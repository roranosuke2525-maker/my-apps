// かいもの：どの画面からでも右下の ＋ で「買うもの」を足す。
// 行き先（いつもの買い物のリスト／⚡ ちょい買い）を選んで、打つか、候補（切れそう・よく買う・クリップした新商品）をタップするだけ。
// app.js の S・addTexts・removeItem・hist・kana・esc などを使う。
const QA = { open: false, dest: "", q: "", added: [] };

function qaDests() {
  return [...usualLists().map((t) => ({ id: t.id, name: t.name.replace(/^🛒\s*/, ""), icon: "🛒" })), { id: "quick", name: "ちょい買い", icon: "⚡" }];
}
function qaList() { return QA.dest === "quick" ? quickList() : listOf(QA.dest); }
function openQuickAdd() {
  const ds = qaDests();
  // 行き先：いま見ているリスト → 前に選んだもの → いちばん近いいつもの買い物 → ちょい買い
  const here = S.tab === "list" && S.seg === "usual" && !S.planning ? S.cur : S.tab === "list" && S.seg === "quick" ? "quick" : "";
  QA.dest = [here, QA.dest].find((id) => id && ds.some((d) => d.id === id)) || ds[0].id;
  QA.open = true; QA.q = ""; QA.added = [];
  renderQuickAdd();
  setTimeout(() => $("#qain")?.focus(), 50);
}
function closeQuickAdd() { QA.open = false; const el = $("#qadd"); el.hidden = true; el.innerHTML = ""; document.body.classList.remove("modal"); render(); }

function qaOnList() {
  const t = qaList();
  return new Set((t?.items || []).filter((i) => !i.checked).map((i) => kana(A.splitQty(i.text).name).replace(/\s/g, "")));
}
const qaKey = (n) => kana(A.splitQty(n).name).replace(/\s/g, "");
function qaChip(name, sub = "", warn = false) {
  const on = qaOnList().has(qaKey(name));
  return `<button type="button" class="chip${warn ? " warn" : ""}${on ? " on" : ""}" data-qa="add" data-name="${esc(name)}" ${on ? "disabled" : ""}>${on ? "✓" : "＋"} ${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
}
function qaSuggest() {
  const q = QA.q.trim();
  if (q) {
    const k = kana(q).replace(/\s/g, "");
    const names = new Map();
    const put = (n, score) => { if (n && kana(n).replace(/\s/g, "").includes(k)) names.set(n, Math.max(names.get(n) || 0, score + (kana(n).replace(/\s/g, "").startsWith(k) ? 100 : 0))); };
    for (const [n, h] of Object.entries(hist)) put(n, h.n);
    for (const x of S.stock) put(x.name, 0.5);
    for (const x of S.templates) put(x.name, 0.4);
    A.STAPLES.forEach((n) => put(n, 0.2));
    const xs = [...names].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n]) => n);
    return `<div class="qasec">${xs.map((n) => qaChip(n)).join("")}${xs.some((n) => qaKey(n) === qaKey(q)) ? "" : `<button type="button" class="chip new" data-qa="typed">＋「${esc(q)}」を入れる</button>`}</div>`;
  }
  const soon = soonStock(SOON_DAYS).slice(0, 6);
  const often = Object.entries(hist).filter(([, h]) => h.n >= 1).sort((a, b) => b[1].n - a[1].n || (b[1].last || "").localeCompare(a[1].last || "")).slice(0, 14).map(([n]) => n);
  const clips = typeof N !== "undefined" && N.favs ? [...new Set(N.favs.flatMap((f) => f.names || []))].slice(0, 8) : [];
  const staples = often.length < 6 ? A.STAPLES.filter((n) => !often.includes(n)).slice(0, 10) : [];
  const sec = (title, body) => (body ? `<div class="qasec"><div class="sgl">${title}</div>${body}</div>` : "");
  return sec("📦 切れそう", soon.map((x) => qaChip(x.name, leftTx(x.left), true)).join(""))
    + sec("🔁 よく買う", often.map((n) => qaChip(n)).join(""))
    + sec("📎 クリップした新商品", clips.map((n) => qaChip(n)).join(""))
    + sec("🧺 定番", staples.map((n) => qaChip(n)).join(""));
}
function renderQuickAdd() {
  const el = $("#qadd"); if (!QA.open) return;
  const ds = qaDests(); const t = qaList();
  const left = t ? (t.items || []).filter((i) => !i.checked).length : 0;
  el.innerHTML = `<div class="sheet-bg" data-qa="close"></div><div class="sheet qa" role="dialog" aria-label="買うものを足す">
    <div class="sh-head"><b>＋ 買うものを足す</b><button type="button" class="more" data-qa="close" aria-label="閉じる">×</button></div>
    <div class="qadest"><span class="mute">入れる先</span>${ds.map((d) => `<button type="button" class="chip" data-qa="dest" data-id="${d.id}" aria-pressed="${QA.dest === d.id}">${d.icon} ${esc(d.name)}</button>`).join("")}</div>
    <form class="addbox" id="qaform"><input id="qain" type="text" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="品の名前（例：牛乳）" aria-label="買うもの" value="${esc(QA.q)}">${qtyBox("qaqty")}<button type="submit" class="btn pri">入れる</button></form>
    <div id="qasug">${qaSuggest()}</div>
    ${QA.added.length ? `<div class="qadone"><span class="mute">入れた：</span>${QA.added.map((a, k) => `<span class="chip on">✓ ${esc(a.text)}<button type="button" class="x" data-qa="undo" data-k="${k}" aria-label="「${esc(a.text)}」を取り消す">×</button></span>`).join("")}</div>` : ""}
    <div class="row-end"><span class="mute">${t ? `「${esc(ds.find((d) => d.id === QA.dest)?.name || "")}」に ${left}品` : "まだ空です（入れると作ります）"}</span><button type="button" class="btn ok" data-qa="close">おわり</button></div></div>`;
  el.hidden = false; document.body.classList.add("modal");
}
async function qaAdd(text) {
  text = text.trim(); if (!text) return;
  const seg = S.seg, cur = S.cur;
  if (QA.dest === "quick") S.seg = "quick"; else { S.seg = "usual"; S.cur = QA.dest; }
  try { await addTexts([text]); }
  finally {
    // いつもの買い物で入れたときはその画面のまま、それ以外は元の画面に戻す
    if (!(S.tab === "list" && seg === S.seg)) { S.seg = seg; S.cur = cur; }
  }
  const t = qaList(); if (QA.dest === "quick" && t) QA.dest = "quick";
  QA.added.push({ text, dest: QA.dest });
  QA.q = ""; render(); renderQuickAdd(); $("#qain")?.focus();
}
function qaUndo(k) {
  const a = QA.added[k]; if (!a) return;
  const t = a.dest === "quick" ? quickList() : listOf(a.dest);
  const it = [...(t?.items || [])].reverse().find((i) => i.text === a.text && !i.checked);
  if (it) removeItem(it.id);
  QA.added.splice(k, 1); renderQuickAdd();
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-qa]"); if (!el) return;
  e.stopPropagation();
  const k = el.dataset.qa;
  if (k === "open") openQuickAdd();
  else if (k === "close") closeQuickAdd();
  else if (k === "dest") { QA.dest = el.dataset.id; renderQuickAdd(); }
  else if (k === "add") { el.disabled = true; qaAdd(withQty(el.dataset.name, $("#qaqty")?.value)); }
  else if (k === "typed") qaAdd(withQty(QA.q, $("#qaqty")?.value));
  else if (k === "undo") qaUndo(+el.dataset.k);
}, true);
document.addEventListener("input", (e) => { if (e.target.id === "qain") { QA.q = e.target.value; $("#qasug").innerHTML = qaSuggest(); } });
document.addEventListener("submit", (e) => {
  if (e.target.id !== "qaform") return;
  e.preventDefault(); e.stopPropagation();
  const texts = A.splitInput($("#qain").value).map((x) => withQty(x, $("#qaqty")?.value));
  (async () => { for (const x of texts) await qaAdd(x); })();
}, true);
