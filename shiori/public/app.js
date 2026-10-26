// しおり：付箋のページの写真・Kindle のハイライトを読書メモ_DB の本に集め、読後は感想を読書メーターへ、ハイライトを NotebookLM へ渡す。
// /api は mcp-api.js（アーティファクト版）が答える。写真の読み取り・感想の下書きは見ている人の Claude（sample）に頼む。
const P = window.ShioriParse;
const STATUSES = ["読中", "未読", "読了"];
const FILTERS = [["読中", "読んでいる"], ["未読", "これから"], ["読了", "読んだ"], ["", "すべて"]];
const RATINGS = ["★", "★★", "★★★", "★★★★", "★★★★★"];
const REVIEW_MAX = 255;
const PHOTO_EDGE = 2000; // 送る写真の長い辺（文字が読める大きさに縮める）
const KINDLE_AI_MAX = 30000;

const $ = (s, el = document) => el.querySelector(s);
const state = { books: [], options: { authors: [], publishers: [] }, filter: "読中", view: "shelf", bookId: "", hl: new Map(), pages: [], kindle: null, done: {} };
let samplePromise = null;
let downloadsPromise = null;

// ---------- 共通 ----------
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラー（${res.status}）`);
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

async function getSample() {
  if (!samplePromise) samplePromise = window.claude?.use ? window.claude.use("sample").catch(() => null) : Promise.resolve(null);
  return samplePromise;
}
async function getDownloads() {
  if (!downloadsPromise) downloadsPromise = window.claude?.use ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);
  return downloadsPromise;
}

function sampleError(e) {
  const code = e?.code;
  if (code === "rate_limited") return "Claude の利用が混み合っています。少し待ってからもう一度";
  if (code === "not_granted") return "Claude を使う許可がありません。ページの権限から許可してください";
  if (code === "invalid_json") return "読み取りの答えを読めませんでした。もう一度試してください";
  if (code === "image_rejected") return "この写真は読み込めませんでした（形式か大きさ）";
  if (code === "images_unavailable") return "この画面では写真を Claude に送れません";
  return e?.message || "Claude への問い合わせでエラーが起きました";
}

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
    const n = b.highlightCount + b.legacyCount;
    return el("li", { class: "book", tabindex: "0", role: "button", "aria-label": `${b.title}を開く`, onclick: () => openBook(b.id), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBook(b.id); } } },
      el("div", { class: "spine" }, b.cover ? el("img", { src: b.cover, alt: "", loading: "lazy" }) : b.title.slice(0, 6)),
      el("div", { class: "book-main" },
        el("div", { class: "book-title" }, b.title),
        el("div", { class: "book-meta" }, [b.author, b.publisher].filter(Boolean).join(" ・ ") || "著者未登録")),
      el("div", { class: "book-side" },
        el("span", { class: `chip ${b.status === "読中" ? "reading" : b.status === "読了" ? "done" : ""}` }, b.status),
        n ? el("span", { class: "count" }, `ハイライト ${n}`) : null,
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
  const fileBtn = el("button", { type: "button", class: "btn small", onclick: async () => {
    const dl = await getDownloads();
    if (!dl) { toast("この画面ではファイルを保存できません。コピーを使ってください"); return; }
    try {
      await dl.save({ filename: `${b.title.replace(/[\\/:*?"<>|]/g, "")}_ハイライト.txt`, data: text });
      toast("ファイルを保存しました");
      mark();
    } catch (e) { if (e?.code !== "declined") toast("保存できませんでした"); }
  } }, "ファイルで保存");
  const copyBtn = el("button", { type: "button", class: "btn ghost small", onclick: async () => { if (await copyText(text, preview)) mark(); } }, "コピー");
  return el("section", { class: "card handoff" },
    el("h3", {}, "NotebookLM に渡す"),
    el("p", {}, "ハイライトとメモを1つの文にまとめます。NotebookLM のノートブックで「ソースを追加」から、保存したファイルをアップロードするか「コピーしたテキスト」に貼ります。"),
    preview,
    el("div", { class: "actions" }, el("a", { href: "https://notebooklm.google.com/", target: "_blank", rel: "noopener", class: "btn ghost small" }, "NotebookLM を開く"), copyBtn, fileBtn),
    el("label", { class: "tick" }, tick, "NotebookLM に入れた"));
}

// ---------- 付箋を撮る ----------
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_EDGE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((r) => c.toBlob((b) => r(b || file), "image/jpeg", 0.85));
}

function ocrPrompt(book) {
  return [
    `これは本『${book.title}』${book.author ? `（${book.author}）` : ""}のページの写真です。付箋が貼ってあることがあります。`,
    "1. 本文を読む順に正確に文字に起こしてください。縦書きは右の行から左へ。ルビ・柱（ページ上の書名や章名）・ページ番号は本文に入れません。行の折り返しで切れた語はつなぎ、段落ごとに分けます。見開きなら右ページ→左ページの順。",
    "2. 印刷されたページ番号が読めれば page に数字で（見開きなら小さいほう）。読めなければ null。",
    "3. 大事な箇所を highlights に、本文からそのまま抜き出した文字列で1〜3つ。付箋の先が指している行、線やマーカーが引かれた行があればそれを最優先にし、なければ内容の要になる文を選びます。",
    "4. 付箋が写っていれば sticky を true に。",
    'JSON だけで返してください：{"page": 123, "paragraphs": ["…"], "highlights": ["…"], "sticky": true}',
  ].join("\n");
}

function setupPhoto() {
  $("#photo-book").addEventListener("change", (e) => selectBook(e.target.value));
  $("#photo-input").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    const book = bookOf($("#photo-book").value);
    if (!book) { toast("先に本を選んでください"); return; }
    const sample = await getSample();
    const caps = sample ? await sample.limits().catch(() => null) : null;
    if (!caps?.images) { photoOff("この画面では写真を Claude に送れません。claude.ai でこのアーティファクトを開き、Claude の利用を許可してください"); return; }
    for (const f of files) {
      const page = { id: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`, bookId: book.id, file: f, thumb: URL.createObjectURL(f), status: "wait", data: null, marks: [], memo: {}, pageNo: "", saved: false };
      state.pages.push(page);
    }
    renderPages();
    runQueue(sample);
  });
  $("#photo-save").addEventListener("click", savePages);
}

function photoOff(msg) {
  const n = $("#photo-off");
  n.textContent = msg;
  n.hidden = false;
}

let queueRunning = false;
async function runQueue(sample) {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (let page = state.pages.find((p) => p.status === "wait"); page; page = state.pages.find((p) => p.status === "wait")) {
      page.status = "reading";
      renderPages();
      try {
        const book = bookOf(page.bookId);
        const blob = await shrink(page.file);
        const res = await sample.json(ocrPrompt(book), { images: [blob], modelTier: "default" });
        const paragraphs = (Array.isArray(res?.paragraphs) ? res.paragraphs : []).map((p) => String(p).trim()).filter(Boolean);
        if (!paragraphs.length) throw new Error("文字を読み取れませんでした。明るい所でページ全体が写るように撮り直してください");
        page.data = { paragraphs, sticky: !!res.sticky };
        page.marks = P.markSentences(paragraphs, Array.isArray(res.highlights) ? res.highlights.map(String) : []);
        page.pageNo = Number.isInteger(res.page) ? String(res.page) : "";
        page.status = "ready";
      } catch (e) {
        page.status = "error";
        page.error = e?.code ? sampleError(e) : e.message;
        if (e?.code === "rate_limited" || e?.code === "not_granted") {
          for (const p of state.pages) if (p.status === "wait") { p.status = "error"; p.error = page.error; }
        }
      }
      renderPages();
    }
  } finally {
    queueRunning = false;
  }
}

function renderPages() {
  $("#pages").replaceChildren(...state.pages.map(pageCard));
  $("#photo-save-all").hidden = !state.pages.some((p) => p.status === "ready" && !p.saved && groupsOf(p).length);
}

const groupsOf = (p) => (p.data ? P.groupMarks(p.data.paragraphs, p.marks) : []);

function pageCard(p) {
  const book = bookOf(p.bookId);
  const remove = el("button", { type: "button", class: "icon-btn", "aria-label": "このページを外す", onclick: () => { URL.revokeObjectURL(p.thumb); state.pages = state.pages.filter((x) => x !== p); renderPages(); } },
    el("span", { "aria-hidden": "true" }, "×"));
  const top = el("div", { class: "page-top" },
    el("img", { class: "thumb", src: p.thumb, alt: "撮ったページ" }),
    el("div", {},
      el("div", { class: "book-title" }, book?.title || ""),
      p.status === "ready" ? el("label", { class: "page-no" }, "p.", el("input", { inputmode: "numeric", value: p.pageNo, "aria-label": "ページ", oninput: (e) => { p.pageNo = e.target.value.trim(); } })) : null,
      p.saved ? el("span", { class: "saved-flag" }, "✓ 保存しました") : null),
    remove);
  if (p.status === "wait") return el("article", { class: "card page-card" }, top, el("div", { class: "working" }, "順番を待っています"));
  if (p.status === "reading") return el("article", { class: "card page-card" }, top, el("div", { class: "working" }, el("span", { class: "spinner" }), "文字に起こしています…"));
  if (p.status === "error") {
    return el("article", { class: "card page-card" }, top, el("p", { class: "status err" }, p.error),
      el("div", { class: "actions" }, el("button", { type: "button", class: "btn ghost small", onclick: async () => { p.status = "wait"; renderPages(); runQueue(await getSample()); } }, "もう一度読む")));
  }
  const text = el("div", { class: "page-text", "data-page": p.id, "aria-label": "ページの文。文を押すとハイライトの付け外し" },
    p.data.paragraphs.map((para, pi) => el("p", {}, P.sentences(para).map((s, si) => el("span", {
      class: `sent${p.marks[pi]?.[si] ? " on" : ""}`, role: "button", tabindex: "0", "aria-pressed": String(!!p.marks[pi]?.[si]),
      onclick: () => toggle(p, pi, si), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(p, pi, si); } },
    }, s)))));
  const groups = groupsOf(p);
  const picked = el("div", { class: "picked" },
    el("h3", {}, groups.length ? `ハイライト ${groups.length}件（文を押して付け外し）` : "文を押すとハイライトになります"),
    groups.map((g) => el("div", { class: "pick-item" },
      el("div", { class: "book-title", style: "font-size:0.95rem" }, g.text),
      el("input", { maxlength: "1000", placeholder: "メモ（なくてもよい）", value: p.memo[g.key] || "", "aria-label": "メモ", oninput: (e) => { p.memo[g.key] = e.target.value; } }))));
  return el("article", { class: "card page-card" }, top, p.data.sticky ? el("p", { class: "note" }, "付箋の位置をもとに色を付けました") : null, text, picked,
    el("div", { class: "actions" }, el("button", { type: "button", class: "btn small", disabled: p.saved || !groups.length, onclick: () => savePages([p]) }, p.saved ? "保存済み" : "このページを保存")));
}

function toggle(p, pi, si) {
  if (p.saved) return;
  p.marks[pi][si] = !p.marks[pi][si];
  const scroll = document.querySelector(`[data-page="${p.id}"]`)?.scrollTop;
  renderPages();
  if (scroll != null) document.querySelector(`[data-page="${p.id}"]`).scrollTop = scroll;
}

async function savePages(only) {
  const targets = (Array.isArray(only) ? only : state.pages).filter((p) => p.status === "ready" && !p.saved && groupsOf(p).length);
  const byBook = new Map();
  for (const p of targets) {
    const context = p.data.paragraphs.join("\n");
    const items = groupsOf(p).map((g) => ({ text: g.text, page: p.pageNo, memo: p.memo[g.key] || "", source: "📷 付箋写真", context }));
    byBook.set(p.bookId, [...(byBook.get(p.bookId) || []), { p, items }]);
  }
  const btn = $("#photo-save");
  btn.disabled = true;
  try {
    for (const [bookId, entries] of byBook) {
      await saveHighlights(bookId, entries.flatMap((e) => e.items));
      for (const e of entries) e.p.saved = true;
    }
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    renderPages();
  }
}

// ---------- Kindle ----------
function setupKindle() {
  $("#kindle-book").addEventListener("change", (e) => { selectBook(e.target.value); if (state.kindle) renderKindle(); });
  $("#kindle-parse").addEventListener("click", () => {
    const groups = P.parseKindle($("#kindle-text").value);
    if (!groups.length) { toast("ハイライトが見つかりませんでした。「AIで読み取る」も試してください"); return; }
    state.kindle = { groups, group: 0 };
    // My Clippings.txt のように書名が付いていれば、本棚の本に合わせる
    const match = groups[0].title && P.matchBook(state.books, groups[0].title);
    if (match) selectBook(match.id);
    renderKindle();
  });
  $("#kindle-ai").addEventListener("click", kindleByAi);
}

async function kindleByAi() {
  const raw = $("#kindle-text").value.trim();
  if (!raw) { toast("先に貼り付けてください"); return; }
  const sample = await getSample();
  if (!sample) { toast("この画面では Claude を使えません"); return; }
  const btn = $("#kindle-ai");
  btn.disabled = true;
  $("#kindle-result").replaceChildren(el("div", { class: "working" }, el("span", { class: "spinner" }), "Claude が読み取っています…"));
  try {
    const res = await sample.json([
      "次は Kindle のハイライトをコピーした文です。ハイライト1つずつに分けてください。本文は変えずにそのまま。",
      "ページ番号は page（数字か null）、位置番号は loc（文字列、無ければ空）、ハイライトに付いた自分のメモは memo（無ければ空）。書名が分かれば title に。",
      'JSON だけで返してください：{"title": "…", "items": [{"text": "…", "page": null, "loc": "123", "memo": ""}]}',
      "",
      raw.slice(0, KINDLE_AI_MAX),
    ].join("\n"), { modelTier: "quick" });
    const items = (Array.isArray(res?.items) ? res.items : []).map((i) => ({ text: String(i?.text || "").trim(), page: Number.isInteger(i?.page) ? i.page : null, loc: String(i?.loc || ""), memo: String(i?.memo || "") })).filter((i) => i.text);
    if (!items.length) throw new Error("ハイライトを読み取れませんでした");
    state.kindle = { groups: [{ title: String(res.title || ""), author: "", items }], group: 0 };
    const match = res.title && P.matchBook(state.books, res.title);
    if (match) selectBook(match.id);
    renderKindle();
  } catch (e) {
    $("#kindle-result").replaceChildren(el("p", { class: "status err" }, e?.code ? sampleError(e) : e.message));
  } finally {
    btn.disabled = false;
  }
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
      for (let i = 0; i < items.length; i += 100) await saveHighlights(bookId, items.slice(i, i + 100));
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
  const review = el("textarea", { id: "done-review", rows: "6", placeholder: "読書メーターに載せる感想（255文字まで）" });
  review.value = d.review || "";
  const counter = el("div", { class: "counter" });
  const updateCount = () => { const n = [...review.value].length; counter.textContent = `${n} / ${REVIEW_MAX}`; counter.classList.toggle("over", n > REVIEW_MAX); };
  review.addEventListener("input", () => { d.review = review.value; store.set(`review:${b.id}`, review.value); updateCount(); });
  updateCount();

  const draftBtn = el("button", { type: "button", class: "btn ghost small", onclick: async () => {
    const sample = await getSample();
    if (!sample) { toast("この画面では Claude を使えません"); return; }
    draftBtn.disabled = true;
    const hls = [...data.highlights, ...data.legacy].slice(0, 40).map((h) => `- ${h.text.slice(0, 160)}${h.memo ? `（メモ：${h.memo.slice(0, 120)}）` : ""}`).join("\n");
    const prompt = [
      `本『${b.title}』${b.author ? `（${b.author}）` : ""}を読み終えた人の、読書メーター用の感想の下書きを書いてください。`,
      d.rating ? `本人の評価：${d.rating}` : "",
      review.value.trim() ? `本人が書きかけた感想（活かす）：${review.value.trim()}` : "",
      "本人が引いたハイライトとメモ：",
      hls || "（なし）",
      "",
      "条件：本人の一人称で、普段の言葉（です・ます調にしない）。200〜240文字。結末やトリックのネタバレは書かない。ハイライトの引用は短く1つまで。感想の文だけを返す。",
    ].filter(Boolean).join("\n");
    try {
      const { text } = await sample(prompt, { modelTier: "default", onText: ({ text }) => { review.value = text; updateCount(); } });
      review.value = text.trim();
      d.review = review.value;
      store.set(`review:${b.id}`, review.value);
      updateCount();
    } catch (e) { toast(sampleError(e)); } finally { draftBtn.disabled = false; }
  } }, "ハイライトから下書き");

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
      el("div", { class: "actions" }, draftBtn, saveBtn)),
    meterCard,
    notebookCard(b, data));
}

// ---------- はじめ ----------
function setup() {
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  $("#reload").addEventListener("click", () => { state.hl.clear(); loadBooks(); });
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
  setupAddBook();
  setupPhoto();
  setupKindle();
  setupDone();
  const v = store.get("view");
  show(["shelf", "photo", "kindle", "done"].includes(v) ? v : "shelf");
  loadBooks();
}

setup();
