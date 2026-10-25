// 記事ページのHTMLから本文の段落だけを抜き出す（リーダー表示用）。
// Workers と Node の両方で動くよう、DOM を使わず小さなタグ読み取りで処理する。

// 新聞社ごとの本文の場所。root に当たる要素の中の文字を段落として集める。
// split: その要素で段落を区切る／skip: その要素の中は読まない
export const SITES = [
  { host: "nikkei.com", root: (el) => el.tag === "p" && /\bparagraph_/.test(el.cls) },
  { host: "jiji.com", root: (el, up) => el.tag === "p" && up.some((a) => /\bArticleBlock\b/.test(a.cls)) },
  { host: "jomo-news.co.jp", root: (el, up) => el.tag === "p" && up.some((a) => /\barticle-body\b/.test(a.cls)) },
  {
    host: "tokyo-np.co.jp",
    root: (el, up) => el.tag === "div" && /(^|\s)block(\s|$)/.test(el.cls) && up.some((a) => a.id === "entry"),
    split: new Set(["br", "p"]),
    skip: (el) => /\b(hide|image|caption|cmp-[\w-]+)\b/.test(el.cls),
  },
];

const VOID = new Set(["br", "img", "meta", "link", "input", "hr", "source", "wbr", "area", "base", "col", "embed", "param", "track"]);
const RAW = new Set(["script", "style", "noscript", "template", "svg", "iframe"]);
const NOISE = /(会員登録|ログイン|この記事は会員限定|続きを読む|有料会員|無断転載|Copyright|記事をマイページ)/;
// 【図解】【時事ドットコム天気予報】のような、本文ではない短い案内の行
const LINK_LINE = /^【[^】]{1,30}】.{0,24}$/;
const MIN_GENERIC = 20;
const MAX_PARAS = 80;

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function siteFor(url) {
  const host = hostOf(url);
  return SITES.find((s) => host === s.host || host.endsWith("." + s.host)) || null;
}

export function extractArticle(html, url) {
  const meta = readMeta(html);
  const site = siteFor(url);
  let paragraphs = site ? collect(html, site) : [];
  if (paragraphs.length === 0) paragraphs = generic(html);
  paragraphs = paragraphs.filter((t) => !NOISE.test(t) && !LINK_LINE.test(t)).slice(0, MAX_PARAS);
  if (paragraphs.length === 0 && meta.description) paragraphs = [meta.description];
  return {
    title: cleanTitle(meta.title),
    image: safeUrl(meta.image, url),
    paragraphs,
  };
}

// ---------- 読み取り ----------
function* tokens(html) {
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      yield { text: m[4] };
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      yield { close: tag };
      continue;
    }
    const attrs = m[3] || "";
    const el = { tag, cls: attr(attrs, "class"), id: attr(attrs, "id"), attrs };
    if (RAW.has(tag) && !/\/\s*$/.test(attrs)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      re.lastIndex = end === -1 ? html.length : end;
      continue;
    }
    yield { open: el, selfClosing: VOID.has(tag) || /\/\s*$/.test(attrs) };
  }
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : "";
}

// root の中の文字を集める
function collect(html, site) {
  const out = [];
  const stack = [];
  let inRoot = 0;
  let skip = 0;
  let buf = "";
  const flush = () => {
    const t = tidy(buf);
    if (t) out.push(t);
    buf = "";
  };
  for (const tk of tokens(html)) {
    if (tk.open) {
      const el = tk.open;
      if (tk.selfClosing) {
        if (inRoot && !skip && site.split?.has(el.tag)) flush();
        continue;
      }
      el.isRoot = !inRoot && site.root(el, stack);
      el.isSkip = inRoot > 0 && !!site.skip?.(el);
      if (el.isRoot) {
        inRoot++;
        flush();
      } else if (inRoot && !skip && site.split?.has(el.tag)) flush();
      if (el.isSkip) skip++;
      stack.push(el);
    } else if (tk.close) {
      const i = stack.map((e) => e.tag).lastIndexOf(tk.close);
      if (i === -1) continue;
      for (const el of stack.splice(i)) {
        if (el.isSkip) skip--;
        if (el.isRoot) {
          inRoot--;
          flush();
        }
      }
      if (inRoot && !skip && site.split?.has(tk.close)) flush();
    } else if (inRoot && !skip) {
      buf += tk.text;
    }
  }
  flush();
  return out;
}

// サイトの決まりが無い・外れたとき：同じ親の下に並ぶ <p> のうち、文字数が一番多いまとまりを本文とみなす
function generic(html) {
  const groups = new Map();
  const stack = [];
  let p = null;
  for (const tk of tokens(html)) {
    if (tk.open) {
      if (tk.selfClosing) continue;
      if (tk.open.tag === "p" && !p) p = { key: stack.map((e) => `${e.tag}.${e.cls}#${e.id}`).join(">"), text: "" };
      stack.push(tk.open);
    } else if (tk.close) {
      const i = stack.map((e) => e.tag).lastIndexOf(tk.close);
      if (i === -1) continue;
      const closed = stack.splice(i);
      if (p && closed.some((e) => e.tag === "p")) {
        const t = tidy(p.text);
        if (t.length >= MIN_GENERIC) {
          const g = groups.get(p.key) || { len: 0, paras: [] };
          g.len += t.length;
          g.paras.push(t);
          groups.set(p.key, g);
        }
        p = null;
      }
    } else if (p) {
      p.text += tk.text;
    }
  }
  let best = null;
  for (const g of groups.values()) if (!best || g.len > best.len) best = g;
  return best ? best.paras : [];
}

function readMeta(html) {
  const head = html.slice(0, 200000);
  const meta = (key) => {
    const re = new RegExp(`<meta\\s[^>]*(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, "i");
    const tag = head.match(re);
    return tag ? attr(tag[0], "content") : "";
  };
  const title = meta("og:title") || decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  return { title, description: meta("og:description") || meta("description"), image: meta("og:image") };
}

function cleanTitle(t) {
  return tidy(t).replace(/\s*[|｜:：\-–]\s*(日本経済新聞|時事ドットコム|東京新聞デジタル|上毛新聞電子版.*|朝日新聞.*|読売新聞.*|毎日新聞.*)$/, "");
}

function safeUrl(u, base) {
  if (!u) return "";
  try {
    const x = new URL(u, base);
    return x.protocol === "https:" ? x.href : "";
  } catch {
    return "";
  }
}

function tidy(s) {
  return decode(s).replace(/[ \t\r\n ]+/g, " ").replace(/^[ 　]+|[ 　]+$/g, "");
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", yen: "¥", times: "×" };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
