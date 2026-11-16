// ギルドの決まり。Notion の DB_ギルド依頼 の式（累計EXP・けいじばん）と同じ値にしておく。
// 🪜 のぼる依頼：段階をこえるたびにランクが上がる。🔁 くりかえし依頼：ランク固定

export const RANKS = ["D", "C", "B", "A", "S"];
export const RANK_NEED = { D: 1, C: 6, B: 12, A: 20, S: 30 }; // 受けられるLv
export const RANK_REWARD = { D: 40, C: 70, B: 110, A: 160, S: 220 }; // 報酬EXP
export const RANK_RARITY = { D: 1, C: 2, B: 3, A: 4, S: 5 }; // 落ちるそうびのレア度（会心で＋1）

// 後日談が開く回数（くりかえし依頼）。のぼる依頼は段階をこえるたび
export const REPEAT_EPILOGUE_AT = [1, 5, 10, 20, 30];

// done 回めの報告（0から）のランク
export function rankAt(quest, done) {
  const start = Math.max(0, RANKS.indexOf(quest.rank));
  if (quest.repeat) return RANKS[start];
  const L = Math.max(1, quest.stages?.length || 1);
  return RANKS[Math.min(RANKS.length - 1, start + Math.min(done, L - 1))];
}

// これまでの報告 n 回で手に入れた EXP の合計（Notion の「累計EXP」と同じ）
export function totalExp(quest, n) {
  let sum = 0;
  for (let k = 0; k < n; k++) sum += RANK_REWARD[rankAt(quest, k)];
  return sum;
}

// いまの段階の見え方（けいじばん）
export function questBoard(quest, playerLv) {
  const n = quest.count ?? 0;
  const stages = quest.stages || [];
  const L = Math.max(1, stages.length);
  const i = quest.repeat ? 0 : Math.min(n, L - 1);
  const rank = rankAt(quest, n);
  const need = RANK_NEED[rank];
  const reward = RANK_REWARD[rank];
  const master = !quest.repeat && stages.length > 0 && n >= L;
  const open = typeof playerLv !== "number" || playerLv >= need;
  const lines = String(quest.lines || "").split("\n").map((s) => s.trim());
  const line = lines[Math.min(i, Math.max(0, lines.length - 1))] || "";
  const board = `【${rank}ランク】 ${quest.repeat ? "🔁 くりかえし" : master ? "🏆 制覇（くりかえし）" : `${n + 1}段目／${L}`}\n` +
    `▶ ${stages[i] ?? ""}\nほうしゅう ${reward} EXP\n${open ? "✅ うけられる" : `🔒 Lv${need} から`}\nたっせい ${n} かい`;
  return { stage: i, stageRank: rank, need, reward, master, open, line, board, dropRarity: RANK_RARITY[rank] };
}

// 後日談の番号（何話め）：のぼる依頼は段階をこえた数、くりかえしは REPEAT_EPILOGUE_AT に届いた数
export function epilogueCount(quest, n) {
  if (quest.repeat) return REPEAT_EPILOGUE_AT.filter((x) => n >= x).length;
  return Math.min(n, Math.max(1, quest.stages?.length || 1));
}
