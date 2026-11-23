  // ================= 🌙 夜の「今日できたこと」：夕方からはじめて開いたとき、今日済んだことを先に見せてから明日の1件を選ぶ =================
  // 見たかどうかはこの端末に覚える（1日1回だけ自動で出す）。今日タブの帯からいつでも開ける
  const EVE_HOUR = 17;
  const jstHour = () => new Date(Date.now() + 9 * 3600e3).getUTCHours();
  const isEvening = () => jstHour() >= EVE_HOUR;
  const eveningDue = () => isEvening() && store.get("evening") !== TODAY() && !(S.mode === "loading" && !S.tasks.length);
  const EV = { pick: null };
  function eveWord(n) {
    if (!n) return ["今日はおやすみの日でもいいよ", "何もしなかった日も大事な1日。ゆっくり休んで、明日また1つだけやろう"];
    if (n === 1) return ["1つ進んだね、おつかれさま！", "ゼロと1は大ちがい。ちゃんと前に進んでるよ"];
    if (n <= 3) return [`${n}つもできたね、えらい！`, "いいペース。この調子で明日もいこう"];
    return [`${n}つも片づけた！すごい日だったね 🎉`, "がんばりすぎたかも。今夜はしっかり休もうね"];
  }
  // 明日の候補：重点 → 今日の残り → 次にやるの軽いもの（6件まで）
  function eveCands() {
    const seen = new Set(); const out = [];
    const add = (t, why) => { if (t && !seen.has(t.id) && isOpenT(t)) { seen.add(t.id); out.push({ t, why }); } };
    for (const t of focusList()) add(t, "⭐ 重点");
    for (const t of stageItems("today")) add(t, "今日の残り");
    for (const t of stageItems("next").filter((t) => !t.weight || t.weight === "S" || t.weight === "M").slice(0, 6)) add(t, "すぐできそう");
    return out.slice(0, 6);
  }
  function openEvening(auto = false) {
    if (auto) store.set("evening", TODAY());
    const tm = addDays(TODAY(), 1); EV.pick = [...S.tasks].find((t) => t.hl === tm)?.id || null;
    modal(`<div class="ev" id="ev"></div>`); $("#modal .sheet").classList.add("tall"); drawEvening();
  }
  function drawEvening() {
    const box = $("#ev"); if (!box) return;
    const done = S.doneToday; const hl = done.find((t) => t.hl === TODAY()); const [h, sub] = eveWord(done.length);
    const tm = addDays(TODAY(), 1); const cands = eveCands();
    box.innerHTML = `<div class="pkhead"><h3>🌙 今日できたこと</h3><small>${md(TODAY())}（${WD[dow(TODAY())]}）</small></div>
      <div class="evbody">
        <section class="evhi"><b>${esc(h)}</b><span>${esc(sub)}</span>${hl ? `<span class="evhl">🎯 ハイライト「${esc(short(hl.name, 20))}」も達成！</span>` : ""}</section>
        ${done.length ? `<section><h4>✓ 済んだこと <small>${done.length}</small></h4>${done.map((t) => `<div class="evrow"><span>${t.hl === TODAY() ? "🎯" : "✓"}</span><button type="button" class="tx" data-mopen="${t.id}">${esc(t.name)}</button></div>`).join("")}</section>` : ""}
        <section><h4>明日の1つだけ、決めとく？</h4><p class="mute">選ぶと明日（${md(tm)}・${WD[dow(tm)]}）の 🎯 ハイライトになるよ。決めなくても大丈夫</p>
          ${cands.map(({ t, why }) => { const on = EV.pick === t.id; return `<button type="button" class="pkrow${on ? " sel" : ""}" data-evpick="${t.id}"><span class="bx">${on ? "🎯" : ""}</span><span class="tx"><b>${esc(t.name)}</b><small>${esc([why, t.waku, t.weight].filter(Boolean).join("・"))}</small></span></button>`; }).join("") || `<p class="mute">候補はないみたい。明日の朝に決めよう</p>`}
        </section>
      </div>
      <div class="pkfoot"><button type="button" class="btn pri" data-evok="1">${EV.pick ? "これで明日へ・おやすみ" : "おやすみ 🌙"}</button></div>`;
  }
  function evePick(id) { EV.pick = EV.pick === id ? null : id; buzz(); drawEvening(); }
  async function eveCommit() {
    store.set("evening", TODAY()); closeModal();
    const tm = addDays(TODAY(), 1); const t = EV.pick && known.get(EV.pick);
    if (!t) { toast("おつかれさま。また明日！"); return; }
    const old = [...S.tasks].filter((x) => x.hl === tm && x !== t);
    for (const o of old) await setProps(o, { "date:🎯 ハイライト:start": null }, "", { quiet: true, undo: false });
    if (t.hl !== tm || t.date !== tm) await setProps(t, { "date:🎯 ハイライト:start": tm, "date:🎯 ハイライト:is_datetime": 0, ...dateProps(tm) }, "", { quiet: true, undo: false });
    toast(`明日は「${short(t.name)}」からいこう。おやすみ！${S.mode === "demo" ? "（見本）" : ""}`);
  }
  // 今日タブの帯（夕方から）
  function eveBarHtml() {
    if (!isEvening() || (S.mode === "loading" && !S.tasks.length)) return "";
    const n = S.doneToday.length;
    return `<button type="button" class="pickbar evbar" data-evening="1"><span class="ic">🌙</span><span class="tx"><b>今日できたこと${n ? ` ${n}件` : ""}</b><small>ふり返って、明日の1つを決めとこう</small></span><i>›</i></button>`;
  }
