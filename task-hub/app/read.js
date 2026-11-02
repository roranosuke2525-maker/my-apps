  // ================= 読む：書庫（📚 REFERENCE）のうち「📖 すぐ読む」に印を付けたものを集める =================
  const READ_PROP = "📖 すぐ読む";
  const isRead = (t) => t?.read === "__YES__";
  // 印を付ける・外す（読むリストの出し入れもここで）
  async function setRead(t, on, msg) {
    const ok = await setProps(t, { [READ_PROP]: on ? "__YES__" : "__NO__" }, msg || (on ? `「${short(t.name)}」を「すぐ読む」に入れました` : `「${short(t.name)}」を読んだので外しました`));
    syncReadList(t);
    if (PG?.task === t) $("#pprops").innerHTML = propsHtml();
    return ok;
  }
  function syncReadList(t) {
    const i = S.readList.indexOf(t);
    if (isRead(t) && i < 0) S.readList.unshift(t);
    if (!isRead(t) && i >= 0) S.readList.splice(i, 1);
    if (S.tab === "read") render();
  }
  function renderRead(view) {
    const all = S.readList.filter(isRead);
    const tags = [...new Set(all.map((t) => t.tag).filter(Boolean))];
    if (S.readTag && !tags.includes(S.readTag)) S.readTag = "";
    const items = all.filter((t) => !S.readTag || t.tag === S.readTag);
    view.insertAdjacentHTML("beforeend", `<div class="readhead"><div><b>すぐ読む</b><span class="mute">${all.length}件・書庫から選んだもの</span></div><button type="button" class="btn pri" data-readpick="1">＋ 書庫から選ぶ</button></div>
      ${tags.length > 1 ? `<div class="chips"><button type="button" class="chip" data-readtag="" aria-pressed="${!S.readTag}">すべて<span class="n">${all.length}</span></button>${tags.map((g) => `<button type="button" class="chip" data-readtag="${esc(g)}" aria-pressed="${S.readTag === g}">${esc(g)}<span class="n">${all.filter((t) => t.tag === g).length}</span></button>`).join("")}</div>` : ""}
      <div class="card panel"><div class="scroll" id="readbox"></div></div>`);
    const box = $("#readbox");
    if (!items.length) { box.innerHTML = `<div class="empty">${S.extraErr.read ? esc(S.extraErr.read) : "すぐ読みたいものはありません。\n「＋ 書庫から選ぶ」か、資料のページの「📖 すぐ読む」で入れられます"}</div>`; return; }
    box.innerHTML = items.map((t) => {
      const sm = S.bodies[t.id];
      const pv = sm?.conc ? `⭐ ${esc(short(sm.conc, 70))}` : t.next ? esc(t.next) : "";
      return `<article class="rcard"><button type="button" class="rmain" data-open="${t.id}"><span class="rt">${esc(t.name)}</span><span class="rs">${t.tag ? `<i>${esc(t.tag)}</i>` : ""}${t.ai === "🔍✅" ? "<i>🔍 調査結果</i>" : ""}<span class="mute">書庫 ${ageOf(t)}日</span></span>${pv ? `<span class="rp">${pv}</span>` : ""}</button>
        <div class="ract">${t.link ? `<a class="qc" href="${esc(t.link)}" target="_blank" rel="noopener">🔗 元のページ</a>` : ""}<button type="button" class="qc ok" data-readdone="${t.id}">✓ 読んだ（外す）</button></div></article>`;
    }).join("");
    prefetchRead(items);
  }
  // 結論（⭐）を先読みして一覧に出す
  let readFetching = false;
  async function prefetchRead(items) {
    if (readFetching || S.mode === "loading" || S.mode === "error") return;
    const todo = items.filter((t) => !S.bodies[t.id] || S.bodies[t.id].edited !== t.edited).slice(0, 12); if (!todo.length) return;
    readFetching = true;
    const worker = async () => { for (let t; (t = todo.shift());) { try { S.bodies[t.id] = summarize(t, await fetchBody(t.id)); } catch { /* 次回 */ } } };
    await Promise.all([worker(), worker(), worker()]); readFetching = false; store.set("sums", S.bodies);
    if (S.tab === "read" && $("#page").hidden) render();
  }
  // 書庫（読み込み済みの資料）から選ぶ
  function openReadPick(q = "") {
    const cands = S.refs.filter((t) => !isRead(t) && (!q || norm(`${t.name} ${t.tag || ""}`).includes(norm(q))));
    modal(`<h3>書庫から選ぶ</h3><div class="form" style="padding-bottom:0"><input id="readq" type="search" placeholder="名前・分類タグで絞る" value="${esc(q)}"></div>
      <div class="list" style="max-height:58vh;overflow:auto;padding:6px 0" id="readpicks">${cands.map((t) => `<button type="button" class="row" data-readadd="${t.id}" style="min-height:52px"><span class="dot" style="--c:var(--s-ref)"></span><span class="main"><span class="nm">${esc(t.name)}</span><span class="sub">${esc(t.tag || "")}・書庫 ${ageOf(t)}日</span></span><span class="meta">＋</span></button>`).join("") || `<div class="empty">${S.refs.length ? "当てはまる資料はありません" : "書庫（📚 REFERENCE）が読み込まれていません"}</div>`}</div>
      <div class="form"><p class="mute" style="font-size:11.5px;margin:0">最近の書庫 ${S.refs.length}件から選べます。古いものは虫めがねで探して、資料のページの「📖 すぐ読む」で入れられます。</p><button type="button" class="btn" data-mclose="1">閉じる</button></div>`);
    const i = $("#readq"); i.oninput = () => { const pos = i.selectionStart; openReadPick(i.value); const j = $("#readq"); j.focus(); j.setSelectionRange(pos, pos); };
  }
