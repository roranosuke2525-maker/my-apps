// ぼうけん：章ボスとの戦いの舞台。前に見たときから増えたダメージを、仲間の攻撃として順に見せる。
//   battleStage({ boss, members, hero, pet, bg }) → 要素（画面に置くと自動で始まる）
// ・タスク（モンスター）は種族ごとに、得意な仲間が攻撃する（コイン→ゼニ、モジ→フミ…）
// ・習慣は型ごとに、その型の仲間が攻撃する（ちから→ムキ、かしこさ→フミ、やさしさ→ルミ、しっかり→ゼニ）
// ・その仲間がまだパーティーにいなければ、さとしが攻撃する
import { petKey } from "./aibou.js";
import { BOSS_IMAGES } from "./art-index.js";

const IMG = (name) => `img/${name}.webp`;
const SEEN_KEY = "battle-seen";
const MAX_HITS = 8; // これより多いときは、古い分を「これまでの攻撃」にまとめる
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
    if (x.kind === "muscle") {
      out.push({ who: "さとし", damage: x.damage, what: "きたえた からだの力", date: x.date });
    } else if (x.kind === "task") {
      const want = FAMILY_ATTACKER[x.family] || "さとし";
      out.push({ who: has(want) ? want : "さとし", damage: x.damage, what: `${x.name}${"★".repeat(x.stars || 0)}を片づけた力`, date: x.date });
    } else {
      const types = x.types && Object.keys(x.types).length ? x.types : { ちから: x.damage };
      // 同じ人の分はまとめる
      const byWho = {};
      for (const [t, v] of Object.entries(types)) {
        const want = TYPE_ATTACKER[t] || "さとし";
        const who = has(want) ? want : "さとし";
        byWho[who] = (byWho[who] || 0) + v;
      }
      for (const [who, v] of Object.entries(byWho)) if (v > 0) out.push({ who, damage: v, what: "習慣の力", date: x.date });
    }
  }
  return out;
}

export function battleStage({ boss, members = [], hero = "", pet = null, bg = "capital" }) {
  const seen = readSeen();
  const already = seen?.id === boss.chapterId ? Math.min(seen.damage, boss.damage) : 0;
  let fresh = Math.max(0, boss.damage - already);
  // 新しい分にあたる攻撃を、新しいほうから拾う
  const all = attacksOf(boss.log || [], members);
  let pick = [];
  let sum = 0;
  for (let i = all.length - 1; i >= 0 && sum < fresh; i--) { pick.unshift(all[i]); sum += all[i].damage; }
  if (sum < fresh) pick.unshift({ who: "さとし", damage: fresh - sum, what: "これまでの攻撃", combined: true });
  if (pick.length > MAX_HITS) {
    const rest = pick.slice(0, pick.length - MAX_HITS + 1);
    pick = [{ who: "さとし", damage: rest.reduce((a, x) => a + x.damage, 0), what: "これまでの攻撃", combined: true }, ...pick.slice(pick.length - MAX_HITS + 1)];
  }
  // 端数の食い違いは最後の攻撃で合わせる
  if (pick.length) pick.at(-1).damage += fresh - pick.reduce((a, x) => a + x.damage, 0);

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

  async function hit(a) {
    const f = fighters[a.who] || fighters.さとし;
    const move = MOVES[a.who] || MOVES.さとし;
    caption.textContent = a.combined ? `これまでの攻撃！ ${Math.round(a.damage)} ダメージ` : `${a.who === "あいぼう" ? pet?.name || "あいぼう" : a.who}の${move.name}！（${a.what}）`;
    f.classList.add("attack");
    await wait(260);
    const e = h("div", { class: `bs-effect fx-${a.combined ? "combo" : move.fx}` });
    if (move.fx === "coins" || move.fx === "pages") for (let i = 0; i < 9; i++) {
      const p = h("i", {});
      p.style.setProperty("--d", `${i * 40}ms`);
      p.style.setProperty("--y", `${-30 + Math.random() * 60}px`);
      e.append(p);
    }
    fx.append(e);
    await wait(220);
    bossEl.classList.remove("hit"); void bossEl.offsetWidth; bossEl.classList.add("hit");
    const big = a.damage >= boss.hp * 0.12;
    const num = h("span", { class: `bs-num${big ? " big" : ""}`, text: String(Math.round(a.damage)) });
    num.style.setProperty("--x", `${-20 + Math.random() * 40}px`);
    fx.append(num);
    if (big) { root.classList.remove("quake"); void root.offsetWidth; root.classList.add("quake"); }
    setHp(hp - a.damage);
    await wait(420);
    f.classList.remove("attack");
    setTimeout(() => { e.remove(); num.remove(); }, 900);
    await wait(260);
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
    writeSeen({ id: boss.chapterId, damage: boss.damage });
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
    if (pick.length && !reduceMotion) play(pick, startHp);
    else finishView([]);
  };
  requestAnimationFrame(start);
  return root;
}
