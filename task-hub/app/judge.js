  // ================= 🔍✅ 古い順に10件だけ：AIの調べ物の判定待ちを、作った日の古い順に1枚ずつ決める =================
  // 「次にやる・いつか・資料」の3つで決めて次の1枚へ。「あとで」で飛ばせる。10件で区切って終わり
  const JG = { ids: [], i: 0, decided: 0, skipped: 0 };
  const JG_MAX = 10;
  const madeDays = (t) => (t.created ? Math.max(0, diffDays(String(t.created).slice(0, 10), TODAY())) : ageOf(t));
  const judgeItems = () => S.tasks.filter((t) => t.status === ST.ai && t.ai === "🔍✅" && t.tag !== "WORK").sort((a, b) => (a.created || a.edited || "").localeCompare(b.created || b.edited || ""));
  const judgeOld = () => judgeItems().filter((t) => madeDays(t) >= 30);
  function openJudge() {
    const list = judgeItems().slice(0, JG_MAX);
    if (!list.length) { toast("判定待ちの🔍✅はないよ。すっきり！"); return; }
    Object.assign(JG, { ids: list.map((t) => t.id), i: 0, decided: 0, skipped: 0 });
    modal(`<div class="jg" id="jg"></div>`); $("#modal .sheet").classList.add("tall"); drawJudge();
  }
  async function drawJudge() {
    const box = $("#jg"); if (!box) return;
    const t = known.get(JG.ids[JG.i]);
    if (!t) { finishJudge(); return; }
    const sm = summaryOf(t);
    box.innerHTML = `<div class="pkhead"><h3>🔍✅ 古い順に10件だけ</h3><small class="jgn">${JG.i + 1} / ${JG.ids.length}</small></div>
      <div class="jgcard"><small class="${madeDays(t) >= 30 ? "old" : "mute"}">作ってから ${madeDays(t)}日${t.tag ? `・${esc(t.tag)}` : ""}</small><b>${esc(t.name)}</b>
        <p id="jgconc">${sm ? (sm.conc ? `⭐ ${esc(sm.conc)}` : "結論の要約が見つからなかった。開いて確かめてね") : "結論を読みこみ中…"}</p>
        <button type="button" class="qc" data-jgopen="${t.id}">全文を開く ›</button></div>
      <div class="jgacts"><button type="button" class="btn pri" data-jg="next">⏭ 次にやる</button><button type="button" class="btn" data-jg="some">🕰 いつか</button><button type="button" class="btn" data-jg="ref">📚 資料</button></div>
      <div class="pkfoot"><button type="button" class="btn" data-jg="skip">あとで（飛ばす）</button><button type="button" class="btn" data-jg="end">ここでおわる</button></div>`;
    if (!sm) {
      try { const raw = await fetchBody(t.id); S.bodies[t.id] = summarize(t, raw); store.set("sums", S.bodies); } catch { /* 開いて確かめる */ }
      const p = $("#jgconc"); const s2 = summaryOf(t);
      if (p && JG.ids[JG.i] === t.id) p.innerHTML = s2?.conc ? `⭐ ${esc(s2.conc)}` : "結論の要約が見つからなかった。開いて確かめてね";
    }
  }
  function judgeAct(k) {
    const t = known.get(JG.ids[JG.i]);
    if (k === "end") { finishJudge(); return; }
    if (t && k !== "skip") { move(t, k); JG.decided++; buzz(); } else JG.skipped++;
    JG.i++; if (JG.i >= JG.ids.length) finishJudge(); else drawJudge();
  }
  function finishJudge() {
    closeModal(); const n = JG.decided; const rest = judgeItems().length;
    toast(n ? `${n}件決めたね、おつかれさま！のこり ${rest}件${rest ? "はまた今度" : "。ぜんぶ片づいた 🎉"}` : `今日はここまででOK。のこり ${rest}件`);
  }
