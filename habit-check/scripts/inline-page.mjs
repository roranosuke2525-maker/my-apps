// 画面（public/）を1ファイルのHTMLにまとめる。CSS・JS・木目画像を中に入れ、/api の差し替えスクリプトを先に読み込む。
// build-demo.mjs（作りものの /api）と build-artifact.mjs（Notion 連携の /api）で使う。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(join(root, p), "utf8");
const dataUri = async (p, type) => `data:${type};base64,${(await readFile(join(root, p))).toString("base64")}`;

export async function inlinePage({ apiScript, bodyStart = "", extraCss = "" }) {
  const [html, css, app, carve, walnut, oak] = await Promise.all([
    read("public/index.html"),
    read("public/style.css"),
    read("public/app.js"),
    read("public/carve.js"),
    dataUri("public/img/walnut.jpg", "image/jpeg"),
    dataUri("public/img/oak.jpg", "image/jpeg"),
  ]);
  const inlineCss = css.replaceAll('url("img/walnut.jpg")', `url("${walnut}")`).replaceAll('url("img/oak.jpg")', `url("${oak}")`);
  const page = html
    .replace(/<link rel="manifest"[^>]*>\s*/, "")
    .replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\s*/g, "")
    .replace('<link rel="stylesheet" href="style.css">', `<style>\n${inlineCss}\n${extraCss ? `${extraCss}\n` : ""}</style>`)
    .replace("<body>", `<body>\n  ${bodyStart}`)
    .replace('<script src="carve.js"></script>', () => `<script>\n${carve}\n  </script>`)
    .replace(
      '<script src="app.js" type="module"></script>',
      `<script>${apiScript}</script>\n  <script type="module">\n${app.replace(/if \("serviceWorker" in navigator\)[\s\S]*?\n}\n/, "")}\n  </script>`,
    );
  if (page.includes('href="style.css"') || page.includes('src="app.js"') || page.includes('src="carve.js"') || page.includes('url("img/')) {
    throw new Error("1ファイルへの組み立てに失敗しました");
  }
  return page;
}
