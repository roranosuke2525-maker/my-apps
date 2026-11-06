import test from "node:test";
import assert from "node:assert/strict";
import { rankAt, totalExp, questBoard, epilogueCount } from "../src/guild-config.js";
import { rarityOf } from "../src/item-config.js";
import { QUESTS } from "../scripts/guild-quests.mjs";

const climb = { rank: "D", stages: ["a", "b", "c", "d", "e"] };
const repeat = { rank: "C", repeat: true, stages: ["x"] };

test("のぼる依頼は段階ごとにランクが上がり、最後で止まる", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => rankAt(climb, n)), ["D", "C", "B", "A", "S", "S", "S"]);
  assert.deepEqual([0, 1, 2].map((n) => rankAt({ rank: "C", stages: ["a", "b"] }, n)), ["C", "B", "B"]);
  assert.equal(totalExp(climb, 3), 40 + 70 + 110);
});

test("くりかえし依頼はランク固定。後日談は 1/5/10/20/30 回で開く", () => {
  assert.equal(rankAt(repeat, 12), "C");
  assert.equal(totalExp(repeat, 3), 210);
  assert.deepEqual([0, 1, 4, 5, 29, 30].map((n) => epilogueCount(repeat, n)), [0, 1, 1, 2, 4, 5]);
  assert.deepEqual([0, 1, 5, 7].map((n) => epilogueCount(climb, n)), [0, 1, 5, 5]);
});

test("けいじばん：段階のセリフと受けられるLv", () => {
  const b = questBoard({ ...climb, count: 1, lines: ["一", "二", "三"].join("\n") }, 5);
  assert.deepEqual([b.stage, b.stageRank, b.need, b.open, b.line], [1, "C", 6, false, "二"]);
  assert.equal(questBoard({ ...climb, count: 5 }, 40).master, true);
});

test("そうびのレア度はその回のランク（会心で＋1、最大★5）", () => {
  assert.deepEqual([0, 1, 4].map((n) => rarityOf(climb, n, false)), [1, 2, 5]);
  assert.equal(rarityOf(climb, 4, true), 5);
  assert.equal(rarityOf(repeat, 9, true), 3);
});

test("依頼データ：段階とセリフの数がそろっている", () => {
  for (const q of QUESTS.filter((x) => !x.closed)) {
    assert.ok(q.requester, q.title);
    assert.equal(q.lines.length, q.repeat ? 1 : q.stages.length, q.title);
  }
});
