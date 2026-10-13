'use strict';
// HTTP API + static files.
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');
const net = require('node:net');
const Schema = require('../shared/schema');
const { Router, readBody, readJson, send, serveStatic, clientIp } = require('./http');
const Scoring = require('../shared/scoring');
// [page, open without sign-in (view-only, uses this machine's screen key)]
const SHORT = { '/scorer': ['scorer', false], '/stats': ['stats', false], '/graphics-control': ['/live/control.html', false], '/control': ['/live/control.html', false],
  '/confidence': ['/live/comms.html', true], '/commentary': ['/live/comms.html', true], '/rundown': ['/live/rundown.html', true], '/output': ['/live/output.html', true], '/preview': ['/live/preview.html', true],
  '/worship': ['/live/worship.html', false], '/stage': ['/live/stage.html', true],
  '/timeline': ['/live/timeline.html', false], '/dash': ['/live/dash.html', false], '/dashboard': ['/live/dash.html', false], '/crew': ['/live/timeline.html', true, { view: 'crew' }],
  '/key': ['/live/output.html', true, { mode: 'key' }], '/fill': ['/live/output.html', true, { mode: 'fill', bg: 'black' }], '/fill-key': ['/live/output.html', true, { mode: 'fillkey' }], '/fillkey': ['/live/output.html', true, { mode: 'fillkey' }] };
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
  const pubUser = (u) => ({ id: u.id, name: u.data.name || '', email: u.data.email, image: u.data.image || '', phone: u.data.phone || '', emailOff: !!u.data.emailOff, hasPassword: !!u.data.passwordHash, google: !!u.data.googleSub });

  // ---- the production PC is a bridge: records are managed on the website
  const bridge = app.isLocal && !cfg.standalone;
  const site = () => String(cfg.cloud.url || cfg.defaultCloudUrl || '').replace(/\/+$/, '');
  function onlyOnline(what) {
    const e = new (require('./util').HttpError)(403, `${what} ${/s$/.test(what) ? 'are' : 'is'} managed on the website${site() ? ' (' + site().replace(/^https?:\/\//, '') + ')' : ''}. This PC is the CasparCG bridge: it shows them but does not change them.`);
    e.code = 'ONLINE_ONLY'; throw e;
  }
  const pcMayEdit = (type) => !bridge || Schema.PC_EDIT.includes(type);

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
  r.add('GET', '/api/config', async () => ({ name: cfg.name, mode: cfg.mode, version: app.version, googleClientId: cfg.google.clientId || app.cloudGoogleClientId || '',
    needsSetup: await needsSetup(), allowSignup: !!cfg.allowSignup, androidApp: !app.isLocal && fs.existsSync(path.join(app.root, 'public', 'app', 'rfp-manager.apk')), bridge, pcEdit: bridge ? Schema.PC_EDIT : null, streaming: app.streaming.enabled(), mail: app.mail.enabled(), linked: !!(app.sync && app.sync.linked()), cloudUrl: app.isLocal ? cfg.cloud.url || cfg.defaultCloudUrl || '' : '' }));

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
    const user = await auth.userByEmail(b.email);
    if (!user || !user.data.passwordHash || !checkPassword(b.password, user.data.passwordHash)) fail(401, 'Wrong email or password');
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

  // First run on a production PC: link it to the online site instead of creating a local account.
  r.add('POST', '/api/setup/link', async (req) => {
    if (!(await needsSetup())) fail(403, 'This machine is already set up. Use Settings > This machine.');
    const b = await readJson(req);
    await linkCloud(b.url, b.key);
    return { users: (await app.store.listType('user')).length, error: app.sync.status().lastError };
  });

  // The website gives a production PC its own key for the person signing in with Google (an Admin there).
  async function linkWithGoogle(credential) {
    const url = String(cfg.cloud.url || cfg.defaultCloudUrl || '').replace(/\/+$/, '');
    if (!url) fail(400, 'This PC does not know the website address. Use Link to the website below.');
    let r, out = {};
    try {
      r = await fetch(url + '/api/pair/google', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify({ credential, name: cfg.machineName || require('node:os').hostname() }), signal: AbortSignal.timeout(90000) });
      out = await r.json().catch(() => ({}));
    } catch (e) { fail(502, `Could not reach the website (${url}): ${e.message}`); }
    if (!r.ok || !out.key) fail(r.status === 403 ? 403 : 502, out.error || `The website answered ${r.status}`);
    await linkCloud(url, out.key);
    log(`Linked to ${url} by Google sign-in (${out.email})`);
  }

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
          if (r2.status === 200) { const pm = JSON.parse(r2.body.toString('utf8')).machine || {}; machine = { ...machine, ...pm, mode: cfg.mode, remote: { id: m.id, name: m.name, version: m.version } }; }
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
    r.add('POST', '/api/pair/start', async (req) => { auth.throttle(clientIp(req, true)); const b = await readJson(req); const p = rs.pairStart(b.name); return { ...p, approveUrl: (cfg.publicUrl || '').replace(/\/+$/, '') + '/app#/link/' + p.code }; });
    r.add('POST', '/api/pair/google', async (req) => {
      // a production PC whose user signed in with Google there: that person (an Admin here) gives it its own key
      auth.throttle(clientIp(req, true));
      const b = await readJson(req);
      const g = await auth.verifyGoogle(b.credential);
      const user = await auth.userByEmail(g.email);
      if (!user || !(await auth.teamsFor(user)).some((t) => t.role === 'Admin')) fail(403, `${g.email} is not an Admin of a production team on the website. Sign in on the website first and create a team (or ask its Admin to make you one), then try again.`);
      await auth.ensureUser({ email: g.email, name: g.name, image: g.image, sub: g.sub });
      const k = await auth.createKey(user, String(b.name || 'Production PC').slice(0, 60));
      log(`Production PC "${String(b.name || '').slice(0, 60)}" linked by Google sign-in of ${g.email}`);
      return { key: k.key, email: g.email };
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
    const list = (await app.store.list(team, 'production')).filter((d) => d.data.streamChannel && d.data.streamSlug)
      .map((d) => ({ id: d.id, channel: d.data.streamChannel, ...st.status(d.data.streamSlug), videos: st.videosOf(d.data.streamSlug).length, ingest: Schema.CAN.edit(role) ? st.ingest(d) : null }));
    return { enabled: st.enabled(), base: (cfg.publicUrl || '').replace(/\/+$/, ''), health: st.health(), list };
  });
  r.add('POST', '/api/productions/:id/newkey', async (req, res, p) => {
    const team = qs(req).get('team');
    if (bridge) onlyOnline('Productions');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to change the stream key');
    const cur = await app.store.get(p.id);
    if (!cur || cur.deleted || cur.team !== team || cur.type !== 'production' || !cur.data.streamChannel) fail(404, 'Production stream not found');
    const doc = await st.newStreamKey(cur, user.id);
    return { doc, ingest: st.ingest(doc) };
  });
  r.add('GET', '/api/watch/:slug', async (req, res, p) => st.watch(p.slug, await auth.userFromReq(req).catch(() => null), undefined, qs(req).get('v') || ''));
  r.add('POST', '/api/watch/:slug', async (req, res, p) => {
    auth.throttle(clientIp(req, !app.isLocal));
    return st.watch(p.slug, await auth.userFromReq(req).catch(() => null), String((await readJson(req)).password || ''), qs(req).get('v') || '');
  });

  // ---- the public website: live streams, videos, matches and channels of every production team -----------
  const pubCache = new Map();
  app.on('doc', (d) => { if (['fixture', 'org', 'competition', 'club', 'squad', 'production', 'channel', 'venue'].includes(d.type)) pubCache.delete('matches'); });
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
          out.push({ id: f.id, name: d.name || d.autoName || '', sport: d.sport || '', date: d.startDate, time: d.startTime || '', status: d.status || 'Upcoming', company: o.data.name,
            competition: comp ? { name: [comp.data.name, comp.data.season].filter(Boolean).join(' '), logo: comp.data.logo || '' } : null, venue: venue ? venue.data.name : '',
            score: r && r.started ? r.text : d.officialReport && d.officialReport.scoreA !== '' ? `${d.officialReport.scoreA} – ${d.officialReport.scoreB}` : '', period: r && r.started && d.status === 'Live' ? r.period : '',
            teams: teams.map((t) => ({ name: t.name, logo: t.logo, color: t.color1 })) });
        }
      }
      return out;
    });
  }
  const subsOf = (u) => (u && Array.isArray(u.data.subscriptions) ? u.data.subscriptions : []);
  r.add('GET', '/api/public/home', async (req) => {
    const user = await auth.userFromReq(req).catch(() => null);
    const today = new Date().toISOString().slice(0, 10);
    const streams = await pubCached('streams', 4000, () => st.publicStreams());
    const chans = (await st.publicChannels()).map((c) => c.brand);
    const videos = [];
    for (const s of streams) for (const v of s.videos) videos.push({ slug: s.slug, title: s.title, poster: s.poster, channel: s.channel, start: v.start, duration: v.duration });
    videos.sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const matches = await publicMatches();
    return {
      site: cfg.name || 'RFP Manager', me: user ? { name: user.data.name || '', email: user.data.email, image: user.data.image || '', subscriptions: subsOf(user), teams: (await auth.teamsFor(user)).length } : null,
      live: streams.filter((s) => s.live).sort((a, b) => b.viewers - a.viewers),
      upcoming: streams.filter((s) => !s.live && s.date >= today).sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time))).slice(0, 24),
      videos: videos.slice(0, 120), channels: chans,
      matches: { live: matches.filter((m) => m.status === 'Live'), upcoming: matches.filter((m) => m.status !== 'Live' && m.date >= today && !['Completed', 'Cancelled'].includes(m.status)).sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time))).slice(0, 30),
        results: matches.filter((m) => m.status === 'Completed' || (m.date < today && m.score)).sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time))).slice(0, 30) },
    };
  });
  r.add('GET', '/api/public/c/:slug', async (req, res, p) => {
    const ch = await st.channelBySlug(String(p.slug).toLowerCase());
    if (!ch || ch.data.disabled || (ch.data.access || 'Public') !== 'Public') fail(404, 'There is no channel at this address');
    const user = await auth.userFromReq(req).catch(() => null);
    const brand = await st.branding(ch);
    const streams = (await pubCached('streams', 4000, () => st.publicStreams())).filter((s) => s.channel.id === ch.id);
    const subscribers = (await app.store.listType('user')).filter((u) => subsOf(u).includes(ch.id)).length;
    return { channel: brand, subscribers, subscribed: subsOf(user).includes(ch.id), signedIn: !!user, streams };
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
    r.add('GET', '/api/server/bundle.tgz', async (req, res) => {
      await setupToken(req);
      const buf = await require('./tarball').bundle(app.root);
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    r.add('GET', '/api/server/env', async (req, res) => {
      const s = await setupToken(req);
      // what the new server needs to use the same database and Google sign-in as this website
      const lines = { MODE: 'cloud', MONGODB_URI: cfg.mongo.uri, MONGODB_DB: cfg.mongo.db, GOOGLE_CLIENT_ID: cfg.google.clientId || '', ALLOW_SIGNUP: cfg.allowSignup ? 'true' : 'false',
        SITE_ADMINS: (cfg.siteAdmins || []).join(','), SITE_NAME: cfg.name || '',
        ...(cfg.mail && cfg.mail.provider ? { MAIL_PROVIDER: cfg.mail.provider, MAIL_FROM: cfg.mail.from || '', ...(cfg.mail.apiKey ? { MAIL_API_KEY: cfg.mail.apiKey } : {}), ...(cfg.mail.smtp ? { SMTP_URL: cfg.mail.smtp } : {}) } : {}) };
      log(`Server setup: settings handed to a new server at ${clientIp(req, true)} (link made by ${s.by})`);
      const body = Object.entries(lines).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]/g, '')}`).join('\n') + '\n';
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    });
  }

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
  r.add('POST', '/api/link/cancel', async (req) => { if (!(await needsSetup())) await needMachineAdmin(req); linking = null; return linkView(); });

  r.add('POST', '/api/me', async (req) => {
    const user = await needUser(req);
    if (app.sync && app.sync.linked()) fail(400, 'This machine is linked to the website. Change your name or password there and it will sync down.');
    const b = await readJson(req);
    const data = { ...user.data };
    if (b.name !== undefined) data.name = String(b.name).slice(0, 80);
    if (b.phone !== undefined) data.phone = String(b.phone).slice(0, 40);
    if (b.emailOff !== undefined) data.emailOff = !!b.emailOff;
    if (b.image !== undefined && /^(img_[\w-]+|https:\/\/[^\s"']{1,500})?$/.test(String(b.image))) data.image = String(b.image);
    if (b.password) {
      if (String(b.password).length < 8) fail(400, 'Use a password of at least 8 characters');
      if (data.passwordHash && !checkPassword(b.currentPassword || '', data.passwordHash)) fail(403, 'Your current password is wrong');
      data.passwordHash = hashPassword(b.password);
    }
    return { user: pubUser(await app.save('', 'user', user.id, data, user.id)) };
  });

  // ---- production teams + members -------------------------------------------------------------
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

  r.add('GET', '/api/verse', async (req) => { await needUser(req); return app.verse.today(); });

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
    for (const f of Schema.fieldsFor(p.type, null)) if (f.req && !String(b.data[f.k] === undefined || b.data[f.k] === null ? '' : b.data[f.k]).trim()) fail(400, `${f.l} is required`);
    const saved = await app.write(team, p.type, p.id, b.data, user.id);
    const before = cur && !cur.deleted ? cur : null;
    if (p.type === 'production') app.notify.productionSaved(team, before, saved);
    if (p.type === 'fixture') app.notify.fixtureSaved(team, before, saved);
    if (p.type === 'expense') app.notify.expenseSaved(team, before, saved, user);
    return { doc: saved };
  });

  r.add('DELETE', '/api/docs/:type/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    if (!Schema.ENTITIES[p.type] && p.type !== 'image') fail(400, 'Unknown record type');
    if (!pcMayEdit(p.type)) onlyOnline(p.type === 'image' ? 'Images' : Schema.ENTITIES[p.type].plural);
    const { user, role } = await needRole(req, team, Schema.CAN.read);
    const cur = await app.store.get(p.id);
    if (!cur || cur.team !== team || cur.type !== p.type) fail(404, 'Record not found');
    const ownExpense = p.type === 'expense' && cur.data.submittedBy === user.data.email && cur.data.status === 'Submitted';
    if (!Schema.CAN.edit(role) && !ownExpense && !(role === 'Coach' && p.type !== 'club' && await coachMay(user, team, p.type, cur, cur.data))) fail(403, 'You need the Producer role to delete this');
    await app.remove(p.id, user.id);
    return {};
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
        if (req.method !== 'GET' && !req.headers.authorization && req.headers['x-rfp'] !== '1' && pathname !== '/api/stream/auth') fail(403, 'Missing request header');
        const out = await m.handler(req, res, m.params);
        if (!res.headersSent) send(res, 200, out);
        return;
      }
      if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      const csp = { 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://accounts.google.com; frame-src 'self' https://accounts.google.com; connect-src 'self' ws: wss: https://accounts.google.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://accounts.google.com; font-src 'self' data:", 'Referrer-Policy': 'no-referrer-when-downgrade', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' };
      // the website: its front page for everyone; the production teams' app at /app (on a production PC the app is at / too)
      if (!app.isLocal && (pathname === '/' || /^\/(c\/[\w-]{1,60}|channels|matches|videos|subscriptions)\/?$/.test(pathname))) { if (await serveStatic(res, path.join(app.root, 'public'), 'home.html', csp)) return; }
      if (pathname === '/app' || pathname === '/app/') { if (await serveStatic(res, path.join(app.root, 'public'), 'index.html', csp)) return; }
      if (pathname.startsWith('/shared/')) { if (await serveStatic(res, path.join(app.root, 'shared'), pathname.slice(8))) return; }
      else if (pathname.startsWith('/live/templates/')) {
        if (await serveStatic(res, path.join(app.root, 'templates'), decodeURIComponent(pathname.slice(16)))) return;
        // templates loaded from this PC's own template folder render in the browser outputs and previews too
        if (app.isLocal && app.config.templatesPath && await serveStatic(res, app.templates.folder(), decodeURIComponent(pathname.slice(16)))) return;
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
