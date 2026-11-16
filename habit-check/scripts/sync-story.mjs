// エピソード2の本文（story/episode2/NN.md）を Notion の DB_ものがたり に書く。
//   NOTION_TOKEN=ntn_... node scripts/sync-story.mjs [1-10]   （話の番号の範囲。省略で全部）
// すでにある話（しゅるい＝エピソード2・じゅんばん＝200＋話数）は、題・ボス・本文だけを書き換える。
// 「よんだ」「ボス開始日」「撃破日」には触らない。
//
// NN.md の形：
//   ---
//   title: 第1話　たまごと灰
//   order: 1
//   boss: 灰のスライム        （ボスなしの話は boss・hp・weak を書かない）
//   hp: 300
//   weak: しっかり
//   ---
//   本文。1行＝1段落。「> 」で始まる行は【SYSTEM】などの引用。空行は無視
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./inline-page.mjs";

const STORY_DS_ID = "f673bc1a-91b2-467d-bcd3-b2a70bd1bcbd";
const KIND = "エピソード2";
const PLAYER_PAGE_ID = "3e962844acbe81b0843ff78fe19791fa";
const ORDER_BASE = 200;
const dir = join(root, "story", "episode2");

const token = process.env.NOTION_TOKEN;
if (!token) throw new Error("NOTION_TOKEN がありません");
const [lo, hi] = (process.argv[2] || "1-999").split("-").map(Number);

async function notion(method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${data.code} ${data.message}`);
    return data;
  }
}

function parse(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("先頭の --- がありません");
  const meta = Object.fromEntries(m[1].split("\n").map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
  const lines = m[2].split("\n").map((l) => l.trim()).filter(Boolean);
  return { meta, lines };
}

const rt = (s) => [{ type: "text", text: { content: s } }];

function blocks(lines) {
  return lines.map((l) => {
    const q = l.match(/^>\s*(.*)$/);
    if (q) return { type: "quote", quote: { rich_text: rt(q[1]) } };
    if (/^##\s/.test(l)) return { type: "heading_3", heading_3: { rich_text: rt(l.replace(/^##\s+/, "")) } };
    return { type: "paragraph", paragraph: { rich_text: rt(l) } };
  });
}

function properties(meta) {
  const p = {
    しょう: { title: rt(meta.title) },
    しゅるい: { select: { name: KIND } },
    じゅんばん: { number: ORDER_BASE + Number(meta.order) },
    かいほうLv: { number: 1 },
    プレイヤー: { relation: [{ id: PLAYER_PAGE_ID }] }, // Notion の「じょうたい」の式が いまのLv を読めるように
    ボス: { rich_text: meta.boss ? rt(meta.boss) : [] },
    ボスHP: { number: meta.hp ? Number(meta.hp) : null },
    弱点: { select: meta.weak ? { name: meta.weak } : null },
  };
  return p;
}

async function existing() {
  const out = new Map();
  let cursor;
  do {
    const res = await notion("POST", `/data_sources/${STORY_DS_ID}/query`, {
      filter: { property: "しゅるい", select: { equals: KIND } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const p of res.results) out.set(p.properties["じゅんばん"]?.number, p.id);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

// 本文はトグル「▶ 読む」の中に入れる（エピソード1と同じ形）。100ブロックずつ足す
async function writeBody(pageId, lines) {
  const children = blocks(lines);
  const toggle = await notion("PATCH", `/blocks/${pageId}/children`, {
    children: [{ type: "toggle", toggle: { rich_text: rt("▶ 読む"), children: children.slice(0, 100) } }],
  });
  const toggleId = toggle.results[0].id;
  for (let i = 100; i < children.length; i += 100) {
    await notion("PATCH", `/blocks/${toggleId}/children`, { children: children.slice(i, i + 100) });
  }
}

async function clearBody(pageId) {
  const res = await notion("GET", `/blocks/${pageId}/children?page_size=100`);
  for (const b of res.results) await notion("DELETE", `/blocks/${b.id}`);
}

const files = (await readdir(dir)).filter((f) => /^\d+\.md$/.test(f)).sort();
const have = await existing();
for (const f of files) {
  const { meta, lines } = parse(await readFile(join(dir, f), "utf8"));
  const n = Number(meta.order);
  if (n < lo || n > hi) continue;
  const id = have.get(ORDER_BASE + n);
  if (id) {
    await notion("PATCH", `/pages/${id}`, { properties: properties(meta) });
    await clearBody(id);
    await writeBody(id, lines);
    console.log(`updated ${meta.title}（${lines.join("").length}字）`);
  } else {
    const page = await notion("POST", "/pages", { parent: { type: "data_source_id", data_source_id: STORY_DS_ID }, properties: properties(meta) });
    await writeBody(page.id, lines);
    console.log(`created ${meta.title}（${lines.join("").length}字）`);
  }
}
