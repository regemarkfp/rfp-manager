'use strict';
// YouTube Live: a team connects its YouTube channel once (Google sign-in with the YouTube permission), then schedules
// broadcasts from the Studio. Each broadcast gets its own stream key; when it is for a production that streams through
// this website, a "YouTube" restream destination is added to the production (lib/restream.js), so the copy goes to
// YouTube while the production is live and YouTube starts and ends the broadcast by itself (auto start / stop).
// Without a production (vMix, OBS …) the server address and stream key are shown to paste there.
//
// Google needs the website's OAuth client: the same client ID as Google sign-in, and its client secret, which a site
// admin types in (Settings → Server → YouTube Live; kept in kv "ytlive:secret", never sent back to the browser).
// The channel's refresh token is kept per team in kv "ytlive:acct:<team>", also never sent to the browser.
const crypto = require('node:crypto');
const { fail, log } = require('./util');

const SCOPE = 'https://www.googleapis.com/auth/youtube';
const PRIVACY = ['public', 'unlisted', 'private'];

function makeYtLive(app) {
  const cfg = () => app.config;
  const authBase = () => cfg().ytOauthAuth || 'https://accounts.google.com/o/oauth2/v2/auth';
  const tokenUrl = () => cfg().ytOauthToken || 'https://oauth2.googleapis.com/token';
  const apiBase = () => (cfg().youtubeApi || 'https://www.googleapis.com/youtube/v3').replace(/\/+$/, '');
  const clientId = () => String((cfg().google && cfg().google.clientId) || app.cloudGoogleClientId || '');
  const secret = async () => String((await app.store.kvGet('ytlive:secret')) || '');
  const acctKey = (team) => 'ytlive:acct:' + team;
  const pending = new Map();                       // state → { team, userId, at, back }
  const tokens = new Map();                        // team → { token, until }

  async function serverView(base) {
    return { clientId: !!clientId(), hasSecret: !!(await secret()), redirectUri: String(base || '').replace(/\/+$/, '') + '/api/ytlive/callback' };
  }
  async function setSecret(v) {
    v = String(v || '').trim();
    if (v && !/^[\w-]{10,100}$/.test(v)) fail(400, 'That does not look like a client secret (Google Cloud → APIs & Services → Credentials → your OAuth client)');
    await app.store.kvSet('ytlive:secret', v);
    return { hasSecret: !!v };
  }

  // ---- connecting the channel
  async function connectUrl(team, user, base, back) {
    if (!clientId()) fail(400, 'Google sign-in is not set up on this website yet');
    if (!(await secret())) fail(400, 'A site admin first adds the Google client secret: Settings → Server → YouTube Live');
    const state = crypto.randomBytes(18).toString('base64url');
    for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60e3) pending.delete(k);
    pending.set(state, { team, userId: user.id, at: Date.now(), back: '#/youtube' });
    const q = new URLSearchParams({ client_id: clientId(), redirect_uri: base.replace(/\/+$/, '') + '/api/ytlive/callback', response_type: 'code', scope: SCOPE,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
    return { url: `${authBase()}?${q}` };
  }
  // Google sends the person back here with a code: swap it for tokens, find the channel, keep the refresh token
  async function callback(code, state, base, user) {
    const p = pending.get(String(state || ''));
    if (!p) fail(400, 'This YouTube connection link has expired. Press Connect again.');
    pending.delete(state);
    if (!user || user.id !== p.userId) fail(403, 'Sign in as the person who pressed Connect, then try again');
    const r = await fetch(tokenUrl(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ code: String(code || ''), client_id: clientId(), client_secret: await secret(), redirect_uri: base.replace(/\/+$/, '') + '/api/ytlive/callback', grant_type: 'authorization_code' }) }).catch(() => null);
    if (!r) fail(502, 'Could not reach Google');
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) fail(400, 'Google did not accept the connection: ' + (j.error_description || j.error || r.status));
    if (!j.refresh_token) fail(400, 'Google did not give a lasting permission. Remove RegemarkFP under myaccount.google.com → Security → Third-party connections, then Connect again.');
    tokens.set(p.team, { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3000) * 1000 - 60e3 });
    const ch = await call(p.team, 'GET', 'channels', { part: 'snippet', mine: 'true' }, null, j.access_token);
    const c = ch.items && ch.items[0];
    if (!c) fail(400, 'That Google account has no YouTube channel. Create the channel on YouTube first (and enable live streaming), then Connect again.');
    await app.store.kvSet(acctKey(p.team), { refresh: j.refresh_token, channelId: c.id, title: c.snippet.title, image: ((c.snippet.thumbnails || {}).default || {}).url || '', by: user.data.email, at: Date.now() });
    log(`YouTube Live: ${c.snippet.title} connected for ${p.team} by ${user.data.email}`);
    return { team: p.team, back: p.back };
  }
  async function status(team) {
    const a = await app.store.kvGet(acctKey(team));
    return a && a.refresh ? { connected: true, channel: { id: a.channelId, title: a.title, image: a.image }, by: a.by, at: a.at } : { connected: false };
  }
  async function disconnect(team) {
    const a = await app.store.kvGet(acctKey(team));
    if (a && a.refresh) fetch((cfg().ytOauthRevoke || 'https://oauth2.googleapis.com/revoke') + '?token=' + encodeURIComponent(a.refresh), { method: 'POST', signal: AbortSignal.timeout(8000) }).catch(() => {});
    await app.store.kvSet(acctKey(team), null);
    tokens.delete(team);
    return { connected: false };
  }

  async function accessToken(team) {
    const t = tokens.get(team);
    if (t && t.until > Date.now()) return t.token;
    const a = await app.store.kvGet(acctKey(team));
    if (!a || !a.refresh) fail(400, 'Connect your YouTube channel first (Streaming → YouTube Live)');
    const r = await fetch(tokenUrl(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: clientId(), client_secret: await secret(), refresh_token: a.refresh, grant_type: 'refresh_token' }) }).catch(() => null);
    if (!r) fail(502, 'Could not reach Google');
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      if (j.error === 'invalid_grant') { await app.store.kvSet(acctKey(team), { ...a, refresh: '' }); fail(400, 'The YouTube permission was withdrawn. Connect your YouTube channel again.'); }
      fail(502, 'Google: ' + (j.error_description || j.error || r.status));
    }
    tokens.set(team, { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3000) * 1000 - 60e3 });
    return j.access_token;
  }
  async function call(team, method, path, params, body, token) {
    const tk = token || await accessToken(team);
    const r = await fetch(`${apiBase()}/${path}?${new URLSearchParams(params || {})}`, { method, signal: AbortSignal.timeout(20000),
      headers: { authorization: 'Bearer ' + tk, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    if (!r) fail(502, 'Could not reach YouTube');
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reason = j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
      if (reason === 'liveStreamingNotEnabled') fail(400, 'Live streaming is not switched on for this YouTube channel yet: YouTube Studio → Create → Go live (it can take 24 hours the first time).');
      fail(r.status === 403 ? 403 : 400, 'YouTube: ' + ((j.error && j.error.message) || r.status));
    }
    return j;
  }

  // ---- broadcasts
  const shape = (b) => ({ id: b.id, title: b.snippet.title, description: b.snippet.description || '', start: b.snippet.scheduledStartTime || '', end: b.snippet.scheduledEndTime || '',
    privacy: (b.status || {}).privacyStatus || '', state: (b.status || {}).lifeCycleStatus || '', thumb: ((b.snippet.thumbnails || {}).medium || {}).url || '', url: 'https://www.youtube.com/watch?v=' + b.id, streamId: (b.contentDetails || {}).boundStreamId || '' });
  async function list(team) {
    const out = [];
    for (const st of ['upcoming', 'active']) {
      const j = await call(team, 'GET', 'liveBroadcasts', { part: 'snippet,status,contentDetails', broadcastStatus: st, broadcastType: 'all', maxResults: '50' });
      for (const b of j.items || []) out.push(shape(b));
    }
    // which production each one is for
    const prods = (await app.store.list(team, 'production')).filter((p) => !p.deleted && p.data.ytLive && p.data.ytLive.broadcastId);
    for (const b of out) { const p = prods.find((x) => x.data.ytLive.broadcastId === b.id); if (p) b.production = { id: p.id, name: p.data.name }; }
    return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }
  function clean(b, needStart) {
    const title = String(b.title || '').trim().slice(0, 100);
    if (!title) fail(400, 'Give the broadcast a title');
    const start = b.start ? new Date(b.start) : null;
    if (needStart && (!start || isNaN(start))) fail(400, 'Choose when it starts');
    if (start && start.getTime() < Date.now() - 5 * 60e3) fail(400, 'The start time has passed');
    const privacy = PRIVACY.includes(b.privacy) ? b.privacy : 'public';
    return { title: title.replace(/[<>]/g, ''), description: String(b.description || '').replace(/[<>]/g, '').slice(0, 4900), start: start ? start.toISOString() : '', privacy, kids: !!b.kids };
  }
  async function prodOf(team, id) {
    if (!id) return null;
    const p = await app.store.get(String(id));
    if (!p || p.deleted || p.type !== 'production' || p.team !== team) fail(404, 'Production not found');
    return p;
  }
  // schedule: the broadcast, its stream (key), bound together; with a production also its restream destination
  async function schedule(team, b, user) {
    const x = clean(b, true);
    const prod = await prodOf(team, b.production);
    if (prod && prod.data.ytLive && prod.data.ytLive.broadcastId) fail(409, 'This production already has a YouTube broadcast. Change or cancel that one.');
    const bc = await call(team, 'POST', 'liveBroadcasts', { part: 'snippet,status,contentDetails' }, {
      snippet: { title: x.title, description: x.description, scheduledStartTime: x.start },
      status: { privacyStatus: x.privacy, selfDeclaredMadeForKids: x.kids },
      contentDetails: { enableAutoStart: true, enableAutoStop: true, enableDvr: true, latencyPreference: 'normal', monitorStream: { enableMonitorStream: false } } });
    let stream;
    try {
      stream = await call(team, 'POST', 'liveStreams', { part: 'snippet,cdn,contentDetails' }, { snippet: { title: x.title.slice(0, 120) }, cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' }, contentDetails: { isReusable: false } });
      await call(team, 'POST', 'liveBroadcasts/bind', { id: bc.id, part: 'id,contentDetails', streamId: stream.id });
    } catch (e) { await call(team, 'DELETE', 'liveBroadcasts', { id: bc.id }).catch(() => {}); throw e; }
    const ing = stream.cdn.ingestionInfo || {};
    const out = { ...shape(bc), streamId: stream.id, server: ing.ingestionAddress || 'rtmp://a.rtmp.youtube.com/live2', key: ing.streamName || '' };
    if (prod) {
      const rows = (prod.data.streamRestream || []).filter((r) => r.ytBroadcast !== bc.id);
      rows.push({ name: 'YouTube: ' + x.title.slice(0, 40), url: out.server, key: out.key, on: true, fixture: '', ytBroadcast: bc.id });
      await app.save(team, 'production', prod.id, { ...prod.data, streamRestream: rows, ytLive: { broadcastId: bc.id, streamId: stream.id, url: out.url, start: x.start, privacy: x.privacy, title: x.title } }, user.id);
      out.production = { id: prod.id, name: prod.data.name };
    }
    log(`YouTube Live: "${x.title}" scheduled for ${x.start} by ${user.data.email}`);
    return out;
  }
  async function update(team, id, b) {
    const x = clean(b, false);
    const cur = (await call(team, 'GET', 'liveBroadcasts', { part: 'snippet,status', id })).items;
    if (!cur || !cur[0]) fail(404, 'YouTube does not know that broadcast any more');
    const sn = cur[0].snippet;
    const bc = await call(team, 'PUT', 'liveBroadcasts', { part: 'snippet,status' }, { id, snippet: { title: x.title, description: x.description, scheduledStartTime: x.start || sn.scheduledStartTime },
      status: { privacyStatus: x.privacy, selfDeclaredMadeForKids: x.kids } });
    const prod = (await app.store.list(team, 'production')).find((p) => !p.deleted && p.data.ytLive && p.data.ytLive.broadcastId === id);
    if (prod) await app.save(team, 'production', prod.id, { ...prod.data, ytLive: { ...prod.data.ytLive, start: x.start || prod.data.ytLive.start, privacy: x.privacy, title: x.title } }, '');
    return shape(bc);
  }
  // the key again (to paste into vMix / OBS): the stream bound to the broadcast
  async function keyOf(team, id) {
    const bc = (await call(team, 'GET', 'liveBroadcasts', { part: 'contentDetails', id })).items;
    const sid = bc && bc[0] && bc[0].contentDetails.boundStreamId;
    if (!sid) fail(404, 'This broadcast has no stream key');
    const s = (await call(team, 'GET', 'liveStreams', { part: 'cdn', id: sid })).items;
    const ing = (s && s[0] && s[0].cdn.ingestionInfo) || {};
    return { server: ing.ingestionAddress || '', key: ing.streamName || '' };
  }
  async function cancel(team, id, user) {
    const k = await keyOf(team, id).catch(() => ({ key: '' }));          // its restream row, also if the form dropped our marker
    await call(team, 'DELETE', 'liveBroadcasts', { id });
    const mine = (r) => r.ytBroadcast === id || (k.key && r.key === k.key);
    for (const p of (await app.store.list(team, 'production')).filter((q) => !q.deleted && ((q.data.ytLive && q.data.ytLive.broadcastId === id) || (q.data.streamRestream || []).some(mine)))) {
      const d = { ...p.data, streamRestream: (p.data.streamRestream || []).filter((r) => !mine(r)) };
      if (d.ytLive && d.ytLive.broadcastId === id) delete d.ytLive;
      await app.save(team, 'production', p.id, d, user.id);
    }
    return {};
  }

  return { serverView, setSecret, connectUrl, callback, status, disconnect, list, schedule, update, keyOf, cancel };
}

module.exports = { makeYtLive };
