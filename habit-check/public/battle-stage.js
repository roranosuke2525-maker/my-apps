// ぼうけん：章ボスとの戦いの舞台。まだ見ていない攻撃（タスク1件ごと・習慣は1日分を型ごと）を、仲間の攻撃として順に見せる。
// 見た攻撃は key とそのときのダメージで覚えるので、同じ攻撃は二度出ない。
// 同じ日にあとから習慣が増えたら、増えた分だけを見せる（▶ 戦いを見る で、きょうの分は見直せる）
//   battleStage({ boss, members, hero, pet, bg }) → 要素（画面に置くと自動で始まる）
// ・タスク（モンスター）は種族ごとに、得意な仲間が攻撃する（コイン→ゼニ、モジ→フミ…）
// ・習慣は型ごとに、その型の仲間が攻撃する（ちから→ムキ、かしこさ→フミ、やさしさ→ルミ、しっかり→ゼニ）
// ・その仲間がまだパーティーにいなければ、さとしが攻撃する
import { petKey } from "./aibou.js";
import { BOSS_IMAGES, CAST_VARIANTS } from "./art-index.js";
import { createActorGL } from "./theater-gl.js";

const IMG = (name) => `img/${name}.webp`;
const SEEN_KEY = "battle-seen";
const MAX_HITS = 12;
const SEEN_MAX = 400; // 覚えておく攻撃の数
const MIN_MORE = 2; // 見た攻撃の「つづき」として見せる最小のダメージ // これより多いときは、古い分を「これまでの攻撃」にまとめる
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const HERO_KEYS = { みならい: "hero_1", かけだし: "hero_2", いちにんまえ: "hero_3", ベテラン: "hero_4", たつじん: "hero_5", でんせつ: "hero_6" };
const FAMILY_ATTACKER = { ホコリ: "ムキ", ダラケ: "ムキ", ヨナキ: "ルミ", コイン: "ゼニ", モジ: "フミ", アトマワシ: "あいぼう", ザツム: "さとし", モヤモヤ: "さとし" };
const TYPE_ATTACKER = { ちから: "ムキ", かしこさ: "フミ", やさしさ: "ルミ", しっかり: "ゼニ" };
// 技：名前・動き（motion）・演出（fx）。仲間ごとに何種類かあり、攻撃のたびに選ぶ（大きなダメージは big の技）
//   motion：dash 走りこんで斬る / leap 跳びかかる / combo 走りこんで3連撃 / cast その場から飛び道具 / rain 頭上から降らせる / charge 力をためて一撃
const MOVES = {
  さとし: [
    { name: "灯りの剣", motion: "dash", fx: "slash" },
    { name: "三連斬り", motion: "combo", fx: "slash" },
    { name: "天翔ける一閃", motion: "leap", fx: "slash", big: true },
  ],
  ムキ: [
    { name: "大斧の一撃", motion: "dash", fx: "smash" },
    { name: "大地割り", motion: "leap", fx: "smash" },
    { name: "渾身の一撃", motion: "charge", fx: "smash", big: true },
  ],
  // フミ：腰をくねらせて、ウインクと投げキッスのハートで攻める
  フミ: [
    { name: "魅惑のウインク", motion: "cast", fx: "heart", orb: "#ff6fae", allure: true },
    { name: "禁断の頁", motion: "cast", fx: "pages", orb: "#c9a2ff", allure: true },
    { name: "甘い誘惑", motion: "rain", fx: "heart", big: true, allure: true },
  ],
  ゼニ: [
    { name: "そろばん連弾", motion: "combo", fx: "coins" },
    { name: "金貨投げ", motion: "cast", fx: "coins", orb: "#ffd86a" },
    { name: "黄金の雨", motion: "rain", fx: "coins", big: true },
  ],
  ルミ: [
    { name: "ともしびの炎", motion: "cast", fx: "flame", orb: "#ff9a4a" },
    { name: "灯の舞", motion: "combo", fx: "flame" },
    { name: "大かがり火", motion: "rain", fx: "flame", big: true },
  ],
  あいぼう: [
    { name: "たいあたり", motion: "dash", fx: "tackle" },
    { name: "とびかかり", motion: "leap", fx: "tackle", big: true },
  ],
};
const MUSCLE_MOVE = { name: "鍛えた肉体の一撃", motion: "charge", fx: "muscle", big: true };

function pickMove(who, big, seed) {
  const list = MOVES[who] || MOVES.さとし;
  const pool = list.filter((m) => !!m.big === big);
  const from = pool.length ? pool : list;
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return from[x % from.length];
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); } catch { return null; }
}
function writeSeen(v) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch { /* 見られなくても戦いは見せる */ }
}

// 攻撃の一覧（古い順）。log は新しい順で届く
export function attacksOf(log, members) {
  const has = (who) => who === "さとし" || who === "ルミ" || members.includes(who);
  const out = [];
  for (const x of [...log].reverse()) {
    const key = x.key || `${x.date}|${x.kind}|${x.name || ""}`;
    if (x.kind === "muscle") {
      out.push({ key, who: "さとし", damage: x.damage, what: "きたえた からだの力", date: x.date, move: MUSCLE_MOVE });
    } else if (x.kind === "task") {
      const want = FAMILY_ATTACKER[x.family] || "さとし";
      out.push({ key, who: has(want) ? want : "さとし", damage: x.damage, what: `${x.name}${"★".repeat(x.stars || 0)}を片づけた力`, date: x.date });
    } else if (x.name) {
      // 習慣ひとつ分
      const want = TYPE_ATTACKER[x.type] || "さとし";
      out.push({ key, who: has(want) ? want : "さとし", damage: x.damage, what: `「${String(x.name).replace(/^[^\p{L}\p{N}]+/u, "")}」の力`, date: x.date });
    } else {
      const types = x.types && Object.keys(x.types).length ? x.types : { ちから: x.damage };
      // 同じ人の分はまとめる
      const byWho = {};
      for (const [t, v] of Object.entries(types)) {
        const want = TYPE_ATTACKER[t] || "さとし";
        const who = has(want) ? want : "さとし";
        byWho[who] = (byWho[who] || 0) + v;
      }
      for (const [who, v] of Object.entries(byWho)) if (v > 0) out.push({ key: `${key}|${who}`, who, damage: v, what: "習慣の力", date: x.date });
    }
  }
  return out;
}

export function battleStage({ boss, members = [], hero = "", pet = null, bg = "capital" }) {
  const all = attacksOf(boss.log || [], members);
  // まだ見ていない攻撃は、舞台が画面に出たときに決める（同じ画面がすぐ作り直されても、二度は出さない）
  let seenHits = {};
  let pick = [];
  let fresh = 0;
  let startHp = Math.max(0, boss.hp - boss.damage);
  function computePick() {
    const seen = readSeen();
    const mine = seen?.id === boss.chapterId;
    // seen.hits：攻撃の key → 見たときのダメージ。前の形（合計だけ・key の一覧）からの切りかえでは、いまある攻撃を見たことにする
    seenHits = mine && seen.hits ? { ...seen.hits } : mine ? Object.fromEntries(all.map((a) => [a.key, a.damage])) : {};
    // 見た攻撃が増えるのは、その日のうちに習慣が増えたときだけ見せる（そうびなどで前の日の値が少し変わっても出し直さない）
    const today = (boss.log || [])[0]?.date;
    pick = all
      .map((a) => ({ ...a, damage: a.damage - (seenHits[a.key] || 0), more: a.key in seenHits }))
      .filter((a) => (a.more ? a.date === today && a.damage >= MIN_MORE : a.damage > 0))
      .map((a) => (a.more ? { ...a, what: `${a.what}（つづき）` } : a));
    if (pick.length > MAX_HITS) {
      const rest = pick.slice(0, pick.length - MAX_HITS + 1);
      pick = [{ who: "さとし", damage: rest.reduce((a, x) => a + x.damage, 0), what: "これまでの攻撃", combined: true }, ...pick.slice(pick.length - MAX_HITS + 1)];
    }
    fresh = Math.min(boss.damage, pick.reduce((a, x) => a + x.damage, 0));
    startHp = Math.max(0, boss.hp - (boss.damage - fresh));
  }
  const markSeen = () => {
    const hits = { ...seenHits };
    for (const a of all) hits[a.key] = Math.max(hits[a.key] || 0, a.damage);
    writeSeen({ id: boss.chapterId, hits: Object.fromEntries(Object.entries(hits).slice(-SEEN_MAX)) });
  };

  const won = !!boss.defeatedOn;

  // ---------- 舞台 ----------
  const party = ["さとし", "ルミ", ...["ムキ", "フミ", "ゼニ"].filter((m) => members.includes(m))];
  if (pet && pet.stage && pet.stage !== "たまご") party.push("あいぼう");
  const imgOf = (who) => {
    if (who === "さとし") return IMG(`cast2/${HERO_KEYS[(hero.match(/（(.+)）/) || [])[1]] || "hero_6"}`);
    if (who === "あいぼう") return IMG(`pet/${petKey(pet.stage, pet.stage === "成長期" || pet.stage === "成体" ? pet.type : null)}`);
    return IMG(`cast2/${{ ルミ: "rumi", ムキ: "muki", フミ: "fumi", ゼニ: "zeni" }[who]}`);
  };
  // RPG のように：仲間は左に斜めに並び（奥ほど上）、右のボスと向き合う。攻撃する人だけが前に出る
  const fighters = {};
  const partyEl = h("div", { class: "bs-party" }, party.map((who, i) => {
    const el = h("div", { class: `bs-fighter${who === "あいぼう" ? " small" : ""}` }, h("img", { src: imgOf(who), alt: who, draggable: "false" }));
    el.style.setProperty("--i", i);
    el.style.setProperty("--n", party.length);
    fighters[who] = el;
    return el;
  }));
  const bossImg = BOSS_IMAGES[boss.name] ? IMG(BOSS_IMAGES[boss.name]) : null;
  const bossEl = h("div", { class: `bs-boss${won ? " down" : ""}` }, bossImg ? h("img", { src: bossImg, alt: boss.name, draggable: "false" }) : null);
  const fx = h("div", { class: "bs-fx", "aria-hidden": "true" });
  const glCanvas = h("canvas", { class: "bs-gl", "aria-hidden": "true" });
  const pCanvas = h("canvas", { class: "bs-particles", "aria-hidden": "true" });
  const cam = h("div", { class: "bs-cam" },
    h("div", { class: "bs-bg", style: `background-image:url(${IMG(`bg/${bg}`)})` }), partyEl, bossEl, glCanvas, pCanvas, fx);
  const hpFill = h("span", { class: "bs-hp-fill" });
  const hpLag = h("span", { class: "bs-hp-lag" });
  const hpText = h("b", { class: "bs-hp-text" });
  const caption = h("p", { class: "bs-caption", "aria-live": "polite" });
  const skipBtn = h("button", { type: "button", class: "bs-skip", text: "とばす" });
  const replayBtn = h("button", { type: "button", class: "bs-replay", text: "▶ 戦いを見る" });
  // 下：メッセージの窓（「ムキの こうげき！」）。上：技の名前の札
  const msg = h("div", { class: "bs-msg", "aria-hidden": "true" }, h("p", {}), h("p", {}));
  const skillTag = h("div", { class: "bs-skill", "aria-hidden": "true" });
  const stage = h("div", { class: "bs-stage" }, cam, skillTag,
    h("div", { class: "bs-hp" }, h("span", { class: "bs-hp-name", text: boss.name }), h("span", { class: "bs-hp-bar" }, hpLag, hpFill), hpText));
  const root = h("div", { class: "bs" }, stage, msg, h("div", { class: "bs-foot" }, caption, skipBtn, replayBtn));

  // 立ち絵を WebGL でなめらかに（構えてその場で小さく弾む。大きさは変えない）。使えなければ <img> のまま
  let glr = null;
  if (!reduceMotion) {
    try { glr = createActorGL(glCanvas); } catch { glr = null; }
  }
  if (glr) {
    root.classList.add("gl");
    for (const [who, el] of Object.entries(fighters)) {
      glr.add(el, el.firstElementChild, { float: false, stance: true });
      glr.pose(el, { turn: 0.5, lean: 0.1 });
      // まばたき（差分の絵があれば）
      const key = (el.firstElementChild.getAttribute("src").match(/cast2\/([\w]+)\.webp$/) || [])[1];
      const has = (v) => key && CAST_VARIANTS[key]?.includes(v);
      glr.frames(el, { blink: has("blink") ? IMG(`cast2/${key}_blink`) : null, gesture: has("gesture") ? IMG(`cast2/${key}_gesture`) : null });
    }
    if (bossImg) {
      glr.add(bossEl, bossEl.firstElementChild, { boss: true, stance: true });
      glr.pose(bossEl, { turn: -0.6 });
    }
  } else glCanvas.remove();

  // ---------- カメラ・粒子・HP（1つの描画ループ） ----------
  const camS = { zoom: 1, x: 0, y: 0, shake: 0, tz: 1, tx: 0, ty: 0, pace: 6 };
  const parts = [];
  const pctx = pCanvas.getContext("2d");
  let hpShown = startHp;
  let hpLagShown = startHp;
  let hpGoal = startHp;
  let lastT = performance.now();
  let alive = true;
  const lerp = (c, g, dt, k) => c + (g - c) * (1 - Math.exp(-dt * k));
  function loop(now) {
    if (!alive) return;
    if (!root.isConnected && now - born > 5000) { alive = false; glr?.destroy(); return; }
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    // カメラ：目標へなめらかに。ゆれは減衰
    camS.zoom = lerp(camS.zoom, camS.tz, dt, camS.pace);
    camS.x = lerp(camS.x, camS.tx, dt, camS.pace);
    camS.y = lerp(camS.y, camS.ty, dt, camS.pace);
    camS.shake = Math.max(0, camS.shake - dt * 2.2);
    const sh = camS.shake * camS.shake * 14;
    const sx = (Math.random() - 0.5) * sh;
    const sy = (Math.random() - 0.5) * sh * 0.6;
    cam.style.transform = `translate(${camS.x + sx}px, ${camS.y + sy}px) scale(${camS.zoom})`;
    // HP：本体は早く、うしろの帯はゆっくり追う。数字も動く
    hpShown = lerp(hpShown, hpGoal, dt, 14);
    hpLagShown = hpLagShown > hpShown ? lerp(hpLagShown, hpShown, dt, 2.5) : hpShown;
    hpFill.style.width = `${(hpShown / boss.hp) * 100}%`;
    hpLag.style.width = `${(hpLagShown / boss.hp) * 100}%`;
    hpText.textContent = `${Math.round(hpShown).toLocaleString()} / ${boss.hp.toLocaleString()}`;
    // 粒子
    const box = pCanvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
    if (W && H && (pCanvas.width !== W || pCanvas.height !== H)) { pCanvas.width = W; pCanvas.height = H; }
    if (!W || !H) return;
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pctx.clearRect(0, 0, W, H);
    const w = W / dpr, hh = H / dpr;
    pctx.globalCompositeOperation = "lighter";
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const k = p.life / p.max;
      pctx.globalAlpha = Math.min(1, k * 1.6);
      pctx.fillStyle = p.color;
      pctx.shadowColor = p.color;
      pctx.shadowBlur = p.glow;
      pctx.save();
      pctx.translate(p.x * w, p.y * hh);
      pctx.rotate(p.rot);
      if (p.shape === "dot") { pctx.beginPath(); pctx.arc(0, 0, p.size * (0.4 + k * 0.6), 0, 6.283); pctx.fill(); }
      else if (p.shape === "heart") {
        const r = p.size;
        pctx.beginPath();
        pctx.moveTo(0, r * 0.35);
        pctx.bezierCurveTo(-r * 1.2, -r * 0.5, -r * 0.45, -r * 1.25, 0, -r * 0.45);
        pctx.bezierCurveTo(r * 0.45, -r * 1.25, r * 1.2, -r * 0.5, 0, r * 0.35);
        pctx.fill();
      }
      else if (p.shape === "streak") { pctx.fillRect(-p.size * 2, -p.size * 0.25, p.size * 4, p.size * 0.5); }
      else pctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      pctx.restore();
    }
    pctx.globalAlpha = 1;
    pctx.shadowBlur = 0;
    pctx.globalCompositeOperation = "source-over";
  }
  const born = performance.now();
  requestAnimationFrame(loop);

  // 粒子を出す（x,y は舞台の割合）
  function emit(n, { x, y, color = "#ffe9b0", speed = 0.5, spread = Math.PI * 2, dir = 0, g = 1.2, size = 4, life = 0.6, shape = "dot", glow = 8, drag = 1.5 }) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const ang = dir + (Math.random() - 0.5) * spread;
      const v = speed * (0.4 + Math.random() * 0.9);
      parts.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, g, drag, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12,
        size: size * (0.6 + Math.random() * 0.8), life: life * (0.6 + Math.random() * 0.7), max: life, color: Array.isArray(color) ? color[i % color.length] : color, shape, glow });
    }
    if (parts.length > 400) parts.splice(0, parts.length - 400);
  }
  const camTo = (z, x, y, pace = 6) => { camS.tz = z; camS.tx = x; camS.ty = y; camS.pace = pace; };
  const shake = (v) => { camS.shake = Math.max(camS.shake, v); };
  // 舞台の中の位置（割合）
  const posOf = (el) => {
    const r = el.getBoundingClientRect(), b = pCanvas.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - b.left) / b.width, y: (r.top + r.height * 0.5 - b.top) / b.height, bottom: (r.bottom - b.top) / b.height };
  };

  let hp = startHp;
  const setHp = (v, instant) => {
    hp = Math.max(0, v);
    hpGoal = hp;
    if (instant) { hpShown = hp; hpLagShown = hp; }
  };
  setHp(startHp, true);

  let speed = 1;
  let playing = false;
  let cancelled = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms / speed));

  // メッセージの窓に2行まで出す
  function say(line1, line2 = "") {
    const [a, b] = msg.children;
    a.textContent = line1;
    b.textContent = line2;
    msg.classList.toggle("on", !!(line1 || line2));
  }

  // 要素を動かす（transform は translate と rotate だけ：大きさは変えない）
  function move(el, frames, ms, easing = "cubic-bezier(.3, .7, .3, 1)") {
    const an = el.animate(frames, { duration: ms / speed, easing, fill: "forwards" });
    return an.finished.catch(() => {});
  }
  // 攻撃する人がボスの手前まで行くための横の距離（px）
  function reach(f) {
    const r = f.getBoundingClientRect(), b = bossEl.getBoundingClientRect();
    return Math.max(0, b.left + b.width * 0.18 - (r.left + r.width * 0.72));
  }

  // 命中：一瞬止まる → 閃光・火花・ダメージの数字・ゆれ
  async function impact(a, kind, dmg, { big = false, n = 0 } = {}) {
    const bp = posOf(bossEl);
    const hx = bp.x - 0.04 + (n % 2 ? 0.03 : 0), hy = bp.y - 0.05 + n * 0.05;
    const e = h("div", { class: `bs-effect fx-${kind}` });
    if (kind === "coins" || kind === "pages") for (let i = 0; i < 10; i++) {
      const p = h("i", {});
      p.style.setProperty("--d", `${i * 30}ms`);
      p.style.setProperty("--y", `${-40 + Math.random() * 80}px`);
      e.append(p);
    }
    fx.append(e);
    if (kind === "slash") emit(14, { x: hx, y: hy, color: ["#fff", "#ffe9a0"], speed: 1.1, dir: -0.6, spread: 0.9, g: 0.3, size: 6, life: 0.35, shape: "streak", glow: 10, drag: 4 });
    if (kind === "flame") emit(26, { x: hx, y: hy + 0.05, color: ["#ff5a2a", "#ffb35c", "#fff6c8"], speed: 0.35, dir: -Math.PI / 2, spread: 1.4, g: -0.5, size: 7, life: 0.7, glow: 14, drag: 1 });
    if (kind === "smash" || kind === "muscle") emit(22, { x: hx, y: hy + 0.1, color: ["#ffb35c", "#fff"], speed: 0.9, g: 1.6, size: 5, life: 0.6, glow: 10 });
    if (kind === "coins") emit(12, { x: hx, y: hy, color: ["#ffd86a", "#fff4c0"], speed: 0.6, g: 1.4, size: 5, life: 0.7, shape: "square", glow: 6 });
    if (kind === "pages") emit(12, { x: hx, y: hy, color: ["#fbf6ea", "#c9a2ff"], speed: 0.4, g: 0.3, size: 7, life: 0.8, shape: "square", glow: 8, drag: 2.5 });
    if (kind === "heart") emit(22, { x: hx, y: hy, color: ["#ff6fae", "#ffb3d6", "#fff"], speed: 0.6, g: -0.3, size: 8, life: 0.9, shape: "heart", glow: 10, drag: 1.5 });
    if (kind === "tackle" || kind === "combo") emit(18, { x: hx, y: hy, color: ["#8fe6ff", "#fff"], speed: 0.8, g: 0.8, size: 5, life: 0.6, glow: 10 });
    root.classList.add("hitstop");
    await wait(big ? 130 : 70);
    root.classList.remove("hitstop");
    const flash = h("div", { class: "bs-flash" });
    fx.append(flash);
    emit(big ? 36 : 16, { x: hx, y: hy, color: ["#fff", "#ffe066", "#ffb35c"], speed: big ? 1.3 : 0.8, g: 1.8, size: 4, life: 0.6, shape: "streak", glow: 8, drag: 2 });
    bossEl.classList.remove("hit"); void bossEl.offsetWidth; bossEl.classList.add("hit");
    glr?.flash(bossEl);
    glr?.pose(bossEl, { lean: 0.6, turn: -0.5 });
    setTimeout(() => glr?.pose(bossEl, { lean: 0, turn: -0.5 }), 300 / speed);
    // ボスは打たれた方向へ少し押しもどされる
    bossEl.animate([{ transform: "translate(0, 0) rotate(0deg)" }, { transform: `translate(${big ? 26 : 14}px, ${big ? -6 : 0}px) rotate(${big ? 4 : 2}deg)` }, { transform: "translate(0, 0) rotate(0deg)" }],
      { duration: (big ? 520 : 360) / speed, easing: "cubic-bezier(.2, .8, .3, 1)" });
    shake(big ? 1 : 0.5);
    const weak = boss.weak && (TYPE_ATTACKER[boss.weak] === a.who || boss.weak === "バランス");
    const num = h("span", { class: `bs-num${big ? " big" : ""}` },
      n === 0 && big ? h("small", { text: "かいしんの いちげき！" }) : n === 0 && weak ? h("small", { text: "こうかは ばつぐんだ！" }) : null,
      String(Math.round(dmg)));
    num.style.setProperty("--x", `${-30 + n * 26 + Math.random() * 10}px`);
    num.style.setProperty("--ny", `${n * -14}px`);
    fx.append(num);
    setHp(hp - dmg);
    setTimeout(() => { e.remove(); num.remove(); flash.remove(); }, 1000);
  }

  // 飛び道具：攻撃する人の手元からボスへ光の玉が飛ぶ
  async function shoot(f, color, ms = 380, heart = false) {
    const fp = posOf(f), bp = posOf(bossEl);
    const orb = h("i", { class: `bs-orb${heart ? " heart" : ""}` });
    orb.style.setProperty("--c", color);
    orb.style.left = `${(fp.x + 0.06) * 100}%`;
    orb.style.top = `${(fp.y - 0.08) * 100}%`;
    fx.append(orb);
    const sw = fx.getBoundingClientRect();
    const dx = (bp.x - fp.x - 0.1) * sw.width, dy = (bp.y - fp.y + 0.08) * sw.height;
    const trail = setInterval(() => {
      const r = orb.getBoundingClientRect();
      emit(2, { x: (r.left + r.width / 2 - sw.left) / sw.width, y: (r.top + r.height / 2 - sw.top) / sw.height, color, speed: 0.08, g: 0, size: heart ? 5 : 4, life: 0.35, glow: 10, shape: heart ? "heart" : "dot" });
    }, 30);
    await move(orb, [{ transform: "translate(0, 0)" }, { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px)` }, { transform: `translate(${dx}px, ${dy}px)` }], ms, "ease-in");
    clearInterval(trail);
    orb.remove();
  }

  // 1回の攻撃：前に出る → 技の名前 → 動き（技ごとにちがう）→ 命中 → もとの場所へ
  async function hit(a) {
    const f = fighters[a.who] || fighters.さとし;
    const big = a.damage >= boss.hp * 0.12;
    const mv = a.combined ? { name: "みんなの こうげき", motion: "rush", fx: "combo" } : a.move || pickMove(a.who, big, a.key || a.what);
    const who = a.who === "あいぼう" ? pet?.name || "あいぼう" : a.who;
    caption.textContent = a.combined ? "これまでの攻撃！" : `${who}の${mv.name}！`;
    caption.dataset.sub = a.combined ? "" : a.what;
    say(a.combined ? "なかまたちの こうげき！" : `${who}の ${mv.name}！`);
    skillTag.textContent = mv.name;
    skillTag.classList.remove("on"); void skillTag.offsetWidth; skillTag.classList.add("on");
    f.classList.add("active");
    const kind = mv.fx;
    const D = reach(f);
    const base = "translate(0, 0) rotate(0deg)";
    const hitLine = () => say(msg.children[0].textContent, `${boss.name}に ${Math.round(a.damage)}の ダメージ！`);

    // 一歩前に出る（RPG の「行動する人」）
    await move(f, [{ transform: base }, { transform: "translate(18px, 0)" }], 220);
    const fromStep = "translate(18px, 0)";

    if (mv.motion === "dash" || mv.motion === "combo" || mv.motion === "rush") {
      // 走りこむ（土ぼこり・残像）
      const fp0 = posOf(f);
      emit(8, { x: fp0.x, y: fp0.bottom - 0.02, color: "#d9c7a8", speed: 0.25, dir: Math.PI, spread: 1.2, g: 0.4, size: 5, life: 0.5, glow: 0, drag: 3 });
      // ふりかぶる（少し下がって沈む）
      glr?.pose(f, { lean: -0.6, turn: 0.6 });
      await move(f, [{ transform: fromStep }, { transform: "translate(4px, 6px) rotate(-8deg)" }], 140);
      glr?.pose(f, { lean: 0.9, turn: 0.9 });
      ghosts(f);
      // 走る：上下に弾みながら
      await move(f, [
        { transform: "translate(4px, 6px) rotate(-8deg)" },
        { transform: `translate(${D * 0.35}px, -10px) rotate(6deg)` },
        { transform: `translate(${D * 0.7}px, 0px) rotate(10deg)` },
        { transform: `translate(${D}px, -6px) rotate(12deg)` },
      ], 280, "cubic-bezier(.5, 0, .7, 1)");
      if (mv.motion === "dash") {
        // 斬りあげ → 斬りおろし
        await move(f, [{ transform: `translate(${D}px, -6px) rotate(12deg)` }, { transform: `translate(${D + 10}px, -22px) rotate(-14deg)` }], 110);
        await move(f, [{ transform: `translate(${D + 10}px, -22px) rotate(-14deg)` }, { transform: `translate(${D + 18}px, 4px) rotate(18deg)` }], 80, "ease-in");
        await impact(a, kind, a.damage, { big });
        hitLine();
        // はね返って着地
        await move(f, [{ transform: `translate(${D + 18}px, 4px) rotate(18deg)` }, { transform: `translate(${D - 30}px, -24px) rotate(-10deg)` }, { transform: `translate(${D - 40}px, 0) rotate(0deg)` }], 300);
      } else {
        // 3連撃：右・左・とどめは跳んで
        const parts = [0.3, 0.3, 0.4];
        let at = `translate(${D}px, -6px) rotate(12deg)`;
        const hits = [
          `translate(${D + 14}px, 0px) rotate(16deg)`,
          `translate(${D + 6}px, -14px) rotate(-16deg)`,
          `translate(${D + 20}px, 2px) rotate(22deg)`,
        ];
        for (let k = 0; k < 3; k++) {
          if (k === 2) {
            await move(f, [{ transform: at }, { transform: `translate(${D}px, -46px) rotate(-20deg)` }], 140);
            at = `translate(${D}px, -46px) rotate(-20deg)`;
          }
          await move(f, [{ transform: at }, { transform: hits[k] }], k === 2 ? 90 : 75, "ease-in");
          at = hits[k];
          await impact(a, kind, a.damage * parts[k], { big: big && k === 2, n: k });
          await wait(70);
        }
        hitLine();
        await move(f, [{ transform: at }, { transform: `translate(${D - 30}px, -20px) rotate(-8deg)` }, { transform: `translate(${D - 40}px, 0) rotate(0deg)` }], 300);
      }
      await wait(200);
      glr?.pose(f, { lean: -0.2, turn: 0.5 });
      // 戻りは軽く跳ねながら
      await move(f, [
        { transform: `translate(${D - 40}px, 0)` },
        { transform: `translate(${(D - 40) * 0.5}px, -14px)` },
        { transform: base },
      ], 380, "cubic-bezier(.3, .6, .3, 1)");
    } else if (mv.motion === "leap") {
      // 高く跳んで、ボスの上から振りおろす
      glr?.pose(f, { lean: -0.4, turn: 0.6 });
      await wait(120);
      glr?.pose(f, { lean: 0.7, turn: 0.9 });
      const H = stage.clientHeight * 0.42;
      await move(f, [{ transform: fromStep }, { transform: "translate(10px, 10px) rotate(-6deg)" }], 120);
      ghosts(f);
      await move(f, [
        { transform: "translate(10px, 10px) rotate(-6deg)", offset: 0 },
        { transform: `translate(${D * 0.3}px, ${-H * 0.85}px) rotate(-18deg)`, offset: 0.35 },
        { transform: `translate(${D * 0.6}px, ${-H}px) rotate(-28deg)`, offset: 0.6 },
        { transform: `translate(${D}px, ${-H * 0.15}px) rotate(20deg)`, offset: 1 },
      ], 560, "cubic-bezier(.3, .5, .6, 1)");
      await move(f, [{ transform: `translate(${D}px, ${-H * 0.15}px) rotate(14deg)` }, { transform: `translate(${D}px, 0) rotate(4deg)` }], 90, "ease-in");
      await impact(a, kind, a.damage, { big: true });
      hitLine();
      await wait(320);
      glr?.pose(f, { lean: -0.2, turn: 0.5 });
      await move(f, [{ transform: `translate(${D}px, 0) rotate(4deg)` }, { transform: `translate(${D * 0.5}px, ${-H * 0.25}px) rotate(-6deg)`, offset: 0.5 }, { transform: base }], 420);
    } else if (mv.motion === "charge") {
      // 力をためる（足元に光が集まる）→ 一気に突進
      f.classList.add("aura");
      glr?.pose(f, { lean: -0.5, turn: 0.6, slump: 0.3 });
      const fp0 = posOf(f);
      for (let k = 0; k < 5; k++) {
        emit(6, { x: fp0.x + (Math.random() - 0.5) * 0.1, y: fp0.bottom - 0.02, color: ["#ffe066", "#fff"], speed: 0.25, dir: -Math.PI / 2, spread: 0.6, g: -0.6, size: 4, life: 0.6, glow: 10 });
        await wait(110);
      }
      f.classList.remove("aura");
      glr?.pose(f, { lean: 0.95, turn: 0.9, slump: 0 });
      ghosts(f);
      await move(f, [{ transform: fromStep }, { transform: `translate(${D + 10}px, 0) rotate(6deg)` }], 170, "cubic-bezier(.6, 0, .8, 1)");
      await impact(a, kind, a.damage, { big: true });
      hitLine();
      await wait(360);
      glr?.pose(f, { lean: -0.2, turn: 0.5 });
      await move(f, [{ transform: `translate(${D + 10}px, 0) rotate(6deg)` }, { transform: base }], 380);
    } else {
      // cast / rain：その場から
      const fp0 = posOf(f);
      if (mv.allure) {
        // フミ：腰をくねらせて、髪をかきあげ、ウインク
        glr?.pose(f, { lean: 0.2, tilt: 0.6, turn: 0.4 });
        glr?.gesture(f, 1400);
        await move(f, [
          { transform: fromStep },
          { transform: "translate(22px, 0) rotate(-6deg)" },
          { transform: "translate(14px, 0) rotate(7deg)" },
          { transform: "translate(22px, 0) rotate(-5deg)" },
          { transform: "translate(18px, 0) rotate(3deg)" },
        ], 700, "ease-in-out");
        glr?.blink(f);
        glr?.pose(f, { lean: 0.4, tilt: -0.5, turn: 0.7 });
        emit(16, { x: fp0.x + 0.03, y: fp0.y - 0.08, color: ["#ff6fae", "#ffb3d6"], speed: 0.35, g: -0.4, size: 7, life: 0.9, shape: "heart", glow: 10, drag: 1.5 });
        await wait(260);
      } else {
        // 構える → 小さく跳んで力をこめる
        glr?.pose(f, { lean: -0.3, turn: 0.6 });
        glr?.gesture(f, 900);
        emit(14, { x: fp0.x, y: fp0.y, color: [mv.orb || "#ffe066", "#fff"], speed: 0.3, g: -0.2, size: 4, life: 0.5, glow: 12 });
        await move(f, [{ transform: fromStep }, { transform: "translate(18px, -26px) rotate(-6deg)" }, { transform: "translate(22px, 0) rotate(4deg)" }], 360, "cubic-bezier(.3, .7, .4, 1)");
      }
      glr?.pose(f, { lean: 0.5, turn: 0.8 });
      if (mv.motion === "cast") {
        // 投げる・放つ：前へ乗り出す
        move(f, [{ transform: "translate(22px, 0) rotate(4deg)" }, { transform: "translate(34px, -4px) rotate(10deg)" }, { transform: "translate(22px, 0) rotate(0deg)" }], 420);
        await shoot(f, mv.orb || "#ffe066", 380, mv.fx === "heart");
        await impact(a, kind, a.damage, { big });
      } else {
        // 頭上から降らせる（3回に分けて当たる）
        const bp = posOf(bossEl);
        for (let k = 0; k < 3; k++) {
          emit(14, { x: bp.x + (Math.random() - 0.5) * 0.2, y: 0.05, color: kind === "coins" ? ["#ffd86a", "#fff4c0"] : kind === "flame" ? ["#ff5a2a", "#ffb35c"] : kind === "heart" ? ["#ff6fae", "#ffb3d6"] : ["#fbf6ea", "#c9a2ff"], speed: 0.9, dir: Math.PI / 2, spread: 0.4, g: 2.4, size: kind === "heart" ? 9 : 6, life: 0.6, shape: kind === "coins" ? "dot" : kind === "heart" ? "heart" : "square", glow: 8, drag: 0.5 });
          await wait(160);
          await impact(a, kind, a.damage / 3, { big: k === 2, n: k });
        }
      }
      hitLine();
      await wait(380);
      glr?.pose(f, { lean: 0.1, turn: 0.5 });
      await move(f, [{ transform: "translate(22px, 0)" }, { transform: base }], 260);
    }
    f.classList.remove("active");
    f.getAnimations().forEach((x) => x.cancel());
    skillTag.classList.remove("on");
    await wait(200);
  }

  // 走るときの残像
  function ghosts(f) {
    for (let k = 1; k <= 3; k++) {
      setTimeout(() => {
        const ghost = f.cloneNode(true);
        ghost.classList.add("ghost");
        ghost.getAnimations?.().forEach((x) => x.cancel());
        ghost.style.transform = getComputedStyle(f).transform;
        partyEl.append(ghost);
        ghost.animate([{ opacity: 0.45 }, { opacity: 0 }], { duration: 360, fill: "forwards" });
        setTimeout(() => ghost.remove(), 380);
      }, k * 60 / speed);
    }
  }

  async function play(list, from) {
    if (playing) return;
    playing = true;
    cancelled = false;
    speed = 1;
    root.classList.add("playing");
    bossEl.classList.remove("down");
    glr?.pose(bossEl, { slump: 0 });
    setHp(from, true);
    camTo(1, 0, 0, 2);
    say(`${boss.name}が たちはだかる！`);
    await wait(900);
    for (const a of list) {
      if (cancelled) break;
      await hit(a);
    }
    finishView(list);
  }

  function finishView(list) {
    const end = Math.max(0, boss.hp - boss.damage);
    setHp(end, cancelled);
    root.classList.remove("playing");
    playing = false;
    camTo(1, 0, 0, 3);
    if (won) {
      bossEl.classList.add("down");
      glr?.pose(bossEl, { slump: 1, lean: 0.8 });
      const bp = posOf(bossEl);
      emit(60, { x: bp.x, y: bp.y, color: ["#ffe066", "#fff", "#ffb35c"], speed: 0.9, g: 0.6, size: 5, life: 1.4, glow: 12, drag: 1.2 });
      shake(0.8);
      const banner = h("div", { class: "bs-win", text: "撃破！" });
      say(`${boss.name}を やっつけた！`);
      fx.append(banner);
      caption.textContent = `${boss.name}を たおした！`;
    } else {
      const total = list.reduce((a, x) => a + x.damage, 0);
      say(list.length ? `${boss.name}に あわせて ${Math.round(list.reduce((a, x) => a + x.damage, 0))}の ダメージ！` : "", list.length ? `のこりHP ${Math.round(end)}` : "");
      caption.textContent = list.length ? `合計 ${Math.round(total)} ダメージ！ のこり ${Math.round(end)}` : `のこりHP ${Math.round(end)}。習慣やタスクで仲間が攻撃します`;
    }
    markSeen();
  }

  skipBtn.addEventListener("click", () => { cancelled = true; speed = 8; });
  replayBtn.addEventListener("click", () => {
    // きょうの分（なければ最近の分）をもう一度
    const today = (boss.log || [])[0]?.date;
    const list = attacksOf((boss.log || []).filter((x) => x.date === today), members);
    const total = list.reduce((a, x) => a + x.damage, 0);
    root.querySelector(".bs-win")?.remove();
    play(list, Math.min(boss.hp, Math.max(0, boss.hp - boss.damage) + total));
  });

  // 画面に出たら始める
  let tries = 0;
  const start = () => {
    if (!root.isConnected) return ++tries < 300 && requestAnimationFrame(start);
    computePick();
    if (pick.length && !reduceMotion) {
      markSeen(); // 途中で画面を離れても、同じ攻撃はもう出さない
      play(pick, startHp);
    }
    else finishView([]);
  };
  requestAnimationFrame(start);
  return root;
}
