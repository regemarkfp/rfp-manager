'use strict';
// Sharing (sharing.regemarkfp.com): shared folders on the NAS for a production or an event. Producers and Admins of the
// team make a folder and invite people by email as Viewer (see and download) or Editor (also upload, make folders,
// rename, delete). People sign in with Google or a password (the same accounts as the client portal).
//   - Files live on disk: <sharing folder>/<share id>/files/…   (config sharingDir, SHARING_DIR, <NAS>/sharing, data/sharing)
//   - Uploads come in pieces (32 MB, under Cloudflare's 100 MB limit) and carry on after a dropped connection.
//   - Previews: photos, PDFs, audio and browser-friendly video as they are; other video (ProRes, MXF, HEVC …) gets a
//     720p proxy made by ffmpeg the first time it is opened. Video and photo thumbnails come from ffmpeg too.
//   - Downloads: one file (with byte ranges), or folders and selections as one ZIP written as it goes (lib/zipstream.js).
//   - Comments on a file (a timecode on video), an activity list, and a summary email when new files or comments come in.
// Records: "share" { name, production, members: [{ email, role, invitedBy, at, token, accepted, notify }], createdBy },
// "sharecomment" { share, path, text, tc, email, name, at }; kv "share:meta:<id>" (who added each file), "share:act:<id>".
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const Schema = require('../shared/schema');
const { newId, fail, log } = require('./util');
const { zipTo } = require('./zipstream');

const CHUNK = 32 * 1024 * 1024;
const ROLES = ['viewer', 'editor'];
const KIND = [
  ['image', /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|tiff?|cr2|cr3|nef|arw|dng|raf|orf|rw2)$/i],
  ['video', /\.(mp4|m4v|mov|mkv|webm|avi|mxf|mts|m2ts|ts|wmv|flv|3gp|mpg|mpeg|braw|r3d)$/i],
  ['audio', /\.(mp3|wav|m4a|aac|ogg|oga|flac|aif|aiff|wma|opus)$/i],
  ['pdf', /\.pdf$/i],
  ['text', /\.(txt|csv|md|json|srt|vtt|xml|log|edl|cue)$/i],
  ['doc', /\.(docx?|xlsx?|pptx?|odt|ods|odp|key|pages|numbers)$/i],
  ['archive', /\.(zip|rar|7z|tar|gz)$/i],
];
const kindOf = (name) => (KIND.find(([, re]) => re.test(name)) || ['file'])[0];
const WEB_IMAGE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const WEB_VIDEO = /\.(mp4|m4v|webm)$/i;
const WEB_AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg', pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', json: 'text/plain; charset=utf-8', srt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8', xml: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8', edl: 'text/plain; charset=utf-8', cue: 'text/plain; charset=utf-8' };
const mimeOf = (name) => MIME[(/\.([a-z0-9]+)$/i.exec(name) || [])[1] ? (/\.([a-z0-9]+)$/i.exec(name) || [])[1].toLowerCase() : ''] || 'application/octet-stream';
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));
const normEmail = (e) => String(e || '').trim().toLowerCase();

// a path inside a share: "Day 1/Camera A/A001.mov" – no "..", no hidden names, no slashes at the ends
function cleanPath(p, { allowRoot = true } = {}) {
  const parts = String(p == null ? '' : p).replace(/\\/g, '/').split('/').map((x) => x.trim()).filter(Boolean);
  for (const x of parts) {
    if (x === '.' || x === '..' || x.startsWith('.') || /[\u0000-\u001f<>:"|?*]/.test(x) || x.length > 200) fail(400, `"${x}" cannot be used as a name`);
  }
  if (!allowRoot && !parts.length) fail(400, 'Choose a file or folder');
  if (parts.join('/').length > 1000) fail(400, 'That path is too long');
  return parts.join('/');
}
const cleanName = (n) => { const c = cleanPath(n, { allowRoot: false }); if (c.includes('/')) fail(400, 'A name cannot contain /'); return c; };

function makeSharing(app) {
  const cfg = () => app.config;
  function baseDir() {
    const c = cfg();
    if (c.sharingDir) return path.resolve(c.sharingDir);
    if (process.env.SHARING_DIR) return path.resolve(process.env.SHARING_DIR);
    if (c.nasDir || process.env.NAS_DIR) return path.join(c.nasDir || process.env.NAS_DIR, 'sharing');
    const media = c.mediaMirror || process.env.MEDIA_DIR || '';
    if (media && /assets[\\/]images[\\/]?$/.test(media)) return path.resolve(media, '..', '..', 'sharing');
    if (process.env.SOFTWARE_DIR) return path.resolve(process.env.SOFTWARE_DIR, '..', 'sharing');
    return path.join(app.dataDir(), 'sharing');
  }
  const safeId = (id) => String(id || '').replace(/[^\w-]/g, '');
  const rootOf = (id) => path.join(baseDir(), safeId(id), 'files');
  const sysOf = (id, ...p) => path.join(baseDir(), safeId(id), '.rfp', ...p);
  const abs = (id, rel) => { const r = rootOf(id), f = path.resolve(r, rel || '.'); if (f !== r && !f.startsWith(r + path.sep)) fail(400, 'Not inside this folder'); return f; };
  const siteUrl = () => String(cfg().sharingUrl || (String(cfg().publicUrl || '').replace(/\/+$/, '') + '/sharing')).replace(/\/+$/, '');
  const get = async (id) => { const d = id ? await app.store.get(String(id)) : null; return d && !d.deleted && d.type === 'share' ? d : null; };
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

  // ---------------------------------------------------------------- who may do what
  //   manager: a Producer or Admin of the team (makes folders, invites, everything); editor; viewer
  async function roleIn(share, user) {
    if (!user) return null;
    const r = await app.auth.roleIn(user, share.team).catch(() => null);
    if (r && Schema.CAN.edit(r)) return 'manager';
    const m = (share.data.members || []).find((x) => x.email === normEmail(user.data.email));
    return m ? m.role : null;
  }
  async function access(id, user, need = 'viewer') {
    if (!user) fail(401, 'Sign in first');
    const share = await get(id);
    if (!share) fail(404, 'This shared folder does not exist (any more)');
    const role = await roleIn(share, user);
    const rank = { viewer: 1, editor: 2, manager: 3 };
    if (!role) fail(403, 'You have not been invited to this folder. Ask the production team to invite ' + user.data.email);
    if (rank[role] < rank[need]) fail(403, need === 'manager' ? 'Only Producers and Admins of the production team can do that' : 'You can see this folder but not change it (you were invited as a viewer)');
    // the first visit of an invited person counts as accepting
    const m = (share.data.members || []).find((x) => x.email === normEmail(user.data.email));
    if (m && !m.accepted) { m.accepted = Date.now(); await app.save(share.team, 'share', share.id, share.data, user.id).catch(() => {}); }
    return { share, role, user };
  }
  const who = (user) => ({ email: normEmail(user.data.email), name: user.data.name || normEmail(user.data.email).split('@')[0] });

  // ---------------------------------------------------------------- activity, uploaders, summary emails
  const metaCache = new Map();
  async function meta(id) {
    if (!metaCache.has(id)) metaCache.set(id, (await app.store.kvGet('share:meta:' + id).catch(() => null)) || {});
    return metaCache.get(id);
  }
  const metaSave = (() => { const t = new Map(); return (id) => { clearTimeout(t.get(id)); const x = setTimeout(() => { app.store.kvSet('share:meta:' + id, metaCache.get(id) || {}).catch(() => {}); }, 500); if (x.unref) x.unref(); t.set(id, x); }; })();
  async function activity(share, user, what, p, extra = {}) {
    const k = 'share:act:' + share.id;
    const list = (await app.store.kvGet(k).catch(() => null)) || [];
    list.unshift({ at: Date.now(), email: user ? normEmail(user.data.email) : '', name: user ? user.data.name || '' : '', what, path: p || '', ...extra });
    await app.store.kvSet(k, list.slice(0, 300)).catch(() => {});
    if (['upload', 'comment'].includes(what) && !extra.quiet) digest(share, user, what, p, extra);
  }
  // one email per folder at most every 10 minutes: "5 new files in Cup final (Ruan)"
  const pending = new Map();
  function digest(share, user, what, p, extra) {
    const q = pending.get(share.id) || { files: [], comments: [], by: new Set(), t: null };
    if (what === 'upload') q.files.push(p); else q.comments.push({ path: p, text: extra.text || '' });
    if (user) q.by.add(normEmail(user.data.email));
    pending.set(share.id, q);
    if (q.t) return;
    q.t = setTimeout(() => { pending.delete(share.id); sendDigest(share.id, q).catch((e) => log('Sharing email:', e.message)); }, Number(cfg().sharingDigestMs) || 10 * 60e3);
    if (q.t.unref) q.t.unref();
  }
  async function sendDigest(id, q) {
    const share = await get(id);
    if (!share || !app.mail || !app.mail.enabled()) return;
    const names = [...q.by];
    const to = (share.data.members || []).filter((m) => m.notify !== false && !(names.length === 1 && m.email === names[0])).map((m) => m.email);
    if (!to.length) return;
    const n = q.files.length, c = q.comments.length;
    const what = [n ? `${n} new file${n > 1 ? 's' : ''}` : '', c ? `${c} new comment${c > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
    await app.mail.send(to, { subject: `${what} in ${share.data.name}`, title: share.data.name,
      lines: [`${what} from ${names.join(', ') || 'the team'}:`, ...q.files.slice(0, 12).map((f) => '• ' + f), ...(n > 12 ? [`… and ${n - 12} more`] : []), ...q.comments.slice(0, 6).map((x) => `💬 ${x.path}: “${x.text.slice(0, 120)}”`)],
      button: { url: `${siteUrl()}/f/${share.id}`, label: 'Open the folder' }, footer: 'You get this because you were invited to this folder. Turn these emails off in the folder (People).' });
  }

  // ---------------------------------------------------------------- folders (shares)
  const view = (share, role, user) => ({ id: share.id, team: share.team, name: share.data.name, production: share.data.production || '', role, createdAt: share.data.createdAt, expires: share.data.expires || '', url: `${siteUrl()}/f/${share.id}`,
    members: role === 'manager' ? (share.data.members || []).map((m) => ({ email: m.email, role: m.role, invitedBy: m.invitedBy, at: m.at, accepted: !!m.accepted, notify: m.notify !== false })) : undefined,
    notify: user ? ((share.data.members || []).find((m) => m.email === normEmail(user.data.email)) || {}).notify !== false : undefined });
  // the production's name for a folder made from one (the Sharing site shows it next to "File Sharing")
  async function prodName(share) {
    if (!share.data.production) return '';
    const p = await app.store.get(share.data.production).catch(() => null);
    return p && !p.deleted ? [p.data.name, p.data.date].filter(Boolean).join(' · ') : '';
  }
  async function mine(user) {
    if (!user) fail(401, 'Sign in first');
    const email = normEmail(user.data.email), out = [];
    const teams = (await app.auth.teamsFor(user).catch(() => [])).filter((t) => Schema.CAN.edit(t.role)).map((t) => t.id);
    for (const s of await app.store.listType('share')) {
      if (s.deleted) continue;
      const role = teams.includes(s.team) ? 'manager' : ((s.data.members || []).find((m) => m.email === email) || {}).role;
      if (role) out.push({ ...view(s, role, user), productionName: await prodName(s) });
    }
    const teamNames = {};
    for (const t of new Set(out.map((x) => x.team))) { const o = await app.store.get(t).catch(() => null); teamNames[t] = o ? o.data.name || '' : ''; }
    out.forEach((x) => { x.teamName = teamNames[x.team] || ''; });
    return { shares: out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), canCreate: teams, teams: teams.map((id) => ({ id, name: teamNames[id] || '' })) };
  }
  async function create(team, b, user) {
    const role = await app.auth.roleIn(user, team).catch(() => null);
    if (!role || !Schema.CAN.edit(role)) fail(403, 'Only Producers and Admins of the production team can make shared folders');
    let name = str(b.name, 120), production = '';
    if (b.production) {
      const p = await app.store.get(String(b.production));
      if (!p || p.deleted || p.type !== 'production' || p.team !== team) fail(404, 'Production not found');
      production = p.id; if (!name) name = [p.data.name, p.data.date].filter(Boolean).join(' · ');
    }
    if (!name) fail(400, 'Give the folder a name');
    const id = newId('shr_');
    await fsp.mkdir(rootOf(id), { recursive: true });
    const expires = String(b.expires || '');
    if (expires && (!okDate(expires) || expires < today())) fail(400, 'Choose a removal date in the future (YYYY-MM-DD)');
    const doc = await app.save(team, 'share', id, { name, production, expires, members: [], createdBy: user.data.email, createdAt: Date.now() }, user.id);
    await activity(doc, user, 'create', '');
    return view(doc, 'manager', user);
  }
  // the folder of a production (made the first time)
  async function forProduction(team, prodId, user) {
    const role = await app.auth.roleIn(user, team).catch(() => null);
    if (!role || !Schema.CAN.edit(role)) fail(403, 'Only Producers and Admins of the production team can open the shared folder');
    const cur = (await app.store.list(team, 'share')).find((s) => !s.deleted && s.data.production === prodId);
    return cur ? view(cur, 'manager', user) : create(team, { production: prodId }, user);
  }
  async function info(id, user) { const { share, role } = await access(id, user); return { ...view(share, role, user), productionName: await prodName(share) }; }
  // edit a folder: name, the production it belongs to, the date it is removed from the server (YYYY-MM-DD, '' = never)
  const okDate = (d) => /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d);
  async function rename(id, b, user) {
    const { share } = await access(id, user, 'manager');
    const data = { ...share.data };
    if (b.name !== undefined) { const name = str(b.name, 120); if (!name) fail(400, 'Give the folder a name'); data.name = name; }
    if (b.production !== undefined) {
      if (!b.production) data.production = '';
      else { const p = await app.store.get(String(b.production)); if (!p || p.deleted || p.type !== 'production' || p.team !== share.team) fail(404, 'Production not found'); data.production = p.id; }
    }
    if (b.expires !== undefined) {
      const e = String(b.expires || '');
      if (e && !okDate(e)) fail(400, 'Give the date as YYYY-MM-DD');
      if (e && e < today()) fail(400, 'That date has passed');
      if (e !== (data.expires || '')) { data.expires = e; data.warned = 0; }
    }
    await app.save(share.team, 'share', share.id, data, user.id);
    await activity(share, user, 'edit', '', { target: [b.name !== undefined ? 'name' : '', b.expires !== undefined ? (data.expires ? 'removal on ' + data.expires : 'no removal date') : ''].filter(Boolean).join(', ') });
    return { ...view({ ...share, data }, 'manager', user), productionName: await prodName({ ...share, data }) };
  }
  // the folder disappears for everyone now; its files are kept aside for sharingKeepDays (30) and then deleted
  async function dropShare(share, userId) {
    const dir = path.join(baseDir(), safeId(share.id)), gone = path.join(baseDir(), '.deleted', safeId(share.id) + '-' + Date.now());
    await fsp.mkdir(path.dirname(gone), { recursive: true });
    await fsp.rename(dir, gone).catch(() => {});
    await app.remove(share.id, userId);
  }
  async function removeShare(id, user) {
    const { share } = await access(id, user, 'manager');
    await dropShare(share, user.id);
    return {};
  }

  // ---------------------------------------------------------------- the daily tidy: expired folders, warnings, kept files
  const today = () => new Date().toISOString().slice(0, 10);
  const keepDays = () => (Number(cfg().sharingKeepDays) >= 0 && cfg().sharingKeepDays !== undefined && cfg().sharingKeepDays !== '' ? Number(cfg().sharingKeepDays) : 30);
  async function sweep() {
    const t = today(), soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    let removed = 0, warned = 0, purged = 0;
    for (const sh of await app.store.listType('share')) {
      if (sh.deleted || !sh.data.expires) continue;
      if (sh.data.expires <= t) {
        await dropShare(sh, 'expiry');
        log(`Sharing: "${sh.data.name}" reached its removal date (${sh.data.expires}) and was removed`);
        removed++; continue;
      }
      // three days before: the invited people (and whoever made it) hear that it is going, once
      if (sh.data.expires <= soon && !sh.data.warned && app.mail && app.mail.enabled()) {
        const to = [...new Set([...(sh.data.members || []).map((m) => m.email), normEmail(sh.data.createdBy)].filter(okEmail))];
        if (to.length) {
          await app.mail.send(to, { subject: `“${sh.data.name}” is removed on ${sh.data.expires}`, title: sh.data.name,
            lines: [`This shared folder and its files are removed from the server on ${sh.data.expires}.`, 'Download what you want to keep before then (Download all gives everything as one ZIP).'],
            button: { url: `${siteUrl()}/f/${sh.id}`, label: 'Open the folder' } }).catch(() => null);
        }
        await app.save(sh.team, 'share', sh.id, { ...sh.data, warned: Date.now() }, 'expiry');
        warned++;
      }
    }
    // files kept after deleting: removed folders (.deleted) and each folder's bin, after keepDays
    const cut = Date.now() - keepDays() * 864e5;
    const rmOld = async (dir, stampOf) => {
      let names = []; try { names = await fsp.readdir(dir); } catch { return; }
      for (const n of names) { const at = stampOf(n); if (at && at < cut) { await fsp.rm(path.join(dir, n), { recursive: true, force: true }).catch(() => {}); purged++; } }
    };
    await rmOld(path.join(baseDir(), '.deleted'), (n) => Number((/-(\d{13})$/.exec(n) || [])[1]) || 0);
    let ids = []; try { ids = (await fsp.readdir(baseDir())).filter((n) => !n.startsWith('.')); } catch { ids = []; }
    for (const id of ids) await rmOld(path.join(baseDir(), id, '.rfp', 'bin'), (n) => (/^\d{4}-\d{2}-\d{2}$/.test(n) ? Date.parse(n + 'T00:00:00Z') + 864e5 : 0));
    return { removed, warned, purged };
  }
  let sweepT = null, firstT = null;
  function start() {
    if (sweepT) return;
    const run = () => sweep().catch((e) => log('Sharing tidy:', e.message));
    sweepT = setInterval(run, Number(cfg().sharingSweepMs) || 3600e3); if (sweepT.unref) sweepT.unref();
    firstT = setTimeout(run, 60e3); if (firstT.unref) firstT.unref();
  }
  function stop() { clearInterval(sweepT); clearTimeout(firstT); sweepT = null; }

  // ---------------------------------------------------------------- people
  async function invite(id, b, user) {
    const { share } = await access(id, user, 'manager');
    const emails = [...new Set(String(b.emails || b.email || '').split(/[\s,;]+/).map(normEmail).filter(Boolean))];
    if (!emails.length) fail(400, 'Type an email address');
    const bad = emails.filter((e) => !okEmail(e)); if (bad.length) fail(400, 'Not an email address: ' + bad[0]);
    const role = ROLES.includes(b.role) ? b.role : 'viewer';
    const members = [...(share.data.members || [])], added = [];
    for (const email of emails.slice(0, 50)) {
      let m = members.find((x) => x.email === email);
      if (m) { m.role = role; continue; }
      m = { email, role, invitedBy: user.data.email, at: Date.now(), token: crypto.randomBytes(18).toString('base64url'), accepted: 0, notify: true };
      members.push(m); added.push(m);
    }
    await app.save(share.team, 'share', share.id, { ...share.data, members }, user.id);
    const org = await app.store.get(share.team).catch(() => null), from = org ? org.data.name || '' : '';
    let mailed = 0;
    if (app.mail && app.mail.enabled()) {
      for (const m of added) {
        const r = await app.mail.send(m.email, { subject: `${user.data.name || from || 'Someone'} shared “${share.data.name}” with you`, title: share.data.name,
          lines: [`${user.data.name || user.data.email}${from ? ' (' + from + ')' : ''} invited you to a shared folder as ${m.role === 'editor' ? 'an editor: you can see, download and upload files' : 'a viewer: you can see and download the files'}.`,
            ...(b.note ? [String(b.note).slice(0, 1000)] : []), 'Sign in with Google, or make a password the first time.'],
          button: { url: `${siteUrl()}/invite/${m.token}`, label: 'Open the folder' } }).catch(() => null);
        if (r && r.sent) mailed++;
      }
    }
    for (const m of added) await activity(share, user, 'invite', '', { target: m.email, role: m.role });
    return { added: added.map((m) => m.email), mailed, links: added.map((m) => ({ email: m.email, url: `${siteUrl()}/invite/${m.token}` })), members: view(await get(id), 'manager').members };
  }
  async function setMember(id, email, b, user) {
    const self = normEmail(user && user.data.email) === normEmail(email);
    const { share } = await access(id, user, self && b.notify !== undefined && b.role === undefined ? 'viewer' : 'manager');
    const members = [...(share.data.members || [])], m = members.find((x) => x.email === normEmail(email));
    if (!m) fail(404, 'Not invited to this folder');
    if (b.role !== undefined) { if (!ROLES.includes(b.role)) fail(400, 'Viewer or editor'); m.role = b.role; }
    if (b.notify !== undefined) m.notify = !!b.notify;
    await app.save(share.team, 'share', share.id, { ...share.data, members }, user.id);
    return { ok: true };
  }
  async function removeMember(id, email, user) {
    const { share } = await access(id, user, 'manager');
    const members = (share.data.members || []).filter((x) => x.email !== normEmail(email));
    await app.save(share.team, 'share', share.id, { ...share.data, members }, user.id);
    await activity(share, user, 'uninvite', '', { target: normEmail(email) });
    return { ok: true };
  }
  // an invite link: who it is for, and whether they have an account yet
  async function inviteFor(token) {
    token = String(token || '');
    if (!/^[\w-]{16,40}$/.test(token)) fail(404, 'This invite link is not valid');
    for (const s of await app.store.listType('share')) {
      if (s.deleted) continue;
      const m = (s.data.members || []).find((x) => x.token === token);
      if (m) {
        const u = await app.auth.userByEmail(m.email).catch(() => null);
        return { share: s, member: m, view: { id: s.id, name: s.data.name, email: m.email, role: m.role, invitedBy: m.invitedBy, account: u ? { password: !!u.data.passwordHash, google: !!u.data.googleSub } : null } };
      }
    }
    fail(404, 'This invite was withdrawn or the folder was removed');
  }
  // first visit without an account: make a password for the invited email
  async function invitePassword(token, b) {
    const { member } = await inviteFor(token);
    const u = await app.auth.userByEmail(member.email).catch(() => null);
    if (u && (u.data.passwordHash || u.data.googleSub)) fail(409, u.data.googleSub ? 'This email signs in with Google: use Sign in with Google' : 'This email has a password already: sign in with it');
    if (String(b.password || '').length < 8) fail(400, 'Use a password of at least 8 characters');
    const { hashPassword } = require('./auth');
    return app.auth.ensureUser({ email: member.email, name: str(b.name, 80) || member.email.split('@')[0], passwordHash: hashPassword(String(b.password)) });
  }

  // ---------------------------------------------------------------- browsing
  async function list(id, rel, user) {
    const { share, role } = await access(id, user);
    rel = cleanPath(rel);
    const dir = abs(id, rel);
    await fsp.mkdir(rootOf(id), { recursive: true });
    let names;
    try { names = await fsp.readdir(dir, { withFileTypes: true }); } catch { fail(404, 'This folder is not there (any more)'); }
    const m = await meta(id);
    const counts = {};
    for (const c of await app.store.find('sharecomment', 'share', id).catch(() => [])) if (!c.deleted) counts[c.data.path] = (counts[c.data.path] || 0) + 1;
    const items = [];
    for (const d of names) {
      if (d.name.startsWith('.')) continue;
      const p = rel ? rel + '/' + d.name : d.name;
      let st; try { st = await fsp.stat(path.join(dir, d.name)); } catch { continue; }
      const isDir = st.isDirectory();
      items.push({ name: d.name, path: p, dir: isDir, size: isDir ? 0 : st.size, mtime: st.mtimeMs, kind: isDir ? 'folder' : kindOf(d.name), by: (m[p] || {}).name || '', byEmail: (m[p] || {}).email || '', comments: counts[p] || 0 });
    }
    items.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
    let free = null;
    try { const s = await fsp.statfs(rootOf(id)); free = s.bavail * s.bsize; } catch { free = null; }
    return { share: { ...view(share, role, user), productionName: await prodName(share) }, path: rel, items, free, chunk: CHUNK, ffmpeg: await hasFfmpeg() };
  }
  async function mkdir(id, rel, user) {
    const { share } = await access(id, user, 'editor');
    rel = cleanPath(rel, { allowRoot: false });
    await fsp.mkdir(abs(id, rel), { recursive: true });
    await activity(share, user, 'folder', rel);
    return { path: rel };
  }
  // a name that is free in that folder: "A001.mov" → "A001 (2).mov"
  async function freeName(dirAbs, name) {
    const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 1; i < 1000; i++) {
      const n = i === 1 ? name : `${stem} (${i})${ext}`;
      try { await fsp.access(path.join(dirAbs, n)); } catch { return n; }
    }
    fail(409, 'Too many files with that name');
  }
  async function move(id, b, user) {
    const { share } = await access(id, user, 'editor');
    const from = cleanPath(b.from, { allowRoot: false });
    let to = b.name !== undefined ? (path.posix.dirname(from) === '.' ? '' : path.posix.dirname(from) + '/') + cleanName(b.name) : cleanPath(b.to, { allowRoot: false });
    if (to === from) return { path: to };
    if (to.startsWith(from + '/')) fail(400, 'A folder cannot go inside itself');
    const src = abs(id, from), dstDir = path.dirname(abs(id, to));
    await fsp.mkdir(dstDir, { recursive: true });
    try { await fsp.access(abs(id, to)); fail(409, 'There is already something called that'); } catch (e) { if (e.status) throw e; }
    try { await fsp.rename(src, abs(id, to)); } catch { fail(404, 'That file is not there (any more)'); }
    const m = await meta(id);
    for (const k of Object.keys(m)) if (k === from || k.startsWith(from + '/')) { m[to + k.slice(from.length)] = m[k]; delete m[k]; }
    metaSave(id);
    for (const c of await app.store.find('sharecomment', 'share', id).catch(() => [])) if (!c.deleted && (c.data.path === from || c.data.path.startsWith(from + '/'))) await app.save(c.team, 'sharecomment', c.id, { ...c.data, path: to + c.data.path.slice(from.length) }, '');
    await activity(share, user, 'move', to, { from });
    return { path: to };
  }
  // deleted files go to the folder's bin for 30 days (a manager can bring them back by hand on the NAS)
  async function remove(id, paths, user) {
    const { share } = await access(id, user, 'editor');
    const list = (Array.isArray(paths) ? paths : [paths]).map((p) => cleanPath(p, { allowRoot: false })).slice(0, 500);
    const bin = sysOf(id, 'bin', new Date().toISOString().slice(0, 10));
    await fsp.mkdir(bin, { recursive: true });
    const m = await meta(id);
    let n = 0;
    for (const p of list) {
      const src = abs(id, p);
      try { await fsp.rename(src, path.join(bin, (await freeName(bin, path.basename(p))))); n++; } catch { continue; }
      for (const k of Object.keys(m)) if (k === p || k.startsWith(p + '/')) delete m[k];
      await activity(share, user, 'delete', p);
    }
    metaSave(id);
    return { deleted: n };
  }

  // ---------------------------------------------------------------- uploads (pieces; carries on after a dropped connection)
  async function startUpload(id, b, user) {
    const { share } = await access(id, user, 'editor');
    const dir = cleanPath(b.dir), name = cleanName(b.name), size = Math.round(Number(b.size));
    if (!(size >= 0) || size > 2 * 1024 ** 4) fail(400, 'Give the file size');
    try { const s = await fsp.statfs(baseDir()); if (s.bavail * s.bsize < size + 1024 ** 3) fail(507, 'The NAS is nearly full: there is no room for this file'); } catch (e) { if (e.status) throw e; }
    // the same file again (same name, size and folder) by the same person: carry on where it stopped
    const key = crypto.createHash('sha1').update([id, dir, name, size, normEmail(user.data.email)].join('|')).digest('hex').slice(0, 24);
    const up = 'up_' + key;
    const rec = (await app.store.kvGet('share:up:' + up).catch(() => null)) || { share: id, dir, name, size, email: normEmail(user.data.email), name2: user.data.name || '', at: Date.now() };
    await app.store.kvSet('share:up:' + up, rec);
    await fsp.mkdir(sysOf(id, 'uploads'), { recursive: true });
    let have = 0; try { have = (await fsp.stat(sysOf(id, 'uploads', up))).size; } catch { have = 0; }
    void share;
    return { upload: up, received: have, size, chunk: CHUNK };
  }
  async function upOf(id, up, user) {
    if (!/^up_[0-9a-f]{24}$/.test(String(up))) fail(404, 'No such upload');
    const rec = await app.store.kvGet('share:up:' + up).catch(() => null);
    if (!rec || rec.share !== id) fail(404, 'This upload has expired: start it again');
    if (rec.email !== normEmail(user.data.email)) fail(403, 'Not your upload');
    return rec;
  }
  async function chunk(id, up, offset, buf, user) {
    await access(id, user, 'editor');
    const rec = await upOf(id, up, user);
    const file = sysOf(id, 'uploads', up);
    let have = 0; try { have = (await fsp.stat(file)).size; } catch { have = 0; }
    offset = Math.round(Number(offset));
    if (!(offset >= 0) || offset > have) fail(409, `Send from byte ${have}`);
    if (offset + buf.length > rec.size) fail(400, 'More bytes than the file has');
    if (offset < have) await fsp.truncate(file, offset);
    await fsp.appendFile(file, buf);
    return { received: offset + buf.length, size: rec.size };
  }
  async function finishUpload(id, up, user, opts = {}) {
    const { share } = await access(id, user, 'editor');
    const rec = await upOf(id, up, user);
    const file = sysOf(id, 'uploads', up);
    if (rec.size === 0) await fsp.writeFile(file, '', { flag: 'a' });
    const have = (await fsp.stat(file).catch(() => ({ size: -1 }))).size;
    if (have !== rec.size) fail(409, `The upload is not complete (${have} of ${rec.size} bytes)`);
    const dirAbs = abs(id, rec.dir);
    await fsp.mkdir(dirAbs, { recursive: true });
    const name = await freeName(dirAbs, rec.name);
    await fsp.rename(file, path.join(dirAbs, name));
    await app.store.kvSet('share:up:' + up, null).catch(() => {});
    const p = rec.dir ? rec.dir + '/' + name : name;
    const m = await meta(id); m[p] = { email: rec.email, name: rec.name2 || rec.email.split('@')[0], at: Date.now() }; metaSave(id);
    await activity(share, user, 'upload', p, { size: rec.size, ...(opts.quiet ? { quiet: true } : {}) });   // quiet: part of a transfer, which tells people itself
    if (kindOf(name) === 'video') thumbFor(id, p).catch(() => {});
    return { path: p, name };
  }

  // ---------------------------------------------------------------- files, previews, thumbnails
  async function fileFor(id, rel, user) {
    await access(id, user);
    rel = cleanPath(rel, { allowRoot: false });
    const f = abs(id, rel);
    let st; try { st = await fsp.stat(f); } catch { fail(404, 'That file is not there (any more)'); }
    if (!st.isFile()) fail(400, 'That is a folder');
    return { file: f, rel, name: path.basename(rel), size: st.size, mtime: st.mtimeMs, mime: mimeOf(rel), kind: kindOf(rel) };
  }
  let ff = null;
  const hasFfmpeg = () => { if (!ff) ff = new Promise((resolve) => execFile(cfg().ffmpeg || 'ffmpeg', ['-version'], { timeout: 8000 }, (e) => resolve(!e))); return ff; };
  const run = (args, timeout, onLine) => new Promise((resolve, reject) => {
    const p = spawn(cfg().ffmpeg || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); if (onLine) String(d).split(/\r|\n/).forEach(onLine); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(); else reject(new Error('ffmpeg: ' + err.split('\n').filter(Boolean).slice(-1)[0])); });
  });
  const keyOf = (f) => crypto.createHash('sha1').update([f.rel, f.size, Math.round(f.mtime)].join('|')).digest('hex').slice(0, 20);
  // a small picture for the list: a frame of a video, a smaller photo
  async function thumbFor(id, rel, user) {
    const f = user ? await fileFor(id, rel, user) : await (async () => { const a = abs(id, rel), st = await fsp.stat(a); return { file: a, rel, size: st.size, mtime: st.mtimeMs, kind: kindOf(rel) }; })();
    if (!['video', 'image'].includes(f.kind)) fail(404, 'No thumbnail for this kind of file');
    const out = sysOf(id, 'thumbs', keyOf(f) + '.jpg');
    try { await fsp.access(out); return out; } catch { /* make it */ }
    if (!(await hasFfmpeg())) { if (f.kind === 'image' && WEB_IMAGE.test(f.rel)) return f.file; fail(404, 'No thumbnail (ffmpeg is not installed)'); }
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const tmp = out + '.' + process.pid + '.tmp.jpg';
    const args = f.kind === 'video' ? ['-y', '-ss', '1', '-i', f.file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', tmp] : ['-y', '-i', f.file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', tmp];
    try { await run(args, 60000); } catch (e) {
      if (f.kind === 'video') { try { await run(['-y', '-i', f.file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', tmp], 60000); } catch { fail(404, 'No thumbnail for this file'); } }
      else if (WEB_IMAGE.test(f.rel)) return f.file; else fail(404, 'No thumbnail for this file');
    }
    await fsp.rename(tmp, out);
    return out;
  }
  // what the browser plays: the file itself when it can, else a 720p copy (made once, in the background)
  const proxies = new Map();          // key → { progress, error }
  async function preview(id, rel, user) {
    const f = await fileFor(id, rel, user);
    if (f.kind === 'image') return WEB_IMAGE.test(rel) ? { ready: true, file: f.file, mime: f.mime } : { ready: true, file: await thumbFor(id, rel, user).catch(() => fail(415, 'This photo cannot be shown in the browser: download it')), mime: 'image/jpeg' };
    if (f.kind === 'audio' && WEB_AUDIO.test(rel)) return { ready: true, file: f.file, mime: f.mime };
    if (f.kind === 'pdf' || f.kind === 'text') return { ready: true, file: f.file, mime: f.mime };
    if (f.kind !== 'video' && f.kind !== 'audio') fail(415, 'This kind of file cannot be shown in the browser: download it');
    if (f.kind === 'video' && WEB_VIDEO.test(rel) && f.size < 8 * 1024 ** 3) return { ready: true, file: f.file, mime: f.mime };
    const k = keyOf(f), out = sysOf(id, 'proxies', k + (f.kind === 'audio' ? '.m4a' : '.mp4'));
    try { await fsp.access(out); return { ready: true, file: out, mime: f.kind === 'audio' ? 'audio/mp4' : 'video/mp4' }; } catch { /* not yet */ }
    if (!(await hasFfmpeg())) fail(415, 'This video cannot be played in the browser, and the server has no ffmpeg to make a preview: download it');
    const job = proxies.get(k);
    if (job && job.error) { proxies.delete(k); fail(415, 'No preview could be made: ' + job.error); }
    if (!job) {
      const j = { progress: 0, error: '' }; proxies.set(k, j);
      (async () => {
        await fsp.mkdir(path.dirname(out), { recursive: true });
        let dur = 0;
        const tmp = out + '.tmp' + path.extname(out);
        const args = f.kind === 'audio' ? ['-y', '-i', f.file, '-vn', '-c:a', 'aac', '-b:a', '160k', tmp]
          : ['-y', '-i', f.file, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=-2:min(720\\,ih),format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', tmp];
        await run(args, 6 * 3600e3, (l) => {
          const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(l); if (d) dur = +d[1] * 3600 + +d[2] * 60 + +d[3];
          const t = /time=(\d+):(\d+):([\d.]+)/.exec(l); if (t && dur) j.progress = Math.min(99, Math.round(((+t[1] * 3600 + +t[2] * 60 + +t[3]) / dur) * 100));
        });
        await fsp.rename(tmp, out);
        proxies.delete(k);
      })().catch((e) => { j.error = e.message; log('Sharing preview:', rel, e.message); });
    }
    return { ready: false, progress: (proxies.get(k) || {}).progress || 0 };
  }
  // ZIP of files and folders (paths, or the whole folder)
  async function zip(id, rels, user, out) {
    const { share } = await access(id, user);
    const list = (rels && rels.length ? rels : ['']).map((p) => cleanPath(p)).slice(0, 2000);
    const entries = [];
    // a selected folder keeps its name in the ZIP ("Day 1/A001.mov"); the whole folder lists what is in it
    const walk = async (rel, name) => {
      const a = abs(id, rel);
      let st; try { st = await fsp.stat(a); } catch { return; }
      if (st.isDirectory()) { for (const d of (await fsp.readdir(a)).sort()) { if (!d.startsWith('.')) await walk(rel ? rel + '/' + d : d, name ? name + '/' + d : d); } }
      else entries.push({ name, file: a, size: st.size, mtime: st.mtimeMs });
      if (entries.length > 20000) fail(413, 'Too many files for one ZIP: choose fewer');
    };
    for (const p of list) await walk(p, p === '' ? '' : path.posix.basename(p));
    if (!entries.length) fail(404, 'Nothing to download');
    await activity(share, user, 'download', list.length === 1 ? list[0] || '(everything)' : `${list.length} items`, { files: entries.length });
    return { entries, run: () => zipTo(out, entries), name: (list.length === 1 && list[0] ? path.basename(list[0]) : share.data.name).replace(/[^\w .()-]+/g, '_') + '.zip' };
  }

  // ---------------------------------------------------------------- comments
  async function comments(id, rel, user) {
    await access(id, user);
    rel = cleanPath(rel);
    const me = normEmail(user.data.email), mgr = (await roleIn(await get(id), user)) === 'manager';
    return { comments: (await app.store.find('sharecomment', 'share', id).catch(() => [])).filter((c) => !c.deleted && c.data.path === rel).sort((a, b) => a.data.at - b.data.at)
      .map((c) => ({ id: c.id, text: c.data.text, tc: c.data.tc, name: c.data.name, email: c.data.email, at: c.data.at, mine: c.data.email === me, canRemove: c.data.email === me || mgr })) };
  }
  const last = new Map();
  async function comment(id, rel, b, user) {
    const { share } = await access(id, user);
    rel = cleanPath(rel, { allowRoot: false });
    const text = String(b.text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 2000);
    if (!text) fail(400, 'Write something first');
    if (Date.now() - (last.get(user.id) || 0) < 1500) fail(429, 'Slow down a little');
    last.set(user.id, Date.now());
    const tc = b.tc === undefined || b.tc === null || b.tc === '' ? null : Math.max(0, Math.round(Number(b.tc) * 10) / 10);
    const w = who(user);
    const doc = await app.save(share.team, 'sharecomment', newId('shc_'), { share: id, path: rel, text, tc: Number.isFinite(tc) ? tc : null, email: w.email, name: w.name, at: Date.now() }, user.id);
    await activity(share, user, 'comment', rel, { text: text.slice(0, 200), tc: doc.data.tc });
    return { id: doc.id };
  }
  async function uncomment(id, cid, user) {
    const { share, role } = await access(id, user);
    const c = await app.store.get(String(cid));
    if (!c || c.deleted || c.type !== 'sharecomment' || c.data.share !== id) fail(404, 'Comment not found');
    if (c.data.email !== normEmail(user.data.email) && role !== 'manager') fail(403, 'You can only remove your own comments');
    await app.remove(c.id, user.id);
    void share;
    return {};
  }
  // the Studio's File sharing page: every person invited to a team's folders, with their folders and roles
  async function people(team, user) {
    const role = await app.auth.roleIn(user, team).catch(() => null);
    if (!role || !Schema.CAN.edit(role)) fail(403, 'Only Producers and Admins of the production team manage file sharing');
    const shares = (await app.store.list(team, 'share')).filter((x) => !x.deleted);
    const folders = [], byEmail = new Map();
    for (const sh of shares) {
      const act = (await app.store.kvGet('share:act:' + sh.id).catch(() => null)) || [];
      folders.push({ id: sh.id, name: sh.data.name, expires: sh.data.expires || '', production: sh.data.production || '', productionName: await prodName(sh), url: `${siteUrl()}/f/${sh.id}`, createdAt: sh.data.createdAt || 0, members: (sh.data.members || []).length, lastActivity: act.length ? act[0].at : 0 });
      for (const m of sh.data.members || []) {
        if (!byEmail.has(m.email)) byEmail.set(m.email, { email: m.email, folders: [], lastSeen: 0 });
        const last = act.find((a) => a.email === m.email);
        const p = byEmail.get(m.email);
        p.folders.push({ id: sh.id, name: sh.data.name, role: m.role, accepted: !!m.accepted, at: m.at, invitedBy: m.invitedBy, notify: m.notify !== false });
        if (last && last.at > p.lastSeen) p.lastSeen = last.at;
        if (m.accepted && m.accepted > p.lastSeen) p.lastSeen = m.accepted;
      }
    }
    const out = [];
    for (const p of byEmail.values()) {
      const u = await app.auth.userByEmail(p.email).catch(() => null);
      out.push({ ...p, name: u ? u.data.name || '' : '', account: !!u, accepted: p.folders.some((f) => f.accepted) });
    }
    out.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    folders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return { folders, people: out, siteUrl: siteUrl(), mail: !!(app.mail && app.mail.enabled()) };
  }
  // the invite email again (same link), e.g. it went to spam
  async function resend(id, email, user) {
    const { share } = await access(id, user, 'manager');
    const m = (share.data.members || []).find((x) => x.email === normEmail(email));
    if (!m) fail(404, 'Not invited to this folder');
    const url = `${siteUrl()}/invite/${m.token}`;
    let sent = false;
    if (app.mail && app.mail.enabled()) {
      const r = await app.mail.send(m.email, { subject: `Reminder: “${share.data.name}” is shared with you`, title: share.data.name,
        lines: [`${user.data.name || user.data.email} shared this folder with you as ${m.role === 'editor' ? 'an editor: you can see, download and upload files' : 'a viewer: you can see and download the files'}.`, 'Sign in with Google, or make a password the first time.'],
        button: { url, label: 'Open the folder' } }).catch(() => null);
      sent = !!(r && r.sent);
    }
    return { sent, url };
  }
  // ---------------------------------------------------------------- transfers (like WeTransfer): a batch of uploads, people tagged
  // who may be tagged: the folder's invited people and the team's Producers and Admins
  async function taggable(id, user) {
    const { share } = await access(id, user, 'editor');
    const out = new Map();
    for (const m of (await app.store.list(share.team, 'member')).filter((x) => !x.deleted && Schema.CAN.edit(x.data.role))) {
      const e = normEmail(m.data.email); if (e) out.set(e, { email: e, name: m.data.name || '', role: 'manager' });
    }
    for (const m of share.data.members || []) if (!out.has(m.email)) out.set(m.email, { email: m.email, name: '', role: m.role });
    for (const x of out.values()) if (!x.name) { const u = await app.auth.userByEmail(x.email).catch(() => null); x.name = u ? u.data.name || '' : ''; }
    out.delete(normEmail(user.data.email));
    return { people: [...out.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)) };
  }
  const human = (n) => (n < 1024 ** 2 ? Math.max(1, Math.round(n / 1024)) + ' KB' : n < 1024 ** 3 ? (n / 1024 ** 2).toFixed(1) + ' MB' : (n / 1024 ** 3).toFixed(2) + ' GB');
  async function transfer(id, b, user) {
    const { share } = await access(id, user, 'editor');
    const dir = cleanPath(b.dir);
    const files = (Array.isArray(b.files) ? b.files : []).slice(0, 5000).map((f) => ({ path: cleanPath(f.path, { allowRoot: false }), size: Math.max(0, Math.round(Number(f.size) || 0)) }));
    if (!files.length) fail(400, 'No files in this transfer');
    const ok = new Set((await taggable(id, user)).people.map((x) => x.email));
    const tags = [...new Set((Array.isArray(b.tags) ? b.tags : []).map(normEmail))].filter((e) => ok.has(e)).slice(0, 50);
    const message = str(b.message, 2000), size = files.reduce((n, f) => n + f.size, 0), me = who(user);
    const rec = { id: 'tx_' + crypto.randomBytes(6).toString('hex'), share: share.id, dir, files: files.slice(0, 1000), count: files.length, size, message, tags, email: me.email, name: me.name, at: Date.now() };
    const k = 'share:tx:' + share.id;
    const list = (await app.store.kvGet(k).catch(() => null)) || [];
    list.unshift(rec);
    await app.store.kvSet(k, list.slice(0, 300));
    await activity(share, user, 'transfer', dir, { count: files.length, size, tags });
    const where = `${siteUrl()}/f/${share.id}/${dir ? dir.split('/').map(encodeURIComponent).join('/') : ''}`;
    const what = `${files.length} file${files.length === 1 ? '' : 's'} (${human(size)})`;
    const listLines = [...files.slice(0, 15).map((f) => '• ' + (dir && f.path.startsWith(dir + '/') ? f.path.slice(dir.length + 1) : f.path)), ...(files.length > 15 ? [`… and ${files.length - 15} more`] : [])];
    let mailed = 0;
    if (app.mail && app.mail.enabled()) {
      for (const e of tags) {
        const r = await app.mail.send(e, { subject: `${me.name} sent you ${what} in ${share.data.name}`, title: share.data.name,
          lines: [`${me.name} (${me.email}) uploaded ${what}${dir ? ' to ' + dir : ''} and tagged you.`, ...(message ? ['“' + message + '”'] : []), ...listLines],
          button: { url: where, label: 'Open the files' }, footer: 'You get this because you were tagged in a shared folder.' }).catch(() => null);
        if (r && r.sent) mailed++;
      }
      // the uploader: a receipt
      await app.mail.send(me.email, { subject: `Your ${what} are in ${share.data.name}`, title: 'Upload complete',
        lines: [`${what} uploaded to ${share.data.name}${dir ? ' / ' + dir : ''}.`, tags.length ? `Told: ${tags.join(', ')}.` : 'Nobody was tagged.', ...(message ? ['Your message: “' + message + '”'] : []), ...listLines],
        button: { url: where, label: 'Open the folder' } }).catch(() => null);
    }
    if (tags.length && app.push) await app.push.send(tags, { kind: 'file_shared', title: `${me.name} sent you ${what}`, body: `${share.data.name}${dir ? ' / ' + dir : ''}${message ? ' · ' + message.slice(0, 120) : ''}`, url: where, tag: 'tx:' + rec.id }).catch(() => 0);
    return { transfer: rec, mailed };
  }
  // previous transfers in the folders this person can open (newest first)
  async function transfers(user, { share: only } = {}) {
    const { shares } = await mine(user);
    const out = [];
    for (const sh of shares) {
      if (only && sh.id !== only) continue;
      for (const t of (await app.store.kvGet('share:tx:' + sh.id).catch(() => null)) || []) out.push({ ...t, files: t.files.slice(0, 50), shareName: sh.name, productionName: sh.productionName || '', mine: t.email === normEmail(user.data.email), forMe: (t.tags || []).includes(normEmail(user.data.email)) });
    }
    return { transfers: out.sort((a, b) => b.at - a.at).slice(0, 100) };
  }
  async function activityOf(id, user) { await access(id, user); return { activity: (await app.store.kvGet('share:act:' + id).catch(() => null)) || [] }; }

  return { baseDir, siteUrl, sweep, start, stop, mine, create, forProduction, info, rename, removeShare, invite, setMember, removeMember, people, resend, inviteFor, invitePassword, list, mkdir, move, remove,
    startUpload, chunk, finishUpload, fileFor, thumbFor, preview, zip, comments, comment, uncomment, activityOf, taggable, transfer, transfers, CHUNK, cleanPath, kindOf };
}

module.exports = { makeSharing, cleanPath, kindOf };
