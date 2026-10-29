// 文字の読み取り（public/parse.js）の確かめ。 npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const g = {};
new Function("window", await readFile(new URL("../public/parse.js", import.meta.url), "utf8"))(g);
const P = g.ShioriParse;

test("My Clippings.txt：本ごとに分け、メモは直前のハイライトに付ける。ブックマークは飛ばす", () => {
  const raw = [
    "﻿見本の本 (作家 一)",
    "- 12ページ|位置No. 180-182のハイライト |作成日: 2026年10月1日木曜日 21:00:00",
    "",
    "一つ目の",
    "ハイライト。",
    "==========",
    "見本の本 (作家 一)",
    "- 12ページ|位置No. 182のメモ |作成日: 2026年10月1日",
    "",
    "自分のメモ",
    "==========",
    "見本の本 (作家 一)",
    "- 位置No. 300のブックマーク |作成日: 2026年10月1日",
    "",
    "==========",
    "Another Book (Writer)",
    "- Your Highlight on page 5 | Location 70-71 | Added on Monday",
    "",
    "English line.",
    "==========",
  ].join("\r\n");
  const books = P.parseKindle(raw);
  assert.deepEqual(books, [
    { title: "見本の本", author: "作家 一", items: [{ text: "一つ目の ハイライト。", page: 12, loc: "180-182", memo: "自分のメモ" }] },
    { title: "Another Book", author: "Writer", items: [{ text: "English line.", page: 5, loc: "70-71", memo: "" }] },
  ]);
});

test("メモとハイライト（Web）：見出しの行、本文、メモ", () => {
  const raw = [
    "見本の本",
    "作家 一",
    "オプション",
    "黄色のハイライト | 位置: 1,234",
    "最初の文。",
    "メモ: 気になった",
    "ピンクのハイライト | ページ: 45",
    "二つ目の文。",
    "続きの行。",
    "Yellow highlight | Location: 99",
    "Third.",
    "Note: mine",
  ].join("\n");
  const [book] = P.parseKindle(raw);
  assert.equal(book.title, "見本の本");
  assert.deepEqual(book.items, [
    { text: "最初の文。", page: null, loc: "1,234", memo: "気になった" },
    { text: "二つ目の文。 続きの行。", page: 45, loc: "", memo: "" },
    { text: "Third.", page: null, loc: "99", memo: "mine" },
  ]);
});

test("見出しが無ければ空行で区切った塊ごと", () => {
  const [book] = P.parseKindle("一つ目のハイライトです。\n\n二つ目の\nハイライトです。\n\nx");
  assert.deepEqual(book.items.map((i) => i.text), ["一つ目のハイライトです。", "二つ目の ハイライトです。"]);
  assert.deepEqual(P.parseKindle("  "), []);
});

test("書名で本を探す（空白・かっこの違いは無視）", () => {
  const books = [{ id: "a", title: "月と六ペンス" }, { id: "b", title: "ダ・ヴィンチ・コード（上）" }];
  assert.equal(P.matchBook(books, "月と六ペンス (新潮文庫)")?.id, "a");
  assert.equal(P.matchBook(books, "ダ・ヴィンチ・コード 上")?.id, "b");
  assert.equal(P.matchBook(books, "別の本"), null);
});

test("ページの文：文に分け、AI の選んだ箇所に重なる文に印を付けてまとめる", () => {
  const paras = ["「行こう」と彼は言った。空は青い！ 風が吹く。", "次の段落です。最後"];
  assert.deepEqual(P.sentences(paras[0]), ["「行こう」と彼は言った。", "空は青い！", " 風が吹く。"]);
  assert.deepEqual(P.sentences(paras[1]), ["次の段落です。", "最後"]);
  const marks = P.markSentences(paras, ["空は青い！風が", "最後", "どこにもない文"]);
  assert.deepEqual(marks, [[false, true, true], [false, true]]);
  assert.deepEqual(P.groupMarks(paras, marks), [{ key: "0:1", text: "空は青い！ 風が吹く。" }, { key: "1:1", text: "最後" }]);
});

test("貼り付けたページの文：印刷の行をつなぎ、字下げ・かぎかっこ・空行で段落を分ける。数字だけの行はページ番号", () => {
  const raw = "　朝になると、彼は\n窓を開けた。\n「おはよう」\n42\nと声がした。\n\nHello\nworld.";
  assert.deepEqual(P.pageFromText(raw), { paragraphs: ["　朝になると、彼は窓を開けた。".trim(), "「おはよう」と声がした。", "Hello world."], page: 42 });
  assert.deepEqual(P.pageFromText(""), { paragraphs: [], page: null });
});

test("NotebookLM に渡す文", () => {
  const text = P.exportText(
    { title: "見本の本", author: "作家 一", publisher: "", finished: "2026-10-26", rating: "★★★★", review: "よかった" },
    [{ text: "引用一", page: 12, loc: "", source: "📷 付箋写真", memo: "メモ一" }, { text: "引用二", page: null, loc: "40", source: "📱 Kindle", memo: "" }],
    [{ text: "前の形", memo: "" }],
  );
  assert.equal(text, [
    "# 見本の本", "", "著者：作家 一 ／ 読了：2026-10-26 ／ 評価：★★★★", "", "## 感想", "", "よかった", "", "## ハイライト（3件）",
    "", "> 引用一", "（p.12 ・ 📷 付箋写真）", "メモ：メモ一",
    "", "> 引用二", "（位置 40 ・ 📱 Kindle）",
    "", "> 前の形", "（付箋写真・前の形）", "",
  ].join("\n"));
});

test("読書辞典の調べるリンク：種別ごと。人物・距離感はネタバレよけで出さない", () => {
  assert.deepEqual(P.lookupLinks("鎌倉", "📍 舞台").map((l) => l.label), ["地図", "画像", "Wikipedia"]);
  assert.equal(P.lookupLinks("鎌倉", "📍 舞台")[0].url, "https://www.google.com/maps/search/?api=1&query=%E9%8E%8C%E5%80%89");
  assert.deepEqual(P.lookupLinks("ドクダミ", "🌿 植物").map((l) => l.label), ["画像", "Wikipedia"]);
  assert.deepEqual(P.lookupLinks("叔母", "👥 人物・距離感"), []);
  assert.deepEqual(P.lookupLinks("矜持", "📖 言葉").map((l) => l.label), ["辞書", "検索"]);
  assert.deepEqual(P.lookupLinks("なにか", "").map((l) => l.label), ["辞書", "検索"]);
  assert.deepEqual(P.lookupLinks("  ", "📖 言葉"), []);
});
