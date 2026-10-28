// パーティーのドット絵（public/img/party/*.svg）を Notion の DB_すがた に差し替える。
//   NOTION_TOKEN=ntn_... node scripts/upload-party.mjs [前の絵の保存先フォルダ]
// 各ページの先頭の画像を新しい絵にし、前の絵は「エピソード1のすがた」のトグルの中へ移す（フォルダを渡したときだけ。
// ファイル名は「なまえ」の（）を _ にしたもの）。アプリは先頭の画像だけを使う。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "./inline-page.mjs";

const PARTY_DS_ID = "7ab3aa8b-2f1e-44cb-b2f8-592202bab226";
const token = process.env.NOTION_TOKEN;
if (!token) throw new Error("NOTION_TOKEN がありません");
const oldDir = process.argv[2];
const dir = join(root, "public", "img", "party");
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.code} ${data.message}`);
  return data;
}

// Notion にファイルを上げて、file_upload の id を返す
async function upload(name, buf) {
  const fu = await notion("POST", "/file_uploads", { filename: name, content_type: "image/svg+xml" });
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "image/svg+xml" }), name);
  const res = await fetch(`https://api.notion.com/v1/file_uploads/${fu.id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2025-09-03" },
    body: form,
  });
  if (!res.ok) throw new Error(`send ${name}: ${await res.text()}`);
  return fu.id;
}

const image = (id) => ({ type: "image", image: { type: "file_upload", file_upload: { id } } });

const rows = (await notion("POST", `/data_sources/${PARTY_DS_ID}/query`, { page_size: 100 })).results;
for (const item of index) {
  const page = rows.find((p) => p.properties["なまえ"].title.map((t) => t.plain_text).join("") === item.name);
  if (!page) { console.log(`skip（DB_すがた にない）: ${item.name}`); continue; }
  const children = (await notion("GET", `/blocks/${page.id}/children?page_size=100`)).results;
  const newId = await upload(item.file, readFileSync(join(dir, item.file)));
  const add = [image(newId)];
  const oldFile = oldDir && join(oldDir, `${item.name.replace(/[（）]/g, "_")}.img`);
  if (oldFile && existsSync(oldFile) && !children.some((b) => b.type === "toggle")) {
    const oldId = await upload(`ep1_${item.file}`, readFileSync(oldFile));
    add.push({ type: "toggle", toggle: { rich_text: [{ type: "text", text: { content: "エピソード1のすがた" } }], children: [image(oldId)] } });
  }
  for (const b of children.filter((b) => b.type === "image")) await notion("DELETE", `/blocks/${b.id}`);
  // 先頭に入れる（ほかのブロックがあればその前。なければ末尾＝先頭）
  const first = children.find((b) => b.type !== "image");
  if (first) {
    await notion("PATCH", `/blocks/${page.id}/children`, { children: add, position: { type: "start" } }).catch(async () => {
      await notion("PATCH", `/blocks/${page.id}/children`, { children: add });
    });
  } else {
    await notion("PATCH", `/blocks/${page.id}/children`, { children: add });
  }
  console.log(`updated: ${item.name}`);
}
