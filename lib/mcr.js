'use strict';
// Master control for a live stream, on the website: what viewers of the app see, on top of the clean feed.
//  · slates: Technical difficulties, Weather delay, Connection issues, … for a while or until cleared (sound on or off)
//  · ad breaks: a playlist of video adverts that plays in the viewers' players, with a countdown for the production
//  · overlays: a logo bug, a lower third, a ticker or an image – only in the app
//  · squeeze-backs: the live picture shrinks into a corner while an advert (video or sponsor board) fills the frame
//  · cues: any of these at a set time; automation: any of these when something happens in the game (a try, a wicket,
//    the end of an over …), reported by the scorer on the production PC
// The feed itself (and so the recording) stays clean: all of it happens in the player.
// Kept as "mcr" records per stream (team = the production's): { slug, production, slate, ad, squeeze, overlays, cues, auto }
// Video adverts are "videoad" records { title, file, duration, size }; the files live in <dataDir>/ads.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { newId, fail, log } = require('./util');

const SLATES = {
  technical: { title: 'Technical difficulties', text: 'We are currently experiencing technical issues. Our technicians are working to resolve the problem – please stay with us.' },
  weather: { title: 'Weather delay', text: 'Play is suspended because of the weather. We will be back as soon as play resumes.' },
  connection: { title: 'Connection issues', text: 'We are having trouble with the connection from the venue. The stream continues as soon as it is restored.' },
  break: { title: 'We will be right back', text: 'A short break – stay with us.' },
  starting: { title: 'Starting soon', text: 'The stream starts in a moment.' },
  custom: { title: '', text: '' },
};
const OVERLAYS = ['bug', 'lower', 'ticker', 'image'];
const DOES = ['slate', 'ads', 'squeeze', 'clearSlate', 'stopAds', 'stopSqueeze'];
const POS = ['tl', 'tr', 'bl', 'br'];
const docId = (slug) => 'mcr_' + crypto.createHash('sha256').update(String(slug)).digest('hex').slice(0, 20);
const iso = (ms) => new Date(ms).toISOString();

function makeMcr(app) {
  const adsDir = () => path.resolve(app.root || '.', app.config.dataDir || 'data', 'ads');
  let timer = null;

  async function load(slug) { const d = await app.store.get(docId(slug)); return d && !d.deleted ? d : null; }
  const blank = (s) => ({ slug: s.prod.data.streamSlug, production: s.prod.id, slate: null, ad: null, squeeze: null, overlays: [], cues: [], auto: [] });
  async function state(s) { const d = await load(s.prod.data.streamSlug); return d ? { ...blank(s), ...d.data } : blank(s); }
  async function save(s, data, userId = '') { return (await app.save(s.prod.team, 'mcr', docId(s.prod.data.streamSlug), data, userId)).data; }

  // ---- the actions
  function slateOf(b = {}) {
    const kind = SLATES[b.kind] ? b.kind : 'technical';
    const now = Date.now(), mins = Number(b.minutes) || 0;
    return { kind, title: String(b.title || SLATES[kind].title || 'Please stand by').slice(0, 80), text: String(b.text !== undefined && b.text !== '' ? b.text : SLATES[kind].text).slice(0, 300),
      mute: b.mute !== false, since: iso(now), until: mins > 0 ? iso(now + Math.min(mins, 24 * 60) * 60e3) : '' };
  }
  async function adsByIds(team, ids) {
    const out = [];
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 50)) {
      const d = await app.store.get(String(id));
      if (d && !d.deleted && d.type === 'videoad' && d.team === team) out.push({ id: d.id, title: d.data.title || '', duration: Number(d.data.duration) || 0 });
    }
    return out.filter((x) => x.duration > 0);
  }
  // a squeeze-back: adverts (played one after the other) or a sponsor board for a number of seconds
  async function squeezeOf(team, b, now = Date.now()) {
    const items = await adsByIds(team, b.ads);
    const image = /^img_[\w-]+$/.test(String(b.image || '')) ? String(b.image) : '';
    if (!items.length && !image) fail(400, 'Pick video adverts or a sponsor board for the squeeze-back');
    const secs = items.length ? items.reduce((n, x) => n + x.duration, 0) : Math.max(5, Math.min(600, Number(b.seconds) || 20));
    return { items, image, text: String(b.text || '').slice(0, 120), pos: POS.includes(b.pos) ? b.pos : 'tr', size: Math.max(40, Math.min(80, Number(b.size) || 62)),
      sound: b.sound === 'live' ? 'live' : 'ad', startedAt: iso(now), endsAt: iso(now + secs * 1000) };
  }
  async function act(s, b, userId = '') {
    const cur = await state(s);
    const what = String(b.action || '');
    if (what === 'slate') cur.slate = slateOf(b);
    else if (what === 'clearSlate') cur.slate = null;
    else if (what === 'ads') {
      const items = await adsByIds(s.prod.team, b.ads);
      if (!items.length) fail(400, 'Pick one or more video adverts first');
      const now = Date.now(), total = items.reduce((n, x) => n + x.duration, 0);
      cur.ad = { items, startedAt: iso(now), endsAt: iso(now + total * 1000) };
    } else if (what === 'stopAds') cur.ad = null;
    else if (what === 'squeeze') { cur.squeeze = await squeezeOf(s.prod.team, b); cur.ad = null; }
    else if (what === 'stopSqueeze') cur.squeeze = null;
    else if (what === 'setAuto') cur.auto = cleanAuto(b.rules);
    else if (what === 'overlays') cur.overlays = cleanOverlays(b.overlays);
    else if (what === 'addCue') {
      const at = Date.parse(b.at);
      if (!Number.isFinite(at)) fail(400, 'Choose when it should happen');
      const cue = { id: newId('cue_'), at: iso(at), do: DOES.includes(b.do) ? b.do : 'slate', kind: b.kind || 'technical', title: b.title || '', text: b.text || '', minutes: Number(b.minutes) || 0, mute: b.mute !== false, ads: Array.isArray(b.ads) ? b.ads.slice(0, 50) : [],
        image: String(b.image || ''), seconds: Number(b.seconds) || 0, pos: b.pos || 'tr', sound: b.sound || 'ad' };
      if (cue.do === 'ads' && !(await adsByIds(s.prod.team, cue.ads)).length) fail(400, 'Pick one or more video adverts for the ad break');
      if (cue.do === 'squeeze') await squeezeOf(s.prod.team, cue);
      cur.cues = [...(cur.cues || []), cue].sort((a, x) => a.at.localeCompare(x.at)).slice(-50);
    } else if (what === 'removeCue') cur.cues = (cur.cues || []).filter((c) => c.id !== b.id);
    else if (what === 'clearAll') { cur.slate = null; cur.ad = null; cur.squeeze = null; }
    else fail(400, 'Unknown action');
    return save(s, cur, userId);
  }
  // automation rules: WHEN a game event (from the scorer) THEN a squeeze-back, an ad break or a slate
  function cleanAuto(list) {
    return (Array.isArray(list) ? list : []).slice(0, 30).map((r) => ({ id: /^au_[\w-]+$/.test(r.id || '') ? r.id : newId('au_'), on: r.on !== false, when: String(r.when || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30),
      team: ['A', 'B'].includes(r.team) ? r.team : '', do: ['squeeze', 'ads', 'slate'].includes(r.do) ? r.do : 'squeeze', ads: Array.isArray(r.ads) ? r.ads.slice(0, 20).map(String) : [],
      image: /^img_[\w-]+$/.test(String(r.image || '')) ? r.image : '', seconds: Math.max(5, Math.min(600, Number(r.seconds) || 20)), kind: SLATES[r.kind] ? r.kind : 'break', minutes: Math.max(0, Number(r.minutes) || 0),
      delay: Math.max(0, Math.min(120, Number(r.delay) || 0)), cooldown: Math.max(0, Math.min(3600, Number(r.cooldown) || 120)), pos: POS.includes(r.pos) ? r.pos : 'tr', sound: r.sound === 'live' ? 'live' : 'ad' }))
      .filter((r) => r.when);
  }
  function cleanOverlays(list) {
    return (Array.isArray(list) ? list : []).filter((o) => OVERLAYS.includes(o && o.kind)).slice(0, 10).map((o) => ({
      kind: o.kind, on: !!o.on, text: String(o.text || '').slice(0, 200), sub: String(o.sub || '').slice(0, 120), image: /^(img_[\w-]+)?$/.test(String(o.image || '')) ? String(o.image || '') : '',
      pos: ['tl', 'tr', 'bl', 'br'].includes(o.pos) ? o.pos : o.kind === 'bug' ? 'tr' : 'bl' }));
  }

  // ---- the clock: cues that are due, slates and ad breaks that are over
  async function tick() {
    const now = Date.now();
    for (const d of await app.store.listType('mcr')) {
      if (d.deleted) continue;
      const x = { ...d.data };
      let changed = false;
      if (x.slate && x.slate.until && Date.parse(x.slate.until) <= now) { x.slate = null; changed = true; }
      if (x.ad && Date.parse(x.ad.endsAt) <= now) { x.ad = null; changed = true; }
      if (x.squeeze && Date.parse(x.squeeze.endsAt) <= now) { x.squeeze = null; changed = true; }
      const due = (x.cues || []).filter((c) => Date.parse(c.at) <= now);
      if (due.length) {
        x.cues = (x.cues || []).filter((c) => Date.parse(c.at) > now);
        for (const c of due) {
          if (now - Date.parse(c.at) > 10 * 60e3) continue;                     // missed by far (server was off): skip
          if (c.do === 'slate') x.slate = slateOf(c);
          else if (c.do === 'clearSlate') x.slate = null;
          else if (c.do === 'stopAds') x.ad = null;
          else if (c.do === 'stopSqueeze') x.squeeze = null;
          else if (c.do === 'squeeze') { try { x.squeeze = await squeezeOf(d.team, c, now); } catch { /* its adverts are gone */ } }
          else if (c.do === 'ads') { const items = await adsByIds(d.team, c.ads); if (items.length) x.ad = { items, startedAt: iso(now), endsAt: iso(now + items.reduce((n, i) => n + i.duration, 0) * 1000) }; }
        }
        changed = true;
      }
      if (changed) { try { await app.save(d.team, 'mcr', d.id, x, ''); } catch (e) { log('MCR:', e.message); } }
    }
  }
  function start() { if (app.isLocal) return; timer = setInterval(() => tick().catch(() => {}), 2000); timer.unref(); }
  function stop() { clearInterval(timer); }

  // what the viewers' players get (live only)
  async function forViewers(s) {
    const x = await state(s);
    const now = Date.now();
    const slate = x.slate && (!x.slate.until || Date.parse(x.slate.until) > now) ? x.slate : null;
    const ad = x.ad && Date.parse(x.ad.endsAt) > now ? { startedAt: x.ad.startedAt, endsAt: x.ad.endsAt, items: x.ad.items.map((i) => ({ title: i.title, duration: i.duration, url: `/ads/${i.id}.mp4` })) } : null;
    const sq = x.squeeze && Date.parse(x.squeeze.endsAt) > now ? { ...x.squeeze, items: x.squeeze.items.map((i) => ({ title: i.title, duration: i.duration, url: `/ads/${i.id}.mp4` })) } : null;
    return { now, slate, ad, squeeze: sq, overlays: (x.overlays || []).filter((o) => o.on) };
  }

  // ---- automation: a game event from a scorer (via the production PC) runs the rules of the streams showing that match:
  // the match's own stream (One stream per match), else the productions' streams the match is in. Only while live.
  const lastAuto = new Map();       // rule id → when it last ran (cool-down)
  async function gameEvent(team, e) {
    const fx = String(e.fixtureId || ''), kinds = new Set([String(e.kind || ''), ...(Array.isArray(e.also) ? e.also : [])].map((k) => String(k).toLowerCase()));
    if (!fx || !kinds.size) return { ran: 0 };
    const all = await app.streaming.allStreams(team);
    let streams = all.filter((p) => p.fixtureId === fx);
    if (!streams.length) streams = all.filter((p) => !p.fixtureId && (p.data.fixtures || []).some((r) => r && r.fixture === fx));
    let ran = 0;
    for (const p of streams) {
      const slug = p.data.streamSlug;
      if (!slug || !app.streaming.status(slug).live) continue;
      const s = { prod: p }, x = await state(s), now = Date.now();
      for (const r of x.auto || []) {
        if (!r.on || !kinds.has(r.when) || (r.team && r.team !== e.team)) continue;
        if (now - (lastAuto.get(r.id) || 0) < r.cooldown * 1000) continue;
        const busy = (x.ad && Date.parse(x.ad.endsAt) > now) || (x.squeeze && Date.parse(x.squeeze.endsAt) > now) || (x.slate && (!x.slate.until || Date.parse(x.slate.until) > now));
        if (busy) continue;                                                      // never on top of a break or a slate
        lastAuto.set(r.id, now);
        const go = async () => {
          const body = r.do === 'slate' ? { action: 'slate', kind: r.kind, minutes: r.minutes || Math.ceil(r.seconds / 60), mute: false } : r.do === 'ads' ? { action: 'ads', ads: r.ads } : { action: 'squeeze', ads: r.ads, image: r.image, seconds: r.seconds, pos: r.pos, sound: r.sound };
          try { await act(s, body, ''); log(`Master control ${slug}: ${r.do} on "${r.when}"`); } catch (er) { log(`Master control ${slug}: rule "${r.when}" could not run: ${er.message}`); }
        };
        if (r.delay) setTimeout(go, r.delay * 1000).unref(); else await go();
        ran++;
        break;                                                                   // one rule per event per stream
      }
    }
    return { ran };
  }

  // ---- the video adverts
  function probe(file) {
    return new Promise((resolve) => execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 20000 }, (e, out) => resolve(e ? 0 : Math.round(Number(String(out).trim()) * 10) / 10 || 0)));
  }
  // the upload streams to disk (adverts can be big); ffprobe tells the length, else the browser's guess
  async function upload(req, team, { name, duration } = {}, userId = '') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(type)) fail(415, 'Use an MP4 video (H.264 + AAC plays everywhere)');
    const max = 500 * 1024 * 1024;
    if (Number(req.headers['content-length']) > max) fail(413, 'Video adverts can be up to 500 MB');
    fs.mkdirSync(adsDir(), { recursive: true });
    const id = newId('vad_');
    const file = path.join(adsDir(), id + '.mp4');
    let size = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(file);
      req.on('data', (c) => { size += c.length; if (size > max) { req.destroy(); out.destroy(); reject(Object.assign(new Error('Video adverts can be up to 500 MB'), { status: 413 })); } });
      req.pipe(out);
      out.on('finish', resolve); out.on('error', reject); req.on('error', reject);
    }).catch((e) => { fs.rmSync(file, { force: true }); throw e; });
    if (!size) { fs.rmSync(file, { force: true }); fail(400, 'The video is empty'); }
    const secs = (await probe(file)) || Math.round(Number(duration) * 10) / 10 || 0;
    if (!secs) { fs.rmSync(file, { force: true }); fail(400, 'Could not read how long the video is'); }
    return app.save(team, 'videoad', id, { title: String(name || 'Advert').replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 80), file: id + '.mp4', duration: secs, size, mime: type }, userId);
  }
  async function removeAd(doc, userId = '') {
    fs.rmSync(path.join(adsDir(), doc.id + '.mp4'), { force: true });
    return app.put({ ...doc, deleted: true, updatedAt: Math.max(Date.now(), doc.updatedAt + 1), updatedBy: userId });
  }
  const adFile = (id) => (/^vad_[\w-]+$/.test(id) ? path.join(adsDir(), id + '.mp4') : null);

  return { SLATES, state, act, tick, start, stop, forViewers, upload, removeAd, adFile, docId, gameEvent };
}

module.exports = { makeMcr, SLATES };
