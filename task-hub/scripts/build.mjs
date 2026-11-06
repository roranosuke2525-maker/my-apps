// 画面の部品（app/）をつないで public/index.html を作る。アーティファクト版も Cloudflare版もこの1枚を使う
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL("../", import.meta.url);
const parts = ["head.html", "settings.js", "data.js", "editor.js", "views.js", "today.js", "page.js", "shop.js", "read.js", "news.js", "concierge.js", "suggest.js", "ops.js", "search.js", "boot.js"];
const html = parts.map((p) => readFileSync(new URL(`app/${p}`, dir), "utf8")).join("");
writeFileSync(new URL("public/index.html", dir), html);
// Worker は画面（HTML）と sw.js を資産の置き場からではなく自分の中から配る（置き場の端のキャッシュに古い版が残る事故があったため）
import { createHash } from "node:crypto";
const sw = readFileSync(new URL("public/sw.js", dir), "utf8");
const build = createHash("sha256").update(html + sw).digest("hex").slice(0, 10);
writeFileSync(new URL("src/bundle.js", dir), `// build.mjs が作る。手で直さない\nexport const BUILD = ${JSON.stringify(build)};\nexport const HTML = ${JSON.stringify(html)};\nexport const SW = ${JSON.stringify(sw)};\n`);
console.log(`public/index.html（${(html.length / 1024).toFixed(0)} KB）・build ${build}`);
