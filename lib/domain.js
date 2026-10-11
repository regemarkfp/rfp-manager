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
      let s = await load(sid);
      // the coach's team sheet for this match, if there is one: starters first, then the bench
      const sheet = f.teamSheets && sid && f.teamSheets[sid];
      if (s && sheet && (sheet.rows || []).length) { s = { ...s, players: [...sheet.rows.filter((r) => !r.bench), ...sheet.rows.filter((r) => r.bench)] }; m.set(sid, s); }
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

  // Production team names are unique on a site.
  const teamKey = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
  async function uniqueTeamName(name, exceptId) {
    const k = teamKey(name);
    if (!k) fail(400, 'The production team needs a name');
    const other = (await app.store.listType('org')).find((o) => !o.deleted && o.id !== exceptId && teamKey(o.data.name) === k);
    if (other) fail(409, `There is already a production team called "${other.data.name}". Choose another name, or ask its Admin to add you to it.`);
  }

  async function beforeSave(team, type, id, incoming, cur, userId) {
    const d = incoming;
    if (type === 'fixture') {
      // The live match and its result belong to the scorer; an edit of the match details never touches them.
      for (const k of ['live', 'result']) { if (cur && cur.data[k]) d[k] = cur.data[k]; else delete d[k]; }
      for (const k of ['teamSheets', 'officialReport']) { if (cur && cur.data[k] && d[k] === undefined) d[k] = cur.data[k]; }   // set through their own screens
      d.autoName = await autoName(d);
      if (!d.status) d.status = 'Upcoming';
    }
    if (type === 'channel') await app.streaming.prepare(team, id, d, cur);
    if (type === 'expense') {
      const u = userId ? await app.store.get(userId) : null;
      d.submittedBy = (cur && cur.data.submittedBy) || (u && u.data.email) || '';
      if (!d.date) d.date = new Date().toISOString().slice(0, 10);
      if (!d.paidBy) d.paidBy = (u && (u.data.name || u.data.email)) || '';
      if (!Schema.EXPENSE_STATUS.includes(d.status)) d.status = 'Submitted';
      d.amount = Math.round((Number(d.amount) || 0) * 100) / 100;
      if (d.vat !== undefined && d.vat !== '') d.vat = Math.round((Number(d.vat) || 0) * 100) / 100;
      if (cur && cur.data.status !== d.status) { d.decidedBy = (u && (u.data.name || u.data.email)) || ''; d.decidedAt = Date.now(); }
    }
    if (type === 'org') { delete d.id; if (!String(d.name || '').trim()) fail(400, 'The production team needs a name'); if (!cur || teamKey(cur.data.name) !== teamKey(d.name)) await uniqueTeamName(d.name, id); }
    return d;
  }
  async function afterSave(doc, userId) {
    if (doc.type === 'fixture') await ensureProduction(doc, userId);
  }

  return { uniqueTeamName, snapshotTeams, autoName, ensureProduction, beforeSave, afterSave };
}

module.exports = { makeDomain };
