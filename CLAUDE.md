# CLAUDE.md

自分専用のPWAをまとめて置くリポジトリ。GitHub Pages（main ブランチのルート）で公開している。

## ルール

- 回答とコードコメントは日本語で書く。
- スマホ縦画面・片手操作を最優先にする（主要ボタンは画面下部、タップ領域は大きく、safe-area を考慮）。
- 外部ライブラリは最小限にし、ビルド工程は作らない（素の HTML / CSS / JS をそのまま配信）。
- アプリを変更したら、そのアプリの `sw.js` の `VERSION` を必ず上げる。
- 新しいアプリは `apps/<アプリ名>/` に追加し、ルートの `index.html` の一覧にも載せる。
- Public リポジトリなので、個人情報・APIキー・トークン類はコードに書かない。

## 構成

```
index.html              アプリ一覧（各アプリへのリンク）
icons/                  一覧ページ用アイコン
apps/<アプリ名>/
  index.html            アプリ本体
  manifest.json         start_url / scope / id は "./"（そのフォルダ）
  sw.js                 キャッシュ名 "<アプリ名>-<VERSION>"
  icons/icon-180.png    apple-touch-icon
  icons/icon-512.png    manifest 用
```

## 新しいアプリの作り方

1. `apps/hello/` をコピーして `apps/<アプリ名>/` を作る。
2. `manifest.json` の name / short_name / 色、`index.html` の title / apple-mobile-web-app-title を変える。
3. `sw.js` のキャッシュ名の接頭辞（`hello-`）をアプリ名に変え、`VERSION` を `v1` に戻す。
4. アイコンを差し替える（180px・512px の PNG）。
5. ルートの `index.html` に一覧の項目を足す。

## 注意

- パスはすべて相対パス（`./`）で書く。GitHub Pages は `/<リポジトリ名>/` 配下で公開されるため、`/` 始まりの絶対パスは壊れる。
- service worker の scope はアプリのフォルダに閉じるので、アプリごとに別々にホーム画面へ追加できる。
- キャッシュ削除は自分のアプリの接頭辞が付いたものだけにする（同じオリジンの他アプリのキャッシュを消さない）。
