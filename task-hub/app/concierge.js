  // ================= コンシェルジュ：今の状態を見て、タスクが進むように提案する =================
  const avatar = () => AVATARS.find((a) => a.key === store.get("avatar")) || AVATARS[0];
  const W8 = { S: 1, M: 2, L: 4, XL: 8 };
  const load8 = (list) => list.reduce((n, t) => n + (W8[t.weight] || 2), 0);
  // 提案の一覧（大事な順）。acts は押せる操作、items は1件ずつ動かせるタスク
  function advise() {
    const d = TODAY(); const out = [];
    const today = inStage("today"); const late = lateOf(); const next = inStage("next"); const inbox = inStage("inbox");
    const wait = inStage("wait"); const some = inStage("some");
    if (late.length) out.push({ pri: 100, icon: "⏰", title: `遅れが ${late.length}件あります`, body: "日付を過ぎたものは、今日やるか、日を決め直すと流れが戻ります。", acts: [["late:today", "全部 今日にする"], ["late:tomorrow", "全部 明日にずらす"]], items: late.slice(0, 4), itemActs: [["d:today", "今日"], ["d:sat", "土曜"], ["s:some", "いつか"]] });
    const w = load8(today);
    if (today.length >= 8 || w > 12) {
      const heavy = today.filter((t) => ["L", "XL"].includes(t.weight) || !t.weight).slice(0, 4);
      out.push({ pri: 90, icon: "🧺", title: `今日が詰まっています（${today.length}件・重さ ${w}）`, body: "1日に終わるのは重さ12くらいまで。重いものを明日以降へ回して、終わる量に絞りましょう。", items: heavy.length ? heavy : today.slice(0, 4), itemActs: [["d:tomorrow", "明日へ"], ["d:mon", "来週月"], ["s:some", "いつか"]] });
    }
    if (!today.length && next.length) {
      const pick = next.slice().sort((a, b) => (W8[a.weight] || 2) - (W8[b.weight] || 2) || ageOf(b) - ageOf(a)).slice(0, 3);
      out.push({ pri: 85, icon: "🎯", title: "今日やることが決まっていません", body: "次にやるから軽いもの・古いものを3つ選びました。今日に入れてみませんか。", items: pick, itemActs: [["d:today", "今日やる"], ["d:tomorrow", "明日"]] });
    }
    const mine = myTurn();
    if (mine.length) out.push({ pri: 80, icon: "💬", title: `AIからの返事が ${mine.length}件 待っています`, body: "回答（💭）や判定（🔍✅）を返すと、次の定時処理でAIが続きを進めます。", acts: [["tab:ai", "AIの番を見る"]] });
    const oldIn = inbox.filter((t) => ageOf(t) >= 3);
    if (inbox.length >= 10 || oldIn.length) out.push({ pri: 70, icon: "📥", title: `収集箱に ${inbox.length}件${oldIn.length ? `（3日以上 ${oldIn.length}件）` : ""}`, body: "1件ずつ「やる・いつか・AI・資料」に振り分けると頭が軽くなります。5分だけ仕分けしましょう。", acts: [["triage:inbox", "仕分けを始める"]] });
    const noStep = next.filter((t) => !t.next);
    if (noStep.length >= 3) out.push({ pri: 60, icon: "👣", title: `次の一歩が空のタスクが ${noStep.length}件`, body: "「最初に何をするか」が書いてあると手が動きます。開いて一歩を書くか、AIに分解を頼みましょう。", items: noStep.slice(0, 3), itemActs: [["open", "開く"], ["a:💬", "AIと分解"]] });
    const stale = next.filter((t) => ageOf(t) >= 14);
    if (stale.length) out.push({ pri: 55, icon: "🕸", title: `2週間動いていない「次にやる」が ${stale.length}件`, body: "やらないなら いつか へ、迷っているなら AI に調べてもらうと進みます。", items: stale.slice(0, 3), itemActs: [["d:today", "今日"], ["s:some", "いつか"], ["a:🔍", "AIに調べて"]] });
    const longWait = wait.filter((t) => ageOf(t) >= 7);
    if (longWait.length) out.push({ pri: 50, icon: "📮", title: `1週間以上の待ちが ${longWait.length}件`, body: "相手に確かめる日を決めておくと抜けません。", items: longWait.slice(0, 3), itemActs: [["d:tomorrow", "明日確認"], ["s:next", "自分で進める"]] });
    const soon = typeof stockSoon === "function" ? stockSoon() : [];
    if (soon.length) out.push({ pri: 45, icon: "🛒", title: `もうすぐ切れる日用品が ${soon.length}点`, body: soon.slice(0, 3).map((x) => `${x.name}（${leftTx(x)}）`).join("・"), acts: [["shop:stock", "在庫を見る"]] });
    const buyToday = shopLists().filter((t) => t.date && t.date <= d);
    if (buyToday.length) out.push({ pri: 44, icon: "🧾", title: `今日の買い物リストが ${buyToday.length}件`, body: buyToday.map((t) => t.name).join("・"), acts: [["shop:list", "買い物リストを開く"]] });
    if (some.length >= 20 && [5, 6, 0].includes(dow(d))) out.push({ pri: 30, icon: "🕰", title: `週末の見直し：いつか ${some.length}件`, body: "今週やりたくなったものを次にやるへ戻しましょう。", acts: [["triage:some", "いつかを見直す"]] });
    const dg = S.diag.at(-1);
    if (dg?.next) out.push({ pri: 20, icon: "🩺", title: "前回の診断の「次の一手」", body: dg.next, acts: [["tab:log", "診断を見る"]] });
    if (!out.some((x) => x.pri >= 50)) out.push({ pri: 10, icon: "✨", title: S.doneToday.length ? `今日は ${S.doneToday.length}件 終わりました。いい流れです` : "流れは整っています", body: today.length ? `今日の残り ${today.length}件。上から1つずつどうぞ。` : "余裕があれば、次にやるから1つ今日に入れてみましょう。", acts: today.length ? [["stage:today", "今日の一覧"]] : [["stage:next", "次にやるを見る"]] });
    return out.sort((a, b) => b.pri - a.pri);
  }
  const adviceTop = () => (S.mode === "loading" && !S.tasks.length ? null : advise()[0]);
  function greet() {
    const h = new Date(Date.now() + 9 * 3600e3).getUTCHours(); const a = avatar();
    const hi = h < 5 ? "夜ふかしですね" : h < 11 ? "おはようございます" : h < 17 ? "こんにちは" : "おつかれさまです";
    const today = inStage("today").length;
    return `${hi}。${a.name}です。今日の残りは ${today}件、終わったのは ${S.doneToday.length}件。${{ astra: "段取りを整えましょう。", lumina: "次の一手を一緒に選びましょう。", sunny: "さあ、ひとつ片づけちゃいましょう！", nox: "優先順位から決めます。" }[a.key]}`;
  }
  function openConcierge(pickAvatar = false) {
    const a = avatar(); const list = advise();
    const itemRow = (t, acts) => `<div class="crow" data-qt="${t.id}"><button type="button" class="cname" data-mopen="${t.id}">${esc(short(t.name, 26))}<small>${esc(metaOf(t).tx)}${t.weight ? `・${t.weight}` : ""}</small></button><span class="cacts">${acts.map(([k, n]) => k === "open" ? `<button type="button" class="qc" data-mopen="${t.id}">${n}</button>` : `<button type="button" class="qc" data-qk="${k}">${n}</button>`).join("")}</span></div>`;
    modal(`<div class="concierge"><div class="chero"><img src="${a.img}" alt="${esc(a.name)}"><div><div class="cn">${esc(a.name)}<small>${esc(a.role)}</small></div><p>${esc(greet())}</p><button type="button" class="mute cswap" data-avpick="1">姿を変える</button></div></div>
      ${pickAvatar ? `<div class="avgrid">${AVATARS.map((x) => `<button type="button" data-avatar="${x.key}" aria-pressed="${x.key === a.key}"><img src="${x.img}" alt=""><b>${esc(x.name)}</b><small>${esc(x.style)}</small></button>`).join("")}</div>` : ""}
      <div class="clist">${list.map((x) => `<section class="csug"><h4><span>${x.icon}</span>${esc(x.title)}</h4><p>${esc(x.body)}</p>${(x.items || []).map((t) => itemRow(t, x.itemActs)).join("")}${x.acts ? `<div class="sfoot">${x.acts.map(([k, n], i) => `<button type="button" class="btn${i ? "" : " pri"}" data-cact="${k}">${n}</button>`).join("")}</div>` : ""}</section>`).join("")}</div>
      <div class="form" style="padding-top:0"><button type="button" class="btn" data-mclose="1">閉じる</button></div></div>`);
  }
  async function conciergeAct(k) {
    const [kind, v] = k.split(":");
    if (kind === "late") { const late = lateOf(); closeModal(); const d = v === "today" ? TODAY() : addDays(TODAY(), 1); for (const t of late) await setProps(t, dateProps(d), `遅れ ${late.length}件を${v === "today" ? "今日" : "明日"}にしました`, { undo: false, quiet: t !== late[0] }); return; }
    closeModal();
    if (kind === "tab") { S.tab = v; render(); return; }
    if (kind === "stage") { S.tab = "flow"; S.stage = v; render(); return; }
    if (kind === "triage") { S.tab = "triage"; S.pileKey = v === "some" ? "some" : "inbox"; render(); return; }
    if (kind === "shop") { S.tab = "shop"; S.shopSeg = v; render(); }
  }
  function renderConciergeFab() {
    const b = $("#cfab"); if (!b) return;
    const n = S.mode === "loading" ? 0 : advise().filter((x) => x.pri >= 50).length;
    b.innerHTML = `<img src="${avatar().img}" alt="コンシェルジュ">${n ? `<span class="badge">${n}</span>` : ""}`;
    b.hidden = S.tab === "flow";
  }
