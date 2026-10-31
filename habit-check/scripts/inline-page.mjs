// 画面（public/）を1ファイルのHTMLにまとめる。CSS・JS・木目画像を中に入れ、/api の差し替えスクリプトを先に読み込む。
// build-demo.mjs（作りものの /api）と build-artifact.mjs（Notion 連携の /api）で使う。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(join(root, p), "utf8");
const dataUri = async (p, type) => `data:${type};base64,${(await readFile(join(root, p))).toString("base64")}`;

// 画面のJSが import している public/ の中のファイルを、1つのスクリプトにつなげる（export は外す）
async function bundle(file, seen = new Set()) {
  if (seen.has(file)) return "";
  seen.add(file);
  const code = await read(`public/${file}`);
  const parts = [];
  for (const m of code.matchAll(/^import \{[^}]*\} from "\.\/([\w.-]+)";$/gm)) parts.push(await bundle(m[1], seen));
  parts.push(code.replace(/^import \{[^}]*\} from "\.\/[\w.-]+";\n/gm, "").replace(/^export (const|function|async function) /gm, "$1 "));
  return parts.join("\n");
}

export async function inlinePage({ apiScript, bodyStart = "", extraCss = "" }) {
  const [html, css, app, walnut, oak] = await Promise.all([
    read("public/index.html"),
    read("public/style.css"),
    bundle("app.js"),
    dataUri("public/img/walnut.jpg", "image/jpeg"),
    dataUri("public/img/oak.jpg", "image/jpeg"),
  ]);
  const inlineCss = css.replaceAll('url("img/walnut.jpg")', `url("${walnut}")`).replaceAll('url("img/oak.jpg")', `url("${oak}")`);
  const page = html
    .replace(/<link rel="manifest"[^>]*>\s*/, "")
    .replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\s*/g, "")
    .replace('<link rel="stylesheet" href="style.css">', `<style>\n${inlineCss}\n${extraCss ? `${extraCss}\n` : ""}</style>`)
    .replace("<body>", `<body>\n  ${bodyStart}`)
    .replace(
      '<script src="app.js" type="module"></script>',
      `<script>${apiScript}</script>\n  <script type="module">\n${app.replace(/if \("serviceWorker" in navigator\)[\s\S]*?\n}\n/, "")}\n  </script>`,
    );
  if (page.includes('href="style.css"') || page.includes('src="app.js"') || page.includes('url("img/')) {
    throw new Error("1ファイルへの組み立てに失敗しました");
  }
  return page;
}
