'use strict';
// Rules that sit on top of plain records: match names, automatic productions, team snapshots and live scoring.
const Schema = require('../shared/schema');
const { detId, fail } = require('./util');

function makeDomain(app) {
  const data = async (id) => { if (!id) return null; const d = await app.store.get(id); return d && !d.deleted ? d.data : null; };

  // What a team looked like when the match was scored: name, colours, logo and squad list.
  async function snapshotTeams(f) {
    const m = new Map();
    const load = async (id) => { if (id && !m.has(id)) m.set(id, await data(id)); return id ? m.get(id) : null; };
    for (const sid of [f.team1, f.team2]) {
      const s = await load(sid);
      if (s) { await load(s.club); for (const r of s.players || []) await load(r.player); }
    }
    const get = (id) => m.get(id) || null;
    // A match with no squads chosen still has team names if its name reads "Cheetahs vs Griquas".
    const typed = String(f.name || '').split(/\s+(?:vs?\.?|versus|teen|v\/s)\s+/i).map((x) => x.replace(/\s*\([^)]*\)\s*$/, '').trim());
    const named = typed.length === 2 && typed[0] && typed[1] ? typed : null;
    return [f.team1, f.team2].map((id, i) => {
      const t = Schema.snapshotTeam(get, id, named ? named[i] : i ? 'Away' : 'Home');
      t.fromMatch = !!t.id || !!named;                 // false = nothing on the match says who this team is
      return t;
    });
  }

  async function autoName(f) {
    const a = await data(f.team1), b = await data(f.team2);
    if (!a || !b) return '';
    const ra = Schema.resolveSquad(a, await data(a.club)), rb = Schema.resolveSquad(b, await data(b.club));
    const age = a.ageGroup && a.ageGroup === b.ageGroup ? ' (' + a.ageGroup + ')' : '';
    return `${ra.graphicName || ra.name} vs ${rb.graphicName || rb.name}${age}`;
  }

  // Every venue gets its own production for each day that has matches on it.
  async function ensureProduction(fx, userId) {
    const f = fx.data;
    const want = !fx.deleted && f.startDate && f.venue && f.status !== 'Cancelled' ? detId('prod_', fx.team, f.startDate, f.venue) : null;
    for (const p of await app.store.list(fx.team, 'production')) {
      if (!p.data.auto || p.id === want) continue;
      const rows = (p.data.fixtures || []).filter((r) => r.fixture !== fx.id);
      if (rows.length !== (p.data.fixtures || []).length) await app.save(fx.team, 'production', p.id, { ...p.data, fixtures: rows }, userId);
    }
    if (!want) return;
    const cur = await app.store.get(want);
    if (cur && cur.deleted) return;
    if (!cur) {
      const venue = await data(f.venue);
      await app.save(fx.team, 'production', want, { name: `${venue ? venue.name : 'Venue'} – ${f.startDate}`, type: 'Sport', date: f.startDate, venue: f.venue, auto: true,
        description: 'Created automatically from the fixture list.', fixtures: [{ fixture: fx.id }] }, userId);
    } else if (!(cur.data.fixtures || []).some((r) => r.fixture === fx.id)) {
      await app.save(fx.team, 'production', want, { ...cur.data, fixtures: [...(cur.data.fixtures || []), { fixture: fx.id }] }, userId);
    }
  }

  async function beforeSave(team, type, id, incoming, cur) {
    const d = incoming;
    if (type === 'fixture') {
      // The live match and its result belong to the scorer; an edit of the match details never touches them.
      for (const k of ['live', 'result']) { if (cur && cur.data[k]) d[k] = cur.data[k]; else delete d[k]; }
      d.autoName = await autoName(d);
      if (!d.status) d.status = 'Upcoming';
    }
    if (type === 'org') { delete d.id; if (!String(d.name || '').trim()) fail(400, 'The production team needs a name'); }
    return d;
  }
  async function afterSave(doc, userId) {
    if (doc.type === 'fixture') await ensureProduction(doc, userId);
  }

  return { snapshotTeams, autoName, ensureProduction, beforeSave, afterSave };
}

module.exports = { makeDomain };
