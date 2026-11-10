// かいもの：🆕 新商品タブ。スーパーで買えるお菓子・アイス・飲み物・食品の新発売ニュース（Bing ニュースの RSS）。
// ニュースアプリのように、読んだ記事は一覧から消える（既読は KV に残り、どの端末でも同じ）。📎 でクリップして残せる。
// 見出しの「」『』から商品名を拾い、タップでちょい買いに入れられる。app.js の S・api・esc・toast などを使う。
const N = { items: null, cats: {}, cat: "all", view: "new", loading: false, err: "", added: new Set(), favs: null, read: null };
const NEWS_ICON = { sweets: "🍪", ice: "🍨", drink: "🥤", food: "🍜" };

async function loadNewsState() {
  const [f, r] = await Promise.all([api("GET", "/api/newsfav").catch(() => null), api("GET", "/api/newsread").catch(() => null)]);
  N.favs = f?.favs || N.favs || []; N.read = new Set(r?.read || []);
  if (S.tab === "news") render();
}
const isFav = (link) => !!N.favs?.some((f) => f.link === link);
const isRead = (link) => !!N.read?.has(link);
async function toggleFav(link) {
  const on = isFav(link);
  const x = N.items?.find((i) => i.link === link) || N.favs?.find((f) => f.link === link); if (!x) return;
  const before = N.favs || [];
  N.favs = on ? before.filter((f) => f.link !== link) : [{ ...x, savedAt: new Date().toISOString() }, ...before];
  render(); // 先に見た目を変えてから保存する
  try {
    N.favs = on ? (await api("DELETE", "/api/newsfav", { link })).favs : (await api("POST", "/api/newsfav", { item: x })).favs;
    toast(on ? "クリップを外しました" : "📎 クリップしました");
  } catch (err) { N.favs = before; toast(`保存できませんでした：${err.message}`); }
  render();
}
// 読んだ（一覧から消す）。unread=true で未読に戻す
async function markRead(links, unread = false, quiet = false) {
  links = links.filter(Boolean); if (!links.length) return;
  for (const l of links) unread ? N.read.delete(l) : N.read.add(l);
  render();
  try { N.read = new Set((await api("POST", "/api/newsread", { links, unread })).read); }
  catch (err) { for (const l of links) unread ? N.read.add(l) : N.read.delete(l); toast(`保存できませんでした：${err.message}`); }
  if (!quiet) toast(unread ? "未読に戻しました" : links.length > 1 ? `${links.length}件を読んだことにしました（✓ 既読 から戻せます）` : "読んだことにしました（✓ 既読 から戻せます）");
  render();
}
async function loadNews(fresh = false) {
  if (N.loading) return;
  N.loading = true; if (S.tab === "news") render();
  try { const r = await api("GET", `/api/news?cat=all${fresh ? "&fresh=1" : ""}`); N.items = r.items; N.cats = r.cats; N.err = ""; }
  catch (err) { N.err = err.message; N.items ||= []; }
  finally { N.loading = false; if (S.tab === "news") render(); }
}
// 記事の日付：11/7（土）・3日前（日本時間）
const dateTx = (iso) => {
  if (!iso) return "日付不明";
  const t = new Date(Date.parse(iso) + 9 * 3600e3);
  const d = Math.floor((Date.parse(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) - Date.parse(t.toISOString().slice(0, 10))) / 864e5);
  const ago = d <= 0 ? "今日" : d === 1 ? "きのう" : `${d}日前`;
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${"日月火水木金土"[t.getUTCDay()]}）・${ago}`;
};

function renderNews() {
  if (!N.items && !N.loading) loadNews();
  if (!N.read) { N.read = new Set(); N.favs ||= []; loadNewsState(); }
  const all = N.items || [];
  const inCat = (x) => N.cat === "all" || x.cat === N.cat;
  const unread = all.filter((x) => !isRead(x.link));
  const views = [["new", `📰 未読${unread.length ? ` ${unread.length}` : ""}`], ["fav", `📎 クリップ${N.favs.length ? ` ${N.favs.length}` : ""}`], ["read", "✓ 既読"]];
  const cats = [["all", "すべて"], ...Object.entries(N.cats)];
  const head = `<div class="ltools"><b>🆕 新商品</b><span class="mute">スーパーで買えるお菓子・アイス・飲み物など</span><button type="button" class="btn ghost sm" data-newsreload="1" ${N.loading ? "disabled" : ""}>${N.loading ? "読みこみ中…" : "↻ 新しく"}</button></div>
    <div class="seg newsview">${views.map(([k, n]) => `<button type="button" data-newsview="${k}" aria-pressed="${N.view === k}">${esc(n)}</button>`).join("")}</div>
    ${N.view !== "fav" && cats.length > 1 ? `<div class="chips">${cats.map(([k, n]) => { const c = (N.view === "new" ? unread : all.filter((x) => isRead(x.link))).filter((x) => k === "all" || x.cat === k).length; return `<button type="button" class="chip" data-newscat="${k}" aria-pressed="${N.cat === k}">${NEWS_ICON[k] || ""}${esc(n)}${c ? `<small>${c}</small>` : ""}</button>`; }).join("")}</div>` : ""}`;
  if (N.view === "fav") {
    if (!N.favs.length) return `${head}<div class="empty small">まだありません。気になる記事の 📎 を押すとここに残ります</div>`;
    return `${head}<div class="news">${N.favs.map((x) => newsCard(x, "fav")).join("")}</div><p class="note pad">📎 をもう一度押すと外します。読んだ記事・古くなった記事もここには残ります（100件まで）。</p>`;
  }
  if (!N.items) return `${head}<div class="empty small">読みこみ中…</div>`;
  if (N.err && !all.length) return `${head}<div class="card"><p class="note err">${esc(N.err)}</p></div>`;
  if (N.view === "read") {
    const xs = all.filter((x) => isRead(x.link) && inCat(x));
    if (!xs.length) return `${head}<div class="empty small">読んだ記事はまだありません</div>`;
    return `${head}<div class="news">${xs.map((x) => newsCard(x, "read")).join("")}</div><p class="note pad">「↩ 未読に戻す」で未読の一覧に戻ります。</p>`;
  }
  const xs = unread.filter(inCat);
  if (!xs.length) return `${head}<div class="empty">🎉 新しい記事はぜんぶ読みました<small>3時間ごとに新しい記事を探します</small></div>`;
  return `${head}<div class="news">${xs.map((x) => newsCard(x, "new")).join("")}</div>
    <div class="row-end"><button type="button" class="btn ghost sm" data-newsreadall="1">✓ ここにある${xs.length}件を全部読んだ</button></div>
    <p class="note pad">見出しをタップすると記事が開き、読んだ記事は一覧から消えます（✓ 読んだ でも消せます）。📎 でクリップ、＋ で ⚡ ちょい買い へ。この1週間の新発売ニュースを3時間ごとに読み直します（Bing ニュースより。タバコ・時事の話は出しません）。</p>`;
}
function newsCard(x, view) {
  const fav = isFav(x.link);
  return `<div class="card nitem${fav ? " fav" : ""}${view === "read" ? " read" : ""}">
      <div class="ndate">${NEWS_ICON[x.cat] || "🆕"} <b>${esc(dateTx(x.date))}</b><span>${esc(x.source || "")}</span></div>
      <a class="ntitle" href="${esc(x.link)}" target="_blank" rel="noopener" data-newsopen="${esc(x.link)}">${x.image ? `<img class="nimg" src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<span><b>${esc(x.title)}</b>${x.desc ? `<small>${esc(x.desc)}…</small>` : ""}</span></a>
      <div class="nnames">${(x.names || []).map((n) => { const on = N.added.has(n); return `<button type="button" class="chip${on ? " on" : ""}" data-newsadd="${esc(n)}" ${on ? "disabled" : ""}>${on ? "✓" : "＋"} ${esc(n)}</button>`; }).join("")}${x.names?.length ? `<a class="chip ghost" href="${esc(googleUrl(x.names[0]))}" target="_blank" rel="noopener" aria-label="Google で調べる">🔎</a>` : ""}
        <span class="nacts"><button type="button" class="favbtn${fav ? " on" : ""}" data-newsfav="${esc(x.link)}" aria-pressed="${fav}">${fav ? "📎 クリップ中" : "📎 クリップ"}</button>${view === "new" ? `<button type="button" class="favbtn" data-newsread="${esc(x.link)}">✓ 読んだ</button>` : view === "read" ? `<button type="button" class="favbtn" data-newsunread="${esc(x.link)}">↩ 未読に</button>` : ""}</span></div>
    </div>`;
}
async function newsAdd(name) {
  const seg = S.seg; S.seg = "quick";
  try { await addTexts([name]); N.added.add(name); toast(`「${name}」をちょい買いに入れました`); }
  finally { S.seg = seg; render(); }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-newscat],[data-newsadd],[data-newsreload],[data-newsfav],[data-newsview],[data-newsread],[data-newsunread],[data-newsreadall],[data-newsopen]"); if (!el) return;
  const d = el.dataset;
  // 見出しを開いたら既読に（リンクはそのまま新しいタブで開く）
  if (d.newsopen) { if (N.view === "new" && !isRead(d.newsopen)) setTimeout(() => markRead([d.newsopen], false, true), 400); return; }
  if (d.newsfav) { toggleFav(d.newsfav); return; }
  if (d.newsread) { markRead([d.newsread]); return; }
  if (d.newsunread) { markRead([d.newsunread], true); return; }
  if (d.newsreadall) {
    const xs = (N.items || []).filter((x) => !isRead(x.link) && (N.cat === "all" || x.cat === N.cat)).map((x) => x.link);
    if (xs.length && confirm(`${xs.length}件を読んだことにしますか？`)) markRead(xs);
    return;
  }
  if (d.newsview) { N.view = d.newsview; render(); window.scrollTo(0, 0); return; }
  if (d.newscat) { N.cat = d.newscat; render(); }
  else if (d.newsadd) { el.disabled = true; newsAdd(d.newsadd); }
  else if (d.newsreload) loadNews(true);
});
