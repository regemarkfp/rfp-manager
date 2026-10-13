'use strict';
// Live streaming and videos.
//  · A channel is a branded page (/c/<channel>): the production company's, a club's, a team's or a production's own.
//  · A production streams on a channel with its own stream key. Cameras or vMix/OBS send SRT or RTMP to a MediaMTX
//    server; viewers watch at /watch/<stream> (WebRTC, HLS on iPhones). MediaMTX records it, and the recording is
//    played back as a video afterwards (MediaMTX's playback server).
//  · MediaMTX asks this site whether each publisher or viewer may in (POST /api/stream/auth); this site reads MediaMTX's
//    API for what is live, how many watch, and which recordings there are.
const crypto = require('node:crypto');
const Schema = require('../shared/schema');
const { fail, log, slug: slugify } = require('./util');

const KEY_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const newKey = (n = 24) => { let s = ''; for (const x of crypto.randomBytes(n)) s += KEY_CHARS[x % KEY_CHARS.length]; return s; };
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); };
const RESERVED = new Set(['api', 'app', 'live', 'webrtc', 'hls', 'vod', 'watch', 'admin', 'new', 'all', 'all_others', 'c', 'channels', 'matches', 'videos', 'subscriptions']);
const ACCESS = ['Public', 'Team members', 'Password'];

// "live/saturday-rugby" (what MediaMTX calls the path) → "saturday-rugby"
const slugOfPath = (p) => String(p || '').replace(/^\/+|\/+$/g, '').replace(/^live\//, '');
const pathOf = (slug) => 'live/' + slug;

function makeStreaming(app) {
  const conf = () => app.config.streaming || {};
  const enabled = () => !!conf().host;
  const signKey = () => conf().hookSecret || app.streamTokenKey || (app.streamTokenKey = crypto.randomBytes(32).toString('hex'));
  const data = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };

  // ---- viewer tokens: "slug.expires.signature", for a viewer allowed to watch a stream that is not public
  const sign = (s) => crypto.createHmac('sha256', signKey()).update(s).digest('base64url').slice(0, 32);
  function token(slug, hours = 8) { const body = slug + '.' + (Date.now() + hours * 3600e3).toString(36); return body + '.' + sign(body); }
  function tokenOk(t, slug) {
    const p = String(t || '').split('.');
    if (p.length !== 3 || p[0] !== slug) return false;
    return parseInt(p[1], 36) > Date.now() && same(p[2], sign(p[0] + '.' + p[1]));
  }

  // ---- channels and the productions streaming on them
  const cache = new Map();
  const cached = async (key, fn) => { const hit = cache.get(key); if (hit && hit.at > Date.now() - 5000) return hit.v; const v = await fn(); cache.set(key, { v, at: Date.now() }); return v; };
  app.on('doc', (doc) => { if (doc.type === 'channel' || doc.type === 'production' || doc.type === 'club' || doc.type === 'squad' || doc.type === 'org') cache.clear(); });
  const channelBySlug = (slug) => cached('c:' + slug, async () => (await app.store.find('channel', 'slug', slug)).find((d) => !d.deleted) || null);
  const productionBySlug = (slug) => cached('p:' + slug, async () => (await app.store.find('production', 'streamSlug', slug)).find((d) => !d.deleted) || null);
  async function streamOf(slug) {                        // { prod, ch } for a stream address
    const prod = await productionBySlug(slug);
    if (!prod || !prod.data.streamChannel) return null;
    const ch = await data(prod.data.streamChannel);
    return ch ? { prod, ch } : null;
  }

  // A channel as shown: its own logo, banner and colour, else its club's / team's / company's.
  async function branding(ch) {
    const d = ch.data, org = (await data(ch.team)) || { data: {} };
    let club = d.owner === 'Club' ? await data(d.club) : null;
    const squad = d.owner === 'Team' ? await data(d.squad) : null;
    if (squad && !club) club = await data(squad.data.club);
    const team = squad ? Schema.resolveSquad(squad.data, club && club.data) : null;
    return {
      id: ch.id, slug: d.slug, name: d.name, description: d.description || '', owner: d.owner || 'Production company',
      logo: d.logo || (team && team.image) || (club && club.data.image) || org.data.image || '',
      banner: d.banner || '', color: d.color || (team && team.primaryColor !== '#ffffff' ? team.primaryColor : '') || (club && club.data.primaryColor) || org.data.accentColor || '#00ff82',
      access: d.access || 'Public', company: org.data.name || '',
    };
  }

  // Before a channel is saved: a clean, unique web address.
  async function prepareChannel(team, id, d) {
    d.slug = slugify(d.slug || d.name).slice(0, 40);
    if (!d.slug) fail(400, 'The channel needs a name or a web address');
    if (RESERVED.has(d.slug)) fail(400, `"${d.slug}" cannot be used as a web address. Choose another.`);
    if ((await app.store.find('channel', 'slug', d.slug)).some((x) => !x.deleted && x.id !== id)) fail(409, `Another channel already uses the web address /c/${d.slug}. Choose another.`);
    if (!ACCESS.includes(d.access)) d.access = 'Public';
    if (d.access === 'Password' && !String(d.viewerPassword || '').trim()) fail(400, 'Type the password viewers need, or choose another "Who can watch"');
    delete d.streamKey;                                     // stream keys belong to productions now
    return d;
  }
  // Before a production is saved: when it streams, a unique stream address and its own stream key.
  async function prepareProduction(team, id, d, cur) {
    if (!d.streamChannel) { if (cur && cur.data.streamKey) d.streamKey = cur.data.streamKey; if (cur && cur.data.streamSlug && !d.streamSlug) d.streamSlug = cur.data.streamSlug; return d; }
    const ch = await data(d.streamChannel);
    if (!ch || ch.type !== 'channel' || ch.deleted) fail(400, 'Pick a channel to stream on');
    if (ch.team !== team && ch.data.teamOnly) fail(400, `The channel ${ch.data.name || ''} is only for its own production team`);
    if (ch.team !== team && ch.data.disabled) fail(400, 'That channel is switched off');
    let s = slugify(d.streamSlug || (cur && cur.data.streamSlug) || [d.name, d.date].filter(Boolean).join(' ')).slice(0, 50);
    if (!s) s = 'stream-' + id.slice(-6).toLowerCase();
    if (RESERVED.has(s)) s += '-live';
    const clash = async (x) => (await app.store.find('production', 'streamSlug', x)).some((o) => !o.deleted && o.id !== id);
    if (d.streamSlug && await clash(s)) fail(409, `Another production already streams at /watch/${s}. Choose another stream web address.`);
    const stem = s;
    for (let n = 2; await clash(s); n++) s = stem + '-' + n;
    d.streamSlug = s;
    d.streamKey = (cur && cur.data.streamKey) || newKey();
    if (d.streamRecord === undefined) d.streamRecord = true;
    if (d.streamVod === undefined) d.streamVod = true;
    return d;
  }
  async function newStreamKey(doc, userId) { return app.save(doc.team, 'production', doc.id, { ...doc.data, streamKey: newKey() }, userId); }

  // ---- MediaMTX asks: may this camera publish / this viewer watch or play back?
  // body: { user, password, token, ip, action, path, protocol, id, query }
  async function allow(b) {
    const action = String(b.action || ''), slug = slugOfPath(b.path);
    if (action === 'api' || action === 'metrics' || action === 'pprof') return ['127.0.0.1', '::1'].includes(String(b.ip || ''));
    if (!['publish', 'read', 'playback'].includes(action)) return false;
    const s = await streamOf(slug);
    if (!s || s.ch.data.disabled) return false;
    const q = new URLSearchParams(String(b.query || ''));
    const offered = [b.password, b.token, q.get('pass'), q.get('key'), q.get('token')].filter(Boolean).map(String);
    if (action === 'publish') return offered.some((k) => same(k, s.prod.data.streamKey));
    if (conf().hookSecret && offered.some((k) => same(k, conf().hookSecret))) return true;      // this site itself (listing recordings)
    if (action === 'playback' && s.prod.data.streamVod === false) return offered.some((t) => tokenOk(t, slug));
    if ((s.ch.data.access || 'Public') === 'Public' && !(app.pay && app.pay.isPaid(s.prod, s.ch))) return true;
    return offered.some((t) => tokenOk(t, slug));
  }

  // ---- what MediaMTX is doing: what is live, viewers, bitrate; and the recordings
  const live = new Map();         // slug → { path, live, since, viewers, tracks, kbps, bytes, at }
  const vods = new Map();         // slug → [{ start, duration }]
  let timer = null, lastError = '', polled = 0, vodAt = 0;
  async function poll() {
    const api = conf().api;
    if (!api) return;
    try {
      const r = await fetch(api.replace(/\/+$/, '') + '/v3/paths/list?itemsPerPage=1000', { signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error('MediaMTX API answered ' + r.status);
      const items = (await r.json()).items || [];
      const seen = new Set(), now = Date.now();
      for (const p of items) {
        const slug = slugOfPath(p.name);
        const on = !!(p.ready ?? p.available ?? p.online);
        const prev = live.get(slug);
        const bytes = Number(p.bytesReceived || p.inboundBytes || 0);
        const kbps = prev && prev.bytes && bytes >= prev.bytes ? Math.round(((bytes - prev.bytes) * 8) / Math.max(1, now - prev.at)) : (prev ? prev.kbps : 0);
        const s = { path: p.name, live: on, since: on ? Date.parse(p.readyTime || p.availableTime || p.onlineTime || '') || (prev && prev.since) || now : 0,
          viewers: (p.readers || []).length, tracks: (p.tracks || []).map((t) => (typeof t === 'string' ? t : t.codec || t.type || '')).filter(Boolean), kbps: on ? kbps : 0, bytes, at: now };
        seen.add(slug);
        if (!prev || prev.live !== s.live || prev.viewers !== s.viewers) app.emit('stream', slug, view(slug, s), prev ? prev.live : false);
        live.set(slug, s);
      }
      for (const slug of [...live.keys()]) if (!seen.has(slug)) { const was = live.get(slug).live; live.delete(slug); app.emit('stream', slug, view(slug, null), was); }
      lastError = ''; polled = now;
      if (now - vodAt > 60000) { vodAt = now; await pollVods(); }
    } catch (e) {
      if (lastError !== e.message) log('Streaming server:', e.message);
      lastError = e.message;
    }
  }
  // the recordings, as one video per uninterrupted stretch of streaming
  async function pollVods() {
    const pb = conf().playback;
    if (!pb) return;
    const r = await fetch(conf().api.replace(/\/+$/, '') + '/v3/recordings/list?itemsPerPage=1000', { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!r || !r.ok) return;
    const names = ((await r.json()).items || []).map((x) => x.name).filter((n) => /^live\//.test(n));
    const next = new Map();
    for (const name of names) {
      const q = await fetch(`${pb.replace(/\/+$/, '')}/list?path=${encodeURIComponent(name)}`, { headers: internal(), signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (!q || !q.ok) continue;
      const list = (await q.json().catch(() => [])) || [];
      next.set(slugOfPath(name), list.map((x) => ({ start: x.start, duration: Number(x.duration) || 0 })).filter((x) => x.start && x.duration > 20));
    }
    vods.clear();
    for (const [k, v] of next) vods.set(k, v);
    await noRecording();
  }
  const internal = () => ({ authorization: 'Basic ' + Buffer.from('rfp:' + (conf().hookSecret || '')).toString('base64') });
  // productions that should not be recorded: MediaMTX gets a path setting with recording off for each
  async function noRecording() {
    const api = conf().api.replace(/\/+$/, '');
    const want = (await app.store.listType('production')).filter((p) => !p.deleted && p.data.streamSlug && p.data.streamRecord === false).map((p) => pathOf(p.data.streamSlug));
    const r = await fetch(api + '/v3/config/paths/list?itemsPerPage=1000', { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!r || !r.ok) return;
    const have = new Map(((await r.json()).items || []).map((x) => [x.name, x]));
    for (const name of want) {
      if (have.has(name) && have.get(name).record === false) continue;
      await fetch(`${api}/v3/config/paths/${have.has(name) ? 'patch' : 'add'}/${encodeURIComponent(name)}`, { method: have.has(name) ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ record: false }), signal: AbortSignal.timeout(5000) }).catch(() => {});
    }
  }
  const view = (slug, s) => ({ slug, live: !!(s && s.live), since: s ? s.since : 0, viewers: s ? s.viewers : 0, tracks: s ? s.tracks : [], kbps: s ? s.kbps : 0 });
  function start() { if (!timer && conf().api) { poll(); timer = setInterval(poll, 4000); timer.unref(); } }
  function stop() { clearInterval(timer); timer = null; }

  // ---- addresses
  function ingest(prod) {
    const c = conf(), host = c.host, key = prod.data.streamKey, slug = prod.data.streamSlug;
    if (!host || !key || !slug) return null;
    const rtmpPort = Number(c.rtmpPort) || 1935, srtPort = Number(c.srtPort) || 8890;
    const rtmpHost = rtmpPort === 1935 ? host : `${host}:${rtmpPort}`;
    const streamId = `publish:${pathOf(slug)}:publish:${key}`;
    return {
      rtmpServer: `rtmp://${rtmpHost}/live`, rtmpKey: `${slug}?user=publish&pass=${key}`, rtmpUrl: `rtmp://${rtmpHost}/live/${slug}?user=publish&pass=${key}`,
      srtHost: host, srtPort, srtStreamId: streamId, srtUrl: `srt://${host}:${srtPort}?streamid=${streamId}&pkt_size=1316&latency=200000`,
    };
  }
  const status = (slug) => view(slug, live.get(slug));
  const players = (slug) => { const p = (live.get(slug) || {}).path || pathOf(slug); return { whep: `/webrtc/${p}/whep`, hls: `/hls/${p}/index.m3u8` }; };
  const vodUrl = (slug, v, tok) => `/vod/get?path=${encodeURIComponent(pathOf(slug))}&start=${encodeURIComponent(v.start)}&duration=${v.duration}&format=mp4${tok ? '&token=' + encodeURIComponent(tok) : ''}`;
  const videosOf = (slug) => (vods.get(slug) || []).slice().sort((a, b) => String(b.start).localeCompare(String(a.start)));

  // A stream (a production on a channel) as the public pages show it
  async function streamCard(prod, ch, brand) {
    const d = prod.data, slug = d.streamSlug;
    const st = status(slug);
    const matches = d.streamVod === false || !app.clips ? [] : app.clips.videos(await app.clips.clipsOf(prod.id), videosOf(slug), st.live);
    return { slug, title: d.streamTitle || d.name, date: d.date || '', time: d.txTime || '', poster: d.streamPoster || '', channel: brand || await branding(ch),
      ...st, price: app.pay && app.pay.isPaid(prod, ch) ? app.pay.prices(prod, ch) : null, videos: d.streamVod === false ? [] : videosOf(slug).map((v) => ({ start: v.start, duration: Math.round(v.duration) })), matches };
  }

  // What the /watch page needs. Team members always watch; others as the channel says.
  async function watch(slug, user, password, vodStart, tickets = [], matchId = '') {
    const s = await streamOf(slugify(slug));
    if (!s || s.ch.data.disabled) fail(404, 'There is no stream at this address');
    const { prod, ch } = s;
    const card = await streamCard(prod, ch);
    const out = { ...card, site: app.config.publicName || app.config.name || '', description: prod.data.description || '', access: ch.data.access || 'Public', streaming: enabled() };
    const member = user ? !!((await app.auth.roleIn(user, ch.team)) || (prod.team !== ch.team && (await app.auth.roleIn(user, prod.team)))) : false;
    let ok = (ch.data.access || 'Public') === 'Public' || member;
    if (!ok && ch.data.access === 'Password' && password !== undefined) {
      if (!same(String(password).trim(), String(ch.data.viewerPassword || '').trim())) fail(403, 'That password is not right');
      ok = true;
    }
    if (!ok) return { ...out, videos: [], needs: ch.data.access === 'Password' ? 'password' : user ? 'team' : 'signin' };
    const paid = !!(app.pay && app.pay.isPaid(prod, ch));
    if (paid && !member && !(await app.pay.entitled(prod, ch, user, tickets))) {
      return { ...out, videos: out.videos, needs: 'ticket', price: app.pay.prices(prod, ch), payments: app.pay.enabled(), signedIn: !!user, email: user ? user.data.email : '' };
    }
    const tok = (ch.data.access || 'Public') === 'Public' && prod.data.streamVod !== false && !paid ? '' : token(slug);
    const vids = prod.data.streamVod === false && !member ? [] : videosOf(slug);
    const matches = prod.data.streamVod === false && !member ? [] : out.matches.filter((m) => m.duration > 0);
    let pick = vodStart ? vids.find((v) => v.start === vodStart) : null;
    let pickMatch = matchId ? matches.find((m) => m.fixture === matchId) : null;
    if (pickMatch) pick = { start: pickMatch.start, duration: pickMatch.duration, title: pickMatch.title, fixture: pickMatch.fixture };
    return { ...out, needs: null, paid, token: (ch.data.access || 'Public') === 'Public' && !paid ? '' : tok, ...players(slug),
      matches: matches.map((m) => ({ ...m, url: vodUrl(slug, m, tok) })),
      videos: vids.map((v) => ({ start: v.start, duration: Math.round(v.duration), url: vodUrl(slug, v, tok) })), vod: pick ? { start: pick.start, duration: Math.round(pick.duration), title: pick.title || '', fixture: pick.fixture || '', url: vodUrl(slug, pick, tok) } : null };
  }

  // ---- the public website: everything public across all production teams
  async function publicChannels() {
    return cached('public', async () => {
      const out = [];
      for (const ch of await app.store.listType('channel')) if (!ch.deleted && !ch.data.disabled && (ch.data.access || 'Public') === 'Public') out.push({ ch, brand: await branding(ch) });
      return out;
    });
  }
  async function publicStreams() {
    const chans = await publicChannels(), byId = new Map(chans.map((c) => [c.ch.id, c]));
    const out = [];
    for (const p of await app.store.listType('production')) {
      if (p.deleted || !p.data.streamChannel || !p.data.streamSlug || !byId.has(p.data.streamChannel)) continue;
      const c = byId.get(p.data.streamChannel);
      out.push(await streamCard(p, c.ch, c.brand));
    }
    return out;
  }

  // Channels any production team can stream on (not "only this production team"), for the production form
  async function sharedChannels() {
    const out = [];
    for (const ch of await app.store.listType('channel')) {
      if (ch.deleted || ch.data.disabled || ch.data.teamOnly) continue;
      const org = await data(ch.team);
      out.push({ id: ch.id, name: ch.data.name || '', slug: ch.data.slug || '', team: ch.team, teamName: org && org.data ? org.data.name || '' : '' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { signKey, sharedChannels, enabled, prepareChannel, prepareProduction, newStreamKey, allow, watch, ingest, status, players, token, tokenOk, start, stop, poll, pollVods, branding, channelBySlug, streamOf, streamCard, publicChannels, publicStreams, videosOf,
    health: () => ({ api: !!conf().api, playback: !!conf().playback, lastError, polled }), ACCESS };
}

module.exports = { makeStreaming, slugOfPath, newKey };
