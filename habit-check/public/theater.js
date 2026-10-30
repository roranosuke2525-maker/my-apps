// ものがたりを「劇」で見せる：横に流れる背景、立ち絵、吹き出し、画面効果。
//   openTheater({ chapter, blocks, pet, hero, onRead, onUnread }) … 全画面で開く。閉じると消える。
// 台本は theater-script.js、話し手は theater-speakers.js、背景は theater-stage.js。
import { toScript, subjectOf } from "./theater-script.js";
import { SPEAKERS } from "./theater-speakers.js";
import { chapterBgs, BG_WORDS, weatherOf } from "./theater-stage.js";
import { BOSS_IMAGES, CAST_VARIANTS } from "./art-index.js";
import { fillStory, petKey } from "./aibou.js";
import { createActorGL } from "./theater-gl.js";

const IMG = (name) => `img/${name}.webp`;

// 立ち絵：名前 → 絵と大きさ（舞台の高さに対する割合）・浮かぶかどうか
// key があれば img/cast2/<key>.webp と、表情・構えの差分 <key>_<差分>.webp（CAST_VARIANTS にあるもの）
const CAST = {
  ムキ: { key: "muki", h: 0.68 },
  フミ: { key: "fumi", h: 0.62 },
  ゼニ: { key: "zeni", h: 0.64 },
  ルミ: { key: "rumi", h: 0.3, float: true },
  シロガネ: { key: "shirogane", h: 0.7 },
  おばあさん: { key: "obaasan", h: 0.56 },
  レンサ: { key: "rensa", h: 0.56, float: true },
  カゾエ: { key: "kazoe", h: 0.48 },
  ゴウ: { key: "gou", h: 0.72 },
  妻: { key: "tsuma", h: 0.62 },
  小さな勇者: { key: "chiisana", h: 0.3 },
  トキ爺: { key: "tokijii", h: 0.58 },
  SYSTEM: { img: "cast/system", h: 0.3, float: true },
  モヤ: { img: "mon/moyamoya_dragon", h: 0.7, boss: true },
  霧の声: { img: "mon/moyamoya_slime", h: 0.45, boss: true },
  ホコリドラゴン: { img: "mon/hokori_dragon", h: 0.5, boss: true },
  曇りの騎士: { img: BOSS_IMAGES.峠の残り霧, h: 0.7, boss: true },
  灯籠の少女: { img: BOSS_IMAGES.冷たい灯籠, h: 0.55, boss: true },
  百回隊: { img: BOSS_IMAGES.百回隊の総攻撃, h: 0.7, boss: true },
};
// 戦いの場面（WARNING のあと）で、構えの絵に切り替わる人
const FIGHTERS = new Set(["さとし", "ムキ", "フミ", "ゼニ", "シロガネ"]);
const BATTLE_STEPS = 14;
const HERO_KEYS = { みならい: "hero_1", かけだし: "hero_2", いちにんまえ: "hero_3", ベテラン: "hero_4", たつじん: "hero_5", でんせつ: "hero_6" };
const EP1_HERO = { 0: "みならい", 1: "みならい", 2: "かけだし", 3: "かけだし", 4: "いちにんまえ", 5: "ベテラン", 6: "ベテラン", 7: "たつじん", 8: "たつじん", 9: "でんせつ" };
const PET_HEIGHT = { egg: 0.26, baby: 0.28, child: 0.36, adult: 0.5 };
const SLOTS = [0.2, 0.5, 0.8];
const SKIP_FX = matchMedia("(prefers-reduced-motion: reduce)").matches;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

export function openTheater({ chapter, blocks, pet, hero, onRead, onUnread }) {
  const order = chapter.order ?? -1;
  const fill = (s) => fillStory(s, pet);
  const petName = fill("{あいぼう}");
  const script = toScript(blocks, SPEAKERS[order]).map((s) => ({ ...s, text: fill(s.text) }));
  const bgs = chapterBgs(order, chapter.title);

  // ---------- 画面 ----------
  const bgA = h("img", { class: "th-bg", alt: "", draggable: "false" });
  const bgB = h("img", { class: "th-bg", alt: "", draggable: "false" });
  const weather = h("div", { class: "th-weather", "aria-hidden": "true" });
  const actors = h("div", { class: "th-actors" });
  const bubbles = h("div", { class: "th-bubbles", "aria-live": "polite" });
  const fx = h("div", { class: "th-fx", "aria-hidden": "true" });
  const sys = h("div", { class: "th-system" });
  const glCanvas = h("canvas", { class: "th-gl", "aria-hidden": "true" });
  const stage = h("div", { class: "th-stage" }, h("div", { class: "th-bgwrap" }, bgA, bgB), weather, actors, glCanvas, bubbles, sys, fx,
    h("div", { class: "th-vignette", "aria-hidden": "true" }));
  const capName = h("span", { class: "th-cap-name" });
  const capText = h("p", { class: "th-cap-text" });
  const caption = h("div", { class: "th-caption" }, capName, capText, h("span", { class: "th-next", "aria-hidden": "true", text: "▼" }));
  const progress = h("span", { class: "th-progress-bar" });
  const autoBtn = h("button", { type: "button", class: "th-btn", "aria-pressed": "false", text: "オート" });
  const root = h("div", { class: "theater", role: "dialog", "aria-modal": "true", "aria-label": chapter.title },
    h("div", { class: "th-top" },
      h("span", { class: "th-title", text: chapter.title }),
      h("span", { class: "th-progress" }, progress)),
    stage, caption,
    h("div", { class: "th-controls" },
      h("button", { type: "button", class: "th-btn", text: "◀ もどる", onclick: (e) => { e.stopPropagation(); back(); } }),
      autoBtn,
      h("button", { type: "button", class: "th-btn", text: "ログ", onclick: (e) => { e.stopPropagation(); showLog(); } }),
      h("button", { type: "button", class: "th-btn", text: "とばす", onclick: (e) => { e.stopPropagation(); finish(); } }),
      h("button", { type: "button", class: "th-btn close", "aria-label": "とじる", text: "✕", onclick: (e) => { e.stopPropagation(); close(); } })));
  document.body.append(root);
  document.body.classList.add("theater-open");
  // 立ち絵を WebGL でなめらかに動かす（使えない端末・動きを減らす設定では、ふつうの絵）
  let glr = null;
  if (!SKIP_FX) {
    try { glr = createActorGL(glCanvas); } catch { glr = null; }
  }
  if (glr) actors.classList.add("gl");
  else glCanvas.remove();

  // ---------- 状態 ----------
  let i = -1;
  let bgIndex = 0;
  let front = bgA;
  let typing = null;
  let auto = false;
  let autoTimer = null;
  let ended = false;
  let battleLeft = 0; // WARNING のあと、しばらくは戦いの構え
  const onStage = []; // { who, el, slot, last }
  const segSteps = []; // 背景ごとの、その背景で進んだ段の数（横に流す量）
  const bgAt = []; // 各段の背景の番号（もどるとき用）

  // 段ごとの背景を先に決めておく（地の文に、その話の背景の語が出たら切り替え）
  {
    let cur = 0;
    script.forEach((s, k) => {
      if (s.kind === "narr" && !s.aside) {
        const next = bgs.findIndex((b, n) => n !== cur && BG_WORDS[b]?.test(s.text));
        if (next >= 0) cur = next;
      }
      bgAt[k] = cur;
    });
    // 同じ背景が続く区間で、何段目かを数える（背景を横に流す割合に使う）
    let start = 0;
    script.forEach((_, k) => {
      if (k > 0 && bgAt[k] !== bgAt[k - 1]) start = k;
      segSteps[k] = { start, k };
    });
    for (let k = script.length - 1, end = script.length - 1; k >= 0; k--) {
      if (k < script.length - 1 && bgAt[k] !== bgAt[k + 1]) end = k;
      segSteps[k].end = end;
    }
  }
  // 使う絵を先に読みこむ
  for (const b of bgs) new Image().src = IMG(`bg/${b}`);

  function setBg(index, instant) {
    const src = IMG(`bg/${bgs[index]}`);
    const changed = index !== bgIndex || !front.getAttribute("src");
    if (!changed) return;
    const back = front === bgA ? bgB : bgA;
    back.src = src;
    back.classList.remove("out", "in", "show");
    back.style.setProperty("--pan", "0");
    if (instant || SKIP_FX) {
      front.classList.remove("show");
      back.classList.add("show");
    } else {
      // 横スクロールで場面が変わる：古い背景は左へ、新しい背景は右から
      const old = front;
      back.classList.add("in");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        old.classList.add("out");
        back.classList.add("show");
        back.classList.remove("in");
      }));
      setTimeout(() => old.classList.remove("show", "out"), 950);
    }
    front = back;
    bgIndex = index;
    setWeather(weatherOf(bgs[index], order));
  }

  function pan(k) {
    const seg = segSteps[k];
    const p = seg.end > seg.start ? (k - seg.start) / (seg.end - seg.start) : 0.5;
    front.style.setProperty("--pan", String(p));
    // 奥行き：背景が流れると、立ち絵と手前の粒は少しだけ反対に動く
    stage.style.setProperty("--par", String(p));
  }

  function setWeather(kind) {
    if (weather.dataset.kind === kind) return;
    weather.dataset.kind = kind;
    weather.replaceChildren();
    if (SKIP_FX) return;
    const n = { ash: 34, fog: 4, leaves: 14, embers: 18, dust: 12, sun: 5, night: 0 }[kind] ?? 0;
    for (let k = 0; k < n; k++) {
      const p = h("span", { class: `wp ${kind}` });
      p.style.setProperty("--x", `${Math.random() * 100}%`);
      p.style.setProperty("--d", `${(kind === "fog" ? 18 : kind === "sun" ? 6 : 6) + Math.random() * 8}s`);
      p.style.setProperty("--delay", `${-Math.random() * 14}s`);
      p.style.setProperty("--s", `${0.5 + Math.random()}`);
      p.style.setProperty("--y", `${Math.random() * 100}%`);
      weather.append(p);
    }
  }

  // ---------- 立ち絵 ----------
  function castOf(who) {
    if (who === "さとし") {
      // エピソード1の本編は、その章のころの姿。ほかは今の姿（DB_すがた）
      const stageName = EP1_HERO[order] || (hero || "").match(/（(.+)）/)?.[1];
      return { key: HERO_KEYS[stageName] || "hero_6", h: 0.66 };
    }
    if (who === "あいぼう") {
      const key = petKey(pet?.stage || "たまご", pet?.stage === "成長期" || pet?.stage === "成体" ? pet?.type : null);
      const size = key === "egg" ? "egg" : key === "baby" ? "baby" : key.startsWith("adult") ? "adult" : "child";
      return { img: `pet/${key}`, h: PET_HEIGHT[size], float: key === "egg" };
    }
    if (CAST[who]) return CAST[who];

    if (BOSS_IMAGES[who]) return { img: BOSS_IMAGES[who], h: 0.74, boss: true };
    return null;
  }

  function displayName(who) {
    if (who === "あいぼう") return petName || "あいぼう";
    if (who === "SYSTEM") return "【SYSTEM】";
    return who;
  }

  // 表情・構えの差分があればその絵、なければ ふつうの絵
  function imgOf(c, emo) {
    if (!c.key) return IMG(c.img);
    return IMG(emo && CAST_VARIANTS[c.key]?.includes(emo) ? `cast2/${c.key}_${emo}` : `cast2/${c.key}`);
  }

  function setFace(a, emo) {
    const src = imgOf(a.c, emo);
    const img = a.el.firstElementChild;
    if (img.getAttribute("src") === src) return;
    img.src = src;
    a.el.classList.remove("swap"); void a.el.offsetWidth; a.el.classList.add("swap");
  }

  function bringOn(who, { quiet, emo } = {}) {
    const c = castOf(who);
    if (!c) return null;
    let a = onStage.find((x) => x.who === who);
    const now = performance.now();
    if (!a) {
      // 敵は右から、仲間は左から空いている場所へ
      const order = c.boss ? [2, 1, 0] : [0, 1, 2];
      let slot = order.find((n) => !onStage.some((x) => x.slot === n)) ?? -1;
      if (slot < 0) {
        // いちばん長く出番のない人に下がってもらう（主人公はなるべく残す）
        const leave = [...onStage].sort((x, y) => (x.who === "さとし") - (y.who === "さとし") || x.last - y.last)[0];
        slot = leave.slot;
        leave.el.classList.add("leave");
        setTimeout(() => { leave.el.remove(); glr?.remove(leave.el); }, 600);
        onStage.splice(onStage.indexOf(leave), 1);
      }
      const img = h("img", { src: imgOf(c, emo), alt: displayName(who), draggable: "false" });
      // 差分の絵がなければ ふつうの絵、それもなければ立ち絵なし
      img.onerror = () => {
        const base = imgOf(c, null);
        if (img.getAttribute("src") !== base) img.src = base;
        else a.el.classList.add("noimg");
      };
      const el = h("div", { class: `actor${c.float ? " float" : ""}${c.boss ? " boss" : ""} enter-${SLOTS[slot] < 0.5 ? "left" : "right"}` }, img);
      el.style.setProperty("--x", `${SLOTS[slot] * 100}%`);
      el.style.setProperty("--h", c.h);
      actors.append(el);
      glr?.add(el, img, { float: c.float, boss: c.boss });
      a = { who, el, slot, last: now, c };
      onStage.push(a);
      requestAnimationFrame(() => el.classList.add("on"));
    }
    a.last = now;
    if (!quiet || emo) setFace(a, emo);
    if (!quiet) {
      for (const x of onStage) x.el.classList.toggle("speaking", x === a);
    }
    return a;
  }

  function clearStage() {
    for (const a of onStage) { a.el.remove(); glr?.remove(a.el); }
    onStage.length = 0;
  }

  // ---------- 文字 ----------
  // 文字は1字ずつ、ふわっと浮かび上がる。せりふのあいだは話し手がうなずく
  function type(el, text, speed = 30, { talk = false } = {}) {
    stopTyping();
    if (SKIP_FX) { el.textContent = text; return; }
    const frag = document.createDocumentFragment();
    let delay = 0;
    for (const ch of text) {
      const sp = document.createElement("span");
      sp.className = "ch";
      sp.textContent = ch;
      sp.style.animationDelay = `${delay}ms`;
      delay += /[、。！？…]/.test(ch) ? speed * 4 : speed;
      frag.append(sp);
    }
    el.classList.remove("typed");
    el.replaceChildren(frag);
    if (talk) glr?.talkAll(true);
    typing = { el, text, timer: setTimeout(() => { typing = null; glr?.talkAll(false); scheduleAuto(); }, delay + 250) };
  }
  function stopTyping() {
    if (!typing) return false;
    clearTimeout(typing.timer);
    typing.el.classList.add("typed");
    typing = null;
    glr?.talkAll(false);
    scheduleAuto();
    return true;
  }

  // ---------- 効果 ----------
  function effect(kind, s, actor) {
    if (!kind || SKIP_FX) return;
    if (kind === "shake") { stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake"); }
    if (kind === "flash") burst("flash");
    if (kind === "pop") {
      const word = s.text.match(/べちゃ|ぷるぷる|ぴしっ|ぱりん|ぽん|ぽっ|ぷちっ|ばきっ|がしゃん|ずしん|どかん/)?.[0];
      if (word) {
        const w = h("span", { class: "th-ono", text: word });
        w.style.setProperty("--x", `${20 + Math.random() * 60}%`);
        w.style.setProperty("--y", `${15 + Math.random() * 40}%`);
        w.style.setProperty("--r", `${-12 + Math.random() * 24}deg`);
        fx.append(w);
        setTimeout(() => w.remove(), 1200);
      }
    }
    if (kind === "ember") for (let k = 0; k < 14; k++) spark();
    if (kind === "tear") burst("tear");
    if (kind === "smile" && actor) {
      if (glr) glr.hop(actor.el);
      else { actor.el.classList.remove("hop"); void actor.el.offsetWidth; actor.el.classList.add("hop"); }
    }
  }
  function burst(cls) {
    const b = h("div", { class: `th-burst ${cls}` });
    fx.append(b);
    setTimeout(() => b.remove(), 1200);
  }
  function spark() {
    const p = h("span", { class: "th-spark" });
    p.style.setProperty("--x", `${Math.random() * 100}%`);
    p.style.setProperty("--dx", `${-30 + Math.random() * 60}px`);
    p.style.setProperty("--delay", `${Math.random() * 0.4}s`);
    fx.append(p);
    setTimeout(() => p.remove(), 1800);
  }

  // ---------- 1段ずつ見せる ----------
  function render(k, { instant = false } = {}) {
    const s = script[k];
    progress.style.width = `${((k + 1) / script.length) * 100}%`;
    setBg(bgAt[k], instant);
    pan(k);
    bubbles.replaceChildren();
    if (s.kind !== "system" && s.kind !== "warn") sys.replaceChildren();
    caption.classList.remove("hidden", "system");
    root.dataset.kind = s.kind;
    root.dataset.step = String(k);

    if (s.kind === "title") {
      capName.textContent = "";
      type(capText, s.text);
      return;
    }
    if (s.kind === "pause") {
      burst("black");
      capName.textContent = "";
      capText.textContent = "――";
      return;
    }
    if (s.kind === "system" || s.kind === "warn") {
      const win = h("div", { class: `th-window${s.kind === "warn" ? " warn" : ""}` }, h("span", { class: "th-win-text" }));
      if (sys.children.length >= 3) sys.firstElementChild.remove();
      sys.append(win);
      type(win.firstElementChild, s.text, 22);
      caption.classList.add("hidden");
      if (s.kind === "warn" && !SKIP_FX) {
        burst("alarm");
        stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake");
        const boss = s.text.match(/(?:出現|ラスボス)[：:]\s*(.+)$/)?.[1]?.trim();
        if (boss && castOf(boss)) bringOn(boss);
        // 仲間は構える
        battleLeft = BATTLE_STEPS;
        for (const a of onStage) if (FIGHTERS.has(a.who)) setFace(a, "battle");
      }
      return;
    }
    if (s.kind === "narr") {
      // 地の文に出てきた人物を、だまって舞台に上げる
      const who = subjectOf(s.text);
      if (who && who !== "さとし" && castOf(who)) bringOn(who, { quiet: true });
      for (const x of onStage) x.el.classList.remove("speaking");
      capName.textContent = "";
      type(capText, s.text);
      effect(s.fx, s);
      return;
    }
    // せりふ：立ち絵の上に吹き出し
    if (battleLeft > 0) battleLeft--;
    const actor = bringOn(s.who, { emo: s.emo || (battleLeft > 0 && FIGHTERS.has(s.who) ? "battle" : null) });
    if (!actor) for (const x of onStage) x.el.classList.remove("speaking");
    const name = displayName(s.who);
    const bubble = h("div", { class: `th-bubble${actor ? "" : " voice"}${/！|!/.test(s.text) ? " loud" : ""}${/……|…$/.test(s.text) ? " soft" : ""}` },
      h("span", { class: "th-bubble-name", text: name }),
      h("span", { class: "th-bubble-text" }));
    const x = actor ? SLOTS[actor.slot] : 0.5;
    bubbles.append(bubble);
    caption.classList.add("hidden");
    // 吹き出しは画面からはみ出さないように置き、しっぽだけ話し手に向ける（全文の大きさで先に測る）
    const body = bubble.lastElementChild;
    body.textContent = `「${s.text}」`;
    const W = stage.clientWidth;
    const bw = bubble.offsetWidth;
    const left = Math.min(W - bw - 8, Math.max(8, x * W - bw / 2));
    bubble.style.left = `${left}px`;
    bubble.style.setProperty("--tail", `${Math.min(bw - 22, Math.max(22, x * W - left))}px`);
    bubble.style.minHeight = `${bubble.offsetHeight}px`;
    type(body, `「${s.text}」`, 30, { talk: true });
    effect(s.fx, s, actor);
  }

  function next() {
    if (stopTyping()) return;
    if (i >= script.length - 1) return finish();
    i++;
    render(i);
    if (script[i].kind === "pause") setTimeout(() => i === script.length - 1 || next(), 700);
  }

  function back() {
    if (i <= 0) return;
    stopTyping();
    i--;
    // もどるときは、その段の場面を作り直す（立ち絵は、その段の話し手だけ）
    clearStage();
    render(i, { instant: true });
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (!auto || ended) return;
    const s = script[i];
    const wait = 900 + Math.min(4000, (s?.text?.length || 0) * 45);
    autoTimer = setTimeout(next, wait);
  }

  autoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    auto = !auto;
    autoBtn.setAttribute("aria-pressed", String(auto));
    autoBtn.classList.toggle("on", auto);
    if (auto && !typing) scheduleAuto();
  });

  function showLog() {
    stopTyping();
    const list = h("div", { class: "th-log-list" }, script.slice(0, i + 1).map((s) =>
      s.kind === "say"
        ? h("p", {}, h("b", { text: `${displayName(s.who)}　` }), `「${s.text}」`)
        : s.kind === "pause" ? null
        : h("p", { class: s.kind === "narr" ? "narr" : "sys", text: s.text })));
    const panel = h("div", { class: "th-log", onclick: (e) => e.stopPropagation() },
      h("div", { class: "th-log-head" }, h("b", { text: "ログ" }), h("button", { type: "button", class: "th-btn", text: "とじる", onclick: () => panel.remove() })),
      list);
    root.append(panel);
    list.scrollTop = list.scrollHeight;
  }

  // ---------- おわり ----------
  function finish() {
    if (ended) return;
    ended = true;
    stopTyping();
    clearTimeout(autoTimer);
    i = script.length - 1;
    progress.style.width = "100%";
    bubbles.replaceChildren();
    sys.replaceChildren();
    caption.classList.add("hidden");
    const boss = chapter.kind === "エピソード2" && chapter.boss && !chapter.defeated ? chapter.boss : null;
    const bossImg = boss && (BOSS_IMAGES[boss] ? IMG(BOSS_IMAGES[boss]) : null);
    const card = h("div", { class: `th-end${boss ? " boss" : ""}`, onclick: (e) => e.stopPropagation() },
      boss ? h("p", { class: "th-end-kicker", text: "BOSS" }) : h("p", { class: "th-end-kicker", text: "つづく" }),
      bossImg ? h("img", { class: "th-end-boss", src: bossImg, alt: boss }) : null,
      boss ? h("h2", { text: boss }) : h("h2", { text: chapter.title }),
      boss ? h("p", { class: "th-end-sub", text: `HP ${chapter.hp ?? "?"}　じゃくてん：${chapter.weak || "—"}` }) : null,
      h("div", { class: "th-end-btns" },
        chapter.read
          ? h("button", { type: "button", class: "th-btn big", text: "とじる", onclick: () => close() })
          : h("button", { type: "button", class: "th-btn big primary", text: boss ? "よんだ（ボス戦へ）" : "よんだ", onclick: async (e) => {
            e.currentTarget.disabled = true;
            await onRead?.();
            close();
          } }),
        h("button", { type: "button", class: "th-btn big", text: "はじめから", onclick: () => restart() }),
        chapter.read && onUnread ? h("button", { type: "button", class: "th-btn", text: "「よんだ」を外す", onclick: async (e) => {
          e.currentTarget.disabled = true;
          await onUnread();
          close();
        } }) : null));
    if (!SKIP_FX && boss) { burst("alarm"); stage.classList.add("shake"); }
    root.append(card);
  }

  function restart() {
    root.querySelector(".th-end")?.remove();
    ended = false;
    clearStage();
    i = -1;
    next();
  }

  function close() {
    stopTyping();
    glr?.destroy();
    clearTimeout(autoTimer);
    document.removeEventListener("keydown", onKey);
    root.classList.add("closing");
    document.body.classList.remove("theater-open");
    setTimeout(() => root.remove(), 250);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") back();
    else if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); next(); }
  }
  document.addEventListener("keydown", onKey);
  stage.addEventListener("click", next);
  caption.addEventListener("click", next);

  // はじまり：題名の幕
  setBg(0, true);
  pan(0);
  const opening = h("div", { class: "th-opening", onclick: (e) => { e.stopPropagation(); opening.remove(); next(); } },
    h("p", { class: "th-open-kicker", text: chapter.kind === "エピソード2" ? "エピソード2　ツヅキの帝国" : chapter.kind === "よりみち" ? "よりみち" : "エピソード1　霧の国" }),
    h("h2", { text: chapter.title }),
    h("p", { class: "th-open-tap", text: "タップで はじまる" }));
  root.append(opening);
  if (!script.length) {
    opening.remove();
    capText.textContent = "本文がありません";
  }
  return { close };
}
