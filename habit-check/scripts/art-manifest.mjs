// Gemini で描く絵の一覧（gen-art.mjs が読む）。id がファイル名になる（public/img/<id>.webp）。
// kind: sprite＝白背景で描いて背景を抜く（キャラ・モンスター）／bg＝そのまま横長の背景
// 絵柄は public/img/party/gemini/1_minarai.png（パーティーの絵）にそろえる。

export const STYLE_REF = "img/party/gemini/1_minarai.png";

const SPRITE = "Same warm hand-painted 2D Japanese fantasy RPG art style as the reference image, but on a plain pure white background (#ffffff) with nothing else, " +
  "single subject only, full body, centered with margin around it, clean dark outline, no text, no shadow on the ground, no frame.";
const BG = "Same warm hand-painted 2D Japanese fantasy RPG art style as the reference image. Wide background scenery for a visual novel stage, " +
  "no people, no characters, no text, eye-level view, detailed but soft, the lower third is open floor or ground where characters can stand.";

const sprite = (id, desc) => ({ id, kind: "sprite", ratio: "1:1", prompt: `${SPRITE} ${desc}` });
const bg = (id, desc) => ({ id, kind: "bg", ratio: "16:9", prompt: `${BG} ${desc}` });

// ---------- あいぼう ----------
const PET = "a cute small round fantasy creature companion (mascot-like, big friendly eyes)";
export const PETS = [
  sprite("pet/egg", "A smooth egg about the size of two hands, pale aqua blue shell with thin glowing cyan circuit-board lines and dots, softly glowing. No creature."),
  sprite("pet/egg_crack1", "The same pale aqua blue egg with glowing cyan circuit lines, now with one small crack near the top, a little light leaking out."),
  sprite("pet/egg_crack2", "The same pale aqua blue egg with glowing cyan circuit lines, cracked in a zigzag across the top, bright light leaking out, about to hatch."),
  sprite("pet/baby", `${PET}: 'Puchimo', a mint green round blob baby with two short antennae tipped with little yellow balls, pink cheeks, tiny smile, faint cyan circuit pattern on its back.`),
  sprite("pet/child_power", `${PET}: 'Garubo', an orange baby dinosaur with yellow back spikes, cream belly, energetic pose, faint cyan circuit pattern on its tail.`),
  sprite("pet/child_wisdom", `${PET}: 'Lumine', a light blue owl-fox with fox ears, big round owl eyes, a curled tail whose tip glows yellow like a lamp, faint cyan circuit pattern.`),
  sprite("pet/child_kind", `${PET}: 'Mofura', a fluffy cream-white rabbit-like puffball with long ears, pink cheeks and a little green sprout on its head.`),
  sprite("pet/child_steady", `${PET}: 'Kachiko', a small grey-green turtle with a shell that has a clock face on it, a tiny glowing green antenna, calm eyes.`),
  sprite("pet/adult_power", `${PET} evolved into a heroic form: 'Doragaia', a red-orange young dragon with small wings, golden horns, silver chest armor with a yellow gem, brave pose.`),
  sprite("pet/adult_wisdom", `${PET} evolved into a heroic form: 'Astra', a deep indigo fox-like beast with constellation star wings, a golden star on its forehead, white-tipped tail, mystical.`),
  sprite("pet/adult_kind", `${PET} evolved into a heroic form: 'Floram', a gentle light green deer-like beast with leaf-shaped ears and a big pink flower blooming on its back, smaller flowers around.`),
  sprite("pet/adult_steady", `${PET} evolved into a heroic form: 'Gianox', a silver armored knight-beast with a helmet visor, a golden gear-shaped shield, glowing cyan lines, steady stance.`),
  sprite("pet/adult_balance", `${PET} evolved into its legendary form: 'Aurora', a shining white holy beast with a small golden horn and four floating orbs around it (red, blue, pink, green), aurora-colored mane.`),
];

// ---------- モンスター（種族 × 格） ----------
export const FAMILY_KEYS = { ホコリ: "hokori", ヨナキ: "yonaki", コイン: "coin", ダラケ: "darake", モジ: "moji", アトマワシ: "atomawashi", ザツム: "zatsumu", モヤモヤ: "moyamoya" };
const FAMILY_DESC = {
  hokori: "made of grey fluffy house dust and dust bunnies, a little lint and hair sticking out",
  yonaki: "pink and pastel, themed on a crying baby at night, with a pacifier, a little moon and teardrops",
  coin: "golden, made of coins and a coin purse, with receipts fluttering",
  darake: "lazy green, lounging and sleepy, themed on snacks and a sofa cushion, yawning",
  moji: "blue, made of floating letters, pages and ink, with a bookmark ribbon",
  atomawashi: "purple, themed on procrastination, with a melting clock and an hourglass, sticky notes saying nothing",
  zatsumu: "orange, made of piled paperwork, envelopes and a stamp",
  moyamoya: "pale lavender mist, a soft cloudy fog body with vague swirling face",
};
const SHAPE_DESC = {
  slime: "a small round slime monster (weakest rank), cute but mischievous",
  goblin: "a small goblin-like imp monster (second rank), sly grin",
  golem: "a big heavy golem monster (strong rank), blocky and hulking",
  dragon: "a dragon monster (highest rank), wings spread, intimidating but still in a cute RPG style",
};
export const MONSTERS = Object.values(FAMILY_KEYS).flatMap((fam) =>
  Object.entries(SHAPE_DESC).map(([shape, d]) => sprite(`mon/${fam}_${shape}`, `${d}, ${FAMILY_DESC[fam]}. RPG enemy.`)));

// ---------- 章ボス（エピソード2） ----------
// ボスの名前 → 姿（本文の設定から）
const BOSS_DESC = {
  灰のスライム: "a bucket-sized slime made of white-grey ash with two black dot eyes, ash flakes falling off",
  灰かぶりゴブリン: "a goblin covered in grey ash and soot, carrying a broken laundry basket as a shield",
  数えのコウモリ: "a bat monster with numbers glowing on its wings and a tally counter in its claws",
  百回ゴーレム: "a stone golem with the number 100 carved on its chest and chains around its arms, doing squats",
  伝説の偽像: "a living stone statue of a too-perfect smiling hero holding a sword, cracked and hollow-eyed",
  灰狼: "a large wolf made of ash and embers, grey fur dissolving into ash",
  "見えない鎖・太": "a thick translucent ghostly chain coiled like a snake with a padlock head, faint and half invisible",
  途切れの悪夢: "a nightmare creature made of torn calendar pages and broken streak counters, dark purple",
  関所の番兵カウントガード: "an armored gate guard golem with a big counter display on its helmet showing streak numbers, holding a halberd",
  百回隊長ゴウ: "a stern muscular imperial captain in heavy black armor with chain emblems, scarred, holding a huge mace (a human, not a monster)",
  灰の衛兵: "an imperial guard made of ash in dull armor with a chain-patterned spear",
  眠り売りの商人: "a shady merchant spirit with a sack of glowing sleep bottles and a long coat, sleepy eyes",
  数字の司書: "a ghostly librarian made of numbers, with a ledger book and quill, cold blue light",
  冷たい灯籠: "a stone lantern monster with a cold blue flame inside, eerie face",
  鎖の大蛇: "a giant serpent made of interlocking iron chains with glowing circuit-like engraved marks",
  監視のフクロウ: "a large owl with many eyes and a monocle, carrying a clipboard, watchful",
  灰の騎士見習い: "a young knight apprentice made of ash in silver armor, earnest stance, sword raised",
  告げ口のカラス: "a black crow with a rolled letter and a wax seal, whispering mouth",
  拡声の塔: "a living tower with brass megaphones on top and windows like eyes, shouting",
  鎖将シロガネの牢: "a cage made of silver chains with a crest of a knight, glowing, like a living prison",
  牢番: "a burly jailer monster with a big key ring and lantern, iron mask",
  闇の看守: "a shadowy prison warden in a dark cloak with chains for arms",
  追手の鎖犬: "a hound made of chains with glowing red eyes, running",
  抽出機ヌキトリ: "a mechanical extraction machine with glass tubes, needles and a pumping core, steampunk",
  黒い霧の残り: "a creature of black fog with glowing eyes, remnants of a demon lord's mist",
  燃え尽きの影: "a tired shadow figure made of burnt-out ash, slumped, embers fading",
  古い記録の亡霊: "a ghost made of old yellowed record papers and ink, with a round pair of glasses floating",
  焼け焦げた日誌: "a living charred diary book with burnt pages flapping like wings",
  峠の残り霧: "a misty spirit on a mountain pass, white fog with an empty knight helmet inside",
  先代勇者の影: "the dark silhouette of a former hero in old armor with a cape, shadowy and sorrowful",
  国境の灰嵐: "a whirlwind storm of ash with an angry face",
  空白のページ: "a giant blank page monster with a mouth that swallows words, white and empty",
  計数眼: "a huge mechanical eye with counter dials and a red iris, floating, surrounded by numbers",
  不安の霧: "a swirling grey fog with many worried faces",
  見えない壁: "a translucent invisible wall with a faint face, glass-like",
  裏切りの影: "a shadow figure holding an abacus, two-faced mask",
  百回隊の総攻撃: "a squad of imperial soldiers in black armor charging together under a banner with the number 100",
  青い炎の結界: "a magic barrier of cold blue flames shaped like a ring of candles",
  レンサの分身: "a girl-shaped spirit made of cold blue fire, a crowned empress illusion, translucent",
  絶望: "a huge dark void creature, a black hole with tendrils, despair",
  静かな朝の霧: "a quiet pale morning mist spirit, soft and sad",
  森の番人の試し: "a gentle giant forest guardian made of trees and moss with a wooden mask",
  "シロガネ（二戦目）": "a silver knight with long silver hair in white-silver armor and a chain-wrapped sword (a human)",
  千日の鎖: "an enormous chain with a thousand links forming a spiral tower, glowing marks",
  偽りの計数眼: "a corrupted version of a giant mechanical counting eye, cracked, red and glitching",
  灰の大波: "a huge tidal wave made of ash",
  "ホコリドラゴン（成体）": "a big adult dragon made of grey dust and dust bunnies, sneezing clouds",
  帝国の大鎖: "a gigantic imperial chain wrapping around a palace tower, with the empire crest",
  皇帝レンサ: "a young empress girl made of cold blue fire with a crown and a chain-patterned dress, cheerful but intense (a spirit)",
};
export const BOSS_FILES = Object.fromEntries(Object.keys(BOSS_DESC).map((name, i) => [name, `boss/b${String(i + 1).padStart(2, "0")}`]));
export const BOSSES = Object.entries(BOSS_DESC).map(([name, d]) => sprite(BOSS_FILES[name], `Chapter boss: ${d}. Imposing RPG boss.`));

// ---------- 劇の登場人物（パーティー以外） ----------
export const CAST = [
  sprite("cast/rumi", "Rumi, a tiny candle-flame fairy girl (palm-sized) with fluffy orange hair like sparks, a small flame on top of her head, cheerful, wearing a little dress like candle wax, glowing warm."),
  sprite("cast/shirogane", "Shirogane, a tall silver knight with long silver hair, white-silver armor, a cape, a chain-shaped burn scar on his wrist, stern but sad eyes, holding a sword."),
  sprite("cast/obaasan", "Fumiyo, a kind old woman guild receptionist with round glasses, grey hair in a bun, a shawl, holding a record book."),
  sprite("cast/rensa", "Rensa, an empress girl made of cold blue fire, twin sister of a candle fairy, a crown, a white and blue dress with chain patterns, bright cheerful smile but intense eyes."),
  sprite("cast/kazoe", "Kazoe, a 10-year-old refugee girl in a simple tunic, a metal bracelet on her wrist showing a glowing number, shy but brave."),
  sprite("cast/gou", "Gou, a stern muscular captain of the imperial Hundred Squad, heavy black armor with chain emblems, short grey hair, scar."),
  sprite("cast/tsuma", "The hero's wife, a kind Japanese woman in her early 30s with shoulder-length dark hair, casual home clothes and an apron, holding a coffee mug, warm smile."),
  sprite("cast/chiisana", "The 'little hero', a 1-year-old Japanese toddler sitting, wearing a tiny red cape over baby clothes, chubby cheeks, curious happy face."),
  sprite("cast/tokijii", "Toki-jii, a thin old prisoner man with a long white beard, ragged clothes, kind tired eyes."),
  sprite("cast/system", "A floating translucent holographic game window icon with a glowing cyan frame and an eye symbol, like a game system interface spirit."),
];

// ---------- 背景 ----------
export const BACKGROUNDS = [
  bg("bg/home", "The cozy living room of a young Japanese family home in a fantasy world, morning sunlight through big windows, a shelf, a sofa, baby toys on the floor."),
  bg("bg/balcony", "A small apartment balcony with laundry hanging on poles, a view of a fantasy town's rooftops, morning sky."),
  bg("bg/night_room", "A dim bedroom at night with a single candle on the bedside, a crib, moonlight from the window, peaceful."),
  bg("bg/kitchen", "A warm home kitchen with a coffee drip set, baby food jars, morning light."),
  bg("bg/bath", "A steamy home bathroom with a bathtub and a small rubber duck, soft warm light."),
  bg("bg/garden", "A small front garden with a hedge, a lawn and weeds, a fantasy-style house wall, sunny."),
  bg("bg/upstairs", "The cluttered second floor hallway of a home turned into a maze of boxes and clothes, adventurous mood."),
  bg("bg/studio", "A small home soundproof music room with six microphones on stands, a keyboard and guitars."),
  bg("bg/town", "A cozy fantasy town street with stone pavement, small shops and a fountain, morning, 'Hibino town'."),
  bg("bg/guild", "Inside an adventurers' guild hall: wooden reception counter, a quest board full of papers, lanterns, tables."),
  bg("bg/book_tower", "Inside a tall tower library with spiral bookshelves rising up, ladders, floating dust in light beams."),
  bg("bg/field", "A grassy plain with a dirt road leading to distant mountains, clear sky, adventure begins."),
  bg("bg/pass", "A misty rocky mountain pass with an old road, fog swirling, a little eerie."),
  bg("bg/laundry_village", "A pastoral village with lots of colorful laundry drying in the wind between houses, sunny."),
  bg("bg/money_city", "A wealthy fantasy merchant city with golden roofs, banks and stalls with scales and coins."),
  bg("bg/demon_castle", "A dark castle shrouded in thick white fog, the demon lord's castle, ominous."),
  bg("bg/border", "A heavy iron border gate with watchtowers, grey ash falling, guards' banners with chain emblems."),
  bg("bg/capital", "The imperial capital street of 'Kusarinomiya': grand grey buildings decorated with chains, a big perfect hero statue in a plaza, grey ash falling, people hurrying."),
  bg("bg/market", "A busy imperial market where stalls display glowing streak numbers as prices, bottles of sleep for sale, lanterns, chains."),
  bg("bg/archive", "A forbidden archive with endless shelves of ledgers full of numbers, cold blue lamps, dusty."),
  bg("bg/village_norest", "A grim village where no one rests: houses with signs 'do not rest', clocks everywhere, grey sky."),
  bg("bg/palace", "An imperial throne room with cold blue flames in braziers, chains hanging from pillars, a high throne."),
  bg("bg/dungeon", "An underground prison with iron bars, chains on walls, a torch, damp stone."),
  bg("bg/lab", "A research tower laboratory with glass tubes, strange machines with needles, glowing cables."),
  bg("bg/counting_tower", "Inside a counting tower: a gigantic mechanical eye on the wall, gears and number counters everywhere."),
  bg("bg/forest", "'The forest of the future': a lush gentle forest grown from seeds, sunlight, small huts and refugees' tents hidden among trees."),
  bg("bg/battlefield", "The final battle in front of the imperial palace: a huge chain wrapped around the tower, ash storm, dramatic sky."),
  bg("bg/dawn", "A peaceful dawn over a small town and a home balcony, the sky clearing, warm sunrise colors, hope."),
];

// ---------- 登場人物（第2版：精密な線の青年漫画風。表情・装備・構えの差分つき） ----------
// 劇は cast2/<名前>.webp（ふつう）。旧版の cast/ は SYSTEM の窓の絵だけ使うと cast2/<名前>_<差分>.webp を使う。差分：smile 笑顔／angry 怒り・気迫／sad 悲しみ・不安／surprised 驚き／battle 戦いの構え
export const STYLE2_REF = "https://gemini-art.roranosuke2525.workers.dev/i/5bf2e0f2fb1fd72f152e72e332ea8cd4.png";
const MANGA = "Japanese seinen manga cover illustration style: extremely detailed and precise ink linework, realistic slender proportions, sharp angular facial features with intense eyes, " +
  "fine cross-hatching and subtle screentone shading, dramatic rim lighting, meticulous detail on armor and cloth folds, refined polished coloring. " +
  "Full body, plain pure white background, single character only, centered with margin, no text, no frame.";
const VARIANT = {
  smile: "Change only the facial expression and body language: a warm genuine smile, relaxed open posture.",
  angry: "Change only the facial expression and body language: fierce determined glare, gritted teeth, tense leaning-forward posture, clenched fist.",
  sad: "Change only the facial expression and body language: sad, worried eyes looking down, shoulders slumped, hand near chest.",
  surprised: "Change only the facial expression and body language: wide-eyed shock, mouth open, leaning back slightly, hands raised.",
  battle: "Change only the pose: a dynamic battle-ready combat stance, weapon raised, cape and hair swept by motion, intense focused expression.",
};
const HERO_FACE = "Satoshi, a shonen manga hero around 20, fluffy messy black hair with an ahoge, large earnest eyes, warm determined smile, a white towel-like scarf, a hooded green cloak and a small glowing lantern (a traveler, never wears armor)";
const person = (id, desc, variants = [], { ref = null } = {}) => [
  { id: `cast2/${id}`, kind: "sprite", ratio: "3:4", prompt: `${MANGA} ${ref ? "Same art style and same face as the reference image. " : "Same art style as the reference image. "}${desc}`, ...(ref ? { ref } : { refUrl: STYLE2_REF }) },
  ...variants.map((v) => ({ id: `cast2/${id}_${v}`, kind: "sprite", ratio: "3:4", ref: `cast2/${id}`,
    prompt: `${MANGA} The exact same character, outfit, colors and art style as the reference image. ${VARIANT[v]}` })),
];
export const CAST2 = [
  // さとし：旅人のまま6段階（鎧は着ない）。顔は候補C（2026-10-31 に決定）。表情・構えの差分は でんせつ
  ...person("hero_6", `${HERO_FACE}. Stage 6 legendary: a grand flowing green-and-gold mantle embroidered with stars, the scarf streaming like a banner, an elegant traveler's coat, a sword of holy light, a lantern shining like the dawn sun, a soft warm aura.`, ["smile", "angry", "sad", "surprised", "battle"]),
  ...person("hero_1", `${HERO_FACE}. Stage 1 apprentice: a worn plain hooded green cloak, simple linen tunic, a small tin lantern, a wooden walking stick.`, ["smile", "surprised"], { ref: "cast2/hero_6" }),
  ...person("hero_2", `${HERO_FACE}. Stage 2 novice: the cloak with a few patches, a brown leather vest, a canvas satchel, a short knife, a brass lantern.`, [], { ref: "cast2/hero_6" }),
  ...person("hero_3", `${HERO_FACE}. Stage 3 full-fledged: a well-made green cloak with an embroidered hem, a dark travel coat, leather gloves, a short sword.`, [], { ref: "cast2/hero_6" }),
  ...person("hero_4", `${HERO_FACE}. Stage 4 veteran: a long weathered green mantle with a fur-lined collar, layered travel clothes, pouches and a map case, a well-used sword.`, ["battle"], { ref: "cast2/hero_6" }),
  ...person("hero_5", `${HERO_FACE}. Stage 5 master: a deep green mantle with silver clasps and glowing rune embroidery, a refined long coat, a sword with a soft blue glow, a blue-white flame lantern.`, ["battle"], { ref: "cast2/hero_6" }),
  ...person("rumi", "Rumi, a palm-sized candle-flame fairy girl, fluffy orange hair like sparks, a small living flame on top of her head, large expressive eyes, a dress like melted candle wax, warm glow, floating.", ["smile", "angry", "sad", "surprised"]),
  ...person("muki", "Muki, a big muscular warrior man in his 30s with spiky red hair, rugged face, bare strong arms with leather wristbands, a chain-shaped old burn scar around his left wrist, brown sleeveless jerkin, huge battle axe.", ["smile", "angry", "sad", "surprised", "battle"]),
  ...person("fumi", "Fumi, a young woman librarian scholar in her 20s, long purple hair in a single braid, round glasses, earnest intelligent face, layered purple robe and scarf, holding a thick record book and a quill pen.", ["smile", "angry", "sad", "surprised", "battle"]),
  ...person("zeni", "Zeni, a slim merchant steward man in his late 20s, narrow smiling eyes, wide-brimmed green hat, long brown coat with many pockets, holding an abacus, a leather ledger under his arm, a small sapling pin on his coat.", ["smile", "angry", "sad", "surprised", "battle"]),
  ...person("shirogane", "Shirogane, a tall elegant knight with long straight silver hair, cold sorrowful eyes, silver plate armor with dark chain engravings and dark leather straps, a long grey-blue cape, a chain-shaped burn scar on his wrist, holding a sword. Strong dark outlines.", ["smile", "angry", "sad", "surprised", "battle"]),
  ...person("rensa", "Rensa, an empress girl spirit made of cold blue fire, long flowing hair of blue flame, a small crown, white and blue dress with chain patterns, bright smile with unsettlingly intense eyes, human-sized.", ["smile", "angry", "sad", "surprised"]),
  ...person("obaasan", "Fumiyo, a kind but sharp old woman guild receptionist in her 70s, grey hair in a bun, round glasses, a shawl over a dark dress, holding a worn register book.", ["smile", "sad"]),
  ...person("kazoe", "Kazoe, a young girl traveler with short dark hair, a simple grey travel cloak over a tunic, a metal bracelet on her wrist with a small glowing number display, shy gentle expression.", ["smile", "sad"]),
  ...person("gou", "Gou, a stern huge imperial captain in heavy black armor with chain emblems, short grey hair, a diagonal scar across his face, a greatsword engraved with chains.", ["angry", "sad"]),
  ...person("tsuma", "The hero's wife, a kind Japanese woman in her early 30s, shoulder-length dark hair, casual home clothes and an apron, holding a coffee mug.", ["smile", "sad"]),
  ...person("chiisana", "The 'little hero', a 1-year-old Japanese toddler sitting, a tiny red cape over baby clothes, chubby cheeks, curious face.", ["smile"]),
  ...person("tokijii", "Toki-jii, a thin old prisoner man with a long white beard, ragged clothes, kind tired eyes."),
];

export const ALL = [...PETS, ...MONSTERS, ...BOSSES, ...CAST, ...BACKGROUNDS, ...CAST2];
