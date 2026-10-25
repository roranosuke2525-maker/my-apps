// ホーム画面のアイコンの数字（バッジ）を、アプリを開いていないときにも更新するための Web Push。
// 鍵（VAPID）は初回に Worker が作って KV に置く。送るのは中身の無い通知だけで、
// 受け取ったサービスワーカーが /api/unread を読んで数字と通知の文面を決める。

const VAPID_KEY = "vapid";
const SUB_PREFIX = "sub:";
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
const TTL = 12 * 3600;

export function pushEnabled(env) {
  return !!env.NEWS_KV;
}

export async function publicKey(env) {
  return (await vapid(env)).publicKey;
}

export async function saveSubscription(env, sub, origin) {
  if (!pushEnabled(env)) throw pushError(400, "通知の保存先（KV）がありません");
  const endpoint = sub?.endpoint;
  if (!validEndpoint(endpoint)) throw pushError(400, "通知の宛先が正しくありません");
  const record = { endpoint, origin, savedAt: new Date().toISOString() };
  await env.NEWS_KV.put(SUB_PREFIX + (await hash(endpoint)), JSON.stringify(record));
}

export async function removeSubscription(env, endpoint) {
  if (!pushEnabled(env) || typeof endpoint !== "string") return;
  await env.NEWS_KV.delete(SUB_PREFIX + (await hash(endpoint)));
}

export async function sendToAll(env) {
  if (!pushEnabled(env)) return { sent: 0, failed: 0, enabled: false };
  const keys = await vapid(env);
  const list = await env.NEWS_KV.list({ prefix: SUB_PREFIX });
  let sent = 0;
  let failed = 0;
  for (const { name } of list.keys) {
    const record = JSON.parse((await env.NEWS_KV.get(name)) || "null");
    if (!record || !validEndpoint(record.endpoint)) {
      await env.NEWS_KV.delete(name);
      continue;
    }
    const res = await fetch(record.endpoint, {
      method: "POST",
      headers: {
        TTL: String(TTL),
        Urgency: "normal",
        Authorization: `vapid t=${await jwt(keys, record.endpoint, record.origin)}, k=${keys.publicKey}`,
        "Content-Length": "0",
      },
    }).catch(() => null);
    if (res && res.ok) sent++;
    else {
      failed++;
      // 宛先が無くなった（通知をオフにした・アプリを消した）ものは捨てる
      if (res && (res.status === 404 || res.status === 410)) await env.NEWS_KV.delete(name);
    }
  }
  return { sent, failed, enabled: true };
}

function validEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

async function vapid(env) {
  const saved = await env.NEWS_KV.get(VAPID_KEY);
  if (saved) {
    const { publicKey, jwk } = JSON.parse(saved);
    const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return { publicKey, privateKey };
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = b64url(raw);
  await env.NEWS_KV.put(VAPID_KEY, JSON.stringify({ publicKey, jwk }));
  return { publicKey, privateKey: pair.privateKey };
}

async function jwt(keys, endpoint, origin) {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + TTL, sub: origin || "mailto:news-reader@example.com" })),
  );
  const data = `${header}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

async function hash(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pushError(status, publicMessage) {
  return Object.assign(new Error(publicMessage), { status, publicMessage });
}
