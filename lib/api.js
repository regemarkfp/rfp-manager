'use strict';
// HTTP API + static files.
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');
const net = require('node:net');
const Schema = require('../shared/schema');
const { Router, readBody, readJson, send, serveStatic, clientIp } = require('./http');
const escHtml = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const Scoring = require('../shared/scoring');
// [page, open without sign-in (view-only, uses this machine's screen key)]
const SHORT = { '/scorer': ['scorer', false], '/stats': ['stats', false], '/graphics-control': ['/live/control.html', false], '/control': ['/live/control.html', false],
  '/confidence': ['/live/comms.html', true], '/commentary': ['/live/comms.html', true], '/rundown': ['/live/rundown.html', true], '/output': ['/live/output.html', true], '/preview': ['/live/preview.html', true],
  '/worship': ['/live/worship.html', false], '/stage': ['/live/stage.html', true],
  '/timeline': ['/live/timeline.html', false], '/dash': ['/live/dash.html', false], '/dashboard': ['/live/dash.html', false], '/crew': ['/live/timeline.html', true, { view: 'crew' }],
  '/key': ['/live/output.html', true, { mode: 'key' }], '/fill': ['/live/output.html', true, { mode: 'fill', bg: 'black' }], '/fill-key': ['/live/output.html', true, { mode: 'fillkey' }], '/fillkey': ['/live/output.html', true, { mode: 'fillkey' }],
  '/mcr': ['/live/mcr.html', true], '/adbreak': ['/live/mcr.html', true] };
const { newId, fail, log, sha } = require('./util');
const { hashPassword, checkPassword, normEmail, userIdFor, memberIdFor } = require('./auth');
const { MIME, EXT_MIME, fileNameFor, safeFile } = require('./blobs');
const { viewDoc } = require('./hub');
const { exportXml, importXml } = require('./xml');
const actor = require('./actor');

const MAX_IMAGE = 8 * 1024 * 1024;
const isPrivate = (ip) => {
  if (net.isIPv6(ip)) { const v = ip.toLowerCase(); return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') ? (v.startsWith('::ffff:') ? isPrivate(v.slice(7)) : true) : false; }
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
};
const isTailnet = (ip) => { const p = ip.split('.').map(Number); return p[0] === 100 && p[1] >= 64 && p[1] <= 127; };
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1';

function makeApi(app) {
  const r = new Router();
  const { auth } = app;
  const cfg = app.config;
  const qs = (req) => new URL(req.url, 'http://x').searchParams;
  const pubUser = (u) => ({ id: u.id, name: u.data.name || '', email: u.data.email, image: u.data.image || '', phone: u.data.phone || '', emailOff: !!u.data.emailOff, emailNoNew: !!u.data.emailNoNew,
    versePrefs: { on: true, translation: '', time: '00:00', ...(u.data.versePrefs || {}) }, hasPassword: !!u.data.passwordHash, google: !!u.data.googleSub,
    superTerms: u.data.superTerms || null, marketingOptOut: !!u.data.marketingOptOut });

  // ---- the production PC is a bridge: records are managed on the website
  const bridge = app.isLocal && !cfg.standalone;
  const site = () => String(cfg.cloud.url || cfg.defaultCloudUrl || '').replace(/\/+$/, '');
  function onlyOnline(what) {
    const e = new (require('./util').HttpError)(403, `${what} ${/s$/.test(what) ? 'are' : 'is'} managed on the website${site() ? ' (' + site().replace(/^https?:\/\//, '') + ')' : ''}. This PC is the CasparCG bridge: it shows them but does not change them.`);
    e.code = 'ONLINE_ONLY'; throw e;
  }
  const pcMayEdit = (type) => !bridge || Schema.PC_EDIT.includes(type);
  // a big file (a video) with byte ranges, so players can seek and phones can play it
  function sendFile(req, res, file, type) {
    let st0 = null;
    try { st0 = file ? fs.statSync(file) : null; } catch { st0 = null; }
    if (!st0 || !st0.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const size = st0.size, head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2])) {
      let a = m[1] ? Number(m[1]) : size - Number(m[2]), b = m[1] && m[2] ? Number(m[2]) : size - 1;
      a = Math.max(0, a); b = Math.min(size - 1, b);
      if (a > b || a >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start: a, end: b }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, 'Content-Length': size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const needUser = async (req) => (await auth.userFromReq(req)) || fail(401, 'Sign in first');
  async function needRole(req, team, test, msg) {
    const user = await needUser(req);
    if (!team) fail(400, 'No production team given');
    const role = await auth.roleIn(user, team);
    if (!role) fail(403, 'You are not in this production team');
    if (test && !test(role)) fail(403, msg || 'Your role does not allow this');
    return { user, role };
  }
  async function needMachineAdmin(req) {
    if (!app.isLocal) fail(400, 'Machine settings only exist on a production PC');
    const user = await needUser(req);
    if (!(await auth.teamsFor(user)).some((t) => t.role === 'Admin')) fail(403, 'Only an Admin can change this machine');
    return user;
  }
  const needsSetup = async () => app.isLocal && (await app.store.listType('user')).length === 0;
  async function needKey(req) {
    const k = await auth.keyUser(auth.bearer(req));
    if (!k) fail(401, 'Machine key not recognised');
    return k.user;
  }

  // ---- images ---------------------------------------------------------------------------------
  async function storeImage(team, buf, mime, name, kind, userId, sourceUrl, by) {
    const pdf = kind === 'receipt' && mime === 'application/pdf';
    if (!MIME[mime] && !pdf) fail(415, kind === 'receipt' ? 'Use a photo (JPG, PNG, WebP) or a PDF' : 'Use a PNG, JPG, WebP, GIF or SVG image');
    if (!buf.length) fail(400, 'The image is empty');
    if (buf.length > MAX_IMAGE) fail(413, 'Images can be up to 8 MB');
    const id = newId('img_');
    const clean = String(name || 'image').replace(/\.[A-Za-z0-9]{2,5}$/, '').slice(0, 80) || 'image';
    const doc = { id, team, type: 'image', data: { name: clean, file: pdf ? fileNameFor(id, clean, mime).replace(/\.bin$/, '.pdf') : fileNameFor(id, clean, mime), mime, size: buf.length, sha256: sha(buf), kind: String(kind || '').slice(0, 30), ...(sourceUrl ? { sourceUrl } : {}), ...(by ? { by } : {}) } };
    await app.blobs.put(doc, buf);
    return app.save(team, 'image', id, doc.data, userId);
  }

  async function fetchImage(team, url, name, userId) {
    let u;
    try { u = new URL(url); } catch { fail(400, 'That is not a web address'); }
    if (!['http:', 'https:'].includes(u.protocol)) fail(400, 'Only http and https addresses can be downloaded');
    if (!app.isLocal) {
      const addrs = await dns.promises.lookup(u.hostname, { all: true }).catch(() => fail(400, 'Could not find that address'));
      if (addrs.some((a) => isPrivate(a.address))) fail(400, 'That address is not allowed');
    }
    const res = await fetch(u, { redirect: app.isLocal ? 'follow' : 'error', signal: AbortSignal.timeout(20000) }).catch(() => fail(502, 'Could not download the image'));
    if (!res.ok) fail(502, 'Could not download the image (' + res.status + ')');
    if (Number(res.headers.get('content-length')) > MAX_IMAGE) fail(413, 'Images can be up to 8 MB');
    let mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!MIME[mime]) mime = EXT_MIME[path.extname(u.pathname).slice(1).toLowerCase().replace('jpeg', 'jpg')] || mime;
    const buf = Buffer.from(await res.arrayBuffer());
    const doc = await storeImage(team, buf, mime, name || path.basename(u.pathname) || 'image', '', userId, u.href);
    return doc.id;
  }
  app.fetchImage = fetchImage;

  // ---- config + sign-in -----------------------------------------------------------------------
  // the country code a phone number gets when it is typed with a 0 (Settings → Server → WhatsApp → country; South Africa)
  const dialOf = async () => { try { return String((app.whatsapp && (await app.whatsapp.conf()).country) || '27').replace(/\D/g, '') || '27'; } catch { return '27'; } };
  // the Android app is for the production team itself (Admins, Producers, Scorers, Crew), not for everyone
  const APP_ROLES = ['Admin', 'Producer', 'Scorer', 'Crew'];
  const apkThere = () => !app.isLocal && fs.existsSync(path.join(app.root, 'public', 'app', 'rfp-manager.apk'));
  const appAllowed = async (user) => !!user && (await auth.teamsFor(user)).some((t) => APP_ROLES.includes(t.role));
  const copyrightLine = async () => { if (app.isLocal) return ''; const l = (await app.store.kvGet('site:legal').catch(() => null)) || {}; const name = cfg.publicName || cfg.name || ''; return `© ${new Date().getFullYear()} ${l.company || cfg.legalName || (/^regemarkfp$/i.test(name) ? 'RegemarkFP (Pty) Ltd' : name)}. All rights reserved.`; };
  r.add('GET', '/api/config', async (req) => ({ copyright: await copyrightLine(), name: cfg.name, publicName: cfg.publicName || cfg.name, mode: cfg.mode, siteUrl: !app.isLocal && cfg.adminUrl ? String(cfg.publicUrl || '').replace(/\/+$/, '') : '', version: app.version, payments: !!(app.pay && app.pay.enabled()), googleClientId: cfg.google.clientId || app.cloudGoogleClientId || '',
    needsSetup: await needsSetup(), allowSignup: !!cfg.allowSignup, androidApp: apkThere() && (await appAllowed(await auth.userFromReq(req).catch(() => null))), bridge, pcEdit: bridge ? Schema.PC_EDIT : null, streaming: app.streaming.enabled(), mail: app.mail.enabled(), whatsapp: !app.isLocal && app.whatsapp ? await app.whatsapp.ready() : false, linked: !!(app.sync && app.sync.linked()), cloudUrl: app.isLocal ? cfg.cloud.url || cfg.defaultCloudUrl || '' : '', dial: await dialOf() }));

  // Google sign-in on the same page (no pop-up): Google posts the form here, then we go to the app.
  // For browsers and in-app browsers that block the sign-in window. Website only.
  r.add('POST', '/api/auth/google/redirect', async (req, res) => {
    if (app.isLocal) fail(404, 'Not on a production PC');
    auth.throttle(clientIp(req, true));
    const form = new URLSearchParams((await require('./http').readBody(req, 64 * 1024)).toString('utf8'));
    const cookie = /(?:^|;\s*)g_csrf_token=([^;]+)/.exec(req.headers.cookie || '');
    const back = (msg) => { res.writeHead(303, { Location: '/app' + (msg ? '?signin_error=' + encodeURIComponent(msg) : ''), 'Cache-Control': 'no-store' }); res.end(); };
    if (cookie && cookie[1] !== form.get('g_csrf_token')) return back('The sign-in could not be checked. Try again.');
    let g;
    try { g = await auth.verifyGoogle(form.get('credential') || ''); } catch (e) { return back(e.message); }
    const user = await auth.ensureUser({ email: g.email, name: g.name, image: g.image, sub: g.sub });
    await auth.startSession(req, res, user.id);
    back();
  });
  r.add('POST', '/api/auth/google', async (req, res) => {
    auth.throttle(clientIp(req, !app.isLocal));
    const credential = (await readJson(req)).credential;
    const g = await auth.verifyGoogle(credential);
    const known = async () => !!(await auth.userByEmail(g.email)) || (await app.store.find('member', 'email', g.email)).length > 0;
    if (app.isLocal && !cfg.allowSignup && !(await known())) {
      // not on this PC yet: a PC that is not linked links itself to the website as this person (an Admin there);
      // a linked PC asks the website for anything new first
      if (!app.sync.linked()) await linkWithGoogle(credential);
      else { await app.sync.run().catch(() => {}); if (!(await known())) await app.sync.run().catch(() => {}); }   // a sync already under way may have started before the person was added
      if (!(await known())) fail(403, `${g.email} is not in a production team that this PC syncs. Ask an Admin to add you on the website, then sign in again.`);
    }
    const user = await auth.ensureUser({ email: g.email, name: g.name, image: g.image, sub: g.sub });
    await auth.startSession(req, res, user.id);
    return { user: pubUser(user) };
  });

  r.add('POST', '/api/auth/login', async (req, res) => {
    auth.throttle(clientIp(req, !app.isLocal));
    const b = await readJson(req);
    const ok = async () => { const u = await auth.userByEmail(b.email); return u && u.data.passwordHash && checkPassword(String(b.password || ''), u.data.passwordHash) ? u : null; };
    let user = await ok();
    if (!user && bridge) {
      // the production PC: your website account is your sign-in. Not connected yet: connect as you; connected: fetch anything new (a new password, a new member)
      if (!app.sync.linked()) { await linkWithWebsite('/api/pair/password', { email: b.email, password: b.password }); user = await ok(); }
      else {
        let v = null;
        try { v = await app.sync.verify(b.email, b.password); } catch (e) { if (e.status === 401 || e.status === 403) fail(e.status, e.message); }   // offline: only what this PC knows
        if (v && v.user && v.user.id === userIdFor(v.user.data.email)) { await app.put({ ...v.user, updatedAt: Math.max(Date.now(), v.user.updatedAt || 0) }, { dirty: false }); await app.sync.run().catch(() => {}); user = await ok(); }
      }
    }
    if (!user) fail(401, 'Wrong email or password');
    await auth.startSession(req, res, user.id);
    return { user: pubUser(user) };
  });

  r.add('POST', '/api/auth/signup', async (req, res) => {
    auth.throttle(clientIp(req, !app.isLocal));
    if (bridge) fail(403, 'This PC works linked to the website. Sign in with Google, or link it to the website, to set it up.');
    if (!(await needsSetup()) && !cfg.allowSignup) fail(403, 'Ask an Admin to add you to a production team');
    const b = await readJson(req);
    const email = normEmail(b.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (String(b.password || '').length < 8) fail(400, 'Use a password of at least 8 characters');
    const cur = await auth.userByEmail(email);
    if (cur && (cur.data.passwordHash || cur.data.googleSub)) fail(409, 'That email already has an account');
    const user = await auth.ensureUser({ email, name: String(b.name || email).slice(0, 80), passwordHash: hashPassword(b.password) });
    await auth.startSession(req, res, user.id);
    return { user: pubUser(user) };
  });

  r.add('POST', '/api/auth/logout', async (req, res) => { await auth.endSession(req, res); return {}; });
  // ---- the Android app: Google sign-in happens in the phone's browser (Google does not allow it inside apps), then
  // the browser hands the app a one-time code for the same person: /api/auth/app-start → rfpmanager://signin?code=…
  // → the app opens /api/auth/app-claim?code=… in its own window, which signs in there.
  const appCodes = new Map();
  const safeNext = (n) => (/^\/(?!\/)[\w\-./?=&%#]*$/.test(String(n || '')) ? String(n) : '/app');
  r.add('GET', '/api/auth/app-start', async (req, res) => {
    if (app.isLocal) fail(404, 'Not here');
    const next = safeNext(qs(req).get('next'));
    const user = await auth.userFromReq(req).catch(() => null);
    if (!user) { res.writeHead(302, { Location: '/app?next=' + encodeURIComponent('/api/auth/app-start?next=' + encodeURIComponent(next)), 'Cache-Control': 'no-store' }); res.end(); return; }
    const code = require('node:crypto').randomBytes(24).toString('base64url');
    appCodes.set(code, { userId: user.id, exp: Date.now() + 2 * 60e3 });
    for (const [k, v] of appCodes) if (v.exp < Date.now()) appCodes.delete(k);
    const to = `rfpmanager://signin?code=${code}&next=${encodeURIComponent(next)}`;
    // a page as well as the redirect: some browsers want a tap to open an app
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Back to the app</title><body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh;text-align:center"><div><p>Signed in as ${String(user.data.email).replace(/[<>&"]/g, '')}.</p><p><a href="${to}" style="display:inline-block;padding:12px 22px;border-radius:24px;background:#00ff82;color:#000;font-weight:700;text-decoration:none">Back to RFP Manager</a></p></div><script>location.href=${JSON.stringify(to)}</script></body>`);
  });
  r.add('GET', '/api/auth/app-claim', async (req, res) => {
    if (app.isLocal) fail(404, 'Not here');
    const c = appCodes.get(String(qs(req).get('code') || ''));
    appCodes.delete(String(qs(req).get('code') || ''));
    if (!c || c.exp < Date.now()) { res.writeHead(302, { Location: '/app?signin_error=' + encodeURIComponent('That sign-in link has expired. Try again.') }); res.end(); return; }
    await auth.startSession(req, res, c.userId);
    res.writeHead(302, { Location: safeNext(qs(req).get('next')), 'Cache-Control': 'no-store' }); res.end();
  });

  // First run on a production PC: link it to the online site instead of creating a local account.
  r.add('POST', '/api/setup/link', async (req) => {
    if (!(await needsSetup())) fail(403, 'This machine is already set up. Use Settings > This machine.');
    const b = await readJson(req);
    await linkCloud(b.url, b.key);
    return { users: (await app.store.listType('user')).length, error: app.sync.status().lastError };
  });

  // The website gives a production PC its own key for the person signing in with Google (an Admin there).
  async function linkWithWebsite(route, body) {
    const sites = [...new Set([cfg.cloud.url, cfg.defaultCloudUrl, ...(cfg.fallbackCloudUrls || [])].map((u) => String(u || '').trim().replace(/\/+$/, '')).filter((u) => /^https?:\/\//.test(u)))];
    if (!sites.length) fail(400, 'This PC does not know the website address (Settings → This machine).');
    let lastErr = '';
    for (const url of sites) {
      let r, out = {};
      try {
        r = await fetch(url + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify({ ...body, name: cfg.machineName || require('node:os').hostname() }), signal: AbortSignal.timeout(90000) });
        out = await r.json().catch(() => ({}));
      } catch (e) { lastErr = `Could not reach ${url.replace(/^https?:\/\//, '')} (${e.cause && e.cause.code ? e.cause.code : e.message})`; continue; }
      if (r.status === 404 || r.status >= 500) { lastErr = `${url.replace(/^https?:\/\//, '')} answered ${r.status}`; continue; }
      if (!r.ok || !out.key) fail(r.status === 401 || r.status === 403 ? r.status : 502, out.error || `The website answered ${r.status}`);
      await linkCloud(url, out.key);
      log(`Connected to ${url} as ${out.email}`);
      return;
    }
    fail(502, (lastErr || 'Could not reach the website') + '. Check the internet connection and try again.');
  }
  const linkWithGoogle = (credential) => linkWithWebsite('/api/pair/google', { credential });

  // A production PC uses the website's Google sign-in: it asks the website for the client ID and keeps it.
  async function learnGoogle() {
    if (!app.isLocal || cfg.google.clientId) return;
    if (app.cloudGoogleClientId === undefined) app.cloudGoogleClientId = (await app.store.kvGet('cloud:googleClientId').catch(() => null)) || '';
    const url = String(cfg.cloud.url || cfg.defaultCloudUrl || '').replace(/\/+$/, '');
    if (!url || cfg.learnGoogle === false) return;
    try {
      const r = await fetch(url + '/api/config', { signal: AbortSignal.timeout(90000) });
      const id = r.ok ? String((await r.json()).googleClientId || '') : '';
      if (id && id !== app.cloudGoogleClientId) { app.cloudGoogleClientId = id; await app.store.kvSet('cloud:googleClientId', id); }
    } catch { /* offline: keep what we had */ }
  }
  app.learnGoogle = learnGoogle;
  if (app.isLocal) learnGoogle();

  async function linkCloud(url, key) {
    url = String(url || '').trim().replace(/\/+$/, '');
    key = String(key || '').trim();
    if (url && !/^https?:\/\/[^\s/]+/.test(url)) fail(400, 'The website address should start with https://');
    if (url && !/^mk_[\w-]{20,}$/.test(key)) fail(400, 'That does not look like a machine key (it starts with mk_)');
    const changed = url !== (cfg.cloud.url || '');
    cfg.cloud = { url, key: url ? key : '' };
    app.saveConfig();
    if (changed) { await app.store.kvSet('sync:pulled', 0); if (app.store.markAllDirty) await app.store.markAllDirty(); }
    app.sync.stop();
    app.sync.start();
    if (app.relay) { app.relay.stop(); app.relay.start(); }
    if (url) { await app.sync.run(); await app.sync.ensureMedia(); learnGoogle(); }
  }

  r.add('GET', '/api/me', async (req, res) => {
    const user = await needUser(req);
    const teams = (await auth.teamsFor(user)).map((t) => ({ id: t.id, role: t.role, name: t.org.name, accentColor: t.org.accentColor || '#00ff82', image: t.org.image || '' }));
    let machine = { mode: cfg.mode, name: cfg.machineName || '', admin: app.isLocal && teams.some((t) => t.role === 'Admin'), linked: !!(app.sync && app.sync.linked()),
      sync: app.sync ? app.sync.status() : null, outputKey: app.isLocal && teams.length ? cfg.outputKey : '', hostname: app.isLocal ? require('node:os').hostname() : '', port: cfg.port, shortLinks: cfg.shortLinks !== false, onAirFixture: app.gfx ? app.gfx.fixtureId || '' : '',
      remoteAccess: app.relay ? app.relay.status() : null, siteAdmin: !app.isLocal && (cfg.siteAdmins || []).map((e) => normEmail(e)).includes(normEmail(user.data.email)) };
    let pcs = null, pc = '';
    if (app.relayServer) {
      // the website: the production PCs of this person's teams that are online, and the one this browser uses
      pcs = await app.relayServer.list(user);
      const m = await app.relayServer.choose(req, user);
      pc = m ? m.id : '';
      if (m && !m.offline && (await app.relayServer.allowedFor(user, m))) {
        app.relayServer.remember(req, res, m);
        try {
          const r2 = await app.relayServer.request(m, { path: '/api/me', headers: { accept: 'application/json' }, user, ip: clientIp(req, true) });
          if (r2.status === 200) { const pm = JSON.parse(r2.body.toString('utf8')).machine || {}; machine = { ...machine, ...pm, mode: cfg.mode, siteAdmin: machine.siteAdmin, remote: { id: m.id, name: m.name, version: m.version } }; }
        } catch { /* the PC did not answer: the website's own view */ }
      }
    }
    return { user: pubUser(user), teams, machine, pcs, pc };
  });

  // ---- remote access through the website ---------------------------------------------------------
  if (app.relayServer) {
    const rs = app.relayServer;
    r.add('GET', '/api/pcs', async (req) => { const user = await needUser(req); const m = await rs.choose(req, user); return { pcs: await rs.list(user), pc: m ? m.id : '', choice: require('./http').parseCookies(req).rfp_pc || '' }; });
    r.add('POST', '/api/pcs/choose', async (req, res) => {
      const user = await needUser(req);
      const id = String((await readJson(req)).id || '');
      if (id && id !== 'none' && !(await rs.list(user)).some((p) => p.id === id)) fail(404, 'That production PC is not online for your teams');
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.setHeader('Set-Cookie', id ? `rfp_pc=${encodeURIComponent(id)}; Path=/; SameSite=Lax; Max-Age=31536000${secure}` : 'rfp_pc=; Path=/; SameSite=Lax; Max-Age=0');
      return { pc: id };
    });
    // linking a PC by signing in: the PC asks for a code, an Admin approves it here
    r.add('POST', '/api/pair/start', async (req) => { auth.throttle(clientIp(req, true)); const b = await readJson(req); const p = rs.pairStart(b.name); return { ...p, approveUrl: (cfg.adminUrl || cfg.publicUrl || '').replace(/\/+$/, '') + '/app#/link/' + p.code }; });
    r.add('POST', '/api/pair/google', async (req) => {
      // a production PC whose user signed in with Google there: that person (an Admin here) gives it its own key
      auth.throttle(clientIp(req, true));
      const b = await readJson(req);
      const g = await auth.verifyGoogle(b.credential);
      const user = await auth.userByEmail(g.email);
      if (!user || !(await auth.teamsFor(user)).some((t) => t.role === 'Admin')) fail(403, `${g.email} is not an Admin of a production team, so it cannot connect a production PC. Ask your team's Admin to sign in here the first time.`);
      await auth.ensureUser({ email: g.email, name: g.name, image: g.image, sub: g.sub });
      const k = await auth.createKey(user, String(b.name || 'Production PC').slice(0, 60));
      log(`Production PC "${String(b.name || '').slice(0, 60)}" linked by Google sign-in of ${g.email}`);
      return { key: k.key, email: g.email };
    });
    r.add('POST', '/api/pair/password', async (req) => {
      // a production PC where someone signed in with their website email and password
      auth.throttle(clientIp(req, true));
      const b = await readJson(req);
      const user = await auth.userByEmail(b.email);
      if (!user || !user.data.passwordHash || !checkPassword(String(b.password || ''), user.data.passwordHash)) {
        fail(401, user && !user.data.passwordHash ? 'This account signs in with Google. Use the Google button, or set a password on the website (Settings → My account).' : 'Wrong email or password');
      }
      if (!(await auth.teamsFor(user)).some((t) => t.role === 'Admin')) fail(403, `${user.data.email} is not an Admin of a production team, so it cannot connect a production PC. Ask your team's Admin to sign in here the first time.`);
      const k = await auth.createKey(user, String(b.name || 'Production PC').slice(0, 60));
      log(`Production PC "${String(b.name || '').slice(0, 60)}" connected by ${user.data.email} (email sign-in)`);
      return { key: k.key, email: user.data.email };
    });
    r.add('POST', '/api/pair/poll', async (req) => { const b = await readJson(req); return rs.pairPoll(b.code, b.secret); });
    r.add('GET', '/api/pair/:code', async (req, res, p) => { await needUser(req); return rs.pairInfo(p.code); });
    r.add('POST', '/api/pair/:code/approve', async (req, res, p) => rs.pairApprove(await needUser(req), p.code));
  }

  // ---- live streaming: channels, the MediaMTX check, the watch page ----------------------------------
  const st = app.streaming;
  r.add('POST', '/api/stream/auth', async (req, res) => {
    // MediaMTX on the same server asks: may this camera publish, may this viewer watch?
    const secret = cfg.streaming && cfg.streaming.hookSecret;
    if (!secret || qs(req).get('s') !== secret) { send(res, 403, { error: 'Not allowed' }); return; }
    const ok = await st.allow(await readJson(req)).catch(() => false);
    send(res, ok ? 200 : 401, ok ? { ok: true } : { error: 'Not allowed' });
  });
  // a production team's streams: one per production that streams on a channel
  r.add('GET', '/api/streams', async (req) => {
    const team = qs(req).get('team');
    const { role } = await needRole(req, team, Schema.CAN.read);
    const mcrs = new Map((await app.store.list(team, 'mcr')).filter((d) => !d.deleted).map((d) => [d.data.slug, d.data]));
    const now = Date.now();
    const list = (await st.allStreams(team)).filter((d) => d.data.streamChannel && d.data.streamSlug)
      .map((d) => ({ id: d.id, slug: d.data.streamSlug, parent: d.parentId || '', fixture: d.fixtureId || '', title: d.data.streamTitle || d.data.name || '', perMatch: !!d.data.streamPerMatch, channel: d.data.streamChannel,
        mcr: mcrSummary(mcrs.get(d.data.streamSlug), now), restream: app.restream ? app.restream.status(d) : [], ...st.status(d.data.streamSlug), viewers: Math.max(st.status(d.data.streamSlug).viewers || 0, app.analytics.watchingNow(d.data.streamSlug)), videos: st.videosOf(d.data.streamSlug).length, closed: !!d.data.streamClosed, endedAt: d.data.streamEndedAt || '', audioTracks: (d.data.streamAudio || []).length, ingest: Schema.CAN.edit(role) ? st.ingest(d) : null }));
    return { enabled: st.enabled(), base: (cfg.publicUrl || '').replace(/\/+$/, ''), health: st.health(), list };
  });
  // what master control is doing on a stream, in short (the Live streams page, the countdowns)
  function mcrSummary(x, now = Date.now()) {
    if (!x) return null;
    const slate = x.slate && (!x.slate.until || Date.parse(x.slate.until) > now) ? { kind: x.slate.kind, title: x.slate.title, until: x.slate.until || '', since: x.slate.since } : null;
    let ad = null;
    if (x.ad && Date.parse(x.ad.endsAt) > now) {
      let t = Date.parse(x.ad.startedAt), cur = null, idx = 0;
      for (const [i, it] of x.ad.items.entries()) { if (now < t + it.duration * 1000) { cur = it; idx = i; break; } t += it.duration * 1000; }
      ad = { startedAt: x.ad.startedAt, endsAt: x.ad.endsAt, count: x.ad.items.length, index: idx, title: cur ? cur.title : '', itemEndsAt: cur ? new Date(t + cur.duration * 1000).toISOString() : x.ad.endsAt };
    }
    const squeeze = x.squeeze && Date.parse(x.squeeze.endsAt) > now ? { startedAt: x.squeeze.startedAt, endsAt: x.squeeze.endsAt, count: x.squeeze.items.length, board: !!x.squeeze.image } : null;
    const overlays = (x.overlays || []).filter((o) => o.on).map((o) => o.kind);
    const next = (x.cues || []).find((c) => Date.parse(c.at) > now) || null;
    return slate || ad || squeeze || overlays.length || next ? { slate, ad, squeeze, overlays, next: next ? { at: next.at, do: next.do, kind: next.kind } : null } : null;
  }
  // match videos inside a production's stream: list, and set start / end by hand
  r.add('GET', '/api/productions/:id/clips', async (req, res, p) => {
    const team = qs(req).get('team');
    await needRole(req, team, Schema.CAN.read);
    const prod = await app.store.get(p.id);
    if (!prod || prod.deleted || prod.team !== team || prod.type !== 'production') fail(404, 'Production not found');
    const clips = await app.clips.clipsOf(prod.id);
    const vids = app.clips.videos(clips, st.videosOf(prod.data.streamSlug || ''), st.status(prod.data.streamSlug || '').live);
    return { clips: clips.map((c) => ({ id: c.id, ...c.data, video: vids.find((v) => v.fixture === c.data.fixture) || null })) };
  });
  r.add('POST', '/api/productions/:id/clips', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to mark matches in the stream');
    if (app.isLocal) fail(400, 'Matches are marked in the stream on the website');
    const prod = await app.store.get(p.id);
    if (!prod || prod.deleted || prod.team !== team || prod.type !== 'production') fail(404, 'Production not found');
    const b = await readJson(req);
    const doc = await app.clips.set(prod, String(b.fixture || ''), { start: b.start, end: b.end, clear: !!b.clear }, user.id);
    return { clip: doc ? { id: doc.id, ...doc.data } : null };
  });
  // call sheets: the PDF, who can get it, and emailing it (body + PDF attached) to the crew
  async function prodFor(req, p, test, msg) {
    const team = qs(req).get('team');
    const { user, role } = await needRole(req, team, test, msg);
    const prod = await app.store.get(p.id);
    if (!prod || prod.deleted || prod.team !== team || prod.type !== 'production') fail(404, 'Production not found');
    return { user, role, prod };
  }
  r.add('GET', '/api/productions/:id/callsheet.pdf', async (req, res, p) => {
    const { prod } = await prodFor(req, p, Schema.CAN.read);
    const cs = await app.callsheet.build(prod);
    const name = app.callsheet.fileName(cs);
    send(res, 200, app.callsheet.pdf(cs), { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${qs(req).get('download') ? 'attachment' : 'inline'}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}` });
  });
  // ---- quotes and invoices (lib/invoices.js)
  const pdfOut = (req, res, f) => send(res, 200, f.buf, { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': `${qs(req).get('download') ? 'attachment' : 'inline'}; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"` });
  const who = (user) => user.data.name || user.data.email;
  const money2 = async (req, admin) => { const team = qs(req).get('team'); const r0 = await needRole(req, team, admin ? Schema.CAN.admin : Schema.CAN.edit, admin ? 'Admins do this' : 'Producers and Admins see quotes and invoices'); if (bridge) onlyOnline('Quotes and invoices'); return { team, user: r0.user }; };
  // a production's own quotes and invoices, and making one from its costing
  r.add('GET', '/api/productions/:id/invoices', async (req, res, p) => { const { prod } = await prodFor(req, p, Schema.CAN.edit, 'Producers and Admins see quotes and invoices'); return { list: await app.invoices.forProduction(prod), billing: await app.invoices.billing(prod.team), lines: await app.invoices.linesOf(prod) }; });
  r.add('POST', '/api/productions/:id/invoices', async (req, res, p) => { const { prod, user } = await prodFor(req, p, Schema.CAN.edit, 'Producers and Admins make quotes and invoices'); const b = await readJson(req); return { doc: await app.invoices.create(prod.team, { kind: String(b.kind || 'invoice'), production: prod.id }, who(user)) }; });
  // all of them: list, make, change, PDF, email, convert, copy, payments
  r.add('GET', '/api/invoices', async (req) => { const { team } = await money2(req); return app.invoices.overview(team); });
  r.add('GET', '/api/invoices/list', async (req) => { const { team } = await money2(req); const q = qs(req); return { list: await app.invoices.list(team, { client: q.get('client') || '', production: q.get('production') || '', kind: q.get('kind') || '' }) }; });
  r.add('POST', '/api/invoices', async (req) => { const { team, user } = await money2(req); const b = await readJson(req); return { doc: await app.invoices.create(team, { kind: String(b.kind || ''), client: b.client || '', production: b.production || '', booking: b.booking || '', title: b.title || '', lines: b.lines }, who(user)) }; });
  // many at once: an action on each, their PDFs in one ZIP, a spreadsheet
  r.add('POST', '/api/invoices/bulk', async (req) => { const { team, user } = await money2(req); const b = await readJson(req, 65536); return app.invoices.bulk(team, b.ids, String(b.action || ''), b, who(user), user.id); });
  const idsOf = (req) => String(qs(req).get('ids') || '').split(',').map((x) => x.trim()).filter((x) => /^[\w-]{3,80}$/.test(x));
  r.add('GET', '/api/invoices/bulk.zip', async (req, res) => { const { team } = await money2(req); const f = await app.invoices.pdfZip(team, idsOf(req)); send(res, 200, f.buf, { 'Content-Type': 'application/zip', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${f.name}"` }); });
  r.add('GET', '/api/invoices/export.csv', async (req, res) => { const { team } = await money2(req); const f = await app.invoices.csv(team, idsOf(req)); send(res, 200, f.buf, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${f.name}"` }); });
  r.add('GET', '/api/invoices/:id', async (req, res, p) => { const { team } = await money2(req); return { doc: await app.invoices.one(team, p.id) }; });
  r.add('PUT', '/api/invoices/:id', async (req, res, p) => { const { team, user } = await money2(req); return { doc: await app.invoices.update(team, p.id, await readJson(req, 512 * 1024), who(user)) }; });
  r.add('DELETE', '/api/invoices/:id', async (req, res, p) => { const { team, user } = await money2(req); return app.invoices.remove(team, p.id, user.id); });
  r.add('GET', '/api/invoices/:id/pdf', async (req, res, p) => { const { team } = await money2(req); pdfOut(req, res, await app.invoices.pdf(team, p.id)); });
  r.add('GET', '/api/invoices/:id/contract.pdf', async (req, res, p) => { const { team } = await money2(req); pdfOut(req, res, await app.invoices.contractPdf(team, p.id)); });
  r.add('POST', '/api/invoices/:id/send', async (req, res, p) => { const { team, user } = await money2(req); const b = await readJson(req); return app.invoices.send(team, p.id, { to: b.to, note: b.note, cc: b.cc }, who(user)); });
  r.add('POST', '/api/invoices/:id/convert', async (req, res, p) => { const { team, user } = await money2(req); return { doc: await app.invoices.convert(team, p.id, who(user)) }; });
  r.add('POST', '/api/invoices/:id/duplicate', async (req, res, p) => { const { team, user } = await money2(req); const b = await readJson(req); return { doc: await app.invoices.duplicate(team, p.id, b.kind, who(user)) }; });
  r.add('POST', '/api/invoices/:id/payments', async (req, res, p) => { const { team, user } = await money2(req); return { doc: await app.invoices.addPayment(team, p.id, await readJson(req), who(user)) }; });
  r.add('DELETE', '/api/invoices/:id/payments/:i', async (req, res, p) => { const { team } = await money2(req); return { doc: await app.invoices.removePayment(team, p.id, Number(p.i)) }; });
  r.add('GET', '/api/billing', async (req) => { const team = qs(req).get('team'); await needRole(req, team, Schema.CAN.edit); return { ...(await app.invoices.billing(team)), ...(await app.invoices.nextNumbers(team)) }; });
  r.add('PUT', '/api/billing', async (req) => { const team = qs(req).get('team'); await needRole(req, team, Schema.CAN.admin, 'Admins set the billing details'); return app.invoices.setBilling(team, await readJson(req, 128 * 1024)); });
  // Invoice Ninja: clients, products, quotes, invoices and payments copied in (lib/ninja.js); the token is used once, not kept
  r.add('POST', '/api/invoices/import/invoiceninja', async (req) => { const { team, user } = await money2(req, true); const b = await readJson(req); return app.ninja.start(team, { url: b.url, token: b.token, pdfs: b.pdfs !== false }, who(user)); });
  r.add('GET', '/api/invoices/import/invoiceninja', async (req) => { const { team } = await money2(req, true); return app.ninja.status(team); });
  // a client's portal, from the team's side: who is on it, invite someone, take someone off
  const clientFor = async (req, p) => { const { team, user } = await money2(req); const c = await app.store.get(p.id); if (!c || c.deleted || c.team !== team || c.type !== 'client') fail(404, 'No such client'); return { team, user, c }; };
  r.add('GET', '/api/clients/:id/portal', async (req, res, p) => { const { c } = await clientFor(req, p); return { users: (c.data.portalUsers || []).map((u) => ({ email: u.email, name: u.name || '', at: u.at, url: `${String(cfg.publicUrl || '').replace(/\/+$/, '')}/portal/${u.key}` })) }; });
  r.add('POST', '/api/clients/:id/portal', async (req, res, p) => { const { c, user } = await clientFor(req, p); const b = await readJson(req); const u = await app.portal.invite(c, b.email, b.name, who(user)); return { email: u.email }; });
  r.add('DELETE', '/api/clients/:id/portal/:email', async (req, res, p) => { const { c } = await clientFor(req, p); return app.portal.removeByTeam(c, decodeURIComponent(p.email)); });
  // ---- invitations: /join/<token> from the "You have been invited" email: set a password (or use Google) and go in
  const joinPage = (inner) => `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(cfg.publicName || cfg.name || 'RFP Manager')}: join</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px}main{max-width:400px;width:100%}h1{font-size:22px}label{display:block;margin:12px 0 4px;color:#bbb;font-size:14px}input{box-sizing:border-box;width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#1c1c1c;color:#eee;font-size:16px}button,.btn{display:inline-block;margin-top:16px;padding:11px 20px;border-radius:22px;border:0;background:#00c766;color:#fff;font-weight:700;font-size:15px;text-decoration:none;cursor:pointer}.alt{background:#3a3a3a}.err{background:#4a1d1d;color:#ffc9c9;padding:10px;border-radius:6px}.dim{color:#999;font-size:14px}</style><body><main>${inner}</main></body>`;
  const joinForm = (token, v, err) => joinPage(`<h1>Join ${escHtml(v.teamName)}</h1><p>You are invited as <b>${escHtml(v.role)}</b> with <b>${escHtml(v.email)}</b>.</p>${err ? `<p class="err">${escHtml(err)}</p>` : ''}
<form method="post" action="/join/${escHtml(token)}"><label>Your name</label><input name="name" required maxlength="80" autocomplete="name" value="${escHtml(v.name)}"><label>Choose a password (8+ characters)</label><input name="password" type="password" required minlength="8" autocomplete="new-password"><label>Password again</label><input name="password2" type="password" required minlength="8" autocomplete="new-password"><button type="submit">Join and sign in</button></form>
<p class="dim" style="margin-top:22px">Or use Google with ${escHtml(v.email)}:</p><a class="btn alt" href="/app">Sign in with Google</a>`);
  const htmlOut = (res, status, html, extra) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(extra || {}) }); res.end(html); };
  r.add('GET', '/join/:token', async (req, res, p) => {
    let v;
    try { v = await app.invites.peek(p.token); } catch (e) { return htmlOut(res, 200, joinPage(`<h1>Hmm</h1><p>${escHtml(e.message)}</p><a class="btn alt" href="/app">Sign in</a>`)); }
    if (v.hasPassword) return htmlOut(res, 200, joinPage(`<h1>You are in ${escHtml(v.teamName)}</h1><p>You already have a password for ${escHtml(v.email)}. Sign in with it to open the team.</p><a class="btn" href="/app">Sign in</a>`));
    htmlOut(res, 200, joinForm(p.token, v));
  });
  r.add('POST', '/join/:token', async (req, res, p) => {
    auth.throttle(clientIp(req, !app.isLocal));
    const f = new URLSearchParams((await readBody(req, 16 * 1024)).toString('utf8'));
    let v;
    try { v = await app.invites.peek(p.token); } catch (e) { return htmlOut(res, 200, joinPage(`<h1>Hmm</h1><p>${escHtml(e.message)}</p>`)); }
    try {
      if (f.get('password') !== f.get('password2')) fail(400, 'The two passwords are not the same');
      const a = await app.invites.accept(p.token, { name: f.get('name'), password: f.get('password') });
      await auth.startSession(req, res, a.user.id);
      app.notify.memberJoined(a.team, a.member, a.user);
      res.writeHead(303, { Location: '/app', 'Cache-Control': 'no-store' }); res.end();
    } catch (e) { htmlOut(res, 200, joinForm(p.token, { ...v, name: f.get('name') || v.name }, e.message)); }
  });

  // ---- crew: answers from the email, clashes, their own days off
  r.add('GET', '/r/:token', async (req, res, p) => {
    let html;
    try { const a = await app.crewtools.respond(p.token); html = `<h1>${a.yes ? '✓ Thanks, you’re in' : 'Thanks for letting us know'}</h1><p>${a.yes ? 'You are confirmed for' : 'You are marked as not available for'} <b>${escHtml(a.production)}</b>${a.date ? ' on ' + escHtml(a.date) : ''}. The producer has been told.</p>`; }
    catch (e) { html = `<h1>Hmm</h1><p>${escHtml(e.message)}</p>`; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(cfg.publicName || cfg.name || 'RFP Manager')}</title><body style="font-family:Segoe UI,Arial,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px;text-align:center"><div style="max-width:440px">${html}</div></body>`);
  });
  r.add('GET', '/api/productions/:id/clashes', async (req, res, p) => { const { prod } = await prodFor(req, p, Schema.CAN.edit); return { list: await app.crewtools.clashes(prod) }; });
  r.add('GET', '/api/me/availability', async (req) => { const user = await needUser(req), team = qs(req).get('team'); await needRole(req, team, Schema.CAN.read); const m = await app.crewtools.memberFor(user, team); return { onCrew: !!m, list: (m && m.data.unavailable) || [] }; });
  r.add('PUT', '/api/me/availability', async (req) => { const user = await needUser(req), team = qs(req).get('team'); await needRole(req, team, Schema.CAN.read); return { list: await app.crewtools.setUnavailable(user, team, (await readJson(req)).list) }; });
  // ---- the client page (/client/<key>): a private link per production
  r.add('POST', '/api/productions/:id/client-link', async (req, res, p) => { const { prod } = await prodFor(req, p, Schema.CAN.edit, 'Producers and Admins share the client page'); const key = await app.crewtools.clientKey(prod); return { key, url: `${String(cfg.publicUrl || '').replace(/\/+$/, '')}/client/${key}` }; });
  r.add('DELETE', '/api/productions/:id/client-link', async (req, res, p) => { const { prod } = await prodFor(req, p, Schema.CAN.edit); const cur = (await app.store.get(prod.id)).data; delete cur.clientKey; await app.save(prod.team, 'production', prod.id, cur, ''); return { ok: true }; });
  r.add('GET', '/api/client/:key', async (req, res, p) => app.crewtools.clientView(p.key));
  r.add('GET', '/api/client/:key/callsheet.pdf', async (req, res, p) => { const prod = await app.crewtools.byKey(p.key); const cs = await app.callsheet.build(prod); pdfOut(req, res, { buf: app.callsheet.pdf(cs), name: app.callsheet.fileName(cs) }); });
  r.add('GET', '/api/client/:key/report.pdf', async (req, res, p) => { const prod = await app.crewtools.byKey(p.key); if (prod.data.status !== 'Completed') fail(404, 'The report comes after the production'); const rep = await app.prodreport.build(prod); rep.costs = null; pdfOut(req, res, { buf: app.prodreport.pdf(rep), name: app.prodreport.fileName(rep) + '.pdf' }); });
  r.add('GET', '/api/client/:key/doc/:num.pdf', async (req, res, p) => { const prod = await app.crewtools.byKey(p.key); const x = (await app.invoices.forProduction(prod)).find((y) => y.number === p.num); if (!x || x.status === 'Draft') fail(404, 'Not found'); pdfOut(req, res, await app.invoices.pdf(prod.team, x.id)); });
  // ---- sponsors: proof of play per month
  r.add('GET', '/api/sponsors', async (req) => { const q = qs(req), team = q.get('team'); await needRole(req, team, Schema.CAN.edit); return { list: await app.crewtools.sponsorReport(team, q.get('month')) }; });
  r.add('GET', '/api/sponsors/report.pdf', async (req, res) => { const q = qs(req), team = q.get('team'); await needRole(req, team, Schema.CAN.edit); pdfOut(req, res, await app.crewtools.sponsorPdf(team, q.get('month'), q.get('sponsor') || '')); });
  r.add('POST', '/api/sponsors/send', async (req) => { const team = qs(req).get('team'); await needRole(req, team, Schema.CAN.edit); const b = await readJson(req); return app.crewtools.sendSponsor(team, String(b.month || ''), String(b.sponsor || ''), b.to); });
  // ---- fans: predictions and player of the match, player profiles, sermons, calendar
  r.add('GET', '/api/public/match/:id/fans', async (req, res, p) => app.fanzone.fans(p.id, await auth.userFromReq(req).catch(() => null)));
  r.add('POST', '/api/public/match/:id/fans', async (req, res, p) => { const user = await needUser(req); const b = await readJson(req); return app.fanzone.vote(p.id, user, { predict: b.predict, potm: b.potm }); });
  r.add('GET', '/api/public/player/:id', async (req, res, p) => app.fanzone.player(p.id));
  r.add('GET', '/api/public/c/:slug/sermons', async (req, res, p) => app.fanzone.sermons(p.slug, { q: qs(req).get('q') || '' }));
  r.add('GET', '/api/public/ical-link', async (req) => { const user = await needUser(req); const key = await app.follows.icalKey(user); const base = String(cfg.publicUrl || '').replace(/\/+$/, '') || `https://${req.headers.host}`; return { url: `${base}/ical/${key}.ics`, webcal: `${base.replace(/^https?:/, 'webcal:')}/ical/${key}.ics` }; });
  r.add('GET', '/ical/:file', async (req, res, p) => {
    const ics = await app.follows.ical(String(p.file).replace(/\.ics$/, ''), await publicMatches());
    if (!ics) fail(404, 'Not found');
    send(res, 200, ics, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900' });
  });

  // ---- post-production: the report, the music cue sheet and rights holders' reports ----
  const disp = (req, name, ext) => `${qs(req).get('download') ? 'attachment' : 'inline'}; filename="${(name + ext).replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name + ext)}`;
  r.add('GET', '/api/productions/:id/report', async (req, res, p) => { const { prod } = await prodFor(req, p, Schema.CAN.read); return app.prodreport.build(prod); });
  r.add('GET', '/api/productions/:id/report.pdf', async (req, res, p) => {
    const { prod } = await prodFor(req, p, Schema.CAN.read);
    const rep = await app.prodreport.build(prod);
    send(res, 200, app.prodreport.pdf(rep), { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': disp(req, app.prodreport.fileName(rep), '.pdf') });
  });
  const LAYOUTS = ['samro', 'broadcaster', 'rights'];
  r.add('GET', '/api/productions/:id/cuesheet', async (req, res, p) => { const { prod } = await prodFor(req, p, Schema.CAN.read); return app.music.cueSheet(prod); });
  r.add('GET', '/api/productions/:id/cuesheet.pdf', async (req, res, p) => {
    const { prod } = await prodFor(req, p, Schema.CAN.read);
    const cs = await app.music.cueSheet(prod), layout = LAYOUTS.includes(qs(req).get('layout')) ? qs(req).get('layout') : 'samro';
    send(res, 200, app.music.cuePdf(cs, layout), { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Disposition': disp(req, app.prodreport.fileName({ name: cs.programme, date: cs.date }, 'Music cue sheet'), '.pdf') });
  });
  r.add('GET', '/api/productions/:id/cuesheet.csv', async (req, res, p) => {
    const { prod } = await prodFor(req, p, Schema.CAN.read);
    const cs = await app.music.cueSheet(prod), layout = qs(req).get('layout') === 'broadcaster' ? 'broadcaster' : 'samro';
    send(res, 200, app.music.cueCsv(cs, layout), { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': disp(req, app.prodreport.fileName({ name: cs.programme, date: cs.date }, 'Music cue sheet'), '.csv').replace(/^inline/, 'attachment') });
  });
  // a rights holder's report (composer, publisher, library): every use over a period
  r.add('GET', '/api/music/rights-report', async (req) => {
    const q = qs(req), team = q.get('team');
    await needRole(req, team, Schema.CAN.edit, 'You need the Producer role for rights reports');
    return { rows: await app.music.rightsReport(team, { who: q.get('who') || '', from: q.get('from') || '', to: q.get('to') || '' }) };
  });
  r.add('GET', '/api/music/rights-report.csv', async (req, res) => {
    const q = qs(req), team = q.get('team');
    await needRole(req, team, Schema.CAN.edit, 'You need the Producer role for rights reports');
    const rows = await app.music.rightsReport(team, { who: q.get('who') || '', from: q.get('from') || '', to: q.get('to') || '' });
    const cell = (x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`;
    const head = ['Date', 'Time', 'Production', 'Match', 'Title', 'Artist', 'Composer(s)', 'Publisher(s)', 'Library', 'ISRC', 'ISWC', 'Use', 'Played from', 'Duration'];
    const body = rows.map((r) => [r.date, r.at ? new Date(r.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '', r.productionName || '', r.match || '', r.title, r.artist, r.composers, r.publisher, r.library, r.isrc, r.iswc, r.usage, r.source, r.duration]);
    send(res, 200, '﻿' + [head, ...body].map((l) => l.map(cell).join(',')).join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="Music use${q.get('who') ? ' - ' + String(q.get('who')).replace(/[^\w .-]/g, '') : ''}.csv"` });
  });
  // the theme music to offer for a match (its production's, then its competition's)
  r.add('GET', '/api/music/theme', async (req) => {
    const q = qs(req), team = q.get('team');
    await needRole(req, team, Schema.CAN.read);
    const fx = q.get('fixture') ? await app.store.get(q.get('fixture')) : null;
    return { tracks: fx && fx.team === team ? await app.music.themeFor(fx.id) : [] };
  });
  r.add('GET', '/api/productions/:id/callsheet/recipients', async (req, res, p) => {
    const { prod } = await prodFor(req, p, Schema.CAN.edit, 'You need the Producer role to send call sheets');
    return { mail: app.mail.enabled(), bridge, site: site(), list: app.callsheet.recipients(await app.callsheet.build(prod)).map((r) => ({ ...r, email: r.email || '', hasEmail: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email || '') })) };
  });
  r.add('POST', '/api/productions/:id/callsheet/send', async (req, res, p) => {
    if (bridge) { const e = new (require('./util').HttpError)(403, `Call sheets are emailed from the website${site() ? ' (' + site().replace(/^https?:\/\//, '') + ')' : ''}: open this production there and press Send call sheet.`); e.code = 'ONLINE_ONLY'; throw e; }
    const { user, prod } = await prodFor(req, p, Schema.CAN.edit, 'You need the Producer role to send call sheets');
    auth.throttle('callsheet:' + user.id);
    const b = await readJson(req);
    return app.callsheet.send(prod, { to: b.to, extra: b.extra, note: String(b.note || '') }, user);
  });
  // end a live stream from the website (the camera is cut off and the key closed), or open its key again
  r.add('POST', '/api/productions/:id/stream/end', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to end a stream');
    if (app.isLocal) fail(400, 'Streams are ended on the website');
    const prod = await st.prodById(p.id);
    if (!prod || prod.deleted || prod.team !== team || prod.type !== 'production') fail(404, 'Production not found');
    const r2 = await st.endStream(prod, user.id);
    return { doc: r2.doc, kicked: r2.kicked };
  });
  r.add('POST', '/api/productions/:id/stream/reopen', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to open a stream key');
    const prod = await st.prodById(p.id);
    if (!prod || prod.deleted || prod.team !== team || prod.type !== 'production') fail(404, 'Production not found');
    return { doc: await st.reopenStream(prod, user.id) };
  });
  // ---- master control (lib/mcr.js): slates, ad breaks and overlays for the app's viewers; the feed stays clean
  async function mcrStream(req, p, test, msg) {
    const team = qs(req).get('team');
    const { user, role } = await needRole(req, team, test, msg);
    if (app.isLocal) fail(400, 'Master control is on the website');
    const prod = await st.prodById(p.id);
    if (!prod || prod.deleted || prod.team !== team || prod.type !== 'production' || !prod.data.streamSlug) fail(404, 'Production stream not found');
    const ch = prod.data.streamChannel ? await app.store.get(prod.data.streamChannel) : null;
    return { user, role, s: { prod, ch } };
  }
  r.add('GET', '/api/productions/:id/mcr', async (req, res, p) => {
    const { s } = await mcrStream(req, p, Schema.CAN.read);
    return { state: await app.mcr.state(s), summary: mcrSummary(await app.mcr.state(s)), slates: app.mcr.SLATES, events: require('./automation').EVENTS, now: Date.now(), live: st.status(s.prod.data.streamSlug).live };
  });
  r.add('POST', '/api/productions/:id/mcr', async (req, res, p) => {
    const { user, s } = await mcrStream(req, p, Schema.CAN.edit, 'You need the Producer role for master control');
    const state = await app.mcr.act(s, await readJson(req, 64 * 1024), user.id);
    return { state, summary: mcrSummary(state), now: Date.now() };
  });
  // the viewers' players ask every few seconds (live only)
  r.add('GET', '/api/watch/:slug/mcr', async (req, res, p) => {
    if (app.isLocal) return { now: Date.now(), slate: null, ad: null, overlays: [] };
    const s = await st.streamOf(require('./util').slug(p.slug));
    if (!s || s.ch.data.disabled) fail(404, 'There is no stream at this address');
    send(res, 200, await app.mcr.forViewers(s), { 'Cache-Control': 'no-store' });
  });
  // what is on now, for the countdowns: on the production PC (scorer, graphics control, confidence monitor) and in the Studio
  r.add('GET', '/api/mcr/active', async (req) => {
    const user = await auth.userFromReq(req).catch(() => null);
    const viaKey = !user && app.isLocal && !!cfg.outputKey && qs(req).get('key') === cfg.outputKey;
    if (!user && !viaKey) fail(401, 'Sign in first');
    const teams = viaKey ? null : new Set((await auth.teamsFor(user)).map((t) => t.id));
    const now = Date.now(), list = [];
    for (const d of await app.store.listType('mcr')) {
      if (d.deleted || (teams && !teams.has(d.team))) continue;
      const sum = mcrSummary(d.data, now);
      if (!sum || (!sum.slate && !sum.ad && !sum.squeeze)) continue;
      const prod = await st.prodById(d.data.production);
      list.push({ slug: d.data.slug, production: d.data.production, team: d.team, title: prod ? prod.data.streamTitle || prod.data.name || '' : d.data.slug, ...sum });
    }
    return { now, list };
  });
  // a game event from a scorer (sent by the production PC): master control's automation rules (squeeze-backs, ad breaks …)
  r.add('POST', '/api/mcr/event', async (req) => {
    const user = await needUser(req);
    if (app.isLocal) return { ran: 0 };
    const b = await readJson(req, 8192);
    const fx = await app.store.get(String(b.fixtureId || ''));
    if (!fx || fx.deleted || fx.type !== 'fixture') fail(404, 'Match not found');
    const role = await auth.roleIn(user, fx.team);
    if (!role || !Schema.CAN.score(role)) fail(403, 'You cannot score this match');
    return app.mcr.gameEvent(fx.team, { fixtureId: fx.id, kind: String(b.kind || ''), also: Array.isArray(b.also) ? b.also.slice(0, 10).map(String) : [], team: ['A', 'B'].includes(b.team) ? b.team : '' });
  });
  // ---- push notifications (lib/push.js): the apps' devices, each person's choices, the inbox, the Firebase settings
  r.add('GET', '/api/push/android-config', async () => (app.isLocal ? {} : app.push.androidConfig()));
  r.add('GET', '/api/push/config', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can see this'); return app.push.config(); });
  r.add('POST', '/api/push/config', async (req) => {
    const user = await needUser(req);
    if (!siteAdmin(user)) fail(403, 'Only a site admin can change this');
    return app.push.setConfig(await readJson(req, 64 * 1024));
  });
  r.add('GET', '/api/push/prefs', async (req) => {
    const user = await needUser(req);
    if (app.isLocal) fail(400, 'Notifications are set on the website');
    const devices = (await app.push.devicesOf(user.id)).map((d) => ({ id: d.id, platform: d.data.platform, name: d.data.name, at: d.data.at }));
    const p = user.data.pushPrefs || {};
    return { events: app.push.EVENTS.map(([key, group, label]) => ({ key, group, label })), prefs: app.push.prefsOf(user), quiet: p.quiet || { on: false, from: '22:00', to: '07:00' }, devices, ...(await app.push.config().then((c) => ({ android: c.android && c.fcm }))) };
  });
  r.add('PUT', '/api/push/prefs', async (req) => {
    const user = await needUser(req);
    if (app.isLocal) fail(400, 'Notifications are set on the website');
    const b = await readJson(req);
    const keys = new Set(app.push.EVENTS.map((e) => e[0]));
    const prefs = { ...(user.data.pushPrefs || {}) };
    for (const [k, v] of Object.entries(b.prefs || {})) if (keys.has(k)) prefs[k] = !!v;
    if (b.quiet) { const t = (x, d) => (/^\d\d:\d\d$/.test(String(x || '')) ? String(x) : d); prefs.quiet = { on: !!b.quiet.on, from: t(b.quiet.from, '22:00'), to: t(b.quiet.to, '07:00') }; }
    await app.save('', 'user', user.id, { ...user.data, pushPrefs: prefs }, user.id);
    return { prefs: app.push.prefsOf({ data: { pushPrefs: prefs } }), quiet: prefs.quiet || null };
  });
  // an Android app (its Firebase token) or, with the PC's machine key, a person on a Windows production PC
  r.add('POST', '/api/push/register', async (req) => {
    if (app.isLocal) fail(400, 'Devices are registered on the website');
    const b = await readJson(req, 8192);
    if (b.platform === 'windows') {
      const k = await auth.keyUser(auth.bearer(req));
      if (!k) fail(401, 'This PC is not linked to the website');
      const u = await auth.userByEmail(String(b.email || ''));
      if (!u) fail(404, 'Nobody with that email on the website');
      // the person must share a production team with whoever linked the PC
      const mine = new Set((await auth.teamsFor(k.user)).map((t) => t.id));
      if (!(await auth.teamsFor(u)).some((t) => mine.has(t.id))) fail(403, 'That person is not in this PC\'s production teams');
      const doc = await app.push.register(u, { platform: 'windows', machine: k.keyDoc.id, name: String(b.name || 'Windows PC') });
      return { device: doc.id };
    }
    const user = await needUser(req);
    if (b.platform === 'web') { const doc = await app.push.register(user, { platform: 'web', subscription: b.subscription, name: b.name }); return { device: doc.id }; }
    const doc = await app.push.register(user, { platform: 'android', token: b.token, name: b.name });
    return { device: doc.id };
  });
  // browsers: the website's public key, to subscribe with
  r.add('GET', '/api/push/web-key', async () => (app.isLocal ? { key: '' } : { key: await app.push.webKey() }));
  r.add('POST', '/api/push/unregister', async (req) => {
    if (app.isLocal) return { ok: true };
    const b = await readJson(req, 8192);
    if (b.platform === 'windows') {
      const k = await auth.keyUser(auth.bearer(req));
      const u = k && (await auth.userByEmail(String(b.email || '')));
      if (u) await app.push.removeDevice(await app.store.get(app.push.deviceId('windows', k.keyDoc.id + ':' + u.id)));
      return { ok: true };
    }
    if (b.platform === 'web') { const w = await app.store.get(app.push.deviceId('web', String(b.endpoint || ''))); if (w && w.type === 'pushdevice') await app.push.removeDevice(w); return { ok: true }; }
    const d = await app.store.get(app.push.deviceId('android', String(b.token || '')));
    if (d && d.type === 'pushdevice') await app.push.removeDevice(d);
    return { ok: true };
  });
  r.add('DELETE', '/api/push/devices/:id', async (req, res, p) => {
    const user = await needUser(req);
    const d = await app.store.get(p.id);
    if (!d || d.deleted || d.type !== 'pushdevice' || d.data.user !== user.id) fail(404, 'Device not found');
    await app.push.removeDevice(d);
    return { ok: true };
  });
  r.add('POST', '/api/push/test', async (req) => {
    const user = await needUser(req);
    if (app.isLocal) fail(400, 'Notifications are sent from the website');
    auth.throttle('pushtest:' + user.id);
    const devices = await app.push.devicesOf(user.id);
    const prefs = { ...user.data, pushPrefs: { ...(user.data.pushPrefs || {}), stream_live: true, quiet: { on: false } } };
    const n = await app.push.send([{ ...user, data: prefs }], { kind: 'stream_live', title: 'Test notification', body: 'Notifications from RFP Manager reach this device.', url: String(cfg.adminUrl || cfg.publicUrl || '').replace(/\/+$/, '') + '/app/#/notifications' });
    return { devices: devices.length, pushed: n };
  });
  // the Windows PCs: one stream per linked PC (machine key) with the notifications of the people registered on it
  r.add('GET', '/api/push/stream', async (req, res) => {
    if (app.isLocal) fail(400, 'Not on a production PC');
    const k = await auth.keyUser(auth.bearer(req));
    if (!k) fail(401, 'This PC is not linked to the website');
    app.push.stream(req, res, k.keyDoc.id);
  });
  // the inbox
  r.add('GET', '/api/notifications', async (req) => { const user = await needUser(req); if (app.isLocal) return { unread: 0, list: [] }; return app.push.inbox(user); });
  r.add('POST', '/api/notifications/read', async (req) => { const user = await needUser(req); const b = await readJson(req); return app.push.markRead(user, b.all ? 'all' : (Array.isArray(b.ids) ? b.ids.map(String) : [])); });
  // the video adverts: a production team's library
  r.add('GET', '/api/videoads', async (req) => {
    const team = qs(req).get('team');
    await needRole(req, team, Schema.CAN.read);
    const here = !!(cfg.streaming && cfg.streaming.api);
    return { list: (await app.store.list(team, 'videoad')).filter((d) => !d.deleted).map((d) => ({ id: d.id, ...d.data, kind: d.data.kind || 'ad', url: '/ads/' + d.id + '.mp4', missing: here && !fs.existsSync(app.mcr.adFile(d.id) || '-') })).sort((a, b) => String(a.title).localeCompare(String(b.title))) };
  });
  r.add('POST', '/api/videoads', async (req) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to add video adverts');
    if (app.isLocal) fail(400, 'Video adverts are added on the website');
    // the files are kept (and played from) the server that streams; another copy of the website (no streaming server
    // of its own) would keep them where viewers never get them
    if (!(cfg.streaming && cfg.streaming.api)) { const at = String(cfg.adminUrl || '').replace(/\/+$/, ''); fail(400, `Add videos and music on the streaming server${at && !at.includes(String(req.headers.host || '-')) ? ' (' + at.replace(/^https?:\/\//, '') + ')' : ''}: this copy of the website does not keep them.`); }
    const doc = await app.mcr.upload(req, team, { name: qs(req).get('name') || '', duration: qs(req).get('duration') || '', kind: qs(req).get('kind') || 'ad' }, user.id);
    return { ad: { id: doc.id, ...doc.data, url: '/ads/' + doc.id + '.mp4' } };
  });
  r.add('PUT', '/api/videoads/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to change video adverts');
    const cur = await app.store.get(p.id);
    if (!cur || cur.deleted || cur.team !== team || cur.type !== 'videoad') fail(404, 'Video advert not found');
    const b = await readJson(req);
    const doc = await app.save(team, 'videoad', cur.id, { ...cur.data, title: String(b.title || cur.data.title || '').slice(0, 80), kind: cur.data.kind !== 'music' && (b.kind === 'squeeze' || b.kind === 'ad') ? b.kind : cur.data.kind || 'ad' }, user.id);
    return { ad: { id: doc.id, ...doc.data, url: '/ads/' + doc.id + '.mp4' } };
  });
  // presets: ready-made ad breaks and squeeze-backs
  const presetOut = (d) => ({ id: d.id, ...d.data });
  r.add('GET', '/api/adpresets', async (req) => {
    const team = qs(req).get('team');
    await needRole(req, team, Schema.CAN.read);
    return { list: (await app.store.list(team, 'adpreset')).filter((d) => !d.deleted).map(presetOut).sort((a, b) => String(a.name).localeCompare(String(b.name))) };
  });
  r.add('PUT', '/api/adpresets/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to change presets');
    if (app.isLocal) fail(400, 'Presets are made on the website');
    const id = p.id === 'new' ? newId('ap_') : p.id;
    if (!/^ap_[\w-]+$/.test(id)) fail(400, 'Bad preset id');
    const cur = await app.store.get(id);
    if (cur && (cur.team !== team || cur.type !== 'adpreset')) fail(404, 'Preset not found');
    const b = await readJson(req, 32 * 1024);
    const kind = b.kind === 'squeeze' ? 'squeeze' : 'ads';
    const mine = new Set((await app.store.list(team, 'videoad')).filter((d) => !d.deleted).map((d) => d.id));
    const ads = (Array.isArray(b.ads) ? b.ads : []).map(String).filter((x) => mine.has(x)).slice(0, 30);
    const image = /^img_[\w-]+$/.test(String(b.image || '')) ? String(b.image) : '';
    if (kind === 'ads' && !ads.length) fail(400, 'Pick the video adverts for the ad break');
    if (kind === 'squeeze' && !ads.length && !image) fail(400, 'Pick videos or a sponsor board for the squeeze-back');
    const data = { name: String(b.name || '').trim().slice(0, 60) || (kind === 'ads' ? 'Ad break' : 'Squeeze-back'), kind, ads, image, seconds: Math.max(5, Math.min(600, Number(b.seconds) || 20)),
      pos: ['tl', 'tr', 'bl', 'br'].includes(b.pos) ? b.pos : 'tr', sound: b.sound === 'ad' ? 'ad' : 'live', text: String(b.text || '').slice(0, 120) };
    return { preset: presetOut(await app.save(team, 'adpreset', id, data, user.id)) };
  });
  r.add('DELETE', '/api/adpresets/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to delete presets');
    const cur = await app.store.get(p.id);
    if (!cur || cur.deleted || cur.team !== team || cur.type !== 'adpreset') fail(404, 'Preset not found');
    await app.put({ ...cur, deleted: true, updatedAt: Math.max(Date.now(), cur.updatedAt + 1), updatedBy: user.id });
    return { ok: true };
  });
  r.add('DELETE', '/api/videoads/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to delete video adverts');
    const cur = await app.store.get(p.id);
    if (!cur || cur.deleted || cur.team !== team || cur.type !== 'videoad') fail(404, 'Video advert not found');
    await app.mcr.removeAd(cur, user.id);
    return { ok: true };
  });
  r.add('GET', '/api/channels/shared', async (req) => { await needUser(req); return { list: await st.sharedChannels() }; });
  r.add('POST', '/api/productions/:id/newkey', async (req, res, p) => {
    const team = qs(req).get('team');
    if (bridge) onlyOnline('Productions');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to change the stream key');
    const cur = await st.prodById(p.id);
    if (!cur || cur.deleted || cur.team !== team || cur.type !== 'production' || !cur.data.streamChannel) fail(404, 'Production stream not found');
    const doc = await st.newStreamKey(cur, user.id);
    return { doc, ingest: st.ingest(doc) };
  });
  // tickets the viewer holds (ticket links kept by the page): header x-rfp-tickets "tk_…,tk_…" or ?ticket=
  const ticketsOf = (req) => [...String(req.headers['x-rfp-tickets'] || '').split(','), qs(req).get('ticket') || ''].map((x) => x.trim()).filter((x) => /^tk_/.test(x)).slice(0, 20);
  r.add('GET', '/api/watch/:slug', async (req, res, p) => st.watch(p.slug, await auth.userFromReq(req).catch(() => null), undefined, qs(req).get('v') || '', ticketsOf(req), qs(req).get('m') || ''));
  r.add('POST', '/api/watch/:slug', async (req, res, p) => {
    auth.throttle(clientIp(req, !app.isLocal));
    return st.watch(p.slug, await auth.userFromReq(req).catch(() => null), String((await readJson(req)).password || ''), qs(req).get('v') || '', ticketsOf(req), qs(req).get('m') || '');
  });

  // ---- comments on watch pages (live chat, and per video)
  const whereOf = (req) => { const q = qs(req); return { match: q.get('m') || '', start: q.get('v') || '' }; };
  // video analytics: the watch page says every 30 s that someone is watching
  r.add('POST', '/api/watch/:slug/beat', async (req, res, p) => {
    if (app.isLocal) return { ok: false };
    const b = await readJson(req, 4096);
    return app.analytics.beat(require('./util').slug(p.slug), { sid: b.sid, kind: String(b.kind || ''), start: b.start, match: b.match, title: b.title });
  });
  r.add('GET', '/api/analytics', async (req) => {
    const team = qs(req).get('team');
    await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to see video analytics');
    if (app.isLocal) fail(400, 'Video analytics are on the website');
    return app.analytics.report(team, Number(qs(req).get('days')) || 30);
  });
  // a production's recordings: list (with their numbers), title / hide, delete
  async function streamProd(req, p, test, msg) {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, test, msg);
    if (app.isLocal) fail(400, 'Recordings are managed on the website');
    const prod = await st.prodById(p.id);
    if (!prod || prod.deleted || prod.team !== team || prod.type !== 'production' || !prod.data.streamSlug) fail(404, 'Production stream not found');
    return { user, prod, team };
  }
  r.add('GET', '/api/productions/:id/recordings', async (req, res, p) => {
    const { prod, team } = await streamProd(req, p, Schema.CAN.edit, 'You need the Producer role to manage recordings');
    const stats = await app.analytics.forStream(team, prod.data.streamSlug);
    const list = (await st.recordings(prod)).map((v) => { const n = stats.get('v:' + v.start) || {}; return { ...v, viewers: n.viewers || 0, seconds: n.seconds || 0 }; });
    const live = stats.get('live') || {};
    return { list, live: { viewers: live.viewers || 0, seconds: live.seconds || 0, peak: live.peak || 0 }, watch: (cfg.publicUrl || '').replace(/\/+$/, '') + '/watch/' + prod.data.streamSlug };
  });
  r.add('PUT', '/api/productions/:id/recordings/:start', async (req, res, p) => {
    const { user, prod } = await streamProd(req, p, Schema.CAN.edit, 'You need the Producer role to manage recordings');
    const b = await readJson(req);
    const doc = await st.setRecording(prod, p.start, { title: b.title, hidden: b.hidden }, user.id);
    return { title: doc.data.title || '', hidden: !!doc.data.hidden };
  });
  r.add('DELETE', '/api/productions/:id/recordings/:start', async (req, res, p) => {
    const { user, prod } = await streamProd(req, p, Schema.CAN.edit, 'You need the Producer role to delete recordings');
    return st.deleteRecording(prod, p.start, user.id);
  });
  r.add('GET', '/api/watch/:slug/comments', async (req, res, p) => app.comments.list(p.slug, whereOf(req), await auth.userFromReq(req).catch(() => null)));
  r.add('POST', '/api/watch/:slug/comments', async (req, res, p) => {
    const user = await needUser(req);
    return { comment: await app.comments.add(p.slug, whereOf(req), user, (await readJson(req, 16 * 1024)).text) };
  });
  // comments on a video (VOD): the same comments, thread vod:<id>
  r.add('GET', '/api/public/v/:id/comments', async (req, res, p) => app.comments.list('vod:' + p.id, {}, await auth.userFromReq(req).catch(() => null), ticketsOf(req)));
  r.add('POST', '/api/public/v/:id/comments', async (req, res, p) => {
    const user = await needUser(req);
    return { comment: await app.comments.add('vod:' + p.id, {}, user, (await readJson(req, 16 * 1024)).text, ticketsOf(req)) };
  });
  r.add('DELETE', '/api/comments/:id', async (req, res, p) => app.comments.remove(p.id, await needUser(req)));

  // ---- paid streams (PayFast)
  const siteBase = (req) => (cfg.publicUrl || ((req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')) + '://' + req.headers.host)).replace(/\/+$/, '');
  r.add('POST', '/api/pay/start', async (req) => {
    if (app.isLocal) fail(400, 'Tickets are sold on the website');
    auth.throttle(clientIp(req, true));
    const b = await readJson(req);
    const user = await auth.userFromReq(req).catch(() => null);
    return app.pay.start({ slug: String(b.slug || ''), kind: String(b.kind || 'ticket'), email: String(b.email || ''), name: String(b.name || ''), giftTo: String(b.giftTo || ''), user, base: siteBase(req) });
  });
  r.add('GET', '/api/pay/status/:id', async (req, res, p) => app.pay.statusOf(p.id));

  // ---- videos on demand (lib/vod.js): uploads in chunks, processing, playback, series, buying
  async function vodTeam(req, msg) {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, msg || 'You need the Producer role to upload videos');
    if (app.isLocal) fail(400, 'Videos are uploaded on the website');
    return { team, user };
  }
  r.add('GET', '/api/vod', async (req) => { const { team } = await vodTeam(req); return { list: await app.vod.list(team), ffmpeg: await app.vod.hasFfmpeg(), chunk: app.vod.CHUNK }; });
  r.add('POST', '/api/vod', async (req) => { const { team, user } = await vodTeam(req); return app.vod.create(team, user, await readJson(req, 16384)); });
  r.add('GET', '/api/vod/:id/upload', async (req, res, p) => { const { team } = await vodTeam(req); return app.vod.status(team, p.id); });
  r.add('PUT', '/api/vod/:id/upload', async (req, res, p) => { const { team } = await vodTeam(req); return app.vod.chunk(team, p.id, qs(req).get('offset'), await readBody(req, app.vod.CHUNK + 1024 * 1024)); });
  r.add('POST', '/api/vod/:id/done', async (req, res, p) => { const { team } = await vodTeam(req); return app.vod.done(team, p.id); });
  r.add('GET', '/api/public/v/:id', async (req, res, p) => app.vod.watch(p.id, { user: await auth.userFromReq(req).catch(() => null), tickets: ticketsOf(req) }));
  r.add('POST', '/api/public/v/:id', async (req, res, p) => {
    auth.throttle(clientIp(req, !app.isLocal));
    return app.vod.watch(p.id, { user: await auth.userFromReq(req).catch(() => null), password: String((await readJson(req)).password || ''), tickets: ticketsOf(req) });
  });
  r.add('POST', '/api/public/v/:id/view', async (req, res, p) => ({ counted: await app.vod.counted(p.id, clientIp(req, !app.isLocal)) }));
  r.add('GET', '/api/public/s/:id', async (req, res, p) => app.vod.seriesPage(p.id, { user: await auth.userFromReq(req).catch(() => null), tickets: ticketsOf(req) }));
  r.add('POST', '/api/public/vod/buy', async (req) => {
    if (app.isLocal) fail(400, 'Tickets are sold on the website');
    auth.throttle(clientIp(req, true));
    const b = await readJson(req);
    return app.vod.buy({ kind: String(b.kind || ''), id: String(b.id || ''), email: String(b.email || ''), name: String(b.name || ''), giftTo: String(b.giftTo || ''), user: await auth.userFromReq(req).catch(() => null), base: siteBase(req) });
  });
  // YouTube: the team's API key (kept on the server), bringing in links, syncing a playlist that came from YouTube
  // ---- YouTube Live (lib/ytlive.js): connect the team's channel, schedule broadcasts
  if (!app.isLocal) {
    const ytBase = (req) => String(cfg.adminUrl || siteBase(req)).replace(/\/+$/, '');
    const ytTeam = async (req) => { const team = qs(req).get('team'); const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role for YouTube Live'); return { team, user }; };
    r.add('GET', '/api/ytlive/server', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can see this'); return app.ytlive.serverView(ytBase(req)); });
    r.add('PUT', '/api/ytlive/server', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can change this'); return app.ytlive.setSecret((await readJson(req, 4096)).secret); });
    r.add('GET', '/api/ytlive', async (req) => { const { team } = await ytTeam(req); return { ...(await app.ytlive.status(team)), server: await app.ytlive.serverView(ytBase(req)) }; });
    r.add('POST', '/api/ytlive/connect', async (req) => {
      const team = qs(req).get('team');
      const { user } = await needRole(req, team, Schema.CAN.admin, 'Only an Admin can connect the YouTube channel');
      return app.ytlive.connectUrl(team, user, ytBase(req), (await readJson(req, 4096)).back);
    });
    r.add('GET', '/api/ytlive/callback', async (req, res) => {
      const q = qs(req), user = await auth.userFromReq(req).catch(() => null);
      const go = (to) => { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
      if (q.get('error')) return go('/app#/youtube/error/' + encodeURIComponent(q.get('error') === 'access_denied' ? 'YouTube was not connected (permission not given)' : q.get('error')));
      try { await app.ytlive.callback(q.get('code'), q.get('state'), ytBase(req), user); go('/app#/youtube/connected'); }
      catch (e) { go('/app#/youtube/error/' + encodeURIComponent(e.message)); }
    });
    r.add('DELETE', '/api/ytlive/connect', async (req) => { const team = qs(req).get('team'); await needRole(req, team, Schema.CAN.admin, 'Only an Admin can disconnect YouTube'); return app.ytlive.disconnect(team); });
    r.add('GET', '/api/ytlive/broadcasts', async (req) => { const { team } = await ytTeam(req); return { list: await app.ytlive.list(team) }; });
    r.add('POST', '/api/ytlive/broadcasts', async (req) => { const { team, user } = await ytTeam(req); return app.ytlive.schedule(team, await readJson(req, 16384), user); });
    r.add('PUT', '/api/ytlive/broadcasts/:id', async (req, res, p) => { const { team } = await ytTeam(req); return app.ytlive.update(team, p.id, await readJson(req, 16384)); });
    r.add('GET', '/api/ytlive/broadcasts/:id/key', async (req, res, p) => { const { team } = await ytTeam(req); return app.ytlive.keyOf(team, p.id); });
    r.add('DELETE', '/api/ytlive/broadcasts/:id', async (req, res, p) => { const { team, user } = await ytTeam(req); return app.ytlive.cancel(team, p.id, user); });
  }
  r.add('GET', '/api/yt/key', async (req) => { const { team } = await vodTeam(req); return { set: await app.youtube.hasKey(team) }; });
  r.add('PUT', '/api/yt/key', async (req) => {
    const team = qs(req).get('team');
    await needRole(req, team, Schema.CAN.admin, 'Only an Admin can set the YouTube key');
    return app.youtube.setKey(team, (await readJson(req, 4096)).key);
  });
  r.add('POST', '/api/yt/import', async (req) => { const { team, user } = await vodTeam(req, 'You need the Producer role to add videos'); return app.youtube.importLinks(team, user, await readJson(req, 65536)); });
  r.add('POST', '/api/yt/sync/:id', async (req, res, p) => { const { team, user } = await vodTeam(req, 'You need the Producer role to sync playlists'); return app.youtube.sync(team, user, p.id); });
  r.add('GET', '/api/public/p/:id', async (req, res, p) => app.vod.playlistPage(p.id, { user: await auth.userFromReq(req).catch(() => null) }));
  // the website's front page layout (site admins): a featured item and the order of the rows
  r.add('GET', '/api/site/layout', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can change the website\'s front page'); return { layout: (await app.store.kvGet('site:layout')) || null }; });
  r.add('PUT', '/api/site/layout', async (req) => {
    const user = await needUser(req);
    if (!siteAdmin(user)) fail(403, 'Only a site admin can change the website\'s front page');
    const layout = app.cms.clean((await readJson(req, 65536)).layout);
    await app.store.kvSet('site:layout', layout);
    pubCache.clear();
    return { layout };
  });
  // subtitles of a video: list, upload (.srt / .vtt as the body; label, lang and default in the query), change, delete
  r.add('GET', '/api/vod/:id/subtitles', async (req, res, p) => { const { team } = await vodTeam(req); return { list: await app.vod.subtitlesOf(p.id) }; });
  r.add('POST', '/api/vod/:id/subtitles', async (req, res, p) => {
    const { team } = await vodTeam(req, 'You need the Producer role to add subtitles');
    const q = qs(req);
    return app.vod.addSubtitle(team, p.id, { label: q.get('label') || '', lang: q.get('lang') || '', def: q.get('default') === '1' }, await readBody(req, 2 * 1024 * 1024));
  });
  r.add('PUT', '/api/vod/:id/subtitles/:sid', async (req, res, p) => { const { team } = await vodTeam(req, 'You need the Producer role to change subtitles'); return app.vod.updateSubtitle(team, p.id, p.sid, await readJson(req, 4096)); });
  r.add('DELETE', '/api/vod/:id/subtitles/:sid', async (req, res, p) => { const { team } = await vodTeam(req, 'You need the Producer role to delete subtitles'); return app.vod.removeSubtitle(team, p.id, p.sid); });
  r.add('GET', '/vodfiles/:id/subs/:file', async (req, res, p) => app.vod.serveSubtitle(res, p.id, String(p.file).replace(/\.vtt$/, ''), qs(req).get('t')));
  r.add('GET', '/vodfiles/:id/video', async (req, res, p) => app.vod.serveFile(req, res, p.id, qs(req).get('t'), false));
  r.add('GET', '/vodfiles/:id/poster.jpg', async (req, res, p) => app.vod.serveFile(req, res, p.id, qs(req).get('t'), true));
  // PayFast's merchant details (site admins) and paying invoices, deposits and software (lib/payments.js)
  r.add('GET', '/api/pay/config', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can see this'); return app.pay.view(); });
  r.add('POST', '/api/pay/config', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can change this'); return app.pay.setConfig(await readJson(req, 8192)); });
  r.add('POST', '/api/pay/test', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can test this'); const b = await readJson(req, 4096); return app.pay.test({ email: String(b.email || ''), base: siteBase(req) }); });
  const payTries = new Map();
  const payThrottle = (ip) => { const now = Date.now(), a = (payTries.get(ip) || []).filter((x) => now - x < 60000); if (a.length >= 20) fail(429, 'Too many payments started. Wait a minute and try again.'); a.push(now); payTries.set(ip, a); if (payTries.size > 5000) payTries.clear(); };
  const payStart = async (req) => { if (app.isLocal) fail(400, 'Payments are on the website'); payThrottle(clientIp(req, true)); return { b: await readJson(req, 8192), user: await auth.userFromReq(req).catch(() => null), base: siteBase(req) }; };
  r.add('POST', '/api/client/:key/pay/:num', async (req, res, p) => { const { b, user, base } = await payStart(req); return app.payments.payInvoice(p.key, p.num, { email: String(b.email || ''), name: String(b.name || ''), base, user }); });
  // ---- the client portal (lib/portal.js): /portal/<key>
  // ---- release forms: the public form (/release/<key>) and the Studio (Producers and Admins)
  if (!app.isLocal && app.releases) {
    r.add('GET', '/api/public/release/:key', async (req, res, p) => app.releases.view(p.key));
    r.add('POST', '/api/public/release/:key', async (req, res, p) => { payThrottle(clientIp(req, true)); return app.releases.submit(p.key, await readJson(req, 1024 * 1024), clientIp(req, true)); });
    r.add('GET', '/api/releases/form/:id', async (req, res, p) => { const { team } = await money2(req); return app.releases.list(team, p.id); });
    r.add('POST', '/api/releases/form/:id/send', async (req, res, p) => { const { team, user } = await money2(req); return app.releases.send(team, p.id, await readJson(req), user.data.email); });
    r.add('GET', '/api/releases/production/:id', async (req, res, p) => { const { team } = await money2(req); return { releases: await app.releases.forProduction(team, p.id) }; });
    r.add('GET', '/api/releases/:id/pdf', async (req, res, p) => { const { team } = await money2(req); pdfOut(req, res, await app.releases.pdf(team, p.id)); });
    r.add('POST', '/api/releases/:id/withdraw', async (req, res, p) => { const { team, user } = await money2(req); return app.releases.withdraw(team, p.id, (await readJson(req)).withdrawn !== false, user.data.email); });
    r.add('DELETE', '/api/releases/:id', async (req, res, p) => { const { team } = await money2(req, true); return app.releases.remove(team, p.id); });
  }
  r.add('GET', '/api/public/my-portals', async (req) => { const u = await auth.userFromReq(req).catch(() => null); return { portals: u ? await app.portal.mine(u.data.email) : [] }; });
  r.add('GET', '/api/portal/:key', async (req, res, p) => app.portal.view(p.key, await auth.userFromReq(req).catch(() => null)));
  r.add('GET', '/api/portal/:key/contract/:id.pdf', async (req, res, p) => { pdfOut(req, res, await app.portal.contractPdf(p.key, p.id)); });
  r.add('POST', '/api/portal/:key/password', async (req, res, p) => { auth.throttle(clientIp(req, true)); const u = await app.portal.createPassword(p.key, (await readJson(req)).password); await auth.startSession(req, res, u.id); return { ok: true }; });
  r.add('PUT', '/api/portal/:key/details', async (req, res, p) => app.portal.saveDetails(p.key, await auth.userFromReq(req).catch(() => null), await readJson(req)));
  r.add('GET', '/api/portal/:key/doc/:id.pdf', async (req, res, p) => { pdfOut(req, res, await app.portal.docPdf(p.key, p.id)); });
  r.add('POST', '/api/portal/:key/sign/:id', async (req, res, p) => { payThrottle(clientIp(req, true)); return { doc: (({ signature, ...x }) => x)(await app.portal.sign(p.key, p.id, await readJson(req, 512 * 1024), clientIp(req, true))) }; });
  r.add('POST', '/api/portal/:key/pay/:id', async (req, res, p) => { const { user, base } = await payStart(req); return app.portal.pay(p.key, p.id, { base, user }); });
  r.add('POST', '/api/portal/:key/users', async (req, res, p) => { payThrottle(clientIp(req, true)); const b = await readJson(req); return app.portal.addUser(p.key, { email: b.email, name: b.name }); });
  r.add('DELETE', '/api/portal/:key/users/:email', async (req, res, p) => app.portal.removeUser(p.key, decodeURIComponent(p.email)));
  r.add('POST', '/api/portal/:key/ads', async (req, res, p) => {
    payThrottle(clientIp(req, true));
    const { team } = await app.portal.byKey(p.key);
    const q = qs(req), mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) fail(415, 'Use a PNG, JPG, WebP or GIF picture');
    const img = await storeImage(team, await readBody(req, MAX_IMAGE + 1024), mime, q.get('name') || 'advert', 'advert', '', null, 'client portal');
    return app.portal.addAd(p.key, { slot: q.get('slot') || '', name: q.get('name') || '', image: img.id, from: q.get('from') || '' });
  });
  r.add('DELETE', '/api/portal/:key/ads/:id', async (req, res, p) => app.portal.removeAd(p.key, p.id));
  r.add('POST', '/api/public/track/:key/pay', async (req, res, p) => { const { user, base } = await payStart(req); return app.payments.payDeposit(p.key, { base, user }); });
  r.add('POST', '/api/public/software/:slug/buy', async (req, res, p) => { const { user, base } = await payStart(req); return app.payments.buySoftware(p.slug, { base, user }); });
  r.add('POST', '/api/pay/payfast/itn', async (req, res) => {
    const body = (await require('./http').readBody(req, 64 * 1024)).toString('utf8');
    const pairs = [...new URLSearchParams(body).entries()];
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('OK');           // PayFast wants a quick 200
    app.pay.notify(pairs, clientIp(req, !app.isLocal)).catch((e) => log('PayFast notification failed:', e.message));
  });
  r.add('GET', '/api/sales', async (req) => {
    const team = qs(req).get('team');
    await needRole(req, team, Schema.CAN.edit, 'Ticket sales are for Producers and Admins');
    const list = await app.pay.sales(team);
    const paid = list.filter((x) => x.status === 'Paid');
    return { payments: app.pay.enabled(), sandbox: app.pay.sandbox(), list, total: paid.reduce((a, x) => a + (Number(x.amount) || 0), 0), fees: paid.reduce((a, x) => a + (Number(x.fee) || 0), 0), count: paid.length };
  });

  // ---- the public website: live streams, videos, matches and channels of every production team -----------
  const pubCache = new Map();
  app.on('doc', (d) => { if (['fixture', 'org', 'competition', 'club', 'squad', 'production', 'channel', 'venue'].includes(d.type)) pubCache.delete('matches'); if (['org', 'club', 'squad'].includes(d.type)) pubCache.delete('teams'); if (d.type === 'fixture') pubCache.delete('match:' + d.id); });
  const pubCached = async (k, ms, fn) => { const h0 = pubCache.get(k); if (h0 && h0.at > Date.now() - ms) return h0.v; const v = await fn(); pubCache.set(k, { v, at: Date.now() }); return v; };
  async function publicMatches() {
    return pubCached('matches', 15000, async () => {
      const orgs = (await app.store.listType('org')).filter((o) => !o.deleted && o.data.publicMatches);
      const out = [];
      for (const o of orgs) {
        for (const f of await app.store.list(o.id, 'fixture')) {
          if (f.deleted || !f.data.startDate) continue;
          const d = f.data, teams = await app.domain.snapshotTeams(d), r = d.result || Scoring.summary(d.live);
          const comp = d.competition ? await app.store.get(d.competition) : null, venue = d.venue ? await app.store.get(d.venue) : null;
          // the scorer's state says more than the status field when it has not caught up (a match saved by sync)
          const status = r && r.finished && d.status !== 'Cancelled' ? 'Completed' : r && r.started && ['Upcoming', '', undefined].includes(d.status) ? 'Live' : d.status || 'Upcoming';
          out.push({ id: f.id, name: d.name || d.autoName || '', sport: d.sport || '', date: d.startDate, time: d.startTime || '', status, company: o.data.name,
            competition: comp ? { name: [comp.data.name, comp.data.season].filter(Boolean).join(' '), logo: comp.data.logo || '' } : null, venue: venue ? venue.data.name : '',
            score: r && r.started ? r.text : d.officialReport && d.officialReport.scoreA !== '' ? `${d.officialReport.scoreA} – ${d.officialReport.scoreB}` : '', period: r && r.started && status === 'Live' ? r.period : '',
            teams: teams.map((t) => ({ name: t.name, logo: t.logo, color: t.color1 })), teamIds: [d.team1 || '', d.team2 || ''], competitionId: d.competition || '' });
        }
      }
      return out;
    });
  }
  // the match centre: one match's score, timeline, team and player statistics or scorecard (public matches, and matches
  // in a production that streams)
  r.add('GET', '/api/public/match/:id', async (req, res, p) => {
    if (pubCache.size > 2000) pubCache.clear();
    const m = await pubCached('match:' + p.id, 2500, () => app.matchcentre.build(String(p.id)));
    if (!m) { pubCache.delete('match:' + p.id); fail(404, 'Match not found'); }
    // a running clock moves on while the answer sits in the cache
    return m.clock && m.clock.running ? { ...m, clock: { ...m.clock, ms: Math.max(0, m.clock.ms + m.clock.dir * (Date.now() - m.clock.at)) } } : m;
  });
  // ---- following teams and clubs (match updates in the app, the browser and the inbox)
  r.add('GET', '/api/public/teams', async () => pubCached('teams', 30000, () => app.follows.catalog()));
  r.add('GET', '/api/public/team/:id', async (req, res, p) => {
    const user = await auth.userFromReq(req).catch(() => null);
    const it = await app.follows.page(String(p.id), await publicMatches());
    if (!it) fail(404, 'That team is not on the website');
    const f = user ? app.follows.followsOf(user).find((x) => x.id === it.id) : null;
    const mine = f ? (await app.follows.list(user)).find((x) => x.id === it.id) : null;
    return { ...it, team: undefined, following: !!f, follow: mine ? { alerts: mine.alerts, live: mine.live, digest: mine.digest, scoreRate: mine.scoreRate } : null, alerts: mine ? mine.alerts : null, ...followChoices() };
  });
  const followChoices = () => ({ alertKinds: app.follows.ALERTS.map(([key, label]) => ({ key, label })), scoreRates: app.follows.SCORE_RATES.map(([key, label]) => ({ key, label })), digests: app.follows.DIGESTS.map(([key, label]) => ({ key, label })) });
  r.add('GET', '/api/public/follows', async (req) => {
    const user = await needUser(req);
    return { list: (await app.follows.list(user)).map((x) => ({ ...x, team: undefined })), prefs: app.follows.prefsOf(user), muted: app.follows.mutedOf(user), ...followChoices() };
  });
  r.add('POST', '/api/public/follow', async (req) => {
    const user = await needUser(req);
    const b = await readJson(req);
    return app.follows.set(user, String(b.id || ''), { follow: b.follow !== false, alerts: b.alerts, live: b.live, digest: b.digest, scoreRate: b.scoreRate });
  });
  // how often: the digest (off / match days / daily / weekly, the time, the day, fixtures, push / email) and a pause
  r.add('PUT', '/api/public/follow-prefs', async (req) => {
    const user = await needUser(req);
    return { prefs: await app.follows.setPrefs(user, await readJson(req)) };
  });
  r.add('POST', '/api/public/digest/now', async (req) => {
    const user = await needUser(req);
    auth.throttle('digest:' + user.id);
    const r2 = await app.follows.sendDigest(user, { force: true });
    return { sent: !!(r2 && r2.sent), empty: !!(r2 && r2.empty) || !r2 };
  });
  r.add('POST', '/api/public/mute', async (req) => {
    const user = await needUser(req);
    const b = await readJson(req);
    if (!/^fixture_[\w-]+$|^[\w-]{3,80}$/.test(String(b.fixture || ''))) fail(400, 'Which match?');
    return app.follows.mute(user, String(b.fixture), b.mute !== false);
  });
  app.publicMatches = publicMatches;            // the score digests use the same list
  const subsOf = (u) => (u && Array.isArray(u.data.subscriptions) ? u.data.subscriptions : []);
  r.add('GET', '/api/public/home', async (req) => {
    const user = await auth.userFromReq(req).catch(() => null);
    const today = new Date().toISOString().slice(0, 10);
    const streams = await pubCached('streams', 4000, () => st.publicStreams());
    const chans = (await st.publicChannels()).map((c) => c.brand);
    const videos = [];
    for (const s of streams) {
      for (const m of s.matches || []) if (m.duration > 0) videos.push({ slug: s.slug, title: m.title, match: m.fixture, of: s.title, poster: s.poster, channel: s.channel, price: s.price, start: m.start, duration: m.duration });
      for (const v of s.videos) videos.push({ slug: s.slug, title: s.title + ((s.matches || []).length ? ' (full stream)' : ''), poster: s.poster, channel: s.channel, price: s.price, start: v.start, duration: v.duration });
    }
    const vod = await pubCached('vod', 10000, () => app.vod.publicList(''));
    videos.push(...vod.videos);
    videos.sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const watchOf = new Map();          // match → its video, or the stream it is live on
    for (const s of streams) for (const m of s.matches || []) watchOf.set(m.fixture, m.live ? { href: '/watch/' + s.slug, live: true } : { href: '/watch/' + s.slug + '?m=' + encodeURIComponent(m.fixture), live: false });
    const matches = (await publicMatches()).map((m) => (watchOf.has(m.id) ? { ...m, watch: watchOf.get(m.id) } : m));
    return {
      site: cfg.publicName || cfg.name || 'RFP Manager', googleClientId: cfg.google.clientId || '', me: user ? { name: user.data.name || '', email: user.data.email, image: user.data.image || '', subscriptions: subsOf(user), follows: app.follows.followsOf(user).map((f) => f.id), muted: app.follows.mutedOf(user), ...(await ((async (tf) => ({ teams: tf.length, appOk: tf.some((t) => APP_ROLES.includes(t.role)) }))(await auth.teamsFor(user)))) } : null,
      androidApp: apkThere(),
      live: streams.filter((s) => s.live).sort((a, b) => b.viewers - a.viewers),
      upcoming: streams.filter((s) => !s.live && s.date >= today).sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time))).slice(0, 24),
      videos: videos.slice(0, 120), series: vod.series.slice(0, 40), playlists: vod.playlists.slice(0, 40), channels: chans,
      layout: await pubCached('layout', 10000, async () => { const l = await app.store.kvGet('site:layout'); return l ? app.cms.resolve(app.cms.clean(l), { channel: '', vod, streams }) : null; }),
      matches: { live: matches.filter((m) => m.status === 'Live'), upcoming: matches.filter((m) => m.status !== 'Live' && m.date >= today && !['Completed', 'Cancelled'].includes(m.status)).sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time))).slice(0, 30),
        results: matches.filter((m) => m.status === 'Completed' || (m.date < today && m.score)).sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time))).slice(0, 30) },
    };
  });
  // ---- the landing page (/) : about us, services, booking requests. Edited by site admins (Settings → Website).
  const LANDING_DEFAULT = {
    title: 'Live production, streaming and broadcast graphics',
    about: 'We film, stream and produce live events: sport, church services, concerts, conferences and corporate events. Multi-camera productions, live graphics and scoring, and streaming to our own channels – so your audience can watch live or catch up afterwards.',
    services: [{ title: 'Live streaming', text: 'Multi-camera live streams to the web, with replays afterwards.' }, { title: 'Sport broadcasts', text: 'Live scoring, score bugs and match graphics for every sport.' },
      { title: 'Event production', text: 'Church services, concerts, conferences and corporate events.' }, { title: 'Video & photography', text: 'Highlights, interviews and event photography.' }],
    email: '', phone: '', image: '', bookingTeam: '', googleReview: '', showReviews: true,
  };
  const landing = async () => ({ ...LANDING_DEFAULT, ...((await app.store.kvGet('site:landing').catch(() => null)) || {}) });
  // the booking form (/book) as the site admin set it up (shared/bookingform.js)
  const BookingForm = require('../shared/bookingform');
  const Phone = require('../shared/phone');
  const bookingForm = async () => BookingForm.clean((await app.store.kvGet('site:bookingForm').catch(() => null)) || BookingForm.DEFAULT);
  async function bookingTeam(l) {
    const orgs = (await app.store.listType('org')).filter((o) => !o.deleted);
    const pick = orgs.find((o) => o.id === l.bookingTeam) || orgs.find((o) => String(o.data.name || '').toLowerCase() === String(cfg.publicName || '').toLowerCase());
    if (pick) return pick.id;
    for (const e of cfg.siteAdmins || []) { const u = await auth.userByEmail(e).catch(() => null); if (u) { const t = (await auth.teamsFor(u)).find((x) => x.role === 'Admin'); if (t) return t.id; } }
    return orgs[0] ? orgs[0].id : '';
  }
  // ---- the website's legal pages (/legal, /terms, /privacy) and its copyright line: Settings → Website → Legal & company
  const Legal = require('../shared/legal');
  const LEGAL_KEYS = [['company', 160], ['tradingAs', 120], ['regNo', 60], ['vatNo', 40], ['address', 400], ['email', 120], ['phone', 40], ['directors', 300], ['infoOfficer', 160], ['terms', 30000], ['privacy', 30000], ['complaints', 2000]];
  async function legal() {
    const l = (await app.store.kvGet('site:legal').catch(() => null)) || {}, land = await landing();
    const name = cfg.publicName || cfg.name || '';
    const out = { company: l.company || cfg.legalName || (/^regemarkfp$/i.test(name) ? 'RegemarkFP (Pty) Ltd' : name), tradingAs: l.tradingAs || '' };
    for (const [k] of LEGAL_KEYS) if (out[k] === undefined) out[k] = l[k] || '';
    out.email = out.email || land.email || ''; out.phone = out.phone || land.phone || '';
    // the terms: as typed here, else the booking team's quote and invoice terms and conditions (one place to keep them)
    if (!out.terms) { const t = await bookingTeam(land).catch(() => ''); if (t && app.invoices) out.terms = (await app.invoices.billing(t)).conditions || ''; }
    out.privacyStandard = !out.privacy;
    if (!out.privacy) out.privacy = Legal.privacy(out);
    out.year = new Date().getFullYear();
    return out;
  }
  r.add('GET', '/api/public/legal', async () => { if (app.isLocal) fail(404, 'Not on a production PC'); return legal(); });
  r.add('GET', '/api/site/legal', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can change the website'); const l = (await app.store.kvGet('site:legal').catch(() => null)) || {}; return { saved: l, shown: await legal() }; });
  r.add('PUT', '/api/site/legal', async (req) => {
    const user = await needUser(req);
    if (!siteAdmin(user)) fail(403, 'Only a site admin can change the website');
    const b = await readJson(req, 256 * 1024), out = {};
    for (const [k, n] of LEGAL_KEYS) out[k] = String(b[k] || '').trim().slice(0, n);
    await app.store.kvSet('site:legal', out);
    return { saved: out, shown: await legal() };
  });
  r.add('GET', '/api/public/landing', async (req) => {
    const l = await landing();
    const user = await auth.userFromReq(req).catch(() => null);
    return { site: cfg.publicName || cfg.name, title: l.title, about: l.about, services: l.services, email: l.email, phone: l.phone, dial: await dialOf(), image: l.image, googleClientId: cfg.google.clientId || '', bookingForm: await bookingForm(), reviews: l.showReviews !== false ? await app.bookings.testimonials() : null,
      me: user ? { name: user.data.name || '', email: user.data.email, image: user.data.image || '', teams: (await auth.teamsFor(user)).length } : null };
  });
  r.add('GET', '/api/site/landing', async (req) => {
    const user = await needUser(req);
    if (!siteAdmin(user)) fail(403, 'Only a site admin can change the website');
    const orgs = (await app.store.listType('org')).filter((o) => !o.deleted).map((o) => ({ id: o.id, name: o.data.name || '' }));
    const l = await landing();
    return { ...l, bookingTeam: l.bookingTeam || await bookingTeam(l), teams: orgs };
  });
  r.add('GET', '/api/site/booking-form', async (req) => {
    const user = await needUser(req);
    if (!siteAdmin(user)) fail(403, 'Only a site admin can change the website');
    return { form: await bookingForm(), standard: BookingForm.clean(BookingForm.DEFAULT), fields: BookingForm.CORE.map(([k, l]) => ({ k, l })), types: BookingForm.TYPES, services: (await landing()).services.map((x) => x.title) };
  });
  r.add('PUT', '/api/site/booking-form', async (req) => {
    const user = await needUser(req);
    if (!siteAdmin(user)) fail(403, 'Only a site admin can change the website');
    const b = await readJson(req, 256 * 1024);
    const form = BookingForm.clean(b.reset ? BookingForm.DEFAULT : b.form);
    await app.store.kvSet('site:bookingForm', form);
    return { form };
  });
  r.add('PUT', '/api/site/landing', async (req) => {
    const user = await needUser(req);
    if (!siteAdmin(user)) fail(403, 'Only a site admin can change the website');
    const b = await readJson(req);
    const str = (v, n) => String(v || '').slice(0, n);
    const out = { title: str(b.title, 160), about: str(b.about, 4000), email: str(b.email, 120), phone: str(b.phone, 40), image: str(b.image, 500), bookingTeam: str(b.bookingTeam, 80), googleReview: str(b.googleReview, 300), showReviews: b.showReviews !== false,
      services: (Array.isArray(b.services) ? b.services : []).slice(0, 12).map((x) => ({ title: str(x && x.title, 80), text: str(x && x.text, 400) })).filter((x) => x.title) };
    await app.store.kvSet('site:landing', out);
    return out;
  });
  r.add('POST', '/api/public/booking', async (req) => {
    if (app.isLocal) fail(404, 'Not on a production PC');
    auth.throttle(clientIp(req, true));
    const b = await readJson(req, 64 * 1024);
    if (String(b.website || '')) return { ok: true };        // a form-filling robot (hidden field)
    const str = (v, n) => String(v || '').trim().slice(0, n);
    const d = { status: 'New', name: str(b.name, 100), email: str(b.email, 120).toLowerCase(), phone: Phone.format(str(b.phone, 40), await dialOf()), organisation: str(b.organisation, 120), service: str(b.service, 80),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : '', venue: str(b.venue, 160), details: str(b.details, 4000), received: new Date().toISOString().slice(0, 16).replace('T', ' ') };
    // the rest of the form: times, town, how to reach them, budget, and the questions for this kind of job
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''), hm = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : '');
    Object.assign(d, { endDate: day(b.endDate) > d.date ? day(b.endDate) : '', startTime: hm(b.startTime), endTime: hm(b.endTime), town: str(b.town, 80),
      contactBy: str(b.contactBy, 40), budget: str(b.budget, 40), heard: str(b.heard, 60),
      answers: (Array.isArray(b.answers) ? b.answers : []).slice(0, 40).map((x) => ({ q: str(x && x.q, 80), a: str(x && x.a, 600) })).filter((x) => x.q && x.a) });
    if (!d.name) fail(400, 'Type your name');
    const bf = await bookingForm();
    for (const [k, lab] of BookingForm.CORE) if (bf.core[k] && bf.core[k].on && bf.core[k].req && !String(d[k] || '').trim()) fail(400, `Please fill in: ${bf.core[k].label || lab}`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email) && !d.phone) fail(400, 'Give an email address or a phone number so we can get back to you');
    const team = await bookingTeam(await landing());
    if (!team) fail(503, 'Bookings are not set up yet');
    d.trackKey = require('node:crypto').randomBytes(12).toString('base64url');
    const doc = await app.save(team, 'booking', newId('book_'), d, '');
    app.notify.bookingReceived(team, doc);
    return { ok: true, track: '/track/' + d.trackKey };
  });

  r.add('GET', '/api/public/c/:slug', async (req, res, p) => {
    const ch = await st.channelBySlug(String(p.slug).toLowerCase());
    if (!ch || ch.data.disabled || (ch.data.access || 'Public') !== 'Public') fail(404, 'There is no channel at this address');
    const user = await auth.userFromReq(req).catch(() => null);
    const brand = await st.branding(ch);
    const streams = (await pubCached('streams', 4000, () => st.publicStreams())).filter((s) => s.channel.id === ch.id);
    const subscribers = (await app.store.listType('user')).filter((u) => subsOf(u).includes(ch.id)).length;
    const vod = await app.vod.publicList(ch.id);
    const layout = ch.data.layout ? await app.cms.resolve(app.cms.clean(ch.data.layout), { channel: ch.id, vod, streams }) : null;
    return { channel: brand, subscribers, subscribed: subsOf(user).includes(ch.id), signedIn: !!user, streams, vods: vod.videos, series: vod.series, playlists: vod.playlists, layout };
  });
  r.add('POST', '/api/public/subscribe', async (req) => {
    const user = await needUser(req);
    const b = await readJson(req);
    const ch = await app.store.get(String(b.channel || ''));
    if (!ch || ch.deleted || ch.type !== 'channel') fail(404, 'Channel not found');
    const subs = new Set(subsOf(user));
    if (b.on === false) subs.delete(ch.id); else subs.add(ch.id);
    await app.save('', 'user', user.id, { ...user.data, subscriptions: [...subs] }, user.id);
    return { subscribed: subs.has(ch.id), subscriptions: [...subs] };
  });

  // ---- the online site: setting up a server of its own (Oracle or any Ubuntu VM) -------------------
  const siteAdmin = (user) => !app.isLocal && (cfg.siteAdmins || []).map((e) => normEmail(e)).includes(normEmail(user.data.email));
  const SETUP_HOURS = 24;
  async function setupToken(req) {
    // a home or cloud server that updates itself nightly uses its own update key (u=…) instead of a 24-hour link
    const u = qs(req).get('u') || '';
    if (u) {
      const keys = (await app.store.kvGet('server:updatekeys')) || [];
      const k = keys.find((x) => x.hash === sha(u));
      if (!k) fail(403, 'This server\'s update key is not known here any more. Make a setup command on the website (Settings → Server) and run it once.');
      return { by: k.by + ' (automatic update)' };
    }
    const t = qs(req).get('t') || '';
    const s = t && await app.store.kvGet('server:setup');
    if (!s || s.exp < Date.now() || s.hash !== sha(t)) fail(403, 'This setup link has expired. Make a new one on the website: Settings → Server.');
    return s;
  }
  if (!app.isLocal) {
    r.add('GET', '/api/server/setup', async (req) => {
      const user = await needUser(req);
      const s = await app.store.kvGet('server:setup');
      return { allowed: siteAdmin(user), siteAdmins: (cfg.siteAdmins || []).length, expires: s && s.exp > Date.now() ? s.exp : 0, by: s ? s.by : '', streaming: st.enabled(), health: st.health(), host: (cfg.streaming || {}).host || '' };
    });
    r.add('POST', '/api/server/setup', async (req) => {
      const user = await needUser(req);
      if (!siteAdmin(user)) fail(403, 'Only a site admin can set up a server. Add your email to SITE_ADMINS where this website runs (Render: Environment).');
      const t = 'st_' + require('node:crypto').randomBytes(18).toString('hex');
      const exp = Date.now() + SETUP_HOURS * 3600e3;
      await app.store.kvSet('server:setup', { hash: sha(t), exp, by: user.data.email });
      const site = (cfg.publicUrl || ((req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')) + '://' + req.headers.host)).replace(/\/+$/, '');
      return { expires: exp, command: `curl -fsSL ${site}/server/install.sh | sudo bash -s -- --from ${site} --token ${t}` };
    });
    r.add('DELETE', '/api/server/setup', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can do this'); await app.store.kvSet('server:setup', null); return {}; });
    // a server set up with a setup link asks once for its own update key, so it can update itself from then on
    r.add('GET', '/api/server/update-key', async (req, res) => {
      if (qs(req).get('u')) fail(403, 'An update key cannot make another one');
      const s = await setupToken(req);
      const key = 'su_' + require('node:crypto').randomBytes(24).toString('hex');
      const keys = ((await app.store.kvGet('server:updatekeys')) || []).slice(-9);
      keys.push({ hash: sha(key), by: s.by || '', at: Date.now(), ip: clientIp(req, true) });
      await app.store.kvSet('server:updatekeys', keys);
      log(`Server setup: update key given to a server at ${clientIp(req, true)} (link made by ${s.by})`);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(key + '\n');
    });
    r.add('DELETE', '/api/server/update-keys', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can do this'); await app.store.kvSet('server:updatekeys', []); return {}; });
    r.add('GET', '/api/server/bundle.tgz', async (req, res) => {
      await setupToken(req);
      const tb = require('./tarball'); const buf = await tb.bundle(app.root, 'rfp-manager', tb.PC_PARTS);
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    r.add('GET', '/api/server/env', async (req, res) => {
      const s = await setupToken(req);
      // what the new server needs to use the same database and Google sign-in as this website
      const lines = { MODE: 'cloud', MONGODB_URI: cfg.mongo.uri, MONGODB_DB: cfg.mongo.db, GOOGLE_CLIENT_ID: cfg.google.clientId || '', ALLOW_SIGNUP: cfg.allowSignup ? 'true' : 'false',
        SITE_ADMINS: (cfg.siteAdmins || []).join(','), SITE_NAME: cfg.name || '', PUBLIC_NAME: cfg.publicName || '',
        ...(cfg.mail && cfg.mail.provider ? { MAIL_PROVIDER: cfg.mail.provider, MAIL_FROM: cfg.mail.from || '', ...(cfg.mail.apiKey ? { MAIL_API_KEY: cfg.mail.apiKey } : {}), ...(cfg.mail.smtp ? { SMTP_URL: cfg.mail.smtp } : {}) } : {}),
        ...(cfg.payfast && cfg.payfast.merchantId ? { PAYFAST_MERCHANT_ID: cfg.payfast.merchantId, PAYFAST_MERCHANT_KEY: cfg.payfast.merchantKey || '', ...(cfg.payfast.passphrase ? { PAYFAST_PASSPHRASE: cfg.payfast.passphrase } : {}), PAYFAST_SANDBOX: cfg.payfast.sandbox ? 'true' : 'false' } : {}) };
      log(`Server setup: settings handed to a new server at ${clientIp(req, true)} (link made by ${s.by})`);
      const body = Object.entries(lines).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]/g, '')}`).join('\n') + '\n';
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    });
  }

  // ---- updates: the website says which version it runs and hands it to linked PCs; the PC asks, then installs
  let updateBundle = null;                       // { version, buf }
  r.add('GET', '/api/update/info', async () => {
    let android = null;
    try { android = JSON.parse(require('node:fs').readFileSync(require('node:path').join(app.root, 'public/app/rfp-manager.json'), 'utf8')); } catch { /* no APK built yet */ }
    return { version: app.version, release: app.release, pc: !app.isLocal, android };
  });
  r.add('GET', '/api/update/bundle.tgz', async (req, res) => {
    if (app.isLocal) fail(404, 'Updates come from the website');
    if (!(await auth.keyUser(auth.bearer(req)))) fail(401, 'This needs the machine key of a linked PC');
    if (!updateBundle || updateBundle.version !== app.version) { const tb = require('./tarball'); updateBundle = { version: app.version, buf: await tb.bundle(app.root, 'rfp-manager', tb.PC_PARTS) }; }
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': updateBundle.buf.length, 'Cache-Control': 'no-store' });
    res.end(updateBundle.buf);
  });
  r.add('GET', '/api/update', async (req) => { await needUser(req); return app.updates.status(); });
  // ---- timing systems (photo finish, timers) → athletics, on the production PC
  const needTiming = async (req) => { const u = await needUser(req); if (!app.isLocal) fail(400, 'Timing systems connect to RFP Manager on the production PC. Open the scorer there.'); return u; };
  r.add('GET', '/api/timing', async (req) => { await needTiming(req); return app.timing.status(); });
  r.add('PUT', '/api/timing', async (req) => { await needTiming(req); return app.timing.save(await readJson(req, 256 * 1024)); });
  r.add('GET', '/api/timing/ports', async (req) => { await needTiming(req); return { ports: await app.timing.ports() }; });
  r.add('POST', '/api/timing/preview', async (req) => { await needTiming(req); const b = await readJson(req, 512 * 1024); return { lines: app.timing.preview(b.input, String(b.text || '')) }; });
  r.add('POST', '/api/timing/inject', async (req) => { await needTiming(req); const b = await readJson(req, 512 * 1024); const out = app.timing.inject(String(b.input || ''), String(b.text || '')); await app.timing.flush(); return out; });
  r.add('POST', '/api/update/check', async (req) => { await needUser(req); return app.updates.check(); });
  r.add('POST', '/api/update/install', async (req) => {
    await needMachineAdmin(req);
    const st = app.updates.status();
    if (!st.available) fail(400, 'This PC already has the newest version');
    return app.updates.install();
  });

  // ---- Rocket League (lib/rocket.js, the production PC): settings, operator actions; the pages use /rl/ws
  const needRl = async (req) => { const user = await needUser(req); if (!app.rocket || !app.rocket.on) fail(400, 'Rocket League graphics run on the production PC'); return user; };
  r.add('GET', '/api/rl', async (req) => { await needRl(req); return app.rocket.view(); });
  r.add('POST', '/api/rl/control', async (req) => { await needRl(req); return { control: await app.rocket.patch(await readJson(req, 2 * 1024 * 1024)) }; });
  r.add('POST', '/api/rl/action', async (req) => { await needRl(req); const b = await readJson(req, 8192); return b.method ? app.rocket.run(b.method, b.target).then(() => ({ ok: true })) : app.rocket.action(String(b.name || ''), b); });

  // ---- the production PC: graphics actions that came through the website (Adverts screen)
  r.add('POST', '/api/gfx', async (req) => {
    const user = await needUser(req);
    if (!app.gfx || !app.gfxAction) fail(400, 'Graphics run on the production PC');
    const b = await readJson(req);
    return app.gfxAction(user, String(b.team || ''), b);
  });

  // ---- the production PC: link to the website by signing in there (no keys to copy)
  let linking = null;          // { url, code, secret, approveUrl, at, error }
  async function linkStart(url) {
    url = String(url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+/.test(url)) fail(400, 'The website address should start with https://');
    let res;
    try { res = await fetch(url + '/api/pair/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify({ name: cfg.machineName || require('node:os').hostname() }), signal: AbortSignal.timeout(60000) }); }
    catch (e) { fail(502, 'Could not reach ' + url + ' (' + (e.cause && e.cause.code ? e.cause.code : e.message) + '). A free website can take up to a minute to wake up: try again.'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) fail(502, j.error || 'The website said ' + res.status + '. Is it RFP Manager 0.16 or newer?');
    linking = { url, code: j.code, secret: j.secret, approveUrl: j.approveUrl && /^https?:/.test(j.approveUrl) ? j.approveUrl : url + '/app#/link/' + j.code, at: Date.now(), error: '' };
    const mine = linking;
    (async () => {
      while (linking === mine && Date.now() - mine.at < 15 * 60000) {
        await new Promise((r2) => setTimeout(r2, 2000));
        if (linking !== mine) return;
        try {
          const pr = await fetch(url + '/api/pair/poll', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify({ code: mine.code, secret: mine.secret }), signal: AbortSignal.timeout(20000) });
          const pj = await pr.json().catch(() => ({}));
          if (!pr.ok) { mine.error = pj.error || 'The link code expired'; return; }
          if (pj.key) { await linkCloud(url, pj.key); mine.done = true; mine.by = pj.by || ''; log(`Linked to ${url} (approved by ${pj.by || 'an Admin'})`); return; }
        } catch (e) { mine.error = ''; /* a hiccup: keep trying */ }
      }
      if (linking === mine && !mine.done) mine.error = mine.error || 'Nobody approved the link in time. Start again.';
    })();
    return linkView();
  }
  const linkView = () => ({ pending: linking && !linking.done && !linking.error ? { code: linking.code, url: linking.url, approveUrl: linking.approveUrl } : null, done: !!(linking && linking.done), by: linking ? linking.by || '' : '', error: linking ? linking.error : '',
    linked: !!(app.sync && app.sync.linked()), url: cfg.cloud.url || '', users: 0 });
  r.add('POST', '/api/link/start', async (req) => {
    if (!app.isLocal) fail(400, 'Only a production PC links to the website');
    if (!(await needsSetup())) await needMachineAdmin(req);
    return linkStart((await readJson(req)).url);
  });
  r.add('GET', '/api/link/status', async (req) => {
    if (!app.isLocal) fail(400, 'Only a production PC links to the website');
    if (!(await needsSetup()) && !(linking && linking.done)) await needMachineAdmin(req);
    return { ...linkView(), users: (await app.store.listType('user')).length, sync: app.sync.status() };
  });
  // link (or link again) with the Google account signed in on this PC: the website gives this PC its own key for
  // that person if they are an Admin there. No codes, no keys to copy.
  r.add('POST', '/api/link/google', async (req) => {
    if (!app.isLocal) fail(400, 'Only a production PC links to the website');
    if (!(await needsSetup())) await needMachineAdmin(req);
    auth.throttle(clientIp(req, true));
    const b = await readJson(req);
    const url = String(b.url || '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/[^\s/]+/.test(url)) fail(400, 'The website address should start with https://');
    if (url && url !== cfg.cloud.url) cfg.cloud = { url, key: '' };       // tried first; linkWithWebsite keeps it only when it works
    await linkWithWebsite('/api/pair/google', { credential: b.credential });
    learnGoogle();
    return { linked: true, url: cfg.cloud.url, sync: app.sync.status() };
  });
  r.add('POST', '/api/link/cancel', async (req) => { if (!(await needsSetup())) await needMachineAdmin(req); linking = null; return linkView(); });

  r.add('POST', '/api/mail/test', async (req) => { const user = await needUser(req); auth.throttle(clientIp(req, !app.isLocal)); return app.mail.test(user.data.email); });
  r.add('POST', '/api/me', async (req) => {
    const user = await needUser(req);
    if (app.sync && app.sync.linked()) fail(400, 'This machine is linked to the website. Change your name or password there and it will sync down.');
    const b = await readJson(req);
    const data = { ...user.data };
    if (b.name !== undefined) data.name = String(b.name).slice(0, 80);
    if (b.phone !== undefined) data.phone = Phone.format(String(b.phone).slice(0, 40), await dialOf());
    if (b.emailOff !== undefined) data.emailOff = !!b.emailOff;
    if (b.emailNoNew !== undefined) data.emailNoNew = !!b.emailNoNew;
    if (b.image !== undefined && /^(img_[\w-]+|https:\/\/[^\s"']{1,500})?$/.test(String(b.image))) data.image = String(b.image);
    if (b.versePrefs && typeof b.versePrefs === 'object') {          // verse of the day: on or off, the translation, when the day turns over
      const v = b.versePrefs;
      data.versePrefs = { on: v.on !== false, translation: /^(local|api|site):[\w.-]{1,70}$/.test(String(v.translation || '')) ? String(v.translation) : '', time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v.time || '')) ? String(v.time) : '00:00' };
    }
    // Admins: the terms (their email is shared with the website's superuser) and the marketing opt-out
    if (b.acceptTerms === true) data.superTerms = { version: require('./super').TERMS_VERSION, at: new Date().toISOString() };
    if (b.marketingOptOut !== undefined) data.marketingOptOut = !!b.marketingOptOut;
    if (b.password) {
      if (String(b.password).length < 8) fail(400, 'Use a password of at least 8 characters');
      if (data.passwordHash && !checkPassword(b.currentPassword || '', data.passwordHash)) fail(403, 'Your current password is wrong');
      data.passwordHash = hashPassword(b.password);
    }
    return { user: pubUser(await app.save('', 'user', user.id, data, user.id)) };
  });

  // ---- production teams + members -------------------------------------------------------------
  // ---- the superuser page (analytics.<website> or /super): its own sign-in, see lib/super.js
  if (!app.isLocal && app.superUser) {
    const su = app.superUser;
    r.add('GET', '/api/super/me', async (req) => { const s = await su.session(req); return { email: s ? s.email : '' }; });
    r.add('POST', '/api/super/login', async (req, res) => { auth.throttle(clientIp(req, true)); return su.login(req, res, await readJson(req)); });
    r.add('POST', '/api/super/logout', async (req, res) => su.logout(req, res));
    r.add('POST', '/api/super/reset', async (req) => { auth.throttle(clientIp(req, true)); return su.requestReset(req, await readJson(req)); });
    r.add('POST', '/api/super/password', async (req, res) => { auth.throttle(clientIp(req, true)); return su.setPassword(req, res, await readJson(req)); });
    r.add('GET', '/api/super/overview', async (req) => { await su.need(req); return su.overview(); });
    r.add('GET', '/api/super/nas', async (req) => { await su.need(req); return su.nas(); });
    r.add('GET', '/api/super/nas/users', async (req) => { await su.need(req); return su.nasUsers(); });
    r.add('POST', '/api/super/nas/users/:action', async (req, res, p) => { const s = await su.need(req); const b = await readJson(req); log(`Universe: ${s.email} NAS user ${p.action} ${String(b.name || '').slice(0, 40)}`); return su.nasUser(p.action, b); });
    const sq = (req) => new URL(req.url, 'http://x').searchParams;
    r.add('GET', '/api/super/files', async (req) => { await su.need(req); return su.files.list(sq(req).get('path') || ''); });
    r.add('GET', '/api/super/files/get', async (req, res) => { await su.need(req); await su.files.download(req, res, sq(req).get('path') || '', sq(req).get('inline') === '1'); });
    r.add('POST', '/api/super/files/upload', async (req) => { await su.need(req); return su.files.upload(req, sq(req).get('path') || '', sq(req).get('name') || ''); });
    r.add('POST', '/api/super/files/mkdir', async (req) => { await su.need(req); const b = await readJson(req); return su.files.mkdir(b.path, b.name); });
    r.add('POST', '/api/super/files/rename', async (req) => { await su.need(req); const b = await readJson(req); return su.files.rename(b.path, b.to); });
    r.add('POST', '/api/super/files/delete', async (req) => { await su.need(req); const b = await readJson(req); return su.files.remove(b.path); });
    r.add('GET', '/api/super/contacts.csv', async (req, res) => {
      await su.need(req);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="company-admins.csv"', 'Cache-Control': 'no-store' });
      res.end(await su.contactsCsv());
    });
  }
  r.add('POST', '/api/orgs', async (req) => {
    const user = await needUser(req);
    if (bridge) onlyOnline('Production teams');
    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) fail(400, 'Give the production team a name');
    await app.domain.uniqueTeamName(name);
    const id = newId('org_');
    await app.save(id, 'org', id, { name, accentColor: '#00ff82', currency: 'ZAR' }, user.id);
    await app.save(id, 'member', memberIdFor(id, user.data.email), { email: normEmail(user.data.email), name: user.data.name || '', role: 'Admin' }, user.id);
    return { id };
  });

  // Two teams that should be one: everything of one team moves into the other (an Admin of both).
  r.add('POST', '/api/orgs/:id/merge', async (req, res, p) => {
    if (bridge) onlyOnline('Production teams');
    const user = await needUser(req);
    const into = p.id, from = String((await readJson(req)).from || '');
    if (!from || from === into) fail(400, 'Pick the other production team');
    for (const t of [into, from]) if ((await auth.roleIn(user, t)) !== 'Admin') fail(403, 'You must be an Admin of both production teams');
    const orgFrom = await app.store.get(from);
    const stamp = (d) => Math.max(Date.now(), d.updatedAt + 1);
    let moved = 0;
    for (const d of await app.store.listTeam(from)) {
      if (d.deleted || d.type === 'org') continue;
      if (d.type === 'member') {
        const nid = memberIdFor(into, d.data.email), cur = await app.store.get(nid);
        if (!cur || cur.deleted) await app.save(into, 'member', nid, d.data, user.id);
        // the old membership ends; kept under the team it moved to so linked PCs hear of it
        await app.put({ ...d, team: into, data: {}, deleted: true, updatedAt: stamp(d), updatedBy: user.id });
        continue;
      }
      await app.put({ ...d, team: into, updatedAt: stamp(d), updatedBy: user.id });
      moved++;
    }
    await app.put({ ...orgFrom, team: into, data: { ...orgFrom.data, mergedInto: into }, deleted: true, updatedAt: stamp(orgFrom), updatedBy: user.id });
    log(`Production team "${orgFrom.data.name}" merged into "${((await app.store.get(into)) || { data: {} }).data.name}" by ${user.data.email} (${moved} records)`);
    return { moved };
  });

  const admins = async (team) => (await app.store.list(team, 'member')).filter((m) => m.data.role === 'Admin');

  r.add('POST', '/api/members', async (req) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.admin, 'Only an Admin can manage members');
    const b = await readJson(req);
    const email = normEmail(b.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (!Schema.ROLES.includes(b.role)) fail(400, 'Pick a role');
    const id = memberIdFor(team, email);
    const cur = await app.store.get(id);
    // on the bridge PC an Admin may only give an existing member a password for this PC (venues without internet)
    if (bridge && (!cur || cur.deleted || cur.data.role !== b.role || !b.password)) onlyOnline('Members and roles');
    if (bridge) {
      if (String(b.password).length < 8) fail(400, 'Use a password of at least 8 characters');
      const u = await auth.userByEmail(email);
      await auth.ensureUser({ email, name: String((u && u.data.name) || cur.data.name || '').slice(0, 80), passwordHash: hashPassword(b.password) });
      return { doc: cur };
    }
    if (cur && !cur.deleted && cur.data.role === 'Admin' && b.role !== 'Admin' && (await admins(team)).length <= 1) fail(400, 'A production team needs at least one Admin');
    if (b.password) {
      if (!app.isLocal) fail(400, 'Online, people sign in with their own Google account. Passwords can only be set on a production PC.');
      if (String(b.password).length < 8) fail(400, 'Use a password of at least 8 characters');
      const u = await auth.userByEmail(email);
      const localOnly = app.isLocal && !(app.sync && app.sync.linked());
      if (u && (u.data.passwordHash || u.data.googleSub) && !localOnly) fail(409, 'That person already has an account and can sign in with it');
      await auth.ensureUser({ email, name: String(b.name || '').slice(0, 80), passwordHash: hashPassword(b.password) });
    }
    const extra = {};
    if (b.role === 'Coach') {
      const clubs = (Array.isArray(b.clubs) ? b.clubs : (cur && cur.data.clubs) || []).map(String);
      for (const c of clubs) { const d = await app.store.get(c); if (!d || d.deleted || d.team !== team || d.type !== 'club') fail(400, 'Pick clubs of this production team'); }
      extra.clubs = clubs;
    }
    if (b.role === 'Official') extra.officialName = String(b.officialName !== undefined ? b.officialName : (cur && cur.data.officialName) || '').trim().slice(0, 80);
    const isNew = !cur || cur.deleted;
    const known = await auth.userByEmail(email);
    if (known && known.data.image && /^https:/.test(known.data.image)) extra.image = known.data.image;
    const mdoc = await app.save(team, 'member', id, { email, name: String(b.name || (cur && cur.data.name) || (known && known.data.name) || '').slice(0, 80), role: b.role, ...extra }, user.id);
    app.notify.memberAdded(team, mdoc, user, isNew);
    return { doc: mdoc };
  });

  // the invitation email again, with a fresh 14-day link
  r.add('POST', '/api/members/:id/invite', async (req, res, p) => {
    const team = qs(req).get('team');
    if (app.isLocal) onlyOnline('Invitations');
    const { user } = await needRole(req, team, Schema.CAN.admin, 'Only an Admin can invite members');
    const cur = await app.store.get(p.id);
    if (!cur || cur.deleted || cur.team !== team || cur.type !== 'member') fail(404, 'Member not found');
    if (!app.mail.enabled()) fail(409, 'Email is not set up on this website (Settings → Server → Email)');
    auth.throttle('invite:' + user.id);
    app.notify.resendInvite(team, cur, user);
    await app.notify.idle();
    return { sent: cur.data.email };
  });

  r.add('DELETE', '/api/members/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    if (bridge) onlyOnline('Members and roles');
    const { user } = await needRole(req, team, Schema.CAN.admin, 'Only an Admin can manage members');
    const cur = await app.store.get(p.id);
    if (!cur || cur.team !== team || cur.type !== 'member') fail(404, 'Member not found');
    if (cur.data.role === 'Admin' && (await admins(team)).length <= 1) fail(400, 'A production team needs at least one Admin');
    await app.remove(p.id, user.id);
    return {};
  });

  // the verse of the day: on the person's own day (?date=, from their computer) in their translation (?t=, else their setting)
  r.add('GET', '/api/verse', async (req) => {
    const user = await needUser(req), q = qs(req), p = user.data.versePrefs || {};
    const d = q.get('date') || '', now = Date.now();
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && Math.abs(Date.parse(d + 'T12:00:00Z') - now) < 2 * 86400e3;     // a day either side (time zones)
    return app.verse.today(ok ? d : undefined, q.get('t') || p.translation || '');
  });
  r.add('GET', '/api/verse/translations', async (req) => { await needUser(req); return { list: await app.verse.translations() }; });
  // ---- software on the website (lib/software.js): products, their GitHub releases copied here, downloads
  const needSiteAdmin2 = async (req) => { const user = await needUser(req); if (app.isLocal || !siteAdmin(user)) fail(403, 'Only a site admin can manage the software'); return user; };
  r.add('GET', '/api/public/software', async (req) => {
    if (app.isLocal) return { list: [] };
    const user = await auth.userFromReq(req).catch(() => null);
    return { list: await Promise.all((await app.software.products()).map((p) => app.software.view(p, user).then((v) => ({ ...v, releases: v.releases.slice(0, 1) })))) };
  });
  r.add('GET', '/api/public/software/:slug', async (req, res, p) => {
    const user = await auth.userFromReq(req).catch(() => null);
    const prod = await app.software.product(p.slug);
    if (!prod || prod.visible === false) fail(404, 'No such app');
    return app.software.view(prod, user);
  });
  // the apps' own update check: GET /api/software/<slug>/latest
  r.add('GET', '/api/software/:slug/latest', async (req, res, p) => app.software.latest(p.slug, String(cfg.publicUrl || '').replace(/\/+$/, '') || `https://${req.headers.host}`));
  r.add('GET', '/download/:slug/:tag/:name', async (req, res, p) => {
    if (app.isLocal) fail(404, 'Not here');
    const user = await auth.userFromReq(req).catch(() => null);
    const f = await app.software.file(p.slug, p.tag, p.name, user);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.size, 'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': `attachment; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"` });
    await require('node:stream/promises').pipeline(require('node:fs').createReadStream(f.path), res).catch(() => {});
  });
  r.add('GET', '/api/software', async (req) => { await needSiteAdmin2(req); return { list: await Promise.all((await app.software.products({ all: true })).map(async (x) => ({ ...(await app.software.view(x, null)), access: x.access }))), folder: app.software.root() }; });
  r.add('POST', '/api/software', async (req) => { await needSiteAdmin2(req); const b = await readJson(req); const out = await app.software.saveProduct(b, b.id || ''); if (out.repo) app.software.sync(out.slug).catch(() => {}); return { product: out }; });
  r.add('DELETE', '/api/software/:id', async (req, res, p) => { await needSiteAdmin2(req); await app.software.removeProduct(p.id); return { ok: true }; });
  r.add('POST', '/api/software/:slug/sync', async (req, res, p) => { await needSiteAdmin2(req); return app.software.sync(p.slug); });

  // ---- Bibles kept by the website (lib/sitebibles.js): everyone's verse of the day, also on production PCs
  r.add('GET', '/api/public/bibles', async () => (app.isLocal ? { list: [] } : { list: (await app.siteBibles.list()).map((b) => ({ id: b.id, name: b.name, language: b.language, copyright: b.copyright })) }));
  r.add('GET', '/api/public/verse', async (req) => {
    if (app.isLocal) fail(404, 'Not here');
    const q = qs(req), d = q.get('date') || '', t = String(q.get('t') || '');
    if (!/^site:[\w-]{3,70}$/.test(t)) fail(400, 'Which Bible?');
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && Math.abs(Date.parse(d + 'T12:00:00Z') - Date.now()) < 2 * 86400e3;
    return app.verse.today(ok ? d : undefined, t);
  });
  const needSiteAdmin = async (req) => { const user = await needUser(req); if (app.isLocal || !siteAdmin(user)) fail(403, 'Only a site admin can manage the website\'s Bibles'); return user; };
  r.add('GET', '/api/bibles/site', async (req) => { await needSiteAdmin(req); return { list: await app.siteBibles.list() }; });
  r.add('GET', '/api/bibles/catalog', async (req) => { await needSiteAdmin(req); return { list: await app.siteBibles.catalog() }; });
  r.add('POST', '/api/bibles/site', async (req) => {
    const user = await needSiteAdmin(req);
    const b = await readJson(req, 40 * 1024 * 1024);
    if (b.confirm !== true) fail(400, 'Confirm that the website may use this translation (most modern translations are under copyright)');
    const by = user.data.name || user.data.email;
    const out = b.file ? await app.siteBibles.addFromBeblia(String(b.file), { by }) : await app.siteBibles.addFromFile(String(b.name || ''), String(b.text || ''), { language: b.language, copyright: b.copyright, by });
    return { bible: out };
  });
  r.add('DELETE', '/api/bibles/site/:id', async (req, res, p) => { await needSiteAdmin(req); await app.siteBibles.remove(p.id); return { ok: true }; });

  // ---- a crew member's gigs: upcoming, what they earned in the last 30 days and what they are still owed
  r.add('GET', '/api/crew/me', async (req) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.read);
    const email = normEmail(user.data.email);
    const mine = new Set((await app.store.list(team, 'crewMember')).filter((c) => !c.deleted && normEmail(c.data.email || '') === email).map((c) => c.id));
    const today = new Date().toISOString().slice(0, 10), since = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
    const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
    const gigs = [];
    for (const p of await app.store.list(team, 'production')) {
      if (p.deleted || !p.data.date) continue;
      const days = Math.max(1, Number(p.data.days) || 1), last = addDays(p.data.date, days - 1);
      for (const row of p.data.crew || []) {
        if (!mine.has(row.crewMember)) continue;
        const role = row.role ? await app.store.get(row.role) : null, venue = p.data.venue ? await app.store.get(p.data.venue) : null;
        const rate = Number(row.rate) || Number(role && role.data.rate) || 0;
        gigs.push({ production: p.id, name: p.data.name, date: p.data.date, last, days, venue: venue ? venue.data.name : '', role: role ? role.data.name : '', location: row.location || '', callTime: row.callTime || '', txTime: row.productionTime || p.data.txTime || '', pay: rate * days, paid: !!row.paid });
      }
    }
    gigs.sort((a, b) => a.date.localeCompare(b.date));
    const expenses = (await app.store.list(team, 'expense')).filter((x) => !x.deleted && x.data.submittedBy === email);
    const owedExpenses = expenses.filter((x) => x.data.status === 'Approved').reduce((s, x) => s + (Number(x.data.amount) || 0), 0);
    const done = gigs.filter((g) => g.last <= today);
    return {
      linked: mine.size > 0, upcoming: gigs.filter((g) => g.last >= today), past: done.slice(-20).reverse(),
      earned30: done.filter((g) => g.last >= since).reduce((s, g) => s + g.pay, 0),
      owed: done.filter((g) => !g.paid).reduce((s, g) => s + g.pay, 0) + owedExpenses, owedGigs: done.filter((g) => !g.paid).length, owedExpenses,
    };
  });

  // ---- coaches, officials, team sheets, results, expenses ---------------------------------------
  async function memberOf(user, team) { return (await app.store.find('member', 'email', normEmail(user.data.email))).find((m) => m.team === team && !m.deleted) || null; }
  async function coachClubs(user, team) { const m = await memberOf(user, team); return new Set((m && m.data.role === 'Coach' && m.data.clubs) || []); }
  // A coach may change their own clubs, those clubs' teams, and players: new ones, or ones in their teams.
  async function coachMay(user, team, type, cur, data) {
    const clubs = await coachClubs(user, team);
    if (!clubs.size) return false;
    if (type === 'club') return !!cur && clubs.has(cur.id);
    if (type === 'squad') return clubs.has(String(data.club || '')) && (!cur || clubs.has(String(cur.data.club || '')));
    if (type === 'player') {
      if (!cur) return true;
      if (cur.data.addedBy === user.data.email) return true;
      return (await app.store.list(team, 'squad')).some((s) => clubs.has(String(s.data.club || '')) && (s.data.players || []).some((r) => r.player === cur.id));
    }
    return false;
  }
  async function fixtureFor(req, team, id) {
    const f = await app.store.get(id);
    if (!f || f.deleted || f.team !== team || f.type !== 'fixture') fail(404, 'Match not found');
    return f;
  }
  // the squad a coach (or a producer) picks for one match
  r.add('PUT', '/api/fixtures/:id/teamsheet', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user, role } = await needRole(req, team, Schema.CAN.read);
    const f = await fixtureFor(req, team, p.id);
    const b = await readJson(req);
    const squad = String(b.squad || '');
    if (![f.data.team1, f.data.team2].includes(squad)) fail(400, 'That team is not playing in this match');
    if (!Schema.CAN.edit(role)) {
      const sq = await app.store.get(squad);
      if (role !== 'Coach' || !sq || !(await coachClubs(user, team)).has(String(sq.data.club || ''))) fail(403, 'Only the team\'s coach or a Producer can pick this team sheet');
    }
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 60).map((r) => ({ player: String(r.player || ''), number: String(r.number || '').slice(0, 4), position: String(r.position || '').slice(0, 30), captain: !!r.captain, bench: !!r.bench })).filter((r) => r.player);
    const sheets = { ...(f.data.teamSheets || {}), [squad]: { rows, by: user.data.name || user.data.email, at: Date.now() } };
    return { doc: await app.save(team, 'fixture', f.id, { ...f.data, teamSheets: sheets }, user.id) };
  });
  // an official confirms the result after the game
  r.add('PUT', '/api/fixtures/:id/report', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user, role } = await needRole(req, team, Schema.CAN.read);
    const f = await fixtureFor(req, team, p.id);
    if (!Schema.CAN.edit(role)) {
      const m = await memberOf(user, team);
      if (role !== 'Official' || !Schema.officiates(f.data, (m && m.data.officialName) || user.data.name)) fail(403, 'Only an official of this match or a Producer can submit its result');
    }
    const b = await readJson(req);
    const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? '' : Number(v));
    const report = { scoreA: num(b.scoreA), scoreB: num(b.scoreB), cards: String(b.cards || '').slice(0, 2000), notes: String(b.notes || '').slice(0, 4000), confirmed: b.confirmed !== false, by: user.data.name || user.data.email, byEmail: user.data.email, at: Date.now() };
    const saved = await app.save(team, 'fixture', f.id, { ...f.data, officialReport: report }, user.id);
    app.notify.reportConfirmed(team, saved);
    return { doc: saved };
  });
  // anyone in the team (not coaches or officials) adds an expense with its receipt; Producers approve
  r.add('POST', '/api/expenses', async (req) => {
    const team = qs(req).get('team');
    if (bridge) onlyOnline('Expenses');
    const { user, role } = await needRole(req, team, (r0) => !Schema.ROLE_SEES[r0], 'Coaches and officials cannot add production expenses');
    const b = await readJson(req);
    const d = b.data || {};
    const id = String(b.id || newId('expense_'));
    const cur = await app.store.get(id);
    if (cur && !cur.deleted && (cur.team !== team || cur.type !== 'expense')) fail(409, 'That id belongs to another record');
    if (cur && !cur.deleted && !Schema.CAN.edit(role) && (cur.data.submittedBy !== user.data.email || cur.data.status !== 'Submitted')) fail(403, 'Only a Producer can change an expense once it has been approved');
    const prod = await app.store.get(String(d.production || ''));
    if (!prod || prod.deleted || prod.team !== team || prod.type !== 'production') fail(400, 'Pick the production');
    if (!String(d.description || '').trim()) fail(400, 'Say what it was for');
    if (!(Number(d.amount) > 0)) fail(400, 'Enter the amount');
    const data = { ...d, status: Schema.CAN.edit(role) && d.status ? d.status : (cur && !cur.deleted ? cur.data.status : 'Submitted') };
    const saved = await app.write(team, 'expense', id, data, user.id);
    app.notify.expenseSaved(team, cur && !cur.deleted ? cur : null, saved, user);
    return { doc: saved };
  });

  // ---- records --------------------------------------------------------------------------------
  r.add('GET', '/api/docs', async (req) => {
    const team = qs(req).get('team');
    const { role } = await needRole(req, team, Schema.CAN.read);
    const user = await needUser(req);
    return { docs: (await app.store.listTeam(team)).map((d) => viewDoc(d, role, user)).filter(Boolean), now: Date.now() };
  });

  r.add('PUT', '/api/docs/:type/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    const isOrg = p.type === 'org';
    if (!isOrg && !Schema.ENTITIES[p.type]) fail(400, 'Unknown record type');
    if (!pcMayEdit(p.type)) onlyOnline(isOrg ? 'Team settings' : Schema.ENTITIES[p.type].plural);
    const { user, role } = await needRole(req, team, Schema.CAN.read);
    if (!/^[\w-]{6,80}$/.test(p.id) || (isOrg && p.id !== team)) fail(400, 'Bad record id');
    const b = await readJson(req);
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) fail(400, 'No data');
    const cur = await app.store.get(p.id);
    if (cur && (cur.team !== team || cur.type !== p.type)) fail(409, 'That id belongs to another record');
    if (isOrg ? !Schema.CAN.admin(role) : !Schema.CAN.edit(role)) {
      if (isOrg) fail(403, 'Only an Admin can change team settings');
      if (!(role === 'Coach' && await coachMay(user, team, p.type, cur && !cur.deleted ? cur : null, b.data))) fail(403, role === 'Coach' ? 'Coaches can change their own clubs, teams and players only' : 'You need the Producer role to edit this');
      if (p.type === 'player') b.data.addedBy = (cur && !cur.deleted && cur.data.addedBy) || user.data.email;
    }
    if (p.type === 'booking') {
      // Admins assign a Producer; that Producer (only) works on it. Accepting / declining goes through /respond.
      const mine = cur && !cur.deleted && String(cur.data.producer || '').toLowerCase() === String(user.data.email || '').toLowerCase();
      if (!Schema.CAN.admin(role) && !mine) fail(403, 'This booking is not allocated to you');
      if (!Schema.CAN.admin(role)) { b.data.producer = cur.data.producer; b.data.status = cur.data.status; b.data.production = cur.data.production || ''; }
      else if (b.data.producer && (!cur || cur.data.producer !== b.data.producer) && ['New', 'Declined by producer', '', undefined].includes(b.data.status)) b.data.status = 'Assigned';
    }
    // the people on a client's portal are kept by the portal (their links): an edit in the Studio never drops them
    if (p.type === 'releaseForm' && app.releases) await app.releases.prepare(team, cur, b.data);
    if (p.type === 'client') { if (cur && !cur.deleted && cur.data.portalUsers) b.data.portalUsers = cur.data.portalUsers; else delete b.data.portalUsers; }
    for (const f of Schema.fieldsFor(p.type, null)) if (f.req && !String(b.data[f.k] === undefined || b.data[f.k] === null ? '' : b.data[f.k]).trim()) fail(400, `${f.l} is required`);
    const saved = await app.write(team, p.type, p.id, b.data, user.id);
    const before = cur && !cur.deleted ? cur : null;
    if (p.type === 'production') app.notify.productionSaved(team, before, saved);
    if (p.type === 'releaseForm' && app.releases) await app.releases.linked(team, saved);
    if (p.type === 'client' && !app.isLocal && app.portal && !saved.deleted) app.portal.welcome(saved).catch((e) => log('Portal welcome:', e.message));
    if (p.type === 'fixture') app.notify.fixtureSaved(team, before, saved);
    if (p.type === 'expense') app.notify.expenseSaved(team, before, saved, user);
    if (p.type === 'booking') app.notify.bookingSaved(team, before, saved, user);
    return { doc: saved };
  });

  // the allocated Producer accepts (a production is made for it) or declines a booking request
  r.add('POST', '/api/bookings/:id/respond', async (req, res, p) => {
    const team = qs(req).get('team');
    if (bridge) onlyOnline('Booking requests');
    const { user, role } = await needRole(req, team, Schema.CAN.edit, 'Bookings are for Producers and Admins');
    const cur = await app.store.get(p.id);
    if (!cur || cur.deleted || cur.team !== team || cur.type !== 'booking') fail(404, 'Booking not found');
    const mine = String(cur.data.producer || '').toLowerCase() === String(user.data.email || '').toLowerCase();
    if (!mine && !Schema.CAN.admin(role)) fail(403, 'This booking is not allocated to you');
    const b = await readJson(req);
    const d = { ...cur.data };
    let production = null;
    if (b.accept) {
      if (!d.producer) d.producer = user.data.email;
      d.status = 'Accepted'; d.respondedAt = new Date().toISOString(); d.response = String(b.note || '').slice(0, 1000);
      if (!d.production || !(await app.store.get(d.production))) {
        const pid = newId('production_');
        production = await app.write(team, 'production', pid, { name: [d.service, d.organisation || d.name].filter(Boolean).join(' – ') || 'New booking', date: d.date || '', client: d.organisation || d.name || '',
          type: /sport|match/i.test(d.service || '') ? 'Sport' : 'Other', description: [d.details, (d.answers || []).map((x) => `${x.q}: ${x.a}`).join('\n'), [d.startTime && d.endTime ? `Time: ${d.startTime}–${d.endTime}` : d.startTime ? 'Starts: ' + d.startTime : '', d.venue || d.town ? 'Where: ' + [d.venue, d.town].filter(Boolean).join(', ') : '', d.budget ? 'Budget: ' + d.budget : ''].filter(Boolean).join('\n'), `Client: ${d.name}${d.email ? ' · ' + d.email : ''}${d.phone ? ' · ' + d.phone : ''}${d.contactBy ? ' (prefers ' + d.contactBy + ')' : ''}`].filter(Boolean).join('\n\n'), booking: cur.id, producer: d.producer, txTime: d.startTime || '' }, user.id);
        d.production = production.id;
      }
    } else {
      d.status = 'Declined by producer'; d.respondedAt = new Date().toISOString(); d.response = String(b.note || '').slice(0, 1000); d.declinedBy = d.producer || user.data.email;
    }
    const saved = await app.write(team, 'booking', cur.id, d, user.id);
    app.notify.bookingSaved(team, cur, saved, user);
    return { doc: saved, production: production ? production.id : d.production || '' };
  });

  // ---- a booking followed by the client (/track/<key>) and the conversation with them (lib/bookings.js)
  async function bookingFor(req, p) {
    const team = qs(req).get('team');
    if (bridge) onlyOnline('Booking requests');
    const { user, role } = await needRole(req, team, Schema.CAN.edit, 'Bookings are for Producers and Admins');
    const cur = await app.store.get(p.id);
    if (!cur || cur.deleted || cur.team !== team || cur.type !== 'booking') fail(404, 'Booking not found');
    if (!Schema.CAN.admin(role) && String(cur.data.producer || '').toLowerCase() !== String(user.data.email || '').toLowerCase()) fail(403, 'This booking is not allocated to you');
    return { user, cur, role };
  }
  r.add('POST', '/api/bookings/:id/reply', async (req, res, p) => {
    const { user, cur, role } = await bookingFor(req, p);
    if (!Schema.CAN.admin(role)) fail(403, 'Only Admins write to clients');
    const b = await readJson(req, 64 * 1024);
    const doc = await app.bookings.reply(cur, user, { text: b.text, email: b.email === undefined ? undefined : b.email !== false, whatsapp: b.whatsapp === undefined ? undefined : b.whatsapp !== false });
    const cleared = doc.data.unread ? await app.save(doc.team, 'booking', doc.id, { ...doc.data, unread: false }, user.id) : doc;
    return { doc: cleared };
  });
  r.add('GET', '/api/bookings/:id/prefers', async (req, res, p) => { const { cur } = await bookingFor(req, p); return { prefers: await app.bookings.prefers(cur.data) }; });
  r.add('POST', '/api/bookings/:id/seen', async (req, res, p) => { const { user, cur } = await bookingFor(req, p); if (!cur.data.unread) return { doc: cur }; return { doc: await app.save(cur.team, 'booking', cur.id, { ...cur.data, unread: false }, user.id) }; });
  r.add('POST', '/api/bookings/:id/track-link', async (req, res, p) => { const { cur } = await bookingFor(req, p); const doc = (await app.bookings.refresh(cur.id)) || cur; return { url: app.bookings.link(doc), doc }; });
  r.add('GET', '/api/public/track/:key', async (req, res, p) => app.bookings.track(p.key));
  r.add('POST', '/api/public/track/:key/rate', async (req, res, p) => { auth.throttle(clientIp(req, true)); return app.bookings.rate(p.key, await readJson(req, 16 * 1024)); });
  r.add('GET', '/api/ratings', async (req) => { const team = qs(req).get('team'); await needRole(req, team, Schema.CAN.edit, 'Ratings are for Producers and Admins'); return app.bookings.ratings(team); });
  r.add('POST', '/api/bookings/:id/rating', async (req, res, p) => { const { cur } = await bookingFor(req, p); const b = await readJson(req, 4096); return { doc: await app.bookings.setHidden(cur, b.hidden) }; });
  r.add('POST', '/api/public/track/:key/message', async (req, res, p) => { auth.throttle(clientIp(req, true)); const b = await readJson(req, 16 * 1024); return app.bookings.trackReply(p.key, b.text); });

  // ---- WhatsApp Business (lib/whatsapp.js): site admins set it up; Meta calls the webhook
  r.add('GET', '/api/whatsapp/config', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can see this'); return app.whatsapp.view(); });
  r.add('POST', '/api/whatsapp/config', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can change this'); return app.whatsapp.setConfig(await readJson(req, 16 * 1024)); });
  r.add('POST', '/api/whatsapp/test', async (req) => {
    const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can do this');
    const b = await readJson(req, 4096);
    const site = String(cfg.publicUrl || '').replace(/\/+$/, '');
    return app.whatsapp.send(b.phone, { text: 'This is a test from ' + (cfg.publicName || 'RFP Manager') + '. WhatsApp messages from the website work.', name: String(user.data.name || '').split(' ')[0] || 'there', what: 'a test', link: site || '-' });
  });
  // the business's own WhatsApp linked like WhatsApp Web (unofficial; lib/walinked.js)
  r.add('POST', '/api/whatsapp/link', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can do this'); const b = await readJson(req, 4096); return app.whatsapp.link({ phone: b.phone || '' }); });
  r.add('GET', '/api/whatsapp/link', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can see this'); return app.whatsapp.linkStatus(); });
  r.add('DELETE', '/api/whatsapp/link', async (req) => { const user = await needUser(req); if (!siteAdmin(user)) fail(403, 'Only a site admin can do this'); await app.whatsapp.unlink(); return app.whatsapp.linkStatus(); });
  r.add('GET', '/api/whatsapp/webhook', async (req, res) => {
    await app.whatsapp.conf();
    const ch = app.whatsapp.verify(qs(req));
    if (ch === null) fail(403, 'Wrong verify token');
    send(res, 200, ch, { 'Content-Type': 'text/plain' });
  });
  r.add('POST', '/api/whatsapp/webhook', async (req, res) => {
    const raw = await readBody(req, 1024 * 1024);
    await app.whatsapp.conf();
    if (!app.whatsapp.signed(raw, req.headers['x-hub-signature-256'])) fail(403, 'Bad signature');
    let body; try { body = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'Invalid JSON'); }
    await app.whatsapp.incoming(body);
    return { ok: true };
  });

  r.add('DELETE', '/api/docs/:type/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    if (!Schema.ENTITIES[p.type] && p.type !== 'image') fail(400, 'Unknown record type');
    if (!pcMayEdit(p.type)) onlyOnline(p.type === 'image' ? 'Images' : Schema.ENTITIES[p.type].plural);
    const { user, role } = await needRole(req, team, Schema.CAN.read);
    const cur = await app.store.get(p.id);
    if (!cur || cur.team !== team || cur.type !== p.type) fail(404, 'Record not found');
    if (p.type === 'booking' && !Schema.CAN.admin(role)) fail(403, 'Only an Admin can delete a booking request');
    const ownExpense = p.type === 'expense' && cur.data.submittedBy === user.data.email && cur.data.status === 'Submitted';
    if (!Schema.CAN.edit(role) && !ownExpense && !(role === 'Coach' && p.type !== 'club' && await coachMay(user, team, p.type, cur, cur.data))) fail(403, 'You need the Producer role to delete this');
    await app.remove(p.id, user.id);
    // a club goes with its teams (squads); the players stay in the players database
    const removed = [];
    if (p.type === 'club') for (const sq of await app.store.list(team, 'squad')) if (!sq.deleted && sq.data.club === p.id) { await app.remove(sq.id, user.id); removed.push(sq.id); }
    return { removed };
  });

  r.add('POST', '/api/images', async (req) => {
    if (bridge) onlyOnline('Images');
    const q = qs(req), team = q.get('team');
    const kind = q.get('kind') || '';
    const { user } = await needRole(req, team, kind === 'receipt' ? (r0) => !Schema.ROLE_SEES[r0] : kind === 'profile' ? Schema.CAN.read : (r0) => Schema.CAN.edit(r0) || r0 === 'Coach' || r0 === 'Official', 'You need the Producer role to add images');
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const buf = await readBody(req, MAX_IMAGE + 1024);
    return { doc: await storeImage(team, buf, mime, q.get('name'), kind, user.id, null, user.data.email) };
  });

  r.add('POST', '/api/images/url', async (req) => {
    if (bridge) onlyOnline('Images');
    const b = await readJson(req);
    const { user } = await needRole(req, b.team, Schema.CAN.edit, 'You need the Producer role to add images');
    return { id: await fetchImage(b.team, b.url, b.name, user.id) };
  });

  r.add('GET', '/media/:id', async (req, res, p) => {
    const doc = await app.store.get(p.id);
    if (!doc || doc.deleted || doc.type !== 'image') fail(404, 'Image not found');
    if (doc.data.kind === 'receipt') {                      // receipts: only for people who may see that expense
      const user = await needUser(req);
      const role = await auth.roleIn(user, doc.team);
      if (!role || (!Schema.CAN.edit(role) && doc.data.by !== user.data.email)) fail(403, 'Not your receipt');
    }
    const buf = await app.blobs.get(doc);
    if (!buf) fail(404, 'This image has not been downloaded to this machine yet');
    send(res, 200, buf, { 'Content-Type': MIME[doc.data.mime] || doc.data.mime === 'application/pdf' ? doc.data.mime : 'application/octet-stream', 'Cache-Control': doc.data.kind === 'receipt' ? 'private, max-age=3600' : 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  });

  // ---- save file (XML) ------------------------------------------------------------------------
  r.add('GET', '/api/export.xml', async (req, res) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to export');
    send(res, 200, await exportXml(app, team, user), { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="RFP Manager - Save File.xml"' });
  });

  r.add('POST', '/api/import.xml', async (req) => {
    if (bridge) onlyOnline('Importing a save file');
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.admin, 'Only an Admin can import a save file');
    const text = (await readBody(req, 20 * 1024 * 1024)).toString('utf8');
    try { return { counts: await importXml(app, team, text, user.id, fetchImage) }; }
    catch (e) { if (e.status) throw e; fail(400, e.message); }
  });

  // ---- this machine (production PC) -----------------------------------------------------------
  const machineView = async () => ({ mediaFolder: app.mediaFolder(), mediaFolderSetting: cfg.mediaFolder || '', caspar: { ...cfg.caspar }, cloud: { url: cfg.cloud.url || '', hasKey: !!cfg.cloud.key }, syncSeconds: cfg.syncSeconds,
    access: cfg.access, googleClientId: cfg.google.clientId || '', machineName: cfg.machineName, outputKey: cfg.outputKey, port: cfg.port,
    sync: app.sync.status(), casparStatus: app.gfx.amcp.status(), images: (await app.store.listType('image')).length, database: app.store.file || '',
    remote: cfg.remote !== false, remoteAccess: app.relay ? app.relay.status() : null });

  r.add('GET', '/api/machine', async (req) => { await needMachineAdmin(req); return machineView(); });

  // ---- connections on this PC: CasparCG, vMix, ATEM, HyperDeck, OBS, Companion, OSC, Art-Net, MIDI, X-keys, Pi GPIO ----
  const connView = () => ({ caspar: app.gfx.casparState(), devices: app.devices.state(), hw: app.devices.hw(), kinds: app.devices.kinds, mappings: app.devices.mappings(), outputKey: cfg.outputKey, port: cfg.port, hostname: require('node:os').hostname() });
  r.add('GET', '/api/connections', async (req) => { await needMachineAdmin(req); return connView(); });
  r.add('PUT', '/api/connections/caspar', async (req) => { await needMachineAdmin(req); app.gfx.saveCasparSettings(await readJson(req)); return connView(); });
  r.add('POST', '/api/connections/caspar/reconnect', async (req) => { await needMachineAdmin(req); app.gfx.amcp.reconnect(); return { ok: true }; });
  r.add('POST', '/api/connections/caspar/raw', async (req) => { await needMachineAdmin(req); const b = await readJson(req); if (String(b.command || '').trim()) await app.gfx.raw(String(b.command).trim()); return { ok: true }; });
  r.add('PUT', '/api/connections/devices', async (req) => { await needMachineAdmin(req); app.devices.save((await readJson(req)).list); return connView(); });
  r.add('PUT', '/api/connections/mappings', async (req) => { await needMachineAdmin(req); app.devices.saveMappings((await readJson(req)).list, app.gfx.cleanActions); return connView(); });
  // custom variables: their values for a match (or the match on air)
  r.add('GET', '/api/vars', async (req) => { await needUser(req); if (!app.automation) return { list: [] }; const f = qs(req).get('fixture'); return { list: app.automation.list(f === null ? undefined : f), onAir: app.gfx ? app.gfx.fixtureId || '' : '' }; });
  r.add('POST', '/api/vars/value', async (req) => {
    const user = await needUser(req);
    if (!(await auth.teamsFor(user)).some((t) => Schema.CAN.score(t.role))) fail(403, 'You need the Scorer role to change a variable');
    const b = await readJson(req);
    return { value: app.automation.set(String(b.key || ''), b.value, String(b.fixture || '')) };
  });
  // "Learn": waits for the next button, key, note, GPI or OSC message and says which live value it was
  r.add('POST', '/api/connections/learn', async (req) => { await needMachineAdmin(req); return { input: await app.devices.learn(15000) }; });
  r.add('POST', '/api/connections/command', async (req) => { await needMachineAdmin(req); const b = await readJson(req); await app.devices.command(String(b.id || ''), String(b.command || ''), String(b.value || '')); return { ok: true }; });

  // Graphic templates in this PC's template folder
  r.add('GET', '/api/templates', async (req) => {
    await needUser(req);
    if (!app.isLocal) fail(400, 'Templates are read from the production PC. Open RFP Manager on that machine.');
    return app.templates.list();
  });
  r.add('GET', '/api/templates/fields', async (req) => {
    await needUser(req);
    if (!app.isLocal) fail(400, 'Templates are read from the production PC');
    return app.templates.fields(qs(req).get('path'));
  });
  r.add('POST', '/api/templates/sync', async (req) => {
    await needMachineAdmin(req);
    if (!app.isLocal) fail(400, 'Templates are copied by the production PC');
    return app.templates.syncBuiltIn();
  });
  r.add('PUT', '/api/templates/folder', async (req) => {
    await needMachineAdmin(req);
    return app.templates.setFolder((await readJson(req)).folder);
  });

  r.add('PUT', '/api/machine', async (req) => {
    await needMachineAdmin(req);
    const b = await readJson(req);
    if (b.mediaFolder !== undefined) {
      const next = String(b.mediaFolder || '').trim();
      const prev = app.mediaFolder();
      const target = next ? path.resolve(next) : path.join(app.dataDir(), 'media');
      try { fs.mkdirSync(target, { recursive: true }); fs.accessSync(target, fs.constants.W_OK); } catch (e) { fail(400, 'That folder cannot be used: ' + e.message); }
      cfg.mediaFolder = next;
      if (target !== prev) {
        let copied = 0;
        for (const d of await app.store.listType('image')) {
          const f = safeFile(d.data.file);
          if (!f) continue;
          const from = path.join(prev, f), to = path.join(target, f);
          try { if (fs.existsSync(from) && !fs.existsSync(to)) { fs.copyFileSync(from, to); copied++; } } catch { /* fetched again below */ }
        }
        log(`Image folder is now ${target} (${copied} copied across)`);
      }
    }
    if (b.caspar && typeof b.caspar === 'object') {
      const c = b.caspar;
      cfg.caspar = { ...cfg.caspar, enabled: c.enabled !== false, host: String(c.host || '127.0.0.1').trim(), port: Number(c.port) || 5250, channel: Number(c.channel) || 1,
        previewChannel: Number(c.previewChannel) || cfg.caspar.previewChannel || 2, format: c.format === 'xml' ? 'xml' : 'json', images: c.images === 'http' ? 'http' : 'file', templateFolder: String(c.templateFolder || 'rfp').replace(/[^\w/-]/g, '') || 'rfp' };
    }
    if (b.syncSeconds !== undefined) cfg.syncSeconds = Math.max(2, Math.min(3600, Number(b.syncSeconds) || 5));
    if (['tailnet', 'lan', 'any'].includes(b.access)) cfg.access = b.access;
    if (b.googleClientId !== undefined) cfg.google.clientId = String(b.googleClientId).trim();
    if (b.machineName !== undefined) cfg.machineName = String(b.machineName).slice(0, 60);
    if (b.remote !== undefined) cfg.remote = !!b.remote;
    app.saveConfig();
    if (app.relay && (b.remote !== undefined || b.machineName !== undefined)) { app.relay.stop(); app.relay.start(); }
    if (b.caspar) app.gfx.amcp.reconnect();
    if (b.cloud && typeof b.cloud === 'object') {
      const keep = b.cloud.key ? b.cloud.key : (String(b.cloud.url || '').replace(/\/+$/, '') === (cfg.cloud.url || '') ? cfg.cloud.key : '');
      await linkCloud(b.cloud.url, keep);
    } else { app.sync.stop(); app.sync.start(); }
    const media = await app.sync.ensureMedia();
    return { ...(await machineView()), media };
  });

  r.add('POST', '/api/machine/sync', async (req) => {
    await needMachineAdmin(req);
    await app.sync.run();
    return { sync: app.sync.status(), media: await app.sync.ensureMedia() };
  });

  r.add('GET', '/api/log', async (req) => { await needMachineAdmin(req); return { lines: log.lines.slice(-200) }; });

  // ---- machine keys + sync (the online side) --------------------------------------------------
  r.add('GET', '/api/keys', async (req) => {
    const user = await needUser(req);
    return { keys: (await app.store.find('machinekey', 'userId', user.id)).map((k) => ({ id: k.id, name: k.data.name, createdAt: k.data.createdAt })) };
  });
  r.add('POST', '/api/keys', async (req) => {
    const user = await needUser(req);
    if (!(await auth.teamsFor(user)).some((t) => t.role === 'Admin')) fail(403, 'Only an Admin can create machine keys');
    return auth.createKey(user, (await readJson(req)).name);
  });
  r.add('DELETE', '/api/keys/:id', async (req, res, p) => {
    const user = await needUser(req);
    const k = await app.store.get(p.id);
    if (!k || k.type !== 'machinekey' || k.data.userId !== user.id) fail(404, 'Key not found');
    await app.remove(p.id, user.id);
    return {};
  });

  r.add('POST', '/api/sync/pull', async (req) => app.syncServer.pull(await needKey(req), await readJson(req)));
  // a linked PC checks a sign-in it does not know yet (a new password, or a person added since the last sync)
  r.add('POST', '/api/sync/verify', async (req) => {
    const keyUser = await needKey(req);
    auth.throttle(clientIp(req, true));
    const b = await readJson(req);
    const u = await auth.userByEmail(b.email);
    if (!u || !u.data.passwordHash || !checkPassword(String(b.password || ''), u.data.passwordHash)) fail(401, u && !u.data.passwordHash ? 'This account signs in with Google. Use the Google button, or set a password on the website (Settings → My account).' : 'Wrong email or password');
    const scope = new Set(await app.syncServer.scope(keyUser));
    if (!(await auth.teamsFor(u)).some((t) => scope.has(t.id))) fail(403, `${u.data.email} is not in a production team this PC works for. Ask an Admin to add you on the website.`);
    return { user: { id: u.id, team: '', type: 'user', data: u.data, updatedAt: u.updatedAt } };
  });
  r.add('POST', '/api/sync/push', async (req) => app.syncServer.push(await needKey(req), await readJson(req, 32 * 1024 * 1024)));
  r.add('GET', '/api/sync/blob/:id', async (req, res, p) => {
    const doc = await app.syncServer.blobAccess(await needKey(req), p.id);
    const buf = await app.blobs.get(doc);
    if (!buf) fail(404, 'Image data missing');
    send(res, 200, buf, { 'Content-Type': 'application/octet-stream' });
  });
  r.add('PUT', '/api/sync/blob/:id', async (req, res, p) => {
    const user = await needKey(req);
    const q = qs(req), team = q.get('team'), file = safeFile(q.get('file'));
    if (!/^img_[\w-]{6,40}$/.test(p.id) || !file) fail(400, 'Bad image');
    if (!(await app.syncServer.scope(user)).includes(team)) fail(403, 'No access to that production team yet');
    const cur = await app.store.get(p.id);
    if (cur && (cur.team !== team || cur.type !== 'image')) fail(409, 'That id belongs to another record');
    const buf = await readBody(req, MAX_IMAGE + 1024);
    if (!buf.length) fail(400, 'The image is empty');
    await app.blobs.put({ id: p.id, team, data: { file } }, buf);
    return {};
  });

  // ---- request handling -----------------------------------------------------------------------
  function allowed(req) {
    if (!app.isLocal || cfg.access === 'any') return true;
    const ip = clientIp(req, false);
    if (isLoopback(ip)) return true;
    if (net.isIPv4(ip) && isTailnet(ip)) return true;
    return cfg.access === 'lan' && isPrivate(ip);
  }

  // The website: requests that belong to a production PC go through its relay link (see lib/relay.js).
  const PC_API = /^\/api\/(connections|templates|vars|machine|log)(\/|$)/;
  async function throughWebsite(req, res, pathname) {
    const short = SHORT[pathname.toLowerCase().replace(/\/+$/, '')];
    const live = pathname.startsWith('/live/api/') || pathname.startsWith('/worship/api/') || pathname.startsWith('/live/templates/');
    const pcApi = PC_API.test(pathname);
    if (!short && !live && !pcApi) return false;
    const user = await auth.userFromReq(req).catch(() => null);
    const m = await app.relayServer.choose(req, user);
    if (!m) {
      if (short) { res.writeHead(302, { Location: user ? '/app#/pcs' : '/app?next=' + encodeURIComponent(pathname), 'Cache-Control': 'no-store' }); res.end(); return true; }
      if (pcApi) { send(res, 409, { error: 'Choose a production PC first (PC at the top of the menu). Start RFP Manager on it and link it to this website.', code: 'NO_PC' }); return true; }
      return false;                                   // the website's own live engine: scoring online without a PC
    }
    if (pcApi && !user) { send(res, 401, { error: 'Sign in first' }); return true; }
    const keepPc = new URL(req.url, 'http://x').searchParams.get('pc');
    if (short && keepPc) {
      // a screen opened with ?pc=… (e.g. an OBS browser source): keep it on that PC after the PC's redirect
      const orig = res.writeHead.bind(res);
      res.writeHead = (status, headers) => { if (headers && headers.location && headers.location.startsWith('/')) headers.location += (headers.location.includes('?') ? '&' : '?') + 'pc=' + encodeURIComponent(keepPc); return orig(status, headers); };
    }
    await app.relayServer.http(req, res, m, user);
    return true;
  }

  async function handle(req, res) { return actor.run({ ip: String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''), via: 'RFP Manager' }, () => handle0(req, res)); }
  async function handle0(req, res) {
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname;
    try {
      if (!allowed(req)) return send(res, 403, { error: 'This address is not allowed to reach RFP Manager (see "access" in Settings > This machine).' });
      if (pathname === '/healthz') return send(res, 200, { ok: true });
      if (app.relayServer && (await throughWebsite(req, res, pathname))) return;
      if (pathname.startsWith('/live/api/')) { await app.live.http(req, res, pathname); return; }
      if (pathname.startsWith('/worship/api/')) { await app.worship.http(req, res, pathname); return; }
      // Short links for this device: http://pc-name/scorer, /confidence, /rundown, /graphics-control, /output, /preview …
      if (app.isLocal && SHORT[pathname.toLowerCase().replace(/\/+$/, '')]) {
        const [page, open, extra] = SHORT[pathname.toLowerCase().replace(/\/+$/, '')];
        const q = new URLSearchParams(new URL(req.url, 'http://x').search);
        // view-only screens open without signing in on this PC's network; through the website they need the screen key in the link
        const viaWeb = app.relay && app.relay.identity(req) !== undefined;
        if (open && cfg.shortLinks !== false && !viaWeb && !q.get('key') && !(await auth.userFromReq(req).catch(() => null))) q.set('key', cfg.outputKey);
        for (const [k, v] of Object.entries(extra || {})) if (!q.has(k)) q.set(k, v);
        let target = page;
        if (page === 'scorer') { const fx = app.gfx && app.gfx.fixtureId ? await app.store.get(app.gfx.fixtureId) : null; const sp = fx && !fx.deleted ? Scoring.sportFor(fx.data.sport) : null; target = sp && sp.id === 'cricket' ? '/live/stats.html' : '/live/sport.html'; }
        if (page === 'stats') { target = '/live/sport.html'; q.set('page', 'entry'); }
        res.writeHead(302, { Location: target + (q.toString() ? '?' + q : ''), 'Cache-Control': 'no-store' }); res.end(); return;
      }
      // several audio tracks: the HLS that ffmpeg makes on this server (lib/multiaudio.js)
      const ma = req.method === 'GET' && !app.isLocal && app.multiaudio ? /^\/mhls\/([\w-]{1,60})\/(.{1,80})$/.exec(pathname) : null;
      if (ma) {
        const s = await app.streaming.streamOf(ma[1]);
        if (!s || s.ch.data.disabled) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
        const user = await auth.userFromReq(req).catch(() => null);
        const member = user ? !!((await auth.roleIn(user, s.ch.team)) || (await auth.roleIn(user, s.prod.team))) : false;
        const open = app.streaming.accessOf(s.prod, s.ch).access === 'Public' && !(app.pay && app.pay.isPaid(s.prod, s.ch));
        if (!open && !member && !app.streaming.tokenOk(qs(req).get('token') || '', ma[1])) return send(res, 403, 'Not allowed', { 'Content-Type': 'text/plain' });
        const f = app.multiaudio.file(ma[1], ma[2], member);
        if (!f) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
        return send(res, 200, f.body, { 'Content-Type': f.type, 'Cache-Control': f.type === 'video/mp2t' ? 'public, max-age=60' : 'no-store' });
      }
      // video adverts (master control): played by the viewers' players during an ad break
      const ad = (req.method === 'GET' || req.method === 'HEAD') && !app.isLocal && app.mcr ? /^\/ads\/(vad_[\w-]{1,40})\.mp4$/.exec(pathname) : null;
      if (ad) { const d = await app.store.get(ad[1]); return sendFile(req, res, d && !d.deleted ? app.mcr.adFile(ad[1]) : null, (d && d.data.mime === 'audio/mp4') ? 'audio/mp4' : 'video/mp4'); }
      if (req.method === 'GET' && /^\/watch\/[\w-]{1,60}\/?$/.test(pathname)) {
        if (await serveStatic(res, path.join(app.root, 'public'), 'watch.html', { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'", 'Referrer-Policy': 'no-referrer' })) return;
      }
      if (req.method === 'GET' && pathname === '/.well-known/assetlinks.json' && !app.isLocal && cfg.android && cfg.android.sha256) {
        // lets the Android app open this website full screen (Trusted Web Activity)
        return send(res, 200, [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: cfg.android.package, sha256_cert_fingerprints: String(cfg.android.sha256).split(/[,\s]+/).filter(Boolean) } }], { 'Cache-Control': 'public, max-age=3600' });
      }
      if (req.method === 'GET' && pathname === '/server/install.sh' && !app.isLocal) {
        if (await serveStatic(res, path.join(app.root, 'tools', 'server'), 'install.sh', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })) return;
      }
      const m = r.match(req.method, pathname);
      if (m) {
        if (req.method !== 'GET' && !req.headers.authorization && req.headers['x-rfp'] !== '1' && pathname !== '/api/stream/auth' && pathname !== '/api/auth/google/redirect' && pathname !== '/api/pay/payfast/itn' && pathname !== '/api/whatsapp/webhook' && !pathname.startsWith('/join/')) fail(403, 'Missing request header');   // /join/<token>: a plain form, the token is the proof
        const out = await m.handler(req, res, m.params);
        if (!res.headersSent) send(res, 200, out);
        return;
      }
      if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
      // two addresses: the website (example.com) and the production teams' Studio (admin.example.com)
      if (!app.isLocal && cfg.adminUrl && req.method === 'GET') {
        const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
        const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, ''), adm = hostOf(cfg.adminUrl), pub = hostOf(cfg.publicUrl);
        const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        if (adm && host === adm && pathname === '/') { res.writeHead(302, { Location: '/app' + search, 'Cache-Control': 'no-store' }); res.end(); return; }
        if (adm && host !== adm && (host === pub || host === 'www.' + pub) && (pathname === '/app' || pathname === '/app/' || pathname === '/app/index.html')) {
          res.writeHead(302, { Location: String(cfg.adminUrl).replace(/\/+$/, '') + '/app' + search, 'Cache-Control': 'no-store' }); res.end(); return;
        }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      const csp = { 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://accounts.google.com https://www.youtube.com https://s.ytimg.com; frame-src 'self' https://accounts.google.com https://www.youtube-nocookie.com https://www.youtube.com; connect-src 'self' ws: wss: https://accounts.google.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://accounts.google.com; font-src 'self' data:", 'Referrer-Policy': 'no-referrer-when-downgrade', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' };
      // the superuser page: / on analytics.<website>, and /super on any of the website's addresses
      if (!app.isLocal && app.superUser && (pathname === '/super' || pathname === '/super/' || (pathname === '/' && String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '') === app.superUser.host()))) {
        if (await serveStatic(res, path.join(app.root, 'public'), 'super.html', { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; media-src 'self'; frame-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' })) return;
      }
      // the website: its front page for everyone; the production teams' app at /app (on a production PC the app is at / too)
      if (!app.isLocal && (pathname === '/' || /^\/(c\/[\w-]{1,60}|match\/[\w-]{1,80}|team\/[\w-]{1,80}|teams|following|software|software\/[\w-]{1,60}|player\/[\w-]{1,80}|client\/[\w-]{12,40}|track\/[\w-]{12,40}|portal\/[\w-]{16,60}|release\/[\w-]{12,40}|v\/[\w-]{6,80}|s\/[\w-]{6,80}|p\/[\w-]{6,80}|legal|terms|privacy|channels|matches|videos|subscriptions|notifications|browse|book)\/?$/.test(pathname))) { if (await serveStatic(res, path.join(app.root, 'public'), 'home.html', csp)) return; }
      if (pathname === '/app' || pathname === '/app/') { if (await serveStatic(res, path.join(app.root, 'public'), 'index.html', csp)) return; }
      // the app itself: only for the production team (signed in), and for the app's own updater (Android's download manager)
      if (pathname === '/app/rfp-manager.apk' && !app.isLocal) {
        const ok = (await appAllowed(await auth.userFromReq(req).catch(() => null))) || /^AndroidDownloadManager\//.test(String(req.headers['user-agent'] || ''));
        if (!ok) {
          const signedIn = !!(await auth.userFromReq(req).catch(() => null));
          res.writeHead(signedIn ? 403 : 401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>RFP Manager app</title><body style="font-family:Segoe UI,Arial,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px;text-align:center"><div style="max-width:420px"><h1>The RFP Manager app</h1><p>The app is for ${escHtml(cfg.publicName || cfg.name || 'our')} production team: Admins, Producers, Scorers and Crew.</p>${signedIn ? '<p>Your account is not on the production team. Ask an Admin to add you.</p>' : '<p><a style="color:#00ff82" href="/?signin=1&amp;next=%2Fapp%2Frfp-manager.apk">Sign in</a> with your team account to download it.</p>'}</div></body>`);
          return;
        }
        if (await serveStatic(res, path.join(app.root, 'public', 'app'), 'rfp-manager.apk', { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/vnd.android.package-archive' })) return;   // never cached by Cloudflare
      }
      if (pathname.startsWith('/shared/')) { if (await serveStatic(res, path.join(app.root, 'shared'), pathname.slice(8))) return; }
      else if (pathname.startsWith('/live/templates/')) {
        if (await serveStatic(res, path.join(app.root, 'templates'), decodeURIComponent(pathname.slice(16)))) return;
        // templates loaded from this PC's own template folder render in the browser outputs and previews too
        if (app.isLocal && app.config.templatesPath && await serveStatic(res, app.templates.folder(), decodeURIComponent(pathname.slice(16)))) return;
      }
      else if (pathname === '/rl' || pathname.startsWith('/rl/')) {
        // Rocket League: the control panel (public/rl), the graphics and their files (templates/rfp/rocket, the same files CasparCG plays)
        const rest = decodeURIComponent(pathname.slice(4)) || 'control';
        const page = { control: 'control.html', overlay: 'overlay.html', stats: 'stats.html', postgame: 'postgame.html' }[rest];
        if (page === 'control.html' || rest === 'control.html') { if (await serveStatic(res, path.join(app.root, 'public', 'rl'), 'control.html')) return; }
        else if (await serveStatic(res, path.join(app.root, 'templates', 'rfp', 'rocket'), page || rest)) return;
      }
      else if (pathname.startsWith('/live/')) { if (await serveStatic(res, path.join(app.root, 'public'), decodeURIComponent(pathname.slice(1)))) return; }
      else if (pathname.startsWith('/templates/')) { if (await serveStatic(res, path.join(app.root, 'templates'), decodeURIComponent(pathname.slice(11)))) return; }
      else if (await serveStatic(res, path.join(app.root, 'public'), pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1)), pathname === '/' || pathname.endsWith('.html') ? csp : {})) return;
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    } catch (e) {
      if (!e.status) log('Request failed:', req.method, pathname, e.stack || e.message);
      send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server', ...(e.code ? { code: e.code } : {}) });
    }
  }

  return { handle, fetchImage };
}

module.exports = { makeApi };
