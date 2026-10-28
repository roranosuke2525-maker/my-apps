// パーティー（DB_すがた）のドット絵・エピソード2版（32×32）を public/img/party/*.svg に書き出す。
// 夜空と星、ろうそくの灯りのふち（エピソード2は《ヨイヤミ》の物語）。
//   node scripts/make-party-sprites.mjs
// Notion の DB_すがた へは scripts/upload-party.mjs で差し替える。
import { mkdirSync, writeFileSync } from "node:fs";

const N = 32;
const canvas = () => Array.from({ length: N }, () => Array(N).fill("."));
const inRange = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
function px(g, pts, c) { for (const [x, y] of pts) if (inRange(x, y)) g[y][x] = c; }
function rect(g, x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (inRange(i, j)) g[j][i] = c; }
function ell(g, cx, cy, rx, ry, c) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) g[y][x] = c;
}
function line(g, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) { px(g, [[x0, y0]], c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
// 外側の輪郭（キャラの色のまわりを o に）
function outline(g) {
  const out = g.map((r) => r.slice());
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y][x] !== ".") continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const c = g[y + dy]?.[x + dx]; return c && c !== "." && c !== "o"; })) out[y][x] = "o";
  }
  return out;
}

// 人物：c＝{ skin, hair, hairStyle, top, topShade, legs, boots, belt, cape, hat, weapon, shield, extra[] }
function person(o) {
  const g = canvas();
  const w = o.wide ? 1 : 0; // ムキは体が大きい
  // マント（体の後ろ）
  if (o.cape) {
    // 肩から足元へ広がるマント（両わきと すそが見える）
    for (let y = 12; y <= 27; y++) { const spread = Math.floor((y - 12) / 3); rect(g, 7 - spread, y, 18 + 2 * spread, 1, y >= 25 ? "k" : "K"); }
  }
  // 足
  rect(g, 12 - w, 22, 3 + w, 6, "L"); rect(g, 17, 22, 3 + w, 6, "L");
  rect(g, 11 - w, 27, 4 + w, 2, "B"); rect(g, 17, 27, 4 + w, 2, "B");
  // 胴
  rect(g, 11 - w, 13, 10 + 2 * w, 10, "T");
  rect(g, 11 - w, 19, 10 + 2 * w, 1, "t");
  rect(g, 11 - w, 20, 10 + 2 * w, 1, "Y"); // ベルト
  if (o.robe) { rect(g, 10 - w, 18, 12 + 2 * w, 9, "T"); rect(g, 10 - w, 25, 12 + 2 * w, 2, "t"); }
  // 腕
  rect(g, 8 - w, 13, 3, 8, o.bareArms ? "S" : "T"); rect(g, 21 + w, 13, 3, 8, o.bareArms ? "S" : "T");
  rect(g, 8 - w, 20, 3, 2, "S"); rect(g, 21 + w, 20, 3, 2, "S");
  // 首と顔
  rect(g, 14, 11, 4, 2, "S");
  ell(g, 16, 7.5, 5, 5, "S");
  // 髪
  if (o.hairStyle !== "none") {
    for (let x = 11; x <= 20; x++) for (let y = 2; y <= 5; y++) if (((x + 0.5 - 16) / 5.2) ** 2 + ((y + 0.5 - 7) / 5.2) ** 2 <= 1) g[y][x] = "H";
    px(g, [[11, 6], [11, 7], [20, 6], [20, 7]], "H");
    if (o.hairStyle === "braid") { rect(g, 20, 7, 2, 2, "H"); rect(g, 21, 9, 2, 6, "H"); px(g, [[21, 15], [22, 15]], "Y"); }
    if (o.hairStyle === "bob") { rect(g, 10, 5, 2, 7, "H"); rect(g, 20, 5, 2, 7, "H"); }
    if (o.hairStyle === "spiky") px(g, [[12, 1], [15, 1], [18, 1], [13, 2], [16, 2], [19, 2]], "H");
  }
  // 顔のパーツ
  px(g, [[14, 8], [18, 8]], "E");
  if (o.glasses) { for (const cx of [14, 18]) px(g, [[cx - 1, 7], [cx, 7], [cx + 1, 7], [cx - 1, 8], [cx + 1, 8], [cx, 9]], "G"); px(g, [[16, 7]], "G"); } // 丸眼鏡（金のふち）
  px(g, [[13, 10], [19, 10]], "R"); // ほお
  px(g, [[15, 11], [16, 11], [17, 11]], o.beard ? "H" : "m");
  if (o.beard) rect(g, 13, 10, 7, 2, "H");
  // ぼうし・かぶと
  if (o.hat === "band") { rect(g, 11, 4, 10, 1, "A"); px(g, [[21, 5], [22, 6]], "A"); }
  if (o.hat === "leather") { ell(g, 16, 4, 6, 3, "A"); rect(g, 9, 5, 14, 1, "a"); }
  if (o.hat === "helm") { ell(g, 16, 5, 6, 4.5, "A"); rect(g, 10, 6, 12, 1, "a"); rect(g, 15, 1, 2, 3, "a"); }
  if (o.hat === "horn") { ell(g, 16, 5, 6, 4.5, "A"); rect(g, 10, 6, 12, 1, "a"); line(g, 10, 4, 7, 0, "Y"); line(g, 22, 4, 25, 0, "Y"); }
  if (o.hat === "crown") { ell(g, 16, 5, 6, 4.5, "A"); rect(g, 10, 6, 12, 1, "a"); px(g, [[11, 1], [13, 0], [16, 0], [19, 0], [21, 1], [12, 1], [14, 1], [15, 1], [17, 1], [18, 1], [20, 1]], "Y"); px(g, [[16, 2]], "r"); }
  if (o.hat === "brim") { rect(g, 9, 4, 14, 1, "A"); ell(g, 16, 3, 5, 2.5, "A"); px(g, [[19, 1], [20, 1]], "r"); }
  if (o.hat === "hood") { ell(g, 16, 6, 7, 6.5, "A"); ell(g, 16, 8, 4.5, 4.2, "S"); px(g, [[14, 8], [18, 8]], "E"); px(g, [[15, 11], [16, 11], [17, 11]], "m"); }
  // 武器（右手）
  if (o.weapon === "stick") { line(g, 25, 8, 23, 22, "W"); }
  if (o.weapon === "sword") { rect(g, 24, 6, 2, 13, "M"); px(g, [[24, 5]], "M"); rect(g, 22, 18, 6, 1, "Y"); rect(g, 24, 19, 2, 3, "W"); }
  if (o.weapon === "magic") { rect(g, 24, 4, 2, 15, "C"); px(g, [[24, 3], [25, 3]], "c"); px(g, [[23, 6], [26, 9], [23, 12]], "c"); rect(g, 22, 18, 6, 1, "Y"); rect(g, 24, 19, 2, 3, "W"); }
  if (o.weapon === "holy") { rect(g, 24, 3, 2, 16, "c"); px(g, [[24, 2], [25, 2]], "w"); rect(g, 21, 18, 8, 1, "Y"); rect(g, 24, 19, 2, 3, "Y"); px(g, [[27, 4], [22, 7], [27, 10]], "w"); }
  if (o.weapon === "axe") { line(g, 26, 6, 24, 24, "W"); ell(g, 27.5, 7.5, 3, 3.5, "M"); px(g, [[26, 6], [26, 7]], "W"); }
  if (o.weapon === "pen") { line(g, 25, 12, 23, 20, "W"); px(g, [[25, 11], [26, 10]], "Y"); }
  if (o.weapon === "abacus") { rect(g, 22, 15, 7, 6, "W"); for (const y of [16, 18]) for (const x of [23, 25, 27]) px(g, [[x, y]], "Y"); }
  // 盾（左手）
  if (o.shield) { rect(g, 4, 14, 6, 7, "D"); rect(g, 5, 21, 4, 1, "D"); px(g, [[6, 22], [7, 22]], "D"); px(g, [[6, 16], [7, 16], [6, 17], [7, 17]], "Y"); }
  // 小物
  for (const x of o.extra || []) {
    if (x === "lantern") { for (const [gx, gy] of [[19, 22], [23, 22], [19, 25], [23, 25], [21, 26], [20, 21], [22, 21]]) if (g[gy][gx] === ".") g[gy][gx] = "h"; }
    if (x === "lantern") { line(g, 20, 20, 21, 22, "W"); rect(g, 20, 22, 3, 4, "Y"); px(g, [[21, 23], [21, 24]], "F"); px(g, [[21, 22]], "f"); } // ルミのろうそくのランタン
    if (x === "wrist") { rect(g, 8 - w, 18, 3, 1, "r"); } // 鎖の火傷をかくす赤い布
    if (x === "bento") { rect(g, 3, 17, 6, 4, "r"); rect(g, 3, 16, 6, 1, "Y"); }
    if (x === "book") { rect(g, 4, 15, 6, 7, "r"); rect(g, 5, 16, 4, 5, "F"); px(g, [[6, 17], [7, 18], [6, 19]], "f"); } // 光る記録帳
    if (x === "sapling") { rect(g, 3, 19, 5, 3, "W"); line(g, 5, 18, 5, 14, "g"); px(g, [[4, 15], [6, 14], [3, 14], [7, 13]], "g"); }
    if (x === "scarf") { rect(g, 13, 12, 7, 2, "r"); rect(g, 18, 14, 2, 3, "r"); }
    if (x === "pauldron") { ell(g, 9.5 - w, 13.5, 3, 2, "A"); ell(g, 22.5 + w, 13.5, 3, 2, "A"); }
    if (x === "starcape") { px(g, [[9, 16], [22, 18], [10, 22], [23, 24]], "Y"); }
  }
  return outline(g);
}

const BASE = { o: "#1a1420", S: "#f6c9a3", R: "#f39a8c", E: "#2a1d18", m: "#b5605a", G: "#c9962a", Y: "#f2c14e", M: "#d7dde6", W: "#8a5a36", L: "#3b4a7a", B: "#5a3a24", F: "#ffcf6a", f: "#fff6d0", r: "#c8443a", g: "#7fd36b", C: "#7fc7ff", c: "#d8f0ff", w: "#ffffff", h: "#f3a64b" };
const CHARS = [
  { file: "1_minarai", name: "さとし（みならい）", o: { hair: "#6b3f22", top: "#7fae6b", topShade: "#5d8a4c", weapon: "stick", extra: ["lantern"] } },
  { file: "2_kakedashi", name: "さとし（かけだし）", o: { hair: "#6b3f22", hat: "leather", A: "#a6733f", a: "#7d5228", top: "#a6733f", topShade: "#7d5228", weapon: "sword", extra: ["lantern"] } },
  { file: "3_ichininmae", name: "さとし（いちにんまえ）", o: { hair: "#6b3f22", hat: "helm", A: "#aeb6c4", a: "#7d8696", top: "#5b8fd6", topShade: "#3f6db0", weapon: "sword", shield: "#b8673a", extra: ["lantern"] } },
  { file: "4_veteran", name: "さとし（ベテラン）", o: { hair: "#6b3f22", hat: "helm", A: "#c7cfdc", a: "#8a94a6", top: "#c7cfdc", topShade: "#8a94a6", cape: "#3a5fb0", capeShade: "#2a4585", weapon: "sword", shield: "#3a5fb0", extra: ["lantern", "pauldron"] } },
  { file: "5_tatsujin", name: "さとし（たつじん）", o: { hair: "#6b3f22", hat: "horn", A: "#7aa8e8", a: "#4d78bd", top: "#7aa8e8", topShade: "#4d78bd", cape: "#c0392b", capeShade: "#8e2a20", weapon: "magic", shield: "#9aa6b8", extra: ["lantern", "pauldron"] } },
  { file: "6_densetsu", name: "さとし（でんせつ）", o: { hair: "#6b3f22", hat: "crown", A: "#f2c14e", a: "#c9962a", top: "#f2c14e", topShade: "#c9962a", cape: "#2b2a6b", capeShade: "#1c1b4a", weapon: "holy", shield: "#f6f1ff", extra: ["lantern", "pauldron", "starcape"] } },
  { file: "7_muki", name: "ムキ（きんにくせんし）", o: { wide: true, hair: "#c0392b", hairStyle: "spiky", top: "#8a5a36", topShade: "#6a4224", bareArms: true, weapon: "axe", beard: false, extra: ["wrist", "bento"] } },
  { file: "8_fumi", name: "フミ（ものしり）", o: { hair: "#6a4a9a", hairStyle: "braid", glasses: true, top: "#7a5aa8", topShade: "#5a3e85", robe: true, weapon: "pen", extra: ["book", "scarf"] } },
  { file: "9_zeni", name: "ゼニ（やりくりし）", o: { hair: "#6b4a2a", hat: "brim", A: "#3f8a4a", a: "#2d6a36", top: "#9a6a3a", topShade: "#7a5028", robe: true, weapon: "abacus", extra: ["sapling"] } },
];

function svg(rows, pal) {
  // 背景：夜空（上が濃い藍、下がすみれ色）・星・ろうそく色のふち
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="320" height="320" shape-rendering="crispEdges">`;
  s += `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#141a33"/><stop offset="1" stop-color="#3a2a55"/></linearGradient></defs>`;
  s += `<rect width="32" height="32" fill="url(#sky)"/>`;
  for (const [x, y] of [[3, 3], [27, 4], [6, 9], [29, 12], [2, 17], [25, 2], [12, 1], [30, 26], [1, 27]]) s += `<rect x="${x}" y="${y}" width="1" height="1" fill="#fff6d0" opacity="0.8"/>`;
  s += `<rect x="0" y="29" width="32" height="3" fill="#24203a"/>`;
  s += `<rect x="0.25" y="0.25" width="31.5" height="31.5" fill="none" stroke="#f3a64b" stroke-width="0.5"/>`;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const c = row[x];
      let w = 1;
      while (row[x + w] === c) w++;
      if (c !== ".") s += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${pal[c]}"/>`;
      x += w;
    }
  });
  return s + "</svg>";
}

const outDir = new URL("../public/img/party/", import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const ch of CHARS) {
  const o = ch.o;
  const pal = { ...BASE, D: o.shield || "#888", H: o.hair, T: o.top, t: o.topShade, A: o.A || "#888", a: o.a || "#666", K: o.cape || "#000", k: o.capeShade || "#000" };
  const rows = person(o).map((r) => r.join(""));
  writeFileSync(new URL(`${ch.file}.svg`, outDir), svg(rows, pal));
}
writeFileSync(new URL("index.json", outDir), JSON.stringify(CHARS.map(({ file, name }) => ({ file: `${file}.svg`, name })), null, 2));
console.log(`wrote ${CHARS.length} party sprites`);
