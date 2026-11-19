  // ================= 🛠 アプリ改善：改善案（前後の見本つき）を判断し、文章で直しを頼む =================
  // 記録は DB_アプリ改善。採用・依頼・本番に出す・元に戻す は状態を変えてから、定期実行「🛠 アプリ改善（実装）」を起こす
  // （トークンが無ければ毎日 12:17・19:17 の見回りで動く）。実装・試し版・本番は Claude Code がする
  const FIX_APP = "https://www.notion.so/40662844acbe81b98894fc88719d6ea8"; // DB_アプリ「今どこ」
  const FX = { ST: { prop: "💡 提案中", ok: "✅ 採用", work: "🛠 実装中", try: "👀 試し版", ship: "🚀 本番待ち", done: "🚀 反映済み", skip: "⏭ 見送り", fail: "⚠️ できなかった", back: "↩ 戻す待ち", backed: "↩ 戻した" }, bodies: {}, view: {}, armed: "" };
  const toFix = (r) => ({
    id: idOf(r.url), url: r.url, name: text(r["名前"]) || "（無題）", kind: r["種類"] || "", state: r["状態"] || "", reason: text(r["理由"]), basis: text(r["根拠"]), result: text(r["結果"]),
    preview: text(r["試し版URL"]), ver: text(r["版"]), pri: Number(r["優先"]) || 0, date: r["date:日付:start"] ? String(r["date:日付:start"]).slice(0, 10) : "", decided: r["date:決めた日:start"] ? String(r["date:決めた日:start"]).slice(0, 10) : "", edited: r["最終更新日時"] || r.createdTime || "",
  });
  const fixWaiting = () => (S.fixes || []).filter((f) => f.state === FX.ST.prop || f.state === FX.ST.try);
  const fixMoving = () => (S.fixes || []).filter((f) => [FX.ST.ok, FX.ST.work, FX.ST.ship, FX.ST.back].includes(f.state));
  // 本文の「## 今」「## 直した後」の html 見本と「## やること」を読む
  function parseFixBody(raw) {
    const sec = (h) => { const m = raw.match(new RegExp(`^#{1,3}\\s*${h}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|$(?![\\s\\S]))`, "m")); return m ? m[1] : ""; };
    const code = (s) => { const m = s.match(/```(?:html)?\s*\n([\s\S]*?)```/); return m ? m[1] : ""; };
    const todo = sec("やること").split("\n").map((l) => l.replace(/^\s*([-*+]|\d+[.)])\s*(\[[ x]\]\s*)?/, "").trim()).filter(Boolean).slice(0, 8);
    return { before: code(sec("今")), after: code(sec("直した後")), todo };
  }
  async function loadFixBody(f) {
    if (FX.bodies[f.id]) return;
    FX.bodies[f.id] = { loading: true };
    try { FX.bodies[f.id] = parseFixBody(S.mode === "demo" ? DEMO_FIX_BODY : await fetchBody(f.id)); } catch (err) { FX.bodies[f.id] = { err: errText(err) }; }
    if (S.tab === "log" && S.logSeg === "fix" && $("#page").hidden) render();
  }
  // 見本は script を動かさない枠（sandbox）で、そのまま描く
  const mock = (html, label) => `<figure class="fxm"><figcaption>${label}</figcaption><iframe sandbox="" loading="lazy" title="${label}の見本" srcdoc="${esc(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=360"><style>html,body{margin:0;background:#15171c;color:#e8e6e1;font:14px/1.5 -apple-system,"Hiragino Sans",sans-serif}</style>${html || "<p style='padding:16px;color:#8a8f98'>見本がありません</p>"}`)}"></iframe></figure>`;
  function fixCard(f) {
    const b = FX.bodies[f.id]; const v = FX.view[f.id] || "both";
    const chip = `<span class="fxst" data-st="${esc(f.state)}">${esc(f.state)}</span>`;
    const head = `<div class="fxh">${chip}<span class="mute">${f.kind === "✍️ 依頼" ? "✍️ 依頼" : "💡 改善案"}${f.date ? `・${md(f.date)}` : ""}</span><button type="button" class="qc" data-dany=":${f.id}">Notion</button></div><b class="fxn">${esc(f.name)}</b>`;
    const why = `${f.reason ? `<p class="fxr">${esc(f.reason)}</p>` : ""}${f.basis ? `<p class="fxb">📊 ${esc(f.basis)}</p>` : ""}`;
    let body = "";
    if (f.state === FX.ST.prop) {
      if (!b) loadFixBody(f);
      const mocks = !b || b.loading ? `<div class="mute fxload">見本を読みこみ中…</div>` : b.err ? `<div class="mute">${esc(b.err)}</div>`
        : `<div class="seg fxseg">${[["before", "今"], ["after", "直した後"], ["both", "並べる"]].map(([k, n]) => `<button type="button" data-fxview="${f.id}:${k}" aria-pressed="${v === k}">${n}</button>`).join("")}</div><div class="fxmocks ${v}">${v !== "after" ? mock(b.before, "今") : ""}${v !== "before" ? mock(b.after, "直した後") : ""}</div>${b.todo?.length ? `<ul class="fxtodo">${b.todo.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>` : ""}`;
      body = `${mocks}<div class="fxact"><button type="button" class="btn pri" data-fxset="${f.id}:ok">採用して作ってもらう</button><button type="button" class="btn" data-fxset="${f.id}:skip">見送り</button></div>`;
    } else if (f.state === FX.ST.try) {
      body = `${f.result ? `<p class="fxres">🛠 ${esc(f.result)}</p>` : ""}<div class="fxact">${f.preview ? `<a class="btn" href="${esc(f.preview)}" target="_blank" rel="noopener">👀 試し版を開く</a>` : ""}<button type="button" class="btn pri" data-fxset="${f.id}:ship">本番に出す</button><button type="button" class="btn" data-fxset="${f.id}:skip">やめる</button></div><p class="mute fxhint">試し版は別のアドレスなので、開くと合言葉をもう一度聞かれます</p>`;
    } else if (f.state === FX.ST.done) {
      body = `${f.result ? `<p class="fxres">🛠 ${esc(f.result)}</p>` : ""}<div class="fxact"><button type="button" class="btn${FX.armed === f.id ? " danger" : ""}" data-fxset="${f.id}:back">${FX.armed === f.id ? "もう一度押すと元に戻す" : "↩ 元に戻す"}</button></div>`;
    } else if ([FX.ST.ok, FX.ST.work, FX.ST.ship, FX.ST.back].includes(f.state)) {
      body = `<p class="mute fxhint">${f.state === FX.ST.work ? "Claude Code が作っています" : "順番待ち"}（ボタンで起こせないときは、毎日 12:17・19:17 の見回りで動きます）</p>`;
    } else if (f.result) body = `<p class="fxres">${esc(f.result)}</p>`;
    return `<article class="fxc" data-fx="${f.id}">${head}${why}${body}</article>`;
  }
  function renderFix(view) {
    if (!S.fixAt && !S.fixLoading && S.mode !== "loading") loadFixes();
    const all = S.fixes || []; const wait = fixWaiting(); const moving = fixMoving();
    const past = all.filter((f) => !wait.includes(f) && !moving.includes(f));
    view.insertAdjacentHTML("beforeend", `<div class="card panel"><div class="scroll" id="fixbox">
      <section class="g-sec"><h3>✍️ 文章で直してもらう<small>送るとすぐ Claude Code が作り、試し版ができます</small></h3>
        <div class="fxreq"><textarea id="fxtext" rows="3" placeholder="例：ニュースの★をもう少し大きくして／今日タブの一番上に天気を出して">${esc(S.fixDraft || "")}</textarea><button type="button" class="btn pri" data-fxreq="1">送る</button></div></section>
      <section class="g-sec"><h3>🧑‍⚖️ 判断を待っている<small>${wait.length}件</small></h3>${wait.map(fixCard).join("") || `<div class="empty">${S.fixLoading ? "読みこみ中…" : S.fixErr ? esc(S.fixErr) : "今はありません。改善案は毎週月曜 8:07 に届きます"}</div>`}</section>
      ${moving.length ? `<section class="g-sec"><h3>🛠 進んでいる<small>${moving.length}件</small></h3>${moving.map(fixCard).join("")}</section>` : ""}
      ${past.length ? `<section class="g-sec"><h3>これまで<small>${past.length}件</small></h3>${past.slice(0, 20).map(fixCard).join("")}</section>` : ""}
    </div></div>`);
    const ta = $("#fxtext"); if (ta) ta.oninput = () => { S.fixDraft = ta.value; };
  }
  async function loadFixes() {
    if (S.mode === "demo") { if (!S.fixes) demoFixes(); return; }
    S.fixLoading = true;
    try { const r = await rows(DS.fix, { sort: [{ property: "最終更新日時", direction: "descending" }], limit: 50 }); S.fixes = r.results.map(toFix); S.fixErr = ""; S.fixAt = Date.now(); }
    catch (err) { S.fixErr = errText(err); }
    S.fixLoading = false;
    if (S.tab === "log" && $("#page").hidden) render();
  }
  // 定期実行を起こす（設定が無ければ見回りに任せる）
  async function kickFix() {
    if (S.mode === "demo" || VIA !== "api") return "見回り（12:17・19:17）で動きます";
    try {
      const r = await fetch("/api/run", { method: "POST", headers: { Authorization: `Bearer ${store.get("key") || ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ which: "fix" }) });
      const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || r.status);
      return "Claude Code を呼びました（数分〜十数分）";
    } catch { return "すぐには呼べませんでした。12:17・19:17 の見回りで動きます"; }
  }
  const FX_ACT = { ok: ["✅ 採用", "採用しました"], skip: ["⏭ 見送り", "見送りました"], ship: ["🚀 本番待ち", "本番に出すよう頼みました"], back: ["↩ 戻す待ち", "元に戻すよう頼みました"] };
  async function setFix(id, act) {
    const f = (S.fixes || []).find((x) => x.id === id); if (!f || !FX_ACT[act]) return;
    if (act === "back" && FX.armed !== id) { FX.armed = id; render(); setTimeout(() => { if (FX.armed === id) { FX.armed = ""; render(); } }, 4000); return; }
    FX.armed = "";
    const [state, msg] = FX_ACT[act]; const before = f.state; f.state = state; f.decided = TODAY(); render();
    try {
      if (S.mode !== "demo") await call("update", { page_id: f.id, command: "update_properties", properties: { "状態": state, "date:決めた日:start": TODAY(), "date:決めた日:is_datetime": 0 }, allow_async: false }, { read: false });
      toast(act === "skip" ? msg : `${msg}。${await kickFix()}`);
    } catch (err) { f.state = before; render(); toast(`変えられませんでした：${errText(err)}`); }
  }
  async function sendFixRequest() {
    const t = ($("#fxtext")?.value || "").trim(); if (!t) { toast("直してほしいことを書いてください"); return; }
    if (t.length > 2000) { toast("2000字までにしてください"); return; }
    const name = t.replace(/\s+/g, " ").slice(0, 30);
    const props = { "名前": name, "種類": "✍️ 依頼", "状態": FX.ST.ok, "理由": t, "date:日付:start": TODAY(), "date:日付:is_datetime": 0, "アプリ": [FIX_APP] };
    const row = { id: "", url: "", name, kind: "✍️ 依頼", state: FX.ST.ok, reason: t, basis: "", result: "", preview: "", ver: "", pri: 0, date: TODAY(), decided: "" };
    try {
      if (S.mode !== "demo") { const res = await call("create", { parent: { type: "data_source_id", data_source_id: DS.fix }, pages: [{ properties: props }], allow_async: false }, { read: false }); const pg = (res.pages || [])[0] || {}; row.url = pg.url || ""; row.id = String(pg.id || "").replace(/-/g, ""); }
      else row.id = `f${String(Date.now()).padStart(31, "0")}`;
      S.fixes = [row, ...(S.fixes || [])]; S.fixDraft = ""; render();
      toast(`依頼しました。${await kickFix()}`);
    } catch (err) { toast(`送れませんでした：${errText(err)}`); }
  }
  const DEMO_FIX_BODY = "## 今\n\n```html\n<div style=\"padding:12px\"><div style=\"font-weight:700;margin-bottom:8px\">今日</div><div style=\"padding:10px;border-radius:10px;background:#1e2128;margin-bottom:6px\">（例）資源ごみを出す</div><div style=\"padding:10px;border-radius:10px;background:#1e2128;margin-bottom:6px\">（例）家計の振込</div><div style=\"color:#8a8f98;font-size:12px;margin-top:40px\">▼ 次にやる から足す（一番下・たたまれている）</div></div>\n```\n\n## 直した後\n\n```html\n<div style=\"padding:12px\"><div style=\"padding:10px 12px;border-radius:12px;background:#2a2417;color:#e0a43c;font-weight:700;margin-bottom:10px\">＋ 次にやるから今日を選ぶ（12件）</div><div style=\"font-weight:700;margin-bottom:8px\">今日</div><div style=\"padding:10px;border-radius:10px;background:#1e2128;margin-bottom:6px\">（例）資源ごみを出す</div><div style=\"padding:10px;border-radius:10px;background:#1e2128\">（例）家計の振込</div></div>\n```\n\n## やること\n\n- 今日タブの一番上に「次にやるから今日を選ぶ」ボタンを置く\n- 押すと次にやるが一覧で出て、まとめて選べる\n- 一番下の「次にやる から足す」は残す";
  function demoFixes() {
    const d = TODAY();
    S.fixes = [
      { id: "f1".padEnd(32, "0"), url: "https://www.notion.so/", name: "（例）今日タブの一番上に「今日を選ぶ」を置く", kind: "💡 改善案", state: FX.ST.prop, reason: "次にやるを開かないまま1日が終わる日が続いています。今日タブから直接選べるようにします。", basis: "（例）この7日で今日タブから次にやるを開いたのは1回・今日やるの完了率 35%", result: "", preview: "", ver: "", pri: 80, date: d, decided: "" },
      { id: "f2".padEnd(32, "0"), url: "https://www.notion.so/", name: "（例）ニュースの★を大きく", kind: "✍️ 依頼", state: FX.ST.try, reason: "ニュースの★をもう少し大きくして", basis: "", result: "（例）★を 28px→36px にし、押せる範囲を広げた", preview: "https://example.com", ver: "", pri: 0, date: addDays(d, -1), decided: addDays(d, -1) },
      { id: "f3".padEnd(32, "0"), url: "https://www.notion.so/", name: "（例）診断タブにひと目でカード", kind: "💡 改善案", state: FX.ST.done, reason: "", basis: "", result: "（例）6枚のカードと新着の印を足した", preview: "", ver: "", pri: 0, date: addDays(d, -7), decided: addDays(d, -6) },
    ];
    S.fixAt = Date.now();
  }
