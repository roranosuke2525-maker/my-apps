// あいぼうのドット絵（32×32）を、丸・四角・多角形の組み合わせからピクセル配列にして
// public/aibou-sprites.js に書き出す。絵を直すときはここを変えて `node scripts/make-aibou-sprites.mjs`。
// 書き出した配列は文字1つ＝1ピクセル（. は透明）。色は各キャラの palette で決まる。
import { writeFileSync } from "node:fs";

const N = 32;

function canvas() {
  return Array.from({ length: N }, () => Array(N).fill("."));
}

// 図形：in(x, y) でそのピクセルの中心が図形の中か
const ellipse = (cx, cy, rx, ry) => (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
const circle = (cx, cy, r) => ellipse(cx, cy, r, r);
const rect = (x0, y0, w, h) => (x, y) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
const poly = (pts) => (x, y) => {
  const px = x + 0.5, py = y + 0.5;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const and = (a, b) => (x, y) => a(x, y) && b(x, y);
const or = (...fs) => (x, y) => fs.some((f) => f(x, y));
const not = (a) => (x, y) => !a(x, y);

// 塗る。opts.edge で図形のふちを o（輪郭）にする／opts.shade で右下を s・左上に l のつや
function fill(g, inside, ch, opts = {}) {
  const pts = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inside(x, y)) pts.push([x, y]);
  const set = new Set(pts.map(([x, y]) => y * N + x));
  const has = (x, y) => x >= 0 && y >= 0 && x < N && y < N && set.has(y * N + x);
  let minX = N, maxX = 0, minY = N, maxY = 0;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = (maxX - minX) / 2 + 0.5, ry = (maxY - minY) / 2 + 0.5;
  for (const [x, y] of pts) {
    let c = ch;
    if (opts.shade) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (nx * 0.45 + ny * 0.85 > 0.42) c = opts.shade;
      else if (opts.light && (nx + 0.4) ** 2 + (ny + 0.52) ** 2 < 0.03) c = opts.light;
    }
    if (opts.edge && (!has(x - 1, y) || !has(x + 1, y) || !has(x, y - 1) || !has(x, y + 1))) c = "o";
    g[y][x] = c;
  }
}

function px(g, list, ch) {
  for (const [x, y] of list) if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = ch;
}

function line(g, x0, y0, x1, y1, ch) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(g, [[x0, y0]], ch);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// 外側の輪郭：透明のピクセルで、上下左右に色があれば o
function outline(g, skip = "") {
  const out = g.map((r) => r.slice());
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y][x] !== ".") continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const c = g[y + dy]?.[x + dx];
      return c && c !== "." && c !== "o" && !skip.includes(c);
    });
    if (near) out[y][x] = "o";
  }
  return out;
}

// 目：開いた目（e と光 w）と、まばたきで閉じた目（横線）
function eyes(g, list, { w = 2, h = 3, closed = false } = {}) {
  for (const [x, y] of list) {
    if (closed) { px(g, Array.from({ length: w + 1 }, (_, i) => [x + i - (w > 1 ? 0 : 0), y + h - 1]), "o"); continue; }
    fill(g, rect(x, y, w, h), "e");
    px(g, [[x, y]], "w");
  }
}

const rows = (g) => g.map((r) => r.join(""));

// ---------- キャラごとの絵 ----------
// draw(g, { blink }) で1コマ描く。キャラは足元を y=29 あたりにそろえる
const PETS = {
  egg: {
    name: "たまご",
    palette: { o: "#27495c", b: "#bdeef7", s: "#86cfe0", l: "#ffffff", a: "#3aa6c8", g: "#7ff3ff" },
    draw(g, { crack = 0 }) {
      // 下がふくらんだ たまご形（上は細め）
      fill(g, or(ellipse(16, 20, 10, 9.5), ellipse(16, 15, 7.5, 10.5)), "b", { shade: "s", light: "l" });
      // 回路の模様（光る線と点）
      line(g, 9, 15, 13, 15, "a"); line(g, 13, 15, 15, 13, "a"); line(g, 15, 13, 19, 13, "a"); px(g, [[19, 13], [20, 13]], "g");
      line(g, 8, 21, 12, 21, "a"); line(g, 12, 21, 14, 23, "a"); line(g, 14, 23, 20, 23, "a"); line(g, 20, 23, 22, 21, "a"); px(g, [[23, 21], [22, 20]], "g");
      line(g, 17, 18, 21, 18, "a"); px(g, [[17, 18], [16, 18]], "g");
      px(g, [[11, 9], [12, 9], [12, 8]], "a"); px(g, [[13, 8]], "g");
      if (crack >= 1) { line(g, 10, 12, 12, 10, "o"); line(g, 12, 10, 14, 12, "o"); line(g, 14, 12, 16, 9, "o"); }
      if (crack >= 2) { line(g, 16, 9, 18, 12, "o"); line(g, 18, 12, 21, 10, "o"); line(g, 21, 10, 22, 13, "o"); }
      return outline(g);
    },
  },
  baby: {
    name: "プチモ",
    palette: { o: "#1f4a3a", b: "#a8f0cf", s: "#6ccfa2", l: "#f4fff9", e: "#1f2d2a", w: "#ffffff", k: "#ff9fb3", a: "#ffcf5a" },
    draw(g, { blink }) {
      fill(g, and(ellipse(16, 21.5, 11.5, 9), rect(0, 0, 32, 29)), "b", { shade: "s", light: "l" });
      line(g, 12, 13, 10, 8, "o"); line(g, 20, 13, 22, 8, "o");
      fill(g, circle(9.5, 6.5, 2), "a"); fill(g, circle(22.5, 6.5, 2), "a");
      eyes(g, [[11, 19], [19, 19]], { closed: blink });
      px(g, [[8, 23], [9, 23], [22, 23], [23, 23]], "k");
      px(g, [[15, 23], [16, 23]], "o"); px(g, [[14, 22], [17, 22]], "o");
      return outline(g);
    },
  },
  child_power: {
    name: "ガルボ",
    palette: { o: "#5a2a12", b: "#ffa552", s: "#e07b2a", l: "#ffe3c2", c: "#fff1d0", a: "#ffd447", e: "#2b1a10", w: "#ffffff", k: "#ff8f8f" },
    draw(g, { blink }) {
      fill(g, poly([[22, 20], [30, 25], [29, 27], [21, 27]]), "b", { edge: true }); // しっぽ
      for (const [x, y] of [[16, 13], [20, 15], [23, 19]]) fill(g, poly([[x - 2, y + 2], [x + 1, y - 2], [x + 2, y + 2]]), "a", { edge: true }); // 背中のとげ
      fill(g, ellipse(16, 21.5, 9, 7.5), "b", { shade: "s", edge: true });
      fill(g, ellipse(14, 23, 5, 4.5), "c");
      fill(g, ellipse(12.5, 12.5, 8.5, 7), "b", { shade: "s", light: "l", edge: true });
      fill(g, rect(9, 27, 4, 3), "s", { edge: true }); fill(g, rect(17, 27, 4, 3), "s", { edge: true });
      eyes(g, [[8, 10], [14, 10]], { closed: blink });
      px(g, [[6, 15], [7, 15]], "k");
      px(g, [[10, 16], [11, 16], [12, 16], [13, 16]], "o"); px(g, [[11, 17]], "w");
      return outline(g);
    },
  },
  child_wisdom: {
    name: "ルミネ",
    palette: { o: "#173a5e", b: "#8fd0ff", s: "#5aa8e6", l: "#e9f7ff", c: "#eef8ff", a: "#ffe066", g: "#fffbd0", e: "#14223a", w: "#ffffff", k: "#ffb3c7" },
    draw(g, { blink }) {
      // 光る尾（右に巻いて先が光る）
      fill(g, poly([[20, 24], [26, 22], [29, 16], [27, 14], [25, 19], [20, 21]]), "b", { shade: "s", edge: true });
      fill(g, circle(27.5, 13.5, 2.5), "a"); px(g, [[27, 13]], "g");
      fill(g, poly([[7, 9], [9, 2], [13, 7]]), "b", { edge: true }); fill(g, poly([[19, 7], [23, 2], [25, 9]]), "b", { edge: true }); // きつねの耳
      px(g, [[9, 6], [10, 6], [22, 6], [23, 6]], "k");
      fill(g, ellipse(16, 16.5, 10, 12), "b", { shade: "s", light: "l", edge: true });
      fill(g, ellipse(16, 22, 6, 5.5), "c"); // おなか
      // ふくろうの大きな目
      for (const cx of [11.5, 20.5]) fill(g, circle(cx, 13.5, 3.5), "c", { edge: true });
      if (blink) { line(g, 9, 14, 13, 14, "o"); line(g, 18, 14, 22, 14, "o"); }
      else { fill(g, rect(10, 12, 3, 3), "e"); fill(g, rect(19, 12, 3, 3), "e"); px(g, [[10, 12], [19, 12]], "w"); }
      px(g, [[15, 17], [16, 17], [15, 18]], "a"); // くちばし
      px(g, [[12, 23], [14, 24], [17, 24], [19, 23]], "s");
      fill(g, rect(11, 28, 3, 2), "a", { edge: true }); fill(g, rect(18, 28, 3, 2), "a", { edge: true });
      return outline(g);
    },
  },
  child_kind: {
    name: "モフラ",
    palette: { o: "#6a4a3a", b: "#fff6e3", s: "#f0dcc0", l: "#ffffff", c: "#ffc9d6", f: "#ffe8ec", a: "#7fd36b", d: "#4fa84a", e: "#3a2a24", w: "#ffffff", k: "#ff9fb3" },
    draw(g, { blink }) {
      fill(g, ellipse(8, 9, 2.5, 6.5), "b", { edge: true }); fill(g, ellipse(24, 9, 2.5, 6.5), "b", { edge: true }); // うさぎの耳
      fill(g, ellipse(8, 10, 1, 4), "c"); fill(g, ellipse(24, 10, 1, 4), "c");
      // もこもこの体（丸をいくつも重ねる）
      const puffs = [[9, 18, 4.5], [16, 15, 5], [23, 18, 4.5], [8, 24, 4.5], [24, 24, 4.5], [12, 27, 3.5], [20, 27, 3.5], [16, 22, 8]];
      for (const [x, y, r] of puffs) fill(g, circle(x, y, r), "b", { edge: true });
      for (const [x, y, r] of puffs) fill(g, circle(x, y, r - 1), "b", { shade: "s" });
      fill(g, ellipse(16, 20.5, 6, 5), "f", { edge: true }); // 顔
      eyes(g, [[12, 19], [18, 19]], { w: 2, h: 2, closed: blink });
      px(g, [[15, 22], [16, 22]], "o"); px(g, [[11, 22], [12, 22], [19, 22], [20, 22]], "k");
      // 頭の若葉
      line(g, 16, 10, 16, 8, "d"); fill(g, ellipse(13.5, 7, 2.5, 1.5), "a", { edge: true }); fill(g, ellipse(18.5, 7, 2.5, 1.5), "a", { edge: true });
      return outline(g);
    },
  },
  child_steady: {
    name: "カチコ",
    palette: { o: "#2c3a36", b: "#9fb3aa", s: "#7a8f86", l: "#d9e6e0", c: "#f6f1df", a: "#e0b04a", e: "#1c2624", w: "#ffffff", k: "#ff9fb3", g: "#7ff0c0" },
    draw(g, { blink }) {
      fill(g, ellipse(7.5, 19, 6.5, 6), "b", { shade: "s", light: "l", edge: true }); // 頭
      fill(g, and(ellipse(19, 22, 11.5, 10), rect(0, 0, 32, 26)), "b", { shade: "s", light: "l", edge: true }); // 甲羅
      for (const x of [12, 18, 24]) line(g, x, 14, x, 25, "s");
      fill(g, circle(18, 19, 4.5), "c", { edge: true }); // 時計
      line(g, 18, 19, 18, 16, "o"); line(g, 18, 19, 20, 19, "o"); px(g, [[18, 15]], "a");
      fill(g, rect(6, 25, 24, 2), "s", { edge: true });
      for (const x of [9, 15, 22, 26]) fill(g, rect(x, 26, 3, 3), "s", { edge: true });
      eyes(g, [[4, 17]], { closed: blink }); px(g, [[3, 21], [4, 21]], "k"); px(g, [[2, 22]], "o");
      px(g, [[27, 13], [28, 12]], "g"); // アンテナの光
      return outline(g);
    },
  },
  adult_power: {
    name: "ドラガイア",
    palette: { o: "#4a1a10", b: "#ff6a3d", s: "#d24a26", l: "#ffc2a8", c: "#ffe2b0", a: "#c9ced6", d: "#8a93a3", y: "#ffd447", e: "#2b120c", w: "#ffffff" },
    draw(g, { blink }) {
      fill(g, poly([[2, 6], [10, 12], [9, 17], [3, 13]]), "s", { edge: true }); fill(g, poly([[30, 6], [22, 12], [23, 17], [29, 13]]), "s", { edge: true }); // つばさ
      fill(g, poly([[21, 24], [30, 28], [29, 30], [20, 28]]), "b", { edge: true }); // しっぽ
      fill(g, ellipse(16, 21, 7.5, 8), "b", { shade: "s", edge: true });
      fill(g, ellipse(16, 21, 5, 6.5), "a", { shade: "d", edge: true }); // 胸の鎧
      px(g, [[16, 19], [15, 20], [16, 20], [17, 20], [16, 21]], "y");
      fill(g, ellipse(16, 9.5, 6.5, 5.5), "b", { shade: "s", light: "l", edge: true }); // 頭
      fill(g, poly([[10, 6], [8, 1], [12, 5]]), "y", { edge: true }); fill(g, poly([[22, 6], [24, 1], [20, 5]]), "y", { edge: true }); // つの
      fill(g, ellipse(16, 12, 3.5, 2), "c");
      eyes(g, [[12, 8], [18, 8]], { w: 2, h: 2, closed: blink });
      fill(g, rect(9, 15, 4, 3), "a", { edge: true }); fill(g, rect(19, 15, 4, 3), "a", { edge: true }); // 肩当て
      fill(g, rect(11, 27, 4, 3), "s", { edge: true }); fill(g, rect(17, 27, 4, 3), "s", { edge: true });
      return outline(g);
    },
  },
  adult_wisdom: {
    name: "アストラ",
    palette: { o: "#1c1f4a", b: "#4a56b8", s: "#343e8e", l: "#9fa9f0", c: "#e8ebff", a: "#ffd75e", g: "#fff7c4", e: "#12142e", w: "#ffffff", k: "#ff9fc0" },
    draw(g, { blink }) {
      // 星座の翼（左右）
      fill(g, poly([[11, 14], [1, 6], [2, 16], [6, 22], [11, 21]]), "s", { edge: true });
      fill(g, poly([[21, 14], [31, 6], [30, 16], [26, 22], [21, 21]]), "s", { edge: true });
      for (const [x, y] of [[3, 9], [5, 13], [4, 17], [8, 18], [29, 9], [27, 13], [28, 17], [24, 18]]) px(g, [[x, y]], "a");
      line(g, 3, 9, 5, 13, "l"); line(g, 5, 13, 8, 18, "l"); line(g, 29, 9, 27, 13, "l"); line(g, 27, 13, 24, 18, "l");
      fill(g, poly([[21, 25], [29, 22], [30, 27], [22, 29]]), "c", { edge: true }); // しっぽ（先が白い）
      fill(g, poly([[21, 25], [26, 23], [26, 28], [22, 29]]), "b");
      fill(g, ellipse(16, 21.5, 6.5, 8), "b", { shade: "s", edge: true });
      fill(g, ellipse(16, 23, 3.5, 5), "c");
      fill(g, poly([[9, 8], [10, 1], [14, 6]]), "b", { edge: true }); fill(g, poly([[18, 6], [22, 1], [23, 8]]), "b", { edge: true }); // 耳
      fill(g, ellipse(16, 10.5, 7, 5.5), "b", { shade: "s", light: "l", edge: true });
      fill(g, ellipse(16, 13, 3.5, 2.2), "c");
      eyes(g, [[12, 9], [18, 9]], { w: 2, h: 2, closed: blink });
      px(g, [[16, 5], [15, 6], [16, 6], [17, 6], [16, 7]], "a"); // 額の星
      px(g, [[15, 13], [16, 13]], "o"); px(g, [[10, 12], [22, 12]], "k");
      fill(g, rect(12, 28, 3, 2), "s", { edge: true }); fill(g, rect(17, 28, 3, 2), "s", { edge: true });
      return outline(g);
    },
  },
  adult_kind: {
    name: "フローラム",
    palette: { o: "#3e3a24", b: "#bfe89a", s: "#92c96c", l: "#f2ffe4", c: "#fff4e0", a: "#ff8fb8", d: "#ffd1e2", y: "#ffe066", e: "#2d2a1c", w: "#ffffff", k: "#ff9fb3" },
    draw(g, { blink }) {
      // 背中の花（大きな花びら＋小さな花）
      for (const [x, y] of [[16, 3], [11, 6], [21, 6], [13, 9], [19, 9]]) fill(g, circle(x, y, 3), "a", { edge: true });
      fill(g, circle(16, 6.5, 2.5), "y", { edge: true });
      fill(g, circle(6, 12, 2), "d", { edge: true }); fill(g, circle(26, 12, 2), "d", { edge: true });
      fill(g, ellipse(16, 20, 11, 9.5), "b", { shade: "s", light: "l", edge: true });
      fill(g, ellipse(16, 22.5, 6.5, 5), "c");
      fill(g, poly([[5, 15], [2, 10], [8, 13]]), "b", { edge: true }); fill(g, poly([[27, 15], [30, 10], [24, 13]]), "b", { edge: true }); // 葉っぱの耳
      eyes(g, [[11, 17], [19, 17]], { closed: blink });
      px(g, [[8, 20], [9, 20], [22, 20], [23, 20]], "k");
      px(g, [[15, 21], [16, 21]], "o"); px(g, [[14, 20], [17, 20]], "o");
      for (const x of [8, 13, 18, 23]) fill(g, rect(x, 27, 3, 3), "s", { edge: true });
      return outline(g);
    },
  },
  adult_steady: {
    name: "ギアノクス",
    palette: { o: "#232a33", b: "#aeb8c4", s: "#7d8896", l: "#eef3f8", c: "#d9b45a", d: "#a8842f", a: "#5ad1ff", e: "#141a22", w: "#ffffff" },
    draw(g, { blink }) {
      fill(g, poly([[20, 24], [29, 26], [28, 29], [20, 28]]), "s", { edge: true }); // しっぽ
      fill(g, ellipse(17, 21, 7.5, 8), "b", { shade: "s", edge: true });
      fill(g, ellipse(17, 10, 6.5, 6), "b", { shade: "s", light: "l", edge: true }); // かぶと
      fill(g, poly([[11, 7], [9, 1], [14, 5]]), "s", { edge: true }); fill(g, poly([[23, 7], [25, 1], [20, 5]]), "s", { edge: true });
      fill(g, rect(12, 9, 10, 3), "e"); // かぶとのすき間
      if (blink) line(g, 13, 10, 21, 10, "s"); else px(g, [[14, 10], [15, 10], [19, 10], [20, 10]], "a");
      // 歯車の盾（左手）
      const gear = (x, y) => circle(10, 20, 6.5)(x, y) || (circle(10, 20, 8)(x, y) && ((x + y) % 3 === 0 || Math.abs(x - 9.5) < 1.2 || Math.abs(y - 19.5) < 1.2));
      fill(g, gear, "c", { shade: "d", edge: true });
      fill(g, circle(10, 20, 2.5), "d", { edge: true }); px(g, [[9, 19], [10, 19], [9, 20], [10, 20]], "c");
      fill(g, rect(13, 27, 4, 3), "s", { edge: true }); fill(g, rect(19, 27, 4, 3), "s", { edge: true });
      return outline(g);
    },
  },
  adult_balance: {
    name: "アウロラ",
    palette: { o: "#4a4060", b: "#fbf7ff", s: "#ddd3ee", l: "#ffffff", c: "#ffe9a8", r: "#ff7a5c", u: "#5aa8ff", p: "#ff9fd0", g: "#6fdc8c", e: "#2a2440", w: "#ffffff", k: "#ffb3d0" },
    draw(g, { blink }) {
      // 4属性の玉（ちから・かしこさ・やさしさ・しっかり）
      fill(g, circle(4, 9, 3), "r", { edge: true }); fill(g, circle(28, 9, 3), "u", { edge: true });
      fill(g, circle(3.5, 21, 3), "p", { edge: true }); fill(g, circle(28.5, 21, 3), "g", { edge: true });
      fill(g, poly([[22, 22], [30, 27], [28, 30], [21, 27]]), "b", { shade: "s", edge: true }); // しっぽ
      fill(g, ellipse(16, 21, 8, 8), "b", { shade: "s", edge: true });
      fill(g, ellipse(16, 22.5, 4.5, 5), "c");
      fill(g, poly([[10, 8], [9, 1], [14, 5]]), "b", { edge: true }); fill(g, poly([[22, 8], [23, 1], [18, 5]]), "b", { edge: true });
      fill(g, ellipse(16, 10.5, 7, 6), "b", { shade: "s", light: "l", edge: true });
      fill(g, poly([[16, 1], [14, 5], [18, 5]]), "c", { edge: true }); // 額の角
      eyes(g, [[12, 9], [18, 9]], { w: 2, h: 3, closed: blink });
      px(g, [[10, 13], [22, 13]], "k"); px(g, [[15, 14], [16, 14]], "o");
      fill(g, rect(11, 27, 4, 3), "s", { edge: true }); fill(g, rect(17, 27, 4, 3), "s", { edge: true });
      return outline(g);
    },
  },
};

// ---------- モンスター（ぼうけん）：b/s/l は種族の色で置き換える ----------
const MON_PALETTE = { o: "#2a2230", b: "#9aa0a6", s: "#6f757b", l: "#d7dadd", e: "#1d1820", w: "#ffffff", r: "#d2463c", y: "#ffd447", k: "#c9c3b6" };
const MONSTERS = {
  mon_slime: {
    name: "スライム",
    draw(g, { blink }) {
      fill(g, and(or(ellipse(16, 23, 11, 8), ellipse(16, 17, 6, 7)), rect(0, 0, 32, 30)), "b", { shade: "s", light: "l" });
      px(g, [[16, 9], [16, 10]], "b");
      if (blink) { line(g, 11, 21, 13, 21, "o"); line(g, 19, 21, 21, 21, "o"); }
      else { fill(g, rect(11, 19, 2, 3), "e"); fill(g, rect(19, 19, 2, 3), "e"); px(g, [[11, 19], [19, 19]], "w"); }
      line(g, 10, 18, 13, 19, "o"); line(g, 22, 18, 19, 19, "o"); // つり目
      px(g, [[14, 25], [15, 24], [16, 24], [17, 25]], "o");
      return outline(g);
    },
  },
  mon_goblin: {
    name: "ゴブリン",
    draw(g, { blink }) {
      fill(g, rect(22, 12, 3, 14), "k", { edge: true }); fill(g, ellipse(23.5, 11, 3, 3.5), "k", { edge: true }); // こん棒
      fill(g, ellipse(15, 23, 7, 6), "s", { edge: true });
      fill(g, poly([[5, 9], [1, 6], [8, 13]]), "b", { edge: true }); fill(g, poly([[25, 9], [29, 6], [22, 13]]), "b", { edge: true }); // とがった耳
      fill(g, ellipse(15, 13, 8, 7), "b", { shade: "s", light: "l", edge: true });
      if (blink) { line(g, 10, 13, 12, 13, "o"); line(g, 17, 13, 19, 13, "o"); }
      else { fill(g, rect(10, 11, 3, 3), "y"); fill(g, rect(17, 11, 3, 3), "y"); px(g, [[11, 12], [18, 12]], "e"); }
      line(g, 11, 17, 18, 17, "o"); px(g, [[12, 18], [17, 18]], "w"); // きば
      fill(g, rect(10, 28, 3, 2), "s", { edge: true }); fill(g, rect(17, 28, 3, 2), "s", { edge: true });
      return outline(g);
    },
  },
  mon_golem: {
    name: "ゴーレム",
    draw(g, { blink }) {
      fill(g, rect(3, 13, 6, 12), "s", { edge: true }); fill(g, rect(23, 13, 6, 12), "s", { edge: true }); // うで
      fill(g, rect(8, 11, 16, 15), "b", { shade: "s", light: "l", edge: true });
      fill(g, rect(11, 3, 10, 9), "b", { shade: "s", edge: true }); // あたま
      if (blink) line(g, 13, 7, 18, 7, "o"); else { fill(g, rect(13, 6, 2, 2), "r"); fill(g, rect(17, 6, 2, 2), "r"); }
      for (const [x, y] of [[11, 15], [18, 19], [14, 22], [20, 14]]) px(g, [[x, y], [x + 1, y]], "s");
      fill(g, rect(9, 26, 5, 4), "s", { edge: true }); fill(g, rect(18, 26, 5, 4), "s", { edge: true });
      return outline(g);
    },
  },
  mon_dragon: {
    name: "ドラゴン",
    draw(g, opts) {
      drawDragon(g, opts);
      return outline(g);
    },
  },
  mon_boss: {
    name: "ボス",
    draw(g, opts) {
      drawDragon(g, opts);
      fill(g, poly([[9, 4], [10, 0], [12, 3], [14, 0], [16, 3], [18, 0], [19, 4]]), "y", { edge: true }); // かんむり
      px(g, [[14, 2]], "r");
      return outline(g);
    },
  },
};

function drawDragon(g, { blink }) {
  fill(g, poly([[18, 12], [31, 4], [29, 16], [22, 19]]), "s", { edge: true }); // つばさ
  fill(g, poly([[20, 22], [31, 26], [30, 29], [19, 27]]), "b", { edge: true }); // しっぽ
  fill(g, ellipse(16, 21, 8, 7.5), "b", { shade: "s", edge: true });
  fill(g, ellipse(15, 22.5, 4.5, 4.5), "l");
  fill(g, ellipse(12, 10.5, 7.5, 5.5), "b", { shade: "s", light: "l", edge: true }); // あたま
  fill(g, poly([[8, 6], [6, 1], [10, 5]]), "y", { edge: true }); fill(g, poly([[15, 6], [17, 1], [13, 5]]), "y", { edge: true });
  if (blink) line(g, 8, 10, 10, 10, "o"); else { fill(g, rect(8, 9, 2, 2), "y"); px(g, [[9, 10]], "e"); }
  line(g, 5, 13, 11, 13, "o"); px(g, [[6, 14], [9, 14]], "w"); px(g, [[4, 11], [4, 12]], "r"); // 口とほのお
  fill(g, rect(10, 27, 4, 3), "s", { edge: true }); fill(g, rect(17, 27, 4, 3), "s", { edge: true });
}

// ---------- そうび（アイテムのアイコン）：b/s/l はレア度の色で置き換える ----------
const ITEM_PALETTE = { o: "#2a2230", b: "#c9c3b6", s: "#8f887c", l: "#f4f0e8", y: "#ffd447", r: "#e0503c", w: "#ffffff", k: "#8a5a36" };
const ITEMS = {
  item_weapon: (g) => {
    fill(g, poly([[22, 3], [28, 3], [28, 9], [12, 25], [8, 21]]), "b", { shade: "s", light: "l", edge: true }); // 刃
    line(g, 25, 6, 11, 20, "l");
    fill(g, poly([[5, 18], [9, 16], [16, 23], [14, 27]]), "y", { edge: true }); // つば
    fill(g, poly([[7, 23], [9, 25], [5, 29], [3, 27]]), "k", { edge: true }); // 柄
    fill(g, circle(3.5, 28.5, 1.8), "y", { edge: true });
    return outline(g);
  },
  item_helm: (g) => {
    fill(g, and(ellipse(16, 18, 11, 11), rect(0, 0, 32, 23)), "b", { shade: "s", light: "l", edge: true });
    fill(g, rect(5, 21, 22, 4), "s", { edge: true });
    fill(g, rect(15, 7, 2, 14), "y", { edge: true }); // 飾り
    fill(g, poly([[16, 2], [12, 8], [20, 8]]), "r", { edge: true });
    fill(g, rect(10, 16, 4, 3), "o"); fill(g, rect(18, 16, 4, 3), "o");
    return outline(g);
  },
  item_shield: (g) => {
    fill(g, poly([[5, 4], [27, 4], [27, 16], [16, 29], [5, 16]]), "b", { shade: "s", light: "l", edge: true });
    fill(g, poly([[9, 8], [23, 8], [23, 15], [16, 24], [9, 15]]), "s", { edge: true });
    fill(g, circle(16, 14, 3.5), "y", { edge: true }); px(g, [[15, 13]], "w");
    return outline(g);
  },
  item_armor: (g) => {
    fill(g, poly([[6, 6], [12, 4], [16, 7], [20, 4], [26, 6], [29, 13], [24, 14], [24, 28], [8, 28], [8, 14], [3, 13]]), "b", { shade: "s", light: "l", edge: true });
    line(g, 16, 8, 16, 27, "s");
    fill(g, rect(9, 20, 14, 2), "y", { edge: true });
    fill(g, circle(16, 14, 2.5), "r", { edge: true });
    return outline(g);
  },
  item_ring: (g) => {
    fill(g, and(circle(16, 19, 10), not(circle(16, 19, 6.5))), "y", { shade: "k", edge: true });
    fill(g, poly([[16, 3], [22, 9], [16, 14], [10, 9]]), "b", { shade: "s", light: "l", edge: true }); // 宝石
    px(g, [[14, 7], [15, 6]], "w");
    return outline(g);
  },
};

const out = {};
for (const [key, draw] of Object.entries(ITEMS)) {
  const f = rows(draw(canvas()));
  out[key] = { name: key, palette: ITEM_PALETTE, frames: { idle: f, blink: f } };
}
for (const [key, mon] of Object.entries(MONSTERS)) {
  const frame = (opts) => rows(mon.draw(canvas(), opts));
  out[key] = { name: mon.name, palette: MON_PALETTE, frames: { idle: frame({}), blink: frame({ blink: true }) } };
}
for (const [key, pet] of Object.entries(PETS)) {
  const frame = (opts) => rows(pet.draw(canvas(), opts));
  out[key] = {
    name: pet.name,
    palette: pet.palette,
    frames: key === "egg"
      ? { idle: frame({}), crack1: frame({ crack: 1 }), crack2: frame({ crack: 2 }) }
      : { idle: frame({}), blink: frame({ blink: true }) },
  };
}

const target = new URL("../public/aibou-sprites.js", import.meta.url);
writeFileSync(target, `// あいぼうとモンスターのドット絵（32×32）。scripts/make-aibou-sprites.mjs が作る（手で直してもよい）
// 1文字＝1ピクセル。. は透明、それ以外は palette の色
export const SPRITES = ${JSON.stringify(out, null, 1).replace(/\n\s*/g, (m) => (m.length > 3 ? "\n  " : "\n"))};
`);
console.log(`wrote ${Object.keys(out).length} sprites`);
