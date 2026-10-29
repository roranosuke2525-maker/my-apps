// art-manifest.mjs の絵を、gemini-art の Worker（Gemini の画像生成）でまとめて描く。
//   GEMINI_ART_URL=https://gemini-art.<アカウント>.workers.dev/mcp/<合言葉> node scripts/gen-art.mjs <保存先フォルダ> [id の一部…]
// 保存先にもうある絵は描かない（描き直すときは消してから）。描いたら scripts/finish-art.py で背景を抜いて public/img へ。
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ALL } from "./art-manifest.mjs";

const endpoint = process.env.GEMINI_ART_URL;
if (!endpoint) throw new Error("GEMINI_ART_URL がありません");
const [outDir, ...only] = process.argv.slice(2);
if (!outDir) throw new Error("保存先フォルダを指定してください");
const styleRef = process.env.STYLE_REF_URL; // 絵柄の見本（https）。なければ見本なし
const CONCURRENCY = 4;

let seq = 0;
async function callTool(args) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name: "generate_image", arguments: args } }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.result.content.find((c) => c.type === "text")?.text || "";
  if (data.result.isError) throw new Error(text);
  const url = text.match(/https:\/\/\S+?\.png/)?.[0];
  if (!url) throw new Error(`URL がありません: ${text}`);
  return url;
}

const todo = ALL.filter((a) => (!only.length || only.some((o) => a.id.includes(o))) && !existsSync(join(outDir, `${a.id}.png`)));
console.log(`${todo.length} 枚を描きます`);
let failed = 0;
async function worker() {
  for (let a = todo.shift(); a; a = todo.shift()) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const url = await callTool({ prompt: a.prompt, aspect_ratio: a.ratio, ...(styleRef ? { reference_image_urls: [styleRef] } : {}) });
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const file = join(outDir, `${a.id}.png`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, buf);
        console.log(`ok ${a.id}`);
        break;
      } catch (e) {
        console.log(`${attempt < 3 ? "retry" : "FAIL"} ${a.id}: ${e.message.slice(0, 160)}`);
        if (attempt === 3) failed++;
        else await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(failed ? `${failed} 枚 失敗` : "ぜんぶ描けました");
