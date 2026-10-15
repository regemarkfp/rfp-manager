'use strict';
const actor = require('./actor');
// WebSocket hub: live record updates for every signed-in screen, scoring, graphics control,
// browser outputs, and the link from production PCs to the online site.
const { accept } = require('./ws');
const Schema = require('../shared/schema');
const { fail, log } = require('./util');

function viewDoc(doc, role, user) {
  if (!doc) return null;
  // money is for Producers and Admins: rates, costs and what crew members are paid
  if (!doc.deleted && doc.data && !Schema.CAN.edit(role) && Schema.ROLES.includes(role)) {
    if (doc.type === 'crewRole' || doc.type === 'equipment') { const { rate, invoiceRate, ...data } = doc.data; doc = { ...doc, data }; }
    if (doc.type === 'production') {
      const { extras, streamKey, ...data } = doc.data;
      // stream keys: of the match streams, and of the platforms it is restreamed to
      if (data.matchStreams) data.matchStreams = Object.fromEntries(Object.entries(data.matchStreams).map(([k, m]) => { const { key, ...rest } = m || {}; return [k, rest]; }));
      if (data.streamRestream) data.streamRestream = data.streamRestream.map(({ key, ...row }) => row);
      doc = { ...doc, data: { ...data, crew: (data.crew || []).map(({ rate, paid, ...row }) => row) } };
    }
  }
  // video analytics are read through /api/analytics (they are big), never as records
  if (doc.type === 'viewstat') return null;
  // coaches and officials see their clubs and matches, not productions, crew or costs
  if (!Schema.sees(role, doc.type)) return null;
  // booking requests (people's contact details): Producers and Admins
  if (doc.type === 'booking' && !doc.deleted && !Schema.CAN.admin(role) && !(role === 'Producer' && user && String((doc.data && doc.data.producer) || '').toLowerCase() === String(user.data.email || '').toLowerCase())) return null;
  if (doc.type === 'member' && Schema.ROLE_SEES[role] && user && doc.data && doc.data.email !== user.data.email) return null;
  // an expense: whoever added it, and Producers / Admins
  if (doc.type === 'expense' && !Schema.CAN.edit(role) && !(user && doc.data && doc.data.submittedBy === user.data.email)) return null;
  if (doc.type === 'image' && doc.data && doc.data.kind === 'receipt' && !Schema.CAN.edit(role) && !(user && doc.data.by === user.data.email)) return null;
  if ((doc.type === 'channel' || doc.type === 'production') && !Schema.CAN.edit(role) && doc.data && (doc.data.streamKey || doc.data.viewerPassword)) {
    const { streamKey, viewerPassword, ...data } = doc.data;
    return { ...doc, data };
  }
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
      if (c.kind === 'ui' && c.team === doc.team) { const v = viewDoc(doc, c.role, c.user); if (v) send(c, { type: 'doc', doc: v }); }
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
    if (!g && c.pc && app.relayServer) {                 // the website: pass it on to the production PC this browser uses
      const r = await app.relayServer.request(app.relayServer.machines.get(c.pc.id) || c.pc, { method: 'POST', path: '/api/gfx', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: Buffer.from(JSON.stringify({ ...m, team: c.team })), user: c.user, ip: c.ip });
      let out = {}; try { out = JSON.parse(r.body.toString('utf8') || '{}'); } catch { /* not JSON */ }
      if (r.status !== 200) fail(r.status, out.error || 'The production PC could not do that');
      return out;
    }
    if (!g) fail(400, 'Graphics run on the production PC. Open RFP Manager on that machine (or link it to the website) to play adverts.');
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
        const pcNow = c.pc && app.relayServer ? app.relayServer.machines.get(c.pc.id) : null;
        const remote = !app.gfx && pcNow && pcNow.gfxState ? { state: pcNow.gfxState, pc: { id: pcNow.id, name: pcNow.name } } : null;
        return send(c, { type: 'welcome', now: Date.now(), role, gfx: app.gfx ? { state: { onAir: app.gfx.onAirList(), playlist: app.gfx.playlistState(), caspar: app.gfx.casparState(), fixtureId: app.gfx.fixtureId || '' } } : remote, sync: app.sync ? app.sync.status() : null });
      }
      if (c.kind !== 'ui') fail(400, 'Say hello first');
      if (m.type === 'gfx') return send(c, { type: 'ack', rid: m.rid, result: await actor.run({ name: c.user.data.name || c.user.data.email || '', ip: c.ip || '', via: 'RFP Manager' }, () => gfxAction(c, m)) });
    } catch (e) {
      if (!e.status) log('WebSocket error:', e.stack || e.message);
      send(c, { type: 'error', rid: m.rid, error: e.status ? e.message : 'Something went wrong' });
    }
  }

  // the website: what is on air on a production PC reaches the screens that use it
  app.on('relay-gfx', (id, state) => { for (const c of clients) if (c.kind === 'ui' && c.pc && c.pc.id === id) send(c, { type: 'gfx-state', state }); });
  app.on('relay', () => { for (const c of clients) if (c.kind === 'ui') send(c, { type: 'pcs' }); });

  async function upgrade(req, sock) {
    let user = null, pc = null;
    try { user = await app.auth.userFromReq(req); } catch { /* treated as signed out */ }
    if (app.relayServer && user) { try { pc = await app.relayServer.choose(req, user); if (pc && !pc.offline && !(await app.relayServer.allowedFor(user, pc))) pc = null; } catch { pc = null; } }
    const ws = accept(req, sock);
    if (!ws) return;
    const c = { ws, user, pc, kind: 'new', team: null, role: null, scope: new Set(), chain: Promise.resolve(), ip: String((req && req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '') };
    clients.add(c);
    ws.on('message', (text) => { c.chain = c.chain.then(() => onMessage(c, text)).catch(() => {}); });
    ws.on('close', () => { clients.delete(c); clearTimeout(c.pingTimer); });
    setTimeout(() => { if (c.kind === 'new') ws.close(); }, 15000).unref();
  }

  const beat = setInterval(() => {
    for (const c of clients) { if (!c.ws.alive) { c.ws.close(); continue; } c.ws.alive = false; c.ws.ping(); }
  }, 30000);
  beat.unref();

  app.gfxAction = (user, team, m) => gfxAction({ user, team, pc: null }, m);   // the same, for a request that came through the website
  return { upgrade, clients, viewDoc, close: () => { clearInterval(beat); for (const c of clients) c.ws.close(); } };
}

module.exports = { makeHub, viewDoc };
