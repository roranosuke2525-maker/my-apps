  // ================= ニュース：DB_ニュース を話題ごとに読む =================
  // 同じ話題は1つにまとめ、扱った社の多い順。見出しを押すと記事が開く。読んだ・📚送る（次の朝 REFERENCE になる）はその場で
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
  function toNews(r) {
    return {
      id: idOf(r.url), url: r.url, title: text(r["見出し"]) || "（見出しなし）", link: text(r["userDefined:URL"]), date: r["date:日付:start"] ? String(r["date:日付:start"]).slice(0, 10) : "",
      src: r["新聞社"] || "", area: r["枠"] || "", state: r["状態"] || "未読", topic: text(r["話題"]), sum: text(r["一言要約"]), n: Number(r["社数"]) || 1, paid: r["🔒有料"] === "__YES__" || r["🔒有料"] === true,
    };
  }
  function renderNews(view) {
    if (!S.newsAt && !S.newsLoading && S.mode !== "demo" && S.mode !== "loading") loadNews();
    const all = S.news || []; const days = [...new Set(all.map((x) => x.date))].sort().reverse();
    if (!days.includes(S.newsDay)) S.newsDay = days[0] || "";
    const areas = ["全国", "地元", "業界"];
    const inDay = all.filter((x) => x.date === S.newsDay && (!S.newsArea || x.area === S.newsArea));
    const unread = (x) => x.state === "未読";
    view.insertAdjacentHTML("beforeend", `<div class="chips newsdays">${days.slice(0, 7).map((d) => `<button type="button" class="chip" data-newsday="${d}" aria-pressed="${d === S.newsDay}">${d === TODAY() ? "今日" : `${md(d)}（${WD[dow(d)]}）`}<span class="n">${all.filter((x) => x.date === d && unread(x)).length}</span></button>`).join("")}</div>
      <div class="seg">${[["", "すべて"], ...areas.map((a) => [a, a])].map(([k, n]) => `<button type="button" data-newsarea="${k}" aria-pressed="${(S.newsArea || "") === k}">${n}<span class="n">${all.filter((x) => x.date === S.newsDay && (!k || x.area === k) && unread(x)).length}</span></button>`).join("")}</div>
      <div class="card panel"><div class="panel-head"><span class="ttl"><b>見出し</b><small>同じ話題は1つに・社数の多い順</small></span><div class="seg"><button type="button" data-newshide="1" aria-pressed="${!!S.newsHide}">読んだものを隠す</button></div></div><div class="scroll" id="newsbox"></div></div>`);
    const box = $("#newsbox");
    if (S.newsErr && !all.length) { box.innerHTML = `<div class="empty">DB_ニュース を読めませんでした。\n${esc(S.newsErr)}${VIA === "api" ? "\nNotion のインテグレーションを DB_ニュース にも接続してください" : ""}</div>`; return; }
    if (!all.length) { box.innerHTML = `<div class="empty">${S.newsLoading || S.mode === "loading" ? "読みこみ中…" : "この1週間のニュースはありません"}</div>`; return; }
    // 話題ごとにまとめる（話題が空なら1件で1つ）
    const groups = new Map();
    for (const x of inDay) { const k = x.topic || x.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    const list = [...groups.values()].map((g) => g.sort((a, b) => (a.paid - b.paid) || b.n - a.n)).sort((a, b) => Math.max(...b.map((x) => x.n)) - Math.max(...a.map((x) => x.n)) || b.length - a.length)
      .filter((g) => !S.newsHide || g.some(unread));
    if (!list.length) { box.innerHTML = `<div class="empty">全部読みました 📰</div>`; return; }
    box.innerHTML = list.map((g) => {
      const top = g[0]; const n = Math.max(...g.map((x) => x.n), g.length); const isNew = g.some(unread); const sent = g.some((x) => x.state.startsWith("📚"));
      return `<article class="news${isNew ? "" : " read"}" data-nid="${top.id}">
        <div class="nh">${n > 1 ? `<span class="nc" title="扱った社の数">${n}社</span>` : ""}${top.area ? `<span class="na">${esc(top.area)}</span>` : ""}${top.topic ? `<span class="nt">${esc(top.topic)}</span>` : ""}</div>
        ${top.link ? `<a class="ntitle" href="${esc(top.link)}" target="_blank" rel="noopener" data-newsread="${top.id}">${esc(top.title)}</a>` : `<button type="button" class="ntitle" data-newsopen="${top.id}">${esc(top.title)}</button>`}
        ${top.sum ? `<p class="nsum">${esc(top.sum)}</p>` : ""}
        <div class="nsrc">${g.map((x) => x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener" data-newsread="${x.id}" class="${x.state === "未読" ? "" : "r"}">${esc(x.src || "記事")}${x.paid ? "🔒" : ""}</a>` : `<span>${esc(x.src)}</span>`).join("")}</div>
        <div class="nact"><button type="button" class="qc" data-newsstate="${g.map((x) => x.id).join(",")}:${isNew ? "読んだ" : "未読"}">${isNew ? "✓ 読んだ" : "↩ 未読に戻す"}</button><button type="button" class="qc${sent ? " on" : ""}" data-newsstate="${top.id}:📚 送る" ${sent ? "disabled" : ""}>${sent ? "📚 資料に送る予定" : "📚 資料に送る"}</button><button type="button" class="qc" data-newsopen="${top.id}">メモ</button></div>
      </article>`;
    }).join("");
  }
  async function setNews(ids, state, quiet = false) {
    const items = ids.map((id) => (S.news || []).find((x) => x.id === id)).filter((x) => x && x.state !== state && !(state === "読んだ" && x.state.startsWith("📚")));
    if (!items.length) return;
    const before = items.map((x) => x.state); items.forEach((x) => { x.state = state; });
    if (S.tab === "news" && $("#page").hidden) render();
    if (!quiet) toast(state === "📚 送る" ? "次の朝、資料（REFERENCE）になります" : state === "読んだ" ? "読んだにしました" : "未読に戻しました");
    if (S.mode === "demo") return;
    try { for (const x of items) await call("update", { page_id: x.id, command: "update_properties", properties: { "状態": state }, allow_async: false }, { read: false }); }
    catch (err) { items.forEach((x, i) => { x.state = before[i]; }); render(); toast(`変えられませんでした：${errText(err)}`); }
  }
  function openNews(id) {
    const x = (S.news || []).find((n) => n.id === id); if (!x) return;
    openPage({ kind: "news", id: x.id, url: x.url, title: x.title, titleProp: "見出し", fields: [["日付", x.date ? md(x.date) : ""], ["新聞社", x.src + (x.paid ? "（🔒有料）" : "")], ["枠", x.area], ["話題", x.topic], ["社数", x.n > 1 ? `${x.n}社` : ""], ["一言要約", x.sum], ["状態", x.state], ["URL", x.link]], crumb: "DB_ニュース" });
  }
  function demoNews() {
    const d = TODAY();
    S.news = [["日銀、政策金利を据え置き", "日経", "全国", "日銀会合", 4, "物価見通しは上方修正。次回の利上げ時期に注目"], ["日銀 金利据え置き決定", "時事", "全国", "日銀会合", 4, ""], ["県内の最低賃金が改定", "上毛", "地元", "最低賃金", 1, "来月から適用。時給は過去最大の上げ幅"], ["生成AIの社内利用ガイドライン、大手で整備進む", "日経クロステック", "業界", "生成AI 社内利用", 2, "情報漏えい対策と利用ログの扱いが焦点"], ["新しい送電網の整備計画", "電気新聞", "業界", "送電網", 1, ""]]
      .map(([title, src, area, topic, n, sum], i) => ({ id: `${"4".repeat(31)}${i}`, url: "https://www.notion.so/", title: `（例）${title}`, link: "https://example.com", date: i < 4 ? d : addDays(d, -1), src, area, state: i === 4 ? "読んだ" : "未読", topic, sum, n, paid: i === 0 }));
    S.newsAt = Date.now();
  }
