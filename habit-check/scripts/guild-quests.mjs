// ギルドの依頼（DB_ギルド依頼）の中身。ここを直して `NOTION_TOKEN=... node scripts/guild-quests.mjs` で Notion にそろえる。
// 依頼は2つの形：
//   🪜 のぼる依頼（repeat なし）：段階をこえるたびにランクが上がる（rank は1段目のランク）
//   🔁 くりかえし依頼（repeat: true）：「〜するごとに」報告する。ランク固定
// lines：依頼人のセリフ（段階ごと。くりかえしは1つ）。達成済みの段階は、ずれないよう先頭に残している
// id：今ある依頼のページ。なければ新しく作る。closed：受付終了（これまでの記録・EXP・そうびは残す）
import { RANK_NEED, RANK_REWARD } from "../src/guild-config.js";

export const QUESTS = [
  // ---------- 家事 ----------
  {
    id: "40762844-acbe-8108-b1ff-f143e0995b21", title: "換気扇の霧を晴らせ", category: "家事", rank: "D", requester: "宿屋のおかみ",
    stages: ["換気扇のフィルターを1枚替える", "レンジフードの外側を拭く", "換気扇を分解して洗う", "台所の壁とコンロまわりを大掃除する", "月1の台所メンテを3か月続ける"],
    lines: ["台所の空がくもってきてねえ。まずはフィルター1枚、頼めるかい", "外側の油がまた光ってる。表をきゅっと磨いておくれ", "羽根の奥に霧がたまってるのさ。ばらして洗ってくれないかい", "せっかくなら台所ぜんぶ、晴れ渡らせてみないかい", "晴れた台所を守り続けた人だけが、ほんとうの主さ"],
  },
  {
    id: "41583927-1881-4bcd-a140-e972039f9c16", title: "全館空調のフィルター退治", category: "家事", rank: "C", repeat: true, requester: "家の風の精",
    stages: ["すべてのフィルターを掃除する（1週間強ごと）"],
    lines: ["ふう……息がしにくいの。家じゅうの口を、またきれいにしてくれる？"],
  },
  {
    title: "洗濯物の城", category: "家事", rank: "D", requester: "洗濯日和の村の村長",
    stages: ["洗剤とネットの置き場所を決める", "衣類の定位置を決める", "着ない服を10着手放す", "衣替えを1日でやりきる", "洗濯から収納までを家族で回す仕組みにする"],
    lines: ["城づくりは、まず道具の置き場からじゃ", "服にも帰る家が要る。定位置を決めてやってくれ", "着ない服は、城の重荷になる。10着、旅に出してやるのじゃ", "季節の入れ替えを1日で。城の総入れ替えじゃな", "王ひとりで回す城は長くもたん。みなで回る仕組みを"],
  },
  // ---------- 育児 ----------
  {
    id: "4032bff8-d5a9-4214-9500-4238db2fc4da", title: "離乳食マスターへの道", category: "育児", rank: "C", requester: "フミ",
    stages: ["新しい食材を1つ試す", "朝の離乳食を一人で回せる", "メニューの指示がなくてもできる"],
    lines: ["あ、あの、新しい食材の記録、いっしょにつけませんか", "朝の一回、ひとりで回せたら……それはもう立派な兵站です！", "献立を見なくても作れる。それって、本を一冊覚えたのと同じです"],
  },
  {
    id: "ef8eb107-57f4-4f28-8263-2355de253792", title: "ワンオペの試練", category: "育児", rank: "C", requester: "妻",
    stages: ["2時間ひとりで見る", "半日ワンオペを乗り切る", "1日ワンオペを乗り切る", "1泊2日のワンオペを乗り切る", "2泊3日のワンオペを乗り切る"],
    lines: ["作戦説明は以上。じゃ、いってきます", "半日ね。……変なものは食べさせないでよ", "まる1日。帰ってきたら部屋が無事か見るからね", "1泊。冷蔵庫に作り置きあるから。あと、寝かしつけ早めにね", "3日。……ほんとに大丈夫？ 大丈夫そうだね。じゃ、よろしく"],
  },
  // ---------- お金 ----------
  {
    id: "384421d5-5900-4ae8-8722-c47baa9da15a", title: "固定費のみなおし", category: "お金", rank: "C", repeat: true, requester: "コインズの商人ギルド長",
    stages: ["使っていないサブスクを1つ解約する"],
    lines: ["見えない鎖は、1本切るごとに財布が軽く……いや、重くなるのですぞ"],
  },
  {
    id: "e5df7cc9-8a78-4e39-abbc-c63f2912d7d3", title: "家族のNISA", category: "お金", rank: "B", requester: "未来の森の番人",
    stages: ["必要なことを調べる", "妻の積立てを設定する", "子どもの分の貯め方も決める"],
    lines: ["種をまく前に、土を知れ", "ひとつめの種を、ともに暮らす者の森へ", "いちばん小さな勇者の森にも、種を"],
  },
  // ---------- 家 ----------
  {
    id: "48ac764e-7235-4d1d-aba0-98448377678d", title: "在庫の番人", category: "家", rank: "D", repeat: true, requester: "食料庫の小人",
    stages: ["切れそうな物を補充する"],
    lines: ["棚がすかすかでち！ ひとつ足してくれたら、ぼくらは安心してねむれるでち"],
  },
  {
    title: "在庫リストの整備", category: "家", rank: "C", requester: "食料庫の小人",
    stages: ["補充リストを整える"],
    lines: ["何がいくつあって、いくつで買うか。帳面があれば、番人はもっと強くなれるでち"],
  },
  {
    id: "3f062844-acbe-8122-ba8e-c5a5ad151534", title: "庭の結界をまもれ", category: "家", rank: "D", repeat: true, requester: "庭の小さな精",
    stages: ["ゴミ捨てのついでに枯葉を拾う"],
    lines: ["通りがかりのひと拾いで、結界はちゃんと保つの。ありがとね"],
  },
  {
    id: "35d9cafa-f129-4f20-befb-8f11efc9102f", title: "2Fダンジョン攻略", category: "家", rank: "C", requester: "二階の迷宮の管理人",
    stages: ["5分だけ1カ所片づける", "寝室を整える", "WICを整える", "書斎を整える", "防音室を整える"],
    lines: ["迷宮は入口の一歩から攻略するもの", "まずは眠りの間。ここが整えば、毎朝が軽くなる", "衣の回廊。住所の決まらない服たちが迷っておる", "知の間。机の上が晴れれば、頭の中も晴れる", "最深部、六つの声の部屋。ここを攻略した者は迷宮の主だ"],
  },
  // ---------- からだ ----------
  {
    id: "4e8fb889-e1fe-4202-93a1-26f1f8c1227b", title: "未知のトレーニング", category: "からだ", rank: "C", requester: "シロガネ",
    stages: ["いつもと違う型を5分ためす", "新しい型を1週間続ける", "新しいメニューを週2で1か月続ける", "自分用のメニュー表を作る"],
    lines: ["慣れた道の外へ、五分だけ踏み出してみよ", "一週間。……休んでもよい。戻ってくればな", "ひと月。型が体に住みつくまで", "己の型を、己で記せ"],
  },
  {
    id: "3ec62844-acbe-814a-b626-c37598f31a7f", title: "体脂肪の霧を晴らせ", category: "からだ", rank: "C", requester: "ムキ",
    stages: ["体脂肪率を1%下げる", "2%下げる", "3%下げる", "目標の15%に届く"],
    lines: ["一気にやるなよ。1%ずつだ", "……ほう、続いてるじゃねえか", "ここからが本番だ。食って、鍛えて、寝ろ", "15%。……がっはっは！ 文句なしだ"],
  },
  // ---------- 学び ----------
  {
    id: "9090ba65-1c21-4ab5-9fd0-585aad4ac585", title: "本を読破せよ", category: "学び", rank: "B", repeat: true, requester: "フミ",
    stages: ["本を1冊読みきる"],
    lines: ["最後のページまで行けたら……あの、感想、聞かせてください！"],
  },
  {
    title: "読書アプリを完成させよ", category: "学び", rank: "A", requester: "本の塔の賢者",
    stages: ["読書アプリを作り終える"],
    lines: ["読んだ記録を、忘れない器に。塔の新しい書庫を作るのじゃ"],
  },
  // ---------- 趣味 ----------
  {
    id: "768f9707-5ea3-485f-a1a6-a2602272bf91", title: "美味しいドリップを淹れる", category: "趣味", rank: "D", repeat: true, requester: "香りの錬金術師",
    stages: ["コーヒーを1杯ていねいに淹れる"],
    lines: ["お湯は細く、心は太く。今日の一杯も、立派な錬金術ですよ"],
  },
  {
    title: "妻へ一杯を", category: "趣味", rank: "C", repeat: true, requester: "妻",
    stages: ["妻へコーヒーを淹れる"],
    lines: ["……あ、淹れてくれるの？ じゃあ、ちょっと濃いめで"],
  },
  {
    id: "95f10505-424d-45ba-9c6f-79f34ed9efb9", title: "スタジオを仕上げる", category: "趣味", rank: "B", requester: "六つの声の歌い手",
    stages: ["タイルカーペットを敷く", "スタジオの機材をそろえる", "カラオケを整える"],
    lines: ["まずは足元から。響きは床で決まるのよ", "声を受けとめる器を、ひとつずつ", "さあ、六つの声で歌いましょう"],
  },
  // ---------- 受付終了 ----------
  { id: "e2607716-1e61-41a5-91b0-c9660bed2468", title: "おふろの番人", closed: true },
  { id: "9c95f1d6-6530-489c-9fbd-fd7259c5dede", title: "家計折半の記録便", closed: true },
  { id: "40762844-acbe-8194-8d94-e6db75f33488", title: "AIの塔をのぼる", closed: true },
];

// ---------- Notion にそろえる ----------
const GUILD_DS_ID = "86ea2c0d-a66a-49e4-9a6b-b287f4f32bbd";
const PLAYER_PAGE_ID = "3e962844acbe81b0843ff78fe19791fa";

async function main() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN がありません");
  const notion = async (method, path, body) => {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${data.code} ${data.message}`);
    return data;
  };
  const text = (s) => ({ rich_text: [{ type: "text", text: { content: s } }] });
  for (const q of QUESTS) {
    if (q.closed) {
      await notion("PATCH", `/pages/${q.id}`, { properties: { 受付終了: { checkbox: true } } });
      console.log(`受付終了: ${q.title}`);
      continue;
    }
    const properties = {
      依頼: { title: [{ type: "text", text: { content: q.title } }] },
      カテゴリ: { select: { name: q.category } },
      ランク: { select: { name: q.rank } },
      段階: text(q.stages.join("｜")),
      依頼人: text(q.requester),
      依頼文: text(q.lines.join("\n")),
      くりかえし: { checkbox: !!q.repeat },
      受付終了: { checkbox: false },
      受注Lv: { number: RANK_NEED[q.rank] },
      基本EXP: { number: RANK_REWARD[q.rank] },
    };
    if (q.id) {
      await notion("PATCH", `/pages/${q.id}`, { properties });
      console.log(`更新: ${q.title}`);
    } else {
      const found = await notion("POST", `/data_sources/${GUILD_DS_ID}/query`, { filter: { property: "依頼", title: { equals: q.title } } });
      if (found.results?.length) {
        await notion("PATCH", `/pages/${found.results[0].id}`, { properties });
        console.log(`更新: ${q.title}`);
      } else {
        await notion("POST", "/pages", { parent: { type: "data_source_id", data_source_id: GUILD_DS_ID }, properties: { ...properties, プレイヤー: { relation: [{ id: PLAYER_PAGE_ID }] } } });
        console.log(`追加: ${q.title}`);
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
