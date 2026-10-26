// しおり：文字の読み取り（Kindle の貼り付け・ページの文の区切り・書き出し）。画面と Notion に依存しないので test から直接確かめる。
(function (root) {
  const norm = (s) => String(s || "").replace(/[\s　「」『』（）()【】・、。,.!！?？"'“”‘’]/g, "").toLowerCase();

  // 「書名 (著者)」を分ける（Kindle の My Clippings.txt の1行目）
  function splitTitle(line) {
    const s = String(line || "").replace(/^﻿/, "").trim();
    const m = s.match(/^(.*?)\s*[(（]([^()（）]+)[)）]\s*$/);
    return m ? { title: m[1].trim(), author: m[2].trim() } : { title: s, author: "" };
  }

  const locOf = (s) => ((s.match(/(?:位置\s*(?:No\.?)?|Location)\s*[:：]?\s*([\d,]+(?:\s*[-–]\s*[\d,]+)?)/i) || [])[1] || "").replace(/\s/g, "");
  const pageOf = (s) => {
    const m = s.match(/(?:ページ|page)\s*[:：]?\s*(\d+)/i) || s.match(/(\d+)\s*ページ/);
    return m ? Number(m[1]) : null;
  };

  // My Clippings.txt：「==========」で区切られ、1行目が書名、2行目が種類と位置
  function parseClippings(t) {
    const books = new Map();
    for (const block of t.split(/^={6,}\s*$/m)) {
      const lines = block.split("\n").map((s) => s.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      const meta = lines[1];
      const body = lines.slice(2).join("\n").trim();
      if (!body || /ブックマーク|bookmark/i.test(meta)) continue;
      const { title, author } = splitTitle(lines[0]);
      if (!books.has(title)) books.set(title, { title, author, items: [] });
      const items = books.get(title).items;
      const isNote = /メモ|note/i.test(meta) && !/ハイライト|highlight/i.test(meta);
      if (isNote) {
        const prev = items[items.length - 1];
        if (prev) prev.memo = prev.memo ? `${prev.memo}\n${body}` : body;
        continue;
      }
      items.push({ text: body.replace(/\s*\n\s*/g, " "), page: pageOf(meta), loc: locOf(meta), memo: "" });
    }
    return [...books.values()].filter((b) => b.items.length);
  }

  // メモとハイライト（Web・アプリ）：「黄色のハイライト | 位置: 123」の行のあとに本文、「メモ: …」が続く
  const HEAD = /^(?:.{0,12}ハイライト.{0,12}|.{0,16}highlight.{0,8})\s*(?:[|｜\-–·•]|$)/i;
  const NOTE_HEAD = /^(?:メモ|note)\s*(?:[|｜\-–·•]|$)/i;
  const NOTE_LINE = /^(?:メモ|note)\s*[:：]\s*(.*)$/i;
  const NOISE = /^(?:オプション|options?|エクスポート|export|検索|search|メモとハイライト|your notes and highlights|ハイライトを\d+件|\d+\s*件のハイライト|\d+\s*highlights?|最終アクセス日|last accessed)/i;

  function parseNotebook(t) {
    const lines = t.split("\n").map((s) => s.trim());
    const items = [];
    let cur = null;
    let mode = null; // "hl" | "note"
    let title = "";
    const close = () => { if (cur && cur.text.trim()) items.push(cur); cur = null; };
    for (const line of lines) {
      if (!line) continue;
      if (HEAD.test(line) && /位置|ページ|location|page|\|/i.test(line)) {
        close();
        cur = { text: "", page: pageOf(line), loc: locOf(line), memo: "" };
        mode = "hl";
        continue;
      }
      if (NOTE_HEAD.test(line) && /位置|ページ|location|page|\|/i.test(line)) { mode = "note"; continue; }
      const note = line.match(NOTE_LINE);
      if (note) {
        const target = cur || items[items.length - 1];
        if (target && note[1]) target.memo = target.memo ? `${target.memo}\n${note[1]}` : note[1];
        if (cur || items.length) mode = "note";
        continue;
      }
      if (!cur && mode === null) {
        if (!title && !NOISE.test(line)) title = line;
        continue;
      }
      if (mode === "note") {
        const target = cur || items[items.length - 1];
        if (target) target.memo = target.memo ? `${target.memo}\n${line}` : line;
        continue;
      }
      if (cur) cur.text = cur.text ? `${cur.text} ${line}` : line;
    }
    close();
    return items.length ? [{ title, author: "", items }] : [];
  }

  // 見出しが無い貼り付けは、空行で区切った塊を1つずつハイライトにする
  function parseBlocks(t) {
    const items = t.split(/\n\s*\n/).map((b) => b.replace(/\s*\n\s*/g, " ").trim()).filter((b) => b.length >= 4)
      .map((b) => ({ text: b, page: null, loc: "", memo: "" }));
    return items.length ? [{ title: "", author: "", items }] : [];
  }

  function parseKindle(raw) {
    const t = String(raw || "").replace(/\r\n?/g, "\n").replace(/ /g, " ");
    if (!t.trim()) return [];
    if (/^={6,}\s*$/m.test(t)) {
      const c = parseClippings(t);
      if (c.length) return c;
    }
    const n = parseNotebook(t);
    return n.length ? n : parseBlocks(t);
  }

  // 書名で読書メモ_DB の本を探す（空白・かっこの違いは無視）
  function matchBook(books, title) {
    const k = norm(title);
    if (!k) return null;
    return books.find((b) => norm(b.title) === k)
      || books.find((b) => { const n = norm(b.title); return n.length >= 2 && (k.includes(n) || n.includes(k)); })
      || null;
  }

  // ---------- ページの文 ----------
  // 1段落を文に分ける。閉じかっこは前の文に付ける
  function sentences(p) {
    return String(p).match(/[^。！？!?]*(?:[。！？!?]+[」』）)]*|$)/g).filter((s) => s.trim());
  }

  // AI が選んだ箇所（本文の抜き出し）に重なる文に印を付ける。返すのは段落ごとの true/false の並び
  function markSentences(paragraphs, highlights) {
    const marks = paragraphs.map((p) => sentences(p).map(() => false));
    for (const h of highlights || []) {
      const want = norm(h);
      if (!want) continue;
      paragraphs.forEach((p, pi) => {
        const ss = sentences(p);
        // 文の境目ごとの位置を、空白などを除いた文字で数える
        let pos = 0;
        const ranges = ss.map((s) => { const n = norm(s).length; const r = [pos, pos + n]; pos += n; return r; });
        const at = norm(p).indexOf(want);
        if (at < 0) return;
        const end = at + want.length;
        ranges.forEach(([a, b], si) => { if (a < end && b > at) marks[pi][si] = true; });
      });
    }
    return marks;
  }

  // 印の付いた文を、段落の中で続いているものごとに1つのハイライトにまとめる
  function groupMarks(paragraphs, marks) {
    const groups = [];
    paragraphs.forEach((p, pi) => {
      const ss = sentences(p);
      let cur = null;
      ss.forEach((s, si) => {
        if (marks[pi]?.[si]) {
          if (!cur) { cur = { key: `${pi}:${si}`, text: "" }; groups.push(cur); }
          cur.text += s;
        } else cur = null;
      });
    });
    return groups.map((g) => ({ ...g, text: g.text.trim() }));
  }

  // ---------- 書き出し（NotebookLM に渡すテキスト） ----------
  function exportText(book, highlights, legacy) {
    const lines = [`# ${book.title}`];
    const meta = [book.author && `著者：${book.author}`, book.publisher && `出版社：${book.publisher}`, book.finished && `読了：${book.finished}`, book.rating && `評価：${book.rating}`].filter(Boolean);
    if (meta.length) lines.push("", meta.join(" ／ "));
    if (book.review) lines.push("", "## 感想", "", book.review);
    lines.push("", `## ハイライト（${highlights.length + (legacy?.length || 0)}件）`);
    for (const h of highlights) {
      const where = [h.page != null && `p.${h.page}`, h.loc && `位置 ${h.loc}`, h.source].filter(Boolean).join(" ・ ");
      lines.push("", `> ${h.text}`);
      if (where) lines.push(`（${where}）`);
      if (h.memo) lines.push(`メモ：${h.memo}`);
    }
    for (const h of legacy || []) {
      lines.push("", `> ${h.text}`, "（付箋写真・前の形）");
      if (h.memo) lines.push(`メモ：${h.memo}`);
    }
    return `${lines.join("\n")}\n`;
  }

  root.ShioriParse = { parseKindle, splitTitle, matchBook, sentences, markSentences, groupMarks, exportText, norm };
})(typeof window !== "undefined" ? window : globalThis);
