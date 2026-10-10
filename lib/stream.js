'use strict';
// Live streaming: each production team has channels. Cameras or vMix/OBS send SRT or RTMP to a MediaMTX server; viewers
// watch at /watch/<channel> (WebRTC, HLS on iPhones). MediaMTX asks this site whether each publisher or viewer may in
// (POST /api/stream/auth), and this site reads MediaMTX's API to show which channels are live and how many watch.
const crypto = require('node:crypto');
const { fail, log, slug: slugify } = require('./util');

const KEY_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const newKey = (n = 24) => { let s = ''; for (const x of crypto.randomBytes(n)) s += KEY_CHARS[x % KEY_CHARS.length]; return s; };
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); };
const RESERVED = new Set(['api', 'live', 'webrtc', 'hls', 'watch', 'admin', 'new', 'all', 'all_others']);
const ACCESS = ['Public', 'Team members', 'Password'];

// "live/my-channel" (what MediaMTX calls the path) → "my-channel"
const slugOfPath = (p) => String(p || '').replace(/^\/+|\/+$/g, '').replace(/^live\//, '');
const pathOf = (slug) => 'live/' + slug;

function makeStreaming(app) {
  const conf = () => app.config.streaming || {};
  const enabled = () => !!conf().host;
  const signKey = () => conf().hookSecret || app.streamTokenKey || (app.streamTokenKey = crypto.randomBytes(32).toString('hex'));

  // ---- viewer tokens: "slug.expires.signature", handed to a viewer allowed to watch a channel that is not public
  const sign = (s) => crypto.createHmac('sha256', signKey()).update(s).digest('base64url').slice(0, 32);
  function token(slug, hours = 8) { const body = slug + '.' + (Date.now() + hours * 3600e3).toString(36); return body + '.' + sign(body); }
  function tokenOk(t, slug) {
    const p = String(t || '').split('.');
    if (p.length !== 3 || p[0] !== slug) return false;
    const exp = parseInt(p[1], 36);
    return exp > Date.now() && same(p[2], sign(p[0] + '.' + p[1]));
  }

  // ---- channels
  const cache = new Map();
  async function channel(slug) {
    if (!slug) return null;
    const hit = cache.get(slug);
    if (hit && hit.at > Date.now() - 5000) return hit.doc;
    const doc = (await app.store.find('channel', 'slug', slug)).find((d) => !d.deleted) || null;
    cache.set(slug, { doc, at: Date.now() });
    return doc;
  }
  app.on('doc', (doc) => { if (doc.type === 'channel') cache.clear(); });

  // Before a channel is saved: a clean, unique web address and a stream key the browser never chooses.
  async function prepare(team, id, d, cur) {
    d.slug = slugify(d.slug || d.name).slice(0, 40);
    if (!d.slug) fail(400, 'The channel needs a name or a web address');
    if (RESERVED.has(d.slug)) fail(400, `"${d.slug}" cannot be used as a web address. Choose another.`);
    const taken = (await app.store.find('channel', 'slug', d.slug)).find((x) => !x.deleted && x.id !== id);
    if (taken) fail(409, `Another channel already uses the web address /watch/${d.slug}. Choose another.`);
    if (!ACCESS.includes(d.access)) d.access = 'Public';
    if (d.access !== 'Password') d.viewerPassword = d.viewerPassword || '';
    if (d.access === 'Password' && !String(d.viewerPassword || '').trim()) fail(400, 'Type the password viewers need, or choose another "Who can watch"');
    d.streamKey = (cur && cur.data.streamKey) || newKey();
    return d;
  }
  async function newStreamKey(doc, userId) {
    return app.save(doc.team, 'channel', doc.id, { ...doc.data, streamKey: newKey() }, userId);
  }

  // ---- MediaMTX asks: may this camera publish / this viewer read?
  // body: { user, password, token, ip, action, path, protocol, id, query }
  async function allow(b) {
    const action = String(b.action || ''), slug = slugOfPath(b.path);
    if (action === 'api' || action === 'metrics' || action === 'pprof') return ['127.0.0.1', '::1'].includes(String(b.ip || ''));
    if (action !== 'publish' && action !== 'read') return false;
    const ch = await channel(slug);
    if (!ch || ch.data.disabled) return false;
    const q = new URLSearchParams(String(b.query || ''));
    const offered = [b.password, b.token, q.get('pass'), q.get('key'), q.get('token')].filter(Boolean).map(String);
    if (action === 'publish') return offered.some((k) => same(k, ch.data.streamKey));
    if (ch.data.access === 'Public') return true;
    return offered.some((t) => tokenOk(t, slug));
  }

  // ---- what MediaMTX is doing: live channels, viewers, bitrate
  const live = new Map();         // slug → { path, live, since, viewers, tracks, kbps, bytes, at }
  let timer = null, lastError = '', polled = 0;
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
        if (!prev || prev.live !== s.live || prev.viewers !== s.viewers) app.emit('stream', slug, view(slug, s));
        live.set(slug, s);
      }
      for (const slug of [...live.keys()]) if (!seen.has(slug)) { live.delete(slug); app.emit('stream', slug, view(slug, null)); }
      lastError = ''; polled = now;
    } catch (e) {
      if (lastError !== e.message) log('Streaming server:', e.message);
      lastError = e.message;
    }
  }
  const view = (slug, s) => ({ slug, live: !!(s && s.live), since: s ? s.since : 0, viewers: s ? s.viewers : 0, tracks: s ? s.tracks : [], kbps: s ? s.kbps : 0 });
  function start() { if (!timer && conf().api) { poll(); timer = setInterval(poll, 4000); timer.unref(); } }
  function stop() { clearInterval(timer); timer = null; }

  // ---- addresses
  const base = () => (app.config.publicUrl || '').replace(/\/+$/, '');
  function ingest(ch) {
    const c = conf(), host = c.host, key = ch.data.streamKey, slug = ch.data.slug;
    if (!host || !key) return null;
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

  // What the /watch page needs. Team members always watch; others as the channel says.
  async function watch(slug, user, password) {
    const ch = await channel(slugify(slug));
    if (!ch) fail(404, 'There is no channel at this address');
    const d = ch.data;
    const out = { name: d.name || d.slug, slug: d.slug, description: d.description || '', poster: d.poster || '', access: d.access || 'Public', streaming: enabled(), ...status(d.slug) };
    const member = user ? !!(await app.auth.roleIn(user, ch.team)) : false;
    let ok = d.access === 'Public' || member;
    if (!ok && d.access === 'Password' && password !== undefined) {
      if (!same(String(password).trim(), String(d.viewerPassword || '').trim())) fail(403, 'That password is not right');
      ok = true;
    }
    if (!ok) return { ...out, needs: d.access === 'Password' ? 'password' : user ? 'team' : 'signin' };
    return { ...out, needs: null, token: d.access === 'Public' ? '' : token(d.slug), ...players(d.slug) };
  }

  return { enabled, prepare, newStreamKey, allow, watch, ingest, status, players, token, tokenOk, start, stop, poll, health: () => ({ api: !!conf().api, lastError, polled }), ACCESS };
}

module.exports = { makeStreaming, slugOfPath, newKey };
