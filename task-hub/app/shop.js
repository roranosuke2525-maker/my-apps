  // ================= 買う：買い物リスト（BUYタスクの本文のチェックリスト）と在庫（DB_Daily） =================
  const SHOP_OPEN = [ST.next, ST.doing, ST.inbox, ST.wait];
  const TODO_RE = /^(\s*)[-*+] \[( |x|X)\] ?(.*)$/;
  const shopScroll = {}; // 描き直してもスクロール位置を保つ
  document.addEventListener("scroll", (e) => { if (e.target.id === "shopbox" || e.target.id === "stockbox") shopScroll[e.target.id] = e.target.scrollTop; }, true);
  const keepScroll = (box) => { box.scrollTop = shopScroll[box.id] || 0; };
  const shopRaw = {}; // タスクid → { edited, raw }
  const shopQ = {}; // タスクid → 書き込みの順番待ち
  const shopLists = () => S.tasks.filter((t) => SHOP_OPEN.includes(t.status) && (t.tag === "BUY" || t.refill?.length))
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (b.edited || "").localeCompare(a.edited || ""));
  const openRefills = (id) => S.tasks.filter((t) => t.refill?.includes(id) && t.status !== ST.done);
  const stockSoon = () => S.stock.filter((x) => x.left != null && x.left <= 3 && !openRefills(x.id).length);
  const leftTx = (x) => (x.left == null ? "" : x.left < 0 ? `切れて${-x.left}日` : x.left === 0 ? "今日切れる" : `あと${x.left}日`);
  const leftColor = (x) => (x.left == null ? "var(--s-some)" : x.left <= 0 ? "var(--late)" : x.left <= 7 ? "var(--s-today)" : "var(--ok)");

  function shopParse(raw) {
    const lines = raw.split("\n"); const items = []; let group = "";
    lines.forEach((l, i) => {
      const h = l.match(/^#{1,4}\s+(.+)$/) || l.match(/^<h[1-4][^>]*>(.*)<\/h[1-4]>\s*$/);
      if (h) { group = text(h[1]); return; }
      const m = l.match(TODO_RE);
      if (m) items.push({ li: i, depth: (m[1].match(/\t/g) || []).length + Math.floor(m[1].replace(/\t/g, "").length / 2), done: m[2] !== " ", text: text(m[3]) || "（空）", group });
    });
    return { lines, items };
  }
  // lines[i..j] を、本文の中で1か所だけになるまで前後に広げる
  function uniqSpan(lines, i, j, raw) {
    let a = i, b = j;
    while (raw.split(lines.slice(a, b + 1).join("\n")).length - 1 > 1 && (a > 0 || b < lines.length - 1)) { if (a > 0) a--; else b++; }
    return [a, b];
  }
  // 1つ前の書き込みが終わってから次を書く（同じページへの書き込みが追い越さないように）
  function shopWrite(id, job) {
    const p = (shopQ[id] || Promise.resolve()).then(job, job);
    shopQ[id] = p.catch(() => {});
    return p;
  }
  async function shopFail(t, err) {
    toast(/No matches found/i.test(String(err?.message || "")) ? "Notion 側でリストが変わっていました。読み直します" : `書き込めませんでした：${errText(err)}`);
    setSync("err");
    try { shopRaw[t.id] = { edited: t.edited, raw: await fetchBody(t.id) }; } catch { delete shopRaw[t.id]; }
    if (S.tab === "shop") render();
  }
  function touched(t) { t.edited = new Date().toISOString(); if (shopRaw[t.id]) shopRaw[t.id].edited = t.edited; }

  let shopLoading = false;
  async function loadShopBodies() {
    if (shopLoading || S.mode === "loading" || S.mode === "error") return;
    const todo = shopLists().filter((t) => shopRaw[t.id]?.edited !== t.edited).slice(0, 12);
    if (!todo.length) return;
    shopLoading = true;
    const worker = async () => { for (let t; (t = todo.shift());) { try { shopRaw[t.id] = { edited: t.edited, raw: await fetchBody(t.id) }; } catch { shopRaw[t.id] = { edited: t.edited, raw: "", err: true }; } } };
    await Promise.all([worker(), worker(), worker()]);
    shopLoading = false;
    if (S.tab === "shop" && S.shopSeg === "list" && $("#page").hidden && !document.activeElement?.matches("#shopin")) render();
  }

  function renderShop(view) {
    const lists = shopLists(); const soon = stockSoon().length;
    view.insertAdjacentHTML("beforeend", `<div class="seg">${[["list", "買い物リスト", lists.length], ["stock", "在庫・補充", soon ? `${soon}!` : S.stock.length]].map(([k, n, x]) => `<button type="button" data-shopseg="${k}" aria-pressed="${S.shopSeg === k}">${n}<span class="n">${x}</span></button>`).join("")}</div>`);
    if (S.shopSeg === "stock") return renderStock(view);
    // 足す先：チェックリストのあるリスト（なければ新しく作る）
    const targets = lists.filter((t) => shopRaw[t.id] ? shopParse(shopRaw[t.id].raw).items.length || !shopRaw[t.id].raw.trim() : /BUY|買い物/.test(t.name));
    if (!targets.some((t) => t.id === S.shopTarget)) S.shopTarget = targets[0]?.id || "";
    view.insertAdjacentHTML("beforeend", `<div class="card shopadd"><input id="shopin" type="text" maxlength="120" placeholder="買うものを足す（例：牛乳）" aria-label="買うもの" enterkeyhint="done">
      <select id="shopto" aria-label="足す先">${targets.map((t) => `<option value="${t.id}" ${t.id === S.shopTarget ? "selected" : ""}>${esc(short(t.name, 12))}</option>`).join("")}<option value="" ${S.shopTarget ? "" : "selected"}>＋ 新しいリスト</option></select>
      <button type="button" class="btn pri" data-shopadd="1">足す</button></div>
      <div class="card panel"><div class="panel-head"><b>買うもの</b><span class="mute" style="font-size:12px">BUY のタスク ${lists.length}件</span><div class="seg"><button type="button" data-shophide="1" aria-pressed="${S.shopHide}">買えたものを隠す</button></div></div><div class="shop" id="shopbox"></div></div>`);
    const box = $("#shopbox");
    if (!lists.length) { box.innerHTML = `<div class="empty">買うものはありません。\n上の欄から足すか、在庫・補充から選べます</div>`; return; }
    box.innerHTML = lists.map(shopCard).join(""); keepScroll(box);
    loadShopBodies();
  }
  function shopCard(t) {
    const m = metaOf(t); const got = shopRaw[t.id];
    const link = t.link ? `<a class="buylink" href="${esc(t.link)}" target="_blank" rel="noopener">🛒 開く</a>` : "";
    const head = `<div class="shead"><button type="button" class="sname" data-open="${t.id}">${esc(t.name)}</button>${link}<span class="meta${m.late ? " late" : ""}">${esc(t.date ? m.tx : STAGES[stageOf(t)].name)}</span></div>`;
    if (!got) return `<section class="slist">${head}<div class="mute sline">読みこみ中…</div></section>`;
    const { items } = shopParse(got.raw);
    if (!items.length) {
      // チェックリストのない買い物（1品だけ・ネット注文など）は、タスクごと済みにする
      return `<section class="slist one" style="--c:var(--s-today)"><div class="row"><button type="button" class="check" data-done="${t.id}" aria-label="買えた">✓</button><button type="button" class="main" data-open="${t.id}"><span class="nm">${esc(t.name)}</span><span class="sub">${esc(t.next || (t.refill?.length ? "補充" : ""))}</span></button>${link}<span class="meta${m.late ? " late" : ""}">${esc(t.date ? m.tx : "")}</span></div></section>`;
    }
    const left = items.filter((x) => !x.done).length; let g = null;
    const rowsHtml = items.filter((x) => !(S.shopHide && x.done)).map((x) => {
      const gh = x.group !== g ? ((g = x.group) ? `<div class="sgroup">${esc(g)}</div>` : "") : "";
      return `${gh}<button type="button" class="sitem${x.done ? " on" : ""}" data-shopitem="${t.id}:${x.li}" style="--d:${x.depth}" aria-pressed="${x.done}"><span class="check${x.done ? " on" : ""}" aria-hidden="true">✓</span><span class="tx">${esc(x.text)}</span></button>`;
    }).join("");
    const done = items.length - left;
    return `<section class="slist">${head}<div class="sprog"><i style="--p:${Math.round((done / items.length) * 100)}%"></i><span>${done}/${items.length}</span></div>${rowsHtml || `<div class="mute sline">全部買えました</div>`}
      <div class="sfoot">${done ? `<button type="button" class="btn" data-shopclear="${t.id}">買えた${done}品をリストから消す</button>` : ""}${!left ? `<button type="button" class="btn ok" data-shopdone="${t.id}">買い物を終える（済みにする）</button>` : ""}</div></section>`;
  }

  function toggleItem(id, li) {
    const t = known.get(id); const got = shopRaw[id]; if (!t || !got) return;
    const lines = got.raw.split("\n"); const line = lines[li]; const m = line?.match(TODO_RE); if (!m) return;
    const nl = line.replace(/\[( |x|X)\]/, m[2] === " " ? "[x]" : "[ ]");
    const [a, b] = uniqSpan(lines, li, li, got.raw);
    const old = lines.slice(a, b + 1).join("\n"); lines[li] = nl; const nw = lines.slice(a, b + 1).join("\n");
    got.raw = lines.join("\n"); touched(t); render();
    if (S.mode === "demo") { DEMO_BODIES[id] = got.raw; return; }
    setSync("busy");
    shopWrite(id, async () => {
      try { await call("update", { page_id: id, command: "update_content", content_updates: [{ old_str: old, new_str: nw }], allow_async: false }, { read: false }); setSync("ok"); }
      catch (err) { await shopFail(t, err); }
    });
  }
  async function addItem() {
    const i = $("#shopin"); const name = i.value.trim(); if (!name) { i.focus(); return; }
    const item = `- [ ] ${name.replace(/([\\*_`<>[\]~])/g, "\\$1")}`;
    const t = known.get($("#shopto").value);
    i.value = ""; i.focus();
    if (!t) {
      try { const nt = await createShopTask({ "名前": "買い物リスト", "枠": "🏠 家・外" }, item); shopRaw[nt.id] = { edited: nt.edited, raw: item }; S.shopTarget = nt.id; render(); toast("新しい買い物リストを作りました"); $("#shopin")?.focus(); }
      catch (err) { i.value = name; toast(`作れませんでした：${errText(err)}`); }
      return;
    }
    S.shopTarget = t.id;
    const got = shopRaw[t.id] || { raw: "" }; const lines = got.raw.split("\n");
    // 最後のチェック項目（とその下の入れ子）の後ろに足す。チェック項目がなければ本文の最後へ
    let k = -1; lines.forEach((l, n) => { if (TODO_RE.test(l)) k = n; });
    let job;
    if (k >= 0) {
      let j = k; const ind = lines[k].match(/^\s*/)[0].length; while (j + 1 < lines.length && lines[j + 1].trim() && lines[j + 1].match(/^\s*/)[0].length > ind) j++;
      const [a, b] = uniqSpan(lines, k, j, got.raw);
      const old = lines.slice(a, b + 1).join("\n"); const nwLines = lines.slice(a, b + 1); nwLines.splice(j - a + 1, 0, item);
      const nw = nwLines.join("\n"); lines.splice(j + 1, 0, item);
      job = () => call("update", { page_id: t.id, command: "update_content", content_updates: [{ old_str: old, new_str: nw }], allow_async: false }, { read: false });
    } else {
      if (got.raw.trim()) lines.push(""); lines.push(item);
      job = () => call("update", { page_id: t.id, command: "insert_content", content: item, allow_async: false }, { read: false });
    }
    shopRaw[t.id] = { ...got, raw: lines.join("\n").replace(/^\n+/, "") }; touched(t); render(); $("#shopin")?.focus();
    if (S.mode === "demo") { DEMO_BODIES[t.id] = shopRaw[t.id].raw; return; }
    setSync("busy");
    shopWrite(t.id, async () => { try { await job(); setSync("ok"); } catch (err) { await shopFail(t, err); } });
  }
  // 買えた項目（と、その下の入れ子）を本文から消す
  function clearChecked(id) {
    const t = known.get(id); const got = shopRaw[id]; if (!t || !got) return;
    const lines = got.raw.split("\n"); const chunks = [];
    for (let n = 0; n < lines.length; n++) {
      const m = lines[n].match(TODO_RE); if (!m || m[2] === " ") continue;
      let j = n; const ind = m[1].length; while (j + 1 < lines.length && lines[j + 1].trim() && lines[j + 1].match(/^\s*/)[0].length > ind) j++;
      const last = chunks.at(-1); if (last && last[1] === n - 1) last[1] = j; else chunks.push([n, j]);
      n = j;
    }
    if (!chunks.length) return;
    const keep = lines.filter((_, n) => !chunks.some(([a, b]) => n >= a && n <= b));
    const updates = chunks.map(([s, e]) => {
      let a = s, b = e; // 前後の1行を含めて1か所に決める
      if (a > 0) a--; else if (b < lines.length - 1) b++;
      [a, b] = uniqSpan(lines, a, b, got.raw);
      return { old_str: lines.slice(a, b + 1).join("\n"), new_str: lines.slice(a, b + 1).filter((_, k) => k + a < s || k + a > e).join("\n") };
    });
    const whole = !keep.some((l) => l.trim());
    got.raw = keep.join("\n"); touched(t); render();
    toast(`買えた ${chunks.reduce((n, [a, b]) => n + b - a + 1, 0)}行をリストから消しました`);
    if (S.mode === "demo") { DEMO_BODIES[id] = got.raw; return; }
    setSync("busy");
    shopWrite(id, async () => {
      try {
        if (whole) await call("update", { page_id: id, command: "replace_content", new_str: "", allow_async: false }, { read: false });
        else await call("update", { page_id: id, command: "update_content", content_updates: updates, allow_async: false }, { read: false });
        setSync("ok");
      } catch (err) { await shopFail(t, err); }
    });
  }

  async function createShopTask(props, content) {
    const now = new Date().toISOString();
    const all = { "ステータス": ST.next, "分類タグ": "BUY", "重さ": "S", "プレイヤー": [PLAYER], ...props };
    const local = (u) => toTask({ url: u, 名前: all["名前"], NEXT: all.NEXT || "", ステータス: all["ステータス"], 分類タグ: "BUY", 枠: all["枠"] || null, 重さ: "S", "userDefined:URL": all["userDefined:URL"] || "", 補充対象: JSON.stringify(all["補充対象"] || []), 最終更新日時: now, createdTime: now });
    if (S.mode === "demo") { const t = local(`https://www.notion.so/${"d".repeat(24)}${String(Date.now()).slice(-8)}`); S.tasks.push(t); DEMO_BODIES[t.id] = content || ""; return t; }
    setSync("busy");
    try {
      const res = await call("create", { parent: { type: "data_source_id", data_source_id: DS.task }, pages: [{ properties: all, ...(content ? { content } : {}) }], allow_async: false }, { read: false });
      const pg = (res.pages || [])[0] || {}; const t = local(pg.url || `https://www.notion.so/${String(pg.id || "").replace(/-/g, "")}`); S.tasks.push(t); saveSnap(); setSync("ok"); return t;
    } catch (err) { setSync("err"); throw err; }
  }

  // ---------- 在庫・補充 ----------
  function renderStock(view) {
    if (S.extraErr.stock && !S.stock.length) { view.insertAdjacentHTML("beforeend", `<div class="card panel"><div class="empty">DB_Daily を読めませんでした。\n${esc(S.extraErr.stock)}\n${VIA === "api" ? "Notion のインテグレーションを DB_Daily にも接続してください" : ""}</div></div>`); return; }
    const all = S.stock.map(stockCalc);
    const cats = [...new Set(all.map((x) => x.cat).filter(Boolean))];
    const out = all.filter((x) => x.left != null && x.left <= 0).length, week = all.filter((x) => x.left != null && x.left > 0 && x.left <= 7).length, listed = all.filter((x) => openRefills(x.id).length).length;
    view.insertAdjacentHTML("beforeend", `<div class="aihead"><div class="card"><div class="k">切れている</div><div class="n" style="color:var(--late)">${out}</div><div class="s">予定日を過ぎた</div></div><div class="card"><div class="k">7日以内</div><div class="n" style="color:var(--s-today)">${week}</div><div class="s">そろそろ買う</div></div><div class="card"><div class="k">リスト済み</div><div class="n">${listed}</div><div class="s">補充タスクあり</div></div></div>
      <div class="chips"><button type="button" class="chip" data-stockcat="" aria-pressed="${!S.stockCat}">すべて<span class="n">${all.length}</span></button>${cats.map((c) => `<button type="button" class="chip" data-stockcat="${esc(c)}" aria-pressed="${S.stockCat === c}">${esc(c)}<span class="n">${all.filter((x) => x.cat === c).length}</span></button>`).join("")}</div>
      <div class="card panel"><div class="shop" id="stockbox"></div></div>`);
    const items = all.filter((x) => !S.stockCat || x.cat === S.stockCat).sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9) || a.name.localeCompare(b.name, "ja"));
    const box = $("#stockbox");
    if (!items.length) { box.innerHTML = `<div class="empty">${S.mode === "loading" ? "読みこみ中…" : "在庫の登録がありません"}</div>`; return; }
    box.innerHTML = items.map((x) => {
      const open = openRefills(x.id);
      const sub = [x.cat, x.left == null ? (x.use ? "購入日が未入力" : "使う数が未入力") : `${md(x.end)}まで`].filter(Boolean).join("・");
      return `<div class="row stockrow" style="--c:${leftColor(x)}"><span class="dot"></span><button type="button" class="main" data-stock="${x.id}"><span class="nm">${esc(x.name)}</span><span class="sub">${esc(sub)}</span></button><span class="meta${x.left != null && x.left <= 0 ? " late" : ""}">${esc(leftTx(x))}</span>
        ${open.length ? `<button type="button" class="btn ok sm" data-stockdone="${x.id}">補充した</button>` : `<button type="button" class="btn sm" data-stockadd="${x.id}">🛒 リストへ</button>`}</div>`;
    }).join(""); keepScroll(box);
  }
  // DB_Daily の「補充」ボタンと同じ形の補充タスクを作る（補充対象でつなぐと、済みにした日が最終補充日になる）
  async function stockAdd(id, btn) {
    const x = S.stock.find((s) => s.id === id); if (!x || openRefills(id).length) return;
    btn.disabled = true;
    try {
      await createShopTask({ "名前": `補充:${x.name}`, NEXT: x.link ? "リンクから注文する" : "買う", "枠": x.link ? "☼ 朝" : "🏠 家・外", "補充対象": [x.url], ...(x.link ? { "userDefined:URL": x.link } : {}) });
      render(); toast(`「${short(x.name)}」を買い物リストに入れました`);
    } catch (err) { btn.disabled = false; toast(`入れられませんでした：${errText(err)}`); }
  }
  async function stockDone(id) {
    const x = S.stock.find((s) => s.id === id); if (!x) return;
    const prev = S.refillDone[id];
    S.refillDone[id] = TODAY(); stockCalc(x);
    const ok = await Promise.all(openRefills(id).map((t) => setProps(t, { "ステータス": ST.done }, `「${short(x.name)}」を補充しました（${leftTx(x) || "記録"}）`, { undo: false })));
    if (ok.includes(false)) { if (prev) S.refillDone[id] = prev; else delete S.refillDone[id]; stockCalc(x); }
    saveSnap(); render();
  }
  function openStock(id) {
    const x = S.stock.find((s) => s.id === id); if (!x) return; stockCalc(x);
    const per = x.use && x.freq ? `${x.freq} ${x.use}${x.size ? `（1個 ${x.size}）` : ""}` : "";
    const fields = [["カテゴリ", x.cat], ["残り", leftTx(x)], ["切れる予定日", x.end ? `${md(x.end)}（${WD[dow(x.end)]}）` : ""], ["補充した日", x.base ? md(x.base) : ""], ["使い方", per], ["1個で", x.days != null ? `${x.days}日もつ` : ""], ["メモ", x.memo], ["URL", x.link], ["補充タスク", openRefills(id).map((t) => t.name).join("・")]];
    openPage({ kind: "stock", id: x.id, url: x.url, title: x.name, titleProp: "名前", fields, crumb: "DB_Daily ／ 在庫" });
  }

  function onShopClick(d, el) {
    if (d.shopseg) { S.shopSeg = d.shopseg; render(); return true; }
    if (d.shophide) { S.shopHide = !S.shopHide; render(); return true; }
    if (d.shopitem) { const k = d.shopitem.lastIndexOf(":"); toggleItem(d.shopitem.slice(0, k), +d.shopitem.slice(k + 1)); return true; }
    if (d.shopadd) { addItem(); return true; }
    if (d.shopclear) { clearChecked(d.shopclear); return true; }
    if (d.shopdone) { const t = known.get(d.shopdone); if (t) move(t, "done"); return true; }
    if (d.stockcat !== undefined && el.classList.contains("chip")) { S.stockCat = d.stockcat; render(); return true; }
    if (d.stockadd) { stockAdd(d.stockadd, el); return true; }
    if (d.stockdone) { stockDone(d.stockdone); return true; }
    if (d.stock) { openStock(d.stock); return true; }
    return false;
  }
  document.addEventListener("keydown", (e) => { if (e.target.id === "shopin" && e.key === "Enter" && !e.isComposing) { e.preventDefault(); addItem(); } });
  document.addEventListener("change", (e) => { if (e.target.id === "shopto") S.shopTarget = e.target.value; });
