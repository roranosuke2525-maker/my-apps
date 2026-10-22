// 動かせるデモ（1ファイルのHTML）を作る。本物の画面コードをそのまま使い、/api だけを偽物に差し替える。
//   node scripts/build-demo.mjs [出力先]   既定：dist/demo.html
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] || join(root, "dist", "demo.html");
const read = (p) => readFile(join(root, p), "utf8");

const [html, css, app] = await Promise.all([read("public/index.html"), read("public/style.css"), read("public/app.js")]);

// デモ用の習慣（列名の形式は DB_習慣チェック と同じ）
const habits = [
  ["◆☼ 起床", ""], ["◆☼ 洗濯", ""], ["◆↻ マネーフォワード更新", ""],
  ["◇☼ 体重計に乗る", "朝、乗るだけでOK"], ["◇☼ プロテイン", ""], ["◇☼ ストレッチ", "最小版：1分"],
  ["◇☼ 新聞", "最小版：見出しだけ"], ["◇☼ スクワット", "最小版：10回"],
  ["◇☀︎ プロテイン", ""], ["◇◷ プロテイン（15時）", ""],
  ["◇☾ ヤクルト（22時）", "寝る前22時ごろ"], ["◇☾ フロス", ""],
  ["◇↻ 読書", "最小版：1ページ"], ["◇↻ ナッツを食べる", ""],
];

const mock = `
// ---- デモ用：Worker の代わりに画面の中で返事をする（Notion には何も送らない） ----
(() => {
  const HABITS = ${JSON.stringify(habits)};
  const EXP_PER_CHECK = 5, EXP_PER_LV = 100;
  const habitList = HABITS.map(([name, hint]) => {
    const m = name.match(/^([◆◇])\\s*([☼☀◷☾↻])[\\uFE0E\\uFE0F]?\\s*(.+)$/u);
    const slot = { "☼": "morning", "☀": "noon", "◷": "timed", "☾": "night", "↻": "anytime" }[m[2]];
    return { name, label: m[3].trim(), must: m[1] === "◆", slot, hint };
  });
  const rows = {};
  let totalExp = 1135;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const newRow = (date, seed) => ({ id: "demo-" + date, url: "", note: "",
    checks: Object.fromEntries(HABITS.map(([n], i) => [n, seed && i % 3 === 0])) });
  rows[today] = newRow(today, true);
  const stats = () => ({ "いまのLv": Math.floor(totalExp / EXP_PER_LV), "のこりEXP": EXP_PER_LV - (totalExp % EXP_PER_LV) });
  const view = (r) => r && { ...r, checks: { ...r.checks }, stats: stats() };
  const reply = (data, status = 200) => new Promise((ok) =>
    setTimeout(() => ok(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })), 250));
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://demo.invalid/");
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.pathname === "/api/day" && (init.method || "GET") === "GET") {
      const date = url.searchParams.get("date");
      return reply({ date, habits: habitList, row: view(rows[date]) });
    }
    if (url.pathname === "/api/day" && init.method === "POST") {
      rows[body.date] = rows[body.date] || newRow(body.date, false);
      return reply({ date: body.date, habits: habitList, row: view(rows[body.date]) });
    }
    const id = url.pathname.split("/").pop();
    const row = Object.values(rows).find((r) => r.id === id);
    if (body.name === "ひとこと") {
      if (!row.note && body.value) totalExp += 5;
      row.note = body.value;
    } else {
      if (row.checks[body.name] !== body.value) totalExp += body.value ? EXP_PER_CHECK : -EXP_PER_CHECK;
      row.checks[body.name] = body.value;
    }
    return reply({ row: view(row) });
  };
  // 合言葉の画面は飛ばす。埋め込み先では端末への保存が禁止されることがあるので、保存先も画面の中に置く
  const memory = { "habit-check:key": "demo-key-0123456789" };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (k in memory ? memory[k] : null),
      setItem: (k, v) => { memory[k] = String(v); },
      removeItem: (k) => { delete memory[k]; },
    },
  });
})();
`;

const banner = `<div style="background:#fff4d6;color:#7a5200;font-size:12px;padding:6px 16px;text-align:center">デモ：タップで動きます（Notion には保存されません）</div>`;

const page = html
  .replace(/<link rel="manifest"[^>]*>\s*/, "")
  .replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\s*/g, "")
  .replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`)
  .replace("<body>", `<body>\n  ${banner}`)
  .replace(
    '<script src="app.js" type="module"></script>',
    `<script>${mock}</script>\n  <script type="module">\n${app.replace(/if \("serviceWorker" in navigator\)[\s\S]*?\n}\n/, "")}\n  </script>`,
  );

if (page.includes('href="style.css"') || page.includes('src="app.js"')) throw new Error("デモの組み立てに失敗しました");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`demo written: ${out} (${(page.length / 1024).toFixed(1)} KiB)`);
