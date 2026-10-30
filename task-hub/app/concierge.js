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
  const IDLE = ["な、何よ。じっと見ないで。", "用がないなら手を動かしなさいよ。", "…ちゃんと休憩もしなさいよね。", "べ、別にあなたのために待ってたわけじゃないから。", "タスク、1つでいいから片づけてきなさいよ。", "…今日もおつかれさま。い、一回しか言わないから。"];
  const W8 = { S: 1, M: 2, L: 4, XL: 8 };
  const load8 = (list) => list.reduce((n, t) => n + (W8[t.weight] || 2), 0);
  // 提案の一覧（大事な順）。acts は押せる操作、items は1件ずつ動かせるタスク
  function advise() {
    const d = TODAY(); const out = [];
    const today = inStage("today"); const late = lateOf(); const next = inStage("next"); const inbox = inStage("inbox");
    const wait = inStage("wait"); const some = inStage("some");
    if (late.length) out.push({ pri: 100, icon: "⏰", say: `…遅れが${late.length}件あるんだけど。べ、別に心配してるわけじゃないから。`, title: `遅れが ${late.length}件あります`, body: "日付を過ぎたものは、今日やるか、日を決め直すと流れが戻ります。", acts: [["late:today", "全部 今日にする"], ["late:tomorrow", "全部 明日にずらす"]], items: late.slice(0, 4), itemActs: [["d:today", "今日"], ["d:sat", "土曜"], ["s:some", "いつか"]] });
    const w = load8(today);
    if (today.length >= 8 || w > 12) {
      const heavy = today.filter((t) => ["L", "XL"].includes(t.weight) || !t.weight).slice(0, 4);
      out.push({ pri: 90, icon: "🧺", say: `ちょっと、今日${today.length}件も詰めすぎ。倒れられたら困るのよ…わたしが。`, title: `今日が詰まっています（${today.length}件・重さ ${w}）`, body: "1日に終わるのは重さ12くらいまで。重いものを明日以降へ回して、終わる量に絞りましょう。", items: heavy.length ? heavy : today.slice(0, 4), itemActs: [["d:tomorrow", "明日へ"], ["d:mon", "来週月"], ["s:some", "いつか"]] });
    }
    if (!today.length && next.length) {
      const pick = next.slice().sort((a, b) => (W8[a.weight] || 2) - (W8[b.weight] || 2) || ageOf(b) - ageOf(a)).slice(0, 3);
      out.push({ pri: 85, icon: "🎯", say: "今日やること、決めてないでしょ。しょうがないから3つ選んであげたわよ。", title: "今日やることが決まっていません", body: "次にやるから軽いもの・古いものを3つ選びました。今日に入れてみませんか。", items: pick, itemActs: [["d:today", "今日やる"], ["d:tomorrow", "明日"]] });
    }
    const mine = myTurn();
    if (mine.length) out.push({ pri: 80, icon: "💬", say: "AIが返事を待ってるわよ。人を待たせるなんて、いい度胸ね。", title: `AIからの返事が ${mine.length}件 待っています`, body: "回答（💭）や判定（🔍✅）を返すと、次の定時処理でAIが続きを進めます。", acts: [["tab:ai", "AIの番を見る"]] });
    const oldIn = inbox.filter((t) => ageOf(t) >= 3);
    if (inbox.length >= 10 || oldIn.length) out.push({ pri: 70, icon: "📥", say: `収集箱、${inbox.length}件もたまってる。…5分だけなら付き合ってあげてもいいけど。`, title: `収集箱に ${inbox.length}件${oldIn.length ? `（3日以上 ${oldIn.length}件）` : ""}`, body: "1件ずつ「やる・いつか・AI・資料」に振り分けると頭が軽くなります。5分だけ仕分けしましょう。", acts: [["triage:inbox", "仕分けを始める"]] });
    const noStep = next.filter((t) => !t.next);
    if (noStep.length >= 3) out.push({ pri: 60, icon: "👣", say: "次の一歩が空っぽのタスクがあるの。何から手をつけるかくらい書いておきなさいよ。", title: `次の一歩が空のタスクが ${noStep.length}件`, body: "「最初に何をするか」が書いてあると手が動きます。開いて一歩を書くか、AIに分解を頼みましょう。", items: noStep.slice(0, 3), itemActs: [["open", "開く"], ["a:💬", "AIと分解"]] });
    const stale = next.filter((t) => ageOf(t) >= 14);
    if (stale.length) out.push({ pri: 55, icon: "🕸", say: "2週間も放っておいたのがあるわね。やるの？やらないの？はっきりして。", title: `2週間動いていない「次にやる」が ${stale.length}件`, body: "やらないなら いつか へ、迷っているなら AI に調べてもらうと進みます。", items: stale.slice(0, 3), itemActs: [["d:today", "今日"], ["s:some", "いつか"], ["a:🔍", "AIに調べて"]] });
    const longWait = wait.filter((t) => ageOf(t) >= 7);
    if (longWait.length) out.push({ pri: 50, icon: "📮", say: "1週間以上待たされてるの、あるでしょ。…催促くらい、してもいいのよ。", title: `1週間以上の待ちが ${longWait.length}件`, body: "相手に確かめる日を決めておくと抜けません。", items: longWait.slice(0, 3), itemActs: [["d:tomorrow", "明日確認"], ["s:next", "自分で進める"]] });
    const soon = typeof stockSoon === "function" ? stockSoon() : [];
    if (soon.length) out.push({ pri: 45, icon: "🛒", say: "日用品、もうすぐ切れるわよ。切らしてから慌てても知らないんだから。", title: `もうすぐ切れる日用品が ${soon.length}点`, body: soon.slice(0, 3).map((x) => `${x.name}（${leftTx(x)}）`).join("・"), acts: [["shop:stock", "在庫を見る"]] });
    const buyToday = shopLists().filter((t) => t.date && t.date <= d);
    if (buyToday.length) out.push({ pri: 44, icon: "🧾", say: "今日は買い物の日でしょ。リスト、忘れないでよね。", title: `今日の買い物リストが ${buyToday.length}件`, body: buyToday.map((t) => t.name).join("・"), acts: [["shop:list", "買い物リストを開く"]] });
    if (some.length >= 20 && [5, 6, 0].includes(dow(d))) out.push({ pri: 30, icon: "🕰", say: "週末なんだから、いつかの山くらい見直したら？…手伝ってあげなくもないわ。", title: `週末の見直し：いつか ${some.length}件`, body: "今週やりたくなったものを次にやるへ戻しましょう。", acts: [["triage:some", "いつかを見直す"]] });
    const dg = S.diag.at(-1);
    if (dg?.next) out.push({ pri: 20, icon: "🩺", say: "前の診断で決めた次の一手、覚えてる？…覚えてないと思ったわ。", title: "前回の診断の「次の一手」", body: dg.next, acts: [["tab:log", "診断を見る"]] });
    if (!out.some((x) => x.pri >= 50)) out.push({ pri: 10, icon: "✨", say: S.doneToday.length ? `ふん、今日はもう${S.doneToday.length}件も終わってるじゃない。…やればできるのね。` : "今のところ問題なし。…べ、別にほめてないから。", title: S.doneToday.length ? `今日は ${S.doneToday.length}件 終わりました。いい流れです` : "流れは整っています", body: today.length ? `今日の残り ${today.length}件。上から1つずつどうぞ。` : "余裕があれば、次にやるから1つ今日に入れてみましょう。", acts: today.length ? [["stage:today", "今日の一覧"]] : [["stage:next", "次にやるを見る"]] });
    return out.sort((a, b) => b.pri - a.pri);
  }
  const adviceTop = () => (S.mode === "loading" && !S.tasks.length ? null : advise()[0]);
  function sayNow(list = advise()) {
    const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
    if (h >= 23 || h < 5) return "まだ起きてるの？…明日に響くわよ。早く寝なさい。";
    return list[0]?.say || IDLE[0];
  }
  let lines = [], lineAt = 0;
  function openConcierge(pickOutfit = false) {
    const o = outfit(); const list = advise(); const auto = !store.get("outfit") || store.get("outfit") === "auto";
    lines = [...list.map((x) => x.say).filter(Boolean), ...IDLE]; lineAt = 0;
    const itemRow = (t, acts) => `<div class="crow" data-qt="${t.id}"><button type="button" class="cname" data-mopen="${t.id}">${esc(short(t.name, 26))}<small>${esc(metaOf(t).tx)}${t.weight ? `・${t.weight}` : ""}</small></button><span class="cacts">${acts.map(([k, n]) => k === "open" ? `<button type="button" class="qc" data-mopen="${t.id}">${n}</button>` : `<button type="button" class="qc" data-qk="${k}">${n}</button>`).join("")}</span></div>`;
    modal(`<div class="concierge"><div class="stage"><canvas id="serena" aria-label="${CNAME}（${esc(o.label)}）" role="img"></canvas><div class="say"><div class="cn">${CNAME}<small>${esc(o.label)}${auto ? `・${esc(o.when)}` : "・固定"}</small></div><p id="sayline">${esc(sayNow(list))}</p><button type="button" class="cswap" data-avpick="1">👗 着替え</button></div></div>
      ${pickOutfit ? `<div class="wardrobe"><button type="button" data-outfit="auto" aria-pressed="${auto}"><span class="auto">AUTO</span><b>自動</b><small>季節と時間で</small></button>${OUTFITS.map((x) => `<button type="button" data-outfit="${x.key}" aria-pressed="${!auto && x.key === o.key}"><span class="face" style="${faceStyle(x, 52)}"></span><b>${esc(x.label)}</b><small>${esc(x.when)}</small></button>`).join("")}</div>` : ""}
      <div class="clist">${list.map((x) => `<section class="csug"><h4><span>${x.icon}</span>${esc(x.title)}</h4><p>${esc(x.body)}</p>${(x.items || []).map((t) => itemRow(t, x.itemActs)).join("")}${x.acts ? `<div class="sfoot">${x.acts.map(([k, n], i) => `<button type="button" class="btn${i ? "" : " pri"}" data-cact="${k}">${n}</button>`).join("")}</div>` : ""}</section>`).join("")}</div>
      <div class="form" style="padding-top:0"><button type="button" class="btn" data-mclose="1">閉じる</button></div></div>`);
    serena.mount($("#serena"), o);
  }
  // ---- 動き：全身の絵を細い横帯に切って、帯ごとにずらす（足は固定・上ほど揺れる・胸は呼吸でふくらむ・髪は遅れて揺れる） ----
  const serena = (() => {
    let cv, ctx, img, o, raf = 0, hop = 0, t0 = performance.now();
    const ease = (x) => x * x * (3 - 2 * x);
    function frame(now) {
      raf = 0; if (!cv?.isConnected) { cv = null; return; }
      const dpr = Math.min(2, devicePixelRatio || 1); const Hc = cv.clientHeight * dpr, Wc = cv.clientWidth * dpr;
      if (cv.width !== Wc || cv.height !== Hc) { cv.width = Wc; cv.height = Hc; }
      ctx.clearRect(0, 0, Wc, Hc);
      if (!img.complete || !img.naturalWidth) { raf = requestAnimationFrame(frame); return; }
      const t = (now - t0) / 1000; const sc = (Hc * 0.97) / o.h; const dw = o.w * sc; const x0 = (Wc - dw) / 2; const base = Hc;
      const br = Math.sin(t * 2 * Math.PI / 3.8); const sw = Math.sin(t * 2 * Math.PI / 5.6); const hair = Math.sin(t * 2 * Math.PI / 5.6 - .9);
      const hp = hop > now ? Math.sin(((hop - now) / 420) * Math.PI) : 0; // 押したときの小さな跳ね
      const strip = 2 * dpr; const n = Math.ceil((o.h * sc) / strip);
      for (let i = 0; i < n; i++) {
        const yd = i * strip; const v = yd / (o.h * sc); // 0＝頭 1＝足
        const up = 1 - v; const k = Math.pow(up, 1.7);
        let dx = sw * 3.2 * dpr * k + (v < .2 ? hair * 2.4 * dpr * ease(1 - v / .2) : 0);
        const chest = v > .16 && v < .42 ? Math.sin(((v - .16) / .26) * Math.PI) : 0;
        const sx = 1 + br * .012 * chest; const lift = (br * 1.4 * dpr + hp * 10 * dpr) * ease(Math.min(1, up / .55));
        const w2 = dw * sx; const sy = yd / sc; const sh = Math.min(strip / sc + .6, o.h - sy); if (sh <= 0) break;
        ctx.drawImage(img, 0, sy, o.w, sh, x0 + dx - (w2 - dw) / 2, base - o.h * sc * (1 + hp * .015) + yd * (1 + hp * .015) - lift, w2, strip * (1 + hp * .015) + .6);
      }
      if (!reduce && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function mount(el, of) {
      cv = el; ctx = cv.getContext("2d"); o = of; img = new Image(); img.src = o.img; img.onload = () => { if (!raf) raf = requestAnimationFrame(frame); };
      cv.onclick = () => { hop = performance.now() + 420; const p = $("#sayline"); if (p) { lineAt = (lineAt + 1) % lines.length; p.classList.remove("pop"); void p.offsetWidth; p.textContent = lines[lineAt]; p.classList.add("pop"); } if (!raf) raf = requestAnimationFrame(frame); };
      if (!raf) raf = requestAnimationFrame(frame);
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden && cv && !raf) raf = requestAnimationFrame(frame); });
    return { mount };
  })();
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
    b.innerHTML = `<span class="face" style="${faceStyle(outfit(), 54)}"></span>${n ? `<span class="badge">${n}</span>` : ""}`;
    b.hidden = S.tab === "flow";
  }
