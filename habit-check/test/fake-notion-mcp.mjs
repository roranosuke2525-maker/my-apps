// テスト用の偽 Notion 連携（MCP）。返事の形は本物の Notion MCP に合わせ、値はすべて作りもの。
// ブラウザにも toString() で渡すので、この関数の外のものは使わない。
export function fakeNotionMcp({ bareToolNames = false, today = "2026-10-23" } = {}) {
  const DS = {
    habit: "e730b8b2-bb41-491d-9382-a296c40e6deb",
    party: "7ab3aa8b-2f1e-44cb-b2f8-592202bab226",
    guild: "86ea2c0d-a66a-49e4-9a6b-b287f4f32bbd",
    report: "0ea02603-b2dd-4064-bc84-bf02f0e60aca",
    story: "f673bc1a-91b2-467d-bcd3-b2a70bd1bcbd",
  };
  const PLAYER = "3e962844acbe81b0843ff78fe19791fa";
  const url = (id) => `https://app.notion.com/p/${id}`;
  const hex = (n) => n.toString(16).padStart(32, "0");
  const ref = (kind, ds, id) => `${kind}Result://${ds}/${id}/AbCd`;
  const habitNames = ["◆☼ 起床", "◆☼ 洗濯", "◇☼ ストレッチ", "◇☀︎ プロテイン", "◇☾プロテインの準備", "◇↻ 読書"];
  const hints = { "◇☼ ストレッチ": "最小版：1分", "◇↻ 読書": "最小版：1ページ" };
  const schema = {
    日: { name: "日", type: "title" },
    日付: { name: "日付", type: "created_time" },
    ひとこと: { name: "ひとこと", type: "text", description: "書くと+5EXP" },
    いまのLv: { name: "いまのLv", type: "rollup" },
    プレイヤー: { name: "プレイヤー", type: "relation" },
  };
  for (const n of habitNames) schema[n] = { name: n, type: "checkbox", description: hints[n] || "" };

  let seq = 100;
  const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const created = (date) => new Date(Date.parse(`${date}T00:00:30+09:00`)).toISOString();
  const tables = { [DS.habit]: [], [DS.party]: [], [DS.guild]: [], [DS.report]: [], [DS.story]: [] };
  for (let i = 9; i >= 1; i--) {
    const d = addDays(today, -i);
    const id = hex(seq++);
    const row = { url: url(id), 日: `<p>\n<date start="${d}" /> \n</p>`, 日付: created(d), ひとこと: i === 1 ? "<p>散歩した &amp; 早寝</p>" : "", いまのLv: ref("rollup", DS.habit, id) };
    habitNames.forEach((n, k) => { row[n] = (i + k) % 3 ? "__YES__" : "__NO__"; });
    tables[DS.habit].push(row);
  }
  tables[DS.party].push(
    { url: url(hex(201)), なまえ: "ゆうしゃ（かけだし）", しゅるい: "しゅじんこう", ひつようLv: 1, つぎLv: 5, ひょうじ: ref("formula", DS.party, hex(201)) },
    { url: url(hex(202)), なまえ: "なかまA", しゅるい: "なかま", ひつようLv: 3, つぎLv: 999, ひょうじ: ref("formula", DS.party, hex(202)) },
  );
  tables[DS.guild].push(
    { url: url(hex(301)), 依頼: "朝の霧を晴らせ", カテゴリ: "からだ", ランク: "C", 受注Lv: 1, 基本EXP: 40, 段階: "3日つづける｜1週間つづける", 記録: JSON.stringify([url(hex(401)), url(hex(402))]), 達成回数: ref("formula", DS.guild, hex(301)) },
    { url: url(hex(302)), 依頼: "台所の砦", カテゴリ: "家事", ランク: "B", 受注Lv: 3, 基本EXP: 60, 段階: "引き出しを1つ", 達成回数: ref("formula", DS.guild, hex(302)) },
  );
  tables[DS.report].push(
    { url: url(hex(401)), ひとこと: "6時に起きた", 依頼: JSON.stringify([url(hex(301))]), 達成日: `${addDays(today, -2)}T21:00:00.000Z` },
    { url: url(hex(402)), ひとこと: "6時半に起きた", 依頼: JSON.stringify([url(hex(301))]), 達成日: `${addDays(today, -1)}T21:00:00.000Z` },
  );
  tables[DS.story].push(
    { url: url(hex(501)), しょう: "第1章　はじまり", しゅるい: "ほんぺん", じゅんばん: 1, かいほうLv: 1, よんだ: "__YES__", いまのLv: ref("rollup", DS.story, hex(501)) },
    { url: url(hex(502)), しょう: "寄り道　小人", しゅるい: "よりみち", じゅんばん: 101, かいほうLv: 30, よんだ: "__NO__", いまのLv: ref("rollup", DS.story, hex(502)) },
  );
  const content = {
    [hex(201)]: '<image source="notion-file-block://aaa/bbb?space_id=s&amp;name=a.svg" />',
    [hex(501)]: "<toggle>\n▶ 読む\n\n「おはよう」と言った。\n\n> 【SYSTEM】クエスト開始\n\n## 朝\n\n- 窓をあけた\n</toggle>",
    [hex(502)]: "本文",
  };
  const calls = [];
  const fail = (code, message = code) => Promise.reject(Object.assign(new Error(message), { code, message }));
  const ok = (payload) => Promise.resolve({ content: [{ type: "text", text: JSON.stringify(payload) }], payload });
  const idOf = (u) => (String(u).match(/([0-9a-f]{32})/i) || [])[1];
  const findRow = (id) => {
    for (const [ds, rows] of Object.entries(tables)) {
      const r = rows.find((x) => idOf(x.url) === id.replace(/-/g, ""));
      if (r) return { ds, r };
    }
    return null;
  };
  const matches = (r, f) => {
    const v = r[f.property];
    if (f.operator === "date_is_on_or_after") return v.slice(0, 10) >= f.value.value;
    if (f.operator === "date_is_before") return v.slice(0, 10) < f.value.value;
    return true;
  };

  function handle(tool, input) {
    if (tool === "fetch") {
      if (input.id.startsWith("collection://")) {
        if (input.id !== `collection://${DS.habit}`) return fail("tool_error");
        return ok({ metadata: { type: "data_source" }, text: `<data-source>\n<data-source-state>\n${JSON.stringify({ name: "DB_習慣チェック", schema })}\n</data-source-state>\n</data-source>` });
      }
      const id = idOf(input.id);
      if (id === PLAYER) return ok({ text: `<page>\n<properties>\n${JSON.stringify({ url: url(PLAYER), 名前: "テストさん", レベル: ref("formula", "x", PLAYER) })}\n</properties>\n<blank-page/>\n</page>` });
      const found = findRow(id);
      if (!found) return fail("tool_error", "object_not_found");
      const c = content[id] || "";
      const references = input.include_file_urls && c.includes("notion-file-block://aaa/bbb") ? { "notion-file-block://aaa/bbb?space_id=s&name=a.svg": "https://files.example/a.svg?sig=1" } : undefined;
      return ok({ text: `<page>\n<properties>\n${JSON.stringify(found.r)}\n</properties>\n<content>\n${c}\n</content>\n</page>`, ...(references ? { references } : {}) });
    }
    if (tool === "query-data-sources") {
      const d = input.data;
      if (d.mode !== "rows") return fail("tool_error", "sql not allowed in test");
      const ds = d.data_source_url.replace("collection://", "");
      let rows = (tables[ds] || []).filter((r) => (d.filter?.filters || []).every((f) => matches(r, f)));
      if (d.sort?.[0]) {
        const { property, direction } = d.sort[0];
        rows = [...rows].sort((a, b) => (a[property] > b[property] ? 1 : a[property] < b[property] ? -1 : 0) * (direction === "descending" ? -1 : 1));
      }
      return ok({ results: rows.slice(0, d.limit || 50).map((r) => ({ ...r })), has_more: false });
    }
    if (tool === "update-page") {
      const found = findRow(input.page_id);
      if (!found || input.command !== "update_properties") return fail("tool_error");
      Object.assign(found.r, input.properties);
      return ok({ page_id: input.page_id });
    }
    if (tool === "create-pages") {
      const ds = input.parent.data_source_id;
      const id = hex(seq++);
      const props = input.pages[0].properties;
      const row = { url: url(id), ...props, 依頼: props.依頼 ? JSON.stringify(props.依頼) : undefined };
      if (ds === DS.habit) {
        row.日付 = created(props.日);
        habitNames.forEach((n) => { row[n] = "__NO__"; });
        row.ひとこと = "";
      }
      if (ds === DS.report) row.達成日 = new Date().toISOString();
      tables[ds].push(row);
      return ok({ pages: [{ id, url: url(id) }] });
    }
    return fail("tool_error");
  }

  const mcp = {
    calls,
    tables,
    callTool(server, name, input) {
      calls.push({ server, name, input: JSON.parse(JSON.stringify(input)) });
      if (server !== "Notion") return fail("server_not_connected");
      const bare = name.replace(/^notion-/, "");
      if (bareToolNames === (bare !== name)) return fail("not_in_manifest");
      return handle(bare, input);
    },
  };
  return mcp;
}
