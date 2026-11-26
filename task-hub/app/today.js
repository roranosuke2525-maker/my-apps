  // ================= 今日：流れと1つにまとめたタブ =================
  const buzz = (ms = 10) => { try { navigator.vibrate?.(ms); } catch { /* 無ければ何もしない */ } };
  // 11/26：「今日」と「流れ」は同じ中身なので1つのタブに。上のインデックスは流れの順（収集→次にやる→予定→今日→済み＋置き場）。
  // 開いたときは「今日」の段。今日の段は 持ち越し・今日・済み、予定の段は日ごと（近い順）に並べる。Notion の仕組みは変えない
  function renderToday(view) {
    if (S.mode === "error" && !S.tasks.length) { view.insertAdjacentHTML("beforeend", `<div class="card panel"><div class="empty errbox"><b>うまく読みこめなかった…</b><span>${esc(S.error || "")}</span><button type="button" class="btn pri" id="retry">もう一回ためす</button></div></div>`); return; }
    if (S.error && S.tasks.length) view.insertAdjacentHTML("beforeend", `<button type="button" class="stale" id="retry">⚠ 新しくできてないみたい（${S.loadedAt ? jstTime(S.loadedAt) : "前"}のデータを表示中）　↻ もう一回</button>`);
    renderFlow(view);
  }
  const secHead = (title, n, extra = "", btn = "") => `<div class="sech${extra}"><span>${esc(title)}</span><small>${n}</small>${btn}</div>`;
  const pullRows = (list) => list.map((t) => `<div class="row pick" data-id="${t.id}" style="--c:var(--s-next)"><span class="dot"></span><button type="button" class="main" data-open="${t.id}"><span class="nm">${esc(t.name)}</span><span class="sub">${esc([t.date ? metaOf(t).tx : "", t.next || t.tag || ""].filter(Boolean).join("・") || `${ageOf(t)}日`)}</span></button><button type="button" class="qc" data-pulltoday="${t.id}">今日</button></div>`).join("");
  // 今日の段：持ち越し → 今日 → 済み
  function todayListHtml(loading) {
    const d = TODAY(); const all = stageItems("today"); const lt = all.filter((t) => t.date < d); const now = all.filter((t) => t.date >= d); const done = S.doneToday.length;
    const rows = (list, meta) => list.map((t, i) => rowHtml(t, i, { meta })).join("");
    let html = "";
    if (lt.length) html += secHead("持ち越し（あせらずに）", lt.length, " late", `<button type="button" class="qc" data-cact="late:today">ぜんぶ今日に</button>`) + rows(lt, "late");
    if (now.length) html += secHead("今日", now.length) + rows(now, "weight");
    if (!all.length) html += loading ? `<div class="empty">読みこみ中…</div>` : `<div class="alldone"><b>${done ? "今日のぶんはおしまい！おつかれさま" : "今日やることはまだないよ"}</b><span>${done ? "よゆうがあれば「予定」や「次にやる」から1つ足してもいいし、休んでもいい" : "「予定」か「次にやる」から「今日」を押して入れよう"}</span></div>`;
    if (done) html += `<details class="donebox"${!all.length ? " open" : ""}><summary><span>済み</span><small>${done}</small></summary>${S.doneToday.map((t, i) => rowHtml(t, i, { check: false })).join("")}</details>`;
    return html + `<div class="ghint mute">→ 右にスワイプでできた！　← 左で明日に　長押しで日付・状態</div>`;
  }
  // 予定の段：1週間は日ごと、その先はまとめて
  function planListHtml(items) {
    const d = TODAY(); const w = addDays(d, 7); const byDay = new Map(); const later = [];
    for (const t of items) { if (t.date && t.date <= w) { if (!byDay.has(t.date)) byDay.set(t.date, []); byDay.get(t.date).push(t); } else later.push(t); }
    let html = "";
    for (const [day, ts] of byDay) html += secHead(`${day === addDays(d, 1) ? "明日" : WD[dow(day)] + "曜"}　${md(day)}`, ts.length) + pullRows(ts);
    if (later.length) html += secHead("先の予定（8日より先）", later.length) + pullRows(later);
    return html + `<div class="ghint mute">「今日」で今日の段へ　長押しで日付・状態</div>`;
  }

  // ================= 行の操作：スワイプ（右＝済み・左＝明日）と長押し（日付・状態の変更） =================
  (() => {
    let g = null, lpTimer = 0; const THR = 84;
    const guard = () => { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; addEventListener("click", stop, { capture: true, once: true }); setTimeout(() => removeEventListener("click", stop, { capture: true }), 350); };
    const cancel = () => { clearTimeout(lpTimer); if (g?.row) g.row.classList.remove("pressing"); g = null; };
    document.addEventListener("pointerdown", (e) => {
      const row = e.target.closest(".swipey .row[data-id]"); if (!row || e.button > 0 || e.target.closest("a")) return;
      const t = known.get(row.dataset.id); if (!t) return;
      g = { row, t, x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, moving: false, wrap: row.closest(".rw") };
      row.classList.add("pressing");
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => { if (!g || g.moving) return; const id = g.t.id; buzz(15); g.row.classList.remove("pressing"); g = null; guard(); openQuick(id); }, 450);
    }, { passive: true });
    document.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moving) { if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; clearTimeout(lpTimer); g.row.classList.remove("pressing"); if (Math.abs(dy) > Math.abs(dx)) { g = null; return; } g.moving = true; g.row.classList.add("swiping"); try { g.row.setPointerCapture(e.pointerId); } catch { /* 無視 */ } }
      const canDone = g.t.status !== ST.done; g.dx = canDone ? dx : Math.min(0, dx);
      g.row.style.transform = `translateX(${g.dx}px)`;
      const w = g.wrap; if (w) { w.classList.toggle("r", g.dx > 0); w.classList.toggle("l", g.dx < 0); w.classList.toggle("ready", Math.abs(g.dx) > THR); }
      if (Math.abs(g.dx) > THR && !g.buzzed) { g.buzzed = true; buzz(8); } if (Math.abs(g.dx) <= THR) g.buzzed = false;
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return; const G = g; cancel();
      G.row.classList.remove("swiping");
      if (!G.moving) return;
      guard();
      const w = G.wrap;
      if (G.dx > THR) { G.row.style.transform = "translateX(110%)"; G.row.classList.add("gone"); setTimeout(() => move(G.t, "done"), reduce ? 0 : 200); }
      else if (G.dx < -THR) { G.row.style.transform = "translateX(-110%)"; G.row.classList.add("gone"); setTimeout(() => move(G.t, G.t.status === ST.done ? "next" : "tomorrow"), reduce ? 0 : 200); }
      else { G.row.style.transform = ""; w?.classList.remove("r", "l", "ready"); }
    };
    document.addEventListener("pointerup", end); document.addEventListener("pointercancel", (e) => { if (g && e.pointerId === g.id) { g.row.style.transform = ""; g.wrap?.classList.remove("r", "l", "ready"); cancel(); } });
    // 長押し中にスクロールしたら取り消し
    document.addEventListener("scroll", cancel, true);
  })();

  // ================= もっと（読む・買う・ニュース・運用・DB） =================
  const MORE = [["ai", "AI", "AIに預けた・AIの番", () => myTurn().length], ["read", "読む", "しおりを挟んだ資料", () => S.readList.filter(isRead).length], ["shop", "買う", "買い物リストと在庫", () => stockSoon().length], ["news", "ニュース", "今朝の見出し", () => 0], ["log", "運用", "使い方と診断", () => 0], ["db", "DB", "すべてのデータベース", () => 0]];
  const MORE_ICON = { ai: `<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M9 9.5l1.5 1.5L13 8.5"/>`, read: `<path d="M3 5.5C5.5 4.5 8.5 4.5 12 6.5c3.5-2 6.5-2 9-1v13c-2.5-1-5.5-1-9 1-3.5-2-6.5-2-9-1z"/><path d="M12 6.5v13"/>`, shop: `<path d="M3 4h2.2l2.1 11h10.6L20 7.5H6"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>`, news: `<path d="M5 4h12v15a1 1 0 0 0 1 1H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z"/><path d="M17 8h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2M8 8h6M8 12h6M8 16h4"/>`, log: `<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`, db: `<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>` };
  const inMore = (tab) => MORE.some(([k]) => k === tab);
  function openMore() {
    modal(`<h3 class="mh">もっと</h3><div class="moregrid">${MORE.map(([k, n, d, badge]) => { const b = badge(); return `<button type="button" data-gotab="${k}" aria-pressed="${S.tab === k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${MORE_ICON[k]}</svg><b>${n}</b><small>${d}</small>${b ? `<i class="badge">${b}</i>` : ""}</button>`; }).join("")}</div><div class="form" style="padding-top:0"><button type="button" class="btn" data-mclose="1">閉じる</button></div>`);
  }
