// 今どこ ウィジェット（Scriptable 用）
// ホーム画面：小（進み具合＋まず これ）／中（一覧 4件・✓で済み・→で明日）／大（一覧 8件＋AIの提案）
// ロック画面：丸（残り件数の輪）／四角（残り・遅れ・まず これ）／1行
// 初回はアプリ内で実行すると合言葉を聞く（この端末の Keychain にだけ保存）。URL はこのファイルの HOST だけ直せばよい
const HOST = "https://imadoko.roranosuke2525.workers.dev";
const KEY_ID = "imadoko.key";
const REFRESH_MIN = 15;

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "imadoko-widget-cache.json");

// 合言葉（アプリ内で実行したときだけ聞く）
async function getKey() {
  if (Keychain.contains(KEY_ID)) return Keychain.get(KEY_ID);
  if (config.runsInWidget) return null;
  const a = new Alert();
  a.title = "今どこの合言葉";
  a.message = "Worker に設定した合言葉（APP_KEY）を入れてください。この iPhone の Keychain にだけ保存されます。";
  a.addSecureTextField("合言葉", "");
  a.addAction("保存"); a.addCancelAction("やめる");
  if ((await a.present()) < 0) return null;
  const v = a.textFieldValue(0).trim();
  if (v.length < 16) { const b = new Alert(); b.title = "合言葉が短すぎます"; b.addAction("OK"); await b.present(); return null; }
  Keychain.set(KEY_ID, v);
  return v;
}

// データ（取れなければ前回のものを使う）
async function loadData() {
  const key = await getKey();
  if (key) {
    try {
      const req = new Request(`${HOST}/api/widget`);
      req.headers = { Authorization: `Bearer ${key}` };
      req.timeoutInterval = 20;
      const data = await req.loadJSON();
      if (data && Array.isArray(data.tasks)) { data._at = Date.now(); fm.writeString(cachePath, JSON.stringify(data)); return data; }
      if (data && data.code === "bad_key") { Keychain.remove(KEY_ID); return { error: "合言葉が違います。アプリ内で実行して入れ直してください" }; }
      return { error: (data && data.error) || "読めませんでした" };
    } catch (e) {
      if (fm.fileExists(cachePath)) { const d = JSON.parse(fm.readString(cachePath)); d._stale = true; return d; }
      return { error: "つながりません" };
    }
  }
  return { error: "合言葉が未設定。Scriptable でこのスクリプトを一度実行してください" };
}

// 色（ライト／ダークで変える）
const C = {
  bg: Color.dynamic(new Color("#f4f5f7"), new Color("#14171c")),
  card: Color.dynamic(new Color("#ffffff"), new Color("#1b1f26")),
  tx: Color.dynamic(new Color("#1d2026"), new Color("#e8eaee")),
  mute: Color.dynamic(new Color("#6b7280"), new Color("#9aa0a8")),
  line: Color.dynamic(new Color("#e2e4e8"), new Color("#2a2f38")),
  ok: new Color("#8fb8a5"),
  late: new Color("#e08578"),
  ring: Color.dynamic(new Color("#e2e4e8"), new Color("#2a2f38")),
  doing: new Color("#7aa6d8"),
};
const WAKU_ICON = { "☼ 朝": "☼", "💻 PC": "💻", "🏠 家・外": "🏠", "作業中": "▶" };

// 進み具合の輪（画像にして置く）
function ringImage(pct, size, color, label, labelSize) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size); ctx.opaque = false; ctx.respectScreenScale = true;
  const lw = Math.max(4, Math.round(size / 9)); const r = size / 2 - lw / 2 - 1; const cx = size / 2, cy = size / 2;
  const arc = (from, to) => { const p = new Path(); const n = Math.max(2, Math.round((to - from) * 60)); for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (from + ((to - from) * i) / n) * 2 * Math.PI; const pt = new Point(cx + r * Math.cos(a), cy + r * Math.sin(a)); if (i === 0) p.move(pt); else p.addLine(pt); } return p; };
  ctx.setLineWidth(lw); ctx.setStrokeColor(C.ring); ctx.addPath(arc(0, 1)); ctx.strokePath();
  if (pct > 0) { ctx.setStrokeColor(color); ctx.addPath(arc(0, Math.min(1, pct / 100))); ctx.strokePath(); }
  if (label != null) { ctx.setTextAlignedCenter(); ctx.setTextColor(C.tx); ctx.setFont(Font.boldSystemFont(labelSize || Math.round(size / 3.6))); const h = (labelSize || size / 3.6) * 1.3; ctx.drawTextInRect(String(label), new Rect(0, cy - h / 2, size, h)); }
  return ctx.getImage();
}

function title(stack, data) {
  const h = stack.addStack(); h.centerAlignContent();
  const t = h.addText(data.remaining ? `のこり ${data.remaining}件` : "今日は全部終わり"); t.font = Font.boldSystemFont(15); t.textColor = C.tx; t.lineLimit = 1;
  h.addSpacer();
  if (data.late) { const l = h.addText(`遅れ ${data.late}`); l.font = Font.mediumSystemFont(12); l.textColor = C.late; }
  else if (data.done) { const l = h.addText(`${data.done}件 済み`); l.font = Font.mediumSystemFont(12); l.textColor = C.mute; }
  return h;
}

function row(stack, t, { withActs = true, size = 13 } = {}) {
  const r = stack.addStack(); r.centerAlignContent(); r.spacing = 6;
  const chk = r.addText("○"); chk.font = Font.systemFont(size + 3); chk.textColor = t.late ? C.late : C.ok;
  if (withActs) chk.url = t.done;
  const body = r.addStack(); body.layoutVertically(); body.url = t.open;
  const nm = body.addText(`${t.doing ? "▶ " : ""}${t.name}`); nm.font = t.doing ? Font.semiboldSystemFont(size) : Font.systemFont(size); nm.textColor = C.tx; nm.lineLimit = 1; nm.minimumScaleFactor = 0.8;
  const sub = [WAKU_ICON[t.waku] || "", t.late ? "遅れ" : "", t.next].filter(Boolean).join("・");
  if (sub) { const s = body.addText(sub); s.font = Font.systemFont(size - 3); s.textColor = t.late ? C.late : C.mute; s.lineLimit = 1; }
  r.addSpacer();
  if (withActs) { const arrow = r.addText("→"); arrow.font = Font.systemFont(size + 1); arrow.textColor = C.mute; arrow.url = t.tomorrow; }
  return r;
}

function errorWidget(w, msg) {
  w.addSpacer();
  const t = w.addText("今どこ"); t.font = Font.boldSystemFont(14); t.textColor = C.tx;
  const m = w.addText(msg); m.font = Font.systemFont(12); m.textColor = C.late; m.lineLimit = 3;
  w.addSpacer();
}

function foot(w, data) {
  const f = w.addStack(); f.centerAlignContent();
  const at = new Date(data._at || Date.now());
  const s = f.addText(`${data._stale ? "⚠ " : ""}${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")} 更新${data.sugs ? `・💡 提案 ${data.sugs}` : ""}`); s.font = Font.systemFont(10); s.textColor = C.mute;
  f.addSpacer();
  const b = f.addText(`${data.done}/${data.done + data.remaining} 済み`); b.font = Font.systemFont(10); b.textColor = C.mute;
}

async function build() {
  const data = await loadData();
  const fam = config.widgetFamily || "medium";
  const w = new ListWidget();
  w.url = `${HOST}/`;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60e3);
  const accessory = fam.startsWith("accessory");
  if (!accessory) { w.backgroundColor = C.bg; w.setPadding(12, 14, 10, 14); } else { w.addAccessoryWidgetBackground = true; }

  if (data.error) { if (accessory) { const t = w.addText(`今どこ：${data.error}`); t.font = Font.systemFont(11); t.lineLimit = 2; } else errorWidget(w, data.error); return w; }
  const first = data.tasks[0];
  const color = data.late ? C.late : C.ok;

  if (fam === "accessoryCircular") { w.addImage(ringImage(data.pct, 58, color, data.remaining, 20)); return w; }
  if (fam === "accessoryInline") { const t = w.addText(data.remaining ? `✓ のこり${data.remaining}${data.late ? `・遅れ${data.late}` : ""}　${first ? first.name : ""}` : "✓ 今日は全部終わり"); t.font = Font.systemFont(12); return w; }
  if (fam === "accessoryRectangular") {
    const t = w.addText(data.remaining ? `のこり ${data.remaining}件${data.late ? `・遅れ ${data.late}` : ""}` : "今日は全部終わり"); t.font = Font.boldSystemFont(13); t.lineLimit = 1;
    if (first) { const n = w.addText(`${first.doing ? "▶ " : "・"}${first.name}`); n.font = Font.systemFont(12); n.lineLimit = 2; }
    else { const n = w.addText(`${data.done}件 片づけた`); n.font = Font.systemFont(12); }
    return w;
  }

  if (fam === "small") {
    const top = w.addStack(); top.centerAlignContent();
    top.addImage(ringImage(data.pct, 46, color, `${data.pct}%`, 12)).imageSize = new Size(46, 46);
    top.addSpacer(8);
    const tx = top.addStack(); tx.layoutVertically();
    const a = tx.addText(data.remaining ? `のこり ${data.remaining}` : "全部終わり"); a.font = Font.boldSystemFont(14); a.textColor = C.tx; a.lineLimit = 1; a.minimumScaleFactor = 0.7;
    const b = tx.addText(data.late ? `遅れ ${data.late}` : `${data.done}件 済み`); b.font = Font.systemFont(11); b.textColor = data.late ? C.late : C.mute;
    w.addSpacer(8);
    if (first) {
      const l = w.addText(first.doing ? "▶ いま やっている" : "まず これ"); l.font = Font.semiboldSystemFont(10); l.textColor = first.doing ? C.doing : C.mute;
      const n = w.addText(first.name); n.font = Font.semiboldSystemFont(13); n.textColor = C.tx; n.lineLimit = 2; n.minimumScaleFactor = 0.8;
      if (first.next) { const s = w.addText(first.next); s.font = Font.systemFont(10); s.textColor = C.mute; s.lineLimit = 1; }
    } else { const n = w.addText(data.done ? "おつかれさまでした" : "今日の予定はありません"); n.font = Font.systemFont(12); n.textColor = C.mute; }
    w.addSpacer();
    if (data.sugs) { const s = w.addText(`💡 AIの提案 ${data.sugs}件`); s.font = Font.systemFont(10); s.textColor = C.mute; }
    return w;
  }

  // medium / large
  const max = fam === "large" ? 8 : 4;
  const head = w.addStack(); head.centerAlignContent();
  head.addImage(ringImage(data.pct, 34, color, null)).imageSize = new Size(34, 34);
  head.addSpacer(8);
  const hs = head.addStack(); hs.layoutVertically();
  title(hs, data);
  const sub = hs.addText(first ? `${first.doing ? "▶ " : "まず："}${first.name}` : (data.done ? "おつかれさまでした" : "次にやるから1つ今日に入れましょう")); sub.font = Font.systemFont(11); sub.textColor = C.mute; sub.lineLimit = 1; sub.url = first ? first.open : `${HOST}/#flow`;
  w.addSpacer(6);
  const list = w.addStack(); list.layoutVertically(); list.spacing = fam === "large" ? 5 : 3;
  const shown = data.tasks.slice(0, max);
  for (const t of shown) row(list, t, { size: fam === "large" ? 13 : 12 });
  if (data.tasks.length > max) { const m = list.addText(`ほか ${data.remaining - max}件 ›`); m.font = Font.systemFont(10); m.textColor = C.mute; m.url = `${HOST}/#today`; }
  if (!shown.length) { const e = list.addText(data.done ? `✓ ${data.done}件 片づけました` : "今日の予定はありません"); e.font = Font.systemFont(12); e.textColor = C.mute; }
  w.addSpacer();
  foot(w, data);
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
