/* RFP Manager – what the rest of the app needs to know about a scored match, whatever the sport.
   The rules themselves live in cricket.js (cricket) and sports.js (everything else). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cricket'), require('./sports'));
  else root.RFPScoring = factory(root.Cricket, root.Sports);
})(typeof self !== 'undefined' ? self : this, function (Cricket, Sports) {
  'use strict';

  const key = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ALIASES = { soccer: 'football', fieldhockey: 'hockey', hockeyfield: 'hockey', rugbyunion: 'rugby', rugbysevens: 'rugby', rugby7s: 'rugby', sevens: 'rugby', rugbyleague: 'rugby', beachvolleyball: 'volleyball', trackandfield: 'athletics' };
  const VARIANTS = { rugbysevens: 'sevens', rugby7s: 'sevens', sevens: 'sevens', rugbyleague: 'league', beachvolleyball: 'beach' };
  // Fixture sport name -> { id, variant }: 'cricket', a sports.js id, or null when there is no rules engine for it.
  function sportFor(name) {
    const k = key(name);
    if (!k) return null;
    if (k.startsWith('cricket')) return { id: 'cricket', variant: '' };
    const id = Sports.SPORTS[k] ? k : ALIASES[k];
    return id && Sports.SPORTS[id] ? { id, variant: VARIANTS[k] || '' } : null;
  }
  // Formats a fixture or competition can be set to, so the scorer opens ready to go: "Rugby: Rugby sevens (2 × 7)".
  function formats() {
    const out = Object.entries(Cricket.FORMATS).map(([id, f]) => ({ sport: 'cricket', id, text: 'Cricket: ' + f.label }));
    Sports.list().forEach((sp) => sp.variants.forEach((v) => out.push({ sport: sp.id, id: v.id, text: sp.name.replace(' (field)', '') + ': ' + v.label })));
    return out;
  }
  // The format id chosen for a sport ('' when none or when it belongs to another sport).
  function formatFor(sportName, text) {
    const sp = sportFor(sportName), t = String(text || '').trim().toLowerCase();
    if (!sp || !t) return '';
    const f = formats().find((x) => x.sport === sp.id && (x.text.toLowerCase() === t || x.text.toLowerCase().split(': ').slice(1).join(': ') === t || x.id.toLowerCase() === t));
    return f ? f.id : '';
  }
  const sportNames = () => ['Cricket', ...Sports.list().map((s) => s.name.replace(' (field)', ''))];

  // One line about a match for lists, logs and tables.
  function summary(live) {
    const none = { kind: '', started: false, finished: false, a: 0, b: 0, text: '', period: '', status: '', winner: -1, teams: null };
    if (!live) return none;
    try {
      if (live.kind === 'cricket' && live.match) {
        const m = live.match, s = Cricket.compute(m);
        const tot = (k) => s.innings.filter((i) => !i.superOver && i.battingTeam === k);
        const line = (k) => tot(k).map((i) => i.score).join(' & ') || '-';
        const runs = (k) => tot(k).reduce((t, i) => t + i.runs, 0);
        const cur = s.innings[s.currentIndex];
        return { kind: 'cricket', started: s.innings.length > 0, finished: s.matchComplete, a: runs('A'), b: runs('B'), text: `${line('A')} | ${line('B')}`,
          period: s.matchComplete ? 'Result' : cur ? `${cur.superOver ? 'Super over' : 'Innings ' + cur.number} · ${cur.overs} ov` : 'Not started', status: s.statusText,
          winner: s.winner === 'A' ? 0 : s.winner === 'B' ? 1 : -1, teams: [m.teamA.name, m.teamB.name] };
      }
      if (live.kind === 'sport' && live.setup && live.setup.sport) {
        const v = Sports.compute(live.setup, live.events || []);
        const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
        return { kind: v.kind, started: (live.events || []).length > 0, finished: !!v.finished, a: n(v.score.A), b: n(v.score.B), text: `${v.score.A} – ${v.score.B}`, period: v.periodLabel, status: v.status,
          winner: v.winner === 'A' ? 0 : v.winner === 'B' ? 1 : -1, teams: [v.teams.A.name, v.teams.B.name] };
      }
    } catch (e) { return Object.assign(none, { status: 'Could not read this match: ' + e.message }); }
    return none;
  }

  const LABELS = { try: 'Tries', conv: 'Conversions', pen: 'Penalties', drop: 'Drop goals', points: 'Points', goals: 'Goals', supers: 'Super shots', gain: 'Gains', shot: 'Shots', yellow_cards: 'Yellow cards', red_cards: 'Red cards',
    green_cards: 'Green cards', fouls: 'Fouls', reb: 'Rebounds', ast: 'Assists', stl: 'Steals', blk: 'Blocks', fgm3: '3-pointers', sot: 'Shots on target' };
  // Career numbers pulled from completed matches: { playerId: { name, matches, stats: {label: n}, teams: [names] } }
  function playerStats(fixtures) {
    const out = {};
    const get = (id, name) => (out[id] = out[id] || { name: name || '', matches: 0, stats: {}, teams: [] });
    const inc = (p, k, n) => { if (n) p.stats[k] = (p.stats[k] || 0) + n; };
    for (const f of fixtures) {
      if (f.status !== 'Completed' || !f.live) continue;
      try {
        if (f.live.kind === 'cricket') {
          const m = f.live.match, s = Cricket.compute(m);
          for (const t of [m.teamA, m.teamB]) for (const pl of t.players) { const p = get(pl.id, pl.name); p.matches++; if (!p.teams.includes(t.name)) p.teams.push(t.name); }
          for (const i of s.innings) {
            for (const b of i.batting) { const p = get(b.playerId, b.name); inc(p, 'Runs', b.runs); inc(p, 'Balls faced', b.balls); inc(p, 'Fours', b.fours); inc(p, 'Sixes', b.sixes); if (b.runs >= 100) inc(p, 'Hundreds', 1); else if (b.runs >= 50) inc(p, 'Fifties', 1); }
            for (const b of i.bowling) { const p = get(b.playerId, b.name); inc(p, 'Wickets', b.wickets); inc(p, 'Runs conceded', b.runs); inc(p, 'Maidens', b.maidens); }
          }
        } else if (f.live.kind === 'sport' && f.live.setup) {
          const v = Sports.compute(f.live.setup, f.live.events || []);
          for (const pl of v.players) {
            if (pl.team !== 'A' && pl.team !== 'B') continue;
            const p = get(pl.id, pl.name), tn = v.teams[pl.team].name;
            p.matches++; if (!p.teams.includes(tn)) p.teams.push(tn);
            for (const [k, n] of Object.entries(pl.stats || {})) if (LABELS[k] && typeof n === 'number') inc(p, LABELS[k], n);
          }
        }
      } catch { /* a match that cannot be read does not stop the others */ }
    }
    return out;
  }

  // Log table for a competition from each match's stored result. rules: { win, draw, loss }
  function standings(fixtures, rules) {
    const r = Object.assign({ win: 3, draw: 1, loss: 0 }, rules || {});
    const rows = {};
    const row = (id, name) => (rows[id] = rows[id] || { id, name, P: 0, W: 0, D: 0, L: 0, PF: 0, PA: 0, PD: 0, Pts: 0 });
    for (const f of fixtures) {
      if (f.status !== 'Completed' || !f.team1 || !f.team2) continue;
      const x = f.result || summary(f.live);
      if (!x || !x.started) continue;
      const A = row(f.team1, x.teams && x.teams[0]), B = row(f.team2, x.teams && x.teams[1]);
      A.P++; B.P++; A.PF += x.a; A.PA += x.b; B.PF += x.b; B.PA += x.a;
      const w = x.winner >= 0 ? x.winner : x.a === x.b ? -1 : x.a > x.b ? 0 : 1;
      if (w === -1) { A.D++; B.D++; A.Pts += r.draw; B.Pts += r.draw; }
      else { const [W, Lo] = w === 0 ? [A, B] : [B, A]; W.W++; Lo.L++; W.Pts += r.win; Lo.Pts += r.loss; }
    }
    return Object.values(rows).map((x) => Object.assign(x, { PD: x.PF - x.PA })).sort((x, y) => (y.Pts - x.Pts) || (y.PD - x.PD) || (y.PF - x.PF) || String(x.name).localeCompare(String(y.name)));
  }

  return { sportFor, sportNames, formats, formatFor, summary, playerStats, standings, keyOf: key };
});
