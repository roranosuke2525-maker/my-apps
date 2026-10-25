// けさの新聞（画面側）。Notion と記事のサイトへは必ず Worker の /api を経由する。
// DB_ニュース の記事を話題ごとに並べ、開くとアプリの中で本文を読める。未読の数はホーム画面のアイコンにも出す。

const KEY_STORAGE = "news-reader:key";
const BANNER_STORAGE = "news-reader:banner-closed";
const AUTH_CACHE = "news-reader-auth";
const STALE_MS = 60e3;
const PAPERS = ["日経", "時事", "東京", "上毛", "朝日", "読売", "毎日"];
const WEEK = "日月火水木金土";
const EMPTY = {
  unread: ["未読はありません", "平日の朝 6:47 に新しい記事が届きます。"],
  recent: ["記事がありません", "ここ3日の記事がまだありません。"],
  sent: ["送った記事はありません", "記事を開いて「📚 送る」を押すと、翌朝リファレンスになります。"],
};

const $ = (id) => document.getElementById(id);

// 要素を作る。文字は必ず textContent で入れる（Notion や記事の文字をHTMLとして扱わない）
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const state = {
  scope: "unread",
  paper: "すべて",
  data: {},
  loadedAt: {},
  errors: {},
  loading: {},
  unread: new Map(), // 未読の記事ID → 新聞社
  bodies: new Map(),
  order: [],
  current: null,
};

// ---------- 日付 ----------
function todayJst() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
function dateLabel(date, withYear = false) {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00Z`);
  const md = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
  return withYear ? `${d.getUTCFullYear()}年${md}` : md;
}

// ---------- 通信 ----------
function getKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${getKey()}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout();
    throw new Error(data.error || "合言葉が違います");
  }
  if (!res.ok) throw new Error(data.error || `通信エラー（${res.status}）`);
  return data;
}

// サービスワーカー（通知を受けたとき）が /api/unread を読めるよう、合言葉をこの端末のキャッシュにも置く
async function shareKeyWithWorker(key) {
  if (!("caches" in window)) return;
  try {
    const c = await caches.open(AUTH_CACHE);
    if (key) await c.put("/__key", new Response(key));
    else await c.delete("/__key");
  } catch {}
}

// ---------- 読み込み ----------
async function load(scope, { force = false } = {}) {
  if (state.loading[scope]) return;
  if (!force && state.data[scope] && Date.now() - (state.loadedAt[scope] || 0) < STALE_MS) return;
  state.loading[scope] = true;
  state.errors[scope] = "";
  if (!state.data[scope]) render();
  try {
    const data = await api(`/api/articles?scope=${scope}`);
    state.data[scope] = data;
    state.loadedAt[scope] = Date.now();
    setUnread(data.unreadItems || []);
  } catch (e) {
    state.errors[scope] = e.message;
  } finally {
    state.loading[scope] = false;
    render();
  }
}

function setUnread(items) {
  state.unread = new Map(items.map((x) => [x.id, x.paper]));
  updateBadge();
}

function allArticles() {
  const seen = new Map();
  for (const d of Object.values(state.data)) for (const a of d?.articles || []) if (!seen.has(a.id)) seen.set(a.id, a);
  return [...seen.values()];
}

function findArticle(id) {
  for (const d of Object.values(state.data)) {
    const a = d?.articles?.find((x) => x.id === id);
    if (a) return a;
  }
  return null;
}

// 同じ記事が複数の一覧に入っているので、全部まとめて書き換える
function patchArticle(id, fields) {
  for (const d of Object.values(state.data)) for (const a of d?.articles || []) if (a.id === id) Object.assign(a, fields);
}

// ---------- 未読の数（画面の赤丸とホーム画面のアイコン） ----------
function unreadCount(paper = "すべて") {
  if (paper === "すべて") return state.unread.size;
  let n = 0;
  for (const p of state.unread.values()) if (p === paper) n++;
  return n;
}

function updateBadge() {
  const n = unreadCount();
  const total = $("total");
  total.hidden = n === 0;
  total.textContent = n > 99 ? "99+" : String(n);
  total.setAttribute("aria-label", `未読 ${n} 件`);
  const tab = document.querySelector('[data-count="unread"]');
  tab.hidden = n === 0;
  tab.textContent = String(n);
  document.title = n ? `(${n}) けさの新聞` : "けさの新聞";
  if ("setAppBadge" in navigator) {
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }
}

// ---------- 描画 ----------
function render() {
  const loggedIn = !!getKey();
  $("login").hidden = loggedIn;
  $("list").hidden = !loggedIn;
  document.querySelector(".tabs").hidden = !loggedIn;
  $("papers").hidden = !loggedIn;
  if (!loggedIn) return;

  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.scope === state.scope));
  renderPapers();
  renderBanner();
  renderList();
  updateBadge();
}

function renderPapers() {
  const list = state.data[state.scope]?.articles || [];
  const present = new Set(list.map((a) => a.paper));
  const papers = PAPERS.filter((p) => present.has(p) || unreadCount(p) > 0);
  if (state.paper !== "すべて" && !papers.includes(state.paper)) state.paper = "すべて";
  const chip = (p) => {
    const n = unreadCount(p);
    return h(
      "button",
      { type: "button", class: "paper-chip", "aria-pressed": String(state.paper === p), onclick: () => { state.paper = p; render(); } },
      p,
      n ? h("span", { class: "badge small", text: String(n) }) : null,
    );
  };
  $("papers").replaceChildren(chip("すべて"), ...papers.map(chip));
}

function renderList() {
  const body = $("list-body");
  const data = state.data[state.scope];
  if (!data) {
    body.replaceChildren(
      state.errors[state.scope] ? h("div", { class: "error", text: state.errors[state.scope] }) : h("div", { class: "loading", text: "読み込み中…" }),
    );
    return;
  }
  const list = data.articles.filter((a) => state.paper === "すべて" || a.paper === state.paper);
  const nodes = [];
  if (state.errors[state.scope]) nodes.push(h("div", { class: "error", text: state.errors[state.scope] }));
  if (list.length === 0) {
    const [title, text] = EMPTY[state.scope];
    nodes.push(h("div", { class: "empty" }, h("b", { text: title }), text));
    body.replaceChildren(...nodes);
    state.order = [];
    return;
  }

  // 2社以上が扱った話題はまとめて、残りは全国／地元に分けて並べる
  const groups = new Map();
  for (const a of list) {
    const k = a.topicName;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  // 一部を読んで残りが1件になっても、Notion の社数が2以上ならまとまりのまま出す
  const papersOf = (g) => Math.max(g.length, ...g.map((a) => a.topicCount || 1));
  const multi = [...groups.values()]
    .filter((g) => papersOf(g) >= 2)
    .sort((a, b) => papersOf(b) - papersOf(a) || (b[0].date > a[0].date ? 1 : -1));
  const multiIds = new Set(multi.flat().map((a) => a.id));
  const rest = list.filter((a) => !multiIds.has(a.id));
  const national = rest.filter((a) => a.frame !== "地元");
  const local = rest.filter((a) => a.frame === "地元");

  state.order = [...multi.flat(), ...national, ...local].map((a) => a.id);

  if (multi.length) {
    nodes.push(h("h2", { class: "section-title" }, "各社が報じた話題", h("small", { text: `${multi.length}件` })));
    for (const g of multi) {
      nodes.push(
        h(
          "section",
          { class: "topic" },
          h("div", { class: "topic-head" }, h("span", { class: "topic-name", text: g[0].topicName }), h("span", { class: "topic-count", text: `${papersOf(g)}社` })),
          h("ul", { class: "items" }, g.map((a) => itemRow(a))),
        ),
      );
    }
  }
  if (national.length) nodes.push(plainSection("全国", national));
  if (local.length) nodes.push(plainSection("地元", local));
  body.replaceChildren(...nodes);
}

function plainSection(title, items) {
  return h(
    "section",
    { class: "plain" },
    h("h2", { class: "section-title" }, title, h("small", { text: `${items.length}件` })),
    h("ul", { class: "items" }, items.map((a) => itemRow(a))),
  );
}

function itemRow(a, { showDate = state.scope !== "unread" } = {}) {
  const unread = a.state === "未読";
  const sentTag = a.state === "📚 送る" ? "📚 送る予定" : a.state === "📚 送り済" ? "📚 送り済" : "";
  return h(
    "li",
    { class: `item${unread ? "" : " read"}` },
    h(
      "button",
      { type: "button", onclick: () => openArticle(a.id) },
      h("span", { class: `paper p-${a.paper}`, text: a.paper || "—" }),
      h("span", { class: "title" }, unread && state.scope !== "unread" ? h("span", { class: "dot", "aria-label": "未読" }) : null, a.title, a.paid ? h("span", { class: "lock", text: "🔒", "aria-label": "有料" }) : null),
      h(
        "span",
        { class: "summary" },
        [a.summary, showDate ? dateLabel(a.date) : ""].filter(Boolean).join("　"),
        sentTag ? h("span", { class: "state-tag", text: sentTag }) : null,
      ),
    ),
  );
}

// ---------- 記事を読む ----------
function openArticle(id, { push = true } = {}) {
  const a = findArticle(id);
  if (!a) return;
  state.current = id;
  if (push) history.pushState({ article: id }, "", `#${id}`);
  $("reader").hidden = false;
  document.body.style.overflow = "hidden";
  renderReader();
  $("reader-scroll").scrollTop = 0;
  if (a.state === "未読") setState(id, "読んだ", { quiet: true });
  if (!state.bodies.has(id)) {
    api(`/api/articles/${id}/body`)
      .then((b) => state.bodies.set(id, b))
      .catch((e) => state.bodies.set(id, { paragraphs: [], note: e.message }))
      .finally(() => { if (state.current === id) renderReader(); });
  }
}

function closeReader() {
  state.current = null;
  $("reader").hidden = true;
  document.body.style.overflow = "";
  render();
}

function renderReader() {
  const id = state.current;
  const a = findArticle(id);
  if (!a) return;
  const b = state.bodies.get(id);

  $("reader-meta").replaceChildren(h("span", { class: `paper p-${a.paper}`, text: a.paper || "—" }), h("span", { text: dateLabel(a.date) }));
  const open = $("reader-open");
  if (a.url) open.href = a.url;
  else open.removeAttribute("href");

  const nodes = [h("h2", { text: a.title })];
  if (a.summary) nodes.push(h("p", { class: "hitokoto", text: a.summary }));
  if (!b) {
    nodes.push(h("div", { class: "skeleton" }, ...[90, 100, 95, 80, 100, 60].map((w) => h("p", { style: `width:${w}%` }))));
  } else {
    if (b.image) nodes.push(h("img", { class: "lead-img", src: b.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: (e) => e.target.remove() }));
    if (b.paragraphs?.length) nodes.push(h("div", { class: "text" }, b.paragraphs.map((t) => h("p", { text: t }))));
    if (b.note) nodes.push(h("div", { class: "reader-note", text: b.note }));
    else if (a.paid) nodes.push(h("div", { class: "reader-note", text: "🔒 有料記事のため、読めるのは無料の部分までです。続きは元の記事で（会員登録が必要）。" }));
  }
  if (a.url) {
    nodes.push(h("a", { class: "open-link", href: a.url, target: "_blank", rel: "noopener noreferrer" }, "元の記事を開く ↗"));
  }

  const related = allArticles().filter((x) => x.id !== id && x.topicName === a.topicName);
  if (related.length) {
    nodes.push(
      h("section", { class: "related" }, h("h3", { text: `同じ話題の他社（${related.length}）` }), h("ul", { class: "items" }, related.map((x) => itemRow(x, { showDate: true })))),
    );
  }
  $("reader-body").replaceChildren(...nodes);

  const sent = a.state === "📚 送る" || a.state === "📚 送り済";
  const send = $("act-send");
  send.textContent = a.state === "📚 送り済" ? "📚 送り済" : sent ? "📚 送る予定" : "📚 送る";
  send.classList.toggle("on", sent);
  send.disabled = a.state === "📚 送り済";
  const back = $("act-unread");
  back.textContent = a.state === "未読" ? "読んだにする" : "未読に戻す";
  back.disabled = a.state === "📚 送り済";
  const next = nextId();
  $("act-next").disabled = !next;
  $("act-next").textContent = next ? "次の記事 →" : "最後の記事です";
}

function nextId() {
  const i = state.order.indexOf(state.current);
  return i === -1 ? null : state.order[i + 1] || null;
}

// ---------- 状態の書き換え ----------
async function setState(id, next, { quiet = false } = {}) {
  const a = findArticle(id);
  if (!a || a.state === next) return;
  const prev = a.state;
  patchArticle(id, { state: next });
  if (next === "未読") state.unread.set(id, a.paper);
  else state.unread.delete(id);
  updateBadge();
  if (state.current === id) renderReader();
  else render();
  try {
    await api(`/api/articles/${id}`, { method: "PATCH", body: JSON.stringify({ state: next }) });
    if (!quiet) toast(next === "📚 送る" ? "翌朝リファレンスに送ります" : next === "未読" ? "未読に戻しました" : "読んだにしました");
  } catch (e) {
    patchArticle(id, { state: prev });
    if (prev === "未読") state.unread.set(id, a.paper);
    else state.unread.delete(id);
    updateBadge();
    if (state.current === id) renderReader();
    else render();
    toast(`保存できませんでした：${e.message}`);
  }
}

let toastTimer = null;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

// ---------- 通知（ホーム画面のアイコンの数字） ----------
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const canNotify = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;

function notifyState() {
  if (isIos && !isStandalone) return "add-to-home";
  if (!canNotify) return "unsupported";
  return Notification.permission; // granted / denied / default
}

function renderBanner() {
  const banner = $("notify-banner");
  const s = notifyState();
  let closed = false;
  try {
    closed = localStorage.getItem(BANNER_STORAGE) === "1";
  } catch {}
  if (closed || s === "granted" || s === "unsupported" || s === "denied") {
    banner.hidden = true;
    return;
  }
  const close = h("button", { type: "button", class: "icon-btn", "aria-label": "閉じる", onclick: () => {
    try { localStorage.setItem(BANNER_STORAGE, "1"); } catch {}
    banner.hidden = true;
  } }, "×");
  banner.replaceChildren(
    ...(s === "add-to-home"
      ? [h("p", { text: "共有ボタン →「ホーム画面に追加」で開くと、アイコンに未読の数（赤丸）が出せます。" }), close]
      : [h("p", { text: "ホーム画面のアイコンに未読の数（赤丸）を出しますか？" }), h("button", { type: "button", class: "primary", onclick: enableNotify, text: "オンにする" }), close]),
  );
  banner.hidden = false;
}

async function enableNotify() {
  if (notifyState() === "add-to-home") return toast("先にホーム画面に追加してください");
  if (!canNotify) return toast("この端末では使えません");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    render();
    renderSettings();
    return toast("通知が許可されませんでした（設定アプリ → 通知 から変えられます）");
  }
  updateBadge();
  try {
    const reg = await navigator.serviceWorker.ready;
    const key = await api("/api/push/key");
    if (key.enabled) {
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key.publicKey) }));
      await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
      toast("オンにしました。平日の朝、未読の数がアイコンに出ます");
    } else {
      toast("アプリを開いたときにアイコンの数字を更新します");
    }
  } catch (e) {
    toast(`通知の登録に失敗しました：${e.message}`);
  }
  render();
  renderSettings();
}

function b64ToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function renderSettings() {
  const s = notifyState();
  const text = {
    "add-to-home": "アイコンの赤丸は、ホーム画面に追加したアプリで使えます（共有ボタン →「ホーム画面に追加」）。",
    unsupported: "この端末・ブラウザは通知に対応していません。",
    denied: "通知がオフになっています。設定アプリ → 通知 → 新聞 から許可してください。",
    default: "オンにすると、ホーム画面のアイコンに未読の数が出ます。平日 7:15 ごろに今朝の件数をお知らせします。",
    granted: "オンになっています。アイコンに未読の数が出ます。",
  }[s];
  $("notify-status").textContent = text;
  $("notify-on").hidden = s === "granted" || s === "unsupported" || s === "denied";
  $("notify-test").hidden = s !== "granted";
}

// ---------- 起動 ----------
function logout() {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {}
  shareKeyWithWorker("");
  state.data = {};
  state.unread = new Map();
  if ("clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
  render();
}

function selectScope(scope) {
  const again = state.scope === scope;
  state.scope = scope;
  render();
  load(scope, { force: again });
  window.scrollTo({ top: 0 });
}

function init() {
  $("today").textContent = dateLabel(todayJst(), true);
  $("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const key = $("key").value.trim();
    try {
      localStorage.setItem(KEY_STORAGE, key);
    } catch {}
    shareKeyWithWorker(key);
    render();
    load(state.scope, { force: true });
  });
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => selectScope(b.dataset.scope));
  $("total").addEventListener("click", () => selectScope("unread"));

  $("reader-back").addEventListener("click", () => (history.state?.article ? history.back() : closeReader()));
  $("act-send").addEventListener("click", () => {
    const a = findArticle(state.current);
    if (a) setState(a.id, a.state === "📚 送る" ? "読んだ" : "📚 送る");
  });
  $("act-unread").addEventListener("click", () => {
    const a = findArticle(state.current);
    if (a) setState(a.id, a.state === "未読" ? "読んだ" : "未読");
  });
  $("act-next").addEventListener("click", () => {
    const next = nextId();
    if (next) {
      history.replaceState({ article: next }, "", `#${next}`);
      openArticle(next, { push: false });
    }
  });
  window.addEventListener("popstate", (e) => {
    if (e.state?.article && findArticle(e.state.article)) openArticle(e.state.article, { push: false });
    else if (state.current) closeReader();
  });

  $("open-settings").addEventListener("click", () => {
    renderSettings();
    $("settings").showModal();
  });
  $("notify-on").addEventListener("click", enableNotify);
  $("notify-test").addEventListener("click", async () => {
    try {
      const r = await api("/api/push/test", { method: "POST" });
      toast(r.enabled === false ? "通知の保存先（KV）がありません" : r.sent ? "通知を送りました" : "送れる端末がありません。いったんオフ→オンにしてください");
    } catch (e) {
      toast(e.message);
    }
  });
  $("logout").addEventListener("click", () => {
    $("settings").close();
    logout();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getKey()) load(state.scope);
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (location.hash) history.replaceState(null, "", location.pathname);
  render();
  if (getKey()) {
    shareKeyWithWorker(getKey());
    load(state.scope);
  }
}

init();
