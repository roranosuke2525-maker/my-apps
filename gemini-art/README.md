# Gemini（gemini-art）

Google Gemini を Claude の「カスタムコネクタ」（リモートMCPサーバー）として使うための Worker。画面はない。
Claude の設定 → コネクタ に「Gemini」として登録してある。

```
Claude ──/mcp/<合言葉>──▶ Cloudflare Worker ──キー──▶ Gemini API（絵／Google 検索つきの調べ物）
```

- Gemini のキーは **Cloudflare 側の秘密の値にだけ**置く。Claude にもチャットにも出ない
- 料金は Gemini API（AI Studio のプロジェクト）。Google AI Pro の月$10クレジットを紐付けると、先にそこから引かれる

## 道具

| 道具 | 中身 | 料金の目安 |
| --- | --- | --- |
| generate_image | 絵を1枚描く。返した URL を見本に渡すと同じキャラで描き直せる。絵は KV に30日 | 1枚 数円 |
| research | Google 検索つきで調べ物（下調べ）。結論・要点・候補・注意と出典を日本語で返す。月の上限（既定300回）を超えたら isError | 1回 数円以下。検索は月5,000回まで無料 |
| research_usage | 今月の調べ物の回数と上限 | なし |

- 調べ物の決まり：まず research で下調べ → Claude が足りているか確かめ、足りない所だけ自分で補う。上限・エラーのときは Claude が自分で調べる
- 質問に個人名・住所・社内の情報は入れない（一般的な言い方にする）
- 回数は KV（IMAGES）の `usage:YYYY-MM`（40日で消える）

## 読む／書くもの

| つなぎ先 | 読む | 書く |
| --- | --- | --- |
| Gemini API | 絵・調べた答えと出典 | 指示文・質問文・見本の絵 |
| Workers KV（IMAGES） | 絵・今月の回数 | 絵（30日）・今月の回数 |

## セットアップ

| 名前 | 種類 | 中身 |
| --- | --- | --- |
| GEMINI_API_KEY | 秘密 | Google AI Studio のキー |
| MCP_PATH_TOKEN | 秘密 | コネクタの URL の合言葉 |
| SCRIPT_TOKEN | 秘密（任意） | Claude Code のスクリプト用の合言葉 |
| RESEARCH_MONTHLY_LIMIT | 変数（任意） | 調べ物の月の上限（既定 300） |
| RESEARCH_MODEL／GEMINI_MODEL | 変数（任意） | 調べ物／絵のモデル |

```sh
npm test            # Gemini を偽物にして確かめる
npx wrangler deploy # 公開（秘密の値はそのまま残る）
```

- コードは 2026/11/10 に Cloudflare に上がっていた版（ソースマップ）から取り出してここに置いた
