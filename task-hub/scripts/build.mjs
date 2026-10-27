// 画面の部品（app/）をつないで public/index.html を作る。アーティファクト版も Cloudflare版もこの1枚を使う
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL("../", import.meta.url);
const parts = ["head.html", "settings.js", "data.js", "editor.js", "views.js", "page.js", "shop.js", "boot.js"];
const html = parts.map((p) => readFileSync(new URL(`app/${p}`, dir), "utf8")).join("");
writeFileSync(new URL("public/index.html", dir), html);
console.log(`public/index.html（${(html.length / 1024).toFixed(0)} KB）`);
