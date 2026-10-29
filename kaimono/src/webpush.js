// Web Push（VAPID＋aes128gcm の暗号化）を WebCrypto だけで送る。ライブラリは使わない。
// RFC 8291（メッセージの暗号化）・RFC 8292（VAPID）・RFC 8188（aes128gcm）

const enc = new TextEncoder();

export const b64u = {
  encode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// 受け取る端末の公開鍵（p256dh）と auth で、本文を1レコードの aes128gcm に包む
export async function encryptPayload(payload, p256dh, auth, { salt = crypto.getRandomValues(new Uint8Array(16)), local } = {}) {
  const uaPublic = b64u.decode(p256dh);
  const authSecret = b64u.decode(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("bad subscription keys");
  const pair = local || (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 2 = 最後のレコード
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// VAPID の署名（ES256 の JWT）。公開鍵は65バイトの非圧縮点、秘密鍵は32バイトの d（どちらも base64url）
export async function vapidAuth(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const pub = b64u.decode(publicKey);
  if (pub.length !== 65) throw new Error("bad VAPID public key");
  const jwk = { kty: "EC", crv: "P-256", x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33)), d: privateKey, ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u.encode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u.encode(sig)}, k=${publicKey}`;
}

// 1通送る。戻り値は通知サービスの HTTP ステータス（404・410 は購読が切れた印）
export async function sendPush(subscription, payload, vapid, { ttl = 12 * 3600, urgency = "normal" } = {}) {
  const body = await encryptPayload(JSON.stringify(payload), subscription.keys.p256dh, subscription.keys.auth);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  return res.status;
}
