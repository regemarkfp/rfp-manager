'use strict';
// Push notifications, on the website, for the RFP Manager apps:
//  · Android: Firebase Cloud Messaging (FCM). The site admin uploads the Firebase files once (Settings → Server):
//    the service account (to send) and google-services.json (the app reads the public part from /api/push/android-config).
//  · Windows: the production PC keeps one connection to the website (GET /api/push/stream with its machine key) and
//    shows the notifications of the people who signed in on it as Windows notifications.
//  · Every notification is also kept in the person's inbox ("notification" records), shown in the apps and the Studio.
// Who gets what is up to each person: Settings → Notifications (user.data.pushPrefs), with quiet hours.
const crypto = require('node:crypto');
const { newId, log, sha } = require('./util');

// what a person can switch on or off; [key, group, label, default]
const EVENTS = [
  ['stream_live', 'Streams', 'A stream goes live (yours, and channels you follow)', true],
  ['stream_ended', 'Streams', 'A stream of your team ends', true],
  ['stream_dropped', 'Streams', 'A stream of your team drops (signal lost)', true],
  ['restream_failed', 'Streams', 'A restream to YouTube / Facebook … stops', true],
  ['team_added', 'Crew & bookings', 'You are added to a production team', true],
  ['production_new', 'Crew & bookings', 'A new production is on the calendar', true],
  ['production_changed', 'Crew & bookings', 'The date, time or venue of your production changes', true],
  ['crew_hired', 'Crew & bookings', 'You are hired on a production', true],
  ['callsheet', 'Crew & bookings', 'A call sheet is sent to you', true],
  ['reminder', 'Crew & bookings', 'Reminder the day before your production', true],
  ['booking', 'Crew & bookings', 'Booking requests (new, allocated to you, accepted or declined)', true],
  ['expense', 'Crew & bookings', 'Expenses to approve, and yours approved or rejected', true],
  ['match_moments', 'Matches', 'Key moments: tries, goals, wickets, half and full time', true],
  ['match_result', 'Matches', 'Results confirmed by the officials', true],
  ['chat', 'Chat & sales', 'New live-chat messages on your streams', true],
  ['sales', 'Chat & sales', 'Tickets and passes sold', true],
];
const CHANNELS = { Streams: 'streams', 'Crew & bookings': 'crew', Matches: 'matches', 'Chat & sales': 'chat' };
const groupOf = (kind) => (EVENTS.find((e) => e[0] === kind) || [])[1] || 'Streams';
const defaults = () => Object.fromEntries(EVENTS.map((e) => [e[0], e[3]]));

function makePush(app) {
  const streams = new Map();        // machine key hash → Set of SSE responses (Windows PCs)
  let cfgCache = null, tokenCache = null;

  // ---- settings
  async function config() { if (!cfgCache) cfgCache = (await app.store.kvGet('push:config').catch(() => null)) || {}; return cfgCache; }
  async function setConfig({ serviceAccount, googleServices } = {}) {
    const cur = { ...(await config()) };
    if (serviceAccount !== undefined) {
      if (!serviceAccount) delete cur.serviceAccount;
      else {
        let sa; try { sa = typeof serviceAccount === 'string' ? JSON.parse(serviceAccount) : serviceAccount; } catch { throw Object.assign(new Error('That is not the service-account JSON file'), { status: 400 }); }
        if (!sa.client_email || !sa.private_key || !sa.project_id) throw Object.assign(new Error('The file needs project_id, client_email and private_key (Firebase → Project settings → Service accounts → Generate new private key)'), { status: 400 });
        cur.serviceAccount = { project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key };
      }
    }
    if (googleServices !== undefined) {
      if (!googleServices) delete cur.android;
      else {
        let g; try { g = typeof googleServices === 'string' ? JSON.parse(googleServices) : googleServices; } catch { throw Object.assign(new Error('That is not google-services.json'), { status: 400 }); }
        const client = (g.client || []).find((c) => c.client_info && c.client_info.android_client_info && c.client_info.android_client_info.package_name === 'com.regemarkfp.rfpmanager') || (g.client || [])[0];
        const key = client && (client.api_key || [])[0];
        if (!g.project_info || !client || !key) throw Object.assign(new Error('google-services.json has no Android app in it (add the Android app com.regemarkfp.rfpmanager in Firebase)'), { status: 400 });
        cur.android = { apiKey: key.current_key, appId: client.client_info.mobilesdk_app_id, projectId: g.project_info.project_id, senderId: g.project_info.project_number, storageBucket: g.project_info.storage_bucket || '' };
      }
    }
    await app.store.kvSet('push:config', cur);
    cfgCache = cur; tokenCache = null;
    return status();
  }
  async function status() {
    const c = await config();
    return { fcm: !!c.serviceAccount, android: !!c.android, project: (c.serviceAccount || c.android || {}).project_id || (c.android || {}).projectId || '', windows: streams.size };
  }
  // the public part the Android app needs to start Firebase
  async function androidConfig() { const c = await config(); return c.android || {}; }

  // ---- FCM (HTTP v1): a service-account token, then one message per device
  const b64u = (x) => Buffer.from(x).toString('base64url');
  // (the addresses can be changed for tests)
  const tokenUrl = () => (app.config.push && app.config.push.tokenUrl) || 'https://oauth2.googleapis.com/token';
  const fcmBase = () => ((app.config.push && app.config.push.fcmBase) || 'https://fcm.googleapis.com').replace(/\/+$/, '');
  async function accessToken() {
    if (tokenCache && tokenCache.exp > Date.now() + 60e3) return tokenCache.token;
    const sa = (await config()).serviceAccount;
    if (!sa) return null;
    const now = Math.floor(Date.now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key).toString('base64url');
    const r = await fetch(tokenUrl(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error('Firebase sign-in failed: ' + (j.error_description || j.error || r.status));
    tokenCache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return tokenCache.token;
  }
  async function fcmSend(device, n) {
    const sa = (await config()).serviceAccount;
    const token = await accessToken();
    if (!sa || !token) return false;
    const data = { title: n.title, body: n.body || '', url: n.url || '', kind: n.kind, channel: CHANNELS[groupOf(n.kind)] || 'streams', id: n.id || '', tag: n.tag || '' };
    const r = await fetch(`${fcmBase()}/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: device.data.token, data, android: { priority: 'HIGH', ttl: '86400s' } } }), signal: AbortSignal.timeout(15000) });
    if (r.ok) return true;
    const j = await r.json().catch(() => ({}));
    const code = JSON.stringify(j.error || {});
    // the app was removed, or the token renewed: forget this device
    if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*registration/i.test(code)) await removeDevice(device).catch(() => {});
    else log('Push (Android):', r.status, (j.error && j.error.message) || '');
    return false;
  }

  // ---- devices ("pushdevice" records { user, platform, token | machine, name, at })
  const deviceId = (platform, key) => 'pd_' + sha(platform + ':' + key).slice(0, 24);
  async function register(user, { platform, token, name, machine }) {
    if (platform === 'android') {
      if (!/^[\w:.-]{20,4096}$/.test(String(token || ''))) throw Object.assign(new Error('No push token'), { status: 400 });
      const id = deviceId('android', token);
      // one app install = one person: a token used by someone else before moves to this person
      const doc = await app.save('', 'pushdevice', id, { user: user.id, platform, token: String(token), name: String(name || 'Android').slice(0, 60), at: Date.now() }, user.id);
      return doc;
    }
    if (platform === 'windows') {
      const id = deviceId('windows', machine + ':' + user.id);
      return app.save('', 'pushdevice', id, { user: user.id, platform, machine, name: String(name || 'Windows PC').slice(0, 60), at: Date.now() }, user.id);
    }
    throw Object.assign(new Error('Unknown device'), { status: 400 });
  }
  async function removeDevice(doc) { if (doc && !doc.deleted) await app.put({ ...doc, deleted: true, updatedAt: Math.max(Date.now(), doc.updatedAt + 1) }); }
  async function devicesOf(userId) { return (await app.store.find('pushdevice', 'user', userId)).filter((d) => !d.deleted); }

  // ---- the person's choices
  const prefsOf = (u) => ({ ...defaults(), ...((u && u.data.pushPrefs) || {}) });
  function quiet(u, now = new Date()) {
    const q = (u && u.data.pushPrefs && u.data.pushPrefs.quiet) || null;
    if (!q || !q.on || !/^\d\d:\d\d$/.test(q.from || '') || !/^\d\d:\d\d$/.test(q.to || '')) return false;
    const tz = app.config.timezone || 'Africa/Johannesburg';
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    return q.from <= q.to ? hm >= q.from && hm < q.to : hm >= q.from || hm < q.to;
  }

  // ---- sending: to people (user records, ids or emails); kept in their inbox, pushed to their devices
  const recent = new Map();          // tag → when (no repeats within a minute)
  async function usersOf(list) {
    const out = new Map();
    for (const x of list || []) {
      if (!x) continue;
      let u = typeof x === 'object' && x.data ? x : null;
      if (!u && /^usr_/.test(String(x))) u = await app.store.get(String(x));
      if (!u && String(x).includes('@')) u = await app.auth.userByEmail(String(x)).catch(() => null);
      if (u && !u.deleted && u.type === 'user') out.set(u.id, u);
    }
    return [...out.values()];
  }
  async function send(to, n, { except } = {}) {
    if (app.isLocal) return 0;
    if (n.tag) { const k = n.tag; if ((recent.get(k) || 0) > Date.now() - 60e3) return 0; recent.set(k, Date.now()); if (recent.size > 5000) recent.clear(); }
    const people = (await usersOf(to)).filter((u) => !except || (u.id !== except && u.data.email !== except));
    let pushed = 0;
    for (const u of people) {
      if (!prefsOf(u)[n.kind]) continue;
      const doc = await app.save('', 'notification', newId('ntf_'), { user: u.id, kind: n.kind, title: String(n.title).slice(0, 120), body: String(n.body || '').slice(0, 300), url: n.url || '', at: Date.now(), read: false }, '');
      if (quiet(u)) continue;
      const item = { ...n, id: doc.id };
      for (const d of await devicesOf(u.id)) {
        try {
          if (d.data.platform === 'android') { if (await fcmSend(d, item)) pushed++; }
          else if (d.data.platform === 'windows') { if (toMachine(d.data.machine, { ...item, user: u.data.email })) pushed++; }
        } catch (e) { log('Push:', e.message); }
      }
    }
    prune(people).catch(() => {});
    return pushed;
  }
  // an inbox keeps the last 200
  async function prune(people) {
    for (const u of people) {
      const list = (await app.store.find('notification', 'user', u.id)).filter((d) => !d.deleted).sort((a, b) => b.data.at - a.data.at);
      for (const d of list.slice(200)) await app.put({ ...d, deleted: true, updatedAt: Date.now() });
    }
  }
  async function inbox(user, limit = 60) {
    const list = (await app.store.find('notification', 'user', user.id)).filter((d) => !d.deleted).sort((a, b) => b.data.at - a.data.at);
    return { unread: list.filter((d) => !d.data.read).length, list: list.slice(0, limit).map((d) => ({ id: d.id, ...d.data })) };
  }
  async function markRead(user, ids) {
    const list = (await app.store.find('notification', 'user', user.id)).filter((d) => !d.deleted && !d.data.read && (ids === 'all' || (ids || []).includes(d.id)));
    for (const d of list) await app.save('', 'notification', d.id, { ...d.data, read: true }, user.id);
    return { read: list.length };
  }

  // ---- Windows PCs: a server-sent event stream per machine key
  function toMachine(machine, item) {
    const set = streams.get(machine);
    if (!set || !set.size) return false;
    for (const res of set) { try { res.write(`event: notify\ndata: ${JSON.stringify(item)}\n\n`); } catch { /* closed */ } }
    return true;
  }
  function stream(req, res, machine) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': connected\n\n');
    if (!streams.has(machine)) streams.set(machine, new Set());
    streams.get(machine).add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
    const done = () => { clearInterval(ping); const s = streams.get(machine); if (s) { s.delete(res); if (!s.size) streams.delete(machine); } };
    req.on('close', done); res.on('close', done);
  }

  return { EVENTS, CHANNELS, defaults, prefsOf, quiet, config: status, setConfig, androidConfig, register, removeDevice, devicesOf, send, inbox, markRead, stream, deviceId, toMachine, accessToken };
}

module.exports = { makePush, EVENTS };
