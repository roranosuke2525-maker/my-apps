  // ================= 読む：書庫（📚 REFERENCE）にしおり（📖 すぐ読む）を挟んだものを集めて、その場で読む =================
  const READ_PROP = "📖 すぐ読む";
  const isRead = (t) => t?.read === "__YES__";
  // しおりのボタン（一覧の左端。資料の行ならどこでも押せる）
  const BM_SVG = (on) => `<svg viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`;
  const bmHtml = (t) => `<button type="button" class="bm${isRead(t) ? " on" : ""}" data-readtoggle="${t.id}" aria-label="${isRead(t) ? "すぐ読むから外す" : "すぐ読むに入れる"}" aria-pressed="${isRead(t)}">${BM_SVG(isRead(t))}</button>`;
  // 行の左端：資料ならしおり、それ以外は段の色の点
  const leadHtml = (t) => (t.status === ST.ref ? bmHtml(t) : `<span class="dot"></span>`);
  // しおりを挟む・外す
  async function setRead(t, on, msg) {
    const ok = await setProps(t, { [READ_PROP]: on ? "__YES__" : "__NO__" }, msg || (on ? `「${short(t.name)}」にしおりを挟みました` : `「${short(t.name)}」を読んだので外しました`));
    syncReadList(t);
    if (PG?.task === t && $("#pprops")) $("#pprops").innerHTML = propsHtml();
    return ok;
  }
  function syncReadList(t) {
    const i = S.readList.indexOf(t);
    if (isRead(t) && i < 0) S.readList.unshift(t);
    if (!isRead(t) && i >= 0) S.readList.splice(i, 1);
  }
  const readItems = () => S.readList.filter(isRead).filter((t) => !S.readTag || t.tag === S.readTag);

  function renderRead(view) {
    const all = S.readList.filter(isRead);
    view.insertAdjacentHTML("beforeend", `<div class="seg">${[["list", "しおり", all.length], ["shelf", "書庫", S.refs.length + (S.refMore ? "+" : "")]].map(([k, n, x]) => `<button type="button" data-readseg="${k}" aria-pressed="${(S.readSeg || "list") === k}">${n}<span class="n">${x}</span></button>`).join("")}</div>`);
    if (S.readSeg === "shelf") return renderShelf(view);
    const tags = [...new Set(all.map((t) => t.tag).filter(Boolean))];
    if (S.readTag && !tags.includes(S.readTag)) S.readTag = "";
    const items = readItems();
    view.insertAdjacentHTML("beforeend", `${tags.length > 1 ? `<div class="chips"><button type="button" class="chip" data-readtag="" aria-pressed="${!S.readTag}">すべて<span class="n">${all.length}</span></button>${tags.map((g) => `<button type="button" class="chip" data-readtag="${esc(g)}" aria-pressed="${S.readTag === g}">${esc(g)}<span class="n">${all.filter((t) => t.tag === g).length}</span></button>`).join("")}</div>` : ""}
      <div class="card panel"><div class="scroll" id="readbox"></div></div>`);
    const box = $("#readbox");
    if (!items.length) { box.innerHTML = `<div class="empty">${S.extraErr.read ? esc(S.extraErr.read) : "しおりを挟んだ資料はありません。\n「書庫」でしおり（📖）を押すと、ここに集まります"}</div>`; return; }
    box.innerHTML = `<div class="rhint mute">押すと読めます。左にスワイプで「読んだ」</div>` + items.map(readCard).join("");
    attachSwipe(box);
    prefetchRead(items);
  }
  function readCard(t) {
    const sm = S.bodies[t.id];
    const pv = sm?.conc ? `⭐ ${esc(short(sm.conc, 80))}` : t.next ? esc(t.next) : "";
    return `<div class="rwrap"><span class="rdone" aria-hidden="true">✓ 読んだ</span><article class="rcard" data-rid="${t.id}"><button type="button" class="rmain" data-reader="${t.id}"><span class="rt">${esc(t.name)}</span><span class="rs">${t.tag ? `<i>${esc(t.tag)}</i>` : ""}${t.ai === "🔍✅" ? "<i>🔍 調査結果</i>" : ""}<span class="mute">書庫 ${ageOf(t)}日</span></span>${pv ? `<span class="rp">${pv}</span>` : ""}</button></article></div>`;
  }
  // 左にスワイプで「読んだ」（カードが動いて、離すと外れる）
  function attachSwipe(box) {
    let g = null;
    box.addEventListener("pointerdown", (e) => { const c = e.target.closest(".rcard"); if (!c || e.button > 0) return; g = { c, x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, moving: false }; });
    box.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moving) { if (Math.abs(dx) < 10) return; if (Math.abs(dy) > Math.abs(dx)) { g = null; return; } g.moving = true; g.c.classList.add("swiping"); g.c.setPointerCapture?.(e.pointerId); }
      g.dx = Math.min(0, dx); g.c.style.transform = `translateX(${g.dx}px)`; g.c.parentElement.classList.toggle("ready", g.dx < -90);
      e.preventDefault();
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return; const G = g; g = null;
      G.c.classList.remove("swiping");
      if (!G.moving) return;
      const once = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; addEventListener("click", once, { capture: true, once: true }); setTimeout(() => removeEventListener("click", once, { capture: true }), 300);
      if (G.dx < -90) { G.c.style.transform = "translateX(-110%)"; const t = known.get(G.c.dataset.rid); setTimeout(() => { if (t) setRead(t, false); render(); }, reduce ? 0 : 180); }
      else { G.c.style.transform = ""; G.c.parentElement.classList.remove("ready"); }
    };
    box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
  }
  // 結論（⭐）を先読みして一覧に出す
  let readFetching = false;
  async function prefetchRead(items) {
    if (readFetching || S.mode === "loading" || S.mode === "error") return;
    const todo = items.filter((t) => !S.bodies[t.id] || S.bodies[t.id].edited !== t.edited).slice(0, 12); if (!todo.length) return;
    readFetching = true;
    const worker = async () => { for (let t; (t = todo.shift());) { try { S.bodies[t.id] = summarize(t, await fetchBody(t.id)); } catch { /* 次回 */ } } };
    await Promise.all([worker(), worker(), worker()]); readFetching = false; store.set("sums", S.bodies);
    if (S.tab === "read" && S.readSeg !== "shelf" && $("#page").hidden) render();
  }

  // ---- 書庫：最近の資料（＋名前で探せば古いものも Notion から）。しおりを押すだけで入る ----
  const SH = { q: "", remote: [], loading: false, seq: 0 };
  function renderShelf(view) {
    view.insertAdjacentHTML("beforeend", `<div class="sbox" style="flex:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input id="shq" type="search" placeholder="書庫を探す（古いものも）" value="${esc(SH.q)}" autocomplete="off"></div>
      <div class="card panel"><div class="scroll" id="shelfbox"></div></div>`);
    drawShelf();
    const i = $("#shq"); i.oninput = () => { SH.q = i.value; drawShelf(); shelfAsk(); };
  }
  function drawShelf() {
    const box = $("#shelfbox"); if (!box) return;
    const q = norm(SH.q.trim()); const ids = new Set();
    const local = S.refs.filter((t) => !q || norm(`${t.name} ${t.tag || ""} ${t.next || ""}`).includes(q));
    const items = [...local, ...SH.remote.filter((t) => !local.includes(t))].filter((t) => !ids.has(t.id) && ids.add(t.id));
    const row = (t) => `<div class="row" style="--c:var(--s-ref)">${bmHtml(t)}<button type="button" class="main" data-reader="${t.id}"><span class="nm">${esc(t.name)}</span><span class="sub">${esc([t.tag, `書庫 ${ageOf(t)}日`].filter(Boolean).join("・"))}</span></button><span class="meta mute">›</span></div>`;
    box.innerHTML = `<div class="rhint mute">${SH.loading ? "Notion を検索中…" : q ? `${items.length}件` : `最近の書庫 ${S.refs.length}件${S.refMore ? "（古いものは名前で探せます）" : ""}`}　しおり（📖）を押すと「しおり」に入ります</div>` + (items.map(row).join("") || `<div class="empty">${SH.loading ? "" : "見つかりませんでした"}</div>`);
  }
  let shelfTimer;
  function shelfAsk() {
    clearTimeout(shelfTimer); SH.remote = [];
    const q = SH.q.trim(); if (q.length < 2 || S.mode === "demo") { SH.loading = false; drawShelf(); return; }
    SH.loading = true; drawShelf(); const my = ++SH.seq;
    shelfTimer = setTimeout(async () => {
      try {
        const res = await call("query", { data: { mode: "rows", data_source_url: `collection://${DS.task}`, filter: { type: "group", operator: "and", filters: [statusFilter(ST.ref), { type: "property", property: "名前", propertyType: "title", operator: "string_contains", value: { type: "exact", value: q.split(/\s+/)[0] } }] }, sort: [{ property: "最終更新日時", direction: "descending" }], limit: 40 } });
        if (my !== SH.seq) return;
        SH.remote = (res.results || []).map((r) => known.get(idOf(r.url)) || toTask(r));
      } catch { /* 読み込み済みだけ */ }
      if (my !== SH.seq) return; SH.loading = false; drawShelf();
    }, 350);
  }

  // ---- 読む画面：本文だけを大きく。下に「読んだ」と「次へ」 ----
  function openReader(id, from = "read") {
    const t = known.get(id); if (!t) return;
    const P = { kind: "reader", id: t.id, url: t.url, title: t.name, task: t, from }; PG = P;
    const el = $("#page"); el.hidden = false;
    const list = readItems(); const i = list.indexOf(t); const next = i >= 0 ? list[i + 1] : null;
    el.innerHTML = `<div class="pbar"><button type="button" class="iconbtn" data-close="1" aria-label="戻る">‹</button><span class="crumb">読む${i >= 0 ? `　${i + 1} / ${list.length}` : ""}</span><button type="button" class="pbtn" data-open="${t.id}">編集</button><a href="${esc(t.url)}" target="_blank" rel="noopener">Notionで開く</a></div>
      <div class="pscroll reader" id="pscroll"><div class="pinner"><h1 class="rdtitle">${esc(t.name)}</h1><div class="rdmeta">${t.tag ? `<i>${esc(t.tag)}</i>` : ""}<span class="mute">書庫 ${ageOf(t)}日</span>${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">🔗 元のページ</a>` : ""}</div><div id="edbox"><div class="mute" style="padding:8px 0">読みこみ中…</div></div></div></div>
      <div class="rdbar">${bmHtml(t)}<button type="button" class="btn ok" data-readdone="${t.id}" style="flex:1">✓ 読んだ${next ? "・次へ" : ""}</button>${next ? `<button type="button" class="btn" data-reader="${next.id}">次へ ›</button>` : ""}</div>`;
    fetchBody(t.id).then((raw) => { if (PG !== P) return; P.raw = raw; S.bodies[t.id] = summarize(t, raw); mountEditor($("#edbox"), raw, { pageId: t.id, readOnly: true }); $("#pscroll").scrollTop = 0; })
      .catch((err) => { if (PG === P) $("#edbox").innerHTML = `<div class="empty">${esc(errText(err))}</div>`; });
  }
  // 読む画面で「読んだ」：外して、次があれば次へ、なければ一覧へ
  async function readDoneAndNext(t) {
    const list = readItems(); const i = list.indexOf(t); const next = i >= 0 ? list[i + 1] : null;
    await setRead(t, false);
    if (next) openReader(next.id); else closePage();
  }
