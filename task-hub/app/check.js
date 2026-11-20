  // ================= 診断タブ：ひと目で（色と新着）→ 答えていない判断 → ジャーナル → 健康診断・週次レポート =================
  // 「見た」はこの端末に覚える（レポートのIDごと）。答えていない判断は Notion のタスクから数えるので、どの端末でも同じ
  const seenAll = () => store.get("seen") || {};
  function markSeen(k, id) { if (!k || !id) return; const s = seenAll(); s[k] = id; store.set("seen", s); }
  const sigOf = (v) => (/🔴|停滞|悪化|危/.test(v || "") ? "red" : /🟡|注意|黄|横ばい/.test(v || "") ? "yellow" : /🟢|順調|良好|改善/.test(v || "") ? "green" : "info");
  const ASK_RE = /タスク診断|診断.*判断|判断に答える|目標の月次振り返り/;
  const openAsks = () => S.tasks.filter((t) => ASK_RE.test(t.name) && t.status !== ST.done && t.status !== ST.ref);
  function unseenReports() {
    const s = seenAll(); const d = S.diag.at(-1); const j = S.journal?.[0];
    return [d && s.diag !== d.id ? "diag" : null, j && s.jour !== j.id ? "jour" : null].filter(Boolean);
  }
  function checkBadge() { return S.mode === "loading" && !S.tasks.length ? 0 : unseenReports().length + openAsks().length + fixWaiting().length; }
  function checkCards() {
    const seen = seenAll(); const d = S.diag.at(-1); const prev = S.diag.at(-2); const j = S.journal?.[0];
    const checks = healthChecks(); const bad = checks.filter((c) => c.st === "red" || c.st === "yellow"); const red = checks.some((c) => c.st === "red");
    const asks = openAsks(); const live = S.goals.filter((g) => /挑戦中/.test(g.status)); const soon = live.filter((g) => g.due && diffDays(TODAY(), g.due) <= 30);
    const delta = d && prev ? Math.round((d.rate - prev.rate) * 100) : null;
    return [
      { k: "weekly", icon: "🩺", name: "週次の運用診断", sig: d ? (sigOf(d.verdict) !== "info" ? sigOf(d.verdict) : d.rate < .4 ? "red" : d.rate < .6 ? "yellow" : "green") : "info", main: d ? d.verdict || "判定なし" : "まだありません", sub: d ? `第${d.no}回・完了率 ${Math.round(d.rate * 100)}%${delta == null ? "" : `（${delta >= 0 ? "+" : ""}${delta}）`}${d.next ? `・次の一手：${d.next}` : ""}` : S.extraErr?.diag || "", unseen: !!d && seen.diag !== d.id },
      { k: "asks", icon: "✋", name: "答えていない判断", sig: asks.length ? (asks.some((t) => ageOf(t) >= 7) ? "red" : "yellow") : "green", main: asks.length ? `${asks.length}件` : "なし", sub: asks.length ? asks.map((t) => short(t.name, 16)).join("・") : "診断・振り返りの宿題はありません" },
      { k: "journal", icon: "📓", name: "ゆうべのジャーナル", sig: "info", main: j ? j.name : "まだありません", sub: j ? `済み ${j.done}件・AIとのやりとり ${j.ai}回${j.note ? "" : "・ひとこと未記入"}` : S.journalErr || "", unseen: !!j && seen.jour !== j.id },
      { k: "health", icon: "🏥", name: "いまの健康診断", sig: red ? "red" : bad.length ? "yellow" : "green", main: bad.length ? `直したい所 ${bad.length}つ` : "問題なし", sub: bad.map((c) => c.name).join("・") || "10項目すべて良好" },
      { k: "goal", icon: "🎯", name: "目標", sig: soon.length ? "yellow" : "info", main: `挑戦中 ${live.length}件`, sub: soon.length ? `期限30日以内：${soon.map((g) => short(g.name, 12)).join("・")}` : "毎月1日 8:10 に振り返り" },
      { k: "focus", icon: "⭐", name: "今週の重点", sig: focusList().some(isOpenT) ? (reviewDue() ? "yellow" : "green") : "red", main: focusList().length ? `${focusList().filter((t) => !isOpenT(t)).length} / ${focusList().length} 済み` : "未設定", sub: focusList().length ? focusList().map((t) => short(t.name, 12)).join("・") : "週の見直しで3つ選ぶ", go: "review", unseen: reviewDue() },
      { k: "fix", icon: "🛠", name: "アプリの改善", sig: fixWaiting().length ? "yellow" : "green", main: fixWaiting().length ? `${fixWaiting().length}件 判断待ち` : fixMoving().length ? `${fixMoving().length}件 進行中` : "なし", sub: fixWaiting().length ? fixWaiting().map((f) => short(f.name, 14)).join("・") : "文章で直しを頼めます", go: "fix", unseen: fixWaiting().some((f) => f.state === "💡 提案中") },
      { k: "sug", icon: "💡", name: "AIからの提案", sig: S.sugs.length ? "yellow" : "green", main: S.sugs.length ? `${S.sugs.length}件 待ち` : "なし", sub: S.sugs.length ? "採用か見送りを決める" : "毎朝 7:36 に届く", go: "concierge" },
    ];
  }
  function renderCheck(view) {
    renderDiagAll(view);
    const root = $("#diagall"); if (!root) return;
    const cards = checkCards(); const asks = openAsks(); const unseen = cards.filter((c) => c.unseen); const todo = unseen.length + asks.length;
    const j = S.journal?.[0]; const seen = seenAll();
    root.insertAdjacentHTML("afterbegin", `<section class="g-sec"><h3>ひと目で<small>色＝状態　赤い「新着」＝まだ見ていない</small></h3>
        <div class="ck-sum">${todo ? `<b>見ておくこと ${todo}件</b>　新着レポート ${unseen.length}・答えていない判断 ${asks.length}` : "<b>見落としはありません ✨</b>"}</div>
        <div class="ck-glance">${cards.map((c) => `<button type="button" class="ckc ${c.sig}" ${c.go === "concierge" ? 'data-concierge="1"' : c.go === "fix" ? 'data-logseg="fix"' : c.go === "review" ? 'data-review="1"' : `data-dgo="${c.k}"`}>${c.unseen ? '<span class="new">新着</span>' : ""}<span class="h"><span class="ic">${c.icon}</span>${esc(c.name)}</span><b>${esc(c.main)}</b><small>${esc(c.sub || "")}</small></button>`).join("")}</div></section>
      <section class="g-sec ck-sec" id="ck-asks"><h3>✋ 答えていない判断<small>診断・振り返りから出た宿題</small></h3><div class="ck-todo">${asks.length ? asks.map((t, i) => rowHtml(t, i, { check: false })).join("") : `<div class="empty">ありません</div>`}</div></section>
      <section class="g-sec ck-sec" id="ck-journal"><h3>📓 ゆうべのジャーナル<small>毎晩 20:53 に自動</small></h3><div class="jr" id="jrbox">${j ? `<p class="mute">読みこみ中…</p>` : `<div class="empty">${esc(S.journalErr || "ジャーナルはまだありません")}</div>`}</div>
        ${j ? `<div class="seenbar"><button type="button" class="btn" data-dany="jour:${j.id}">全文を開く</button>${seen.jour === j.id ? `<span class="mute" style="align-self:center">✓ 確認済み</span>` : `<button type="button" class="btn pri" data-dseen="jour:${j.id}">確認した</button>`}</div>` : ""}</section>`);
    // 週次レポートに「確認した」
    const d = S.diag.at(-1); const wk = $("#ck-weekly");
    if (d && wk) wk.insertAdjacentHTML("beforeend", `<div class="seenbar">${seen.diag === d.id ? `<span class="mute">✓ 第${d.no}回は確認済み</span>` : `<button type="button" class="btn pri" data-dseen="diag:${d.id}">第${d.no}回を確認した</button>`}</div>`);
    if (j) loadJournal(j);
  }
  // ジャーナル本文から「まとめ」「気になること」「明日の提案」を抜き出す
  const jourCache = {};
  async function loadJournal(j) {
    const draw = (secs) => { const b = $("#jrbox"); if (!b) return; b.innerHTML = secs.length ? secs.map((s) => `<div class="ask"><b>${esc(s.h)}</b>${s.lines.map((l) => `<p>${inline(l)}</p>`).join("")}</div>`).join("") : `<p class="mute">${esc(j.name)}（要点を読み取れませんでした。全文を開いてください）</p>`; };
    if (jourCache[j.id]) { draw(jourCache[j.id]); return; }
    if (S.mode === "demo") { jourCache[j.id] = [{ h: "⭐ 今日のまとめ", lines: ["（例）旅行から帰って、たまった買い物を2件決めた"] }, { h: "⚠️ 気になること", lines: ["（例）年末調整の書類が 11/16 まで"] }, { h: "☀️ 明日の提案", lines: ["（例）☼ 朝：保育園の慣らし保育を確認", "（例）💻 PC：年末調整の控除証明書をそろえる"] }]; draw(jourCache[j.id]); return; }
    try {
      const raw = await fetchBody(j.id); const L = raw.split("\n"); const secs = [];
      L.forEach((l, i) => {
        const m = l.match(/^#{1,4}\s*(.*(今日のまとめ|気になること|明日の提案).*)$/); if (!m) return;
        const lines = []; for (let k = i + 1; k < L.length && !/^#{1,4}\s/.test(L[k]); k++) { const t = L[k].replace(/^\s*([-*+]|\d+[.)])\s*(\[[ x]\]\s*)?/, "").trim(); if (t && !/^<\/?(table|tr|td|toggle|callout|details|summary)/.test(t)) lines.push(t); }
        if (lines.length) secs.push({ h: text(m[1]), lines: lines.slice(0, 4) });
      });
      jourCache[j.id] = secs;
    } catch { jourCache[j.id] = []; }
    draw(jourCache[j.id]);
  }
