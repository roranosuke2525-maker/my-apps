  // ================= 関係が進む：済みにしたタスクの累計で、セレナとの関係の段階が上がる =================
  // 記録はこの端末のブラウザに保存（済みにしたタスクの id と、その日付）。Notion は変えない
  const BOND = [
    { lv: 1, name: "同僚", need: 0 },
    { lv: 2, name: "信頼", need: 30 },
    { lv: 3, name: "特別", need: 100 },
    { lv: 4, name: "デレ", need: 300 },
  ];
  const ME = "サトシ";
  function bondData() { const b = store.get("bond") || {}; return { ids: b.ids || {}, seen: b.seen || 0, flags: b.flags || {} }; }
  // 見えた済み（今日の済み・この1週間の済み）を数え足す。同じタスクは1回だけ
  function bondSync() {
    const b = bondData(); let added = 0;
    for (const t of [...S.doneToday, ...(S.doneWeek || [])]) {
      if (!t?.id || b.ids[t.id]) continue;
      b.ids[t.id] = t.edited ? jst(Date.parse(t.edited)) : TODAY(); added++;
    }
    if (added) store.set("bond", b);
  }
  const bondCount = () => Object.keys(bondData().ids).length;
  const bondLv = () => BOND.filter((x) => bondCount() >= x.need).at(-1).lv;
  // 続けて済みを出した日数（今日か昨日まで続いていれば数える）
  function bondStreak() {
    const days = new Set(Object.values(bondData().ids)); let d = days.has(TODAY()) ? TODAY() : addDays(TODAY(), -1); let n = 0;
    while (days.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  function bondHtml() {
    const n = bondCount(); const cur = BOND[bondLv() - 1]; const nx = BOND[bondLv()];
    const p = nx ? Math.round(((n - cur.need) / (nx.need - cur.need)) * 100) : 100;
    return `<span class="bond" title="済みの累計 ${n}件"><b>Lv${cur.lv} ${cur.name}</b><i style="--p:${p}%"></i><small>${nx ? `あと${nx.need - n}件` : "MAX"}</small></span>`;
  }
  const callName = (s) => (s && bondLv() >= 3 ? `${ME}さん、${s}` : s);

  // ---- 段階ごとのセリフ（礼儀正しいツンデレ。段階が上がるほどツンがゆるむ） ----
  const BOND_GREET = [
    ["おはようございます。本日もよろしくお願いいたします。…べ、別に、お待ちしていたわけではありません。", "おつかれさまです。進み具合はいかがですか。…気になったので、確認しただけです。", "おつかれさまでした。今日の残りを一緒に確認しましょう。…手短に、ですけれど。"],
    ["おはようございます。最近、頑張っていますね。…見ていましたから、知っています。", "おつかれさまです。今日も順調ですか？ …ちょっと気になっただけです。", "おつかれさまでした。今日もよく頑張りましたね。…あ、いえ、今のは独り言です。"],
    [`おはようございます、${ME}さん。…名前で呼ぶの、まだ少し照れますね。`, `${ME}さん、おつかれさまです。お昼、ちゃんと食べましたか？`, `${ME}さん、今日もおつかれさまでした。…隣で見ていて、楽しかったです。`],
    [`おはようございます、${ME}さん。今日も一緒に頑張りましょうね。`, `${ME}さん、おつかれさまです。…会えてうれしいです。業務、関係なく。`, `${ME}さん、おつかれさまでした。…あなたと一緒だと、私も頑張れます。`],
  ];
  const BOND_IDLE = [
    ["…なにかご用でしょうか。じっと見られると、仕事がしにくいのですが。", "ご用がなければ、タスクをひとつ進めましょう。", "適度に休憩もとってくださいね。…業務効率のためです。", "お待ちしていました。…いえ、たまたまです。", "おつかれさまです。…一度しか言いませんので。"],
    ["…そんなに見られると、少し困ります。", "最近のあなたは、ちょっとだけ頼もしいです。…ちょっとだけ、です。", "休憩も大事ですよ。倒れられたら、私が困りますから。", "何かあれば、遠慮なく言ってくださいね。"],
    [`${ME}さん、また見てる。…もう、しょうがない人ですね。`, "今日の服、どうですか？ …べ、別に感想が欲しいわけでは。", "一緒に片づけると、早いですね。", "無理はしないでくださいね。…本気で言っています。"],
    [`${ME}さん、いつもありがとうございます。…ちゃんと言いたかったので。`, "隣にいられるの、うれしいです。", "今日も一緒にいてくれて、ありがとうございます。", "ふふ。…なんでもありません。"],
  ];
  const BOND_REACT = [
    ["かしこまりました。…べ、別にあなたのためではありません。", "承知しました。こういうのは、早いほうがいいですから。", "はい、やっておきました。…お礼は結構です。"],
    ["かしこまりました。…よくできました、って言ってほしいんですか？", "はい、やっておきました。…どういたしまして。", "了解です。あなたのそういうところ、嫌いじゃないです。"],
    [`はい、${ME}さん。任せてください。`, "やっておきました。…ほめてくれてもいいんですよ？", "了解です。一緒にやると、すぐですね。"],
    [`はい、${ME}さん。喜んで。`, "やっておきました。…あなたの役に立てるの、うれしいです。", "任せてください。あなたのためなら。"],
  ];
  // 遅れが3件以上たまると、一時的にツンに戻る
  const BOND_SULK = ["…遅れが3件以上あります。正直、がっかりしました。", "…遅れ、たまってますよ。私、ちょっと怒っています。", `…${ME}さん。遅れがたまっています。信じていたんですけど。`, `…${ME}さん、遅れがたまっています。…一緒に片づけてくれたら、許してあげます。`];
  const BOND_UP = [
    "",
    "…最近、ずいぶん頑張っていますね。正直、見直しました。これからは、もう少しだけ頼りにします。",
    `あの…これから、${ME}さんって呼んでもいいですか。…だめ、ですか？ ふふ、ありがとうございます。`,
    `${ME}さん。…ずっと、言おうと思っていました。あなたの隣で働けて、私、とても幸せです。`,
  ];
  const STREAK = { 7: "…7日連続で、タスクを終えていますね。続けるのって、すごいことです。…ほめてますからね。", 30: "30日連続です。…ここまで続けられる人、なかなかいません。私の自慢です。" };
  // 段階が上がった・連続日数の節目を一度だけ言う
  function levelUpLine() {
    const b = bondData(); const lv = bondLv(); const st = bondStreak(); let line = "";
    if ((b.flags.lv || 1) < lv) { line = BOND_UP[lv - 1]; b.flags.lv = lv; }
    else for (const k of [30, 7]) { const run = addDays(TODAY(), 1 - st); if (st >= k && b.flags[`st${k}`] !== run) { line = STREAK[k]; b.flags[`st${k}`] = run; break; } }
    if (line) store.set("bond", b);
    return line;
  }

  // ---- イベント（一枚絵つきの短い会話）と思い出アルバム ----
  const EVENTS = [
    {
      key: "cafe", title: "カフェでひと休み", lv: 2, cg: "cafe", script: [
        ["", "仕事帰り、セレナに呼び止められた。"],
        [CNAME, "あの…少しだけ、お時間いただけますか。"],
        [CNAME, "最近、タスクをきちんと片づけていらっしゃるので。…その、ごほうびです。"],
        ["", "駅前の小さなカフェ。セレナはラテを両手で包んでいる。", true],
        [CNAME, "…なんですか。じっと見ないでください。", true],
        [CNAME, "このショートケーキ、ここのいちばん人気なんです。…調べました。あなたのために、ではなく、業務の一環として。", true],
        [CNAME, "…おいしいですか？ そう、よかった。", true],
        [CNAME, "これからも、この調子でお願いしますね。…私も、隣で見ていますから。", true],
        ["", "思い出アルバムに「カフェでひと休み」が加わった。", true],
      ],
    },
    { key: "festival", title: "夏祭りの夜", lv: 3, soon: true },
    { key: "deck", title: "星空の展望デッキ", lv: 4, soon: true },
  ];
  const pendingEvent = () => EVENTS.find((e) => !e.soon && bondLv() >= e.lv && !bondData().flags[`ev_${e.key}`]);
  function playEvent(ev) {
    const b = bondData(); b.flags[`ev_${ev.key}`] = TODAY(); store.set("bond", b);
    const o = outfit(); let i = 0;
    const sc = $("#scene"); sc.hidden = false;
    sc.innerHTML = `<div class="evcg" id="evcg" style="background-image:url(${CG[ev.cg]})"></div><div class="tint" id="evtint" style="background:rgba(28,14,54,.55)"></div>
      <div class="sbar"><span class="evtitle">EVENT ♡ ${esc(ev.title)}</span><span class="sp"></span><button type="button" data-evskip="1">スキップ</button></div>
      <div class="chara" id="evchara"><div class="floor"></div><canvas id="serena" role="img" aria-label="${CNAME}"></canvas></div>
      <div class="msgwrap"><div class="msg" id="msgbox"><span class="nameplate" id="evname">${CNAME}</span><div class="line" id="sayline"></div><span class="next" aria-hidden="true">▼</span></div></div>`;
    serena.mount($("#serena"), o, true);
    const show = () => {
      const [who, text, cg] = ev.script[i];
      $("#evname").hidden = !who; $("#evcg").classList.toggle("on", !!cg); $("#evtint").style.opacity = cg ? "0" : "1"; $("#evchara").style.opacity = cg ? "0" : "1";
      if (who) serena.blush(4000);
      typeLine(text);
    };
    $("#msgbox").onclick = () => {
      if (typing) { nextLine(); return; }
      i++; if (i >= ev.script.length) { openConcierge(); toast(`思い出アルバムに「${ev.title}」を追加しました`); return; }
      show();
    };
    show();
  }
  function albumHtml() {
    const lv = bondLv();
    return `<div class="panel2"><h3>💗 思い出アルバム<button type="button" data-scenepanel="">もどる</button></h3><div class="body"><div class="album">${EVENTS.map((e) => {
      const open = !e.soon && bondData().flags[`ev_${e.key}`];
      return open ? `<button type="button" data-evplay="${e.key}" class="alb"><span class="pic" style="background-image:url(${CG[e.cg]})"></span><b>${esc(e.title)}</b><small>もう一度見る</small></button>`
        : `<div class="alb lock"><span class="pic">🔒</span><b>${esc(e.soon ? e.title : "？？？")}</b><small>${e.soon ? `Lv${e.lv} ${BOND[e.lv - 1].name}で開放（準備中）` : lv >= e.lv ? "会話の画面を開くと始まります" : `Lv${e.lv} ${BOND[e.lv - 1].name}で開放`}</small></div>`;
    }).join("")}</div>
      <div class="bondinfo">${bondHtml()}<p>済みにしたタスクの累計で関係が進みます（この端末に記録）。連続 ${bondStreak()}日。<br>Lv2 信頼（30件）でツンがゆるみ、Lv3 特別（100件）で名前で呼び、Lv4 デレ（300件）でほとんどデレます。遅れが3件以上たまると、一時的にツンに戻ります。</p></div></div></div>`;
  }
