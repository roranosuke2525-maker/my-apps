  // ================= タスクを動かす =================
  const dateProps = (d) => (d ? { "date:実行日:start": d, "date:実行日:is_datetime": 0 } : { "date:実行日:start": null });
  const MOVES = {
    done: { label: "済み", props: () => ({ "ステータス": ST.done }) },
    next: { label: "次にやる", props: () => ({ "ステータス": ST.next, ...dateProps(null) }) },
    today: { label: "今日やる", props: (t) => ({ "ステータス": t.status === ST.doing ? ST.doing : ST.next, ...dateProps(TODAY()) }) },
    tomorrow: { label: "明日", props: (t) => ({ "ステータス": t.status === ST.doing ? ST.doing : ST.next, ...dateProps(addDays(TODAY(), 1)) }) },
    wait: { label: "待ち", props: () => ({ "ステータス": ST.wait, ...dateProps(null) }) },
    some: { label: "いつか", props: () => ({ "ステータス": ST.some, ...dateProps(null) }) },
    ref: { label: "資料", props: () => ({ "ステータス": ST.ref }) },
    ai: { label: "AIに調べて（🔍）", props: () => ({ "ステータス": ST.ai, "AIアクション": "🔍" }) },
    deep: { label: "AIと深掘り（💬）", props: () => ({ "ステータス": ST.ai, "AIアクション": "💬" }) },
    thorough: { label: "AIに徹底調査（🔬）", props: () => ({ "ステータス": ST.ai, "AIアクション": "🔬" }) },
  };
  const FIELD = { "ステータス": "status", "AIアクション": "ai", "date:実行日:start": "date", NEXT: "next", "枠": "waku", "重さ": "weight", "分類タグ": "tag", "名前": "name" };
  function propsBefore(t, props) {
    const out = {};
    for (const k of Object.keys(props)) { if (k === "date:実行日:is_datetime") continue; const f = FIELD[k]; if (f) out[k] = t[f] ?? null; }
    if ("date:実行日:start" in out && out["date:実行日:start"]) out["date:実行日:is_datetime"] = 0;
    return out;
  }
  function applyLocal(t, props) {
    for (const [k, v] of Object.entries(props)) { const f = FIELD[k]; if (f) t[f] = v === "" ? null : v; }
    t.edited = new Date().toISOString();
    // 済み・資料は別の置き場へ
    const inTasks = S.tasks.includes(t), inDone = S.doneToday.includes(t), inRef = S.refs.includes(t);
    const want = t.status === ST.done ? "done" : t.status === ST.ref ? "ref" : "tasks";
    if (want !== "tasks" && inTasks) S.tasks.splice(S.tasks.indexOf(t), 1);
    if (want !== "done" && inDone) S.doneToday.splice(S.doneToday.indexOf(t), 1);
    if (want !== "ref" && inRef) S.refs.splice(S.refs.indexOf(t), 1);
    if (want === "tasks" && !S.tasks.includes(t)) S.tasks.push(t);
    if (want === "done" && !inDone) S.doneToday.unshift(t);
    if (want === "ref" && !inRef) S.refs.unshift(t);
  }
  // プロパティを書き換える（先に画面を変え、失敗したら戻す）。undo を付けると「取り消す」が出る
  async function setProps(t, props, msg, { undo = true, quiet = false } = {}) {
    const before = propsBefore(t, props);
    applyLocal(t, props); refresh();
    if (!quiet) toast(msg + (S.mode === "demo" ? "（見本）" : ""), undo ? () => setProps(t, before, "元に戻しました", { undo: false }) : null);
    if (S.mode === "demo") return true;
    setSync("busy");
    try { await call("update", { page_id: t.id, command: "update_properties", properties: props, allow_async: false }, { read: false }); saveSnap(); setSync("ok"); return true; }
    catch (err) { applyLocal(t, before); refresh(); setSync("err"); toast(`変更できませんでした：${errText(err)}`); return false; }
  }
  const move = (t, key, extra = "") => setProps(t, MOVES[key].props(t), `「${short(t.name)}」→ ${MOVES[key].label}${extra}`);
  const short = (s, n = 14) => (s.length > n ? `${s.slice(0, n)}…` : s);
  function setSync(st) { const el = $("#sync"); el.className = `sync ${st === "ok" ? "" : st}`; $("#synct").textContent = st === "busy" ? "書き込み中" : st === "err" ? "エラー" : S.mode === "demo" ? "見本" : S.loadedAt ? `${jstTime(S.loadedAt)} 更新` : ""; }
  // 平日 7:52〜17:52 毎時（土日・祝日は動かない。祝日は振替休日・国民の休日を含む 2026〜2027年）
  const HOLIDAYS = new Set(["2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06", "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
    "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23"]);
  const workday = (d) => dow(d) >= 1 && dow(d) <= 5 && !HOLIDAYS.has(d);
  function nextRun() {
    const n = new Date(Date.now() + 9 * 3600e3); const h = n.getUTCHours(); const m = n.getUTCMinutes();
    if (workday(TODAY()) && (h < 17 || (h === 17 && m < 52))) { const hh = h < 7 || (h === 7 && m < 52) ? 7 : m < 52 ? h : h + 1; return `今日 ${hh}:52`; }
    let d = TODAY(); do { d = addDays(d, 1); } while (!workday(d));
    return `${md(d)}（${WD[dow(d)]}）7:52`;
  }

  // ================= 頁送り・スワイプ =================
  function pageOf(key, items, per) {
    const pages = Math.max(1, Math.ceil(items.length / per));
    const p = Math.max(0, Math.min(S.page[key] || 0, pages - 1)); S.page[key] = p;
    return { slice: items.slice(p * per, p * per + per), p, pages };
  }
  // 枠の高さから1頁の件数を決め、下に頁送りを付ける
  function paged(box, key, items, unit, draw) {
    const per = Math.max(1, Math.floor((box.clientHeight + 1) / unit));
    const { slice, p, pages } = pageOf(key, items, per);
    box.innerHTML = slice.map(draw).join("");
    box.dataset.swipe = key; box.dataset.pages = pages;
    if (S.slide?.key === key) box.classList.add(S.slide.dir > 0 ? "in-l" : "in-r");
    box.insertAdjacentHTML("afterend", `<div class="pager">${pages > 1 ? `<button type="button" data-pg="${key}:-1" ${p ? "" : "disabled"} aria-label="前へ">◀</button><span>${p + 1} / ${pages}　左右にスワイプ</span><button type="button" data-pg="${key}:1" ${p < pages - 1 ? "" : "disabled"} aria-label="次へ">▶</button>` : `<span>${items.length}件</span>`}</div>`);
  }
  const swipe = (() => {
    let g = null, suppress = false;
    addEventListener("pointerdown", (e) => { const el = e.target.closest("[data-swipe]"); if (!el || e.button > 0 || e.target.closest("input, textarea, [contenteditable]")) return; g = { key: el.dataset.swipe, pages: +el.dataset.pages || 1, x: e.clientX, y: e.clientY, id: e.pointerId }; });
    addEventListener("pointerup", (e) => {
      if (!g || e.pointerId !== g.id) return; const G = g; g = null;
      const dx = e.clientX - G.x, dy = e.clientY - G.y; if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      suppress = true; setTimeout(() => { suppress = false; }, 250);
      const dir = dx < 0 ? 1 : -1; const p = (S.page[G.key] || 0) + dir; if (p < 0 || p >= G.pages) return;
      S.page[G.key] = p; S.slide = { key: G.key, dir }; render();
    });
    return { get suppress() { return suppress; } };
  })();

  // ================= 一覧の行 =================
  const TODAY_TXT = () => { const d = TODAY(); return `${+d.slice(5, 7)}月${+d.slice(8)}日（${WD[dow(d)]}）`; };
  function metaOf(t) {
    const d = TODAY();
    if (t.date) return t.date < d && t.status !== ST.done ? { tx: `遅れ ${diffDays(t.date, d)}日`, late: true } : { tx: t.date === d ? "今日" : `${md(t.date)}（${WD[dow(t.date)]}）` };
    return { tx: `${ageOf(t)}日` };
  }
  function rowHtml(t, i, { check = true } = {}) {
    const st = stageOf(t); const m = metaOf(t);
    const sub = t.ai && t.status === ST.ai ? `<span class="ai-mark">${t.ai}</span> ${esc(AI_LABEL[t.ai] || "")}` : esc(t.next || t.tag || "");
    return `<div class="row" data-id="${t.id}" style="--c:${STAGES[st]?.c || "var(--mute)"}">${check ? `<button type="button" class="check${t.status === ST.done ? " on" : ""}" data-done="${t.id}" aria-label="済みにする">✓</button>` : `<span class="dot"></span>`}
      <button type="button" class="main" data-open="${t.id}"><span class="nm">${esc(t.name)}</span><span class="sub">${sub}</span></button><span class="meta${m.late ? " late" : ""}">${esc(m.tx)}</span></div>`;
  }
  function stageItems(k) {
    const items = inStage(k).slice(); const d = TODAY();
    if (k === "today") return items.sort((a, b) => (b.date < d) - (a.date < d) || WAKU.indexOf(a.waku) - WAKU.indexOf(b.waku));
    if (k === "plan") return items.sort((a, b) => a.date.localeCompare(b.date));
    if (k === "next" || k === "wait") return items.sort((a, b) => (a.edited || "").localeCompare(b.edited || ""));
    if (k === "ai") return items.sort((a, b) => (AI_TURN[b.ai] === "me") - (AI_TURN[a.ai] === "me") || (b.edited || "").localeCompare(a.edited || ""));
    return items.sort((a, b) => (b.edited || "").localeCompare(a.edited || ""));
  }
  function groupBy(items, k) {
    const key = { today: (t) => t.waku || "枠なし", done: (t) => t.waku || "枠なし", plan: (t) => (t.date ? `${md(t.date)}（${WD[dow(t.date)]}）` : "—"), ai: (t) => (t.ai ? `${t.ai} ${AI_LABEL[t.ai]}` : "印なし") }[k] || ((t) => t.tag || "分類なし");
    const m = new Map(); for (const t of items) { const g = key(t); if (!m.has(g)) m.set(g, []); m.get(g).push(t); }
    return [...m];
  }
  function tableHtml(items) {
    return `<table class="grid"><thead><tr><th>名前</th><th>ステータス</th><th>実行日</th><th>枠</th><th>重さ</th><th>分類</th><th>AI</th><th>次の一歩</th></tr></thead><tbody>${items.map((t) => `<tr class="click" data-open="${t.id}"><td>${esc(short(t.name, 22))}</td><td>${esc(t.status)}</td><td class="${metaOf(t).late ? "late" : ""}">${t.date ? md(t.date) : ""}</td><td>${esc(t.waku || "")}</td><td>${esc(t.weight || "")}</td><td>${esc(t.tag || "")}</td><td>${esc(t.ai || "")}</td><td>${esc(short(t.next || "", 20))}</td></tr>`).join("")}</tbody></table>`;
  }

  // ================= 流れ（GTD） =================
  const FLOW_POS = { inbox: "1/1/2/4", ai: "1/4/2/7", next: "2/1/3/3", plan: "2/3/3/5", wait: "2/5/3/7", today: "3/1/4/5", some: "3/5/4/7", done: "4/1/5/4", ref: "4/4/5/7" };
  const EDGES = [["inbox", "ai"], ["inbox", "next"], ["ai", "next"], ["ai", "some"], ["ai", "ref"], ["next", "today"], ["plan", "today"], ["next", "wait"], ["today", "done"]];
  function renderFlow(view) {
    const d = TODAY(); const late = lateOf().length; const mine = myTurn().length;
    const cnt = Object.fromEntries(Object.keys(STAGES).map((k) => [k, inStage(k).length]));
    const inflow = [...S.tasks, ...S.doneToday, ...S.refs].filter((t) => t.created && jst(Date.parse(t.created)) === d).length;
    const maxAge = (k) => Math.max(0, ...inStage(k).map(ageOf));
    const soon = stageItems("plan")[0];
    const sub = { inbox: inflow ? `今日 +${inflow}` : S.more?.[ST.inbox] ? "100件以上" : "入ってきたもの", ai: `AI作業中 ${aiTurn().length}`, next: cnt.next ? `いちばん古い ${maxAge("next")}日` : "", plan: soon ? `次 ${md(soon.date)}（${WD[dow(soon.date)]}）` : "", today: late ? `遅れ ${late}` : cnt.today ? "のこり" : "終わり", wait: cnt.wait ? `最長 ${maxAge("wait")}日` : "", some: "", done: "今日", ref: `最近の${cnt.ref}件` };
    const loading = S.mode === "loading" && !S.tasks.length;
    view.insertAdjacentHTML("beforeend", `<div class="flow" id="flow"><svg class="edges" id="edges" aria-hidden="true"></svg><div class="nodes">${Object.entries(STAGES).map(([k, s]) => `<button type="button" class="node" data-stage="${k}" style="--c:${s.c};grid-area:${FLOW_POS[k]}" aria-pressed="${S.stage === k}" title="${s.sub}"><span class="k">${s.name}</span><span class="n">${loading ? "…" : cnt[k]}${k === "ref" && S.refMore ? "+" : ""}</span><span class="s${k === "today" && late ? " late" : ""}">${esc(sub[k])}</span>${k === "ai" && mine ? `<span class="flag">あなたの番 ${mine}</span>` : ""}</button>`).join("")}</div></div>
      <div class="card panel" id="stagepanel"></div>`);
    requestAnimationFrame(() => drawEdges(cnt));
    const st = STAGES[S.stage]; const items = stageItems(S.stage);
    const panel = $("#stagepanel");
    panel.innerHTML = `<div class="panel-head"><span class="dot" style="--c:${st.c}"></span><b>${st.name}</b><span class="mute" style="font-size:12px">${items.length}件</span><div class="seg">${[["list", "リスト"], ["board", "ボード"], ["table", "表"]].map(([k, n]) => `<button type="button" data-sview="${k}" aria-pressed="${S.stageView === k}">${n}</button>`).join("")}</div></div><div class="list" id="stagelist"></div>`;
    const box = $("#stagelist");
    if (!items.length) { box.innerHTML = `<div class="empty">${loading ? "読みこみ中…" : S.stage === "today" ? "今日やることは全部終わりました" : "ここには何もありません"}</div>`; return; }
    if (S.stageView === "board") { box.outerHTML = `<div class="board">${groupBy(items, S.stage).map(([g, list]) => `<div class="col"><h4><span>${esc(g)}</span><span class="num mute">${list.length}</span></h4>${list.slice(0, 12).map((t) => `<button type="button" class="bcard" data-open="${t.id}">${esc(t.name)}<span class="sub">${esc(t.next || metaOf(t).tx)}</span></button>`).join("")}${list.length > 12 ? `<span class="mute" style="font-size:11px;padding:2px 4px">ほか ${list.length - 12}件</span>` : ""}</div>`).join("")}</div>`; return; }
    if (S.stageView === "table") { box.className = "tablewrap"; const per = Math.max(1, Math.floor((box.clientHeight - 32) / 33)); const { slice, p, pages } = pageOf(`tb:${S.stage}`, items, per); box.innerHTML = tableHtml(slice); box.dataset.swipe = `tb:${S.stage}`; box.dataset.pages = pages; box.insertAdjacentHTML("afterend", `<div class="pager">${pages > 1 ? `<button type="button" data-pg="tb:${S.stage}:-1" ${p ? "" : "disabled"}>◀</button><span>${p + 1} / ${pages}</span><button type="button" data-pg="tb:${S.stage}:1" ${p < pages - 1 ? "" : "disabled"}>▶</button>` : `<span>${items.length}件</span>`}</div>`); return; }
    paged(box, `st:${S.stage}`, items, 52, (t, i) => rowHtml(t, i, { check: !["done", "ref"].includes(S.stage) }));
  }
  function drawEdges(cnt) {
    const svg = $("#edges"); const flow = $("#flow"); if (!svg || !flow) return;
    const fr = flow.getBoundingClientRect();
    const rect = (k) => { const r = flow.querySelector(`.node[data-stage="${k}"]`).getBoundingClientRect(); return { x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height }; };
    let html = "";
    EDGES.forEach(([a, b], i) => {
      const A = rect(a), B = rect(b); let d;
      if (Math.abs(A.y - B.y) < 4) { const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2; d = `M${x1},${y1} L${x2},${y2}`; }
      else { const x1 = Math.min(Math.max(A.x + A.w / 2, B.x + 14), B.x + B.w - 14), y1 = A.y + A.h, x2 = Math.min(Math.max(x1, B.x + 14), B.x + B.w - 14), y2 = B.y; const my = (y1 + y2) / 2; d = `M${A.x + A.w / 2},${y1} C${A.x + A.w / 2},${my} ${x2},${my} ${x2},${y2}`; }
      html += `<path class="edge" id="e${i}" d="${d}"/>`;
      const n = reduce ? 0 : Math.min(3, Math.ceil((cnt[a] || 0) / 4));
      for (let k = 0; k < n; k++) html += `<circle r="3" class="pt" style="--c:${STAGES[a].c}"><animateMotion dur="${2.6 + i * .15}s" repeatCount="indefinite" begin="${(-k * (2.6 / n)).toFixed(2)}s"><mpath href="#e${i}"/></animateMotion></circle>`;
    });
    svg.innerHTML = html;
  }

  // ================= AI =================
  function conclusionOf(raw) {
    const L = raw.split("\n");
    let h = L.findIndex((l) => /^##\s.*(調査結果|徹底調査結果).*最新/.test(l)); if (h < 0) h = L.findIndex((l) => /^##\s.*(調査結果|徹底調査結果)/.test(l));
    if (h < 0) return "";
    for (let i = h + 1; i < L.length && !/^##\s/.test(L[i]); i++) {
      if (/^<callout/.test(L[i].trim())) { const out = []; for (let j = i + 1; j < L.length && !/^<\/callout>/.test(L[j].trim()); j++) if (L[j].trim()) out.push(L[j]); return text(out.join(" ")).slice(0, 160); }
      if (L[i].trim() && !/^#{3,4}\s/.test(L[i]) && !/^</.test(L[i].trim())) return text(L[i]).slice(0, 160);
    }
    return "";
  }
  // 💬 の最新の質問票を読む（質問・選択肢・コメント欄・明確度・決めることリスト）
  function qaParse(raw) {
    const L = raw.split("\n");
    let h = -1;
    L.forEach((l, i) => { if (/^##\s/.test(l) && /💬/.test(l)) { if (/最新/.test(l)) h = i; else if (h < 0 || !/最新/.test(L[h])) h = i; } });
    if (h < 0) return null;
    let end = h + 1; while (end < L.length && !/^##\s/.test(L[end]) && !/^###\s*🗂/.test(L[end])) end++;
    const sec = L.slice(h, end);
    const qa = { h, end, sec, qs: [], decide: [], clarity: null };
    const cl = sec.join("\n").match(/明確度\s*([0-9]+)\s*\/\s*([0-9]+)/); if (cl) qa.clarity = [+cl[1], +cl[2]];
    let mode = null; let cur = null;
    sec.forEach((l, i) => {
      if (/^#{3,4}\s.*決めること/.test(l)) { mode = "decide"; return; }
      const qm = l.match(/^(?:#{3,4}\s*)?(?:\*\*|<b>)?\s*(?:❓\s*)?(Q\s*\d+[\s\S]*)$/);
      if (qm && !/^\s*[-*+]\s/.test(l)) { mode = "q"; cur = { title: text(qm[1].replace(/(\*\*|<\/?b>)/g, "")), opts: [], comment: null, line: i }; qa.qs.push(cur); return; }
      if (/^#{3,4}\s/.test(l)) { mode = null; return; }
      const om = l.match(/^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/);
      if (om && mode === "decide") { qa.decide.push({ text: text(om[3]), checked: om[2] !== " " }); return; }
      if (om && mode === "q" && cur) { cur.opts.push({ i, text: text(om[3]), checked: om[2] !== " ", was: om[2] !== " " }); return; }
      const cm = l.match(/^(\s*(?:[-*]\s+)?(?:<b>|\*\*)?\s*(?:💬\s*コメント|回答)\s*(?:<\/b>|\*\*)?\s*[:：]\s*)(.*)$/);
      if (cm && mode === "q" && cur) { cur.comment = { i, prefix: cm[1], value: text(cm[2]), was: cm[2] }; }
    });
    return qa.qs.length || qa.decide.length ? qa : null;
  }
  function qaWrite(qa) {
    const out = qa.sec.slice(); const inserts = [];
    for (const q of qa.qs) {
      for (const o of q.opts) out[o.i] = out[o.i].replace(/\[( |x|X)\]/, o.checked ? "[x]" : "[ ]");
      if (q.comment) { if (q.newComment != null) out[q.comment.i] = q.comment.prefix + q.newComment.replace(/\n/g, " "); }
      else if (q.newComment) { const last = q.opts.length ? q.opts.at(-1).i : q.line; inserts.push([last + 1, ["", `💬 コメント：${q.newComment.replace(/\n/g, " ")}`]]); }
    }
    inserts.sort((a, b) => b[0] - a[0]).forEach(([at, ls]) => out.splice(at, 0, ...ls));
    return out.join("\n");
  }
  function summaryOf(t) { const b = S.bodies[t.id]; return b && b.edited === t.edited ? b : null; }
  let prefetching = false;
  async function prefetchBodies() {
    if (prefetching || S.mode === "loading" || S.mode === "error") return; prefetching = true;
    const todo = myTurn().filter((t) => !summaryOf(t)).slice(0, 15);
    const worker = async () => {
      for (let t; (t = todo.shift());) {
        try { const raw = await fetchBody(t.id); S.bodies[t.id] = summarize(t, raw); store.set("sums", S.bodies); if ((S.tab === "ai" && S.aiSeg === "me") || (S.tab === "triage" && S.pileKey === "judge")) render(); } catch { /* 次回 */ }
      }
    };
    await Promise.all([worker(), worker(), worker()]); prefetching = false;
  }
  function summarize(t, raw) {
    const qa = qaParse(raw);
    return { edited: t.edited, conc: conclusionOf(raw), qn: qa?.qs.length || 0, q1: qa?.qs[0]?.title || "", clarity: qa?.clarity || null };
  }
  async function fetchBody(id) {
    if (S.mode === "demo") return DEMO_BODIES[id] || DEMO_BODY;
    const res = await call("fetch", { id }, { read: true });
    const tx = String(res.text || ""); const a = tx.indexOf("<content>"), b = tx.lastIndexOf("</content>");
    return a >= 0 && b > a ? tx.slice(a + 9, b).replace(/^\n/, "").replace(/\n$/, "") : "";
  }
  function renderAi(view) {
    const me = myTurn().sort((a, b) => (a.ai === "💭" ? 0 : 1) - (b.ai === "💭" ? 0 : 1) || (b.edited || "").localeCompare(a.edited || ""));
    const ai = aiTurn().sort((a, b) => AIA.indexOf(a.ai) - AIA.indexOf(b.ai) || (a.edited || "").localeCompare(b.edited || ""));
    const c = (arr, m) => arr.filter((t) => t.ai === m).length;
    view.insertAdjacentHTML("beforeend", `<div class="aihead"><button type="button" class="card mine" data-aiseg="me"><div class="k">あなたの番</div><div class="n">${me.length}</div><div class="s">💭 回答 ${c(me, "💭")}・🔍✅ 判定 ${c(me, "🔍✅")}</div></button><button type="button" class="card" data-aiseg="ai"><div class="k">AIの番</div><div class="n">${ai.length}</div><div class="s">🔍 ${c(ai, "🔍")}・🔬 ${c(ai, "🔬")}・💬 ${c(ai, "💬")}</div></button><div class="card"><div class="k">次の定時処理</div><div class="n" style="font-size:16px;padding:4px 0 2px">${nextRun()}</div><div class="s">平日 7:52〜17:52 毎時・祝日休み</div></div></div>
      <div class="seg">${[["me", "あなたの番", me.length], ["ai", "AIの番", ai.length], ["req", "依頼する", ""]].map(([k, n, x]) => `<button type="button" data-aiseg="${k}" aria-pressed="${S.aiSeg === k}">${n}<span class="n">${x}</span></button>`).join("")}</div>
      <div class="card panel"><div class="list" id="ailist"></div></div>`);
    const box = $("#ailist");
    if (S.aiSeg === "req") { box.outerHTML = requestForm(); return; }
    const items = S.aiSeg === "me" ? me : ai;
    if (!items.length) { box.innerHTML = `<div class="empty">${S.aiSeg === "me" ? "あなたの番はありません。\nAIの返事を待っています" : "AIに預けているものはありません。\n「依頼する」から頼めます"}</div>`; return; }
    paged(box, `ai:${S.aiSeg}`, items, 88, (t) => {
      const sm = summaryOf(t);
      const what = t.ai === "💭" ? `<span class="what ans">💭 回答する</span>` : t.ai === "🔍✅" ? `<span class="what">🔍✅ 判定する</span>` : `<span class="what">${t.ai} ${AI_LABEL[t.ai]}</span>`;
      const pv = t.ai === "💭" ? (sm ? `${sm.clarity ? `<span class="clar">明確度 ${sm.clarity[0]}/${sm.clarity[1]}<i style="--p:${Math.round((sm.clarity[0] / sm.clarity[1]) * 100)}%"></i></span>　` : ""}質問 ${sm.qn}問${sm.q1 ? `：<b>${esc(short(sm.q1, 40))}</b>` : ""}` : "質問票を読みこみ中…")
        : t.ai === "🔍✅" ? (sm ? (sm.conc ? `⭐ <b>${esc(sm.conc)}</b>` : "結論の要約が見つかりません（開いて確認）") : "結論を読みこみ中…")
        : `預けて ${ageOf(t)}日${t.ai === "🔬" ? "・1回の定時処理で1件ずつ" : ""}${t.next ? `　次の一歩：${esc(t.next)}` : ""}`;
      return `<button type="button" class="aicard" data-open="${t.id}" style="height:88px"><span class="t">${what}<b>${esc(t.name)}</b><span class="mute" style="font-size:11px">${ageOf(t)}日</span></span><span class="pv">${pv}</span></button>`;
    });
    if (S.aiSeg === "me") prefetchBodies();
  }
  let reqMode = "🔍";
  function requestForm() {
    return `<div class="form" style="flex:1;min-height:0;overflow:auto"><label for="rq-name">何を調べる・決める？</label><input id="rq-name" type="text" maxlength="200" placeholder="例）食洗機 ビルトイン 45cm 比較">
      <label for="rq-url">参考URL（なくてもよい）</label><input id="rq-url" type="url" placeholder="https://">
      <label for="rq-memo">メモ（条件・気になること）</label><textarea id="rq-memo" placeholder="例）予算10万円まで。深さ45cm"></textarea>
      <label>頼み方</label><div class="modes">${[["🔍", "🔍 調べて", "答え・情報がほしい"], ["🔬", "🔬 徹底調査", "市場を網羅（1回1件）"], ["💬", "💬 深掘り", "質問票で一緒に決める"]].map(([k, n, d]) => `<button type="button" data-reqmode="${k}" aria-pressed="${reqMode === k}"><b>${n}</b>${d}</button>`).join("")}</div>
      <div style="display:flex;gap:8px;margin-top:4px"><button type="button" class="btn pri" data-req="1" style="flex:1">AIに預ける</button><button type="button" class="btn" data-pickai="1">今あるタスクから</button></div>
      <p class="mute" style="font-size:11.5px;margin:0">ステータス「🤖 AI」で DB_タスク管理 に入ります。次の定時処理（${nextRun()}）で処理されます。</p></div>`;
  }

  // ================= 仕分け =================
  const PILES = {
    inbox: { name: "収集", c: "var(--s-inbox)", items: () => inStage("inbox").sort((a, b) => (a.created || a.edited || "").localeCompare(b.created || b.edited || "")), dirs: { r: "next", l: "some", u: "ai", d: "ref" } },
    judge: { name: "判定待ち", c: "var(--s-ai)", items: () => S.tasks.filter((t) => t.status === ST.ai && t.ai === "🔍✅").sort((a, b) => (a.edited || "").localeCompare(b.edited || "")), dirs: { r: "next", l: "some", u: "ai", d: "ref" } },
    next: { name: "次にやる", c: "var(--s-next)", items: () => stageItems("next"), dirs: { r: "today", l: "some", u: "ai", d: "wait" } },
    wait: { name: "待ち", c: "var(--s-wait)", items: () => stageItems("wait"), dirs: { r: "next", l: "some", u: "today", d: "done" } },
    some: { name: "いつか", c: "var(--s-some)", items: () => inStage("some").sort((a, b) => (a.edited || "").localeCompare(b.edited || "")), dirs: { r: "next", l: "skip", u: "ai", d: "ref" } },
  };
  const skipped = new Set();
  const DIR_LABEL = (k) => (k === "skip" ? "まだ置く" : k === "ai" ? "AIに調べて" : MOVES[k].label);
  function renderTriage(view) {
    const P = PILES[S.pileKey];
    const items = P.items().sort((a, b) => skipped.has(a.id) - skipped.has(b.id));
    view.insertAdjacentHTML("beforeend", `<div class="chips">${Object.entries(PILES).map(([k, p]) => `<button type="button" class="chip" data-pile="${k}" aria-pressed="${S.pileKey === k}">${p.name}<span class="n">${p.items().length}</span></button>`).join("")}</div>
      <div class="pile" id="pile"></div>
      <div class="dirs">${[["l", "←"], ["d", "↓"], ["u", "↑"], ["r", "→"]].map(([d, a]) => `<button type="button" data-dir="${d}" style="--c:${d === "r" ? "var(--s-next)" : d === "u" ? "var(--s-ai)" : d === "d" ? "var(--s-ref)" : "var(--s-some)"}"><b>${a}</b>${DIR_LABEL(P.dirs[d])}</button>`).join("")}</div>
      <div class="subacts"><button type="button" data-sub="open">開く</button><button type="button" data-sub="today">今日やる</button><button type="button" data-sub="done">済み</button><button type="button" data-sub="skip">あとで</button></div>`);
    const pile = $("#pile");
    if (!items.length) { pile.innerHTML = `<div class="empty">「${P.name}」の山は空です${S.pileKey === "inbox" ? "\n収集箱がからっぽ。いい状態です" : ""}</div>`; return; }
    items.slice(0, 3).reverse().forEach((t, ri, arr) => {
      const i = arr.length - 1 - ri; const sm = summaryOf(t); const m = metaOf(t);
      pile.insertAdjacentHTML("beforeend", `<div class="tcard ${i === 1 ? "b1" : i === 2 ? "b2" : "top"}" data-card="${t.id}" style="--c:${P.c}">
        <div style="display:flex;gap:6px;align-items:center">${t.tag ? `<span class="tag">${esc(t.tag)}</span>` : ""}${t.ai && t.status === ST.ai ? `<span class="tag">${t.ai} ${AI_LABEL[t.ai]}</span>` : ""}<span class="mute" style="margin-left:auto;font-size:11.5px">${items.length}枚中 1枚目</span></div>
        <h3>${esc(t.name)}</h3>${t.next ? `<div class="nx">次の一歩：<b>${esc(t.next)}</b></div>` : ""}
        ${S.pileKey === "judge" ? `<div class="pv">${sm ? (sm.conc ? `⭐ ${esc(sm.conc)}` : "（結論の要約なし。開いて確認）") : "結論を読みこみ中…"}</div>` : ""}
        <div class="meta"><span class="${m.late ? "late" : ""}">${t.date ? m.tx : `${ageOf(t)}日前から`}</span>${t.weight ? `<span>重さ ${t.weight}</span>` : ""}${t.waku ? `<span>${esc(t.waku)}</span>` : ""}${t.link ? `<span>🔗 URLあり</span>` : ""}</div>
        ${["r", "l", "u", "d"].map((d) => `<span class="stamp ${d}">${DIR_LABEL(P.dirs[d])}</span>`).join("")}</div>`);
    });
    const top = $(".tcard.top", pile); if (top) dragCard(top);
    if (S.pileKey === "judge") prefetchBodies();
  }
  function fling(card, d) {
    const t = known.get(card.dataset.card); const key = PILES[S.pileKey].dirs[d];
    card.style.transition = "transform .3s ease-in, opacity .3s"; card.style.transform = { r: "translate(130%,20px) rotate(16deg)", l: "translate(-130%,20px) rotate(-16deg)", u: "translate(0,-120%)", d: "translate(0,120%)" }[d]; card.style.opacity = "0";
    setTimeout(() => { if (key === "skip") { skipped.add(t.id); render(); toast(`「${short(t.name)}」はまだ置いておきます`); } else move(t, key); }, reduce ? 0 : 260);
  }
  function dragCard(card) {
    let x0, y0, on = false;
    card.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; x0 = e.clientX; y0 = e.clientY; on = true; card.setPointerCapture(e.pointerId); card.style.transition = "none"; });
    card.addEventListener("pointermove", (e) => {
      if (!on) return; const dx = e.clientX - x0, dy = e.clientY - y0;
      card.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 16}deg)`;
      const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : dy < 0 ? "u" : "d";
      for (const s of card.querySelectorAll(".stamp")) s.style.opacity = s.classList.contains(d) ? Math.min(1, Math.hypot(dx, dy) / 90) : 0;
    });
    card.addEventListener("pointerup", (e) => {
      if (!on) return; on = false; const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.hypot(dx, dy) > 90) { fling(card, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : dy < 0 ? "u" : "d"); return; }
      card.style.transition = ""; card.style.transform = ""; for (const s of card.querySelectorAll(".stamp")) s.style.opacity = 0;
      if (Math.hypot(dx, dy) < 6) openTask(card.dataset.card);
    });
  }

  // ================= 記録（診断・運用ログ・目標とプロジェクト） =================
  function renderLog(view) {
    view.insertAdjacentHTML("beforeend", `<div class="seg">${[["diag", "診断"], ["log", "運用ログ"], ["goal", "目標・PJ"]].map(([k, n]) => `<button type="button" data-logseg="${k}" aria-pressed="${S.logSeg === k}">${n}</button>`).join("")}</div>`);
    if (S.logSeg === "diag") return renderDiag(view);
    if (S.logSeg === "log") return renderOpsLog(view);
    return renderGoals(view);
  }
  function renderDiag(view) {
    const ds = S.diag; const d = ds.at(-1);
    if (!d) { view.insertAdjacentHTML("beforeend", `<div class="card panel"><div class="empty">${esc(S.extraErr.diag || "診断レポートはまだありません")}</div></div>`); return; }
    const prev = ds.at(-2); const delta = prev ? Math.round((d.rate - prev.rate) * 100) : null;
    view.insertAdjacentHTML("beforeend", `<div class="statrow"><div class="card stat"><div class="k">今日やる完了率</div><div class="n">${Math.round(d.rate * 100)}%</div><div class="s">${delta == null ? "" : `前回から ${delta >= 0 ? "+" : ""}${delta}pt`}</div></div><div class="card stat"><div class="k">完了</div><div class="n">${d.done}</div><div class="s">件</div></div><div class="card stat"><div class="k">流入</div><div class="n">${d.inflow}</div><div class="s">件</div></div><div class="card stat"><div class="k">回</div><div class="n">${d.no}</div><div class="s">${d.from ? `${md(d.from)}〜${md(d.to || d.from)}` : ""}</div></div></div>
      <button type="button" class="card verdict" data-diag="${d.id}"><span class="mute" style="font-size:11.5px">第${d.no}回の判定</span><b>${esc(d.verdict || "—")}</b><span class="nx">次の一手：${esc(d.next || "—")}</span></button>
      <div class="card chart" id="dchart"></div>
      <div class="card panel"><div class="list" id="dlist"></div></div>`);
    const W = 340, H = 118, pl = 26, pr = 26, pt = 10, pb = 18; const n = ds.length; const max = Math.max(10, ...ds.map((x) => Math.max(x.done, x.inflow)));
    const X = (i) => pl + ((i + .5) * (W - pl - pr)) / n; const Y = (v) => pt + (1 - v / max) * (H - pt - pb); const YR = (r) => pt + (1 - r) * (H - pt - pb); const bw = Math.min(12, (W - pl - pr) / n / 3);
    const ticks = [0, Math.round(max / 2), max];
    $("#dchart").innerHTML = `<div class="legend"><span><i style="background:var(--s-inbox);opacity:.5"></i>流入</span><span><i style="background:var(--s-done)"></i>完了</span><span><i style="background:var(--s-today)"></i>今日やる完了率（右の目盛り）</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="診断の推移">
      ${ticks.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line)"/><text x="${pl - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`).join("")}${[0, .5, 1].map((r) => `<text x="${W - pr + 4}" y="${YR(r) + 3}">${r * 100}%</text>`).join("")}
      ${ds.map((x, i) => `<rect x="${X(i) - bw - 1}" y="${Y(x.inflow)}" width="${bw}" height="${Y(0) - Y(x.inflow)}" rx="2" style="fill:var(--s-inbox);opacity:.5"/><rect x="${X(i) + 1}" y="${Y(x.done)}" width="${bw}" height="${Y(0) - Y(x.done)}" rx="2" style="fill:var(--s-done)"/><text x="${X(i)}" y="${H - 4}" text-anchor="middle">${x.no}</text>`).join("")}
      <polyline points="${ds.map((x, i) => `${X(i)},${YR(x.rate)}`).join(" ")}" fill="none" style="stroke:var(--s-today)" stroke-width="2"/>${ds.map((x, i) => `<circle cx="${X(i)}" cy="${YR(x.rate)}" r="${i === n - 1 ? 4 : 2.5}" style="fill:var(--s-today)"/>`).join("")}</svg>`;
    paged($("#dlist"), "diag", ds.slice().reverse(), 52, (x) => `<button type="button" class="row" data-diag="${x.id}"><span class="main"><span class="nm">第${x.no}回　${esc(x.verdict || "")}</span><span class="sub">${esc(x.next || "")}</span></span><span class="meta"><span class="num">${Math.round(x.rate * 100)}%</span><br>${x.from ? md(x.from) : ""}</span></button>`);
  }
  function renderOpsLog(view) {
    const evs = [...new Set(S.logs.map((l) => l.event).filter(Boolean))];
    const items = S.logs.filter((l) => !S.logEvent || l.event === S.logEvent);
    view.insertAdjacentHTML("beforeend", `<div class="chips"><button type="button" class="chip" data-ev="" aria-pressed="${!S.logEvent}">すべて<span class="n">${S.logs.length}</span></button>${evs.map((e) => `<button type="button" class="chip" data-ev="${esc(e)}" aria-pressed="${S.logEvent === e}">${esc(e)}<span class="n">${S.logs.filter((l) => l.event === e).length}</span></button>`).join("")}</div><div class="card panel"><div class="list" id="loglist"></div></div>`);
    const box = $("#loglist");
    if (!items.length) { box.innerHTML = `<div class="empty">${esc(S.extraErr.log || "運用ログはまだありません")}</div>`; return; }
    paged(box, `log:${S.logEvent}`, items, 52, (l) => { const t = l.at ? Date.parse(l.at) : 0; return `<button type="button" class="row" data-log="${l.id}"><span class="main"><span class="nm">${esc(l.name)}</span><span class="sub">${esc(l.body || "")}</span></span><span class="meta">${esc(l.event)}<br>${t ? `${jst(t) === TODAY() ? "今日" : md(jst(t))} ${jstTime(t)}` : ""}</span></button>`; });
  }
  function projStats(p) {
    const open = S.tasks.filter((t) => t.projects.includes(p.id));
    const done = Math.max(0, p.total - open.length);
    return { open, done, pct: p.total ? Math.round((done / p.total) * 100) : 0 };
  }
  function renderGoals(view) {
    const items = []; const live = S.goals.filter((g) => !/達成|完了|手放/.test(g.status)).sort((a, b) => (/挑戦中/.test(b.status) ? 1 : 0) - (/挑戦中/.test(a.status) ? 1 : 0));
    const used = new Set();
    for (const g of live) { items.push({ k: "g", g }); for (const pid of g.projects) { const pj = S.projects.find((x) => x.id === pid); if (pj && !pj.status.includes("完了")) { items.push({ k: "p", p: pj }); used.add(pj.id); } } }
    const rest = S.projects.filter((x) => !used.has(x.id) && !x.status.includes("完了"));
    if (rest.length) { items.push({ k: "h" }); rest.forEach((x) => items.push({ k: "p", p: x })); }
    view.insertAdjacentHTML("beforeend", `<div class="card panel"><div class="list" id="goallist"></div></div>`);
    const box = $("#goallist");
    if (!items.length) { box.innerHTML = `<div class="empty">${esc(S.extraErr.goal || "目標はまだありません")}</div>`; return; }
    paged(box, "goals", items, 52, (x) => x.k === "g" ? `<button type="button" class="row" data-goal="${x.g.id}"><span class="dot" style="--c:${/挑戦中/.test(x.g.status) ? "var(--s-today)" : "var(--mute)"}"></span><span class="main"><span class="nm" style="font-weight:700">${esc(x.g.name)}</span><span class="sub">${esc([x.g.status, x.g.area, x.g.due ? `期限 ${md(x.g.due)}` : ""].filter(Boolean).join("・"))}</span></span></button>`
      : x.k === "h" ? `<div class="row" style="height:52px;color:var(--mute);font-size:12px">目標につながっていないプロジェクト</div>`
      : (() => { const st = projStats(x.p); return `<button type="button" class="row" data-proj="${x.p.id}" style="padding-left:30px"><span class="main"><span class="nm">${esc(x.p.name)}</span><span class="sub">${esc(x.p.step ? `次の一歩：${x.p.step}` : x.p.status)}</span></span><span class="meta"><span class="num">${st.done}/${x.p.total}</span><div style="width:60px;height:5px;border-radius:3px;background:var(--sunk);margin-top:4px;overflow:hidden"><div style="height:100%;width:${st.pct}%;background:var(--s-next)"></div></div></span></button>`; })());
  }

  // ================= DB（すべてのデータベース） =================
  function initDbs() {
    const names = store.get("dbnames") || {};
    S.dbs = SECTIONS.flatMap(([sec, items]) => items.map(([id, name]) => ({ id, name: name || names[id] || "", sec })));
  }
  const dbIdle = () => S.tab === "db" && !S.dbOpen && $("#page").hidden;
  async function refreshDbList() {
    try {
      const res = await call("fetch", { id: DB_PAGE });
      const body = String(res.text || ""); const out = []; let sec = "その他";
      const re = /<h2[^>]*>\s*([^<]+?)\s*<\/h2>|^##\s+(.+)$|<database url="[^"]+"(?: data-source-url="collection:\/\/([0-9a-f-]+)")?[^>]*>([\s\S]*?)<\/database>/gm;
      for (const m of body.matchAll(re)) {
        if (m[1] || m[2]) { sec = (m[1] || m[2]).trim(); continue; }
        if (!m[3]) continue;
        const prev = S.dbs.find((d) => d.id === m[3]); out.push({ id: m[3], name: text(m[4]) || prev?.name || "", sec });
      }
      if (out.length >= 5) S.dbs = out;
    } catch { /* 控えの一覧のまま */ }
    if (dbIdle()) render();
    fillDbNames();
  }
  async function fillDbNames() {
    const names = store.get("dbnames") || {}; const todo = S.dbs.filter((d) => !d.name); let timer;
    const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (dbIdle()) render(); }, 300); };
    const worker = async () => {
      for (let d; (d = todo.shift());) {
        try { const res = await call("fetch", { id: `collection://${d.id}` }); const m = String(res.text || "").match(/The title of this Data Source is:\s*(.+)/); d.name = (m ? m[1] : res.title || "").trim() || "（名前なし）"; names[d.id] = d.name; store.set("dbnames", names); }
        catch { d.name = d.name || "（読めないDB）"; }
        later();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  function renderDbHome(view) {
    if (S.dbOpen) return renderDb(view);
    const secs = [...new Set(S.dbs.map((d) => d.sec))];
    if (!S.dbSec || !secs.includes(S.dbSec)) S.dbSec = secs[0];
    view.insertAdjacentHTML("beforeend", `<div class="chips">${secs.map((s) => `<button type="button" class="chip" data-dbsec="${esc(s)}" aria-pressed="${s === S.dbSec}">${esc(s)}<span class="n">${S.dbs.filter((d) => d.sec === s).length}</span></button>`).join("")}</div><div class="card panel"><div class="list" id="dbl"></div></div>`);
    paged($("#dbl"), `dbs:${S.dbSec}`, S.dbs.filter((d) => d.sec === S.dbSec), 52, (d) => `<button type="button" class="row" data-db="${d.id}"><span class="dot" style="--c:var(--accent)"></span><span class="main"><span class="nm">${esc(d.name || "…")}</span><span class="sub">${esc(S.dbSec)}</span></span><span class="meta">›</span></button>`);
  }
  async function openDb(id) {
    const d = S.dbs.find((x) => x.id === id); if (!d) return;
    Object.assign(S, { dbOpen: d, dbRows: [], dbSchema: null, dbErr: null, dbQuery: "", dbLoading: true }); S.page.db = 0; render();
    if (S.mode === "demo") { Object.assign(S, { dbLoading: false, dbSchema: DEMO_SCHEMA, dbRows: DEMO_ROWS }); render(); return; }
    try {
      const res = await call("fetch", { id: `collection://${id}` }); const t = String(res.text || "");
      const m = t.match(/The title of this Data Source is:\s*(.+)/); if (m && !d.name) d.name = m[1].trim();
      let schema = {}; try { schema = JSON.parse((t.match(/<data-source-state>\s*([\s\S]*?)\s*<\/data-source-state>/) || [])[1] || "{}").schema || {}; } catch { /* 型なし */ }
      S.dbSchema = schema;
      const edited = Object.values(schema).find((p) => p.type === "last_edited_time") || Object.values(schema).find((p) => p.type === "created_time");
      let r; try { r = await rows(id, { sort: edited ? [{ property: edited.name, direction: "descending" }] : undefined }); } catch { r = await rows(id); }
      S.dbRows = r.results; S.dbMore = r.more;
    } catch (err) { S.dbErr = errText(err); }
    S.dbLoading = false; if (S.dbOpen === d) render();
  }
  function dbColumns() {
    const all = Object.values(S.dbSchema || {}); const title = all.find((p) => p.type === "title")?.name || "名前";
    const shown = all.filter((p) => p.name !== title && !SECRET.test(p.name) && !["formula", "rollup", "button", "relation", "files", "people", "created_by", "last_edited_by"].includes(p.type));
    const group = all.find((p) => p.type === "status") || all.find((p) => p.type === "select");
    return { title, shown: shown.slice(0, 6), group };
  }
  function cell(r, p) {
    const k = p.type === "date" ? `date:${p.name}:start` : /^(url|id)$/i.test(p.name) ? `userDefined:${p.name}` : p.name;
    const v = r[k] ?? r[p.name];
    if (p.type === "checkbox") return v === "__YES__" ? "☑" : "☐";
    if (p.type === "date") return v ? md(String(v).slice(0, 10)) : "";
    if (p.type === "last_edited_time" || p.type === "created_time") return v ? md(jst(Date.parse(v))) : "";
    const l = list(v); if (l) return l.every((x) => /^https?:/.test(x)) ? (l.length ? `${l.length}件` : "") : l.join("・");
    return text(v);
  }
  function renderDb(view) {
    const d = S.dbOpen;
    view.insertAdjacentHTML("beforeend", `<div style="display:flex;align-items:center;gap:8px;flex:none"><button type="button" class="iconbtn" data-dbback="1" aria-label="DBの一覧へ">‹</button><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px">${esc(d.name || "データベース")}</b><div class="seg">${[["table", "表"], ["list", "リスト"], ["board", "ボード"]].map(([k, n]) => `<button type="button" data-dbview="${k}" aria-pressed="${S.dbView === k}">${n}</button>`).join("")}</div></div>
      <input id="dbq" type="search" placeholder="さがす" value="${esc(S.dbQuery)}" aria-label="さがす" style="flex:none;background:var(--card);border:0;border-radius:10px;padding:8px 12px;box-shadow:var(--shadow)">
      <div class="card panel" id="dbpanel"><div class="list" id="dbbox"></div></div>`);
    const box = $("#dbbox");
    if (S.dbLoading) { box.innerHTML = `<div class="empty">読みこみ中…</div>`; return; }
    if (S.dbErr) { box.innerHTML = `<div class="empty">${esc(S.dbErr)}</div>`; return; }
    const { title, shown, group } = dbColumns(); const q = S.dbQuery.trim().toLowerCase();
    const items = S.dbRows.filter((r) => !q || Object.values(r).some((v) => typeof v === "string" && !isRef(v) && text(v).toLowerCase().includes(q)));
    if (!items.length) { box.innerHTML = `<div class="empty">${q ? "見つかりません" : "行がありません"}</div>`; return; }
    if (S.dbView === "board" && group) {
      const m = new Map(); for (const r of items) { const g = cell(r, group) || "（なし）"; if (!m.has(g)) m.set(g, []); m.get(g).push(r); }
      box.outerHTML = `<div class="board">${[...m].map(([g, list]) => `<div class="col"><h4><span>${esc(g)}</span><span class="num mute">${list.length}</span></h4>${list.slice(0, 15).map((r) => `<button type="button" class="bcard" data-dbrow="${S.dbRows.indexOf(r)}">${esc(text(r[title]) || "（無題）")}<span class="sub">${esc(shown.filter((p) => p !== group).map((p) => cell(r, p)).filter(Boolean)[0] || "")}</span></button>`).join("")}</div>`).join("")}</div>`;
      return;
    }
    if (S.dbView === "table" || (S.dbView === "board" && !group)) {
      box.className = "tablewrap"; const per = Math.max(1, Math.floor((box.clientHeight - 32) / 33)); const { slice, p, pages } = pageOf("dbt", items, per);
      box.innerHTML = `<table class="grid"><thead><tr><th>${esc(title)}</th>${shown.map((p2) => `<th>${esc(p2.name)}</th>`).join("")}</tr></thead><tbody>${slice.map((r) => `<tr class="click" data-dbrow="${S.dbRows.indexOf(r)}"><td>${esc(short(text(r[title]) || "（無題）", 24))}</td>${shown.map((p2) => `<td>${esc(short(cell(r, p2), 18))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      box.dataset.swipe = "dbt"; box.dataset.pages = pages;
      box.insertAdjacentHTML("afterend", `<div class="pager">${pages > 1 ? `<button type="button" data-pg="dbt:-1" ${p ? "" : "disabled"}>◀</button><span>${p + 1} / ${pages}${S.dbMore ? "（新しい100件）" : ""}</span><button type="button" data-pg="dbt:1" ${p < pages - 1 ? "" : "disabled"}>▶</button>` : `<span>${items.length}件</span>`}</div>`);
      return;
    }
    paged(box, "db", items, 52, (r) => `<button type="button" class="row" data-dbrow="${S.dbRows.indexOf(r)}"><span class="main"><span class="nm">${esc(text(r[title]) || "（無題）")}</span><span class="sub">${esc(shown.map((p) => cell(r, p)).filter(Boolean).slice(0, 3).join("・"))}</span></span><span class="meta">›</span></button>`);
  }

