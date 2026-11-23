  // ================= 今日を選ぶ：次にやるを一覧で見て、まとめて選んで1回で今日に入れる =================
  const PK = { sel: new Set(), f: "rec", keep: false, armed: null };
  // 今日やるの目安（1日に入れる件数）。🎯 ハイライト＋締切の1件＝2件がふつう。この端末に覚える
  const dayCap = () => Math.min(5, Math.max(1, Number(store.get("dayCap")) || 2));
  const W_ORDER = { S: 0, M: 1, L: 2, XL: 3 };
  const wPts = (arr) => arr.reduce((s, t) => s + ({ S: 1, M: 2, L: 3, XL: 5 }[t.weight] || 1), 0);
  function pickItems() {
    let a = stageItems("next").slice(); const f = PK.f;
    if (f === "light") a = a.filter((t) => !t.weight || t.weight === "S" || t.weight === "M");
    else if (f.startsWith("w:")) a = a.filter((t) => (t.waku || "枠なし") === f.slice(2));
    else if (f.startsWith("t:")) a = a.filter((t) => (t.tag || "分類なし") === f.slice(2));
    if (f === "old") a.sort((x, y) => ageOf(y) - ageOf(x));
    else a.sort((x, y) => (W_ORDER[x.weight] ?? 1) - (W_ORDER[y.weight] ?? 1) || ageOf(y) - ageOf(x));
    return a;
  }
  function openPickDay() {
    PK.sel = new Set(); PK.f = "rec"; PK.armed = null;
    modal(`<div class="pk" id="pk"></div>`); $("#modal .sheet").classList.add("tall");
    drawPick();
  }
  function drawPick() {
    const box = $("#pk"); if (!box) return;
    const all = stageItems("next"); const today = stageItems("today");
    const tags = [...new Set(all.map((t) => t.tag || "分類なし"))]; const wakus = [...new Set(all.map((t) => t.waku || "枠なし"))];
    const fs = [["rec", "おすすめ順"], ["old", "古い順"], ["light", "軽いもの"], ...wakus.map((w) => [`w:${w}`, w]), ...tags.map((g) => [`t:${g}`, g])];
    const items = pickItems(); const selT = [...PK.sel].map((id) => known.get(id)).filter(Boolean);
    const st = box.querySelector(".pklist")?.scrollTop || 0; const fx = box.querySelector(".pkf")?.scrollLeft || 0;
    const cap = dayCap(); const n = today.length + selT.length; const hl = today.find((t) => t.hl === TODAY());
    box.innerHTML = `<div class="pkhead"><h3>今日やるを選ぼう</h3><small>重さ ${wPts(today) + wPts(selT)}</small></div>
      <div class="capbar${n > cap ? " over" : ""}"><span class="slot${hl ? " on" : ""}">🎯 ${hl ? esc(short(hl.name, 10)) : "ハイライト"}</span><span class="slot${n >= 2 ? " on" : ""}">⏰ 締切のある1件</span><button type="button" class="capn" data-pkcap="1" aria-label="目安の件数を変える">今日 ${n} / ${cap}</button></div>
      <p class="capmsg">${n > cap ? `目安の${cap}件をこえてるよ。多い日は残りが明日に流れがち。それでもOKなら入れてね` : n === cap ? "これで十分！あとは終わったら足そう" : `あと${cap - n}件まで入れられるよ`}</p>
      <div class="pkf">${fs.map(([k, n]) => `<button type="button" class="qc" data-pkf="${esc(k)}" aria-pressed="${PK.f === k}">${esc(n)}</button>`).join("")}</div>
      <div class="pklist">${items.map((t) => { const on = PK.sel.has(t.id); return `<button type="button" class="pkrow${on ? " sel" : ""}" data-pksel="${t.id}"><span class="bx">${on ? "✓" : ""}</span><span class="tx"><b>${esc(t.name)}</b><small>${esc([t.waku, t.tag, t.next].filter(Boolean).join("・"))}</small></span><span class="w">${esc(t.weight || "")}<br>${ageOf(t)}日</span></button>`; }).join("") || `<div class="empty">ここには何もないよ</div>`}</div>
      <div class="pkfoot"><button type="button" class="btn" data-mclose="1">閉じる</button><button type="button" class="btn pri" data-pkok="1" ${selT.length ? "" : "disabled"}>${selT.length ? `今日に入れる（${selT.length}件）` : "タップして選んでね"}</button></div>`;
    const f2 = box.querySelector(".pkf"); if (f2) f2.scrollLeft = fx;
    if (PK.keep) { const l2 = box.querySelector(".pklist"); if (l2) l2.scrollTop = st; }
    PK.keep = false;
  }
  function pickToggle(id) {
    if (PK.sel.has(id)) PK.sel.delete(id);
    else {
      const n = stageItems("today").length + PK.sel.size + 1;
      // 目安をこえる1件目は、もう一度押したら入る（禁止はしない）
      if (n > dayCap() && PK.armed !== id) { PK.armed = id; buzz(20); toast(`目安は${dayCap()}件だよ。5件入れた日は1〜2件しか終わってなかった。それでも入れるならもう一回押してね`); return; }
      PK.armed = null; PK.sel.add(id);
    }
    buzz(); PK.keep = true; drawPick();
  }
  function cycleCap() { const c = dayCap() % 5 + 1; store.set("dayCap", c); toast(`今日やるの目安を${c}件にしたよ`); PK.keep = true; drawPick(); }
  async function pickCommit() {
    const list = [...PK.sel].map((id) => known.get(id)).filter(Boolean); if (!list.length) return;
    closeModal(); const props = dateProps(TODAY());
    const befores = list.map((t) => [t, propsBefore(t, props)]);
    await Promise.all(list.map((t) => setProps(t, props, "", { quiet: true })));
    toast(`${list.length}件を今日に入れたよ。1つずついこう！${S.mode === "demo" ? "（見本）" : ""}`, () => befores.forEach(([t, b]) => setProps(t, b, "", { quiet: true, undo: false })));
  }
