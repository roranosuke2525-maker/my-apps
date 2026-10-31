  // ================= コンシェルジュ：今の状態を見て、タスクが進むように提案する =================
  // ---- 服：季節と時間で着替える（手動で固定もできる） ----
  const CNAME = "セレナ";
  function outfitAuto(now = Date.now()) {
    const j = new Date(now + 9 * 3600e3); const h = j.getUTCHours(); const m = j.getUTCMonth() + 1; const d = jst(now);
    const summer = m >= 6 && m <= 9, winter = m === 12 || m <= 2, off = !workday(d);
    if (h >= 22 || h < 6) return "lounge";
    if (lateOf().length >= 3) return "commander";
    if (summer && (m === 7 || m === 8) && h >= 17) return "yukata";
    if (off) return summer ? "sundress" : winter && (h < 10 || h >= 16) ? "coat" : "casual";
    if (winter && (h < 9 || h >= 17)) return "coat";
    if (h >= 19) return summer ? "summer" : winter ? "coat" : "casual";
    return summer ? "summer" : "office";
  }
  const outfit = () => OUTFITS.find((o) => o.key === (store.get("outfit") || "auto")) || OUTFITS.find((o) => o.key === outfitAuto()) || OUTFITS[1];
  // 丸いアイコン：全身の絵から顔のまわりを切り出す（CSS の背景で）
  function faceStyle(o, size) {
    const k = size / (o.hw * o.w * 1.5); const W = o.w * k, H = o.h * k;
    return `background-image:url(${o.img});background-size:${W.toFixed(1)}px ${H.toFixed(1)}px;background-position:${(size / 2 - o.hx * o.w * k).toFixed(1)}px ${(-o.hy * o.h * k + size * 0.06).toFixed(1)}px`;
  }
  const avatar = () => ({ name: CNAME });
  const IDLE = ["…なにかご用でしょうか。じっと見られると、仕事がしにくいのですが。", "ご用がなければ、タスクをひとつ進めましょう。", "適度に休憩もとってくださいね。…業務効率のためです。", "お待ちしていました。…いえ、たまたまです。", "おつかれさまです。…一度しか言いませんので。", "何かあれば遠慮なくどうぞ。そのための私ですから。"];
  const W8 = { S: 1, M: 2, L: 4, XL: 8 };
  const load8 = (list) => list.reduce((n, t) => n + (W8[t.weight] || 2), 0);
  // 提案の一覧（大事な順）。acts は押せる操作、items は1件ずつ動かせるタスク
  function advise() {
    const d = TODAY(); const out = [];
    const today = inStage("today"); const late = lateOf(); const next = inStage("next"); const inbox = inStage("inbox");
    const wait = inStage("wait"); const some = inStage("some");
    if (late.length) out.push({ pri: 100, icon: "⏰", say: `遅れが${late.length}件ございます。…別に、心配しているわけではありません。予定の管理も私の仕事ですので。`, title: `遅れが ${late.length}件あります`, body: "日付を過ぎたものは、今日やるか、日を決め直すと流れが戻ります。", acts: [["late:today", "全部 今日にする"], ["late:tomorrow", "全部 明日にずらす"]], items: late.slice(0, 4), itemActs: [["d:today", "今日"], ["d:sat", "土曜"], ["s:some", "いつか"]] });
    const w = load8(today);
    if (today.length >= 8 || w > 12) {
      const heavy = today.filter((t) => ["L", "XL"].includes(t.weight) || !t.weight).slice(0, 4);
      out.push({ pri: 90, icon: "🧺", say: `本日${today.length}件は詰め込みすぎです。重いものは明日以降へ回しましょう。…倒れられては、私が困りますので。`, title: `今日が詰まっています（${today.length}件・重さ ${w}）`, body: "1日に終わるのは重さ12くらいまで。重いものを明日以降へ回して、終わる量に絞りましょう。", items: heavy.length ? heavy : today.slice(0, 4), itemActs: [["d:tomorrow", "明日へ"], ["d:mon", "来週月"], ["s:some", "いつか"]] });
    }
    if (!today.length && next.length) {
      const pick = next.slice().sort((a, b) => (W8[a.weight] || 2) - (W8[b.weight] || 2) || ageOf(b) - ageOf(a)).slice(0, 3);
      out.push({ pri: 85, icon: "🎯", say: "本日の予定がまだ決まっていません。候補を3つ選んでおきました。…仕方なく、ですけれど。", title: "今日やることが決まっていません", body: "次にやるから軽いもの・古いものを3つ選びました。今日に入れてみませんか。", items: pick, itemActs: [["d:today", "今日やる"], ["d:tomorrow", "明日"]] });
    }
    const mine = myTurn();
    if (mine.length) out.push({ pri: 80, icon: "💬", say: "AIからの返事がお待ちです。お返事は早めにお願いします。待たせるのは失礼ですよ。", title: `AIからの返事が ${mine.length}件 待っています`, body: "回答（💭）や判定（🔍✅）を返すと、次の定時処理でAIが続きを進めます。", acts: [["tab:ai", "AIの番を見る"]] });
    const oldIn = inbox.filter((t) => ageOf(t) >= 3);
    if (inbox.length >= 10 || oldIn.length) out.push({ pri: 70, icon: "📥", say: `収集箱に${inbox.length}件たまっています。5分ほど仕分けしませんか。…お付き合いしますので。`, title: `収集箱に ${inbox.length}件${oldIn.length ? `（3日以上 ${oldIn.length}件）` : ""}`, body: "1件ずつ「やる・いつか・AI・資料」に振り分けると頭が軽くなります。5分だけ仕分けしましょう。", acts: [["triage:inbox", "仕分けを始める"]] });
    const noStep = next.filter((t) => !t.next);
    if (noStep.length >= 3) out.push({ pri: 60, icon: "👣", say: "次の一歩が空欄のタスクがあります。最初の一手だけでも書いておいていただけますか。", title: `次の一歩が空のタスクが ${noStep.length}件`, body: "「最初に何をするか」が書いてあると手が動きます。開いて一歩を書くか、AIに分解を頼みましょう。", items: noStep.slice(0, 3), itemActs: [["open", "開く"], ["a:💬", "AIと分解"]] });
    const stale = next.filter((t) => ageOf(t) >= 14);
    if (stale.length) out.push({ pri: 55, icon: "🕸", say: "2週間動いていないタスクがあります。進めるのか見送るのか、ご判断をお願いします。", title: `2週間動いていない「次にやる」が ${stale.length}件`, body: "やらないなら いつか へ、迷っているなら AI に調べてもらうと進みます。", items: stale.slice(0, 3), itemActs: [["d:today", "今日"], ["s:some", "いつか"], ["a:🔍", "AIに調べて"]] });
    const longWait = wait.filter((t) => ageOf(t) >= 7);
    if (longWait.length) out.push({ pri: 50, icon: "📮", say: "1週間以上お待ちの件があります。確認のご連絡を入れても失礼にはあたりませんよ。", title: `1週間以上の待ちが ${longWait.length}件`, body: "相手に確かめる日を決めておくと抜けません。", items: longWait.slice(0, 3), itemActs: [["d:tomorrow", "明日確認"], ["s:next", "自分で進める"]] });
    const soon = typeof stockSoon === "function" ? stockSoon() : [];
    if (soon.length) out.push({ pri: 45, icon: "🛒", say: "日用品がもうすぐ切れます。切らしてから慌てても、私は知りませんからね。", title: `もうすぐ切れる日用品が ${soon.length}点`, body: soon.slice(0, 3).map((x) => `${x.name}（${leftTx(x)}）`).join("・"), acts: [["shop:stock", "在庫を見る"]] });
    const buyToday = shopLists().filter((t) => t.date && t.date <= d);
    if (buyToday.length) out.push({ pri: 44, icon: "🧾", say: "本日は買い物の予定がございます。リストのお忘れなく。…念のため、です。", title: `今日の買い物リストが ${buyToday.length}件`, body: buyToday.map((t) => t.name).join("・"), acts: [["shop:list", "買い物リストを開く"]] });
    if (some.length >= 20 && [5, 6, 0].includes(dow(d))) out.push({ pri: 30, icon: "🕰", say: "週末ですので、いつかの見直しをおすすめします。…お手伝いしてもかまいません。", title: `週末の見直し：いつか ${some.length}件`, body: "今週やりたくなったものを次にやるへ戻しましょう。", acts: [["triage:some", "いつかを見直す"]] });
    const dg = S.diag.at(-1);
    if (dg?.next) out.push({ pri: 20, icon: "🩺", say: "前回の診断で決めた次の一手です。お忘れではないかと思いまして。", title: "前回の診断の「次の一手」", body: dg.next, acts: [["tab:log", "診断を見る"]] });
    if (!out.some((x) => x.pri >= 50)) out.push({ pri: 10, icon: "✨", say: S.doneToday.length ? `本日はもう${S.doneToday.length}件完了しています。…お見事です。べ、別にほめているわけでは。` : "今のところ問題ございません。…別に、ほめているわけではありませんので。", title: S.doneToday.length ? `今日は ${S.doneToday.length}件 終わりました。いい流れです` : "流れは整っています", body: today.length ? `今日の残り ${today.length}件。上から1つずつどうぞ。` : "余裕があれば、次にやるから1つ今日に入れてみましょう。", acts: today.length ? [["stage:today", "今日の一覧"]] : [["stage:next", "次にやるを見る"]] });
    return out.sort((a, b) => b.pri - a.pri);
  }
  const adviceTop = () => (S.mode === "loading" && !S.tasks.length ? null : advise()[0]);
  function sayNow(list = advise()) {
    const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
    if (h >= 23 || h < 5) return "まだ起きていらしたんですか。明日に響きますので、そろそろお休みください。…心配ではなく、業務上の助言です。";
    return list[0]?.say || IDLE[0];
  }
  document.documentElement.style.setProperty("--bgimg", `url("${SCENE_BG}")`);
  // 好感度（ハート5つ）：今日終えた数で上がり、遅れ・たまった収集箱で下がる
  function loveLv() {
    if (S.mode === "loading" && !S.tasks.length) return 3;
    const late = lateOf().length; const inbox = inStage("inbox").length;
    return Math.max(0, Math.min(5, 2 + Math.min(2, Math.floor(S.doneToday.length / 2)) + (late ? -1 : 1) + (inbox >= 10 ? -1 : 0)));
  }
  const loveHtml = () => { const n = loveLv(); return `<span style="font-size:10px;margin-right:4px;color:var(--mute);letter-spacing:0">好感度</span>${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? "" : "off"}">♥</i>`).join("")}`; };
  function greetLine() {
    const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
    if (h >= 23 || h < 5) return sayNow();
    if (lateOf().length >= 3) return BOND_SULK[Math.min(bondLv(), 4) - 1];
    return BOND_GREET[bondLv() - 1][h < 11 ? 0 : h < 17 ? 1 : 2];
  }
  // ---- 会話の場面：背景・全身のセレナ・メッセージ窓・選択肢（ギャルゲーの画面） ----
  let lines = [], lineAt = 0, typing = null;
  const REACT = ["かしこまりました。…べ、別にあなたのためではありません。", "承知しました。こういうのは、早いほうがいいですから。", "はい、やっておきました。…お礼は結構です。"];
  function openConcierge(panel = "") {
    const o = outfit(); const list = advise(); const auto = !store.get("outfit") || store.get("outfit") === "auto";
    const ev = pendingEvent(); if (ev && !panel) { playEvent(ev); return; }
    const lv = bondLv(); const up = panel ? "" : levelUpLine();
    lines = [...(up ? [up] : []), greetLine(), ...list.map((x) => callName(x.say)).filter(Boolean), ...BOND_IDLE[lv - 1]]; lineAt = 0;
    const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
    const tint = h < 5 || h >= 21 ? "rgba(16,6,44,.42)" : h < 10 ? "rgba(255,214,190,.10)" : h >= 17 ? "rgba(255,120,170,.12)" : "rgba(0,0,0,0)";
    const choices = list.slice(0, 3).map((x, i) => x.acts?.length ? `<button type="button" data-cact="${x.acts[0][0]}">${x.icon} ${esc(x.acts[0][1])}</button>` : `<button type="button" data-scenelog="${i}">${x.icon} ${esc(short(x.title, 20))}</button>`).join("");
    const sc = $("#scene"); sc.hidden = false;
    sc.innerHTML = `<div class="tint" style="background:${tint}"></div>
      <div class="sbar"><span class="love">${loveHtml()}</span>${bondHtml()}<span class="sp"></span><button type="button" data-scenelog="-1">LOG</button><button type="button" data-scenepanel="album">思い出</button><button type="button" data-avpick="1">着替え</button><button type="button" data-sceneclose="1">とじる</button></div>
      <div class="chara"><div class="floor"></div><canvas id="serena" role="img" aria-label="${CNAME}（${esc(o.label)}）"></canvas></div>
      <div class="msgwrap"><div class="choices" id="choices" hidden>${choices}<button type="button" data-sceneclose="1">あとで</button></div>
        <div class="msg" id="msgbox"><span class="nameplate">${CNAME}<small>${esc(o.label)}${auto ? "" : "（固定）"}</small></span><div class="line" id="sayline"></div><span class="next" aria-hidden="true">▼</span><span class="menu2"><button type="button" data-scenelog="-1">LOG</button><button type="button" data-avpick="1">CLOSET</button></span></div></div>
      ${panel === "closet" ? closetHtml(o, auto) : panel === "album" ? albumHtml() : panel.startsWith("log") ? logHtml(list, +panel.split(":")[1] || 0) : ""}`;
    serena.mount($("#serena"), o, lv >= 3 && lateOf().length < 3);
    if (up) serena.blush(5000);
    typeLine(lines[0], () => { $("#choices") && ($("#choices").hidden = false); });
    $("#msgbox").onclick = (e) => { if (e.target.closest(".menu2")) return; nextLine(); };
  }
  function closeScene() { const sc = $("#scene"); sc.hidden = true; sc.innerHTML = ""; clearInterval(typing); render(); }
  function typeLine(text, done) {
    const el = $("#sayline"); if (!el) return; clearInterval(typing);
    if (reduce) { el.textContent = text; done?.(); return; }
    let i = 0; el.textContent = "";
    typing = setInterval(() => { i += 1; el.textContent = text.slice(0, i); if (i >= text.length) { clearInterval(typing); typing = null; done?.(); } }, 32);
    typeLine.full = text; typeLine.done = done;
  }
  function nextLine() {
    if (typing) { clearInterval(typing); typing = null; $("#sayline").textContent = typeLine.full; typeLine.done?.(); return; }
    lineAt = (lineAt + 1) % lines.length; serena.hop(); typeLine(lines[lineAt]);
  }
  function sayReact(text) { serena.hop(); if (bondLv() >= 2) serena.blush(); const r = BOND_REACT[bondLv() - 1]; typeLine(text || r[Math.floor(Math.random() * r.length)]); }
  function closetHtml(o, auto) {
    return `<div class="panel2"><h3>👗 クローゼット<button type="button" data-scenepanel="">もどる</button></h3><div class="body"><div class="wardrobe"><button type="button" data-outfit="auto" aria-pressed="${auto}"><span class="auto">AUTO</span><b>自動</b><small>季節と時間で</small></button>${OUTFITS.map((x) => `<button type="button" data-outfit="${x.key}" aria-pressed="${!auto && x.key === o.key}"><span class="face" style="${faceStyle(x, 52)}"></span><b>${esc(x.label)}</b><small>${esc(x.when)}</small></button>`).join("")}</div></div></div>`;
  }
  function logHtml(list, at) {
    const itemRow = (t, acts) => `<div class="crow" data-qt="${t.id}"><button type="button" class="cname" data-mopen="${t.id}">${esc(short(t.name, 26))}<small>${esc(metaOf(t).tx)}${t.weight ? `・${t.weight}` : ""}</small></button><span class="cacts">${acts.map(([k, n]) => k === "open" ? `<button type="button" class="qc" data-mopen="${t.id}">${n}</button>` : `<button type="button" class="qc" data-qk="${k}">${n}</button>`).join("")}</span></div>`;
    return `<div class="panel2"><h3>📜 セレナからの提案<button type="button" data-scenepanel="">もどる</button></h3><div class="body"><div class="clist">${list.map((x, i) => `<section class="csug" ${i === at ? 'id="logat"' : ""}><h4><span>${x.icon}</span>${esc(x.title)}</h4><p>${esc(x.body)}</p>${(x.items || []).map((t) => itemRow(t, x.itemActs)).join("")}${x.acts ? `<div class="sfoot">${x.acts.map(([k, n], j) => `<button type="button" class="btn${j ? "" : " pri"}" data-cact="${k}">${n}</button>`).join("")}</div>` : ""}</section>`).join("")}</div></div></div>`;
  }
  // 1日1回、最初に開いたときにあいさつに出てくる
  function maybeGreet() {
    if (store.get("greet") === TODAY() || !$("#page").hidden || !$("#scene").hidden) return;
    store.set("greet", TODAY()); openConcierge();
  }
  // ---- 動き：全身の絵を細い横帯に切って、帯ごとにずらす（足は固定・上ほど揺れる・胸は呼吸でふくらむ・髪は遅れて揺れる） ----
  const serena = (() => {
    let cv, ctx, img, img2, o, raf = 0, hop = 0, t0 = performance.now(), smile = 0, want = 0, smileUntil = 0;
    const ease = (x) => x * x * (3 - 2 * x);
    function draw(im, alpha, t, now, Wc, Hc, dpr) {
      if (alpha <= .01 || !im?.naturalWidth) return;
      const w = im.naturalWidth, h = im.naturalHeight; ctx.globalAlpha = alpha;
      const sc = (Hc * 0.97) / h; const dw = w * sc; const x0 = (Wc - dw) / 2; const base = Hc;
      const br = Math.sin(t * 2 * Math.PI / 3.8); const sw = Math.sin(t * 2 * Math.PI / 5.6); const hair = Math.sin(t * 2 * Math.PI / 5.6 - .9);
      const hp = hop > now ? Math.sin(((hop - now) / 420) * Math.PI) : 0; // 押したときの小さな跳ね
      const strip = 2 * dpr; const n = Math.ceil((h * sc) / strip);
      for (let i = 0; i < n; i++) {
        const yd = i * strip; const v = yd / (h * sc); // 0＝頭 1＝足
        const up = 1 - v; const k = Math.pow(up, 1.7);
        const dx = sw * 3.2 * dpr * k + (v < .2 ? hair * 2.4 * dpr * ease(1 - v / .2) : 0);
        const chest = v > .16 && v < .42 ? Math.sin(((v - .16) / .26) * Math.PI) : 0;
        const sx = 1 + br * .012 * chest; const lift = (br * 1.4 * dpr + hp * 10 * dpr) * ease(Math.min(1, up / .55));
        const w2 = dw * sx; const sy = yd / sc; const sh = Math.min(strip / sc + .6, h - sy); if (sh <= 0) break;
        ctx.drawImage(im, 0, sy, w, sh, x0 + dx - (w2 - dw) / 2, base - h * sc * (1 + hp * .015) + yd * (1 + hp * .015) - lift, w2, strip * (1 + hp * .015) + .6);
      }
      ctx.globalAlpha = 1;
    }
    function frame(now) {
      raf = 0; if (!cv?.isConnected) { cv = null; return; }
      const dpr = Math.min(2, devicePixelRatio || 1); const Hc = cv.clientHeight * dpr, Wc = cv.clientWidth * dpr;
      if (cv.width !== Wc || cv.height !== Hc) { cv.width = Wc; cv.height = Hc; }
      ctx.clearRect(0, 0, Wc, Hc);
      const target = smileUntil > now ? 1 : want; smile += (target - smile) * .08; if (Math.abs(target - smile) < .01) smile = target;
      const t = (now - t0) / 1000;
      draw(img, smile >= .99 && img2?.naturalWidth ? 0 : 1, t, now, Wc, Hc, dpr);
      draw(img2, smile, t, now, Wc, Hc, dpr);
      if (!reduce && !document.hidden) raf = requestAnimationFrame(frame);
      else if (smile !== target) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (cv && !raf) raf = requestAnimationFrame(frame); };
    function mount(el, of, smiling = false) {
      cv = el; ctx = cv.getContext("2d"); o = of; img = new Image(); img.onload = kick; img.src = o.img;
      img2 = o.smile ? Object.assign(new Image(), { onload: kick, src: o.smile }) : null;
      want = smiling ? 1 : 0; smile = want;
      cv.onclick = () => nextLine();
      kick();
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });
    return { mount, hop() { hop = performance.now() + 420; kick(); }, blush(ms = 3200) { smileUntil = performance.now() + ms; kick(); }, setSmile(v) { want = v ? 1 : 0; kick(); } };
  })();
  async function conciergeAct(k) {
    const [kind, v] = k.split(":");
    const inScene = !$("#scene").hidden;
    if (kind === "late") {
      const late = lateOf(); const d = v === "today" ? TODAY() : addDays(TODAY(), 1);
      if (inScene) { $("#choices") && ($("#choices").hidden = true); sayReact(`遅れの${late.length}件を${v === "today" ? "本日" : "明日"}に移しました。…今度は遅れないでくださいね。`); }
      else closeModal();
      for (const t of late) await setProps(t, dateProps(d), `遅れ ${late.length}件を${v === "today" ? "今日" : "明日"}にしました`, { undo: false, quiet: t !== late[0] });
      $("#scene .love") && ($("#scene .love").innerHTML = loveHtml());
      return;
    }
    const go = () => {
      if (kind === "tab") { S.tab = v; }
      else if (kind === "stage") { S.tab = "flow"; S.stage = v; }
      else if (kind === "triage") { S.tab = "triage"; S.pileKey = v === "some" ? "some" : "inbox"; }
      else if (kind === "shop") { S.tab = "shop"; S.shopSeg = v; }
      if (inScene) closeScene(); else { closeModal(); render(); }
    };
    if (inScene) { sayReact(); setTimeout(go, 900); } else go();
  }
  function renderConciergeFab() {
    const b = $("#cfab"); if (!b) return;
    const n = S.mode === "loading" ? 0 : advise().filter((x) => x.pri >= 50).length;
    b.innerHTML = `<span class="face" style="${faceStyle(outfit(), 54)}"></span>${n ? `<span class="badge">${n}</span>` : ""}`;
    b.hidden = S.tab === "flow";
    const lv = $("#love"); if (lv) lv.innerHTML = loveHtml();
  }
