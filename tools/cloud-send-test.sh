#!/usr/bin/env bash
# 検証用：CI用の長期トークン（claude setup-token）で、既存のClaude Codeクラウドセッションに追いメッセージを送れるか確かめる
# 使い方（Codespacesのターミナルで）: bash tools/cloud-send-test.sh
set -u

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code をインストールします…"
  npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || { echo "インストール失敗"; exit 1; }
fi

echo
echo "① トークンを作ります。表示されたURLを開いて許可し、出てきたコードをここに貼ってください。"
echo "   最後に表示される sk-ant-oat01-… のトークンをコピーしておいてください。"
echo
claude setup-token

echo
read -r -s -p "② コピーしたトークンを貼り付けて Enter（画面には表示されません）: " TOKEN
echo
read -r -p "③ テスト用セッションのURLまたはID（session_…）を貼り付けて Enter: " SESSION
echo

echo "送信テスト中…"
CLAUDE_CODE_OAUTH_TOKEN="$TOKEN" claude -p "【スマホのCodespacesからのテスト】このメッセージが届いたら「受信OK」とだけ返してください。" \
  --cloud "$SESSION" --output-format json
RC=$?
unset TOKEN

echo
if [ $RC -eq 0 ]; then
  echo "=== 結果：送信コマンドは成功しました。テスト用セッションに「受信OK」が返っているか確認してください ==="
else
  echo "=== 結果：失敗しました（終了コード $RC）。上のエラー文面をClaudeに伝えてください ==="
fi
