// あいぼう（画面側）：キャラの描画・セリフ・進化のひとこと。
// 描画は renderPet(段階, 型, 動き) だけを呼ぶ。assets/aibou/ に GLB があれば 3D 表示（aibou-3d.js）に、無ければドット絵。
import { SPRITES } from "./aibou-sprites.js";
import { BOSS_IMAGES, FAMILY_BY_COLOR } from "./art-index.js";
import { createActorGL } from "./theater-gl.js";

// 大きく見せる絵（あいぼう・ボス）は WebGL でなめらかに息づかせる。小さな絵や、動きを減らす設定では CSS の動きだけ
const SMOOTH_MIN = 110;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function smooth(el, size, opts) {
  if (size < SMOOTH_MIN || reduceMotion) return;
  const body = el.querySelector(".pet-body");
  const img = body?.querySelector("img.art");
  if (!img) return;
  const canvas = document.createElement("canvas");
  canvas.className = "art-gl";
  body.append(canvas);
  let g = null;
  try { g = createActorGL(canvas); } catch { g = null; }
  if (!g) return canvas.remove();
  g.add(body, img, opts);
  el.classList.add("gl");
  el.hop = () => g.hop(body);
}

// Gemini で描いた絵（img/<名前>.webp）。読めなければドット絵のまま
function artImg(name, alt) {
  return `<img class="art" src="img/${name}.webp" alt="${alt}" draggable="false" onerror="this.closest('.art-host')?.classList.remove('has-art');this.remove()">`;
}

export const TYPE_COLORS = { ちから: "#e0603a", かしこさ: "#4a7fd6", やさしさ: "#e2789e", しっかり: "#4f9a6a" };
const TYPE_KEYS = { ちから: "power", かしこさ: "wisdom", やさしさ: "kind", しっかり: "steady", バランス: "balance" };

// 3Dモデル（GLB）のファイル名。public/assets/aibou/<名前>.glb を置くと、そのキャラだけ3D表示に切り替わる
export const MODEL_FILES = {
  egg: "01_egg", baby: "02_baby",
  child_power: "03_child_power", child_wisdom: "04_child_wisdom", child_kind: "05_child_kind", child_steady: "06_child_steady",
  adult_power: "07_adult_power", adult_wisdom: "08_adult_wisdom", adult_kind: "09_adult_kind", adult_steady: "10_adult_steady", adult_balance: "11_adult_balance",
};

export function petKey(stage, type) {
  if (stage === "たまご") return "egg";
  if (stage === "幼体") return "baby";
  return `${stage === "成体" ? "adult" : "child"}_${TYPE_KEYS[type] || "power"}`;
}

export function petName(stage, type) {
  return SPRITES[petKey(stage, type)]?.name || "";
}

// ドット絵1コマを SVG の <g> にする（横に続く同じ色はまとめて1つの四角）
function frameSvg(palette, rows) {
  let out = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const c = row[x];
      let w = 1;
      while (row[x + w] === c) w++;
      if (c !== ".") out += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${palette[c]}"/>`;
      x += w;
    }
  });
  return out;
}

const modelChecks = new Map();
function hasModel(key) {
  if (!modelChecks.has(key)) {
    const url = `assets/aibou/${MODEL_FILES[key]}.glb`;
    modelChecks.set(key, fetch(url, { method: "HEAD" })
      .then((r) => (r.ok && !(r.headers.get("content-type") || "").includes("text/html") ? url : null))
      .catch(() => null));
  }
  return modelChecks.get(key);
}

// 動き：idle（ぴょこぴょこ・まばたき）／happy（跳ねて喜ぶ）／sleep（寝ている）／evolve（光って入れ替わる）／hatch（たまごが割れる）
// crack：たまごのひび（0〜2）。返す要素の play(動き) で動きを変えられる
export function renderPet(stage, type, motion = "idle", { crack = 0, size = 160 } = {}) {
  const key = petKey(stage, type);
  const sp = SPRITES[key];
  const el = document.createElement("div");
  el.className = "pet";
  el.style.setProperty("--pet-size", `${size}px`);
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", stage === "たまご" ? "たまご" : sp.name);
  const frames = key === "egg"
    ? { idle: sp.frames[["idle", "crack1", "crack2"][crack] || "idle"], blink: sp.frames.crack2 }
    : sp.frames;
  const art = key === "egg" ? ["egg", "egg_crack1", "egg_crack2"][crack] || "egg" : key;
  el.classList.add("art-host", "has-art");
  el.innerHTML = `<div class="pet-body">${artImg(`pet/${art}`, "")}<svg viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">` +
    `<g class="f-idle">${frameSvg(sp.palette, frames.idle)}</g><g class="f-blink">${frameSvg(sp.palette, frames.blink)}</g></svg></div>` +
    `<div class="pet-fx" aria-hidden="true"></div>`;
  el.dataset.kind = key === "egg" ? "egg" : "pet";
  smooth(el, size, { float: false, boss: false });

  let timer = null;
  const blink = () => {
    if (!el.isConnected) return clearInterval(timer);
    if (el.dataset.motion === "sleep" || key === "egg") return;
    el.classList.add("blink");
    setTimeout(() => el.classList.remove("blink"), 160);
  };
  timer = setInterval(blink, 2600 + Math.random() * 1500);

  el.play = (m) => {
    el.dataset.motion = m;
    el.classList.toggle("blink", m === "sleep");
    const fx = el.querySelector(".pet-fx");
    fx.replaceChildren();
    if (m === "happy") {
      for (let i = 0; i < 3; i++) {
        const s = document.createElement("span");
        s.className = "heart";
        s.textContent = "♥";
        s.style.left = `${30 + i * 20}%`;
        s.style.animationDelay = `${i * 0.12}s`;
        fx.append(s);
      }
      clearTimeout(el._back);
      el._back = setTimeout(() => el.isConnected && el.play(el.dataset.rest || "idle"), 1100);
    }
    if (m === "sleep") {
      const z = document.createElement("span");
      z.className = "zzz";
      z.textContent = "z z";
      fx.append(z);
    }
  };
  el.dataset.rest = motion === "sleep" ? "sleep" : "idle";
  el.play(motion);

  // 3Dモデルがあれば差し替える（aibou-3d.js の mount(要素, GLBのURL, 動き) を呼ぶ。無い・失敗ならドット絵のまま）
  hasModel(key).then((url) => {
    if (!url || !el.isConnected) return;
    import("./aibou-3d.js").then((m) => m.mount(el, url, el.dataset.motion)).catch(() => {});
  });
  return el;
}

// ---------- モンスター（ぼうけん） ----------
// shape：slime / goblin / golem / dragon / boss、colors：[ふつう, かげ, ひかり]（src/battle-config.js の種族の色）
// boss：章ボスの名前（あれば、そのボスの絵）
export function renderMonster(shape, colors, { size = 56, motion = "idle", boss = null } = {}) {
  const sp = SPRITES[`mon_${shape}`] || SPRITES.mon_slime;
  const palette = { ...sp.palette, b: colors?.[0] || sp.palette.b, s: colors?.[1] || sp.palette.s, l: colors?.[2] || sp.palette.l };
  const el = document.createElement("div");
  el.className = "pet monster";
  el.style.setProperty("--pet-size", `${size}px`);
  el.dataset.motion = motion;
  const fam = FAMILY_BY_COLOR[colors?.[0]];
  const art = shape === "boss" ? BOSS_IMAGES[boss] : fam && shape !== "boss" ? `mon/${fam}_${shape}` : null;
  if (art) el.classList.add("art-host", "has-art");
  el.innerHTML = `<div class="pet-body">${art ? artImg(art, "") : ""}<svg viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">` +
    `<g class="f-idle">${frameSvg(palette, sp.frames.idle)}</g><g class="f-blink">${frameSvg(palette, sp.frames.blink)}</g></svg></div>`;
  if (art) smooth(el, size, { boss: shape === "boss" });
  return el;
}

// ---------- そうび（アイテムのアイコン） ----------
const ITEM_KEYS = { 武器: "item_weapon", かぶと: "item_helm", たて: "item_shield", よろい: "item_armor", アクセサリー: "item_ring" };
// レア度の色（★1 灰 ★2 緑 ★3 青 ★4 紫 ★5 金）
export const RARITY_COLORS = {
  1: ["#c9c3b6", "#8f887c", "#f4f0e8"],
  2: ["#8fd18b", "#5ea95a", "#d6f5d3"],
  3: ["#7fb2f0", "#4f84c9", "#d4e6fc"],
  4: ["#c39be8", "#8a62bd", "#eedcff"],
  5: ["#f6cf55", "#c9962a", "#fff3c4"],
};

export function renderItem(slot, rarity, { size = 40 } = {}) {
  const sp = SPRITES[ITEM_KEYS[slot]] || SPRITES.item_ring;
  const c = RARITY_COLORS[rarity] || RARITY_COLORS[1];
  const palette = { ...sp.palette, b: c[0], s: c[1], l: c[2] };
  const el = document.createElement("span");
  el.className = "item-icon";
  el.style.setProperty("--pet-size", `${size}px`);
  el.innerHTML = `<svg viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">${frameSvg(palette, sp.frames.idle)}</svg>`;
  return el;
}

// ---------- ものがたりの本文の置き換え ----------
// {あいぼう}＝名前、{すがた}＝いまの姿の名前、{型:ちから=…;かしこさ=…;やさしさ=…;しっかり=…;バランス=…;ほか=…}＝型で変わる一文
export function fillStory(text, pet) {
  const stage = pet?.stage || "たまご";
  const type = stage === "成長期" || stage === "成体" ? pet?.type : null;
  const form = stage === "たまご" ? "たまご" : petName(stage, type);
  const name = pet?.name || form || "あいぼう";
  return String(text)
    .replaceAll("{あいぼう}", name)
    .replaceAll("{すがた}", form || "たまご")
    .replace(/\{型:([^}]*)\}/g, (_, body) => {
      const opts = Object.fromEntries(body.split(";").map((kv) => kv.split("=")).filter((kv) => kv.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
      return (type && opts[type]) || opts.ほか || "";
    });
}

// ---------- セリフ（段階×型ごと。数パターンからランダム） ----------
const LINES = {
  たまご: ["……（ことこと ゆれている）", "……（あたたかい）", "……（なかで なにか うごいた）", "……（かいろの もようが ひかった）"],
  幼体: ["ぷちっ！", "きょうも いっしょ？", "ぽよん ぽよん", "おなか…じゃなくて、きもちが いっぱい！", "なにか できたら おしえてね"],
  成長期: {
    ちから: ["うおー！ からだが うごきたがってる！", "スクワット みてたよ！", "ガオッ（つよくなった きがする）", "きょうも いっしょに きたえよ！"],
    かしこさ: ["ほう…あたらしいこと しったよ", "しっぽが ひかるのは かんがえてる しるし", "よんだ ほん、どんな はなし？", "ふむふむ、いい ちょうし"],
    やさしさ: ["みんなの ために ありがとう", "おうちが ぽかぽか してる", "わかばが のびた きがする！", "いっしょに いると あんしん"],
    しっかり: ["カチ、コチ。きょうも じかんどおり", "まいにちの つみかさねだね", "こうらが ぴかぴか！", "よていどおり、よし！"],
  },
  成体: {
    ちから: ["その ちから、たしかに うけとった", "どんな かべも いっしょに こえよう", "きたえた ひびが わたしの よろい"],
    かしこさ: ["ほしの ならびが きみの みちを しめしてる", "まなびは つばさ。どこへでも とべる", "きょうの ひとつが、あすの ちえになる"],
    やさしさ: ["きみの やさしさで はなが さいた", "もりも いえも、きみが まもってる", "ありがとう。ちゃんと とどいてるよ"],
    しっかり: ["はぐるまは きょうも ただしく まわる", "まいにちを まもる、それが きしの つとめ", "つみあげた ひびは くずれない"],
    バランス: ["4つの ひかりが そろった", "きみの まいにちは、すべてが ちからになる", "どの みちも、いっしょに あるいてきた"],
  },
};

export function petLine(stage, type) {
  const list = Array.isArray(LINES[stage]) ? LINES[stage] : LINES[stage]?.[type] || LINES.幼体;
  return list[Math.floor(Math.random() * list.length)];
}

export const SLEEP_LINES = ["すやすや……", "……zzz（きょうは のんびり）", "むにゃ……（なにか したら おきるかも）"];

// ---------- 進化のときのひとこと（ものがたり風） ----------
const GROWTH_WORDS = { ちから: "きたえた ちから", かしこさ: "まなんだ ちえ", やさしさ: "だれかを おもう こころ", しっかり: "まいにちの つみかさね" };
export function evolveStory(stage, type, name) {
  const who = name || "あいぼう";
  const n = petName(stage, type);
  if (stage === "幼体") return `ぴしっ…ぱりん！ たまごの かいろが まぶしく ひかり、なかから ちいさな ${n} が とびだした。`;
  if (stage === "成長期") return `${who} の からだが ひかりに つつまれる……。${GROWTH_WORDS[type] || "まいにちの ちから"}が あふれ、${who} は ${n} に すがたを かえた！`;
  if (type === "バランス") return `4つの ひかりが ひとつに とけあう――。かたよらない まいにちが、まぼろしの せいじゅう ${n} を よびさました！`;
  return `ながい ひびの つみかさねが、いま かたちに なる。${who} は ${type}を きわめた ${n} へと しんかした！`;
}
