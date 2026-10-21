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
          ? "Notion で DB_習慣チェック にインテグレーションが接続されていません"
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
  } else if (schema.props[name]?.type === "checkbox" && typeof value === "boolean") {
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
  const habits = Object.values(props)
    .filter((p) => p.type === "checkbox")
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
  return { props, habits };
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
    if (prop.type === "checkbox" && schema.props[name]) checks[name] = prop.checkbox;
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
  if (inner.type === "array") {
    const first = inner.array?.[0];
    return first ? statValue(first) : null;
  }
  return null;
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
