  // ================= 🧭 コーチのカード：毎平日 8:13 の定期実行「🧭 コーチ」が作る「🧭 コーチ M/D（曜）」の行を、今日タブの一番上に出す =================
  // 会社でスマホから1分で読んで答えられるように：気づき（短く）→ 問い（押すだけ）→ ひとこと → 今日の一手。
  // 答えは Notion のそのページの「- [ ]」を「- [x]」にし、コメントは「💬 コメント：」の後ろに書く（次の朝のコーチが読む）
  const isCoach = (t) => /🧭\s*コーチ/.test(t.name || "");
  const coachTask = () => {
    const list = S.tasks.filter((t) => isCoach(t) && t.status !== ST.done && t.status !== ST.ref);
    return list.find((t) => t.date === TODAY()) || list.sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || null;
  };
  const CO = { id: "", edited: "", raw: "", data: null, busy: false };
  const COACH_DEMO = "## 💬 昨日の答えから\n\n昨日は3件片づけて、今朝ももう1件。いい流れです。\n\n## 👀 気づき\n\n（例）塀の補助は締切が11/30（月）。電話できる平日は今日・明日・月曜の3日だけです。\n\n## ❓ 問い\n\n塀の補助の電話、いつにしますか？\n\n- [ ] 今日の昼休みにかける\n- [ ] 明日（金）の昼休みにかける\n- [ ] 補助は使わない（資料にする）\n\n💬 コメント：\n\n## 👣 今日の一手\n\n建築指導課に電話して「対象になるか」だけ聞いてみませんか。5分で終わります。";
  function coachParse(raw) {
    const secs = {}; let cur = null;
    for (const l of raw.split("\n")) {
      const m = l.match(/^##\s*(.+)$/); if (m) { cur = m[1]; secs[cur] = []; continue; }
      if (cur) secs[cur].push(l);
    }
    const pick = (re) => { const k = Object.keys(secs).find((x) => re.test(x)); return k ? secs[k] : []; };
    const lines = (arr) => arr.map((l) => l.trim()).filter((l) => l && !/^<\/?toggle/.test(l));
    const q = pick(/問い/); const opts = []; let title = ""; let comment = "";
    for (const l of lines(q)) {
      const o = l.match(/^[-*]\s*\[( |x)\]\s*(.+)$/i);
      if (o) opts.push({ text: o[2].trim(), on: o[1].toLowerCase() === "x" });
      else if (/^💬\s*コメント[：:]/.test(l)) comment = l.replace(/^💬\s*コメント[：:]\s*/, "");
      else if (!title) title = l;
    }
    return { said: lines(pick(/昨日の答え/)).join(" "), notice: lines(pick(/気づき/)), title, opts, comment, step: lines(pick(/一手/)) };
  }
  async function coachLoad(t) {
    if (CO.busy) return; CO.busy = true;
    try { const raw = S.mode === "demo" ? COACH_DEMO : await fetchBody(t.id); Object.assign(CO, { id: t.id, edited: t.edited, raw, data: coachParse(raw) }); }
    catch { Object.assign(CO, { id: t.id, edited: t.edited, raw: "", data: null }); }
    CO.busy = false; const box = $("#coach"); if (box && S.tab === "today") box.outerHTML = coachCardHtml();
  }
  function coachCardHtml() {
    const t = coachTask(); if (!t) return "";
    const fresh = CO.id === t.id && CO.edited === t.edited;
    if (!fresh) { setTimeout(() => coachLoad(t), 0); return `<section class="coach card" id="coach"><div class="coh"><b>🧭 ${esc(t.name.replace(/^（例）/, "").replace(/^🧭\s*/, ""))}</b></div><p class="mute">読みこみ中…</p></section>`; }
    const c = CO.data;
    if (!c) return `<section class="coach card" id="coach"><div class="coh"><b>🧭 ${esc(t.name)}</b><button type="button" class="qc" data-open="${t.id}">開く</button></div><p class="mute">うまく読めなかった。開いて読んでね</p></section>`;
    const answered = c.opts.some((o) => o.on);
    return `<section class="coach card" id="coach">
      <div class="coh"><b>🧭 ${esc(t.name.replace(/^（例）/, "").replace(/^🧭\s*/, ""))}</b><button type="button" class="qc" data-open="${t.id}">全文</button></div>
      ${c.notice.length ? `<div class="cosec"><small>👀 気づき</small><p>${inline(c.notice.slice(0, 2).join(" "))}</p></div>` : ""}
      ${c.title ? `<div class="cosec"><small>❓ 問い${answered ? "（答えたよ）" : ""}</small><p class="coq">${inline(c.title)}</p>
        <div class="coopts">${c.opts.map((o, i) => `<button type="button" class="coopt${o.on ? " on" : ""}" data-coopt="${i}" aria-pressed="${o.on}">${esc(o.text)}</button>`).join("")}</div>
        <div class="cocm"><input type="text" id="cocm" maxlength="200" placeholder="ひとこと（なくてもOK）" value="${esc(c.comment)}"><button type="button" class="qc" data-cocm="1">送る</button></div></div>` : ""}
      ${c.step.length ? `<div class="cosec"><small>👣 今日の一手</small><p>${inline(c.step.join(" "))}</p></div>` : ""}
      <div class="cofoot"><button type="button" class="btn" data-cook="${t.id}">読んだ（しまう）</button></div>
    </section>`;
  }
  async function coachWrite(updates, msg) {
    const t = coachTask(); if (!t || !CO.data) return;
    if (S.mode === "demo") { toast(`${msg}（見本）`); return; }
    try { await call("update", { page_id: t.id, command: "update_content", content_updates: updates, allow_async: false }, { read: false }); toast(msg); }
    catch (err) { toast(`ごめん、書けなかった：${errText(err)}`); }
  }
  async function coachAnswer(i) {
    const c = CO.data; if (!c) return; const o = c.opts[i]; if (!o) return; buzz();
    const updates = [];
    for (const [j, x] of c.opts.entries()) {
      const want = j === i ? !x.on : false; if (want === x.on) continue;
      updates.push({ old_str: `- [${x.on ? "x" : " "}] ${x.text}`, new_str: `- [${want ? "x" : " "}] ${x.text}` }); x.on = want;
    }
    const box = $("#coach"); if (box) box.outerHTML = coachCardHtml();
    if (updates.length) await coachWrite(updates, o.on ? `「${short(o.text, 16)}」で答えたよ。明日の朝コーチが読むね` : "答えを外したよ");
  }
  async function coachComment() {
    const c = CO.data; const v = ($("#cocm")?.value || "").trim(); if (!c) return;
    if (v === c.comment) { toast("ひとことは変わってないよ"); return; }
    const old = `💬 コメント：${c.comment}`.trimEnd(); c.comment = v;
    await coachWrite([{ old_str: old, new_str: `💬 コメント：${v}` }], "ひとこと送ったよ");
  }
