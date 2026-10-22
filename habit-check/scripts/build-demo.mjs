// 動かせるデモ（1ファイルのHTML）を作る。本物の画面コードをそのまま使い、/api だけを偽物に差し替える。
//   node scripts/build-demo.mjs [出力先]   既定：dist/demo.html
// デモのデータはすべて作りもの（実際の Notion の値ではない）。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] || join(root, "dist", "demo.html");
const read = (p) => readFile(join(root, p), "utf8");
const dataUri = async (p, type) => `data:${type};base64,${(await readFile(join(root, p))).toString("base64")}`;

const [html, css, app, walnut, oak] = await Promise.all([
  read("public/index.html"),
  read("public/style.css"),
  read("public/app.js"),
  dataUri("public/img/walnut.jpg", "image/jpeg"),
  dataUri("public/img/oak.jpg", "image/jpeg"),
]);

// デモ用の習慣（列名の形式は DB_習慣チェック と同じ）
const habits = [
  ["◆☼ 起床", ""], ["◆☼ 洗濯", ""], ["◆↻ マネーフォワード更新", ""],
  ["◇☼ 体重計に乗る", "朝、乗るだけでOK"], ["◇☼ プロテイン", ""], ["◇☼ ストレッチ", "最小版：1分"],
  ["◇☼ 新聞", "最小版：見出しだけ"], ["◇☼ スクワット", "最小版：10回"], ["◇☼ 日焼け止め", ""],
  ["◇☀︎ プロテイン", ""], ["◇◷ プロテイン（15時）", ""],
  ["◇☾ ヤクルト（22時）", "寝る前22時ごろ"], ["◇☾ フロス", ""], ["◇☾ 仕事の所感を書く", "一言でOK"],
  ["◇↻ 読書", "最小版：1ページ"], ["◇↻ ナッツを食べる", ""], ["◇↻ 食器洗い・食洗機", ""],
];

// すがたの絵（デモ用の簡単な人形）
const figure = (body, hat) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="22" r="10" fill="#f2d3b3"/><path d="M14 58c2-14 9-22 18-22s16 8 18 22z" fill="${body}"/><path d="M20 18c2-9 22-9 24 0z" fill="${hat}"/></svg>`)}`;

const mock = `
// ---- デモ用：Worker の代わりに画面の中で返事をする（Notion には何も送らない） ----
(() => {
  const HABITS = ${JSON.stringify(habits)};
  const EXP_PER_CHECK = 5, EXP_PER_LV = 150;
  const habitList = HABITS.map(([name, hint]) => {
    const m = name.match(/^([◆◇])\\s*([☼☀◷☾↻])[\\uFE0E\\uFE0F]?\\s*(.+)$/u);
    const slot = { "☼": "morning", "☀": "noon", "◷": "timed", "☾": "night", "↻": "anytime" }[m[2]];
    return { name, label: m[3].trim(), must: m[1] === "◆", slot, hint };
  });
  const jst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const today = jst();
  const rows = {};
  const newRow = (date, seed) => ({ id: "demo-" + date.replace(/-/g, ""), url: "", note: "",
    checks: Object.fromEntries(HABITS.map(([n], i) => [n, seed ? ((i * 7 + Number(date.slice(8)) * 3) % 10) < seed : false])) });
  for (let i = 1; i <= 60; i++) { const d = addDays(today, -i); if (i % 13 !== 5) rows[d] = newRow(d, 6 + (i % 4)); }
  rows[today] = newRow(today, 4);
  let guildExp = 340, taskExp = 520;
  const habitExp = () => Object.values(rows).reduce((s, r) => s + Object.values(r.checks).filter(Boolean).length * EXP_PER_CHECK + (r.note ? 5 : 0), 0);
  const total = () => habitExp() + guildExp + taskExp;
  const level = () => Math.floor(total() / EXP_PER_LV) + 1;
  const stats = () => ({ "いまのLv": level(), "のこりEXP": EXP_PER_LV - (total() % EXP_PER_LV) });
  const view = (r) => r && { ...r, checks: { ...r.checks }, stats: stats() };
  const members = [
    { id: "m1", name: "ひかる（かけだし）", kind: "しゅじんこう", needLv: 1, nextLv: 15, image: ${JSON.stringify(figure("#8a5a36", "#5e4030"))} },
    { id: "m2", name: "ひかる（いちにんまえ）", kind: "しゅじんこう", needLv: 15, nextLv: 999, image: ${JSON.stringify(figure("#3f74a0", "#2b4d6a"))} },
    { id: "m3", name: "モリ（きこり）", kind: "なかま", needLv: 3, nextLv: 999, image: ${JSON.stringify(figure("#6e7b4f", "#4c5636"))} },
    { id: "m4", name: "ノア（ものしり）", kind: "なかま", needLv: 8, nextLv: 999, image: ${JSON.stringify(figure("#7a55a0", "#563c72"))} },
  ];
  const quests = [
    { id: "q".repeat(31) + "1", title: "朝の霧を晴らせ（7時までに起きる）", category: "からだ", rank: "C", lv: 1, exp: 40, stages: ["3日つづける", "1週間つづける", "1か月つづける"], board: "★★☆　つぎ：1か月つづける", detour: "", count: 2, totalExp: 80 },
    { id: "q".repeat(31) + "2", title: "台所の砦をととのえる", category: "家事", rank: "B", lv: 3, exp: 60, stages: ["引き出しを1つ片づける", "シンク下を片づける", "食器を半分に減らす"], board: "★☆☆　つぎ：シンク下を片づける", detour: "寄り道：調味料の期限チェック", count: 1, totalExp: 60 },
    { id: "q".repeat(31) + "3", title: "固定費の迷宮", category: "お金", rank: "C", lv: 3, exp: 60, stages: ["サブスクを1つ確認する", "通信費を見直す", "保険を見直す"], board: "☆☆☆　つぎ：サブスクを1つ確認する", detour: "", count: 0, totalExp: 0 },
    { id: "q".repeat(31) + "4", title: "本の塔をのぼる（月2冊）", category: "学び", rank: "A", lv: 5, exp: 100, stages: ["1冊読みきる", "2冊読みきる", "3か月つづける"], board: "★☆☆", detour: "", count: 1, totalExp: 100 },
    { id: "q".repeat(31) + "5", title: "写真の森を手入れする", category: "趣味", rank: "D", lv: 2, exp: 20, stages: ["1か月分を選ぶ", "アルバムを1冊作る"], board: "☆☆", detour: "", count: 0, totalExp: 0 },
    { id: "q".repeat(31) + "6", title: "伝説の大掃除", category: "家", rank: "S", lv: 99, exp: 300, stages: ["家じゅうの窓を拭く", "物置を空にする"], board: "", detour: "", count: 0, totalExp: 0 },
  ];
  const reports = [
    { id: "r1", note: "引き出しの中身を半分にした", questIds: [quests[1].id], date: addDays(today, -1) + "T11:20:00.000Z" },
    { id: "r2", note: "6:50に起きられた", questIds: [quests[0].id], date: addDays(today, -3) + "T22:05:00.000Z" },
  ];
  const chapters = [
    { id: "s".repeat(31) + "1", title: "第1章　木の家で目をさます", kind: "ほんぺん", order: 1, unlockLv: 1, state: "よめる", read: true },
    { id: "s".repeat(31) + "2", title: "第2章　きこりのモリ", kind: "ほんぺん", order: 2, unlockLv: 3, state: "よめる", read: false },
    { id: "s".repeat(31) + "3", title: "第3章　霧の湖", kind: "ほんぺん", order: 3, unlockLv: 15, state: "", read: false },
    { id: "s".repeat(31) + "4", title: "寄り道　台所の小人", kind: "よりみち", order: 101, unlockLv: 3, state: "依頼「台所の砦」を1回たっせいで よめる", read: false },
  ];
  const storyText = [
    { type: "p", text: "（デモ用の文章です）木の香りのする部屋で、ひかるは目をさました。" },
    { type: "p", text: "窓の外では、朝の霧がゆっくりと晴れていく。" },
    { type: "quote", text: "【SYSTEM】デモの章を読みました" },
  ];
  const withLv = (c) => ({ ...c, playerLv: level(), locked: level() < c.unlockLv });
  const player = () => ({ id: "player", url: "", name: "デモのプレイヤー", level: level(), toNext: EXP_PER_LV - (total() % EXP_PER_LV),
    totalExp: total(), habitExp: habitExp(), taskExp, guildExp,
    status: "ちから 12 ／ まもり 9 ／ かしこさ 14", party: "モリ（きこり）・ノア（ものしり）", spell: "ととのえ（Lv3）\\nはやおき（Lv5）" });
  const reply = (data, status = 200) => new Promise((ok) =>
    setTimeout(() => ok(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })), 200));
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://demo.invalid/");
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : {};
    const p = url.pathname;
    if (p === "/api/day" && method === "GET") {
      const date = url.searchParams.get("date");
      return reply({ date, habits: habitList, row: view(rows[date]) });
    }
    if (p === "/api/day" && method === "POST") {
      rows[body.date] = rows[body.date] || newRow(body.date, 0);
      return reply({ date: body.date, habits: habitList, row: view(rows[body.date]) });
    }
    if (p === "/api/range") {
      const from = url.searchParams.get("from"), to = url.searchParams.get("to");
      const days = {};
      for (let d = from; d <= to; d = addDays(d, 1)) if (rows[d]) days[d] = view(rows[d]);
      return reply({ from, to, habits: habitList, days });
    }
    if (p === "/api/player") return reply({ player: player() });
    if (p === "/api/party") return reply({ members: members.filter((m) => m.needLv <= level()) });
    if (p === "/api/guild" && method === "GET") return reply({ quests: quests.map((q) => ({ ...q, playerLv: level() })), reports });
    if (p === "/api/guild/reports") {
      const q = quests.find((x) => x.id === body.questId);
      q.count += 1; q.totalExp += q.exp; guildExp += q.exp;
      const r = { id: "r" + Date.now(), note: body.note.trim(), questIds: [q.id], date: new Date().toISOString() };
      reports.unshift(r);
      return reply({ report: r });
    }
    if (p === "/api/story") return reply({ chapters: chapters.map(withLv) });
    if (p.startsWith("/api/story/")) {
      const c = chapters.find((x) => x.id === p.split("/").pop());
      if (withLv(c).locked) return reply({ error: "Lv" + c.unlockLv + "になると読めます" }, 403);
      if (method === "PATCH") { c.read = body.read; return reply({ chapter: withLv(c) }); }
      return reply({ chapter: withLv(c), blocks: storyText });
    }
    const id = p.split("/").pop();
    const row = Object.values(rows).find((r) => r.id === id);
    if (body.name === "ひとこと") row.note = body.value;
    else row.checks[body.name] = body.value;
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

const banner = `<div style="position:fixed;top:0;right:0;z-index:30;background:#fff4d6;color:#7a5200;font-size:10px;line-height:16px;padding:0 8px;border-radius:0 0 0 8px;pointer-events:none">デモ（作りもののデータ・保存されません）</div>`;

const demoCss = css.replaceAll('url("img/walnut.jpg")', `url("${walnut}")`).replaceAll('url("img/oak.jpg")', `url("${oak}")`);

const page = html
  .replace(/<link rel="manifest"[^>]*>\s*/, "")
  .replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\s*/g, "")
  .replace('<link rel="stylesheet" href="style.css">', `<style>\n${demoCss}\n</style>`)
  .replace("<body>", `<body>\n  ${banner}`)
  .replace(
    '<script src="app.js" type="module"></script>',
    `<script>${mock}</script>\n  <script type="module">\n${app.replace(/if \("serviceWorker" in navigator\)[\s\S]*?\n}\n/, "")}\n  </script>`,
  );

if (page.includes('href="style.css"') || page.includes('src="app.js"') || page.includes('url("img/')) throw new Error("デモの組み立てに失敗しました");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`demo written: ${out} (${(page.length / 1024).toFixed(1)} KiB)`);
