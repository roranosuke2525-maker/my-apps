  // ================= 運用：使い方（運用マップの要約と図解）と、診断（週次レポート＋いまの健康診断と直し方） =================
  const MAP_PAGE = "3f662844acbe8183834dfcb4cff0883f"; // Notion運用マップ
  const DIAG_SKILL = "3fe62844acbe81daa72cf3e2b438d207"; // 🩺 タスク運用診断（10項目の正本）
  const notionUrl = (id) => `https://www.notion.so/${id}`;

  // ---- 使い方：図でひと目で ----
  function renderGuide(view) {
    const box = document.createElement("div"); box.className = "card panel"; box.innerHTML = `<div class="scroll guide" id="guide">${guideHtml()}</div>`; view.append(box);
    loadMapMeta();
  }
  function guideHtml() {
    const m = S.mapMeta;
    return `
      <section class="g-sec"><h3>ひとことで</h3>
        <div class="g-roles">
          <div class="g-role" style="--c:var(--s-next)"><b>👤 自分</b><p>入れる・AIに預ける・<em>行き先を決める</em>・NEXTをやる</p></div>
          <div class="g-role" style="--c:var(--s-ai)"><b>🤖 AI</b><p>調べる・整理・質問・ToDoとNEXTを作る。<em>ステータスは変えない</em></p></div>
          <div class="g-role" style="--c:var(--s-today)"><b>⏰ 時間</b><p>平日の日中は毎時AIが動く。朝ニュース・夜ジャーナル・月曜診断</p></div>
        </div></section>

      <section class="g-sec"><h3>① タスクの一生</h3>
        <div class="g-flow">
          <div class="g-node" style="--c:var(--mute)">入口<small>Claudeに相談・🔍ボタン・この画面の＋</small></div>
          <div class="g-arr"></div>
          <div class="g-node" style="--c:var(--s-inbox)">📥 INBOX<small>まず入れるだけ</small></div>
          <div class="g-arr"></div>
          <div class="g-node" style="--c:var(--s-ai)">🤖 AIに預ける<small>🔍 調べて・💬 深掘り・🔬 徹底調査</small></div>
          <div class="g-arr"></div>
          <div class="g-node strong" style="--c:var(--accent)">👤 自分が行き先を決める</div>
          <div class="g-branch">
            <div class="g-leaf" style="--c:var(--s-next)"><b>⏭ NEXT</b><small>やる</small></div>
            <div class="g-leaf" style="--c:var(--s-ref)"><b>📚 REFERENCE</b><small>資料で完結</small></div>
            <div class="g-leaf" style="--c:var(--s-some)"><b>🕰 SOMEDAY</b><small>今はやめ</small></div>
            <div class="g-leaf" style="--c:var(--s-wait)"><b>⏳ WAITING</b><small>返事待ち</small></div>
          </div>
          <div class="g-arr" style="margin-left:12%"></div>
          <div class="g-row"><div class="g-node" style="--c:var(--s-today)">☀️ 今日やる<small>実行日＝今日・枠で分ける</small></div><span class="g-to">→</span><div class="g-node" style="--c:var(--s-done)">✅ DONE</div></div>
        </div></section>

      <section class="g-sec"><h3>② AIの印（誰の番か）</h3>
        <div class="g-cycle">
          <div class="g-pair"><span class="g-chip ai">🔍 調べて</span><span class="g-a">→</span><span class="g-chip me">🔍✅ 判定待ち</span></div>
          <div class="g-pair"><span class="g-chip ai">🔬 徹底調査</span><span class="g-a">→</span><span class="g-chip me">🔍✅ 判定待ち</span><small>1回1件・市場を網羅</small></div>
          <div class="g-pair"><span class="g-chip ai">💬 深掘り</span><span class="g-a">⇄</span><span class="g-chip me">💭 回答待ち</span><small>明確度90%でまとめ</small></div>
          <div class="g-pair"><span class="g-chip me">🔍✅</span><span class="g-a">→</span><span class="g-chip ai">🔍 に戻す</span><small>「こうしたい」を書いて再調査</small></div>
          <div class="g-pair"><span class="g-chip ai">🛠 アプリ修正</span><span class="g-a">→</span><span class="g-chip me">🛠✅ 確認</span><small>毎時41分に直して反映・記録はトグル</small></div>
          <div class="g-pair"><span class="g-chip me">🛠💭 質問</span><span class="g-a">→</span><span class="g-chip ai">答えて 🛠 に戻す</span></div>
        </div>
        <div class="g-legend"><span class="g-chip ai">AIの番</span>定時処理が拾う　<span class="g-chip me">自分の番</span>AIは触らない</div></section>

      <section class="g-sec"><h3>③ 行き先の決め方</h3>
        <div class="g-grid">
          <div class="g-card" style="--c:var(--s-next)"><b>やる</b><span>⏭ NEXT</span><small>今日の枠に入れて ✅ DONE へ</small></div>
          <div class="g-card" style="--c:var(--s-ref)"><b>調べて完結・やらない</b><span>📚 REFERENCE</span><small>資料として残す</small></div>
          <div class="g-card" style="--c:var(--s-some)"><b>直感で今はやめ</b><span>🕰 SOMEDAY</span><small>理由を1行。見直し日は置かない</small></div>
          <div class="g-card" style="--c:var(--s-wait)"><b>人の返事待ち</b><span>⏳ WAITING</span><small>実行日を消す</small></div>
        </div></section>

      <section class="g-sec"><h3>④ 1日・1週間の時間割</h3>${timelineSvg()}
        <div class="g-week">
          <div><b>月</b>7:23 🩺 タスク運用診断</div>
          <div><b>火</b>19:46 ♻️ 資源ごみ（第2・4水曜の前日）</div>
          <div><b>毎月1日</b>8:10 🎯 目標の月次振り返り</div>
          <div><b>毎日</b>7:41〜23:41 毎時 🛠 アプリ修正</div>
          <div><b>土日祝</b>AIリサーチは休み（ジャーナル・読書辞典・アプリ修正は動く）</div>
        </div></section>

      <section class="g-sec"><h3>⑤ AIとの約束</h3>
        <ul class="g-rules">
          <li><b>ステータスと実行日は変えない</b>（行き先は必ず自分）</li>
          <li><b>自分で書いたNEXTは上書きしない</b>・勝手にDONEにしない</li>
          <li>空欄の重さ・分類タグ・枠だけ埋める</li>
          <li>調査結果は ⭐おすすめ → 📊比較表 → ▶️次の手順、詳しくはトグル</li>
          <li>別の日の手作業（購入・申込・連絡）は新しい行にしてよい（1回5件まで）</li>
        </ul></section>

      <section class="g-sec"><h3>⑥ 入口と置き場</h3>
        <div class="g-grid two">
          <div class="g-card" style="--c:var(--accent)"><b>入口</b><small>Claudeに相談（手作業は自動でタスク化）／MEの「🔍 調べて」ボタン／既存タスクに🔍💬🔬／スマホで「深掘り」と送る／この画面の＋</small></div>
          <div class="g-card" style="--c:var(--accent)"><b>正本はNotion</b><small>DB_スキル（設定・スキル・定期実行）をClaudeが最初に読む。動くたびに DB_運用ログ、週1で DB_診断レポート</small></div>
        </div></section>

      <section class="g-sec g-foot">
        ${m ? `<p class="mute">運用マップの最終更新：${esc(m.updated || "—")}</p>${m.recent?.length ? `<div class="g-recent"><b>最近の仕組み変更</b>${m.recent.map((r) => `<div><span>${esc(r.d)}</span>${esc(r.t)}</div>`).join("")}</div>` : ""}` : `<p class="mute">${S.mode === "demo" ? "見本：Notionの運用マップは読んでいません" : "運用マップを読みこみ中…"}</p>`}
        <div class="sfoot"><a class="btn pri" href="${notionUrl(MAP_PAGE)}" target="_blank" rel="noopener">運用マップを開く（全文）</a><a class="btn" href="${notionUrl(DIAG_SKILL)}" target="_blank" rel="noopener">診断の10項目</a></div>
        <p class="mute" style="font-size:11px">この要約は 2026/11/01 時点の運用マップから作っています。仕組みが変わったら下の「最近の仕組み変更」と食い違うことがあります。</p>
      </section>`;
  }
  // 1日の時間割（6時〜23時の帯に、定期実行の時刻を置く）
  function timelineSvg() {
    const W = 340, H = 104, x0 = 14, x1 = 326; const X = (h) => x0 + ((h - 6) / 17) * (x1 - x0);
    const pts = [[6.78, "6:47", "🗞 ニュース", 0], [7.13, "7:08", "📖 読書辞典", 1], [20.88, "20:53", "📓 ジャーナル", 0], [21.13, "21:08", "📖 読書辞典", 1]];
    const now = new Date(Date.now() + 9 * 3600e3); const nh = now.getUTCHours() + now.getUTCMinutes() / 60;
    return `<div class="g-tl"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="1日の定期実行の時刻">
      <rect x="${X(7.87)}" y="40" width="${X(17.87) - X(7.87)}" height="16" rx="4" style="fill:var(--s-ai);opacity:.25"/>
      <text x="${(X(7.87) + X(17.87)) / 2}" y="51.5" text-anchor="middle" style="fill:var(--ink);font-size:10px">🔍 AIリサーチ　平日 7:52〜17:52 毎時</text>
      <line x1="${x0}" x2="${x1}" y1="64" y2="64" style="stroke:var(--line);stroke-width:2"/>
      ${[6, 9, 12, 15, 18, 21].map((h) => `<text x="${X(h)}" y="${H - 4}" text-anchor="middle" class="tk">${h}時</text><line x1="${X(h)}" x2="${X(h)}" y1="61" y2="67" style="stroke:var(--mute)"/>`).join("")}
      ${pts.map(([h, t, n, up]) => `<circle cx="${X(h)}" cy="64" r="3.5" style="fill:var(--s-today)"/><text x="${X(h) + (h > 18 ? -4 : 4)}" y="${up ? 82 : 28}" text-anchor="${h > 18 ? "end" : "start"}" style="fill:var(--ink);font-size:10px">${t} ${n}</text><line x1="${X(h)}" x2="${X(h)}" y1="${up ? 68 : 32}" y2="${up ? 74 : 60}" style="stroke:var(--s-today);opacity:.6"/>`).join("")}
      ${nh >= 6 && nh <= 23 ? `<line x1="${X(nh)}" x2="${X(nh)}" y1="36" y2="70" style="stroke:var(--late);stroke-width:1.5"/><text x="${X(nh)}" y="12" text-anchor="middle" style="fill:var(--late);font-size:9.5px">いま</text>` : ""}
    </svg></div>`;
  }
  // 運用マップの最終更新と、変更履歴の新しい3件
  async function loadMapMeta() {
    if (S.mapMeta || S.mode === "demo" || loadMapMeta.busy) return; loadMapMeta.busy = true;
    try {
      const raw = await fetchBody(MAP_PAGE);
      const updated = text((raw.match(/最終更新：([^\n<]+)/) || [])[1] || "");
      const recent = [...raw.matchAll(/<tr>\s*<td>\s*(\d{4}\/\d{2}\/\d{2})\s*<\/td>\s*<td>\s*([\s\S]*?)<\/td>\s*<\/tr>/g)].slice(0, 3)
        .map((m) => ({ d: m[1].slice(5), t: text(m[2].split(/<br\s*\/?>/)[0]).replace(/^・/, "").slice(0, 80) }));
      S.mapMeta = { updated, recent };
    } catch { S.mapMeta = { updated: "読めませんでした", recent: [] }; }
    loadMapMeta.busy = false;
    const g = $("#guide"); if (g && S.tab === "log" && S.logSeg === "guide") { const st = g.scrollTop; g.innerHTML = guideHtml(); g.scrollTop = st; }
  }

  // ---- 診断：いまの健康診断（読み込み済みのデータから10項目を見る）と、直し方 ----
  const RISKY = /期限|締切|締め切り|〆|支払|振込|更新|手続|申請|パスワード|セキュリティ|2段階|二段階|税|保険|車検|免許/;
  function healthChecks() {
    const today = inStage("today"), late = lateOf(), next = inStage("next"), inbox = inStage("inbox"), wait = inStage("wait"), some = inStage("some");
    const all = [...S.tasks, ...S.refs];
    const w8 = load8(today);
    const oldNext = next.filter((t) => ageOf(t) >= 7).sort((a, b) => ageOf(b) - ageOf(a));
    const aiStuck = aiTurn().filter((t) => ageOf(t) >= 2);
    const logs7 = S.logs.filter((l) => l.at && Date.now() - Date.parse(l.at) < 7 * 86400e3);
    const changes = logs7.filter((l) => /仕組み/.test(l.event)).length;
    const runsToday = S.logs.filter((l) => l.at && jst(Date.parse(l.at)) === TODAY() && /AIリサーチ|定時処理/.test(l.name)).length;
    const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
    const riskySome = some.filter((t) => RISKY.test(`${t.name} ${t.next || ""}`));
    const longWait = wait.filter((t) => ageOf(t) >= 14);
    const names = new Map(); for (const t of S.tasks) { const k = norm(t.name).replace(/[\s（）()「」【】・、。!！?？]/g, "").replace(/^例/, ""); if (k.length >= 4) { if (!names.has(k)) names.set(k, []); names.get(k).push(t); } }
    const dups = [...names.values()].filter((g) => g.length > 1);
    const temp = S.tasks.filter((t) => t.name === "（無題）" || norm(t.name).replace(/\s/g, "").length <= 2);
    const noTag = S.tasks.filter((t) => !t.tag && t.status !== ST.ai);
    const inflow = [...S.tasks, ...S.doneToday, ...S.refs].filter((t) => t.created && jst(Date.parse(t.created)) === TODAY()).length;
    const lvl = (red, yellow) => (red ? "red" : yellow ? "yellow" : "green");
    const last = S.diag.at(-1);
    return [
      { no: "①", name: "今日やる", val: `${today.length}件・重さ${w8}`, st: lvl(today.length >= 12, today.length >= 8 || w8 > 12), why: "8件以上・重さ12超で完了率が下がりやすい",
        fix: today.length >= 8 || w8 > 12 ? { msg: "重いもの（L・XL）を明日以降へ", items: today.filter((t) => ["L", "XL"].includes(t.weight)).slice(0, 4), acts: [["d:tomorrow", "明日へ"], ["d:mon", "月曜"], ["s:some", "いつか"]] } : null },
      { no: "②", name: "持ち越し（遅れ）", val: `${late.length}件`, st: lvl(late.some((t) => diffDays(t.date, TODAY()) >= 7), late.length > 0), why: "日付を過ぎたまま。何度もずらすなら分解かいつかへ",
        fix: late.length ? { msg: "今日やるか、日を決め直す", items: late.slice(0, 4), acts: [["d:today", "今日"], ["d:sat", "土曜"], ["a:💬", "AIと分解"], ["s:some", "いつか"]], all: ["late:today", "全部 今日にする"] } : null },
      { no: "③", name: "処理している時間帯", val: "週次レポートで確認", st: "info", why: "ログから組み立てるので月曜の診断で見る" },
      { no: "④", name: "滞留", val: `収集 ${inbox.length}・動かないNEXT ${oldNext.length}`, st: lvl(inbox.length > 50, inbox.length > 20 || oldNext.length > 5), why: "収集50件超・7日以上動かないNEXTが5件超で黄信号",
        fix: oldNext.length || inbox.length > 20 ? { msg: oldNext.length ? "7日以上動いていない「次にやる」" : "収集箱を仕分ける", items: oldNext.slice(0, 4), acts: [["d:today", "今日"], ["s:some", "いつか"], ["a:🔍", "AIに調べて"]], all: inbox.length > 20 ? ["triage:inbox", "仕分けを始める"] : null } : null },
      { no: "⑤", name: "AI処理の稼働", val: `今日の定時処理 ${runsToday}回・止まり気味 ${aiStuck.length}件`, st: lvl(false, (workday(TODAY()) && h >= 10 && !runsToday && S.logs.length) || aiStuck.length > 0), why: "平日の日中は毎時動く。AIの番が2日以上残るなら止まっているかも",
        fix: aiStuck.length ? { msg: "AIの番のまま2日以上たっている（定時処理の運用ログを確認）", items: aiStuck.slice(0, 4), acts: [["open", "開く"]], all: ["logseg:log", "運用ログを見る"] } : null },
      { no: "⑥", name: "流入と完了（今日）", val: `入った ${inflow}・済み ${S.doneToday.length}`, st: lvl(false, inflow > S.doneToday.length + 5), why: "入る数が出る数を上回り続けると溜まる" },
      { no: "⑦", name: "仕組み変更の回数", val: `この7日 ${changes}件`, st: lvl(false, changes > 3), why: "週3件超は仕組みいじりすぎ（目標は月0件）",
        fix: changes > 3 ? { msg: "しばらく仕組みは触らず、運用で様子を見る", all: ["logseg:log", "運用ログを見る"] } : null },
      { no: "⑧", name: "保留の健全性", val: `SOMEDAY ${some.length}・危ない保留 ${riskySome.length}・長い待ち ${longWait.length}`, st: lvl(riskySome.length > 0, longWait.length > 0), why: "締切・手続き・セキュリティ系をいつかに置かない。14日以上の待ちは確認",
        fix: riskySome.length || longWait.length ? { msg: riskySome.length ? "締切・手続き系がいつかにある" : "14日以上の待ち", items: [...riskySome, ...longWait].slice(0, 4), acts: [["s:next", "次にやるへ"], ["d:tomorrow", "明日確認"]] } : null },
      { no: "⑨", name: "データの健全性", val: `重複 ${dups.length}・仮タイトル ${temp.length}・分類なし ${noTag.length}`, st: lvl(false, dups.length || temp.length || noTag.length), why: "重複・仮タイトル・分類タグ空。分類は定時処理が空欄を埋める",
        fix: dups.length || temp.length || noTag.length ? { msg: dups.length ? "名前がほぼ同じタスク（片方を済み・資料に）" : temp.length ? "仮タイトル（開いて名前を付ける）" : "分類タグが空（その場で選ぶか、定時処理に任せる）", items: (dups.length ? dups.flat() : temp.length ? temp : noTag).slice(0, 5), acts: dups.length ? [["open", "開く"], ["s:done", "済み"], ["s:ref", "資料"]] : temp.length ? [["open", "開く"]] : [["tag", "分類"]] } : null },
      { no: "⑩", name: "前回の次の一手", val: last?.next ? short(last.next, 26) : "—", st: last?.next ? "info" : "info", why: last ? `第${last.no}回で決めたこと。守れたかは次の月曜に診断` : "診断レポートがまだない" },
    ];
  }
  const ST_ICON = { green: "🟢", yellow: "🟡", red: "🔴", info: "⚪" };
  function renderDiagAll(view) {
    const checks = healthChecks(); const bad = checks.filter((c) => c.st === "red" || c.st === "yellow").length;
    const d = S.diag.at(-1);
    view.insertAdjacentHTML("beforeend", `<div class="card panel"><div class="scroll diagall" id="diagall">
      <section class="g-sec"><h3>いまの健康診断<small>読み込み済みのデータから・${jstTime(S.loadedAt || Date.now())}時点</small></h3>
        <div class="hc-sum"><span class="${bad ? "y" : "g"}">${bad ? `直したほうがいい所が ${bad}つ` : "大きな問題はありません"}</span></div>
        <div class="hc">${checks.map((c, i) => `<details class="hc-i ${c.st}" ${c.fix && c.st !== "green" && i < 9 && (c.st === "red" || c.st === "yellow") ? "open" : ""}><summary><span class="ic">${ST_ICON[c.st]}</span><span class="nm">${c.no} ${esc(c.name)}</span><span class="v">${esc(c.val)}</span></summary>
          <p class="why">${esc(c.why)}</p>${c.fix ? fixHtml(c.fix) : ""}</details>`).join("")}</div></section>
      <section class="g-sec"><h3>週次の診断レポート<small>毎週月曜 7:23 に自動</small></h3><div id="diagweek"></div></section>
      ${d ? `<section class="g-sec"><h3>第${d.no}回からの提案<small>判断してほしいこと・Claude側で直せること</small></h3><div id="diagask"><p class="mute">レポート本文を読みこみ中…</p></div></section>` : ""}
      <section class="g-sec"><h3>過去のレポート</h3><div id="diaglist"></div></section>
    </div></div>`);
    const wk = $("#diagweek");
    if (!d) wk.innerHTML = `<div class="empty">${esc(S.extraErr.diag || "診断レポートはまだありません")}</div>`;
    else {
      const prev = S.diag.at(-2); const delta = prev ? Math.round((d.rate - prev.rate) * 100) : null;
      wk.innerHTML = `<div class="statrow"><div class="card stat"><div class="k">今日やる完了率</div><div class="n">${Math.round(d.rate * 100)}%</div><div class="s">${delta == null ? "" : `前回から ${delta >= 0 ? "+" : ""}${delta}pt`}</div></div><div class="card stat"><div class="k">完了</div><div class="n">${d.done}</div><div class="s">件</div></div><div class="card stat"><div class="k">流入</div><div class="n">${d.inflow}</div><div class="s">件</div></div><div class="card stat"><div class="k">回</div><div class="n">${d.no}</div><div class="s">${d.from ? `${md(d.from)}〜${md(d.to || d.from)}` : ""}</div></div></div>
        <button type="button" class="card verdict" data-diag="${d.id}"><span class="mute" style="font-size:11.5px">第${d.no}回の判定</span><b>${esc(d.verdict || "—")}</b><span class="nx">次の一手：${esc(d.next || "—")}</span></button>
        <div class="card chart" id="dchart"></div>`;
      drawDiagChart();
      loadDiagAsk(d);
    }
    $("#diaglist").innerHTML = S.diag.slice().reverse().map((x) => `<button type="button" class="row" data-diag="${x.id}"><span class="main"><span class="nm">第${x.no}回　${esc(x.verdict || "")}</span><span class="sub">${esc(x.next || "")}</span></span><span class="meta"><span class="num">${Math.round(x.rate * 100)}%</span><br>${x.from ? md(x.from) : ""}</span></button>`).join("");
  }
  function fixHtml(f) {
    const row = (t) => `<div class="crow" data-qt="${t.id}"><button type="button" class="cname" data-mopen="${t.id}">${esc(short(t.name, 26))}<small>${esc(STAGES[stageOf(t)]?.name || "")}・${esc(metaOf(t).tx)}</small></button><span class="cacts">${f.acts.map(([k, n]) => k === "open" ? `<button type="button" class="qc" data-mopen="${t.id}">${n}</button>` : k === "tag" ? `<select class="qc" data-settag="${t.id}" aria-label="分類タグ"><option value="">分類…</option>${TAGS.map((g) => `<option>${g}</option>`).join("")}</select>` : `<button type="button" class="qc" data-qk="${k}">${n}</button>`).join("")}</span></div>`;
    return `<div class="fix"><b>直し方</b>${esc(f.msg)}${(f.items || []).map(row).join("")}${f.all ? `<div class="sfoot"><button type="button" class="btn pri" data-cact="${f.all[0]}">${esc(f.all[1])}</button></div>` : ""}</div>`;
  }
  function drawDiagChart() {
    const ds = S.diag; const el = $("#dchart"); if (!el || !ds.length) return;
    const W = 340, H = 118, pl = 26, pr = 26, pt = 10, pb = 18; const n = ds.length; const max = Math.max(10, ...ds.map((x) => Math.max(x.done, x.inflow)));
    const X = (i) => pl + ((i + .5) * (W - pl - pr)) / n; const Y = (v) => pt + (1 - v / max) * (H - pt - pb); const YR = (r) => pt + (1 - r) * (H - pt - pb); const bw = Math.min(12, (W - pl - pr) / n / 3);
    const ticks = [0, Math.round(max / 2), max];
    el.innerHTML = `<div class="legend"><span><i style="background:var(--s-inbox);opacity:.5"></i>流入</span><span><i style="background:var(--s-done)"></i>完了</span><span><i style="background:var(--s-today)"></i>今日やる完了率（右の目盛り）</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="診断の推移">
      ${ticks.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line)"/><text x="${pl - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`).join("")}${[0, .5, 1].map((r) => `<text x="${W - pr + 4}" y="${YR(r) + 3}">${r * 100}%</text>`).join("")}
      ${ds.map((x, i) => `<rect x="${X(i) - bw - 1}" y="${Y(x.inflow)}" width="${bw}" height="${Y(0) - Y(x.inflow)}" rx="2" style="fill:var(--s-inbox);opacity:.5"/><rect x="${X(i) + 1}" y="${Y(x.done)}" width="${bw}" height="${Y(0) - Y(x.done)}" rx="2" style="fill:var(--s-done)"/><text x="${X(i)}" y="${H - 4}" text-anchor="middle">${x.no}</text>`).join("")}
      <polyline points="${ds.map((x, i) => `${X(i)},${YR(x.rate)}`).join(" ")}" fill="none" style="stroke:var(--s-today)" stroke-width="2"/>${ds.map((x, i) => `<circle cx="${X(i)}" cy="${YR(x.rate)}" r="${i === n - 1 ? 4 : 2.5}" style="fill:var(--s-today)"/>`).join("")}</svg>`;
  }
  // 最新のレポート本文から「判断してほしいこと」「Claude側で直せること」「次の一手」を抜き出す
  const diagAsk = {};
  async function loadDiagAsk(d) {
    const box = () => $("#diagask");
    const draw = (x) => { const b = box(); if (!b) return; b.innerHTML = x.secs.length ? x.secs.map((s) => `<div class="ask"><b>${esc(s.h)}</b>${s.lines.map((l) => `<p>${inline(l)}</p>`).join("")}</div>`).join("") + `<div class="sfoot"><button type="button" class="btn" data-diag="${d.id}">レポート全文を開く</button></div>` : `<p class="mute">本文に「判断してほしいこと」が見つかりませんでした。<button type="button" class="btn" data-diag="${d.id}">全文を開く</button></p>`; };
    if (diagAsk[d.id]) { draw(diagAsk[d.id]); return; }
    if (S.mode === "demo") { diagAsk[d.id] = { secs: [{ h: "判断してほしいこと", lines: ["（例）朝の今日やるを生活の1件だけにしてよいか", "（例）動かないNEXT 6件をいつかへ移してよいか"] }, { h: "Claude側で直せること", lines: ["（例）分類なしの3件に分類タグを入れる"] }] }; draw(diagAsk[d.id]); return; }
    try {
      const raw = await fetchBody(d.id); const L = raw.split("\n"); const secs = [];
      L.forEach((l, i) => {
        const m = l.match(/^#{1,4}\s*(.*(判断してほしいこと|直せること|次の一手).*)$/); if (!m) return;
        const lines = []; for (let j = i + 1; j < L.length && !/^#{1,4}\s/.test(L[j]); j++) { const t = L[j].replace(/^\s*([-*+]|\d+[.)])\s*(\[[ x]\]\s*)?/, "").trim(); if (t && !/^<\/?(table|tr|td|toggle|callout)/.test(t)) lines.push(t); }
        if (lines.length) secs.push({ h: text(m[1]), lines: lines.slice(0, 6) });
      });
      diagAsk[d.id] = { secs };
    } catch { diagAsk[d.id] = { secs: [] }; }
    draw(diagAsk[d.id]);
  }
