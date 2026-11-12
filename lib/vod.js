'use strict';
// Videos on demand: films, highlights, shows and series uploaded by a production team to one of its channels.
//
// Records:
//   vodvideo  (team, editable in the app): title, channel, series, season, episode, description, poster, price,
//             freeInSeries, visibility (Public / Unlisted / Hidden), publishOn
//   vodseries (team, editable): title, channel, description, poster, banner, price (the whole series), visibility, seasonNames
//   vodfile   (system, server only, id "vf_<video>"): the upload and its processing – size, received, status
//             (uploading / processing / ready / failed), duration, width, height, file, views
// Files: <VOD folder>/<team>/<video>/ – source.<ext> while uploading, web.mp4 once processed, poster.jpg.
// The VOD folder: config vodDir, else VOD_DIR, else <NAS>/vod (NAS_DIR or the folder above MEDIA_DIR's assets/images),
// else <data>/vod. Uploads come in chunks (8 MB) so they pass Cloudflare's 100 MB request limit, and can resume.
// With ffmpeg on the server a video gets a web copy (H.264 / AAC MP4 with the index up front, so it starts at once
// and seeks) and a poster frame; without it MP4 and WebM play as uploaded.
// Who may watch: the channel's rules (Public / Team members / Password), the production team always; paid videos
// need a ticket for the video, the series, or the channel pass (PayFast, as live streams).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { fail, log } = require('./util');

const CHUNK = 8 * 1024 * 1024;
const PLAYABLE = /\.(mp4|m4v|webm|mov)$/i;
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

function makeVod(app) {
  const cfg = () => app.config;
  const data = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };

  function vodDir() {
    const c = cfg();
    if (c.vodDir) return path.resolve(c.vodDir);
    if (process.env.VOD_DIR) return path.resolve(process.env.VOD_DIR);
    if (c.nasDir || process.env.NAS_DIR) return path.join(c.nasDir || process.env.NAS_DIR, 'vod');
    const media = c.mediaMirror || process.env.MEDIA_DIR || '';
    if (media && /assets[\\/]images[\\/]?$/.test(media)) return path.resolve(media, '..', '..', 'vod');
    return path.join(app.dataDir(), 'vod');
  }
  const safe = (s) => String(s || '').replace(/[^\w-]/g, '');
  const dirOf = (team, id) => path.join(vodDir(), safe(team), safe(id));
  const fileId = (id) => 'vf_' + id;
  const fileOf = async (id) => (await data(fileId(id))) || null;
  const saveFile = (v, d) => app.save(v.team, 'vodfile', fileId(v.id), d, '');

  // ---- ffmpeg (optional)
  let ff = null;
  const hasFfmpeg = () => {
    if (ff) return ff;
    ff = new Promise((resolve) => execFile(cfg().ffmpeg || 'ffmpeg', ['-version'], { timeout: 8000 }, (e) => resolve(!e)));
    return ff;
  };
  const run = (bin, args, { onLine, timeout = 6 * 3600e3 } = {}) => new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', (d) => { out += d; if (onLine) String(d).split('\n').forEach(onLine); if (out.length > 4e6) out = out.slice(-1e6); });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(out); else reject(new Error(err.trim().split('\n').pop() || 'ffmpeg stopped (' + code + ')')); });
  });
  async function probe(file) {
    const bin = cfg().ffprobe || 'ffprobe';
    const j = JSON.parse(await run(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 60e3 }));
    const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
    const a = (j.streams || []).find((s) => s.codec_type === 'audio') || {};
    return { duration: Number(j.format && j.format.duration) || Number(v.duration) || 0, format: String((j.format && j.format.format_name) || ''), vcodec: v.codec_name || '', acodec: a.codec_name || '', width: v.width || 0, height: v.height || 0, pix: v.pix_fmt || '' };
  }

  // one video at a time is processed; the rest wait in line
  let queue = Promise.resolve();
  const process1 = (id) => { queue = queue.then(() => processVideo(id)).catch((e) => log('VOD:', e.message)); return queue; };

  async function processVideo(id) {
    const v = await data(id);
    const f = await fileOf(id);
    if (!v || !f) return;
    const dir = dirOf(v.team, v.id);
    const src = path.join(dir, f.data.source || '');
    const set = async (patch) => { const cur = await fileOf(id); if (cur) await saveFile(v, { ...cur.data, ...patch }); };
    if (!(await hasFfmpeg())) {
      // no ffmpeg: MP4 / WebM / MOV play as they are (most phones and browsers); others are kept and flagged
      if (isYt(v)) await app.save(v.team, 'vodvideo', v.id, { ...v.data, source: 'Upload', ytOrigin: v.data.youtube, youtube: '' }, '');
      await set({ status: 'ready', file: f.data.source, readyAt: Date.now(), note: PLAYABLE.test(f.data.source) ? 'Played as uploaded (ffmpeg is not on the server, so no web copy or poster frame was made).' : 'This file type may not play in browsers. Install ffmpeg on the server, or upload an MP4.' });
      return;
    }
    try {
      await set({ status: 'processing', progress: 0, error: '' });
      const info = await probe(src);
      const web = path.join(dir, 'web.mp4'), tmp = path.join(dir, 'web.part.mp4');
      // the size: standard (up to 1080p, close to the original), small (720p) or smallest (480p): a fraction of the size
      const Q = { standard: { w: 1920, crf: cfg().vodCrf || 21, ab: '160k' }, small: { w: 1280, crf: 27, ab: '112k' }, smallest: { w: 854, crf: 30, ab: '80k' } }[f.data.quality || 'standard'] || { w: 1920, crf: 21, ab: '160k' };
      const copyOk = (f.data.quality || 'standard') === 'standard' && /mp4|mov/.test(info.format) && info.vcodec === 'h264' && (!info.acodec || ['aac', 'mp3'].includes(info.acodec)) && (!info.pix || info.pix === 'yuv420p');
      const progress = (line) => {
        const m = /^out_time_(?:ms|us)=(\d+)/.exec(line);
        if (m && info.duration) { const pct = Math.min(99, Math.round(Number(m[1]) / 1e6 / info.duration * 100)); if (pct >= (progress.last || 0) + 5) { progress.last = pct; set({ progress: pct }).catch(() => {}); } }
      };
      const common = ['-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats', '-i', src];
      const args = copyOk
        ? [...common, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', tmp]
        : [...common, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', cfg().vodPreset || 'veryfast', '-crf', String(Q.crf), '-pix_fmt', 'yuv420p',
          '-vf', `scale='min(${Q.w},iw)':-2`, '-c:a', 'aac', '-b:a', Q.ab, '-movflags', '+faststart', tmp];
      await run(cfg().ffmpeg || 'ffmpeg', args, { onLine: progress });
      await fsp.rename(tmp, web);
      // a poster frame a tenth of the way in (unless the team chose a picture – it is made anyway, as a fallback)
      await run(cfg().ffmpeg || 'ffmpeg', ['-hide_banner', '-y', '-nostdin', '-ss', String(Math.max(1, Math.round(info.duration * 0.1))), '-i', web, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', path.join(dir, 'poster.jpg')], { timeout: 120e3 }).catch(() => {});
      if (!cfg().vodKeepSource) await fsp.rm(src, { force: true });
      const cur1 = await data(id);
      if (cur1 && isYt(cur1)) await app.save(cur1.team, 'vodvideo', cur1.id, { ...cur1.data, source: 'Upload', ytOrigin: cur1.data.youtube, youtube: '' }, '');
      const outSize = (await fsp.stat(web)).size;
      await set({ status: 'ready', file: 'web.mp4', progress: 100, webSize: outSize, duration: Math.round(info.duration), width: info.width, height: info.height, copied: copyOk, poster: fs.existsSync(path.join(dir, 'poster.jpg')), readyAt: Date.now(), note: '' });
    } catch (e) {
      await set({ status: 'failed', error: 'Could not process the video: ' + e.message.slice(0, 300) });
    }
  }

  // ---- uploading (Producers and Admins of the team)
  async function create(team, user, b = {}) {
    const size = Math.round(Number(b.size) || 0);
    const name = String(b.name || 'video.mp4').slice(0, 200);
    if (!(size > 0)) fail(400, 'Choose a video file');
    const maxGb = Number(cfg().vodMaxGb) || 30;
    if (size > maxGb * 1073741824) fail(413, `Videos can be up to ${maxGb} GB`);
    if (!/\.(mp4|m4v|mov|webm|mkv|avi|mts|m2ts|mxf|ts|wmv|mpg|mpeg)$/i.test(name) && !/^video\//.test(String(b.mime || ''))) fail(400, 'That is not a video file');
    // a file for an item that plays from YouTube now (your own video, downloaded from YouTube Studio): same item, its
    // playlists, series and subtitles stay; it switches to the file once that is ready
    const old = b.replace ? await data(b.replace) : null;
    if (b.replace && (!old || old.type !== 'vodvideo' || old.team !== team)) fail(404, 'Video not found');
    if (old && (await fileOf(old.id)) && !isYt(old)) fail(409, 'This video already has a file');
    const ch = await data(old ? old.data.channel : b.channel);
    if (!ch || ch.type !== 'channel') fail(400, 'Choose the channel the video is for');
    if (ch.team !== team && ch.data.teamOnly) fail(403, 'That channel only takes its own team\'s videos');
    await fsp.mkdir(vodDir(), { recursive: true });
    try {
      const s = await fsp.statfs(vodDir());
      if (Number(s.bavail) * Number(s.bsize) < size * 2 + 1073741824) fail(507, 'Not enough room on the server for this video (it needs about twice its size while it is processed)');
    } catch (e) { if (e.status) throw e; }
    const id = old ? old.id : 'vod_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const quality = ['standard', 'small', 'smallest'].includes(b.quality) ? b.quality : 'standard';
    const ext = (/\.(\w{2,5})$/.exec(name) || [, 'mp4'])[1].toLowerCase();
    const title = String(b.title || name.replace(/\.\w{2,5}$/, '').replace(/[_.]+/g, ' ')).trim().slice(0, 160) || 'Video';
    const series = b.series ? await data(b.series) : null;
    const doc = old || await app.save(team, 'vodvideo', id, { title, channel: ch.id, series: series && series.team === team ? series.id : '', season: Number(b.season) || (series ? 1 : ''), episode: Number(b.episode) || '', visibility: ['Public', 'Unlisted', 'Hidden'].includes(b.visibility) ? b.visibility : 'Public', description: '', price: '' }, user.id);
    await fsp.mkdir(dirOf(team, id), { recursive: true });
    await saveFile(doc, { video: id, name, mime: String(b.mime || ''), size, received: 0, source: 'source.' + ext, status: 'uploading', quality, uploadedBy: user.id, startedAt: Date.now(), views: 0 });
    return { doc, chunk: CHUNK };
  }
  async function own(team, id) {
    const v = await data(id);
    if (!v || v.type !== 'vodvideo' || v.team !== team) fail(404, 'Video not found');
    const f = await fileOf(id);
    if (!f) fail(404, 'This video has no file');
    return { v, f };
  }
  // a piece of the file at "offset" (a piece sent again after a dropped connection overwrites from there)
  async function chunk(team, id, offset, buf) {
    const { v, f } = await own(team, id);
    if (f.data.status !== 'uploading') fail(409, 'This video is already uploaded');
    offset = Math.round(Number(offset));
    const file = path.join(dirOf(team, id), f.data.source);
    let have = 0;
    try { have = (await fsp.stat(file)).size; } catch { have = 0; }
    if (!(offset >= 0) || offset > have) fail(409, `Send from byte ${have}`);
    if (offset + buf.length > f.data.size) fail(400, 'More bytes than the file has');
    if (offset < have) await fsp.truncate(file, offset);
    await fsp.appendFile(file, buf);
    const received = offset + buf.length;
    if (received === f.data.size || received - (f.data.received || 0) >= 64 * 1024 * 1024) await saveFile(v, { ...f.data, received });
    return { received, size: f.data.size };
  }
  async function status(team, id) {
    const { f } = await own(team, id);
    let have = 0;
    try { have = (await fsp.stat(path.join(dirOf(team, id), f.data.source))).size; } catch { have = 0; }
    return { ...view(f), received: f.data.status === 'uploading' ? have : f.data.size, chunk: CHUNK };
  }
  async function done(team, id) {
    const { v, f } = await own(team, id);
    if (f.data.status !== 'uploading') return view(f);
    const have = (await fsp.stat(path.join(dirOf(team, id), f.data.source)).catch(() => ({ size: 0 }))).size;
    if (have !== f.data.size) fail(409, `The upload is not complete (${have} of ${f.data.size} bytes)`);
    await saveFile(v, { ...f.data, received: have, status: 'processing', progress: 0, uploadedAt: Date.now() });
    process1(id);
    return view(await fileOf(id));
  }
  const view = (f) => (f ? { status: f.data.status, progress: f.data.progress || 0, size: f.data.size, received: f.data.received || 0, name: f.data.name, duration: f.data.duration || 0, width: f.data.width || 0, height: f.data.height || 0, error: f.data.error || '', note: f.data.note || '', views: f.data.views || 0, poster: !!f.data.poster, quality: f.data.quality || 'standard', webSize: f.data.webSize || 0 } : null);
  // the team's videos with their files (the app's Videos page)
  async function list(team) {
    const out = [];
    for (const v of await app.store.list(team, 'vodvideo')) if (!v.deleted) out.push({ id: v.id, file: view(await fileOf(v.id)), subtitles: (await subtitlesOf(v.id)).length });
    return out;
  }
  async function removeFiles(team, id) {
    await fsp.rm(dirOf(team, id), { recursive: true, force: true }).catch(() => {});
    for (const x of [fileId(id), subsId(id)]) { const f = await app.store.get(x); if (f && !f.deleted) await app.remove(f.id, ''); }
  }
  app.on('doc', (doc) => { if (doc.type === 'vodvideo' && doc.deleted && !app.isLocal) removeFiles(doc.team, doc.id).catch((e) => log('VOD delete:', e.message)); });
  // videos that were mid-way through processing when the server stopped start again
  async function resume() {
    if (app.isLocal) return;
    for (const f of await app.store.listType('vodfile')) if (!f.deleted && f.data.status === 'processing') process1(f.data.video);
  }

  // ---- who may watch
  const key = () => (app.streaming && app.streaming.signKey ? app.streaming.signKey() : (app.vodKey || (app.vodKey = crypto.randomBytes(32).toString('hex'))));
  const sign = (s) => crypto.createHmac('sha256', 'vod:' + key()).update(s).digest('base64url').slice(0, 27);
  const tokenFor = (id, hours = 6) => { const exp = Math.floor(Date.now() / 1000) + hours * 3600; return `${exp}.${sign(id + '.' + exp)}`; };
  function tokenOk(id, t) {
    const m = /^(\d{9,11})\.([\w-]{27})$/.exec(String(t || ''));
    if (!m || Number(m[1]) < Date.now() / 1000) return false;
    const a = Buffer.from(m[2]), b = Buffer.from(sign(id + '.' + m[1]));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const isYt = (v) => v && v.data.source === 'YouTube' && !!v.data.youtube;
  const published = (d) => !d.data.publishOn || d.data.publishOn <= today();
  const listed = (d) => (d.data.visibility || 'Public') === 'Public' && published(d);
  // what a video costs: { video, series: {id, title, amount} | null, pass: {amount, days} | null } (null = free)
  function prices(v, s, ch) {
    if (isYt(v)) return null;                       // YouTube videos are free to watch anyway
    const own1 = money(v.data.price) > 0 ? money(v.data.price) : 0;
    const ser = s && money(s.data.price) > 0 && !v.data.freeInSeries ? { id: s.id, title: s.data.title, amount: money(s.data.price) } : null;
    if (!own1 && !ser) return null;
    if (v.data.freeInSeries && !own1) return null;
    const pp = money(ch.data.passPrice);
    return { video: own1, series: ser, pass: pp > 0 ? { amount: pp, days: Math.max(1, Math.round(Number(ch.data.passDays) || 30)) } : null, currency: 'ZAR' };
  }
  async function purchased(user, tickets, { vod, series, channel }) {
    const now = Date.now();
    const email = user ? String(user.data.email || '').toLowerCase() : '';
    const ids = new Set((tickets || []).map((t) => app.pay.purchaseIdOf(t)).filter(Boolean));
    const mine = (p) => p.data.status === 'Paid' && (ids.has(p.id) || (user && (p.data.userId === user.id || (email && String(p.data.email || '').toLowerCase() === email))));
    if (vod) for (const p of await app.store.find('purchase', 'vod', vod)) if (p.data.kind === 'vod' && mine(p)) return p;
    if (series) for (const p of await app.store.find('purchase', 'series', series)) if (p.data.kind === 'series' && mine(p)) return p;
    if (channel) for (const p of await app.store.find('purchase', 'channel', channel)) if (p.data.kind === 'pass' && Number(p.data.expiresAt) > now && mine(p)) return p;
    return null;
  }
  // { needs: null | 'signin' | 'team' | 'password' | 'ticket' | 'processing', ... }
  async function access(v, { user, password, tickets }) {
    const ch = await data(v.data.channel);
    if (!ch || ch.data.disabled) fail(404, 'There is no video here');
    const role = user ? await app.auth.roleIn(user, v.team) : null;
    if (!role && (v.data.visibility === 'Hidden' || !published(v))) fail(404, 'There is no video here');
    const s = v.data.series ? await data(v.data.series) : null;
    const f = await fileOf(v.id);
    const out = { ch, s, f, role, price: null, needs: null };
    if (!isYt(v) && (!f || f.data.status !== 'ready')) { out.needs = 'processing'; return out; }
    if (role) return out;
    const acc = ch.data.access || 'Public';
    if (acc === 'Team members') { out.needs = user ? 'team' : 'signin'; return out; }
    if (acc === 'Password') { if (!password || String(password) !== String(ch.data.viewerPassword || '')) out.needs = 'password'; return out; }
    out.price = app.pay ? prices(v, s, ch) : null;
    if (out.price && !(await purchased(user, tickets, { vod: v.id, series: out.price.series && out.price.series.id, channel: ch.id }))) out.needs = 'ticket';
    return out;
  }

  // ---- the public side
  const posterUrl = (v, f) => (v.data.poster ? v.data.poster : v.data.ytPoster ? v.data.ytPoster : f && f.data.poster ? `/vodfiles/${v.id}/poster.jpg` : '');
  const lengthOf = (v, f) => { if (isYt(v) && !(Number(v.data.duration) > 0) && app.youtube && !app.isLocal) app.youtube.fillLength(v); return isYt(v) ? Number(v.data.duration) || 0 : (f && f.data.duration) || 0; };
  const epLabel = (v) => (v.data.season || v.data.episode ? [v.data.season ? 'S' + v.data.season : '', v.data.episode ? 'E' + v.data.episode : ''].join(' ').trim() : '');
  async function card(v, brand) {
    const f = await fileOf(v.id);
    const ch = await data(v.data.channel);
    const s = v.data.series ? await data(v.data.series) : null;
    const pr = ch && app.pay ? prices(v, s, ch) : null;
    return { href: '/v/' + v.id, id: v.id, title: v.data.title, of: s ? [s.data.title, epLabel(v)].filter(Boolean).join(' · ') : '', poster: posterUrl(v, f), channel: brand || (ch ? await app.streaming.branding(ch) : {}),
      price: pr ? { ticket: pr.video || (pr.series ? pr.series.amount : 0) } : null, start: new Date((f && (f.data.readyAt || f.data.uploadedAt)) || v.updatedAt || Date.now()).toISOString(), duration: lengthOf(v, f), youtube: isYt(v), series: v.data.series || '', category: v.data.category || '', tags: v.data.tags || '', season: v.data.season || '', episode: v.data.episode || '' };
  }
  const order = (a, b) => (Number(a.data.season) || 0) - (Number(b.data.season) || 0) || (Number(a.data.episode) || 0) - (Number(b.data.episode) || 0) || String(a.data.title).localeCompare(String(b.data.title));
  async function readyIds() {
    const out = new Set((await app.store.listType('vodfile')).filter((f) => !f.deleted && f.data.status === 'ready').map((f) => f.data.video));
    for (const v of await app.store.listType('vodvideo')) if (!v.deleted && isYt(v)) out.add(v.id);
    return out;
  }
  // every listed, ready video and series on public channels (home page, channel pages)
  async function publicList(channelId) {
    const chans = new Map();
    for (const ch of await app.store.listType('channel')) if (!ch.deleted && !ch.data.disabled && (ch.data.access || 'Public') === 'Public' && (!channelId || ch.id === channelId)) chans.set(ch.id, ch);
    const ready = await readyIds();
    const brands = new Map();
    const brandOf = async (id) => { if (!brands.has(id)) brands.set(id, await app.streaming.branding(chans.get(id))); return brands.get(id); };
    const videos = [], seriesOut = [];
    const vids = (await app.store.listType('vodvideo')).filter((v) => !v.deleted && chans.has(v.data.channel) && listed(v) && ready.has(v.id));
    for (const v of vids) videos.push(await card(v, await brandOf(v.data.channel)));
    for (const s of await app.store.listType('vodseries')) {
      if (s.deleted || !chans.has(s.data.channel) || !listed(s)) continue;
      const eps = vids.filter((v) => v.data.series === s.id).sort(order);
      if (!eps.length) continue;
      const first = await fileOf(eps[0].id);
      seriesOut.push({ href: '/s/' + s.id, id: s.id, title: s.data.title, poster: s.data.poster || s.data.banner || posterUrl(eps[0], first), channel: await brandOf(s.data.channel), episodes: eps.length,
        seasons: new Set(eps.map((e) => Number(e.data.season) || 1)).size, category: s.data.category || '', price: money(s.data.price) > 0 ? { ticket: money(s.data.price) } : null, updated: Math.max(...eps.map((e) => e.updatedAt || 0)) });
    }
    videos.sort((a, b) => String(b.start).localeCompare(String(a.start)));
    seriesOut.sort((a, b) => b.updated - a.updated);
    return { videos, series: seriesOut, playlists: await playlistCards(channelId) };
  }
  // episodes of a series the viewer may see, grouped by season
  async function seasonsOf(s, role) {
    const ready = await readyIds();
    const eps = (await app.store.list(s.team, 'vodvideo')).filter((v) => !v.deleted && v.data.series === s.id && ready.has(v.id) && (role || (v.data.visibility !== 'Hidden' && published(v)))).sort(order);
    const names = new Map(String(s.data.seasonNames || '').split('\n').map((l) => /^\s*(\d+)\s*[:.\-–]\s*(.+)$/.exec(l)).filter(Boolean).map((m) => [Number(m[1]), m[2].trim()]));
    const seasons = new Map();
    for (const v of eps) {
      const n = Number(v.data.season) || 1;
      if (!seasons.has(n)) seasons.set(n, { number: n, title: names.get(n) || 'Season ' + n, episodes: [] });
      const f = await fileOf(v.id);
      seasons.get(n).episodes.push({ id: v.id, title: v.data.title, episode: v.data.episode || '', description: v.data.description || '', poster: posterUrl(v, f), duration: lengthOf(v, f), free: !!v.data.freeInSeries || !(money(v.data.price) > 0 || money(s.data.price) > 0) });
    }
    return [...seasons.values()].sort((a, b) => a.number - b.number);
  }
  async function watch(id, { user, password, tickets }) {
    const v = await data(id);
    if (!v || v.type !== 'vodvideo') fail(404, 'There is no video here');
    const a = await access(v, { user, password, tickets });
    const brand = await app.streaming.branding(a.ch);
    let series = null, next = null;
    if (a.s && !a.s.deleted) {
      const seasons = await seasonsOf(a.s, a.role);
      const flat = seasons.flatMap((x) => x.episodes);
      const i = flat.findIndex((e) => e.id === v.id);
      next = i >= 0 && flat[i + 1] ? { id: flat[i + 1].id, title: flat[i + 1].title } : null;
      series = { id: a.s.id, title: a.s.data.title, seasons };
    }
    return { id: v.id, title: v.data.title, description: v.data.description || '', label: epLabel(v), poster: posterUrl(v, a.f), channel: brand, series, next,
      duration: lengthOf(v, a.f), needs: a.needs, price: a.price, payments: !!(app.pay && app.pay.enabled()), team: !!a.role,
      youtube: isYt(v) && !a.needs ? v.data.youtube : '',
      subtitles: a.needs ? [] : (await subtitlesOf(v.id)).map((x) => ({ label: x.label, lang: x.lang, default: !!x.default, url: `/vodfiles/${v.id}/subs/${x.id}.vtt?t=${tokenFor(v.id)}` })), src: a.needs || isYt(v) ? '' : `/vodfiles/${v.id}/video?t=${tokenFor(v.id)}`,
      status: isYt(v) ? 'ready' : a.f ? a.f.data.status : 'missing', progress: a.f ? a.f.data.progress || 0 : 0 };
  }
  async function seriesPage(id, { user, tickets }) {
    const s = await data(id);
    if (!s || s.type !== 'vodseries') fail(404, 'There is no series here');
    const ch = await data(s.data.channel);
    if (!ch || ch.data.disabled) fail(404, 'There is no series here');
    const role = user ? await app.auth.roleIn(user, s.team) : null;
    if (!role && (s.data.visibility === 'Hidden' || !published(s))) fail(404, 'There is no series here');
    const seasons = await seasonsOf(s, role);
    const price = money(s.data.price) > 0 ? money(s.data.price) : 0;
    const pp = money(ch.data.passPrice);
    const owned = role || !price ? true : !!(await purchased(user, tickets, { series: s.id, channel: ch.id }));
    return { id: s.id, title: s.data.title, description: s.data.description || '', poster: s.data.poster || '', banner: s.data.banner || '', channel: await app.streaming.branding(ch), seasons,
      price: price ? { series: price, pass: pp > 0 ? { amount: pp, days: Math.max(1, Math.round(Number(ch.data.passDays) || 30)) } : null, currency: 'ZAR' } : null, owned, payments: !!(app.pay && app.pay.enabled()), team: !!role };
  }
  // buying a video, a series, or the channel pass from a video or series page
  async function buy({ kind, id, user, email, name, giftTo, base }) {
    if (!app.pay || !app.pay.enabled()) fail(400, 'Payments are not set up on this website yet');
    const doc = await data(id);
    if (!doc || !['vodvideo', 'vodseries'].includes(doc.type)) fail(404, 'Not found');
    const ch = await data(doc.data.channel);
    if (!ch || ch.data.disabled || (ch.data.access || 'Public') !== 'Public') fail(400, 'This is not for sale');
    const isSeries = doc.type === 'vodseries';
    const s = isSeries ? doc : doc.data.series ? await data(doc.data.series) : null;
    kind = ['vod', 'series', 'pass'].includes(kind) ? kind : isSeries ? 'series' : 'vod';
    let amount = 0, item = '';
    if (kind === 'vod') { if (isSeries) fail(400, 'Choose an episode'); amount = money(doc.data.price); item = `${doc.data.title} – video`; }
    if (kind === 'series') { if (!s) fail(400, 'This video is not part of a series'); amount = money(s.data.price); item = `${s.data.title} – series`; }
    if (kind === 'pass') { amount = money(ch.data.passPrice); item = `${ch.data.name} pass (${Math.max(1, Math.round(Number(ch.data.passDays) || 30))} days)`; }
    if (!(amount > 0)) fail(400, kind === 'pass' ? 'This channel does not sell passes' : 'This is free to watch');
    const payer = String((user && user.data.email) || email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payer)) fail(400, 'Type your email address: the ticket is sent there');
    const gift = String(giftTo || '').trim().toLowerCase();
    if (gift && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(gift)) fail(400, 'Type the email address of the person the gift is for');
    if (!gift && await purchased(user, [], { vod: kind === 'vod' ? doc.id : '', series: kind === 'series' ? s.id : '', channel: kind === 'pass' ? ch.id : '' })) fail(409, 'You already have this');
    const back = (isSeries ? '/s/' : '/v/') + doc.id;
    const who = String(name || (user && user.data.name) || '').slice(0, 80);
    return app.pay.checkout({ kind, amount, item, payer, name: who, user, base, returnPath: back, cancelPath: back,
      data: { team: kind === 'pass' ? ch.team : doc.team, channel: ch.id, vod: kind === 'vod' ? doc.id : '', series: kind === 'series' ? s.id : '', path: back, email: gift || payer,
        name: gift ? '' : who, userId: user && !gift ? user.id : '', giftFrom: gift ? who || payer : '', days: kind === 'pass' ? Math.max(1, Math.round(Number(ch.data.passDays) || 30)) : 0 } });
  }
  // the ticket email for a video or series (passes are emailed by lib/pay.js)
  async function sendTicket(p) {
    if (!app.mail || !app.mail.enabled()) return;
    const base = String(cfg().publicUrl || '').replace(/\/+$/, '');
    const url = `${base}${p.data.path}?ticket=${app.pay.ticketOf(p.id)}`;
    await app.mail.send(p.data.email, { subject: `Your ticket: ${p.data.item.replace(/ – (video|series)$/, '')}`, title: 'Your ticket',
      lines: [...(p.data.giftFrom ? [`A gift from ${p.data.giftFrom}.`] : []), p.data.item, p.data.kind === 'series' ? 'Every episode of the series, as often as you like.' : 'Watch it as often as you like.', 'Keep this email: the button below opens it on any device. Please do not share it.'],
      button: base ? { url, label: 'Watch' } : null, footer: `You get this because you paid for it on ${cfg().publicName || cfg().name || 'RFP Manager'}.` });
  }
  if (app.pay) { app.pay.onPaid('vod', sendTicket); app.pay.onPaid('series', sendTicket); }

  // a play counts once per viewer and hour
  const seen = new Map();
  async function counted(id, who) {
    const k = id + '|' + who, now = Date.now();
    if (seen.get(k) > now - 3600e3) return false;
    seen.set(k, now);
    if (seen.size > 20000) for (const [x, t] of seen) if (t < now - 3600e3) seen.delete(x);
    const f = await fileOf(id);
    if (!f) return false;
    const v = await data(id);
    if (v) await saveFile(v, { ...f.data, views: (f.data.views || 0) + 1 });
    return true;
  }

  // the file itself, with byte ranges (seeking) – only with a token from watch()
  async function serveFile(req, res, id, token, poster) {
    const v = await data(id);
    const f = await fileOf(id);
    if (!v || !f) fail(404, 'Video not found');
    const dir = dirOf(v.team, v.id);
    if (poster) {
      if (v.data.visibility === 'Hidden' && !tokenOk(id, token)) fail(404, 'Not found');
      const p = path.join(dir, 'poster.jpg');
      if (!fs.existsSync(p)) fail(404, 'No poster');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(p).pipe(res);
      return;
    }
    if (!tokenOk(id, token)) fail(403, 'This link has run out. Open the video page again.');
    if (f.data.status !== 'ready') fail(409, 'This video is still being processed');
    const file = path.join(dir, f.data.file || f.data.source);
    let st;
    try { st = await fsp.stat(file); } catch { fail(404, 'The video file is missing on the server'); }
    const type = /\.webm$/i.test(file) ? 'video/webm' : /\.mov$/i.test(file) ? 'video/quicktime' : 'video/mp4';
    const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      if (start < 0) start = 0;
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, 'Content-Length': String(st.size) });
    fs.createReadStream(file).pipe(res);
  }

  // ---- subtitles: WebVTT files beside the video (SRT is turned into WebVTT), listed in "vodsubs" (id "vs_<video>")
  const subsId = (id) => 'vs_' + id;
  async function subtitlesOf(id) { const d = await data(subsId(id)); return (d && d.data.list) || []; }
  function toVtt(buf) {
    let t = buf.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!/-->/.test(t)) fail(400, 'That is not a subtitle file (SRT or WebVTT)');
    if (!/^WEBVTT/.test(t)) t = 'WEBVTT\n\n' + t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2');
    return t.trim() + '\n';
  }
  async function ownVideo(team, id) {
    const v = await data(id);
    if (!v || v.type !== 'vodvideo' || v.team !== team) fail(404, 'Video not found');
    return v;
  }
  async function addSubtitle(team, id, { label, lang, def }, buf) {
    const v = await ownVideo(team, id);
    if (!buf || !buf.length) fail(400, 'Choose a subtitle file (.srt or .vtt)');
    const vtt = toVtt(buf);
    const list = await subtitlesOf(id);
    if (list.length >= 20) fail(400, 'A video can have up to 20 subtitle tracks');
    const sid = 'st' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const dir = path.join(dirOf(team, id), 'subs');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, sid + '.vtt'), vtt);
    lang = String(lang || '').trim().slice(0, 12);
    const item = { id: sid, label: String(label || '').trim().slice(0, 40) || lang || 'Subtitles', lang, default: !!def, cues: (vtt.match(/-->/g) || []).length, addedAt: Date.now() };
    const next = [...list.map((x) => (item.default ? { ...x, default: false } : x)), item];
    await app.save(team, 'vodsubs', subsId(id), { video: id, list: next }, '');
    return { list: next, video: v.id };
  }
  async function updateSubtitle(team, id, sid, b = {}) {
    await ownVideo(team, id);
    const list = await subtitlesOf(id);
    if (!list.some((x) => x.id === sid)) fail(404, 'Subtitle track not found');
    const next = list.map((x) => (x.id === sid ? { ...x, label: b.label !== undefined ? String(b.label).trim().slice(0, 40) || x.label : x.label, lang: b.lang !== undefined ? String(b.lang).trim().slice(0, 12) : x.lang, default: b.default !== undefined ? !!b.default : x.default } : b.default ? { ...x, default: false } : x));
    await app.save(team, 'vodsubs', subsId(id), { video: id, list: next }, '');
    return { list: next };
  }
  async function removeSubtitle(team, id, sid) {
    await ownVideo(team, id);
    const list = await subtitlesOf(id);
    await fsp.rm(path.join(dirOf(team, id), 'subs', safe(sid) + '.vtt'), { force: true });
    const next = list.filter((x) => x.id !== sid);
    await app.save(team, 'vodsubs', subsId(id), { video: id, list: next }, '');
    return { list: next };
  }
  async function serveSubtitle(res, id, sid, token) {
    const v = await data(id);
    if (!v || !tokenOk(id, token)) fail(403, 'This link has run out. Open the video page again.');
    const file = path.join(dirOf(v.team, v.id), 'subs', safe(sid) + '.vtt');
    if (!fs.existsSync(file)) fail(404, 'Subtitles not found');
    res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'private, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  }

  // ---- playlists: uploaded and YouTube videos, and live streams (live while on air, then the recording)
  async function liveItem(prod, ch) {
    if (!prod || prod.deleted || !prod.data.streamSlug || !ch || ch.data.disabled) return null;
    const c = await app.streaming.streamCard(prod, ch);
    const acc = app.streaming.accessOf(prod, ch);
    return { kind: 'live', id: prod.id, slug: prod.data.streamSlug, title: c.title, poster: c.poster || '', live: !!c.live, startsAt: c.startsAt || '', date: c.date || '', time: c.time || '',
      recordings: (c.videos || []).length, duration: (c.videos && c.videos[0] && c.videos[0].duration) || 0, listed: acc.listed !== false && acc.access === 'Public', price: c.price ? { ticket: c.price.ticket } : null };
  }
  async function playlistItems(pl, role) {
    const ready = await readyIds();
    const out = [];
    for (const it of pl.data.items || []) {
      if (it.kind === 'live') {
        const prod = await data(it.id);
        const ch = prod ? await data(prod.data.streamChannel) : null;
        const x = await liveItem(prod, ch);
        if (x && (role || x.listed)) out.push(x);
        continue;
      }
      const v = await data(it.id);
      if (!v || v.type !== 'vodvideo' || !ready.has(v.id)) continue;
      if (!role && (v.data.visibility === 'Hidden' || !published(v))) continue;
      const f = await fileOf(v.id);
      const s = v.data.series ? await data(v.data.series) : null;
      const ch = await data(v.data.channel);
      const pr = ch && app.pay ? prices(v, s, ch) : null;
      out.push({ kind: 'vod', id: v.id, title: v.data.title, of: s ? [s.data.title, epLabel(v)].filter(Boolean).join(' · ') : '', poster: posterUrl(v, f), duration: lengthOf(v, f), youtube: isYt(v), price: pr ? { ticket: pr.video || (pr.series ? pr.series.amount : 0) } : null });
    }
    return out;
  }
  async function playlistPage(id, { user }) {
    const pl = await data(id);
    if (!pl || pl.type !== 'vodplaylist') fail(404, 'There is no playlist here');
    const ch = await data(pl.data.channel);
    if (!ch || ch.data.disabled) fail(404, 'There is no playlist here');
    const role = user ? await app.auth.roleIn(user, pl.team) : null;
    if (!role && (pl.data.visibility === 'Hidden' || !published(pl))) fail(404, 'There is no playlist here');
    const items = await playlistItems(pl, role);
    return { id: pl.id, title: pl.data.title, description: pl.data.description || '', poster: pl.data.poster || pl.data.ytPoster || (items[0] && items[0].poster) || '', channel: await app.streaming.branding(ch), items, team: !!role };
  }
  async function playlistCards(channelId) {
    const out = [];
    for (const pl of await app.store.listType('vodplaylist')) {
      if (pl.deleted || !listed(pl) || (channelId && pl.data.channel !== channelId)) continue;
      const ch = await data(pl.data.channel);
      if (!ch || ch.data.disabled || (ch.data.access || 'Public') !== 'Public') continue;
      const items = await playlistItems(pl, null);
      if (!items.length) continue;
      out.push({ href: '/p/' + pl.id, id: pl.id, title: pl.data.title, poster: pl.data.poster || pl.data.ytPoster || items[0].poster, channel: await app.streaming.branding(ch), count: items.length, live: items.some((x) => x.live), updated: pl.updatedAt || 0, category: pl.data.category || '' });
    }
    return out.sort((a, b) => b.updated - a.updated);
  }

  // may this person see this video (for its comments)? { needs, member }
  async function canWatch(id, opts = {}) {
    const v = await data(id);
    if (!v || v.type !== 'vodvideo') fail(404, 'There is no video here');
    const a = await access(v, opts);
    return { needs: a.needs || '', member: !!a.role, team: v.team };
  }
  return { canWatch, subtitlesOf, addSubtitle, updateSubtitle, removeSubtitle, serveSubtitle, playlistPage, playlistCards, playlistItems, liveItem, isYt, vodDir, create, chunk, status, done, list, removeFiles, resume, watch, seriesPage, publicList, buy, counted, serveFile, tokenFor, tokenOk, hasFfmpeg, processVideo, CHUNK };
}

module.exports = { makeVod };
