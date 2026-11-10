// 💪 からだチェックの動作確認。Notion・Claude・写真のURLは偽物に差し替える。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getBody, postBody, muscleHits, compareTarget, weekOf } from "../src/muscle.js";
import { BASE_DAMAGE, IMPROVE_DAMAGE, improveBonus } from "../src/muscle-config.js";

const MDS = "muscle-ds";
const BDS = "body-ds";
const env = {
  NOTION_TOKEN: "ntn_fake",
  NOTION_API_BASE: "https://notion.test/v1",
  ANTHROPIC_API_KEY: "sk-ant-fake",
  ANTHROPIC_API_URL: "https://anthropic.test/v1/messages",
  MUSCLE_DS_ID: MDS,
  BODY_DS_ID: BDS,
};
const IMG = "data:image/jpeg;base64,/9j/AAAA";
// 2026-11-05（木）12:00 JST
const NOW = Date.parse("2026-11-05T03:00:00Z");

let pages;
let calls;
let aiReply;

const text = (s) => [{ plain_text: s }];
function record(id, at, { score = 60, damage = 0, photo = true } = {}) {
  return {
    id, url: `https://www.notion.so/${id}`, created_time: at, parent: { type: "data_source_id", data_source_id: MDS },
    properties: {
      名前: { type: "title", title: text(at.slice(0, 16).replace("T", " ")) },
      撮影日時: { type: "date", date: { start: at } },
      総合スコア: { type: "number", number: score },
      ボスダメージ: { type: "number", number: damage },
      写真_正面: { type: "files", files: photo ? [{ type: "file", file: { url: `https://s3.test/${id}-front.jpg` } }] : [] },
      写真_横: { type: "files", files: [] },
      写真_背面: { type: "files", files: [] },
    },
  };
}
function bodyRow(at, weight, fat) {
  return { id: `b-${at}`, parent: { type: "data_source_id", data_source_id: BDS }, properties: { 計測日時: { type: "date", date: { start: at } }, 体重: { type: "number", number: weight }, 体脂肪率: { type: "number", number: fat } } };
}

function aiResult(extra = {}) {
  return { usable: true, reason: "", overall: 64, parts: { chest: 6, shoulders: 6, arms: 5, abs: 5, back: 6, legs: 7 }, confidence: "中", match: "高", comment: "胸が少し厚くなりました。", ...extra };
}

const notion = async (method, path, body) => {
  const res = await fetch(env.NOTION_API_BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error("notion"), { status: 502 });
  return data;
};

beforeEach(() => {
  calls = [];
  pages = [];
  aiReply = { stop_reason: "tool_use", content: [{ type: "tool_use", name: "record_result", input: aiResult() }] };
  globalThis.fetch = async (url, init = {}) => {
    const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://s3.test/")) {
      calls.push({ path: "photo", url });
      return new Response(new Uint8Array([255, 216, 255]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url === env.ANTHROPIC_API_URL) {
      const body = JSON.parse(init.body);
      calls.push({ path: "anthropic", body, headers: init.headers });
      return ok(aiReply);
    }
    const path = url.replace(env.NOTION_API_BASE, "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method: init.method, path, body });
    if (path === "/file_uploads") return ok({ id: `up-${calls.length}` });
    if (/^\/file_uploads\/.+\/send$/.test(path)) return ok({ status: "uploaded" });
    const q = path.match(/^\/data_sources\/(.+)\/query$/);
    if (q) return ok({ results: pages.filter((p) => p.parent.data_source_id === q[1]), has_more: false });
    if (path === "/pages" && init.method === "POST") {
      const p = { id: "new-record", url: "https://www.notion.so/new", created_time: new Date(NOW).toISOString(), parent: body.parent, properties: { 名前: { type: "title", title: text(body.properties.名前.title[0].text.content) }, 撮影日時: { type: "date", date: body.properties.撮影日時.date } } };
      pages.push(p);
      return ok(p);
    }
    throw new Error(`unexpected ${init.method} ${url}`);
  };
});

const posted = () => calls.find((c) => c.path === "/pages").body;

test("週の始まりは日本時間の月曜", () => {
  assert.equal(weekOf("2026-11-05"), "2026-11-02");
  assert.equal(weekOf("2026-11-02"), "2026-11-02");
  assert.equal(weekOf("2026-11-01"), "2026-10-26");
});

test("比べる記録は6日以上前のうち一番新しいもの", () => {
  const recs = [{ date: "2026-11-04", score: 62 }, { date: "2026-10-30", score: 60 }, { date: "2026-10-20", score: 55 }];
  assert.equal(compareTarget(recs, NOW).date, "2026-10-30");
  assert.equal(compareTarget([{ date: "2026-11-01", score: 1 }], NOW), null);
});

test("改善ボーナス：上がった分だけ・条件がそろわなければなし・上限あり", () => {
  assert.equal(improveBonus(4, "高"), 4 * IMPROVE_DAMAGE);
  assert.equal(improveBonus(4, "低"), 0);
  assert.equal(improveBonus(-3, "高"), 0);
  assert.equal(improveBonus(null, null), 0);
  assert.equal(improveBonus(100, "高"), 250);
});

test("初回：比べずに判定し、基本ダメージだけで1行残す（写真は Notion に上げる）", async () => {
  pages.push(bodyRow("2026-11-05T07:10:00+09:00", 66.2, 18.4));
  const res = await postBody(notion, env, { front: IMG, side: IMG }, { bossId: "boss1", now: NOW });
  const ai = calls.find((c) => c.path === "anthropic");
  assert.equal(ai.body.model, "claude-sonnet-5-5");
  // Sonnet 5.5 はツールの強制（tool_choice: tool）を受け付けない。auto＋strict で呼ばせる
  assert.equal(ai.body.tool_choice.type, "auto");
  assert.equal(ai.body.tools[0].strict, true);
  assert.equal(ai.body.tools[0].input_schema.additionalProperties, false);
  assert.equal(ai.body.messages[0].content.filter((c) => c.type === "image").length, 2);
  assert.match(ai.body.messages[0].content.at(-1).text, /66\.2kg・体脂肪率 18\.4%/);
  assert.match(ai.body.messages[0].content.at(-1).text, /比較用の写真はありません/);
  assert.equal(calls.filter((c) => c.path === "/file_uploads").length, 2);
  const p = posted();
  assert.equal(p.parent.data_source_id, MDS);
  assert.equal(p.properties.名前.title[0].text.content, "2026-11-05 12:00");
  assert.equal(p.properties.撮影日時.date.start, "2026-11-05T12:00:00+09:00");
  assert.equal(p.properties.総合スコア.number, 64);
  assert.equal(p.properties.胸.number, 6);
  assert.equal(p.properties.ボスダメージ.number, BASE_DAMAGE);
  assert.equal(p.properties.体重.number, 66.2);
  assert.equal(p.properties.前回比, undefined);
  assert.equal(p.properties.条件一致度, undefined);
  assert.deepEqual(p.properties.対象ボス.relation, [{ id: "boss1" }]);
  assert.ok(p.properties.写真_正面.files[0].file_upload.id);
  assert.equal(p.properties.写真_背面, undefined);
  assert.equal(res.record.damage, BASE_DAMAGE);
  assert.equal(res.compared, null);
});

test("1週間前の写真と比べ、上がった分を改善ボーナスにする", async () => {
  pages.push(record("old", "2026-10-29T07:00:00+09:00", { score: 60, damage: 120 }));
  pages.push(record("recent", "2026-11-01T07:00:00+09:00", { score: 63, damage: 0 })); // 先週の日曜（3日前）は比べない
  const res = await postBody(notion, env, { front: IMG }, { now: NOW });
  assert.ok(calls.some((c) => c.path === "photo" && c.url.includes("old-front")));
  const ai = calls.find((c) => c.path === "anthropic");
  assert.equal(ai.body.messages[0].content.filter((c) => c.type === "image").length, 2);
  assert.match(ai.body.messages[0].content.at(-1).text, /総合スコアは 60/);
  const p = posted();
  assert.equal(p.properties.前回比.number, 4);
  assert.equal(p.properties.条件一致度.select.name, "高");
  assert.equal(p.properties.ボスダメージ.number, BASE_DAMAGE + 4 * IMPROVE_DAMAGE);
  assert.equal(p.properties.比較した記録.rich_text[0].text.content, "2026-10-29 07:00");
  assert.equal(res.compared, "2026-10-29 07:00");
});

test("同じ週にもうダメージが入っていれば、記録だけ（ダメージ0）", async () => {
  pages.push(record("mon", "2026-11-02T07:00:00+09:00", { damage: 120 }));
  const res = await postBody(notion, env, { front: IMG }, { now: NOW });
  assert.equal(posted().properties.ボスダメージ.number, 0);
  assert.equal(res.weekUsed, true);
});

test("判定できない写真・正面なし・キーなしは保存しない", async () => {
  await assert.rejects(postBody(notion, env, { side: IMG }, { now: NOW }), /正面の写真/);
  await assert.rejects(postBody(notion, env, { front: "data:text/plain;base64,AAAA" }, { now: NOW }), /正面の写真が正しくない/);
  await assert.rejects(postBody(notion, { ...env, ANTHROPIC_API_KEY: "" }, { front: IMG }, { now: NOW }), /ANTHROPIC_API_KEY/);
  aiReply = { stop_reason: "tool_use", content: [{ type: "tool_use", name: "record_result", input: aiResult({ usable: false, reason: "暗すぎます" }) }] };
  await assert.rejects(postBody(notion, env, { front: IMG }, { now: NOW }), /暗すぎます/);
  aiReply = { stop_reason: "refusal", content: [] };
  await assert.rejects(postBody(notion, env, { front: IMG }, { now: NOW }), /断られました/);
  assert.equal(calls.filter((c) => c.path === "/pages").length, 0);
  assert.equal(calls.filter((c) => c.path === "/file_uploads").length, 0);
});

test("スコアは範囲に収め、自信度・一致度は決まった値だけ", async () => {
  pages.push(record("old", "2026-10-29T07:00:00+09:00", { score: 60 }));
  aiReply = { stop_reason: "tool_use", content: [{ type: "tool_use", name: "record_result", input: aiResult({ overall: 140, parts: { chest: 99, shoulders: 0 }, confidence: "すごく高い", match: "?" }) }] };
  await postBody(notion, env, { front: IMG }, { now: NOW });
  const p = posted().properties;
  assert.equal(p.総合スコア.number, 100);
  assert.equal(p.胸.number, 10);
  assert.equal(p.肩.number, 1);
  assert.equal(p.自信度.select.name, "低");
  assert.equal(p.条件一致度.select.name, "低");
  assert.equal(p.ボスダメージ.number, BASE_DAMAGE); // 一致度が低いので改善ボーナスなし
});

test("一覧：新しい順・比べる記録・今週の攻撃ずみ", async () => {
  pages.push(record("a", "2026-10-20T07:00:00+09:00", { score: 55, damage: 120 }), record("b", "2026-10-29T07:00:00+09:00", { score: 60, damage: 140 }));
  const data = await getBody(notion, env);
  assert.deepEqual(data.records.map((r) => r.id), ["b", "a"]);
  assert.equal(data.records[0].photos.front, "https://s3.test/b-front.jpg");
  assert.deepEqual(data.configured, { notion: true, ai: true });
  const hits = await muscleHits(notion, env);
  assert.deepEqual(hits.map((x) => [x.date, x.damage]), [["2026-10-29", 140], ["2026-10-20", 120]]);
  assert.deepEqual(await muscleHits(notion, { ...env, MUSCLE_DS_ID: "" }), []);
});
