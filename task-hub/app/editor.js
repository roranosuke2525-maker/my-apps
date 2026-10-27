  // ================= エディタ：Notion の Markdown を読み書きする =================
  // ブロック：{ type, text, attrs, checked, children, ... }。最上位ブロックは元の文字列（src）と位置を持ち、
  // 保存するときは「変わったところだけ」を update_content（old_str → new_str）で置き換える
  const LISTY = new Set(["bul", "num", "todo"]);
  const KIDS_OK = new Set(["para", "bul", "num", "todo", "tog", "call", "qtag"]);
  const TEXT_TYPES = new Set(["para", "h1", "h2", "h3", "h4", "bul", "num", "todo", "quote", "tog", "call", "qtag"]);
  let bidSeq = 0;
  const wsOf = (l) => l.match(/^[\t ]*/)[0];
  const isBlockStart = (l) => /^\s*([-*+]\s|\d+[.)]\s|#{1,4}\s|>|<|\||```|\$\$|---\s*$)/.test(l);

  function parseMd(raw) {
    const lines = raw.split("\n");
    const starts = []; let off = 0;
    for (const l of lines) { starts.push(off); off += l.length + 1; }
    const unitBox = { unit: null };
    const blocks = parseLines(lines, unitBox, true);
    for (const b of blocks) { b.start = starts[b.from]; b.end = starts[b.to] + lines[b.to].length; b.src = raw.slice(b.start, b.end); }
    return { blocks, unit: unitBox.unit || (/\n\t/.test(raw) ? "\t" : "  ") };
  }
  function mk(type, o = {}) { return { bid: `b${++bidSeq}`, type, text: "", attrs: "", children: [], ...o }; }
  function parseLines(L, unitBox, top = false) {
    const out = []; let i = 0;
    while (i < L.length) {
      const line = L[i];
      if (!line.trim()) { i++; continue; }
      const from = i; const t = line.trim();
      let b = null;
      // コード
      const fm = t.match(/^(`{3,}|~{3,})(.*)$/);
      if (fm) {
        let j = i + 1; while (j < L.length && !(L[j].trim().startsWith(fm[1][0].repeat(fm[1].length)) && /^[`~]+$/.test(L[j].trim()))) j++;
        b = mk("code", { lang: fm[2].trim(), text: L.slice(i + 1, j).join("\n") }); i = Math.min(j, L.length - 1) + 1;
        b.from = from; b.to = i - 1; out.push(b); continue;
      }
      if (t === "$$") {
        let j = i + 1; while (j < L.length && L[j].trim() !== "$$") j++;
        b = mk("ro", { label: "数式", raw: L.slice(i, j + 1).join("\n") }); i = j + 1; b.from = from; b.to = i - 1; out.push(b); continue;
      }
      // タグのブロック
      const tm = t.match(/^<([a-z][\w-]*)([^>]*?)(\/?)>(.*)$/);
      if (tm && !/^<(b|i|s|u|span|mention|date|br|link-preview)\b/.test(t)) {
        const [, tag, attrs, self, rest] = tm;
        const closeRe = new RegExp(`</${tag}>\\s*$`);
        if (self || closeRe.test(t)) {
          const inner = self ? "" : rest.replace(closeRe, "");
          if (tag === "table-of-contents") b = mk("toc", { raw: line.trim(), attrs });
          else if (tag === "p" && self) b = mk("para", { emptyTag: true });
          else if (tag === "p") b = mk("para", { text: inner, attrs });
          else if (/^h[1-4]$/.test(tag)) b = mk(tag, { text: inner, attrs });
          else if (tag === "todo") b = mk("todo", { text: inner, attrs: attrs.replace(/\s*checked="(true|false)"/, ""), checked: /checked="true"/.test(attrs), tagForm: true });
          else b = mk("ro", { label: roLabel(tag, inner, attrs), raw: line.trim(), url: (attrs.match(/(?:url|source)="([^"]+)"/) || [])[1] });
          i++;
        } else {
          let depth = 1, j = i + 1;
          const openRe = new RegExp(`^<${tag}(\\s|>)`);
          for (; j < L.length; j++) {
            const tj = L[j].trim();
            if (openRe.test(tj) && !new RegExp(`</${tag}>\\s*$`).test(tj) && !/\/>\s*$/.test(tj)) depth++;
            if (tj === `</${tag}>` || (tj.endsWith(`</${tag}>`) && !openRe.test(tj))) { depth--; if (depth === 0) break; }
          }
          const inner = L.slice(i + 1, j).map((l) => l.slice(Math.min(wsOf(line).length, wsOf(l).length)));
          if (rest.trim()) inner.unshift(rest);
          if (tag === "callout" || tag === "toggle" || tag === "quote") {
            const c = parseContainer(inner, unitBox);
            b = mk(tag === "callout" ? "call" : tag === "toggle" ? "tog" : "qtag", { attrs, ...c });
            if (tag === "callout") { b.icon = (attrs.match(/icon="([^"]*)"/) || [])[1] || ""; b.color = (attrs.match(/color="([^"]*)"/) || [])[1] || ""; }
          } else if (tag === "table") b = parseTagTable(L.slice(i, j + 1).join("\n"));
          else b = mk("ro", { label: roLabel(tag, inner.join(" "), attrs), raw: L.slice(i, j + 1).join("\n"), url: (attrs.match(/url="([^"]+)"/) || [])[1] });
          i = Math.min(j, L.length - 1) + 1;
        }
        b.from = from; b.to = i - 1; out.push(b); continue;
      }
      // 表（パイプ）
      if (t.startsWith("|")) {
        let j = i; while (j < L.length && L[j].trim().startsWith("|")) j++;
        b = parsePipeTable(L.slice(i, j)); i = j; b.from = from; b.to = i - 1; out.push(b); continue;
      }
      // 1行のブロック
      const ind = wsOf(line).length; let c = line.slice(ind); let m;
      if ((m = c.match(/^(#{1,4})\s+(.*)$/))) b = mk(`h${m[1].length}`, { text: m[2] });
      else if ((m = c.match(/^[-*+]\s+\[( |x|X)\]\s?(.*)$/))) b = mk("todo", { text: m[2], checked: m[1] !== " " });
      else if ((m = c.match(/^[-*+]\s+(.*)$/))) b = mk("bul", { text: m[1] });
      else if ((m = c.match(/^\d+[.)]\s+(.*)$/))) b = mk("num", { text: m[1] });
      else if ((m = c.match(/^>\s?(.*)$/))) b = mk("quote", { text: m[1] });
      else if (/^(-{3,}|\*{3,}|_{3,})$/.test(c.trim())) b = mk("div");
      else if (/^!\[[^\]]*\]\([^)]*\)$/.test(c.trim())) b = mk("ro", { label: `🖼 画像${(c.match(/^!\[([^\]]*)\]/) || [])[1] ? `：${c.match(/^!\[([^\]]*)\]/)[1]}` : ""}`, raw: c, url: (c.match(/\]\(([^)]+)\)/) || [])[1] });
      else b = mk("para", { text: c });
      // 行末の \ は改行（同じブロックの続き）
      while (TEXT_TYPES.has(b.type) && b.text.endsWith("\\") && i + 1 < L.length && L[i + 1].trim()) { i++; b.text = `${b.text.slice(0, -1)}\n${L[i].trim()}`; }
      // 字下げされた行は子ブロック
      let j = i + 1; const kids = [];
      while (j < L.length) {
        if (!L[j].trim()) { let k = j; while (k < L.length && !L[k].trim()) k++; if (k < L.length && wsOf(L[k]).length > ind) { kids.push(...L.slice(j, k)); j = k; continue; } break; }
        if (wsOf(L[j]).length > ind) { kids.push(L[j]); j++; } else break;
      }
      if (kids.length) {
        const first = kids.find((l) => l.trim());
        if (!unitBox.unit) unitBox.unit = wsOf(first).slice(ind) || "  ";
        const minWs = Math.min(...kids.filter((l) => l.trim()).map((l) => wsOf(l).length));
        b.children = parseLines(kids.map((l) => l.slice(Math.min(minWs, wsOf(l).length))), unitBox);
        if (!KIDS_OK.has(b.type)) { b = mk("ro", { label: "（入れ子のブロック）", raw: L.slice(from, j).join("\n") }); }
      }
      let last = j - 1; while (last > from && !L[last].trim()) last--;
      b.from = from; b.to = last; out.push(b); i = j;
    }
    return out;
  }
  // コールアウト・トグル・引用（タグ）：最初の段落が見出し（タイトル）、空行のあとが子ブロック
  function parseContainer(inner, unitBox) {
    let k = 0; while (k < inner.length && !inner[k].trim()) k++;
    if (k >= inner.length) return { text: "", children: [] };
    if (isBlockStart(inner[k]) && !/^\s*<(b|i|s|u|span|mention|date)\b/.test(inner[k])) return { text: "", noTitle: true, children: parseLines(inner.slice(k), unitBox) };
    let text = inner[k].trim(); k++;
    while (text.endsWith("\\") && k < inner.length && inner[k].trim()) { text = `${text.slice(0, -1)}\n${inner[k].trim()}`; k++; }
    return { text: text === "<p />" ? "" : text, children: parseLines(inner.slice(k), unitBox) };
  }
  function roLabel(tag, inner, attrs) {
    const name = text(inner) || "";
    return ({ page: `📄 ${name || "ページ"}`, database: `🗄 ${name || "データベース"}`, image: "🖼 画像", file: "📎 ファイル", pdf: "📎 PDF", video: "🎞 動画", audio: "🔊 音声", bookmark: `🔖 ${name || "ブックマーク"}`, embed: "🔗 埋め込み",
      columns: "▥ 段組み（Notionで編集）", "synced-block": "🔄 同期ブロック", "synced-block-reference": "🔄 同期ブロック", "meeting-notes": "📝 会議メモ", details: "▸ トグル（旧形式）", ul: "• リスト（タグ形式）", ol: "1. リスト（タグ形式）", tabs: "タブ", mail: "✉️ メール", equation: "数式" })[tag] || `<${tag}>`;
  }
  function splitRow(l) {
    const s = l.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = []; let cur = "";
    for (let i = 0; i < s.length; i++) { if (s[i] === "\\" && s[i + 1] === "|") { cur += "\\|"; i++; continue; } if (s[i] === "|") { cells.push(cur.trim()); cur = ""; continue; } cur += s[i]; }
    cells.push(cur.trim()); return cells;
  }
  function parsePipeTable(lines) {
    const sepIdx = lines.findIndex((l) => /^\s*\|?\s*:?-{2,}/.test(l.replace(/\|/g, "|")) && /^[\s|:-]+$/.test(l));
    const rowsL = lines.filter((_, k) => k !== sepIdx);
    return mk("table", { kind: "pipe", rows: rowsL.map((l) => splitRow(l).map((c) => c.replace(/\\\|/g, "|"))), sep: sepIdx >= 0 ? lines[sepIdx] : null, head: sepIdx === 1 });
  }
  function parseTagTable(src) {
    const rowsOut = []; const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g; let m;
    while ((m = re.exec(src))) {
      const rowStart = m.index + m[0].indexOf(">") + 1; const cells = []; const cre = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/g; let c;
      while ((c = cre.exec(m[1]))) { const s = rowStart + c.index + c[0].indexOf(">") + 1; const t0 = c[2].trim().replace(/<br\s*\/?>/g, "\n"); cells.push({ s, e: s + c[2].length, text: t0, t0, nl: /^\n/.test(c[2]), th: c[1] === "th" }); }
      rowsOut.push(cells);
    }
    return mk("table", { kind: "tag", src, cells: rowsOut, head: /header-row="true"/.test(src) });
  }

  // ---- 書き出し ----
  function serText(s) { return String(s).replace(/\n/g, "\\\n"); }
  function guardLead(s, type) { return type === "para" && /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|---$|\|)/.test(s) ? `\\${s}` : s; }
  function ser(b, U) {
    const kidsOf = (sepKids) => b.children.map((c, k) => (k ? sepOf(b.children[k - 1], c) : "") + ser(c, U)).join("");
    const indentKids = () => kidsOf().split("\n").map((l) => (l ? U + l : l)).join("\n");
    const t = serText(b.text);
    let head;
    switch (b.type) {
      case "para": head = b.attrs ? `<p${b.attrs}>${t}</p>` : (t ? guardLead(t, "para") : "<p />"); break;
      case "h1": case "h2": case "h3": case "h4": { const n = +b.type[1]; head = b.attrs ? `<h${n}${b.attrs}>${t}</h${n}>` : `${"#".repeat(n)} ${t}`; break; }
      case "bul": head = `- ${t}`; break;
      case "num": head = `1. ${t}`; break;
      case "todo": head = b.tagForm ? `<todo checked="${b.checked ? "true" : "false"}"${b.attrs}>${t}</todo>` : `- [${b.checked ? "x" : " "}] ${t}`; break;
      case "quote": head = `> ${t}`; break;
      case "div": return "---";
      case "code": { const run = Math.max(2, ...(b.text.match(/`+/g) || [""]).map((x) => x.length)); const f = "`".repeat(run + 1); return `${f}${b.lang || ""}\n${b.text}\n${f}`; }
      case "call": case "tog": case "qtag": {
        const tag = { call: "callout", tog: "toggle", qtag: "quote" }[b.type];
        let attrs = b.attrs;
        if (b.type === "call") { attrs = attrs.replace(/\s*icon="[^"]*"/, "").replace(/\s*color="[^"]*"/, ""); attrs = `${b.icon ? ` icon="${b.icon}"` : ""}${b.color ? ` color="${b.color}"` : ""}${attrs}`; }
        const kids = b.children.length ? kidsOf() : "";
        const title = b.noTitle && !t ? "" : (t || "<p />");
        return `<${tag}${attrs}>\n${title}${title && kids ? "\n\n" : ""}${kids}\n</${tag}>`;
      }
      case "table":
        if (b.kind === "pipe") {
          const cell = (c) => c.replace(/\|/g, "\\|").replace(/\n/g, "<br />");
          const linesOut = b.rows.map((r) => `| ${r.map(cell).join(" | ")} |`);
          if (b.sep) linesOut.splice(1, 0, b.rows[0] ? `|${b.rows[0].map(() => " --- ").join("|")}|` : b.sep);
          return linesOut.join("\n");
        } else {
          let s = b.src; const all = b.cells.flat().sort((x, y) => y.s - x.s);
          for (const c of all) if (c.text !== c.t0) { const v = c.text.replace(/\n/g, "<br />"); s = s.slice(0, c.s) + (c.nl ? `\n${v}\n` : v) + s.slice(c.e); }
          return s;
        }
      default: return b.raw || "";
    }
    return b.children.length ? `${head}\n${indentKids()}` : head;
  }
  const sepOf = (a, b) => (LISTY.has(a.type) && LISTY.has(b.type) ? "\n" : "\n\n");

  // ---- 文字の飾り：Markdown ⇔ 画面 ----
  function mdToHtml(s) {
    const ph = []; const put = (h) => `\u0000${ph.push(h) - 1}\u0000`;
    let x = String(s);
    x = x.replace(/<mention\b[^>]*?(?:\/>|>[\s\S]*?<\/mention>)/g, (m) => { const label = (m.match(/>([\s\S]*?)<\/mention>/) || [])[1] || (/user:\/\//.test(m) ? "@ユーザー" : "↗ ページ"); return put(`<span class="mention" contenteditable="false" data-src="${encodeURIComponent(m)}">${esc(decode(label))}</span>`); });
    x = x.replace(/<date\b[^>]*\/>/g, (m) => put(`<span class="atom" contenteditable="false" data-src="${encodeURIComponent(m)}">📅 ${esc((m.match(/start="([^"]+)"/) || [])[1] || "")}</span>`));
    x = x.replace(/<link-preview\b[^>]*\/>/g, (m) => put(`<span class="atom" contenteditable="false" data-src="${encodeURIComponent(m)}">🔗 ${esc((m.match(/url="([^"]+)"/) || [])[1] || "")}</span>`));
    x = x.replace(/\[\^(https?:[^\]]+)\]/g, (m) => put(`<span class="atom" contenteditable="false" data-src="${encodeURIComponent(m)}">[出典]</span>`));
    x = x.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, f, c) => put(`<code>${esc(c)}</code>`));
    x = x.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, tx, u) => put(`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(decode(tx.replace(/\\([^\w\s])/g, "$1")))}</a>`));
    x = x.replace(/\\([\\`*_{}[\]()#+\-.!<>|~$])/g, (m, c) => put(esc(c)));
    x = esc(decode(x));
    x = x.replace(/&lt;(\/?)(b|i|s|u)&gt;/g, "<$1$2>").replace(/&lt;br\s*\/?&gt;/g, "<br>")
      .replace(/&lt;span color=&quot;([a-z_]+)&quot;&gt;/g, (m, c) => `<span data-color="${c}" class="${c.endsWith("_bg") ? `bg-${c.slice(0, -3)}` : `c-${c}`}">`).replace(/&lt;\/span&gt;/g, "</span>");
    x = x.replace(/\*\*([^*]+?)\*\*/g, "<b>$1</b>").replace(/__([^_]+?)__/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>").replace(/~~([^~]+?)~~/g, "<s>$1</s>");
    x = x.replace(/\n/g, "<br>");
    return x.replace(/\u0000(\d+)\u0000/g, (m, k) => ph[+k]);
  }
  const escMd = (s) => s.replace(/([\\`*_~[\]<>])/g, "\\$1");
  function htmlToMd(el) {
    let out = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { out += escMd(n.nodeValue.replace(/ /g, " ")); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (n.dataset?.src) { out += decodeURIComponent(n.dataset.src); continue; }
      if (tag === "br") { out += "\n"; continue; }
      const inner = htmlToMd(n);
      if (!inner) continue;
      const wrap = (a, b2, tagName) => (/^\s|\s$/.test(inner) ? `<${tagName}>${inner}</${tagName}>` : `${a}${inner}${b2}`);
      if (tag === "b" || tag === "strong") out += `<b>${inner}</b>`;
      else if (tag === "i" || tag === "em") out += `<i>${inner}</i>`;
      else if (tag === "s" || tag === "strike" || tag === "del") out += `<s>${inner}</s>`;
      else if (tag === "u") out += `<u>${inner}</u>`;
      else if (tag === "code") { const raw = n.textContent; const f = "`".repeat(Math.max(0, ...(raw.match(/`+/g) || [""]).map((y) => y.length)) + 1); out += `${f}${raw}${f}`; }
      else if (tag === "a") out += `[${inner}](${n.getAttribute("href") || ""})`;
      else if (tag === "span" && n.dataset.color) out += `<span color="${n.dataset.color}">${inner}</span>`;
      else if (tag === "div" || tag === "p") out += (out && !out.endsWith("\n") ? "\n" : "") + inner;
      else out += inner;
    }
    return out;
  }

  // ---- エディタ本体 ----
  // ED：開いているページの編集状態。raw＝Notion にある今の本文、tops＝最上位ブロック
  let ED = null;
  function mountEditor(box, raw, { pageId, onSaved, readOnly = false } = {}) {
    const { blocks, unit } = parseMd(raw || "");
    blocks.forEach((b, k) => { b.oi = k; });
    ED = { box, raw: raw || "", tops: blocks, orig: blocks.slice(), unit, pageId, open: new Set(), dirty: false, saving: false, again: false, timer: 0, onSaved, readOnly, byId: new Map() };
    if (!blocks.length) ED.tops.push(mk("para"));
    drawEditor();
  }
  function walk(list, fn, parent = null) { for (const b of list) { fn(b, parent); if (b.children?.length) walk(b.children, fn, b); } }
  function siblingsOf(b) { const p = ED.parent.get(b.bid); return p ? p.children : ED.tops; }
  function topOf(b) { let x = b; while (ED.parent.get(x.bid)) x = ED.parent.get(x.bid); return x; }
  function drawEditor(focus) {
    ED.parent = new Map(); ED.byId = new Map();
    walk(ED.tops, (b, p) => { ED.parent.set(b.bid, p); ED.byId.set(b.bid, b); });
    const root = document.createElement("div"); root.className = "ed";
    for (const el of drawList(ED.tops)) root.append(el);
    ED.box.replaceChildren(root);
    root.addEventListener("click", (e) => { if (e.target === root) { const last = ED.tops.at(-1); if (!last || last.type !== "para" || last.text) { const nb = mk("para"); ED.tops.push(nb); change(); drawEditor({ bid: nb.bid, at: 0 }); } else focusBlock(last.bid, "end"); } });
    if (focus) focusBlock(focus.bid, focus.at);
  }
  function drawList(list) {
    let n = 0;
    return list.map((b) => { n = b.type === "num" ? n + 1 : 0; return drawBlock(b, n); });
  }
  const PH = { para: "「/」でブロックを選ぶ", h1: "見出し1", h2: "見出し2", h3: "見出し3", h4: "見出し4", bul: "リスト", num: "リスト", todo: "ToDo", quote: "引用", tog: "トグル", call: "", qtag: "引用" };
  function drawBlock(b, n) {
    const el = document.createElement("div");
    el.className = `blk ${b.type}${b.type === "todo" && b.checked ? " on" : ""}${b.type === "tog" && ED.open.has(b.bid) ? " open" : ""}${b.type === "table" ? " tblk" : ""}`;
    el.dataset.bid = b.bid;
    const colorCls = (b.attrs.match(/color="([a-z_]+)"/) || [])[1];
    if (colorCls && b.type !== "call") el.classList.add(colorCls.endsWith("_bg") ? `bg-${colorCls.slice(0, -3)}` : `c-${colorCls}`);
    if (!ED.readOnly) el.insertAdjacentHTML("beforeend", `<button type="button" class="hdl" data-hdl="${b.bid}" aria-label="ブロックの操作" tabindex="-1">⋮⋮</button>`);
    if (b.type === "bul" || b.type === "num") el.insertAdjacentHTML("beforeend", `<span class="mk">${b.type === "num" ? `${n}.` : ""}</span>`);
    if (b.type === "todo") el.insertAdjacentHTML("beforeend", `<span class="mk"><button type="button" data-todo="${b.bid}" aria-label="チェック">${b.checked ? "✓" : ""}</button></span>`);
    if (b.type === "tog") el.insertAdjacentHTML("beforeend", `<span class="mk"><button type="button" data-tog="${b.bid}" aria-label="開く・閉じる">▶</button></span>`);
    const body = document.createElement("div"); body.className = "body"; el.append(body);
    const editable = !ED.readOnly;
    if (TEXT_TYPES.has(b.type)) {
      if (b.type === "call") { body.classList.add(...(b.color ? [b.color.endsWith("_bg") ? `bg-${b.color.slice(0, -3)}` : `c-${b.color}`] : [])); body.style.setProperty("--cbg", b.color && b.color.endsWith("_bg") ? `var(--nb-${b.color.slice(0, -3)})` : "var(--nb-default)"); body.insertAdjacentHTML("beforeend", `<span class="ic" data-icon="${b.bid}" role="button" tabindex="-1">${esc(b.icon || "💡")}</span>`); }
      const tx = document.createElement("div"); tx.className = `tx ${b.type}`; tx.dataset.bid = b.bid; tx.dataset.ph = PH[b.type] || "";
      if (editable) { tx.contentEditable = "true"; tx.spellcheck = false; }
      tx.innerHTML = mdToHtml(b.text);
      if (b.type === "call" && b.noTitle && !b.text) tx.dataset.ph = "";
      body.append(tx);
      if (b.children.length || b.type === "tog" || b.type === "call" || b.type === "qtag") {
        const kids = document.createElement("div"); kids.className = "kids";
        for (const k of drawList(b.children)) kids.append(k);
        if (b.type === "tog" && !b.children.length && editable) kids.insertAdjacentHTML("beforeend", `<div class="mute" style="font-size:13px;padding:2px 4px;cursor:text" data-addkid="${b.bid}">空のトグル。ここを押して書く</div>`);
        body.append(kids);
      }
    } else if (b.type === "div") body.innerHTML = "<hr>";
    else if (b.type === "code") {
      body.insertAdjacentHTML("beforeend", `<span class="lang">${esc(b.lang || "コード")}</span>`);
      const tx = document.createElement("div"); tx.className = "tx codetx"; tx.dataset.bid = b.bid; tx.textContent = b.text;
      if (editable) { tx.contentEditable = "true"; tx.spellcheck = false; }
      body.append(tx);
    } else if (b.type === "table") {
      const rowsArr = b.kind === "pipe" ? b.rows.map((r) => r.map((c) => ({ text: c }))) : b.cells;
      body.innerHTML = `<table><tbody>${rowsArr.map((r, ri) => `<tr class="${b.head && ri === 0 ? "hd" : ""}">${r.map((c, ci) => `<td><div class="cell" ${editable ? 'contenteditable="true"' : ""} data-cell="${b.bid}:${ri}:${ci}">${mdToHtml(c.text)}</div></td>`).join("")}</tr>`).join("")}</tbody></table>${editable && b.kind === "pipe" ? `<button type="button" class="mute" style="font-size:12px;padding:4px 2px" data-addrow="${b.bid}">＋ 行を足す</button>` : ""}`;
    } else if (b.type === "toc") {
      const hs = []; walk(ED.tops, (x) => { if (/^h[1-4]$/.test(x.type) || (x.type === "tog" && /heading=/.test(x.attrs))) hs.push(x); });
      body.innerHTML = hs.length ? hs.map((h) => `<a href="#" data-goto="${h.bid}" class="l${h.type[1] || 3}">${esc(text(h.text))}</a>`).join("") : "目次（見出しがまだありません）";
    } else {
      body.innerHTML = `<span>${esc(b.label || "Notionのブロック")}</span>${b.url && /^https?:/.test(b.url) ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">開く</a>` : ""}<span class="mute" style="font-size:11px">（このアプリでは編集できません）</span>`;
      el.classList.add("ro");
    }
    return el;
  }
  function focusBlock(bid, at = "end") {
    const tx = ED.box.querySelector(`.tx[data-bid="${bid}"]`); if (!tx) return;
    tx.focus();
    const len = tx.textContent.length;
    setCaret(tx, at === "end" ? len : Math.min(at, len));
  }
  function textNodesOf(el) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const out = []; let n; while ((n = w.nextNode())) out.push(n); return out; }
  function setCaret(el, off) {
    const sel = getSelection(); const r = document.createRange();
    let left = off;
    for (const n of textNodesOf(el)) { if (left <= n.length) { r.setStart(n, left); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return; } left -= n.length; }
    r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
  }
  function caretOffset(el) {
    const sel = getSelection(); if (!sel.rangeCount) return 0;
    const r = sel.getRangeAt(0).cloneRange(); const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  }
  const atEnd = (el) => caretOffset(el) >= el.textContent.length;
  function change(b) {
    if (b) topOf(b).dirty = true;
    ED.dirty = true; setSaveState("未保存");
    clearTimeout(ED.timer); ED.timer = setTimeout(saveEditor, 1200);
  }
  // 文字の入力
  function onEdInput(e) {
    const tx = e.target.closest(".tx, .cell"); if (!tx || !ED) return;
    if (tx.classList.contains("cell")) {
      const [bid, ri, ci] = tx.dataset.cell.split(":"); const b = ED.byId.get(bid); const v = htmlToMd(tx);
      if (b.kind === "pipe") b.rows[+ri][+ci] = v; else b.cells[+ri][+ci].text = v;
      change(b); return;
    }
    const b = ED.byId.get(tx.dataset.bid); if (!b) return;
    if (b.type === "code") { b.text = tx.innerText.replace(/\n$/, ""); change(b); return; }
    b.text = htmlToMd(tx).replace(/\n$/, "");
    // Markdown の書き出し：段落の先頭で「# 」「- 」「[] 」などを打ったら種類を変える
    if (b.type === "para" && !e.isComposing) {
      const plain = tx.textContent; const sc = [[/^#\s/, "h1"], [/^##\s/, "h2"], [/^###\s/, "h3"], [/^[-*]\s/, "bul"], [/^\[\s?\]\s/, "todo"], [/^1[.)]\s/, "num"], [/^>\s/, "tog"], [/^"\s/, "quote"], [/^---$/, "div"], [/^```$/, "code"]];
      for (const [re, type] of sc) {
        const m = plain.match(re);
        if (m) { const rest = b.text.replace(/^(\\?#{1,3}|\\?[-*]|\\\[\s?\\\]|\[\s?\]|1\\?[.)]|\\?>|"|\\?-\\?-\\?-|\\`\\`\\`|```)\s?/, ""); retype(b, type, rest); return; }
      }
    }
    change(b);
    if (slash) updateSlash(tx);
  }
  function retype(b, type, textValue = b.text) {
    b.type = type; b.text = type === "div" || type === "code" ? (type === "code" ? "" : "") : textValue;
    if (type === "todo") b.checked = false;
    if (type === "call") { b.icon = b.icon || "💡"; b.color = b.color || "gray_bg"; }
    if (type === "tog") ED.open.add(b.bid);
    if (!KIDS_OK.has(type) && b.children.length) { const sib = siblingsOf(b); sib.splice(sib.indexOf(b) + 1, 0, ...b.children); b.children = []; }
    change(b); drawEditor(type === "div" ? null : { bid: b.bid, at: 0 });
    if (type === "div") { const sib = siblingsOf(b); const nb = mk("para"); sib.splice(sib.indexOf(b) + 1, 0, nb); change(nb); drawEditor({ bid: nb.bid, at: 0 }); }
  }
  // 1つ前の「文字を書ける」ブロック（画面の上から順）
  function flatText() { const out = []; walk(ED.tops, (b) => { if (TEXT_TYPES.has(b.type) || b.type === "code") out.push(b); }); return out.filter((b) => { let p = ED.parent.get(b.bid); while (p) { if (p.type === "tog" && !ED.open.has(p.bid)) return false; p = ED.parent.get(p.bid); } return true; }); }
  function onEdKey(e) {
    const tx = e.target.closest(".tx"); if (!tx || !ED) return;
    const b = ED.byId.get(tx.dataset.bid); if (!b) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (slash && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) { e.preventDefault(); slashKey(e.key); return; }
    if ((e.metaKey || e.ctrlKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) { e.preventDefault(); fmt({ b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()]); return; }
    if (e.key === "/" && !e.metaKey) { const off = caretOffset(tx); const before = tx.textContent.slice(0, off); if (!before || /\s$/.test(before)) setTimeout(() => openSlash(tx, b, off), 0); }
    if (e.key === "Enter" && b.type === "code") { if (e.shiftKey || !atEnd(tx) || !tx.textContent.endsWith("\n\n")) { e.preventDefault(); document.execCommand("insertText", false, "\n"); return; } e.preventDefault(); b.text = b.text.replace(/\n+$/, ""); const sib = siblingsOf(b); const nb = mk("para"); sib.splice(sib.indexOf(b) + 1, 0, nb); change(b); drawEditor({ bid: nb.bid, at: 0 }); return; }
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); document.execCommand("insertLineBreak"); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const empty = !tx.textContent.length;
      if (empty && (LISTY.has(b.type) || b.type === "quote")) { if (ED.parent.get(b.bid) && LISTY.has(ED.parent.get(b.bid).type)) outdent(b); else retype(b, "para", ""); return; }
      // 右側を切り取って次のブロックへ
      const sel = getSelection(); const r = sel.getRangeAt(0); r.deleteContents();
      const tail = document.createRange(); tail.setStart(r.startContainer, r.startOffset); tail.setEnd(tx, tx.childNodes.length);
      const frag = tail.extractContents(); const tmp = document.createElement("div"); tmp.append(frag);
      b.text = htmlToMd(tx).replace(/\n$/, ""); const rightText = htmlToMd(tmp).replace(/^\n/, "");
      const nb = mk(LISTY.has(b.type) ? b.type : "para", { text: rightText });
      if ((b.type === "tog" && ED.open.has(b.bid)) || b.type === "call" || b.type === "qtag") b.children.unshift(nb);
      else { const sib = siblingsOf(b); sib.splice(sib.indexOf(b) + 1, 0, nb); if (b.children.length && LISTY.has(b.type) && !rightText) { /* 子はそのまま */ } }
      change(b); change(nb); drawEditor({ bid: nb.bid, at: 0 }); return;
    }
    if (e.key === "Backspace" && getSelection().isCollapsed && caretOffset(tx) === 0) {
      if (b.type !== "para") { e.preventDefault(); if (b.type === "call" || b.type === "qtag" || b.type === "tog") { const sib = siblingsOf(b); const at = sib.indexOf(b); const nb = mk("para", { text: b.text }); sib.splice(at, 1, nb, ...b.children); change(nb); drawEditor({ bid: nb.bid, at: 0 }); return; } retype(b, "para", b.text); return; }
      const p = ED.parent.get(b.bid);
      if (p && LISTY.has(p.type)) { e.preventDefault(); outdent(b); return; }
      const flat = flatText(); const k = flat.indexOf(b); const prev = flat[k - 1];
      if (!prev) return;
      e.preventDefault();
      if (prev.type === "code") { focusBlock(prev.bid, "end"); return; }
      const at = text(prev.text).length; const joinAt = ED.box.querySelector(`.tx[data-bid="${prev.bid}"]`)?.textContent.length ?? at;
      prev.text = (prev.text || "") + (b.text || ""); prev.children.push(...b.children);
      const sib = siblingsOf(b); sib.splice(sib.indexOf(b), 1);
      if (!ED.tops.length) ED.tops.push(mk("para"));
      change(prev); markStructure(); drawEditor({ bid: prev.bid, at: joinAt }); return;
    }
    if (e.key === "Tab") { e.preventDefault(); if (e.shiftKey) outdent(b); else indent(b); return; }
    if (e.key === "ArrowUp" && caretOffset(tx) === 0) { const flat = flatText(); const prev = flat[flat.indexOf(b) - 1]; if (prev) { e.preventDefault(); focusBlock(prev.bid, "end"); } }
    if (e.key === "ArrowDown" && atEnd(tx)) { const flat = flatText(); const nx = flat[flat.indexOf(b) + 1]; if (nx) { e.preventDefault(); focusBlock(nx.bid, 0); } }
  }
  function markStructure() { ED.dirty = true; change(); }
  function indent(b) {
    const sib = siblingsOf(b); const k = sib.indexOf(b); const prev = sib[k - 1];
    if (!prev || !KIDS_OK.has(prev.type)) return;
    const off = caretOffset(ED.box.querySelector(`.tx[data-bid="${b.bid}"]`) || document.body);
    sib.splice(k, 1); prev.children.push(b); if (prev.type === "tog") ED.open.add(prev.bid);
    change(prev); markStructure(); drawEditor({ bid: b.bid, at: off });
  }
  function outdent(b) {
    const p = ED.parent.get(b.bid); if (!p) return;
    const off = caretOffset(ED.box.querySelector(`.tx[data-bid="${b.bid}"]`) || document.body);
    const sib = p.children; sib.splice(sib.indexOf(b), 1);
    const gs = siblingsOf(p); gs.splice(gs.indexOf(p) + 1, 0, b);
    change(p); markStructure(); drawEditor({ bid: b.bid, at: off });
  }
  function onEdClick(e) {
    if (!ED) return;
    const t = e.target.closest("[data-todo],[data-tog],[data-icon],[data-addrow],[data-addkid],[data-goto],[data-hdl]"); if (!t) return;
    e.preventDefault();
    if (ED.readOnly && !t.dataset.tog && !t.dataset.goto) return;
    const d = t.dataset;
    if (d.todo) { const b = ED.byId.get(d.todo); b.checked = !b.checked; change(b); const el = t.closest(".blk"); el.classList.toggle("on", b.checked); t.textContent = b.checked ? "✓" : ""; return; }
    if (d.tog) { ED.open.has(d.tog) ? ED.open.delete(d.tog) : ED.open.add(d.tog); t.closest(".blk").classList.toggle("open"); return; }
    if (d.icon) { const b = ED.byId.get(d.icon); askText("アイコン（絵文字1つ）", b.icon || "💡", (v) => { b.icon = v.trim() || "💡"; change(b); drawEditor(); }); return; }
    if (d.addrow) { const b = ED.byId.get(d.addrow); b.rows.push(b.rows[0].map(() => "")); change(b); drawEditor(); return; }
    if (d.addkid) { const b = ED.byId.get(d.addkid); const nb = mk("para"); b.children.push(nb); change(b); drawEditor({ bid: nb.bid, at: 0 }); return; }
    if (d.goto) { const el = ED.box.querySelector(`.blk[data-bid="${d.goto}"]`); el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); return; }
    if (d.hdl) blockMenu(d.hdl, t);
  }
  // 「/」メニュー
  const SLASH = [["para", "テキスト", "Aa"], ["h1", "見出し1", "H1"], ["h2", "見出し2", "H2"], ["h3", "見出し3", "H3"], ["todo", "ToDoリスト", "☑"], ["bul", "箇条書き", "•"], ["num", "番号付きリスト", "1."], ["tog", "トグル", "▶"], ["quote", "引用", "❝"], ["call", "コールアウト", "💡"], ["div", "区切り線", "—"], ["code", "コード", "</>"], ["table", "表（3×2）", "▦"]];
  let slash = null;
  function openSlash(tx, b, off) { slash = { tx, b, off, q: "", i: 0 }; drawSlash(); }
  function updateSlash(tx) {
    if (!slash || tx !== slash.tx) return;
    const cur = caretOffset(tx); const s = tx.textContent;
    if (s[slash.off] !== "/" || cur <= slash.off) { closeSlash(); return; }
    slash.q = s.slice(slash.off + 1, cur); slash.i = 0;
    if (/\s/.test(slash.q) || slash.q.length > 10) { closeSlash(); return; }
    drawSlash();
  }
  function slashItems() { const q = slash.q; return SLASH.filter(([k, n]) => !q || n.includes(q) || k.includes(q.toLowerCase())); }
  function drawSlash() {
    closeMenus();
    const items = slashItems(); if (!items.length) { slash.empty = true; return; }
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    const m = document.createElement("div"); m.className = "menu"; m.id = "slashmenu";
    m.innerHTML = `<div class="lab">ブロックを選ぶ</div>${items.map(([k, n, ic], i) => `<button type="button" data-slash="${k}" aria-selected="${i === slash.i}"><i>${ic}</i>${n}</button>`).join("")}`;
    document.body.append(m);
    const top = Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 8); m.style.top = `${Math.max(8, top)}px`; m.style.left = `${Math.min(Math.max(8, r.left), innerWidth - m.offsetWidth - 8)}px`;
  }
  function slashKey(k) {
    const items = slashItems();
    if (k === "Escape" || !items.length) { closeSlash(); return; }
    if (k === "ArrowDown") slash.i = (slash.i + 1) % items.length;
    if (k === "ArrowUp") slash.i = (slash.i - 1 + items.length) % items.length;
    if (k === "Enter") { applySlash(items[slash.i][0]); return; }
    drawSlash();
  }
  function applySlash(type) {
    const { tx, b, off, q } = slash; closeSlash();
    // 「/…」を消す
    const s = tx.textContent; const plain = s.slice(0, off) + s.slice(off + 1 + q.length);
    const hadText = plain.trim().length > 0;
    if (!hadText) b.text = ""; else { tx.textContent = plain; b.text = escMd(plain); }
    let target = b;
    if (hadText) { target = mk("para"); const sib = siblingsOf(b); sib.splice(sib.indexOf(b) + 1, 0, target); ED.parent.set(target.bid, ED.parent.get(b.bid)); ED.byId.set(target.bid, target); }
    if (type === "table") { const sib = siblingsOf(target); const tb = mk("table", { kind: "pipe", rows: [["", "", ""], ["", "", ""]], sep: "| --- | --- | --- |", head: true }); sib.splice(sib.indexOf(target), 1, tb); change(tb); markStructure(); drawEditor(); return; }
    retype(target, type, "");
  }
  function closeSlash() { slash = null; document.getElementById("slashmenu")?.remove(); }
  function closeMenus() { for (const m of document.querySelectorAll(".menu")) m.remove(); }
  // ブロックの操作（⋮⋮）
  function blockMenu(bid, anchor) {
    closeMenus(); const b = ED.byId.get(bid); if (!b) return;
    const r = anchor.getBoundingClientRect();
    const m = document.createElement("div"); m.className = "menu";
    const conv = TEXT_TYPES.has(b.type) ? SLASH.filter(([k]) => TEXT_TYPES.has(k) && k !== b.type) : [];
    m.innerHTML = `<button type="button" data-bm="up"><i>↑</i>上へ移動</button><button type="button" data-bm="down"><i>↓</i>下へ移動</button><button type="button" data-bm="dup"><i>⧉</i>複製</button><button type="button" data-bm="del"><i>🗑</i>削除</button>
      ${b.type === "call" ? `<div class="lab">背景の色</div>${["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"].map((c) => `<button type="button" data-bm="color:${c}_bg"><i class="bg-${c}" style="border-radius:4px">&nbsp;</i>${c}</button>`).join("")}` : ""}
      ${conv.length ? `<div class="lab">種類を変える</div>${conv.map(([k, n, ic]) => `<button type="button" data-bm="to:${k}"><i>${ic}</i>${n}</button>`).join("")}` : ""}`;
    document.body.append(m);
    m.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8))}px`; m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
    m.onclick = (e) => {
      const x = e.target.closest("[data-bm]"); if (!x) return; closeMenus();
      const act = x.dataset.bm; const sib = siblingsOf(b); const k = sib.indexOf(b);
      if (act === "up" && k > 0) { sib.splice(k, 1); sib.splice(k - 1, 0, b); moved(b); }
      if (act === "down" && k < sib.length - 1) { sib.splice(k, 1); sib.splice(k + 1, 0, b); moved(b); }
      if (act === "dup") { const copy = JSON.parse(JSON.stringify(b)); walk([copy], (y) => { y.bid = `b${++bidSeq}`; delete y.oi; delete y.src; }); sib.splice(k + 1, 0, copy); change(copy); }
      if (act === "del") { sib.splice(k, 1); if (!ED.tops.length) ED.tops.push(mk("para")); markStructure(); }
      if (act.startsWith("color:")) { b.color = act.slice(6); change(b); }
      if (act.startsWith("to:")) { retype(b, act.slice(3)); return; }
      drawEditor();
    };
  }
  // 並べ替えたブロックは「新しく書いた」扱いにして、元の場所を消して新しい場所に書く
  function moved(b) { const top = topOf(b); if (top === b && b.oi != null) { b.moved = true; } change(top); markStructure(); }
  // 選んだ文字の飾り
  function fmt(kind) {
    if (kind === "code") { const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return; const r = sel.getRangeAt(0); const c = document.createElement("code"); c.textContent = r.toString(); r.deleteContents(); r.insertNode(c); }
    else if (kind === "link") { const sel = getSelection(); const r = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null; askText("リンク先のURL", "https://", (u) => { if (!r || !/^https?:\/\//.test(u)) return; sel.removeAllRanges(); sel.addRange(r); document.execCommand("createLink", false, u); afterFmt(); }); return; }
    else if (kind.startsWith("color:")) { const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return; const r = sel.getRangeAt(0); const c = kind.slice(6); const sp = document.createElement("span"); sp.dataset.color = c; sp.className = c.endsWith("_bg") ? `bg-${c.slice(0, -3)}` : `c-${c}`; sp.append(r.extractContents()); r.insertNode(sp); }
    else document.execCommand(kind === "strike" ? "strikeThrough" : kind);
    afterFmt();
  }
  function afterFmt() { const a = document.activeElement; if (a?.classList.contains("tx") || a?.classList.contains("cell")) onEdInput({ target: a }); }
  function showFmtBar() {
    const old = document.getElementById("fmtbar");
    const sel = getSelection();
    if (!ED || ED.readOnly || !sel.rangeCount || sel.isCollapsed) { old?.remove(); return; }
    const host = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest(".tx:not(.codetx), .cell");
    if (!host || !ED.box.contains(host)) { old?.remove(); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const bar = old || Object.assign(document.createElement("div"), { className: "fmt", id: "fmtbar" });
    bar.innerHTML = `<button type="button" data-fmt="bold"><b>B</b></button><button type="button" data-fmt="italic"><i>I</i></button><button type="button" data-fmt="underline"><u>U</u></button><button type="button" data-fmt="strike"><s>S</s></button><button type="button" data-fmt="code">&lt;/&gt;</button><button type="button" data-fmt="link">🔗</button><button type="button" data-fmt="color:red" style="color:var(--n-red)">A</button><button type="button" data-fmt="color:blue" style="color:var(--n-blue)">A</button><button type="button" data-fmt="color:yellow_bg" style="background:var(--nb-yellow);color:var(--ink)">A</button>`;
    if (!old) document.body.append(bar);
    bar.style.top = `${Math.max(8, r.top - bar.offsetHeight - 8)}px`; bar.style.left = `${Math.max(8, Math.min(r.left, innerWidth - bar.offsetWidth - 8))}px`;
  }
  // 貼り付け：複数行は Markdown として読み、ブロックにする
  function onEdPaste(e) {
    const tx = e.target.closest(".tx, .cell"); if (!tx || !ED) return;
    const t = e.clipboardData.getData("text/plain"); e.preventDefault();
    const b = ED.byId.get(tx.dataset.bid);
    if (!b || !t.includes("\n") || b.type === "code" || tx.classList.contains("cell")) { document.execCommand("insertText", false, t); return; }
    const { blocks } = parseMd(t.replace(/\r/g, "")); const sib = siblingsOf(b); const k = sib.indexOf(b);
    if (!b.text) sib.splice(k, 1, ...blocks); else sib.splice(k + 1, 0, ...blocks);
    for (const x of blocks) { delete x.oi; change(x); }
    markStructure(); drawEditor({ bid: blocks.at(-1).bid, at: "end" });
  }

  // ---- 保存：変わった最上位ブロックの範囲だけを置き換える ----
  function buildUpdate() {
    const raw = ED.raw; const orig = ED.orig; const now = ED.tops; const U = ED.unit;
    const clean = (b, k) => b.oi === k && !b.dirty && !b.moved;
    let p = 0; while (p < now.length && p < orig.length && clean(now[p], p) && now[p] === orig[p]) p++;
    let q = 0; while (q < now.length - p && q < orig.length - p && now[now.length - 1 - q] === orig[orig.length - 1 - q] && !now[now.length - 1 - q].dirty && !now[now.length - 1 - q].moved) q++;
    const oMid = orig.slice(p, orig.length - q); const nMid = now.slice(p, now.length - q);
    if (!oMid.length && !nMid.length) return null;
    const kA = p > 0 ? orig[p - 1] : null; const kB = q > 0 ? orig[orig.length - q] : null;
    const serList = (list) => list.map((b, k) => (k ? sepOf(list[k - 1], b) : "") + (b.oi != null && !b.dirty && !b.moved && b.src ? b.src : ser(b, U))).join("");
    let s, e, nt;
    if (oMid.length) {
      s = kA ? kA.end : oMid[0].start; e = oMid.at(-1).end;
      nt = nMid.length ? (kA ? sepOf(kA, nMid[0]) : "") + serList(nMid) : "";
      if (!nMid.length && !kA && kB) e = kB.start;
    } else if (kA) { s = kA.start; e = kA.end; nt = kA.src + sepOf(kA, nMid[0]) + serList(nMid); }
    else if (kB) { s = kB.start; e = kB.end; nt = serList(nMid) + sepOf(nMid.at(-1), kB) + kB.src; }
    else return { append: serList(nMid) };
    // old_str が本文の中で1か所だけになるまで前後に広げる
    const count = (x) => (x ? raw.split(x).length - 1 : 0);
    let guard = 0;
    while (count(raw.slice(s, e)) !== 1 && guard++ < 400) {
      const prev = orig.filter((b) => b.end <= s).at(-1); const next = orig.find((b) => b.start >= e);
      if (prev) { nt = raw.slice(prev.start, s) + nt; s = prev.start; } else if (next) { nt += raw.slice(e, next.end); e = next.end; } else break;
    }
    if (!raw.slice(s, e)) return { replace: serList(now) };
    return { s, e, old: raw.slice(s, e), nw: nt };
  }
  async function saveEditor() {
    if (!ED || !ED.dirty || ED.readOnly) return;
    if (ED.saving) { ED.again = true; return; }
    const E = ED; const u = buildUpdate();
    if (!u) { E.dirty = false; setSaveState("保存済み"); return; }
    E.saving = true; E.dirty = false; setSaveState("保存中…");
    const snapshotTops = E.tops.slice();
    try {
      let newRaw;
      if (S.mode === "demo") { await sleep(250); }
      else if (u.append != null) await call("update", { page_id: E.pageId, command: "insert_content", content: u.append, allow_async: false }, { read: false });
      else if (u.replace != null) await call("update", { page_id: E.pageId, command: "replace_content", new_str: u.replace, allow_async: false }, { read: false });
      else {
        const res = await call("update", { page_id: E.pageId, command: "update_content", content_updates: [{ old_str: u.old, new_str: u.nw }], allow_async: false }, { read: false });
        if (res?.warnings?.length) throw Object.assign(new Error("conflict"), { code: "conflict" });
      }
      // Notion は書いた文を整えて保存する（**太字** → <b>太字</b> など）ので、保存後の本文を読み直して位置を合わせる
      newRaw = S.mode === "demo" ? null : await fetchBody(E.pageId).catch(() => null);
      if (newRaw == null) newRaw = u.append != null ? (E.raw ? `${E.raw}\n\n${u.append}` : u.append) : u.replace != null ? u.replace : E.raw.slice(0, u.s) + u.nw + E.raw.slice(u.e);
      E.raw = newRaw;
      // 書いた内容を読み直して、各ブロックの元の文字列と位置を付け直す
      const { blocks } = parseMd(newRaw);
      if (blocks.length === snapshotTops.length && E === ED) {
        blocks.forEach((nb, k) => { const b = snapshotTops[k]; Object.assign(b, { oi: k, src: nb.src, start: nb.start, end: nb.end, from: nb.from, to: nb.to, moved: false }); if (!E.dirty) walk([b], (y) => { y.dirty = false; }); });
        E.orig = snapshotTops.slice();
      } else if (E === ED) {
        blocks.forEach((b, k) => { b.oi = k; }); E.orig = blocks.slice(); E.tops = blocks; if (!document.activeElement?.closest(".ed")) drawEditor(); else E.redrawLater = true;
      }
      setSaveState(E.dirty ? "未保存" : "保存済み");
      E.onSaved?.(newRaw);
    } catch (err) {
      E.dirty = true;
      const conflict = err?.code === "conflict" || /No matches found/i.test(String(err?.message || ""));
      setSaveState(conflict ? "Notion側が変わっていました" : "保存できませんでした", true);
      if (conflict && E === ED) showConflict(E); else toast(errText(err));
    } finally {
      E.saving = false;
      if (E.again) { E.again = false; saveEditor(); }
    }
  }
  // 保存しようとした所が Notion 側で先に変わっていたとき：最新を読み込むか、自分の内容で上書きするかを選ぶ
  function showConflict(E) {
    const bar = document.getElementById("conflict") || Object.assign(document.createElement("div"), { id: "conflict", className: "aibar" });
    bar.style.borderColor = "var(--late)";
    bar.innerHTML = `<div class="h"><b style="color:var(--late)">Notion 側で本文が先に変わっていました</b></div><div class="mute" style="font-size:12.5px">定時処理のAIなどが同じ所を書き換えた可能性があります。どちらにしますか？</div>
      <div class="acts"><button type="button" class="btn pri" id="cf-load">Notion の最新を読み込む（この画面の変更は捨てる）</button><button type="button" class="btn" id="cf-over">この画面の内容で上書きする</button></div>`;
    E.box.before(bar);
    bar.querySelector("#cf-load").onclick = async () => { bar.remove(); ED.dirty = false; clearTimeout(ED.timer); await reloadBody(); setSaveState("最新を読み込みました"); };
    bar.querySelector("#cf-over").onclick = async () => {
      bar.remove(); const U = E.unit; const all = E.tops.map((b, k) => (k ? sepOf(E.tops[k - 1], b) : "") + ser(b, U)).join("");
      setSaveState("上書き中…");
      try { await call("update", { page_id: E.pageId, command: "replace_content", new_str: all, allow_async: false }, { read: false }); E.dirty = false; await reloadBody(); setSaveState("上書きしました"); }
      catch (e2) { setSaveState("上書きできませんでした", true); toast(/delet|削除/i.test(String(e2?.message || "")) ? "上書きすると子ページなどが消えるため止めました。Notion で直してください" : errText(e2)); }
    };
  }
  function setSaveState(t, err = false) { const el = document.getElementById("savestate"); if (el) { el.textContent = t; el.classList.toggle("err", err); } }
  document.addEventListener("input", (e) => { if (ED && ED.box.contains(e.target)) onEdInput(e); });
  document.addEventListener("keydown", (e) => { if (ED && ED.box.contains(e.target)) onEdKey(e); });
  document.addEventListener("paste", (e) => { if (ED && ED.box.contains(e.target)) onEdPaste(e); });
  document.addEventListener("selectionchange", () => showFmtBar());
  document.addEventListener("focusin", (e) => { for (const x of document.querySelectorAll(".blk.focus")) x.classList.remove("focus"); e.target.closest?.(".blk")?.classList.add("focus"); });
  document.addEventListener("mousedown", (e) => { const f = e.target.closest("[data-fmt]"); if (f) { e.preventDefault(); fmt(f.dataset.fmt); } const s = e.target.closest("[data-slash]"); if (s) { e.preventDefault(); applySlash(s.dataset.slash); } if (!e.target.closest(".menu, .hdl")) closeMenus(); });

