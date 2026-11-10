// 旅のしおり：画面の配信と Notion API の中継（Cloudflare Worker）
// Notion のトークンはこの Worker の secret にだけ置き、ブラウザには渡さない。
// 読み書きするのは PAGE_ID のページの「ToDo」見出しの下にあるチェックボックスだけ。

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const MAX_DEPTH = 4; // まとまり（日付・事前準備など）の下に何段まで読むか
const MAX_TEXT = 200;
const LIST_TYPES = new Set(["to_do", "bulleted_list_item", "numbered_list_item", "paragraph"]);
const DATE_HEAD = /^(\d{1,2})\/(\d{1,2})/;
const TIME_HEAD = /^(\d{1,2}[:：]\d{2})[\s　]*(.*)$/u;
const PLACE = /(ホテル|レストラン|カフェ|コーヒー|ハウス|ガーデン|テラス|駅|北斎|ショップ|ストア|ファッション|ランド|シー|パーク|バザール|ダイナー|キッチン|グリル|ラウンジ|イクスピアリ)/u;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      checkConfig(env);
      if (!authorized(request, env)) return json({ error: "合言葉が違います" }, 401);
      const notion = notionClient(env);

      if (url.pathname === "/api/trip" && request.method === "GET") {
        return json(await getTrip(notion, env));
      }
      if (url.pathname === "/api/groups" && request.method === "POST") {
        const body = await readJson(request);
        return json(await addGroup(notion, env, body));
      }
      const childMatch = url.pathname.match(/^\/api\/blocks\/([0-9a-f-]{32,36})\/children$/i);
      if (childMatch && request.method === "POST") {
        const body = await readJson(request);
        return json(await addItem(notion, env, childMatch[1], body));
      }
      const blockMatch = url.pathname.match(/^\/api\/blocks\/([0-9a-f-]{32,36})$/i);
      if (blockMatch && request.method === "PATCH") {
        const body = await readJson(request);
        return json(await updateItem(notion, env, blockMatch[1], body));
      }
      if (blockMatch && request.method === "DELETE") {
        return json(await deleteItem(notion, env, blockMatch[1]));
      }
      if (url.pathname === "/api/pois" && request.method === "GET") {
        return json(await getPois(env));
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      const status = err.status || 500;
      return json({ error: err.publicMessage || "サーバーでエラーが起きました" }, status);
    }
  },
};

// ---------- 読む ----------

async function getTrip(notion, env) {
  const [page, top] = await Promise.all([
    notion("GET", `/pages/${env.PAGE_ID}`),
    listChildren(notion, env.PAGE_ID),
  ]);
  const section = pickSection(top, hiddenPrefixes(env));
  const filled = await withChildren(notion, section, 1);
  const year = Number(env.TRIP_YEAR) || new Date().getUTCFullYear();
  const days = [];
  const groups = [];
  for (const b of filled) {
    const text = blockText(b);
    const m = text.match(DATE_HEAD);
    if (m) {
      const date = `${year}-${pad(m[1])}-${pad(m[2])}`;
      days.push({ id: b.id, label: text, date, items: sortByTime(b.children.map((c) => toItem(c, env, true))) });
    } else {
      groups.push({ id: b.id, label: text, items: b.children.map((c) => toItem(c, env, false)) });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return {
    title: env.TITLE || pageTitle(page),
    pageUrl: `https://www.notion.so/${normalizeId(env.PAGE_ID)}`,
    parks: tripParks(env),
    days,
    groups,
    fetchedAt: new Date().toISOString(),
  };
}

function tripParks(env) {
  const list = (env.TRIP_PARKS || "land,sea").split(",").map((s) => s.trim()).filter((s) => s === "land" || s === "sea");
  return list.length ? list : ["land", "sea"];
}

// ページ直下のうち「ToDo」見出しから次の見出しまで（見出しが無ければ全部）の、チェックボックスのまとまり
function pickSection(top, hidden) {
  const start = top.findIndex((b) => isHeading(b) && /todo/i.test(blockText(b)));
  let blocks = top;
  if (start >= 0) {
    const rest = top.slice(start + 1);
    const end = rest.findIndex(isHeading);
    blocks = end >= 0 ? rest.slice(0, end) : rest;
  }
  // 済みにした1行だけのチェック（「〇〇を決める」など）はしおりに出さない
  return blocks.filter(
    (b) => b.type === "to_do" && !(b.to_do.checked && !b.has_children) && !hidden.some((h) => blockText(b).startsWith(h)),
  );
}

function sectionEnd(top) {
  const start = top.findIndex((b) => isHeading(b) && /todo/i.test(blockText(b)));
  if (start < 0) return top.at(-1)?.id || null;
  const rest = top.slice(start + 1);
  const end = rest.findIndex(isHeading);
  const inSection = end >= 0 ? rest.slice(0, end) : rest;
  return (inSection.at(-1) || top[start]).id;
}

async function withChildren(notion, blocks, depth) {
  return mapLimit(blocks, 3, async (b) => {
    const kids = b.has_children && depth <= MAX_DEPTH ? await listChildren(notion, b.id) : [];
    const listed = kids.filter((k) => LIST_TYPES.has(k.type) && (blockText(k) || k.has_children));
    return { ...b, children: await withChildren(notion, listed, depth + 1) };
  });
}

function toItem(b, env, withTime) {
  const text = blockText(b);
  const t = withTime ? text.match(TIME_HEAD) : null;
  const label = t ? t[2] : text;
  const item = {
    id: b.id,
    text,
    label,
    time: t ? t[1].replace("：", ":") : null,
    checked: b.type === "to_do" ? !!b.to_do.checked : null,
    children: (b.children || []).map((c) => toItem(c, env, withTime)),
  };
  const link = firstLink(b);
  const q = withTime ? mapQuery(label) : null;
  if (link) item.link = link;
  if (q) item.map = mapUrl(q, env);
  return item;
}

// 時刻順に並べる。時刻の無い行（ルートのメモなど）は直前の時刻つきの行にくっついて動く
export function sortByTime(items) {
  const head = [];
  const segs = [];
  for (const i of items) {
    if (i.time) segs.push([i]);
    else (segs.length ? segs.at(-1) : head).push(i);
  }
  const min = (t) => t.split(":").reduce((h, m) => Number(h) * 60 + Number(m));
  segs.sort((a, b) => min(a[0].time) - min(b[0].time));
  return [...head, ...segs.flat()];
}

// 予定の文から地図で探す場所を取り出す（例：「ルームサービス（東京ディズニーランドホテル）」→ かっこの中）
export function mapQuery(label) {
  const forced = label.includes("📍");
  const s = label.replace(/📍/gu, "").trim();
  const paren = s.match(/[（(]([^）)]+)[）)]/u);
  if (paren && PLACE.test(paren[1])) return paren[1].trim();
  const base = s
    .replace(/[（(][^）)]*[）)]/gu, "")
    .replace(/[\s　]*(チェックイン|チェックアウト|集合|到着|出発)$/u, "")
    .trim();
  const station = base.match(/^(\S+?(?:駅|PA|SA))/u);
  if (station) return /PA|SA/.test(station[1]) && paren && /[上下]り/u.test(paren[1]) ? `${station[1]} ${paren[1]}` : station[1];
  if (forced) return base;
  if (PLACE.test(base) && !/[⇒→]/u.test(base)) return base;
  return null;
}

function mapUrl(q, env) {
  const area = env.MAP_AREA && !/駅|〒|PA|SA/u.test(q) ? ` ${env.MAP_AREA}` : "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q + area)}`;
}

// ---------- 書く ----------

async function updateItem(notion, env, id, body) {
  const block = await assertWritable(notion, env, id);
  if (block.type !== "to_do") throw httpError(400, "チェックボックス以外は書き換えられません");
  const patch = {};
  if (typeof body.checked === "boolean") patch.checked = body.checked;
  if (body.text !== undefined) patch.rich_text = richText(cleanText(body.text));
  if (!Object.keys(patch).length) throw httpError(400, "変更がありません");
  const updated = await notion("PATCH", `/blocks/${id}`, { to_do: patch });
  return { id: updated.id, text: blockText(updated), checked: !!updated.to_do?.checked };
}

// 消す（Notion のゴミ箱へ。30日は戻せる）。日付のまとまり（11/12 など）は丸ごと消えるので消さない
async function deleteItem(notion, env, id) {
  const block = await assertWritable(notion, env, id);
  if (block.type !== "to_do") throw httpError(400, "チェックボックス以外は消せません");
  if (block.parent?.type === "page_id" && DATE_HEAD.test(blockText(block))) {
    throw httpError(400, "日付のまとまりはアプリからは消せません（Notion で消してください）");
  }
  await notion("DELETE", `/blocks/${id}`);
  return { id, deleted: true };
}

// ---------- 詳しい地図（OpenStreetMap のデータ） ----------
// パークの敷地の中の施設（アトラクション・食べ物・ショップ・トイレ・ベビー）だけを Overpass API から取り、1週間キャッシュする。
// 敷地は OpenStreetMap の「テーマパーク」の形を使う。見つからないときだけ、園内に収まる狭い四角で取る
const OVERPASS = "https://overpass-api.de/api/interpreter";
const PARK_AREA = {
  land: { name: "^(東京ディズニーランド|Tokyo Disneyland)$", bbox: "35.6303,139.8768,35.6362,139.8838" },
  sea: { name: "^(東京ディズニーシー|Tokyo DisneySea)$", bbox: "35.6236,139.8822,35.6296,139.8905" },
};
const OUTSIDE = /ホテル|hotel|イクスピアリ|ikspiari|ボン・?ヴォヤージュ|bon voyage|駅|station|リゾートライン|駐車場|parking/iu;

function poiQuery(park, useBbox) {
  const a = PARK_AREA[park];
  const where = useBbox ? `(${a.bbox})` : "(area.p)";
  return `[out:json][timeout:40];
${useBbox ? "" : `area["tourism"="theme_park"]["name"~"${a.name}"]->.p;`}
(
  nwr["tourism"="attraction"]${where};
  nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|toilets|baby_hatch)$"]${where};
  nwr["shop"]${where};
  nwr["changing_table"="yes"]${where};
  nwr["baby_feeding"]${where};
);
out center tags;`;
}

async function overpass(env, query) {
  const res = await fetch(env.OVERPASS_URL || OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "trip-shiori/1.0 (personal trip planner)" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw httpError(502, "地図のデータ（OpenStreetMap）を取れませんでした。少し待ってからもう一度");
  return (await res.json()).elements || [];
}

export function poiKind(tags) {
  if (tags.amenity === "toilets") return "toilet";
  if (tags.changing_table === "yes" && !tags.amenity) return "baby";
  if (tags.baby_feeding || /ベビー|授乳/u.test(tags.name || "")) return "baby";
  if (/^(restaurant|cafe|fast_food|bar|pub|ice_cream)$/.test(tags.amenity || "")) return "food";
  if (tags.shop) return "shop";
  return "ride";
}

async function getPois(env) {
  const parks = tripParks(env);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`https://trip-shiori.cache/pois-v2-${parks.join("-")}`);
  const hit = cache && (await cache.match(key));
  if (hit) return hit.json();
  const pois = [];
  for (const park of parks) {
    let elements = await overpass(env, poiQuery(park, false));
    if (!elements.length) elements = await overpass(env, poiQuery(park, true)); // 敷地の形が見つからないとき
    for (const e of elements) {
      const tags = e.tags || {};
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      if (lat == null || lon == null) continue;
      const kind = poiKind(tags);
      const name = tags["name:ja"] || tags.name || (kind === "toilet" ? "トイレ" : "");
      if (!name || OUTSIDE.test(`${name} ${tags.name || ""}`)) continue;
      pois.push({
        n: name,
        k: kind,
        p: park,
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        ...(tags.changing_table === "yes" ? { ct: 1 } : {}),
        ...(tags.wheelchair === "yes" ? { wc: 1 } : {}),
      });
    }
  }
  const out = { pois, parks, fetchedAt: new Date().toISOString(), attribution: "© OpenStreetMap contributors (ODbL)" };
  if (cache) {
    await cache.put(key, new Response(JSON.stringify(out), { headers: { "Cache-Control": "max-age=604800", "Content-Type": "application/json" } }));
  }
  return out;
}

async function addItem(notion, env, parentId, body) {
  const parent = await assertWritable(notion, env, parentId);
  if (parent.type !== "to_do") throw httpError(400, "チェックボックスの下にだけ足せます");
  const text = cleanText(body.text);
  const res = await notion("PATCH", `/blocks/${parentId}/children`, { children: [todo(text)] });
  const b = res.results?.[0];
  if (!b) throw httpError(502, "Notion に追加できませんでした");
  return { id: b.id, text, label: text, time: null, checked: false, children: [] };
}

async function addGroup(notion, env, body) {
  const text = cleanText(body.text);
  if (DATE_HEAD.test(text)) throw httpError(400, "日付で始まるまとまりは Notion で足してください");
  const top = await listChildren(notion, env.PAGE_ID);
  const after = sectionEnd(top);
  const res = await notion("PATCH", `/blocks/${env.PAGE_ID}/children`, {
    children: [todo(text)],
    ...(after ? { after } : {}),
  });
  const b = res.results?.find((r) => blockText(r) === text) || res.results?.at(-1);
  if (!b) throw httpError(502, "Notion に追加できませんでした");
  return { id: b.id, label: text, items: [] };
}

// 書き換えてよいのは、しおりのページの「ToDo」の下（隠したまとまりを除く）にあるブロックだけ
async function assertWritable(notion, env, id) {
  const block = await notion("GET", `/blocks/${id}`);
  let cur = block;
  for (let i = 0; i <= MAX_DEPTH + 1; i++) {
    const p = cur.parent || {};
    if (p.type === "page_id") {
      if (normalizeId(p.page_id) !== normalizeId(env.PAGE_ID)) break;
      const top = await listChildren(notion, env.PAGE_ID);
      const section = pickSection(top, hiddenPrefixes(env));
      if (!section.some((b) => normalizeId(b.id) === normalizeId(cur.id))) break;
      return block;
    }
    if (p.type !== "block_id") break;
    cur = await notion("GET", `/blocks/${p.block_id}`);
  }
  throw httpError(403, "しおりの外のブロックは書き換えられません");
}

// ---------- Notion ----------

function checkConfig(env) {
  if (!env.NOTION_TOKEN || !env.APP_KEY || env.APP_KEY.length < 16 || !env.PAGE_ID) {
    throw httpError(500, "Worker の設定（NOTION_TOKEN / APP_KEY / PAGE_ID）が足りません");
  }
}

function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return constantTimeEqual(given, env.APP_KEY);
}

function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}

function notionClient(env) {
  const base = env.NOTION_API_BASE || NOTION_BASE;
  const call = async (method, path, body, retry = true) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && retry) {
      const wait = Math.min(Number(res.headers.get("Retry-After")) || 1, 3);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return call(method, path, body, false);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint =
        data.code === "object_not_found"
          ? "Notion でしおりのページにインテグレーションが接続されていません（README の手順1）"
          : data.code === "unauthorized"
            ? "Notion のトークンが正しくありません"
            : data.code === "rate_limited"
              ? "Notion が混み合っています。少し待ってください"
              : `Notion エラー（${data.code || res.status}）`;
      throw httpError(res.status === 429 ? 429 : 502, hint);
    }
    return data;
  };
  return call;
}

async function listChildren(notion, id) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const q = `page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const res = await notion("GET", `/blocks/${id}/children?${q}`);
    out.push(...(res.results || []));
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return out;
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

function blockText(b) {
  const rt = b?.[b?.type]?.rich_text || [];
  return rt.map((r) => r.plain_text ?? r.text?.content ?? "").join("").trim();
}

function firstLink(b) {
  const rt = b?.[b?.type]?.rich_text || [];
  const href = rt.find((r) => r.href)?.href;
  return href && /^https:\/\//.test(href) ? href : null;
}

function isHeading(b) {
  return /^heading_\d$/.test(b.type);
}

function pageTitle(page) {
  const prop = Object.values(page.properties || {}).find((p) => p.type === "title");
  return (prop?.title || []).map((t) => t.plain_text).join("") || "旅のしおり";
}

function hiddenPrefixes(env) {
  return (env.HIDE_GROUPS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function todo(text) {
  return { object: "block", type: "to_do", to_do: { rich_text: richText(text), checked: false } };
}

function richText(text) {
  return [{ type: "text", text: { content: text } }];
}

function cleanText(v) {
  const s = typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim() : "";
  if (!s) throw httpError(400, "文字を入れてください");
  if (s.length > MAX_TEXT) throw httpError(400, `${MAX_TEXT}文字までです`);
  return s;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function normalizeId(id) {
  return (id || "").replace(/-/g, "").toLowerCase();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "リクエストの形式が正しくありません");
  }
}

function httpError(status, publicMessage) {
  return Object.assign(new Error(publicMessage), { status, publicMessage });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
