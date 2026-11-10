// 💪 からだチェック（写真で筋肉のつき具合を判定し、ボスに攻撃する）の設定。
// ここを書き換えれば、ダメージの強さや比べる写真の選び方が変わる。

// 筋肉チェックのダメージの型（ボスの弱点が「ちから」なら1.5倍、そうびの「ちから」＋%も乗る）
export const MUSCLE_TYPE = "ちから";

// ダメージ（素の値。弱点・あいぼう・能力値・そうびの倍率はぼうけんで掛ける）
// 目安：1日の習慣＋タスクが約300EXP。週1回の撮影で、半日ぶんくらいの攻撃になるようにした
export const BASE_DAMAGE = 120; // 撮影しただけで入る
export const IMPROVE_DAMAGE = 25; // 比べた写真より総合スコアが1点上がるごとに
export const IMPROVE_MAX = 250; // 改善ボーナスの上限

// ダメージが入るのは、週（月曜〜日曜・日本時間）に1回まで。2回目以降は記録だけ
export const WEEKLY_LIMIT = 1;

// 比べる写真：COMPARE_DAYS 日以上前の記録のうち一番新しいもの（1日では筋肉はほぼ変わらないため）
export const COMPARE_DAYS = 6;

// 判定に使うモデル（wrangler.toml の MUSCLE_MODEL で上書きできる。安くするなら claude-haiku-5-5）
export const DEFAULT_MODEL = "claude-sonnet-5-5";

// 部位（Notion の列名と、AI に返してもらうキー）
export const PARTS = [
  ["chest", "胸"],
  ["shoulders", "肩"],
  ["arms", "腕"],
  ["abs", "腹"],
  ["back", "背中"],
  ["legs", "脚"],
];

// 撮る向き（Notion の列名）
export const VIEWS = [
  ["front", "正面", "写真_正面"],
  ["side", "横", "写真_横"],
  ["back", "背面", "写真_背面"],
];

// 改善ボーナスを入れるか・いくつか（比べる記録がない／条件がそろっていない／下がった なら 0）
export function improveBonus(diff, match) {
  if (typeof diff !== "number" || diff <= 0 || match === "低") return 0;
  return Math.min(IMPROVE_MAX, Math.round(diff * IMPROVE_DAMAGE));
}
