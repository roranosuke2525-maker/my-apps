// ぼうけん：章ボスとの戦いの舞台。まだ見ていない攻撃（習慣1つ・タスク1件ごと）を、仲間の攻撃として順に見せる。
// 見た攻撃は key で覚えるので、同じ攻撃は二度出ない（▶ 戦いを見る で、きょうの分は見直せる）
//   battleStage({ boss, members, hero, pet, bg }) → 要素（画面に置くと自動で始まる）
// ・タスク（モンスター）は種族ごとに、得意な仲間が攻撃する（コイン→ゼニ、モジ→フミ…）
// ・習慣は型ごとに、その型の仲間が攻撃する（ちから→ムキ、かしこさ→フミ、やさしさ→ルミ、しっかり→ゼニ）
// ・その仲間がまだパーティーにいなければ、さとしが攻撃する
import { petKey } from "./aibou.js";
import { BOSS_IMAGES } from "./art-index.js";

const IMG = (name) => `img/${name}.webp`;
const SEEN_KEY = "battle-seen";
const MAX_HITS = 12;
const SEEN_MAX = 400; // 覚えておく攻撃の数 // これより多いときは、古い分を「これまでの攻撃」にまとめる
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
  // 前の形（合計ダメージだけ覚えていた）からの切りかえ：いまある攻撃は見たことにする
  const seenKeys = new Set(mine ? (Array.isArray(seen.keys) ? seen.keys : all.map((a) => a.key)) : []);
  let pick = all.filter((a) => a.key && !seenKeys.has(a.key) && a.damage > 0);
  if (pick.length > MAX_HITS) {
    const rest = pick.slice(0, pick.length - MAX_HITS + 1);
    pick = [{ who: "さとし", damage: rest.reduce((a, x) => a + x.damage, 0), what: "これまでの攻撃", combined: true }, ...pick.slice(pick.length - MAX_HITS + 1)];
  }
  const fresh = Math.min(boss.damage, pick.reduce((a, x) => a + x.damage, 0));
  const markSeen = () => writeSeen({ id: boss.chapterId, keys: [...new Set([...seenKeys, ...all.map((a) => a.key).filter(Boolean)])].slice(-SEEN_MAX) });

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
  const hpFill = h("span", { class: "bs-hp-fill" });
  const hpLag = h("span", { class: "bs-hp-lag" });
  const hpText = h("b", { class: "bs-hp-text" });
  const caption = h("p", { class: "bs-caption", "aria-live": "polite" });
  const skipBtn = h("button", { type: "button", class: "bs-skip", text: "とばす" });
  const replayBtn = h("button", { type: "button", class: "bs-replay", text: "▶ 戦いを見る" });
  const root = h("div", { class: "bs" },
    h("div", { class: "bs-stage", style: `background-image:url(${IMG(`bg/${bg}`)})` }, partyEl, bossEl, fx,
      h("div", { class: "bs-hp" }, h("span", { class: "bs-hp-name", text: boss.name }), h("span", { class: "bs-hp-bar" }, hpLag, hpFill), hpText)),
    h("div", { class: "bs-foot" }, caption, skipBtn, replayBtn));

  let hp = startHp;
  const setHp = (v, instant) => {
    hp = Math.max(0, v);
    const pct = `${(hp / boss.hp) * 100}%`;
    hpFill.style.transition = instant ? "none" : "";
    hpLag.style.transition = instant ? "none" : "";
    hpFill.style.width = pct;
    setTimeout(() => { hpLag.style.width = pct; }, instant ? 0 : 450);
    hpText.textContent = `${Math.round(hp).toLocaleString()} / ${boss.hp.toLocaleString()}`;
  };
  setHp(startHp, true);

  let speed = 1;
  let playing = false;
  let cancelled = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms / speed));

  // 1回の攻撃：カットイン（技の名前）→ 踏み込み（残像）→ 技の演出 → 命中（一瞬止まる・閃光・破片・ダメージ）→ もどる
  async function hit(a) {
    const f = fighters[a.who] || fighters.さとし;
    const move = a.move || MOVES[a.who] || MOVES.さとし;
    const who = a.who === "あいぼう" ? pet?.name || "あいぼう" : a.who;
    const kind = a.combined ? "combo" : move.fx;
    caption.textContent = a.combined ? `これまでの攻撃！` : `${who}の${move.name}！`;
    caption.dataset.sub = a.combined ? "" : a.what;

    // カットイン
    if (speed === 1) {
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

    // 踏み込み（残像を2つ残す）
    f.classList.add("charge");
    await wait(160);
    for (let k = 1; k <= 2; k++) {
      const ghost = f.cloneNode(true);
      ghost.classList.add("ghost");
      ghost.style.setProperty("--k", k);
      partyEl.append(ghost);
      setTimeout(() => ghost.remove(), 420);
    }
    f.classList.remove("charge");
    f.classList.add("attack");
    await wait(200);

    // 技の演出
    const e = h("div", { class: `bs-effect fx-${kind}` });
    if (kind === "coins" || kind === "pages") for (let i = 0; i < 12; i++) {
      const p = h("i", {});
      p.style.setProperty("--d", `${i * 35}ms`);
      p.style.setProperty("--y", `${-40 + Math.random() * 80}px`);
      e.append(p);
    }
    fx.append(e);
    await wait(kind === "flame" || kind === "pages" || kind === "coins" ? 320 : 200);

    // 命中：一瞬止まる → 閃光・衝撃・破片・ダメージ
    root.classList.add("hitstop");
    await wait(90);
    root.classList.remove("hitstop");
    const flash = h("div", { class: "bs-flash" });
    const impact = h("div", { class: "bs-impact" });
    fx.append(flash, impact);
    for (let i = 0; i < 10; i++) {
      const d = h("i", { class: "bs-debris" });
      const ang = Math.random() * Math.PI * 2;
      d.style.setProperty("--dx", `${Math.cos(ang) * (40 + Math.random() * 60)}px`);
      d.style.setProperty("--dy", `${Math.sin(ang) * (40 + Math.random() * 60) - 20}px`);
      impact.append(d);
    }
    bossEl.classList.remove("hit"); void bossEl.offsetWidth; bossEl.classList.add("hit");
    const big = a.damage >= boss.hp * 0.12;
    const weak = boss.weak && (TYPE_ATTACKER[boss.weak] === a.who || boss.weak === "バランス");
    const num = h("span", { class: `bs-num${big ? " big" : ""}` },
      big ? h("small", { text: "CRITICAL!" }) : weak ? h("small", { text: "こうかばつぐん" }) : null,
      String(Math.round(a.damage)));
    num.style.setProperty("--x", `${-20 + Math.random() * 40}px`);
    fx.append(num);
    root.classList.remove("quake"); void root.offsetWidth; root.classList.add(big ? "quake" : "jolt");
    setHp(hp - a.damage);
    await wait(460);
    f.classList.remove("attack");
    root.classList.remove("jolt");
    setTimeout(() => { e.remove(); num.remove(); flash.remove(); impact.remove(); }, 900);
    await wait(280);
  }

  async function play(list, from) {
    if (playing) return;
    playing = true;
    cancelled = false;
    speed = 1;
    root.classList.add("playing");
    bossEl.classList.remove("down");
    setHp(from, true);
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
    if (won) {
      bossEl.classList.add("down");
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
