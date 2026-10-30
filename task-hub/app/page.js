  // ================= ページ（詳細）：プロパティ・AIとのやり取り・本文 =================
  let PG = null; // { kind, id, url, title, titleProp, task, props, raw, qa }
  const hereTime = () => { const n = new Date(Date.now() + 9 * 3600e3).toISOString(); return `${+n.slice(5, 7)}/${+n.slice(8, 10)} ${n.slice(11, 16)}`; };
  function openTask(id) { const t = known.get(id); if (t) openPage({ kind: "task", id: t.id, url: t.url, title: t.name, titleProp: "名前", task: t, crumb: `DB_タスク管理 ／ ${STAGES[stageOf(t)]?.name || ""}` }); }
  function openDbRow(i) { const r = S.dbRows[i]; if (!r) return; const { title } = dbColumns(); openPage({ kind: "row", id: idOf(r.url), url: r.url, title: text(r[title]) || "（無題）", titleProp: title, row: r, crumb: S.dbOpen?.name || "" }); }
  function openRecord(kind, id) {
    const src = { diag: S.diag, log: S.logs, goal: S.goals, proj: S.projects }[kind] || []; const x = src.find((r) => r.id === id); if (!x) return;
    const fields = kind === "goal" ? [["ステータス", x.status], ["種別", x.kind], ["領域", x.area], ["期限", x.due ? md(x.due) : ""], ["なぜ", x.why], ["達成の目安", x.goalBy], ["プロジェクト", x.projects.map((pid) => S.projects.find((p) => p.id === pid)?.name).filter(Boolean).join("・")]]
      : kind === "diag" ? [["期間", x.from ? `${md(x.from)}〜${md(x.to || x.from)}` : ""], ["判定", x.verdict], ["今日やる完了率", `${Math.round(x.rate * 100)}%`], ["完了／流入", `${x.done}／${x.inflow}`], ["次の一手", x.next]]
      : kind === "proj" ? [["ステータス", x.status], ["次の一歩", x.step], ["今の状態", x.now], ["タスク", `${projStats(x).done}/${x.total}`]]
      : [["イベント", x.event], ["日時", x.at ? `${md(jst(Date.parse(x.at)))} ${jstTime(Date.parse(x.at))}` : ""], ["内容", x.body]];
    openPage({ kind, id: x.id, url: x.url, title: x.name, titleProp: "名前", fields, crumb: { diag: "DB_診断レポート", log: "DB_運用ログ", goal: "DB_目標", proj: "DB_プロジェクト" }[kind] });
  }
  async function openPage(P) {
    PG = P;
    const el = $("#page"); el.hidden = false;
    el.innerHTML = `<div class="pbar"><button type="button" class="iconbtn" data-close="1" aria-label="戻る">‹</button><span class="crumb">${esc(P.crumb || "")}</span><span class="savestate" id="savestate"></span><a href="${esc(P.url)}" target="_blank" rel="noopener">Notionで開く</a></div>
      <div class="pscroll" id="pscroll"><div class="pinner"><div class="ptitle" id="ptitle" contenteditable="true" spellcheck="false">${esc(P.title)}</div><div id="pprops">${propsHtml()}</div><div id="aibar"></div><div class="divline"></div><div id="edbox"><div class="mute" style="padding:8px 0">本文を読みこみ中…</div></div></div></div>`;
    drawAiBar();
    try {
      const raw = await fetchBody(P.id);
      if (PG !== P) return;
      P.raw = raw; if (P.task) S.bodies[P.id] = summarize(P.task, raw);
      mountEditor($("#edbox"), raw, { pageId: P.id, onSaved: (nr) => { P.raw = nr; if (P.task) { S.bodies[P.id] = summarize(P.task, nr); } } });
      setSaveState(S.mode === "demo" ? "見本（Notionは変わりません）" : "");
      drawAiBar();
    } catch (err) { if (PG === P) $("#edbox").innerHTML = `<div class="empty">${esc(errText(err))}</div>`; }
  }
  async function closePage() {
    const E = ED;
    if (E && (E.dirty || E.saving)) { clearTimeout(E.timer); setSaveState("保存中…"); for (let i = 0; i < 60 && (E.dirty || E.saving); i++) { if (!E.saving && E.dirty) saveEditor(); await sleep(150); } }
    ED = null; PG = null; closeMenus(); $("#fmtbar")?.remove();
    $("#page").hidden = true; $("#page").innerHTML = ""; render();
  }
  async function reloadBody() {
    const P = PG; if (!P) return;
    const raw = await fetchBody(P.id); if (PG !== P) return; P.raw = raw;
    if (P.task) S.bodies[P.id] = summarize(P.task, raw);
    mountEditor($("#edbox"), raw, { pageId: P.id, onSaved: (nr) => { P.raw = nr; } }); drawAiBar();
  }
  function propsHtml() {
    const P = PG; const t = P.task;
    if (t) {
      const sel = (prop, opts, val, blank = true) => `<select data-prop="${prop}" aria-label="${prop}">${blank ? `<option value="">—</option>` : ""}${opts.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      const pj = S.projects.filter((p) => t.projects.includes(p.id));
      return `${quickHtml(t)}<dl class="props"><dt>ステータス</dt><dd>${sel("ステータス", ALL_STATUSES, t.status, false)}</dd>
        <dt>AIアクション</dt><dd>${sel("AIアクション", AIA, t.ai)} <span class="mute" style="font-size:11.5px">${t.ai ? AI_LABEL[t.ai] : ""}</span></dd>
        <dt>実行日</dt><dd><input type="date" data-prop="date:実行日:start" value="${t.date || ""}" aria-label="実行日">${t.date ? `<button type="button" class="mute" data-cleardate="1" style="font-size:12px;padding:0 6px">外す</button>` : ""}</dd>
        <dt>次の一歩</dt><dd><input type="text" data-prop="NEXT" value="${esc(t.next || "")}" placeholder="（空）" aria-label="次の一歩"></dd>
        <dt>枠</dt><dd>${sel("枠", WAKU, t.waku)}</dd><dt>重さ</dt><dd>${sel("重さ", WEIGHTS, t.weight)}</dd><dt>分類タグ</dt><dd>${sel("分類タグ", TAGS, t.tag)}</dd>
        ${pj.length ? `<dt>プロジェクト</dt><dd>${pj.map((p) => `<button type="button" class="pill" data-proj="${p.id}">${esc(p.name)}</button>`).join("")}</dd>` : ""}
        ${t.link ? `<dt>URL</dt><dd><a href="${esc(t.link)}" target="_blank" rel="noopener" style="color:var(--accent);font-size:12.5px;overflow-wrap:anywhere">${esc(t.link.slice(0, 70))}</a></dd>` : ""}</dl>`;
    }
    if (P.fields) return `<dl class="props">${P.fields.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${linky(v)}</dd>`).join("")}</dl>`;
    if (P.row) {
      const schema = S.dbSchema || {}; const props = Object.values(schema).filter((p) => p.name !== P.titleProp && !["button"].includes(p.type));
      const shown = props.map((p) => { const v = p.type === "formula" || p.type === "rollup" ? "" : cell(P.row, p); return v ? `<dt>${esc(p.name)}</dt><dd>${SECRET.test(p.name) ? "••••（隠しています）" : linky(v)}</dd>` : ""; }).join("");
      return `<dl class="props">${shown}</dl>`;
    }
    return "";
  }
  // 文字の中の URL を押せるリンクにする
  const linky = (v) => esc(v).replace(/https?:\/\/[^\s<>"'）)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener" class="ulink">${u.length > 60 ? `${u.slice(0, 58)}…` : u}</a>`);
  // URL を開く：知っている Notion のページならこの画面で、それ以外は新しいタブで
  function openLink(href) {
    const id = /notion\.(so|site|com)/.test(href) ? idOf(href) : "";
    if (id && known.has(id)) { openTask(id); return; }
    const x = id && S.stock.find((r) => r.id === id); if (x) { openStock(id); return; }
    window.open(href, "_blank", "noopener");
  }

  // ================= 日付・状態をすぐ変える =================
  const nextDow = (w) => { const d = TODAY(); return addDays(d, ((w - dow(d) + 7) % 7) || 7); };
  const QUICK_DATES = [["today", "今日"], ["tomorrow", "明日"], ["sat", "土曜"], ["mon", "来週月"], ["week", "1週間後"]];
  const QUICK_ST = [["next", ST.next, "次にやる"], ["doing", ST.doing, "進行中"], ["wait", ST.wait, "待ち"], ["some", ST.some, "いつか"], ["ref", ST.ref, "資料"], ["inbox", ST.inbox, "収集に戻す"]];
  function quickDate(k) { const d = TODAY(); return { today: d, tomorrow: addDays(d, 1), sat: nextDow(6), mon: nextDow(1), week: addDays(d, 7) }[k]; }
  function quickHtml(t) {
    const done = t.status === ST.done;
    return `<div class="quick" data-qt="${t.id}">
      <div class="qrow"><span class="ql">日付</span>${QUICK_DATES.map(([k, n]) => `<button type="button" class="qc${t.date === quickDate(k) ? " on" : ""}" data-qk="d:${k}">${n}<small>${md(quickDate(k))}</small></button>`).join("")}<label class="qc pick">📅 選ぶ<input type="date" data-qdate="1" value="${t.date || ""}" aria-label="日付を選ぶ"></label>${t.date ? `<button type="button" class="qc" data-qk="d:none">日付なし</button>` : ""}</div>
      <div class="qrow"><span class="ql">状態</span>${QUICK_ST.filter(([, v]) => v !== t.status).map(([k, , n]) => `<button type="button" class="qc" data-qk="s:${k}" style="--c:${STAGES[k === "doing" ? "next" : k].c}">${n}</button>`).join("")}<button type="button" class="qc ok" data-qk="s:${done ? "next" : "done"}">${done ? "↩ 戻す" : "✓ 済み"}</button></div>
      ${t.status === ST.ai ? "" : `<div class="qrow"><span class="ql">AI</span><button type="button" class="qc ai" data-qk="a:🔍">🔍 調べて</button><button type="button" class="qc ai" data-qk="a:💬">💬 一緒に分解</button><button type="button" class="qc ai" data-qk="a:🔬">🔬 徹底調査</button></div>`}
    </div>`;
  }
  async function applyQuick(t, key, val) {
    const [kind, k] = key.split(":");
    let props, msg;
    if (kind === "d") { const d = k === "pick" ? val : k === "none" ? null : quickDate(k); props = { ...dateProps(d), ...(d && ![ST.next, ST.doing].includes(t.status) ? { "ステータス": ST.next } : {}) }; msg = d ? `「${short(t.name)}」→ ${md(d)}（${WD[dow(d)]}）にやる` : `「${short(t.name)}」の日付を外しました`; }
    else if (kind === "s") { const v = k === "done" ? ST.done : QUICK_ST.find((q) => q[0] === k)[1]; props = { "ステータス": v }; msg = `「${short(t.name)}」→ ${k === "done" ? "済み" : QUICK_ST.find((q) => q[0] === k)[2]}`; }
    else { props = { "ステータス": ST.ai, "AIアクション": k }; msg = `AIに預けました（${k}・次の定時処理 ${nextRun()}）`; }
    await setProps(t, props, msg);
    if (PG?.task === t) { $("#pprops").innerHTML = propsHtml(); drawAiBar(); }
  }
  function openQuick(id) {
    const t = known.get(id); if (!t) return;
    modal(`<h3 class="qhead"><span class="dot" style="--c:${STAGES[stageOf(t)]?.c}"></span>${esc(t.name)}</h3><div class="form">${quickHtml(t)}<div style="display:flex;gap:8px"><button type="button" class="btn pri" data-mopen="${t.id}" style="flex:1">ページを開く</button><button type="button" class="btn" data-mclose="1">閉じる</button></div></div>`);
  }

  // AIとのやり取りの帯（ページの上）
  function drawAiBar() {
    const box = $("#aibar"); const P = PG; if (!box || !P) return;
    const t = P.task; if (!t) { box.innerHTML = ""; return; }
    if (t.ai === "💭") {
      const qa = P.raw != null ? qaParse(P.raw) : null; P.qa = qa;
      box.innerHTML = `<div class="aibar"><div class="h"><b>💭 あなたの番：質問に答える</b>${qa?.clarity ? `<span class="clar mute">明確度 ${qa.clarity[0]}/${qa.clarity[1]}<i style="--p:${Math.round((qa.clarity[0] / qa.clarity[1]) * 100)}%"></i></span>` : ""}</div>
        ${P.raw == null ? `<div class="mute">質問票を読みこみ中…</div>` : qa && qa.qs.length ? `<div class="qa">${qa.qs.map((q, qi) => `<div class="q"><div class="qt">${esc(q.title)}</div>${q.opts.map((o, oi) => `<button type="button" class="opt" data-qopt="${qi}:${oi}" aria-pressed="${o.checked}"><i>✓</i><span>${esc(o.text)}</span></button>`).join("")}<input type="text" data-qcom="${qi}" value="${esc(q.newComment ?? q.comment?.value ?? "")}" placeholder="💬 コメント（自由に）" aria-label="コメント"></div>`).join("")}</div>
          ${qa.decide.length ? `<div class="mute" style="font-size:12px">決めること：${qa.decide.map((d) => `${d.checked ? "☑" : "☐"} ${esc(d.text)}`).join("　")}</div>` : ""}
          <div class="acts"><button type="button" class="btn pri" data-qa="send">回答してAIに返す（💬へ）</button><button type="button" class="btn" data-qa="save">回答だけ保存</button></div>`
        : `<div class="mute" style="font-size:12.5px">質問票の形が読み取れませんでした。下の本文に直接書いてから「AIに返す」を押してください。</div><div class="acts"><button type="button" class="btn pri" data-aiset="💬">AIに返す（💬へ）</button></div>`}</div>`;
      return;
    }
    if (t.ai === "🔍✅") {
      const conc = P.raw != null ? conclusionOf(P.raw) : "";
      box.innerHTML = `<div class="aibar"><div class="h"><b>🔍✅ 調べ終わった：行き先を決める</b></div>${conc ? `<div style="background:var(--nb-yellow);border-radius:10px;padding:8px 10px;font-size:13.5px">⭐ ${esc(conc)}</div>` : ""}
        <div class="decide"><div class="row2"><button type="button" class="btn ok" data-mv="next">やる<small>⏭ 次にやる</small></button><button type="button" class="btn" data-mv="today">今日やる<small>実行日＝今日</small></button><button type="button" class="btn" data-mv="ref">資料にする<small>📚 REFERENCE</small></button></div>
        <div class="row2"><button type="button" class="btn" data-mv="some">いつか<small>🕰 SOMEDAY</small></button><button type="button" class="btn" data-mv="done">済んだ<small>✅ DONE</small></button><button type="button" class="btn" data-mv="wait">返事待ち<small>⏳ WAITING</small></button></div></div>
        <textarea id="ainote" placeholder="メモ：いつかにする理由／もう一度AIに頼むときの「ここを調べ直して」「Bで」など"></textarea>
        <div class="acts"><span class="mute" style="font-size:12px;align-self:center">もう一度AIへ：</span><button type="button" class="btn" data-again="🔍">🔍 再調査</button><button type="button" class="btn" data-again="🔬">🔬 徹底調査</button><button type="button" class="btn" data-again="💬">💬 深掘り</button></div></div>`;
      return;
    }
    if (AI_TURN[t.ai] === "ai") {
      box.innerHTML = `<div class="aibar"><div class="h"><b>🤖 AIの番：${t.ai} ${AI_LABEL[t.ai]}</b><span class="mute">次の定時処理 ${nextRun()}</span></div>
        <div class="acts">${["🔍", "🔬", "💬"].filter((m) => m !== t.ai).map((m) => `<button type="button" class="btn" data-aiset="${m}">${m} に変える</button>`).join("")}<button type="button" class="btn" data-aiset="">印を外す</button></div></div>`;
      return;
    }
    box.innerHTML = t.status === ST.done || t.status === ST.ref ? "" : `<div class="aibar" style="padding:8px 12px"><div class="acts" style="align-items:center"><span class="mute" style="font-size:12.5px">AIに頼む：</span><button type="button" class="btn" data-again="🔍">🔍 調べて</button><button type="button" class="btn" data-again="🔬">🔬 徹底調査</button><button type="button" class="btn" data-again="💬">💬 深掘り</button></div></div>`;
  }
  // 質問票への回答を本文に書く（最新のやり取りの節だけを置き換える）
  async function sendQa(back) {
    const P = PG; const qa = P.qa; if (!qa) return;
    for (const inp of document.querySelectorAll("[data-qcom]")) { const q = qa.qs[+inp.dataset.qcom]; const v = inp.value.trim(); if (v !== (q.comment?.value ?? "")) q.newComment = v; }
    const oldSec = qa.sec.join("\n"); const newSec = qaWrite(qa);
    const btns = document.querySelectorAll("[data-qa]"); btns.forEach((b) => { b.disabled = true; });
    try {
      if (newSec !== oldSec) {
        if (S.mode === "demo") { P.raw = P.raw.replace(oldSec, newSec); DEMO_BODIES[P.id] = P.raw; }
        else { const res = await call("update", { page_id: P.id, command: "update_content", content_updates: [{ old_str: oldSec, new_str: newSec }], allow_async: false }, { read: false }); if (res?.warnings?.length) throw Object.assign(new Error("conflict"), { code: "conflict" }); }
      }
      if (back) await setProps(P.task, { "AIアクション": "💬", ...(P.task.status === ST.ai ? {} : { "ステータス": ST.ai }) }, "回答をAIに返しました（次の定時処理で読みます）");
      else toast("回答を保存しました");
      if (S.mode === "demo") { mountEditor($("#edbox"), P.raw, { pageId: P.id }); drawAiBar(); } else await reloadBody();
      $("#pprops").innerHTML = propsHtml();
    } catch (err) { toast(err?.code === "conflict" || /No matches found/i.test(String(err?.message || "")) ? "Notion 側で質問票が更新されていました。開き直してください" : `保存できませんでした：${errText(err)}`); btns.forEach((b) => { b.disabled = false; }); }
  }
  // 本文の最後にメモを足す（再調査の指示・いつかの理由）
  async function appendToPage(P, content) {
    if (S.mode === "demo") { P.raw = `${P.raw}\n\n${content}`; DEMO_BODIES[P.id] = P.raw; return; }
    await call("update", { page_id: P.id, command: "insert_content", content, allow_async: false }, { read: false });
  }
  async function memoToPage(P, line) {
    const raw = P.raw || ""; const L = raw.split("\n"); const h = L.findIndex((l) => /^##\s*(📝\s*)?メモ\s*$/.test(l.trim()));
    if (h >= 0 && raw.split(L[h]).length === 2) {
      if (S.mode === "demo") { P.raw = raw.replace(L[h], `${L[h]}\n\n- ${line}`); DEMO_BODIES[P.id] = P.raw; return; }
      await call("update", { page_id: P.id, command: "update_content", content_updates: [{ old_str: L[h], new_str: `${L[h]}\n\n- ${line}` }], allow_async: false }, { read: false });
    } else await appendToPage(P, `## メモ\n\n- ${line}`);
  }
  async function aiDecide(key) {
    const P = PG; const t = P.task; const note = ($("#ainote")?.value || "").trim();
    try { if (key === "some" && note) await memoToPage(P, `いつかへ（${hereTime()}）：${note}`); } catch (err) { toast(errText(err)); }
    await move(t, key);
    $("#pprops").innerHTML = propsHtml(); drawAiBar();
    if (key === "some" && note) await reloadBody();
  }
  async function aiAgain(mode) {
    const P = PG; const t = P.task; const note = ($("#ainote")?.value || "").trim();
    try { if (note) await appendToPage(P, `<callout icon="✍️" color="gray_bg">\n${mode === "🔍" ? "再調査" : mode === "🔬" ? "徹底調査" : "深掘り"}の依頼（${hereTime()}）：${note}\n</callout>`); } catch (err) { toast(errText(err)); return; }
    await setProps(t, { "ステータス": ST.ai, "AIアクション": mode }, `AIに預けました（${mode}・次の定時処理 ${nextRun()}）`);
    $("#pprops").innerHTML = propsHtml(); drawAiBar(); if (note) await reloadBody();
  }
  async function saveTitle() {
    const P = PG; if (!P) return; const v = $("#ptitle").textContent.trim(); if (!v || v === P.title) return;
    const old = P.title; P.title = v;
    if (P.task) { await setProps(P.task, { "名前": v }, "名前を変えました", { undo: false }); return; }
    if (S.mode === "demo") return;
    try { await call("update", { page_id: P.id, command: "update_properties", properties: { [P.titleProp]: v }, allow_async: false }, { read: false }); toast("名前を変えました"); }
    catch (err) { P.title = old; $("#ptitle").textContent = old; toast(errText(err)); }
  }
  function onPropChange(el) {
    const t = PG?.task; if (!t) return; const prop = el.dataset.prop; let v = el.value.trim() || null;
    if (prop === "date:実行日:start") { setProps(t, dateProps(v), v ? `実行日を ${md(v)} にしました` : "実行日を外しました").then(() => { $("#pprops").innerHTML = propsHtml(); }); return; }
    setProps(t, { [prop]: v }, `${prop === "NEXT" ? "次の一歩" : prop}を変えました`).then(() => { if (prop !== "NEXT") { $("#pprops").innerHTML = propsHtml(); drawAiBar(); if (prop === "AIアクション" && PG.raw == null) reloadBody(); } });
  }

  // ================= 新しく入れる・AIに預ける =================
  function modal(html) { const m = $("#modal"); m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
  function closeModal() { const m = $("#modal"); m.hidden = true; m.innerHTML = ""; }
  function askText(label, val, done) {
    modal(`<h3>${esc(label)}</h3><div class="form"><input id="ask" type="text" value="${esc(val)}"><div style="display:flex;gap:8px"><button type="button" class="btn pri" id="askok" style="flex:1">決める</button><button type="button" class="btn" data-mclose="1">やめる</button></div></div>`);
    const i = $("#ask"); i.focus(); i.select();
    const ok = () => { const v = i.value; closeModal(); done(v); };
    $("#askok").onclick = ok; i.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) ok(); };
  }
  let capKind = "inbox";
  function openCapture() {
    modal(`<h3>新しく入れる</h3><div class="form"><div class="seg">${[["inbox", "📥 収集箱へ"], ["ai", "🤖 AIに頼む"]].map(([k, n]) => `<button type="button" data-cap="${k}" aria-pressed="${capKind === k}">${n}</button>`).join("")}</div>
      <label for="cp-name">名前</label><input id="cp-name" type="text" maxlength="200" placeholder="${capKind === "ai" ? "例）食洗機 ビルトイン 比較" : "例）郵便受けの対策を決める"}">
      ${capKind === "ai" ? `<label for="cp-url">参考URL</label><input id="cp-url" type="url" placeholder="https://"><label>頼み方</label><div class="modes">${[["🔍", "🔍 調べて"], ["🔬", "🔬 徹底調査"], ["💬", "💬 深掘り"]].map(([k, n]) => `<button type="button" data-reqmode="${k}" aria-pressed="${reqMode === k}"><b>${n}</b></button>`).join("")}</div>` : `<label for="cp-next">次の一歩（なくてもよい）</label><input id="cp-next" type="text" maxlength="200">`}
      <label for="cp-memo">メモ（本文に入る）</label><textarea id="cp-memo"></textarea>
      <div style="display:flex;gap:8px"><button type="button" class="btn pri" data-capgo="1" style="flex:1">${capKind === "ai" ? "AIに預ける" : "入れる"}</button><button type="button" class="btn" data-mclose="1">やめる</button></div></div>`);
    setTimeout(() => $("#cp-name")?.focus(), 50);
  }
  async function createTask({ name, kind, mode, url, next, memo }) {
    const props = { "名前": name, "ステータス": kind === "ai" ? ST.ai : ST.inbox, "プレイヤー": [PLAYER] };
    if (kind === "ai") props["AIアクション"] = mode;
    if (url) props["userDefined:URL"] = url;
    if (next) props.NEXT = next;
    const content = [next ? `## やること\n\n- [ ] ${next}` : "", memo ? `## メモ\n\n${memo}` : ""].filter(Boolean).join("\n\n");
    const local = (u) => toTask({ url: u, 名前: name, NEXT: next || "", ステータス: props["ステータス"], AIアクション: props["AIアクション"] || null, "userDefined:URL": url || "", 最終更新日時: new Date().toISOString(), createdTime: new Date().toISOString() });
    if (S.mode === "demo") { const t = local(`https://www.notion.so/${"d".repeat(24)}${String(Date.now()).slice(-8)}`); S.tasks.push(t); DEMO_BODIES[t.id] = content; return t; }
    setSync("busy");
    try {
      const res = await call("create", { parent: { type: "data_source_id", data_source_id: DS.task }, pages: [{ properties: props, ...(content ? { content } : {}) }], allow_async: false }, { read: false });
      const pg = (res.pages || [])[0] || {}; const t = local(pg.url || `https://www.notion.so/${String(pg.id || "").replace(/-/g, "")}`); S.tasks.push(t); saveSnap(); setSync("ok"); return t;
    } catch (err) { setSync("err"); throw err; }
  }
  async function submitCapture() {
    const name = $("#cp-name").value.trim(); if (!name) { $("#cp-name").focus(); return; }
    const btn = $("[data-capgo]"); btn.disabled = true;
    try {
      await createTask({ name, kind: capKind, mode: reqMode, url: $("#cp-url")?.value.trim(), next: $("#cp-next")?.value.trim(), memo: $("#cp-memo").value.trim() });
      closeModal(); refresh(); toast(capKind === "ai" ? `AIに預けました（次の定時処理 ${nextRun()}）` : "収集箱に入れました");
    } catch (err) { btn.disabled = false; toast(err?.code === "server_unavailable" ? "返事がありません。重ならないよう ↻ で確かめてから入れ直してください" : `入れられませんでした：${errText(err)}`); }
  }
  async function submitRequest() {
    const name = $("#rq-name").value.trim(); if (!name) { $("#rq-name").focus(); return; }
    const btn = $("[data-req]"); btn.disabled = true;
    try { await createTask({ name, kind: "ai", mode: reqMode, url: $("#rq-url").value.trim(), memo: $("#rq-memo").value.trim() }); S.aiSeg = "ai"; render(); toast(`AIに預けました（次の定時処理 ${nextRun()}）`); }
    catch (err) { btn.disabled = false; toast(`預けられませんでした：${errText(err)}`); }
  }
  function pickForAi() {
    const cands = [...inStage("inbox"), ...inStage("next"), ...inStage("some")].slice(0, 40);
    modal(`<h3>AIに預けるタスクを選ぶ（${reqMode}）</h3><div class="list" style="max-height:60vh;overflow:auto;padding:6px 0">${cands.map((t) => `<button type="button" class="row" data-aipick="${t.id}" style="height:52px"><span class="dot" style="--c:${STAGES[stageOf(t)].c}"></span><span class="main"><span class="nm">${esc(t.name)}</span><span class="sub">${STAGES[stageOf(t)].name}</span></span></button>`).join("") || `<div class="empty">候補がありません</div>`}</div><div class="form"><button type="button" class="btn" data-mclose="1">閉じる</button></div>`);
  }

