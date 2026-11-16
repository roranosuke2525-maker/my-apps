// パーティーの絵を Google Gemini（画像生成）で描いて、public/img/party/gemini/ に PNG で保存する。
//   GEMINI_API_KEY=... node scripts/gen-party-gemini.mjs [ファイル名の一部…]
// できたら upload-party.mjs で DB_すがた に差し替える：
//   NOTION_TOKEN=... node scripts/upload-party.mjs --dir public/img/party/gemini
// さとしは「みならい」を先に描き、それを参照画像にして他の段階を描く（顔と髪をそろえるため）。
// GEMINI_MODEL でモデルを変えられる（既定 gemini-2.5-flash-image）。
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { root } from "./inline-page.mjs";

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY がありません");
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-image";
const only = process.argv.slice(2);
const dir = join(root, "public", "img", "party", "gemini");
mkdirSync(dir, { recursive: true });

// 絵柄（全員共通）。ここを書き換えると全員の絵柄が変わる
const STYLE = "Fantasy RPG character illustration, full body, standing, facing slightly left, " +
  "warm hand-painted 2D style like a classic Japanese RPG, soft lighting, plain light parchment background, " +
  "square 1:1, centered, single character only, no text, no logo, no frame";

// エピソード2「霧の旅」：霧の晴れていく世界を旅する、日々の暮らしを守る冒険者たち
const HERO = "a young Japanese man in his early 30s with short dark brown hair, kind determined eyes, " +
  "carrying a small glowing lantern that clears mist";
const PARTY = [
  { file: "1_minarai", name: "さとし（みならい）", desc: `${HERO}, apprentice adventurer in a simple green tunic, holding a wooden stick` },
  { file: "2_kakedashi", name: "さとし（かけだし）", ref: "1_minarai", desc: `${HERO}, novice adventurer in a brown leather cap and leather armor, holding a short sword` },
  { file: "3_ichininmae", name: "さとし（いちにんまえ）", ref: "1_minarai", desc: `${HERO}, full-fledged adventurer in a steel helmet and blue tunic, sword and round copper shield` },
  { file: "4_veteran", name: "さとし（ベテラン）", ref: "1_minarai", desc: `${HERO}, veteran knight in silver plate armor with pauldrons and a blue cape, sword and blue shield` },
  { file: "5_tatsujin", name: "さとし（たつじん）", ref: "1_minarai", desc: `${HERO}, master warrior in sky-blue horned armor and a red cape, sword glowing with blue magic` },
  { file: "6_densetsu", name: "さとし（でんせつ）", ref: "1_minarai", desc: `${HERO}, legendary hero in golden armor with a small crown and a starry midnight-blue cape, holy shining sword, white shield` },
  { file: "7_muki", name: "ムキ（きんにくせんし）", desc: "a cheerful muscular warrior with spiky red hair, bare strong arms with wristbands, brown sleeveless jerkin, big axe, a lunch box tied at his waist" },
  { file: "8_fumi", name: "フミ（ものしり）", desc: "a calm scholar girl with a long purple braid and round glasses, purple robe and scarf, holding a big open book and a quill pen" },
  { file: "9_zeni", name: "ゼニ（やりくりし）", desc: "a thrifty merchant-steward with a wide-brimmed green hat and brown robe, holding an abacus and a small sapling in a pot" },
];

async function generate(prompt, refPng) {
  const parts = [{ text: prompt }];
  if (refPng) {
    parts.push({ text: "Keep the same person (face, hair, body) as this reference image; change only the outfit and equipment." });
    parts.push({ inline_data: { mime_type: "image/png", data: refPng.toString("base64") } });
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"] } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${data.error?.message || JSON.stringify(data)}`);
  const img = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  if (!img) throw new Error(`画像が返ってきませんでした: ${JSON.stringify(data).slice(0, 300)}`);
  return Buffer.from((img.inlineData || img.inline_data).data, "base64");
}

const index = [];
for (const c of PARTY) {
  const file = `${c.file}.png`;
  index.push({ file, name: c.name });
  if (only.length && !only.some((o) => c.file.includes(o))) continue;
  const refPath = c.ref && join(dir, `${c.ref}.png`);
  const ref = refPath && existsSync(refPath) ? readFileSync(refPath) : null;
  writeFileSync(join(dir, file), await generate(`${STYLE}. ${c.desc}.`, ref));
  console.log(`描いた: ${c.name} → ${file}`);
}
writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
