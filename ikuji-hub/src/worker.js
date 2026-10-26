// 育児ハブ：画面の配信と Notion API・カレンダーの中継（Cloudflare Worker）
// Notion のトークンとカレンダーの非公開アドレスはこの Worker の secret にだけ置き、ブラウザには渡さない。
// 返事の形はアーティファクト版の /api（src/mcp-api.js）と同じ。

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const TASK_TAG = "CHILD";
const DONE = "✅ DONE";
const REFERENCE = "📚 REFERENCE";
const TASK_STATUSES = ["⏭ NEXT", "▶️ DOING", "⏳ WAITING", "🕰 SOMEDAY", "📥 INBOX", DONE];
const TITLE_MAX = 100;
const SLEEP_TEXT_MAX = 500;
const SLEEP_MONTH_MAX = 72;
const SLEEP_BODY_MAX = 5000;
const CAL_WORDS = /奏輔|そうすけ|検診|健診|接種|ワクチン|保育園|慣らし|離乳食|小児科/;
const CAL_DAYS = 180;
const MAX_QUERY_PAGES = 5;
// 本文をアプリで書き換えてよいブロック（文字だけのもの）。これ以外があれば Notion で直してもらう
const TEXT_BLOCKS = {
  paragraph: "",
  heading_1: "# ",
  heading_2: "## ",
  heading_3: "### ",
  bulleted_list_item: "- ",
  numbered_list_item: "1. ",
  quote: "> ",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      checkConfig(env);
      if (!authorized(request, env)) return json({ error: "合言葉が違います" }, 401);
      const notion = notionClient(env);
      const p = url.pathname;
      const m = request.method;

      if (p === "/api/hub" && m === "GET") return json(await getHub(notion, env));
      if (p === "/api/calendar" && m === "GET") return json(await getCalendar(env));
      if (p === "/api/tasks" && m === "POST") return json(await addTask(notion, env, await readJson(request)));
      const task = p.match(/^\/api\/tasks\/([0-9a-f]{32})$/i);
      if (task && m === "PATCH") return json(await setTaskStatus(notion, env, task[1], await readJson(request)));
      if (p === "/api/sleep" && m === "GET") return json(await getSleep(notion, env));
      if (p === "/api/sleep" && m === "PUT") return json(await saveSleep(notion, env, await readJson(request)));
      const body = p.match(/^\/api\/sleep\/([0-9a-f]{32})\/body$/i);
      if (body && m === "GET") return json(await getSleepBody(notion, env, body[1]));
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: err.publicMessage || "サーバーでエラーが起きました" }, err.status || 500);
    }
  },
};

// ---------- 設定・合言葉 ----------
function checkConfig(env) {
  const need = ["NOTION_TOKEN", "APP_KEY", "TASK_DS_ID", "MEMO_DS_ID", "AID_DS_ID", "SLEEP_DS_ID", "CHILD_BIRTH"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length || env.APP_KEY.length < 16) {
    throw httpError(500, `Worker の設定が足りません（${missing.join(" / ") || "APP_KEY は16文字以上"}）`);
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

// ---------- Notion のページを読む ----------
const plain = (rich) => (rich || []).map((t) => t.plain_text ?? t.text?.content ?? "").join("");

function prop(page, name) {
  const p = page.properties?.[name];
  if (!p) return null;
  switch (p.type) {
    case "title": return plain(p.title);
    case "rich_text": return plain(p.rich_text);
    case "select": return p.select?.name || "";
    case "status": return p.status?.name || "";
    case "multi_select": return (p.multi_select || []).map((o) => o.name);
    case "number": return typeof p.number === "number" ? p.number : null;
    case "date": return p.date?.start ? p.date.start.slice(0, 10) : null;
    default: return null;
  }
}
const str = (page, name) => prop(page, name) || "";
const normalizeId = (id) => String(id || "").replace(/-/g, "").toLowerCase();
const parentDs = (page) => normalizeId(page.parent?.data_source_id);

function taskItem(page) {
  const status = str(page, "ステータス");
  return {
    id: normalizeId(page.id),
    url: page.url,
    src: status === REFERENCE ? "ref" : "task",
    title: str(page, "名前") || "（無題）",
    status,
    note: str(page, "NEXT"),
    date: prop(page, "実行日"),
    tag: "",
    meta: [str(page, "枠"), str(page, "重さ")].filter(Boolean),
    star: false,
    done: status === DONE,
  };
}

function memoItem(page) {
  const status = str(page, ""); // このDBのステータス列は名前が空
  return {
    id: normalizeId(page.id),
    url: page.url,
    src: "memo",
    title: str(page, "名前") || "（無題）",
    status,
    note: "",
    date: prop(page, "実行日"),
    tag: str(page, "分類タグ"),
    meta: [],
    star: str(page, "Star") === "☆",
    done: status === "完了",
  };
}

function aidItem(page) {
  const status = str(page, "申請状況");
  return {
    id: normalizeId(page.id),
    url: page.url,
    src: "aid",
    title: str(page, "名前") || "（無題）",
    status,
    note: str(page, "助成内容"),
    date: prop(page, "期限"),
    tag: "",
    meta: [str(page, "申請先")].filter(Boolean),
    star: false,
    done: status === "取得済み" || str(page, "ステータス") === "完了",
  };
}

function child(env) {
  return { name: env.CHILD_NAME || "", birth: env.CHILD_BIRTH, backToWork: env.BACK_TO_WORK || "" };
}

async function getHub(notion, env) {
  const [tasks, memos, aids] = await Promise.all([
    queryAll(notion, env.TASK_DS_ID, {
      filter: {
        and: [
          { property: "分類タグ", select: { equals: TASK_TAG } },
          { property: "ステータス", status: { does_not_equal: DONE } },
        ],
      },
    }),
    queryAll(notion, env.MEMO_DS_ID, {}),
    queryAll(notion, env.AID_DS_ID, {}),
  ]);
  return {
    child: child(env),
    items: [...tasks.map(taskItem), ...memos.map(memoItem), ...aids.map(aidItem)],
    loadedAt: new Date().toISOString(),
  };
}

// ---------- タスク（DB_タスク管理 の CHILD だけ） ----------
async function addTask(notion, env, body) {
  const title = String(body?.title || "").replace(/\s+/g, " ").trim();
  if (!title) throw httpError(400, "タスクの名前を入れてください");
  if (title.length > TITLE_MAX) throw httpError(400, `タスクの名前は${TITLE_MAX}文字までです`);
  const page = await notion("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: env.TASK_DS_ID },
    properties: {
      名前: { title: [{ text: { content: title } }] },
      ステータス: { status: { name: "📥 INBOX" } },
      分類タグ: { select: { name: TASK_TAG } },
    },
  });
  return { item: taskItem(page) };
}

async function setTaskStatus(notion, env, id, body) {
  if (!TASK_STATUSES.includes(body?.status)) throw httpError(400, "変更できないステータスです");
  const page = await notion("GET", `/pages/${id}`);
  // DB_タスク管理 の CHILD のタスクだけ（しらべた＝REFERENCE は変えない）
  if (parentDs(page) !== normalizeId(env.TASK_DS_ID) || str(page, "分類タグ") !== TASK_TAG || str(page, "ステータス") === REFERENCE) {
    throw httpError(403, "育児のタスクだけ変更できます");
  }
  const updated = await notion("PATCH", `/pages/${id}`, { properties: { ステータス: { status: { name: body.status } } } });
  return { item: taskItem(updated) };
}

// ---------- ねんね（DB_ねんね記録） ----------
function sleepRow(page) {
  return {
    id: normalizeId(page.id),
    url: page.url,
    title: str(page, "名前"),
    date: prop(page, "記録日"),
    month: prop(page, "月齢"),
    place: str(page, "寝る場所"),
    methods: prop(page, "寝かしつけ") || [],
    who: str(page, "寝かしつけ担当"),
    bed: str(page, "寝る時刻"),
    wake: str(page, "起きる時刻"),
    night: prop(page, "夜中に起きる回数"),
    naps: prop(page, "昼寝の回数"),
    good: str(page, "うまくいったこと"),
    trouble: str(page, "困っていること"),
  };
}

// 選択肢は DB の設定から読む（Notion で選択肢を足せばアプリにも出る）
async function sleepOptions(notion, env) {
  const ds = await notion("GET", `/data_sources/${env.SLEEP_DS_ID}`);
  const names = (name) => {
    const p = ds.properties?.[name];
    return ((p?.select || p?.multi_select)?.options || []).map((o) => o.name);
  };
  return { place: names("寝る場所"), methods: names("寝かしつけ"), who: names("寝かしつけ担当") };
}

async function getSleep(notion, env) {
  const [options, pages] = await Promise.all([sleepOptions(notion, env), queryAll(notion, env.SLEEP_DS_ID, {})]);
  const records = pages.map(sleepRow).sort((a, b) => (b.month ?? -1) - (a.month ?? -1) || String(b.date).localeCompare(String(a.date)));
  return { records, options };
}

async function sleepPage(notion, env, id) {
  const page = await notion("GET", `/pages/${id}`);
  if (parentDs(page) !== normalizeId(env.SLEEP_DS_ID)) throw httpError(403, "ねんね記録だけ開けます");
  return page;
}

// 本文：文字だけのブロックなら Markdown 風の文字にして返す。表・画像・入れ子などがあれば書き換え不可
async function readBody(notion, id) {
  const blocks = [];
  let cursor;
  for (let i = 0; i < MAX_QUERY_PAGES; i++) {
    const res = await notion("GET", `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    blocks.push(...(res.results || []));
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  const editable = blocks.every((b) => b.type in TEXT_BLOCKS && !b.has_children);
  const lines = blocks.map((b) => (b.type in TEXT_BLOCKS ? TEXT_BLOCKS[b.type] + plain(b[b.type]?.rich_text) : plain(b[b.type]?.rich_text)));
  return { blocks, body: lines.join("\n").trim(), editable };
}

async function getSleepBody(notion, env, id) {
  await sleepPage(notion, env, id);
  const { body, editable } = await readBody(notion, id);
  return { body, editable };
}

// 文字を段落・見出し・箇条書きのブロックにする（1行＝1ブロック。空行は飛ばす）
function bodyBlocks(text) {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const [type, content] =
      line.startsWith("### ") ? ["heading_3", line.slice(4)]
        : line.startsWith("## ") ? ["heading_2", line.slice(3)]
          : line.startsWith("# ") ? ["heading_1", line.slice(2)]
            : /^[-*] /.test(line) ? ["bulleted_list_item", line.slice(2)]
              : /^\d+\. /.test(line) ? ["numbered_list_item", line.replace(/^\d+\. /, "")]
                : line.startsWith("> ") ? ["quote", line.slice(2)]
                  : ["paragraph", line];
    return { object: "block", type, [type]: { rich_text: [{ type: "text", text: { content: content.slice(0, 2000) } }] } };
  });
}

async function saveSleep(notion, env, body) {
  const opts = await sleepOptions(notion, env);
  const month = Number(body?.month);
  if (!Number.isInteger(month) || month < 0 || month > SLEEP_MONTH_MAX) throw httpError(400, "月齢が正しくありません");
  const pick = (v, allowed) => {
    const t = String(v || "");
    if (t && !allowed.includes(t)) throw httpError(400, `選べない値です：${t}`);
    return t || null;
  };
  const time = (v) => {
    const t = String(v || "").trim();
    if (t && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) throw httpError(400, "時刻は 20:30 の形で入れてください");
    return t;
  };
  const times = (v) => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 20) throw httpError(400, "回数は 0〜20 で入れてください");
    return n;
  };
  const note = (v) => {
    const t = String(v || "").trim();
    if (t.length > SLEEP_TEXT_MAX) throw httpError(400, `メモは${SLEEP_TEXT_MAX}文字までです`);
    return t;
  };
  const rich = (t) => ({ rich_text: t ? [{ text: { content: t } }] : [] });
  const select = (t) => ({ select: t ? { name: t } : null });
  const methods = Array.isArray(body.methods) ? [...new Set(body.methods.map(String))] : [];
  for (const m of methods) pick(m, opts.methods);
  const newBody = typeof body.body === "string" ? body.body.replace(/\r\n/g, "\n").trim() : null;
  if (newBody != null && newBody.length > SLEEP_BODY_MAX) throw httpError(400, `本文は${SLEEP_BODY_MAX}文字までです`);

  const title = month < 12 ? `生後${month}か月` : `${Math.floor(month / 12)}歳${month % 12}か月`;
  const properties = {
    名前: { title: [{ text: { content: title } }] },
    記録日: { date: { start: jstDate(new Date().toISOString()) } },
    月齢: { number: month },
    寝る場所: select(pick(body.place, opts.place)),
    寝かしつけ: { multi_select: methods.map((name) => ({ name })) },
    寝かしつけ担当: select(pick(body.who, opts.who)),
    寝る時刻: rich(time(body.bed)),
    起きる時刻: rich(time(body.wake)),
    夜中に起きる回数: { number: times(body.night) },
    昼寝の回数: { number: times(body.naps) },
    うまくいったこと: rich(note(body.good)),
    困っていること: rich(note(body.trouble)),
  };

  // 同じ月齢の行があれば書き換え、なければ1行足す
  const [existing] = await queryAll(notion, env.SLEEP_DS_ID, { filter: { property: "月齢", number: { equals: month } } });
  if (existing) {
    // 本文は今の本文から変わったときだけ置き換える（表・画像などを含む本文は触らない）
    let replace = null;
    if (newBody != null) {
      const now = await readBody(notion, existing.id);
      if (newBody !== now.body) {
        if (!now.editable) throw httpError(409, "この本文は表や画像などを含むので、Notion で直してください");
        replace = now.blocks;
      }
    }
    await notion("PATCH", `/pages/${existing.id}`, { properties });
    if (replace) {
      for (const b of replace) await notion("DELETE", `/blocks/${b.id}`);
      const children = bodyBlocks(newBody);
      if (children.length) await notion("PATCH", `/blocks/${existing.id}/children`, { children });
    }
  } else {
    const page = { parent: { type: "data_source_id", data_source_id: env.SLEEP_DS_ID }, properties };
    if (newBody) page.children = bodyBlocks(newBody);
    await notion("POST", "/pages", page);
  }
  return getSleep(notion, env);
}

// ---------- 予定（カレンダーの非公開アドレス＝iCal を読むだけ） ----------
// CALENDAR_ICS_URLS（secret）に Google カレンダーの「iCal 形式の非公開アドレス」を改行かカンマ区切りで入れる
async function getCalendar(env) {
  const urls = String(env.CALENDAR_ICS_URLS || "").split(/[\s,]+/).filter((u) => /^https:\/\//.test(u));
  if (!urls.length) throw httpError(503, "カレンダーの設定がありません（README の「カレンダー」）");
  const today = jstDate(new Date().toISOString());
  const until = addDays(today, CAL_DAYS);
  const texts = await Promise.all(urls.map((u) => fetch(u).then((r) => (r.ok ? r.text() : ""), () => "")));
  if (texts.every((t) => !t)) throw httpError(502, "カレンダーを読めませんでした（非公開アドレスを確かめてください）");
  const seen = new Set();
  const events = texts.flatMap(parseIcs)
    .filter((e) => e.status !== "CANCELLED" && e.date >= today && e.date < until && CAL_WORDS.test(`${e.title} ${e.description}`))
    .map(({ title, date, time }) => ({ title, date, time, url: "" }))
    .filter((e) => !seen.has(`${e.date}|${e.time}|${e.title}`) && seen.add(`${e.date}|${e.time}|${e.title}`))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { events };
}

// 繰り返しの予定（RRULE）は最初の1回だけ扱う
export function parseIcs(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out = [];
  let ev = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = { title: "", description: "", status: "", date: "", time: "" };
    else if (line === "END:VEVENT") { if (ev?.date) out.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(";");
      const value = line.slice(i + 1);
      if (name === "SUMMARY") ev.title = unescapeIcs(value) || "（予定）";
      else if (name === "DESCRIPTION") ev.description = unescapeIcs(value);
      else if (name === "STATUS") ev.status = value.trim();
      else if (name === "DTSTART") Object.assign(ev, icsStart(value.trim(), params));
    }
  }
  return out;
}

function icsStart(value, params) {
  const d = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!d) return {};
  const date = `${d[1]}-${d[2]}-${d[3]}`;
  if (!d[4] || params.includes("VALUE=DATE")) return { date, time: "" };
  if (d[7]) {
    // UTC で書かれた時刻は日本時間に直す
    const jst = new Date(Date.parse(`${date}T${d[4]}:${d[5]}:${d[6]}Z`) + 9 * 3600e3).toISOString();
    return { date: jst.slice(0, 10), time: jst.slice(11, 16) };
  }
  return { date, time: `${d[4]}:${d[5]}` }; // TZID 付きはその土地の時刻（日本の予定は日本時間）
}

const unescapeIcs = (s) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();

// ---------- 共通 ----------
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

function jstDate(iso) {
  return new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
