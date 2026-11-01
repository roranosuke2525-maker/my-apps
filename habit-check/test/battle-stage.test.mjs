import { test } from "node:test";
import assert from "node:assert/strict";

// battle-stage.js は画面用だが、攻撃の割り当て（attacksOf）は node で確かめられる
globalThis.matchMedia = () => ({ matches: false });
const { attacksOf } = await import("../public/battle-stage.js");

const log = [
  { date: "2026-11-01", kind: "habit", damage: 60, types: { ちから: 30, かしこさ: 20, しっかり: 10 } },
  { date: "2026-10-31", kind: "task", name: "コインスライム", family: "コイン", stars: 0, damage: 12 },
  { date: "2026-10-31", kind: "task", name: "モジゴブリン", family: "モジ", stars: 1, damage: 24 },
];

test("タスクは種族の得意な仲間、習慣は型の仲間が攻撃する（古い順）", () => {
  const a = attacksOf(log, ["ムキ", "フミ", "ゼニ"]);
  assert.deepEqual(a.map((x) => [x.who, x.damage]), [["フミ", 24], ["ゼニ", 12], ["ムキ", 30], ["フミ", 20], ["ゼニ", 10]]);
});

test("まだ仲間でない人の分は、さとしが攻撃する", () => {
  const a = attacksOf(log, []);
  assert.ok(a.every((x) => x.who === "さとし"));
  assert.equal(a.reduce((s, x) => s + x.damage, 0), 96);
});
