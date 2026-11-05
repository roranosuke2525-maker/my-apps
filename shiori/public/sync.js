// しおりへ同期：Safari のブックマークが Kindle の「メモとハイライト」から読み取ったハイライトを受け取り、本棚の本と合わせて DB_読書ハイライトに足す。
// 受け取りは /api/kindle-sync（フォーム）→ sessionStorage → この画面。合言葉は本体と同じ localStorage のものを使う。

const P = window.ShioriParse;
const SAVE_CHUNK = 40;
const STORE_KEY = "shiori:kindleSync";
const $ = (s, el = document) => el.querySelector(s);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return n;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

const key = (() => { try { return localStorage.getItem("shiori:key") || ""; } catch { return ""; } })();

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("合言葉が違います。しおりを開き直して合言葉を入れてください");
  if (!res.ok) throw new Error(data.error || `通信エラー（${res.status}）`);
  return data;
}

function readPayload() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.v === 1 && Array.isArray(d.books) ? d : null;
  } catch { return null; }
}

const box = () => $("#sync");
const working = (msg) => box().replaceChildren(el("div", { class: "working" }, el("span", { class: "spinner" }), msg));

async function main() {
  const data = readPayload();
  if (!data) {
    box().replaceChildren(
      el("div", { class: "card guide" },
        el("h2", { class: "sec" }, "まだ何も受け取っていません"),
        el("p", {}, "Safari で Kindle の「メモとハイライト」（read.amazon.co.jp/notebook）を開き、ブックマーク「しおりへ同期」を押すと、ここに届きます。"),
        el("p", { class: "note" }, "ブックマークの作り方は、しおりの「Kindle」タブにあります。"),
        el("div", { class: "actions" }, el("a", { class: "btn", href: "./#kindle" }, "しおりを開く"))));
    return;
  }
  if (!key) {
    box().replaceChildren(
      el("div", { class: "card guide" },
        el("h2", { class: "sec" }, "合言葉がありません"),
        el("p", {}, "この端末でまだしおりを開いていません。先にしおりを開いて合言葉を入れ、戻ってきてください（受け取ったハイライトはこのタブに残っています）。"),
        el("div", { class: "actions" }, el("a", { class: "btn", href: "./", target: "_blank", rel: "noopener" }, "しおりを開く"), el("button", { type: "button", class: "btn ghost", onclick: () => location.reload() }, "入れたので続ける"))));
    return;
  }

  working("本棚と照らし合わせています…");
  let shelf;
  try { shelf = await api("GET", "/api/books"); } catch (e) { box().replaceChildren(el("p", { class: "note" }, e.message)); return; }
  const books = shelf.books || [];
  const authors = shelf.options?.authors || [];

  // 受け取った本ごとに、本棚の本・登録済みのハイライトを調べる
  const rows = [];
  for (const b of data.books) {
    const { title, publisher } = P.splitAmazonTitle(b.title);
    const items = (b.items || []).filter((it) => it && String(it.text || "").trim()).map((it) => {
      const meta = P.kindleMeta(it.header, it.loc);
      return { text: String(it.text).replace(/\s+/g, " ").trim(), memo: String(it.note || "").trim(), page: meta.page, loc: meta.loc, on: true, dup: false };
    });
    const match = P.matchBook(books, title) || P.matchBook(books, b.title);
    rows.push({ asin: b.asin, title, publisher, author: P.matchAuthor(authors, b.author), cover: /^https:\/\//.test(b.cover || "") ? b.cover : "", items, match, on: items.length > 0, open: false });
  }
  // 登録済みのものは外す（本棚にある本だけ）
  for (const r of rows) {
    if (!r.match || !r.items.length) continue;
    working(`『${r.match.title}』の登録済みハイライトを見ています…`);
    try {
      const d = await api("GET", `/api/books/${r.match.id}/highlights`);
      const have = new Set([...(d.highlights || []), ...(d.legacy || [])].map((h) => P.norm(h.text)));
      for (const it of r.items) { it.dup = have.has(P.norm(it.text)); it.on = !it.dup; }
    } catch (e) { toast(e.message); }
    r.on = r.items.some((it) => it.on);
  }
  render(rows, data);
}

function render(rows, data) {
  const newCount = () => rows.filter((r) => r.on).reduce((a, r) => a + r.items.filter((it) => it.on).length, 0);
  const newBooks = () => rows.filter((r) => r.on && !r.match && r.items.some((it) => it.on)).length;
  const total = rows.reduce((a, r) => a + r.items.length, 0);
  const saveBtn = el("button", { type: "button", class: "btn", disabled: !newCount(), onclick: () => save(rows, saveBtn) }, label());
  function label() { const nb = newBooks(); return `${newCount()}件をしおりに入れる${nb ? `（本を${nb}冊足す）` : ""}`; }
  const refresh = () => { saveBtn.disabled = !newCount(); saveBtn.textContent = label(); };

  box().replaceChildren(
    el("p", { class: "note" }, `${data.host || "Kindle"} から ${rows.length}冊・${total}件を受け取りました${data.at ? `（${new Date(data.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）` : ""}。登録済みのものは外してあります。`),
    el("ol", { class: "sync-books" }, rows.map((r) => {
      const fresh = r.items.filter((it) => !it.dup).length;
      const check = el("input", { type: "checkbox", checked: r.on, disabled: !fresh, onchange: (e) => { r.on = e.target.checked; refresh(); } });
      const list = el("ol", { class: "hls" }, r.items.map((it) => el("li", { class: `hl${it.dup ? " dup" : ""}` },
        el("label", { class: "hl-check" },
          el("input", { type: "checkbox", checked: it.on, disabled: it.dup, onchange: (e) => { it.on = e.target.checked; r.on = r.items.some((x) => x.on); check.checked = r.on; refresh(); } }),
          el("blockquote", {}, it.text)),
        it.memo ? el("div", { class: "hl-memo" }, it.memo) : null,
        el("div", { class: "hl-meta" }, [it.page != null ? `p.${it.page}` : "", it.loc ? `位置 ${it.loc}` : "", it.dup ? "登録済み" : ""].filter(Boolean).map((w) => el("span", {}, w))))));
      list.hidden = true;
      return el("li", { class: "sync-book" },
        el("label", { class: "sync-head" }, check,
          r.cover ? el("img", { class: "sync-thumb", src: r.cover, alt: "", width: "40", loading: "lazy" }) : el("span", { class: "sync-thumb", "aria-hidden": "true" }),
          el("div", { class: "sync-main" },
            el("div", { class: "sync-title" }, r.title),
            el("div", { class: "sync-meta" }, [r.author, r.publisher].filter(Boolean).join(" ・ ")),
            el("div", { class: "sync-meta sync-where" }, r.match
              ? `本棚の『${r.match.title}』に入れる ・ 新しく${fresh}件${r.items.length - fresh ? `（登録済み${r.items.length - fresh}件）` : ""}`
              : fresh ? `本棚に無い本。新しく「読中」で足して ${fresh}件を入れる` : "ハイライトなし"))),
        fresh || r.items.length ? el("button", { type: "button", class: "linkish", onclick: (e) => { list.hidden = !list.hidden; e.target.textContent = list.hidden ? `${r.items.length}件を見る` : "閉じる"; } }, `${r.items.length}件を見る`) : null,
        list);
    })),
    el("div", { class: "sticky-actions" }, saveBtn));
}

async function save(rows, btn) {
  btn.disabled = true;
  const done = [];
  try {
    for (const r of rows) {
      if (!r.on) continue;
      const items = r.items.filter((it) => it.on).map((it) => ({ text: it.text, page: it.page ?? "", loc: it.loc, memo: it.memo, source: "📱 Kindle" }));
      if (!items.length) continue;
      let bookId = r.match?.id;
      let title = r.match?.title;
      if (!bookId) {
        working(`『${r.title}』を本棚に足しています…`);
        const { book } = await api("POST", "/api/books", { title: r.title, author: r.author, publisher: r.publisher, cover: r.cover, status: "読中" });
        bookId = book.id; title = book.title;
      }
      let n = 0;
      for (let i = 0; i < items.length; i += SAVE_CHUNK) {
        working(`『${title}』に ${Math.min(i + SAVE_CHUNK, items.length)}/${items.length} 件を入れています…`);
        const res = await api("POST", "/api/highlights", { bookId, items: items.slice(i, i + SAVE_CHUNK) });
        n += res.added;
      }
      done.push({ title, n, added: !r.match });
    }
    try { sessionStorage.removeItem(STORE_KEY); } catch { /* 消せなくても困らない */ }
    box().replaceChildren(
      el("p", { class: "saved-flag" }, `✓ ${done.reduce((a, d) => a + d.n, 0)}件を保存しました`),
      el("ul", { class: "sync-done" }, done.map((d) => el("li", {}, `『${d.title}』 ${d.n}件${d.added ? "（本棚に「読中」で足しました）" : ""}`))),
      el("p", { class: "note" }, "読み終えていた本が「読中」で入ったときは、しおりの本棚でステータスを直してください。"),
      el("div", { class: "actions" }, el("a", { class: "btn", href: "./" }, "しおりを開く")));
  } catch (e) {
    toast(e.message);
    box().prepend(el("p", { class: "note" }, `途中で止まりました：${e.message}（入ったもの：${done.map((d) => `『${d.title}』${d.n}件`).join("、") || "なし"}）。もう一度ブックマークを押せば、入った分は外して続きから入れられます。`));
  }
}

main();
