// かいもの：💴 価格タブ。レシートを撮って（Claude で読み取り）DB_レシート・DB_価格記録 に残し、品ごとに店別の比較表を出す。
// app.js の S・api・esc・toast などをそのまま使う（同じページの通常のスクリプト）。
const P = { prices: null, receipts: [], q: "", open: "", loading: false, err: "", draft: null };

async function loadPriceData() {
  if (P.loading) return;
  P.loading = true;
  try { Object.assign(P, await api("GET", "/api/prices"), { err: "" }); }
  catch (err) { P.err = err.message; P.prices ||= []; }
  finally { P.loading = false; if (S.tab === "price") render(); }
}

// 同じ品をまとめる鍵：かな・全角半角・空白・数（「牛乳 2」の 2）をそろえる
const priceKey = (name) => kana(A.splitQty(name).name).replace(/[\s　・]/g, "");
const yen = (n) => (n == null ? "" : `¥${Math.round(n).toLocaleString("ja-JP")}`);
const unitOf = (x) => x.price / (x.qty || 1);

function renderPrices() {
  if (!P.prices && !P.loading) loadPriceData();
  const head = `<div class="stock-acts"><label class="btn pri">📸 レシートを撮る<input type="file" accept="image/*" capture="environment" id="rcptshot" hidden></label><button type="button" class="btn" data-pmanual="1">＋ 手で入れる</button></div>
    <div class="chips storechips"><span class="mute">店：</span>${S.stores.map((n) => `<span class="chip">${esc(n)}<button type="button" class="x" data-storedel="${esc(n)}" aria-label="${esc(n)}を一覧から外す">×</button></span>`).join("")}<button type="button" class="chip" data-storeadd="1">＋ 店を追加</button></div>`;
  if (!P.prices) return `${head}<div class="empty small">読みこみ中…</div>`;
  if (P.err && !P.prices.length) return `${head}<div class="card"><p class="note err">${esc(P.err)}</p><p class="note">Notion の DB_価格記録・DB_レシート に「かいもの」が接続されているか確かめてください。</p></div>`;
  // 品ごと×店ごとに、いちばん安い単価と最後に買った値段
  const groups = new Map();
  for (const x of P.prices) {
    const k = priceKey(x.name); if (!k) continue;
    if (!groups.has(k)) groups.set(k, { name: A.splitQty(x.name).name, rows: [] });
    groups.get(k).rows.push(x);
  }
  const q = kana(P.q.trim());
  const list = [...groups.entries()].filter(([k, g]) => !q || k.includes(q.replace(/\s/g, "")) || kana(g.name).includes(q)).sort((a, b) => (b[1].rows[0].date || "").localeCompare(a[1].rows[0].date || ""));
  const stores = [...new Set(P.prices.map((x) => x.store || "（店なし）"))].sort((a, b) => S.stores.indexOf(a) - S.stores.indexOf(b));
  const rows = list.map(([k, g]) => {
    const by = {};
    for (const x of g.rows) { const st = x.store || "（店なし）"; const u = unitOf(x); if (!by[st] || u < by[st].min) by[st] = { min: u, last: by[st]?.last || x }; if (!by[st].last || (x.date || "") > (by[st].last.date || "")) by[st].last = x; }
    const best = Math.min(...Object.values(by).map((v) => v.min));
    const cells = stores.map((st) => { const v = by[st]; return `<td class="${v && v.min === best && Object.keys(by).length > 1 ? "best" : ""}">${v ? `${yen(v.min)}${v.last.qty > 1 ? "<small>/個</small>" : ""}` : "—"}</td>`; }).join("");
    const open = P.open === k;
    const hist = open ? `<tr class="phist"><td colspan="${stores.length + 1}">${g.rows.map((x) => `<div class="prow2"><span>${esc(md(x.date || ""))}</span><span>${esc(x.store || "—")}</span><span>${esc(x.name)}</span><b>${yen(x.price)}${x.qty > 1 ? `<small>（${x.qty}個・${yen(unitOf(x))}/個）</small>` : ""}</b><button type="button" class="more" data-pdel="${x.id}" aria-label="この記録を消す">🗑</button></div>`).join("")}</td></tr>` : "";
    return `<tr><th><button type="button" class="pname2" data-popen="${esc(k)}">${esc(g.name)}<small>${g.rows.length}回</small></button></th>${cells}</tr>${hist}`;
  }).join("");
  const table = list.length ? `<div class="ptable-wrap"><table class="ptable"><thead><tr><th>品</th>${stores.map((s) => `<th>${esc(s)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty small">${P.prices.length ? "見つかりません" : "まだ記録がありません。レシートを撮るか、手で入れてください"}</div>`;
  const rc = P.receipts.slice(0, 6).map((r) => `<a class="rcpt" href="${esc(r.url)}" target="_blank" rel="noopener">${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "<span>🧾</span>"}<small>${esc(md(r.date || ""))} ${esc(r.store || "")}<br>${yen(r.total)}</small></a>`).join("");
  return `${head}<input id="psearch" class="psearch" type="search" placeholder="品名で探す（例：納豆）" value="${esc(P.q)}" aria-label="品名で探す">
    <div class="card list">${table}</div>
    <p class="note pad">緑はいちばん安い店（数量があれば1個あたり）。品名をタップすると買った記録が出ます。</p>
    ${rc ? `<h3 class="sec">🧾 最近のレシート</h3><div class="rcpts">${rc}</div>` : ""}`;
}

// ---------- レシートの確認シート ----------
function shrinkImage(file, max = 1600) {
  return new Promise((ok, ng) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); ng(new Error("写真を読めませんでした")); };
    img.src = url;
  });
}
async function startReceipt(file) {
  let image;
  try { image = await shrinkImage(file); } catch (err) { toast(err.message); return; }
  P.draft = { image, store: S.stores[0] || "", date: jstDay(), total: "", items: [], reading: true, note: "" };
  renderDraft();
  try {
    const r = await api("POST", "/api/receipts/read", { image, stores: S.stores, names: S.stock.map((x) => x.name) });
    if (!P.draft) return;
    if (!r.configured) P.draft.note = "Claude の API キーを入れると自動で読み取ります。今は手で入れてください（写真は保存されます）";
    else {
      if (r.store) { P.draft.store = r.store; if (!S.stores.includes(r.store)) S.stores.push(r.store); }
      if (r.date) P.draft.date = r.date;
      if (r.total) P.draft.total = r.total;
      P.draft.items = r.items;
      P.draft.note = `${r.items.length}品を読み取りました。違うところを直して保存してください`;
    }
  } catch (err) { if (P.draft) P.draft.note = `${err.message}。手で入れてください`; }
  if (P.draft) { P.draft.reading = false; if (!P.draft.items.length) P.draft.items = [{ name: "", price: "", qty: 1 }]; renderDraft(); }
}
function draftRead() {
  const f = $("#draftform"); if (!f || !P.draft) return;
  P.draft.store = f.elements.store.value; P.draft.date = f.elements.date.value; P.draft.total = f.elements.total.value;
  P.draft.items = [...f.querySelectorAll(".ditem")].map((r) => ({ name: r.querySelector("[name=iname]").value.trim(), price: r.querySelector("[name=iprice]").value, qty: r.querySelector("[name=iqty]").value || 1 }));
}
function renderDraft() {
  const d = P.draft; const el = $("#sheet");
  const sum = d.items.reduce((n, x) => n + (Number(x.price) || 0), 0);
  el.innerHTML = `<div class="sheet-bg" data-draftclose="1"></div><form class="sheet" id="draftform">
    <div class="sh-head"><b>${d.image ? "🧾 レシート" : "＋ 価格を入れる"}</b><button type="button" class="more" data-draftclose="1" aria-label="閉じる">×</button></div>
    ${d.image ? `<img class="rcpt-big" src="${d.image}" alt="レシートの写真">` : ""}
    ${d.reading ? `<p class="note">🤖 読み取っています…</p>` : d.note ? `<p class="note">${esc(d.note)}</p>` : ""}
    <div class="row3"><label>店${storeSelect("store", d.store)}</label><label>日付<input name="date" type="date" value="${esc(d.date)}"></label><label>合計<input name="total" type="number" inputmode="numeric" value="${esc(d.total)}" placeholder="${sum || ""}"></label></div>
    <div class="ditems">${d.items.map((x, k) => `<div class="ditem"><input name="iname" value="${esc(x.name)}" placeholder="品名" autocomplete="off"><input name="iprice" type="number" inputmode="numeric" value="${esc(x.price)}" placeholder="円"><input name="iqty" type="number" inputmode="numeric" value="${esc(x.qty)}" min="1" aria-label="個数"><button type="button" class="more" data-ditemdel="${k}" aria-label="この行を消す">×</button></div>`).join("")}</div>
    <div class="row-end"><button type="button" class="btn ghost sm" data-ditemadd="1">＋ 行を足す</button></div>
    <div class="row-end"><button type="submit" class="btn pri" ${d.reading ? "disabled" : ""}>保存（${d.items.filter((x) => x.name && x.price !== "").length}品）</button></div></form>`;
  el.hidden = false; document.body.classList.add("modal");
}
function closeDraft() { P.draft = null; closeSheet(); }
async function saveDraft(btn) {
  draftRead();
  const d = P.draft;
  const byName = Object.fromEntries(S.stock.map((x) => [priceKey(x.name), x.id]));
  const items = d.items.filter((x) => x.name && x.price !== "").map((x) => ({ ...x, stock: byName[priceKey(x.name)] || "" }));
  if (!items.length && !d.image) { toast("品名と価格を入れてください"); return; }
  btn.disabled = true; btn.textContent = "保存しています…";
  try {
    const res = d.image ? await api("POST", "/api/receipts", { image: d.image, store: d.store, date: d.date, total: d.total, items }) : await api("POST", "/api/prices", { store: d.store, date: d.date, items });
    P.prices = [...res.prices, ...(P.prices || [])];
    if (res.receipt) P.receipts.unshift({ ...res.receipt, store: d.store, date: d.date, total: Number(d.total) || items.reduce((n, x) => n + Number(x.price), 0), photo: "" });
    closeDraft(); render();
    toast(`${res.prices.length}品の価格を記録しました${res.receipt ? "（レシートの写真も保存）" : ""}`);
  } catch (err) { btn.disabled = false; btn.textContent = "保存"; toast(`保存できませんでした：${err.message}`); }
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("button,[data-draftclose]"); if (!el) return;
  const d = el.dataset;
  if (d.draftclose) { closeDraft(); return; }
  if (d.pmanual) { P.draft = { image: "", store: S.stores[0] || "", date: jstDay(), total: "", items: [{ name: "", price: "", qty: 1 }], reading: false, note: "" }; renderDraft(); return; }
  if (d.ditemadd) { draftRead(); P.draft.items.push({ name: "", price: "", qty: 1 }); renderDraft(); return; }
  if (d.ditemdel) { draftRead(); P.draft.items.splice(+d.ditemdel, 1); renderDraft(); return; }
  if (d.popen) { P.open = P.open === d.popen ? "" : d.popen; render(); return; }
  if (d.pdel) {
    if (!confirm("この価格の記録を消しますか？（Notion のゴミ箱から戻せます）")) return;
    api("DELETE", `/api/prices/${d.pdel}`).then(() => { P.prices = P.prices.filter((x) => x.id !== d.pdel); render(); }).catch((err) => toast(err.message));
  }
});
document.addEventListener("submit", (e) => { if (e.target.id === "draftform") { e.preventDefault(); saveDraft(e.target.querySelector("[type=submit]")); } });
document.addEventListener("change", (e) => { if (e.target.id === "rcptshot") { const f = e.target.files?.[0]; e.target.value = ""; if (f) startReceipt(f); } });
document.addEventListener("input", (e) => {
  if (e.target.id !== "psearch") return;
  P.q = e.target.value; const pos = e.target.selectionStart; render();
  const i = $("#psearch"); i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* 検索欄 */ }
});
