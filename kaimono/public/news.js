// かいもの：🆕 新商品タブ。スーパーで買えるお菓子・アイス・飲み物・食品の新発売ニュース（Google ニュースの検索 RSS）。
// 見出しの「」『』から商品名を拾い、タップでちょい買いに入れられる。app.js の S・api・esc・toast などを使う。
const N = { items: null, cats: {}, cat: "all", loading: false, err: "", added: new Set() };
const NEWS_ICON = { sweets: "🍪", ice: "🍨", drink: "🥤", food: "🍜" };

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
  const cats = [["all", "すべて"], ...Object.entries(N.cats)];
  const head = `<div class="ltools"><b>🆕 新商品</b><span class="mute">スーパーで買えるお菓子・アイス・飲み物など</span><button type="button" class="btn ghost sm" data-newsreload="1" ${N.loading ? "disabled" : ""}>${N.loading ? "読みこみ中…" : "↻ 新しく"}</button></div>
    ${cats.length > 1 ? `<div class="chips">${cats.map(([k, n]) => `<button type="button" class="chip" data-newscat="${k}" aria-pressed="${N.cat === k}">${NEWS_ICON[k] || ""}${esc(n)}</button>`).join("")}</div>` : ""}`;
  if (!N.items) return `${head}<div class="empty small">読みこみ中…</div>`;
  if (N.err && !N.items.length) return `${head}<div class="card"><p class="note err">${esc(N.err)}</p></div>`;
  const xs = N.items.filter((x) => N.cat === "all" || x.cat === N.cat);
  if (!xs.length) return `${head}<div class="empty small">この2週間の新発売ニュースは見つかりませんでした</div>`;
  return `${head}<div class="news">${xs.map((x) => `<div class="card nitem">
      <a class="ntitle" href="${esc(x.link)}" target="_blank" rel="noopener"><span class="nicon" aria-hidden="true">${NEWS_ICON[x.cat] || "🆕"}</span><span>${esc(x.title)}</span></a>
      <div class="nmeta"><span>${esc(x.source || "")}</span><span>${esc(agoTx(x.date))}</span></div>
      ${x.names?.length ? `<div class="nnames">${x.names.map((n) => { const on = N.added.has(n); return `<button type="button" class="chip${on ? " on" : ""}" data-newsadd="${esc(n)}" ${on ? "disabled" : ""}>${on ? "✓" : "＋"} ${esc(n)}</button>`; }).join("")}<a class="chip ghost" href="${esc(googleUrl(x.names[0]))}" target="_blank" rel="noopener">🔎</a></div>` : ""}
    </div>`).join("")}</div>
    <p class="note pad">＋ を押すと ⚡ ちょい買い に入ります。見出しをタップすると記事が開きます。2週間以内の新発売ニュースを、3時間ごとに読み直します（Google ニュースより）。</p>`;
}
async function newsAdd(name) {
  const seg = S.seg; S.seg = "quick";
  try { await addTexts([name]); N.added.add(name); toast(`「${name}」をちょい買いに入れました`); }
  finally { S.seg = seg; render(); }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-newscat],[data-newsadd],[data-newsreload]"); if (!el) return;
  const d = el.dataset;
  if (d.newscat) { N.cat = d.newscat; render(); }
  else if (d.newsadd) { el.disabled = true; newsAdd(d.newsadd); }
  else if (d.newsreload) loadNews(true);
});
