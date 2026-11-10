# my-apps

- [habit-check](habit-check/) — Notion の習慣チェックをスマホから入力するWebアプリ（PWA）
- [ikuji-hub](ikuji-hub/) — Notion の育児まわり（タスク・メモ・申請）を棚ごとに探せるWebアプリ（PWA）
- [task-hub](task-hub/) — 今どこ：AIリサーチの回答・判定を中心に、GTDの流れ・仕分け・診断・全DBをまとめ、本文をNotionと同じ書き方で編集できるタスクアプリ（アーティファクト／Cloudflare Worker＋Notion API）
- [shiori](shiori/) — しおり：付箋のページの文と Kindle のハイライトを Notion の読書メモに集め、読後は読書メーター・NotebookLM へ渡す読書ノート（PWA・Notion API）
- [trip-shiori](trip-shiori/) — 旅のしおり：Notion の旅行ページのToDoを、日付ごとの予定（時刻・地図ボタン）と準備のチェックリストで見て・チェック・追加できるPWA。圏外でも開け、未送信は電波が戻ったら送る（Cloudflare Worker＋Notion API）

## 道具

- `tools/notion.mjs` — Notion の連携ツールが無いセッション（定期実行など）から、環境変数 NOTION_TOKEN で Notion を読み書きする（道具名・JSON は Notion の連携ツールと同じ）。🛠 アプリ修正の定期実行が使う
