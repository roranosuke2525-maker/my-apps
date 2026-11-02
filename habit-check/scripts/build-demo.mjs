// 動かせるデモ（1ファイルのHTML）を作る。本物の画面コードをそのまま使い、/api だけを偽物に差し替える。
//   node scripts/build-demo.mjs [出力先]   既定：dist/demo.html
// デモのデータはすべて作りもの（実際の Notion の値ではない）。
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inlinePage, root } from "./inline-page.mjs";
import { habitType, habitWeight } from "../src/aibou-config.js";

const out = process.argv[2] || join(root, "dist", "demo.html");

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
  const AIBOU = ${JSON.stringify(Object.fromEntries(habits.map(([n]) => [n, { type: habitType(n), exp: habitWeight(n) }])))};
  const EXP_PER_CHECK = 5, EXP_PER_LV = 150;
  const habitList = HABITS.map(([name, hint]) => {
    const m = name.match(/^([◆◇★])\\s*([☼☀◷◐☾↻])[\\uFE0E\\uFE0F]?\\s*(.+)$/u);
    const slot = { "☼": "morning", "☀": "noon", "◷": "noon", "◐": "evening", "☾": "night", "↻": "anytime" }[m[2]];
    const label = m[3].trim();
    const d = label.match(/[（(]([日月火水木金土]+)[）)]\\s*$/u);
    return { name, label, must: m[1] === "◆", bonus: m[1] === "★", slot, days: d ? [...d[1]].map((c) => "日月火水木金土".indexOf(c)) : null, hint, aibou: AIBOU[name] };
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
  // 新しいギルド：stageRank・need・reward は src/guild-config.js の questBoard と同じ形
  const quests = [
    { id: "q".repeat(31) + "1", title: "換気扇の霧を晴らせ", category: "家事", rank: "D", repeat: false, requester: "宿屋のおかみ", line: "外側の油がまた光ってる。表をきゅっと磨いておくれ", stages: ["換気扇のフィルターを1枚替える", "レンジフードの外側を拭く", "換気扇を分解して洗う", "台所の壁とコンロまわりを大掃除する", "月1の台所メンテを3か月続ける"], stage: 1, stageRank: "C", need: 6, reward: 70, master: false, dropSlot: "たて", epilogues: 1, detour: "", count: 1, totalExp: 40, exp: 70 },
    { id: "q".repeat(31) + "2", title: "ワンオペの試練", category: "育児", rank: "C", repeat: false, requester: "妻", line: "1泊。冷蔵庫に作り置きあるから。あと、寝かしつけ早めにね", stages: ["2時間ひとりで見る", "半日ワンオペを乗り切る", "1日ワンオペを乗り切る", "1泊2日のワンオペを乗り切る", "2泊3日のワンオペを乗り切る"], stage: 3, stageRank: "S", need: 30, reward: 220, master: false, dropSlot: "たて", epilogues: 3, detour: "", count: 3, totalExp: 220, exp: 220 },
    { id: "q".repeat(31) + "3", title: "固定費のみなおし", category: "お金", rank: "C", repeat: true, requester: "コインズの商人ギルド長", line: "見えない鎖は、1本切るごとに財布が軽く……いや、重くなるのですぞ", stages: ["使っていないサブスクを1つ解約する"], stage: 0, stageRank: "C", need: 6, reward: 70, master: false, dropSlot: "よろい", epilogues: 1, detour: "", count: 2, totalExp: 140, exp: 70 },
    { id: "q".repeat(31) + "4", title: "本を読破せよ", category: "学び", rank: "B", repeat: true, requester: "フミ", line: "最後のページまで行けたら……あの、感想、聞かせてください！", stages: ["本を1冊読みきる"], stage: 0, stageRank: "B", need: 12, reward: 110, master: false, dropSlot: "かぶと", epilogues: 2, detour: "", count: 6, totalExp: 660, exp: 110 },
    { id: "q".repeat(31) + "5", title: "在庫リストの整備", category: "家", rank: "C", repeat: false, requester: "食料庫の小人", line: "何がいくつあって、いくつで買うか。帳面があれば、番人はもっと強くなれるでち", stages: ["補充リストを整える"], stage: 0, stageRank: "C", need: 6, reward: 70, master: true, dropSlot: "よろい", epilogues: 1, detour: "", count: 1, totalExp: 70, exp: 70 },
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
    { id: "s".repeat(31) + "5", title: "第1話　たまごと灰", kind: "エピソード2", order: 201, unlockLv: 1, state: "⚔️ ボスと たたかっている", read: true, boss: "灰のスライム", hp: 300, weak: "しっかり" },
    { id: "s".repeat(31) + "6", title: "第2話　ぴしっ、ぱりん", kind: "エピソード2", order: 202, unlockLv: 1, state: "🔒 前の話のボスを倒すと開く", read: false, locked: true },
  ];
  const storyText = [
    { type: "p", text: "（デモ用の文章です）木の香りのする部屋で、ひかるは目をさました。" },
    { type: "p", text: "窓の外では、朝の霧がゆっくりと晴れていく。" },
    { type: "quote", text: "【SYSTEM】デモの章を読みました" },
  ];
  const withLv = (c) => ({ ...c, playerLv: level(), locked: c.locked || level() < c.unlockLv });
  // ぼうけん：第1話のボスと、タスクのモンスター（作りもの）
  const fam = { ホコリ: ["#9aa0a6", "#6f757b", "#d7dadd"], コイン: ["#f2c14e", "#c9962a", "#fff0b8"], モジ: ["#7fb2f0", "#4f84c9", "#d4e6fc"], ヨナキ: ["#f4a3b8", "#d97c95", "#ffd9e3"] };
  const mon = (i, family, rank, shape, title, stars, status, weight) => ({ id: "t" + i, url: "", title, status, weight, family, colors: fam[family], shape, name: family + rank, stars, ageDays: stars * 14 + 3 });
  const monsters = [
    mon(1, "ホコリ", "ドラゴン", "dragon", "物置を空にする", 5, "🕰 SOMEDAY", "XL"), mon(2, "コイン", "ゴーレム", "golem", "保険を見直す", 3, "📥 INBOX", "L"),
    mon(3, "モジ", "ゴブリン", "goblin", "本を1冊読みきる", 1, "⏭ NEXT", "M"), mon(4, "ヨナキ", "スライム", "slime", "保育園の書類", 0, "▶️ DOING", "S"),
    mon(5, "ホコリ", "スライム", "slime", "玄関のマット", 0, "⏭ NEXT", "S"),
  ];
  // そうび（作りもの）
  const items = [
    { id: "i1", name: "吸込口のたて", slot: "たて", type: "やさしさ", rarity: 1, effect: 3, crit: false, equipped: true, date: addDays(today, -26) },
    { id: "i2", name: "風見のたて", slot: "たて", type: "やさしさ", rarity: 3, effect: 8, crit: true, equipped: false, date: addDays(today, -3) },
    { id: "i3", name: "一行の革よろい", slot: "よろい", type: "しっかり", rarity: 1, effect: 3, crit: false, equipped: true, date: addDays(today, -15) },
    { id: "i4", name: "一杯目のしずく", slot: "アクセサリー", type: "ぜんぶ", rarity: 1, effect: 3, crit: false, equipped: false, date: addDays(today, -26) },
    { id: "i5", name: "栞のはちまき", slot: "かぶと", type: "かしこさ", rarity: 2, effect: 5, crit: false, equipped: false, date: addDays(today, -8) },
  ];
  const equipNow = () => {
    const b = {};
    for (const it of items.filter((x) => x.equipped)) {
      if (it.type === "ぜんぶ") for (const t of ["ちから", "かしこさ", "やさしさ", "しっかり"]) b[t] = (b[t] || 0) + it.effect / 2;
      else b[it.type] = (b[it.type] || 0) + it.effect;
    }
    return b;
  };
  const battle = () => {
    const t = Object.entries(rows[today].checks).filter(([, v]) => v).reduce((s, [n]) => s + AIBOU[n].exp, 0);
    return { boss: { chapterId: "s".repeat(31) + "5", chapter: "第1話　たまごと灰", name: "灰のスライム", hp: 300, weak: "しっかり", start: addDays(today, -1),
      damage: Math.min(300, 140 + t), today: t, petHit: false, mult: 1.02, defeatedOn: null,
      log: [{ date: today, kind: "habit", damage: t }, { date: addDays(today, -1), kind: "task", name: "コインゴーレム", title: "保険を見直す", stars: 3, family: "コイン", shape: "golem", colors: fam.コイン, damage: 84 }, { date: addDays(today, -1), kind: "habit", damage: 56 }] },
      next: null, cleared: false, stats: { ちから: 31, かしこさ: 52, やさしさ: 40, しっかり: 63 }, equip: equipNow(), pet: { name: "", stage: "成長期", type: "ちから" }, monsters, moreMonsters: false };
  };
  const player = () => ({ id: "player", url: "", name: "デモのプレイヤー", level: level(), toNext: EXP_PER_LV - (total() % EXP_PER_LV),
    totalExp: total(), habitExp: habitExp(), taskExp, guildExp,
    status: "ちから 12 ／ まもり 9 ／ かしこさ 14", party: "モリ（きこり）・ノア（ものしり）", spell: "ととのえ（Lv3）\\nはやおき（Lv5）" });
  // あいぼう：成長期（ちから）の途中。今日のチェックのぶんだけ増える
  const pet = { id: "pet", url: "", name: "", birthday: addDays(today, -20), stage: "成長期", childType: "ちから", adultType: null, type: "ちから",
    history: addDays(today, -19) + " 孵化／" + addDays(today, -6) + " 成長期（ちから）" };
  const aibouData = () => {
    const t = Object.entries(rows[today].checks).filter(([, v]) => v).reduce((s, [n]) => s + AIBOU[n].exp, 0);
    return { pet, exp: 5200 + t, today: t, from: 4000, next: { stage: "成体", at: 18000 }, evolved: [],
      points: { ちから: 2100, かしこさ: 1500, やさしさ: 1300, しっかり: 1600 + t }, period: { ちから: 620, かしこさ: 310, やさしさ: 280, しっかり: 400 + t } };
  };
  // からだチェック：毎週1回の記録（写真はデモなのでなし）
  const bodyRec = (d, score, diff, damage) => ({ id: "b" + d, title: addDays(today, -d) + " 07:00", at: addDays(today, -d) + "T07:00:00+09:00", date: addDays(today, -d), score, diff, damage,
    parts: { chest: 5, shoulders: 6, arms: 5, abs: 4, back: 5, legs: 6 }, comment: "（デモ）全体に少し引き締まってきました。", confidence: "中", match: "高", photos: {} });
  const bodyData = { configured: { notion: true, ai: true }, model: "claude-sonnet-5-5", weekUsed: false,
    rules: { base: 120, weekly: 1, compareDays: 6, type: "ちから" },
    records: [bodyRec(7, 60, 2, 170), bodyRec(14, 58, 1, 145), bodyRec(21, 57, 2, 170), bodyRec(28, 55, null, 120)] };
  bodyData.compare = bodyData.records[0];
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
      const q = quests.find((x) => x.id === (body.questIds?.[0] || body.questId));
      q.count += 1; q.totalExp += q.exp; guildExp += q.exp;
      const r = { id: "r" + Date.now(), note: body.note.trim(), questIds: [q.id], date: new Date().toISOString() };
      reports.unshift(r);
      const drop = { id: "i" + Date.now(), name: "鉄のよろい", slot: "よろい", type: "しっかり", rarity: 3, effect: 8, crit: true, equipped: false, date: today, quest: q.title };
      items.push(drop);
      return reply({ report: r, drops: [drop] });
    }
    if (p === "/api/battle") return reply(battle());
    if (p === "/api/body" && method === "GET") return reply(bodyData);
    if (p === "/api/body") {
      const score = 63, diff = 3, damage = bodyData.weekUsed ? 0 : 195;
      const rec = { id: "body" + bodyData.records.length, title: today + " 07:00", at: today + "T07:00:00+09:00", date: today, score, diff, damage,
        parts: { chest: 6, shoulders: 6, arms: 5, abs: 5, back: 6, legs: 7 }, comment: "（デモ）胸と肩の厚みが前回より少し増えて見えます。お腹まわりはまだ伸びしろ。腹筋ローラーを続けましょう。", confidence: "中", match: "高", photos: {} };
      bodyData.records.unshift(rec);
      bodyData.weekUsed = true;
      return new Promise((ok) => setTimeout(() => ok(new Response(JSON.stringify({ record: rec, weekUsed: false, compared: bodyData.compare.title,
        boss: { name: "灰のスライム", hp: 300, damage: 300, defeatedOn: null, hit: Math.round(damage * 1.02), before: false } }), { status: 200, headers: { "Content-Type": "application/json" } })), 1500));
    }
    if (p === "/api/items") return reply({ items, drops: [], slots: [] });
    if (p.startsWith("/api/items/")) {
      const it = items.find((x) => x.id === p.split("/").pop());
      if (body.equipped) items.forEach((x) => { if (x.slot === it.slot) x.equipped = false; });
      it.equipped = body.equipped;
      return reply({ items, drops: [], slots: [] });
    }
    if (p === "/api/aibou" && method === "PATCH") { pet.name = body.name; return reply({ pet }); }
    if (p === "/api/aibou") return reply(aibouData());
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

const page = await inlinePage({ apiScript: mock, bodyStart: banner });

await mkdir(dirname(out), { recursive: true });
await writeFile(out, page);
console.log(`demo written: ${out} (${(page.length / 1024).toFixed(1)} KiB)`);
