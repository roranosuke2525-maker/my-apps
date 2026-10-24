// テスト用の偽 Notion 連携（MCP）。返事の形は本物の Notion MCP（rows モード）に合わせ、値はすべて作りもの。
// ブラウザにも toString() で渡すので、この関数の外のものは使わない。
export function fakeNotionMcp() {
  const DS = {
    task: "21762844-acbe-8075-bbe6-000bcaf22801",
    memo: "2f362844-acbe-804a-9314-000be9fe07fa",
    aid: "21c62844-acbe-800b-8b6b-000b7d8e1e7c",
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
    [DS.aid]: [
      { url: url(21), 名前: "子ども医療費の受給者証", 申請状況: "申請中", ステータス: "進行中", 申請先: "市役所", 助成内容: "<p>\n通院・入院の自己負担 &amp; 薬代\n</p>", "date:期限:start": "2026-11-30" },
    ],
  };
  const calls = [];
  const match = (row, f) => {
    if (f.type === "group") return f.operator === "and" ? f.filters.every((x) => match(row, x)) : f.filters.some((x) => match(row, x));
    const v = row[f.property];
    if (f.operator === "enum_is" || f.operator === "status_is") return v === f.value.value;
    if (f.operator === "status_is_not") return v !== f.value.value;
    throw Object.assign(new Error(`unsupported ${f.operator}`), { code: "bad_request" });
  };
  return {
    calls,
    tables,
    async callTool(server, name, input, opts) {
      calls.push({ server, name, input, opts });
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
      if (name === "notion-update-page") {
        const row = Object.values(tables).flat().find((r) => r.url.endsWith(input.page_id));
        Object.assign(row, input.properties);
        return { payload: { page_id: input.page_id } };
      }
      throw Object.assign(new Error("not in manifest"), { code: "not_in_manifest" });
    },
  };
}
