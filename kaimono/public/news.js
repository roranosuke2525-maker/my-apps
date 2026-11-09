// かいもの：🆕 新商品タブ。スーパーで買えるお菓子・アイス・飲み物・食品の新発売ニュース（Bing ニュースの RSS）。
// 見出しの「」『』から商品名を拾い、タップでちょい買いに入れられる。app.js の S・api・esc・toast などを使う。
const N = { items: null, cats: {}, cat: "all", loading: false, err: "", added: new Set(), favs: null };
const NEWS_ICON = { sweets: "🍪", ice: "🍨", drink: "🥤", food: "🍜" };

// 気になる新商品（Worker の KV に残る。どの端末でも同じ）
async function loadFavs() {
  try { N.favs = (await api("GET", "/api/newsfav")).favs; } catch { N.favs ||= []; }
  if (S.tab === "news") render();
}
const isFav = (link) => !!N.favs?.some((f) => f.link === link);
async function toggleFav(link, btn) {
  const on = isFav(link);
  const x = N.items?.find((i) => i.link === link) || N.favs?.find((f) => f.link === link); if (!x) return;
  if (btn) btn.disabled = true;
  // 先に見た目を変えてから保存する
  const before = N.favs || [];
  N.favs = on ? before.filter((f) => f.link !== link) : [{ ...x, savedAt: new Date().toISOString() }, ...before];
  render();
  try {
    N.favs = on ? (await api("DELETE", "/api/newsfav", { link })).favs : (await api("POST", "/api/newsfav", { item: x })).favs;
    toast(on ? "気になるから外しました" : "⭐ 気になるに入れました");
  } catch (err) { N.favs = before; toast(`保存できませんでした：${err.message}`); }
  render();
}
async function loadNews(fresh = false) {
  if (N.loading) return;
  N.loading = true; if (S.tab === "news") render();
  try { const r = await api("GET", `/api/news?cat=all${fresh ? "&fresh=1" : ""}`); N.items = r.items; N.cats = r.cats; N.err = ""; }
  catch (err) { N.err = err.message; N.items ||= []; }
  finally { N.loading = false; if (S.tab === "news") render(); }
}
const agoTx = (iso) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? "今日" : d === 1 ? "きのう" : `${d}日前`;
};

function renderNews() {
  if (!N.items && !N.loading) loadNews();
  if (!N.favs) { N.favs = []; loadFavs(); }
  const cats = [["fav", `⭐ 気になる${N.favs.length ? ` ${N.favs.length}` : ""}`], ["all", "すべて"], ...Object.entries(N.cats)];
  const head = `<div class="ltools"><b>🆕 新商品</b><span class="mute">スーパーで買えるお菓子・アイス・飲み物など</span><button type="button" class="btn ghost sm" data-newsreload="1" ${N.loading ? "disabled" : ""}>${N.loading ? "読みこみ中…" : "↻ 新しく"}</button></div>
    ${cats.length > 1 ? `<div class="chips">${cats.map(([k, n]) => `<button type="button" class="chip" data-newscat="${k}" aria-pressed="${N.cat === k}">${NEWS_ICON[k] || ""}${esc(n)}</button>`).join("")}</div>` : ""}`;
  if (N.cat === "fav") {
    if (!N.favs.length) return `${head}<div class="empty small">まだありません。気になる記事の ☆ を押すとここに残ります</div>`;
    return `${head}<div class="news">${N.favs.map(newsCard).join("")}</div><p class="note pad">★ を押すと外します。記事が古くなってもここには残ります（100件まで）。</p>`;
  }
  if (!N.items) return `${head}<div class="empty small">読みこみ中…</div>`;
  if (N.err && !N.items.length) return `${head}<div class="card"><p class="note err">${esc(N.err)}</p></div>`;
  const xs = N.items.filter((x) => N.cat === "all" || x.cat === N.cat);
  if (!xs.length) return `${head}<div class="empty small">この1週間の新発売ニュースは見つかりませんでした</div>`;
  return `${head}<div class="news">${xs.map(newsCard).join("")}</div>
    <p class="note pad">☆ で気になる記事を残せます。＋ を押すと ⚡ ちょい買い に入ります。見出しをタップすると記事が開きます。この1週間の新発売ニュースを、3時間ごとに読み直します（Bing ニュースより。タバコ・時事の話は出しません）。</p>`;
}
function newsCard(x) {
  const fav = isFav(x.link);
  return `<div class="card nitem${fav ? " fav" : ""}">
      <a class="ntitle" href="${esc(x.link)}" target="_blank" rel="noopener">${x.image ? `<img class="nimg" src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<span class="nicon" aria-hidden="true">${NEWS_ICON[x.cat] || "🆕"}</span>`}<span><b>${esc(x.title)}</b>${x.desc ? `<small>${esc(x.desc)}…</small>` : ""}</span></a>
      <div class="nmeta"><span>${esc(x.source || "")}</span><span>${esc(agoTx(x.date))}</span><button type="button" class="favbtn${fav ? " on" : ""}" data-newsfav="${esc(x.link)}" aria-pressed="${fav}" aria-label="${fav ? "気になるから外す" : "気になるに入れる"}">${fav ? "★ 気になる" : "☆ 気になる"}</button></div>
      ${x.names?.length ? `<div class="nnames">${x.names.map((n) => { const on = N.added.has(n); return `<button type="button" class="chip${on ? " on" : ""}" data-newsadd="${esc(n)}" ${on ? "disabled" : ""}>${on ? "✓" : "＋"} ${esc(n)}</button>`; }).join("")}<a class="chip ghost" href="${esc(googleUrl(x.names[0]))}" target="_blank" rel="noopener">🔎</a></div>` : ""}
    </div>`;
}
async function newsAdd(name) {
  const seg = S.seg; S.seg = "quick";
  try { await addTexts([name]); N.added.add(name); toast(`「${name}」をちょい買いに入れました`); }
  finally { S.seg = seg; render(); }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-newscat],[data-newsadd],[data-newsreload],[data-newsfav]"); if (!el) return;
  const d = el.dataset;
  if (d.newsfav) { toggleFav(d.newsfav, el); return; }
  if (d.newscat) { N.cat = d.newscat; render(); }
  else if (d.newsadd) { el.disabled = true; newsAdd(d.newsadd); }
  else if (d.newsreload) loadNews(true);
});
