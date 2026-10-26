// テスト用の偽 Notion 連携（MCP）。返事の形は本物の Notion MCP（rows モード）に合わせ、値はすべて作りもの。
export function fakeNotionMcp() {
  const DS = { book: "23362844-acbe-80b5-a2b4-000b59e31cdf", hl: "1f6f7d77-b234-4b5b-8e15-4afcf2097567" };
  const hex = (n) => n.toString(16).padStart(32, "0");
  const url = (n) => `https://app.notion.com/p/${hex(n)}`;
  const bookSchema = {
    書籍名: { name: "書籍名", type: "title" },
    著者名: { name: "著者名", type: "select", options: [{ name: "作家　一" }, { name: "作家　二" }] },
    出版社: { name: "出版社", type: "select", options: [{ name: "見本文庫" }] },
  };
  const tables = {
    [DS.book]: [
      { url: url(1), 書籍名: "見本の本", 著者名: "作家　一", 出版社: "見本文庫", ステータス: "読中", 読書メーター: "__NO__", NotebookLM: "__NO__", ハイライト: JSON.stringify([url(21)]),
        "ファイル&メディア": JSON.stringify([`file://${encodeURIComponent(JSON.stringify({ source: "https://example.test/cover.jpg" }))}`]) },
      { url: url(2), 書籍名: "読んだ本", 著者名: "作家　二", ステータス: "読了", "date:読了日:start": "2026-09-01", 評価: "★★★★", 感想: "よかった", 読書メーター: "__YES__", NotebookLM: "__NO__",
        読書メモ_DBからのリレーション: JSON.stringify([url(31), url(32)]) },
      { url: url(3), 書籍名: "まだの本", ステータス: "未読" },
    ],
    [DS.hl]: [
      { url: url(21), 引用: "見本のハイライト。", 本: JSON.stringify([url(1)]), ページ: 12, 出どころ: "📷 付箋写真", メモ: "", "date:記録日:start": "2026-10-20" },
      { url: url(22), 引用: "前のページ", 本: JSON.stringify([url(1)]), ページ: 3, 出どころ: "📱 Kindle", 位置: "40" },
    ],
  };
  const pages = {
    [hex(31)]: { title: "前の形の引用", text: '<content>\n<image source="notion-file-block://x" />\n\n大事な一文\n</content>' },
    [hex(32)]: { title: "もう一つ", text: "<blank-page>This page is blank</blank-page>" },
  };
  const calls = [];
  let next = 100;
  const idOf = (u) => (String(u).match(/([0-9a-f]{32})/) || [])[1];

  async function callTool(server, tool, input) {
    calls.push({ server, tool, input });
    if (tool === "notion-query-data-sources") {
      const ds = input.data.data_source_url.replace("collection://", "");
      let rows = tables[ds] || [];
      const f = input.data.filter?.filters?.[0];
      if (f?.operator === "relation_contains") rows = rows.filter((r) => JSON.parse(r[f.property] || "[]").includes(f.value.value));
      return { payload: { results: rows, has_more: false } };
    }
    if (tool === "notion-fetch") {
      if (input.id === `collection://${DS.book}`) return { payload: { text: `<data-source-state>${JSON.stringify({ schema: bookSchema })}</data-source-state>` } };
      const p = pages[idOf(input.id)];
      if (!p) throw Object.assign(new Error("not found"), { code: "tool_error" });
      return { payload: p };
    }
    if (tool === "notion-create-pages") return { payload: { pages: input.pages.map(() => ({ url: url(next++) })) } };
    if (tool === "notion-update-page") return { payload: { page_id: input.page_id } };
    throw Object.assign(new Error("unknown tool"), { code: "bad_request" });
  }
  return { callTool, calls, DS, hex, url };
}
