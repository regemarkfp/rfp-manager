/* RFP Manager – cricket engine (ball-by-ball scorer, statistics, DLS).
   Ported from CricketCG's C# engine so both tools behave the same, then extended with ICC playing
   conditions: format presets, powerplay phases, bowler over limits, super overs and two-innings matches.
   Runs on the server (authoritative) and in the browser. Property names match what the Stats,
   Control and Commentary screens expect. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cricket = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class ScoringError extends Error {}
  const fail = (m) => { throw new ScoringError(m); };
  const rid = (n) => { let s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const up = (s) => String(s == null ? '' : s).toUpperCase();
  const plural = (n, w) => (n === 1 ? `${n} ${w}` : `${n} ${w}S`);
  const fx = (n, d) => Number(n).toFixed(d);

  // ICC playing conditions per format. overs 0 = no limit (declarations and time decide).
  const FORMATS = {
    T20: { label: 'T20 (20 overs)', overs: 20, ballsPerOver: 6, powerplay: 6, bowlerMax: 4, inningsPerSide: 1, phases: [{ name: 'P', from: 1, to: 6 }] },
    ODI: { label: 'One-day (50 overs)', overs: 50, ballsPerOver: 6, powerplay: 10, bowlerMax: 10, inningsPerSide: 1, phases: [{ name: 'P1', from: 1, to: 10 }, { name: 'P2', from: 11, to: 40 }, { name: 'P3', from: 41, to: 50 }] },
    T10: { label: 'T10 (10 overs)', overs: 10, ballsPerOver: 6, powerplay: 3, bowlerMax: 2, inningsPerSide: 1, phases: [{ name: 'P', from: 1, to: 3 }] },
    100: { label: '100-ball (20 sets of 5)', overs: 20, ballsPerOver: 5, powerplay: 5, bowlerMax: 4, inningsPerSide: 1, phases: [{ name: 'P', from: 1, to: 5 }] },
    TEST: { label: 'Test (5 days, two innings)', overs: 0, ballsPerOver: 6, powerplay: 0, bowlerMax: 0, inningsPerSide: 2, followOn: 200, phases: [] },
    FC: { label: 'First-class (3–4 days, two innings)', overs: 0, ballsPerOver: 6, powerplay: 0, bowlerMax: 0, inningsPerSide: 2, followOn: 150, phases: [] },
  };
  const formatOf = (m) => FORMATS[up(m.format).replace(/[^A-Z0-9]/g, '')] || null;
  const perSide = (m) => (m.rules && Number(m.rules.inningsPerSide) === 2 ? 2 : 1);

  function newTeam(name, short) { return { name, shortName: short, logo: '', color1: '#1f6f3f', color2: '#f2c500', coach: '', players: [] }; }
  function newMatch() {
    return { id: rid(8), tournament: '', matchTitle: '', matchNumber: '', venue: '', city: '', format: 'T20', oversPerInnings: 20, ballsPerOver: 6, powerplayOvers: 6,
      rules: { inningsPerSide: 1, bowlerMax: 4, enforceBowler: true, followOn: 0, phases: clone(FORMATS.T20.phases) },
      teamA: newTeam('TEAM A', 'TMA'), teamB: newTeam('TEAM B', 'TMB'),
      toss: { winner: '', decision: '' }, officials: { umpire1: '', umpire2: '', tvUmpire: '', fourthUmpire: '', referee: '' }, commentators: [],
      innings: [], currentInningsIndex: -1, resultOverride: '', dls: { enabled: true, g50: 245, r1Override: null, r2Override: null, parOverride: null } };
  }
  // Fills in anything an older saved match does not have.
  function normalise(m) {
    const d = newMatch();
    for (const k of Object.keys(d)) if (m[k] === undefined || m[k] === null) m[k] = d[k];
    m.rules = Object.assign({}, d.rules, m.rules || {});
    m.dls = Object.assign({}, d.dls, m.dls || {});
    for (const t of [m.teamA, m.teamB]) { t.players = t.players || []; }
    for (const i of m.innings) { i.balls = i.balls || []; i.battingOrder = i.battingOrder || []; i.interruptions = i.interruptions || []; i.nextSeq = i.nextSeq || i.balls.length + 1; }
    return m;
  }

  const team = (m, key) => (key === 'B' ? m.teamB : m.teamA);
  const other = (key) => (key === 'B' ? 'A' : 'B');
  const findPlayer = (m, id) => (id ? m.teamA.players.find((p) => p.id === id) || m.teamB.players.find((p) => p.id === id) || null : null);
  const teamKeyOf = (m, id) => (!id ? null : m.teamA.players.some((p) => p.id === id) ? 'A' : m.teamB.players.some((p) => p.id === id) ? 'B' : null);
  const display = (p) => (p ? (String(p.tvName || '').trim() ? p.tvName : up(p.name)) : '');
  const current = (m) => (m.currentInningsIndex >= 0 && m.currentInningsIndex < m.innings.length ? m.innings[m.currentInningsIndex] : null);
  const isLegal = (b) => b.extra !== 'wd' && b.extra !== 'nb' && b.extra !== 'pen';
  const isDelivery = (b) => b.extra !== 'pen';
  const total = (b) => b.batRuns + b.extraRuns;
  const countsAsWicket = (w) => !!w && w.kind !== 'retiredhurt';
  const BOWLER_CREDITED = ['bowled', 'caught', 'caughtbowled', 'lbw', 'stumped', 'hitwicket'];

  function defaultTvName(full) {
    const parts = String(full).trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return up(String(full).trim());
    const particles = ['de', 'van', 'der', 'du', 'le', 'la', 'von', 'den', 'da', 'di', 'ul', 'al'];
    let start = parts.length - 1;
    while (start > 1 && particles.includes(parts[start - 1].toLowerCase())) start--;
    return up(parts.slice(start).join(' '));
  }

  const oversString = (legal, bpo) => (legal % bpo === 0 ? String(legal / bpo) : `${Math.floor(legal / bpo)}.${legal % bpo}`);
  const rate = (runs, legal, bpo) => (legal === 0 ? '0.00' : fx(runs * bpo / legal, 2));
  function ballLabel(b) {
    let s;
    switch (b.extra) {
      case 'wd': s = b.extraRuns <= 1 ? 'wd' : `${b.extraRuns}wd`; break;
      case 'nb': s = b.batRuns > 0 ? `nb${b.batRuns}` : (b.extraRuns > 1 ? `${b.extraRuns}nb` : 'nb'); break;
      case 'b': s = `${b.extraRuns}b`; break;
      case 'lb': s = `${b.extraRuns}lb`; break;
      case 'pen': s = `${b.extraRuns}p`; break;
      default: s = b.batRuns === 0 ? '•' : String(b.batRuns);
    }
    if (b.wicket && countsAsWicket(b.wicket)) s = s === '•' ? 'W' : s + 'W';
    return s;
  }
  function howOut(kind, bowler, fielder) {
    switch (kind) {
      case 'bowled': return `b ${bowler}`;
      case 'caught': return !fielder ? `c ? b ${bowler}` : (fielder === bowler ? `c & b ${bowler}` : `c ${fielder} b ${bowler}`);
      case 'caughtbowled': return `c & b ${bowler}`;
      case 'lbw': return `lbw b ${bowler}`;
      case 'stumped': return `st ${fielder} b ${bowler}`;
      case 'runout': return !fielder ? 'run out' : `run out (${fielder})`;
      case 'hitwicket': return `hit wicket b ${bowler}`;
      case 'obstructing': return 'obstructing the field';
      case 'timedout': return 'timed out';
      case 'retiredout': return 'retired out';
      case 'retiredhurt': return 'retired hurt';
      default: return kind;
    }
  }

  // ================================================================== DLS (Standard Edition style)
  const DLS_B = 0.027464074821239352;
  const DLS_F = [1.0, 0.8849, 0.7604, 0.6308, 0.5003, 0.3756, 0.262, 0.1643, 0.0889, 0.0351];
  function builtInTable() {
    const t = [], d = 1 - Math.exp(-DLS_B * 50);
    for (let u = 0; u <= 50; u++) { t[u] = []; for (let w = 0; w < 10; w++) t[u][w] = Math.round(1000 * DLS_F[w] * (1 - Math.exp(-DLS_B * u / DLS_F[w])) / d) / 10; }
    return t;
  }
  const BUILT_IN = builtInTable();
  const validTable = (rows) => Array.isArray(rows) && rows.length === 51 && rows.every((r) => Array.isArray(r) && r.length === 10 && r.every((x) => Number.isFinite(x)));
  // Parse a pasted table: 51 lines (0..50 overs left) of 10 percentages for 0..9 wickets lost. Returns { rows } or { error }.
  function parseTable(text) {
    const parsed = {};
    let implicit = 50;
    for (const line of String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
      const nums = (line.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      if (nums.length === 11) parsed[Math.trunc(nums[0])] = nums.slice(1);
      else if (nums.length === 10) parsed[implicit--] = nums;
    }
    const rows = [];
    for (let u = 0; u <= 50; u++) { if (!parsed[u]) return { error: `Expected 51 rows (0–50 overs left) of 10 values, found ${Object.keys(parsed).length} usable rows.` }; rows.push(parsed[u]); }
    return { rows };
  }
  function resource(table, oversLeft, wickets) {
    if (wickets >= 10 || oversLeft <= 0) return 0;
    if (oversLeft > 50) oversLeft = 50;
    const lo = Math.floor(oversLeft), hi = Math.min(50, lo + 1), frac = oversLeft - lo;
    return table[lo][wickets] + (table[hi][wickets] - table[lo][wickets]) * frac;
  }
  const startOvers = (m, inn) => (inn.superOver ? 1 : inn.startOvers || m.oversPerInnings);
  const maxOvers = (m, inn) => (inn.superOver ? 1 : inn.maxOversOverride || inn.startOvers || m.oversPerInnings);
  const wicketsOf = (inn) => inn.balls.filter((b) => b.wicket && countsAsWicket(b.wicket)).length;
  const legalOf = (inn) => inn.balls.filter(isLegal).length;
  const runsOf = (inn) => inn.balls.reduce((s, b) => s + total(b), 0);

  function inningsResources(table, m, inn, workings, label) {
    const bpo = Math.max(1, m.ballsPerOver);
    let r = resource(table, startOvers(m, inn), 0);
    workings.push(`${label}: start ${startOvers(m, inn)} ov → ${fx(r, 1)}%`);
    for (const it of inn.interruptions) {
      const used = it.legalBalls / bpo;
      const before = resource(table, it.oversBefore - used, it.wickets), after = resource(table, it.oversAfter - used, it.wickets);
      r -= before - after;
      workings.push(`${label}: stopped at ${oversString(it.legalBalls, bpo)} ov, ${it.wickets} wkts, ${it.oversBefore}→${it.oversAfter} ov: lost ${fx(before - after, 1)}%`);
    }
    return Math.max(0, r);
  }
  function targetFor(s, r1, r2, g50) {
    if (r2 < r1) return Math.floor(s * r2 / r1) + 1;
    if (Math.abs(r2 - r1) < 1e-9) return Math.trunc(s) + 1;
    return Math.floor(s + (r2 - r1) * g50 / 100) + 1;
  }
  const parFor = (s, r1, used, g50) => (used <= r1 ? Math.floor(s * used / r1) : Math.floor(s + (used - r1) * g50 / 100));
  const r2 = (x) => Math.round(x * 100) / 100;

  function computeDls(m, table, source) {
    const info = { available: false, applied: false, tableSource: source || 'built-in (approximate)', g50: m.dls.g50, r1: 0, r2: 0, r1Manual: false, r2Manual: false, firstInningsTotal: 0,
      target: null, par: null, parManual: false, parIfWicket: null, diff: null, r2Used: 0, r2Remaining: 0, team1Overs: 0, team2Overs: 0, parText: '', targetText: '', workings: [] };
    if (!m.innings.length || perSide(m) === 2 || !(m.oversPerInnings > 0)) return info;
    const i1 = m.innings[0];
    info.firstInningsTotal = runsOf(i1);
    info.team1Overs = maxOvers(m, i1);
    let r1 = inningsResources(table, m, i1, info.workings, 'Team 1');
    if (m.dls.r1Override > 0) { r1 = m.dls.r1Override; info.r1Manual = true; info.workings.push(`Team 1 resources set manually: ${fx(r1, 1)}%`); }
    info.r1 = r2(r1);
    const i2 = m.innings.length > 1 && !m.innings[1].superOver ? m.innings[1] : null;
    let rr2 = i2 ? inningsResources(table, m, i2, info.workings, 'Team 2') : resource(table, info.team1Overs, 0);
    if (!i2) info.workings.push(`Team 2 (not started): assumed ${info.team1Overs} ov → ${fx(rr2, 1)}%`);
    if (m.dls.r2Override > 0) { rr2 = m.dls.r2Override; info.r2Manual = true; info.workings.push(`Team 2 resources set manually: ${fx(rr2, 1)}%`); }
    info.r2 = r2(rr2);
    info.team2Overs = i2 ? maxOvers(m, i2) : info.team1Overs;
    if (r1 <= 0) return info;
    info.available = true;
    const s = info.firstInningsTotal;
    info.target = targetFor(s, r1, rr2, m.dls.g50);
    info.applied = info.target !== s + 1 || i1.interruptions.length > 0 || (i2 ? i2.interruptions.length : 0) > 0 || info.r1Manual || info.r2Manual
      || startOvers(m, i1) !== (i2 ? startOvers(m, i2) : startOvers(m, i1));
    info.workings.push(rr2 < r1 ? `R2 < R1: target = ${s} × ${fx(rr2, 1)}/${fx(r1, 1)} + 1 = ${info.target}`
      : rr2 > r1 ? `R2 > R1: target = ${s} + (${fx(rr2, 1)} − ${fx(r1, 1)}) × ${m.dls.g50}/100 + 1 = ${info.target}` : `R2 = R1: target = ${s} + 1 = ${info.target}`);
    info.targetText = `TARGET ${info.target} FROM ${info.team2Overs} OVERS${info.applied ? ' (DLS)' : ''}`;
    if (i2) {
      const bpo = Math.max(1, m.ballsPerOver), legal = legalOf(i2), wk = wicketsOf(i2);
      const left = (maxOvers(m, i2) * bpo - legal) / bpo;
      const remaining = resource(table, left, wk), used = Math.max(0, rr2 - remaining);
      info.r2Remaining = r2(remaining); info.r2Used = r2(used);
      info.par = parFor(s, r1, used, m.dls.g50);
      info.parIfWicket = wk < 9 ? parFor(s, r1, Math.max(0, rr2 - resource(table, left, wk + 1)), m.dls.g50) : null;
      if (m.dls.parOverride !== null && m.dls.parOverride !== undefined && m.dls.parOverride >= 0) { info.par = m.dls.parOverride; info.parManual = true; }
      info.diff = runsOf(i2) - info.par;
      const t = up(team(m, i2.battingTeam).name);
      info.parText = info.diff > 0 ? `DLS PAR ${info.par} · ${t} ${info.diff} AHEAD` : info.diff < 0 ? `DLS PAR ${info.par} · ${t} ${-info.diff} BEHIND` : `DLS PAR ${info.par} · SCORES LEVEL`;
    }
    return info;
  }

  // ================================================================== statistics
  // Which fielding-restriction phase a ball number falls in, scaled when the innings is shortened
  // (ICC: the powerplay is the same share of the innings, rounded to the nearest ball).
  function phaseAt(m, inn, legal) {
    const bpo = Math.max(1, m.ballsPerOver), full = m.oversPerInnings, max = maxOvers(m, inn);
    if (inn.superOver || !(full > 0)) return '';
    const phases = (m.rules.phases && m.rules.phases.length ? m.rules.phases : (m.powerplayOvers > 0 ? [{ name: 'P', from: 1, to: m.powerplayOvers }] : []));
    const single = phases.length === 1;
    for (const p of phases) {
      const to = single ? m.powerplayOvers || p.to : p.to;
      const endBalls = max === full ? to * bpo : Math.round(max * bpo * to / full);
      if (legal < endBalls) return p.name;
    }
    return '';
  }
  const bowlerLimit = (m, inn) => {
    if (inn.superOver) return 1;
    const base = Number(m.rules.bowlerMax) || 0, full = m.oversPerInnings, max = maxOvers(m, inn);
    if (!base || !(full > 0)) return 0;
    return max === full ? base : Math.ceil(max / 5);
  };

  function computeInnings(m, index, dls) {
    const inn = m.innings[index], bpo = Math.max(1, m.ballsPerOver);
    const batTeam = team(m, inn.battingTeam), bowlTeam = team(m, inn.bowlingTeam);
    const limited = m.oversPerInnings > 0 || inn.superOver;
    const s = { index, number: inn.number, battingTeam: inn.battingTeam, bowlingTeam: inn.bowlingTeam, battingTeamName: batTeam.name, battingTeamShort: batTeam.shortName,
      bowlingTeamName: bowlTeam.name, bowlingTeamShort: bowlTeam.shortName, runs: 0, wickets: 0, legalBalls: 0, maxBalls: limited ? maxOvers(m, inn) * bpo : 0,
      maxWickets: inn.superOver ? 2 : Math.min(10, Math.max(1, batTeam.players.length > 1 ? batTeam.players.length - 1 : 10)), overs: '0', score: '0/0', runRate: '0.00',
      extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0, total: 0, detail: '' }, batting: [], yetToBat: [], bowling: [], fow: [], partnerships: [], overList: [], thisOver: [], thisOverRuns: 0,
      freeHit: false, powerplay: false, powerplayName: '', target: null, targetRevised: false, runsNeeded: null, ballsRemaining: null, requiredRate: null, projectedScore: '', complete: false, completeReason: '',
      closed: !!inn.closed, declared: !!inn.declared, superOver: !!inn.superOver, strikerId: inn.strikerId || null, nonStrikerId: inn.nonStrikerId || null, bowlerId: inn.bowlerId || null, overComplete: false,
      lastBallLabel: '', ballCount: inn.balls.length, bowlerLimit: bowlerLimit(m, inn), bowlerWarning: '' };
    const nm = (id) => display(findPlayer(m, id));
    const bat = new Map(), bowl = new Map(), bowlOrder = [];
    const Bat = (id) => {
      if (!bat.has(id)) { const p = findPlayer(m, id); bat.set(id, { playerId: id, name: p ? p.name : '?', tvName: p ? display(p) : '?', order: 0, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, strikeRate: '0.00', out: false, howOut: '', bowlerName: '', fielderName: '', status: 'dnb', onStrike: false, captain: !!(p && p.captain), keeper: !!(p && p.keeper) }); }
      return bat.get(id);
    };
    const Bowl = (id) => {
      if (!bowl.has(id)) { const p = findPlayer(m, id); bowl.set(id, { playerId: id, name: p ? p.name : '?', tvName: p ? display(p) : '?', legalBalls: 0, maidens: 0, runs: 0, wickets: 0, dots: 0, wides: 0, noBalls: 0, foursConceded: 0, sixesConceded: 0, overs: '0', economy: '0.00', figures: '0-0', current: false }); bowlOrder.push(id); }
      return bowl.get(id);
    };
    let runs = 0, wkts = 0, legal = 0, over = null, overBowlerRuns = 0, overLegal = 0, freeHitNext = false, part = null;
    const ex = s.extras;
    for (const b of inn.balls) {
      const overIdx = Math.floor(legal / bpo);
      if (isDelivery(b) && (!over || over.over !== overIdx + 1)) { over = { over: overIdx + 1, bowlerId: b.bowlerId, bowlerName: nm(b.bowlerId), runs: 0, wickets: 0, cumulative: 0, cumulativeWickets: 0, balls: [] }; s.overList.push(over); overBowlerRuns = 0; overLegal = 0; }
      if (isDelivery(b) && b.strikerId && b.nonStrikerId) {
        const same = part && ((part.batter1Id === b.strikerId && part.batter2Id === b.nonStrikerId) || (part.batter1Id === b.nonStrikerId && part.batter2Id === b.strikerId));
        if (!same) {
          if (part) part.current = false;
          let first = b.strikerId, second = b.nonStrikerId;
          const io1 = inn.battingOrder.indexOf(first), io2 = inn.battingOrder.indexOf(second);
          if (io1 >= 0 && io2 >= 0 && io2 < io1) [first, second] = [second, first];
          part = { forWicket: wkts + 1, batter1Id: first, batter1Name: nm(first), batter1Runs: 0, batter1Balls: 0, batter2Id: second, batter2Name: nm(second), batter2Runs: 0, batter2Balls: 0, runs: 0, balls: 0, current: true };
          s.partnerships.push(part);
        }
      }
      runs += total(b);
      if (b.extra === 'wd') ex.wides += b.extraRuns; else if (b.extra === 'nb') ex.noBalls += b.extraRuns; else if (b.extra === 'b') ex.byes += b.extraRuns; else if (b.extra === 'lb') ex.legByes += b.extraRuns; else if (b.extra === 'pen') ex.penalty += b.extraRuns;
      if (isDelivery(b)) {
        if (b.strikerId) {
          const st = Bat(b.strikerId);
          if (b.extra !== 'wd') { st.balls++; if (b.batRuns === 0) st.dots++; }
          st.runs += b.batRuns;
          if (b.boundary && b.batRuns === 4) st.fours++;
          if (b.boundary && b.batRuns === 6) st.sixes++;
          if (part) {
            if (part.batter1Id === b.strikerId) { part.batter1Runs += b.batRuns; if (b.extra !== 'wd') part.batter1Balls++; }
            else if (part.batter2Id === b.strikerId) { part.batter2Runs += b.batRuns; if (b.extra !== 'wd') part.batter2Balls++; }
          }
        }
        if (b.nonStrikerId) Bat(b.nonStrikerId);
        if (b.bowlerId) {
          const bw = Bowl(b.bowlerId), conceded = b.batRuns + (b.extra === 'wd' || b.extra === 'nb' ? b.extraRuns : 0);
          bw.runs += conceded; overBowlerRuns += conceded;
          if (b.extra === 'wd') bw.wides += b.extraRuns;
          if (b.extra === 'nb') bw.noBalls++;
          if (isLegal(b)) { bw.legalBalls++; if (total(b) === 0) bw.dots++; }
          if (b.boundary && b.batRuns === 4) bw.foursConceded++;
          if (b.boundary && b.batRuns === 6) bw.sixesConceded++;
        }
      }
      if (part) { part.runs += total(b); if (isLegal(b)) part.balls++; }
      if (over) { over.runs += total(b); over.balls.push(ballLabel(b)); }
      if (isLegal(b)) { legal++; overLegal++; }
      if (b.wicket && b.wicket.playerOutId) {
        const w = b.wicket, outB = Bat(w.playerOutId), bowlerName = nm(b.bowlerId), fielderName = nm(w.fielderId);
        outB.bowlerName = bowlerName; outB.fielderName = fielderName; outB.howOut = howOut(w.kind, bowlerName, fielderName);
        if (countsAsWicket(w)) {
          outB.out = true; outB.status = 'out'; wkts++;
          if (over) over.wickets++;
          if (BOWLER_CREDITED.includes(w.kind) && b.bowlerId) Bowl(b.bowlerId).wickets++;
          s.fow.push({ wicket: wkts, score: runs, over: oversString(legal, bpo), playerId: w.playerOutId, name: outB.tvName, playerRuns: outB.runs });
        } else outB.status = 'retired';
        if (part) part.current = false;
        part = null;
      }
      if (isDelivery(b)) freeHitNext = b.extra === 'nb' || (freeHitNext && !isLegal(b));
      if (isLegal(b) && legal % bpo === 0 && overLegal === bpo && overBowlerRuns === 0 && b.bowlerId) Bowl(b.bowlerId).maidens++;
    }
    s.runs = runs; s.wickets = wkts; s.legalBalls = legal; s.score = `${runs}/${wkts}`;
    s.overs = oversString(legal, bpo); s.runRate = rate(runs, legal, bpo);
    ex.total = ex.wides + ex.noBalls + ex.byes + ex.legByes + ex.penalty;
    ex.detail = [ex.byes ? `b ${ex.byes}` : '', ex.legByes ? `lb ${ex.legByes}` : '', ex.wides ? `w ${ex.wides}` : '', ex.noBalls ? `nb ${ex.noBalls}` : '', ex.penalty ? `p ${ex.penalty}` : ''].filter(Boolean).join(', ');
    s.freeHit = freeHitNext && !inn.closed;
    s.powerplayName = phaseAt(m, inn, legal);
    s.powerplay = !!s.powerplayName && (s.powerplayName === 'P' || s.powerplayName === 'P1');
    const lastBall = inn.balls[inn.balls.length - 1];
    s.overComplete = legal > 0 && legal % bpo === 0 && !!lastBall && isLegal(lastBall);
    if (lastBall) s.lastBallLabel = ballLabel(lastBall);
    let cum = 0, cumW = 0;
    for (const o of s.overList) { cum += o.runs; cumW += o.wickets; o.cumulative = cum; o.cumulativeWickets = cumW; }
    if (s.overList.length) { const last = s.overList[s.overList.length - 1]; s.thisOver = last.balls.slice(); s.thisOverRuns = last.runs; }

    const cur = new Set([inn.strikerId, inn.nonStrikerId].filter(Boolean));
    const orderList = inn.battingOrder.slice();
    for (const id of bat.keys()) if (!orderList.includes(id)) orderList.push(id);
    for (const id of cur) if (!orderList.includes(id)) orderList.push(id);
    let ord = 0;
    for (const id of orderList) {
      if (!bat.has(id) && !cur.has(id)) continue;
      const b = Bat(id);
      b.order = ++ord;
      if (b.status !== 'out' && b.status !== 'retired') b.status = cur.has(id) && !inn.closed ? 'batting' : 'notout';
      if (b.status === 'retired' && cur.has(id)) b.status = 'batting';
      b.onStrike = id === inn.strikerId && !inn.closed;
      if (b.status === 'batting' || b.status === 'notout') b.howOut = 'not out';
      b.strikeRate = b.balls === 0 ? '0.00' : fx(b.runs * 100 / b.balls, 2);
      s.batting.push(b);
    }
    for (const p of batTeam.players) if (!s.batting.some((x) => x.playerId === p.id)) s.yetToBat.push({ playerId: p.id, name: p.name, tvName: display(p), status: 'dnb', captain: !!p.captain, keeper: !!p.keeper, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, strikeRate: '0.00', out: false, howOut: '', order: 0 });
    for (const id of bowlOrder) {
      const b = bowl.get(id);
      b.overs = oversString(b.legalBalls, bpo); b.economy = rate(b.runs, b.legalBalls, bpo); b.figures = `${b.wickets}-${b.runs}`; b.current = id === inn.bowlerId && !inn.closed;
      if (s.bowlerLimit) { b.maxOvers = s.bowlerLimit; b.oversLeft = Math.max(0, s.bowlerLimit - Math.ceil(b.legalBalls / bpo)); }
      s.bowling.push(b);
    }

    // ---------- chase
    const sideTotal = (key, upTo) => m.innings.slice(0, upTo).filter((i) => !i.superOver && i.battingTeam === key).reduce((t, i) => t + runsOf(i), 0);
    if (inn.superOver) {
      const prev = index > 0 && m.innings[index - 1].superOver && isSecondOfPair(m, index) ? m.innings[index - 1] : null;
      if (prev) s.target = runsOf(prev) + 1;
    } else if (perSide(m) === 2) {
      const mainIdx = m.innings.slice(0, index + 1).filter((i) => !i.superOver).length - 1;
      if (mainIdx === 3) s.target = sideTotal(inn.bowlingTeam, index) - sideTotal(inn.battingTeam, index) + 1;
    } else if (index === 1 && m.innings.length > 0) {
      const firstRuns = runsOf(m.innings[0]);
      const dlsTarget = m.dls.enabled && dls.available && dls.applied ? dls.target : null;
      s.target = inn.targetOverride || dlsTarget || firstRuns + 1;
      s.targetRevised = s.target !== firstRuns + 1;
    }
    if (inn.targetOverride && s.target === null) s.target = inn.targetOverride;
    if (inn.targetOverride && perSide(m) === 2) s.target = inn.targetOverride;
    if (s.target !== null && s.target <= 0) s.target = null;
    if (s.target !== null) {
      s.runsNeeded = Math.max(0, s.target - runs);
      if (s.maxBalls > 0) { s.ballsRemaining = Math.max(0, s.maxBalls - legal); s.requiredRate = s.ballsRemaining > 0 ? fx(s.runsNeeded * bpo / s.ballsRemaining, 2) : '-'; }
    } else if (legal > 0 && s.maxBalls > 0) s.projectedScore = String(Math.round(runs + runs / legal * Math.max(0, s.maxBalls - legal)));

    if (wkts >= s.maxWickets) { s.complete = true; s.completeReason = 'ALL OUT'; }
    else if (s.maxBalls > 0 && legal >= s.maxBalls) { s.complete = true; s.completeReason = 'OVERS COMPLETE'; }
    else if (s.target !== null && runs >= s.target) { s.complete = true; s.completeReason = 'TARGET REACHED'; }
    else if (inn.declared) { s.complete = true; s.completeReason = 'DECLARED'; }
    if (inn.declared) s.score = `${runs}/${wkts}d`;

    // ---------- bowler playing conditions
    if (!inn.closed && inn.bowlerId && s.bowlerLimit) {
      const b = bowl.get(inn.bowlerId);
      if (b && b.legalBalls >= s.bowlerLimit * bpo) s.bowlerWarning = `${b.tvName} HAS BOWLED THE MAXIMUM ${plural(s.bowlerLimit, 'OVER')}`;
    }
    return s;
  }
  // Super overs come in pairs after the main innings.
  const isSecondOfPair = (m, index) => m.innings.slice(0, index + 1).filter((i) => i.superOver).length % 2 === 0;

  function tossText(m) {
    if (!m.toss.winner || !m.toss.decision) return '';
    return `${up(team(m, m.toss.winner).name)} WON THE TOSS AND CHOSE TO ${m.toss.decision === 'bat' ? 'BAT' : 'FIELD'}`;
  }

  function resultOf(m, ms) {
    if (String(m.resultOverride || '').trim()) return { text: up(m.resultOverride), complete: true, winner: null };
    const main = ms.innings.filter((i) => !i.superOver), so = ms.innings.filter((i) => i.superOver);
    const name = (k) => up(team(m, k).name);
    const chase = (second, tag) => {
      if (second.target === null) return null;
      if (second.runs >= second.target) {
        const left = second.maxWickets - second.wickets, balls = second.maxBalls > 0 ? second.maxBalls - second.legalBalls : 0;
        return { text: `${name(second.battingTeam)} WON BY ${plural(left, 'WICKET')}${balls > 0 ? ` WITH ${plural(balls, 'BALL')} REMAINING` : ''}${tag}`, complete: true, winner: second.battingTeam };
      }
      if (second.complete || second.closed) {
        const margin = second.target - 1 - second.runs;
        if (margin === 0) return { text: 'MATCH TIED' + tag, complete: true, winner: null, tied: true };
        return { text: `${name(second.bowlingTeam)} WON BY ${plural(margin, 'RUN')}${tag}`, complete: true, winner: second.bowlingTeam };
      }
      return null;
    };
    if (perSide(m) === 2) {
      const tot = (k, n) => main.slice(0, n).filter((i) => i.battingTeam === k).reduce((t, i) => t + i.runs, 0);
      if (main.length >= 4) return chase(main[3], '') || { text: '', complete: false, winner: null };
      if (main.length === 3 && (main[2].complete || main[2].closed)) {
        const twice = main[2].battingTeam, once = other(twice);
        if (main.filter((i) => i.battingTeam === twice).length === 2 && tot(twice, 3) < tot(once, 3)) {
          return { text: `${name(once)} WON BY AN INNINGS AND ${plural(tot(once, 3) - tot(twice, 3), 'RUN')}`, complete: true, winner: once };
        }
      }
      return { text: '', complete: false, winner: null };
    }
    if (main.length < 2) return { text: '', complete: false, winner: null };
    const r = chase(main[1], main[1].targetRevised ? ' (DLS)' : '');
    if (!r) return { text: '', complete: false, winner: null };
    if (r.tied && so.length >= 2) {
      const last = so.length % 2 === 0 ? so[so.length - 1] : null;
      if (!last) return { text: 'MATCH TIED · SUPER OVER', complete: false, winner: null };
      const x = chase(last, '');
      if (!x) return { text: 'MATCH TIED · SUPER OVER', complete: false, winner: null };
      if (x.tied) return { text: 'SUPER OVER TIED', complete: false, winner: null };
      return { text: `${name(x.winner)} WON THE SUPER OVER`, complete: true, winner: x.winner };
    }
    if (r.tied && so.length === 1) return { text: 'MATCH TIED · SUPER OVER', complete: false, winner: null };
    return r;
  }

  function statusText(m, ms) {
    if (ms.resultText) return ms.resultText;
    const cur = ms.currentIndex >= 0 && ms.currentIndex < ms.innings.length ? ms.innings[ms.currentIndex] : null;
    if (!cur) return ms.tossText || 'MATCH YET TO START';
    const t = up(team(m, cur.battingTeam).name);
    if (cur.target !== null && cur.runsNeeded !== null && !cur.complete) {
      if (cur.ballsRemaining === null) return `${t} NEED ${plural(cur.runsNeeded, 'RUN')} TO WIN`;
      if (cur.legalBalls === 0 && cur.ballCount === 0) return `${t} NEED ${plural(cur.runsNeeded, 'RUN')} TO WIN FROM ${plural(cur.ballsRemaining, 'BALL')}`;
      return `${t} NEED ${plural(cur.runsNeeded, 'RUN')} FROM ${plural(cur.ballsRemaining, 'BALL')}`;
    }
    if (perSide(m) === 2 && cur.index > 0) {
      const tot = (k) => ms.innings.filter((i) => !i.superOver && i.battingTeam === k).reduce((x, i) => x + i.runs, 0);
      const d = tot(cur.battingTeam) - tot(cur.bowlingTeam);
      const lead = d === 0 ? 'SCORES LEVEL' : `${t} ${d > 0 ? 'LEAD' : 'TRAIL'} BY ${plural(Math.abs(d), 'RUN')}`;
      return cur.complete ? `END OF INNINGS: ${t} ${cur.score} · ${lead}` : lead;
    }
    if (cur.complete) return `END OF INNINGS: ${t} ${cur.score} (${cur.overs} OV)`;
    return ms.tossText || `CURRENT RUN RATE ${cur.runRate}`;
  }

  function compute(m, opts) {
    const table = opts && validTable(opts.dlsTable) ? opts.dlsTable : BUILT_IN;
    const source = opts && validTable(opts.dlsTable) ? 'custom (official table loaded)' : 'built-in (approximate)';
    const ms = { innings: [], currentIndex: m.currentInningsIndex, tossText: '', statusText: '', resultText: '', matchComplete: false, winner: null, dls: computeDls(m, table, source) };
    for (let i = 0; i < m.innings.length; i++) ms.innings.push(computeInnings(m, i, ms.dls));
    ms.tossText = tossText(m);
    const r = resultOf(m, ms);
    ms.resultText = r.text; ms.matchComplete = r.complete; ms.winner = r.winner;
    ms.statusText = statusText(m, ms);
    return ms;
  }

  // ================================================================== scoring engine
  class Engine {
    constructor(match) { this.match = normalise(match || newMatch()); this.undoStack = []; }
    replace(match) { this.match = normalise(match); this.undoStack = []; }
    get undoDepth() { return this.undoStack.length; }
    push() { this.undoStack.push(JSON.stringify({ innings: this.match.innings, current: this.match.currentInningsIndex })); if (this.undoStack.length > 400) this.undoStack.shift(); }
    undo() {
      if (!this.undoStack.length) fail('Nothing to undo');
      const s = JSON.parse(this.undoStack.pop());
      this.match.innings = s.innings; this.match.currentInningsIndex = s.current;
    }
    requireInnings() {
      const inn = current(this.match) || fail('No innings in progress. Start an innings first.');
      if (inn.closed) fail('This innings is closed. Start the next innings or undo.');
      return inn;
    }

    // ---- setup
    setup(d) {
      const m = this.match;
      for (const k of ['tournament', 'matchTitle', 'matchNumber', 'venue', 'city']) if (d[k] !== undefined && d[k] !== null) m[k] = String(d[k]);
      if (d.format !== undefined && d.format !== null) {
        const changed = up(d.format) !== up(m.format);
        m.format = String(d.format);
        const f = formatOf(m);
        // Choosing a format applies its playing conditions; the numbers can still be changed afterwards.
        if (f && changed) {
          m.oversPerInnings = f.overs; m.ballsPerOver = f.ballsPerOver; m.powerplayOvers = f.powerplay;
          m.rules = Object.assign({}, m.rules, { inningsPerSide: f.inningsPerSide, bowlerMax: f.bowlerMax, followOn: f.followOn || 0, phases: clone(f.phases) });
          d = Object.assign({}, d, { oversPerInnings: undefined, ballsPerOver: undefined, powerplayOvers: undefined });
        }
      }
      if (d.oversPerInnings > 0 || (d.oversPerInnings === 0 && perSide(m) === 2)) m.oversPerInnings = Number(d.oversPerInnings);
      if (d.ballsPerOver > 0) m.ballsPerOver = Number(d.ballsPerOver);
      if (d.powerplayOvers >= 0 && d.powerplayOvers !== null && d.powerplayOvers !== undefined) m.powerplayOvers = Number(d.powerplayOvers);
      if (d.rules && typeof d.rules === 'object') {
        const r = d.rules;
        if (r.bowlerMax !== undefined) m.rules.bowlerMax = Math.max(0, Number(r.bowlerMax) || 0);
        if (r.enforceBowler !== undefined) m.rules.enforceBowler = !!r.enforceBowler;
        if (r.inningsPerSide !== undefined) m.rules.inningsPerSide = Number(r.inningsPerSide) === 2 ? 2 : 1;
        if (r.followOn !== undefined) m.rules.followOn = Math.max(0, Number(r.followOn) || 0);
      }
    }
    setTeam(d) {
      const t = team(this.match, d.key);
      for (const [k, f] of [['name', 'name'], ['shortName', 'shortName'], ['logo', 'logo'], ['coach', 'coach']]) if (d[k] !== undefined && d[k] !== null) t[f] = String(d[k]).trim();
      if (d.color1) t.color1 = d.color1;
      if (d.color2) t.color2 = d.color2;
      if (Array.isArray(d.players)) {
        const old = t.players, list = [];
        for (const raw of d.players) {
          if (!raw || !String(raw.name || '').trim()) continue;
          const p = { id: raw.id || '', name: String(raw.name).trim(), tvName: String(raw.tvName || '').trim(), role: raw.role || '', captain: !!raw.captain, keeper: !!raw.keeper, photo: raw.photo || '', battingStyle: raw.battingStyle || '', bowlingStyle: raw.bowlingStyle || '', age: raw.age === undefined || raw.age === '' ? null : raw.age, number: raw.number === undefined ? '' : raw.number };
          const match = (p.id ? old.find((o) => o.id === p.id) : null) || old.find((o) => o.name.toLowerCase() === p.name.toLowerCase());
          if (match) p.id = match.id;
          if (!p.id || list.some((x) => x.id === p.id)) p.id = rid(10);
          if (!p.tvName) p.tvName = defaultTvName(p.name);
          list.push(p);
        }
        t.players = list;
      }
    }
    setToss(t) { this.match.toss = { winner: t.winner === 'A' || t.winner === 'B' ? t.winner : '', decision: t.decision === 'bat' || t.decision === 'field' ? t.decision : '' }; }
    setOfficials(o) { this.match.officials = Object.assign({ umpire1: '', umpire2: '', tvUmpire: '', fourthUmpire: '', referee: '' }, o || {}); }
    setCommentators(c) { this.match.commentators = (c || []).map((x) => String(x || '').trim()).filter(Boolean); }
    setResultOverride(text) { this.match.resultOverride = text || ''; }

    // ---- innings
    startInnings(battingTeam, opts) {
      this.push();
      const m = this.match, cur = current(m);
      if (cur) cur.closed = true;
      const bat = battingTeam === 'B' ? 'B' : 'A';
      m.innings.push({ number: m.innings.length + 1, battingTeam: bat, bowlingTeam: other(bat), balls: [], strikerId: null, nonStrikerId: null, bowlerId: null, battingOrder: [], closed: false,
        maxOversOverride: null, targetOverride: null, startOvers: null, interruptions: [], nextSeq: 1, superOver: !!(opts && opts.superOver), declared: false });
      m.currentInningsIndex = m.innings.length - 1;
    }
    endInnings(declared) { const inn = this.requireInnings(); this.push(); inn.closed = true; if (declared) inn.declared = true; }
    setInningsOptions(maxOversN, target) {
      const inn = current(this.match) || fail('No innings');
      this.push();
      inn.maxOversOverride = maxOversN > 0 ? maxOversN : null;
      inn.targetOverride = target > 0 ? target : null;
    }
    inningsOrCurrent(index) { const m = this.match; return index !== null && index !== undefined && index >= 0 && index < m.innings.length ? m.innings[index] : (current(m) || fail('No innings')); }
    addInterruption(newOvers, note, inningsIndex) {
      const m = this.match, inn = this.inningsOrCurrent(inningsIndex), bpo = Math.max(1, m.ballsPerOver);
      if (!(m.oversPerInnings > 0)) fail('Overs are only lost in limited-overs matches');
      const legal = legalOf(inn), before = maxOvers(m, inn);
      if (newOvers < Math.ceil(legal / bpo)) fail(`${oversString(legal, bpo)} overs have already been bowled`);
      if (newOvers === before) fail('That is already the innings length');
      this.push();
      if (legal === 0 && inn.interruptions.length === 0) { inn.startOvers = newOvers; inn.maxOversOverride = null; return; }
      inn.interruptions.push({ legalBalls: legal, wickets: wicketsOf(inn), oversBefore: before, oversAfter: newOvers, note: note || '' });
      inn.maxOversOverride = newOvers;
    }
    deleteInterruption(inningsIndex, index) {
      const inn = this.inningsOrCurrent(inningsIndex);
      if (!(index >= 0 && index < inn.interruptions.length)) fail('Interruption not found');
      this.push();
      inn.interruptions.splice(index, 1);
      inn.maxOversOverride = inn.interruptions.length ? inn.interruptions[inn.interruptions.length - 1].oversAfter : null;
    }
    editInterruption(inningsIndex, index, e) {
      const inn = this.inningsOrCurrent(inningsIndex);
      if (!(index >= 0 && index < inn.interruptions.length)) fail('Interruption not found');
      this.push();
      const it = inn.interruptions[index];
      it.legalBalls = Math.max(0, Number(e.legalBalls) || 0); it.wickets = Math.min(9, Math.max(0, Number(e.wickets) || 0));
      it.oversBefore = Math.max(1, Number(e.oversBefore) || 1); it.oversAfter = Math.max(0, Number(e.oversAfter) || 0); it.note = e.note || '';
      inn.maxOversOverride = inn.interruptions[inn.interruptions.length - 1].oversAfter;
    }
    setStartOvers(inningsIndex, overs) { const inn = this.inningsOrCurrent(inningsIndex); this.push(); inn.startOvers = overs > 0 ? overs : null; }
    setTargetOverride(target) {
      const m = this.match;
      if (m.innings.length < 2) fail(target > 0 ? 'Start the second innings before setting its target' : 'No second innings yet');
      this.push();
      m.innings[perSide(m) === 2 ? m.innings.length - 1 : 1].targetOverride = target > 0 ? target : null;
    }
    setDls(d) {
      const x = this.match.dls;
      x.enabled = !!d.enabled;
      if (d.g50 > 0) x.g50 = Number(d.g50);
      x.r1Override = d.r1Override > 0 ? Number(d.r1Override) : null;
      x.r2Override = d.r2Override > 0 ? Number(d.r2Override) : null;
      x.parOverride = d.parOverride !== null && d.parOverride !== undefined && d.parOverride !== '' && Number(d.parOverride) >= 0 ? Number(d.parOverride) : null;
    }
    selectInnings(index) {
      const m = this.match;
      if (!(index >= 0 && index < m.innings.length)) fail('Invalid innings');
      this.push();
      m.currentInningsIndex = index; m.innings[index].closed = false; m.innings[index].declared = false;
    }

    // ---- crease
    checkBatter(inn, id) { if (teamKeyOf(this.match, id) !== inn.battingTeam) fail('That player is not in the batting team'); }
    ensureOrder(inn, id) { if (id && !inn.battingOrder.includes(id)) inn.battingOrder.push(id); }
    pruneOrder(inn) {
      const seen = new Set();
      for (const b of inn.balls) { seen.add(b.strikerId); seen.add(b.nonStrikerId); if (b.wicket) seen.add(b.wicket.playerOutId); }
      if (inn.strikerId) seen.add(inn.strikerId);
      if (inn.nonStrikerId) seen.add(inn.nonStrikerId);
      inn.battingOrder = inn.battingOrder.filter((id) => seen.has(id));
    }
    setStriker(id) {
      const inn = this.requireInnings();
      if (id) this.checkBatter(inn, id);
      this.push();
      if (id && id === inn.nonStrikerId) inn.nonStrikerId = inn.strikerId;
      inn.strikerId = id || null;
      this.ensureOrder(inn, inn.strikerId); this.pruneOrder(inn);
    }
    setNonStriker(id) {
      const inn = this.requireInnings();
      if (id) this.checkBatter(inn, id);
      this.push();
      if (id && id === inn.strikerId) inn.strikerId = inn.nonStrikerId;
      inn.nonStrikerId = id || null;
      this.ensureOrder(inn, inn.nonStrikerId); this.pruneOrder(inn);
    }
    newBatter(id) {
      const inn = this.requireInnings();
      this.checkBatter(inn, id);
      if (id === inn.strikerId || id === inn.nonStrikerId) fail('Already at the crease');
      this.push();
      if (!inn.strikerId) inn.strikerId = id; else if (!inn.nonStrikerId) inn.nonStrikerId = id; else fail('Both batters are already set');
      this.ensureOrder(inn, id);
    }
    setBowler(id, force) {
      const m = this.match, inn = this.requireInnings();
      if (id && teamKeyOf(m, id) !== inn.bowlingTeam) fail('That player is not in the bowling team');
      if (id && !force && m.rules.enforceBowler !== false) {
        const bpo = Math.max(1, m.ballsPerOver), legal = legalOf(inn), who = display(findPlayer(m, id));
        const lastDelivery = [...inn.balls].reverse().find(isDelivery);
        // Law 17.6: a bowler shall not bowl two overs consecutively.
        if (legal > 0 && legal % bpo === 0 && lastDelivery && isLegal(inn.balls[inn.balls.length - 1] || {}) && lastDelivery.bowlerId === id) fail(`${who} bowled the previous over and cannot bowl two in a row`);
        const limit = bowlerLimit(m, inn);
        if (limit && inn.balls.filter((b) => b.bowlerId === id && isLegal(b)).length >= limit * bpo) fail(`${who} has bowled the maximum of ${limit} over${limit === 1 ? '' : 's'}`);
      }
      this.push();
      inn.bowlerId = id || null;
    }
    swapStrike() { const inn = this.requireInnings(); this.push(); [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId]; }

    // ---- balls
    addBall(d) {
      const m = this.match, inn = this.requireInnings();
      if (!inn.strikerId || !inn.nonStrikerId) fail('Select both batters first');
      if (!inn.bowlerId) fail('Select the bowler first');
      const runsIn = Number(d.runs) || 0;
      if (runsIn < 0 || runsIn > 12) fail('Invalid runs');
      const extra = String(d.extra || '').toLowerCase();
      const b = { seq: inn.nextSeq++, bowlerId: inn.bowlerId, strikerId: inn.strikerId, nonStrikerId: inn.nonStrikerId, batRuns: 0, extra, extraRuns: 0, boundary: !!d.boundary, wicket: null, time: new Date().toISOString() };
      let ran;
      const nbByes = Math.max(0, Number(d.nbByes) || 0);
      switch (extra) {
        case '': b.batRuns = runsIn; ran = runsIn; break;
        case 'wd': b.extraRuns = 1 + runsIn; ran = runsIn; break;
        case 'nb': b.batRuns = runsIn; b.extraRuns = 1 + nbByes; ran = runsIn + nbByes; break;
        case 'b': case 'lb': if (runsIn <= 0) { inn.nextSeq--; fail('Byes need at least 1 run'); } b.extraRuns = runsIn; ran = runsIn; break;
        default: inn.nextSeq--; fail(`Unknown extra '${extra}'`);
      }
      if (d.boundary) ran = 0;
      if (d.wicket) {
        const w = { kind: d.wicket.kind || 'bowled', playerOutId: d.wicket.playerOutId || inn.strikerId, fielderId: d.wicket.fielderId || null };
        if (w.playerOutId !== inn.strikerId && w.playerOutId !== inn.nonStrikerId) { inn.nextSeq--; fail('Dismissed player must be one of the batters at the crease'); }
        // A batter cannot be out bowled, caught, lbw, stumped or hit wicket off a no-ball or on a free hit (Law 21.18).
        const free = computeInnings(m, m.currentInningsIndex, { available: false }).freeHit;
        if ((extra === 'nb' || free) && ['bowled', 'caught', 'caughtbowled', 'lbw', 'stumped', 'hitwicket'].includes(w.kind)) {
          inn.nextSeq--; fail(extra === 'nb' ? 'A batter cannot be out that way off a no-ball' : 'A batter cannot be out that way on a free hit');
        }
        if (w.kind === 'caughtbowled') w.fielderId = inn.bowlerId;
        b.wicket = w;
      }
      this.push();
      inn.balls.push(b);
      if (ran % 2 === 1) [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];
      if (b.wicket) { if (inn.strikerId === b.wicket.playerOutId) inn.strikerId = null; else if (inn.nonStrikerId === b.wicket.playerOutId) inn.nonStrikerId = null; }
      if (isLegal(b) && legalOf(inn) % Math.max(1, m.ballsPerOver) === 0) { [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId]; inn.bowlerId = null; }
      return b;
    }
    addPenalty(runs) {
      const inn = this.requireInnings();
      if (!(runs > 0)) fail('Penalty must be positive');
      this.push();
      inn.balls.push({ seq: inn.nextSeq++, bowlerId: inn.bowlerId || '', strikerId: inn.strikerId || '', nonStrikerId: inn.nonStrikerId || '', batRuns: 0, extra: 'pen', extraRuns: runs, boundary: false, wicket: null, time: new Date().toISOString() });
    }
    inningsFor(index) { const m = this.match; return index >= 0 && index < m.innings.length ? m.innings[index] : (current(m) || fail('No innings')); }
    editBall(d) {
      const inn = this.inningsFor(d.innings === undefined ? -1 : d.innings);
      const b = inn.balls.find((x) => x.seq === d.seq) || fail('Ball not found');
      this.push();
      b.batRuns = Math.max(0, Number(d.batRuns) || 0);
      b.extra = String(d.extra || '').toLowerCase();
      b.extraRuns = Math.max(0, Number(d.extraRuns) || 0);
      if ((b.extra === 'wd' || b.extra === 'nb') && b.extraRuns < 1) b.extraRuns = 1;
      b.boundary = !!d.boundary;
      b.wicket = d.wicket && d.wicket.playerOutId ? { kind: d.wicket.kind || 'bowled', playerOutId: d.wicket.playerOutId, fielderId: d.wicket.fielderId || null } : null;
      if (d.bowlerId) b.bowlerId = d.bowlerId;
      if (d.strikerId) b.strikerId = d.strikerId;
      if (d.nonStrikerId) b.nonStrikerId = d.nonStrikerId;
    }
    deleteBall(inningsIndex, seq) {
      const inn = this.inningsFor(inningsIndex);
      const i = inn.balls.findIndex((x) => x.seq === seq);
      if (i < 0) fail('Ball not found');
      this.push();
      inn.balls.splice(i, 1);
      this.pruneOrder(inn);
    }
    newMatch(keepTeams) {
      const old = this.match, m = newMatch();
      if (keepTeams) for (const k of ['tournament', 'venue', 'city', 'format', 'oversPerInnings', 'ballsPerOver', 'powerplayOvers', 'rules', 'teamA', 'teamB', 'officials', 'commentators']) m[k] = old[k];
      if (keepTeams) m.dls.g50 = old.dls.g50;
      this.replace(m);
    }
  }

  return { Engine, ScoringError, FORMATS, newMatch, normalise, compute, parseTable, validTable, builtInTable: () => BUILT_IN, resource: (o, w, t) => resource(t || BUILT_IN, o, w),
    ballLabel, howOut, oversString, defaultTvName, findPlayer, teamKeyOf, display, team, current, isLegal, isDelivery, total, perSide };
});
