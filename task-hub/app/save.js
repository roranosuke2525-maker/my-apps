  // ================= 節約：3月まで、家の必要なものだけ買う =================
  // 区分（DB_タスク管理「買い物の区分」）：🏠 家財＝必要経費（買ってよい）／🧴 消耗品＝補充／🙋 じぶん＝欲しいもの（解除日まで封印・いつか）
  const KINDS_BUY = [["🏠 家財", "🏠 家財"], ["🧴 消耗品", "🧴 消耗品"], ["🙋 じぶん", "🙋 じぶん（封印）"]];
  const K = { home: "🏠 家財", stock: "🧴 消耗品", me: "🙋 じぶん" };
  const APP_PAGE = "40662844acbe81b98894fc88719d6ea8"; // DB_アプリ「今どこ」：本文の「⚙️ 今どこの設定」に予算と解除日
  const yen = (n) => `¥${Math.round(n || 0).toLocaleString()}`;
  const sumP = (list) => list.reduce((a, t) => a + (t.price || 0), 0);
  const isBuy = (t) => t.tag === "BUY" || !!t.kind;
  const openBuy = () => S.tasks.filter((t) => isBuy(t) && ![ST.done, ST.ref].includes(t.status) && !t.parent?.length && !t.refill?.length);
  const homeItems = () => openBuy().filter((t) => t.kind === K.home);
  const sealed = () => S.tasks.filter((t) => t.kind === K.me && ![ST.done, ST.ref].includes(t.status));
  const unsorted = () => openBuy().filter((t) => !t.kind);
  const boughtMonth = () => S.bought.filter((t) => t.kind && t.kind !== K.me);
  const daysLeft = () => diffDays(TODAY(), S.saveCfg.until);
  // 設定（本文の行をそのまま持ち、書き換えは置き換えで）
  async function loadSaveCfg() {
    const res = await call("fetch", { id: APP_PAGE });
    const txt = String(res?.text || "");
    const b = txt.match(/家財の予算（月）[：:]\s*([\d,]+)/); const u = txt.match(/封印の解除日[：:]\s*(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    return { budget: b ? Number(b[1].replace(/,/g, "")) : 30000, until: u ? `${u[1]}-${u[2].padStart(2, "0")}-${u[3].padStart(2, "0")}` : "2027-03-31", rawB: b?.[0] || "", rawU: u?.[0] || "" };
  }
  function saveAlerts() {
    let n = unsorted().length;
    const spent = sumP(boughtMonth()); if (S.saveCfg.budget && spent > S.saveCfg.budget) n++;
    if (daysLeft() <= 0 && sealed().length) n++;
    return n;
  }
  function renderSave(view) {
    const home = homeItems(), seal = sealed(), un = unsorted(), bought = boughtMonth();
    const spent = sumP(bought); const budget = S.saveCfg.budget || 0; const pct = budget ? Math.min(100, Math.round((spent / budget) * 100)) : 0; const left = daysLeft();
    const unlocked = left <= 0;
    view.insertAdjacentHTML("beforeend", `<div class="card savehero">
        <div class="ttl2"><b>${unlocked ? "封印が解けました" : "3月まで超節約"}</b><span class="mute" style="font-size:12px">家の必要なものだけ</span><small>${unlocked ? "解除日を過ぎました" : `あと ${left}日`}</small></div>
        <div class="savenums">
          <div><small>🏠 家財 残り</small><b>${home.length}<span class="yen">件</span></b><span class="yen">${yen(sumP(home))}</span></div>
          <div><small>🙋 封印中</small><b>${seal.length}<span class="yen">件</span></b><span class="yen">${yen(sumP(seal))}</span></div>
          <div><small>今月 買った</small><b>${bought.length}<span class="yen">件</span></b><span class="yen">${yen(spent)}</span></div>
        </div>
        <button type="button" class="bud${budget && spent > budget ? " over" : ""}" data-savecfg="1" style="text-align:left"><span class="lb"><span>今月の家財の予算</span><b>${yen(spent)} / ${budget ? yen(budget) : "未設定"}</b></span><span class="bar"><i style="width:${pct}%"></i></span><span class="lb"><span>${budget && spent > budget ? `⚠ ${yen(spent - budget)} 超えています` : budget ? `残り ${yen(budget - spent)}` : "タップして予算を決める"}</span><span>${S.saveCfg.until.replace(/-/g, "/")} に解除</span></span></button>
      </div>
      <div class="seg" id="saveseg">${[["home", "🏠 家財", home.length], ["seal", "🙋 封印", seal.length], ["sort", "区分なし", un.length], ["done", "今月", bought.length]].map(([k, n, x]) => `<button type="button" data-saveseg="${k}" aria-pressed="${S.saveSeg === k || (S.saveSeg === "home" && k === "home")}">${n}<span class="n">${x}</span></button>`).join("")}</div>
      <div class="card panel"><div class="scroll swipey" id="savelist"></div></div>`);
    const box = $("#savelist"); const seg = ["home", "seal", "sort", "done"].includes(S.saveSeg) ? S.saveSeg : "home";
    const rowB = (t, opts = {}) => `<div class="rw"><div class="row${t.kind === K.me ? " sealed" : ""}" data-id="${t.id}" style="--c:${t.kind === K.home ? "var(--s-done)" : t.kind === K.me ? "var(--mute)" : "var(--s-next)"}">${opts.check === false ? `<span class="dot"></span>` : `<button type="button" class="check" data-bought="${t.id}" aria-label="買った"></button>`}<button type="button" class="main" data-open="${t.id}"><span class="nm">${esc(t.name)}</span><span class="sub">${esc([t.next, t.date && t.kind !== K.me ? `${md(t.date)}（${WD[dow(t.date)]}）` : "", t.tag && t.tag !== "BUY" ? t.tag : ""].filter(Boolean).join("・") || `${ageOf(t)}日前から`)}</span></button><span class="price">${t.price != null ? yen(t.price) : "—"}</span><button type="button" class="meta qbtn" data-quick="${t.id}" aria-label="区分・日付を変える"><i aria-hidden="true">▾</i></button></div></div>`;
    let html = "";
    if (seg === "home") {
      html += `<div class="rules"><b>買ってよいもの＝家に必要な家財・設備・消耗品。</b>買う前の3つ：①家に要る？ ②今要る？ ③代わりで足りない？　○ を押すと「買った」になり今月の予算に入ります。</div>`;
      html += home.length ? home.sort((a, b) => (a.date || "9").localeCompare(b.date || "9") || (b.price || 0) - (a.price || 0)).map(rowB).join("") : `<div class="alldone"><b>家財のリストは空です</b><span>下の「家財を足す」から。揃ったら封印を解く日です</span></div>`;
      html += `<div class="saveadd"><button type="button" class="btn pri" data-saveadd="home">＋ 家財を足す</button><button type="button" class="btn" data-saveadd="me">🙋 欲しいものを封印</button></div>`;
    } else if (seg === "seal") {
      html += `<div class="rules"><b>${unlocked ? "解除日を過ぎました。上から1つずつ、買うか手放すか決めましょう。" : `自分の欲しいものは ${S.saveCfg.until.replace(/-/g, "/")} まで封印。`}</b>見るだけ・足すだけ。▾ から「やっぱり家財」にも変えられます。</div>`;
      html += seal.length ? seal.sort((a, b) => (b.price || 0) - (a.price || 0)).map((t) => rowB(t, { check: unlocked })).join("") : `<div class="alldone"><b>封印中のものはありません</b><span>欲しくなったら「欲しいものを封印」に入れて、3月に見直します</span></div>`;
      html += `<div class="saveadd"><button type="button" class="btn" data-saveadd="me">🙋 欲しいものを封印</button></div>`;
    } else if (seg === "sort") {
      html += `<div class="rules"><b>区分がまだの買い物。</b>▾ か ▾ の中のチップで 🏠 家財／🧴 消耗品／🙋 じぶん に振り分けます。じぶん は いつか・解除日の日付になります。</div>`;
      html += un.length ? un.map((t) => `<div class="rw"><div class="row" data-id="${t.id}" style="--c:var(--s-inbox)"><span class="dot"></span><button type="button" class="main" data-open="${t.id}"><span class="nm">${esc(t.name)}</span><span class="sub">${esc(t.next || t.tag || "")}</span></button><span class="kchip">${KINDS_BUY.map(([k, n]) => `<button type="button" class="qc" data-savekind="${t.id}" data-kind="${k}">${n.slice(0, 2)}</button>`).join("")}</span></div></div>`).join("") : `<div class="alldone"><b>全部 区分が付いています</b></div>`;
    } else {
      html += `<div class="rules"><b>今月買った家財・消耗品（${yen(spent)}）。</b>価格が空のものは ▾ から入れると予算に数えます。</div>`;
      html += bought.length ? bought.sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((t) => rowB(t, { check: false })).join("") : `<div class="alldone"><b>今月はまだ買っていません</b></div>`;
    }
    box.innerHTML = html;
  }
  // 区分を変える（じぶん → いつか＋解除日、家財 → 日付なしなら次にやる）
  async function setKind(t, kind) {
    const props = { "買い物の区分": kind };
    if (kind === K.me) { props["ステータス"] = ST.some; Object.assign(props, dateProps(S.saveCfg.until)); }
    else if (t.status === ST.some && t.kind === K.me) { props["ステータス"] = ST.next; Object.assign(props, dateProps(null)); }
    closeModal();
    await setProps(t, props, `「${short(t.name)}」→ ${kind}${kind === K.me ? `（${S.saveCfg.until.replace(/-/g, "/")} まで封印）` : ""}`);
  }
  async function markBought(t) {
    const ok = await setProps(t, { "ステータス": ST.done, ...dateProps(TODAY()) }, `「${short(t.name)}」を買いました${t.price != null ? `（${yen(t.price)}）` : ""}`);
    if (ok && t.kind && t.kind !== K.me && !S.bought.includes(t)) { S.bought.unshift(t); refresh(); }
  }
  // 足す：家財（次にやる）／欲しいもの（いつか・解除日）
  let saveAddKind = "home";
  function openSaveAdd(kind) {
    saveAddKind = kind;
    const me = kind === "me";
    modal(`<h3>${me ? "🙋 欲しいものを封印する" : "🏠 家財を足す"}</h3><div class="form">
      <label for="sv-name">名前</label><input id="sv-name" type="text" maxlength="200" placeholder="${me ? "例）Switch2 のソフト" : "例）寝室のカーテン"}">
      <label for="sv-price">だいたいの価格（円）</label><input id="sv-price" type="number" inputmode="numeric" min="0" step="100" placeholder="例）12000">
      <label for="sv-next">${me ? "ひとこと（なぜ欲しい）" : "次の一歩"}</label><input id="sv-next" type="text" maxlength="200" placeholder="${me ? "例）子どもと遊びたい" : "例）窓の幅を測る"}">
      <p class="mute" style="margin:0;font-size:12px">${me ? `いつか に入り、${S.saveCfg.until.replace(/-/g, "/")} に見直す日付が付きます。今日の一覧には出ません` : "次にやる に入り、○ を押すと「買った」になって今月の予算に数えます"}</p>
      <div style="display:flex;gap:8px"><button type="button" class="btn pri" data-savego="1" style="flex:1">${me ? "封印する" : "足す"}</button><button type="button" class="btn" data-mclose="1">やめる</button></div></div>`);
    setTimeout(() => $("#sv-name")?.focus(), 50);
  }
  async function submitSaveAdd() {
    const name = $("#sv-name").value.trim(); if (!name) { $("#sv-name").focus(); return; }
    const price = $("#sv-price").value.trim(); const next = $("#sv-next").value.trim(); const me = saveAddKind === "me";
    const btn = $("[data-savego]"); btn.disabled = true;
    try {
      const t = await createTask({ name, kind: "task", next: me ? "" : next, memo: me ? next : "", extra: { "分類タグ": "BUY", "買い物の区分": me ? K.me : K.home, ...(price ? { "価格": Number(price) } : {}), ...(me ? { "ステータス": ST.some, ...dateProps(S.saveCfg.until) } : { "ステータス": ST.next }) } });
      t.kind = me ? K.me : K.home; t.price = price ? Number(price) : null; if (me) { t.status = ST.some; t.date = S.saveCfg.until; }
      closeModal(); S.saveSeg = me ? "seal" : "home"; refresh(); toast(me ? `「${short(name)}」を封印しました（${S.saveCfg.until.replace(/-/g, "/")} まで）` : "家財に足しました");
    } catch (err) { btn.disabled = false; toast(`入れられませんでした：${errText(err)}`); }
  }
  // 設定：予算と解除日（DB_アプリ「今どこ」の本文の行を書き換える）
  function openSaveCfg() {
    modal(`<h3>節約の設定</h3><div class="form">
      <label for="sv-budget">今月の家財の予算（円・月）</label><input id="sv-budget" type="number" inputmode="numeric" min="0" step="1000" value="${S.saveCfg.budget || ""}">
      <label for="sv-until">封印の解除日</label><input id="sv-until" type="date" value="${S.saveCfg.until}">
      <p class="mute" style="margin:0;font-size:12px">Notion の DB_アプリ「今どこ」の本文「⚙️ 今どこの設定」に保存します</p>
      <div style="display:flex;gap:8px"><button type="button" class="btn pri" data-savecfgok="1" style="flex:1">保存</button><button type="button" class="btn" data-mclose="1">やめる</button></div></div>`);
  }
  async function submitSaveCfg() {
    const budget = Number($("#sv-budget").value || 0); const until = $("#sv-until").value || S.saveCfg.until;
    const before = { ...S.saveCfg }; S.saveCfg = { ...S.saveCfg, budget, until }; closeModal(); refresh();
    if (S.mode === "demo") { toast("設定を変えました（見本）"); return; }
    const ups = [];
    if (before.rawB) ups.push({ old_str: before.rawB, new_str: `家財の予算（月）：${budget.toLocaleString()}` });
    if (before.rawU) ups.push({ old_str: before.rawU, new_str: `封印の解除日：${until.replace(/-/g, "/")}` });
    try {
      if (ups.length) await call("update", { page_id: APP_PAGE, command: "update_content", content_updates: ups, allow_async: false }, { read: false });
      else await call("update", { page_id: APP_PAGE, command: "insert_content", content: `\n## ⚙️ 今どこの設定\n\n- 家財の予算（月）：${budget.toLocaleString()}\n- 封印の解除日：${until.replace(/-/g, "/")}\n`, position: { type: "end" }, allow_async: false }, { read: false });
      S.saveCfg.rawB = `家財の予算（月）：${budget.toLocaleString()}`; S.saveCfg.rawU = `封印の解除日：${until.replace(/-/g, "/")}`;
      toast("設定を保存しました");
    } catch (err) { S.saveCfg = before; refresh(); toast(`保存できませんでした：${errText(err)}`); }
  }
