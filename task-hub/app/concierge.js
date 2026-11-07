  // ================= 提案：今の状態を見て、タスクが進むように次の一手を示す =================
  const W8 = { S: 1, M: 2, L: 4, XL: 8 };
  const load8 = (list) => list.reduce((n, t) => n + (W8[t.weight] || 2), 0);
  // 提案の一覧（大事な順）。acts は押せる操作、items は1件ずつ動かせるタスク
  function advise() {
    const d = TODAY(); const out = [];
    const today = inStage("today"); const late = lateOf(); const next = inStage("next"); const inbox = inStage("inbox");
    const wait = inStage("wait"); const some = inStage("some");
    if (S.sugs.length) out.push({ pri: 95, icon: "💡", title: `AIからの提案が ${S.sugs.length}件`, body: S.sugs.slice(0, 3).map((s) => s.name).join("・"), sug: true });
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
    // 節約：区分なしの買い物・予算超え・封印の解除日
    if (typeof unsorted === "function") {
      const un = unsorted(); if (un.length) out.push({ pri: 58, icon: "🏷", title: `区分がまだの買い物が ${un.length}件`, body: "🏠 家財／🧴 消耗品／🎮 娯楽（3月まで封印）に振り分けると、買ってよいものだけが残ります。", acts: [["tab:save", "節約で振り分ける"]] });
      const spent = sumP(boughtMonth()); if (S.saveCfg.budget && spent > S.saveCfg.budget) out.push({ pri: 75, icon: "💸", title: `今月の家財が予算を ${yen(spent - S.saveCfg.budget)} 超えています`, body: `予算 ${yen(S.saveCfg.budget)} に対して ${yen(spent)}。残りの家財は来月に回すか、予算を見直しましょう。`, acts: [["tab:save", "節約を見る"]] });
      if (daysLeft() <= 0 && sealed().length) out.push({ pri: 65, icon: "🔓", title: `封印の解除日です（${sealed().length}件）`, body: "欲しいものを1つずつ、買う・まだ待つ・手放すに決めましょう。", acts: [["tab:save", "封印を見る"]] });
      else if (daysLeft() > 0 && daysLeft() <= 7 && sealed().length) out.push({ pri: 40, icon: "🔓", title: `封印の解除まで あと ${daysLeft()}日`, body: `封印中 ${sealed().length}件・${yen(sumP(sealed()))}。家財が揃っているか先に確かめましょう。`, acts: [["tab:save", "節約を見る"]] });
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
  function openConcierge(at = 0) {
    const list = advise();
    const itemRow = (t, acts) => `<div class="crow" data-qt="${t.id}"><button type="button" class="cname" data-mopen="${t.id}">${esc(short(t.name, 28))}<small>${esc(metaOf(t).tx)}${t.weight ? `・${t.weight}` : ""}</small></button><span class="cacts">${acts.map(([k, n]) => k === "open" ? `<button type="button" class="qc" data-mopen="${t.id}">${n}</button>` : `<button type="button" class="qc" data-qk="${k}">${n}</button>`).join("")}</span></div>`;
    modal(`<div class="tips"><h3>提案<small>${list.length}件・大事な順</small></h3><div class="clist">${sugsHtml()}${list.filter((x) => !x.sug).map((x, i) => `<section class="csug" ${i === at ? 'id="logat"' : ""}><h4><span>${x.icon}</span>${esc(x.title)}</h4><p>${esc(x.body)}</p>${(x.items || []).map((t) => itemRow(t, x.itemActs)).join("")}${x.acts ? `<div class="sfoot">${x.acts.map(([k, n], j) => `<button type="button" class="btn${j ? "" : " pri"}" data-cact="${k}">${n}</button>`).join("")}</div>` : ""}</section>`).join("")}</div>
      <div class="form" style="padding-top:0"><button type="button" class="btn" data-sugrun="1">💡 今すぐ提案してもらう</button><button type="button" class="btn" data-mclose="1">閉じる</button></div></div>`);
  }
  async function conciergeAct(k) {
    const [kind, v] = k.split(":");
    closeModal();
    if (kind === "late") { const late = lateOf(); const d = v === "today" ? TODAY() : addDays(TODAY(), 1); for (const t of late) await setProps(t, dateProps(d), `遅れ ${late.length}件を${v === "today" ? "今日" : "明日"}にしました`, { undo: false, quiet: t !== late[0] }); return; }
    if (kind === "tab") S.tab = v;
    else if (kind === "stage") { S.tab = "flow"; S.stage = v; }
    else if (kind === "triage") { S.tab = "triage"; S.pileKey = v === "some" ? "some" : "inbox"; }
    else if (kind === "shop") { S.tab = "shop"; S.shopSeg = v; }
    else if (kind === "logseg") { S.tab = "log"; S.logSeg = v; }
    render();
  }
  // 上の「提案」ボタンに、急ぎの提案の数を出す
  function renderConciergeFab() {
    const b = $("#tipsbadge"); if (!b) return;
    const n = S.mode === "loading" ? 0 : advise().filter((x) => x.pri >= 50).length;
    b.hidden = !n; b.textContent = n;
  }
