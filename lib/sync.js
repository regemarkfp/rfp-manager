'use strict';
// Keeps a production PC (SQLite + image folder) and the online site (MongoDB) in step.
//  - push: records changed on this machine go up        - pull: records changed online come down
//  - images: uploaded with their record, and downloaded into this machine's image folder
// Newest change wins. A match should be scored from one place at a time.
const Schema = require('../shared/schema');
const { stable, log, fail } = require('./util');
const { safeFile } = require('./blobs');
const { normEmail } = require('./auth');

async function applyRemote(app, incoming, { fromSite = false } = {}) {
  const store = app.store;
  const cur = await store.get(incoming.id);
  if (!cur) { await app.put(incoming, { dirty: false }); return 'applied'; }
  // a record never changes team when a machine sends it; the website may move it (two teams merged into one)
  if (cur.type !== incoming.type || (cur.team !== incoming.team && !fromSite)) return 'rejected';
  if (incoming.updatedAt > cur.updatedAt || (incoming.updatedAt === cur.updatedAt && stable(incoming) > stable({ ...cur, seq: incoming.seq }))) {
    await app.put(incoming, { dirty: false });
    return 'applied';
  }
  return 'stale';
}

const cleanDoc = (d) => {
  if (!d || typeof d.id !== 'string' || !/^[\w-]{4,80}$/.test(d.id) || !Schema.ALL_TYPES.includes(d.type) || typeof d.data !== 'object' || !d.data || Array.isArray(d.data)) return null;
  if (!Number.isFinite(d.updatedAt)) return null;
  if (d.type === 'image' && !d.deleted && !safeFile(d.data.file)) return null;
  return { id: d.id, team: String(d.team || ''), type: d.type, data: d.data, updatedAt: Math.min(d.updatedAt, Date.now() + 60000), updatedBy: String(d.updatedBy || ''), deleted: !!d.deleted };
};

// ---------------------------------------------------------------------------------------------
// Server side (the online site, or any instance another machine links to)
function makeSyncServer(app) {
  async function scope(user) {
    return (await app.auth.teamsFor(user)).filter((t) => t.role === 'Admin').map((t) => t.id);
  }

  async function usersForMembers(memberDocs) {
    const out = [];
    for (const m of memberDocs) {
      if (m.deleted || !m.data.email) continue;
      const u = await app.auth.userByEmail(m.data.email);
      if (u) out.push(u);
    }
    return out;
  }

  async function pull(user, body) {
    const teams = await scope(user);
    const known = new Set(Array.isArray(body.teams) ? body.teams : []);
    const since = Number(body.since) || 0;
    let docs = await app.store.changes(since, teams, 400);
    const more = docs.length === 400;
    const seq = docs.length ? docs[docs.length - 1].seq : Math.max(since, more ? since : await app.store.currentSeq());
    // A team this machine has never seen (new membership): send all of it.
    for (const t of teams) if (!known.has(t) && since > 0) docs = docs.concat((await app.store.changes(0, [t], 5000)).filter((d) => d.seq <= since));
    const users = await usersForMembers(docs.filter((d) => d.type === 'member'));
    const seen = new Set();
    docs = [...docs, ...users].filter((d) => (seen.has(d.id) ? false : seen.add(d.id)));
    return { docs, seq, more, teams, googleClientId: app.config.google.clientId || '' };
  }

  async function push(user, body) {
    const teams = new Set(await scope(user));
    const email = normEmail(user.data.email);
    const results = {};
    const list = (Array.isArray(body.docs) ? body.docs : []).slice(0, 500);
    // Teams created offline on the machine: the first push claims them for the key's owner.
    for (const raw of list) {
      if (raw && raw.type === 'org' && raw.id === raw.team && !teams.has(raw.team) && !(await app.store.teamExists(raw.team)) && !(await app.store.get(raw.team))) {   // (a team merged away stays gone)
        const mine = list.some((m) => m && m.type === 'member' && m.team === raw.team && normEmail(m.data && m.data.email) === email && m.data.role === 'Admin' && !m.deleted);
        if (mine) teams.add(raw.team);
      }
    }
    for (const raw of list) {
      const d = cleanDoc(raw);
      if (!d) { if (raw && raw.id) results[raw.id] = 'rejected'; continue; }
      if (d.type === 'machinekey') { results[d.id] = 'rejected'; continue; }
      if (d.type === 'user') {
        // Accounts are owned by the online site; a machine may only add one that does not exist yet.
        const exists = await app.store.get(d.id);
        if (exists || d.team !== '') { results[d.id] = 'skipped'; continue; }
        // Passwords set on a production PC stay on that PC; online, people sign in with Google.
        const { passwordHash, ...safe } = d.data;
        await app.put({ ...d, data: safe }, { dirty: false }); results[d.id] = 'applied'; continue;
      }
      if (!teams.has(d.team)) { results[d.id] = 'rejected'; continue; }
      if (d.type === 'image' && !d.deleted && !(await app.blobs.has(d))) { results[d.id] = 'need-image'; continue; }
      results[d.id] = await applyRemote(app, d);
    }
    return { results };
  }

  async function blobAccess(user, id) {
    const doc = await app.store.get(id);
    if (!doc || doc.type !== 'image') fail(404, 'Image not found');
    if (!(await scope(user)).includes(doc.team)) fail(403, 'No access');
    return doc;
  }

  return { pull, push, scope, blobAccess };
}

// ---------------------------------------------------------------------------------------------
// Client side (the production PC)
function makeSyncClient(app) {
  const st = { linked: false, running: false, lastSync: 0, lastError: '', pending: 0, pushed: 0, pulled: 0, images: 0, bridge: false };
  let timer = null, soon = null, bridge = null, bridgeTimer = null, again = false, stopped = false;

  const cfg = () => app.config.cloud || {};
  const base = () => String(cfg().url || '').replace(/\/+$/, '');
  const linked = () => !!(base() && cfg().key);

  async function call(method, path, body, raw) {
    const headers = { Authorization: 'Bearer ' + cfg().key };
    let payload;
    if (raw) { payload = body; headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(base() + path, { method, headers, body: payload, signal: AbortSignal.timeout(30000) });
    if (!r.ok) {
      let msg = r.status + ' ' + r.statusText;
      try { msg = (await r.json()).error || msg; } catch { /* ignore */ }
      throw Object.assign(new Error(msg), { status: r.status });
    }
    return r;
  }
  // a sign-in this PC does not know: the website checks it (and hands down that account)
  async function verify(email, password) { return (await call('POST', '/api/sync/verify', { email, password })).json(); }

  async function uploadImage(doc) {
    const buf = await app.blobs.get(doc);
    if (!buf) return false;
    await call('PUT', '/api/sync/blob/' + encodeURIComponent(doc.id) + '?team=' + encodeURIComponent(doc.team) + '&file=' + encodeURIComponent(doc.data.file), buf, true);
    return true;
  }

  async function downloadImage(doc) {
    if (doc.deleted || !safeFile(doc.data.file) || (await app.blobs.has(doc))) return false;
    const r = await call('GET', '/api/sync/blob/' + encodeURIComponent(doc.id));
    await app.blobs.put(doc, Buffer.from(await r.arrayBuffer()));
    st.images++;
    return true;
  }

  // Makes sure every image this machine knows about exists in its image folder.
  async function ensureMedia() {
    let n = 0, missing = 0;
    for (const doc of await app.store.listType('image')) {
      if (await app.blobs.has(doc)) continue;
      if (!linked()) { missing++; continue; }
      try { if (await downloadImage(doc)) n++; } catch { missing++; }
    }
    if (n) log(`Images: downloaded ${n} into ${app.mediaFolder()}`);
    return { downloaded: n, missing };
  }

  async function once() {
    // ---- push
    for (let round = 0; round < 20; round++) {
      const dirty = await app.store.dirty(200);
      if (!dirty.length) break;
      const send = [];
      let imageError = null;
      for (const d of dirty) {
        // An image goes up before its record. If the team is brand new online, the record push below
        // creates it first and the image follows on the next round.
        if (d.type === 'image' && !d.deleted) { try { await uploadImage(d); } catch (e) { imageError = e; continue; } }
        send.push(d);
      }
      if (!send.length) { if (imageError) throw imageError; break; }
      const res = await (await call('POST', '/api/sync/push', { docs: send.map(({ seq, ...d }) => d) })).json();
      let cleared = 0;
      for (const d of send) {
        const r = res.results[d.id];
        if (r === 'need-image') continue;
        await app.store.clearDirty(d.id, d.updatedAt);
        cleared++;
        if (r === 'applied' || r === 'merged') st.pushed++;
      }
      if (!cleared) break;
    }
    // ---- pull
    for (let round = 0; round < 50; round++) {
      const since = (await app.store.kvGet('sync:pulled')) || 0;
      const known = (await app.store.listType('org')).map((o) => o.id);
      const res = await (await call('POST', '/api/sync/pull', { since, teams: known })).json();
      if (res.googleClientId && !app.config.google.clientId) { app.config.google.clientId = res.googleClientId; app.saveConfig(); }
      for (const raw of res.docs) {
        const d = cleanDoc(raw);
        if (!d || d.type === 'machinekey') continue;
        if (d.type === 'user' && !d.data.passwordHash) {
          const mine = await app.store.get(d.id);              // keep this machine's offline password
          if (mine && mine.data.passwordHash) d.data = { ...d.data, passwordHash: mine.data.passwordHash };
        }
        const r = await applyRemote(app, d, { fromSite: true });
        if (r === 'applied' || r === 'merged') st.pulled++;
        if (d.type === 'image') { try { await downloadImage(d); } catch (e) { log('Image download failed:', d.data.name || d.id, e.message); } }
      }
      await app.store.kvSet('sync:pulled', res.seq);
      if (!res.more) break;
    }
    st.pending = await app.store.dirtyCount();
  }

  let current = null;
  function run() {
    if (!linked() || stopped) { st.linked = false; return Promise.resolve(); }
    st.linked = true;
    if (current) { again = true; return current; }
    st.running = true;
    current = (async () => {
      try { await once(); st.lastSync = Date.now(); if (st.lastError) log('Sync: back online'); st.lastError = ''; }
      catch (e) { const msg = e.cause && e.cause.code ? e.cause.code : e.message; if (st.lastError !== msg && !stopped) log('Sync: ' + msg); st.lastError = msg; st.pending = await app.store.dirtyCount().catch(() => st.pending); }
      st.running = false; current = null;
      app.emit('sync', status());
      if (again) { again = false; trigger(); }
    })();
    return current;
  }

  function trigger(delay = 250) { if (!linked() || stopped) return; clearTimeout(soon); soon = setTimeout(run, delay); }

  // A live connection to the online site so changes made there arrive straight away.
  function openBridge() {
    clearTimeout(bridgeTimer);
    if (bridge) { try { bridge.close(); } catch { /* ignore */ } bridge = null; }
    st.bridge = false;
    if (!linked() || stopped || typeof WebSocket === 'undefined') return;
    let ws;
    try { ws = new WebSocket(base().replace(/^http/, 'ws') + '/ws'); } catch { return; }
    bridge = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'bridge', key: cfg().key }));
    ws.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.type === 'bridge-ok') { st.bridge = true; trigger(50); } if (m.type === 'changed') trigger(50); } catch { /* ignore */ } };
    ws.onclose = () => { if (bridge === ws) { st.bridge = false; bridge = null; if (!stopped) bridgeTimer = setTimeout(openBridge, 10000); } };
    ws.onerror = () => { /* onclose follows */ };
  }

  function start() {
    stopped = false;
    clearInterval(timer);
    st.linked = linked();
    if (!linked()) return;
    const every = Math.max(2, Number(app.config.syncSeconds) || 5) * 1000;
    timer = setInterval(run, every);
    openBridge();
    run().then(() => ensureMedia()).catch(() => {});
  }
  function stop() { stopped = true; clearInterval(timer); clearTimeout(soon); clearTimeout(bridgeTimer); if (bridge) { try { bridge.close(); } catch { /* ignore */ } } }
  const status = () => ({ ...st, url: base() });

  app.on('doc', (doc, opts) => { if (opts && opts.dirty) trigger(); });

  return { start, stop, run, trigger, ensureMedia, status, linked, verify };
}

module.exports = { applyRemote, makeSyncServer, makeSyncClient, cleanDoc };
