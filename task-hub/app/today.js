  // ================= 今日：片づけることに絞ったホーム（残り・遅れ・枠ごとの一覧・済み・次にやるから足す） =================
  const buzz = (ms = 10) => { try { navigator.vibrate?.(ms); } catch { /* 無ければ何もしない */ } };
  function renderToday(view) {
    const d = TODAY(); const today = stageItems("today"); const late = today.filter((t) => t.date < d); const rest = today.filter((t) => t.date >= d);
    const done = S.doneToday.length; const total = today.length + done; const pct = total ? Math.round((done / total) * 100) : 0;
    const loading = S.mode === "loading" && !S.tasks.length;
    if (S.mode === "error" && !S.tasks.length) { view.insertAdjacentHTML("beforeend", `<div class="card panel"><div class="empty errbox"><b>読み込めませんでした</b><span>${esc(S.error || "")}</span><button type="button" class="btn pri" id="retry">もう一度</button></div></div>`); return; }
    const doing = today.find((t) => t.status === ST.doing); const first = doing || late[0] || rest[0];
    const tip = adviceTop();
    // 進み具合の輪
    const R = 24, C = 2 * Math.PI * R;
    view.insertAdjacentHTML("beforeend", `<div class="hero card">
        <svg class="ring" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="${R}" class="bg"/><circle cx="30" cy="30" r="${R}" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct / 100)}"/><text x="30" y="34" text-anchor="middle">${loading ? "…" : `${pct}%`}</text></svg>
        <div class="ht">${loading ? `<b>読みこみ中…</b>` : today.length ? `<b>のこり ${today.length}件</b><span>${done ? `${done}件 終わった` : "まだ手つかず"}${late.length ? `・<em>遅れ ${late.length}</em>` : ""}</span>` : `<b>今日は全部終わり ✨</b><span>${done ? `${done}件 片づけた` : "何もありません"}</span>`}</div>
        ${first ? `<div class="hnext"><button type="button" class="hopen" data-open="${first.id}"><small>${doing ? "▶ いま やっている" : "まず これ"}</small><span>${esc(first.name)}</span>${first.next ? `<small class="mute">${esc(first.next)}</small>` : ""}</button><button type="button" class="check big" data-done="${first.id}" aria-label="済みにする">✓</button></div>` : ""}
      </div>
      ${S.error && S.tasks.length ? `<button type="button" class="stale" id="retry">⚠ 更新できていません（${S.loadedAt ? jstTime(S.loadedAt) : "前"}のデータを表示）　↻ もう一度</button>` : ""}
      ${tip && tip.pri >= 50 ? `<button type="button" class="tipbar" data-concierge="1"><span class="ic">${tip.icon}</span><span class="tx"><b>提案</b>${esc(tip.title)}</span><i>›</i></button>` : ""}
      <div class="card panel"><div class="scroll swipey" id="todaylist"></div></div>`);
    const box = $("#todaylist");
    const sec = (title, list, extra = "") => (list.length ? `<div class="sech${extra}"><span>${esc(title)}</span><small>${list.length}</small></div>${list.map((t, i) => rowHtml(t, i, { meta: "weight" })).join("")}` : "");
    let html = "";
    if (late.length) html += `<div class="sech late"><span>遅れ</span><small>${late.length}</small><button type="button" class="qc" data-cact="late:today">全部 今日に</button></div>${late.map((t, i) => rowHtml(t, i, { meta: "late" })).join("")}`;
    const groups = new Map(); for (const t of rest) { const k = t.waku || "枠なし"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    for (const k of [...WAKU, "枠なし"]) if (groups.has(k)) html += sec(k, groups.get(k));
    if (!today.length && !loading) html += `<div class="alldone"><b>${done ? "おつかれさまでした" : "今日の予定はありません"}</b><span>次にやるから1つ選んで、今日に入れてみましょう</span></div>`;
    // 済み（たたむ）
    if (done) html += `<details class="donebox"${!today.length ? " open" : ""}><summary><span>済み</span><small>${done}</small></summary>${S.doneToday.map((t, i) => rowHtml(t, i, { check: false })).join("")}</details>`;
    // 次にやる から足す
    const next = stageItems("next").slice(0, 8);
    if (next.length) html += `<details class="nextbox"${!today.length ? " open" : ""}><summary><span>次にやる から足す</span><small>${inStage("next").length}</small></summary>${next.map((t) => `<div class="row pick" data-id="${t.id}" style="--c:var(--s-next)"><span class="dot"></span><button type="button" class="main" data-open="${t.id}"><span class="nm">${esc(t.name)}</span><span class="sub">${esc(t.next || t.tag || `${ageOf(t)}日`)}</span></button><button type="button" class="qc" data-pulltoday="${t.id}">今日</button></div>`).join("")}${inStage("next").length > 8 ? `<button type="button" class="morelink" data-gostage="next">すべて見る ›</button>` : ""}</details>`;
    box.innerHTML = html || `<div class="empty">読みこみ中…</div>`;
    box.insertAdjacentHTML("beforeend", `<div class="ghint mute">→ 右にスワイプで済み　← 左で明日　長押しで日付・状態</div>`);
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
