// ものがたりの本文（段落の並び）を「劇の台本」にする。だれが話しているかは本文の書き方から推しはかる。
// 画面に依存しないので node でもテストできる。
//   toScript(blocks, labels?) → [{ kind: "say"|"narr"|"system"|"warn"|"title"|"pause", who?, text, fx? }]
// labels：せりふのある段落ごとの話し手（theater-speakers.js）。段落の数が合えばそれを使い、合わなければ推しはかる。

// 登場人物：台本の名前 → 本文に出てくる呼び名（長い順に調べる）
export const CAST = {
  さとし: ["俺", "さとし"],
  ルミ: ["ルミ"],
  ムキ: ["ムキ"],
  フミ: ["フミ"],
  ゼニ: ["ゼニ"],
  シロガネ: ["シロガネ", "白銀の騎士"],
  おばあさん: ["フミヨ", "おばあさん"],
  レンサ: ["レンサ"],
  カゾエ: ["カゾエ"],
  ゴウ: ["ゴウ", "隊長"],
  妻: ["妻"],
  小さな勇者: ["小さな勇者"],
  トキ爺: ["トキ爺", "老囚人"],
  あいぼう: ["{あいぼう}"],
};
const ALIASES = Object.entries(CAST).flatMap(([who, names]) => names.map((n) => [n, who])).sort((a, b) => b[0].length - a[0].length);

// 口ぐせ（ほかに手がかりがないときだけ使う）
const HABITS = [
  [/がっはっは|ガッハッハ/, "ムキ"],
  [/そろばん|ですよ。$/, "ゼニ"],
  [/^あ、あの/, "フミ"],
  [/^おはよーございまーす/, "ルミ"],
];

// 画面効果のきっかけ（本文の語 → 効果の名前）
export const FX_WORDS = [
  [/ぱりん|がしゃん|ばきっ|どん[！!]|ドン|ずしん|どかん|ゴゴゴ|轟/, "shake"],
  [/光った|光が|まぶし|輝|ひかり|閃/, "flash"],
  [/べちゃ|ぷるぷる|ぴしっ|ぽん[！!]|ぽっ/, "pop"],
  [/燃え|炎|火の粉|焦げ/, "ember"],
  [/涙|泣/, "tear"],
  [/笑っ|わら/, "smile"],
];

const QUOTE = /「([^「」]*(?:「[^「」]*」[^「」]*)*)」/g;

// 段落の地の文から、主語になっていそうな人物を探す（「ルミは」「ルミが」「ムキの声」など）
export function subjectOf(text) {
  let best = null;
  for (const [name, who] of ALIASES) {
    const re = new RegExp(`${name.replace(/[{}]/g, "\\$&")}(?:は|が|も|の声|さん|ちゃん)?`);
    const m = text.match(re);
    if (!m) continue;
    const strong = /は|が|も|の声/.test(m[0].slice(name.length));
    const score = (strong ? 0 : 1000) + m.index;
    if (!best || score < best.score) best = { who, score };
  }
  return best?.who || null;
}

const POLITE = /(です|ます|でした|ません|ましょう|ください)[。！？!?…]*$|(です|ます)[。！？]/;
const CASUAL = /(だろ|だぞ|んだ|だな|だよな|じゃないか|しろ|だ|ぞ)(?:[。！？…、]|$)|か？$/;

// その段落の前後に名前が出てくる人物（その場にいそうな人）
function recent(paras, i) {
  const set = new Set();
  for (let k = Math.max(0, i - 12); k <= Math.min(paras.length - 1, i + 3); k++) {
    for (const [name, who] of ALIASES) if (paras[k].text.includes(name)) set.add(who);
  }
  return set;
}

function fxOf(text) {
  const hit = FX_WORDS.find(([re]) => re.test(text));
  return hit ? hit[1] : null;
}

// 1つの段落を「せりふ」と「地の文」に分ける
function split(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(QUOTE)) {
    if (m.index > last) parts.push({ say: false, text: text.slice(last, m.index) });
    parts.push({ say: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ say: false, text: text.slice(last) });
  return parts.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => p.text);
}

// 略号 → 台本の名前（theater-speakers.js で使う）
export const SPEAKER_CODES = {
  さ: "さとし", ル: "ルミ", ム: "ムキ", フ: "フミ", ゼ: "ゼニ", シ: "シロガネ", 婆: "おばあさん", レ: "レンサ",
  カ: "カゾエ", ゴ: "ゴウ", 妻: "妻", 子: "小さな勇者", ト: "トキ爺", あ: "あいぼう", 系: "SYSTEM",
};
const hasSay = (b) => b.type === "p" && b.text.includes("「");

export function toScript(blocks, labels) {
  const out = [];
  const paras = blocks.map((b) => ({ ...b, parts: b.type === "p" ? split(b.text) : [] }));
  const given = typeof labels === "string" ? labels.trim().split(/\s+/) : null;
  const useGiven = given && given.length === blocks.filter(hasSay).length;
  let sayIndex = 0;
  let lastSpeaker = null;
  let partner = null; // 直前のやりとりの相手（交互に話していると見る）

  const remember = (who) => {
    if (who && who !== lastSpeaker) {
      partner = lastSpeaker;
      lastSpeaker = who;
    }
  };

  paras.forEach((b, i) => {
    if (b.type === "heading") return out.push({ kind: "title", text: b.text });
    if (b.type === "quote") {
      const warn = /WARNING|警告/.test(b.text);
      return out.push({ kind: warn ? "warn" : "system", text: b.text.replace(/^>\s*/, ""), fx: warn ? "alarm" : "window" });
    }
    if (/^[―ー—-]{2,}$/.test(b.text.trim()) || /^――/.test(b.text) && b.text.length < 6) return out.push({ kind: "pause", text: "" });

    const narr = b.parts.filter((p) => !p.say).map((p) => p.text).join("");
    const says = b.parts.filter((p) => p.say);
    if (useGiven && hasSay(b)) {
      const token = given[sayIndex++];
      if (token === "-") return out.push({ kind: "narr", text: b.text, fx: fxOf(b.text) });
      const whos = token.split("/").map((t) => SPEAKER_CODES[t] || t);
      let k = 0;
      for (const p of b.parts) {
        if (p.say) out.push({ kind: "say", who: whos[Math.min(k++, whos.length - 1)], text: p.text, fx: fxOf(p.text) });
        else out.push({ kind: "narr", text: p.text, fx: fxOf(p.text), aside: true });
      }
      return remember(whos.at(-1));
    }
    if (!says.length) {
      // 地の文だけ。次の段落がせりふだけなら、ここに出てきた人物がしゃべる手がかりになる
      out.push({ kind: "narr", text: b.text, fx: fxOf(b.text) });
      return;
    }

    // せりふのある段落：手がかりに点数をつけて、いちばん高い人物にする
    const line = says.map((p) => p.text).join(" ");
    const score = new Map();
    const add = (who, n) => who && score.set(who, (score.get(who) || 0) + n);
    for (const who of recent(paras, i)) add(who, 0.1);
    add("さとし", 0.2);
    if (narr) add(subjectOf(narr), 5);
    const next = paras[i + 1];
    if (next?.parts.length && !next.parts[0].say) {
      const head = next.parts[0].text.slice(0, 14);
      const s = subjectOf(head);
      if (s && head.indexOf(CAST[s].find((n) => head.includes(n))) < 3) add(s, 1.2);
    }
    const prev = paras[i - 1];
    if (prev && prev.type === "p" && !prev.parts.some((p) => p.say)) {
      const s = subjectOf(prev.text);
      add(s, s === "さとし" ? 1 : 2.2);
    }
    for (const [re, who] of HABITS) if (re.test(line)) add(who, 2);
    // 交互：直前に話した人ではなく、そのやりとりの相手
    if (lastSpeaker) add(lastSpeaker, -1.5);
    if (lastSpeaker && lastSpeaker !== "さとし") add("さとし", 1.4);
    else if (partner) add(partner, 1.4);
    // 話し方：さとしは です・ます を使わない。呼びかけられた人は話し手ではない
    if (POLITE.test(line)) add("さとし", -2.5);
    if (CASUAL.test(line)) add("さとし", 1.5);
    for (const [name, who] of ALIASES) {
      if (who === "さとし" ? /さとしさん|勇者さん|勇者さま/.test(line) : new RegExp(`${name.replace(/[{}]/g, "\\$&")}(?:さん|ちゃん)?[。、！？!?]|^${name.replace(/[{}]/g, "\\$&")}`).test(line)) add(who, -4);
    }
    const who = [...score.entries()].sort((a, b) => b[1] - a[1])[0][0];

    for (const p of b.parts) {
      if (p.say) out.push({ kind: "say", who, text: p.text, fx: fxOf(p.text) });
      else out.push({ kind: "narr", text: p.text, fx: fxOf(p.text), aside: true });
    }
    remember(who);
  });
  return out;
}
