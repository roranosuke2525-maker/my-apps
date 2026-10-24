// 木彫りの絵（24×24 の線画）。CSS の .carve で「彫った溝」に見せる（溝は濃く、下側に光が当たる）
// 習慣は列名に含まれる言葉で選ぶ（上から順に見て最初に当たったもの）。足すときは HABIT_CARVINGS に1行足す
const CARVINGS = {
  alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M4.5 6 7 3.5M19.5 6 17 3.5M8 20l-1.5 1.5M16 20l1.5 1.5"/>',
  shirt: '<path d="M8.5 4 4 6.5l2 4 2-1V20h8V9.5l2 1 2-4L15.5 4c-.5 1.5-2 2.5-3.5 2.5S9 5.5 8.5 4Z"/>',
  shaker: '<path d="M8 7h8l-1 12.6a1.5 1.5 0 0 1-1.5 1.4h-3A1.5 1.5 0 0 1 9 19.6Z"/><path d="M9 7V4h6v3M8.6 12h6.8"/>',
  stretch: '<circle cx="12" cy="4.5" r="2"/><path d="M3.5 8.5 12 10l8.5-1.5M12 10v5l-4 6M12 15l4 6"/>',
  lotion: '<path d="M8 10h8v10a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 20Z"/><path d="M10.5 10V7h3v3M12 7V4h3.5"/><path d="M12 13.5s-1.8 2-1.8 3.2a1.8 1.8 0 0 0 3.6 0c0-1.2-1.8-3.2-1.8-3.2Z"/>',
  squat: '<circle cx="14" cy="4.5" r="2"/><path d="M14 7l-1.5 6H8l1 7.5M12.5 13l4 1.5-1 5.5M7.5 9.5h9"/>',
  roller: '<circle cx="12" cy="14" r="5.5"/><circle cx="12" cy="14" r="1.6"/><path d="M2.5 14h4M17.5 14h4M12 8.5V6"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 9.5a4 4 0 0 1 7 0M12 10l1.6-2.2M8 16.5h8"/>',
  paper: '<path d="M4 5h13v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2Z"/><path d="M17 9h3v9a2 2 0 0 1-2 2M7 8.5h7M7 12h7M7 15.5h4"/>',
  capsule: '<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M10.3 9.6l3.4 4.8"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  tooth: '<path d="M7.5 3.5C5 3.5 4 6 4.5 8.5c.4 2 1.5 3 1.8 5.5L7.3 20c.3 1 1.6 1 1.9-.1l1-4.3c.3-1.1 1.6-1.1 1.9 0l1 4.3c.3 1.1 1.6 1.1 1.9.1l1-6c.3-2.5 1.4-3.5 1.8-5.5.5-2.5-.5-5-3-5-1.9 0-2.8 1-4.6 1s-2.7-1-4.6-1Z"/>',
  bottle: '<path d="M10 3h4v3c0 1 2 2 2 4v9a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-9c0-2 2-3 2-4Z"/><path d="M8.5 13.5h7"/>',
  bath: '<path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Z"/><path d="M6 12V6a2 2 0 0 1 3.6-1.2M7 19l-1 2M17 19l1 2"/>',
  cabbage: '<path d="M12 21c-5 0-8-3.5-8-8 0-5 4-9 8-9s8 4 8 9c0 4.5-3 8-8 8Z"/><path d="M12 21V9M12 13 8.5 10M12 16.5l3.5-3.5"/>',
  scoop: '<path d="M3 11h11a5.5 5.5 0 0 1-11 0Z"/><path d="M14 11.5 21 6.5M6 8.5c.5-1 1.5-1.5 2.5-1.5"/>',
  moon: '<path d="M19.5 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10 10.5Z"/><path d="M15 4h3.5L15 8h3.5"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5ZM12 6.5v13"/>',
  babybottle: '<path d="M9 8.5h6V19a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z"/><path d="M8.5 8.5h7M10 8.5V7c0-1 1-1.5 1.2-2.5L12 2.5l.8 2c.2 1 1.2 1.5 1.2 2.5v1.5M9 12.5h2M9 15.5h2"/>',
  acorn: '<path d="M5 10.5c0-3 3-5 7-5s7 2 7 5Z"/><path d="M6.5 10.5c0 5 2.5 9 5.5 10.5 3-1.5 5.5-5.5 5.5-10.5M12 5.5V3M8 8l1 2M12 7.5v3M16 8l-1 2"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M9 7.5l3 4 3-4M12 11.5V17M9.5 12.5h5M9.5 15h5"/>',
  broom: '<path d="M15 3l-4 9.5"/><path d="M7.5 12l7 3-1.5 6.5-8-3.5Z"/><path d="M7 17.5l1.3-2M9.6 18.8l1.2-2.1"/>',
  inbox: '<path d="M3 13l2.5-8h13l2.5 8v6H3Z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>',
  pan: '<circle cx="9.5" cy="13" r="6.5"/><path d="M15.7 10.8 21.5 7"/><circle cx="9.5" cy="13" r="2.2"/>',
  dish: '<circle cx="13.5" cy="13" r="6.5"/><circle cx="13.5" cy="13" r="3.5"/><path d="M3 4v4.5A1.5 1.5 0 0 0 4.5 10M6 4v4.5A1.5 1.5 0 0 1 4.5 10M4.5 4v16"/>',
  sponge: '<rect x="4" y="9" width="16" height="10" rx="2"/><path d="M4 13h16M8 6l1-2M12 6V3.5M16 6l-1-2"/>',
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="M12.5 7.5 11 13l-3 7.5M11 13l3.5 3 1 4.5M8 10.5l3.5-3 3 3 2.5 1"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
  journal: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12 8h4M12 11.5h4"/>',
  // ものがたり・ギルドなどで使う
  lock: '<rect x="5" y="10.5" width="14" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
  scroll: '<path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2Z"/><path d="M6 4a2 2 0 0 0-2 2v1.5h2M9.5 8.5h6M9.5 12h6M9.5 15.5h3.5"/>',
  sprout: '<path d="M12 21v-9M12 12c0-4-3-6.5-7-6.5 0 4 3 6.5 7 6.5ZM12 15c0-3.5 2.5-6 6.5-6 0 3.5-2.5 6-6.5 6Z"/>',
};

const HABIT_CARVINGS = [
  ["プロテインの準備", "scoop"], ["プロテイン", "shaker"], ["起床", "alarm"], ["洗濯", "shirt"], ["ストレッチ", "stretch"],
  ["日焼け止め", "lotion"], ["スクワット", "squat"], ["腹筋", "roller"], ["体重", "scale"], ["新聞", "paper"], ["サプリ", "capsule"],
  ["ゴミ", "trash"], ["胸トレ", "dumbbell"], ["筋トレ", "dumbbell"], ["フロス", "tooth"], ["歯", "tooth"], ["ヤクルト", "bottle"],
  ["風呂", "bath"], ["キャベツ", "cabbage"], ["野菜", "cabbage"], ["寝かしつけ", "moon"], ["睡眠", "moon"], ["読書", "book"],
  ["本", "book"], ["ミルク", "babybottle"], ["離乳食", "babybottle"], ["ナッツ", "acorn"], ["マネーフォワード", "coin"],
  ["家計", "coin"], ["クイックル", "broom"], ["INBOX", "inbox"], ["ごはん", "pan"], ["料理", "pan"], ["食器", "dish"],
  ["食洗機", "dish"], ["掃除", "sponge"], ["散歩", "walk"], ["歩", "walk"], ["水", "drop"], ["日記", "journal"], ["薬", "capsule"],
];

function habitCarving(label) {
  return HABIT_CARVINGS.find(([word]) => label.includes(word))?.[1] ?? null;
}

// 彫った絵の svg 要素（name が無ければ null）
function carving(name, cls = "") {
  if (!CARVINGS[name]) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `carve ${cls}`.trim());
  svg.innerHTML = CARVINGS[name];
  return svg;
}
