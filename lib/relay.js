'use strict';
// Remote access through the website.
// A production PC keeps one outgoing WebSocket open to the online site (no port forwarding, works behind any router).
// The site passes requests from signed-in team members' browsers through it: the live pages' data and WebSocket
// (Graphics control, scorers, dashboards, Timeline, Worship, outputs, monitors), the PC's Connections and Templates
// settings, and adverts. The pages themselves are served by the site; only their data travels to the PC.
//
//  browser ──https──▶ website ──relay WebSocket (opened by the PC)──▶ PC ──▶ http://127.0.0.1:<port>/…
//
// On the PC a relayed request carries the person's email (checked by the website: Google sign-in + team membership)
// and a secret known only to this PC process, so nobody on the local network can pretend to come through the relay.
const crypto = require('node:crypto');
const { accept } = require('./ws');
const { readBody, send, parseCookies, clientIp } = require('./http');
const { log, fail } = require('./util');

const CHUNK = 192 * 1024;                     // bytes per frame (base64 grows it by a third; the WebSocket limit is 2 MB)
const MAX_BODY = 16 * 1024 * 1024;
const TIMEOUT = 45000;
const PASS_REQ = ['content-type', 'accept', 'accept-language', 'user-agent', 'x-rfp', 'range', 'if-none-match', 'if-modified-since'];
const PASS_RES = ['content-type', 'cache-control', 'content-disposition', 'location', 'etag', 'last-modified', 'content-security-policy', 'x-content-type-options'];

const pick = (h, keys) => { const o = {}; for (const k of keys) if (h[k] !== undefined && h[k] !== null) o[k] = String(h[k]); return o; };
function chunks(buf) { const out = []; for (let i = 0; i < buf.length; i += CHUNK) out.push(buf.subarray(i, i + CHUNK).toString('base64')); return out.length ? out : ['']; }

// ---------------------------------------------------------------------------------------------- the website
function makeRelayServer(app) {
  const machines = new Map();          // id → machine
  let seq = 0;

  const ofUser = async (user) => {
    if (!user) return [];
    const mine = new Set((await app.auth.teamsFor(user)).map((t) => t.id));
    return [...machines.values()].filter((m) => [...m.teams].some((t) => mine.has(t)));
  };
  const view = (m) => ({ id: m.id, name: m.name, version: m.version, since: m.since, online: true, onAir: (m.gfxState && m.gfxState.fixtureId) || '' });
  const list = async (user) => (await ofUser(user)).map(view).sort((a, b) => a.name.localeCompare(b.name));

  // Which PC a request is for: ?pc=… (screens opened with a key, e.g. an OBS browser source), else the PC this browser
  // chose (cookie), else the only PC of the person's teams that is online. "none" = use the website itself.
  async function choose(req, user) {
    const q = new URL(req.url, 'http://x').searchParams.get('pc');
    const want = q || parseCookies(req).rfp_pc || '';
    if (want === 'none') return null;
    if (want) return machines.get(want) || { id: want, offline: true, name: '' };
    if (!user) return null;
    const mine = await ofUser(user);
    return mine.length === 1 ? mine[0] : null;
  }
  // A PC picked for this browser without asking (the only one online) is remembered, so its screens keep waiting for it
  // when it goes offline instead of quietly switching to the website's own engine.
  function remember(req, res, m) {
    if (!m || m.offline || res.headersSent) return;
    if (new URL(req.url, 'http://x').searchParams.get('pc') || parseCookies(req).rfp_pc) return;
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `rfp_pc=${encodeURIComponent(m.id)}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`);
  }
  async function allowedFor(user, m) { return !!user && (await ofUser(user)).includes(m); }

  // ---- the PC's link
  async function upgrade(req, sock) {
    const ws = accept(req, sock);
    if (!ws) return;
    let m = null;
    const timer = setTimeout(() => { if (!m) ws.close(); }, 15000);
    ws.on('message', async (text) => {
      let msg; try { msg = JSON.parse(text); } catch { return; }
      if (!m) {
        if (msg.t !== 'hello') return ws.close();
        const k = await app.auth.keyUser(msg.key).catch(() => null);
        if (!k) { ws.send({ t: 'err', error: 'This machine key is not recognised by the website. Link the PC again.' }); return setTimeout(() => ws.close(), 100); }
        clearTimeout(timer);
        // one entry per PC: the key, plus the PC's own id (two PCs sharing a key stay two PCs)
        const id = k.keyDoc.id + (/^[\w-]{4,40}$/.test(msg.machineId || '') ? '.' + msg.machineId : '');
        const old = machines.get(id);
        if (old) { try { old.ws.close(); } catch { /* ignore */ } }
        m = { id, ws, owner: k.user, teams: new Set(await app.syncServer.scope(k.user)), name: String(msg.name || k.keyDoc.data.name || 'Production PC').slice(0, 60), version: String(msg.version || ''), since: Date.now(), pending: new Map(), sockets: new Map(), gfxState: null };
        machines.set(m.id, m);
        ws.send({ t: 'ok', id: m.id });
        log(`Production PC online: ${m.name} (${m.version})`);
        app.emit('relay', { id: m.id, online: true });
        return;
      }
      onPcMessage(m, msg);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (!m || machines.get(m.id) !== m) return;
      machines.delete(m.id);
      for (const p of m.pending.values()) p.fail(new Error('The production PC went offline'));
      for (const s of m.sockets.values()) { try { s.send({ type: 'error', message: `The production PC "${m.name}" went offline.`, code: 'OFFLINE' }); s.close(); } catch { /* ignore */ } }
      log(`Production PC offline: ${m.name}`);
      app.emit('relay', { id: m.id, online: false });
    });
  }
  // members change → which teams a PC serves
  app.on('doc', (doc) => { if (doc.type === 'member') for (const m of machines.values()) app.syncServer.scope(m.owner).then((s) => { m.teams = new Set(s); }).catch(() => {}); });

  function onPcMessage(m, msg) {
    if (msg.t === 'gfx') { m.gfxState = msg.state || null; app.emit('relay-gfx', m.id, m.gfxState); return; }
    if (msg.t === 'ping') { m.ws.send({ t: 'pong' }); return; }
    const p = m.pending.get(msg.id);
    if (p) { p.on(msg); return; }
    const s = m.sockets.get(msg.id);
    if (!s) return;
    if (msg.t === 'wsmsg') s.send(String(msg.data));
    else if (msg.t === 'wsclose') { m.sockets.delete(msg.id); s.close(); }
  }

  // One request through the PC: resolves { status, headers, body }.
  function request(m, { method = 'GET', path = '/', headers = {}, body = Buffer.alloc(0), user = null, ip = '' }) {
    if (!m || m.offline || machines.get(m.id) !== m) return Promise.reject(Object.assign(new Error('The production PC is offline'), { status: 503 }));
    const id = 'r' + (++seq);
    const h = { ...pick(headers, PASS_REQ) };
    if (user) h['x-rfp-relay-user'] = user.data.email;
    if (ip) h['x-rfp-relay-ip'] = ip;
    return new Promise((resolve, reject) => {
      const parts = []; let head = null;
      const done = (fn, v) => { clearTimeout(t); m.pending.delete(id); fn(v); };
      const t = setTimeout(() => done(reject, Object.assign(new Error('The production PC did not answer in time'), { status: 504 })), TIMEOUT);
      m.pending.set(id, {
        fail: (e) => done(reject, Object.assign(e, { status: 502 })),
        on: (msg) => {
          if (msg.t === 'res') head = msg;
          if (msg.t === 'res' || msg.t === 'body') parts.push(Buffer.from(String(msg.data || ''), 'base64'));
          if (msg.t === 'err') return done(reject, Object.assign(new Error(msg.error || 'The production PC could not answer'), { status: 502 }));
          if ((msg.t === 'res' || msg.t === 'body') && !msg.more) done(resolve, { status: head.status, headers: head.headers || {}, body: Buffer.concat(parts) });
        },
      });
      const cs = chunks(body);
      cs.forEach((data, i) => m.ws.send(i === 0 ? { t: 'req', id, method, path, headers: h, data, more: cs.length > 1 } : { t: 'body', id, data, more: i < cs.length - 1 }));
    });
  }

  async function http(req, res, m, user) {
    if (!m || m.offline) return send(res, 503, { error: `The production PC${m && m.name ? ' "' + m.name + '"' : ''} is offline. Start RFP Manager on it (and check it is linked to the website).`, code: 'PC_OFFLINE' });
    if (user && !(await allowedFor(user, m))) return send(res, 403, { error: 'You are not in a production team that uses this PC' });
    const body = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readBody(req, MAX_BODY);
    const u = new URL(req.url, 'http://x'); u.searchParams.delete('pc');
    try {
      const r = await request(m, { method: req.method, path: u.pathname + u.search, headers: req.headers, body, user, ip: clientIp(req, true) });
      if (user) remember(req, res, m);
      send(res, r.status, r.body, pick(r.headers, PASS_RES));
    } catch (e) { send(res, e.status || 502, { error: e.message, code: 'PC_OFFLINE' }); }
  }

  // A browser WebSocket (a live page) to the PC.
  async function socket(req, sock, m, user) {
    const ws = accept(req, sock);
    if (!ws) return;
    const bail = (message, code) => { ws.send({ type: 'error', message, code: code || 'AUTH' }); setTimeout(() => ws.close(), 200); };
    if (!m || m.offline) return bail(`The production PC${m && m.name ? ' "' + m.name + '"' : ''} is offline. Start RFP Manager on it and check its internet connection.`, 'OFFLINE');
    if (user && !(await allowedFor(user, m))) return bail('You are not in a production team that uses this PC.');
    const id = 's' + (++seq);
    const u = new URL(req.url, 'http://x'); u.searchParams.delete('pc');
    const h = { ...pick(req.headers, ['user-agent']), 'x-rfp-relay-ip': clientIp(req, true) };
    if (user) h['x-rfp-relay-user'] = user.data.email;
    m.sockets.set(id, ws);
    m.ws.send({ t: 'wsopen', id, path: u.pathname + u.search, headers: h });
    ws.on('message', (text) => { if (machines.get(m.id) === m) m.ws.send({ t: 'wsmsg', id, data: text }); });
    ws.on('close', () => { if (m.sockets.delete(id) && machines.get(m.id) === m) m.ws.send({ t: 'wsclose', id }); });
  }

  const beat = setInterval(() => { for (const m of machines.values()) { if (!m.ws.alive) { m.ws.close(); continue; } m.ws.alive = false; m.ws.ping(); } }, 30000);
  beat.unref();

  // ---- linking a PC by signing in (no keys to copy): the PC asks for a code, a team Admin approves it on the website
  const pairs = new Map();             // code → { secret, name, at, key }
  const sweep = () => { for (const [c, p] of pairs) if (Date.now() - p.at > 15 * 60000) pairs.delete(c); };
  function pairStart(name) {
    sweep();
    if (pairs.size > 500) fail(429, 'Too many link requests. Try again in a few minutes.');
    const code = Array.from(crypto.randomBytes(8), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('').replace(/(.{4})(.{4})/, '$1-$2');
    const secret = crypto.randomBytes(24).toString('base64url');
    pairs.set(code, { secret, name: String(name || 'Production PC').slice(0, 60), at: Date.now(), key: '', by: '' });
    return { code, secret };
  }
  const pairInfo = (code) => { sweep(); const p = pairs.get(String(code || '').toUpperCase()); if (!p) fail(404, 'That link code has expired. Start again on the PC.'); return { name: p.name, approved: !!p.key, by: p.by }; };
  async function pairApprove(user, code) {
    sweep();
    const p = pairs.get(String(code || '').toUpperCase());
    if (!p) fail(404, 'That link code has expired. Start again on the PC.');
    if (!(await app.auth.teamsFor(user)).some((t) => t.role === 'Admin')) fail(403, 'Only an Admin of a production team can link a PC');
    if (!p.key) { p.key = (await app.auth.createKey(user, p.name)).key; p.by = user.data.email; }
    return { name: p.name };
  }
  function pairPoll(code, secret) {
    const p = pairs.get(String(code || '').toUpperCase());
    if (!p || p.secret !== secret) fail(404, 'That link code has expired. Start again on the PC.');
    if (!p.key) return { waiting: true };
    pairs.delete(String(code).toUpperCase());
    return { key: p.key, by: p.by };
  }

  return { upgrade, http, socket, request, choose, remember, list, allowedFor, machines, pairStart, pairInfo, pairApprove, pairPoll, close: () => { clearInterval(beat); for (const m of machines.values()) m.ws.close(); } };
}

// ---------------------------------------------------------------------------------------------- the production PC
function makeRelayClient(app) {
  const secret = crypto.randomBytes(24).toString('base64url');
  const st = { on: false, connected: false, lastError: '', since: 0 };
  let ws = null, timer = null, wait = 3000, stopped = true, gfxTimer = null;
  const reqs = new Map(), socks = new Map();

  const cfg = () => app.config.cloud || {};
  const base = () => String(cfg().url || '').replace(/\/+$/, '');
  const enabled = () => !!(base() && cfg().key && app.config.remote !== false && typeof WebSocket !== 'undefined');
  const local = () => 'http://127.0.0.1:' + app.config.port;
  const out = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

  // Is this request one that came through the relay? undefined = no; otherwise { email, ip } (email '' = no person, a keyed screen)
  function identity(req) {
    if (req.headers['x-rfp-relay'] !== secret) return undefined;
    return { email: String(req.headers['x-rfp-relay-user'] || ''), ip: String(req.headers['x-rfp-relay-ip'] || '') };
  }

  async function doRequest(r) {
    try {
      const headers = { ...r.headers, 'x-rfp-relay': secret };
      const body = r.method === 'GET' || r.method === 'HEAD' ? undefined : Buffer.concat(r.parts);
      const res = await fetch(local() + r.path, { method: r.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(40000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const h = {}; res.headers.forEach((v, k) => { if (PASS_RES.includes(k)) h[k] = v; });
      const cs = chunks(buf);
      cs.forEach((data, i) => out(i === 0 ? { t: 'res', id: r.id, status: res.status, headers: h, data, more: cs.length > 1 } : { t: 'body', id: r.id, data, more: i < cs.length - 1 }));
    } catch (e) { out({ t: 'err', id: r.id, error: e.message }); }
  }

  function openSocket(msg) {
    let s;
    try { s = new WebSocket(local().replace('http', 'ws') + msg.path, { headers: { ...msg.headers, 'x-rfp-relay': secret } }); } catch (e) { out({ t: 'wsclose', id: msg.id }); return; }
    const entry = { s, queue: [] };
    socks.set(msg.id, entry);
    s.onopen = () => { for (const d of entry.queue) s.send(d); entry.queue = []; };
    s.onmessage = (ev) => out({ t: 'wsmsg', id: msg.id, data: String(ev.data) });
    s.onclose = () => { if (socks.delete(msg.id)) out({ t: 'wsclose', id: msg.id }); };
    s.onerror = () => { /* onclose follows */ };
  }

  function onMessage(text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.t === 'ok') { st.connected = true; st.lastError = ''; st.since = Date.now(); wait = 3000; log('Remote access: online through ' + base()); sendGfx(); return; }
    if (m.t === 'err' && !m.id) { st.lastError = m.error || 'refused'; log('Remote access: ' + st.lastError); return; }
    if (m.t === 'req') { const r = { id: m.id, method: m.method, path: m.path, headers: m.headers || {}, parts: [Buffer.from(m.data || '', 'base64')] }; if (m.more) reqs.set(m.id, r); else doRequest(r); return; }
    if (m.t === 'body') { const r = reqs.get(m.id); if (!r) return; r.parts.push(Buffer.from(m.data || '', 'base64')); if (!m.more) { reqs.delete(m.id); doRequest(r); } return; }
    if (m.t === 'wsopen') return openSocket(m);
    if (m.t === 'wsmsg') { const e = socks.get(m.id); if (!e) return; if (e.s.readyState === 1) e.s.send(String(m.data)); else e.queue.push(String(m.data)); return; }
    if (m.t === 'wsclose') { const e = socks.get(m.id); if (e) { socks.delete(m.id); try { e.s.close(); } catch { /* ignore */ } } }
  }

  // what is on air, for the website's Adverts screen
  function gfxState() { const g = app.gfx; return g ? { onAir: g.onAirList(), playlist: g.playlistState(), caspar: g.casparState(), fixtureId: g.fixtureId || '' } : null; }
  function sendGfx() { clearTimeout(gfxTimer); gfxTimer = setTimeout(() => out({ t: 'gfx', state: gfxState() }), 100); }
  if (app.gfx) app.gfx.onMessage((msg) => { if (msg.type === 'changed' || msg.type === 'fixture' || msg.type === 'output') sendGfx(); });

  function connect() {
    clearTimeout(timer);
    if (stopped || !enabled()) { st.on = false; return; }
    st.on = true;
    let s;
    try { s = new WebSocket(base().replace(/^http/, 'ws') + '/relay'); } catch (e) { st.lastError = e.message; timer = setTimeout(connect, wait); return; }
    ws = s;
    s.onopen = () => out({ t: 'hello', key: cfg().key, machineId: app.config.machineId || '', name: app.config.machineName || require('node:os').hostname(), version: app.version, port: app.config.port });
    s.onmessage = (ev) => onMessage(String(ev.data));
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      if (st.connected) log('Remote access: link to the website lost, trying again');
      st.connected = false;
      for (const e of socks.values()) { try { e.s.close(); } catch { /* ignore */ } }
      socks.clear(); reqs.clear();
      if (!stopped) { timer = setTimeout(connect, wait); wait = Math.min(30000, wait * 2); }
    };
    s.onerror = () => { /* onclose follows */ };
  }
  const ping = setInterval(() => out({ t: 'ping' }), 25000);
  ping.unref();

  function start() { stopped = false; wait = 3000; if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; } connect(); }
  function stop() { stopped = true; clearTimeout(timer); st.on = false; st.connected = false; if (ws) { const s = ws; ws = null; try { s.close(); } catch { /* ignore */ } } }
  const status = () => ({ ...st, enabled: app.config.remote !== false, url: base() });

  return { start, stop, status, identity, close: () => { stop(); clearInterval(ping); } };
}

module.exports = { makeRelayServer, makeRelayClient };
