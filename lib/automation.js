'use strict';
// Custom variables and game triggers.
//   Variables ("variable" records): a name and a key, kept for everyone, per sport, per competition or per match.
//     The value for the match on air is a live value {var_<key>} for templates, triggers, dashboards and actions.
//     Values are kept on this PC (they change all the time, from faders and buttons); the definition syncs.
//   Game triggers ("gametrigger" records): WHEN something happens in a game (a try, a six, a wicket, a red card …)
//     for a team, in a sport / competition, THEN run actions (an advert, a playlist, a graphic, a macro, set a variable),
//     with a cool-down and a most-per-match.
const Scoring = require('../shared/scoring');
const actor = require('./actor');
const { log, HttpError } = require('./util');

// What the scorers report, per sport family. The list the trigger editor offers (any other key can be typed).
const EVENTS = {
  cricket: [['ball', 'Any ball'], ['four', 'Four'], ['six', 'Six'], ['boundary', 'Four or six'], ['wicket', 'Wicket'], ['dot', 'Dot ball'], ['wide', 'Wide'], ['noball', 'No ball'], ['extra', 'Any extra'],
    ['over', 'End of an over'], ['maiden', 'Maiden over'], ['fifty', 'Batter reaches 50'], ['hundred', 'Batter reaches 100'], ['innings', 'End of an innings'], ['penalty', 'Penalty runs']],
  sport: [['score', 'Any score'], ['try', 'Try'], ['conversion', 'Conversion'], ['penalty', 'Penalty goal'], ['dropgoal', 'Drop goal'], ['goal', 'Goal'], ['point', 'Point'], ['basket', 'Basket'], ['homerun', 'Home run'],
    ['card', 'Any card'], ['yellow', 'Yellow card'], ['red', 'Red card'], ['sub', 'Substitution'], ['timeout', 'Time-out'], ['period', 'New period / half'], ['event', 'Anything the scorer adds']],
};

function makeAutomation(app) {
  const gfx = () => app.gfx || null;
  const values = new Map();            // "<variable id>|<instance>" -> value
  let saveT = null, loaded = false;
  const counts = new Map(), lastRun = new Map();   // game trigger: fired per match, last time

  async function load() {
    if (loaded) return; loaded = true;
    try { const v = await app.store.kvGet('vars:values'); if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) values.set(k, String(x)); } catch { /* none yet */ }
  }
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => app.store.kvSet('vars:values', Object.fromEntries(values)).catch(() => {}), 800); saveT.unref(); };
  const keyOf = (s) => String(s || '').trim().toLowerCase().replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

  // ---------------------------------------------------------------- variables
  // the match on air (or the one a screen is on): its sport, competition, team
  function context(fixtureId) {
    const fx = fixtureId ? app.cache.get(fixtureId) : null;
    const f = fx && !fx.deleted ? fx.data : {};
    return { fixture: fx && !fx.deleted ? fx.id : '', team: fx ? fx.team : '', sport: Scoring.keyOf(f.sport || '') || String(f.sport || '').toLowerCase(), competition: f.competition || '' };
  }
  const defs = (team) => [...app.cache.values()].filter((d) => d.type === 'variable' && !d.deleted && (!team || d.team === team));
  // a variable applies to the match when its sport / competition fit (empty = every one)
  function applies(d, ctx) {
    const x = d.data;
    if (x.sport && Scoring.keyOf(x.sport) !== ctx.sport && String(x.sport).toLowerCase() !== ctx.sport) return false;
    if (x.competition && x.competition !== ctx.competition) return false;
    return true;
  }
  function instance(d, ctx) {
    const sc = d.data.scope || 'all';
    return sc === 'match' ? ctx.fixture : sc === 'competition' ? ctx.competition : sc === 'sport' ? ctx.sport : '';
  }
  const slot = (d, ctx) => `${d.id}|${instance(d, ctx)}`;
  function valueOf(d, ctx) { const k = slot(d, ctx); return values.has(k) ? values.get(k) : String(d.data.default == null ? '' : d.data.default); }
  // live values {var_<key>} for the match on air
  function vars(fixtureId) {
    const ctx = context(fixtureId === undefined ? (gfx() && gfx().fixtureId) || '' : fixtureId), out = {};
    for (const d of defs(ctx.team)) { if (!applies(d, ctx)) continue; const k = keyOf(d.data.key || d.data.name); if (k) out['var_' + k] = valueOf(d, ctx); }
    return out;
  }
  function list(fixtureId) {
    const ctx = context(fixtureId === undefined ? (gfx() && gfx().fixtureId) || '' : fixtureId);
    return defs(ctx.team).filter((d) => applies(d, ctx)).map((d) => ({ id: d.id, key: keyOf(d.data.key || d.data.name), name: d.data.name || '', type: d.data.type || 'text', options: String(d.data.options || '').split(/[,\n]/).map((o) => o.trim()).filter(Boolean), min: d.data.min, max: d.data.max, scope: d.data.scope || 'all', value: valueOf(d, ctx) }));
  }
  // set a value: "12", "+1", "-5", "toggle", or text; for the match on air (or the match given)
  function set(key, value, fixtureId) {
    const ctx = context(fixtureId || (gfx() && gfx().fixtureId) || '');
    const k = keyOf(String(key || '').replace(/^\{?var_/, '').replace(/\}$/, ''));
    const d = defs(ctx.team).find((x) => keyOf(x.data.key || x.data.name) === k && applies(x, ctx)) || defs('').find((x) => keyOf(x.data.key || x.data.name) === k);
    if (!d) throw new HttpError(400, `No variable called ${key}`);
    if ((d.data.scope === 'match' && !ctx.fixture) || (d.data.scope === 'competition' && !ctx.competition)) throw new HttpError(400, `"${d.data.name}" is kept per ${d.data.scope}: put a match on air first`);
    const cur = valueOf(d, ctx), v = String(value == null ? '' : value).trim();
    let next = v;
    const n = (x) => { const y = parseFloat(String(x).replace(',', '.')); return Number.isFinite(y) ? y : 0; };
    if (/^[+-]\d+(\.\d+)?$/.test(v) && (d.data.type === 'number' || /^-?\d/.test(cur) || cur === '')) next = String(Math.round((n(cur) + n(v)) * 1000) / 1000);
    else if (v === 'toggle') next = cur && cur !== '0' ? '' : '1';
    if (d.data.type === 'number' && next !== '') {
      let x = n(next);
      if (d.data.min !== undefined && d.data.min !== '' && Number.isFinite(Number(d.data.min))) x = Math.max(Number(d.data.min), x);
      if (d.data.max !== undefined && d.data.max !== '' && Number.isFinite(Number(d.data.max))) x = Math.min(Number(d.data.max), x);
      next = String(x);
    }
    if (d.data.type === 'toggle') next = next && next !== '0' && next.toLowerCase() !== 'off' && next.toLowerCase() !== 'false' ? '1' : '';
    next = next.slice(0, 2000);
    if (next === cur) return next;
    values.set(slot(d, ctx), next); persist();
    if (gfx()) { gfx().refreshLive().catch(() => {}); }
    app.emit('vars', { key: k, value: next });
    return next;
  }

  // ---------------------------------------------------------------- game triggers
  const triggers = (team) => [...app.cache.values()].filter((d) => d.type === 'gametrigger' && !d.deleted && !d.data.off && (!team || d.team === team));
  // an event from a scorer: { kind: 'try' | 'six' | 'wicket' …, team: 'A' | 'B' | '', fixtureId, text, player, also: [other kinds it counts as] }
  async function gameEvent(e) {
    app.emit('gameevent', e);                    // master control on the website (squeeze-backs, ad breaks on game events)
    if (!gfx()) return;
    const ctx = context(e.fixtureId), kinds = new Set([e.kind, ...(e.also || [])]);
    for (const t of triggers(ctx.team)) {
      const x = t.data;
      if (!kinds.has(String(x.when || '').toLowerCase())) continue;
      if (x.team && x.team !== 'any' && x.team !== e.team) continue;
      if (x.sport && Scoring.keyOf(x.sport) !== ctx.sport && String(x.sport).toLowerCase() !== ctx.sport) continue;
      if (x.competition && x.competition !== ctx.competition) continue;
      if (x.match && x.match !== ctx.fixture) continue;
      const ck = t.id + '|' + ctx.fixture, n = (counts.get(ck) || 0) + 1;
      if (Number(x.every) > 1 && n % Number(x.every) !== 0) { counts.set(ck, n); continue; }       // every 2nd try, every 3rd six …
      if (Number(x.maxPerMatch) > 0 && (counts.get(ck + '|ran') || 0) >= Number(x.maxPerMatch)) { counts.set(ck, n); continue; }
      if (Number(x.cooldown) > 0 && Date.now() - (lastRun.get(t.id) || 0) < Number(x.cooldown) * 1000) { counts.set(ck, n); continue; }
      counts.set(ck, n); counts.set(ck + '|ran', (counts.get(ck + '|ran') || 0) + 1); lastRun.set(t.id, Date.now());
      const acts = Array.isArray(x.actions) ? x.actions : [];
      const delay = Math.max(0, Math.min(600, Number(x.delay) || 0)) * 1000;
      const go = () => actor.run({ via: 'Game trigger', name: x.name || x.when }, () => gfx().runActions(acts, { team: ctx.team, label: 'Game trigger ' + (x.name || x.when), vars: { team: e.team || '', event: e.kind, event_text: e.text || '', player: e.player || '' } })).catch((er) => log('Game trigger:', er.message));
      if (delay) setTimeout(go, delay).unref(); else go();
      app.emit('gametrigger', { id: t.id, name: x.name, event: e.kind });
    }
  }
  return { load, vars, list, set, gameEvent, keyOf, EVENTS };
}

module.exports = { makeAutomation, EVENTS };
