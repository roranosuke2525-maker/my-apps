# 育児ハブ（PWA）

Notion にちらばっている育児まわりの情報を、テーマ別の「棚」から探せるスマホ向けアプリ。
叩き台3案のうち「C 育児ハブ」を形にしたもの。

| 画面 | 中身 |
| --- | --- |
| 上 | 奏輔の月齢（生後◯か月◯日・1歳まで◯日）、60日以内の予定（実行日・期限のあるもの）、★ピン留めの育児メモ |
| 棚 | ごはん／からだ・医療／お世話・ねんね／あそび・本／保育園・おでかけ／手続き・お金／そのほか。押すと一覧を絞る |
| 一覧 | さがす（名前・NEXT・助成内容）、元のデータ（やること・しらべた・育児メモ・申請）で絞る、済んだものも見る |
| くわしく | 項目を押すと下から開く。育児タスクは「完了にする」「NEXT にする」、すべて「Notion で開く」 |
| 下 | 育児のタスクを追加（DB_タスク管理 に 📥 INBOX・CHILD で入る） |

## 読む／書くもの

| DB | 読む | 書く |
| --- | --- | --- |
| DB_タスク管理 | 分類タグ CHILD で、✅ DONE 以外（📚 REFERENCE は「しらべた」） | ステータスだけ（この画面で読んだ CHILD のタスクに限る）、INBOX への追加 |
| DB_childcare memo | 全件（分類タグで棚に振り分け、Star ☆ をピン留め） | なし |
| 支援の申請・給付 | 全件（申請状況・期限・助成内容） | なし |

- 子どもの名前と誕生日は「大事な日」の 奏輔誕生日 から `src/mcp-api.js` の `CHILD` に書いてある
- 棚の振り分けは `public/app.js` の `SHELVES`。育児メモは分類タグで、ほかは名前の言葉で決まる。合わないものは言葉を足す

## アーティファクト版（いま動いているもの）

claude.ai のアーティファクト（[育児ハブ](https://claude.ai/artifact/5jnJmPxWaknK94WbPDKMi4)）を開く。
Notion へは見ている人の claude.ai の Notion 連携（MCP）で入るので、トークン・サーバー・社内PCへの保存はない。初回に「Notion を使ってよいか」の確認が出たら許可する。

```sh
npm test                          # /api（src/mcp-api.js）を偽の Notion 連携で確かめる
node scripts/build-artifact.mjs   # dist/artifact.html を作る（公開は Claude に「アーティファクトを更新して」）
```

公開するときは capabilities に `{"mcp": {"servers": [{"server": "Notion", "tools": ["notion-query-data-sources", "notion-update-page", "notion-create-pages"]}]}}` を宣言する。

## これから

- Cloudflare版（ホーム画面のアプリとして合言葉で開く）は、habit-check の Worker と同じ形で `/api/hub`・`/api/tasks` を答えれば画面はそのまま使える
