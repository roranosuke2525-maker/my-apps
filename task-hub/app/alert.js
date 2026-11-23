  // ================= 🔔 お知らせ（アラート）：診断レポート・タスクの問題点を、アプリを開いたときに知らせる =================
  // 1日のはじめて開いたとき、まだ見ていないお知らせがあれば自動で出す。上の🔔からいつでも見られる。
  // 「確認した」はこの端末に覚える（その日のうちは同じお知らせを自動では出さない）
  const LV_ORDER = { red: 0, yellow: 1, info: 2 };
  function alertList() {
    if (S.mode === "loading" && !S.tasks.length) return [];
    const out = []; const d = TODAY();
    const today = stageItems("today"); const late = today.filter((t) => t.date && t.date < d);
    const old = late.filter((t) => diffDays(t.date, d) >= 3);
    if (late.length) out.push({ id: `late:${late.length}:${old.length}`, lv: old.length ? "red" : "yellow", icon: "⏰", title: `持ち越しが ${late.length}件あるよ`, body: old.length ? `3日以上たってるもの：${old.slice(0, 2).map((t) => short(t.name, 14)).join("・")}${old.length > 2 ? " ほか" : ""}` : "今日やるか、日付を外すかだけ決めよう", act: ["今日タブで見る", "today"] });
    // 診断レポート（新着）・答えていない判断
    const dg = S.diag.at(-1); const seen = seenAll();
    if (dg && seen.diag !== dg.id) out.push({ id: `diag:${dg.id}`, lv: dg.rate < .4 ? "red" : "yellow", icon: "🩺", title: `診断レポートが届いたよ（第${dg.no}回）`, body: `${dg.verdict || ""}${dg.next ? `・次の一手：${dg.next}` : ""}`, act: ["レポートを見る", "log:diag"] });
    const asks = openAsks();
    if (asks.length) { const a = Math.max(...asks.map(ageOf)); out.push({ id: `asks:${asks.map((t) => t.id.slice(0, 6)).join("")}`, lv: a >= 7 ? "red" : "yellow", icon: "✋", title: `答えを待ってる判断が ${asks.length}件`, body: `${asks.map((t) => short(t.name, 16)).join("・")}${a >= 7 ? `（いちばん古いのは${a}日前）` : ""}`, act: ["判断を見る", "log:diag"] }); }
    // いまの健康診断で赤の項目
    for (const c of healthChecks().filter((c) => c.st === "red").slice(0, 2)) out.push({ id: `hc:${c.no}:${c.val}`, lv: "red", icon: "🏥", title: `${c.name}：${c.val}`, body: c.fix?.msg || c.why, act: ["直し方を見る", "log:diag"] });
    // 重点・ハイライト
    const focus = focusList(); const openF = focus.filter(isOpenT);
    if (!openF.length) out.push({ id: `focus:none:${weekStart()}`, lv: "yellow", icon: "⭐", title: "今週の重点、まだ決まってないよ", body: "大事なことを3つだけ選んでおくと、毎朝そこから1つ選ぶだけでいいよ", act: ["週の見直しをする", "review"] });
    else if (reviewDue()) out.push({ id: `review:${weekStart()}`, lv: "yellow", icon: "🔁", title: "週の見直しの日だよ", body: "今週をふり返って、来週の3つを選び直そう（15分くらい）", act: ["週の見直しをする", "review"] });
    else if (!hlTask() && workday(d)) out.push({ id: `hl:${d}`, lv: "info", icon: "🎯", title: "今日のハイライト、どれにする？", body: `重点から1つ：${openF.map((t) => short(t.name, 12)).join("・")}`, act: ["今日タブで選ぶ", "today"] });
    // AIの番・改善案・ジャーナル
    const mine = myTurn();
    if (mine.length) out.push({ id: `ai:${mine.length}`, lv: mine.some((t) => t.ai === "💭" && ageOf(t) >= 3) ? "yellow" : "info", icon: "💭", title: `AIが ${mine.length}件、返事を待ってるよ`, body: mine.slice(0, 2).map((t) => short(t.name, 16)).join("・"), act: ["AIタブで答える", "ai"] });
    const jo = judgeOld();
    if (jo.length) out.push({ id: `judge:${jo.length}`, lv: "yellow", icon: "🔍✅", title: `30日以上たつ判定待ちが ${jo.length}件あるよ`, body: "古い順に10件だけ、次にやる・いつか・資料に分けよう", act: ["10件だけ決める", "judge"] });
    const fw = fixWaiting();
    if (fw.length) out.push({ id: `fix:${fw.map((f) => f.id.slice(0, 6)).join("")}`, lv: "info", icon: "🛠", title: `アプリの改善案が ${fw.length}件あるよ`, body: fw.map((f) => short(f.name, 16)).join("・"), act: ["改善を見る", "log:fix"] });
    const j = S.journal?.[0];
    if (j && seen.jour !== j.id) out.push({ id: `jour:${j.id}`, lv: "info", icon: "📓", title: /ジャーナル/.test(j.name) ? j.name : `${j.name} のジャーナル`, body: "まとめ・気になること・明日の提案が書いてあるよ", act: ["ジャーナルを見る", "log:diag"] });
    return out.sort((a, b) => LV_ORDER[a.lv] - LV_ORDER[b.lv]);
  }
  const alertSeen = () => { const s = store.get("alertSeen"); return s && s.d === TODAY() ? s : { d: TODAY(), ids: [] }; };
  const alertNew = () => { const s = alertSeen(); return alertList().filter((a) => a.lv !== "info" && !s.ids.includes(a.id)); };
  function alertBadge() { const b = $("#alertbadge"); if (!b) return; const n = alertNew().length; const red = alertList().some((a) => a.lv === "red"); b.hidden = !n; b.textContent = n; b.classList.toggle("red", red); }
  function openAlerts() {
    const list = alertList(); const s = alertSeen();
    modal(`<div class="al"><div class="pkhead"><h3>🔔 お知らせ</h3><small>${list.length ? `${list.length}件・大事な順` : ""}</small></div>
      <div class="allist">${list.map((a) => `<div class="alc ${a.lv}${s.ids.includes(a.id) ? " seen" : ""}"><div class="alh"><span class="ic">${a.icon}</span><b>${esc(a.title)}</b></div>${a.body ? `<p>${esc(a.body)}</p>` : ""}<button type="button" class="qc" data-alertgo="${a.act[1]}">${esc(a.act[0])} ›</button></div>`).join("") || `<div class="empty">気になることはないよ ✨ いい感じ！</div>`}</div>
      <div class="pkfoot"><button type="button" class="btn pri" data-alertok="1">確認した</button></div></div>`);
    $("#modal .sheet").classList.add("tall");
  }
  function alertsSeenAll() { const s = alertSeen(); store.set("alertSeen", { d: TODAY(), ids: [...new Set([...s.ids, ...alertList().map((a) => a.id)])] }); alertBadge(); }
  function alertGo(where) {
    alertsSeenAll(); closeModal();
    if (where === "review") { openReview(); return; }
    if (where === "judge") { openJudge(); return; }
    const [tab, seg] = where.split(":"); S.tab = tab; if (seg) S.logSeg = seg; render();
  }
  // 1日のはじめて開いたときに、まだ見ていない 赤・黄 のお知らせがあれば自動で出す
  function maybeAlert() {
    if (!$("#modal").hidden || !$("#page").hidden) return;
    const last = store.get("alertAuto"); if (last === TODAY()) return;
    if (!alertNew().length) return;
    store.set("alertAuto", TODAY()); openAlerts();
  }
