// 絵の一覧から、画面で使う対応表（public/art-index.js）を作る。
//   node scripts/make-art-index.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./inline-page.mjs";
import { BOSS_FILES, FAMILY_KEYS } from "./art-manifest.mjs";
import { FAMILIES, DEFAULT_FAMILY } from "../src/battle-config.js";

const familyByColor = Object.fromEntries([...FAMILIES, DEFAULT_FAMILY].map((f) => [f.color[0], FAMILY_KEYS[f.name]]));
const out = `// scripts/make-art-index.mjs が作る。手で書き換えない。
// 絵は public/img/<名前>.webp（scripts/gen-art.mjs → finish-art.py）
export const BOSS_IMAGES = ${JSON.stringify(BOSS_FILES, null, 2)};
// モンスターの種族：色（いちばん明るい色ではなく、ふつうの色）→ 絵の名前の頭
export const FAMILY_BY_COLOR = ${JSON.stringify(familyByColor, null, 2)};
`;
writeFileSync(join(root, "public", "art-index.js"), out);
console.log("ok");
