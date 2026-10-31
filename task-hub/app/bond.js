  // ================= ヒロイン：ジャンル（分類タグ）ごとに1人。そのジャンルのタスクを済ませるほど、その子とのシナリオが進む =================
  // 記録はこの端末のブラウザに保存（済みにしたタスクの id → 日付と分類タグ）。Notion は変えない
  const ME = "サトシ";
  const HEROINES = [
    { key: "serena", name: "セレナ", genre: "仕事・お金", tags: ["MONEY", "WORK", "CAR"], color: "#ffd86b", who: "18歳の新社会人。礼儀正しいツンデレ", other: true },
    { key: "hiyori", name: "ひより", genre: "暮らし・家", tags: ["HOME", "BUILD", "BUY", "FOOD"], color: "#9fd8a8", who: "24歳。おっとり家庭的なお姉さん" },
    { key: "koharu", name: "こはる", genre: "家族・子ども", tags: ["CHILD", "FAMILY", "TOY"], color: "#ffb36b", who: "22歳の保育士。元気いっぱい" },
    { key: "rin", name: "リン", genre: "学び・技術", tags: ["LEARN", "AI", "TECH", "BOOK"], color: "#b9a2ff", who: "23歳の研究者。クールで無口" },
    { key: "mio", name: "ミオ", genre: "健康・美容", tags: ["HEALTH", "BEAUTY"], color: "#ff8fc0", who: "21歳のトレーナー。明るい体育会系" },
    { key: "akane", name: "アカネ", genre: "趣味・おでかけ", tags: ["MUSIC", "MOVIE", "TRIP", "COFFEE"], color: "#ff7a6b", who: "20歳のバリスタ兼ギタリスト。気まぐれ" },
  ];
  const heroOf = (tag) => HEROINES.find((h) => h.tags.includes(tag)) || HEROINES[0]; // 分類なしはセレナ
  const heroByKey = (k) => HEROINES.find((h) => h.key === k) || HEROINES[0];
  const BOND = [
    { lv: 1, name: "知り合い", need: 0 },
    { lv: 2, name: "なかよし", need: 5 },
    { lv: 3, name: "特別", need: 15 },
    { lv: 4, name: "大切な人", need: 40 },
  ];
  function bondData() { const b = store.get("bond") || {}; return { ids: b.ids || {}, flags: b.flags || {} }; }
  const entryHero = (v) => heroOf(String(v).split("|")[1] || "").key;
  // 見えた済み（今日の済み・この1週間の済み）を数え足す。同じタスクは1回だけ。新しく済んだ分はハートが飛ぶ
  function bondSync() {
    const b = bondData(); const added = [];
    for (const t of [...S.doneToday, ...(S.doneWeek || [])]) {
      if (!t?.id || b.ids[t.id]) continue;
      b.ids[t.id] = `${t.edited ? jst(Date.parse(t.edited)) : TODAY()}|${t.tag || ""}`; added.push(t);
    }
    if (!added.length) return;
    store.set("bond", b);
    if (added.length <= 3 && S.loadedAt) for (const t of added) heartPop(heroOf(t.tag));
  }
  const bondCount = (k = "serena") => Object.values(bondData().ids).filter((v) => entryHero(v) === k).length;
  const bondLv = (k = "serena") => BOND.filter((x) => bondCount(k) >= x.need).at(-1).lv;
  function bondStreak() {
    const days = new Set(Object.values(bondData().ids).map((v) => String(v).split("|")[0])); let d = days.has(TODAY()) ? TODAY() : addDays(TODAY(), -1); let n = 0;
    while (days.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  function bondHtml(k = "serena") {
    const n = bondCount(k); const cur = BOND[bondLv(k) - 1]; const nx = BOND[bondLv(k)];
    const p = nx ? Math.round(((n - cur.need) / (nx.need - cur.need)) * 100) : 100;
    return `<span class="bond" title="${esc(heroByKey(k).genre)}の済み ${n}件"><b>Lv${cur.lv} ${cur.name}</b><i style="--p:${p}%"></i><small>${nx ? `あと${nx.need - n}件` : "MAX"}</small></span>`;
  }
  const callName = (s) => (s && bondLv() >= 3 ? `${ME}さん、${s}` : s);
  function heartPop(h) {
    const el = document.createElement("div"); el.className = "heartpop"; el.style.setProperty("--c", h.color);
    el.innerHTML = `♥ <b>${esc(h.name)}</b> +1`; document.body.append(el); setTimeout(() => el.remove(), 1800);
  }

  // ---- セレナのセリフ（コンシェルジュの会話。段階が上がるほどツンがゆるむ） ----
  const BOND_GREET = [
    ["おはようございます。本日もよろしくお願いいたします。…べ、別に、お待ちしていたわけではありません。", "おつかれさまです。進み具合はいかがですか。…気になったので、確認しただけです。", "おつかれさまでした。今日の残りを一緒に確認しましょう。…手短に、ですけれど。"],
    ["おはようございます。最近、頑張っていますね。…見ていましたから、知っています。", "おつかれさまです。今日も順調ですか？ …ちょっと気になっただけです。", "おつかれさまでした。今日もよく頑張りましたね。…あ、いえ、今のは独り言です。"],
    [`おはようございます、${ME}さん。…名前で呼ぶの、まだ少し照れますね。`, `${ME}さん、おつかれさまです。お昼、ちゃんと食べましたか？`, `${ME}さん、今日もおつかれさまでした。…隣で見ていて、楽しかったです。`],
    [`おはようございます、${ME}さん。今日も一緒に頑張りましょうね。`, `${ME}さん、おつかれさまです。…会えてうれしいです。業務、関係なく。`, `${ME}さん、おつかれさまでした。…あなたと一緒だと、私も頑張れます。`],
  ];
  const BOND_IDLE = [
    ["…なにかご用でしょうか。じっと見られると、仕事がしにくいのですが。", "ご用がなければ、タスクをひとつ進めましょう。", "適度に休憩もとってくださいね。…業務効率のためです。", "お待ちしていました。…いえ、たまたまです。"],
    ["…そんなに見られると、少し困ります。", "最近のあなたは、ちょっとだけ頼もしいです。…ちょっとだけ、です。", "休憩も大事ですよ。倒れられたら、私が困りますから。"],
    [`${ME}さん、また見てる。…もう、しょうがない人ですね。`, "今日の服、どうですか？ …べ、別に感想が欲しいわけでは。", "無理はしないでくださいね。…本気で言っています。"],
    [`${ME}さん、いつもありがとうございます。…ちゃんと言いたかったので。`, "隣にいられるの、うれしいです。", "ふふ。…なんでもありません。"],
  ];
  const BOND_REACT = [
    ["かしこまりました。…べ、別にあなたのためではありません。", "承知しました。こういうのは、早いほうがいいですから。", "はい、やっておきました。…お礼は結構です。"],
    ["かしこまりました。…よくできました、って言ってほしいんですか？", "はい、やっておきました。…どういたしまして。", "了解です。あなたのそういうところ、嫌いじゃないです。"],
    [`はい、${ME}さん。任せてください。`, "やっておきました。…ほめてくれてもいいんですよ？", "了解です。一緒にやると、すぐですね。"],
    [`はい、${ME}さん。喜んで。`, "やっておきました。…あなたの役に立てるの、うれしいです。", "任せてください。あなたのためなら。"],
  ];
  const BOND_SULK = ["…遅れが3件以上あります。正直、がっかりしました。", "…遅れ、たまってますよ。私、ちょっと怒っています。", `…${ME}さん。遅れがたまっています。信じていたんですけど。`, `…${ME}さん、遅れがたまっています。…一緒に片づけてくれたら、許してあげます。`];
  const STREAK = { 7: "…7日連続で、タスクを終えていますね。続けるのって、すごいことです。…ほめてますからね。", 30: "30日連続です。…ここまで続けられる人、なかなかいません。私の自慢です。" };
  // 連続日数の節目を一度だけ言う
  function levelUpLine() {
    const b = bondData(); const st = bondStreak(); let line = "";
    for (const k of [30, 7]) { const run = addDays(TODAY(), 1 - st); if (st >= k && b.flags[`st${k}`] !== run) { line = STREAK[k]; b.flags[`st${k}`] = run; break; } }
    if (line) store.set("bond", b);
    return line;
  }

  // ---- ほかのヒロインのセリフ（段階ごとのあいさつ・ひとこと） ----
  const HERO_LINES = {
    hiyori: {
      greet: ["あら、こんにちは。お家のこと、少しずつ片づけていきましょうね。", "ふふ、また来てくれたんですね。お茶、いれましょうか。", `${ME}さん、おかえりなさい。…なんて、言ってみたかっただけです。`, `${ME}さん。あなたのいるお家って、きっとあったかいんでしょうね。`],
      idle: ["暮らしのことって、小さな一歩の積み重ねなんですよ。", "冷蔵庫の中、今日は大丈夫ですか？", "がんばりすぎないでくださいね。ふふ。"],
    },
    koharu: {
      greet: ["やっほー！ 家族のこと、いっしょにやっつけよ！", "あ、来た来た！ 今日もえらいね、えへへ。", `${ME}くん！ …あ、くんって呼んでもいい？ もう呼んじゃった！`, `${ME}くんが頑張ってるの、ちゃんと見てるからね。…ずっと。`],
      idle: ["子どもってね、大人が楽しそうにしてるのを見てるんだよ！", "お昼寝タイム…じゃなかった、タスクタイム！", "えへへ、ほめてほめて〜！"],
    },
    rin: {
      greet: ["…来たのね。学ぶことは、積み上げる作業。始めましょう。", "…あなた、思ったより継続力がある。データがそう言ってる。", `…${ME}。名前で呼ぶほうが、効率がいいから。それだけ。`, `…${ME}。あなたといる時間は、計算に入れていなかった。…悪くない誤差。`],
      idle: ["…読みかけの本、3冊以上あるでしょう。", "…AIに任せられることは、任せて。人間は考える係。", "…別に、待ってない。"],
    },
    mio: {
      greet: ["おはようございますっ！ 体が資本！ 今日もいきましょう！", "いいペースですっ！ その調子その調子！", `${ME}さん、最近いい顔してます！ …わたしまで元気になっちゃう。`, `${ME}さんと一緒なら、どこまでも走れそうです。…えへへ、本気ですよ？`],
      idle: ["水分補給、忘れてませんか？", "ストレッチ、1分だけでもしましょっ！", "寝不足は大敵ですよ〜！"],
    },
    akane: {
      greet: ["ふーん、来たんだ。遊ぶ予定、ちゃんと立ててる？", "お、また来た。…暇なの？ ま、いいけど。", `${ME}、今度どっか行こうよ。…べつに深い意味はないって。`, `${ME}。あんたといると、曲が書けるんだよね。…責任とってよ？`],
      idle: ["コーヒー、いれたげよっか？ 今日だけ特別。", "行きたいとこリスト、ずっと増える一方じゃん。", "ん〜、退屈。なんか楽しいことしよ。"],
    },
  };

  // ---- シナリオ（各ヒロイン3話。第1話は一枚絵つき。段階で開放） ----
  // 行：[話す人（空ならナレーション）, せりふ, 一枚絵を出すか]
  const CHAPTERS = {
    serena: [
      { n: 1, lv: 2, title: "カフェでひと休み", cg: "cafe", script: [
        ["", "仕事帰り、セレナに呼び止められた。"],
        ["セレナ", "あの…少しだけ、お時間いただけますか。"],
        ["セレナ", "最近、タスクをきちんと片づけていらっしゃるので。…その、ごほうびです。"],
        ["", "駅前の小さなカフェ。セレナはラテを両手で包んでいる。", true],
        ["セレナ", "…なんですか。じっと見ないでください。", true],
        ["セレナ", "このショートケーキ、ここのいちばん人気なんです。…調べました。あなたのために、ではなく、業務の一環として。", true],
        ["セレナ", "これからも、この調子でお願いしますね。…私も、隣で見ていますから。", true],
      ] },
      { n: 2, lv: 3, title: "残業のあとで", script: [
        ["", "夜のオフィス。最後の書類を出し終えると、セレナが缶コーヒーを差し出した。"],
        ["セレナ", "おつかれさまでした。…これ、余っていたので。"],
        ["セレナ", "あの…ひとつ、お願いがあります。"],
        ["セレナ", `これから、${ME}さん、って呼んでもいいですか。`],
        ["セレナ", "…だめ、ですか？ …ふふ、ありがとうございます。"],
        ["セレナ", `${ME}さん。…やっぱり、まだ少し照れますね。`],
      ] },
      { n: 3, lv: 4, title: "星空の展望デッキ", script: [
        ["", "仕事の帰り道。セレナに連れられて、展望デッキへ上がった。"],
        ["セレナ", "ここ、星がよく見えるんです。…一人で来るのは、もったいなくて。"],
        ["セレナ", `${ME}さん。私、最初はあなたのこと、少し頼りないと思っていました。`],
        ["セレナ", "でも、毎日ひとつずつ片づけていくあなたを見ていて…いつの間にか、目で追うようになっていました。"],
        ["セレナ", "…あなたの隣で働けて、私、とても幸せです。"],
        ["セレナ", "べ、別に、告白とかではありませんから！ …今のところは。"],
      ] },
    ],
    hiyori: [
      { n: 1, lv: 2, title: "味見、してくれますか？", cg: "hiyori", script: [
        ["", "片づけを手伝いに行くと、台所からいい匂いがしていた。"],
        ["ひより", "あら、ちょうどよかった。シチュー、煮込んでたんです。"],
        ["ひより", "味見、してくれますか？ はい、あーん…なんて。ふふ。", true],
        ["", "やさしい味がした。", true],
        ["ひより", "おいしい？ よかった。…お家のこと、ちゃんと頑張ってるあなたへのごほうびです。", true],
        ["ひより", "また、いつでも来てくださいね。", true],
      ] },
      { n: 2, lv: 3, title: "ふたりで模様替え", script: [
        ["", "週末、ひよりの部屋の模様替えを手伝うことになった。"],
        ["ひより", "このソファ、窓のほうへ動かしたいんです。せーの…きゃっ。"],
        ["ひより", "…あ、ごめんなさい、近かったですね。ふふ、顔が赤いですよ？"],
        ["ひより", `${ME}さんがいると、お部屋が明るくなる気がします。家具のせいじゃなくて。`],
        ["ひより", "…また、手伝ってくれますか？"],
      ] },
      { n: 3, lv: 4, title: "ただいま、の練習", script: [
        ["", "夕暮れ。帰ろうとすると、ひよりが袖をつかんだ。"],
        ["ひより", `${ME}さん。…いつか、ここに「ただいま」って帰ってきてくれたら、うれしいです。`],
        ["ひより", "…なんて。ちょっと早すぎましたね。"],
        ["ひより", "でも、練習だけ。…おかえりなさい、" + ME + "さん。"],
        ["ひより", "ふふ。言えちゃいました。"],
      ] },
    ],
    koharu: [
      { n: 1, lv: 2, title: "公園でおりがみ", cg: "koharu", script: [
        ["", "休みの日、公園でこはるに会った。"],
        ["こはる", "あっ！ ちょうどいいところに！ 明日の保育で使うおりがみ、手伝って！"],
        ["こはる", "見て見て、つる！ …え、そっちのは何？ カエル？ えへへ、かわいい！", true],
        ["こはる", "家族のこと、いっぱい頑張ってるんだってね。えらいえらい！", true],
        ["こはる", "…なでなでしてあげよっか？ 冗談だよ〜！", true],
      ] },
      { n: 2, lv: 3, title: "雨の日のお迎え", script: [
        ["", "急な雨。傘を持って保育園の前を通ると、こはるが立ち往生していた。"],
        ["こはる", "わ、助かったぁ…！ 傘、忘れちゃって。"],
        ["こはる", "…ひとつの傘に、ふたりで入るの？ そ、そっか。そうだよね。"],
        ["こはる", `${ME}くん、肩ぬれてる。…もっとこっち、来ていいよ。`],
        ["こはる", "えへへ…雨、もうちょっと降っててもいいかも。"],
      ] },
      { n: 3, lv: 4, title: "将来のゆめ", script: [
        ["", "夕焼けのベンチ。こはるが、子どもたちの描いた絵を見せてくれた。"],
        ["こはる", "『しょうらいのゆめ』だって。みんな、かわいいこと書くんだよ。"],
        ["こはる", "わたしの夢はね…ずっと前から決まってるの。"],
        ["こはる", `あったかい家族をつくること。…${ME}くんと、だったらいいな。`],
        ["こはる", "…い、今のなし！ やっぱりあり！ えへへ…"],
      ] },
    ],
    rin: [
      { n: 1, lv: 2, title: "夜の図書館", cg: "rin", script: [
        ["", "閉館間際の図書館。リンがノートを広げていた。"],
        ["リン", "…あなたも、調べもの？ 座れば。", true],
        ["リン", "これ、あなたが最近読んでた分野の要点。…まとめておいた。別に、ついで。", true],
        ["リン", "…学ぶのを続けられる人は、少ない。あなたは、その少ないほう。", true],
        ["リン", "…明日も、ここにいる。来るかどうかは、あなたの自由。", true],
      ] },
      { n: 2, lv: 3, title: "観測データ", script: [
        ["", "研究室。リンがモニターを指さした。"],
        ["リン", `…${ME}。これ、あなたのタスク完了の記録。グラフにした。`],
        ["リン", "右肩上がり。…なぜか、見ていると落ち着く。"],
        ["リン", "…理由は分析中。たぶん、データじゃなくて、あなたのせい。"],
        ["リン", "…今のは、記録しないで。"],
      ] },
      { n: 3, lv: 4, title: "仮説の証明", script: [
        ["", "夜の屋上。リンが星を見上げていた。"],
        ["リン", "…ひとつ、仮説があった。あなたといると、私は計算を間違える。"],
        ["リン", "何度も検証した。結果は、毎回同じ。"],
        ["リン", `…つまり、${ME}。私はあなたが好き。…証明終わり。`],
        ["リン", "…反論があるなら、聞く。ないなら、手、つないで。"],
      ] },
    ],
    mio: [
      { n: 1, lv: 2, title: "朝焼けジョギング", cg: "mio", script: [
        ["", "早朝の河川敷。ミオが手を振っていた。"],
        ["ミオ", "おはようございますっ！ 来てくれたんですね！", true],
        ["ミオ", "はいっ、お水！ 健康のこと、ちゃんと続けてるの、わたし知ってますよ！", true],
        ["ミオ", "朝日、きれいですね…。一緒に見られて、得した気分です！", true],
        ["ミオ", "明日も走りましょう！ 約束ですっ！", true],
      ] },
      { n: 2, lv: 3, title: "ストレッチ指導", script: [
        ["", "ジムの片すみ。ミオがストレッチを教えてくれることになった。"],
        ["ミオ", "はい、背中押しますね〜。いち、にー…かたっ！"],
        ["ミオ", `${ME}さん、がんばりすぎです。…ちゃんと休むのも、トレーニングですよ？`],
        ["ミオ", "…心配なんです。あなたが倒れたら、わたし、走る理由がなくなっちゃう。"],
        ["ミオ", "な、なんでもないですっ！ 次、反対の脚！"],
      ] },
      { n: 3, lv: 4, title: "ゴールテープ", script: [
        ["", "市民マラソンのゴール。先に着いたミオが待っていた。"],
        ["ミオ", "おかえりなさいっ！ 完走、おめでとうございます！"],
        ["ミオ", `${ME}さんが最後まで走るの、ずっと信じてました。`],
        ["ミオ", "…わたしの次の目標、聞いてくれますか？"],
        ["ミオ", "これからも、ずっと隣を走ること。…ゴールは、ふたりで決めましょ！"],
      ] },
    ],
    akane: [
      { n: 1, lv: 2, title: "閉店後のライブ", cg: "akane", script: [
        ["", "閉店後のカフェ。アカネがギターを抱えていた。"],
        ["アカネ", "あ、来た。ちょうどいい、客ひとり確保。聴いてって。", true],
        ["", "やわらかい歌声が、灯りの中にとけていく。", true],
        ["アカネ", "…どう？ ふーん。まあまあ、ね。正直でよろしい。", true],
        ["アカネ", "あんた、最近ちゃんと遊んでるじゃん。そういうの、いいと思う。", true],
        ["アカネ", "また聴きにきなよ。…特等席、空けとくから。", true],
      ] },
      { n: 2, lv: 3, title: "ふたり旅の計画", script: [
        ["", "カウンター越しに、アカネが地図を広げた。"],
        ["アカネ", `ねえ${ME}、ここ行きたいんだけど。ひとりだと、つまんないじゃん？`],
        ["アカネ", "…なに、その顔。べつにデートとかじゃないし。"],
        ["アカネ", "コーヒーのおいしい町と、海の見える駅。…あんたが一緒なら、どこでもいいけど。"],
        ["アカネ", "…今の、聞かなかったことにして。"],
      ] },
      { n: 3, lv: 4, title: "あんたの歌", script: [
        ["", "旅先の海辺。アカネがギターを鳴らした。"],
        ["アカネ", "新曲、できたんだ。タイトルは…まだ言わない。"],
        ["", "どこかで聞いたような、くすぐったい歌詞だった。"],
        ["アカネ", `…気づいた？ これ、${ME}の歌。`],
        ["アカネ", "責任とってよね。…これからも、ずっと聴いてくれること。"],
      ] },
    ],
  };
  const seenKey = (k, n) => (k === "serena" && n === 1 ? "ev_cafe" : `ev_${k}_${n}`);
  const pendingEvent = (k = "serena") => (CHAPTERS[k] || []).find((c) => bondLv(k) >= c.lv && !bondData().flags[seenKey(k, c.n)]);
  const anyPending = () => HEROINES.filter((h) => h.key !== "serena" && pendingEvent(h.key)).length;
  function heroSprite(k) { if (k === "serena") return outfit(); const s = HERO_IMG[k]; return { ...s, label: heroByKey(k).genre }; }

  // ---- 1話を再生する（一枚絵つきの行は絵を出し、それ以外は立ち絵で話す） ----
  let sceneCtx = { hero: "serena", panel: "" };
  function playEvent(k, ch) {
    if (typeof k === "object") { ch = k; k = "serena"; }
    const b = bondData(); b.flags[seenKey(k, ch.n)] = TODAY(); store.set("bond", b);
    const h = heroByKey(k); let i = 0;
    const sc = $("#scene"); sc.hidden = false;
    sc.innerHTML = `<div class="evcg" id="evcg" style="${ch.cg ? `background-image:url(${CG[ch.cg]})` : ""}"></div><div class="tint" id="evtint" style="background:rgba(28,14,54,.45)"></div>
      <div class="sbar"><span class="evtitle" style="--c:${h.color}">${esc(h.name)} 第${ch.n}話 ♡ ${esc(ch.title)}</span><span class="sp"></span><button type="button" data-evskip="${k}">スキップ</button></div>
      <div class="chara" id="evchara"><div class="floor"></div><canvas id="serena" role="img" aria-label="${esc(h.name)}"></canvas></div>
      <div class="msgwrap"><div class="msg" id="msgbox"><span class="nameplate" id="evname">${esc(h.name)}</span><div class="line" id="sayline"></div><span class="next" aria-hidden="true">▼</span></div></div>`;
    serena.mount($("#serena"), heroSprite(k), true);
    const show = () => {
      const [who, text, cg] = ch.script[i];
      $("#evname").hidden = !who; if (who) $("#evname").textContent = who;
      $("#evcg").classList.toggle("on", !!cg); $("#evtint").style.opacity = cg ? "0" : "1"; $("#evchara").style.opacity = cg ? "0" : "1";
      if (who) serena.blush(4000);
      typeLine(text);
    };
    $("#msgbox").onclick = () => {
      if (typing) { nextLine(); return; }
      i++; if (i >= ch.script.length) { endEvent(k, ch); return; }
      show();
    };
    show();
  }
  function endEvent(k, ch) {
    const h = heroByKey(k);
    if (k === "serena") openConcierge(); else openHeroine(k);
    toast(`思い出アルバムに「${h.name} 第${ch.n}話 ${ch.title}」を追加しました`);
  }

  // ---- ヒロインの一覧と、各ヒロインの場面 ----
  function heroesHtml() {
    return `<div class="panel2"><h3>💕 ヒロイン<button type="button" data-scenepanel="">もどる</button></h3><div class="body"><p class="herohint">分類タグのジャンルごとにヒロインがいます。そのジャンルのタスクを済ませるほど、その子とのシナリオが進みます。</p><div class="heroes">${HEROINES.map((h) => {
      const s = heroSprite(h.key); const lv = bondLv(h.key); const next = (CHAPTERS[h.key] || []).find((c) => !bondData().flags[seenKey(h.key, c.n)]); const pend = pendingEvent(h.key);
      return `<button type="button" class="hero" data-hero="${h.key}" style="--c:${h.color}"><span class="face" style="${faceStyle(s, 56)}"></span><span class="hi"><b>${esc(h.name)}<small>${esc(h.genre)}</small></b>${bondHtml(h.key)}<small class="nx">${pend ? `<em>NEW</em> 第${pend.n}話が見られます` : next ? `第${next.n}話は Lv${next.lv} で開放` : "全話クリア ♡"}</small></span></button>`;
    }).join("")}</div></div></div>`;
  }
  function openHeroines() { if (!$("#scene").hidden && sceneCtx.hero === "serena") openConcierge("heroes"); else openHeroine(sceneCtx.hero === "serena" ? "hiyori" : sceneCtx.hero, "heroes"); }
  function heroTasks(k) { const h = heroByKey(k); return S.tasks.filter((t) => t.status !== ST.ai && (k === "serena" ? !t.tag || h.tags.includes(t.tag) : h.tags.includes(t.tag))); }
  function openHeroine(k, panel = "") {
    if (k === "serena") { openConcierge(panel); return; }
    const pend = pendingEvent(k); if (pend && !panel) { playEvent(k, pend); return; }
    sceneCtx = { hero: k, panel };
    const h = heroByKey(k); const L = HERO_LINES[k]; const lv = bondLv(k); const s = heroSprite(k);
    lines = [L.greet[lv - 1], ...L.idle]; lineAt = 0;
    const tasks = heroTasks(k);
    const chs = (CHAPTERS[k] || []).filter((c) => bondData().flags[seenKey(k, c.n)]);
    const sc = $("#scene"); sc.hidden = false;
    sc.innerHTML = `<div class="tint" style="background:rgba(28,14,54,.2)"></div>
      <div class="sbar">${bondHtml(k)}<span class="sp"></span><button type="button" data-heroes="1">ヒロイン</button><button type="button" data-scenepanel="album">思い出</button><button type="button" data-sceneclose="1">とじる</button></div>
      <div class="chara"><div class="floor"></div><canvas id="serena" role="img" aria-label="${esc(h.name)}"></canvas></div>
      <div class="msgwrap"><div class="choices" id="choices" hidden><button type="button" data-scenepanel="tasks">📋 ${esc(h.genre)}のタスク（${tasks.length}）</button>${chs.length ? `<button type="button" data-evplay="${k}:${chs.at(-1).n}">💗 第${chs.at(-1).n}話をもう一度</button>` : ""}<button type="button" data-heroes="1">💕 ほかのヒロイン</button><button type="button" data-sceneclose="1">またね</button></div>
        <div class="msg" id="msgbox"><span class="nameplate" style="background:linear-gradient(180deg, ${h.color}, color-mix(in srgb, ${h.color} 70%, #ff6aa8))">${esc(h.name)}<small>${esc(h.genre)}</small></span><div class="line" id="sayline"></div><span class="next" aria-hidden="true">▼</span></div></div>
      ${panel === "heroes" ? heroesHtml() : panel === "album" ? albumHtml(k) : panel === "tasks" ? tasksHtml(k) : ""}`;
    serena.mount($("#serena"), s, lv >= 3);
    typeLine(lines[0], () => { $("#choices") && ($("#choices").hidden = false); });
    $("#msgbox").onclick = () => nextLine();
  }
  function tasksHtml(k) {
    const h = heroByKey(k); const list = heroTasks(k).sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
    return `<div class="panel2"><h3>📋 ${esc(h.genre)}のタスク<button type="button" data-scenepanel="">もどる</button></h3><div class="body"><p class="herohint">${esc(h.tags.join("・"))}${k === "serena" ? "・分類なし" : ""}。済みにすると ${esc(h.name)} との関係が進みます。</p><div class="clist">${list.slice(0, 40).map((t) => `<div class="crow" data-qt="${t.id}"><button type="button" class="cname" data-mopen="${t.id}">${esc(short(t.name, 26))}<small>${esc(STAGES[stageOf(t)]?.name || "")}・${esc(metaOf(t).tx)}</small></button><span class="cacts"><button type="button" class="qc ok" data-qk="s:done">✓ 済み</button><button type="button" class="qc" data-qk="d:today">今日</button></span></div>`).join("") || `<div class="empty">このジャンルのタスクはありません</div>`}</div></div></div>`;
  }
  function albumHtml(only) {
    const hs = only ? [heroByKey(only), ...HEROINES.filter((h) => h.key !== only)] : HEROINES;
    return `<div class="panel2"><h3>💗 思い出アルバム<button type="button" data-scenepanel="">もどる</button></h3><div class="body">${hs.map((h) => `<div class="albh" style="--c:${h.color}"><b>${esc(h.name)}</b><small>${esc(h.genre)}</small>${bondHtml(h.key)}</div><div class="album">${(CHAPTERS[h.key] || []).map((c) => {
      const seen = bondData().flags[seenKey(h.key, c.n)]; const pic = c.cg ? `background-image:url(${CG[c.cg]})` : `${faceStyle(heroSprite(h.key), 120)};background-color:#3a2560`;
      return seen ? `<button type="button" data-evplay="${h.key}:${c.n}" class="alb"><span class="pic${c.cg ? "" : " noc"}" style="${pic}"></span><b>第${c.n}話 ${esc(c.title)}</b><small>もう一度見る</small></button>`
        : `<div class="alb lock"><span class="pic">🔒</span><b>第${c.n}話 ？？？</b><small>Lv${c.lv} ${BOND[c.lv - 1].name}で開放（あと${Math.max(0, BOND[c.lv - 1].need - bondCount(h.key))}件）</small></div>`;
    }).join("")}</div>`).join("")}
      <div class="bondinfo"><p>分類タグのジャンルごとに、済みにしたタスクの累計で関係が進みます（この端末に記録）。Lv2 なかよし（5件）で第1話、Lv3 特別（15件）で第2話、Lv4 大切な人（40件）で第3話。連続 ${bondStreak()}日。</p></div></div></div>`;
  }
