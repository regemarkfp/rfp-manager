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
  const pubUser = (u) => ({ id: u.id, name: u.data.name || '', email: u.data.email, image: u.data.image || '', hasPassword: !!u.data.passwordHash, google: !!u.data.googleSub });

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
  async function storeImage(team, buf, mime, name, kind, userId, sourceUrl) {
    if (!MIME[mime]) fail(415, 'Use a PNG, JPG, WebP, GIF or SVG image');
    if (!buf.length) fail(400, 'The image is empty');
    if (buf.length > MAX_IMAGE) fail(413, 'Images can be up to 8 MB');
    const id = newId('img_');
    const clean = String(name || 'image').replace(/\.[A-Za-z0-9]{2,5}$/, '').slice(0, 80) || 'image';
    const doc = { id, team, type: 'image', data: { name: clean, file: fileNameFor(id, clean, mime), mime, size: buf.length, sha256: sha(buf), kind: String(kind || '').slice(0, 30), ...(sourceUrl ? { sourceUrl } : {}) } };
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
  r.add('GET', '/api/config', async () => ({ name: cfg.name, mode: cfg.mode, version: app.version, googleClientId: cfg.google.clientId || '',
    needsSetup: await needsSetup(), allowSignup: !!cfg.allowSignup, linked: !!(app.sync && app.sync.linked()) }));

  r.add('POST', '/api/auth/google', async (req, res) => {
    auth.throttle(clientIp(req, !app.isLocal));
    const g = await auth.verifyGoogle((await readJson(req)).credential);
    const existing = await auth.userByEmail(g.email);
    if (app.isLocal && !existing && !cfg.allowSignup && !(await app.store.find('member', 'email', g.email)).length) {
      fail(403, `${g.email} has not been added to a production team on this machine. Ask an Admin to add you, or sign in on the website first.`);
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
    if (url) { await app.sync.run(); await app.sync.ensureMedia(); }
  }

  r.add('GET', '/api/me', async (req) => {
    const user = await needUser(req);
    const teams = (await auth.teamsFor(user)).map((t) => ({ id: t.id, role: t.role, name: t.org.name, accentColor: t.org.accentColor || '#00ff82', image: t.org.image || '' }));
    return { user: pubUser(user), teams, machine: { mode: cfg.mode, name: cfg.machineName || '', admin: app.isLocal && teams.some((t) => t.role === 'Admin'), linked: !!(app.sync && app.sync.linked()),
      sync: app.sync ? app.sync.status() : null, outputKey: app.isLocal && teams.length ? cfg.outputKey : '', hostname: app.isLocal ? require('node:os').hostname() : '', port: cfg.port, shortLinks: cfg.shortLinks !== false, onAirFixture: app.gfx ? app.gfx.fixtureId || '' : '' } };
  });

  r.add('POST', '/api/me', async (req) => {
    const user = await needUser(req);
    if (app.sync && app.sync.linked()) fail(400, 'This machine is linked to the website. Change your name or password there and it will sync down.');
    const b = await readJson(req);
    const data = { ...user.data };
    if (b.name !== undefined) data.name = String(b.name).slice(0, 80);
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
    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) fail(400, 'Give the production team a name');
    const id = newId('org_');
    await app.save(id, 'org', id, { name, accentColor: '#00ff82', currency: 'ZAR' }, user.id);
    await app.save(id, 'member', memberIdFor(id, user.data.email), { email: normEmail(user.data.email), name: user.data.name || '', role: 'Admin' }, user.id);
    return { id };
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
    if (cur && !cur.deleted && cur.data.role === 'Admin' && b.role !== 'Admin' && (await admins(team)).length <= 1) fail(400, 'A production team needs at least one Admin');
    if (b.password) {
      if (!app.isLocal) fail(400, 'Online, people sign in with their own Google account. Passwords can only be set on a production PC.');
      if (String(b.password).length < 8) fail(400, 'Use a password of at least 8 characters');
      const u = await auth.userByEmail(email);
      const localOnly = app.isLocal && !(app.sync && app.sync.linked());
      if (u && (u.data.passwordHash || u.data.googleSub) && !localOnly) fail(409, 'That person already has an account and can sign in with it');
      await auth.ensureUser({ email, name: String(b.name || '').slice(0, 80), passwordHash: hashPassword(b.password) });
    }
    return { doc: await app.save(team, 'member', id, { email, name: String(b.name || (cur && cur.data.name) || '').slice(0, 80), role: b.role }, user.id) };
  });

  r.add('DELETE', '/api/members/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.admin, 'Only an Admin can manage members');
    const cur = await app.store.get(p.id);
    if (!cur || cur.team !== team || cur.type !== 'member') fail(404, 'Member not found');
    if (cur.data.role === 'Admin' && (await admins(team)).length <= 1) fail(400, 'A production team needs at least one Admin');
    await app.remove(p.id, user.id);
    return {};
  });

  // ---- records --------------------------------------------------------------------------------
  r.add('GET', '/api/docs', async (req) => {
    const team = qs(req).get('team');
    const { role } = await needRole(req, team, Schema.CAN.read);
    return { docs: (await app.store.listTeam(team)).map((d) => viewDoc(d, role)), now: Date.now() };
  });

  r.add('PUT', '/api/docs/:type/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    const isOrg = p.type === 'org';
    if (!isOrg && !Schema.ENTITIES[p.type]) fail(400, 'Unknown record type');
    const { user } = await needRole(req, team, isOrg ? Schema.CAN.admin : Schema.CAN.edit, isOrg ? 'Only an Admin can change team settings' : 'You need the Producer role to edit this');
    if (!/^[\w-]{6,80}$/.test(p.id) || (isOrg && p.id !== team)) fail(400, 'Bad record id');
    const b = await readJson(req);
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) fail(400, 'No data');
    const cur = await app.store.get(p.id);
    if (cur && (cur.team !== team || cur.type !== p.type)) fail(409, 'That id belongs to another record');
    for (const f of Schema.fieldsFor(p.type, null)) if (f.req && !String(b.data[f.k] === undefined || b.data[f.k] === null ? '' : b.data[f.k]).trim()) fail(400, `${f.l} is required`);
    return { doc: await app.write(team, p.type, p.id, b.data, user.id) };
  });

  r.add('DELETE', '/api/docs/:type/:id', async (req, res, p) => {
    const team = qs(req).get('team');
    if (!Schema.ENTITIES[p.type] && p.type !== 'image') fail(400, 'Unknown record type');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to delete this');
    const cur = await app.store.get(p.id);
    if (!cur || cur.team !== team || cur.type !== p.type) fail(404, 'Record not found');
    await app.remove(p.id, user.id);
    return {};
  });

  r.add('POST', '/api/images', async (req) => {
    const q = qs(req), team = q.get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to add images');
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const buf = await readBody(req, MAX_IMAGE + 1024);
    return { doc: await storeImage(team, buf, mime, q.get('name'), q.get('kind'), user.id) };
  });

  r.add('POST', '/api/images/url', async (req) => {
    const b = await readJson(req);
    const { user } = await needRole(req, b.team, Schema.CAN.edit, 'You need the Producer role to add images');
    return { id: await fetchImage(b.team, b.url, b.name, user.id) };
  });

  r.add('GET', '/media/:id', async (req, res, p) => {
    const doc = await app.store.get(p.id);
    if (!doc || doc.deleted || doc.type !== 'image') fail(404, 'Image not found');
    const buf = await app.blobs.get(doc);
    if (!buf) fail(404, 'This image has not been downloaded to this machine yet');
    send(res, 200, buf, { 'Content-Type': MIME[doc.data.mime] ? doc.data.mime : 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  });

  // ---- save file (XML) ------------------------------------------------------------------------
  r.add('GET', '/api/export.xml', async (req, res) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.edit, 'You need the Producer role to export');
    send(res, 200, await exportXml(app, team, user), { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="RFP Manager - Save File.xml"' });
  });

  r.add('POST', '/api/import.xml', async (req) => {
    const team = qs(req).get('team');
    const { user } = await needRole(req, team, Schema.CAN.admin, 'Only an Admin can import a save file');
    const text = (await readBody(req, 20 * 1024 * 1024)).toString('utf8');
    try { return { counts: await importXml(app, team, text, user.id, fetchImage) }; }
    catch (e) { if (e.status) throw e; fail(400, e.message); }
  });

  // ---- this machine (production PC) -----------------------------------------------------------
  const machineView = async () => ({ mediaFolder: app.mediaFolder(), mediaFolderSetting: cfg.mediaFolder || '', caspar: { ...cfg.caspar }, cloud: { url: cfg.cloud.url || '', hasKey: !!cfg.cloud.key }, syncSeconds: cfg.syncSeconds,
    access: cfg.access, googleClientId: cfg.google.clientId || '', machineName: cfg.machineName, outputKey: cfg.outputKey, port: cfg.port,
    sync: app.sync.status(), casparStatus: app.gfx.amcp.status(), images: (await app.store.listType('image')).length, database: app.store.file || '' });

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
    app.saveConfig();
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

  async function handle(req, res) { return actor.run({ ip: String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''), via: 'RFP Manager' }, () => handle0(req, res)); }
  async function handle0(req, res) {
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname;
    try {
      if (!allowed(req)) return send(res, 403, { error: 'This address is not allowed to reach RFP Manager (see "access" in Settings > This machine).' });
      if (pathname === '/healthz') return send(res, 200, { ok: true });
      if (pathname.startsWith('/live/api/')) { await app.live.http(req, res, pathname); return; }
      if (pathname.startsWith('/worship/api/')) { await app.worship.http(req, res, pathname); return; }
      // Short links for this device: http://pc-name/scorer, /confidence, /rundown, /graphics-control, /output, /preview …
      if (app.isLocal && SHORT[pathname.toLowerCase().replace(/\/+$/, '')]) {
        const [page, open, extra] = SHORT[pathname.toLowerCase().replace(/\/+$/, '')];
        const q = new URLSearchParams(new URL(req.url, 'http://x').search);
        if (open && cfg.shortLinks !== false && !q.get('key') && !(await auth.userFromReq(req).catch(() => null))) q.set('key', cfg.outputKey);
        for (const [k, v] of Object.entries(extra || {})) if (!q.has(k)) q.set(k, v);
        let target = page;
        if (page === 'scorer') { const fx = app.gfx && app.gfx.fixtureId ? await app.store.get(app.gfx.fixtureId) : null; const sp = fx && !fx.deleted ? Scoring.sportFor(fx.data.sport) : null; target = sp && sp.id === 'cricket' ? '/live/stats.html' : '/live/sport.html'; }
        if (page === 'stats') { target = '/live/sport.html'; q.set('page', 'entry'); }
        res.writeHead(302, { Location: target + (q.toString() ? '?' + q : ''), 'Cache-Control': 'no-store' }); res.end(); return;
      }
      const m = r.match(req.method, pathname);
      if (m) {
        if (req.method !== 'GET' && !req.headers.authorization && req.headers['x-rfp'] !== '1') fail(403, 'Missing request header');
        const out = await m.handler(req, res, m.params);
        if (!res.headersSent) send(res, 200, out);
        return;
      }
      if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      const csp = { 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://accounts.google.com; frame-src 'self' https://accounts.google.com; connect-src 'self' ws: wss: https://accounts.google.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://accounts.google.com; font-src 'self' data:", 'Referrer-Policy': 'no-referrer-when-downgrade', 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' };
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
      send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server' });
    }
  }

  return { handle, fetchImage };
}

module.exports = { makeApi };
