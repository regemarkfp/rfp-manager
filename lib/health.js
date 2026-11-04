'use strict';
// Health during a show (on the website, every 30 s): the producers hear about it while there is still time to fix it.
//  · a live stream whose bitrate drops below the floor for a minute (the encoder or its internet is struggling)
//  · a live match the scorer has not touched for 12 minutes while play is on (the scorer's device or connection)
//  · a production PC that drops off the website during a production day (CasparCG and graphics run there)
const { log } = require('./util');

function makeHealth(app) {
  const low = new Map(), told = new Map(), pcSeen = new Map();
  const once = (key, mins) => { const t = told.get(key) || 0; if (Date.now() - t < mins * 60e3) return false; told.set(key, Date.now()); if (told.size > 5000) told.clear(); return true; };
  const people = async (team, roles) => (await app.store.list(team, 'member')).filter((d) => !d.deleted && roles.includes(d.data.role)).map((d) => d.data.email).filter(Boolean);
  const studio = () => String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '');
  const floor = () => Number((app.config.health || {}).minKbps) || 700;

  async function streams() {
    if (!app.streaming || !app.streaming.enabled()) return;
    for (const p of await app.streaming.allStreams()) {
      const slug = p.data.streamSlug; if (!slug) continue;
      const s = app.streaming.status(slug);
      if (!s.live || !(s.kbps >= 0)) { low.delete(slug); continue; }
      if (s.kbps > 0 && s.kbps < floor()) low.set(slug, (low.get(slug) || 0) + 1); else low.delete(slug);
      if ((low.get(slug) || 0) >= 2 && once('kbps:' + slug, 10)) {
        await app.push.send(await people(p.team, ['Admin', 'Producer']), { kind: 'stream_health', title: `Weak stream: ${p.data.streamTitle || p.data.name}`, body: `Coming in at ${(s.kbps / 1000).toFixed(1)} Mb/s for a minute. Check the encoder and its internet.`, url: studio() + '/app/#/streams', tag: 'kbps:' + slug });
        log(`Health: weak stream ${slug} (${s.kbps} kb/s)`);
      }
    }
  }
  async function scorers() {
    const today = new Date().toISOString().slice(0, 10);
    for (const f of await app.store.listType('fixture')) {
      if (f.deleted || f.data.status !== 'Live' || (f.data.startDate && f.data.startDate < today) || !f.data.live) continue;
      let phase = 'live';
      try { if (f.data.live.kind === 'sport') phase = (require('../shared/sports').compute(f.data.live.setup, f.data.live.events || []).extra || {}).phase || 'live'; } catch { phase = 'live'; }
      if (phase !== 'live') continue;                                  // breaks and full time are quiet anyway
      if (Date.now() - (f.updatedAt || 0) < 12 * 60e3) continue;
      if (!once('idle:' + f.id, 20)) continue;
      const to = await people(f.team, ['Admin', 'Producer']);
      if (f.data.scorer) { const u = await app.store.get(f.data.scorer); if (u && !u.deleted && u.data.email) to.push(u.data.email); }
      await app.push.send(to, { kind: 'scorer_idle', title: `No scoring for 12 minutes: ${f.data.name || f.data.autoName || 'match'}`, body: 'Is the scorer still connected? Check their device or take over in the scorer.', url: studio() + '/app/#/fixtures', tag: 'idle:' + f.id });
    }
  }
  // production PCs: one that was online today and has been gone for 3 minutes, on a day with a production
  async function pcs() {
    if (!app.relayServer || !app.relayServer.machines) return;
    const now = Date.now(), today = new Date().toISOString().slice(0, 10);
    for (const [id, m] of app.relayServer.machines) pcSeen.set(id, { at: now, team: [...(m.teams || [])][0] || '', name: m.name || 'Production PC' });
    for (const [id, s] of pcSeen) {
      if (app.relayServer.machines.has(id) || now - s.at < 3 * 60e3) continue;
      pcSeen.delete(id);
      if (!s.team) continue;
      const busy = (await app.store.list(s.team, 'production')).some((p) => !p.deleted && p.data.date === today);
      if (busy && once('pc:' + id, 15)) await app.push.send(await people(s.team, ['Admin', 'Producer']), { kind: 'stream_health', title: `${s.name} went offline`, body: 'CasparCG graphics and adverts run there. Check the PC and its internet.', url: studio() + '/app/#/pcs', tag: 'pc:' + id });
    }
  }
  async function tick() {
    if (app.isLocal || !app.push) return;
    for (const f of [streams, scorers, pcs]) { try { await f(); } catch (e) { log('Health:', e.message); } }
  }
  let timer = null;
  return { tick, start() { if (app.isLocal) return; timer = setInterval(() => tick().catch(() => {}), 30000); timer.unref(); }, stop() { clearInterval(timer); } };
}

module.exports = { makeHealth };
