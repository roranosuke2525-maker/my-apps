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
| research | Google 検索つきで調べ物（下調べ）。結論・要点・候補・注意を、文ごとの出典番号つきで日本語で返す。月の上限（既定300回）を超えたら isError | 1回 数円以下。検索は月5,000回まで無料 |
| research_usage | 今月の調べ物の回数と上限 | なし |

- 調べ物の決まり：まず research で下調べ → Claude が出典のページで確かめ、足りない所だけ自分で補う。上限・エラーのときは Claude が自分で調べる
- 質問に個人名・住所・社内の情報は入れない（一般的な言い方にする）
- 回数は KV（IMAGES）の `usage:YYYY-MM`（40日で消える）

### research の入力と答え（2026/11/11〜 v1.2.0）

| 入力 | 中身 |
| --- | --- |
| question | 調べたいこと（2000字まで・必須） |
| focus | 特に知りたい観点（500字まで） |
| rules | Gemini への注意書き。Notion の「🔎 Gemini 育成ノート」の「Gemini への注意書き」をそのまま渡す（1500字まで。長い分は切る）。指示文（systemInstruction）の最後に「## 守ること（育成ノート）」として足すので、質問文に混ぜるより強く効く |

- **出典番号**：Gemini が根拠にした文（groundingSupports）の後ろに ` [1,3]` のように出典の番号を付ける。番号は「## 出典」の `[番号]` と対応。文の場所は segment の文字列で探す（startIndex／endIndex はバイト数のことがあり、日本語ではずれるため使わない）。見つからない文には付けない
- **本当の URL**：Gemini の出典は Google の転送用 URL（`vertexaisearch.cloud.google.com/grounding-api-redirect/…`）で中身が見えない。先頭の15件まで、転送を1回だけ見て（`redirect: "manual"`・4秒で打ち切り・中身は読まない）行き先の URL に直す。直せなかったものは転送用 URL のまま
- **出典の1行**：`[番号] タイトル（サイト）：URL`。タイトルが無い・サイト名と同じなら `[番号] サイト：URL`（サイト＝URL のホスト名、先頭の www. は外す）
- 確かめる側（Claude）は、番号を頼りに必要なページだけ開けばよい。転送を見る分、1回あたり出典の数だけ外への通信が増える（Workers の上限内）

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
- **2026/11/11 の変更（出典番号・本当の URL・rules）は、`gemini-art` フォルダで `npx wrangler deploy` するまで効かない**。公開しても秘密の値・回数（KV）・コネクタの登録はそのまま。公開前の Worker に rules を渡しても、知らない引数として無視されるだけ
