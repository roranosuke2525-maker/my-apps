  // ================= 描画 =================
  const main = $("#main");
  function render() {
    for (const b of document.querySelectorAll("nav [data-tab]")) b.setAttribute("aria-pressed", String(b.dataset.tab === S.tab));
    const mine = myTurn().length; const bd = $("#aibadge"); bd.hidden = !mine; bd.textContent = mine;
    const soon = stockSoon().length; const sb = $("#shopbadge"); sb.hidden = !soon; sb.textContent = soon;
    $("#date").textContent = TODAY_TXT();
    const warped = render.lastTab && render.lastTab !== S.tab; render.lastTab = S.tab;
    main.innerHTML = `<div class="view${warped && !reduce ? " warp" : ""}"></div>`;
    if (warped) stars.warp();
    const view = $(".view", main);
    ({ flow: renderFlow, ai: renderAi, triage: renderTriage, shop: renderShop, news: renderNews, log: renderLog, db: renderDbHome })[S.tab](view);
    S.slide = null;
    bondSync(); renderConciergeFab();
    try { history.replaceState(null, "", `#${S.tab}`); } catch { /* なし */ }
  }
  // 画面とページ（開いていれば）を描き直す
  function refresh() { render(); if (PG && $("#pprops") && !document.activeElement?.closest("#pprops")) { $("#pprops").innerHTML = propsHtml(); drawAiBar(); } }

  // ================= 操作 =================
  document.addEventListener("click", (e) => {
    // URL・ページへのリンクは押せば開く（本文の中でも）
    const a = e.target.closest("a[href]");
    if (a && ED && ED.box.contains(a)) { e.preventDefault(); openLink(a.getAttribute("href")); return; }
    const mn = e.target.closest(".mention[data-src]");
    if (mn) { const u = (decodeURIComponent(mn.dataset.src).match(/url="([^"]+)"/) || [])[1]; if (u) { e.preventDefault(); openLink(u); return; } }
    if (a) return;
    if (ED && ED.box.contains(e.target)) { onEdClick(e); return; }
    if (swipe.suppress) { e.preventDefault(); return; }
    if (e.target.id === "modal") { closeModal(); return; }
    const el = e.target.closest("button, tr[data-open], tr[data-dbrow], [data-open]"); if (!el) return;
    const d = el.dataset;
    if (el.id === "add") { openCapture(); return; }
    if (el.id === "reload") { load(); return; }
    if (d.tab) { S.tab = d.tab; if (d.tab !== "db") S.dbOpen = null; render(); return; }
    if (d.stage) { S.stage = d.stage; render(); return; }
    if (d.sview) { S.stageView = d.sview; render(); return; }
    if (d.done) { const t = known.get(d.done); if (!t) return; el.classList.add("on"); el.closest(".row")?.classList.add("gone"); setTimeout(() => move(t, "done"), reduce ? 0 : 300); return; }
    if (d.pg) { const [key, dir] = [d.pg.slice(0, d.pg.lastIndexOf(":")), +d.pg.slice(d.pg.lastIndexOf(":") + 1)]; S.page[key] = (S.page[key] || 0) + dir; S.slide = { key, dir }; render(); return; }
    if (d.aiseg) { S.aiSeg = d.aiseg; render(); return; }
    if (d.reqmode) { reqMode = d.reqmode; for (const b of document.querySelectorAll("[data-reqmode]")) b.setAttribute("aria-pressed", String(b === el)); return; }
    if (d.req) { submitRequest(); return; }
    if (d.pickai) { pickForAi(); return; }
    if (d.aipick) { const t = known.get(d.aipick); closeModal(); if (t) setProps(t, { "ステータス": ST.ai, "AIアクション": reqMode }, `AIに預けました（${reqMode}・次の定時処理 ${nextRun()}）`); return; }
    if (d.pile) { S.pileKey = d.pile; render(); return; }
    if (d.dir) { const c = $(".tcard.top"); if (c) fling(c, d.dir); return; }
    if (d.sub) { const c = $(".tcard.top"); if (!c) return; const t = known.get(c.dataset.card); if (d.sub === "open") openTask(t.id); else if (d.sub === "skip") { skipped.add(t.id); render(); } else move(t, d.sub); return; }
    if (d.logseg) { S.logSeg = d.logseg; render(); return; }
    if (d.ev !== undefined && el.classList.contains("chip")) { S.logEvent = d.ev; render(); return; }
    if (d.diag) { openRecord("diag", d.diag); return; }
    if (d.log) { openRecord("log", d.log); return; }
    if (d.goal) { openRecord("goal", d.goal); return; }
    if (d.proj) { openRecord("proj", d.proj); return; }
    if (d.dbsec) { S.dbSec = d.dbsec; render(); return; }
    if (d.db) { openDb(d.db); return; }
    if (d.dbback) { S.dbOpen = null; render(); return; }
    if (d.dbview) { S.dbView = d.dbview; render(); return; }
    if (d.dbrow !== undefined) { openDbRow(+d.dbrow); return; }
    if (d.close) { closePage(); return; }
    if (d.qopt) { const [qi, oi] = d.qopt.split(":").map(Number); const o = PG.qa.qs[qi].opts[oi]; o.checked = !o.checked; el.setAttribute("aria-pressed", String(o.checked)); return; }
    if (d.qa) { sendQa(d.qa === "send"); return; }
    if (d.aiset !== undefined) { const t = PG.task; const v = d.aiset || null; setProps(t, v ? { "AIアクション": v, ...(t.status === ST.ai ? {} : { "ステータス": ST.ai }) } : { "AIアクション": null }, v ? `AIアクションを ${v} にしました` : "AIの印を外しました").then(() => { $("#pprops").innerHTML = propsHtml(); drawAiBar(); }); return; }
    if (d.mv) { aiDecide(d.mv); return; }
    if (d.again) { aiAgain(d.again); return; }
    if (d.cleardate) { setProps(PG.task, dateProps(null), "実行日を外しました").then(() => { $("#pprops").innerHTML = propsHtml(); }); return; }
    if (d.cap) { const nm = $("#cp-name")?.value || ""; capKind = d.cap; openCapture(); $("#cp-name").value = nm; return; }
    if (d.capgo) { submitCapture(); return; }
    if (d.mclose) { closeModal(); return; }
    if (d.quick) { openQuick(d.quick); return; }
    if (d.qk) { const host = el.closest("[data-qt]"); const t = host && known.get(host.dataset.qt); if (!t) return; const inS = !!el.closest("#scene"); if (!inS && el.closest("#modal")) closeModal(); applyQuick(t, d.qk).then(() => { if (inS && !$("#scene").hidden) { openConcierge("log"); } }); return; }
    if (d.mopen) { closeModal(); if (!$("#scene").hidden) closeScene(); openTask(d.mopen); return; }
    if (d.sceneclose) { closeScene(); return; }
    if (d.evskip) { openConcierge("album"); return; }
    if (d.evplay) { const ev = EVENTS.find((x) => x.key === d.evplay); if (ev) playEvent(ev); return; }
    if (d.scenelog !== undefined) { openConcierge(`log:${Math.max(0, +d.scenelog)}`); $("#logat")?.scrollIntoView({ block: "start" }); return; }
    if (d.scenepanel !== undefined) { openConcierge(d.scenepanel); return; }
    if (d.stagestep) { stageStep(+d.stagestep); return; }
    if (d.concierge) { openConcierge(); return; }
    if (d.cact) { conciergeAct(d.cact); return; }
    if (d.avpick) { openConcierge("closet"); return; }
    if (d.outfit) { store.set("outfit", d.outfit); openConcierge("closet"); renderConciergeFab(); toast(d.outfit === "auto" ? "服は季節と時間で着替えます" : `${CNAME}の服を「${outfit().label}」に固定しました`); return; }
    if (d.newsday) { S.newsDay = d.newsday; render(); return; }
    if (d.newsarea !== undefined && el.closest(".seg")) { S.newsArea = d.newsarea; render(); return; }
    if (d.newshide) { S.newsHide = !S.newsHide; render(); return; }
    if (d.newsstate) { const k = d.newsstate.indexOf(":"); setNews(d.newsstate.slice(0, k).split(","), d.newsstate.slice(k + 1)); return; }
    if (d.newsopen) { openNews(d.newsopen); return; }
    if (onShopClick(d, el)) return;
    if (d.open) { openTask(d.open); }
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches?.("[data-prop]")) onPropChange(e.target);
    if (e.target.matches?.("[data-qdate]") && e.target.value) { const host = e.target.closest("[data-qt]"); const t = host && known.get(host.dataset.qt); if (!t) return; if (e.target.closest("#modal") && !e.target.closest(".concierge")) closeModal(); applyQuick(t, "d:pick", e.target.value); }
  });
  document.addEventListener("click", (e) => { const a = e.target.closest("[data-newsread]"); if (a) setNews([a.dataset.newsread], "読んだ", true); }, true);
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "ptitle" && e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.target.blur(); }
    if (e.target.matches?.('input[data-prop="NEXT"]') && e.key === "Enter" && !e.isComposing) e.target.blur();
    if (e.key === "Escape") { if (!$("#scene").hidden) { closeScene(); return; } if (document.querySelector(".menu")) closeMenus(); else if (!$("#modal").hidden) closeModal(); else if (!$("#page").hidden && !e.target.closest(".ed")) closePage(); }
  });
  document.addEventListener("focusout", (e) => { if (e.target.id === "ptitle") saveTitle(); });
  document.addEventListener("input", (e) => {
    if (e.target.id !== "dbq") return;
    S.dbQuery = e.target.value; S.page.db = 0; S.page.dbt = 0;
    const pos = e.target.selectionStart; render(); const i = $("#dbq"); if (i) { i.focus(); i.setSelectionRange(pos, pos); }
  });
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (!document.activeElement?.matches("input, textarea")) render(); }, 150); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.mode === "live" && Date.now() - (S.loadedAt || 0) > 10 * 60e3 && $("#page").hidden) load(); });

  // ================= 階層をスワイプで行き来する =================
  // ページ・DBの中：右へスワイプで1つ戻る／流れの一覧：左右で隣の段／下のタブバー：左右で隣のタブ
  const TABS = ["flow", "ai", "triage", "shop", "news", "log", "db"];
  (() => {
    let g = null;
    addEventListener("pointerdown", (e) => { if (e.button > 0) return; g = { x: e.clientX, y: e.clientY, t: performance.now(), el: e.target, id: e.pointerId }; }, true);
    addEventListener("pointerup", (e) => {
      if (!g || e.pointerId !== g.id) return; const G = g; g = null;
      const dx = e.clientX - G.x, dy = e.clientY - G.y; if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || performance.now() - G.t > 700) return;
      const el = G.el instanceof Element ? G.el : null; if (!el) return;
      if (el.closest("input, textarea, select, [data-swipe], .board, .tablewrap, .tcard, .menu")) return;
      const edge = G.x < 40;
      if (!$("#scene").hidden) return;
      if (!$("#modal").hidden) { if (dx > 0 && el.closest("#modal")) closeModal(); return; }
      if (!$("#page").hidden) { if (dx > 0 && (edge || !el.closest(".ed"))) { swipeGuard(); closePage(); } return; }
      if (el.closest("nav.tabs")) { const i = TABS.indexOf(S.tab) + (dx < 0 ? 1 : -1); if (TABS[i]) { swipeGuard(); S.tab = TABS[i]; if (S.tab !== "db") S.dbOpen = null; render(); } return; }
      if (S.tab === "db" && S.dbOpen && dx > 0) { swipeGuard(); S.dbOpen = null; render(); return; }
      if (S.tab === "flow" && el.closest("[data-swipestage], .pipe, .park")) { swipeGuard(); stageStep(dx < 0 ? 1 : -1); }
    }, true);
    function swipeGuard() { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; addEventListener("click", stop, { capture: true, once: true }); setTimeout(() => removeEventListener("click", stop, { capture: true }), 300); }
  })();

  // ================= 星空（タブを変えるとワープ） =================
  const stars = (() => {
    const cv = $("#stars"); const c = cv.getContext("2d"); let W = 0, H = 0, pts = [], warpUntil = 0, raf = 0;
    const size = () => { const dpr = Math.min(2, devicePixelRatio || 1); W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr; pts = Array.from({ length: Math.round((innerWidth * innerHeight) / 2600) }, () => ({ x: Math.random() * W, y: Math.random() * H, z: Math.random(), t: Math.random() * 6 })); };
    function frame(now) {
      raf = 0; const w = now < warpUntil; const k = w ? (warpUntil - now) / 450 : 0;
      c.clearRect(0, 0, W, H);
      for (const p of pts) {
        const tw = .55 + .45 * Math.sin(now / 900 + p.t);
        if (w) { const dx = p.x - W / 2, dy = p.y - H / 2; const len = (1 - k) * 0.25 + 0.04; c.strokeStyle = `rgba(190,225,255,${.35 + p.z * .5})`; c.lineWidth = 1 + p.z; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + dx * len, p.y + dy * len); c.stroke(); }
        else { c.fillStyle = `rgba(${200 + p.z * 55},${215 + p.z * 40},255,${(.25 + p.z * .6) * tw})`; c.fillRect(p.x, p.y, 1 + p.z * 1.4, 1 + p.z * 1.4); }
        p.y += (.02 + p.z * .06) * (w ? 0 : 1); if (p.y > H) p.y = 0;
      }
      if (!reduce && !document.hidden) raf = requestAnimationFrame(frame);
    }
    size(); addEventListener("resize", size);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !raf) raf = requestAnimationFrame(frame); });
    raf = requestAnimationFrame(frame);
    return { warp() { if (reduce) return; warpUntil = performance.now() + 450; if (!raf) raf = requestAnimationFrame(frame); } };
  })();

  // ================= 起動 =================
  async function load() {
    setSync("busy"); $("#synct").textContent = "読みこみ中";
    const mcp = await getMcp();
    if (!mcp) { useDemo(); return; }
    if (VIA === "api" && !store.get("key")) await askKey(false);
    try { await loadLive(); S.mode = "live"; S.error = null; setSync("ok"); }
    catch (err) { S.error = errText(err); S.mode = S.tasks.length ? "live" : "error"; setSync("err"); toast(S.error); }
    render();
    if (!load.dbDone) { load.dbDone = true; refreshDbList(); }
    if (S.tab === "news" || S.newsAt) loadNews();
    if (S.mode === "live") maybeGreet();
    prefetchBodies();
  }
  const DEMO_BODY = "<table-of-contents />\n\n## ☑️ ToDo\n\n- [x] 候補を3つに絞る\n- [ ] 寸法を測る\n  - [ ] 幅と奥行き\n- [ ] 色を決める\n\n郵便受けに雨が入るので対策を考えたい\n\n## メモ\n\n（例）次の打ち合わせで聞く";
  const DEMO_BODIES = {};
  const DEMO_SCHEMA = { a: { name: "名前", type: "title" }, b: { name: "ステータス", type: "status" }, c: { name: "日付", type: "date" }, d: { name: "メモ", type: "text" } };
  const DEMO_ROWS = ["（例）エチオピア ゲイシャ", "（例）ケニア AA", "（例）コロンビア", "（例）グアテマラ", "（例）ブラジル"].map((n, i) => ({ url: `https://www.notion.so/${"e".repeat(31)}${i}`, 名前: n, ステータス: ["飲みたい", "飲んだ", "飲んだ", "飲みたい", "定番"][i], "date:日付:start": addDays(TODAY(), -i * 9), メモ: ["華やか", "酸味", "バランス", "チョコ", "毎日"][i] }));
  function useDemo() {
    S.mode = "demo"; known.clear();
    const d = TODAY(); let n = 0;
    const id = () => (`${(++n).toString(16)}${"0".repeat(32)}`).slice(0, 32);
    const mk = (name, status, o = {}) => toTask({ url: `https://www.notion.so/${id()}`, 名前: `（例）${name}`, ステータス: status, NEXT: o.next || "", "date:実行日:start": o.date || null, 枠: o.waku || null, 重さ: o.w || null, 分類タグ: o.tag || null, AIアクション: o.ai || null, 最終更新日時: new Date(Date.now() - (o.age || 1) * 86400e3).toISOString(), createdTime: new Date(Date.now() - (o.made ?? (o.age || 1)) * 86400e3).toISOString(), "userDefined:URL": o.url || "", プロジェクト: o.pj ? JSON.stringify([`https://www.notion.so/${o.pj}`]) : "[]" });
    const P1 = "a".repeat(32), P2 = "b".repeat(32), P3 = "c".repeat(32);
    S.tasks = [
      mk("資源ごみを出す", ST.next, { date: d, waku: "☼ 朝", w: "S", tag: "HOME", next: "7:30までに玄関前へ" }),
      mk("保険の住所変更をWEBで申請する", ST.next, { date: addDays(d, -2), waku: "☼ 朝", w: "S", tag: "MONEY", next: "契約者サービスにログインする" }),
      mk("ペグボードの棚板を選ぶ", ST.doing, { date: d, waku: "🏠 家・外", w: "L", tag: "HOME", pj: P1, next: "天板から画面上端までの高さを測る" }),
      mk("家計の振込", ST.next, { date: d, waku: "💻 PC", w: "S", tag: "MONEY", next: "口座へ振り込む" }),
      mk("歯医者の予約", ST.next, { date: addDays(d, 3), waku: "☼ 朝", w: "S", tag: "HEALTH" }),
      mk("応援購入を決める（締切）", ST.next, { date: addDays(d, 5), waku: "☼ 朝", w: "S", tag: "TECH" }),
      mk("車の点検", ST.next, { date: addDays(d, 9), waku: "🏠 家・外", w: "M", tag: "CAR" }),
      mk("離乳食の進め方を理解する", ST.next, { waku: "💻 PC", w: "L", tag: "CHILD", age: 10, next: "月齢ごとの量を表にまとめる" }),
      mk("パスワードの管理先を一本化", ST.next, { waku: "💻 PC", w: "XL", tag: "TECH", age: 18, next: "どちらにするか決める" }),
      mk("傘置きを買うか決める", ST.next, { waku: "🏠 家・外", w: "S", tag: "BUY", age: 9, next: "玄関ドアに磁石が付くか確認" }),
      mk("施主支給分の見積", ST.doing, { waku: "💻 PC", w: "L", tag: "BUILD", pj: P2, age: 20, next: "メーカー3社に問い合わせる" }),
      ...["常夜灯の材料を買う", "気になるラーメン店", "読みたい本をメモ", "ベランダの掃除道具", "旅行の候補地", "コーヒー豆の次の候補"].map((x, i) => mk(x, ST.inbox, { tag: ["BUY", "FOOD", "BOOK", "HOME", "TRIP", "COFFEE"][i], w: i % 2 ? "S" : "M", age: i + 1, made: i < 2 ? 0 : i })),
      mk("郵便受けの改善を相談中", ST.wait, { waku: "☼ 朝", w: "M", tag: "BUILD", age: 18, pj: P2 }),
      mk("住所変更の反映待ち", ST.wait, { w: "S", tag: "HOME", age: 6 }),
      mk("ギター教室を探す", ST.some, { tag: "MUSIC", age: 30 }),
      mk("キャンプ道具をそろえる", ST.some, { tag: "TRIP", age: 22 }),
      mk("タスクアプリのUI案", ST.ai, { ai: "💭", tag: "AI", next: "質問票に答える", pj: P3, age: 1 }),
      mk("食洗機の比較（ビルトイン45cm）", ST.ai, { ai: "🔍✅", tag: "HOME", next: "比較表を見て決める", age: 0 }),
      mk("子ども用の自転車", ST.ai, { ai: "🔍✅", tag: "CHILD", age: 2 }),
      mk("ドリッパーを調べる", ST.ai, { ai: "🔍", tag: "COFFEE", age: 0 }),
      mk("電動自転車を市場ごと比較", ST.ai, { ai: "🔬", tag: "BUY", age: 1 }),
      mk("在宅ワークの椅子を決める", ST.ai, { ai: "💬", tag: "HOME", age: 1 }),
    ];
    const BUY = mk("買い物リスト", ST.next, { date: d, waku: "🏠 家・外", w: "S", tag: "BUY", next: "スーパーとドラッグストア" });
    DEMO_BODIES[BUY.id] = "## スーパー\n\n- [x] （例）キャベツ\n- [ ] （例）なす\n- [ ] （例）バナナ\n- [ ] （例）ポン酢\n\t- [ ] （例）ゆず入り\n\n## ドラッグストア\n\n- [ ] （例）おしりふき\n- [ ] （例）ハンドソープ詰め替え";
    S.tasks.push(BUY);
    const ST1 = "5".repeat(31) + "1", ST2 = "5".repeat(31) + "2";
    S.tasks.push(mk("補充:（例）A＆透明ポリ袋 45L", ST.next, { waku: "☼ 朝", w: "S", tag: "BUY", next: "リンクから注文する", url: "https://example.com" }));
    S.tasks.at(-1).refill = [ST2]; DEMO_BODIES[S.tasks.at(-1).id] = "";
    for (const t of S.tasks) if (t.tag === "BUY" && !(t.id in DEMO_BODIES)) DEMO_BODIES[t.id] = "";
    S.refillDone = {};
    S.stock = [["（例）おむつ Mサイズ", "育児", 6, "毎日", 58, -40], ["（例）ポリ袋 45L", "日用品", 3, "毎週", 10, -20], ["（例）ビタミンD", "サプリ", 1, "毎日", 60, -55], ["（例）食器用洗剤", "消耗品", 1, "毎月", 3, -60], ["（例）コーヒー豆", "食品", 20, "毎日", 200, -8], ["（例）洗顔フォーム", "美容", 0, "", 0, null]]
      .map(([name, cat, use, freq, size, ago], i) => stockCalc({ id: [ST1, ST2][i] || `${"5".repeat(31)}${i + 3}`, url: `https://www.notion.so/${[ST1, ST2][i] || `${"5".repeat(31)}${i + 3}`}`, name, cat, memo: "", link: i === 1 ? "https://example.com" : "", use, freq, size, bought: ago == null ? null : addDays(d, ago), rollup: null, formulaEnd: null }));
    S.doneToday = [mk("牛乳を買う", ST.done, { w: "S", waku: "🏠 家・外" }), mk("病院の予約", ST.done, { w: "S", waku: "☼ 朝" })];
    S.refs = ["コーヒー豆の保存方法", "加湿器の掃除のしかた", "ふるさと納税の上限"].map((x, i) => mk(x, ST.ref, { ai: "🔍✅", tag: ["COFFEE", "HOME", "MONEY"][i], age: i + 2 }));
    S.projects = [
      { id: P1, url: "https://www.notion.so/" + P1, name: "（例）書斎を仕上げる", status: "🔥 進行中", step: "デスク天板から画面上端までの高さを測る", now: "", total: 6 },
      { id: P2, url: "https://www.notion.so/" + P2, name: "（例）外構を整える", status: "🔥 進行中", step: "郵便受けの対策を決める", now: "", total: 9 },
      { id: P3, url: "https://www.notion.so/" + P3, name: "（例）タスクアプリ", status: "⏸ 保留", step: "UI案を決める", now: "", total: 4 },
    ];
    S.diag = [[1, .2, 25, 47, "3件選ぶのが億劫"], [2, .49, 49, 92, "特に壊れない"], [3, .31, 56, 109, "3件選ぶのが億劫"], [4, .35, 28, 88, "3件選ぶのが億劫"]].map(([no, rate, done, inflow, verdict]) => ({ id: `${"9".repeat(31)}${no}`, url: "https://www.notion.so/", name: `（例）診断レポート 第${no}回`, no, rate, done, inflow, verdict, next: "（例）朝は今日やるを生活の1件だけにする", from: addDays(d, -7 * (5 - no)), to: addDays(d, -7 * (4 - no)) }));
    S.logs = [["定期実行", "（例）AIリサーチ定時処理", "🔍 2件・💬 1件"], ["定期実行", "（例）ジャーナル作成", "終わった12件"], ["仕組み変更", "（例）SOMEDAYの見直し日をなしに", "AI一括処理・運用マップを更新"], ["定期実行", "（例）朝のニュース収集", "25件"], ["定期実行", "（例）AIリサーチ定時処理", "対象なし"], ["仕組み変更", "（例）DB_アプリを新設", ""], ["定期実行", "（例）タスク運用診断", "第4回"]].map(([event, name, body], i) => ({ id: `${"8".repeat(31)}${i}`, url: "https://www.notion.so/", event, name, body, at: new Date(Date.now() - i * 3600e3 * 5).toISOString() }));
    S.goals = [
      { id: "7".repeat(32), url: "https://www.notion.so/", name: "（例）タスク管理が効率的に回っている", status: "🔥 挑戦中", kind: "🎯 GOAL", area: "LEARN", due: null, why: "", goalBy: "", projects: [P3, P1] },
      { id: "6".repeat(32), url: "https://www.notion.so/", name: "（例）家族で本を読む習慣がある", status: "💭 種", kind: "🌟 VISION", area: "FAMILY", due: null, why: "", goalBy: "", projects: [] },
    ];
    const ai = S.tasks.filter((t) => t.ai);
    DEMO_BODIES[ai[0].id] = "<table-of-contents />\n\n## ☑️ ToDo\n\n- [x] 今の不満を書き出す\n- [ ] 質問票に答える\n\n## 💬 最新のやり取り（10/24 10:52）\n\n### ✍️ 受け取ったこと（検出 10/24 10:40）\n\n- 「AIリサーチの選別とやり取りを一番やりやすく」\n\n### ✅ 決めることリスト（10/24 10:52）\n\n- [x] よく使う機能\n- [x] 画面の数\n- [x] スクロールの扱い\n- [ ] ホームに置くもの\n- [ ] 本文の編集のしかた\n- [ ] 色の方針\n\n明確度 3/6＝50%\n\n**Q1. ホームにいちばん大きく置くものは？**\n\n- [ ] A. GTDの流れの図（⭐ 全体が見える）\n- [ ] B. 今日やるの一覧\n- [ ] C. AIのあなたの番\n- [ ] その他\n\n💬 コメント：\n\n**Q2. 本文はどう編集したい？**\n\n- [ ] A. Notionと同じように直接書く（⭐）\n- [ ] B. 追記だけでよい\n- [ ] その他\n\n💬 コメント：\n\n### 🗂 過去のやり取り（1件）\n\n<toggle>\n10/23 15:52 1回目 🔍 ─ 案を3つに絞った\n\n- ベント・リバー・デッキ\n</toggle>\n\n## メモ\n\n- 社内PCでも開けるように";
    DEMO_BODIES[ai[1].id] = "<table-of-contents />\n\n## ☑️ ToDo\n\n- [ ] 比較表を見て決める\n- [ ] 設置寸法を測る\n- [ ] 見積を取る\n\n## 🔍 調査結果（最新・2026/10/22 13:52）\n\n<callout icon=\"⭐\" color=\"yellow_bg\">\n**これにしておけばいい**：（例）パナソニックのミドルタイプ。45cm幅で5人分、静音で乾燥も強い\n</callout>\n\n### 📊 比較（10/22 13:52）\n\n| 候補 | 価格 | 容量 | 静音 |\n| --- | --- | --- | --- |\n| ⭐ （例）A社ミドル | 約12万円 | 5人分 | 38dB |\n| （例）B社ディープ | 約15万円 | 6人分 | 40dB |\n| （例）C社スリム | 約9万円 | 4人分 | 42dB |\n\n### ▶️ 次の手順（10/22 13:52）\n\n1. キッチンの開口寸法を測る\n2. 型番を決めて見積を取る\n3. 工事日を決める\n\n<toggle>\n詳しく（要点・注意点・参照）\n\n- 深型は入るか要確認\n- [（例）メーカー比較](https://example.com)\n</toggle>\n\n### 🗂 過去のやり取り（1件）\n\n<toggle>\n10/20 09:52 1回目 🔍 ─ 候補を広く洗い出した\n\n- 6機種を候補にした\n</toggle>\n\n## メモ\n\n- 予算は15万円まで";
    DEMO_BODIES[ai[2].id] = "## 🔍 調査結果（最新・2026/10/24 11:52）\n\n<callout icon=\"⭐\" color=\"yellow_bg\">\n**これにしておけばいい**：（例）16インチ・ペダルを外せるタイプ。身長105cmならちょうど\n</callout>\n\n### ▶️ 次の手順（10/24 11:52）\n\n1. 店で跨がってみる\n2. 色を決める";
    demoNews();
    S.loadedAt = Date.now(); render(); setSync("ok"); maybeGreet();
  }

  initDbs();
  S.bodies = store.get("sums") || {};
  const snap = store.get("snap");
  if (snap?.tasks?.length) {
    Object.assign(S, { tasks: snap.tasks, refs: snap.refs || [], projects: snap.projects || [], doneToday: Array.isArray(snap.doneToday) ? snap.doneToday : [], diag: snap.diag || [], logs: snap.logs || [], goals: snap.goals || [], stock: snap.stock || [], refillDone: snap.refillDone || {}, loadedAt: snap.at });
    for (const t of [...S.tasks, ...S.refs, ...S.doneToday]) known.set(t.id, t);
    if (jst(snap.at) !== TODAY()) S.doneToday = [];
  }
  try { const h = location.hash.slice(1); if (["flow", "ai", "triage", "shop", "news", "log", "db"].includes(h)) S.tab = h; } catch { /* なし */ }
  render();
  load();
  window.__imadoko = { parseMd, ser, mdToHtml, htmlToMd, qaParse, qaWrite, conclusionOf, buildUpdate: () => buildUpdate(), get ED() { return ED; } }; // 確認用
})();
</script>
