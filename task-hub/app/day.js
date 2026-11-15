  // ================= 日付で見る：選んだ日に「実行日」「更新」「済み」になったタスクを並べ替えて見る =================
  // 上の日付をタップで開く。読み込み済みのものはすぐ、残りは Notion に聞いて足す
  const DV = { d: "", kind: "all", sort: "edited", res: [], loading: false, err: "", seq: 0 };
  const DV_KINDS = [["all", "すべて"], ["due", "実行日"], ["upd", "更新"], ["done", "済み"]];
  const DV_SORTS = [["edited", "更新が新しい順"], ["due", "実行日順"], ["status", "状態順"], ["name", "名前順"]];
  const editedDay = (t) => (t.edited ? jst(Date.parse(t.edited)) : "");
  function openDayView(d) {
    DV.d = d || DV.d || TODAY();
    modal(`<div class="dv" id="dv"></div>`); $("#modal .sheet").classList.add("tall");
    drawDay(); askDay();
  }
  function dayLocal(d) {
    const seen = new Set(); const out = [];
    for (const t of [...S.tasks, ...S.doneToday, ...S.refs, ...(S.readList || [])]) { if (seen.has(t.id)) continue; seen.add(t.id); if (t.date === d || editedDay(t) === d) out.push(t); }
    return out;
  }
  async function askDay() {
    const my = ++DV.seq; DV.res = []; DV.err = "";
    if (S.mode === "demo") { DV.loading = false; drawDay(); return; }
    DV.loading = true; drawDay();
    try {
      const v = { type: "exact", value: DV.d };
      const res = await call("query", { data: { mode: "rows", data_source_url: `collection://${DS.task}`, filter: { type: "group", operator: "or", filters: [
        { type: "property", property: "実行日", propertyType: "date", operator: "date_is", value: v },
        { type: "property", property: "最終更新日時", propertyType: "last_edited_time", operator: "date_is", value: v },
      ] }, sort: [{ property: "最終更新日時", direction: "descending" }], limit: 100 } });
      if (my !== DV.seq) return;
      DV.res = (res.results || []).map((r) => known.get(idOf(r.url)) || toTask(r)).filter((t) => !t.parent?.length);
    } catch (err) { if (my === DV.seq) DV.err = errText(err); }
    if (my !== DV.seq) return;
    DV.loading = false; drawDay();
  }
  function dayItems() {
    const m = new Map(); for (const t of [...dayLocal(DV.d), ...DV.res]) if (!m.has(t.id) && !t.parent?.length) m.set(t.id, t);
    const all = [...m.values()];
    const is = { due: (t) => t.date === DV.d, upd: (t) => editedDay(t) === DV.d, done: (t) => t.status === ST.done && (t.date === DV.d || editedDay(t) === DV.d) };
    const cnt = { all: all.length, due: all.filter(is.due).length, upd: all.filter(is.upd).length, done: all.filter(is.done).length };
    const list = DV.kind === "all" ? all : all.filter(is[DV.kind]);
    const order = { [ST.doing]: 0, [ST.next]: 1, [ST.inbox]: 2, [ST.wait]: 3, [ST.ai]: 4, [ST.some]: 5, [ST.ref]: 6, [ST.done]: 7 };
    const by = { edited: (a, b) => (b.edited || "").localeCompare(a.edited || ""), due: (a, b) => (a.date || "9").localeCompare(b.date || "9") || (b.edited || "").localeCompare(a.edited || ""), status: (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.edited || "").localeCompare(a.edited || ""), name: (a, b) => a.name.localeCompare(b.name, "ja") };
    return { list: list.sort(by[DV.sort]), cnt, is };
  }
  function drawDay() {
    const box = $("#dv"); if (!box) return;
    const { list, cnt, is } = dayItems(); const d = DV.d;
    const label = `${+d.slice(5, 7)}月${+d.slice(8)}日（${WD[dow(d)]}）${d === TODAY() ? "・今日" : ""}`;
    const row = (t) => {
      const tags = [is.due(t) ? `<span class="dtag due">実行日</span>` : "", is.upd(t) ? `<span class="dtag upd">更新 ${t.edited ? jstTime(Date.parse(t.edited)) : ""}</span>` : "", t.status === ST.done ? `<span class="dtag done">済み</span>` : ""].join("");
      return `<div class="row" style="--c:${STAGES[stageOf(t)]?.c || "var(--mute)"}"><span class="dot"></span><button type="button" class="main" data-mopen="${t.id}"><span class="nm">${esc(t.name)}</span><span class="sub">${tags}${esc(STAGES[stageOf(t)]?.name || t.status)}${t.date && !is.due(t) ? `・実行日 ${md(t.date)}` : ""}${t.tag ? `・${esc(t.tag)}` : ""}</span></button><button type="button" class="meta qbtn" data-quick="${t.id}" aria-label="日付・状態を変える">${esc(metaOf(t).tx)}<i aria-hidden="true">▾</i></button></div>`;
    };
    const st = box.querySelector(".dvlist")?.scrollTop || 0;
    box.innerHTML = `<div class="dvhead"><button type="button" class="iconbtn sm" data-dvstep="-1" aria-label="前の日">‹</button><label class="dvdate"><b>${label}</b><input type="date" id="dvdate" value="${d}" aria-label="日付を選ぶ"></label><button type="button" class="iconbtn sm" data-dvstep="1" aria-label="次の日">›</button>${d !== TODAY() ? `<button type="button" class="qc" data-dvtoday="1">今日</button>` : ""}<button type="button" class="mute dvclose" data-mclose="1">閉じる</button></div>
      <div class="dvf">${DV_KINDS.map(([k, n]) => `<button type="button" class="qc" data-dvkind="${k}" aria-pressed="${DV.kind === k}">${n}<b>${cnt[k]}</b></button>`).join("")}</div>
      <div class="dvf sort"><span class="mute">並べ替え</span>${DV_SORTS.map(([k, n]) => `<button type="button" class="qc" data-dvsort="${k}" aria-pressed="${DV.sort === k}">${n}</button>`).join("")}</div>
      <div class="dvnote mute">${DV.loading ? "Notion から探しています…" : DV.err ? `<span class="late">${esc(DV.err)}</span>` : S.mode === "demo" ? "見本（読み込み済みのものだけ）" : "済み・資料・古いものも含む（最大100件）"}</div>
      <div class="list dvlist">${list.map(row).join("") || (DV.loading ? "" : `<div class="empty">この日のタスクはありません</div>`)}</div>`;
    const l = box.querySelector(".dvlist"); if (l) l.scrollTop = st;
    const inp = $("#dvdate"); if (inp) inp.onchange = () => { if (inp.value) { DV.d = inp.value; drawDay(); askDay(); } };
  }
  function dayStep(n) { DV.d = addDays(DV.d, n); drawDay(); askDay(); }
