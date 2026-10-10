'use strict';
const actor = require('./actor');
// Sign-in: Google (ID token checked against Google's public keys), or email + password for venues with no internet.
// Sessions are a random cookie; machine keys let a production PC sync with the online site.
const crypto = require('node:crypto');
const { sha, detId, fail, newId } = require('./util');
const { parseCookies } = require('./http');

const DAY = 86400000;
const b64 = (s) => Buffer.from(s, 'base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return 'scrypt$' + salt.toString('base64url') + '$' + crypto.scryptSync(String(pw), salt, 32).toString('base64url');
}
function checkPassword(pw, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 3 || p[0] !== 'scrypt') return false;
  const want = b64(p[2]);
  const got = crypto.scryptSync(String(pw), b64(p[1]), want.length);
  return crypto.timingSafeEqual(want, got);
}

const normEmail = (e) => String(e || '').trim().toLowerCase();
const userIdFor = (email) => detId('u_', normEmail(email));
const memberIdFor = (team, email) => detId('m_', team, normEmail(email));

function makeAuth(app) {
  const sessions = new Map();
  const teamCache = new Map();
  let certs = { at: 0, keys: [] };
  const attempts = new Map();

  app.on('doc', (doc) => { if (doc.type === 'member' || doc.type === 'org') teamCache.clear(); });

  async function googleCerts(force) {
    if (!force && certs.keys.length && Date.now() - certs.at < 3600000) return certs.keys;
    const url = app.config.google.certsUrl || 'https://www.googleapis.com/oauth2/v3/certs';
    const r = await fetch(url);
    if (!r.ok) fail(502, 'Could not reach Google to check the sign-in');
    certs = { at: Date.now(), keys: (await r.json()).keys || [] };
    return certs.keys;
  }

  async function verifyGoogle(credential) {
    const clientId = app.config.google.clientId || app.cloudGoogleClientId || '';
    if (!clientId) fail(400, 'Google sign-in is not set up on this server');
    const parts = String(credential || '').split('.');
    if (parts.length !== 3) fail(400, 'Bad Google credential');
    let header, payload;
    try { header = JSON.parse(b64(parts[0])); payload = JSON.parse(b64(parts[1])); } catch { fail(400, 'Bad Google credential'); }
    if (header.alg !== 'RS256') fail(400, 'Bad Google credential');
    let jwk = (await googleCerts(false)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await googleCerts(true)).find((k) => k.kid === header.kid);
    if (!jwk) fail(401, 'Google sign-in could not be verified');
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    if (!crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, b64(parts[2]))) fail(401, 'Google sign-in could not be verified');
    if (payload.aud !== clientId) fail(401, 'This Google sign-in was issued for a different app');
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) fail(401, 'Google sign-in could not be verified');
    if (!(payload.exp * 1000 > Date.now())) fail(401, 'Google sign-in has expired, try again');
    if (!payload.email || payload.email_verified === false) fail(401, 'Your Google email address is not verified');
    return { email: normEmail(payload.email), name: payload.name || payload.email, image: payload.picture || '', sub: payload.sub };
  }

  function throttle(ip) {
    const now = Date.now(), a = (attempts.get(ip) || []).filter((t) => now - t < 60000);
    if (a.length >= 10) fail(429, 'Too many attempts. Wait a minute and try again.');
    a.push(now); attempts.set(ip, a);
    if (attempts.size > 5000) attempts.clear();
  }

  async function startSession(req, res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const s = { userId, exp: Date.now() + 30 * DAY };
    sessions.set(sha(token), s);
    await app.store.kvSet('sess:' + sha(token), s);
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
    res.setHeader('Set-Cookie', `rfp_sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 86400}${secure}`);
  }

  async function endSession(req, res) {
    const token = parseCookies(req).rfp_sid;
    if (token) { sessions.delete(sha(token)); await app.store.kvDel('sess:' + sha(token)); }
    res.setHeader('Set-Cookie', 'rfp_sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  }

  async function userFromReq(req) {
    // through the website (remote access): the website checked the Google sign-in and the team; this PC trusts it only
    // with the relay's own secret, so nobody on the network can claim to be someone
    const via = app.relay && app.relay.identity ? app.relay.identity(req) : undefined;
    if (via !== undefined) {
      if (!via.email) return null;
      const u = await userByEmail(via.email);
      const w = actor.who(); if (u && w) { if (!w.name) w.name = u.data.name || u.data.email || ''; if (via.ip) w.ip = via.ip; w.via = w.via === 'RFP Manager' || !w.via ? 'Website' : w.via; }
      return u;
    }
    const token = parseCookies(req).rfp_sid;
    if (!token) return null;
    const h = sha(token);
    let s = sessions.get(h);
    if (!s) { s = await app.store.kvGet('sess:' + h); if (s) sessions.set(h, s); }
    if (!s || s.exp < Date.now()) return null;
    const u = await app.store.get(s.userId);
    const ok = u && !u.deleted && u.type === 'user' ? u : null;
    const w = actor.who(); if (ok && w && !w.name) w.name = ok.data.name || ok.data.email || '';    // the play log says who did it
    return ok;
  }

  async function userByEmail(email) {
    const u = await app.store.get(userIdFor(email));
    return u && !u.deleted ? u : null;
  }

  async function ensureUser({ email, name, image, sub, passwordHash }) {
    email = normEmail(email);
    const cur = await userByEmail(email);
    const data = { ...(cur ? cur.data : {}), email };
    if (name && !data.name) data.name = name;
    if (image && !data.image) data.image = image;
    if (sub) data.googleSub = sub;
    if (passwordHash) data.passwordHash = passwordHash;
    if (cur && JSON.stringify(cur.data) === JSON.stringify(data)) return cur;
    return app.save('', 'user', userIdFor(email), data, userIdFor(email));
  }

  // [{ id, role, org }] for every production team this person belongs to.
  async function teamsFor(user) {
    const email = normEmail(user.data.email);
    const hit = teamCache.get(email);
    if (hit && Date.now() - hit.at < 3000) return hit.list;
    const list = [];
    for (const m of await app.store.find('member', 'email', email)) {
      const org = await app.store.get(m.team);
      if (org && !org.deleted && org.type === 'org') list.push({ id: m.team, role: m.data.role || 'Crew', org: org.data });
    }
    list.sort((a, b) => String(a.org.name).localeCompare(String(b.org.name)));
    teamCache.set(email, { at: Date.now(), list });
    return list;
  }
  async function roleIn(user, team) {
    const t = (await teamsFor(user)).find((x) => x.id === team);
    return t ? t.role : null;
  }

  async function createKey(user, name) {
    const key = 'mk_' + crypto.randomBytes(24).toString('base64url');
    const doc = await app.save('', 'machinekey', newId('k_'), { userId: user.id, email: user.data.email, name: String(name || 'Production PC').slice(0, 60), hash: sha(key), createdAt: Date.now() }, user.id);
    return { key, id: doc.id };
  }
  async function keyUser(key) {
    if (!/^mk_[\w-]{20,}$/.test(key || '')) return null;
    const [k] = await app.store.find('machinekey', 'hash', sha(key));
    if (!k) return null;
    const u = await app.store.get(k.data.userId);
    return u && !u.deleted ? { user: u, keyDoc: k } : null;
  }
  const bearer = (req) => { const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || ''); return m ? m[1] : ''; };

  return { verifyGoogle, throttle, startSession, endSession, userFromReq, userByEmail, ensureUser, teamsFor, roleIn, createKey, keyUser, bearer };
}

module.exports = { makeAuth, hashPassword, checkPassword, normEmail, userIdFor, memberIdFor };
