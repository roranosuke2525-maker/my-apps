// しおり：付箋のページの写真・Kindle のハイライトを読書メモ_DB の本に集め、読後は感想を読書メーターへ、ハイライトを NotebookLM へ渡す。
// /api は Cloudflare Worker（src/worker.js）が Notion API で答える。開くには合言葉（APP_KEY）が要る。
const P = window.ShioriParse;
const STATUSES = ["読中", "未読", "読了"];
const FILTERS = [["読中", "読んでいる"], ["未読", "これから"], ["読了", "読んだ"], ["", "すべて"]];
const RATINGS = ["★", "★★", "★★★", "★★★★", "★★★★★"];
const REVIEW_MAX = 255;
const SAVE_CHUNK = 40; // Worker が一度に足せるハイライトの数
const KEY_STORAGE = "key";

const $ = (s, el = document) => el.querySelector(s);
const state = { books: [], options: { authors: [], publishers: [] }, filter: "読中", view: "shelf", bookId: "", hl: new Map(), page: null, kindle: null, done: {} };

// ---------- 共通 ----------
let memoryKey = "";

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${memoryKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    memoryKey = "";
    store.set(KEY_STORAGE, "");
    showLogin();
    throw new Error(data.error || "合言葉が違います");
  }
  if (!res.ok) throw new Error(data.error || `通信エラー（${res.status}）`);
  return data;
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

function setStatus(msg, err = false) {
  const s = $("#status");
  s.textContent = msg || "";
  s.classList.toggle("err", !!err);
}

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const bookOf = (id) => state.books.find((b) => b.id === id);
const store = {
  get(k) { try { return localStorage.getItem(`shiori:${k}`) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(`shiori:${k}`, v); } catch { /* 保存できなくても動く */ } },
};

async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    toast("コピーしました");
    return true;
  } catch {
    if (fallbackEl) { fallbackEl.focus(); fallbackEl.select?.(); }
    toast("自動でコピーできませんでした。選んだ文字をコピーしてください");
    return false;
  }
}

// ---------- 読み込み ----------
async function loadBooks() {
  setStatus("Notion から本を読み込み中…");
  try {
    const data = await api("GET", "/api/books");
    state.books = data.books;
    state.options = data.options;
    if (!state.bookId || !bookOf(state.bookId)) state.bookId = store.get("book") && bookOf(store.get("book")) ? store.get("book") : (state.books.find((b) => b.status === "読中")?.id || "");
    setStatus("");
    renderAll();
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function loadHighlights(bookId, force = false) {
  if (!force && state.hl.has(bookId)) return state.hl.get(bookId);
  const data = await api("GET", `/api/books/${bookId}/highlights`);
  state.hl.set(bookId, data);
  return data;
}

function replaceBook(book) {
  const i = state.books.findIndex((b) => b.id === book.id);
  if (i >= 0) state.books[i] = book; else state.books.push(book);
}

// ---------- 画面の切り替え ----------
function show(view) {
  state.view = view;
  for (const v of ["shelf", "photo", "kindle", "done"]) $(`#view-${v}`).hidden = v !== view;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  store.set("view", view);
  if (view === "done") renderDone();
  window.scrollTo(0, 0);
}

function renderAll() {
  renderShelf();
  renderBookSelects();
  renderOptions();
  if (state.view === "done") renderDone();
}

function renderOptions() {
  $("#authors").replaceChildren(...state.options.authors.map((a) => el("option", { value: a })));
  $("#publishers").replaceChildren(...state.options.publishers.map((p) => el("option", { value: p })));
}

function bookOptionEls(selected, { finishing = false } = {}) {
  const groups = STATUSES.map((s) => {
    const books = state.books.filter((b) => b.status === s);
    if (!books.length) return null;
    return el("optgroup", { label: s }, books.map((b) => el("option", { value: b.id, selected: b.id === selected }, b.title)));
  }).filter(Boolean);
  const head = el("option", { value: "", selected: !selected }, finishing ? "読み終えた本を選ぶ" : "本を選ぶ");
  return [head, ...groups];
}

function renderBookSelects() {
  for (const id of ["#photo-book", "#kindle-book", "#done-book"]) $(id).replaceChildren(...bookOptionEls(state.bookId, { finishing: id === "#done-book" }));
}

function selectBook(id) {
  state.bookId = id;
  store.set("book", id);
  for (const s of ["#photo-book", "#kindle-book", "#done-book"]) $(s).value = id;
}

// ---------- 本棚 ----------
function renderShelf() {
  $("#shelf-filter").replaceChildren(...FILTERS.map(([key, label]) => {
    const n = key ? state.books.filter((b) => b.status === key).length : state.books.length;
    return el("button", { type: "button", role: "tab", class: state.filter === key ? "on" : "", "aria-selected": String(state.filter === key), onclick: () => { state.filter = key; renderShelf(); } }, `${label} ${n}`);
  }));
  const books = state.books.filter((b) => !state.filter || b.status === state.filter)
    .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || String(b.finished || "").localeCompare(String(a.finished || "")) || a.title.localeCompare(b.title, "ja"));
  if (!books.length) {
    $("#books").replaceChildren(el("li", { class: "empty" }, state.books.length ? "この棚には本がありません" : "本はまだありません。「＋ 本を足す」から読み始めた本を足してください"));
    return;
  }
  $("#books").replaceChildren(...books.map((b) => {
    const n = `${b.highlightCount + b.legacyCount}${b.highlightMore ? "+" : ""}`;
    return el("li", { class: "book", tabindex: "0", role: "button", "aria-label": `${b.title}を開く`, onclick: () => openBook(b.id), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBook(b.id); } } },
      el("div", { class: "spine" }, b.cover ? el("img", { src: b.cover, alt: "", loading: "lazy" }) : b.title.slice(0, 6)),
      el("div", { class: "book-main" },
        el("div", { class: "book-title" }, b.title),
        el("div", { class: "book-meta" }, [b.author, b.publisher].filter(Boolean).join(" ・ ") || "著者未登録")),
      el("div", { class: "book-side" },
        el("span", { class: `chip ${b.status === "読中" ? "reading" : b.status === "読了" ? "done" : ""}` }, b.status),
        n !== "0" ? el("span", { class: "count" }, `ハイライト ${n}`) : null,
        b.rating ? el("span", { class: "count" }, b.rating) : null));
  }));
}

function setupAddBook() {
  const form = $("#add-book");
  $("#add-book-open").addEventListener("click", () => { form.hidden = false; $("#nb-title").focus(); });
  $("#add-book-cancel").addEventListener("click", () => { form.hidden = true; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const { book } = await api("POST", "/api/books", { title: $("#nb-title").value, author: $("#nb-author").value, publisher: $("#nb-publisher").value, status: "読中" });
      replaceBook(book);
      form.reset();
      form.hidden = true;
      selectBook(book.id);
      state.filter = "読中";
      renderAll();
      toast(`『${book.title}』を足しました`);
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- 本を開く ----------
async function openBook(id) {
  const b = bookOf(id);
  if (!b) return;
  selectBook(id);
  $("#sheet-title").textContent = b.title;
  $("#sheet-sub").textContent = [b.author, b.publisher, b.status, b.finished && `読了 ${b.finished}`].filter(Boolean).join(" ・ ");
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
  const body = $("#sheet-body");
  body.replaceChildren(el("div", { class: "working" }, el("span", { class: "spinner" }), "ハイライトを読み込み中…"));
  try {
    const data = await loadHighlights(id);
    renderSheet(b, data);
  } catch (e) {
    body.replaceChildren(el("p", { class: "status err" }, e.message));
  }
}

function closeSheet() {
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
}

function renderSheet(b, data) {
  const go = (view) => { closeSheet(); selectBook(b.id); show(view); };
  const statusSel = el("select", { id: "sheet-status", "aria-label": "ステータス", onchange: async (e) => {
    try { const { book } = await api("PATCH", `/api/books/${b.id}`, { status: e.target.value }); replaceBook(book); renderAll(); toast(`${book.status}にしました`); } catch (err) { toast(err.message); }
  } }, STATUSES.map((s) => el("option", { value: s, selected: s === b.status }, s)));

  const list = data.highlights.length
    ? el("ol", { class: "hls" }, data.highlights.map((h) => hlItem(h)))
    : el("p", { class: "note" }, "まだハイライトがありません。付箋のページを撮るか、Kindle から取り込んでください。");

  const legacy = data.legacy.length
    ? el("details", { class: "legacy" },
      el("summary", {}, `前の形のハイライト（写真つきの子ページ）${data.legacy.length}件`),
      el("ol", { class: "hls" }, data.legacy.map((h) => el("li", { class: "hl" },
        el("blockquote", {}, h.text),
        h.memo ? el("div", { class: "hl-memo" }, h.memo) : null,
        el("div", { class: "hl-meta" }, h.hasPhoto ? el("span", {}, "📷 写真あり") : null, el("a", { href: h.url, target: "_blank", rel: "noopener" }, "Notion で開く"))))))
    : null;

  $("#sheet-body").replaceChildren(...[
    el("div", { class: "quick" },
      el("button", { type: "button", class: "btn flag", onclick: () => go("photo") }, "付箋を撮る"),
      el("button", { type: "button", class: "btn ghost", onclick: () => go("kindle") }, "Kindle から"),
      el("button", { type: "button", class: "btn ghost", onclick: () => go("done") }, "読み終えた")),
    el("label", { class: "pick" }, "ステータス", statusSel),
    el("h3", { class: "sec" }, `ハイライト ${data.highlights.length}件`),
    list,
    legacy,
    manualForm(b),
    notebookCard(b, data),
    el("a", { href: b.url, target: "_blank", rel: "noopener", class: "note" }, "この本を Notion で開く"),
  ].filter(Boolean));
}

function hlItem(h) {
  const where = [h.page != null ? `p.${h.page}` : "", h.loc ? `位置 ${h.loc}` : "", h.source || ""].filter(Boolean);
  const memoBox = el("div", { class: "hl-memo", hidden: !h.memo }, h.memo || "");
  const item = el("li", { class: "hl" },
    el("blockquote", {}, h.text),
    memoBox,
    el("div", { class: "hl-meta" }, ...where.map((w) => el("span", {}, w)),
      h.id ? el("button", { type: "button", class: "linkish", onclick: () => editMemo(h, item, memoBox) }, h.memo ? "メモを直す" : "メモを書く") : null));
  return item;
}

function editMemo(h, item, memoBox) {
  if (item.querySelector("textarea")) return;
  const ta = el("textarea", { rows: "3", maxlength: "1000", "aria-label": "メモ" });
  ta.value = h.memo || "";
  const save = el("button", { type: "button", class: "btn small", onclick: async () => {
    save.disabled = true;
    try {
      const { memo } = await api("PATCH", `/api/highlights/${h.id}`, { memo: ta.value });
      h.memo = memo;
      memoBox.textContent = memo;
      memoBox.hidden = !memo;
      box.remove();
      toast("メモを保存しました");
    } catch (e) { toast(e.message); save.disabled = false; }
  } }, "保存");
  const box = el("div", { class: "form" }, ta, el("div", { class: "actions" }, el("button", { type: "button", class: "btn ghost small", onclick: () => box.remove() }, "やめる"), save));
  item.append(box);
  ta.focus();
}

function manualForm(b) {
  const text = el("textarea", { id: "manual-text", rows: "3", maxlength: "1900", placeholder: "本の文をそのまま" });
  const page = el("input", { id: "manual-page", inputmode: "numeric", placeholder: "ページ" });
  const memo = el("input", { id: "manual-memo", maxlength: "1000", placeholder: "メモ（なくてもよい）" });
  const btn = el("button", { type: "submit", class: "btn small" }, "足す");
  const form = el("form", { class: "card form" },
    el("h3", { class: "sec" }, "手で足す"),
    el("label", {}, "ハイライト", text),
    el("div", { class: "row2" }, el("label", {}, "ページ", page), el("label", {}, "メモ", memo)),
    el("div", { class: "actions" }, btn));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!text.value.trim()) return;
    btn.disabled = true;
    try {
      await saveHighlights(b.id, [{ text: text.value, page: page.value.trim(), memo: memo.value, source: "✍️ 手入力" }]);
      openBook(b.id);
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
  return form;
}

async function saveHighlights(bookId, items) {
  const res = await api("POST", "/api/highlights", { bookId, items });
  replaceBook(res.book);
  state.hl.delete(bookId);
  renderAll();
  toast(`${res.added}件のハイライトを保存しました`);
  return res;
}

// ---------- NotebookLM ----------
function notebookCard(b, data) {
  const text = P.exportText(b, data.highlights, data.legacy);
  const preview = el("textarea", { rows: "4", readonly: true, "aria-label": "NotebookLM に渡す文" });
  preview.value = text;
  const mark = async () => {
    if (b.notebooklm) return;
    try { const { book } = await api("PATCH", `/api/books/${b.id}`, { notebooklm: true }); replaceBook(book); Object.assign(b, book); tick.checked = true; } catch { /* 印だけなので失敗しても続ける */ }
  };
  const tick = el("input", { type: "checkbox", checked: b.notebooklm, onchange: async (e) => {
    try { const { book } = await api("PATCH", `/api/books/${b.id}`, { notebooklm: e.target.checked }); replaceBook(book); Object.assign(b, book); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
  } });
  const fileName = `${b.title.replace(/[\\/:*?"<>|]/g, "")}_ハイライト.txt`;
  const fileBtn = el("button", { type: "button", class: "btn small", onclick: async () => {
    const file = new File([text], fileName, { type: "text/plain" });
    // iPhone では共有シートから「ファイルに保存」や NotebookLM のアプリへ渡せる
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: fileName }); mark(); } catch (e) { if (e?.name !== "AbortError") toast("共有できませんでした"); }
      return;
    }
    const a = el("a", { href: URL.createObjectURL(file), download: fileName });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("ファイルを保存しました");
    mark();
  } }, "ファイルで保存");
  const copyBtn = el("button", { type: "button", class: "btn ghost small", onclick: async () => { if (await copyText(text, preview)) mark(); } }, "コピー");
  return el("section", { class: "card handoff" },
    el("h3", {}, "NotebookLM に渡す"),
    el("p", {}, "ハイライトとメモを1つの文にまとめます。NotebookLM のノートブックで「ソースを追加」から、保存したファイルをアップロードするか「コピーしたテキスト」に貼ります。"),
    preview,
    el("div", { class: "actions" }, el("a", { href: "https://notebooklm.google.com/", target: "_blank", rel: "noopener", class: "btn ghost small" }, "NotebookLM を開く"), copyBtn, fileBtn),
    el("label", { class: "tick" }, tick, "NotebookLM に入れた"));
}

// ---------- 付箋のページ ----------
// 写真の文字は端末のテキスト認識でコピーして貼る。文を押してハイライトにし、ページ番号とメモを付けて保存する
function setupPhoto() {
  $("#photo-book").addEventListener("change", (e) => selectBook(e.target.value));
  $("#photo-input").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const img = $("#photo-preview");
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(f);
    img.hidden = false;
  });
  $("#photo-split").addEventListener("click", () => {
    const { paragraphs, page } = P.pageFromText($("#photo-text").value);
    if (!paragraphs.length) { toast("先にページの文を貼り付けてください"); return; }
    state.page = { paragraphs, marks: paragraphs.map((p) => P.sentences(p).map(() => false)), pageNo: page != null ? String(page) : "", memo: {} };
    renderPage();
  });
  $("#photo-clear").addEventListener("click", clearPage);
}

function clearPage() {
  state.page = null;
  $("#photo-text").value = "";
  const img = $("#photo-preview");
  if (img.src) URL.revokeObjectURL(img.src);
  img.removeAttribute("src");
  img.hidden = true;
  renderPage();
}

const groupsOf = (p) => P.groupMarks(p.paragraphs, p.marks);

function renderPage() {
  const p = state.page;
  if (!p) { $("#pages").replaceChildren(); return; }
  const scroll = $("#pages .page-text")?.scrollTop;
  const text = el("div", { class: "page-text", "aria-label": "ページの文。文を押すとハイライトの付け外し" },
    p.paragraphs.map((para, pi) => el("p", {}, P.sentences(para).map((s, si) => el("span", {
      class: `sent${p.marks[pi]?.[si] ? " on" : ""}`, role: "button", tabindex: "0", "aria-pressed": String(!!p.marks[pi]?.[si]),
      onclick: () => toggle(pi, si), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(pi, si); } },
    }, s)))));
  const groups = groupsOf(p);
  const saveBtn = el("button", { type: "button", class: "btn", disabled: !groups.length, onclick: () => savePage(saveBtn) }, groups.length ? `${groups.length}件を保存` : "文を選んでください");
  $("#pages").replaceChildren(el("article", { class: "card page-card" },
    el("label", { class: "page-no" }, "p.", el("input", { id: "page-no", inputmode: "numeric", value: p.pageNo, "aria-label": "ページ", oninput: (e) => { p.pageNo = e.target.value.trim(); } })),
    text,
    el("div", { class: "picked" },
      el("h3", {}, groups.length ? `ハイライト ${groups.length}件（文を押して付け外し）` : "大事な文を押すとハイライトになります"),
      groups.map((g) => el("div", { class: "pick-item" },
        el("div", { class: "book-title", style: "font-size:0.95rem" }, g.text),
        el("input", { maxlength: "1000", placeholder: "メモ（なくてもよい）", value: p.memo[g.key] || "", "aria-label": "メモ", oninput: (e) => { p.memo[g.key] = e.target.value; } })))),
    el("div", { class: "actions" }, saveBtn)));
  if (scroll != null) $("#pages .page-text").scrollTop = scroll;
}

function toggle(pi, si) {
  const p = state.page;
  p.marks[pi][si] = !p.marks[pi][si];
  renderPage();
}

async function savePage(btn) {
  const p = state.page;
  const book = bookOf($("#photo-book").value);
  if (!book) { toast("先に本を選んでください"); return; }
  const context = p.paragraphs.join("\n");
  const items = groupsOf(p).map((g) => ({ text: g.text, page: p.pageNo, memo: p.memo[g.key] || "", source: "📷 付箋写真", context }));
  btn.disabled = true;
  try {
    await saveHighlights(book.id, items);
    clearPage();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
  }
}

// ---------- Kindle ----------
function setupKindle() {
  $("#kindle-book").addEventListener("change", (e) => { selectBook(e.target.value); if (state.kindle) renderKindle(); });
  $("#kindle-parse").addEventListener("click", () => {
    const groups = P.parseKindle($("#kindle-text").value);
    if (!groups.length) { toast("ハイライトが見つかりませんでした。見出しの行（○○のハイライト | 位置: …）ごとコピーしてください"); return; }
    state.kindle = { groups, group: 0 };
    // My Clippings.txt のように書名が付いていれば、本棚の本に合わせる
    const match = groups[0].title && P.matchBook(state.books, groups[0].title);
    if (match) selectBook(match.id);
    renderKindle();
  });
}

async function renderKindle() {
  const k = state.kindle;
  const box = $("#kindle-result");
  const g = k.groups[k.group];
  const bookId = $("#kindle-book").value;
  let existing = new Set();
  if (bookId) {
    box.replaceChildren(el("div", { class: "working" }, el("span", { class: "spinner" }), "登録済みのハイライトと照らし合わせています…"));
    try {
      const data = await loadHighlights(bookId);
      existing = new Set([...data.highlights, ...data.legacy].map((h) => P.norm(h.text)));
    } catch (e) { toast(e.message); }
  }
  g.items.forEach((it) => { it.dup = existing.has(P.norm(it.text)); if (it.on == null || it.dupChecked !== bookId) it.on = !it.dup; it.dupChecked = bookId; });
  const pickGroup = k.groups.length > 1
    ? el("label", { class: "pick" }, "取り込む本", el("select", { onchange: (e) => { k.group = Number(e.target.value); const m = P.matchBook(state.books, k.groups[k.group].title); if (m) selectBook(m.id); renderKindle(); } },
      k.groups.map((x, i) => el("option", { value: i, selected: i === k.group }, `${x.title}（${x.items.length}件）`))))
    : null;
  const count = () => g.items.filter((i) => i.on).length;
  const saveBtn = el("button", { type: "button", class: "btn", disabled: !bookId || !count(), onclick: async () => {
    saveBtn.disabled = true;
    try {
      const items = g.items.filter((i) => i.on).map((i) => ({ text: i.text, page: i.page ?? "", loc: i.loc, memo: i.memo, source: "📱 Kindle" }));
      for (let i = 0; i < items.length; i += SAVE_CHUNK) await saveHighlights(bookId, items.slice(i, i + SAVE_CHUNK));
      state.kindle = null;
      $("#kindle-text").value = "";
      box.replaceChildren(el("p", { class: "saved-flag" }, `✓ ${items.length}件を『${bookOf(bookId)?.title || ""}』に保存しました`));
    } catch (e) { toast(e.message); saveBtn.disabled = false; }
  } }, `${count()}件を保存`);
  const dupN = g.items.filter((i) => i.dup).length;
  box.replaceChildren(
    el("div", { class: "view" },
      pickGroup,
      g.title && !bookId ? el("p", { class: "note" }, `『${g.title}』に合う本が本棚にありません。上で本を選ぶか、本棚で本を足してください。`) : null,
      el("h3", { class: "sec" }, `見つかったハイライト ${g.items.length}件${dupN ? `（うち登録済み ${dupN}件は外してあります）` : ""}`),
      el("ol", { class: "hls" }, g.items.map((it) => el("li", { class: `hl${it.dup ? " dup" : ""}` },
        el("label", { class: "hl-check" },
          el("input", { type: "checkbox", checked: it.on, onchange: (e) => { it.on = e.target.checked; saveBtn.disabled = !bookId || !count(); saveBtn.textContent = `${count()}件を保存`; } }),
          el("blockquote", {}, it.text)),
        it.memo ? el("div", { class: "hl-memo" }, it.memo) : null,
        el("div", { class: "hl-meta" }, [it.page != null ? `p.${it.page}` : "", it.loc ? `位置 ${it.loc}` : "", it.dup ? "登録済み" : ""].filter(Boolean).map((w) => el("span", {}, w)))))),
      el("div", { class: "sticky-actions" }, saveBtn)));
}

// ---------- 読み終えた ----------
function setupDone() {
  $("#done-book").addEventListener("change", (e) => { selectBook(e.target.value); renderDone(); });
}

async function renderDone() {
  const box = $("#done-body");
  const b = bookOf($("#done-book").value);
  if (!b) { box.replaceChildren(el("p", { class: "empty" }, "読み終えた本を選ぶと、評価・感想を Notion に残し、読書メーターと NotebookLM に渡せます。")); return; }
  const d = state.done[b.id] || (state.done[b.id] = { rating: b.rating, finished: b.finished || todayJst(), review: b.review || store.get(`review:${b.id}`) });
  let data = { highlights: [], legacy: [] };
  box.replaceChildren(el("div", { class: "working" }, el("span", { class: "spinner" }), "ハイライトを読み込み中…"));
  try { data = await loadHighlights(b.id); } catch (e) { toast(e.message); }
  if ($("#done-book").value !== b.id) return;

  const stars = el("div", { class: "stars", role: "radiogroup", "aria-label": "評価" }, RATINGS.map((r, i) => el("button", {
    type: "button", role: "radio", "aria-checked": String(d.rating === r), "aria-label": `${i + 1}つ星`, class: (d.rating || "").length > i ? "on" : "",
    onclick: () => { d.rating = d.rating === r ? "" : r; renderDone(); },
  }, "★")));
  const date = el("input", { type: "date", id: "done-date", value: d.finished, onchange: (e) => { d.finished = e.target.value; } });
  const review = el("textarea", { id: "done-review", rows: "6", placeholder: "読書メーターに載せる感想（255文字まで）。ハイライトを見返しながら" });
  review.value = d.review || "";
  const counter = el("div", { class: "counter" });
  const updateCount = () => { const n = [...review.value].length; counter.textContent = `${n} / ${REVIEW_MAX}`; counter.classList.toggle("over", n > REVIEW_MAX); };
  review.addEventListener("input", () => { d.review = review.value; store.set(`review:${b.id}`, review.value); updateCount(); });
  updateCount();

  const saveBtn = el("button", { type: "button", class: "btn", onclick: async () => {
    if ([...review.value].length > REVIEW_MAX) { toast("感想を255文字以内にしてください"); return; }
    saveBtn.disabled = true;
    try {
      const { book } = await api("PATCH", `/api/books/${b.id}`, { status: "読了", finished: d.finished, rating: d.rating || "", review: review.value });
      replaceBook(book);
      renderShelf();
      renderBookSelects();
      toast(`『${book.title}』を読了にしました`);
      renderDone();
    } catch (e) { toast(e.message); saveBtn.disabled = false; }
  } }, b.status === "読了" ? "Notion を更新" : "読了にして Notion に保存");

  const meterUrl = `https://bookmeter.com/search?keyword=${encodeURIComponent(b.title)}`;
  const meterTick = el("input", { type: "checkbox", checked: b.meter, onchange: async (e) => {
    try { const { book } = await api("PATCH", `/api/books/${b.id}`, { meter: e.target.checked }); replaceBook(book); toast(book.meter ? "読書メーターに記録済みにしました" : "印を外しました"); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; }
  } });
  const meterCard = el("section", { class: "card handoff" },
    el("h3", {}, "読書メーターに記録する"),
    el("p", {}, "読書メーターには外から書き込む仕組みが無いので、感想をコピーして本のページで「読んだ本に登録」に貼ります。読了日と評価は向こうの画面で選びます。"),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "btn ghost small", onclick: () => copyText(review.value, review) }, "感想をコピー"),
      el("a", { href: meterUrl, target: "_blank", rel: "noopener", class: "btn small" }, "読書メーターで探す")),
    el("label", { class: "tick" }, meterTick, "読書メーターに記録した"));

  box.replaceChildren(
    el("section", { class: "card form" },
      el("div", { class: "book-title" }, b.title),
      el("div", { class: "book-meta" }, `${[b.author, b.publisher].filter(Boolean).join(" ・ ")}　ハイライト ${data.highlights.length + data.legacy.length}件`),
      el("label", {}, "評価", stars),
      el("label", {}, "読了日", date),
      el("label", {}, "感想", review),
      counter,
      el("div", { class: "actions" }, saveBtn)),
    meterCard,
    notebookCard(b, data));
}

// ---------- はじめ ----------
function showLogin() {
  for (const v of ["shelf", "photo", "kindle", "done"]) $(`#view-${v}`).hidden = true;
  $(".tabs").hidden = true;
  $("#reload").hidden = true;
  $("#login").hidden = false;
  setStatus("");
  $("#key").focus();
}

function start() {
  $("#login").hidden = true;
  $(".tabs").hidden = false;
  $("#reload").hidden = false;
  const v = store.get("view");
  show(["shelf", "photo", "kindle", "done"].includes(v) ? v : "shelf");
  loadBooks();
}

function setup() {
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  $("#reload").addEventListener("click", () => { state.hl.clear(); loadBooks(); });
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
  $("#login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    memoryKey = $("#key").value.trim();
    store.set(KEY_STORAGE, memoryKey);
    $("#key").value = "";
    start();
  });
  setupAddBook();
  setupPhoto();
  setupKindle();
  setupDone();
  memoryKey = store.get(KEY_STORAGE);
  if (memoryKey) start(); else showLogin();
}

setup();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* なくても動く */ });
}
