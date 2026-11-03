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
// 技の名前と演出（CSS の .fx-<kind>）
const MOVES = {
  さとし: { name: "灯りの剣", fx: "slash" },
  ムキ: { name: "大斧の一撃", fx: "smash" },
  フミ: { name: "記録の頁", fx: "pages" },
  ゼニ: { name: "そろばん連弾", fx: "coins" },
  ルミ: { name: "ともしびの炎", fx: "flame" },
  あいぼう: { name: "たいあたり", fx: "tackle" },
};

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
      out.push({ key, who: "さとし", damage: x.damage, what: "きたえた からだの力", date: x.date, move: { name: "鍛えた肉体の一撃", fx: "muscle" } });
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
  const seen = readSeen();
  const mine = seen?.id === boss.chapterId;
  // seen.hits：攻撃の key → 見たときのダメージ。前の形（合計だけ・key の一覧）からの切りかえでは、いまある攻撃を見たことにする
  const seenHits = mine && seen.hits ? { ...seen.hits } : mine ? Object.fromEntries(all.map((a) => [a.key, a.damage])) : {};
  // 見た攻撃が増えるのは、その日のうちに習慣が増えたときだけ見せる（そうびなどで前の日の値が少し変わっても出し直さない）
  const today = (boss.log || [])[0]?.date;
  let pick = all
    .map((a) => ({ ...a, damage: a.damage - (seenHits[a.key] || 0), more: a.key in seenHits }))
    .filter((a) => (a.more ? a.date === today && a.damage >= MIN_MORE : a.damage > 0))
    .map((a) => (a.more ? { ...a, what: `${a.what}（つづき）` } : a));
  if (pick.length > MAX_HITS) {
    const rest = pick.slice(0, pick.length - MAX_HITS + 1);
    pick = [{ who: "さとし", damage: rest.reduce((a, x) => a + x.damage, 0), what: "これまでの攻撃", combined: true }, ...pick.slice(pick.length - MAX_HITS + 1)];
  }
  const fresh = Math.min(boss.damage, pick.reduce((a, x) => a + x.damage, 0));
  const markSeen = () => {
    const hits = { ...seenHits };
    for (const a of all) hits[a.key] = Math.max(hits[a.key] || 0, a.damage);
    writeSeen({ id: boss.chapterId, hits: Object.fromEntries(Object.entries(hits).slice(-SEEN_MAX)) });
  };

  const startHp = Math.max(0, boss.hp - (boss.damage - fresh));
  const won = !!boss.defeatedOn;

  // ---------- 舞台 ----------
  const party = ["さとし", "ルミ", ...["ムキ", "フミ", "ゼニ"].filter((m) => members.includes(m))];
  if (pet && pet.stage && pet.stage !== "たまご") party.push("あいぼう");
  const imgOf = (who) => {
    if (who === "さとし") return IMG(`cast2/${HERO_KEYS[(hero.match(/（(.+)）/) || [])[1]] || "hero_6"}`);
    if (who === "あいぼう") return IMG(`pet/${petKey(pet.stage, pet.stage === "成長期" || pet.stage === "成体" ? pet.type : null)}`);
    return IMG(`cast2/${{ ルミ: "rumi", ムキ: "muki", フミ: "fumi", ゼニ: "zeni" }[who]}`);
  };
  const fighters = {};
  const partyEl = h("div", { class: "bs-party" }, party.map((who, i) => {
    const el = h("div", { class: `bs-fighter${who === "あいぼう" ? " small" : ""}` }, h("img", { src: imgOf(who), alt: who, draggable: "false" }));
    el.style.setProperty("--i", i);
    el.style.setProperty("--n", party.length);
    fighters[who] = el;
    return el;
  }));
  const bossImg = BOSS_IMAGES[boss.name] ? IMG(BOSS_IMAGES[boss.name]) : null;
  const bossEl = h("div", { class: `bs-boss${won && !fresh ? " down" : ""}` }, bossImg ? h("img", { src: bossImg, alt: boss.name, draggable: "false" }) : null);
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
  const stage = h("div", { class: "bs-stage" }, cam,
    h("div", { class: "bs-hp" }, h("span", { class: "bs-hp-name", text: boss.name }), h("span", { class: "bs-hp-bar" }, hpLag, hpFill), hpText));
  const root = h("div", { class: "bs" }, stage, h("div", { class: "bs-foot" }, caption, skipBtn, replayBtn));

  // 立ち絵を WebGL でなめらかに（格闘ゲームの構えのように、その場で弾む・体重を移す。大きさは変えない）。使えなければ <img> のまま
  let glr = null;
  if (!reduceMotion) {
    try { glr = createActorGL(glCanvas); } catch { glr = null; }
  }
  if (glr) {
    root.classList.add("gl");
    for (const [who, el] of Object.entries(fighters)) {
      glr.add(el, el.firstElementChild, { float: false, stance: true });
      glr.pose(el, { turn: 0.6, lean: 0.15 });
      // まばたき（差分の絵があれば）
      const key = (el.firstElementChild.getAttribute("src").match(/cast2\/([\w]+)\.webp$/) || [])[1];
      if (key && CAST_VARIANTS[key]?.includes("blink")) glr.frames(el, { blink: IMG(`cast2/${key}_blink`) });
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

  // 1回の攻撃：カットイン（技の名前）→ ため・踏み込み（残像・土ぼこり・カメラが寄る）→ 技の演出 → 命中（一瞬止まる・閃光・火花・ダメージ・カメラのゆれ）→ もどる
  async function hit(a) {
    const f = fighters[a.who] || fighters.さとし;
    const move = a.move || MOVES[a.who] || MOVES.さとし;
    const who = a.who === "あいぼう" ? pet?.name || "あいぼう" : a.who;
    const kind = a.combined ? "combo" : move.fx;
    caption.textContent = a.combined ? `これまでの攻撃！` : `${who}の${move.name}！`;
    caption.dataset.sub = a.combined ? "" : a.what;
    const bp = posOf(bossEl);
    const big = a.damage >= boss.hp * 0.12;

    // カットイン（カメラは攻撃する人へ少し寄る）
    if (speed === 1) {
      const fp = posOf(f);
      camTo(1, 0, 0, 5);
      const portrait = f.querySelector("img")?.src;
      const cut = h("div", { class: `bs-cutin cut-${kind}` },
        h("div", { class: "bs-cut-lines" }),
        portrait ? h("img", { class: "bs-cut-face", src: portrait, alt: "" }) : null,
        h("div", { class: "bs-cut-text" }, h("span", { class: "bs-cut-who", text: a.combined ? "ALL" : who }), h("b", { text: a.combined ? "これまでの攻撃" : move.name })));
      fx.append(cut);
      await wait(720);
      cut.classList.add("out");
      setTimeout(() => cut.remove(), 300);
    }

    // ため → 踏み込み（残像を残し、足元に土ぼこり。カメラはボスへ寄る）
    f.classList.add("charge");
    glr?.pose(f, { lean: -0.5, turn: 0.6 });
    await wait(170);
    const fp0 = posOf(f);
    emit(8, { x: fp0.x, y: fp0.bottom - 0.02, color: "#d9c7a8", speed: 0.25, dir: Math.PI, spread: 1.2, g: 0.4, size: 5, life: 0.5, glow: 0, drag: 3 });
    for (let k = 1; k <= 3; k++) {
      const ghost = f.cloneNode(true);
      ghost.classList.add("ghost");
      ghost.style.setProperty("--k", k);
      partyEl.append(ghost);
      setTimeout(() => ghost.remove(), 460);
    }
    f.classList.remove("charge");
    f.classList.add("attack");
    glr?.pose(f, { lean: 0.8, turn: 0.9 });
    camTo(1, (0.5 - bp.x) * 10, 0, 9);
    await wait(200);

    // 技の演出（CSS）＋粒子
    const e = h("div", { class: `bs-effect fx-${kind}` });
    if (kind === "coins" || kind === "pages") for (let i = 0; i < 12; i++) {
      const p = h("i", {});
      p.style.setProperty("--d", `${i * 35}ms`);
      p.style.setProperty("--y", `${-40 + Math.random() * 80}px`);
      e.append(p);
    }
    fx.append(e);
    const hx = bp.x - 0.04, hy = bp.y;
    if (kind === "slash") emit(16, { x: hx, y: hy, color: ["#fff", "#ffe9a0"], speed: 1.1, dir: -0.6, spread: 0.9, g: 0.3, size: 6, life: 0.35, shape: "streak", glow: 10, drag: 4 });
    if (kind === "flame") emit(30, { x: hx, y: hy + 0.05, color: ["#ff5a2a", "#ffb35c", "#fff6c8"], speed: 0.35, dir: -Math.PI / 2, spread: 1.4, g: -0.5, size: 7, life: 0.7, glow: 14, drag: 1 });
    if (kind === "smash" || kind === "muscle") emit(24, { x: hx, y: hy, color: ["#ffb35c", "#fff"], speed: 0.9, g: 1.6, size: 5, life: 0.6, glow: 10 });
    if (kind === "coins") emit(14, { x: hx, y: hy, color: ["#ffd86a", "#fff4c0"], speed: 0.6, g: 1.4, size: 5, life: 0.7, shape: "square", glow: 6 });
    if (kind === "pages") emit(14, { x: hx, y: hy, color: ["#fbf6ea", "#c9a2ff"], speed: 0.4, g: 0.3, size: 7, life: 0.8, shape: "square", glow: 8, drag: 2.5 });
    if (kind === "tackle" || kind === "combo") emit(20, { x: hx, y: hy, color: ["#8fe6ff", "#fff"], speed: 0.8, g: 0.8, size: 5, life: 0.6, glow: 10 });
    await wait(kind === "flame" || kind === "pages" || kind === "coins" ? 320 : 200);

    // 命中：一瞬止まる → 閃光・衝撃・火花・ダメージ・カメラのゆれ
    root.classList.add("hitstop");
    await wait(big ? 140 : 90);
    root.classList.remove("hitstop");
    const flash = h("div", { class: "bs-flash" });
    const impact = h("div", { class: "bs-impact" });
    fx.append(flash, impact);
    emit(big ? 40 : 22, { x: hx, y: hy, color: ["#fff", "#ffe066", "#ffb35c"], speed: big ? 1.4 : 0.9, g: 1.8, size: 4, life: 0.7, shape: "streak", glow: 8, drag: 2 });
    emit(10, { x: hx, y: hy, color: "#ffe9b0", speed: 0.5, g: 2.2, size: 6, life: 0.8, shape: "square", glow: 4, drag: 1 });
    bossEl.classList.remove("hit"); void bossEl.offsetWidth; bossEl.classList.add("hit");
    glr?.flash(bossEl);
    glr?.emote(bossEl, "angry");
    glr?.pose(bossEl, { lean: 0.5, turn: -0.6 });
    setTimeout(() => glr?.pose(bossEl, { lean: 0, turn: -0.6 }), 350 / speed);
    camTo(1, (0.5 - bp.x) * 16, 0, 14);
    shake(big ? 1 : 0.65);
    const weak = boss.weak && (TYPE_ATTACKER[boss.weak] === a.who || boss.weak === "バランス");
    const num = h("span", { class: `bs-num${big ? " big" : ""}` },
      big ? h("small", { text: "CRITICAL!" }) : weak ? h("small", { text: "こうかばつぐん" }) : null,
      String(Math.round(a.damage)));
    num.style.setProperty("--x", `${-20 + Math.random() * 40}px`);
    fx.append(num);
    setHp(hp - a.damage);
    await wait(big ? 560 : 460);
    f.classList.remove("attack");
    glr?.pose(f, { lean: 0.15, turn: 0.6 });
    camTo(1, 0, 0, 4);
    setTimeout(() => { e.remove(); num.remove(); flash.remove(); impact.remove(); }, 900);
    await wait(300);
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
    await wait(500);
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
      fx.append(banner);
      caption.textContent = `${boss.name}を たおした！`;
    } else {
      const total = list.reduce((a, x) => a + x.damage, 0);
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
    if (pick.length && !reduceMotion) {
      markSeen(); // 途中で画面を離れても、同じ攻撃はもう出さない
      play(pick, startHp);
    }
    else finishView([]);
  };
  requestAnimationFrame(start);
  return root;
}
