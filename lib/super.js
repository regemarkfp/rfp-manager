'use strict';
// The superuser page (analytics.<website>, or /super): the website's health and every registered production company
// with its numbers. Only the superuser emails (config superUsers, env SUPER_USERS; info@regemarkfp.com by default)
// sign in here, with their own password (set from an emailed link) and their own cookie: it is not a Studio account.
// People: only the Admins of each company are named, and only once they accepted the terms (their email is shared
// with the superuser to contact them, and for occasional marketing email they can opt out of). Nobody else is named.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { sha, fail } = require('./util');
const { hashPassword, checkPassword, normEmail } = require('./auth');
const { parseCookies } = require('./http');

const TERMS_VERSION = 1;
const SESSION_H = 12;
const COOKIE = 'rfp_su';
const startedAt = Date.now();

function makeSuper(app) {
  const cfg = () => app.config;
  const users = () => {
    const c = cfg().superUsers;
    const list = Array.isArray(c) ? c : String(process.env.SUPER_USERS || '').split(/[,\s]+/);
    const out = list.map(normEmail).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    return out.length ? out : ['info@regemarkfp.com'];
  };
  const isSuper = (email) => users().includes(normEmail(email));
  const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
  const host = () => hostOf(cfg().superUrl) || (hostOf(cfg().publicUrl) ? 'analytics.' + hostOf(cfg().publicUrl).replace(/^www\./, '') : '');
  // links in the email: the analytics address when the request came through it, else the website's /super
  function base(req) {
    const h = String((req && req.headers.host) || '').toLowerCase().replace(/:\d+$/, '');
    if (cfg().superUrl) return String(cfg().superUrl).replace(/\/+$/, '');
    if (h && h === host()) return 'https://' + h;
    const pub = String(cfg().publicUrl || '').replace(/\/+$/, '');
    return pub ? pub + '/super' : '';
  }

  // ---- sign-in
  async function session(req) {
    const t = parseCookies(req)[COOKIE];
    if (!t) return null;
    const s = await app.store.kvGet('susess:' + sha(t));
    if (!s || s.exp < Date.now() || !isSuper(s.email)) return null;
    return s;
  }
  async function need(req) { const s = await session(req); if (!s) fail(401, 'Sign in first'); return s; }
  async function start(req, res, email) {
    const t = crypto.randomBytes(32).toString('base64url');
    await app.store.kvSet('susess:' + sha(t), { email, exp: Date.now() + SESSION_H * 3600e3 });
    const secure = req.headers['x-forwarded-proto'] === 'https' || (req.socket && req.socket.encrypted) ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${t}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_H * 3600}${secure}`);
  }
  async function login(req, res, { email, password } = {}) {
    email = normEmail(email);
    const rec = isSuper(email) ? await app.store.kvGet('super:' + email) : null;
    if (!rec || !rec.hash || !checkPassword(String(password || ''), rec.hash)) fail(401, 'That email and password do not match');
    await start(req, res, email);
    return { email };
  }
  async function logout(req, res) {
    const t = parseCookies(req)[COOKIE];
    if (t) await app.store.kvDel('susess:' + sha(t));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
    return { ok: true };
  }
  // "Set or reset password": a one-hour link, only ever emailed to a superuser address. The answer is the same for any
  // email, so the page does not tell who is a superuser.
  async function requestReset(req, { email } = {}) {
    email = normEmail(email);
    const msg = { ok: true, message: 'If that is a superuser email, a link to set the password is on its way. It works for one hour.' };
    if (!isSuper(email)) return msg;
    if (!app.mail || !app.mail.enabled()) fail(400, 'Email is not set up on this server, so the link cannot be sent');
    const t = crypto.randomBytes(32).toString('base64url');
    await app.store.kvSet('suset:' + sha(t), { email, exp: Date.now() + 3600e3 });
    await app.mail.send(email, { subject: 'Set your superuser password', title: 'Set your superuser password',
      lines: ['Someone (hopefully you) asked to set or reset the password of the superuser page. The link works once, for one hour.', 'If this was not you, ignore this email: nothing changes.'],
      button: { url: `${base(req)}?set=${t}`, label: 'Set the password' } });
    return msg;
  }
  async function setPassword(req, res, { token, password } = {}) {
    const key = 'suset:' + sha(String(token || ''));
    const s = await app.store.kvGet(key);
    if (!s || s.exp < Date.now() || !isSuper(s.email)) fail(400, 'This link has expired or was used already. Ask for a new one.');
    if (String(password || '').length < 10) fail(400, 'Use a password of at least 10 characters');
    await app.store.kvSet('super:' + s.email, { hash: hashPassword(String(password)), at: new Date().toISOString() });
    await app.store.kvDel(key);
    await start(req, res, s.email);
    return { email: s.email };
  }

  // ---- what the page shows
  async function health() {
    const out = { version: app.version, node: process.version, uptime: Math.round((Date.now() - startedAt) / 1000), host: os.hostname(),
      memory: { rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed, total: os.totalmem(), free: os.freemem() }, load: os.loadavg(), cpus: os.cpus().length };
    const t0 = Date.now();
    try { await app.store.kvGet('health:ping'); out.db = { ok: true, ms: Date.now() - t0 }; } catch (e) { out.db = { ok: false, error: e.message }; }
    try { const d = await fs.promises.statfs(app.dataDir ? app.dataDir() : '/'); out.disk = { total: d.blocks * d.bsize, free: d.bavail * d.bsize }; } catch { out.disk = null; }
    const safe = async (f) => { try { return await f(); } catch { return null; } };
    out.mail = !!(app.mail && app.mail.enabled());
    out.payments = await safe(async () => { const v = await app.pay.view(); return { on: !!v.on, sandbox: !!v.sandbox }; });
    out.whatsapp = await safe(async () => { const v = await app.whatsapp.view(); return { on: !!v.on }; });
    out.push = await safe(async () => { const v = await app.push.config(); return { on: !!(v.fcm || v.android), android: !!v.android, windows: v.windows || 0 }; });
    out.streaming = await safe(async () => {
      if (!app.streaming || !app.streaming.enabled()) return { on: false, live: 0, watching: 0 };
      let live = 0, watching = 0;
      for (const p of await app.streaming.allStreams()) { const s = app.streaming.status(p.data.streamSlug); if (s && s.live) { live++; watching += Number(app.analytics && app.analytics.watchingNow ? app.analytics.watchingNow(p.data.streamSlug) : 0) || 0; } }
      return { on: true, live, watching };
    });
    out.pcsOnline = app.relayServer && app.relayServer.machines ? app.relayServer.machines.size : 0;
    out.users = (await app.store.listType('user')).length;
    return out;
  }

  async function companies() {
    const since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const byTeam = new Map();
    const t = (id) => { let o = byTeam.get(id); if (!o) { o = { roles: {}, users: 0, admins: [], productions: 0, productions30: 0, matches: 0, bookings: 0, invoices: 0, clients: 0, viewers30: 0, watchHours30: 0 }; byTeam.set(id, o); } return o; };
    const userOf = new Map((await app.store.listType('user')).map((u) => [normEmail(u.data.email), u.data]));
    for (const m of await app.store.listType('member')) {
      const o = t(m.team), role = m.data.role || 'Crew';
      o.users++; o.roles[role] = (o.roles[role] || 0) + 1;
      if (role === 'Admin') {
        const u = userOf.get(normEmail(m.data.email)) || {};
        const ok = !!(u.superTerms && u.superTerms.version >= 1);
        o.admins.push(ok ? { name: u.name || m.data.name || '', email: normEmail(m.data.email), marketing: !u.marketingOptOut, acceptedAt: u.superTerms.at } : { hidden: true });
      }
    }
    const count = async (type, f) => { for (const d of await app.store.listType(type)) f(t(d.team), d.data); };
    await count('production', (o, d) => { o.productions++; if (String(d.date || '') >= since) o.productions30++; });
    await count('fixture', (o) => { o.matches++; });
    await count('booking', (o) => { o.bookings++; });
    await count('invoice', (o) => { o.invoices++; });
    await count('client', (o) => { o.clients++; });
    await count('viewstat', (o, d) => { if (String(d.day || '') >= since) { o.viewers30 += (d.viewers || []).length; o.watchHours30 += (Number(d.seconds) || 0) / 3600; } });
    const out = [];
    for (const org of await app.store.listType('org')) {
      const o = t(org.id);
      out.push({ id: org.id, name: org.data.name || '(no name)', created: org.data.createdAt || 0, plan: org.data.plan || '', ...o, watchHours30: Math.round(o.watchHours30 * 10) / 10 });
    }
    return out.sort((a, b) => b.users - a.users || a.name.localeCompare(b.name));
  }

  async function overview() { return { health: await health(), companies: await companies(), termsVersion: TERMS_VERSION }; }

  // the Admins who accepted and did not opt out of marketing email, as CSV
  async function contactsCsv() {
    const q = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
    const rows = [['Company', 'Name', 'Email', 'Marketing email']];
    for (const c of await companies()) for (const a of c.admins) if (!a.hidden) rows.push([c.name, a.name, a.email, a.marketing ? 'yes' : 'opted out']);
    return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  }

  return { users, isSuper, host, session, need, login, logout, requestReset, setPassword, health, companies, overview, contactsCsv, TERMS_VERSION };
}

module.exports = { makeSuper, TERMS_VERSION };
