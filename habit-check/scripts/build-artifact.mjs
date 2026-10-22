// claude.ai のアーティファクト版（1ファイルのHTML）を作る。/api は src/mcp-api.js が Notion 連携（MCP）で答える。
//   node scripts/build-artifact.mjs [出力先]   既定：dist/artifact.html
// 公開するときは capabilities に Notion 連携を宣言する（README の「アーティファクト版」）。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inlinePage, root } from "./inline-page.mjs";

const out = process.argv[2] || join(root, "dist", "artifact.html");
const apiScript = await readFile(join(root, "src", "mcp-api.js"), "utf8");

// 合言葉は使わないので「合言葉を消す」は隠す
const full = await inlinePage({ apiScript, extraCss: "#logout { display: none; }" });

// 公開時に doctype・head・body の枠が付くので、title・style と body の中身だけを書き出す
const pick = (re) => (full.match(re) || [])[1] ?? "";
const page = [
  `<title>${pick(/<title>([\s\S]*?)<\/title>/)}</title>`,
  pick(/<head>[\s\S]*?(<style>[\s\S]*?<\/style>)[\s\S]*?<\/head>/),
  pick(/<body>([\s\S]*)<\/body>/).trim(),
].join("\n");
if (!page.includes("<style>") || !page.includes('<script type="module">')) throw new Error("アーティファクト版の組み立てに失敗しました");

await mkdir(dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`artifact written: ${out} (${(page.length / 1024).toFixed(1)} KiB)`);
