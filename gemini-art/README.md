# gemini-art

Google Gemini の画像生成を、Claude の「カスタムコネクタ」（リモートMCPサーバー）として使うための Cloudflare Worker。
スマホの Claude アプリでも Claude Code でも「〇〇の絵を描いて」で絵が返ってくる。

- `POST /mcp/<MCP_PATH_TOKEN>` … MCP。ツールは `generate_image`（prompt／aspect_ratio／reference_image_urls）
- `GET /i/<id>.png` … 描いた絵。KV に30日間だけ置く

## secret（リポジトリには書かない）

Cloudflare ダッシュボード → Workers → gemini-art → 設定 → 変数とシークレット で入れる（種類は「シークレット」）。

| 名前 | 中身 |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio の API キー |
| `MCP_PATH_TOKEN` | コネクタ URL の合言葉（英数字30文字以上。パスワード生成で作る） |
| `SCRIPT_TOKEN` | Claude Code のスクリプト（habit-check/scripts/gen-party-gemini.mjs）用の合言葉。任意 |

コネクタの URL は `https://gemini-art.roranosuke2525.workers.dev/mcp/<MCP_PATH_TOKEN>`。
URL を知っている人は誰でもキーで絵を描けるので、人に見せない。漏れたら `MCP_PATH_TOKEN` を入れ替えて、コネクタを登録し直す。

## 開発

```bash
npm test
npx wrangler deploy
```
