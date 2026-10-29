import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { toScript, SPEAKER_CODES } from "../public/theater-script.js";
import { SPEAKERS } from "../public/theater-speakers.js";
import { CHAPTER_BGS, BG_WORDS } from "../public/theater-stage.js";

const blocksOf = (n) => readFileSync(new URL(`../story/episode2/${String(n).padStart(2, "0")}.md`, import.meta.url), "utf8")
  .replace(/^---[\s\S]*?---\n/, "").split("\n").filter((l) => l.trim())
  .map((l) => (l.startsWith("> ") ? { type: "quote", text: l.slice(2) } : { type: "p", text: l }));

test("エピソード2の全話：話し手の数が、せりふのある段落の数と合う（本文を直したら theater-speakers.js も直す）", () => {
  for (let n = 1; n <= 50; n++) {
    const paras = blocksOf(n).filter((b) => b.type === "p" && b.text.includes("「")).length;
    assert.equal(SPEAKERS[200 + n].trim().split(/\s+/).length, paras, `第${n}話`);
  }
});

test("台本：話し手・SYSTEM・WARNING・地の文に分かれる", () => {
  const script = toScript(blocksOf(1), SPEAKERS[201]);
  const says = script.filter((s) => s.kind === "say");
  assert.equal(says[0].who, "ルミ");
  assert.equal(says[1].who, "さとし");
  assert.ok(script.some((s) => s.kind === "system"));
  assert.ok(script.some((s) => s.kind === "warn" && /灰のスライム/.test(s.text)));
  assert.ok(script.some((s) => s.kind === "narr"));
});

test("話し手の略号はすべて定義済みか、名前そのもの", () => {
  for (const line of Object.values(SPEAKERS)) {
    for (const t of line.trim().split(/\s+/).flatMap((x) => x.split("/"))) {
      assert.ok(t === "-" || SPEAKER_CODES[t] || t.length >= 2, `不明な略号: ${t}`);
    }
  }
});

test("背景：話ごとの背景はすべて合図の語と絵がある", () => {
  const files = new Set(readdirSync(new URL("../public/img/bg/", import.meta.url)).map((f) => f.replace(".webp", "")));
  for (const list of Object.values(CHAPTER_BGS)) {
    for (const bg of list) {
      assert.ok(BG_WORDS[bg], `合図の語がない: ${bg}`);
      assert.ok(files.has(bg), `絵がない: ${bg}`);
    }
  }
});

test("ラベルが合わないときは推しはかる", () => {
  const script = toScript([{ type: "p", text: "「おはよう」ルミが言った。" }], "さ さ");
  assert.equal(script[0].who, "ルミ");
});
