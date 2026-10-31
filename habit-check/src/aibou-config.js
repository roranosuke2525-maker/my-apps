// あいぼう（たまごから育つペット）の設定。ここを書き換えれば育ち方が変わる。
// 傾向の型は DB_あいぼう の選択肢と同じ名前にする（ちから・かしこさ・やさしさ・しっかり）。

export const TYPES = ["ちから", "かしこさ", "やさしさ", "しっかり"];

// 習慣 → 型。習慣名（列名の先頭の ◆◇★☼☀︎◐◷☾↻ を除いたもの）にキーワードが入っていればその型。
// 上から順に見て、最初に当たった型にする。どれにも当たらない習慣は4つの型に均等割り
export const HABIT_TYPES = {
  ちから: ["ストレッチ", "腹筋ローラー", "胸トレ", "スクワット"],
  かしこさ: ["新聞", "読書"],
  やさしさ: ["洗濯", "ゴミ", "ごみ", "ごはん作り", "食器洗い", "お風呂", "寝かしつけ", "ミルク"],
  しっかり: ["起床", "マネーフォワード", "サプリ", "プロテイン", "ヤクルト", "千切りキャベツ", "日焼け止め", "INBOX整理", "体重計"],
};

// DB_タスク管理 の分類タグ → 型。ここにないタグ（タグなしも）は4つの型に均等割り
export const TAG_TYPES = {
  ちから: ["HEALTH"],
  かしこさ: ["LEARN", "BOOK", "AI", "TECH", "NOTION"],
  やさしさ: ["HOME", "BUILD", "CHILD", "FAMILY"],
  しっかり: ["MONEY", "ROUTINE", "BUY", "FOOD"],
};

// 習慣1つのEXP（DB_習慣チェック「EXP」の式と同じ：◆必ず 5／◇できれば・★ボーナス 10、ひとこと +5）。
// 行の EXP（式の値）が読めればその合計をこの重みで割り振るので、式を変えても合計はずれない
export const HABIT_WEIGHTS = { "◆": 5, "◇": 10, "★": 10 };
export const NOTE_EXP = 5;

// 進化に必要な、誕生日からの累計EXP。
// 2026-10-28 時点の直近14日の平均（習慣 約195＋タスク 約106 ≒ 1日300EXP）から、
// 孵化≒1日・成長期≒2週間・成体≒2か月になるようにした
export const THRESHOLDS = { 幼体: 300, 成長期: 4000, 成体: 18000 };

// 成体が隠しの「バランス型」になる条件：成長期の間の4つの型の（最大−最小）が、期間合計のこの割合以内
export const BALANCE_RATIO = 0.1;

export const STAGES = ["たまご", "幼体", "成長期", "成体"];

const MARKS = /^[◆◇★☼☀◷◐☾↻\s︎️]+/u;

// 習慣の型（どれにも当たらなければ null＝均等割り）
export function habitType(name) {
  const label = String(name).replace(MARKS, "");
  return TYPES.find((t) => HABIT_TYPES[t].some((k) => label.includes(k))) ?? null;
}

export function habitWeight(name) {
  return HABIT_WEIGHTS[String(name).trim()[0]] ?? HABIT_WEIGHTS["◇"];
}

export function tagType(tag) {
  return TYPES.find((t) => TAG_TYPES[t].includes(tag)) ?? null;
}
