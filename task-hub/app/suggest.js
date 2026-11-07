  // ================= AIからの提案（DB_AI提案）：毎朝の定期実行が置いた提案を、採用／見送りで片づける =================
  // 1行＝1提案。「操作」は JSON：{"set":{"ステータス":"…","date":"YYYY-MM-DD","NEXT":"…","枠":"…","重さ":"…","分類タグ":"…"}} か
  // {"create":{"名前":"…","NEXT":"…","分類タグ":"…","枠":"…","重さ":"…","date":"…","メモ":"…","ステータス":"⏭ NEXT|📥 INBOX"}}
  const SUG_KIND = { "🗂 整理": "var(--s-next)", "📅 日付": "var(--s-today)", "🆕 新タスク": "var(--accent)", "🎯 目標の一歩": "var(--s-wait)", "🧹 手放す": "var(--mute)" };
  function toSug(r) {
    let op = null; try { op = JSON.parse(text(r["操作"]) || "null"); } catch { op = null; }
    const s = { id: idOf(r.url), url: r.url, name: text(r["名前"]) || "（無題）", kind: r["種類"] || "🗂 整理", reason: text(r["理由"]), op, pri: Number(r["優先"]) || 0, date: r["date:日付:start"] || null,
      taskIds: (list(r["対象タスク"]) || []).map(idOf).filter(Boolean), goalIds: (list(r["関連目標"]) || []).map(idOf).filter(Boolean) };
    return s.name ? s : null;
  }
  const sugTask = (s) => s.taskIds.map((id) => known.get(id)).find(Boolean) || null;
  // 「set」をタスクのプロパティに直す（date は実行日）
  function sugSetProps(set) {
    const out = {};
    for (const [k, v] of Object.entries(set || {})) {
      if (k === "date") Object.assign(out, dateProps(v || null));
      else if (["ステータス", "NEXT", "枠", "重さ", "分類タグ", "名前", "買い物の区分", "価格"].includes(k)) out[k] = v;
    }
    return out;
  }
  function sugSummary(s) {
    const op = s.op || {}; const t = sugTask(s);
    if (op.create) { const c = op.create; return `新しく作る：${c["名前"] || ""}${c.date ? `・${md(c.date)}` : ""}${c["枠"] ? `・${c["枠"]}` : ""}${c["重さ"] ? `・${c["重さ"]}` : ""}`; }
    if (op.set) { const bits = []; if (op.set["ステータス"]) { const key = Object.keys(ST).find((k) => ST[k] === op.set["ステータス"]); bits.push(`→ ${STAGES[key === "doing" ? "next" : key]?.name || op.set["ステータス"]}`); } if ("date" in op.set) bits.push(op.set.date ? `${md(op.set.date)}（${WD[dow(op.set.date)]}）にやる` : "日付を外す"); if (op.set.NEXT) bits.push(`次の一歩：${op.set.NEXT}`); if (op.set["買い物の区分"]) bits.push(`区分：${op.set["買い物の区分"]}`); return `${t ? short(t.name, 18) : "対象のタスク"} ${bits.join("・")}`; }
    return "";
  }
  function sugsHtml() {
    if (!S.sugs.length) return "";
    return `<section class="csug sugbox"><h4><span>💡</span>AIからの提案<small class="mute">${S.sugs.length}件・毎朝 7:36 に更新</small></h4>${S.sugs.map((s) => { const t = sugTask(s); return `<div class="sug" data-sug="${s.id}" style="--c:${SUG_KIND[s.kind] || "var(--mute)"}"><div class="sh"><i class="dot"></i><b>${esc(s.name)}</b><small>${esc(s.kind)}</small></div>${s.reason ? `<p>${esc(s.reason)}</p>` : ""}<div class="sdo">${esc(sugSummary(s))}</div><div class="sacts">${s.op ? `<button type="button" class="btn pri" data-sugok="${s.id}">採用</button>` : ""}<button type="button" class="btn" data-sugno="${s.id}">見送り</button>${t ? `<button type="button" class="qc" data-mopen="${t.id}">タスクを開く</button>` : ""}</div></div>`; }).join("")}</section>`;
  }
  // 採用：操作を実行して、提案の行を ✅ 採用 にする
  async function adoptSug(id) {
    const s = S.sugs.find((x) => x.id === id); if (!s || !s.op) return;
    const op = s.op; let made = null;
    try {
      if (op.create) {
        const c = op.create;
        made = await createTask({ name: c["名前"] || s.name, kind: "task", next: c.NEXT || "", memo: c["メモ"] || s.reason || "", today: c.date === TODAY(), extra: { ...(c.date && c.date !== TODAY() ? { ...dateProps(c.date), "ステータス": ST.next } : {}), ...(c["ステータス"] === ST.inbox ? { "ステータス": ST.inbox } : {}), ...(c["分類タグ"] ? { "分類タグ": c["分類タグ"] } : {}), ...(c["枠"] ? { "枠": c["枠"] } : {}), ...(c["重さ"] ? { "重さ": c["重さ"] } : {}), ...(s.goalIds.length ? { "関連目標": s.goalIds.map((g) => `https://www.notion.so/${g}`) } : {}) } });
      } else if (op.set) {
        const t = sugTask(s); const props = sugSetProps(op.set);
        if (t) { const ok = await setProps(t, props, `「${short(t.name)}」${sugSummary(s).replace(short(t.name, 18), "").trim()}`, { undo: false }); if (!ok) return; }
        else if (s.taskIds[0] && S.mode !== "demo") await call("update", { page_id: s.taskIds[0], command: "update_properties", properties: props, allow_async: false }, { read: false });
      }
    } catch (err) { toast(`採用できませんでした：${errText(err)}`); return; }
    await settleSug(s, "✅ 採用", made ? [made.url] : null);
    toast(op.create ? `提案を採用して「${short(made?.name || s.name)}」を作りました` : "提案を採用しました");
  }
  async function dismissSug(id) { const s = S.sugs.find((x) => x.id === id); if (!s) return; await settleSug(s, "⏭ 見送り"); toast("見送りました（同じ提案は繰り返しません）"); }
  async function settleSug(s, state, madeUrls) {
    S.sugs = S.sugs.filter((x) => x !== s); refresh(); if (!$("#modal").hidden) openConcierge();
    if (S.mode === "demo") return;
    const props = { "状態": state, "date:決めた日:start": TODAY(), "date:決めた日:is_datetime": 0 }; if (madeUrls) props["対象タスク"] = madeUrls;
    try { await call("update", { page_id: s.id, command: "update_properties", properties: props, allow_async: false }, { read: false }); }
    catch (err) { toast(`提案の記録を更新できませんでした：${errText(err)}`); }
  }
  // 今すぐ提案してもらう（定期実行「💡 タスクの提案」を API トリガーで起動）
  async function askSuggest(el) {
    if (S.mode === "demo") { toast("見本では動きません"); return; }
    if (VIA !== "api") { window.open("https://claude.ai/code/routines", "_blank", "noopener"); return; }
    el.disabled = true; el.textContent = "起動中…";
    try {
      const r = await fetch("/api/run", { method: "POST", headers: { Authorization: `Bearer ${store.get("key") || ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ which: "suggest" }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      el.textContent = "起動しました（数分で届きます）"; toast("AIが提案を考えています。数分したら「↻」で読み直してください");
    } catch (err) { el.disabled = false; el.textContent = "💡 今すぐ提案してもらう"; toast(String(err.message || "起動できませんでした").slice(0, 120)); }
  }
