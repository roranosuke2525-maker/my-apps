  // ================= ニュース：DB_ニュース を「興味度の高い順」に読む =================
  // DB_ニュースは同じ出来事を代表1行にまとめ（他社は「他社」欄）、AIが興味度1〜5を付ける。
  // ★1〜★5で評価すると「読んだ」になり、翌朝の興味度の手本になる。「📚送る」にチェックして評価した記事は翌朝 REFERENCE になる
  async function loadNews() {
    if (S.mode === "demo") return;
    S.newsLoading = true;
    try {
      const r = await rows(DS.news, { filters: [{ type: "property", property: "日付", propertyType: "date", operator: "date_is_on_or_after", value: { type: "relative", value: "one_week_ago" } }], sort: [{ property: "日付", direction: "descending" }], limit: 100 });
      S.news = r.results.map(toNews); S.newsErr = null; S.newsAt = Date.now();
    } catch (err) { S.newsErr = errText(err); }
    S.newsLoading = false;
    if (S.tab === "news" && $("#page").hidden) render();
  }
  const yes = (v) => v === "__YES__" || v === true;
  function toNews(r) {
    return {
      id: idOf(r.url), url: r.url, title: text(r["見出し"]) || "（見出しなし）", link: text(r["userDefined:URL"]), date: r["date:日付:start"] ? String(r["date:日付:start"]).slice(0, 10) : "",
      src: r["新聞社"] || "", area: r["枠"] || "", state: r["状態"] || "未読", topic: text(r["話題"]), sum: text(r["一言要約"]), n: Number(r["社数"]) || 1, paid: yes(r["🔒有料"]),
      others: text(r["他社"]), interest: r["興味度"] == null || r["興味度"] === "" ? null : Number(r["興味度"]), rate: r["評価"] || "", send: yes(r["📚送る"]), themes: (list(r["テーマ"]) || []).length,
    };
  }
  const NEWS_AREAS = ["全国", "地元", "業界", "関心"];
  const NEWS_SORTS = [["interest", "興味度順"], ["n", "社数順"], ["new", "未読を先に"]];
  const isUnread = (x) => x.state === "未読" && !x.rate;
  const sentDone = (x) => x.state === "📚 送り済";
  const dots = (v) => (v == null ? "" : `<span class="ni" title="AIの予想する興味度 ${v}/5">${"●".repeat(Math.max(0, Math.min(5, Math.round(v))))}<i>${"●".repeat(5 - Math.max(0, Math.min(5, Math.round(v))))}</i></span>`);
  function renderNews(view) {
    if (!S.newsAt && !S.newsLoading && S.mode !== "demo" && S.mode !== "loading") loadNews();
    const all = S.news || []; const days = [...new Set(all.map((x) => x.date))].sort().reverse();
    if (!days.includes(S.newsDay)) S.newsDay = days[0] || "";
    const sort = S.newsSort || "interest";
    const inDay = all.filter((x) => x.date === S.newsDay);
    const cnt = (k) => inDay.filter((x) => (!k || x.area === k) && isUnread(x)).length;
    view.insertAdjacentHTML("beforeend", `<div class="chips newsdays">${days.slice(0, 7).map((d) => `<button type="button" class="chip" data-newsday="${d}" aria-pressed="${d === S.newsDay}">${d === TODAY() ? "今日" : `${md(d)}（${WD[dow(d)]}）`}<span class="n">${all.filter((x) => x.date === d && isUnread(x)).length}</span></button>`).join("")}</div>
      <div class="seg">${[["", "すべて"], ...NEWS_AREAS.filter((a) => a !== "関心" || inDay.some((x) => x.area === a)).map((a) => [a, a])].map(([k, n]) => `<button type="button" data-newsarea="${k}" aria-pressed="${(S.newsArea || "") === k}">${n}<span class="n">${cnt(k)}</span></button>`).join("")}</div>
      <div class="card panel"><div class="panel-head"><span class="ttl"><b>見出し</b><small>★で評価すると読んだに・📚は評価すると翌朝 資料へ</small></span></div>
        <div class="nbar">${NEWS_SORTS.map(([k, n]) => `<button type="button" class="qc" data-newssort="${k}" aria-pressed="${sort === k}">${n}</button>`).join("")}<button type="button" class="qc" data-newshide="1" aria-pressed="${!!S.newsHide}">読んだものを隠す</button></div>
        <div class="scroll" id="newsbox"></div></div>`);
    const box = $("#newsbox");
    if (S.newsErr && !all.length) { box.innerHTML = `<div class="empty">DB_ニュース を読めませんでした。\n${esc(S.newsErr)}${VIA === "api" ? "\nNotion のインテグレーションを DB_ニュース にも接続してください" : ""}</div>`; return; }
    if (!all.length) { box.innerHTML = `<div class="empty">${S.newsLoading || S.mode === "loading" ? "読みこみ中…" : "この1週間のニュースはありません"}</div>`; return; }
    // 古い形（同じ話題が別の行）も、話題ごとに1つにまとめて出す
    const groups = new Map();
    for (const x of inDay.filter((x) => !S.newsArea || x.area === S.newsArea)) { const k = x.topic ? `${x.area}:${x.topic}` : x.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    const score = (g) => Math.max(...g.map((x) => x.interest ?? 0));
    const many = (g) => Math.max(...g.map((x) => x.n), g.length);
    const by = { interest: (a, b) => score(b) - score(a) || many(b) - many(a), n: (a, b) => many(b) - many(a) || score(b) - score(a), new: (a, b) => (b.some(isUnread) - a.some(isUnread)) || score(b) - score(a) };
    const list = [...groups.values()].map((g) => g.sort((a, b) => (b.interest ?? 0) - (a.interest ?? 0) || (a.paid - b.paid) || b.n - a.n)).filter((g) => !S.newsHide || g.some(isUnread)).sort(by[sort]);
    if (!list.length) { box.innerHTML = `<div class="empty">全部読みました 📰</div>`; return; }
    let html = ""; let sec = "";
    for (const g of list) {
      if (sort === "interest") { const s = score(g) >= 4 ? "⭐ 興味度4以上" : "そのほか"; if (s !== sec) { sec = s; html += `<div class="sech"><span>${s}</span><small>${list.filter((x) => (score(x) >= 4) === (s !== "そのほか")).length}</small></div>`; } }
      html += newsCard(g);
    }
    box.innerHTML = html;
  }
  function newsCard(g) {
    const top = g[0]; const n = Math.max(...g.map((x) => x.n), g.length); const unread = g.some(isUnread);
    const others = [...new Set([...(top.others || "").split(/[、,・\s]+/).filter(Boolean), ...g.slice(1).map((x) => x.src)])].filter((s) => s && s !== top.src);
    const rateN = Number((top.rate || "").replace("★", "")) || 0;
    return `<article class="news${unread ? "" : " read"}" data-nid="${top.id}">
        <div class="nh">${dots(top.interest)}${top.area ? `<span class="na">${esc(top.area)}</span>` : ""}${n > 1 ? `<span class="nc" title="扱った社の数">${n}社</span>` : ""}${top.topic ? `<span class="nt">${esc(top.topic)}</span>` : ""}${top.themes ? `<span class="nt">🧭 関心テーマ</span>` : ""}${sentDone(top) ? `<span class="nsent">📚 資料にしました</span>` : ""}</div>
        ${top.link ? `<a class="ntitle" href="${esc(top.link)}" target="_blank" rel="noopener" data-newsread="${top.id}">${esc(top.title)}</a>` : `<button type="button" class="ntitle" data-newsopen="${top.id}">${esc(top.title)}</button>`}
        ${top.sum ? `<p class="nsum">${esc(top.sum)}</p>` : ""}
        <div class="nsrc"><span class="me">${esc(top.src || "記事")}${top.paid ? "🔒" : ""}</span>${g.slice(1).filter((x) => x.link).map((x) => `<a href="${esc(x.link)}" target="_blank" rel="noopener" data-newsread="${x.id}">${esc(x.src || "記事")}${x.paid ? "🔒" : ""}</a>`).join("")}${others.filter((s) => !g.some((x) => x.src === s)).map((s) => `<span class="ot">${esc(s)}</span>`).join("")}${others.length ? `<button type="button" class="nmore" data-newsopen="${top.id}">他社の記事 ›</button>` : ""}</div>
        <div class="nact"><span class="stars" role="group" aria-label="評価">${[1, 2, 3, 4, 5].map((k) => `<button type="button" class="st${k <= rateN ? " on" : ""}" data-newsrate="${top.id}:${k}" aria-label="★${k}" aria-pressed="${k === rateN}">★</button>`).join("")}</span>
          <button type="button" class="qc nsend${top.send ? " on" : ""}" data-newssend="${top.id}" ${sentDone(top) ? "disabled" : ""} aria-pressed="${top.send}">📚 ${top.send ? (rateN ? "翌朝 資料へ" : "評価すると資料へ") : "資料に送る"}</button>
          ${unread ? `<button type="button" class="qc" data-newsstate="${g.map((x) => x.id).join(",")}:読んだ">✓ 読んだ</button>` : !rateN ? `<button type="button" class="qc" data-newsstate="${g.map((x) => x.id).join(",")}:未読">↩ 未読</button>` : ""}
          <button type="button" class="qc" data-newsopen="${top.id}">詳しく</button></div>
      </article>`;
  }
  // 変更をその場に映してから Notion に書く。失敗したら戻す
  async function patchNews(items, local, props, msg) {
    if (!items.length) return;
    const before = items.map((x) => ({ ...x })); items.forEach((x) => Object.assign(x, local(x)));
    if (S.tab === "news" && $("#page").hidden) render();
    if (msg) toast(msg + (S.mode === "demo" ? "（見本）" : ""));
    if (S.mode === "demo") return;
    try { for (const x of items) await call("update", { page_id: x.id, command: "update_properties", properties: props(x), allow_async: false }, { read: false }); }
    catch (err) { items.forEach((x, i) => Object.assign(x, before[i])); render(); toast(`変えられませんでした：${errText(err)}`); }
  }
  const newsById = (id) => (S.news || []).find((x) => x.id === id);
  function setNews(ids, state, quiet = false) {
    const items = ids.map(newsById).filter((x) => x && x.state !== state && !(state === "読んだ" && x.state.startsWith("📚")));
    return patchNews(items, () => ({ state }), () => ({ "状態": state }), quiet ? "" : state === "読んだ" ? "読んだにしました" : "未読に戻しました");
  }
  // ★で評価：評価を入れて読んだに（同じ★をもう一度押すと評価を外す）
  function rateNews(id, k) {
    const x = newsById(id); if (!x) return;
    const v = x.rate === `★${k}` ? "" : `★${k}`;
    const state = v ? (x.state.startsWith("📚") ? x.state : "読んだ") : x.state;
    patchNews([x], () => ({ rate: v, state }), () => ({ "評価": v || null, "状態": state }), v ? `${v} を付けました${x.send ? "（翌朝 資料になります）" : ""}` : "評価を外しました");
  }
  // 📚送る：チェックを付け外し。評価が済んでいれば翌朝 REFERENCE に
  function sendNews(id) {
    const x = newsById(id); if (!x || sentDone(x)) return;
    const on = !x.send;
    patchNews([x], () => ({ send: on }), () => ({ "📚送る": on ? "__YES__" : "__NO__" }), on ? (x.rate ? "翌朝、資料（REFERENCE）になります" : "★で評価すると、翌朝 資料になります") : "📚送るを外しました");
  }
  function openNews(id) {
    const x = newsById(id); if (!x) return;
    setNews([x.id], "読んだ", true);
    openPage({ kind: "news", id: x.id, url: x.url, title: x.title, titleProp: "見出し", fields: [["日付", x.date ? md(x.date) : ""], ["新聞社", x.src + (x.paid ? "（🔒有料）" : "")], ["枠", x.area], ["興味度（AIの予想）", x.interest == null ? "" : `${x.interest} / 5`], ["評価", x.rate], ["話題", x.topic], ["社数", x.n > 1 ? `${x.n}社` : ""], ["他社", x.others], ["一言要約", x.sum], ["📚送る", x.send ? "✓" : ""], ["状態", x.state], ["URL", x.link]], crumb: "DB_ニュース" });
  }
  function demoNews() {
    const d = TODAY();
    S.news = [["日銀、政策金利を据え置き", "日経", "全国", "日銀会合", 3, "物価見通しは上方修正。次回の利上げ時期に注目", 3, "時事、東京"], ["新しいLEDダウンライトを各社が発表", "メーカー発表", "関心", "照明 新商品", 1, "調光・調色が標準に。住宅向けの薄型が増える", 5, ""], ["県内の最低賃金が改定", "上毛", "地元", "最低賃金", 1, "来月から適用。時給は過去最大の上げ幅", 2, ""], ["高崎市内で大型物流施設の工事が始まる", "建設通信", "業界", "高崎 物流施設", 2, "延べ床3万㎡規模。地元の協力会社にも発注", 4, "上毛"], ["新しい送電網の整備計画", "電気新聞", "業界", "送電網", 1, "", 3, ""], ["生成AIの社内利用ガイドライン", "日経クロステック", "業界", "生成AI", 1, "情報漏えい対策と利用ログの扱いが焦点", 4, ""]]
      .map(([title, src, area, topic, n, sum, interest, others], i) => ({ id: `${"4".repeat(31)}${i}`, url: "https://www.notion.so/", title: `（例）${title}`, link: "https://example.com", date: i < 5 ? d : addDays(d, -1), src, area, state: i === 4 ? "読んだ" : "未読", topic, sum, n, paid: i === 0, others, interest, rate: i === 4 ? "★3" : "", send: false, themes: area === "関心" ? 1 : 0 }));
    S.newsAt = Date.now();
  }
