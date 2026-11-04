'use strict';
// Web Push for browsers (Chrome, Edge, Firefox; Safari on iPhone once the site is on the home screen), with no extra
// packages: VAPID (RFC 8292) to say who sends, and the message encrypted for the browser (RFC 8291, aes128gcm).
// The website makes its key pair once and keeps it (kv "push:vapid").
const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// the browser's subscription → the encrypted body (RFC 8291 §3, one record)
function encrypt(sub, payload, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPublic = unb64u(sub.keys && sub.keys.p256dh), authSecret = unb64u(sub.keys && sub.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Not a push subscription');
  const as = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) as.generateKeys();
  const asPublic = as.getPublicKey();
  const secret = as.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, secret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPublic.length;
  return Buffer.concat([head, asPublic, body]);
}
// the other side, for tests: what the browser does with its private key
function decrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
  const uaPublic = uaEcdh.getPublicKey(), secret = uaEcdh.computeSecret(asPublic);
  const prkKey = hmac(authSecret, secret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const out = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return out.subarray(0, out.lastIndexOf(2)).toString();
}

function makeWebPush(app, { fetcher } = {}) {
  let keys = null;
  async function vapid() {
    if (keys) return keys;
    let k = await app.store.kvGet('push:vapid').catch(() => null);
    if (!k || !k.d) {
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      k = privateKey.export({ format: 'jwk' });
      await app.store.kvSet('push:vapid', k);
    }
    keys = { jwk: k, key: crypto.createPrivateKey({ key: k, format: 'jwk' }), publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(k.x), unb64u(k.y)])) };
    return keys;
  }
  const publicKey = async () => (await vapid()).publicKey;
  async function jwt(endpoint) {
    const v = await vapid();
    const aud = new URL(endpoint).origin;
    const sub = app.config.publicUrl ? String(app.config.publicUrl).replace(/\/+$/, '') : 'mailto:noreply@example.com';
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })), claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: /^https:/.test(sub) ? sub : 'mailto:noreply@example.com' }));
    const sig = crypto.sign('sha256', Buffer.from(head + '.' + claims), { key: v.key, dsaEncoding: 'ieee-p1363' });
    return `${head}.${claims}.${b64u(sig)}`;
  }
  // → 'sent' | 'gone' (the browser unsubscribed: forget it) | 'failed'
  async function send(sub, message, { ttl = 3600, urgency = 'high' } = {}) {
    if (!sub || !/^https:\/\//.test(sub.endpoint || '')) return 'gone';
    const body = encrypt(sub, JSON.stringify(message));
    const r = await (fetcher || fetch)(sub.endpoint, { method: 'POST', body, headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency,
      Authorization: `vapid t=${await jwt(sub.endpoint)}, k=${await publicKey()}` } });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.status >= 200 && r.status < 300 ? 'sent' : 'failed';
  }
  return { publicKey, send, jwt };
}

module.exports = { makeWebPush, encrypt, decrypt, b64u, unb64u };
