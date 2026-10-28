// あいぼう（画面側）：キャラの描画・セリフ・進化のひとこと。
// 描画は renderPet(段階, 型, 動き) だけを呼ぶ。assets/aibou/ に GLB があれば 3D 表示（aibou-3d.js）に、無ければドット絵。
import { SPRITES } from "./aibou-sprites.js";

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
function frameSvg(sp, rows) {
  let out = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const c = row[x];
      let w = 1;
      while (row[x + w] === c) w++;
      if (c !== ".") out += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${sp.palette[c]}"/>`;
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
  el.innerHTML = `<div class="pet-body"><svg viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">` +
    `<g class="f-idle">${frameSvg(sp, frames.idle)}</g><g class="f-blink">${frameSvg(sp, frames.blink)}</g></svg></div>` +
    `<div class="pet-fx" aria-hidden="true"></div>`;
  el.dataset.kind = key === "egg" ? "egg" : "pet";

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
