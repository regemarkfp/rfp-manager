'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../server');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-' + name + '-'));

async function boot(overrides = {}, opts = {}) {
  const dir = tmp(overrides.mode || 'local');
  const app = await start({ port: 0, dataDir: dir, access: 'any', caspar: { enabled: false }, defaultCloudUrl: '', standalone: true, ...overrides }, { configPath: path.join(dir, 'config.json'), quiet: true, ...opts });
  app.url = 'http://127.0.0.1:' + app.config.port;
  app.tmpDir = dir;
  return app;
}

// A tiny browser-like client: keeps the session cookie and sends the header the API expects.
function client(base) {
  const jar = new Map();
  const cookieStr = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const call = async (method, p, body, headers = {}) => {
    const h = { 'x-rfp': '1', ...headers };
    if (jar.size) h.cookie = cookieStr();
    let payload = body;
    if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const r = await fetch(base + p, { method, headers: h, body: payload });
    for (const sc of r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean)) {
      const [kv, ...attrs] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (!v || attrs.some((a) => /max-age=0/i.test(a))) jar.delete(k); else jar.set(k, v);
    }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, data, headers: r.headers };
  };
  return { get: (p, h) => call('GET', p, undefined, h), post: (p, b, h) => call('POST', p, b, h), put: (p, b, h) => call('PUT', p, b, h), del: (p) => call('DELETE', p), cookie: () => cookieStr() };
}

const assert = require('node:assert/strict');
// A small set of records to work with.
async function seed(c, team) {
  const put = async (type, id, data) => { const r = await c.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.doc; };
  await put('venue', 'venue_toyota', { name: 'Toyota Stadium', city: 'Bloemfontein', country: 'South Africa' });
  await put('competition', 'comp_cc', { name: 'Carling Currie Cup', sport: 'Rugby', season: '2026', primaryColor: '#000000', pointsWin: 4, pointsDraw: 2 });
  await put('player', 'player_ruan', { name: 'Ruan', surname: 'Osborne', dateOfBirth: '2001-02-25' });
  await put('club', 'club_che', { name: 'Toyota Cheetahs', graphicName: 'Cheetahs', abbreviation: 'CHE', primaryColor: '#ffffff', secondaryColor: '#ffa500' });
  await put('club', 'club_bul', { name: 'Vodacom Bulls', graphicName: 'Bulls', abbreviation: 'BUL', primaryColor: '#0000ff' });
  await put('squad', 'squad_che', { club: 'club_che', sport: 'Rugby', ageGroup: '19A', players: [{ number: '10', player: 'player_ruan', position: 'Flyhalf', captain: true }] });
  await put('squad', 'squad_bul', { club: 'club_bul', sport: 'Rugby', ageGroup: '19A' });
  return put('fixture', 'fixture_one', { sport: 'Rugby', competition: 'comp_cc', team1: 'squad_che', team2: 'squad_bul', startDate: '2026-10-10', startTime: '15:00', venue: 'venue_toyota' });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, label = 'condition') {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('Timed out waiting for ' + label); await sleep(40); }
}


// A live screen (scorer, control, output…) talking the same protocol as the pages under /live/.
async function liveClient(app, { cookie, key, fixture, role = 'stats' } = {}) {
  const q = new URLSearchParams();
  if (fixture) q.set('fixture', fixture);
  if (key) q.set('key', key);
  const ws = new WebSocket(app.url.replace('http', 'ws') + '/live/ws' + (q.toString() ? '?' + q : ''), cookie ? { headers: { cookie } } : undefined);
  const c = { got: [], state: null, catalog: [], ws };
  const pending = new Map();
  let n = 0;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    c.got.push(m);
    if (m.type === 'state') c.state = m;
    if (m.type === 'welcome') c.catalog = m.catalog;
    if (m.requestId && pending.has(m.requestId) && ['ack', 'error', 'gfxData'].includes(m.type)) { const p = pending.get(m.requestId); pending.delete(m.requestId); if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m); }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('live socket failed')); });
  ws.send(JSON.stringify({ type: 'hello', name: 'Test', role }));
  c.send = (type, action, data) => new Promise((resolve, reject) => { const requestId = String(++n); pending.set(requestId, { resolve, reject }); ws.send(JSON.stringify({ type, action, data: data || {}, requestId })); });
  c.close = () => ws.close();
  await until(() => c.state || c.got.find((m) => m.type === 'error'), 4000, 'live state');
  return c;
}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const net = require('node:net');
// A pretend CasparCG server: records every AMCP command and answers 202 OK.
async function fakeCaspar(t) {
  const got = [];
  const server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        got.push(line);
        if (line === 'VERSION') sock.write('201 VERSION OK\r\n2.4.0 Fake\r\n');
        else if (line.includes('missing/')) sock.write('404 CG ERROR\r\n');
        else sock.write('202 ' + line.split(' ')[0] + ' OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { got, port: server.address().port };
}
const payload = (cmd) => JSON.parse(JSON.parse('"' + cmd.slice(cmd.indexOf(' "{') + 2, -1) + '"'));


module.exports = { boot, client, sleep, until, tmp, seed, liveClient, PNG, fakeCaspar, payload };
