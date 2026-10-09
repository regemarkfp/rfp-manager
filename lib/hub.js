'use strict';
const actor = require('./actor');
// WebSocket hub: live record updates for every signed-in screen, scoring, graphics control,
// browser outputs, and the link from production PCs to the online site.
const { accept } = require('./ws');
const Schema = require('../shared/schema');
const { fail, log } = require('./util');

function viewDoc(doc, role) {
  if (doc.type === 'crewMember' && !Schema.CAN.edit(role) && doc.data && doc.data.idNumber) {
    const { idNumber, ...data } = doc.data;
    return { ...doc, data };
  }
  return doc;
}

function makeHub(app) {
  const clients = new Set();
  const send = (c, msg) => c.ws.send(msg);
  const ui = () => [...clients].filter((c) => c.kind === 'ui');

  app.on('doc', (doc) => {
    if (doc.type === 'user' || doc.type === 'machinekey') return;
    for (const c of clients) {
      if (c.kind === 'ui' && c.team === doc.team) send(c, { type: 'doc', doc: viewDoc(doc, c.role) });
      else if (c.kind === 'bridge' && (c.scope.has(doc.team) || doc.type === 'member' || doc.type === 'org')) {
        if (!c.pingTimer) c.pingTimer = setTimeout(() => { c.pingTimer = null; send(c, { type: 'changed' }); }, 80);
      }
    }
    if (doc.type === 'member') for (const c of clients) if (c.kind === 'bridge') app.syncServer.scope(c.user).then((s) => { c.scope = new Set(s); }).catch(() => {});
  });
  app.on('sync', (status) => { for (const c of ui()) send(c, { type: 'sync', status }); });
  if (app.gfx) {
    app.gfx.onMessage((msg) => {
      if (msg.type !== 'changed' && msg.type !== 'fixture') return;
      const state = { type: 'gfx-state', state: { onAir: app.gfx.onAirList(), playlist: app.gfx.playlistState(), caspar: app.gfx.casparState(), fixtureId: app.gfx.fixtureId || '' } };
      for (const c of clients) if (c.kind === 'ui') send(c, state);
    });
  }

  // Adverts and playlists are played from the app's Adverts screen; everything else is driven from Graphics Control.
  async function gfxAction(c, m) {
    const g = app.gfx;
    if (!g) fail(400, 'Graphics run on the production PC. Open RFP Manager on that machine to play adverts.');
    if (!Schema.CAN.score(await app.auth.roleIn(c.user, c.team))) fail(403, 'You need the Scorer role to control graphics');
    const state = () => ({ onAir: g.onAirList(), playlist: g.playlistState(), caspar: g.casparState(), fixtureId: g.fixtureId || '' });
    switch (m.action) {
      case 'state': return state();
      case 'setFixture': {
        if (m.fixtureId) { const d = await app.store.get(m.fixtureId); if (!d || !Schema.CAN.score(await app.auth.roleIn(c.user, d.team))) fail(403, 'You cannot put that match on air'); }
        await g.setFixture(m.fixtureId || null);
        return state();
      }
      case 'advert': await g.playAdvert(c.team, m.advertId, { hold: !!m.hold }); return state();
      case 'playlist': await g.startPlaylist(c.team, m.playlistId); return state();
      case 'playlistStop': await g.stopPlaylist(); return state();
      case 'out': await g.hideKey(String(m.key || '')); return state();
      default: fail(400, 'Unknown graphics action');
    }
  }

  async function onMessage(c, text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    try {
      if (m.type === 'ping') return send(c, { type: 'pong', now: Date.now() });
      if (m.type === 'bridge') {
        const k = await app.auth.keyUser(m.key);
        if (!k) { send(c, { type: 'error', error: 'Bad machine key' }); return c.ws.close(); }
        Object.assign(c, { kind: 'bridge', user: k.user, scope: new Set(await app.syncServer.scope(k.user)) });
        return send(c, { type: 'bridge-ok' });
      }
      if (!c.user) fail(401, 'Sign in first');
      if (m.type === 'hello') {
        const role = await app.auth.roleIn(c.user, m.team);
        if (!role) fail(403, 'You are not in this production team');
        Object.assign(c, { kind: 'ui', team: m.team, role });
        return send(c, { type: 'welcome', now: Date.now(), role, gfx: app.gfx ? { state: { onAir: app.gfx.onAirList(), playlist: app.gfx.playlistState(), caspar: app.gfx.casparState(), fixtureId: app.gfx.fixtureId || '' } } : null, sync: app.sync ? app.sync.status() : null });
      }
      if (c.kind !== 'ui') fail(400, 'Say hello first');
      if (m.type === 'gfx') return send(c, { type: 'ack', rid: m.rid, result: await actor.run({ name: c.user.data.name || c.user.data.email || '', ip: c.ip || '', via: 'RFP Manager' }, () => gfxAction(c, m)) });
    } catch (e) {
      if (!e.status) log('WebSocket error:', e.stack || e.message);
      send(c, { type: 'error', rid: m.rid, error: e.status ? e.message : 'Something went wrong' });
    }
  }

  async function upgrade(req, sock) {
    let user = null;
    try { user = await app.auth.userFromReq(req); } catch { /* treated as signed out */ }
    const ws = accept(req, sock);
    if (!ws) return;
    const c = { ws, user, kind: 'new', team: null, role: null, scope: new Set(), chain: Promise.resolve(), ip: String((req && req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '') };
    clients.add(c);
    ws.on('message', (text) => { c.chain = c.chain.then(() => onMessage(c, text)).catch(() => {}); });
    ws.on('close', () => { clients.delete(c); clearTimeout(c.pingTimer); });
    setTimeout(() => { if (c.kind === 'new') ws.close(); }, 15000).unref();
  }

  const beat = setInterval(() => {
    for (const c of clients) { if (!c.ws.alive) { c.ws.close(); continue; } c.ws.alive = false; c.ws.ping(); }
  }, 30000);
  beat.unref();

  return { upgrade, clients, viewDoc, close: () => { clearInterval(beat); for (const c of clients) c.ws.close(); } };
}

module.exports = { makeHub, viewDoc };
