// claude.ai のアーティファクト版（1ファイルのHTML）を作る。/api は src/mcp-api.js が Notion 連携（MCP）で答える。
//   node scripts/build-artifact.mjs [出力先]   既定：dist/artifact.html
// 公開するときは capabilities に Notion 連携を宣言する（README の「アーティファクト版」）。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(join(root, p), "utf8");
const out = process.argv[2] || join(root, "dist", "artifact.html");
const [html, css, app, apiScript] = await Promise.all([read("public/index.html"), read("public/style.css"), read("public/app.js"), read("src/mcp-api.js")]);

// 公開時に doctype・head・body の枠が付くので、title・フォント・style と body の中身だけを書き出す
const pick = (re) => (html.match(re) || [])[1] ?? "";
const body = pick(/<body>([\s\S]*)<\/body>/)
  .replace(
    '<script src="app.js" type="module"></script>',
    `<script>${apiScript}</script>\n<script type="module">\n${app.replace(/if \("serviceWorker" in navigator\)[\s\S]*?\n}\n/, "")}\n</script>`,
  )
  .trim();
const page = [
  `<title>${pick(/<title>([\s\S]*?)<\/title>/)}</title>`,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  (html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/) || [""])[0],
  `<style>\n${css}\n</style>`,
  body,
].join("\n");
if (page.includes('src="app.js"') || page.includes("serviceWorker") || !page.includes('<script type="module">')) {
  throw new Error("アーティファクト版の組み立てに失敗しました");
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`artifact written: ${out} (${(page.length / 1024).toFixed(1)} KiB)`);
