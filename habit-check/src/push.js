// 朝のアラート（Web Push）。決めた時刻に、その習慣にまだチェックが入っていなければスマホへ通知する。
// 通知の中身は送らない（暗号化が要らない「空の通知」）。文言は画面側の sw.js が出す。
//   ・購読（どの端末へ送るか）は KV（PUSH）に覚える
//   ・VAPID の鍵：公開鍵は wrangler.toml の VAPID_PUBLIC_KEY、秘密鍵（JWK）は secret の VAPID_PRIVATE_JWK
//   ・時刻は wrangler.toml の [triggers] crons（UTC）で起こし、ここで JST の時刻と見くらべる

// 時刻（JST）と習慣（DB_習慣チェックの列名）。曜日を絞るときは days に 0(日)〜6(土)
export const ALERTS = [
  { at: "07:45", habit: "◆☼ 浴室乾燥のスイッチを入れる", tag: "bath-dryer" },
];
const WINDOW_MIN = 10; // cron が少し遅れても、この分数のうちなら送る
const SUB_PREFIX = "sub:";

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s) => new TextEncoder().encode(s);

// いまの JST の "HH:MM" と曜日
export function jstClock(now = new Date()) {
  const j = new Date(now.getTime() + 9 * 3600e3);
  return { hm: j.toISOString().slice(11, 16), dow: j.getUTCDay(), date: j.toISOString().slice(0, 10) };
}

// いま送るべきアラート（時刻から WINDOW_MIN 分以内）
export function dueAlerts(now = new Date(), alerts = ALERTS) {
  const { hm, dow } = jstClock(now);
  const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return alerts.filter((a) => {
    const d = mins(hm) - mins(a.at);
    return d >= 0 && d < WINDOW_MIN && (!a.days || a.days.includes(dow));
  });
}

// VAPID の署名（ES256 の JWT）
async function vapidAuth(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(utf8(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "https://habit-check.roranosuke2525.workers.dev",
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// 1つの端末へ送る。購読が切れていたら false（KV から消す合図）
export async function sendPush(sub, env) {
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: await vapidAuth(sub.endpoint, env), TTL: "3600", Urgency: "high", "Content-Length": "0" },
  });
  if (res.status === 404 || res.status === 410) return false;
  if (!res.ok) throw new Error(`push ${res.status}`);
  return true;
}

export function pushReady(env) {
  return !!(env.PUSH && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK);
}

// 購読を覚える（同じ端末は上書き）
export async function saveSubscription(env, sub) {
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint)) {
    const err = new Error("bad subscription");
    err.status = 400;
    err.publicMessage = "通知の登録に失敗しました";
    throw err;
  }
  const id = b64url(await crypto.subtle.digest("SHA-256", utf8(sub.endpoint))).slice(0, 32);
  await env.PUSH.put(SUB_PREFIX + id, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys || null, at: new Date().toISOString() }));
  return { ok: true };
}

// 覚えている端末すべてへ送る
export async function pushAll(env) {
  const list = await env.PUSH.list({ prefix: SUB_PREFIX });
  let sent = 0;
  for (const k of list.keys) {
    const sub = JSON.parse((await env.PUSH.get(k.name)) || "null");
    if (!sub) continue;
    try {
      if (await sendPush(sub, env)) sent++;
      else await env.PUSH.delete(k.name);
    } catch { /* 一時的な失敗は次の機会に */ }
  }
  return sent;
}

// cron から：いまの時刻のアラートを調べ、まだの習慣があれば通知。
// 何を通知したかは KV に「alert:<日付>」で覚え、画面（sw.js）が文言に使う。同じ日に二度は送らない
export async function runAlerts(env, { isDone, now = new Date() }) {
  if (!pushReady(env)) return [];
  const { date } = jstClock(now);
  const fired = [];
  for (const a of dueAlerts(now)) {
    const mark = `sent:${date}:${a.tag}`;
    if (await env.PUSH.get(mark)) continue;
    if (await isDone(a.habit, date)) continue;
    await env.PUSH.put(mark, "1", { expirationTtl: 3 * 86400 });
    await env.PUSH.put(`alert:${date}`, JSON.stringify({ habit: a.habit, at: a.at }), { expirationTtl: 3 * 86400 });
    await pushAll(env);
    fired.push(a.tag);
  }
  return fired;
}
