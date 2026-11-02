// Notion を Notion API で読み書きする小さな道具（定期実行のセッションで Notion の連携ツールが無いとき用）。
// 使い方：node tools/notion.mjs <道具> '<JSON>'
//   道具は MCP と同じ名前：notion-fetch / notion-query-data-sources / notion-update-page / notion-create-pages
//   例）node tools/notion.mjs notion-query-data-sources '{"data":{"mode":"rows","data_source_url":"collection://…","filter":{…}}}'
// 環境変数 NOTION_TOKEN（インテグレーションのトークン）を使う。値は表示しない
import { runTool, notionClient } from "../task-hub/src/worker.js";
const [tool, json = "{}"] = process.argv.slice(2);
if (!tool) { console.error("使い方：node tools/notion.mjs <道具> '<JSON>'"); process.exit(2); }
if (!process.env.NOTION_TOKEN) { console.error("NOTION_TOKEN がありません"); process.exit(2); }
try {
  const out = await runTool(notionClient(process.env), tool, JSON.parse(json));
  console.log(JSON.stringify(out, null, 1));
} catch (err) {
  console.error(`失敗：${err.message}`); process.exit(1);
}
