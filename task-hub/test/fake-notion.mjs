// Notion API の偽物（テスト用）。データソース1つ・ページ数件を持ち、受けた呼び出しを記録する
export function fakeNotion() {
  const calls = [];
  const DS = "21762844acbe8075bbe6000bcaf22801";
  const schema = { "名前": { type: "title" }, "ステータス": { type: "status" }, "AIアクション": { type: "select" }, "実行日": { type: "date" }, NEXT: { type: "rich_text" }, "枠": { type: "select" }, "重さ": { type: "select" }, "分類タグ": { type: "select" }, URL: { type: "url" }, "プレイヤー": { type: "relation" }, "最終更新日時": { type: "last_edited_time" }, "今どこ": { type: "formula" } };
  const t = (s) => [{ type: "text", plain_text: s, annotations: {} }];
  const pages = {
    "11111111111111111111111111111111": { id: "11111111-1111-1111-1111-111111111111", url: "https://www.notion.so/a-11111111111111111111111111111111", created_time: "2026-10-27T00:00:00.000Z", properties: { "名前": { type: "title", title: [{ type: "text", plain_text: "食洗機の比較", annotations: { bold: true } }] }, "ステータス": { type: "status", status: { name: "🤖 AI" } }, "AIアクション": { type: "select", select: { name: "🔍✅" } }, "実行日": { type: "date", date: null }, NEXT: { type: "rich_text", rich_text: t("比較表を見る") }, URL: { type: "url", url: "https://x.example" }, "最終更新日時": { type: "last_edited_time", last_edited_time: "2026-10-27T01:00:00.000Z" }, "今どこ": { type: "formula", formula: { type: "string", string: "AI" } }, "プレイヤー": { type: "relation", relation: [{ id: "3e962844-acbe-81b0-843f-f78fe19791fa" }] } } },
  };
  let md = "## ☑️ ToDo\n\n- [ ] 比較表を見て決める\n- [ ] 寸法を測る\n\n## メモ\n\n- 予算";
  async function fetch(url, init = {}) {
    const u = new URL(url); const path = u.pathname.replace(/^\/v1/, ""); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path: path + u.search, body, version: init.headers?.["Notion-Version"] });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });
    const bad = (code, message, status = 400) => new Response(JSON.stringify({ object: "error", status, code, message }), { status });
    let m;
    if ((m = path.match(/^\/data_sources\/(\w+)\/query$/))) {
      if (m[1] !== DS) return ok({ results: [], has_more: false });
      // ステータスで絞られていれば、そのステータスの行だけ
      const want = body?.filter?.and?.find((x) => x.status)?.status.equals;
      return ok({ results: Object.values(pages).filter((p) => !want || p.properties["ステータス"]?.status?.name === want).map((p) => ({ object: "page", ...p })), has_more: false });
    }
    if ((m = path.match(/^\/data_sources\/(\w+)$/))) return m[1] === DS ? ok({ title: [{ plain_text: "DB_タスク管理" }], properties: schema }) : bad("object_not_found", "no", 404);
    if ((m = path.match(/^\/pages\/(\w+)\/markdown$/))) {
      if (init.method === "GET") return ok({ object: "page_markdown", markdown: md, truncated: false, unknown_block_ids: [] });
      if (body.type === "update_content") {
        const hits = body.update_content.content_updates.filter((x) => md.includes(x.old_str));
        if (!hits.length) return bad("validation_error", `No matches found for ${body.update_content.content_updates[0].old_str}.`);
        for (const x of hits) md = md.replace(x.old_str, x.new_str);
        const miss = body.update_content.content_updates.filter((x) => !hits.includes(x));
        return ok({ object: "page_markdown", markdown: md, ...(miss.length ? { warnings: miss.map(() => ({ code: "no_match", message: "no match" })) } : {}) });
      }
      if (body.type === "insert_content") { md = `${md}\n\n${body.insert_content.content}`; return ok({ markdown: md }); }
      if (body.type === "replace_content") { md = body.replace_content.new_str; return ok({ markdown: md }); }
    }
    if ((m = path.match(/^\/pages\/(\w+)$/))) {
      const p = pages[m[1]]; if (!p) return bad("object_not_found", "no", 404);
      if (init.method === "GET") return ok(p);
      for (const [k, v] of Object.entries(body.properties)) { if (v.status) p.properties[k] = { type: "status", status: v.status }; if ("select" in v) p.properties[k] = { type: "select", select: v.select }; if ("date" in v) p.properties[k] = { type: "date", date: v.date }; if (v.rich_text) p.properties[k] = { type: "rich_text", rich_text: v.rich_text.map((r) => ({ type: "text", plain_text: r.text.content, annotations: {} })) }; }
      return ok(p);
    }
    if (path === "/pages" && init.method === "POST") { const id = "2".repeat(32); pages[id] = { id, url: `https://www.notion.so/${id}`, created_time: new Date().toISOString(), properties: {} }; return ok({ id, url: `https://www.notion.so/${id}` }); }
    return bad("invalid_request_url", "unknown", 404);
  }
  return { fetch, calls, get md() { return md; }, pages, DS };
}
