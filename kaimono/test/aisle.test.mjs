// 売り場の当て方と、入力の分け方。 npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import "../public/aisle.js";

const A = globalThis.KaimonoAisle;
const aisle = (s) => A.aisleOf(s).name;

test("売り場：長く当たった言葉を優先する", () => {
  assert.equal(aisle("キャベツ"), "野菜・果物");
  assert.equal(aisle("牛乳"), "卵・乳製品・豆腐");
  assert.equal(aisle("豆乳"), "卵・乳製品・豆腐");
  assert.equal(aisle("粉ミルク"), "ベビー");
  assert.equal(aisle("サラダ油"), "調味料・乾物・缶詰");
  assert.equal(aisle("水菜"), "野菜・果物");
  assert.equal(aisle("鶏むね肉"), "肉・魚");
  assert.equal(aisle("トイレットペーパー"), "日用品");
  assert.equal(aisle("ﾊﾞﾅﾅ"), "野菜・果物"); // 半角カナ
  assert.equal(aisle("ばなな"), "野菜・果物"); // ひらがな
  assert.equal(aisle("謎のもの"), "その他");
});

test("数を分ける", () => {
  assert.deepEqual(A.splitQty("牛乳 2"), { name: "牛乳", qty: "2" });
  assert.deepEqual(A.splitQty("卵×1パック"), { name: "卵", qty: "1パック" });
  assert.deepEqual(A.splitQty("食パン 6枚"), { name: "食パン", qty: "6枚" });
  assert.deepEqual(A.splitQty("7up"), { name: "7up", qty: "" });
  assert.deepEqual(A.splitQty("2"), { name: "2", qty: "" });
});

test("入力を品目に分ける", () => {
  assert.deepEqual(A.splitInput("牛乳、卵,パン\n バナナ  2 ;"), ["牛乳", "卵", "パン", "バナナ 2"]);
  assert.deepEqual(A.splitInput("  "), []);
});
