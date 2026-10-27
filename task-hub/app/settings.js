  // ================= 設定 =================
  const SERVER = "Notion";
  const DS = {
    task: "21762844-acbe-8075-bbe6-000bcaf22801", // DB_タスク管理
    proj: "6cc9696c-be0e-4b03-9f91-77143ab0a629", // DB_プロジェクト
    diag: "a36bdfc4-617e-4eac-ad23-f01f9e256278", // DB_診断レポート
    log: "15f261e9-1452-4eed-917f-06dd8a13fea3", // DB_運用ログ
    goal: "15898cc5-118c-438e-b2b0-5f26f2f41978", // DB_目標
    daily: "53881991-7268-41b5-8954-2bc4b2bf1971", // DB_Daily（在庫・補充リスト）
  };
  const DB_PAGE = "3ed62844acbe81438bf3c88092856f8b"; // 🗄 データベース
  const PLAYER = "https://www.notion.so/3e962844acbe81b0843ff78fe19791fa"; // DB_プレイヤー（Satoshi）
  const STORE = "imadoko:v3";
  const ST = { next: "⏭ NEXT", doing: "▶️ DOING", wait: "⏳ WAITING", some: "🕰 SOMEDAY", ai: "🤖 AI", inbox: "📥 INBOX", done: "✅ DONE", ref: "📚 REFERENCE" };
  const ALL_STATUSES = [ST.inbox, ST.ai, ST.next, ST.doing, ST.wait, ST.some, ST.ref, ST.done];
  const OPEN_STATUSES = [ST.next, ST.doing, ST.wait, ST.some, ST.ai, ST.inbox];
  const AIA = ["🔍", "🔬", "💬", "💭", "🔍✅"];
  const AI_TURN = { "🔍": "ai", "🔬": "ai", "💬": "ai", "💭": "me", "🔍✅": "me" };
  const AI_LABEL = { "🔍": "調べて", "🔬": "徹底調査", "💬": "深掘り（質問票）", "💭": "回答待ち", "🔍✅": "調べ終わった・判定待ち" };
  const WAKU = ["☼ 朝", "💻 PC", "🏠 家・外", "作業中"];
  const WEIGHTS = ["S", "M", "L", "XL"];
  const TAGS = ["HOME", "BUILD", "CHILD", "FAMILY", "MONEY", "FOOD", "HEALTH", "BEAUTY", "LEARN", "AI", "TECH", "BOOK", "MUSIC", "COFFEE", "MOVIE", "TRIP", "TOY", "CAR", "WORK", "BUY"];
  // GTD の段。色は CSS の --s-*。今日・予定は実行日で決まる（DB_タスク管理の「今どこ」と同じ規則）
  const STAGES = {
    inbox: { name: "収集", sub: "📥 INBOX", c: "var(--s-inbox)" },
    ai: { name: "AI", sub: "🤖 AIに預けた", c: "var(--s-ai)" },
    next: { name: "次にやる", sub: "⏭ NEXT・▶️ DOING", c: "var(--s-next)" },
    plan: { name: "予定", sub: "実行日が明日以降", c: "var(--s-plan)" },
    today: { name: "今日", sub: "実行日が今日まで", c: "var(--s-today)" },
    wait: { name: "待ち", sub: "⏳ WAITING", c: "var(--s-wait)" },
    some: { name: "いつか", sub: "🕰 SOMEDAY", c: "var(--s-some)" },
    ref: { name: "資料", sub: "📚 REFERENCE", c: "var(--s-ref)" },
    done: { name: "済み", sub: "✅ 今日終えた", c: "var(--s-done)" },
  };

  // 🗄 データベース ページの並び（ページが読めないときの控え。読めたらページの内容で置き換える）
  const SECTIONS = [
    ["✅ タスク・仕組み", [["21762844-acbe-8075-bbe6-000bcaf22801", "DB_タスク管理"], ["f482a557-cd35-4bf1-a2a1-eee22c681517", "DB_スキル"], ["15f261e9-1452-4eed-917f-06dd8a13fea3", "DB_運用ログ"], ["15898cc5-118c-438e-b2b0-5f26f2f41978", "DB_目標"], ["6cc9696c-be0e-4b03-9f91-77143ab0a629", "DB_プロジェクト"], ["a36bdfc4-617e-4eac-ad23-f01f9e256278", "DB_診断レポート"]]],
    ["🧪 AI・プロンプト", [["e1562d9b-3924-4709-b696-d3ee05437d3c", "DB_プロンプト"]]],
    ["💰 お金", [["de35539c-31ce-4112-af1f-296bc3e2b04b"], ["3d49780c-10f9-4efd-b9f0-06b712298ee3"], ["22562844-acbe-8091-970a-000ba7c7d505"], ["29762844-acbe-80fe-8853-000b1aae6031"]]],
    ["🔑 アカウント", [["26462844-acbe-8030-ac7c-000b2fc59a17"], ["26362844-acbe-8090-9fd3-000b55f7f608"], ["26462844-acbe-80ba-8080-000b0850a590"]]],
    ["🍳 料理", [["22562844-acbe-8019-a513-000b708749d8"], ["22862844-acbe-80f8-b2f4-000b650fcb64"], ["24e62844-acbe-809d-8a15-000be073e312"], ["25462844-acbe-80a5-811d-000b22397b04"], ["25762844-acbe-8000-be8b-000b17ba125c"]]],
    ["🎮 習慣（RPG）", [["e730b8b2-bb41-491d-9382-a296c40e6deb", "DB_習慣チェック"], ["7ab3aa8b-2f1e-44cb-b2f8-592202bab226", "DB_すがた"], ["aa2b621b-b928-4047-91f8-9eb531f71814", "DB_プレイヤー"], ["86ea2c0d-a66a-49e4-9a6b-b287f4f32bbd", "DB_ギルド依頼"], ["0ea02603-b2dd-4064-bc84-bf02f0e60aca", "DB_ギルド達成記録"], ["f673bc1a-91b2-467d-bcd3-b2a70bd1bcbd", "DB_ものがたり"], ["24462844-acbe-8065-bca4-000b4da3b5f3"]]],
    ["🏠 暮らし・家", [["53881991-7268-41b5-8954-2bc4b2bf1971"], ["21f62844-acbe-80cc-954c-000b57ae3e36"], ["21c62844-acbe-8069-a125-000b4743c5ee"], ["26662844-acbe-809b-90c7-000b31d5490a"], ["26762844-acbe-80ae-8a01-000b00110193"], ["4c30681e-8563-4044-9fc5-134d695a41eb", "DB_ワードローブ"]]],
    ["👶 家族", [["2f362844-acbe-804a-9314-000be9fe07fa"], ["5b44efda-1531-4df5-93d0-96085df89dd3"], ["21c62844-acbe-800b-8b6b-000b7d8e1e7c"]]],
    ["📝 記録・趣味", [["f9332496-b396-44cd-af45-e682ff4fcc8c"], ["23362844-acbe-80b5-a2b4-000b59e31cdf"], ["f22b94dd-2a47-419a-95cf-e406837e8e5e"], ["1730d2d3-32fc-45e9-944e-fe9b801909a5", "DB_体組成ログ"], ["22062844-acbe-8035-af00-000b3af97d3f"], ["24162844-acbe-807c-91bf-000b82be8aa2"]]],
    ["☕ コーヒー", [["21162844-acbe-801d-9540-000bac4ca660"], ["25c62844-acbe-8002-9cb0-000b18e69fd9"], ["25c62844-acbe-80c4-9230-000b4ed3899b"], ["599ef279-52ad-48d7-bdb3-f079103046da"], ["25c62844-acbe-8094-abdf-000b0a334597"], ["33062844-acbe-81c5-85d5-000b725a6493"], ["22762844-acbe-805f-a401-000bbd4241e7"]]],
    ["📰 ニュース・日記", [["62ba6b9f-d216-49d8-96b2-cf2ce0e09cdd", "DB_ニュース"], ["2eaf269b-813f-4f1f-a980-e57602b1f99d", "DB_ジャーナル"]]],
  ];

  const SECRET = /パスワード|password|passwd|pass|PIN|暗証|秘密|secret|token|キー|コード番号/i;

  // ================= 状態 =================
  const S = {
    mode: "loading", tab: "flow", stage: "today", stageView: "list", aiSeg: "me", pileKey: "inbox", logSeg: "diag", logEvent: "",
    tasks: [], refs: [], projects: [], doneToday: [], diag: [], logs: [], goals: [], extraErr: {},
    page: {}, slide: null, error: null, loadedAt: null,
    dbs: [], dbSec: null, dbOpen: null, dbRows: [], dbSchema: null, dbQuery: "", dbErr: null, dbLoading: false, dbView: "table",
    shopSeg: "list", shopHide: false, shopTarget: "", stockCat: "", stock: [], refillDone: {},
    bodies: {}, // id → { raw, edited }（AIの番・あなたの番の要約用）
    undo: [],
  };
  const known = new Map(); // id → タスク（書き込みは読み込んだ行・開いたページだけ）

