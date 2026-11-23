  // ================= ⭐ 今週の重点（3件まで）と 🎯 今日のハイライト（重点から毎朝1件）・🔁 日曜夜の週の見直し =================
  // 「覚えているものから選ぶ」をやめ、週の見直しで選んだ重要なものを、いつも見る今日タブの一番上に出す
  const FOCUS_MAX = 3;
  const isFocus = (t) => t.focus === "__YES__";
  const isOpenT = (t) => t.status !== ST.done && t.status !== ST.ref;
  function focusList() {
    const m = new Map(); for (const t of [...S.tasks, ...S.doneToday, ...(S.focusAll || [])]) if (isFocus(t) && !m.has(t.id)) m.set(t.id, known.get(t.id) || t);
    return [...m.values()];
  }
  const hlTask = () => [...S.tasks, ...S.doneToday].find((t) => t.hl === TODAY()) || null;
  const weekStart = (d = TODAY()) => addDays(d, -((dow(d) + 6) % 7)); // 月曜はじまり
  const reviewDue = () => { const last = store.get("review") || ""; const d = TODAY(); return (dow(d) === 0 || dow(d) === 1) && last < addDays(weekStart(d), -1) || !focusList().some(isOpenT); };
  // 今日タブの上に出す細い帯（今日のタスクを隠さないよう1〜2行に収める）
  function focusCardHtml() {
    if (S.mode === "loading" && !S.tasks.length) return "";
    const hl = hlTask(); const open = focusList().filter(isOpenT); const due = reviewDue() && open.length;
    const rv = `<button type="button" class="fcrv${due ? " due" : ""}" data-review="1" aria-label="週の見直し">🔁${due ? "<i></i>" : ""}</button>`;
    if (hl && isOpenT(hl)) return `<section class="fcbar hl"><span class="fci">🎯</span><button type="button" class="fcname" data-open="${hl.id}">${esc(hl.name)}</button><button type="button" class="fcok" data-done="${hl.id}" aria-label="済み">✓</button><button type="button" class="fcx" data-hlclear="${hl.id}" aria-label="ハイライトを変える">↺</button>${rv}</section>`;
    if (open.length) return `<section class="fcbar"><span class="fci">${hl ? "🎉" : "🎯"}</span><div class="fcchips">${open.map((t) => `<button type="button" class="fcchip" data-hlpick="${t.id}">⭐ ${esc(short(t.name, 16))}</button>`).join("")}</div>${rv}</section>`;
    return `<section class="fcbar"><button type="button" class="fcname mute" data-review="1">⭐ 今週の大事な3つを決めよう（週の見直し）›</button></section>`;
  }
  async function setHighlight(id) {
    const t = known.get(id); if (!t) return;
    const old = hlTask(); const props = { "date:🎯 ハイライト:start": TODAY(), "date:🎯 ハイライト:is_datetime": 0, ...(t.date === TODAY() ? {} : dateProps(TODAY())) };
    if (old && old !== t) await setProps(old, { "date:🎯 ハイライト:start": null }, "", { quiet: true, undo: false });
    buzz(); await setProps(t, props, `🎯 今日のハイライトは「${short(t.name)}」。これができたら今日は花丸！`);
  }
  function clearHighlight(id) { const t = known.get(id); if (t) setProps(t, { "date:🎯 ハイライト:start": null }, "ハイライトを外したよ。気が向いたら選び直そう"); }

  // ---------- 🔁 週の見直し（15分）：①今週の重点の結果 → ②止まっているもの → ③来週の重点を3つまで ----------
  const RV = { pick: new Set(), shown: false, q: "" };
  function openReview() {
    RV.pick = new Set(focusList().filter(isOpenT).map((t) => t.id)); RV.q = "";
    modal(`<div class="rv" id="rv"></div>`); $("#modal .sheet").classList.add("tall"); drawReview();
  }
  function drawReview() {
    const box = $("#rv"); if (!box) return;
    const st = box.querySelector(".rvbody")?.scrollTop || 0;
    const focus = focusList(); const done = focus.filter((t) => !isOpenT(t));
    const stuck = stageItems("next").filter((t) => ageOf(t) >= 14 && !RV.pick.has(t.id)).sort((a, b) => ageOf(b) - ageOf(a)).slice(0, 5);
    const sugs = (S.focusSugs || []).map((s) => ({ s, t: sugTask(s) })).filter((x) => x.t && isOpenT(x.t));
    const goalIds = new Set(S.goals.filter((g) => /挑戦中/.test(g.status)).map((g) => g.id));
    const score = (t) => (t.goals?.some((g) => goalIds.has(g)) ? 100 : 0) + (t.date && t.date <= addDays(TODAY(), 14) ? 50 : 0) + Math.min(ageOf(t), 40);
    const q = RV.q.trim().toLowerCase();
    const pool = [...S.tasks].filter((t) => [ST.next, ST.doing, ST.wait, ST.inbox].includes(t.status) && !t.parent?.length && t.tag !== "WORK" && !sugs.some((x) => x.t.id === t.id))
      .filter((t) => !q || `${t.name} ${t.next || ""} ${t.tag || ""}`.toLowerCase().includes(q)).sort((a, b) => (RV.pick.has(b.id) - RV.pick.has(a.id)) || score(b) - score(a)).slice(0, 40);
    const n = RV.pick.size;
    const pickRow = (t, why) => { const on = RV.pick.has(t.id); return `<button type="button" class="pkrow${on ? " sel" : ""}" data-rvpick="${t.id}"><span class="bx">${on ? "⭐" : ""}</span><span class="tx"><b>${esc(t.name)}</b><small>${esc(why || [STAGES[stageOf(t)]?.name, t.tag, t.goals?.some((g) => goalIds.has(g)) ? "🎯 目標につながる" : "", ageOf(t) >= 14 ? `${ageOf(t)}日止まっている` : ""].filter(Boolean).join("・"))}</small></span></button>`; };
    box.innerHTML = `<div class="pkhead"><h3>🔁 週の見直し</h3><small>15分でOK・正解なんてないよ</small></div>
      <div class="rvbody">
        <section><h4>① 今週の重点はどうだった？</h4>${focus.length ? focus.map((t) => `<div class="rvrow"><span>${isOpenT(t) ? "⭐" : "✅"}</span><button type="button" class="tx" data-mopen="${t.id}">${esc(t.name)}</button><small class="mute">${isOpenT(t) ? (RV.pick.has(t.id) ? "来週も続ける" : "外す") : "済み 🎉"}</small></div>`).join("") : `<p class="mute">今週は重点なしだったね。来週はゆるく1つからでも</p>`}${done.length ? `<p class="rvok">重点を ${done.length}件やりきった！いい1週間だったね</p>` : ""}</section>
        ${stuck.length ? `<section><h4>② 止まっているもの（2週間以上）</h4><p class="mute">やらないなら「いつか」へ置いてOK。大事なら③で重点に</p>${stuck.map((t) => `<div class="rvrow"><span>🕸</span><button type="button" class="tx" data-mopen="${t.id}">${esc(short(t.name, 28))}<small class="mute"> ${ageOf(t)}日</small></button><button type="button" class="qc" data-rvsome="${t.id}">いつかへ</button></div>`).join("")}</section>` : ""}
        <section><h4>③ 来週の重点を選ぶ <span class="rvn${n >= FOCUS_MAX ? " full" : ""}">${n} / ${FOCUS_MAX}</span></h4>
          ${sugs.length ? `<p class="mute">💡 AIのおすすめ（目標・止まっている・期限が近いものから）</p>${sugs.map((x) => pickRow(x.t, x.s.reason)).join("")}` : ""}
          <input type="search" id="rvq" class="rvq" placeholder="ほかのタスクから探す" value="${esc(RV.q)}">
          ${pool.map((t) => pickRow(t)).join("") || `<p class="mute">見つかりません</p>`}
        </section>
      </div>
      <div class="pkfoot"><button type="button" class="btn" data-mclose="1">あとで</button><button type="button" class="btn pri" data-rvok="1">この${n}件で来週を始める</button></div>`;
    const b2 = box.querySelector(".rvbody"); if (b2) b2.scrollTop = st;
    const qi = $("#rvq"); if (qi) qi.oninput = () => { RV.q = qi.value; const pos = qi.selectionStart; drawReview(); const q2 = $("#rvq"); q2.focus(); q2.setSelectionRange(pos, pos); };
  }
  function reviewPick(id) {
    if (RV.pick.has(id)) RV.pick.delete(id);
    else { if (RV.pick.size >= FOCUS_MAX) { toast(`重点は${FOCUS_MAX}つまでにしとこう。どれか外してから選んでね`); return; } RV.pick.add(id); }
    buzz(); drawReview();
  }
  async function reviewCommit() {
    const yes = { "⭐ 重点": "__YES__" }, no = { "⭐ 重点": "__NO__" };
    const now = focusList(); const changes = [];
    for (const t of now) if (!RV.pick.has(t.id)) changes.push([t, no]);
    for (const id of RV.pick) { const t = known.get(id); if (t && !isFocus(t)) changes.push([t, yes]); }
    closeModal();
    await Promise.all(changes.map(([t, p]) => setProps(t, p, "", { quiet: true, undo: false })));
    S.focusAll = (S.focusAll || []).filter((t) => RV.pick.has(t.id));
    // AIのおすすめは、選んだら採用・選ばなかったら見送り
    for (const s of S.focusSugs || []) {
      const t = sugTask(s); const state = t && RV.pick.has(t.id) ? "✅ 採用" : "⏭ 見送り";
      if (S.mode !== "demo") call("update", { page_id: s.id, command: "update_properties", properties: { "状態": state, "date:決めた日:start": TODAY(), "date:決めた日:is_datetime": 0 }, allow_async: false }, { read: false }).catch(() => {});
    }
    S.focusSugs = []; store.set("review", TODAY()); render();
    toast(`来週の重点は${RV.pick.size}つ。毎朝、今日タブのいちばん上から1つ選ぼうね${S.mode === "demo" ? "（見本）" : ""}`);
  }
