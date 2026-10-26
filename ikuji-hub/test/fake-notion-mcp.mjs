// テスト用の偽 Notion 連携（MCP）。返事の形は本物の Notion MCP（rows モード）に合わせ、値はすべて作りもの。
// ブラウザにも toString() で渡すので、この関数の外のものは使わない。
export function fakeNotionMcp() {
  const DS = {
    task: "21762844-acbe-8075-bbe6-000bcaf22801",
    memo: "2f362844-acbe-804a-9314-000be9fe07fa",
    aid: "21c62844-acbe-800b-8b6b-000b7d8e1e7c",
    sleep: "5d665394-581e-4294-9bc1-adb8bad27784",
  };
  const sleepSchema = {
    名前: { name: "名前", type: "title" },
    寝る場所: { name: "寝る場所", type: "select", options: [{ name: "ベビーベッド" }, { name: "布団（親と一緒）" }] },
    寝かしつけ: { name: "寝かしつけ", type: "multi_select", options: [{ name: "抱っこ" }, { name: "トントン" }, { name: "ひとりで" }] },
    寝かしつけ担当: { name: "寝かしつけ担当", type: "select", options: [{ name: "自分" }, { name: "妻" }] },
  };
  const hex = (n) => n.toString(16).padStart(32, "0");
  const url = (n) => `https://app.notion.com/p/${hex(n)}`;
  const tables = {
    [DS.task]: [
      { url: url(1), 名前: "離乳食の本を読む", ステータス: "⏭ NEXT", 分類タグ: "CHILD", NEXT: "2章から", 枠: "☼ 朝", 重さ: "M", "date:実行日:start": "2026-11-02", 討伐EXP: `formulaResult://${DS.task}/${hex(1)}/AbCd`, 今日: "<omitted />" },
      { url: url(2), 名前: "ベビーゲートを比べる", ステータス: "📥 INBOX", 分類タグ: "CHILD", NEXT: "" },
      { url: url(3), 名前: "抱っこひもの比較", ステータス: "📚 REFERENCE", 分類タグ: "CHILD" },
      { url: url(4), 名前: "仕事の資料", ステータス: "⏭ NEXT", 分類タグ: "WORK" },
      { url: url(5), 名前: "済んだ育児タスク", ステータス: "✅ DONE", 分類タグ: "CHILD" },
    ],
    [DS.memo]: [
      { url: url(11), 名前: "ミルクの量", "": "継続", 分類タグ: "授乳/ミルク", Star: "☆" },
      { url: url(12), 名前: "肌着のサイズ", "": "完了", 分類タグ: "おむつ" },
    ],
    [DS.sleep]: [
      { url: url(31), 名前: "生後8か月", 月齢: 8, "date:記録日:start": "2026-09-20", 寝る場所: "ベビーベッド", 寝かしつけ: '["抱っこ","トントン"]', 寝る時刻: "20:00", 夜中に起きる回数: 3 },
      { url: url(32), 名前: "生後9か月", 月齢: 9, "date:記録日:start": "2026-10-26" },
      { url: url(33), 名前: "生後7か月", 月齢: 7 },
    ],
    [DS.aid]: [
      { url: url(21), 名前: "子ども医療費の受給者証", 申請状況: "申請中", ステータス: "進行中", 申請先: "市役所", 助成内容: "<p>\n通院・入院の自己負担 &amp; 薬代\n</p>", "date:期限:start": "2026-11-30" },
    ],
  };
  const calls = [];
  // ページの本文（fetch で <content> として返す）
  const bodies = {
    [hex(31)]: "寝る前に絵本1冊。\n<br>電気は真っ暗に",
    [hex(32)]: null, // 空のページ
    [hex(33)]: '<table header-row="true">\n<tr><td>a</td></tr>\n</table>',
  };
  const calendars = [
    { id: "ja.japanese#holiday@group.v.calendar.google.com", summary: "日本の祝日" },
    { id: "me@example.test", summary: "me" },
    { id: "family@example.test", summary: "家族" },
  ];
  const events = {
    "me@example.test": [
      { summary: "美容室", start: { dateTime: "2026-11-15T12:30:00+09:00" }, status: "confirmed" },
      { summary: "9か月検診", start: { dateTime: "2026-11-19T09:00:00+09:00" }, status: "confirmed", htmlLink: "https://www.google.com/calendar/event?eid=abc" },
    ],
    "family@example.test": [
      { summary: "保育園 面談", start: { date: "2026-12-01" }, status: "confirmed" },
      { summary: "保育園 見学", start: { date: "2026-12-02" }, status: "cancelled" },
    ],
  };
  const match = (row, f) => {
    if (f.type === "group") return f.operator === "and" ? f.filters.every((x) => match(row, x)) : f.filters.some((x) => match(row, x));
    const v = row[f.property];
    if (f.operator === "enum_is" || f.operator === "status_is") return v === f.value.value;
    if (f.operator === "status_is_not") return v !== f.value.value;
    throw Object.assign(new Error(`unsupported ${f.operator}`), { code: "bad_request" });
  };
  const self = {
    calls,
    tables,
    bodies,
    noCalendar: false,
    async callTool(server, name, input, opts) {
      calls.push({ server, name, input, opts });
      if (server === "Google Calendar") {
        if (self.noCalendar) throw Object.assign(new Error("not connected"), { code: "server_not_connected" });
        if (name === "list_calendars") return { payload: { calendars } };
        if (name === "list_events") return { payload: { events: events[input.calendarId] || [] } };
      }
      if (name === "notion-fetch" && input.id === `collection://${DS.sleep}`) {
        return { payload: { text: `<data-source url="collection://${DS.sleep}">\n<data-source-state>\n${JSON.stringify({ name: "DB_ねんね記録", schema: sleepSchema })}\n</data-source-state>\n</data-source>` } };
      }
      if (name === "notion-fetch" && input.id in bodies) {
        const b = bodies[input.id];
        return { payload: { text: `<page url="${url(0)}">\n<properties>\n{}\n</properties>\n${b == null ? "<blank-page>This page is blank and has no content.</blank-page>" : `<content>\n${b}\n</content>`}\n</page>` } };
      }
      if (name === "notion-query-data-sources") {
        const d = input.data;
        const rows = tables[d.data_source_url.replace("collection://", "")] || [];
        return { payload: { results: rows.filter((r) => !d.filter || match(r, d.filter)).slice(0, d.limit), has_more: false } };
      }
      if (name === "notion-create-pages") {
        const row = { url: url(100 + calls.length), ...input.pages[0].properties };
        tables[input.parent.data_source_id].push(row);
        return { payload: { pages: [{ id: row.url.slice(-32), url: row.url }] } };
      }
      if (name === "notion-update-page" && input.command === "replace_content") {
        bodies[input.page_id] = input.new_str;
        return { payload: { page_id: input.page_id } };
      }
      if (name === "notion-update-page") {
        const row = Object.values(tables).flat().find((r) => r.url.endsWith(input.page_id));
        Object.assign(row, input.properties);
        return { payload: { page_id: input.page_id } };
      }
      throw Object.assign(new Error("not in manifest"), { code: "not_in_manifest" });
    },
  };
  return self;
}
