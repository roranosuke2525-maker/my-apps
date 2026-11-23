  // ================= 提案：今の状態を見て、タスクが進むように次の一手を示す =================
  const W8 = { S: 1, M: 2, L: 4, XL: 8 };
  const load8 = (list) => list.reduce((n, t) => n + (W8[t.weight] || 2), 0);
  // 提案の一覧（大事な順）。acts は押せる操作、items は1件ずつ動かせるタスク
  function advise() {
    const d = TODAY(); const out = [];
    const today = inStage("today"); const late = lateOf(); const next = inStage("next"); const inbox = inStage("inbox");
    const wait = inStage("wait"); const some = inStage("some");
    if (S.sugs.length) out.push({ pri: 95, icon: "💡", title: `AIから ${S.sugs.length}件の提案が届いてるよ`, body: S.sugs.slice(0, 3).map((s) => s.name).join("・"), sug: true });
    if (late.length) out.push({ pri: 100, icon: "⏰", title: `持ち越しが ${late.length}件あるよ`, body: "責めなくて大丈夫。今日やるか、いったん日付を外すかだけ決めると、気持ちが軽くなるよ。", acts: [["late:today", "ぜんぶ今日にする"], ["late:tomorrow", "ぜんぶ明日にする"]], items: late.slice(0, 4), itemActs: [["d:today", "今日"], ["d:sat", "土曜"], ["s:some", "いつか"]] });
    const w = load8(today);
    if (today.length >= 8 || w > 12) {
      const heavy = today.filter((t) => ["L", "XL"].includes(t.weight) || !t.weight).slice(0, 4);
      out.push({ pri: 90, icon: "🧺", title: `今日ちょっと詰めこみすぎかも（${today.length}件・重さ ${w}）`, body: "1日でこなせるのは重さ12くらいまで。重いのを明日以降に回して、終わる量にしぼろう。", items: heavy.length ? heavy : today.slice(0, 4), itemActs: [["d:tomorrow", "明日へ"], ["d:mon", "来週月"], ["s:some", "いつか"]] });
    }
    if (!today.length && next.length) {
      const pick = next.slice().sort((a, b) => (W8[a.weight] || 2) - (W8[b.weight] || 2) || ageOf(b) - ageOf(a)).slice(0, 3);
      out.push({ pri: 85, icon: "🎯", title: "今日やること、まだ決まってないね", body: "軽いもの・前からあるものを3つ選んでみたよ。どれか1つ、今日に入れてみない？", items: pick, itemActs: [["d:today", "今日やる"], ["d:tomorrow", "明日"]] });
    }
    // 節約：区分なしの買い物・予算超え・封印の解除日
    if (typeof unsorted === "function") {
      const un = unsorted(); if (un.length) out.push({ pri: 58, icon: "🏷", title: `区分がまだの買い物が ${un.length}件あるよ`, body: "🏠 家財／🧴 消耗品／🎮 娯楽（3月まで封印）に分けると、買っていいものだけが残るよ。", acts: [["tab:save", "節約で振り分ける"]] });
      const spent = sumP(boughtMonth()); if (S.saveCfg.budget && spent > S.saveCfg.budget) out.push({ pri: 75, icon: "💸", title: `今月の家財、予算を ${yen(spent - S.saveCfg.budget)} こえちゃった`, body: `予算 ${yen(S.saveCfg.budget)} に対して ${yen(spent)}。残りは来月に回すか、予算を見直そう。`, acts: [["tab:save", "節約を見る"]] });
      if (daysLeft() <= 0 && sealed().length) out.push({ pri: 65, icon: "🔓", title: `封印の解除日だよ（${sealed().length}件）`, body: "ここまでよくがまんしたね！欲しいものを1つずつ、買う・まだ待つ・手放すに決めよう。", acts: [["tab:save", "封印を見る"]] });
      else if (daysLeft() > 0 && daysLeft() <= 7 && sealed().length) out.push({ pri: 40, icon: "🔓", title: `封印の解除まで あと ${daysLeft()}日`, body: `封印中 ${sealed().length}件・${yen(sumP(sealed()))}。家財がそろってるか先に確かめとこう。`, acts: [["tab:save", "節約を見る"]] });
    }
    const mine = myTurn();
    if (mine.length) out.push({ pri: 80, icon: "💬", title: `AIが ${mine.length}件、返事を待ってるよ`, body: "回答（💭）や判定（🔍✅）を返してくれたら、次の定時処理でAIが続きを進めるね。", acts: [["tab:ai", "AIの番を見る"]] });
    const oldIn = inbox.filter((t) => ageOf(t) >= 3);
    if (inbox.length >= 10 || oldIn.length) out.push({ pri: 70, icon: "📥", title: `収集箱に ${inbox.length}件${oldIn.length ? `（3日以上 ${oldIn.length}件）` : ""}`, body: "1件ずつ「やる・いつか・AI・資料」に分けると頭がすっきりするよ。5分だけやってみよう。", acts: [["triage:inbox", "仕分けを始める"]] });
    const noStep = next.filter((t) => !t.next);
    if (noStep.length >= 3) out.push({ pri: 60, icon: "👣", title: `最初の一歩が空のタスクが ${noStep.length}件`, body: "「最初に何をするか」が書いてあると、すっと手が動くよ。一歩を書くか、AIに分けてもらおう。", items: noStep.slice(0, 3), itemActs: [["open", "開く"], ["a:💬", "AIと分解"]] });
    const stale = next.filter((t) => ageOf(t) >= 14);
    if (stale.length) out.push({ pri: 55, icon: "🕸", title: `2週間止まってる「次にやる」が ${stale.length}件`, body: "やらないなら いつか へ置いてOK。迷ってるならAIに調べてもらうと動きだすよ。", items: stale.slice(0, 3), itemActs: [["d:today", "今日"], ["s:some", "いつか"], ["a:🔍", "AIに調べて"]] });
    const longWait = wait.filter((t) => ageOf(t) >= 7);
    if (longWait.length) out.push({ pri: 50, icon: "📮", title: `1週間以上待ってるものが ${longWait.length}件`, body: "相手に確かめる日を決めておくと、忘れずにすむよ。", items: longWait.slice(0, 3), itemActs: [["d:tomorrow", "明日確認"], ["s:next", "自分で進める"]] });
    const soon = typeof stockSoon === "function" ? stockSoon() : [];
    if (soon.length) out.push({ pri: 45, icon: "🛒", title: `もうすぐ切れそうな日用品が ${soon.length}点`, body: soon.slice(0, 3).map((x) => `${x.name}（${leftTx(x)}）`).join("・"), acts: [["shop:stock", "在庫を見る"]] });
    const buyToday = shopLists().filter((t) => t.date && t.date <= d);
    if (buyToday.length) out.push({ pri: 44, icon: "🧾", title: `今日の買い物リストが ${buyToday.length}件あるよ`, body: buyToday.map((t) => t.name).join("・"), acts: [["shop:list", "買い物リストを開く"]] });
    if (some.length >= 20 && [5, 6, 0].includes(dow(d))) out.push({ pri: 30, icon: "🕰", title: `週末の見直し：いつか ${some.length}件`, body: "今やりたくなったものがあれば、次にやるへ戻してみよう。", acts: [["triage:some", "いつかを見直す"]] });
    const dg = S.diag.at(-1);
    if (dg?.next) out.push({ pri: 20, icon: "🩺", title: "診断からの次の一手", body: dg.next, acts: [["tab:log", "診断を見る"]] });
    if (!out.some((x) => x.pri >= 50)) out.push({ pri: 10, icon: "✨", title: S.doneToday.length ? `今日はもう ${S.doneToday.length}件できてる。いい感じ！` : "いい流れだよ", body: today.length ? `あと ${today.length}件。上から1つずつでいこう。` : "よゆうがあれば、次にやるから1つ今日に入れてみよう。", acts: today.length ? [["stage:today", "今日の一覧"]] : [["stage:next", "次にやるを見る"]] });
    return out.sort((a, b) => b.pri - a.pri);
  }
  const adviceTop = () => (S.mode === "loading" && !S.tasks.length ? null : advise()[0]);
  function openConcierge(at = 0) {
    const list = advise();
    const itemRow = (t, acts) => `<div class="crow" data-qt="${t.id}"><button type="button" class="cname" data-mopen="${t.id}">${esc(short(t.name, 28))}<small>${esc(metaOf(t).tx)}${t.weight ? `・${t.weight}` : ""}</small></button><span class="cacts">${acts.map(([k, n]) => k === "open" ? `<button type="button" class="qc" data-mopen="${t.id}">${n}</button>` : `<button type="button" class="qc" data-qk="${k}">${n}</button>`).join("")}</span></div>`;
    modal(`<div class="tips"><h3>ひとこと<small>${list.length}件・大事な順</small></h3><div class="clist">${sugsHtml()}${list.filter((x) => !x.sug).map((x, i) => `<section class="csug" ${i === at ? 'id="logat"' : ""}><h4><span>${x.icon}</span>${esc(x.title)}</h4><p>${esc(x.body)}</p>${(x.items || []).map((t) => itemRow(t, x.itemActs)).join("")}${x.acts ? `<div class="sfoot">${x.acts.map(([k, n], j) => `<button type="button" class="btn${j ? "" : " pri"}" data-cact="${k}">${n}</button>`).join("")}</div>` : ""}</section>`).join("")}</div>
      <div class="form" style="padding-top:0"><button type="button" class="btn" data-sugrun="1">💡 今すぐ提案してもらう</button><button type="button" class="btn" data-mclose="1">閉じる</button></div></div>`);
  }
  async function conciergeAct(k) {
    const [kind, v] = k.split(":");
    closeModal();
    if (kind === "late") { const late = lateOf(); const d = v === "today" ? TODAY() : addDays(TODAY(), 1); for (const t of late) await setProps(t, dateProps(d), `持ち越し ${late.length}件を${v === "today" ? "今日" : "明日"}にしたよ`, { undo: false, quiet: t !== late[0] }); return; }
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
