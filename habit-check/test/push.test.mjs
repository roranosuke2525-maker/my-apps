import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAlerts, jstClock, runAlerts } from "../src/push.js";

test("アラートは JST の時刻から10分のあいだだけ", () => {
  const at = (utc) => dueAlerts(new Date(utc)).map((a) => a.tag);
  assert.deepEqual(at("2026-11-04T22:45:00Z"), ["bath-dryer"]); // 11/5 7:45 JST
  assert.deepEqual(at("2026-11-04T22:54:00Z"), ["bath-dryer"]);
  assert.deepEqual(at("2026-11-04T22:44:00Z"), []);
  assert.deepEqual(at("2026-11-04T22:56:00Z"), []);
  assert.equal(jstClock(new Date("2026-11-04T22:45:00Z")).date, "2026-11-05");
});

test("チェックずみなら送らず、まだなら1日1回だけ送る", async () => {
  const store = new Map();
  const PUSH = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async () => ({ keys: [] }) };
  const env = { PUSH, VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_JWK: "{}" };
  const now = new Date("2026-11-04T22:45:00Z");
  assert.deepEqual(await runAlerts(env, { now, isDone: async () => true }), []);
  assert.deepEqual(await runAlerts(env, { now, isDone: async () => false }), ["bath-dryer"]);
  assert.deepEqual(await runAlerts(env, { now, isDone: async () => false }), []);
  assert.equal(JSON.parse(store.get("alert:2026-11-05")).habit, "◆☼ 浴室乾燥のスイッチを入れる");
});
