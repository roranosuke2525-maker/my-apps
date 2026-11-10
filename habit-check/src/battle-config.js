// ぼうけん（バトル）の設定。ここを書き換えればモンスターの名前・強さ・ダメージの計算が変わる。
// Notion の EXP の式は変えない。ここのボーナスはバトルのダメージにだけ効く。

// DB_タスク管理 の分類タグ → モンスターの種族（名前の頭・色）。どれにもないタグ（タグなしも）は「モヤモヤ」
export const FAMILIES = [
  { name: "ホコリ", tags: ["HOME", "BUILD"], color: ["#9aa0a6", "#6f757b", "#d7dadd"] },
  { name: "ヨナキ", tags: ["CHILD", "FAMILY"], color: ["#f4a3b8", "#d97c95", "#ffd9e3"] },
  { name: "コイン", tags: ["MONEY", "BUY"], color: ["#f2c14e", "#c9962a", "#fff0b8"] },
  { name: "ダラケ", tags: ["HEALTH", "BEAUTY", "FOOD"], color: ["#8fd18b", "#5ea95a", "#d6f5d3"] },
  { name: "モジ", tags: ["LEARN", "BOOK", "AI", "TECH", "NOTION"], color: ["#7fb2f0", "#4f84c9", "#d4e6fc"] },
  { name: "アトマワシ", tags: ["MUSIC", "MOVIE", "TOY", "COFFEE", "TRIP", "CAR"], color: ["#b99be0", "#8a6bbd", "#e8dcf7"] },
  { name: "ザツム", tags: ["WORK"], color: ["#f0a067", "#c9743b", "#fde0c8"] },
];
export const DEFAULT_FAMILY = { name: "モヤモヤ", tags: [], color: ["#e9e4f2", "#bfb6d1", "#ffffff"] };

// 重さ → 格（名前のおしり・絵の形）。重さがなければ M
export const RANKS = {
  S: { name: "スライム", shape: "slime" },
  M: { name: "ゴブリン", shape: "goblin" },
  L: { name: "ゴーレム", shape: "golem" },
  XL: { name: "ドラゴン", shape: "dragon" },
};

// 凶暴化：作ってから倒すまでの日数で ★（STAR_DAYS 日ごとに1つ、最大 MAX_STARS）。★1つにつきダメージ +STAR_BONUS
export const STAR_DAYS = 14;
export const MAX_STARS = 5;
export const STAR_BONUS = 0.2;

// ボスの弱点と合う型のEXPは WEAK_BONUS 倍。弱点「バランス」は4つすべてが BALANCE_BONUS 倍
export const WEAK_BONUS = 1.5;
export const BALANCE_BONUS = 1.2;
// あいぼうの型がボスの弱点と同じなら、ダメージ全体が PET_BONUS 倍（こうかばつぐん）
export const PET_BONUS = 1.2;
// さとしの能力値：これまでの全EXPを4つの型に振り分け、STAT_EXP ごとに1。弱点の能力値1につき +STAT_RATE（最大 STAT_MAX）
export const STAT_EXP = 50;
export const STAT_RATE = 0.001;
export const STAT_MAX = 0.2;

export function familyOf(tag) {
  return FAMILIES.find((f) => f.tags.includes(tag)) || DEFAULT_FAMILY;
}

export function starsOf(days) {
  return Math.max(0, Math.min(MAX_STARS, Math.floor(days / STAR_DAYS)));
}
