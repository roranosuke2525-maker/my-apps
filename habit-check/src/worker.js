// 習慣チェック入力アプリ：画面の配信と Notion API の中継（Cloudflare Worker）
// Notion のトークンはこの Worker の secret にだけ置き、ブラウザには渡さない。

import { TYPES, STAGES, THRESHOLDS, BALANCE_RATIO, NOTE_EXP, habitType, habitWeight, tagType } from "./aibou-config.js";
import { SLOT_ORDER, slotOf, itemName, rarityOf, isCrit, RARITY_EFFECT } from "./item-config.js";
import { RANKS, WEAK_BONUS, BALANCE_BONUS, PET_BONUS, STAR_BONUS, STAT_EXP, STAT_RATE, STAT_MAX, familyOf, starsOf } from "./battle-config.js";

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const NOTE_PROPERTY = "ひとこと";
const TITLE_PROPERTY = "日";
const STAT_TYPES = new Set(["formula", "rollup"]);

// 区分：◆必ず ◇できれば ★ボーナス（達成率に数えない） ／ 時間帯：☼朝 ☀︎日中 ◐夕方 ☾寝る前 ↻いつでも（◷は日中として読む）
// 名前の最後に（火金）のように曜日を書くと、その曜日だけ達成率に数える
const SLOTS = { "☼": "morning", "☀": "noon", "◷": "noon", "◐": "evening", "☾": "night", "↻": "anytime" };
const HABIT_NAME = /^([◆◇★])\s*([☼☀◷◐☾↻])[︎️]?\s*(.+)$/u;
const HABIT_DAYS = /[（(]([日月火水木金土]+)[）)]\s*$/u;

function parseHabit(p) {
  const m = p.name.match(HABIT_NAME);
  const label = m ? m[3].trim() : p.name;
  const d = label.match(HABIT_DAYS);
  return {
    name: p.name,
    label,
    must: m ? m[1] === "◆" : false,
    bonus: m ? m[1] === "★" : false,
    slot: m ? SLOTS[m[2]] : "anytime",
    days: d ? [...new Set([...d[1]].map((c) => "日月火水木金土".indexOf(c)))] : null,
    hint: p.description || "",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      checkConfig(env);
      if (!authorized(request, env)) return json({ error: "合言葉が違います" }, 401);
      const notion = notionClient(env);
      if (request.method !== "GET") forgetPlayer(env);

      if (url.pathname === "/api/day" && request.method === "GET") {
        return json(await getDay(notion, env, url.searchParams.get("date")));
      }
      if (url.pathname === "/api/day" && request.method === "POST") {
        const body = await readJson(request);
        return json(await createDay(notion, env, body.date));
      }
      const pageMatch = url.pathname.match(/^\/api\/pages\/([0-9a-f-]{32,36})$/i);
      if (pageMatch && request.method === "PATCH") {
        const body = await readJson(request);
        return json(await updateHabit(notion, env, pageMatch[1], body));
      }
      if (url.pathname === "/api/range" && request.method === "GET") {
        return json(await getRange(notion, env, url.searchParams.get("from"), url.searchParams.get("to")));
      }
      if (url.pathname === "/api/player" && request.method === "GET") {
        return json(await getPlayer(notion, env));
      }
      if (url.pathname === "/api/party" && request.method === "GET") {
        return json(await getParty(notion, env));
      }
      if (url.pathname === "/api/guild" && request.method === "GET") {
        return json(await getGuild(notion, env));
      }
      if (url.pathname === "/api/guild/reports" && request.method === "POST") {
        const body = await readJson(request);
        return json(await createReport(notion, env, body));
      }
      if (url.pathname === "/api/story" && request.method === "GET") {
        return json(await getStories(notion, env));
      }
      const storyMatch = url.pathname.match(/^\/api\/story\/([0-9a-f-]{32,36})$/i);
      if (storyMatch && request.method === "GET") {
        return json(await getStory(notion, env, storyMatch[1]));
      }
      if (storyMatch && request.method === "PATCH") {
        const body = await readJson(request);
        return json(await markStory(notion, env, storyMatch[1], body));
      }
      if (url.pathname === "/api/items" && request.method === "GET") {
        return json(await getItems(notion, env));
      }
      const itemMatch = url.pathname.match(/^\/api\/items\/([0-9a-f-]{32,36})$/i);
      if (itemMatch && request.method === "PATCH") {
        const body = await readJson(request);
        return json(await equipItem(notion, env, itemMatch[1], body));
      }
      if (url.pathname === "/api/battle" && request.method === "GET") {
        return json(await getBattle(notion, env));
      }
      if (url.pathname === "/api/aibou" && request.method === "GET") {
        return json(await getAibou(notion, env));
      }
      if (url.pathname === "/api/aibou" && request.method === "POST") {
        return json(await createAibou(notion, env));
      }
      if (url.pathname === "/api/aibou" && request.method === "PATCH") {
        const body = await readJson(request);
        return json(await renameAibou(notion, env, body));
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      const status = err.status || 500;
      return json({ error: err.publicMessage || "サーバーでエラーが起きました" }, status);
    }
  },
};

function checkConfig(env) {
  if (!env.NOTION_TOKEN || !env.APP_KEY || env.APP_KEY.length < 16 || !env.DATA_SOURCE_ID) {
    throw httpError(500, "Worker の設定（NOTION_TOKEN / APP_KEY / DATA_SOURCE_ID）が足りません");
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
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint =
        data.code === "object_not_found"
          ? "Notion でデータベースにインテグレーションが接続されていません（README の手順1）"
          : data.code === "unauthorized"
            ? "Notion のトークンが正しくありません"
            : data.code === "rate_limited"
              ? "Notion が混み合っています。少し待ってください"
              : `Notion エラー（${data.code || res.status}）`;
      throw httpError(res.status === 429 ? 429 : 502, hint);
    }
    return data;
  };
}

async function getDay(notion, env, date) {
  assertDate(date);
  const [schema, row] = await Promise.all([loadSchema(notion, env), findRow(notion, env, date)]);
  return { date, habits: schema.habits, row: row ? summarizeRow(row, schema) : null };
}

async function createDay(notion, env, date) {
  assertDate(date);
  const schema = await loadSchema(notion, env);
  const existing = await findRow(notion, env, date);
  if (existing) return { date, habits: schema.habits, row: summarizeRow(existing, schema) };

  const properties = {
    [TITLE_PROPERTY]: { title: [{ type: "mention", mention: { type: "date", date: { start: date } } }] },
  };
  if (env.PLAYER_PAGE_ID && schema.props["プレイヤー"]?.type === "relation") {
    properties["プレイヤー"] = { relation: [{ id: env.PLAYER_PAGE_ID }] };
  }
  const page = await notion("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: env.DATA_SOURCE_ID },
    properties,
  });
  return { date, habits: schema.habits, row: summarizeRow(page, schema) };
}

async function updateHabit(notion, env, pageId, body) {
  const schema = await loadSchema(notion, env);
  const { name, value } = body || {};
  let patch;
  if (name === NOTE_PROPERTY && schema.props[NOTE_PROPERTY]?.type === "rich_text") {
    if (typeof value !== "string" || value.length > 2000) throw httpError(400, "ひとことは2000字までです");
    patch = { rich_text: value ? [{ type: "text", text: { content: value } }] : [] };
  } else if (schema.habitNames.has(name) && typeof value === "boolean") {
    patch = { checkbox: value };
  } else {
    throw httpError(400, "変更できない項目です");
  }

  // DB_習慣チェック の行だけを書き換える（他のページには触らない）
  const page = await notion("GET", `/pages/${pageId}`);
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(env.DATA_SOURCE_ID)) {
    throw httpError(403, "DB_習慣チェック の行ではありません");
  }
  const updated = await notion("PATCH", `/pages/${pageId}`, { properties: { [name]: patch } });
  return { row: summarizeRow(updated, schema) };
}

async function loadSchema(notion, env) {
  const ds = await notion("GET", `/data_sources/${env.DATA_SOURCE_ID}`);
  const props = ds.properties || {};
  // Notion API ではビューの表示設定が読めないので、出さない習慣は HIDDEN_HABITS（wrangler.toml）に書く
  const hidden = new Set((env.HIDDEN_HABITS || "").split(",").map((s) => s.trim()).filter(Boolean));
  const habits = Object.values(props)
    .filter((p) => p.type === "checkbox" && !hidden.has(p.name))
    .map((p) => ({ ...parseHabit(p), aibou: { type: habitType(p.name), exp: habitWeight(p.name) } }));
  return { props, habits, habitNames: new Set(habits.map((h) => h.name)) };
}

async function findRow(notion, env, date) {
  const next = addDays(date, 1);
  const res = await notion("POST", `/data_sources/${env.DATA_SOURCE_ID}/query`, {
    filter: {
      timestamp: "created_time",
      created_time: { on_or_after: `${date}T00:00:00+09:00` },
    },
    sorts: [{ timestamp: "created_time", direction: "ascending" }],
    page_size: 10,
  });
  const end = Date.parse(`${next}T00:00:00+09:00`);
  return (res.results || []).find((p) => Date.parse(p.created_time) < end) || null;
}

function summarizeRow(page, schema) {
  const checks = {};
  const stats = {};
  let note = "";
  for (const [name, prop] of Object.entries(page.properties || {})) {
    if (prop.type === "checkbox" && schema.habitNames.has(name)) checks[name] = prop.checkbox;
    else if (name === NOTE_PROPERTY && prop.type === "rich_text") note = prop.rich_text.map((t) => t.plain_text ?? t.text?.content ?? "").join("");
    else if (STAT_TYPES.has(prop.type)) {
      const v = statValue(prop);
      if (v !== null) stats[name] = v;
    }
  }
  return { id: page.id, url: page.url, checks, note, stats };
}

function statValue(prop) {
  const inner = prop.type === "formula" ? prop.formula : prop.rollup;
  if (!inner) return null;
  if (inner.type === "number") return inner.number;
  if (inner.type === "string") return inner.string;
  if (inner.type === "boolean") return inner.boolean;
  if (inner.type === "date") return inner.date?.start ?? null;
  if (inner.type === "array") {
    const first = inner.array?.[0];
    return first ? propValue(first) : null;
  }
  return null;
}

// どの型の列でも、画面に出せる素の値（文字・数・真偽・ID一覧）にする
function propValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case "title":
    case "rich_text":
      return (prop[prop.type] || []).map((t) => t.plain_text ?? t.text?.content ?? "").join("");
    case "number":
      return prop.number;
    case "checkbox":
      return prop.checkbox;
    case "select":
      return prop.select?.name ?? null;
    case "status":
      return prop.status?.name ?? null;
    case "relation":
      return (prop.relation || []).map((r) => r.id);
    case "created_time":
      return prop.created_time;
    case "date":
      return prop.date?.start ?? null;
    case "formula":
    case "rollup":
      return statValue(prop);
    default:
      return null;
  }
}

function pick(page, map) {
  const out = { id: page.id, url: page.url };
  for (const [key, name] of Object.entries(map)) out[key] = propValue(page.properties?.[name]);
  return out;
}

// ---------- 週・カレンダー・グラフ（DB_習慣チェック の期間まとめ読み） ----------
const MAX_RANGE_DAYS = 62;

async function getRange(notion, env, from, to) {
  assertDate(from);
  assertDate(to);
  const span = (Date.parse(to) - Date.parse(from)) / 86400e3;
  if (span < 0 || span > MAX_RANGE_DAYS) throw httpError(400, `期間は${MAX_RANGE_DAYS}日までです`);
  const [schema, rows] = await Promise.all([
    loadSchema(notion, env),
    queryAll(notion, env.DATA_SOURCE_ID, {
      filter: {
        and: [
          { timestamp: "created_time", created_time: { on_or_after: `${from}T00:00:00+09:00` } },
          { timestamp: "created_time", created_time: { before: `${addDays(to, 1)}T00:00:00+09:00` } },
        ],
      },
      sorts: [{ timestamp: "created_time", direction: "ascending" }],
    }),
  ]);
  const days = {};
  for (const page of rows) {
    const date = jstDate(page.created_time);
    if (!days[date]) days[date] = summarizeRow(page, schema);
  }
  return { from, to, habits: schema.habits, days };
}

// ---------- きろく（DB_プレイヤー） ----------
const PLAYER_FIELDS = {
  name: "名前",
  level: "レベル",
  toNext: "次のレベルまで",
  totalExp: "総EXP",
  habitExp: "習慣EXP",
  taskExp: "タスクEXP",
  guildExp: "ギルドEXP",
  status: "ステータス",
  party: "なかま",
  spell: "じゅもん",
};

// Notion API はページの rollup を関連の先頭25件だけで計算し、それを使う数式（総EXP・レベル…）もずれる。
// そこで EXP の rollup は「ページのプロパティ」API で全件の合計を取り直し、レベル系は Notion と同じ式で計算し直す。
const EXP_ROLLUPS = { habitExp: "習慣EXP", taskExp: "タスクEXP", guildExp: "ギルドEXP" };
const MAX_PROPERTY_PAGES = 30;
const PLAYER_TTL = 60e3;
const playerCache = new WeakMap(); // env ごと（同じ Worker の中で1分だけ使い回す）

// DB_プレイヤーの数式と同じ：レベル = floor(√(総EXP/25)) + 1、レベルnの始まり = 25(n-1)²
const levelOf = (xp) => Math.floor(Math.sqrt(xp / 25)) + 1;
const expAt = (lv) => 25 * (lv - 1) ** 2;
const JOBS = [[20, "でんせつ"], [15, "たつじん"], [10, "ベテラン"], [7, "いちにんまえ"], [4, "かけだし"], [0, "みならい"]];

// DB_プレイヤー「ステータス」の数式と同じ文面
function statusText(name, lv, xp, exp) {
  const cur = expAt(lv);
  const nxt = expAt(lv + 1);
  const fill = Math.floor(((xp - cur) / (nxt - cur)) * 10);
  const job = JOBS.find(([min]) => lv >= min)[1];
  return `▶ ${name}　Lv ${lv}\nしょくぎょう：${job}\nEXP：${"■".repeat(fill)}${"□".repeat(10 - fill)}\n` +
    `つぎの レベルまで あと ${nxt - xp} EXP\n（しゅうかん ${exp.habitExp}／ギルド ${exp.guildExp}／タスク ${exp.taskExp}）`;
}

// 取れなければページの値（先頭25件の合計）のまま。プロパティIDは URL エンコード済みで返ることがある
async function fullRollup(notion, pageId, prop) {
  if (!prop || prop.type !== "rollup") return null;
  const fallback = prop.rollup?.type === "number" ? prop.rollup.number : null;
  const propId = encodeURIComponent(decodeURIComponent(prop.id));
  try {
    return await pagedRollup(notion, pageId, propId);
  } catch {
    return fallback;
  }
}

// rollup の元の行を、データソースの検索でまとめて読んで足す（プロパティAPIを25件ずつめくるより速い）。
// 読めなければ null（fullRollup に任せる）
const EXP_SOURCES = {
  habitExp: { ds: "DATA_SOURCE_ID", prop: "EXP" },
  taskExp: { ds: "TASK_DS_ID", prop: "討伐EXP", only: { property: "討伐EXP", formula: { number: { greater_than: 0 } } } },
  guildExp: { ds: "GUILD_DS_ID", prop: "累計EXP" },
};

async function sumByQuery(notion, env, key) {
  const src = EXP_SOURCES[key];
  if (!src || !env[src.ds]) return null;
  try {
    const mine = { property: "プレイヤー", relation: { contains: env.PLAYER_PAGE_ID } };
    const rows = await queryAll(notion, env[src.ds], { filter: src.only ? { and: [mine, src.only] } : mine }, MAX_PROPERTY_PAGES);
    if (!rows.length) return null; // 1行もなければ rollup のほうを信じる（接続や関連の付け方が違うとき）
    return rows.reduce((a, p) => a + (Number(propValue(p.properties?.[src.prop])) || 0), 0);
  } catch {
    return null;
  }
}

async function pagedRollup(notion, pageId, propId) {
  let cursor;
  let last = null;
  for (let i = 0; i < MAX_PROPERTY_PAGES; i++) {
    const q = `page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await notion("GET", `/pages/${pageId}/properties/${propId}?${q}`);
    last = res.property_item?.rollup ?? res.rollup ?? null;
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return last?.type === "number" ? last.number : null;
}

async function loadPlayer(notion, env) {
  const cached = playerCache.get(env);
  if (cached && Date.now() - cached.at < PLAYER_TTL) return cached.value;
  if (!env.PLAYER_PAGE_ID) throw httpError(500, "PLAYER_PAGE_ID が設定されていません（wrangler.toml）");
  const page = await notion("GET", `/pages/${env.PLAYER_PAGE_ID}`);
  const player = pick(page, PLAYER_FIELDS);
  const entries = await Promise.all(
    Object.entries(EXP_ROLLUPS).map(async ([key, name]) => [key, (await sumByQuery(notion, env, key)) ?? (await fullRollup(notion, page.id, page.properties?.[name]))]),
  );
  const exp = Object.fromEntries(entries);
  // 習慣EXPも読めないときは計算し直さない（接続が足りない。Notion の値のまま出す）
  if (typeof exp.habitExp === "number") {
    const xp = (exp.habitExp ?? 0) + (exp.taskExp ?? 0) + (exp.guildExp ?? 0);
    const level = levelOf(xp);
    Object.assign(player, exp, { totalExp: xp, level, toNext: expAt(level + 1) - xp });
    player.status = statusText(player.name || "プレイヤー", level, xp, { habitExp: exp.habitExp ?? 0, taskExp: exp.taskExp ?? 0, guildExp: exp.guildExp ?? 0 });
  }
  playerCache.set(env, { at: Date.now(), value: player });
  return player;
}

// 書き込んだらEXPが変わるので読み直させる
function forgetPlayer(env) {
  playerCache.delete(env);
  eventsCache.delete(env);
}

async function playerLevel(notion, env) {
  const lv = (await loadPlayer(notion, env)).level;
  return typeof lv === "number" ? lv : null;
}

async function getPlayer(notion, env) {
  return { player: await loadPlayer(notion, env) };
}

// ---------- パーティー（DB_すがた：ひょうじ が付いたものだけ） ----------
async function getParty(notion, env) {
  const rows = await queryAll(notion, dsId(env, "PARTY_DS_ID"), {
    sorts: [{ property: "なまえ", direction: "ascending" }],
  });
  const lv = await playerLevel(notion, env);
  // DB_すがた「ひょうじ」と同じ判定を、正しいレベルでやり直す（レベルが分からなければ Notion の値）
  const shown = rows
    .map((p) => ({ page: p, m: pick(p, { name: "なまえ", kind: "しゅるい", needLv: "ひつようLv", nextLv: "つぎLv" }) }))
    .filter(({ page, m }) => {
      if (lv === null) return propValue(page.properties?.["ひょうじ"]) !== false;
      return m.kind === "なかま" ? lv >= (m.needLv ?? 0) : lv >= (m.needLv ?? 0) && lv < (m.nextLv ?? Infinity);
    });
  const members = await Promise.all(shown.map(async ({ page, m }) => ({ ...m, image: await firstImage(notion, page.id) })));
  return { members };
}

async function firstImage(notion, pageId) {
  const res = await notion("GET", `/blocks/${pageId}/children?page_size=20`);
  const block = (res.results || []).find((b) => b.type === "image");
  if (!block) return null;
  const img = block.image;
  return img.type === "file" ? img.file?.url ?? null : img.external?.url ?? null;
}

// ---------- ギルド（DB_ギルド依頼 と DB_ギルド達成記録） ----------
const QUEST_FIELDS = {
  title: "依頼",
  category: "カテゴリ",
  rank: "ランク",
  lv: "受注Lv",
  exp: "基本EXP",
  stagesText: "段階",
  board: "けいじばん",
  detour: "寄り道",
  count: "達成回数",
  totalExp: "累計EXP",
  playerLv: "いまのLv",
};
const REPORT_LIMIT = 20;
const REPORT_NOTE_MAX = 200;
const REPORT_QUEST_MAX = 5;

async function getGuild(notion, env) {
  const [quests, reports, lv] = await Promise.all([
    queryAll(notion, dsId(env, "GUILD_DS_ID"), { sorts: [{ property: "受注Lv", direction: "ascending" }] }),
    notion("POST", `/data_sources/${dsId(env, "REPORT_DS_ID")}/query`, {
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: REPORT_LIMIT,
    }),
    playerLevel(notion, env),
  ]);
  return {
    quests: quests.map((p) => {
      const q = pick(p, QUEST_FIELDS);
      const { stagesText, ...rest } = q;
      return { ...rest, ...(lv !== null ? { playerLv: lv } : {}), stages: splitStages(stagesText) };
    }),
    reports: (reports.results || []).map(summarizeReport),
  };
}

async function createReport(notion, env, body) {
  const { note } = body || {};
  const questIds = reportQuestIds(body);
  if (typeof note !== "string" || !note.trim() || note.length > REPORT_NOTE_MAX) {
    throw httpError(400, `ひとことを${REPORT_NOTE_MAX}字以内で書いてください`);
  }
  const guild = normalizeId(dsId(env, "GUILD_DS_ID"));
  for (const id of questIds) {
    const quest = await notion("GET", `/pages/${id}`);
    if (normalizeId(quest.parent?.data_source_id) !== guild) throw httpError(403, "DB_ギルド依頼 の依頼ではありません");
  }
  const page = await notion("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: dsId(env, "REPORT_DS_ID") },
    properties: {
      ひとこと: { title: [{ type: "text", text: { content: note.trim() } }] },
      依頼: { relation: questIds.map((id) => ({ id })) },
    },
  });
  // そうびのドロップ（DB_そうび に接続していなければ、ほうこくだけで終わる）
  let drops = [];
  if (env.ITEM_DS_ID) {
    try { drops = await syncDrops(notion, env, [page]); } catch { /* 未接続など */ }
  }
  return { report: summarizeReport(page), drops };
}

// questIds（配列・最大 REPORT_QUEST_MAX 件）か、以前の questId（1件）を受け付ける
function reportQuestIds(body) {
  const raw = Array.isArray(body?.questIds) ? body.questIds : [body?.questId];
  if (!raw.length || raw.length > REPORT_QUEST_MAX) throw httpError(400, `依頼を1〜${REPORT_QUEST_MAX}件えらんでください`);
  if (!raw.every((id) => typeof id === "string" && /^[0-9a-f-]{32,36}$/i.test(id))) throw httpError(400, "依頼を選んでください");
  return [...new Set(raw.map(normalizeId))];
}

function summarizeReport(page) {
  const r = pick(page, { note: "ひとこと", questIds: "依頼" });
  return { ...r, date: page.created_time };
}

function splitStages(text) {
  return (text || "").split(/[｜|]/).map((s) => s.trim()).filter(Boolean);
}

// ---------- ものがたり（DB_ものがたり） ----------
// エピソード1（ほんぺん）は Lv で、エピソード2 は「前の話のボスを倒したか」で開く。よりみちは Notion の判定のまま
const EP2 = "エピソード2";
const STORY_FIELDS = {
  title: "しょう",
  kind: "しゅるい",
  order: "じゅんばん",
  unlockLv: "かいほうLv",
  state: "じょうたい",
  read: "よんだ",
  playerLv: "いまのLv",
  boss: "ボス",
  hp: "ボスHP",
  weak: "弱点",
  bossStart: "ボス開始日",
  defeated: "撃破日",
};

// lv：正しいレベル（分からなければ null で Notion の「いまのLv」のまま）。prev：ひとつ前のエピソード2の話
function summarizeStory(page, lv = null, prev = undefined) {
  const s = pick(page, STORY_FIELDS);
  if (s.kind === EP2) {
    const locked = !!prev && !prev.defeated;
    const state = s.read ? (s.defeated ? "✅ ボスを たおした" : s.boss ? "⚔️ ボスと たたかっている" : "✅ 読んだ") : locked ? "🔒 前の話のボスを倒すと開く" : "📖 NEW！ 読める";
    return { ...s, playerLv: lv ?? s.playerLv, locked, state };
  }
  const notionLocked = typeof s.unlockLv === "number" && typeof s.playerLv === "number" && s.playerLv < s.unlockLv;
  if (lv !== null) s.playerLv = lv;
  const locked = typeof s.unlockLv === "number" && typeof s.playerLv === "number" && s.playerLv < s.unlockLv;
  // Notion 側がずれたレベルでロック表示にしている章は、じょうたい の文面も合わせる
  if (notionLocked && !locked && !s.read && s.kind !== "よりみち") s.state = "📖 NEW！ 読める";
  return { ...s, locked };
}

async function loadStories(notion, env) {
  const [rows, lv] = await Promise.all([
    queryAll(notion, dsId(env, "STORY_DS_ID"), { sorts: [{ property: "じゅんばん", direction: "ascending" }] }),
    playerLevel(notion, env),
  ]);
  const out = [];
  let prev;
  for (const p of rows) {
    const c = summarizeStory(p, lv, prev);
    if (c.kind === EP2) prev = c;
    out.push(c);
  }
  return out;
}

async function getStories(notion, env) {
  return { chapters: await loadStories(notion, env) };
}

async function openStory(notion, env, id) {
  const chapter = (await loadStories(notion, env)).find((c) => normalizeId(c.id) === normalizeId(id));
  if (!chapter) throw httpError(403, "DB_ものがたり のページではありません");
  if (chapter.locked) throw httpError(403, chapter.kind === EP2 ? "前の話のボスを倒すと読めます" : `Lv${chapter.unlockLv}になると読めます`);
  return chapter;
}

async function getStory(notion, env, id) {
  const chapter = await openStory(notion, env, id);
  return { chapter, blocks: await readText(notion, id, 0) };
}

// エピソード2 の話を初めて「よんだ」にした日から、その話のボスとの戦いが始まる
async function markStory(notion, env, id, body) {
  if (typeof body?.read !== "boolean") throw httpError(400, "変更できない項目です");
  const chapter = await openStory(notion, env, id);
  const properties = { よんだ: { checkbox: body.read } };
  if (body.read && chapter.kind === EP2 && chapter.boss && !chapter.bossStart) {
    properties["ボス開始日"] = { date: { start: jstDate(new Date().toISOString()) } };
  }
  await notion("PATCH", `/pages/${id}`, { properties });
  return { chapter: (await loadStories(notion, env)).find((c) => normalizeId(c.id) === normalizeId(id)) };
}

// 本文を「段落」と「引用（SYSTEM など）」の並びにする。トグル（▶ 読む）の中も読む
const TEXT_BLOCKS = new Set(["paragraph", "quote", "callout", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item"]);
const MAX_TEXT_DEPTH = 3;
const MAX_TEXT_PAGES = 5;

async function readText(notion, blockId, depth) {
  const out = [];
  let cursor;
  for (let i = 0; i < MAX_TEXT_PAGES; i++) {
    const q = cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : "";
    const res = await notion("GET", `/blocks/${blockId}/children?page_size=100${q}`);
    for (const b of res.results || []) {
      if (TEXT_BLOCKS.has(b.type)) {
        const text = (b[b.type].rich_text || []).map((t) => t.plain_text ?? "").join("");
        if (text) out.push({ type: b.type === "quote" || b.type === "callout" ? "quote" : b.type.startsWith("heading") ? "heading" : "p", text });
      }
      if (b.has_children && depth < MAX_TEXT_DEPTH && (b.type === "toggle" || b.type === "column_list" || b.type === "column" || TEXT_BLOCKS.has(b.type))) {
        out.push(...(await readText(notion, b.id, depth + 1)));
      }
    }
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return out;
}

// ---------- あいぼう（DB_あいぼう） ----------
// EXP・傾向ポイントは保存せず、誕生日からの DB_習慣チェック と DB_タスク管理（DONE）で毎回計算する。
// 進化した段階・型・日付だけを DB_あいぼう に書き、あとでチェックを外しても戻さない。
const PET_FIELDS = { name: "名前", birthday: "誕生日", stage: "段階", childType: "成長期の型", adultType: "成体の型", history: "進化履歴" };
const PET_NAME_MAX = 20;
const TASK_DONE = "✅ DONE";
const AIBOU_QUERY_PAGES = 30;
const HISTORY_WORD = { 幼体: "孵化", 成長期: "成長期", 成体: "成体" };

async function petPage(notion, env) {
  const res = await notion("POST", `/data_sources/${dsId(env, "AIBOU_DS_ID")}/query`, {
    sorts: [{ timestamp: "created_time", direction: "ascending" }],
    page_size: 1,
  });
  return res.results?.[0] || null;
}

function summarizePet(page) {
  const p = pick(page, PET_FIELDS);
  return { ...p, name: p.name || "", stage: STAGES.includes(p.stage) ? p.stage : "たまご", history: p.history || "" };
}

async function getAibou(notion, env) {
  const page = await petPage(notion, env);
  if (!page) return { pet: null };
  let pet = summarizePet(page);
  const birthday = pet.birthday?.slice(0, 10) || jstDate(page.created_time);
  const days = await aibouDays(notion, env, birthday);
  const g = grow(pet, days);
  if (g.events.length) pet = await saveEvolution(notion, page.id, g);
  const idx = STAGES.indexOf(g.stage);
  const next = STAGES[idx + 1] || null;
  return {
    pet: { ...pet, birthday, stage: g.stage, childType: g.childType, adultType: g.adultType, type: g.stage === "成長期" ? g.childType : g.stage === "成体" ? g.adultType : null },
    exp: g.exp,
    today: Math.round(days[jstDate(new Date().toISOString())]?.exp || 0),
    points: g.points,
    period: g.period,
    from: idx > 0 ? THRESHOLDS[g.stage] : 0,
    next: next ? { stage: next, at: THRESHOLDS[next] } : null,
    evolved: g.events,
  };
}

async function createAibou(notion, env) {
  if (await petPage(notion, env)) return getAibou(notion, env);
  await notion("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: dsId(env, "AIBOU_DS_ID") },
    properties: {
      名前: { title: [] },
      誕生日: { date: { start: jstDate(new Date().toISOString()) } },
      段階: { select: { name: "たまご" } },
    },
  });
  return getAibou(notion, env);
}

async function renameAibou(notion, env, body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || [...name].length > PET_NAME_MAX) throw httpError(400, `名前を${PET_NAME_MAX}字以内で入れてください`);
  const page = await petPage(notion, env);
  if (!page) throw httpError(404, "あいぼうがまだいません");
  const updated = await notion("PATCH", `/pages/${page.id}`, { properties: { 名前: { title: [{ type: "text", text: { content: name } }] } } });
  return { pet: summarizePet(updated) };
}

// 日ごとの EXP と、4つの型への振り分け（あいぼう用：習慣とタスクを日ごとに合わせる）
async function aibouDays(notion, env, from) {
  const { habitDays, tasks } = await loadEvents(notion, env, from);
  const days = {};
  for (const [date, d] of Object.entries(habitDays)) days[date] = { exp: d.exp, points: { ...d.points } };
  for (const t of tasks) {
    const d = (days[t.date] ||= { exp: 0, points: zeroPoints() });
    d.exp += t.exp;
    addPoints(d.points, t.type, t.exp);
  }
  return days;
}

// from 以降の習慣（日ごと）と DONE タスク（1件ずつ）。全期間（能力値）でも使うので、書き込みまで1分だけ使い回す
const eventsCache = new WeakMap();
const EVENTS_TTL = 60e3;

async function loadEvents(notion, env, from) {
  const cache = eventsCache.get(env) || new Map();
  eventsCache.set(env, cache);
  const hit = cache.get(from);
  if (hit && Date.now() - hit.at < EVENTS_TTL) return hit.value;
  const [rows, done] = await Promise.all([
    queryAll(notion, env.DATA_SOURCE_ID, {
      filter: { timestamp: "created_time", created_time: { on_or_after: `${from}T00:00:00+09:00` } },
      sorts: [{ timestamp: "created_time", direction: "ascending" }],
    }, AIBOU_QUERY_PAGES),
    queryAll(notion, dsId(env, "TASK_DS_ID"), {
      filter: { and: [{ property: "ステータス", status: { equals: TASK_DONE } }, { property: "完了日", formula: { date: { on_or_after: from } } }] },
    }, AIBOU_QUERY_PAGES),
  ]);
  const habitDays = {};
  for (const page of rows) {
    const date = jstDate(page.created_time);
    if (habitDays[date]) continue; // 同じ日に2行あれば最初の行だけ（画面と同じ）
    const parts = habitParts(page);
    const sum = parts.reduce((a, x) => a + x.exp, 0);
    const formulaExp = propValue(page.properties?.EXP);
    const total = typeof formulaExp === "number" ? formulaExp : sum;
    const d = (habitDays[date] = { exp: total, points: zeroPoints() });
    if (sum > 0) for (const x of parts) addPoints(d.points, x.type, (x.exp / sum) * total);
    else addPoints(d.points, null, total);
  }
  const tasks = [];
  for (const page of done) {
    const exp = propValue(page.properties?.["討伐EXP"]);
    const date = propValue(page.properties?.["完了日"])?.slice(0, 10);
    if (typeof exp !== "number" || !exp || !date || date < from) continue;
    tasks.push({ ...monsterOf(page, date), exp, date });
  }
  const value = { habitDays, tasks };
  cache.set(from, { at: Date.now(), value });
  return value;
}

// タスク1件をモンスターとして見る（種族＝分類タグ、格＝重さ、★＝作ってから until までの日数）
function monsterOf(page, until = jstDate(new Date().toISOString())) {
  const tag = propValue(page.properties?.["分類タグ"]);
  const weight = propValue(page.properties?.["重さ"]) || "M";
  const family = familyOf(tag);
  const rank = RANKS[weight] || RANKS.M;
  const ageDays = Math.max(0, Math.round((Date.parse(until) - Date.parse(jstDate(page.created_time))) / 86400e3));
  return {
    id: page.id,
    url: page.url,
    title: propValue(page.properties?.["名前"]) || "",
    status: propValue(page.properties?.["ステータス"]),
    type: tagType(tag),
    weight,
    family: family.name,
    colors: family.color,
    shape: rank.shape,
    name: family.name + rank.name,
    stars: starsOf(ageDays),
    ageDays,
  };
}

function habitParts(page) {
  const out = [];
  for (const [name, prop] of Object.entries(page.properties || {})) {
    if (prop.type === "checkbox" && prop.checkbox) out.push({ type: habitType(name), exp: habitWeight(name) });
  }
  if (propValue(page.properties?.[NOTE_PROPERTY])) out.push({ type: null, exp: NOTE_EXP });
  return out;
}

function zeroPoints() {
  return Object.fromEntries(TYPES.map((t) => [t, 0]));
}

// 型が null なら4つに均等割り
function addPoints(points, type, v) {
  if (type) points[type] += v;
  else for (const t of TYPES) points[t] += v / TYPES.length;
}

function topType(points) {
  return TYPES.reduce((best, t) => (points[t] > points[best] ? t : best), TYPES[0]);
}

function adultTypeOf(points) {
  const vals = TYPES.map((t) => points[t]);
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum > 0 && Math.max(...vals) - Math.min(...vals) <= sum * BALANCE_RATIO) return "バランス";
  return topType(points);
}

// 進化履歴「2026-11-01 孵化／2026-11-15 成長期（ちから）」から、段階ごとの日付を読む
function historyDates(text) {
  const out = {};
  for (const m of String(text).matchAll(/(\d{4}-\d{2}-\d{2})\s*(孵化|成長期|成体)/g)) out[m[2] === "孵化" ? "幼体" : m[2]] = m[1];
  return out;
}

// 日付順に EXP を積み、しきい値を越えた日に進化させる。その日のぶんは前の段階の期間に数える。
// すでに Notion に保存された進化は、保存された日付・型のまま（下がらない）
function grow(pet, days) {
  const stored = STAGES.indexOf(pet.stage);
  const dates = historyDates(pet.history);
  const periods = STAGES.map(zeroPoints);
  const points = zeroPoints();
  const events = [];
  let { childType, adultType } = pet;
  let idx = 0;
  let exp = 0;
  for (const date of Object.keys(days).sort()) {
    const d = days[date];
    exp += d.exp;
    for (const t of TYPES) { points[t] += d.points[t]; periods[idx][t] += d.points[t]; }
    while (idx < STAGES.length - 1) {
      const next = STAGES[idx + 1];
      const saved = idx + 1 <= stored;
      if (saved && dates[next] ? date < dates[next] : exp < THRESHOLDS[next]) break;
      idx++;
      if (next === "成長期" && (!saved || !childType)) childType = topType(periods[1]);
      if (next === "成体" && (!saved || !adultType)) adultType = adultTypeOf(periods[2]);
      if (!saved) events.push({ stage: next, date, type: next === "成長期" ? childType : next === "成体" ? adultType : null });
    }
  }
  // 保存済みの段階より下には戻らない（チェックを外して EXP が減ったとき）
  if (idx < stored) idx = stored;
  const round = (p) => Object.fromEntries(TYPES.map((t) => [t, Math.round(p[t])]));
  return { stage: STAGES[idx], childType: childType || null, adultType: adultType || null, exp: Math.round(exp), points: round(points), period: round(periods[idx]), events };
}

async function saveEvolution(notion, pageId, g) {
  // 別の端末が先に書いていたら書かない（履歴が二重にならないように）
  const current = summarizePet(await notion("GET", `/pages/${pageId}`));
  const fresh = g.events.filter((e) => STAGES.indexOf(e.stage) > STAGES.indexOf(current.stage));
  if (!fresh.length) return current;
  const lines = fresh.map((e) => `${e.date} ${HISTORY_WORD[e.stage]}${e.type ? `（${e.type}）` : ""}`);
  const history = [current.history, ...lines].filter(Boolean).join("／");
  const properties = {
    段階: { select: { name: g.stage } },
    進化履歴: { rich_text: [{ type: "text", text: { content: history } }] },
  };
  if (g.childType) properties["成長期の型"] = { select: { name: g.childType } };
  if (g.adultType) properties["成体の型"] = { select: { name: g.adultType } };
  return summarizePet(await notion("PATCH", `/pages/${pageId}`, { properties }));
}

// ---------- そうび（DB_そうび） ----------
// ギルドの「ほうこく」1件につき、依頼ごとに1つ落ちる。Notion で直接ほうこくを足した分も、次に読んだときに落とす
const ITEM_FIELDS = { name: "名前", slot: "部位", type: "型", rarity: "レア", effect: "効果", crit: "会心", equipped: "装備中", date: "入手日", questIds: "依頼", reportIds: "ほうこく" };
const syncing = new WeakMap(); // env ごと：同時に読んでも二重に落とさない

function summarizeItem(page) {
  return pick(page, ITEM_FIELDS);
}

// fresh：いま作ったばかりのほうこく（検索にまだ出てこないことがあるので、足して数える）
async function syncDrops(notion, env, fresh = []) {
  if (syncing.get(env)) return syncing.get(env);
  const run = (async () => {
    const [reports, quests, items] = await Promise.all([
      queryAll(notion, dsId(env, "REPORT_DS_ID"), { sorts: [{ timestamp: "created_time", direction: "ascending" }] }),
      queryAll(notion, dsId(env, "GUILD_DS_ID"), {}),
      queryAll(notion, dsId(env, "ITEM_DS_ID"), {}),
    ]);
    for (const f of fresh) if (!reports.some((r) => normalizeId(r.id) === normalizeId(f.id))) reports.push(f);
    const questById = new Map(quests.map((q) => [normalizeId(q.id), pick(q, { title: "依頼", category: "カテゴリ", rank: "ランク" })]));
    const have = new Set();
    for (const it of items.map(summarizeItem)) {
      for (const r of it.reportIds || []) for (const q of it.questIds || []) have.add(`${normalizeId(r)}|${normalizeId(q)}`);
    }
    const stageOf = new Map();
    const created = [];
    for (const r of reports) {
      const report = summarizeReport(r);
      for (const qid of (report.questIds || []).map(normalizeId)) {
        const stage = stageOf.get(qid) || 0;
        stageOf.set(qid, stage + 1);
        const quest = questById.get(qid);
        if (!quest || have.has(`${normalizeId(r.id)}|${qid}`)) continue;
        const { slot, type } = slotOf(quest.category);
        const crit = isCrit(r.id);
        const rarity = rarityOf(quest.rank, stage, crit);
        const page = await notion("POST", "/pages", {
          parent: { type: "data_source_id", data_source_id: dsId(env, "ITEM_DS_ID") },
          properties: {
            名前: { title: [{ type: "text", text: { content: itemName(quest.title, stage, slot, rarity) } }] },
            部位: { select: { name: slot } },
            型: { select: { name: type } },
            レア: { number: rarity },
            効果: { number: RARITY_EFFECT[rarity] },
            会心: { checkbox: crit },
            入手日: { date: { start: jstDate(r.created_time) } },
            依頼: { relation: [{ id: qid }] },
            ほうこく: { relation: [{ id: r.id }] },
          },
        });
        created.push({ ...summarizeItem(page), quest: quest.title });
      }
    }
    return created;
  })();
  syncing.set(env, run);
  try {
    return await run;
  } finally {
    syncing.delete(env);
  }
}

async function getItems(notion, env) {
  const drops = await syncDrops(notion, env);
  const items = (await queryAll(notion, dsId(env, "ITEM_DS_ID"), { sorts: [{ timestamp: "created_time", direction: "ascending" }] })).map(summarizeItem);
  return { items, drops, slots: SLOT_ORDER };
}

// 装備する／外す。同じ部位は1つだけ（装備したら、同じ部位のほかのものは外す）
async function equipItem(notion, env, id, body) {
  if (typeof body?.equipped !== "boolean") throw httpError(400, "変更できない項目です");
  const page = await notion("GET", `/pages/${id}`);
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(dsId(env, "ITEM_DS_ID"))) throw httpError(403, "DB_そうび のアイテムではありません");
  const item = summarizeItem(page);
  if (body.equipped) {
    const others = await queryAll(notion, dsId(env, "ITEM_DS_ID"), {
      filter: { and: [{ property: "部位", select: { equals: item.slot } }, { property: "装備中", checkbox: { equals: true } }] },
    });
    for (const o of others) if (normalizeId(o.id) !== normalizeId(id)) await notion("PATCH", `/pages/${o.id}`, { properties: { 装備中: { checkbox: false } } });
  }
  await notion("PATCH", `/pages/${id}`, { properties: { 装備中: { checkbox: body.equipped } } });
  return getItems(notion, env);
}

// 装備中のそうびの、型ごとのダメージ＋%（ぜんぶ は4つに半分ずつ）。DB_そうび が読めなければ何も足さない
async function equipBonus(notion, env) {
  if (!env.ITEM_DS_ID) return {};
  try {
    const rows = await queryAll(notion, env.ITEM_DS_ID, { filter: { property: "装備中", checkbox: { equals: true } } });
    const bonus = {};
    for (const it of rows.map(summarizeItem)) {
      const add = (t, v) => { bonus[t] = (bonus[t] || 0) + v; };
      if (it.type === "ぜんぶ") for (const t of TYPES) add(t, (it.effect || 0) / 2);
      else if (TYPES.includes(it.type)) add(it.type, it.effect || 0);
    }
    return bonus;
  } catch {
    return {};
  }
}

// ---------- ぼうけん（章ボス・モンスター・能力値） ----------
// ボスへのダメージは、その話を「よんだ」日からの習慣・DONEタスクのEXPに、弱点・凶暴化・あいぼう・能力値のボーナスを掛けたもの。
// HP を削りきった日を DB_ものがたり の「撃破日」に書くと、次の話が開く（あとでチェックを外しても戻らない）
const STATS_FROM = "2000-01-01";
const OPEN_MONSTERS = 100;
const BATTLE_LOG = 12;

async function getBattle(notion, env) {
  const [stories, all, petRow, open, equip] = await Promise.all([
    loadStories(notion, env),
    loadEvents(notion, env, STATS_FROM),
    env.AIBOU_DS_ID ? petPage(notion, env) : null,
    openMonsters(notion, env),
    equipBonus(notion, env),
  ]);
  const pet = petRow ? summarizePet(petRow) : null;
  const petType = pet?.stage === "成長期" ? pet.childType : pet?.stage === "成体" ? pet.adultType : null;
  const stats = statsOf(all);
  const ep2 = stories.filter((c) => c.kind === EP2);
  const current = ep2.find((c) => c.read && c.boss && typeof c.hp === "number" && !c.defeated);
  let boss = null;
  if (current) {
    const start = current.bossStart?.slice(0, 10) || jstDate(new Date().toISOString());
    boss = fight(current, all, start, petType, stats, equip);
    if (boss.defeatedOn) {
      await notion("PATCH", `/pages/${current.id}`, { properties: { 撃破日: { date: { start: boss.defeatedOn } } } });
      current.defeated = boss.defeatedOn;
    }
  }
  const next = ep2.find((c) => !c.read && !c.locked) || null;
  return {
    boss,
    next: next && { id: next.id, title: next.title },
    cleared: ep2.length > 0 && ep2.every((c) => c.read && (c.defeated || !c.boss)),
    stats,
    equip,
    pet: pet && { name: pet.name, stage: pet.stage, type: petType },
    monsters: open.monsters,
    moreMonsters: open.more,
  };
}

function statsOf({ habitDays, tasks }) {
  const points = zeroPoints();
  for (const d of Object.values(habitDays)) for (const t of TYPES) points[t] += d.points[t];
  for (const t of tasks) addPoints(points, t.type, t.exp);
  return Object.fromEntries(TYPES.map((t) => [t, Math.floor(points[t] / STAT_EXP)]));
}

// 型ごとの倍率（弱点なら1.5倍、弱点がバランスなら全部1.2倍）
function weakMult(weak, type) {
  if (weak === "バランス") return BALANCE_BONUS;
  return type === weak ? WEAK_BONUS : 1;
}

// EXP（型 null は4つに均等）に型ごとの倍率 m(型) を掛ける
function weakened(m, type, exp) {
  if (type) return exp * m(type);
  return TYPES.reduce((a, t) => a + (exp / TYPES.length) * m(t), 0);
}

// equip：装備中のそうびの、型ごとのダメージ＋%
function fight(chapter, { habitDays, tasks }, start, petType, stats, equip = {}) {
  const weak = chapter.weak;
  const petHit = !!petType && petType === weak;
  const statVal = weak === "バランス" ? Math.min(...TYPES.map((t) => stats[t])) : stats[weak] || 0;
  const mult = (petHit ? PET_BONUS : 1) * (1 + Math.min(STAT_MAX, statVal * STAT_RATE));
  const m = (t) => weakMult(weak, t) * (1 + (equip[t] || 0) / 100);
  const days = {};
  const day = (d) => (days[d] ||= { habit: 0, tasks: [] });
  for (const [date, d] of Object.entries(habitDays)) {
    if (date < start) continue;
    day(date).habit = TYPES.reduce((a, t) => a + d.points[t] * m(t), 0) * mult;
  }
  for (const t of tasks) {
    if (t.date < start) continue;
    day(t.date).tasks.push({ ...t, damage: weakened(m, t.type, t.exp) * (1 + t.stars * STAR_BONUS) * mult });
  }
  let damage = 0;
  let defeatedOn = null;
  const log = [];
  const today = jstDate(new Date().toISOString());
  let todayDamage = 0;
  for (const date of Object.keys(days).sort()) {
    const d = days[date];
    const total = d.habit + d.tasks.reduce((a, t) => a + t.damage, 0);
    damage += total;
    if (date === today) todayDamage = total;
    if (d.habit) log.push({ date, kind: "habit", damage: Math.round(d.habit) });
    for (const t of d.tasks) log.push({ date, kind: "task", name: t.name, title: t.title, stars: t.stars, family: t.family, shape: t.shape, colors: t.colors, damage: Math.round(t.damage) });
    if (!defeatedOn && damage >= chapter.hp) defeatedOn = date;
  }
  return {
    chapterId: chapter.id,
    chapter: chapter.title,
    name: chapter.boss,
    hp: chapter.hp,
    weak,
    start,
    damage: Math.min(chapter.hp, Math.round(damage)),
    today: Math.round(todayDamage),
    petHit,
    mult: Math.round(mult * 100) / 100,
    defeatedOn,
    log: log.slice(-BATTLE_LOG).reverse(),
  };
}

// まだ終わっていないタスク＝モンスター（古い順に OPEN_MONSTERS 件）
async function openMonsters(notion, env) {
  const res = await notion("POST", `/data_sources/${dsId(env, "TASK_DS_ID")}/query`, {
    filter: { and: ["✅ DONE", "📚 REFERENCE", "🤖 AI"].map((s) => ({ property: "ステータス", status: { does_not_equal: s } })) },
    sorts: [{ timestamp: "created_time", direction: "ascending" }],
    page_size: OPEN_MONSTERS,
  });
  return { monsters: (res.results || []).map((p) => monsterOf(p)), more: !!res.has_more };
}

// ---------- 共通 ----------
const MAX_QUERY_PAGES = 5;

async function queryAll(notion, dataSourceId, body, maxPages = MAX_QUERY_PAGES) {
  const out = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const res = await notion("POST", `/data_sources/${dataSourceId}/query`, {
      ...body,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    out.push(...(res.results || []));
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return out;
}

function dsId(env, key) {
  if (!env[key]) throw httpError(500, `${key} が設定されていません（wrangler.toml）`);
  return env[key];
}

function jstDate(iso) {
  return new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
}

function assertDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || Number.isNaN(Date.parse(date))) {
    throw httpError(400, "日付の形式が正しくありません");
  }
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
