// 習慣チェック入力アプリ：画面の配信と Notion API の中継（Cloudflare Worker）
// Notion のトークンはこの Worker の secret にだけ置き、ブラウザには渡さない。

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const NOTE_PROPERTY = "ひとこと";
const TITLE_PROPERTY = "日";
const STAT_TYPES = new Set(["formula", "rollup"]);

// 区分：◆必ず ◇できれば ／ 時間帯：☼朝 ☀︎昼 ◷時間指定 ☾夜 ↻いつでも
const SLOTS = { "☼": "morning", "☀": "noon", "◷": "timed", "☾": "night", "↻": "anytime" };
const HABIT_NAME = /^([◆◇])\s*([☼☀◷☾↻])[︎️]?\s*(.+)$/u;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      checkConfig(env);
      if (!authorized(request, env)) return json({ error: "合言葉が違います" }, 401);
      const notion = notionClient(env);

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
    .map((p) => {
      const m = p.name.match(HABIT_NAME);
      return {
        name: p.name,
        label: m ? m[3].trim() : p.name,
        must: m ? m[1] === "◆" : false,
        slot: m ? SLOTS[m[2]] : "anytime",
        hint: p.description || "",
      };
    });
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

async function getPlayer(notion, env) {
  if (!env.PLAYER_PAGE_ID) throw httpError(500, "PLAYER_PAGE_ID が設定されていません（wrangler.toml）");
  const page = await notion("GET", `/pages/${env.PLAYER_PAGE_ID}`);
  return { player: pick(page, PLAYER_FIELDS) };
}

// ---------- パーティー（DB_すがた：ひょうじ が付いたものだけ） ----------
async function getParty(notion, env) {
  const rows = await queryAll(notion, dsId(env, "PARTY_DS_ID"), {
    sorts: [{ property: "なまえ", direction: "ascending" }],
  });
  const shown = rows.filter((p) => propValue(p.properties?.["ひょうじ"]) !== false);
  const members = await Promise.all(
    shown.map(async (p) => ({
      ...pick(p, { name: "なまえ", kind: "しゅるい", needLv: "ひつようLv", nextLv: "つぎLv" }),
      image: await firstImage(notion, p.id),
    })),
  );
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
  const [quests, reports] = await Promise.all([
    queryAll(notion, dsId(env, "GUILD_DS_ID"), { sorts: [{ property: "受注Lv", direction: "ascending" }] }),
    notion("POST", `/data_sources/${dsId(env, "REPORT_DS_ID")}/query`, {
      sorts: [{ timestamp: "created_time", direction: "descending" }],
      page_size: REPORT_LIMIT,
    }),
  ]);
  return {
    quests: quests.map((p) => {
      const q = pick(p, QUEST_FIELDS);
      const { stagesText, ...rest } = q;
      return { ...rest, stages: splitStages(stagesText) };
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
  return { report: summarizeReport(page) };
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
const STORY_FIELDS = {
  title: "しょう",
  kind: "しゅるい",
  order: "じゅんばん",
  unlockLv: "かいほうLv",
  state: "じょうたい",
  read: "よんだ",
  playerLv: "いまのLv",
};

function summarizeStory(page) {
  const s = pick(page, STORY_FIELDS);
  const locked = typeof s.unlockLv === "number" && typeof s.playerLv === "number" && s.playerLv < s.unlockLv;
  return { ...s, locked };
}

async function getStories(notion, env) {
  const rows = await queryAll(notion, dsId(env, "STORY_DS_ID"), {
    sorts: [{ property: "じゅんばん", direction: "ascending" }],
  });
  return { chapters: rows.map(summarizeStory) };
}

async function storyPage(notion, env, id) {
  const page = await notion("GET", `/pages/${id}`);
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(dsId(env, "STORY_DS_ID"))) {
    throw httpError(403, "DB_ものがたり のページではありません");
  }
  return page;
}

async function getStory(notion, env, id) {
  const chapter = summarizeStory(await storyPage(notion, env, id));
  if (chapter.locked) throw httpError(403, `Lv${chapter.unlockLv}になると読めます`);
  return { chapter, blocks: await readText(notion, id, 0) };
}

async function markStory(notion, env, id, body) {
  if (typeof body?.read !== "boolean") throw httpError(400, "変更できない項目です");
  const chapter = summarizeStory(await storyPage(notion, env, id));
  if (chapter.locked) throw httpError(403, `Lv${chapter.unlockLv}になると読めます`);
  const page = await notion("PATCH", `/pages/${id}`, { properties: { よんだ: { checkbox: body.read } } });
  return { chapter: summarizeStory(page) };
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

// ---------- 共通 ----------
const MAX_QUERY_PAGES = 5;

async function queryAll(notion, dataSourceId, body) {
  const out = [];
  let cursor;
  for (let i = 0; i < MAX_QUERY_PAGES; i++) {
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
