  // ================= 検索：タスク全体（読み込み済みはすぐ、残りは Notion に聞く） =================
  // 名前・次の一歩・分類タグで探す。読み込み済み（未完了・資料・今日の済み）はその場で、済みや古い資料も含めた全体は Notion の検索で足す
  const SQ = { q: "", kind: "all", seq: 0, remote: [], loading: false, err: "" };
  const norm = (s) => String(s || "").normalize("NFKC").toLowerCase();
  const KINDS = [["all", "すべて"], ["open", "未完了"], ["done", "済み"], ["ref", "資料"]];
  const kindOk = (t) => SQ.kind === "all" || (SQ.kind === "done" ? t.status === ST.done : SQ.kind === "ref" ? t.status === ST.ref : t.status !== ST.done && t.status !== ST.ref);
  function localHits(q) {
    const words = norm(q).split(/\s+/).filter(Boolean); if (!words.length) return [];
    const seen = new Set(); const out = [];
    for (const t of [...S.tasks, ...S.refs, ...S.doneToday]) {
      if (seen.has(t.id)) continue; seen.add(t.id);
      const hay = norm(`${t.name} ${t.next || ""} ${t.tag || ""} ${t.ai || ""}`);
      if (words.every((w) => hay.includes(w))) out.push(t);
    }
    return out;
  }
  function openSearch() {
    modal(`<div class="search"><div class="sbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input id="sq" type="search" placeholder="タスクを探す（名前・次の一歩・分類タグ）" value="${esc(SQ.q)}" enterkeyhint="search" autocomplete="off"><button type="button" class="mute" data-mclose="1">閉じる</button></div>
      <div class="seg" id="skinds">${KINDS.map(([k, n]) => `<button type="button" data-skind="${k}" aria-pressed="${SQ.kind === k}">${n}</button>`).join("")}</div>
      <div class="sres" id="sres"></div></div>`);
    $("#modal .sheet").classList.add("tall");
    const i = $("#sq"); setTimeout(() => i.focus(), 50);
    i.oninput = () => { SQ.q = i.value; drawSearch(); askNotion(); };
    drawSearch(); if (SQ.q) askNotion();
  }
  let askTimer;
  function askNotion() {
    clearTimeout(askTimer); SQ.remote = []; SQ.err = "";
    const q = SQ.q.trim(); if (q.length < 1 || S.mode === "demo") { SQ.loading = false; drawSearch(); return; }
    SQ.loading = true; drawSearch();
    const my = ++SQ.seq;
    askTimer = setTimeout(async () => {
      const word = q.split(/\s+/).sort((a, b) => b.length - a.length)[0];
      try {
        const res = await call("query", { data: { mode: "rows", data_source_url: `collection://${DS.task}`, filter: { type: "group", operator: "or", filters: [
          { type: "property", property: "名前", propertyType: "title", operator: "string_contains", value: { type: "exact", value: word } },
          { type: "property", property: "NEXT", propertyType: "text", operator: "string_contains", value: { type: "exact", value: word } },
        ] }, sort: [{ property: "最終更新日時", direction: "descending" }], limit: 60 } });
        if (my !== SQ.seq) return;
        const words = norm(q).split(/\s+/).filter(Boolean);
        SQ.remote = (res.results || []).map((r) => known.get(idOf(r.url)) || toTask(r)).filter((t) => words.every((w) => norm(`${t.name} ${t.next || ""} ${t.tag || ""}`).includes(w)));
      } catch (err) { if (my === SQ.seq) SQ.err = errText(err); }
      if (my !== SQ.seq) return;
      SQ.loading = false; drawSearch();
    }, 350);
  }
  function drawSearch() {
    const box = $("#sres"); if (!box) return;
    const q = SQ.q.trim();
    if (!q) { box.innerHTML = `<div class="empty">名前・次の一歩・分類タグで探せます。\n済みや古い資料も Notion から探します</div>`; return; }
    const local = localHits(q); const ids = new Set(local.map((t) => t.id));
    const all = [...local, ...SQ.remote.filter((t) => !ids.has(t.id))].filter(kindOk);
    const order = { [ST.doing]: 0, [ST.next]: 1, [ST.inbox]: 2, [ST.wait]: 3, [ST.ai]: 4, [ST.some]: 5, [ST.ref]: 6, [ST.done]: 7 };
    all.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.edited || "").localeCompare(a.edited || ""));
    const words = norm(q).split(/\s+/).filter(Boolean);
    const mark = (s) => { let h = esc(s); for (const w of words) h = h.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`); return h; };
    const row = (t) => `<div class="row" style="--c:${STAGES[stageOf(t)]?.c || "var(--mute)"}"><span class="dot"></span><button type="button" class="main" data-mopen="${t.id}"><span class="nm">${mark(t.name)}</span><span class="sub">${esc(STAGES[stageOf(t)]?.name || t.status)}${t.tag ? `・${esc(t.tag)}` : ""}${t.next ? `・${mark(t.next)}` : ""}</span></button><button type="button" class="meta qbtn" data-quick="${t.id}" aria-label="日付・状態を変える">${esc(metaOf(t).tx)}<i aria-hidden="true">▾</i></button></div>`;
    box.innerHTML = `<div class="shead2"><span>${all.length}件</span>${SQ.loading ? `<span class="mute">Notion を検索中…</span>` : SQ.err ? `<span class="late">${esc(SQ.err)}</span>` : S.mode === "demo" ? `<span class="mute">見本（読み込み済みだけ）</span>` : `<span class="mute">済み・資料も含む</span>`}</div>${all.map(row).join("") || (SQ.loading ? "" : `<div class="empty">見つかりませんでした</div>`)}`;
  }
