'use strict';
// The superuser page (analytics.<website>, or /super): the website's health and every registered production company
// with its numbers. Only the superuser emails (config superUsers, env SUPER_USERS; info@regemarkfp.com by default)
// sign in here, with their own password (set from an emailed link) and their own cookie: it is not a Studio account.
// People: only the Admins of each company are named, and only once they accepted the terms (their email is shared
// with the superuser to contact them, and for occasional marketing email they can opt out of). Nobody else is named.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { sha, fail, log } = require('./util');
const { hashPassword, checkPassword, normEmail } = require('./auth');
const { parseCookies } = require('./http');

const TERMS_VERSION = 1;
const SESSION_H = 12;
const COOKIE = 'rfp_su';
const startedAt = Date.now();

function parseMdstat(txt, dev) {
  const name = String(dev || '').replace(/^\/dev\//, '');
  const blocks = txt.split(/\n(?=md\d+\s*:)/).filter((b) => /^md\d+\s*:/.test(b));
  const b = blocks.find((x) => x.startsWith(name + ' ')) || (blocks.length === 1 ? blocks[0] : null);
  if (!b) return null;
  const head = /^(md\d+)\s*:\s*(\w+)(?:\s+\(([^)]*)\))?\s+(raid\d+|linear)\s+(.*)$/m.exec(b) || [];
  const disks = String(head[5] || '').trim().split(/\s+/).filter(Boolean).map((d) => { const m = /^(\w+)\[(\d+)\](\((\w)\))?/.exec(d) || []; return { name: m[1] || d, failed: m[4] === 'F', spare: m[4] === 'S' }; });
  const st = /\[(\d+)\/(\d+)\]\s*\[([U_]+)\]/.exec(b);
  const prog = /(resync|recovery|check|reshape)\s*=\s*([\d.]+)%.*?finish=([\d.]+min)?/.exec(b);
  return { device: head[1] || name, state: head[2] || '', level: head[4] || '', disks, wanted: st ? Number(st[1]) : disks.length, working: st ? Number(st[2]) : disks.filter((d) => !d.failed).length, map: st ? st[3] : '',
    healthy: st ? !st[3].includes('_') && !disks.some((d) => d.failed) : !disks.some((d) => d.failed), progress: prog ? { kind: prog[1], percent: Number(prog[2]), finish: prog[3] || '' } : null };
}

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
  // universe.<website> (analytics.<website> still works); config superUrl / SUPER_URL picks another address
  const site = () => (hostOf(cfg().publicUrl) || '').replace(/^www\./, '');
  const host = () => hostOf(cfg().superUrl) || (site() ? 'universe.' + site() : '');
  const hosts = () => [...new Set([host(), ...(site() ? ['universe.' + site(), 'analytics.' + site()] : [])].filter(Boolean))];
  // links in the email: the analytics address when the request came through it, else the website's /super
  function base(req) {
    const h = String((req && req.headers.host) || '').toLowerCase().replace(/:\d+$/, '');
    if (cfg().superUrl) return String(cfg().superUrl).replace(/\/+$/, '');
    if (h && hosts().includes(h)) return 'https://' + h;
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
      const im = org.data.image || '';
      out.push({ id: org.id, name: org.data.name || '(no name)', logo: !im ? '' : /^https:\/\//.test(im) ? im : '/media/' + encodeURIComponent(im), created: org.data.createdAt || 0, plan: org.data.plan || '', ...o, watchHours30: Math.round(o.watchHours30 * 10) / 10 });
    }
    return out.sort((a, b) => b.users - a.users || a.name.localeCompare(b.name));
  }

  // ---- the NAS (the home server's RAID 1 mirror): space, the mirror's health, what takes the room
  const nasDir = () => {
    const c = cfg();
    if (c.nasDir) return c.nasDir;
    if (process.env.NAS_DIR) return process.env.NAS_DIR;
    const media = c.mediaMirror || process.env.MEDIA_DIR || '';
    if (media && /assets[\\/]images[\\/]?$/.test(media)) return path.resolve(media, '..', '..');
    return '/srv/nas';
  };
  let sizes = { at: 0, dir: '', list: [], busy: false };
  function measure(dir) {
    if (sizes.busy || (sizes.dir === dir && Date.now() - sizes.at < 15 * 60e3)) return;
    sizes.busy = true;
    execFile('du', ['-b', '--max-depth=1', dir], { timeout: 60e3, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      const list = String(out || '').split('\n').map((l) => l.split('\t')).filter((x) => x.length === 2 && x[1] !== dir)
        .map(([b, p]) => ({ name: path.basename(p), bytes: Number(b) || 0 })).sort((a, b) => b.bytes - a.bytes);
      sizes = { at: Date.now(), dir, list, busy: false, partial: !!err };
    });
  }
  // /proc/mdstat: the mirror, its disks ([UU] both fine, [U_] one gone), a rebuild or check in progress
  function raidOf(dev) {
    let txt = '';
    try { txt = fs.readFileSync('/proc/mdstat', 'utf8'); } catch { return null; }
    return parseMdstat(txt, dev);
  }
  async function nas() {
    const dir = nasDir();
    const out = { path: dir, exists: fs.existsSync(dir) };
    if (!out.exists) return out;
    try { const d = await fs.promises.statfs(dir); out.total = d.blocks * d.bsize; out.free = d.bavail * d.bsize; out.used = out.total - (d.bfree * d.bsize); } catch { /* not readable */ }
    // which device the folder lives on (the longest mount point that holds it)
    try {
      const mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')).filter((x) => x.length > 2);
      const real = fs.realpathSync(dir);
      const m = mounts.filter(([, mp]) => real === mp || real.startsWith(mp.replace(/\/$/, '') + '/')).sort((a, b) => b[1].length - a[1].length)[0];
      if (m) { out.device = m[0]; out.mount = m[1]; out.fs = m[2]; }
    } catch { /* not on Linux */ }
    out.raid = raidOf(out.device);
    out.share = fs.existsSync('/etc/samba/smb.conf') ? (/\[NAS\]/i.test(fs.readFileSync('/etc/samba/smb.conf', 'utf8')) ? 'NAS' : '') : '';
    measure(dir);
    out.folders = sizes.dir === dir ? sizes.list : [];
    out.measuredAt = sizes.dir === dir ? sizes.at : 0;
    out.measuring = sizes.busy;
    return out;
  }

  // ---- the NAS's users (Samba: the house network and Tailscale), through the root helper rfp-nas-users
  const helper = () => cfg().nasUsersHelper || '/usr/local/sbin/rfp-nas-users';
  function nasRun(args, input) {
    return new Promise((resolve, reject) => {
      const bin = cfg().nasUsersHelper ? helper() : 'sudo';
      const argv = cfg().nasUsersHelper ? args : ['-n', helper(), ...args];
      const p = execFile(bin, argv, { timeout: 30e3 }, (err, out, errOut) => {
        if (err) return reject(Object.assign(new Error(String(errOut || '').trim().split('\n').pop() || 'The NAS helper is not installed yet (run: sudo rfp-autoupdate)'), { status: 400 }));
        resolve(String(out || ''));
      });
      if (input !== undefined) p.stdin.end(input + '\n'); else p.stdin.end();
    });
  }
  const userName = (n) => { const u = String(n || '').trim().toLowerCase(); if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(u)) fail(400, 'Use lower-case letters, digits, - or _ (up to 32), starting with a letter'); return u; };
  // who may open what: per user the whole NAS (read and write, or read only), chosen folders (each read or read and
  // write; every folder becomes its own share \\server\Name), or nothing. Kept here (kv nas:perms) and written to
  // Samba by the helper. Until it is first saved, every NAS user has the whole NAS (as install.sh set it up).
  const MODES = ['full', 'read', 'folders', 'none'];
  const getPerms = async () => (await app.store.kvGet('nas:perms').catch(() => null)) || null;
  const relOk = (r) => /^[A-Za-z0-9 _.,'()&+-]+(\/[A-Za-z0-9 _.,'()&+-]+)*$/.test(r) && !/(^|\/)\.\.?(\/|$)/.test(r);
  function shareNames(rels, old = {}) {
    const used = new Set(['nas', 'global', 'homes', 'printers']), out = {};
    for (const rel of rels) {
      let base = old[rel] || (rel.split('/').pop().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'Folder').slice(0, 36);
      if (!/^[A-Za-z0-9]/.test(base)) base = 'F' + base;
      let n = base, i = 2;
      while (used.has(n.toLowerCase())) n = base.slice(0, 36) + '-' + i++;
      used.add(n.toLowerCase()); out[rel] = n;
    }
    return out;
  }
  function rulesOf(perms) {
    const full = [], read = [], byRel = {};
    for (const [u, p] of Object.entries(perms.users || {})) {
      if (p.mode === 'full') full.push(u); else if (p.mode === 'read') read.push(u);
      else if (p.mode === 'folders') for (const [rel, lv] of Object.entries(p.folders || {})) { (byRel[rel] = byRel[rel] || { r: [], w: [] })[lv === 'write' ? 'w' : 'r'].push(u); }
    }
    const rels = Object.keys(byRel).sort();
    perms.shares = shareNames(rels, perms.shares || {});
    const list = (a) => (a.length ? a.join(',') : '-');
    return [`full\t${list(full)}`, `read\t${list(read)}`, ...rels.map((rel) => `share\t${perms.shares[rel]}\t${rel}\t${list(byRel[rel].r)}\t${list(byRel[rel].w)}`)].join('\n');
  }
  async function applyPerms(perms) {
    await nasRun(['apply'], rulesOf(perms));
    perms.at = Date.now();
    await app.store.kvSet('nas:perms', perms);
    return perms;
  }
  const accessOf = (perms, name) => (perms ? (perms.users || {})[name] || { mode: 'none', folders: {} } : { mode: 'full', folders: {} });
  async function nasUsers() {
    let ready = true, users = [], info = {}, folders = [];
    const perms = await getPerms();
    try {
      users = (await nasRun(['list'])).split('\n').filter(Boolean).map((l) => { const [name, state, kind] = l.split('\t'); return { name, enabled: state === 'enabled', madeHere: kind === 'made-here' }; });
      const [host, tsName, tsIp, share] = (await nasRun(['info'])).trim().split('\t');
      info = { host: host || os.hostname(), tailscale: tsName || '', tailscaleIp: tsIp || '', share: 'NAS', path: share || nasDir() };
      folders = (await nasRun(['folders']).catch(() => '')).split('\n').filter(Boolean);
    } catch (e) { ready = false; info = { host: os.hostname(), error: e.message }; }
    for (const u of users) {
      const a = accessOf(perms, u.name);
      u.access = { mode: a.mode, folders: a.folders || {}, shares: a.mode === 'folders' ? Object.keys(a.folders || {}).map((rel) => (perms && perms.shares && perms.shares[rel]) || rel) : [] };
    }
    return { ready, users, info, folders, managed: !!perms };
  }
  function cleanAccess(a = {}) {
    const mode = MODES.includes(a.mode) ? a.mode : 'none', folders = {};
    if (mode === 'folders') for (const [rel, lv] of Object.entries(a.folders || {})) {
      const r = String(rel).replace(/^\/+|\/+$/g, '');
      if (!relOk(r)) fail(400, 'Not a folder in the NAS: ' + rel);
      if (lv === 'read' || lv === 'write') folders[r] = lv;
    }
    return { mode, folders };
  }
  // one user's access changed (or a user added / removed): every rule written again
  async function setAccess(name, access, current) {
    const perms = (await getPerms()) || { users: Object.fromEntries((current || []).map((u) => [u.name, { mode: 'full', folders: {} }])), shares: {} };
    if (access === null) delete perms.users[name]; else perms.users[name] = cleanAccess(access);
    return applyPerms(perms);
  }
  async function nasUser(action, b = {}) {
    const name = userName(b.name);
    if (action === 'add' || action === 'passwd') {
      const pw = String(b.password || '');
      if (pw.length < 8) fail(400, 'Use a password of at least 8 characters');
      if (/[\r\n]/.test(pw)) fail(400, 'A password cannot have line breaks');
      const before = action === 'add' ? (await nasUsers()).users : null;
      await nasRun([action, name], pw);
      if (action === 'add' && (b.access || (await getPerms()))) await setAccess(name, b.access || { mode: 'none' }, before);
    } else if (['enable', 'disable'].includes(action)) await nasRun([action, name]);
    else if (action === 'remove') { await nasRun([action, name]); if (await getPerms()) await setAccess(name, null); }
    else if (action === 'access') await setAccess(name, b.access || {}, (await nasUsers()).users);
    else fail(400, 'Unknown action');
    return nasUsers();
  }

  // ---- the file browser: everything under the NAS folder (never outside it), as the website's account
  async function inNas(rel) {
    const root = await fs.promises.realpath(nasDir()).catch(() => fail(404, 'No NAS folder on this server'));
    const parts = String(rel || '').split(/[\\/]+/).filter((x) => x && x !== '.');
    if (parts.some((x) => x === '..' || x.includes('\0'))) fail(400, 'Not a path on the NAS');
    const full = path.join(root, ...parts);
    let real = full;
    try { real = await fs.promises.realpath(full); } catch { real = path.join(await fs.promises.realpath(path.dirname(full)).catch(() => fail(404, 'Not found')), path.basename(full)); }
    if (real !== root && !real.startsWith(root + path.sep)) fail(403, 'That is outside the NAS');
    return { root, full: real, rel: parts.join('/') };
  }
  const safeName = (n) => { const x = String(n || '').trim(); if (!x || x === '.' || x === '..' || /[\\/\0]/.test(x) || x.length > 200) fail(400, 'Give a name without / or \\'); return x; };
  async function list(rel) {
    const p = await inNas(rel);
    const st = await fs.promises.stat(p.full).catch(() => fail(404, 'Not found'));
    if (!st.isDirectory()) fail(400, 'Not a folder');
    const items = [];
    for (const d of await fs.promises.readdir(p.full, { withFileTypes: true }).catch((e) => fail(403, 'Cannot open this folder (' + e.code + ')'))) {
      if (d.name.startsWith('.') && d.name !== '..') continue;
      let s = null; try { s = await fs.promises.stat(path.join(p.full, d.name)); } catch { continue; }
      items.push({ name: d.name, dir: s.isDirectory(), size: s.isDirectory() ? null : s.size, mtime: s.mtimeMs });
    }
    items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return { path: p.rel, items };
  }
  const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8' };
  async function download(req, res, rel, inline) {
    const p = await inNas(rel);
    const st = await fs.promises.stat(p.full).catch(() => fail(404, 'Not found'));
    if (!st.isFile()) fail(400, 'Not a file');
    const ext = path.extname(p.full).toLowerCase(), type = TYPES[ext] || 'application/octet-stream';
    const show = inline && TYPES[ext] && ext !== '.svg';
    const name = path.basename(p.full).replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${show ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(path.basename(p.full))}`, 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox" };
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : st.size - Number(m[2]), end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      if (start < 0) start = 0; if (end >= st.size) end = st.size - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(p.full, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(p.full).pipe(res);
  }
  const MAX_UPLOAD = 4 * 1024 * 1024 * 1024;
  async function upload(req, rel, name) {
    const dir = await inNas(rel);
    const st = await fs.promises.stat(dir.full).catch(() => fail(404, 'Folder not found'));
    if (!st.isDirectory()) fail(400, 'Not a folder');
    const target = path.join(dir.full, safeName(name));
    const tmp = path.join(dir.full, '.upload-' + crypto.randomBytes(6).toString('hex'));
    let n = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp, { mode: 0o664 });
      req.on('data', (c) => { n += c.length; if (n > MAX_UPLOAD) { req.destroy(); out.destroy(); reject(Object.assign(new Error('Files up to 4 GB'), { status: 413 })); } });
      req.on('error', reject); out.on('error', reject); out.on('finish', resolve);
      req.pipe(out);
    }).catch(async (e) => { await fs.promises.rm(tmp, { force: true }); throw e.status ? e : Object.assign(new Error('The upload stopped: ' + e.message), { status: 400 }); });
    await fs.promises.rename(tmp, target);
    await fs.promises.chmod(target, 0o664).catch(() => {});
    return { name: path.basename(target), size: n };
  }
  async function mkdir(rel, name) {
    const dir = await inNas(rel);
    const target = path.join(dir.full, safeName(name));
    await fs.promises.mkdir(target).catch((e) => fail(e.code === 'EEXIST' ? 409 : 400, e.code === 'EEXIST' ? 'That already exists' : 'Could not make the folder'));
    await fs.promises.chmod(target, 0o2775).catch(() => {});
    return { ok: true };
  }
  async function rename(rel, to) {
    const p = await inNas(rel);
    if (p.full === p.root) fail(400, 'Not the NAS itself');
    const target = path.join(path.dirname(p.full), safeName(to));
    if (fs.existsSync(target)) fail(409, 'That name is taken');
    await fs.promises.rename(p.full, target).catch(() => fail(400, 'Could not rename it'));
    return { ok: true };
  }
  async function remove(rel) {
    const p = await inNas(rel);
    if (p.full === p.root) fail(400, 'Not the NAS itself');
    await fs.promises.rm(p.full, { recursive: true, force: false }).catch((e) => fail(400, 'Could not delete it (' + e.code + ')'));
    log(`Universe: deleted ${p.rel} from the NAS`);
    return { ok: true };
  }
  const files = { list, download, upload, mkdir, rename, remove };

  async function overview() { return { health: await health(), companies: await companies(), termsVersion: TERMS_VERSION }; }

  // the Admins who accepted and did not opt out of marketing email, as CSV
  async function contactsCsv() {
    const q = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
    const rows = [['Company', 'Name', 'Email', 'Marketing email']];
    for (const c of await companies()) for (const a of c.admins) if (!a.hidden) rows.push([c.name, a.name, a.email, a.marketing ? 'yes' : 'opted out']);
    return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  }

  return { users, isSuper, host, hosts, session, need, login, logout, requestReset, setPassword, health, companies, overview, contactsCsv, nas, nasUsers, nasUser, files, TERMS_VERSION };
}

module.exports = { makeSuper, parseMdstat, TERMS_VERSION };
