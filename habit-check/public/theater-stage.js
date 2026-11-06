// 劇の舞台：話ごとに使う背景（img/bg/<名前>.webp）と、場面が変わる合図の語。
// 話の最初は先頭の背景。地の文にその話の背景の語が出てきたら、そこで背景を切り替える。

export const CHAPTER_BGS = {
  0: ["night_room", "home"], 1: ["balcony", "kitchen"], 2: ["town", "guild"], 3: ["guild"], 4: ["laundry_village"],
  5: ["book_tower"], 6: ["pass"], 7: ["money_city"], 8: ["demon_castle"], 9: ["demon_castle", "night_room"],
  101: ["home"], 102: ["home"], 103: ["home"], 104: ["field"], 105: ["upstairs"], 106: ["home"], 107: ["home"],
  108: ["kitchen"], 109: ["kitchen", "town"], 110: ["kitchen"], 111: ["home", "night_room"], 112: ["studio"],
  113: ["home"], 114: ["bath"], 115: ["garden"],
  201: ["balcony", "home"], 202: ["home", "guild", "town"], 203: ["town", "guild"], 204: ["guild", "field"],
  205: ["field", "book_tower"], 206: ["book_tower", "pass"], 207: ["pass", "guild", "town", "home"], 208: ["home", "night_room"],
  209: ["night_room", "guild", "pass", "border"], 210: ["border", "field"], 211: ["field", "capital"], 212: ["capital", "market"],
  213: ["market", "archive"], 214: ["archive", "capital"], 215: ["capital"], 216: ["capital", "village_norest"],
  217: ["village_norest"], 218: ["village_norest"], 219: ["village_norest", "capital"], 220: ["capital", "palace", "dungeon"],
  221: ["dungeon"], 222: ["dungeon"], 223: ["dungeon"], 224: ["dungeon", "lab"], 225: ["lab"], 226: ["lab", "home"],
  227: ["home", "guild"], 228: ["guild"], 229: ["guild", "pass"], 230: ["pass"], 231: ["pass", "guild"], 232: ["border"],
  233: ["counting_tower"], 234: ["counting_tower", "home"], 235: ["home"], 236: ["home", "guild"], 237: ["guild", "town"],
  238: ["town", "guild"], 239: ["town"], 240: ["town"], 241: ["home", "town"], 242: ["town", "forest"], 243: ["forest"],
  244: ["forest"], 245: ["forest"], 246: ["forest", "home"], 247: ["home", "studio"], 248: ["studio", "battlefield"],
  249: ["palace"], 250: ["palace", "night_room", "dawn"],
};

// 背景 → 場面が変わる合図の語（地の文に出てきたら切り替える）
export const BG_WORDS = {
  home: /リビング|ソファ|家に帰|玄関|家の中|棚の上/,
  balcony: /ベランダ|物干し/,
  kitchen: /台所|キッチン|ケトル/,
  night_room: /寝室|布団|ベッド|夜中|その夜|枕元/,
  bath: /風呂|湯船/,
  garden: /庭/,
  upstairs: /二階|階段の上/,
  studio: /防音室/,
  town: /広場|町の|大通り|酒場|パン屋/,
  guild: /ギルド/,
  book_tower: /本の塔|閲覧/,
  field: /街道|空き地|石切り場|川沿い|畑/,
  pass: /峠/,
  laundry_village: /村/,
  money_city: /コインズ|都/,
  demon_castle: /城/,
  border: /国境|関所|門/,
  capital: /帝都|都の|クサリノミヤ|像/,
  market: /市場|露店/,
  archive: /書庫/,
  village_norest: /村/,
  palace: /宮殿|玉座/,
  dungeon: /牢/,
  lab: /研究塔|白衣/,
  counting_tower: /計数塔|塔の中/,
  forest: /森/,
  battlefield: /帝都|大鎖/,
  dawn: /晴れ|朝日|夜明け|窓の外は/,
};

// 屋外の背景（天気の演出をつける）。エピソード1は霧、エピソード2は灰
const OUTDOOR = new Set(["balcony", "garden", "town", "field", "pass", "laundry_village", "money_city", "demon_castle", "border", "capital", "market", "village_norest", "battlefield"]);
export function weatherOf(bg, order) {
  if (bg === "forest") return "leaves";
  if (bg === "dawn") return "sun";
  if (bg === "night_room") return "night";
  if (bg === "palace" || bg === "archive") return "embers";
  if (!OUTDOOR.has(bg)) return "dust";
  return order >= 201 && order <= 245 ? "ash" : order < 200 ? "fog" : "dust";
}

// 背景が決まっていない話（あとから足した話）：題名から推しはかる
export function chapterBgs(order, title = "") {
  if (CHAPTER_BGS[order]) return CHAPTER_BGS[order];
  const hit = Object.entries(BG_WORDS).find(([, re]) => re.test(title));
  return [hit ? hit[0] : order >= 200 ? "capital" : "home"];
}
