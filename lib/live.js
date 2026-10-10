'use strict';
// Live scoring sessions: one per match. Speaks the same WebSocket protocol as CricketCG, so the Stats scorer,
// Sports scorer, Graphics Control, Commentary and Output screens work unchanged (a port of its AppService).
//   cricket  -> shared/cricket.js runs here; the scorer sends actions (ball, wicket, undo…)
//   sports   -> rules run in shared/sports.js; the scorer sends setup + events, the server checks and stores them
// The match lives inside its fixture record, so it syncs to the website and other machines like everything else.
const Cricket = require('../shared/cricket');
const Sports = require('../shared/sports');
const Schema = require('../shared/schema');
const Scoring = require('../shared/scoring');
const { accept } = require('./ws');
const { readBody, send: httpSend } = require('./http');
const { newId, fail, log, clone, HttpError } = require('./util');
const { makeTimeline } = require('./timeline');
const actor = require('./actor');

// ---- clocks (game clock, shot clock) kept on the server so every screen and template agrees -------------
const Clock = {
  make: (o) => Object.assign({ running: false, baseMs: 0, startedAt: 0, direction: 1, limitMs: 0, stopAtLimit: false }, o || {}),
  value(c, now) {
    let v = c.running ? c.baseMs + c.direction * (now - c.startedAt) : c.baseMs;
    if (c.direction < 0) v = Math.max(0, v); else if (c.stopAtLimit && c.limitMs > 0) v = Math.min(v, c.limitMs);
    return Math.max(0, v);
  },
  ticking(c, now) {
    if (!c.running) return false;
    const v = Clock.value(c, now);
    return !(c.direction < 0 && v <= 0) && !(c.direction > 0 && c.stopAtLimit && c.limitMs > 0 && v >= c.limitMs);
  },
  start(c, now) { if (!c.running) { c.startedAt = now; c.running = true; } },
  stop(c, now) { if (c.running) { c.baseMs = Clock.value(c, now); c.running = false; } },
  set(c, ms, now) { c.baseMs = Math.max(0, ms); c.startedAt = now; },
  format(ms, tenths) {
    if (ms < 0) ms = 0;
    if (tenths && ms < 60000) return (Math.floor(ms / 100) / 10).toFixed(1);
    const t = Math.floor(ms / 1000);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  },
};
const newClocks = () => ({ game: Clock.make({ direction: 1 }), shot: Clock.make({ direction: -1, stopAtLimit: true, baseMs: 24000, limitMs: 24000 }) });
const blankSport = () => ({ sport: '', version: 0, setup: null, events: [], derived: null, flat: {}, clocks: newClocks() });
// Counted statistics of one player as [label, value] pairs, most important first (for the player stats graphic).
function statList(v, p) {
  if (v.kind !== 'timed' || !p.stats) return [];
  const out = [], seen = new Set();
  const add = (key, label) => { if (seen.has(key) || !p.stats[key]) return; seen.add(key); out.push([String(label).toUpperCase(), String(p.stats[key])]); };
  add('points', 'Points');
  for (const a of Sports.actions(v.sport, v.variant, v.options)) if (a.player) add(a.stat || a.key, a.short || a.label);
  for (const c of Sports.cards(v.sport)) add(c.key + '_cards', c.label.replace(/\s*\(.*\)/, ''));
  return out.slice(0, 12);
}
const derivedOf = (v) => ({ kind: v.kind, reds: (v.extra && v.extra.reds) || [], teamStats: v.teamStats, shares: (v.extra && v.extra.shares) || {}, timing: v.timing, sinbins: v.sinbins, lastEvent: v.lastEvent, periodLabel: v.periodLabel, score: v.score,
  players: v.players.map((p) => ({ id: p.id, team: p.team, name: p.name, tvName: p.tvName, number: p.number, position: p.position, statsText: p.statsText, statList: statList(v, p), teamName: p.teamName || '', result: p.result || '', rank: p.rank === undefined ? '' : String(p.rank) })) });

function gameTime(sp, now) {
  const t = sp.derived && sp.derived.timing, g = sp.clocks.game || Clock.make(), clock = Clock.value(g, now);
  const len = t ? Number(t.periodLenMs) || 0 : 0;
  if (!t || len <= 0) return clock;
  const period = Number(t.period) || 1;
  const inPeriod = g.direction < 0 ? len - clock : (t.continuous ? clock - (period - 1) * len : clock);
  return Math.round((period - 1) * len + Math.max(0, inPeriod));
}
// Clock and sin-bin keys that change with time, added to the flat keys when graphics are built.
function liveKeys(sp, now) {
  const d = {};
  for (const [name, c] of Object.entries(sp.clocks || {})) {
    const p = name === 'game' ? 'clock' : name, v = Clock.value(c, now);
    d[`${p}_ms`] = String(Math.round(v));
    d[`${p}_text`] = Clock.format(v, name === 'shot' || (c.direction < 0 && sp.sport === 'basketball'));
    d[`${p}_running`] = Clock.ticking(c, now) ? '1' : '';
    d[`${p}_dir`] = c.direction < 0 ? '-1' : '1';
    d[`${p}_limit_ms`] = String(c.limitMs);
    d[`${p}_stop_at_limit`] = c.stopAtLimit ? '1' : '';
    d[`${p}_sig`] = [c.baseMs, c.startedAt, c.running ? 1 : 0, c.direction].join('|');
  }
  const gt = gameTime(sp, now);
  d.gt_ms = String(gt);
  let n = 0;
  for (const b of (sp.derived && sp.derived.sinbins) || []) {
    const left = Number(b.untilGt) - gt;
    if (!(left > 0)) continue;
    n++;
    Object.assign(d, { [`sinbin${n}_team`]: b.team || '', [`sinbin${n}_name`]: b.name || '', [`sinbin${n}_number`]: String(b.number === undefined ? '' : b.number), [`sinbin${n}_card`]: b.card || '', [`sinbin${n}_color`]: Sports.cardColor(sp.sport, b.card || ''), [`sinbin${n}_ms`]: String(Math.round(left)), [`sinbin${n}_text`]: Clock.format(left) });
    if (n >= 6) break;
  }
  d.sinbin_count = String(n);
  // Cards in force for each team, for the card slots on a score bug: sendings-off first, then the players in the sin bin.
  // Four slots per team; an empty slot has empty values (set the colour field to "transparent when there is no value").
  for (const k of ['A', 'B']) {
    const reds = ((sp.derived && sp.derived.reds) || []).filter((r) => r.team === k).map((r) => ({ card: r.card, name: r.name, number: r.number, left: 0 }));
    const bins = ((sp.derived && sp.derived.sinbins) || []).filter((b) => b.team === k && Number(b.untilGt) - gt > 0).map((b) => ({ card: b.card, name: b.name, number: b.number, left: Number(b.untilGt) - gt }));
    const list = reds.concat(bins).slice(0, 4);
    d[`team${k}_cards`] = String(list.length);
    for (let i = 0; i < 4; i++) {
      const x = list[i], p = `team${k}_card${i + 1}`;
      d[p + '_color'] = x ? Sports.cardColor(sp.sport, x.card) : ''; d[p + '_key'] = x ? x.card : ''; d[p + '_name'] = x ? x.name || '' : '';
      d[p + '_number'] = x ? String(x.number === undefined ? '' : x.number) : ''; d[p + '_text'] = x && x.left > 0 ? Clock.format(x.left) : '';
    }
  }
  return d;
}
const sportClient = (sp, now) => ({ sport: sp.sport, version: sp.version, setup: sp.setup, events: sp.events,
  clocks: Object.fromEntries(Object.entries(sp.clocks).map(([k, c]) => [k, { running: c.running, ticking: Clock.ticking(c, now), baseMs: c.baseMs, startedAt: c.startedAt, direction: c.direction, limitMs: c.limitMs, stopAtLimit: c.stopAtLimit, valueMs: Clock.value(c, now) }])), serverNow: now });

function makeLive(app) {
  const sessions = new Map();           // fixture id ('' = nothing chosen) -> session
  const loading = new Map();
  const clients = new Set();
  const gfx = app.gfx || null;
  let seq = 0;
  const timeline = makeTimeline(app);
  app.timeline = timeline;
  // MIDI / X-keys bridge pages, and input mappings (a key, note, GPI or OSC message runs actions)
  const bridgeClients = () => [...clients].filter((c) => c.cgRole === 'bridge' && c.bridgeOk);
  const countBridges = () => { if (app.devices) app.devices.setBridges(bridgeClients().length, (m) => { for (const c of bridgeClients()) c.ws.send(Object.assign({ type: 'bridgeOut' }, m)); }); };
  // a hardware button, MIDI note, GPI or OSC message: screens can use it as a shortcut, and "Learn" listens for it
  if (app.devices) app.devices.on('input', (x) => { for (const c of clients) if (c.cgRole !== 'output' && c.cgRole !== 'bridge') c.ws.send(Object.assign({ type: 'devInput' }, x)); });
  if (app.devices && gfx) {
    app.devices.on('mapping', (m, value) => {
      const fx = gfx.fixtureId ? app.cache.get(gfx.fixtureId) : null;
      actor.run({ via: 'Input', name: m.label || m.when }, () => gfx.runActions(m.actions || [], { team: fx ? fx.team : '', label: 'Input ' + (m.label || m.when), vars: { value } })).catch((e) => log('Input mapping:', e.message));
    });
  }

  const data = async (id) => { if (!id) return null; const d = await app.store.get(id); return d && !d.deleted ? d.data : null; };

  // ---------------------------------------------------------------- building a match from the fixture
  const cricketTeam = (t) => ({ name: t.name, shortName: t.short, logo: t.logo || '', color1: t.color1, color2: t.color2, coach: t.coach || '',
    players: t.players.map((p) => ({ id: p.id, name: p.name, tvName: Cricket.defaultTvName(p.name), role: p.position || '', captain: !!p.captain, keeper: /keeper|\bwk\b/i.test(p.position || ''), photo: p.image || '', number: p.number || '' })) });
  const sportTeam = (t) => ({ name: t.name, short: t.short, logo: t.logo || '', color1: t.color1, color2: t.color2, coach: t.coach || '',
    players: t.players.map((p) => ({ id: p.id, name: p.name, tvName: Cricket.defaultTvName(p.name), number: p.number || '', position: p.position || '', photo: p.image || '' })) });
  const commsOf = (f) => String(f.commentators || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  // "Referee: A Name" per line on the match. A line without a role takes the sport's role in that position.
  const officialsFrom = (f, sportId) => { const roles = Sports.officialRoles(sportId); return String(f.officials || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((x, i) => { const m = /^([^:]{1,40}):\s*(.*)$/.exec(x); return m ? { role: m[1].trim(), name: m[2].trim() } : { role: roles[i] || 'Official', name: x }; }); };
  // The same lines for cricket: umpires, TV umpire, fourth umpire, match referee (by role name, else in that order).
  const cricketOfficials = (f) => {
    const list = officialsFrom(f, 'cricket'); if (!list.length) return null;
    const out = {}, rest = [];
    for (const o of list) {
      const r = o.role.toLowerCase();
      const k = /tv|third|3rd/.test(r) ? 'tvUmpire' : /fourth|4th|reserve/.test(r) ? 'fourthUmpire' : /referee/.test(r) ? 'referee' : /umpire/.test(r) ? (out.umpire1 === undefined ? 'umpire1' : 'umpire2') : '';
      if (k && out[k] === undefined) out[k] = o.name; else rest.push(o.name);
    }
    for (const k of ['umpire1', 'umpire2', 'tvUmpire', 'fourthUmpire', 'referee']) if (out[k] === undefined && rest.length) out[k] = rest.shift();
    return out;
  };
  const fixtureName = (f) => f.name || f.autoName || 'Match';

  function computeSport(sp) {
    if (!sp.setup || !sp.setup.sport || !Sports.SPORTS[sp.setup.sport]) { sp.sport = ''; sp.derived = null; sp.flat = {}; return null; }
    const v = Sports.compute(sp.setup, sp.events || []);
    sp.sport = sp.setup.sport; sp.derived = derivedOf(v); sp.flat = v.flat;
    return v;
  }
  function resetClocks(sp, v) {
    for (const name of ['game', 'shot']) {
      const c = v && v.clock && v.clock[name];
      if (!c) continue;
      sp.clocks[name] = Clock.make({ direction: c.dir < 0 ? -1 : 1, limitMs: c.limitMs || 0, stopAtLimit: !!c.stopAtLimit, baseMs: c.startMs === undefined ? (c.dir < 0 ? c.limitMs : 0) : c.startMs });
    }
  }

  async function seed(doc) {
    const f = doc.data, sp = Scoring.sportFor(f.sport);
    const teams = await app.domain.snapshotTeams(f);
    const comp = (await data(f.competition)) || {}, venue = (await data(f.venue)) || {};
    const compName = [comp.name, comp.season].filter(Boolean).join(' ');
    if (sp && sp.id === 'cricket') {
      const m = Cricket.newMatch();
      m.commentators = commsOf(f);
      if (cricketOfficials(f)) Object.assign(m.officials, cricketOfficials(f));
      Object.assign(m, { tournament: compName, matchTitle: f.name || '', venue: venue.name || '', city: venue.city || '', teamA: cricketTeam(teams[0]), teamB: cricketTeam(teams[1]) });
      const e = new Cricket.Engine(m);
      const k = Scoring.keyOf(f.sport);
      const fmt = /test/.test(k) ? 'TEST' : /firstclass|fc$/.test(k) ? 'FC' : /odi|oneday|50/.test(k) ? 'ODI' : /t10/.test(k) ? 'T10' : /hundred|100/.test(k) ? '100' : '';
      const chosen = Scoring.formatFor(f.sport, f.format) || Scoring.formatFor(f.sport, comp.format);
      if (chosen || fmt) e.setup({ format: chosen || fmt });
      return { kind: 'cricket', engine: e, sport: blankSport() };
    }
    const s = blankSport();
    if (sp) {
      const setup = Sports.newSetup(sp.id, Scoring.formatFor(f.sport, f.format) || Scoring.formatFor(f.sport, comp.format) || sp.variant || undefined);
      Object.assign(setup, { title: fixtureName(f), competition: compName, venue: [venue.name, venue.city].filter(Boolean).join(', ') });
      setup.teams = { A: sportTeam(teams[0]), B: sportTeam(teams[1]) };
      setup.commentators = commsOf(f);
      if (officialsFrom(f, sp.id).length) setup.officials = officialsFrom(f, sp.id);
      if (Sports.SPORTS[sp.id].kind === 'timed') {
        if (Number(f.totalPeriods) > 0) setup.options.periods = Number(f.totalPeriods);
        if (Number(f.periodLength) > 0) setup.options.periodMin = Number(f.periodLength);
      }
      s.setup = setup;
      resetClocks(s, computeSport(s));
    }
    return { kind: 'sport', engine: new Cricket.Engine(Cricket.newMatch()), sport: s };
  }

  // The match is the source for who is playing: names, colours, logos, squads, competition and venue are taken from it
  // every time the scorer opens and whenever they change, also after scoring has started. Returns true when something changed.
  async function pullMatch(s, doc) {
    const f = doc.data, teams = await app.domain.snapshotTeams(f);
    const comp = (await data(f.competition)) || {}, venue = (await data(f.venue)) || {};
    const compName = [comp.name, comp.season].filter(Boolean).join(' ');
    // The sport on the match decides the scorer. A session saved under another sport (the match was changed from rugby to
    // cricket, say) is started again from the match, unless scoring had already begun.
    const want = Scoring.sportFor(f.sport), have = s.kind === 'cricket' ? 'cricket' : (s.sport.setup && s.sport.setup.sport) || '';
    s.sportClash = '';
    if (want && have && want.id !== have) {
      let started = false;
      try { started = !!Scoring.summary(liveOf(s)).started; } catch { /* treat as not started */ }
      if (!started) { Object.assign(s, await seed(doc), { sportUndo: [] }); return true; }
      s.sportClash = `This match was scored as ${(Sports.SPORTS[have] && Sports.SPORTS[have].name) || have} and is now set to ${f.sport}. Use "Start scoring again" to score it as ${f.sport}.`;
    }
    const before = JSON.stringify(s.kind === 'cricket' ? [s.engine.match.teamA, s.engine.match.teamB, s.engine.match.tournament, s.engine.match.venue, s.engine.match.commentators, s.engine.match.officials] : s.sport.setup);
    if (s.kind === 'cricket') {
      const m = s.engine.match;
      teams.forEach((t, i) => {
        if (!t.fromMatch) return;
        const cur = i ? m.teamB : m.teamA, next = cricketTeam(t);
        if (!t.id) { cur.name = next.name; cur.shortName = next.shortName; return; }                 // named in the match title only
        if (!next.players.length) next.players = cur.players;
        else next.players = next.players.map((p) => Object.assign({}, (cur.players || []).find((x) => x.id === p.id) || {}, p, { tvName: ((cur.players || []).find((x) => x.id === p.id) || {}).tvName || p.tvName }));
        Object.assign(cur, next);
      });
      if (compName) m.tournament = compName;
      if (venue.name) { m.venue = venue.name; m.city = venue.city || ''; }
      if (f.name) m.matchTitle = f.name;
      if (commsOf(f).length) m.commentators = commsOf(f);
      if (cricketOfficials(f)) Object.assign(m.officials, cricketOfficials(f));
    } else {
      const sp = Scoring.sportFor(f.sport);
      if (!s.sport.setup || !s.sport.setup.sport) {
        if (!sp || sp.id === 'cricket') return false;
        Object.assign(s, await seed(doc));                                                           // opened before the sport was known
        return true;
      }
      const su = s.sport.setup;
      su.title = fixtureName(f);
      if (compName) su.competition = compName;
      if (venue.name) su.venue = [venue.name, venue.city].filter(Boolean).join(', ');
      if (commsOf(f).length) su.commentators = commsOf(f);
      if (officialsFrom(f, su.sport).length) su.officials = officialsFrom(f, su.sport);
      teams.forEach((t, i) => {
        if (!t.fromMatch) return;
        const k = i ? 'B' : 'A', cur = su.teams[k] || {}, next = sportTeam(t);
        if (!t.id) { su.teams[k] = Object.assign({}, cur, { name: next.name, short: next.short }); return; }
        if (!next.players.length) next.players = cur.players || [];
        su.teams[k] = next;
      });
    }
    const after = JSON.stringify(s.kind === 'cricket' ? [s.engine.match.teamA, s.engine.match.teamB, s.engine.match.tournament, s.engine.match.venue, s.engine.match.commentators, s.engine.match.officials] : s.sport.setup);
    if (after === before) return false;
    if (s.kind !== 'cricket') { computeSport(s.sport); s.sport.version++; }
    return true;
  }

  function fromLive(live) {
    if (live.kind === 'cricket' && live.match) return { kind: 'cricket', engine: new Cricket.Engine(clone(live.match)), sport: blankSport() };
    const s = Object.assign(blankSport(), clone({ sport: live.sport || '', version: live.version || 0, setup: live.setup || null, events: live.events || [], clocks: live.clocks || {} }));
    s.clocks = Object.assign(newClocks(), Object.fromEntries(Object.entries(s.clocks).map(([k, c]) => [k, Clock.make(c)])));
    try { computeSport(s); } catch (e) { log('Could not read sport match:', e.message); }
    return { kind: 'sport', engine: new Cricket.Engine(Cricket.newMatch()), sport: s };
  }
  const liveOf = (s) => (s.kind === 'cricket' ? { kind: 'cricket', match: s.engine.match }
    : { kind: 'sport', sport: s.sport.sport, version: s.sport.version, setup: s.sport.setup, events: s.sport.events, clocks: s.sport.clocks });

  async function dlsTable(team) { const org = await data(team); return org && Cricket.validTable(org.dlsTable) ? org.dlsTable : null; }
  async function recompute(s) { s.stats = Cricket.compute(s.engine.match, { dlsTable: s.id ? await dlsTable(s.team) : null }); }

  async function build(id) {
    let s;
    if (!id) s = { id: '', team: '', kind: 'cricket', engine: new Cricket.Engine(Cricket.newMatch()), sport: blankSport(), pristine: true };
    else {
      const doc = await app.store.get(id);
      if (!doc || doc.deleted || doc.type !== 'fixture') fail(404, 'Match not found');
      s = Object.assign({ id, team: doc.team, pristine: !doc.data.live }, doc.data.live ? fromLive(doc.data.live) : await seed(doc));
      s.lastWrite = doc.updatedAt; s.name = fixtureName(doc.data);
      if (doc.data.live) { try { s.pulled = await pullMatch(s, doc); } catch (e) { log('Could not refresh match data:', e.message); } }
    }
    Object.assign(s, { sportUndo: [], chain: Promise.resolve() });
    await recompute(s);
    if (s.pulled) { s.pulled = false; await persist(s, '').catch((e) => log('Could not save refreshed match data:', e.message)); s.pristine = false; }
    return s;
  }
  function session(id) {
    id = id || '';
    if (sessions.has(id)) return Promise.resolve(sessions.get(id));
    if (!loading.has(id)) loading.set(id, build(id).then((s) => { sessions.set(id, s); return s; }).finally(() => loading.delete(id)));
    return loading.get(id);
  }

  async function persist(s, userId) {
    if (!s.id) return;
    const doc = await app.store.get(s.id);
    if (!doc || doc.deleted) fail(404, 'This match was deleted');
    const d = Object.assign({}, doc.data, { live: clone(liveOf(s)) });
    const r = Scoring.summary(d.live);
    d.result = r;
    if (r.finished) d.status = 'Completed';
    else if (r.started && ['Upcoming', 'Completed', '', undefined].includes(d.status)) d.status = 'Live';
    s.pristine = false;
    s.lastWrite = Infinity;                      // our own write: do not treat it as an outside change
    const saved = await app.save(doc.team, 'fixture', s.id, d, userId);
    s.lastWrite = saved.updatedAt;
  }

  // Every time a screen opens a match its teams, competition and venue are checked against the match record, so a scorer
  // can never be left on "TEAM A v TEAM B" by an older session.
  function freshen(s) {
    if (!s.id) return Promise.resolve();
    const run = async () => {
      const d = await app.store.get(s.id);
      if (!d || d.deleted) return;
      if (s.pristine && !d.data.live) { Object.assign(s, await seed(d), { name: fixtureName(d.data) }); await recompute(s); s.pullError = ''; return; }
      if (await pullMatch(s, d)) { s.name = fixtureName(d.data); await recompute(s); await persist(s, ''); }
      s.pullError = '';
    };
    s.chain = (s.chain || Promise.resolve()).then(run, run).catch((e) => { s.pullError = e.message; log('Could not read the match data for', s.name || s.id, '-', e.stack || e.message); });
    return s.chain;
  }

  // Outside changes: a sync from another machine, an edit in the app, squads changing before scoring starts.
  let reseedTimer = null, pullTimer = null;
  app.on('doc', (doc) => {
    const s = sessions.get(doc.id);
    if (s && doc.type === 'fixture') {
      if (doc.deleted) { sessions.delete(doc.id); return; }
      if (doc.updatedAt > s.lastWrite) {
        s.lastWrite = doc.updatedAt; s.name = fixtureName(doc.data);
        if (doc.data.live) { Object.assign(s, fromLive(doc.data.live), { pristine: false, sportUndo: [] }); recompute(s).then(() => afterChange(s)).catch(() => {}); }   // and then the teams are pulled from the match, below
      }
    }
    if (['squad', 'club', 'player', 'fixture', 'competition', 'venue'].includes(doc.type) && [...sessions.values()].some((x) => !x.pristine && x.id && x.team === doc.team)) {
      clearTimeout(pullTimer);
      pullTimer = setTimeout(async () => {
        for (const x of [...sessions.values()]) {
          if (x.pristine || !x.id) continue;
          const run = async () => { const d = await app.store.get(x.id); if (d && !d.deleted && d.data.live && await pullMatch(x, d)) { x.name = fixtureName(d.data); await recompute(x); await persist(x, ''); await afterChange(x); } };
          x.chain = x.chain.then(run, run).catch((e) => log('Could not refresh match data:', e.message));
        }
      }, 300);
    }
    if (['squad', 'club', 'player', 'fixture', 'competition', 'venue', 'org'].includes(doc.type) && [...sessions.values()].some((x) => x.pristine && x.id && x.team === doc.team)) {
      clearTimeout(reseedTimer);
      reseedTimer = setTimeout(async () => {
        for (const x of [...sessions.values()]) {
          if (!x.pristine || !x.id) continue;
          try { const d = await app.store.get(x.id); if (d && !d.deleted && !d.data.live) { Object.assign(x, await seed(d), { name: fixtureName(d.data) }); await recompute(x); await afterChange(x); } } catch { /* next change retries */ }
        }
      }, 250);
    }
  });

  // Every value any sport can send (score, sets, clocks, cards, stats…), with the sports that have it. For the link picker.
  let sportKeyCache = null;
  function sportKeys() {
    if (sportKeyCache) return sportKeyCache;
    const m = new Map();
    for (const id of Object.keys(Sports.SPORTS)) {
      try {
        const sp = blankSport(); sp.setup = Sports.newSetup(id);
        resetClocks(sp, computeSport(sp));
        for (const k of Object.keys(Object.assign({}, sp.flat, liveKeys(sp, Date.now())))) { if (!m.has(k)) m.set(k, []); m.get(k).push(Sports.SPORTS[id].name || id); }
      } catch (e) { log('No sample values for', id, '-', e.message); }
    }
    const n = Object.keys(Sports.SPORTS).length;
    sportKeyCache = [...m].map(([key, list]) => ({ key, note: list.length >= n ? 'all sports' : list.length > 4 ? list.slice(0, 4).join(', ') + ' +' + (list.length - 4) : list.join(', ') }));
    return sportKeyCache;
  }

  // ---------------------------------------------------------------- scorer buttons and macros, kept per theme
  // With a theme in use they live on the theme (so a broadcaster's look brings its own button mapping); without one, on the team.
  const padSport = (s) => (s.kind === 'cricket' ? 'cricket' : (s.sport.setup && s.sport.setup.sport) || '');
  async function padHome(s) {
    const th = gfx && gfx.themeState() && gfx.themeState().active;
    if (th && th.id) { const d = await app.store.get(th.id); if (d && !d.deleted) return { doc: d, where: { kind: 'theme', name: th.name || 'Theme' } }; }
    const d = s.team ? await app.store.get(s.team) : null;
    return d && !d.deleted ? { doc: d, where: { kind: 'standard', name: 'Standard (no theme)' } } : null;
  }
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  function cleanPad(p) {
    p = p && typeof p === 'object' ? p : {};
    const acts = (a) => (gfx ? gfx.cleanActions(a) : []);
    const buttons = {};
    for (const [k, b] of Object.entries(p.buttons && typeof p.buttons === 'object' ? p.buttons : {}).slice(0, 300)) {
      if (!b || typeof b !== 'object' || !k) continue;
      const x = { label: str(b.label, 40), color: /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(b.color || '') ? b.color : '', hidden: !!b.hidden, more: !!b.more, order: Number.isFinite(Number(b.order)) ? Number(b.order) : 0, actions: acts(b.actions) };
      if (x.label || x.color || x.hidden || x.more || x.order || x.actions.length) buttons[str(k, 120)] = x;
    }
    const custom = (Array.isArray(p.custom) ? p.custom : []).slice(0, 60).filter((b) => b && str(b.label, 40).trim())
      .map((b) => ({ id: str(b.id || newId('btn'), 40), label: str(b.label, 40).trim(), color: /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(b.color || '') ? b.color : '', more: !!b.more, team: b.team === 'A' || b.team === 'B' ? b.team : '', actions: acts(b.actions) }));
    // shortcuts: a keyboard key and / or a hardware input (MIDI note, X-keys key, GPI, OSC) per button and team
    const shortcuts = {};
    for (const [k, x] of Object.entries(p.shortcuts && typeof p.shortcuts === 'object' ? p.shortcuts : {}).slice(0, 400)) {
      if (!x || typeof x !== 'object' || !k) continue;
      const y = { key: str(x.key, 30), input: str(x.input, 120).replace(/^\{|\}$/g, '') };
      if (y.key || y.input) shortcuts[str(k, 160)] = y;
    }
    return { buttons, custom, shortcuts };
  }
  async function padsOf(s) {
    const home = s.id ? await padHome(s) : null;
    if (!home) return { pad: { buttons: {}, custom: [] }, macros: [], where: null };
    const all = home.doc.data.scorerPads || {};
    return { pad: cleanPad(all[padSport(s)]), macros: Array.isArray(home.doc.data.macros) ? home.doc.data.macros : [], where: Object.assign({ sport: padSport(s) }, home.where) };
  }

  // ---------------------------------------------------------------- state for the screens
  const onAirSession = () => sessions.get((gfx && gfx.fixtureId) || '') || null;
  if (gfx) {
    gfx.setProvider(() => { const s = onAirSession(); return s ? { match: s.engine.match, stats: s.stats, sport: s.kind === 'sport' ? s.sport : null, liveKeys: () => (s.kind === 'sport' ? liveKeys(s.sport, Date.now()) : {}), team: s.team } : null; });
    gfx.onMessage((msg) => {
      if (msg.type === 'output') for (const c of clients) { if (c.cgRole === 'output') c.ws.send(msg); }
      if (msg.type === 'log') for (const c of clients) { if (c.cgRole !== 'output') c.ws.send(msg); }
      if (msg.type === 'changed') broadcastAll();
      if (msg.type === 'catalog') for (const c of clients) { if (c.cgRole !== 'output') c.ws.send({ type: 'catalog', catalog: gfx.publicCatalog() }); }
      if (msg.type === 'fixture') follow().catch((e) => log('Live:', e.message));
    });
  }
  // Screens opened without a match in their address follow whatever match is on air.
  async function follow() {
    const s = await session(gfx ? gfx.fixtureId : '');
    for (const c of clients) if (c.follow && c.sess !== s) { c.sess = s; c.role = await roleFor(c, s); c.ws.send({ type: 'welcome', clientId: c.id, catalog: gfx ? gfx.publicCatalog() : [], log: gfx ? gfx.log() : [] }); }
    await broadcastAll();
  }

  async function stateOf(s) {
    const now = Date.now(), air = !!gfx && (gfx.fixtureId || '') === s.id;
    const org = s.team ? await data(s.team) : null;
    return { type: 'state', match: s.engine.match, stats: s.stats, undoDepth: s.engine.undoDepth, mode: s.kind === 'sport' ? 'sport' : 'cricket', sport: sportClient(s.sport, now), sportUndo: s.sportUndo.length,
      gfx: { onAir: gfx ? gfx.onAirList() : [], strip: gfx ? gfx.strip : '', autoWipes: gfx ? gfx.autoWipes : false, triggersOn: gfx ? gfx.triggersOn : false },
      caspar: gfx ? gfx.casparState() : { connected: false, enabled: false, endpoint: '', version: '', settings: { enabled: false, host: '', port: 5250, programChannel: 1, previewChannel: 2, defaultFormat: 'json', clearAfterStopMs: 1500 } },
      clients: [...clients].filter((c) => c.sess === s).map((c) => ({ id: c.id, name: c.name, role: c.cgRole, address: c.address })),
      captions: (org && Array.isArray(org.captions) ? org.captions : []),
      presets: (org && Array.isArray(org.gfxPresets) ? org.gfxPresets : []),
      pads: await padsOf(s),
      devices: app.devices ? { list: app.devices.state(), kinds: app.devices.kinds } : null,
      rfp: { version: app.version, pullError: s.pullError || s.sportClash || '', theme: gfx ? gfx.themeState() : null, fixtureId: s.id, name: s.name || '', team: s.team, accent: /^#[0-9a-f]{6}$/i.test((org && org.accentColor) || '') ? org.accentColor : '', onAir: air, onAirFixture: gfx ? gfx.fixtureId || '' : '', local: !!gfx, formats: Object.entries(Cricket.FORMATS).map(([id, f]) => ({ id, label: f.label })), playlist: gfx ? gfx.playlistState() : null } };
  }
  async function broadcast(s) {
    const list = [...clients].filter((c) => c.sess === s);
    if (!list.length) return;
    const msg = await stateOf(s);
    for (const c of list) c.ws.send(msg);
  }
  async function broadcastAll() { for (const s of new Set([...clients].map((c) => c.sess).filter(Boolean))) await broadcast(s); }
  async function afterChange(s) {
    if (gfx && onAirSession() === s) await gfx.refreshLive();
    await broadcast(s);
  }
  async function lists(s) {
    const sp = s.id ? ((await data(s.id)) || {}).sport : '';
    const k = Scoring.keyOf(sp);
    const squads = s.team ? (await app.store.list(s.team, 'squad')).filter((d) => !k || Scoring.keyOf(d.data.sport) === k) : [];
    const clubs = new Map();
    for (const d of squads) if (d.data.club && !clubs.has(d.data.club)) clubs.set(d.data.club, await data(d.data.club));
    return { type: 'lists', matches: [], teams: squads.map((d) => Schema.ENTITIES.squad.title(d.data, (id) => clubs.get(id) || null)).sort() };
  }

  // ---------------------------------------------------------------- actions
  const int = (d, k) => { const v = d[k]; if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
  const need = (s) => { if (!s.id) fail(400, 'Choose a match first (open the scorer from a fixture in RFP Manager).'); };

  async function handleScore(c, s, action, d) {
    need(s);
    if (action === 'newMatch' && s.kind !== 'cricket') {      // scored as another sport before: start again as the match now says
      const doc = await app.store.get(s.id), sp = Scoring.sportFor(doc.data.sport);
      if (sp && sp.id === 'cricket') { Object.assign(s, await seed(doc), { sportUndo: [], sportClash: '' }); await recompute(s); await persist(s, c.user ? c.user.id : ''); await afterChange(s); return; }
    }
    if (s.kind !== 'cricket') fail(400, 'This match is not cricket. Use the Sports scorer.');
    const e = s.engine;
    let wipe = null, pre = null;
    switch (action) {
      case 'setup': e.setup(d); break;
      case 'team': e.setTeam(d); break;
      case 'toss': e.setToss(d); break;
      case 'officials': e.setOfficials(d); break;
      case 'commentators': e.setCommentators(Array.isArray(d.list) ? d.list : []); break;
      case 'result': e.setResultOverride(String(d.text || '')); break;
      case 'startInnings': e.startInnings(d.battingTeam, { superOver: !!d.superOver }); break;
      case 'superOver': e.startInnings(d.battingTeam, { superOver: true }); break;
      case 'endInnings': e.endInnings(false); break;
      case 'declare': e.endInnings(true); break;
      case 'selectInnings': e.selectInnings(int(d, 'index') === null ? -1 : int(d, 'index')); break;
      case 'inningsOptions': e.setInningsOptions(int(d, 'maxOvers'), int(d, 'target')); break;
      case 'interruption': { const o = int(d, 'overs'); if (o === null) throw new Cricket.ScoringError('Enter the new number of overs'); e.addInterruption(o, d.note, int(d, 'innings')); break; }
      case 'deleteInterruption': e.deleteInterruption(int(d, 'innings'), int(d, 'index')); break;
      case 'editInterruption': e.editInterruption(int(d, 'innings'), int(d, 'index'), d); break;
      case 'startOvers': e.setStartOvers(int(d, 'innings'), int(d, 'overs')); break;
      case 'dls': e.setDls(d); break;
      case 'target': e.setTargetOverride(int(d, 'target')); break;
      case 'dlsTable': {
        const r = Cricket.parseTable(d.text);
        if (r.error) throw new Cricket.ScoringError(r.error);
        const org = await app.store.get(s.team);
        await app.save(s.team, 'org', s.team, Object.assign({}, org.data, { dlsTable: r.rows }), c.user ? c.user.id : '');
        break;
      }
      case 'dlsTableReset': { const org = await app.store.get(s.team); const { dlsTable: _x, ...rest } = org.data; await app.save(s.team, 'org', s.team, rest, c.user ? c.user.id : ''); break; }
      case 'striker': e.setStriker(d.id || null); break;
      case 'nonStriker': e.setNonStriker(d.id || null); break;
      case 'newBatter': e.newBatter(d.id); break;
      case 'bowler': e.setBowler(d.id || null, !!d.force); break;
      case 'swap': e.swapStrike(); break;
      case 'ball':
        pre = cricketSnap(s);
        e.addBall(d);
        if (d.wicket && d.wicket.kind !== 'retiredhurt') wipe = 'wipe_wicket';
        else if (d.boundary && Number(d.runs) === 6 && !d.extra) wipe = 'wipe_six';
        else if (d.boundary && Number(d.runs) === 4 && !d.extra) wipe = 'wipe_four';
        break;
      case 'penalty': e.addPenalty(int(d, 'runs') === null ? 5 : int(d, 'runs')); break;
      case 'undo': e.undo(); break;
      case 'editBall': e.editBall(Object.assign({}, d, { seq: int(d, 'seq'), innings: int(d, 'innings') === null ? -1 : int(d, 'innings') })); break;
      case 'deleteBall': e.deleteBall(int(d, 'innings') === null ? -1 : int(d, 'innings'), int(d, 'seq')); break;
      case 'newMatch': {                               // start the scoring again; who is playing and the rules still come from the match
        const doc = await app.store.get(s.id);
        Object.assign(s, await seed(doc));
        break;
      }
      default: throw new Cricket.ScoringError(`Unknown scoring action '${action}'`);
    }
    // Saving the Match Setup form with empty boxes must not wipe what the match gives the scorer (competition, venue, teams).
    if (action === 'setup') { const doc = await app.store.get(s.id); if (doc && !doc.deleted) await pullMatch(s, doc); }
    await recompute(s);
    await persist(s, c.user ? c.user.id : '');
    if (gfx && onAirSession() === s) {
      await gfx.refreshLive();
      if (wipe && gfx.autoWipes) await gfx.show(wipe, {}, null, false, s.team);
    }
    if (pre) cricketEvents(s, pre, d);
    await broadcast(s);
  }
  // ---- game events for game triggers (a six, a wicket, a try, a red card …)
  function cricketSnap(s) {
    const st = s.stats, inn = st && st.currentIndex >= 0 ? st.innings[st.currentIndex] : null;
    return inn ? { index: inn.index, overComplete: inn.overComplete, complete: inn.complete, overs: inn.overList.length, runs: new Map(inn.batting.map((b) => [b.playerId, b.runs])) } : null;
  }
  function cricketEvents(s, pre, d) {
    if (!app.automation || onAirSession() !== s) return;
    const st = s.stats, inn = st && st.innings.find((x) => x.index === pre.index);
    if (!inn) return;
    const team = inn.battingTeam === 'B' ? 'B' : 'A', ex = String(d.extra || '').toLowerCase(), runs = Number(d.runs) || 0, fire = (kind, also, text, player) => app.automation.gameEvent({ fixtureId: s.id, kind, also, team, text, player: player || '' });
    const kinds = ['ball'];
    if (ex) kinds.push('extra');
    if (ex === 'wd') kinds.push('wide'); if (ex === 'nb') kinds.push('noball');
    const wicket = d.wicket && d.wicket.kind !== 'retiredhurt';
    if (wicket) kinds.push('wicket');
    if (d.boundary && !ex && runs === 6) kinds.push('six', 'boundary'); else if (d.boundary && !ex && runs === 4) kinds.push('four', 'boundary');
    if (!ex && !runs && !wicket) kinds.push('dot');
    const main = kinds.find((k) => ['wicket', 'six', 'four', 'wide', 'noball', 'dot'].includes(k)) || 'ball';
    fire(main, kinds, inn.lastBallLabel || main);
    for (const b of inn.batting) { const was = pre.runs.get(b.playerId) || 0; if (was < 100 && b.runs >= 100) fire('hundred', [], `${b.tvName} ${b.runs}`, b.playerId); else if (was < 50 && b.runs >= 50) fire('fifty', [], `${b.tvName} ${b.runs}`, b.playerId); }
    if (inn.overComplete && !pre.overComplete) { const o = inn.overList[inn.overList.length - 1]; fire(o && !o.runs ? 'maiden' : 'over', o && !o.runs ? ['over'] : [], `Over ${o ? o.over : ''}`); }
    if (inn.complete && !pre.complete) fire('innings', [], inn.completeReason || 'End of the innings');
  }
  function sportEvents(s, before) {
    if (!app.automation || onAirSession() !== s) return;
    const had = new Set((before || []).map((x) => x && x.id)), now = s.sport.events || [];
    for (const ev of now) {
      if (!ev || had.has(ev.id)) continue;
      const t = String(ev.type || ''), k = String(ev.key || '').toLowerCase(), also = ['event'];
      let kind = t;
      if (t === 'score') { kind = k || 'score'; also.push('score'); }
      else if (t === 'card') { kind = k.startsWith('yellow') ? 'yellow' : k.startsWith('red') ? 'red' : 'card'; also.push('card', k); }
      else if (t === 'point') also.push('score');
      app.automation.gameEvent({ fixtureId: s.id, kind, also, team: ev.team === 'B' ? 'B' : ev.team === 'A' ? 'A' : '', text: [k || t, ev.text].filter(Boolean).join(' '), player: ev.player || '' });
    }
  }

  async function handleSport(c, s, action, d) {
    need(s);
    const sp = s.sport, now = Date.now();
    let wipe = null, evBefore = null;
    const snap = () => { s.sportUndo.push(JSON.stringify({ setup: sp.setup, events: sp.events })); if (s.sportUndo.length > 300) s.sportUndo.shift(); };
    switch (action) {
      case 'apply': {
        if (s.kind !== 'sport') fail(400, 'This match is cricket. Use the Cricket scorer.');
        if (Number(d.version) !== sp.version) throw new Cricket.ScoringError('VERSION_CONFLICT');
        if (!d.setup || !d.setup.sport) throw new Cricket.ScoringError('Setup has no sport');
        if (!Sports.SPORTS[d.setup.sport]) throw new Cricket.ScoringError('Unknown sport ' + d.setup.sport);
        const before = { setup: sp.setup, events: sp.events };
        snap();
        sp.setup = d.setup; sp.events = Array.isArray(d.events) ? d.events : [];
        evBefore = before.events;
        try { computeSport(sp); } catch (e) { Object.assign(sp, before); s.sportUndo.pop(); computeSport(sp); throw new Cricket.ScoringError('Rules error: ' + e.message); }
        sp.version++;
        wipe = String(d.wipe || '').trim() || null;
        break;
      }
      case 'undo': {
        if (!s.sportUndo.length) throw new Cricket.ScoringError('Nothing to undo');
        Object.assign(sp, JSON.parse(s.sportUndo.pop()));
        computeSport(sp); sp.version++;
        break;
      }
      case 'reset': {                                // start again: teams and rules come from the match, whatever was scored before
        snap();
        const doc = await app.store.get(s.id), again = doc && !doc.deleted ? await seed(doc) : null;
        if (again && again.kind === 'sport' && again.sport.setup) { const ver = sp.version + 1; Object.assign(sp, again.sport, { version: ver }); s.kind = 'sport'; s.sportClash = ''; }
        else Object.assign(sp, blankSport(), { version: sp.version + 1 });
        break;
      }
      case 'clock': {
        const name = d.name || 'game', k = sp.clocks[name] || (sp.clocks[name] = Clock.make());
        const dir = int(d, 'dir'), limit = d.limitMs === undefined || d.limitMs === null ? null : Number(d.limitMs);
        switch (d.action) {
          case 'start': Clock.start(k, now); break;
          case 'stop': Clock.stop(k, now); break;
          case 'toggle': if (k.running) Clock.stop(k, now); else Clock.start(k, now); break;
          case 'set': Clock.set(k, Number(d.ms) || 0, now); break;
          case 'adjust': Clock.set(k, Clock.value(k, now) + (Number(d.delta) || 0), now); break;
          case 'reset':
            Clock.stop(k, now);
            if (dir !== null) k.direction = dir < 0 ? -1 : 1;
            if (limit !== null) k.limitMs = Math.max(0, limit);
            if (typeof d.stopAtLimit === 'boolean') k.stopAtLimit = d.stopAtLimit;
            Clock.set(k, d.startMs === undefined || d.startMs === null ? (k.direction < 0 ? k.limitMs : 0) : Number(d.startMs), now);
            break;
          case 'config':
            if (dir !== null) { const v = Clock.value(k, now); k.direction = dir < 0 ? -1 : 1; Clock.set(k, v, now); }
            if (limit !== null) k.limitMs = Math.max(0, limit);
            if (typeof d.stopAtLimit === 'boolean') k.stopAtLimit = d.stopAtLimit;
            break;
          default: throw new Cricket.ScoringError(`Unknown clock action '${d.action}'`);
        }
        break;
      }
      case 'mode':                                   // "make this the live event": put this match on air
        if (gfx && (d.mode === 'sport') === (s.kind === 'sport')) await gfx.setFixture(s.id);
        return;
      default: throw new Cricket.ScoringError(`Unknown sport action '${action}'`);
    }
    await persist(s, c.user ? c.user.id : '');
    if (gfx && onAirSession() === s) {
      await gfx.refreshLive();
      if (wipe && gfx.autoWipes) await gfx.show('sport_wipe', {}, { text: wipe, type: wipe }, false, s.team);
    }
    if (evBefore) sportEvents(s, evBefore);
    await broadcast(s);
  }

  async function handleGfx(c, s, action, d, requestId) {
    if (!gfx) fail(400, 'Graphics run on the production PC. Open RFP Manager on that machine to control CasparCG.');
    const id = String(d.id || ''), p = d.params && typeof d.params === 'object' ? { playerId: d.params.playerId || null, innings: d.params.innings === undefined ? null : d.params.innings, team: d.params.team || null, stat: d.params.stat === undefined ? null : String(d.params.stat).slice(0, 60) } : {};
    const ov = d.overrides && typeof d.overrides === 'object' ? Object.fromEntries(Object.entries(d.overrides).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])) : null;
    const preview = d.preview === true, team = s.team || c.team;
    switch (action) {
      case 'data': c.ws.send({ type: 'gfxData', requestId, id, data: gfx.buildData(id, p, null, team) }); return 'sent';
      case 'outputs': c.ws.send({ type: 'outputs', layers: gfx.outputSnapshot() }); return;
      case 'show': await gfx.show(id, p, ov, preview, team); break;
      case 'update': await gfx.update(id, p, ov, preview, team); break;
      case 'hide': await gfx.hide(id, preview); break;
      case 'hideKey': await gfx.hideKey(String(d.key || '')); break;
      case 'hideAll': await gfx.hideAll(d.includePreview === true); break;
      case 'invoke': await gfx.invoke(String(d.key || ''), String(d.method || ''), d.fresh); break;
      case 'run': {                                  // a scorer button, a dashboard control: {value} / {label} come from a fader, a list, a box
        const extra = d.vars && typeof d.vars === 'object' ? Object.fromEntries(Object.entries(d.vars).slice(0, 10).filter(([k]) => /^(value|label|value2)$/.test(k)).map(([k, v]) => [k, String(v == null ? '' : v).slice(0, 500)])) : {};
        await gfx.runActions(Array.isArray(d.actions) ? d.actions : [], { team, vars: Object.assign(extra, { team: d.side === 'A' || d.side === 'B' ? d.side : '' }), label: (d.from === 'dash' ? 'Dashboard ' : 'Scorer button ') + String(d.label || '').slice(0, 40) });
        break;
      }
      case 'macro': { const m = gfx.macrosFor(team).find((x) => x && x.id === d.id); if (!m) fail(400, 'That macro no longer exists'); await gfx.runActions(m.actions, { team, vars: { team: d.side === 'A' || d.side === 'B' ? d.side : '' }, label: 'Macro ' + m.name }); break; }
      case 'button': await gfx.runButton(String(d.graphic || ''), Number(d.index) || 0, String(d.key || ''), team, d.fresh); break;
      case 'strip': gfx.strip = d.text; await gfx.refreshLive(); break;
      case 'setvar': { if (!app.automation) fail(400, 'No variables here'); const v = app.automation.set(String(d.key || ''), d.value, d.fixture || ''); c.ws.send({ type: 'varSet', requestId, key: d.key, value: v }); break; }
      case 'autoWipes': gfx.autoWipes = d.enabled === true; break;
      case 'triggers': gfx.triggersOn = d.enabled === true; break;
      case 'captions': {
        if (!team) fail(400, 'Choose a match or production team first');
        const org = await app.store.get(team);
        const list = (Array.isArray(d.list) ? d.list : []).slice(0, 300).map((x) => ({ line1: String((x && x.line1) || '').slice(0, 200), line2: String((x && x.line2) || '').slice(0, 300) }));
        await app.save(team, 'org', team, Object.assign({}, org.data, { captions: list }), c.user ? c.user.id : '');
        break;
      }
      case 'presets': {                              // saved fill-ins for a graphic: its values under a name, one click to load
        if (!team) fail(400, 'Choose a match or production team first');
        const org = await app.store.get(team);
        const str = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).slice(0, 200).map(([k, v]) => [String(k).slice(0, 80), String(v == null ? '' : v).slice(0, 2000)]));
        const list = (Array.isArray(d.list) ? d.list : []).slice(0, 300).filter((x) => x && x.graphic && String(x.name || '').trim())
          .map((x) => ({ id: String(x.id || newId('pre')).slice(0, 40), name: String(x.name).trim().slice(0, 60), graphic: String(x.graphic).slice(0, 80), params: str(x.params), overrides: str(x.overrides) }));
        await app.save(team, 'org', team, Object.assign({}, org.data, { gfxPresets: list }), c.user ? c.user.id : '');
        break;
      }
      default: throw new Cricket.ScoringError(`Unknown graphics action '${action}'`);
    }
    await broadcastAll();
  }

  async function handleStore(c, s, action, d) {
    switch (action) {
      case 'list': c.ws.send(await lists(s)); return;
      case 'loadTeam': {
        need(s);
        const squads = await app.store.list(s.team, 'squad');
        let hit = null;
        for (const q of squads) { const club = await data(q.data.club); if (Schema.ENTITIES.squad.title(q.data, () => club) === d.name) { hit = q; break; } }
        if (!hit) fail(404, 'That team is no longer in RFP Manager');
        const side = d.key === 'B' ? 1 : 0, f = { team1: side === 0 ? hit.id : '', team2: side === 1 ? hit.id : '' };
        const t = (await app.domain.snapshotTeams(f))[side];
        if (s.kind === 'cricket') { s.engine.setTeam(Object.assign({ key: side ? 'B' : 'A' }, cricketTeam(t))); await recompute(s); }
        else if (s.sport.setup) { s.sport.setup.teams[side ? 'B' : 'A'] = sportTeam(t); computeSport(s.sport); s.sport.version++; }
        await persist(s, c.user ? c.user.id : '');
        break;
      }
      case 'saveTeam': fail(400, 'Teams and squads are kept in RFP Manager → Assets → Teams. Edit them there and use "Load" here.'); break;
      case 'saveMatch': fail(400, 'This match saves itself into its fixture after every ball. Use Export for a file copy.'); break;
      case 'loadMatch': fail(400, 'Open another match from Fixtures & Results in RFP Manager.'); break;
      default: throw new Cricket.ScoringError(`Unknown store action '${action}'`);
    }
    c.ws.send(await lists(s));
    await afterChange(s);
  }

  async function handleRfp(c, s, action, d) {
    switch (action) {
      case 'onAir': {
        if (!gfx) fail(400, 'Graphics run on the production PC');
        const id = d.fixtureId || '';
        if (id) { const doc = await app.store.get(id); if (!doc || !Schema.CAN.score(await app.auth.roleIn(c.user, doc.team))) fail(403, 'You cannot put that match on air'); }
        await gfx.setFixture(id || null);
        return;
      }
      case 'theme': {                                // which theme this PC uses: '' automatic, 'none', or a theme
        if (!gfx) fail(400, 'Graphics run on the production PC');
        if (!Schema.CAN.score(c.role)) fail(403, 'You need the Scorer role to change the theme');
        await gfx.setTheme(d.theme || '');
        return;
      }
      case 'pads': case 'macros': {                  // save the scorer button mapping, or the macros, on the theme in use (or the team)
        need(s);
        if (!Schema.CAN.score(c.role) || c.readOnly) fail(403, 'You need the Scorer role to change the buttons');
        const home = await padHome(s);
        if (!home) fail(400, 'Choose a match first');
        const data = Object.assign({}, home.doc.data);
        if (action === 'pads') data.scorerPads = Object.assign({}, data.scorerPads || {}, { [padSport(s)]: cleanPad(d.pad) });
        else data.macros = (Array.isArray(d.list) ? d.list : []).slice(0, 80).filter((m) => m && str(m.name, 60).trim()).map((m) => ({ id: str(m.id || newId('mac'), 40), name: str(m.name, 60).trim(), actions: gfx ? gfx.cleanActions(m.actions) : [] }));
        await app.save(home.doc.team, home.doc.type, home.doc.id, data, c.user ? c.user.id : '');
        await broadcast(s);
        return;
      }
      case 'refreshTeams': {                         // take names, colours, logos and squads from the database again
        need(s);
        if (!Schema.CAN.score(c.role) || c.readOnly) fail(403, 'You need the Scorer role to reload the teams');
        const doc = await app.store.get(s.id), teams = await app.domain.snapshotTeams(doc.data);
        if (s.kind === 'cricket') { teams.forEach((t, i) => s.engine.setTeam(Object.assign({ key: i ? 'B' : 'A' }, cricketTeam(t)))); await recompute(s); }
        else if (s.sport.setup) { s.sport.setup.teams = { A: sportTeam(teams[0]), B: sportTeam(teams[1]) }; computeSport(s.sport); s.sport.version++; }
        await persist(s, c.user ? c.user.id : '');
        await afterChange(s);
        return;
      }
      case 'fixtures': {
        const out = [];
        for (const t of c.user ? await app.auth.teamsFor(c.user) : []) for (const f of await app.store.list(t.id, 'fixture')) out.push({ id: f.id, name: fixtureName(f.data), sport: f.data.sport || '', date: f.data.startDate || '', time: f.data.startTime || '', status: f.data.status || '' });
        c.ws.send({ type: 'rfpFixtures', fixtures: out.sort((a, b) => String(b.date + b.time).localeCompare(String(a.date + a.time))).slice(0, 200) });
        return;
      }
      default: throw new Cricket.ScoringError(`Unknown action '${action}'`);
    }
  }

  async function roleFor(c, s) {
    if (!c.user) return null;
    if (s.team) return app.auth.roleIn(c.user, s.team);
    const teams = await app.auth.teamsFor(c.user);
    c.team = c.team || (teams[0] && teams[0].id) || '';
    return teams.some((t) => Schema.CAN.score(t.role)) ? 'Scorer' : (teams[0] ? teams[0].role : null);
  }

  async function onMessage(c, text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const requestId = m.requestId === undefined ? null : String(m.requestId), d = m.data && typeof m.data === 'object' ? m.data : {}, action = String(m.action || '');
    const s = c.sess;
    try {
      if (m.type === 'ping') return c.ws.send({ type: 'pong' });
      if (m.type === 'hello') {
        c.cgRole = String(m.role || '').slice(0, 20);
        if (!c.user) c.name = String(m.name || 'Screen').slice(0, 40);
        c.ws.send({ type: 'welcome', clientId: c.id, catalog: gfx ? gfx.publicCatalog() : [], log: gfx ? gfx.log() : [] });
        c.ws.send({ type: 'rfp', canScore: Schema.CAN.score(c.role) && !c.readOnly, user: c.name, fixtureId: s.id });
        await freshen(s);
        await broadcast(s);
        c.ws.send(await lists(s));
        if (gfx) c.ws.send({ type: 'outputs', layers: gfx.outputSnapshot() });
        return;
      }
      if (m.type === 'bridge') {                      // the MIDI / X-keys bridge page
        if (!c.user || !Schema.CAN.score(c.role)) fail(403, 'Sign in as a Scorer (or higher) on the bridge page');
        if (action === 'hello') { c.cgRole = 'bridge'; c.bridgeOk = true; countBridges(); c.ws.send({ type: 'bridgeDevices', list: app.devices ? app.devices.bridged() : [] }); }
        else if (action === 'input' && app.devices) app.devices.bridgeIn(d);
        if (requestId !== null) c.ws.send({ type: 'ack', requestId });
        return;
      }
      if (m.type === 'dash') {                        // dashboards: the layout, and every live value while one is open
        const r = await dashHandle(c, action, d);
        if (requestId !== null && r !== 'sent') c.ws.send({ type: 'ack', requestId });
        return;
      }
      if (m.type === 'tl') {                          // Timeline screens (editor, run, crew view)
        if (!c.user && !c.readOnly) fail(403, 'Sign in to RFP Manager first');
        if (c.readOnly && !['open', 'list'].includes(action)) fail(403, 'This screen is view-only. Sign in to RFP Manager to make changes.');
        const r = await timeline.handle(c, action, d);
        if (requestId !== null && r !== 'sent') c.ws.send({ type: 'ack', requestId });
        return;
      }
      const readOnlyOk = (m.type === 'gfx' && (action === 'data' || action === 'outputs')) || (m.type === 'store' && action === 'list') || (m.type === 'rfp' && action === 'fixtures');
      if (!readOnlyOk) {
        if (c.readOnly || !c.user) fail(403, 'This screen is view-only. Sign in to RFP Manager to make changes.');
        if (!Schema.CAN.score(c.role)) fail(403, 'You need the Scorer role to do that');
        if (m.type === 'caspar' && !Schema.CAN.edit(c.role)) fail(403, 'Only an Admin or Producer can change CasparCG settings');
      }
      // scoring happens on the production PC (or a tablet / phone on its network), never through the website
      if ((m.type === 'score' || m.type === 'sport') && (!app.isLocal || c.viaWeb)) fail(403, 'Scoring is done on the production PC, or on a device on its network, not through the website.');
      let handled;
      // One change at a time per match, like the single gate in CricketCG.
      const run = async () => {
        switch (m.type) {
          case 'score': await handleScore(c, s, action, d); break;
          case 'sport': await handleSport(c, s, action, d); break;
          case 'gfx': handled = await handleGfx(c, s, action, d, requestId); break;
          case 'store': await handleStore(c, s, action, d); break;
          case 'rfp': await handleRfp(c, s, action, d); break;
          case 'caspar':
            if (!gfx) fail(400, 'CasparCG is driven from the production PC');
            if (action === 'settings') gfx.saveCasparSettings(d); else if (action === 'reconnect') gfx.amcp.reconnect(); else if (action === 'raw') { if (String(d.command || '').trim()) await gfx.raw(String(d.command).trim()); }
            else if (action === 'devices') app.devices.save(d.list);
            else if (action === 'device') await app.devices.command(String(d.id || ''), String(d.command || ''), String(d.value || ''));
            else throw new Cricket.ScoringError(`Unknown caspar action '${action}'`);
            await broadcastAll();
            break;
          default: return;
        }
      };
      const p = s.chain.then(run, run);
      s.chain = p.catch(() => {});
      await p;
      if (requestId !== null && handled !== 'sent') c.ws.send({ type: 'ack', requestId });
    } catch (e) {
      const known = e instanceof Cricket.ScoringError || e instanceof HttpError;
      if (!known) log('Live error:', m.type, action, e.stack || e.message);
      c.ws.send({ type: 'error', message: known ? e.message : 'Something went wrong on the server', requestId });
    }
  }

  // ---------------------------------------------------------------- dashboards
  async function dashHandle(c, action, d) {
    const team = c.sess && c.sess.team ? c.sess.team : c.team;
    if (action === 'list') {
      const out = [];
      for (const t of c.user ? await app.auth.teamsFor(c.user) : []) for (const x of await app.store.list(t.id, 'dashboard')) out.push({ id: x.id, name: x.data.name || 'Dashboard' });
      c.ws.send({ type: 'dashList', list: out.sort((a, b) => a.name.localeCompare(b.name)) });
      return;
    }
    if (action === 'lists') { c.ws.send({ type: 'dashLists', lists: await dashLists(team || (c.user ? ((await app.auth.teamsFor(c.user))[0] || {}).id : '')) }); return; }
    if (action === 'values') { c.wantValues = d.on !== false; lastValues.delete(c); pushValues(true); return; }
    const doc = await app.store.get(String(d.id || ''));
    if (!doc || doc.deleted || doc.type !== 'dashboard') fail(404, 'Dashboard not found');
    const role = c.user ? await app.auth.roleIn(c.user, doc.team) : null;
    if (c.user && !role) fail(403, 'You are not in the production team this dashboard belongs to');
    if (action === 'open') {
      c.dash = doc.id; c.wantValues = true; lastValues.delete(c);
      c.ws.send({ type: 'dash', id: doc.id, doc: doc.data, can: { edit: !!role && Schema.CAN.edit(role), use: !!role && Schema.CAN.score(role) && !c.readOnly }, lists: await dashLists(doc.team) });
      pushValues(true);
      return;
    }
    if (action === 'save') {
      if (!role || !Schema.CAN.edit(role) || c.readOnly) fail(403, 'You need the Producer role to change a dashboard');
      const data = d.data && typeof d.data === 'object' ? d.data : {};
      const clean = { name: str(data.name || doc.data.name || 'Dashboard', 80), notes: doc.data.notes || '', width: Math.max(320, Math.min(7680, Number(data.width) || 1280)), height: Math.max(240, Math.min(4320, Number(data.height) || 720)),
        theme: ['dark', 'light'].includes(data.theme) ? data.theme : 'dark', grid: Math.max(2, Math.min(80, Number(data.grid) || 10)),
        pages: (Array.isArray(data.pages) ? data.pages : []).slice(0, 30).map((pg) => ({ id: str(pg && pg.id || newId('pg'), 40), name: str(pg && pg.name || 'Page', 40),
          controls: (Array.isArray(pg && pg.controls) ? pg.controls : []).slice(0, 400).filter((x) => x && typeof x === 'object').map((x) => {
            const o = JSON.parse(JSON.stringify(x));
            o.id = str(o.id || newId('ctl'), 40); o.type = str(o.type, 20);
            for (const k of ['x', 'y', 'w', 'h']) o[k] = Math.max(0, Math.min(8000, Math.round(Number(o[k]) || 0)));
            for (const k of ['actions', 'onActions', 'offActions']) if (o[k] !== undefined) o[k] = gfx ? gfx.cleanActions(o[k]) : [];
            return o;
          }) })) };
      if (JSON.stringify(clean).length > 1500000) fail(400, 'This dashboard is too big');
      await app.save(doc.team, 'dashboard', doc.id, clean, c.user.id);
      return;
    }
    fail(400, 'Unknown dashboard action');
  }
  // what dropdowns can list: players of both teams, adverts, playlists, graphics, macros, variables
  async function dashLists(team) {
    const L = (type) => app.store.list(team, type).then((x) => x.filter((y) => !y.deleted));
    return { adverts: (await L('advert')).map((x) => ({ id: x.id, name: x.data.name || '' })), playlists: (await L('playlist')).map((x) => ({ id: x.id, name: x.data.name || '' })),
      timelines: (await L('timeline')).map((x) => ({ id: x.id, name: x.data.name || '' })), variables: app.automation ? app.automation.list() : [], macros: gfx ? gfx.macrosFor(team).map((m) => ({ id: m.id, name: m.name })) : [] };
  }
  // live values to the dashboards that are open: sent when something changed, a few times a second at most
  const lastValues = new Map();
  function pushValues(force) {
    if (!gfx) return;
    const want = [...clients].filter((c) => c.wantValues);
    if (!want.length) return;
    let vals; try { vals = gfx.liveValues(); } catch { return; }
    vals.__onair = JSON.stringify(gfx.onAirList().map((e) => e.graphicId));
    const json = JSON.stringify(vals);
    for (const c of want) { if (!force && lastValues.get(c) === json) continue; lastValues.set(c, json); c.ws.send({ type: 'values', values: vals }); }
  }
  const valuesTimer = setInterval(() => pushValues(false), 250);
  valuesTimer.unref();
  app.on('doc', (doc) => {
    if (doc.type === 'dashboard') for (const c of clients) if (c.dash === doc.id) c.ws.send({ type: 'dash', id: doc.id, doc: doc.data, update: true });
    if (doc.type === 'variable') for (const c of clients) if (c.dash) app.store.get(doc.id).then(() => c.ws.send({ type: 'dashVars', variables: app.automation ? app.automation.list() : [] })).catch(() => {});
  });

  // ---------------------------------------------------------------- connections
  const keyOk = (k) => !!gfx && !!app.config.outputKey && k === app.config.outputKey;
  // came through the website (remote access)? then the address is the person's, not this PC's
  const relayed = (req) => (app.relay && app.relay.identity ? app.relay.identity(req) : undefined);
  const addrOf = (req) => { const r = relayed(req); return r ? r.ip || 'website' : String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''); };

  async function upgrade(req, sock) {
    const q = new URL(req.url, 'http://x').searchParams;
    let user = null, sess = null, err = '', readOnly = false;
    try {
      user = await app.auth.userFromReq(req);
      const viaKey = !user && keyOk(q.get('key') || '');
      if (!user && !viaKey) err = 'Sign in to RFP Manager first (or use the screen link with its key).';
      else {
        const fid = q.get('fixture') || '';
        sess = await session(fid || (gfx ? gfx.fixtureId || '' : ''));
        readOnly = viaKey;
        if (user && sess.team && !(await app.auth.roleIn(user, sess.team))) err = 'You are not in the production team this match belongs to.';
        // The first match a scorer opens on this PC becomes the live production, so every screen follows it without set-up.
        else if (user && fid && gfx && !gfx.fixtureId && sess.id && Schema.CAN.score(await app.auth.roleIn(user, sess.team))) await gfx.setFixture(sess.id);
      }
    } catch (e) { err = e.status ? e.message : 'Could not open this match'; if (!e.status) log('Live connect:', e.stack || e.message); }
    const ws = accept(req, sock);
    if (!ws) return;
    if (err || !sess) { ws.send({ type: 'error', message: err || 'Could not open this match', code: 'AUTH' }); setTimeout(() => ws.close(), 200); return; }
    const c = { id: 'c' + (++seq), ws, user, sess, follow: !q.get('fixture'), readOnly, cgRole: '', name: user ? (user.data.name || user.data.email) : 'Screen', team: q.get('team') || '',
      address: addrOf(req), viaWeb: !!relayed(req), queue: Promise.resolve() };
    c.role = await roleFor(c, sess);
    clients.add(c);
    ws.on('message', (t) => { c.queue = c.queue.then(() => actor.run({ name: c.name, ip: c.address, via: ({ control: 'Graphics control', stats: 'Cricket scorer', sport: 'Scorer', timeline: 'Timeline', worship: 'Worship', commentary: 'Commentary', bridge: 'Hardware bridge' })[c.cgRole] || c.cgRole || 'Screen' }, () => onMessage(c, t))).catch(() => {}); });
    ws.on('close', () => { clients.delete(c); lastValues.delete(c); timeline.drop(c); if (c.bridgeOk) countBridges(); if (c.sess) broadcast(c.sess).catch(() => {}); });
  }

  // ---------------------------------------------------------------- rundown monitor
  const upper = (x) => String(x || '').toUpperCase();
  const longDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  async function clubName(squadId) { const q = await data(squadId); if (!q) return ''; const r = Schema.resolveSquad(q, await data(q.club)); return r.graphicName || r.name; }
  async function rundownHeader(type, d) {
    const venue = (await data(d.venue)) || {};
    let f = type === 'fixture' ? d : null;
    if (!f) { const list = []; for (const r of d.fixtures || []) { const x = await data(r.fixture); if (x) list.push(x); } if (list.length === 1) f = list[0]; }
    const comp = f ? await data(f.competition) : null;
    const teams = f && f.team1 && f.team2 ? `${upper(await clubName(f.team1))}  vs  ${upper(await clubName(f.team2))}` : upper(type === 'fixture' ? fixtureName(d) : d.name);
    const start = type === 'fixture' ? d.startTime : d.txTime || (f && f.startTime);
    return { event: (type === 'production' && d.event) || (comp ? comp.name : '') || (type === 'fixture' ? d.sport : d.type) || '', teams,
      where: [upper(longDate(type === 'fixture' ? d.startDate : d.date)), upper([venue.name, venue.city].filter(Boolean).join(', '))].filter(Boolean).join(', '), start: start ? `${f ? 'KICK OFF' : 'TX'} - ${start}` : '' };
  }
  // Which rundown a monitor shows: the one named in its address, else the match on air (or the production that match is part of).
  async function findRundown(q) {
    for (const type of ['production', 'fixture']) if (q.get(type)) { const d = await app.store.get(q.get(type)); return d && !d.deleted && d.type === type ? d : null; }
    const fx = gfx && gfx.fixtureId ? await app.store.get(gfx.fixtureId) : null;
    if (!fx || fx.deleted) return null;
    if ((fx.data.rundown || []).length) return fx;
    for (const p of await app.store.list(fx.team, 'production')) if ((p.data.rundown || []).length && (p.data.fixtures || []).some((r) => r.fixture === fx.id)) return p;
    return fx;
  }
  async function rundownApi(req, res, q, user, cue) {
    const doc = await findRundown(q);
    if (!doc) { httpSend(res, 200, { empty: true, now: Date.now(), reason: gfx && !gfx.fixtureId ? 'No match is on air. Choose one in RFP Manager, or open this monitor from a rundown.' : 'Rundown not found.' }); return true; }
    const role = user ? await app.auth.roleIn(user, doc.team) : null;
    if (user && !role) fail(403, 'You are not in this production team');
    if (cue) {
      if (!user || !Schema.CAN.score(role)) fail(403, 'Sign in as a Scorer, Producer or Admin to run the rundown');
      const b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}');
      const n = (doc.data.rundown || []).length, i = b.index === null || b.index === undefined ? null : Math.max(0, Math.min(n - 1, Number(b.index) || 0));
      await app.save(doc.team, doc.type, doc.id, Object.assign({}, doc.data, { rundownLive: i === null ? null : { index: i, startedAt: Date.now() } }), user.id);
      httpSend(res, 200, { ok: true });
      return true;
    }
    const d = doc.data, rows = Schema.rundownTimes(d.rundown || [], doc.type === 'fixture' ? d.startTime : '');
    const anchored = !!(doc.type === 'fixture' && d.startTime) || (d.rundown || []).some((r) => /^\d{1,2}:\d{2}/.test(String(r.startTime || '')));
    httpSend(res, 200, { anchored, type: doc.type, id: doc.id, title: doc.type === 'fixture' ? fixtureName(d) : d.name, header: await rundownHeader(doc.type, d), date: (doc.type === 'fixture' ? d.startDate : d.date) || '', now: Date.now(), live: d.rundownLive || null, canCue: !!user && Schema.CAN.score(role),
      rows: rows.map((r) => ({ content: r.content || '', description: r.description || '', source: r.source || '', audio: r.audio || '', graphics: r.graphics || '', color: r.color || '', start: r.start, startText: r.startText, seconds: Schema.parseDuration(r.duration) })) });
    return true;
  }

  // ---------------------------------------------------------------- small HTTP API used by the scorer pages
  // Bitfocus Companion (or a Stream Deck, a script, anything that can call a web address) drives RFP Manager:
  //   /live/api/companion/macro/<name or id>   /timeline/<go|play|pause|stop|prev>[/<timeline id>]   /hideall
  //   /take/<graphic id>   /out/<graphic id>   /device/<device id>/<command>?value=…   /values (every live value as JSON)
  // From this PC no key is needed; from another machine add ?key=<screen key> (Settings → Connections).
  async function companionApi(req, res, q, parts) {
    const ip = addrOf(req);
    const local = (ip === '127.0.0.1' || ip === '::1') && !relayed(req);
    if (!local && !keyOk(q.get('key') || '') && !(await app.auth.userFromReq(req))) fail(401, 'Add ?key=<screen key> (Settings → Connections) to the address');
    if (!gfx) fail(400, 'Companion talks to the production PC');
    const fx = gfx.fixtureId ? app.cache.get(gfx.fixtureId) : null, team = fx ? fx.team : '';
    const w = actor.who(); if (w) { w.via = 'Companion'; w.ip = ip; }
    const [what, a, b] = parts, run = (actions, label) => gfx.runActions(actions, { team, label: 'Companion: ' + label });
    switch (what) {
      case 'values': { const v = gfx.variables('', []).vars; httpSend(res, 200, Object.fromEntries(v.filter((x) => !x.away).map((x) => [x.key, x.value]))); return true; }
      case 'macro': {
        const m = gfx.macrosFor(team).find((x) => x && (x.id === a || String(x.name || '').toLowerCase() === String(a || '').toLowerCase()));
        if (!m) fail(404, 'No macro called ' + a);
        await run(m.actions, 'macro ' + m.name); break;
      }
      case 'timeline': await run([{ do: 'timeline', method: a, target: b || '' }], 'timeline ' + a); break;
      case 'hideall': await run([{ do: 'hideall' }], 'hide all'); break;
      case 'take': await run([{ do: 'show', target: a }], 'take ' + a); break;
      case 'out': await run([{ do: 'hide', target: a }], 'out ' + a); break;
      case 'device': if (!app.devices) fail(400, 'No devices'); await app.devices.command(a, b, q.get('value') || ''); break;
      default: fail(404, 'Unknown Companion address');
    }
    httpSend(res, 200, { ok: true });
    return true;
  }
  async function http(req, res, pathname) {
    if (!pathname.startsWith('/live/api/')) return false;
    const q = new URL(req.url, 'http://x').searchParams, name = pathname.slice(10);
    if (name === 'info') { httpSend(res, 200, { port: app.config.port, access: app.config.access, keyRequired: false, mode: app.config.mode }); return true; }
    if (name.startsWith('companion/')) return companionApi(req, res, q, name.slice(10).split('/').map(decodeURIComponent));
    const user = await app.auth.userFromReq(req);
    const viaKey = !user && keyOk(q.get('key') || '');
    if (!user && !viaKey) fail(401, 'Sign in first');
    if (name === 'rundown' || name === 'rundown-cue') return rundownApi(req, res, q, user, name === 'rundown-cue');
    if (name === 'theme' && req.method === 'POST') {                 // choose the theme this PC uses (from the Templates page)
      if (!gfx) fail(400, 'Graphics run on the production PC');
      if (!user || !(await app.auth.teamsFor(user)).some((t) => Schema.CAN.score(t.role))) fail(403, 'You need the Scorer role to change the theme');
      const b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}');
      await gfx.setTheme(b.theme || '');
      httpSend(res, 200, gfx.themeState());
      return true;
    }
    if (name === 'variables') { if (!gfx) fail(400, 'Live values come from the production PC'); httpSend(res, 200, gfx.variables(q.get('graphic') || '', sportKeys())); return true; }
    const s = await session(q.get('fixture') || (gfx ? gfx.fixtureId || '' : ''));
    const role = user && s.team ? await app.auth.roleIn(user, s.team) : null;
    if (user && s.team && !role) fail(403, 'You are not in this production team');
    if (name === 'matches') {                          // the matches of this production team, for filling a fixtures / results graphic
      const team = s.team || (user ? ((await app.auth.teamsFor(user))[0] || {}).id : '');
      if (!team) { httpSend(res, 200, { competitions: [], matches: [], current: '' }); return true; }
      const url = (k) => (!k ? '' : /[:\/]/.test(k) ? k : '/media/' + k);
      const comps = new Map((await app.store.list(team, 'competition')).filter((d) => !d.deleted).map((d) => [d.id, d.data]));
      const venues = new Map((await app.store.list(team, 'venue')).filter((d) => !d.deleted).map((d) => [d.id, d.data]));
      const out = [];
      for (const f of (await app.store.list(team, 'fixture')).filter((d) => !d.deleted)) {
        const x = f.data, t = await app.domain.snapshotTeams(x), r = x.result || {};
        const cricket = r.kind === 'cricket', parts = cricket ? String(r.text || '').split(' | ') : [];
        out.push({ id: f.id, date: x.startDate || '', time: x.startTime || '', competition: x.competition || '', status: x.status || '', sport: x.sport || '', venue: (venues.get(x.venue) || {}).name || '',
          team1: t[0].name, team2: t[1].name, short1: t[0].short, short2: t[1].short, logo1: url(t[0].logo), logo2: url(t[1].logo),
          started: !!r.started, finished: !!r.finished || x.status === 'Completed', score1: cricket ? (parts[0] || '') : r.started ? String(r.a) : '', score2: cricket ? (parts[1] || '') : r.started ? String(r.b) : '', resultText: r.finished ? r.status || '' : '' });
      }
      out.sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));
      const cur = s.id ? await data(s.id) : null;
      httpSend(res, 200, { current: cur ? cur.competition || '' : '', competitions: [...comps].map(([id, c]) => ({ id, name: [c.name, c.season].filter(Boolean).join(' '), logo: url(c.logo), color: c.primaryColor || '' })), matches: out.slice(-600) });
      return true;
    }
    if (name === 'picks') {                            // what a Data field can be chosen from: people, pictures and colours of this match
      const url = (k) => (!k ? '' : /[:\/]/.test(k) ? k : '/media/' + k);
      const cr = s.kind === 'cricket', m = s.engine.match, su = s.sport.setup || { teams: { A: {}, B: {} } };
      const teams = (cr ? [m.teamA, m.teamB] : [su.teams.A || {}, su.teams.B || {}]).map((t) => ({ name: t.name || '', short: t.shortName || t.short || '', logo: url(t.logo), color1: t.color1 || '', color2: t.color2 || '', coach: t.coach || '', players: (t.players || []).map((p) => ({ name: p.name || '', photo: url(p.photo) })) }));
      const fx = s.id ? await data(s.id) : null, comp = fx ? await data(fx.competition) : null, org = s.team ? await data(s.team) : null;
      const names = [], images = [], colors = [];
      const person = (nm, group, t) => { if (nm && !names.some((x) => x.name === nm)) names.push({ name: nm, group, image: (t && t.photo) || '', color: '', team: '' }); };
      for (const t of teams) {
        if (t.name) names.push({ name: t.name, group: 'Teams', image: t.logo, color: t.color1 });
        if (t.logo) images.push({ label: t.name + ' logo', group: 'Teams', url: t.logo });
        if (t.color1) colors.push({ label: t.name + ' colour 1', value: t.color1 }); if (t.color2) colors.push({ label: t.name + ' colour 2', value: t.color2 });
        for (const p of t.players) { if (!p.name) continue; names.push({ name: p.name, group: t.name || 'Players', image: p.photo || t.logo, color: t.color1 }); if (p.photo) images.push({ label: p.name, group: t.name + ' players', url: p.photo }); }
        if (t.coach) names.push({ name: t.coach, group: 'Coaches', image: t.logo, color: t.color1 });
      }
      const offs = cr ? Object.values(m.officials || {}) : Sports.officialsOf(su).map((o) => o.name);
      for (const n of offs) person(n, 'Officials'); for (const n of (cr ? m.commentators : su.commentators) || []) person(n, 'Commentators');
      if (comp && comp.logo) images.push({ label: (comp.name || 'Competition') + ' logo', group: 'Competition', url: url(comp.logo) });
      if (comp && comp.primaryColor) colors.push({ label: 'Competition colour', value: comp.primaryColor });
      if (org && org.image) images.push({ label: (org.name || 'Production') + ' logo', group: 'Production', url: url(org.image) });
      if (org && /^#[0-9a-f]{6}$/i.test(org.accentColor || '')) colors.push({ label: 'Accent colour', value: org.accentColor });
      if (s.team) for (const d of (await app.store.list(s.team, 'image')).filter((x) => !x.deleted).slice(0, 400)) { const u = '/media/' + d.id; if (!images.some((x) => x.url === u)) images.push({ label: d.data.name || d.id, group: 'Image library', url: u }); }
      httpSend(res, 200, { names, images, colors }); return true;
    }
    if (name === 'catalog') { httpSend(res, 200, gfx ? gfx.publicCatalog() : []); return true; }
    if (name === 'dls-table') { const t = s.team ? await dlsTable(s.team) : null; httpSend(res, 200, { source: t ? 'custom (official table loaded)' : 'built-in (approximate)', rows: t || Cricket.builtInTable() }); return true; }
    if (name === 'export' && req.method === 'GET') {
      httpSend(res, 200, JSON.stringify(s.kind === 'cricket' ? s.engine.match : liveOf(s), null, 2), { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${String(s.name || 'match').replace(/[^\w .-]/g, '_')}.json"` });
      return true;
    }
    if (name === 'import' && req.method === 'POST') {
      if (!user || !Schema.CAN.score(role)) fail(403, 'You need the Scorer role to import a match');
      if (!s.id || s.kind !== 'cricket') fail(400, 'Open a cricket fixture first, then import into it');
      let m;
      try { m = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8')); } catch { fail(400, 'That file is not a CricketCG match (JSON)'); }
      if (!m || !m.teamA || !m.teamB || !Array.isArray(m.innings)) fail(400, 'That file is not a CricketCG match');
      s.engine.replace(m);
      { const doc = await app.store.get(s.id); if (doc && !doc.deleted) await pullMatch(s, doc); }      // the file brings the scoring; the teams stay the match's
      await recompute(s); await persist(s, user.id); await afterChange(s);
      httpSend(res, 200, { ok: true });
      return true;
    }
    fail(404, 'Not found');
    return true;
  }

  const beat = setInterval(() => { for (const c of clients) { if (!c.ws.alive) { c.ws.close(); continue; } c.ws.alive = false; c.ws.ping(); } }, 30000);
  beat.unref();
  async function start() { if (gfx) await session(gfx.fixtureId || '').catch(async () => { await gfx.setFixture(null); await session(''); }); }
  function close() { clearInterval(valuesTimer); timeline.close(); clearInterval(beat); clearTimeout(reseedTimer); clearTimeout(pullTimer); for (const c of clients) c.ws.close(); }

  return { upgrade, http, start, close, session, clients, sessions, newId };
}

module.exports = { makeLive, Clock };
