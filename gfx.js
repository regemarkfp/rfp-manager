'use strict';
// Graphics playout (ported from CricketCG's GraphicsController / GraphicsCatalog / SportGraphics).
// Every graphic's data is a flat key -> text map. It goes to CasparCG over AMCP (CG ADD / UPDATE / STOP / NEXT /
// INVOKE), is mirrored to the browser output pages, and live graphics are refreshed whenever the score changes.
// On top of that: countdown, log table, fixtures and adverts for productions.
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const Cricket = require('../shared/cricket');
const Schema = require('../shared/schema');
const Scoring = require('../shared/scoring');
const { Amcp, cmd, quote } = require('./amcp');
const { detId, log, fail } = require('./util');
const actor = require('./actor');

const up = (s) => String(s === undefined || s === null ? '' : s).toUpperCase();
const txt = (v) => (v === undefined || v === null ? '' : v === true ? '1' : v === false ? '' : String(v));
// Small helper to build flat string maps.
class D { set(k, v) { this[k] = txt(v); return this; } }
const last = (a, f) => { for (let i = a.length - 1; i >= 0; i--) if (!f || f(a[i])) return a[i]; return null; };
const joinDot = (...p) => p.filter((x) => String(x || '').trim()).join('  ·  ');

// ============================================================================ cricket builders
function addTeam(d, prefix, t) { d.set(`${prefix}_name`, t.name).set(`${prefix}_short`, t.shortName).set(`${prefix}_logo`, t.logo).set(`${prefix}_color1`, t.color1).set(`${prefix}_color2`, t.color2); }
function common(c, layout) {
  const m = c.m, d = new D();
  d.set('layout', layout).set('tournament', m.tournament).set('match_title', String(m.matchTitle || '').trim() ? m.matchTitle : `${m.teamA.name} vs ${m.teamB.name}`)
    .set('match_number', m.matchNumber).set('venue', m.venue).set('city', m.city).set('format', m.format);
  addTeam(d, 'teamA', m.teamA); addTeam(d, 'teamB', m.teamB);
  d.set('status_text', c.s.statusText).set('toss_text', c.s.tossText).set('result_text', c.s.resultText);
  const dls = c.s.dls, showPar = dls.par !== null && m.dls.enabled && c.s.currentIndex === 1;
  d.set('dls_par', showPar ? dls.par : null).set('dls_diff', showPar ? dls.diff : null).set('dls_par_text', showPar ? dls.parText : '').set('dls_par_if_wicket', showPar ? dls.parIfWicket : null)
    .set('dls_target', dls.applied ? dls.target : null).set('dls_target_text', dls.applied ? dls.targetText : '').set('dls_applied', dls.applied);
  return d;
}
const cur = (c) => (c.s.currentIndex >= 0 && c.s.currentIndex < c.s.innings.length ? c.s.innings[c.s.currentIndex] : null);
function inn(c) {
  let i = c.p.innings === null || c.p.innings === undefined ? c.s.currentIndex : Number(c.p.innings);
  if (!(i >= 0 && i < c.s.innings.length)) i = c.s.innings.length - 1;
  return i >= 0 ? c.s.innings[i] : null;
}
function addInningsTeams(c, d, s) {
  if (!s) return;
  addTeam(d, 'bat', Cricket.team(c.m, s.battingTeam)); addTeam(d, 'bowl', Cricket.team(c.m, s.bowlingTeam));
  d.set('innings_no', s.number).set('innings_label', s.superOver ? 'SUPER OVER' : s.number === 1 ? '1ST INNINGS' : s.number === 2 ? '2ND INNINGS' : `INNINGS ${s.number}`)
    .set('runs', s.runs).set('wickets', s.wickets).set('score', s.score).set('score_dash', `${s.runs}-${s.wickets}`)
    .set('overs', s.overs).set('max_overs', s.maxBalls ? s.maxBalls / Math.max(1, c.m.ballsPerOver) : '').set('crr', s.runRate).set('extras', s.extras.total).set('extras_detail', s.extras.detail);
}
function lastBowlerId(c, s) {
  if (s.bowlerId) return s.bowlerId;
  const b = last(c.m.innings[s.index].balls, (x) => Cricket.isDelivery(x) && x.bowlerId);
  return b ? b.bowlerId : '';
}
function addBatter(d, p, b) {
  b = b || null;
  d.set(`${p}_name`, b && b.tvName).set(`${p}_fullname`, b && b.name).set(`${p}_runs`, b && b.runs).set(`${p}_balls`, b && b.balls).set(`${p}_fours`, b && b.fours).set(`${p}_sixes`, b && b.sixes)
    .set(`${p}_sr`, b && b.strikeRate).set(`${p}_onstrike`, !!(b && b.onStrike)).set(`${p}_status`, b && b.status).set(`${p}_howout`, b && b.howOut).set(`${p}_captain`, !!(b && b.captain)).set(`${p}_keeper`, !!(b && b.keeper));
}
function addBowler(d, p, b) {
  b = b || null;
  d.set(`${p}_name`, b && b.tvName).set(`${p}_fullname`, b && b.name).set(`${p}_overs`, b && b.overs).set(`${p}_maidens`, b && b.maidens).set(`${p}_runs`, b && b.runs).set(`${p}_wickets`, b && b.wickets)
    .set(`${p}_econ`, b && b.economy).set(`${p}_dots`, b && b.dots).set(`${p}_figures`, b ? b.figures : '').set(`${p}_analysis`, b ? `${b.overs}-${b.maidens}-${b.runs}-${b.wickets}` : '');
}
const atCrease = (s) => (s ? s.batting.filter((b) => b.status === 'batting').sort((a, b) => a.order - b.order) : []);
const ordinal = (n) => (n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`);
const star = (b) => (b.status === 'batting' || b.status === 'notout' ? '*' : '');
const venueLine = (m) => up([m.venue, m.city].filter((x) => String(x || '').trim()).join(', '));

const CB = {
  scoreBug(c) {
    const d = common(c, 'bug'), s = cur(c) || last(c.s.innings);
    d.set('strip_text', c.strip);
    if (!s) return d.set('score', '').set('overs', '');
    addInningsTeams(c, d, s);
    addBatter(d, 'striker', s.batting.find((b) => b.playerId === s.strikerId)); addBatter(d, 'nonstriker', s.batting.find((b) => b.playerId === s.nonStrikerId));
    const ac = atCrease(s);
    addBatter(d, 'bat1', ac[0]); addBatter(d, 'bat2', ac[1]);
    const bid = lastBowlerId(c, s);
    addBowler(d, 'bowler', s.bowling.find((b) => b.playerId === bid));
    d.set('this_over', s.thisOver.join(' ')).set('this_over_runs', s.thisOverRuns);
    for (let i = 0; i < 10; i++) d.set(`ball${i + 1}`, i < s.thisOver.length ? s.thisOver[i] : '');
    d.set('last_ball', s.lastBallLabel).set('target', s.target).set('runs_needed', s.runsNeeded).set('balls_remaining', s.ballsRemaining).set('rrr', s.requiredRate).set('projected', s.projectedScore)
      .set('need_text', s.target !== null ? c.s.statusText : '').set('powerplay', s.powerplayName || '').set('free_hit', s.freeHit ? 'FREE HIT' : '');
    const p = last(s.partnerships, (x) => x.current), lw = last(s.fow);
    d.set('partnership', p ? `${p.runs} (${p.balls})` : '').set('last_wicket', lw ? `${lw.name} ${lw.playerRuns}` : '');
    const prev = s.index > 0 ? c.s.innings[s.index - 1] : null;
    return d.set('prev_team_short', prev ? prev.battingTeamShort : '').set('prev_score', prev ? prev.score : '');
  },
  matchIntro: (c) => common(c, 'intro').set('title', c.m.tournament).set('subtitle', String(c.m.matchNumber || '').trim() ? `MATCH ${c.m.matchNumber}` : '').set('line1', up(`${c.m.teamA.name} v ${c.m.teamB.name}`)).set('line2', venueLine(c.m)),
  matchIntroLt: (c) => common(c, 'versus').set('line1', up(`${c.m.teamA.name} V ${c.m.teamB.name}`)).set('line2', up(c.m.tournament)),
  venueLt: (c) => common(c, 'text').set('line1', 'LIVE FROM').set('line2', venueLine(c.m)),
  tossLt(c) {
    const w = c.m.toss.winner ? Cricket.team(c.m, c.m.toss.winner) : null;
    return common(c, 'toss').set('line1', 'TOSS').set('line2', c.s.tossText).set('winner_name', w && w.name).set('winner_logo', w && w.logo).set('decision', c.m.toss.decision === 'bat' ? 'BAT' : c.m.toss.decision === 'field' ? 'FIELD' : '');
  },
  statusLt(c) {
    const d = common(c, 'status'), s = cur(c);
    addInningsTeams(c, d, s);
    d.set('line1', s ? up(`${s.battingTeamName} ${s.score} (${s.overs} OV)`) : up(c.m.tournament)).set('line2', c.s.statusText);
    if (s) d.set('target', s.target).set('runs_needed', s.runsNeeded).set('balls_remaining', s.ballsRemaining).set('rrr', s.requiredRate).set('projected', s.projectedScore);
    return d;
  },
  dlsParLt(c) {
    const d = common(c, 'text'), dls = c.s.dls;
    addInningsTeams(c, d, cur(c));
    return d.set('line1', 'DLS PAR SCORE').set('line2', dls.par === null ? '' : dls.parText + (dls.parIfWicket !== null ? `  ·  PAR ${dls.parIfWicket} IF A WICKET FALLS` : ''));
  },
  dlsTargetLt(c) {
    const d = common(c, 'text'), s = c.s.innings.length > 1 ? c.s.innings[1] : null;
    addInningsTeams(c, d, s || cur(c));
    const t = s ? up(Cricket.team(c.m, s.battingTeam).name) : '';
    return d.set('line1', 'REVISED TARGET (DLS)').set('line2', !s || s.target === null ? c.s.dls.targetText : `${t} NEED ${s.target} TO WIN FROM ${s.maxBalls / Math.max(1, c.m.ballsPerOver)} OVERS`);
  },
  resultLt: (c) => common(c, 'result').set('line1', 'RESULT').set('line2', c.s.resultText || c.s.statusText),
  matchSummary: (layout) => (c) => {
    const d = common(c, layout);
    d.set('title', layout === 'innings_break' ? 'INNINGS BREAK' : 'MATCH SUMMARY').set('innings_count', c.s.innings.length);
    for (let n = 0; n < 4; n++) {
      const p = `in${n + 1}`, s = c.s.innings[n] || null, t = s ? Cricket.team(c.m, s.battingTeam) : null;
      d.set(`${p}_team`, t && t.name).set(`${p}_short`, t && t.shortName).set(`${p}_logo`, t && t.logo).set(`${p}_score`, s && s.score).set(`${p}_overs`, s && s.overs).set(`${p}_label`, s ? `${s.overs} OVERS` : '');
      const bats = s ? s.batting.slice().sort((a, b) => (b.runs - a.runs) || (a.balls - b.balls)).slice(0, 3) : [];
      const bowls = s ? s.bowling.slice().sort((a, b) => (b.wickets - a.wickets) || (a.runs - b.runs)).slice(0, 3) : [];
      for (let k = 0; k < 3; k++) {
        const b = bats[k], w = bowls[k];
        d.set(`${p}_bat${k + 1}_name`, b && b.tvName).set(`${p}_bat${k + 1}_runs`, b ? b.runs + star(b) : '').set(`${p}_bat${k + 1}_balls`, b && b.balls)
          .set(`${p}_bowl${k + 1}_name`, w && w.tvName).set(`${p}_bowl${k + 1}_fig`, w && w.figures).set(`${p}_bowl${k + 1}_overs`, w && w.overs);
      }
    }
    return d.set('footer', c.s.statusText);
  },
  chart: (layout) => (c) => {
    const d = common(c, layout);
    d.set('title', layout === 'worm' ? 'THE WORM' : 'MANHATTAN').set('max_overs', c.m.oversPerInnings || '');
    const only = layout === 'manhattan' ? inn(c) : null;
    let slot = 0;
    for (const s of c.s.innings) {
      if (only && s.index !== only.index) continue;
      if (++slot > 2) break;
      const p = `in${slot}`, t = Cricket.team(c.m, s.battingTeam);
      d.set(`${p}_team`, t.name).set(`${p}_short`, t.shortName).set(`${p}_color`, t.color1).set(`${p}_score`, s.score).set(`${p}_overs_played`, s.overs)
        .set(`${p}_runs_per_over`, s.overList.map((o) => o.runs).join(',')).set(`${p}_cumulative`, s.overList.map((o) => o.cumulative).join(',')).set(`${p}_wickets_per_over`, s.overList.map((o) => o.wickets).join(','));
    }
    return d.set('series_count', Math.min(2, slot));
  },
  battingCard(c) {
    const d = common(c, 'batting_card'), s = inn(c), rows = s ? s.batting : [];
    addInningsTeams(c, d, s);
    d.set('title', 'BATTING');
    for (let i = 0; i < 11; i++) addBatter(d, `b${i + 1}`, rows[i]);
    return d.set('rows', rows.length).set('yet_to_bat', s ? s.yetToBat.map((x) => x.tvName).join(', ') : '').set('fow_text', s ? s.fow.map((f) => `${f.wicket}-${f.score} (${f.name}, ${f.over})`).join('  ') : '')
      .set('total_line', s ? `TOTAL ${s.score} (${s.overs} OVERS, RR ${s.runRate})` : '').set('footer', c.s.statusText);
  },
  bowlingCard(c) {
    const d = common(c, 'bowling_card'), s = inn(c), rows = s ? s.bowling : [];
    addInningsTeams(c, d, s);
    d.set('title', 'BOWLING');
    for (let i = 0; i < 11; i++) addBowler(d, `w${i + 1}`, rows[i]);
    return d.set('rows', rows.length).set('footer', c.s.statusText);
  },
  batterLt(c) {
    const d = common(c, 'batter'), s = inn(c);
    addInningsTeams(c, d, s);
    const id = c.p.playerId || (s && s.strikerId);
    const b = s ? s.batting.find((x) => x.playerId === id) || last(c.s.innings.flatMap((x) => x.batting), (x) => x.playerId === id) : null;
    addBatter(d, 'player', b);
    const p = Cricket.findPlayer(c.m, b && b.playerId), t = p ? Cricket.team(c.m, Cricket.teamKeyOf(c.m, p.id) || 'A') : null;
    return d.set('player_team', t && t.name).set('player_logo', t && t.logo).set('player_photo', p && p.photo).set('line1', b && b.tvName)
      .set('line2', b ? `${b.runs}${star(b)} (${b.balls})   4s ${b.fours}   6s ${b.sixes}   SR ${b.strikeRate}` : '');
  },
  battersLt(c) {
    const d = common(c, 'batters'), s = cur(c), ac = atCrease(s);
    addInningsTeams(c, d, s);
    addBatter(d, 'bat1', ac[0]); addBatter(d, 'bat2', ac[1]);
    const p = s ? last(s.partnerships, (x) => x.current) : null;
    return d.set('partnership', p ? `PARTNERSHIP ${p.runs} (${p.balls})` : '');
  },
  addPartnership(d, x, p) {
    p = p || null;
    d.set(`${x}_wicket`, p && p.forWicket).set(`${x}_runs`, p && p.runs).set(`${x}_balls`, p && p.balls).set(`${x}_b1_name`, p && p.batter1Name).set(`${x}_b1_runs`, p && p.batter1Runs).set(`${x}_b1_balls`, p && p.batter1Balls)
      .set(`${x}_b2_name`, p && p.batter2Name).set(`${x}_b2_runs`, p && p.batter2Runs).set(`${x}_b2_balls`, p && p.batter2Balls);
  },
  partnershipLt(c) {
    const d = common(c, 'partnership'), s = cur(c), p = s ? last(s.partnerships) : null;
    addInningsTeams(c, d, s);
    CB.addPartnership(d, 'p', p);
    return d.set('line1', p ? `${ordinal(p.forWicket)} WICKET PARTNERSHIP` : 'PARTNERSHIP')
      .set('line2', p ? `${p.runs} RUNS (${p.balls} BALLS)   ${p.batter1Name} ${p.batter1Runs} (${p.batter1Balls})   ${p.batter2Name} ${p.batter2Runs} (${p.batter2Balls})` : '');
  },
  partnershipsFs(c) {
    const d = common(c, 'partnerships'), s = inn(c), rows = s ? s.partnerships : [];
    addInningsTeams(c, d, s);
    d.set('title', 'PARTNERSHIPS');
    for (let i = 0; i < 10; i++) CB.addPartnership(d, `p${i + 1}`, rows[i]);
    return d.set('rows', Math.min(10, rows.length));
  },
  fowFs(c) {
    const d = common(c, 'fow'), s = inn(c), rows = s ? s.fow : [];
    addInningsTeams(c, d, s);
    d.set('title', 'FALL OF WICKETS');
    for (let i = 0; i < 10; i++) { const f = rows[i] || null; d.set(`f${i + 1}_wicket`, f && f.wicket).set(`f${i + 1}_score`, f && f.score).set(`f${i + 1}_over`, f && f.over).set(`f${i + 1}_name`, f && f.name).set(`f${i + 1}_runs`, f && f.playerRuns); }
    return d.set('rows', rows.length);
  },
  fowLt(c) {
    const d = common(c, 'fow_lt'), s = inn(c);
    addInningsTeams(c, d, s);
    return d.set('line1', 'FALL OF WICKETS').set('line2', s ? s.fow.map((f) => `${f.wicket}-${f.score}`).join('   ') : '');
  },
  batterOut(c) {
    const d = common(c, 'batter_out'), s = cur(c), f = s ? last(s.fow) : null, b = f ? s.batting.find((x) => x.playerId === f.playerId) : null;
    addInningsTeams(c, d, s);
    addBatter(d, 'player', b);
    return d.set('line1', b && b.tvName).set('line2', b ? up(`${b.howOut}   ${b.runs} (${b.balls})   4s ${b.fours}  6s ${b.sixes}`) : '').set('fow', f ? `${f.wicket}-${f.score} (${f.over} OV)` : '');
  },
  bowlerLt(c) {
    const d = common(c, 'bowler'), s = inn(c);
    addInningsTeams(c, d, s);
    let b = null;
    if (s) {
      const id = c.p.playerId || lastBowlerId(c, s);
      b = s.bowling.find((x) => x.playerId === id) || null;
      const pl = !b && id ? Cricket.findPlayer(c.m, id) : null;
      if (pl) b = { playerId: pl.id, name: pl.name, tvName: Cricket.display(pl), overs: '0', maidens: 0, runs: 0, wickets: 0, economy: '0.00', dots: 0, figures: '0-0' };
    }
    addBowler(d, 'player', b);
    const p = Cricket.findPlayer(c.m, b && b.playerId);
    return d.set('player_photo', p && p.photo).set('line1', b && b.tvName).set('line2', b ? `${b.overs} OV   ${b.maidens} M   ${b.runs} R   ${b.wickets} W   ECON ${b.economy}` : '');
  },
  overLt(c) {
    const d = common(c, 'over'), s = cur(c), o = s ? last(s.overList) : null;
    addInningsTeams(c, d, s);
    d.set('line1', o ? `OVER ${o.over}  -  ${o.bowlerName}` : 'THIS OVER').set('line2', o ? `${o.balls.join('  ')}     ${o.runs} RUNS` : '');
    for (let i = 0; i < 10; i++) d.set(`ball${i + 1}`, o && i < o.balls.length ? o.balls[i] : '');
    return d;
  },
  teamParam: (c) => Cricket.team(c.m, c.p.team || 'A'),
  squad(c) {
    const d = common(c, 'squad'), t = CB.teamParam(c);
    addTeam(d, 'team', t);
    d.set('title', 'SQUAD').set('coach', t.coach);
    for (let i = 0; i < 16; i++) { const p = t.players[i] || null; d.set(`p${i + 1}_name`, p && Cricket.display(p)).set(`p${i + 1}_fullname`, p && p.name).set(`p${i + 1}_role`, p && p.role).set(`p${i + 1}_captain`, !!(p && p.captain)).set(`p${i + 1}_keeper`, !!(p && p.keeper)); }
    return d.set('rows', Math.min(16, t.players.length));
  },
  playerLt(c) {
    const d = common(c, 'player'), p = Cricket.findPlayer(c.m, c.p.playerId), t = p ? Cricket.team(c.m, Cricket.teamKeyOf(c.m, p.id) || 'A') : null;
    d.set('player_name', p && Cricket.display(p)).set('player_fullname', p && p.name).set('player_role', p && p.role).set('player_photo', p && p.photo).set('player_team', t && t.name).set('player_logo', t && t.logo)
      .set('player_captain', !!(p && p.captain)).set('player_keeper', !!(p && p.keeper));
    return d.set('line1', p ? up(p.name + (p.captain ? ' (C)' : '') + (p.keeper ? ' (WK)' : '')) : '').set('line2', up([t && t.name, p && p.role].filter((x) => String(x || '').trim()).join('  |  ')));
  },
  coachLt(c) { const d = common(c, 'text'), t = CB.teamParam(c); addTeam(d, 'team', t); return d.set('line1', up(t.coach)).set('line2', up(`${t.name} HEAD COACH`)); },
  addOfficials(c, d) { const o = c.m.officials; return d.set('umpire1', up(o.umpire1)).set('umpire2', up(o.umpire2)).set('tv_umpire', up(o.tvUmpire)).set('fourth_umpire', up(o.fourthUmpire)).set('referee', up(o.referee)); },
  umpiresLt(c) {
    const o = c.m.officials;
    return CB.addOfficials(c, common(c, 'double')).set('line1', 'UMPIRES').set('line2', up(`${o.umpire1} & ${o.umpire2}`)).set('left_title', 'UMPIRE').set('left_name', up(o.umpire1)).set('right_title', 'UMPIRE').set('right_name', up(o.umpire2));
  },
  tvRefLt(c) {
    const o = c.m.officials;
    return CB.addOfficials(c, common(c, 'double')).set('line1', 'TV UMPIRE & MATCH REFEREE').set('line2', up(`${o.tvUmpire} & ${o.referee}`)).set('left_title', 'TV UMPIRE').set('left_name', up(o.tvUmpire)).set('right_title', 'MATCH REFEREE').set('right_name', up(o.referee));
  },
  officialsFs: (c) => CB.addOfficials(c, common(c, 'officials')).set('title', 'MATCH OFFICIALS'),
  commentatorsLt(c) {
    const d = common(c, 'commentators'), list = c.m.commentators || [];
    for (let i = 0; i < 4; i++) d.set(`comm${i + 1}`, i < list.length ? up(list[i]) : '');
    return d.set('count', list.length).set('line1', list.length === 1 ? 'COMMENTATOR' : 'COMMENTATORS').set('line2', up(list.join('  &  ')));
  },
  wipe: (type) => (c) => {
    const d = common(c, 'wipe'), s = cur(c);
    d.set('type', type).set('text', type);
    addInningsTeams(c, d, s);
    if (s) {
      const lastB = last(c.m.innings[s.index].balls, Cricket.isDelivery);
      const id = type === 'WICKET' ? lastB && lastB.wicket && lastB.wicket.playerOutId : lastB && lastB.strikerId;
      const b = s.batting.find((x) => x.playerId === id) || null;
      d.set('player_name', b && b.tvName).set('player_runs', b && b.runs).set('player_balls', b && b.balls).set('player_howout', type === 'WICKET' ? b && b.howOut : '');
    }
    return d;
  },
};

// ============================================================================ other sports builders
const F = (c, k) => (c.sport && c.sport.flat && c.sport.flat[k] !== undefined ? c.sport.flat[k] : '');
const num = (n) => (String(n || '').trim() ? '#' + n + ' ' : '');
const teamKey = (c) => (c.p.team === 'B' ? 'B' : 'A');
function sdata(c, layout) {
  const d = new D();
  if (c.sport) { Object.assign(d, c.sport.flat || {}); Object.assign(d, c.liveKeys()); }
  return d.set('layout', layout);
}
const lower = (c, layout, l1, l2) => sdata(c, layout).set('line1', l1).set('line2', l2);
const sportPlayers = (c) => (c.sport && c.sport.derived && Array.isArray(c.sport.derived.players) ? c.sport.derived.players : []);
const teamStats = (c) => (c.sport && c.sport.derived && Array.isArray(c.sport.derived.teamStats) ? c.sport.derived.teamStats : []);
const blank = (x) => /^(0|0\/0|–|-|)$/.test(String(x == null ? '' : x).trim());
function statHead(c, title) {
  const d = sdata(c, 'compare').set('title', title);
  return d;
}
const SB = {
  // n = 1: the statistic chosen in graphics control (c.p.stat = its label); n = 3: the first three with numbers
  statCompare: (n) => (c) => {
    const all = teamStats(c), d = statHead(c, 'MATCH STATS');
    let rows;
    if (n === 1) { const pick = all.find((s) => s.label === c.p.stat) || all.find((s) => !blank(s.a) || !blank(s.b)) || all[0]; rows = pick ? [pick] : []; }
    else rows = all.filter((s) => !blank(s.a) || !blank(s.b)).slice(0, n);
    d.set('rows', rows.length);
    rows.forEach((s, i) => d.set(`row${i + 1}_label`, s.label).set(`row${i + 1}_a`, s.a).set(`row${i + 1}_b`, s.b));
    return d;
  },
  statShares(c) {
    const all = teamStats(c), d = statHead(c, 'MATCH STATS'), rows = all.filter((s) => s.label === 'POSSESSION' || s.label === 'TERRITORY');
    d.set('rows', rows.length);
    rows.forEach((s, i) => d.set(`row${i + 1}_label`, s.label).set(`row${i + 1}_a`, s.a).set(`row${i + 1}_b`, s.b));
    return d;
  },
  playerStats(c) {
    const p = sportPlayers(c).find((x) => String(x.id) === String(c.p.playerId)) || null, d = sdata(c, 'player'), t = p ? p.team : '';
    const list = (p && Array.isArray(p.statList) ? p.statList : []).slice(0, 8);
    d.set('player_name', p ? p.tvName : '').set('player_number', p ? p.number : '').set('player_position', p ? up(p.position) : '').set('player_team', t === 'A' || t === 'B' ? F(c, `team${t}_name`) : up(p ? p.teamName : ''));
    if (t === 'A' || t === 'B') d.set('player_logo', F(c, `team${t}_logo`)).set('player_color', F(c, `team${t}_color1`));
    d.set('boxes', list.length);
    list.forEach((x, i) => d.set(`box${i + 1}_label`, x[0]).set(`box${i + 1}_value`, x[1]));
    return d;
  },
  lastEvent(c) {
    const t = F(c, 'last_team'), d = lower(c, 'text', F(c, 'last_text'), joinDot(F(c, 'last_team_name'), F(c, 'period')));
    if (t === 'A' || t === 'B') d.set('team_logo', F(c, `team${t}_logo`)).set('team_color1', F(c, `team${t}_color1`)).set('bat_color1', F(c, `team${t}_color1`));
    return d;
  },
  player(c) {
    const p = sportPlayers(c).find((x) => String(x.id) === String(c.p.playerId)) || null, S = (k) => (p ? txt(p[k]) : '');
    const t = S('team'), tn = t === 'A' || t === 'B' ? F(c, `team${t}_name`) : up(S('teamName'));
    const d = lower(c, 'player', num(S('number')) + S('tvName'), joinDot(tn, up(S('position')), S('statsText')));
    d.set('player_name', S('tvName')).set('player_fullname', S('name')).set('player_number', S('number')).set('player_position', S('position')).set('player_team', tn).set('player_stats', S('statsText')).set('player_result', S('result')).set('player_rank', S('rank'));
    if (t === 'A' || t === 'B') d.set('player_logo', F(c, `team${t}_logo`)).set('bat_color1', F(c, `team${t}_color1`));
    return d;
  },
  // athletics: one athlete – lane (or order), team, and the result, the attempts and best mark, or PB / SB
  athlete(c, id) {
    const p = sportPlayers(c).find((x) => String(x.id) === String(id == null ? c.p.playerId : id)) || null, S = (k) => (p ? txt(p[k]) : '');
    const field = S('kind') === 'field', where = S('lane') ? `${field ? 'ORDER' : 'LANE'} ${S('lane')}` : '';
    const detail = S('result') ? joinDot(S('rank') ? 'POS ' + S('rank') : '', S('result'), up(S('note')))
      : field && S('attemptsText') ? joinDot(up(S('attemptsText')), S('best') ? 'BEST ' + S('best') : '')
        : joinDot(S('pb') ? 'PB ' + S('pb') : '', S('sb') ? 'SB ' + S('sb') : '');
    const d = lower(c, 'player', S('tvName'), joinDot(where, up(S('teamName')), detail));
    d.set('player_name', S('tvName')).set('player_fullname', S('name')).set('player_number', S('bib')).set('player_position', where).set('player_team', up(S('teamName')))
      .set('player_stats', detail).set('player_result', S('result')).set('player_rank', S('rank')).set('player_lane', S('lane')).set('player_pb', S('pb')).set('player_sb', S('sb')).set('player_attempts', up(S('attemptsText'))).set('player_best', S('best'));
    return d;
  },
  lineup(c) {
    const k = teamKey(c), d = sdata(c, 'lineup');
    d.set('title', 'TEAM LINE-UP').set('team_name', F(c, `team${k}_name`)).set('team_logo', F(c, `team${k}_logo`)).set('team_color1', F(c, `team${k}_color1`)).set('team_color2', F(c, `team${k}_color2`)).set('coach', F(c, `team${k}_coach`));
    let i = 0;
    for (const p of sportPlayers(c)) {
      if (p.team !== k) continue;
      i++;
      d.set(`p${i}_number`, p.number).set(`p${i}_name`, p.tvName).set(`p${i}_fullname`, p.name).set(`p${i}_position`, p.position);
      if (i >= 30) break;
    }
    return d.set('rows', i);
  },
  wipe: (fixed) => (c) => {
    const d = sdata(c, 'wipe');
    let text = fixed === null ? '' : fixed;
    if (fixed === null) { const le = c.sport && c.sport.derived && c.sport.derived.lastEvent; text = (le && le.wipe) || 'GOAL'; }
    const t = F(c, 'last_team');
    d.set('type', text).set('text', text).set('player_name', '');
    if (t === 'A' || t === 'B') d.set('team_color1', F(c, `team${t}_color1`)).set('team_name', F(c, `team${t}_name`));
    return d;
  },
};

// ============================================================================ catalog
const G = (id, name, group, kind, template, layer, build, extra) => Object.assign({ id, name, group, kind, template, channel: 0, layer, format: null, param: 'none', live: false, autoClearMs: 0, inputs: [], description: '', mode: 'cricket', build }, extra || {});
function createCatalog(prod) {
  const L = { live: true }, W = { autoClearMs: 3500 }, S = { mode: 'sport' }, SL = { mode: 'sport', live: true };
  return [
    G('scorebug', 'Score Bug', 'Main', 'bug', 'scorebug', 20, CB.scoreBug, { live: true, description: 'Main score ticker. Updates automatically every ball.' }),
    G('match_intro', 'Match Intro (FS)', 'Match', 'fs', 'fullframe', 40, CB.matchIntro),
    G('match_intro_lt', 'Match Intro (LT)', 'Match', 'lt', 'lowerthird', 30, CB.matchIntroLt),
    G('venue_lt', 'Live From Venue', 'Match', 'lt', 'lowerthird', 30, CB.venueLt),
    G('toss', 'Toss Result', 'Match', 'lt', 'lowerthird', 30, CB.tossLt),
    G('status_lt', 'Match Situation / Target', 'Match', 'lt', 'lowerthird', 30, CB.statusLt, L),
    G('innings_break', 'Innings Break (FS)', 'Match', 'fs', 'fullframe', 40, CB.matchSummary('innings_break'), L),
    G('match_summary', 'Match Summary (FS)', 'Match', 'fs', 'fullframe', 40, CB.matchSummary('summary'), L),
    G('dls_par_lt', 'DLS Par Score', 'Match', 'lt', 'lowerthird', 30, CB.dlsParLt, L),
    G('dls_target_lt', 'DLS Revised Target', 'Match', 'lt', 'lowerthird', 30, CB.dlsTargetLt, L),
    G('result_lt', 'Result (LT)', 'Match', 'lt', 'lowerthird', 30, CB.resultLt, L),
    G('worm', 'Worm', 'Match', 'fs', 'fullframe', 40, CB.chart('worm'), L),
    G('manhattan', 'Manhattan', 'Match', 'fs', 'fullframe', 40, CB.chart('manhattan'), { live: true, param: 'innings' }),
    G('batting_card', 'Batting Card', 'Batting', 'fs', 'fullframe', 40, CB.battingCard, { live: true, param: 'innings' }),
    G('batter_lt', 'Batter Lower Third', 'Batting', 'lt', 'lowerthird', 30, CB.batterLt, { live: true, param: 'batter' }),
    G('batters_lt', 'Current Batters', 'Batting', 'lt', 'lowerthird', 30, CB.battersLt, L),
    G('partnership_lt', 'Partnership', 'Batting', 'lt', 'lowerthird', 30, CB.partnershipLt, L),
    G('partnerships_fs', 'Partnerships (FS)', 'Batting', 'fs', 'fullframe', 40, CB.partnershipsFs, { live: true, param: 'innings' }),
    G('fow_fs', 'Fall of Wickets (FS)', 'Batting', 'fs', 'fullframe', 40, CB.fowFs, { live: true, param: 'innings' }),
    G('fow_lt', 'Fall of Wicket (LT)', 'Batting', 'lt', 'lowerthird', 30, CB.fowLt, { param: 'innings' }),
    G('batter_out', 'Batter Out', 'Batting', 'lt', 'lowerthird', 30, CB.batterOut),
    G('bowling_card', 'Bowling Card', 'Bowling', 'fs', 'fullframe', 40, CB.bowlingCard, { live: true, param: 'innings' }),
    G('bowler_lt', 'Bowler Lower Third', 'Bowling', 'lt', 'lowerthird', 30, CB.bowlerLt, { live: true, param: 'bowler' }),
    G('over_summary', 'This Over', 'Bowling', 'lt', 'lowerthird', 30, CB.overLt, L),
    G('squad', 'Squad / Team Sheet', 'Teams', 'fs', 'fullframe', 40, CB.squad, { param: 'team' }),
    G('player_lt', 'Player Name + Team', 'Teams', 'lt', 'lowerthird', 30, CB.playerLt, { param: 'player' }),
    G('coach_lt', 'Head Coach', 'Teams', 'lt', 'lowerthird', 30, CB.coachLt, { param: 'team' }),
    G('umpires_lt', 'Umpires', 'Officials', 'lt', 'lowerthird', 30, CB.umpiresLt),
    G('tv_ref_lt', 'TV Umpire & Referee', 'Officials', 'lt', 'lowerthird', 30, CB.tvRefLt),
    G('officials_fs', 'Match Officials (FS)', 'Officials', 'fs', 'fullframe', 40, CB.officialsFs),
    G('commentators_lt', 'Commentators', 'Officials', 'lt', 'lowerthird', 30, CB.commentatorsLt),
    G('custom_lt', 'Custom Lower Third', 'Custom', 'lt', 'lowerthird', 30, (c) => common(c, 'text').set('line1', '').set('line2', ''), { inputs: ['line1', 'line2'], mode: 'any' }),
    G('custom_fs', 'Custom Full Frame', 'Custom', 'fs', 'fullframe', 40, (c) => common(c, 'text').set('title', '').set('subtitle', '').set('body', ''), { inputs: ['title', 'subtitle', 'body'], mode: 'any' }),
    G('wipe_four', 'FOUR', 'Wipes', 'wipe', 'wipe', 60, CB.wipe('FOUR'), W),
    G('wipe_six', 'SIX', 'Wipes', 'wipe', 'wipe', 60, CB.wipe('SIX'), W),
    G('wipe_wicket', 'WICKET', 'Wipes', 'wipe', 'wipe', 60, CB.wipe('WICKET'), W),
    G('wipe_freehit', 'FREE HIT', 'Wipes', 'wipe', 'wipe', 60, CB.wipe('FREE HIT'), W),
    // ---- other sports
    G('sport_bug', 'Score Bug', 'Sport Main', 'bug', 'sport_bug', 20, (c) => sdata(c, 'bug'), Object.assign({ description: 'Score bug with clock / sets / count – updates automatically.' }, SL)),
    G('sport_clock', 'Clock Only', 'Sport Main', 'bug', 'sport_bug', 21, (c) => sdata(c, 'clock'), SL),
    G('sport_score_lt', 'Score Lower Third', 'Sport Main', 'lt', 'lowerthird', 30, (c) => lower(c, 'text', F(c, 'match_line'), joinDot(F(c, 'period'), F(c, 'status_text'))), SL),
    G('sport_status_lt', 'Status / Match Point', 'Sport Main', 'lt', 'lowerthird', 30, (c) => lower(c, 'text', F(c, 'status_text'), F(c, 'match_line')), SL),
    G('sport_last_lt', 'Last Event (score / card)', 'Sport Main', 'lt', 'lowerthird', 30, SB.lastEvent, S),
    G('sport_sub_lt', 'Substitution', 'Sport Main', 'lt', 'lowerthird', 30, (c) => lower(c, 'double', 'SUBSTITUTION', F(c, 'last_team_name')).set('left_title', 'ON').set('left_name', num(F(c, 'sub_on_number')) + F(c, 'sub_on')).set('right_title', 'OFF').set('right_name', num(F(c, 'sub_off_number')) + F(c, 'sub_off')), S),
    G('sport_commentators_lt', 'Commentators', 'Sport Officials', 'lt', 'lowerthird', 30, (c) => lower(c, 'commentators', Number(F(c, 'commentators_count')) === 1 ? 'COMMENTATOR' : 'COMMENTATORS', F(c, 'commentators')).set('count', F(c, 'commentators_count')), S),
    G('sport_referee_lt', 'Referee', 'Sport Officials', 'lt', 'lowerthird', 30, (c) => lower(c, 'text', F(c, 'referee'), F(c, 'referee_title') || 'REFEREE'), S),
    G('sport_officials_lt', 'Officials 1 & 2', 'Sport Officials', 'lt', 'lowerthird', 30, (c) => lower(c, 'double', 'MATCH OFFICIALS', [F(c, 'official1_name'), F(c, 'official2_name')].filter(Boolean).join(' & ')).set('left_title', F(c, 'official1_role')).set('left_name', F(c, 'official1_name')).set('right_title', F(c, 'official2_role')).set('right_name', F(c, 'official2_name')), S),
    G('sport_officials34_lt', 'Officials 3 & 4', 'Sport Officials', 'lt', 'lowerthird', 30, (c) => lower(c, 'double', 'MATCH OFFICIALS', [F(c, 'official3_name'), F(c, 'official4_name')].filter(Boolean).join(' & ')).set('left_title', F(c, 'official3_role')).set('left_name', F(c, 'official3_name')).set('right_title', F(c, 'official4_role')).set('right_name', F(c, 'official4_name')), S),
    G('sport_officials_fs', 'Match Officials (FS)', 'Sport Officials', 'fs', 'sport_full', 40, (c) => sdata(c, 'officials').set('title', 'MATCH OFFICIALS'), S),
    G('sport_summary_fs', 'Score Summary (FS)', 'Sport Scores', 'fs', 'sport_full', 40, (c) => sdata(c, 'summary').set('title', F(c, 'competition') || F(c, 'sport_name')), SL),
    G('sport_stats_fs', 'Team Stats (FS)', 'Sport Scores', 'fs', 'sport_full', 40, (c) => sdata(c, 'stats').set('title', 'MATCH STATS'), SL),
    G('sport_stats2_fs', 'Team Stats – page 2 (FS)', 'Sport Scores', 'fs', 'sport_full', 40, (c) => sdata(c, 'stats').set('title', 'MATCH STATS').set('stats_from', '10'), SL),
    G('sport_stats3_fs', 'Team Stats – page 3 (FS)', 'Sport Scores', 'fs', 'sport_full', 40, (c) => sdata(c, 'stats').set('title', 'MATCH STATS').set('stats_from', '19'), SL),
    G('sport_stat_lt', 'Stat comparison (LT)', 'Sport Stats', 'lt', 'sport_stat', 30, SB.statCompare(1), Object.assign({ param: 'stat', description: 'One statistic for both teams with badges and a bar. Choose the statistic on the right.' }, SL)),
    G('sport_keystats_lt', 'Key stats (LT)', 'Sport Stats', 'lt', 'sport_stat', 30, SB.statCompare(3), Object.assign({ description: 'The first three statistics that have numbers. Change them in the Data panel if you want others.' }, SL)),
    G('sport_poss_lt', 'Possession & territory (LT)', 'Sport Stats', 'lt', 'sport_stat', 30, SB.statShares, Object.assign({ description: 'Possession, and territory where the sport has it.' }, SL)),
    G('sport_playerstats_lt', 'Player stats (LT)', 'Sport Stats', 'lt', 'sport_stat', 30, SB.playerStats, { mode: 'sport', live: true, param: 'player', description: 'Badge, name and every counted statistic of one player.' }),
    G('sport_timeline_fs', 'Timeline (FS)', 'Sport Scores', 'fs', 'sport_full', 40, (c) => sdata(c, 'timeline').set('title', 'KEY MOMENTS'), SL),
    G('sport_leaders_fs', 'Leaders (FS)', 'Sport Scores', 'fs', 'sport_full', 40, (c) => sdata(c, 'leaders').set('title', 'LEADERS'), SL),
    G('sport_lineup_fs', 'Team Line-up (FS)', 'Sport Teams', 'fs', 'sport_full', 40, SB.lineup, { mode: 'sport', param: 'team' }),
    G('sport_player_lt', 'Player Name', 'Sport Teams', 'lt', 'lowerthird', 30, SB.player, { mode: 'sport', live: true, param: 'player' }),
    G('sport_coach_lt', 'Coach', 'Sport Teams', 'lt', 'lowerthird', 30, (c) => lower(c, 'text', F(c, `team${teamKey(c)}_coach`), `${F(c, `team${teamKey(c)}_name`)} HEAD COACH`).set('team_logo', F(c, `team${teamKey(c)}_logo`)), { mode: 'sport', param: 'team' }),
    G('ath_startlist_fs', 'Start List (FS)', 'Athletics', 'fs', 'sport_full', 40, (c) => sdata(c, 'startlist').set('title', F(c, 'ath_event')).set('subtitle', joinDot(F(c, 'ath_round'), 'START LIST')), SL),
    G('ath_results_fs', 'Results (FS)', 'Athletics', 'fs', 'sport_full', 40, (c) => sdata(c, 'results').set('title', F(c, 'ath_event')).set('subtitle', joinDot(F(c, 'ath_round'), 'RESULTS', F(c, 'ath_wind') ? 'WIND ' + F(c, 'ath_wind') : '')), SL),
    G('ath_athlete_lt', 'Athlete Lower Third', 'Athletics', 'lt', 'lowerthird', 30, (c) => SB.athlete(c), { mode: 'sport', live: true, param: 'player' }),
    G('ath_up_lt', 'Field: Athlete Up', 'Athletics', 'lt', 'lowerthird', 30, (c) => { const d = SB.athlete(c, F(c, 'ath_up_id')); d.set('line2', joinDot(F(c, 'ath_bar') ? 'BAR ' + F(c, 'ath_bar') : 'ROUND ' + F(c, 'ath_attempt_round'), 'ATTEMPT ' + F(c, 'ath_up_try'), F(c, 'ath_up_attempts'), F(c, 'ath_up_best') ? 'BEST ' + F(c, 'ath_up_best') : '')); return d; }, { mode: 'sport', live: true, description: 'The field athlete who is up now, with their attempts and best mark.' }),
    G('ath_winner_lt', 'Winner', 'Athletics', 'lt', 'lowerthird', 30, (c) => lower(c, 'text', F(c, 'ath_winner_name'), joinDot(F(c, 'ath_winner_team'), F(c, 'ath_winner_result'), F(c, 'ath_winner_note'), F(c, 'ath_event'))), SL),
    G('ath_event_lt', 'Event Title', 'Athletics', 'lt', 'lowerthird', 30, (c) => lower(c, 'text', F(c, 'ath_event'), joinDot(F(c, 'ath_event_num') ? 'EVENT ' + F(c, 'ath_event_num') : '', F(c, 'ath_round'), F(c, 'competition'))), S),
    G('ath_clock', 'Race Clock', 'Athletics', 'bug', 'sport_bug', 21, (c) => sdata(c, 'clock').set('clock_label', F(c, 'ath_event')), SL),
    G('sport_wipe', 'Wipe (last event)', 'Sport Wipes', 'wipe', 'wipe', 60, SB.wipe(null), Object.assign({}, S, W)),
    G('sport_wipe_goal', 'GOAL', 'Sport Wipes', 'wipe', 'wipe', 60, SB.wipe('GOAL'), Object.assign({}, S, W)),
    G('sport_wipe_try', 'TRY', 'Sport Wipes', 'wipe', 'wipe', 60, SB.wipe('TRY'), Object.assign({}, S, W)),
    G('sport_wipe_ace', 'ACE', 'Sport Wipes', 'wipe', 'wipe', 60, SB.wipe('ACE'), Object.assign({}, S, W)),
    G('sport_wipe_hr', 'HOME RUN', 'Sport Wipes', 'wipe', 'wipe', 60, SB.wipe('HOME RUN'), Object.assign({}, S, W)),
    G('sport_wipe_custom', 'Custom wipe', 'Sport Wipes', 'wipe', 'wipe', 60, (c) => SB.wipe('')(c).set('text', ''), Object.assign({ inputs: ['text'] }, S, W)),
    // ---- production graphics (any event, or none)
    G('countdown', 'Countdown clock', 'Production', 'bug', 'countdown', 25, prod.countdown, { mode: 'any', inputs: ['label', 'time'], description: 'Counts down to a time of day (HH:MM), e.g. the start of a service or kick-off.' }),
    G('standings_fs', 'Log table (FS)', 'Production', 'fs', 'table', 40, prod.standings, { mode: 'any', live: true, description: 'Competition log worked out from completed matches.' }),
    G('fixtures_fs', 'Fixtures & results (FS)', 'Production', 'fs', 'table', 40, prod.fixtures, { mode: 'any', live: true }),
    G('advert', 'Advert', 'Production', 'fs', 'advert', 50, prod.advert, { mode: 'any', inputs: ['image', 'layout', 'text'], description: 'Sponsor board. Play adverts and playlists from RFP Manager → Adverts.' }),
  ];
}

// ============================================================================ controller
function makeGfx(app) {
  const amcp = new Amcp(() => app.config.caspar);
  const onAir = new Map();          // "ch-layer" -> entry
  const pendingClear = new Map();
  const listeners = new Set();
  const amcpLog = [];
  let fixtureId = null, strip = '', autoWipes = false, playlist = null, adTimer = null, refreshTimer = null, provider = () => null;
  const AD_LAYER = 50;

  const doc = (id) => { const d = id && app.cache.get(id); return d && !d.deleted ? d : null; };
  const get = (id) => { const d = doc(id); return d ? d.data : null; };
  const list = (team, type) => [...app.cache.values()].filter((d) => !d.deleted && d.team === team && d.type === type);
  const emit = (msg) => { for (const fn of listeners) { try { fn(msg); } catch { /* ignore */ } } };
  const changed = () => emit({ type: 'changed' });
  const C = () => app.config.caspar || {};
  const programCh = () => Number(C().channel) || 1, previewCh = () => Number(C().previewChannel) || 2;
  const keyOf = (ch, layer) => `${ch}-${layer}`;

  function addLog(direction, text, error) {
    const entry = { time: new Date().toISOString(), direction, text: String(text).length > 600 ? String(text).slice(0, 600) + '…' : String(text), error: !!error };
    amcpLog.push(entry); if (amcpLog.length > 300) amcpLog.shift();
    emit({ type: 'log', entry });
  }
  async function send(command) {
    if (!amcp.enabled) return;
    addLog('>>', command);
    try { const r = await amcp.send(command); addLog('<<', `${r.code} ${r.text}`); }
    catch (e) { addLog('<<', e.message, true); }
  }
  amcp.on('state', () => { addLog('sys', amcp.connected ? `Connected to CasparCG ${amcp.status().host}:${amcp.status().port}` : (amcp.enabled ? 'CasparCG not connected' : 'CasparCG output switched off')); changed(); });

  // ---- production builders ------------------------------------------------------------------
  const niceDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : iso || '');
  function table(d, title, subtitle, headers, rows) {
    d.set('layout', 'table').set('title', title).set('subtitle', subtitle).set('cols', headers.length).set('rows', rows.length);
    headers.forEach((h, i) => d.set(`h${i + 1}`, h));
    rows.forEach((r, i) => { r.cells.forEach((x, j) => d.set(`r${i + 1}_c${j + 1}`, x)); d.set(`r${i + 1}_hl`, !!r.hl); });
    return d;
  }
  const base = (c) => { const org = get(c.team) || {}; return new D().set('accent', org.accentColor || '#00ff82').set('org_name', org.name); };
  const prod = {
    countdown: (c) => base(c).set('layout', 'countdown').set('label', 'STARTING IN').set('time', ''),
    standings(c) {
      const f = c.fixture ? c.fixture.data : null, comp = f ? get(f.competition) : null, d = base(c);
      if (!f || !comp) return table(d, 'LOG', 'Choose a match that belongs to a competition', [], []);
      const n = (v, def) => (v === undefined || v === '' || v === null ? def : Number(v));
      const rows = Scoring.standings(list(c.team, 'fixture').map((x) => Object.assign({ id: x.id }, x.data)).filter((x) => x.competition === f.competition), { win: n(comp.pointsWin, 3), draw: n(comp.pointsDraw, 1), loss: n(comp.pointsLoss, 0) });
      return table(d, up(comp.name), up([comp.season, 'LOG'].filter(Boolean).join(' · ')), ['', 'TEAM', 'P', 'W', 'D', 'L', '+/-', 'PTS'],
        rows.slice(0, 12).map((r, i) => ({ cells: [i + 1, up(r.name), r.P, r.W, r.D, r.L, r.PD > 0 ? '+' + r.PD : r.PD, r.Pts], hl: r.id === f.team1 || r.id === f.team2 }))).set('logo', comp.logo).set('color1', comp.primaryColor);
    },
    fixtures(c) {
      const f = c.fixture ? c.fixture.data : null, d = base(c);
      if (!f) return table(d, 'FIXTURES', 'Choose a match first', [], []);
      const comp = get(f.competition) || {};
      const all = list(c.team, 'fixture').filter((x) => (f.competition ? x.data.competition === f.competition : x.data.startDate === f.startDate)).sort((a, b) => String(a.data.startDate + a.data.startTime).localeCompare(String(b.data.startDate + b.data.startTime)));
      const same = all.filter((x) => x.data.startDate === f.startDate), use = (same.length > 1 ? same : all).slice(0, 10);
      const names = (x) => { const r = x.data.result; return r && r.teams ? r.teams : [Schema.snapshotTeam(get, x.data.team1, 'Home').name, Schema.snapshotTeam(get, x.data.team2, 'Away').name]; };
      return table(d, up(comp.name || 'Fixtures'), up(same.length > 1 ? niceDate(f.startDate) : 'Fixtures & Results'), ['', '', ''], use.map((x) => {
        const r = x.data.result, t = names(x);
        return { cells: [up(t[0]), r && r.started ? r.text : (x.data.startTime || 'v'), up(t[1])], hl: x.id === c.fixture.id };
      })).set('noheader', '1').set('center', '1').set('logo', comp.logo).set('color1', comp.primaryColor);
    },
    advert: (c) => base(c).set('layout', 'full').set('image', '').set('sponsor', '').set('name', '').set('text', '').set('clip', ''),
  };
  const catalog = createCatalog(prod);
  for (const g of catalog) {
    const o = (app.config.graphics || {})[g.id];
    if (!o) continue;
    if (String(o.template || '').trim()) g.customTemplate = o.template;
    if (o.channel > 0) g.channel = Number(o.channel);
    if (o.layer > 0) g.layer = Number(o.layer);
    if (String(o.format || '').trim()) g.format = o.format;
  }

  // ---- context ------------------------------------------------------------------------------
  const cleanFolder = (x) => String(x || '').replace(/["\r\n]/g, '').replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
  // The theme of the match on air (through its competition), and the folder used when a theme does not have a template.
  // Which theme is in use: the one chosen for this PC in Graphics control, else the competition's, else the production team's default.
  // themeChoice: '' = automatic, 'none' = always the standard graphics, or a theme id.
  let themeChoice = '';
  function activeTheme() {
    if (themeChoice === 'none') return null;
    const fx = doc(fixtureId), comp = fx && get(fx.data.competition), org = fx ? get(fx.team) : null;
    const anyOrg = org || ([...app.cache.values()].find((d) => d.type === 'org' && !d.deleted && d.data.defaultTheme) || {}).data || null;
    for (const [id, source] of [[themeChoice, 'chosen'], [comp && comp.theme, 'competition'], [anyOrg && anyOrg.defaultTheme, 'default']]) {
      const th = id && get(id);
      if (th) return { id, name: th.name || '', folder: cleanFolder(th.templateFolder), source };
    }
    return null;
  }
  async function setTheme(choice) {
    choice = String(choice || '');
    if (choice && choice !== 'none' && !(doc(choice) && doc(choice).type === 'theme')) fail(404, 'Theme not found');
    themeChoice = choice;
    await app.store.kvSet('gfx:theme', themeChoice);
    emit({ type: 'catalog' });
    await refreshLive();
    changed();
  }
  const themeState = () => { const at = activeTheme(); return { choice: themeChoice, active: at ? { id: at.id, name: at.name, source: at.source } : null,
    themes: [...app.cache.values()].filter((d) => d.type === 'theme' && !d.deleted).map((d) => ({ id: d.id, name: d.data.name || '' })).sort((a, b) => a.name.localeCompare(b.name)) }; };
  function baseFolder() { const fx = doc(fixtureId), org = (fx && get(fx.team)) || {}; return cleanFolder(org.templateFolder || C().templateFolder) || 'rfp'; }
  // A theme folder replaces a built-in template simply by holding a file of the same name (scorebug.html, lowerthird.html …);
  // anything it does not hold comes from the standard folder.
  function folderFor(template) {
    const th = activeTheme();
    if (th && th.folder) {
      let has = true;
      try { has = !app.templates || !app.config.templatesPath || !!app.templates.fileOf(`${th.folder}/${template}`); } catch { has = false; }
      if (has) return th.folder;
    }
    return baseFolder();
  }
  const folder = () => baseFolder();
  const templateOf = (g) => g.customTemplate || `${folderFor(g.template)}/${g.template}`;
  // ---- graphics made from templates loaded out of this PC's template folder ("graphic" records) ----
  // A field value may contain {tokens} that are filled from the match on air, e.g. "{teamA_name} v {teamB_name}".
  let userCache = null;
  function liveMap(c, base) {
    let m = {};
    try { m = Object.assign({}, c.sport ? sdata(c, '') : Object.assign({}, common(c, ''), CB.scoreBug(c))); } catch { /* nothing on air */ }
    // a themed graphic that stands in for a built-in one can use everything that built-in graphic sends (line1, player_name …)
    // (only when that graphic belongs to the kind of match on air: a cricket graphic has nothing to say about a rugby match)
    if (base && (base.mode === 'any' || (base.mode === 'sport') === !!c.sport)) { try { Object.assign(m, base.build(c)); } catch { /* the built-in graphic has no data right now */ } }
    // the same names work for cricket and the other sports where they mean the same thing
    if (m.competition === undefined && m.tournament !== undefined) m.competition = m.tournament;
    if (m.tournament === undefined && m.competition !== undefined) m.tournament = m.competition;
    if (m.match_title === undefined && m.title !== undefined) m.match_title = m.title;
    if (!c.sport) {                                    // commentators under the same names for cricket as for the other sports
      const list = (c.m && c.m.commentators) || [];
      m.commentators = up(list.join('  &  ')); m.commentators_count = String(list.length);
      for (let i = 0; i < 4; i++) { m[`commentator${i + 1}`] = up(list[i] || ''); m[`comm${i + 1}`] = up(list[i] || ''); }
    }
    // the competition of the match on air: its logo and colours (tournament_* are the same values under the cricket name)
    const comp = c.fixture ? get(c.fixture.data.competition) : null;
    m.competition_logo = comp ? comp.logo || '' : ''; m.competition_color1 = comp ? comp.primaryColor || '' : ''; m.competition_color2 = comp ? comp.secondaryColor || '' : '';
    m.tournament_logo = m.competition_logo; m.tournament_color1 = m.competition_color1; m.tournament_color2 = m.competition_color2;
    const o = doc(c.team);
    m.org_name = o ? o.data.name || '' : ''; m.org_logo = o ? o.data.image || '' : ''; m.accent = o ? o.data.accentColor || '' : '';
    const d = new Date(c.now);
    m.date_text = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); m.time_text = d.toTimeString().slice(0, 5);
    if (app.devices) Object.assign(m, app.devices.vars());
    if (app.timeline) Object.assign(m, app.timeline.vars());
    if (app.automation) Object.assign(m, app.automation.vars());    // custom variables {var_<key>} for the match on air   // the show timeline last started: timeline_section, timeline_next_in …   // vMix / ATEM / HyperDeck: vmix_streaming_time, atem_dsk1_onair …
    delete m.layout; delete m.graphic_id;
    return m;
  }
  // Every value RFP Manager can feed a template right now, for linking template variables: [{ key, value (as a browser would show it), group }]
  function variables(graphicIds, others) {
    const c = context({}, '');
    const ids = String(graphicIds || '').split(',').filter(Boolean), fits = (g) => g && (g.mode === 'any' || (g.mode === 'sport') === !!c.sport);
    const linkedTo = ids.map((id) => catalog.find((g) => g.id === id)).filter(Boolean);
    const base = linkedTo.find(fits) || null;
    const _c = c, m = liveMap(_c, base), own = new Set(base ? (() => { try { return Object.keys(base.build(c)); } catch { return []; } })() : []), web = resolve(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, txt(v)])), 'web');
    const devIds = app.devices ? app.devices.ids() : [], isDev = (k) => devIds.some((d) => k.startsWith(d + '_'));
    const group = (k) => (isDev(k) ? 'Devices (vMix, ATEM, HyperDeck)' : /^timeline_/.test(k) ? 'Timeline' : /^var_/.test(k) ? 'Custom variables' : /^team[AB]_cards?/.test(k) ? 'Cards and last event' : /^team[AB]_|^bat_|^bowl_/.test(k) ? 'Teams' : /^(org_|accent|date_text|time_text)/.test(k) ? 'Production' : /^(stat\d|leader\d|ev\d|col\d|xcol|set\d|scorers|table_|stats_|events_)/.test(k) ? 'Statistics and tables'
      : /(clock|shot|gt_ms|sinbin|_ms$|_sig$)/.test(k) ? 'Clocks' : /^(competition|tournament|venue|city|title|match_|format|sport|variant)/.test(k) ? 'Match' : /^(card_|last_|team[AB]_cards?)/.test(k) ? 'Cards and last event' : 'Score and state');
    const vars = Object.keys(web).sort().map((k) => ({ key: k, value: web[k], group: base && own.has(k) && !/^team[AB]_/.test(k) ? 'This graphic (' + base.name + ')' : /^(sl|rs)\d/.test(k) ? 'Lists and rows' : group(k) }));
    // Every other variable stays selectable too, whatever is on air: cricket values during a rugby match, the values of the
    // other sports, and what the other linked built-in graphics send. They are empty until a match of that kind is on air.
    const seen = new Set(vars.map((v) => v.key));
    const more = (key, grp, note) => { if (!key || seen.has(key) || key === 'layout' || key === 'graphic_id') return; seen.add(key); vars.push({ key, value: '', group: grp, note: note || '', away: true }); };
    // cricket: a sample match with an innings under way, so the batter, bowler and over values are listed before a ball is bowled
    let cc = Object.assign({}, c, { sport: null });
    try { const e = new Cricket.Engine(Cricket.newMatch()); e.startInnings('A'); cc = Object.assign(cc, { m: e.match, s: Cricket.compute(e.match) }); } catch { /* the match on air will do */ }
    try { for (const k of Object.keys(liveMap(cc, null)).sort()) more(k, c.sport ? 'Cricket (empty until a cricket match is on air)' : 'Cricket (empty until the innings starts)', 'cricket'); } catch { /* no cricket sample */ }
    for (const g of linkedTo) { if (g === base) continue; let keys = []; try { keys = Object.keys(g.build(Object.assign({}, c, { sport: g.mode === 'sport' ? c.sport : null }))); } catch { /* needs a match of its own kind */ } for (const k of keys.sort()) more(k, 'Linked graphic: ' + g.name, g.mode === 'sport' ? 'other sports' : 'cricket'); }
    if (app.automation) for (const v of [...app.cache.values()].filter((d) => d.type === 'variable' && !d.deleted)) more('var_' + app.automation.keyOf(v.data.key || v.data.name), 'Custom variables', (v.data.name || '') + ' (not for the match on air)');
    for (const k of ['timeline_name', 'timeline_state', 'timeline_time', 'timeline_remaining', 'timeline_section', 'timeline_section_left', 'timeline_next', 'timeline_next_in']) more(k, 'Timeline', 'empty until a timeline runs');
    if (app.devices) for (const x of app.devices.keys()) more(x.key, 'Devices (vMix, ATEM, HyperDeck)', x.device + ' (empty while not connected)');
    for (const o of [].concat(others || []).sort((a, b) => a.key.localeCompare(b.key))) more(o.key, 'Other sports (empty until that sport is on air)', o.note);
    // what each built-in graphic sends (player name, line 1, table rows …): filled in when this template is linked to that graphic
    const byGraphic = new Map();
    for (const g of catalog) {
      if (linkedTo.includes(g)) continue;
      let keys = [];
      try { keys = Object.keys(g.build(g.mode === 'sport' ? c : cc)); } catch { /* needs a player or a match of its own */ }
      for (const k of keys) { if (seen.has(k)) continue; if (!byGraphic.has(k)) byGraphic.set(k, []); byGraphic.get(k).push(g.name); }
    }
    for (const [k, names] of [...byGraphic].sort((a, b) => a[0].localeCompare(b[0]))) more(k, 'Built-in graphics (link this template to the graphic to fill these)', names.length > 3 ? names.slice(0, 3).join(', ') + ' +' + (names.length - 3) : names.join(', '));
    return { onAir: !!doc(fixtureId), mode: c.sport ? 'sport' : 'cricket', theme: themeState(), builtIn: catalog.filter((g) => g.group !== 'Custom').map((g) => ({ id: g.id, name: g.name, group: g.group, mode: g.mode })), devices: devicesBrief(), vars };
  }
  // ---- the Variables screen: every value a template can use, for every sport, with an example and what it is ----------
  // samples: [{ id, name, kind, sport (a computed sample match), liveKeys }] from live.js
  function reference(samples) {
    const cNow = context({}, ''), nowMap = (() => { try { return resolve(Object.fromEntries(Object.entries(liveMap(cNow, null)).map(([k, v]) => [k, txt(v)])), 'web'); } catch { return {}; } })();
    // cricket sample: an innings under way
    let cc = Object.assign({}, cNow, { sport: null, fixture: null });
    try {
      const m = Cricket.newMatch();
      Object.assign(m.teamA, { name: 'Home Lions', shortName: 'HOM' }); Object.assign(m.teamB, { name: 'Away Eagles', shortName: 'AWY' });
      const e = new Cricket.Engine(m); e.startInnings('A'); cc = Object.assign(cc, { m: e.match, s: Cricket.compute(e.match) });
    } catch { /* a blank match will do */ }
    const keysOf = (c) => { try { return Object.assign({}, liveMap(c, null)); } catch { return {}; } };
    const ctxFor = (x) => Object.assign({}, cNow, { sport: x.sport, liveKeys: x.liveKeys, fixture: null, m: cNow.m, s: cNow.s });
    const sports = [{ id: 'cricket', name: 'Cricket', ctx: cc }].concat(samples.map((x) => ({ id: x.id, name: x.name, ctx: ctxFor(x) })));
    // what each sport sends, and what its graphics add (lower thirds, tables …)
    for (const sp of sports) {
      sp.flat = keysOf(sp.ctx);
      sp.graphic = {};
      for (const g of catalog) {
        if (g.group === 'Custom' || (g.mode === 'sport') !== (sp.id !== 'cricket') && g.mode !== 'any') continue;
        let d = {};
        try { d = g.build(Object.assign({}, sp.ctx, { p: { playerId: sp.id === 'cricket' ? null : (sp.ctx.sport && sp.ctx.sport.derived && sp.ctx.sport.derived.players[0] || {}).id } })); } catch { continue; }
        for (const [k, v] of Object.entries(d)) { if (k === 'layout' || k === 'graphic_id' || sp.flat[k] !== undefined) continue; (sp.graphic[k] = sp.graphic[k] || { ex: txt(v), by: [] }).by.push(g.name); }
      }
    }
    const isProd = (k) => /^(org_|accent$|date_text$|time_text$|competition_(logo|color)|tournament_(logo|color)|timeline_|var_)/.test(k) || (app.devices && app.devices.ids().some((d) => k.startsWith(d + '_')));
    // in every sport (and cricket): one list for all
    const all = Object.keys(sports[0].flat).filter((k) => !isProd(k) && sports.every((sp) => sp.flat[k] !== undefined));
    const common = new Set(all);
    // numbered series (sl1_name … sl16_name) become one row with a number to choose
    const series = (keys) => {
      const out = [], seen = new Map();
      for (const k of keys) {
        const m = /^([a-z_]*?[a-z])(\d+)(_[a-z0-9_]+)?$/i.exec(k);
        if (!m || ['team', 'set', 'quarter', 'period'].includes(m[1]) && !m[3]) { out.push({ key: k }); continue; }
        const pat = `${m[1]}{n}${m[3] || ''}`;
        if (!seen.has(pat)) { const row = { key: k, pattern: pat, nums: [] }; seen.set(pat, row); out.push(row); }
        seen.get(pat).nums.push(Number(m[2]));
      }
      for (const r of out) if (r.nums) { r.nums.sort((a, b) => a - b); if (r.nums.length < 2) { delete r.pattern; delete r.nums; } else { r.min = r.nums[0]; r.max = r.nums[r.nums.length - 1]; delete r.nums; } }
      return out;
    };
    const GROUPS = [
      ['Match', /^(title|competition|tournament|venue|city|match_|format|sport|variant|status|result|toss|date|day|session|period|half|innings_|finished|winner|strip_text)/],
      ['Commentators and officials', /^(comm|commentator|official|referee|umpire)/],
      ['Teams', /^(team[AB]_(name|short|logo|color|coach|abbr|full)|bat_|bowl_|batting_team|bowling_team)/],
      ['Score', /^(score|team[AB]_(score|runs|wickets|overs|points|tries|goals|sets|games|lead)|runs|wickets|overs|target|need|req|crr|rrr|lead|margin|games|set\d|sets_|points|tiebreak|server|serv|flag|bonus|dls|par|extras|free_hit|powerplay|projected|prev_|max_overs|balls_remaining|last_ball|trybonus|losingbonus|logpts|centre_pass)/],
      ['Clocks', /(clock|shot|gt_ms|sinbin|countdown|_ms$|_sig$|_running$|_dir$|_limit)/],
      ['Players', /^(bat\d|bowl\d|batter|striker|nonstriker|non_striker|bowler|keeper|captain|player|p\d|batsman|partnership|last_wicket|fow)/],
      ['Cards and last event', /^(card|last_|team[AB]_cards?|red|yellow|reds)/],
      ['Statistics', /^(stat|leader|stats_|poss|terr|team[AB]_(stat|poss|terr|pen|fouls|timeouts)|teamfouls|timeouts|pens|corners|shots)/],
      ['Lists and tables', /^(sl|rs|ev|col|xcol|table_|events_|scorers|lineup|row|ball\d|over_balls|this_over|recent)/],
      ['Athletics: events', /^ath_(event|round|wind|kind|status|gender|age|discipline|winner)/],
      ['Athletics: field events', /^ath_(up|bar|attempt)/],
      ['Baseball', /^(inning$|half|balls$|strikes|outs|count|base\d|batting$|pitch|batter_|pitcher_|runs[AB]|hits[AB]|errors[AB])/],
    ];
    const groupOf = (k) => (GROUPS.find(([, re]) => re.test(k)) || ['Other'])[0];
    const ex = (sp, k) => { const v = sp.flat[k]; return v === undefined ? '' : String(txt(v)).slice(0, 60); };
    const grouped = (keys, exampleOf) => {
      const map = new Map();
      for (const r of series(keys.sort())) { const g = groupOf(r.key); if (!map.has(g)) map.set(g, []); map.get(g).push(Object.assign(r, { ex: exampleOf(r.key), now: nowMap[r.key] !== undefined ? String(nowMap[r.key]).slice(0, 60) : undefined })); }
      const order = GROUPS.map((x) => x[0]).concat(['Other']);
      return [...map].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([name, vars]) => ({ name, vars }));
    };
    const sections = [];
    sections.push({ id: 'all', name: 'Every sport', note: 'The same names in cricket and every other sport.', groups: grouped([...common], (k) => ex(sports[1] || sports[0], k)) });
    // the other sports share most names (clocks, cards, statistics …): listed once
    const rest = sports.slice(1);
    const shared = new Set(rest.length ? Object.keys(rest[0].flat).filter((k) => !common.has(k) && !isProd(k) && rest.every((sp) => sp.flat[k] !== undefined)) : []);
    const sharedG = new Set(rest.length ? Object.keys(rest[0].graphic).filter((k) => !common.has(k) && rest.every((sp) => sp.graphic[k])) : []);
    if (rest.length) {
      const groups = grouped([...shared], (k) => ex(rest[0], k));
      if (sharedG.size) groups.push({ name: 'Sent by their graphics (lower thirds, tables …)', vars: series([...sharedG].sort()).map((r) => Object.assign(r, { ex: rest[0].graphic[r.key].ex.slice(0, 60), note: [...new Set(rest[0].graphic[r.key].by)].slice(0, 3).join(', ') })) });
      sections.push({ id: 'sports', name: 'All sports except cricket', note: 'Rugby, football, hockey, netball, basketball, tennis, padel, badminton, volleyball, baseball and athletics all send these.', groups });
    }
    for (const sp of sports) {
      const own = Object.keys(sp.flat).filter((k) => !common.has(k) && !isProd(k) && (sp.id === 'cricket' || !shared.has(k)));
      const groups = grouped(own, (k) => ex(sp, k));
      const gk = Object.keys(sp.graphic).filter((k) => !common.has(k) && (sp.id === 'cricket' || !sharedG.has(k)));
      if (gk.length) groups.push({ name: 'Sent by its graphics (lower thirds, tables …)', vars: series(gk.sort()).map((r) => Object.assign(r, { ex: sp.graphic[r.key].ex.slice(0, 60), note: [...new Set(sp.graphic[r.key].by)].slice(0, 3).join(', ') + (new Set(sp.graphic[r.key].by).size > 3 ? ' …' : '') })) });
      // where the same key also exists
      const others = (k) => sports.filter((x) => x !== sp && x.flat[k] !== undefined).map((x) => x.name);
      for (const g of groups) for (const r of g.vars) if (!r.note) { const o = others(r.key); if (o.length && o.length < sports.length - 1) r.note = 'also ' + (o.length > 3 ? o.slice(0, 3).join(', ') + ' +' + (o.length - 3) : o.join(', ')); }
      sections.push({ id: sp.id, name: sp.name, groups });
    }
    // production, timeline, devices and your own variables
    const prodKeys = new Set(Object.keys(sports[0].flat).filter(isProd));
    for (const k of ['timeline_name', 'timeline_state', 'timeline_time', 'timeline_remaining', 'timeline_section', 'timeline_section_left', 'timeline_next', 'timeline_next_in']) prodKeys.add(k);
    if (app.devices) for (const x of app.devices.keys()) prodKeys.add(x.key);
    if (app.automation) for (const v of [...app.cache.values()].filter((d) => d.type === 'variable' && !d.deleted)) prodKeys.add('var_' + app.automation.keyOf(v.data.key || v.data.name));
    const pgroup = (k) => (/^timeline_/.test(k) ? 'Timeline' : /^var_/.test(k) ? 'Your variables (Live → Variables & triggers)' : /^(org_|accent|date_text|time_text|competition_|tournament_)/.test(k) ? 'Production' : 'Devices (vMix, ATEM, HyperDeck)');
    const pmap = new Map();
    for (const k of [...prodKeys].sort()) { const g = pgroup(k); if (!pmap.has(g)) pmap.set(g, []); pmap.get(g).push({ key: k, ex: sports[0].flat[k] !== undefined ? String(txt(sports[0].flat[k])).slice(0, 60) : '', now: nowMap[k] !== undefined ? String(nowMap[k]).slice(0, 60) : undefined }); }
    sections.push({ id: 'production', name: 'Production and devices', groups: ['Production', 'Your variables (Live → Variables & triggers)', 'Timeline', 'Devices (vMix, ATEM, HyperDeck)'].filter((g) => pmap.has(g)).map((g) => ({ name: g, vars: pmap.get(g) })) });
    // what built-in graphics send, whatever the sport (line1, line2, title …)
    const gmap = new Map();
    for (const g of catalog) {
      if (g.group === 'Custom') continue;
      const sp = g.mode === 'sport' ? sports[1] || sports[0] : sports[0];
      let d = {}; try { d = g.build(Object.assign({}, sp.ctx, { p: {} })); } catch { continue; }
      for (const k of Object.keys(d)) { if (k === 'layout' || k === 'graphic_id' || sp.flat[k] !== undefined) continue; if (!gmap.has(k)) gmap.set(k, new Set()); gmap.get(k).add(g.name); }
    }
    sections.push({ id: 'graphics', name: 'Graphic fields', note: 'What the built-in graphics send to their template (a template linked to that graphic gets them).', groups: [{ name: 'Fields', vars: series([...gmap.keys()].sort()).map((r) => Object.assign(r, { note: [...gmap.get(r.key)].slice(0, 3).join(', ') + (gmap.get(r.key).size > 3 ? ' +' + (gmap.get(r.key).size - 3) : '') })) }] });
    return { onAir: !!doc(fixtureId), mode: cNow.sport ? 'sport' : 'cricket', sections };
  }
  const devicesBrief = () => (app.devices ? app.devices.state().map((d) => ({ id: d.id, name: d.name, type: d.type, connected: d.connected, commands: d.commands })) : []);
  // every live value for the match on air, as a browser would show it (dashboards)
  function liveValues() { let m = {}; try { m = liveMap(context({}, ''), null); } catch { /* nothing on air */ } return resolve(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, txt(v)])), 'web'); }
  const fill = (v, map) => String(v == null ? '' : v).replace(/\{([A-Za-z_]\w*)\}/g, (m, k) => (map[k] === undefined || map[k] === null ? (k === 'nl' ? '\n' : '') : String(map[k]))); // {nl} = a line break
  // Fields that are a choice, not free text: the layout of a template that can draw several, and any field given options.
  function optionsFor(x, fields) {
    const out = {};
    for (const f of fields) {
      const own = Array.isArray(f.options) ? f.options : typeof f.options === 'string' ? f.options.split(/[,\n]/) : [];
      let list = own.map((o) => String(o).trim()).filter(Boolean);
      if (!list.length && /^layout$/i.test(f.key) && app.templates) { try { list = app.templates.layouts(x.template); } catch { list = []; } }
      if (list.length > 1) out[f.key] = list.slice(0, 80);
    }
    return out;
  }
  // ---- buttons on a graphic: one press does several things at once (invoke a method, take or clear another graphic, set a field …)
  const DO = ['invoke', 'show', 'hide', 'update', 'set', 'amcp', 'wait', 'macro', 'device', 'timeline', 'hideall', 'setvar', 'advert', 'playlist', 'adstop'];
  const strMap = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).slice(0, 80).map(([k, v]) => [String(k).slice(0, 80), String(v == null ? '' : v).slice(0, 2000)]).filter(([k]) => k));
  const cleanActions = (list) => (Array.isArray(list) ? list : []).filter((a) => a && DO.includes(a.do)).slice(0, 16)
    .map((a) => ({ do: a.do, target: String(a.target || '').slice(0, 80), method: String(a.method || '').trim().slice(0, 200), field: String(a.field || '').slice(0, 80), value: String(a.value == null ? '' : a.value).slice(0, 2000), values: strMap(a.values), ms: Math.max(0, Math.min(10000, Number(a.ms) || 0)), delay: Math.max(0, Math.min(600, Number(a.delay) || 0)) }))
    .filter((a) => (a.do === 'invoke' ? a.method : a.do === 'show' || a.do === 'macro' ? a.target : a.do === 'device' ? a.target && a.method : a.do === 'timeline' ? ['go', 'play', 'pause', 'stop', 'prev'].includes(a.method) : a.do === 'setvar' || a.do === 'advert' || a.do === 'playlist' ? !!a.target : a.do === 'set' ? a.field : a.do === 'amcp' ? a.value.trim() : a.do === 'wait' ? a.ms > 0 : true));
  const cleanButtons = (list) => (Array.isArray(list) ? list : []).map((v) => {
    if (!v) return null;
    const acts = cleanActions(v.actions).slice(0, 12);
    if (String(v.method || '').trim()) acts.unshift({ do: 'invoke', target: '', method: String(v.method).trim().slice(0, 200), field: '', value: '', ms: 0, delay: 0 });   // the first, simple form: one method
    if (!acts.length) return null;
    const first = acts[0];
    return { label: String(v.label || first.method || first.do).trim().slice(0, 30), method: first.do === 'invoke' && !first.target ? first.method : '', actions: acts };
  }).filter(Boolean).slice(0, 24);
  // Runs button n of a graphic. `key` is where that graphic is on air ("1-35"); other graphics are found by their own layer.
  // What the operator has in the Data panel when a button is pressed travels with the press, so an "update" that follows an
  // invoke sends those values (not the ones the graphic was taken with).
  const freshOf = (f) => (f && typeof f === 'object' && f.overrides && typeof f.overrides === 'object' ? { params: Object.assign({}, f.params || {}), overrides: Object.fromEntries(Object.entries(f.overrides).slice(0, 400).map(([k, v]) => [String(k), String(v == null ? '' : v)])) } : null);
  const stash = (key, id, fresh) => { const e = onAir.get(key), f = freshOf(fresh); if (e && f && (!id || e.graphicId === id)) e.next = f; };
  const latest = (e) => { const x = e.next || e; e.next = null; return x; };
  // Runs a list of actions: from a button on a graphic (o.ownId / o.own = that graphic and where it is on air), from a scorer
  // button or a macro (no graphic of its own: every action names its graphic). o.vars fill {team}, {other} and the like.
  function macrosFor(team) {
    const th = activeTheme(), src = th ? get(th.id) : null, org = team ? get(team) : null;
    return (src && Array.isArray(src.macros) && src.macros.length ? src.macros : null) || (org && Array.isArray(org.macros) ? org.macros : []);
  }
  async function runActions(list, o) {
    o = o || {};
    const depth = o.depth || 0, label = o.label || 'Button';
    const own = o.own || '', ownG = o.ownId ? get0(o.ownId) : null;
    const vars = Object.assign({}, o.vars || {});
    if (vars.team === 'A' || vars.team === 'B') { vars.other = vars.team === 'A' ? 'B' : 'A'; }
    const mapNow = (e) => Object.assign({}, liveMap(context(e ? e.params : {}, e ? e.team : o.team), null), vars);
    const fillT = (v, e) => { let t = String(v || ''); if (vars.team) t = t.replace(/\{team\}/g, vars.team).replace(/\{other\}/g, vars.other || ''); return fill(t, mapNow(e)); };
    const where = (t) => { if (!t) return ownG ? { g: ownG, key: own } : null; const x = get0(t); return { g: x, key: keyOf(channelFor(x, false), x.layer) }; };
    const valuesOf = (a, e) => Object.fromEntries(Object.entries(a.values || {}).map(([k, v]) => [k, fillT(v, e)]));
    const run = async (a) => {
      try {
        if (a.do === 'wait') { await new Promise((r) => setTimeout(r, a.ms)); return; }
        if (a.do === 'macro') {
          const m = macrosFor(o.team).find((x) => x && x.id === a.target);
          if (m && depth < 4) await runActions(cleanActions(m.actions), Object.assign({}, o, { depth: depth + 1, label: 'Macro ' + (m.name || '') }));
          return;
        }
        if (a.do === 'hideall') { await hideAll(false); return; }
        if (a.do === 'setvar') { if (!app.automation) return; app.automation.set(a.target, fillT(a.value)); return; }
        if (a.do === 'advert') { const tm = o.team || (doc(fixtureId) || {}).team || ''; await playAdvert(tm, a.target, {}); changed(); return; }
        if (a.do === 'playlist') { const tm = o.team || (doc(fixtureId) || {}).team || ''; await startPlaylist(tm, a.target); changed(); return; }
        if (a.do === 'adstop') { await stopPlaylist(); changed(); return; }
        if (a.do === 'timeline') { const tid = a.target || (app.timeline && app.timeline.current()); if (!tid) throw new Error('No timeline has been started yet'); await app.timeline.control(tid, a.method); return; }
        if (a.do === 'device') { if (!app.devices) throw new Error('Devices are driven from the production PC'); await app.devices.command(a.target, fillT(a.method), fillT(a.value)); return; }
        if (a.do === 'amcp') { const [ch, layer] = (own || keyOf(programCh(), 0)).split('-'); await send(fillT(a.value.replace(/\{channel\}/gi, ch).replace(/\{layer\}/gi, layer))); return; }
        const w = where(a.target); if (!w) return;
        const e = onAir.get(w.key), there = e && e.graphicId === w.g.id;
        const params = Object.assign({}, there ? e.params : {}, vars.team && !(there && e.params && e.params.team) ? { team: vars.team } : {});
        if (a.do === 'invoke') { if (there) await invoke(w.key, fillT(a.method, e)); }
        else if (a.do === 'show') await show(w.g.id, params, Object.assign({}, there ? e.overrides : {}, valuesOf(a, e)), false, o.team);
        else if (a.do === 'hide') { if (there) await hideKey(w.key); }
        else if (a.do === 'update') { if (there) { const x = latest(e); await update(w.g.id, x.params, Object.assign({}, x.overrides, valuesOf(a, e)), false, e.team); } }
        else if (a.do === 'set') { if (there) { const x = latest(e); await update(w.g.id, x.params, Object.assign({}, x.overrides, { [a.field]: fillT(a.value, e) }), false, e.team); } }
      } catch (err) { log(`${label}: ${a.do} failed -`, err.message); }
    };
    // actions without a delay go out together, in the order listed; a delayed one follows that many seconds after the press
    for (const a of list.filter((x) => !x.delay)) await run(a);
    for (const a of list.filter((x) => x.delay > 0)) { const t = setTimeout(() => { run(a).then(changed).catch(() => {}); }, a.delay * 1000); t.unref(); }
    changed();
  }
  async function runButton(id, n, key, team, fresh) {
    const g = get0(id), b = (g.invokes || [])[Number(n)];
    if (!b) fail(400, 'That button no longer exists');
    const own = onAir.get(key) && onAir.get(key).graphicId === id ? key : keyOf(channelFor(g, false), g.layer);
    stash(own, id, fresh);
    await runActions(b.actions, { own, ownId: id, team, label: `Button "${b.label}" of ${g.name}` });
  }

  // ---- triggers: "IF a live value … THEN show / hide / update this graphic, or set one of its fields"
  const OPS = ['=', '!=', '>', '<', '>=', '<=', 'contains', 'empty', 'notempty', 'changes'];
  const cleanRules = (list) => (Array.isArray(list) ? list : []).filter((r) => r && String(r.when || '').trim() && OPS.includes(r.op) && ['show', 'hide', 'update', 'set'].includes(r.then)).slice(0, 40)
    .map((r) => ({ when: String(r.when).trim().replace(/^\{|\}$/g, ''), op: r.op, value: String(r.value == null ? '' : r.value), then: r.then, seconds: Math.max(0, Math.min(3600, Number(r.seconds) || 0)), field: String(r.field || ''), to: String(r.to == null ? '' : r.to), off: !!r.off, delay: Math.max(0, Math.min(600, Number(r.delay) || 0)) }));
  function ruleTrue(r, map) {
    if (r.off) return false;
    const a = String(map[r.when] == null ? '' : map[r.when]).trim(), b = fill(r.value, map).trim();
    const na = parseFloat(a.replace(',', '.')), nb = parseFloat(b.replace(',', '.')), num = Number.isFinite(na) && Number.isFinite(nb);
    switch (r.op) {
      case '=': return num ? na === nb : a.toLowerCase() === b.toLowerCase();
      case '!=': return num ? na !== nb : a.toLowerCase() !== b.toLowerCase();
      case '>': return num && na > nb; case '<': return num && na < nb; case '>=': return num && na >= nb; case '<=': return num && na <= nb;
      case 'contains': return b !== '' && a.toLowerCase().includes(b.toLowerCase());
      case 'empty': return a === ''; case 'notempty': return a !== '';
      default: return false;
    }
  }
  let triggersOn = true, triggering = false;
  async function fireRule(g, r, team, now) {
    if (!(actor.who() && actor.who().via === 'Trigger')) return actor.also({ via: 'Trigger', name: `${g.name}: IF ${r.when} ${r.op} ${r.value || ''}`.trim() }, () => fireRule(g, r, team, now));
    if (r.delay > 0 && !now) { const t = setTimeout(() => { fireRule(g, r, team, true).then((ok) => { if (ok) changed(); }).catch(() => {}); }, r.delay * 1000); t.unref(); return false; }
    const key2 = keyOf(channelFor(g, false), g.layer);
    try {
      clearTimeout(trigTimers.get(key2));
      if (r.then === 'hide') await hideKey(key2);
      else if (r.then === 'update') { const e = onAir.get(key2); if (e && e.graphicId === g.id) { const x = latest(e); await update(g.id, x.params, x.overrides, false, e.team); } }
      else {
        await show(g.id, {}, {}, false, team);
        if (r.seconds > 0) { const t = setTimeout(() => { const e = onAir.get(key2); if (e && e.graphicId === g.id) hideKey(key2).then(changed).catch(() => {}); }, r.seconds * 1000); t.unref(); trigTimers.set(key2, t); }
      }
      log(`Trigger: ${g.name} – IF ${r.when} ${r.op} ${r.value} THEN ${r.then}`);
      return true;
    } catch (e) { log('Trigger failed for', g.name, '-', e.message); return false; }
  }
  // "IF invoke is page(2) THEN update this graphic": rules on the word invoke run each time a method is invoked on that graphic.
  // An empty value, "changes" or "has a value" means any method; otherwise the method name is compared (with or without brackets).
  async function invoked(key, method) {
    const e = onAir.get(key), g = e ? find0(e.graphicId) : null;
    if (!triggersOn || !g || !g.rules || method === 'next' && !g.rules.some((r) => /next/i.test(r.value))) return;
    const m = String(method).trim(), name = m.replace(/\(.*$/, '').trim();
    for (const r of g.rules) {
      if (r.off || r.when !== 'invoke' || r.then === 'set') continue;
      const v = r.value.trim(), same = (x) => x.toLowerCase() === v.toLowerCase();
      const hit = r.op === 'changes' || r.op === 'notempty' || (v === '' && r.op === '=') ? true : r.op === '=' ? same(m) || same(name) : r.op === '!=' ? !(same(m) || same(name)) : r.op === 'contains' ? m.toLowerCase().includes(v.toLowerCase()) : false;
      if (hit) await fireRule(g, r, e.team);
    }
  }
  const trigState = new Map(), trigTimers = new Map();
  async function runTriggers() {
    if (triggering) return;
    if (!triggersOn || !doc(fixtureId)) { trigState.clear(); return; }
    triggering = true;
    try {
      const c = context({}, '');
      let map = null, acted = false;
      const seen = new Set();
      for (const g of userGraphics()) {
        if (!g.rules || !g.rules.some((r) => r.then !== 'set')) continue;
        map = map || liveMap(c, null);
        for (const r of g.rules) {
          if (r.then === 'set' || r.off || r.when === 'invoke') continue;      // IF invoke … runs when a method is invoked, see invoked()
          const key = g.id + '|' + JSON.stringify(r); seen.add(key);
          const cur = String(map[r.when] == null ? '' : map[r.when]), truth = r.op === 'changes' ? false : ruleTrue(r, map), was = trigState.get(key);
          trigState.set(key, { cur, truth });
          if (!was) continue;                                                  // first look: remember, never fire on what was already so
          if (!(r.op === 'changes' ? cur !== was.cur && cur !== '' : truth && !was.truth)) continue;
          if (await fireRule(g, r, c.team)) acted = true;
        }
      }
      for (const k of trigState.keys()) if (!seen.has(k)) trigState.delete(k);
      if (acted) changed();
    } finally { triggering = false; }
  }
  function userGraphics() {
    if (userCache) return userCache;
    userCache = [];
    for (const d of app.cache.values()) {
      if (d.type !== 'graphic' || d.deleted || !String(d.data.template || '').trim()) continue;
      const x = d.data, fields = (Array.isArray(x.fields) ? x.fields : []).filter((f) => f && f.key);
      const rules = cleanRules(x.triggers), sets = rules.filter((r) => r.then === 'set');
      const linked = fields.some((f) => /\{[A-Za-z_]\w*\}/.test(String(f.value || ''))) || sets.length > 0;
      const live = linked && x.autoUpdate !== false;                    // "Update automatically while on air"
      const th = x.theme && get(x.theme);
      const clear = ['transparent', '#00000000', 'rgba(0,0,0,0)'].includes(x.transparentAs) ? x.transparentAs : 'transparent';
      // one template can stand in for several built-in graphics (the cricket bug and the bug of the other sports, say)
      const bases = [].concat(x.replaces || []).map((id) => catalog.find((g) => g.id === id)).filter(Boolean);
      const baseFor = (c) => bases.find((g) => g.mode === 'any' || (g.mode === 'sport') === !!c.sport) || null;
      // a colour field can be switched to transparent, and a linked colour that has no value can fall back to transparent
      const value = (f, map) => {
        let v = linked ? fill(f.value, map) : (f.value == null ? '' : String(f.value));
        if (f.type === 'color') { if (/^transparent$/i.test(v.trim()) || (!v.trim() && f.emptyTransparent)) v = clear; }
        return v;
      };
      userCache.push(G('tpl_' + d.id, x.name || x.template, th ? 'Theme: ' + (th.name || 'Theme') : 'My templates', ['lt', 'fs', 'bug', 'wipe'].includes(x.kind) ? x.kind : 'lt', x.template, Number(x.layer) > 0 ? Number(x.layer) : 35,
        (c) => {
          const out = new D(), map = linked ? liveMap(c, c.base || baseFor(c)) : {};
          for (const f of fields) { if (f.type === 'image' && !f.value) continue; const v = value(f, map); if (f.type === 'image' && !v) continue; out.set(f.key, v); }
          // IF … THEN set a field: the last rule that is true wins
          for (const r of sets) if (r.field && ruleTrue(r, map)) { const f = fields.find((y) => y.key === r.field); let v = fill(r.to, map); if (f && f.type === 'color' && /^transparent$/i.test(v.trim())) v = clear; out.set(r.field, v); }
          return out;
        },   // an empty picture keeps the template's own
        { mode: 'any', live, ticking: live && fields.some((f) => /\{(\w*clock\w*|\w*_text|time_text|shot\w*|sinbin\d+_\w+|team[AB]_cards?\w*)\}/.test(String(f.value || ''))), user: true, hidden: !!x.hidden, rules, invokes: cleanButtons(x.invokes), types: Object.fromEntries(fields.map((f) => [f.key, f.type || 'text'])), folder: String(x.template).split('/').slice(th ? 1 : 0, -1).join('/'), themeId: th ? x.theme : '', replaces: bases.map((g) => g.id), team: d.team, inputs: fields.map((f) => f.key), labels: Object.fromEntries(fields.map((f) => [f.key, f.label || f.key])), options: optionsFor(x, fields), customTemplate: String(x.template).replace(/["\r\n]/g, ''),
          channel: Number(x.channel) > 0 ? Number(x.channel) : 0, autoClearMs: Number(x.autoClear) > 0 ? Number(x.autoClear) * 1000 : 0, format: x.format === 'xml' || x.format === 'json' ? x.format : null, description: x.description || x.template }));
    }
    userCache.sort((a, b) => a.name.localeCompare(b.name));
    return userCache;
  }
  const all = () => catalog.concat(userGraphics());
  // With a theme in use, a built-in graphic is played by the theme's graphic that is set to replace it: same button, same
  // parameters (player, team, innings), but the theme's template, layer and linked variables.
  function replacement(id) { const at = activeTheme(); return at ? userGraphics().find((g) => g.themeId === at.id && g.replaces.includes(id)) || null : null; }
  function find0(id) {
    const g = all().find((x) => x.id === id);
    if (!g || g.user) return g || null;
    const r = replacement(id);
    return r ? Object.assign({}, r, { id: g.id, name: g.name, group: g.group, param: g.param, mode: g.mode, kind: g.kind, replacedBy: r.id, replacedByName: r.name, user: false, hidden: false,
      build: (c) => r.build(Object.assign({}, c, { base: g })) }) : g;
  }
  const get0 = (id) => find0(id) || fail(400, `Unknown graphic '${id}'`);
  const publicCatalog = () => { const at = activeTheme(); return all().map((x) => find0(x.id) || x).map(({ build, customTemplate, ...g }) => Object.assign(g, { template: templateOf(Object.assign({ customTemplate }, g)), activeTheme: !!(at && g.themeId && g.themeId === at.id) })); };

  function context(p, team) {
    const live = provider() || {};
    const fx = doc(fixtureId);
    return { m: live.match || Cricket.newMatch(), s: live.stats || Cricket.compute(Cricket.newMatch()), p: p || {}, strip, sport: live.sport || null, liveKeys: live.liveKeys || (() => ({})),
      now: Date.now(), fixture: fx, team: (fx && fx.team) || team || live.team || '' };
  }

  function buildData(g, p, overrides, team) {
    let data;
    try { data = Object.assign({}, g.build(context(p, team))); }
    catch (e) { data = { layout: 'error', line1: 'DATA ERROR', line2: e.message }; }
    data.graphic_id = g.id;
    for (const [k, v] of Object.entries(overrides || {})) if (k) data[k] = txt(v);
    if (g.id === 'countdown') {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(data.time || '').trim()), now = Date.now();
      let target = 0;
      if (m) { const d = new Date(now); d.setHours(Number(m[1]), Number(m[2]), 0, 0); if (d.getTime() < now - 12 * 3600000) d.setDate(d.getDate() + 1); target = d.getTime(); }
      data.countdown_ms = String(Math.max(0, target - now)); data.countdown_sig = String(target); data.target_text = data.time || '';
    }
    for (const k of Object.keys(data)) data[k] = txt(data[k]);
    return data;
  }

  // Logos and photos are image ids: CasparCG gets the file in this machine's image folder, browsers get /media/<id>.
  function resolve(data, mode) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      // a picture is known by its id (img_…). One chosen in Graphics control or kept in a preset arrives as the web address
      // /media/img_…, which only a browser understands: CasparCG gets the file on this PC (or the full address) for it too.
      const m = typeof v === 'string' ? /^(?:\/media\/)?(img_[\w-]{6,40})$/.exec(v.trim()) : null;
      if (!m) { out[k] = v; continue; }
      const id = m[1], d = doc(id);
      if (!d || d.type !== 'image') { out[k] = ''; continue; }
      if (mode === 'web') { out[k] = '/media/' + id; continue; }
      const p = C().images === 'http' ? null : app.blobs.localPath(d);
      out[k] = p && fs.existsSync(p) ? pathToFileURL(p).href : `${C().httpBase || 'http://127.0.0.1:' + app.config.port}/media/${id}`;
    }
    return out;
  }
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\r?\n/g, '&#10;'); // a line break survives as &#10;
  const formatFor = (g) => g.format || C().format || 'json';
  function payloadOf(g, data) {
    const d = resolve(data, 'caspar');
    if (String(formatFor(g)).toLowerCase() === 'xml') return '<templateData>' + Object.entries(d).map(([k, v]) => `<componentData id="${xmlEsc(k)}"><data id="text" value="${xmlEsc(v)}"/></componentData>`).join('') + '</templateData>';
    return JSON.stringify(d);
  }
  // Clock values move all the time; they must not count as a "change" or every refresh would resend.
  const sig = (data) => JSON.stringify(Object.assign({}, data, { clock_ms: '', clock_text: '', shot_ms: '', shot_text: '', gt_ms: '', countdown_ms: '' }, Object.fromEntries(Object.keys(data).filter((k) => /^sinbin\d+_(ms|text)$/.test(k)).map((k) => [k, '']))));
  const out = (action, ch, layer, template, data, method) => emit({ type: 'output', action, channel: ch, layer, template: template || null, data: data || null, method: method || null });
  const channelFor = (g, preview) => (preview ? previewCh() : (g.channel > 0 ? g.channel : programCh()));

  function cancelClear(key) { const t = pendingClear.get(key); if (t) { clearTimeout(t); pendingClear.delete(key); } }
  function scheduleClear(key, ms) {
    cancelClear(key);
    const t = setTimeout(async () => {
      if (pendingClear.get(key) !== t) return;
      pendingClear.delete(key);
      const [ch, layer] = key.split('-').map(Number);
      plEnd(key);
      const removed = onAir.delete(key);
      out('clear', ch, layer);
      await send(cmd.clearLayer(ch, layer));
      if (removed) changed();
    }, ms);
    pendingClear.set(key, t);
  }

  // ---- play log: every graphic taken to program, when it came off and for how long (adverts are logged with their sponsor in adlog)
  const plOpen = new Map(), plQueue = [];
  let plTimer = null;
  const plTeam = (t) => t || (doc(fixtureId) || {}).team || (([...app.cache.values()].find((x) => x.type === 'org' && !x.deleted) || {}).id) || '';
  // the production a match is part of (productions list their matches); cached for a minute
  const prodCache = new Map();
  function productionOf(fid) {
    if (!fid) return '';
    const c = prodCache.get(fid); if (c && Date.now() - c.t < 60000) return c.name;
    let name = '';
    for (const d of app.cache.values()) if (d.type === 'production' && !d.deleted && (d.data.fixtures || []).some((r) => r && r.fixture === fid)) { name = d.data.name || ''; break; }
    prodCache.set(fid, { t: Date.now(), name });
    return name;
  }
  const whoNow = () => { const w = actor.who() || {}; return { by: String(w.name || '').slice(0, 80), ip: String(w.ip || '').slice(0, 60), via: String(w.via || '').slice(0, 60) }; };
  function plStart(e, how) {
    if (!e || e.preview || e.graphicId === 'advert') return;
    const fx = doc(fixtureId);
    let line = ''; try { const d = JSON.parse(e.lastJson || '{}'); line = [d.line1 || d.title || d._heading || '', d.line2 || ''].filter(Boolean).join(' · '); } catch { /* not JSON */ }
    const rec = { id: Math.random().toString(36).slice(2, 10), graphic: e.graphicId, name: e.name || e.graphicId, template: e.template, channel: e.channel, layer: e.layer, at: Date.now(), how: how || 'take', text: String(line).slice(0, 120),
      match: fx ? fx.data.name || fx.data.autoName || '' : '', production: productionOf(fixtureId), team: plTeam(e.team), machine: app.config.machineName || require('node:os').hostname(), ...whoNow() };
    plOpen.set(e.key, rec); plQueue.push(rec); plFlush();
  }
  function plEnd(key) {
    const r = plOpen.get(key); if (!r) return;
    plOpen.delete(key); r.ended = Date.now(); { const w = whoNow(); r.offBy = [w.via, w.by].filter(Boolean).join(' · '); r.offIp = w.ip; } r.seconds = Math.round((r.ended - r.at) / 100) / 10; plQueue.push(r); plFlush();
  }
  function plFlush() {
    if (plTimer) return;
    plTimer = setTimeout(async () => {
      plTimer = null;
      const batch = plQueue.splice(0), byDoc = new Map();
      for (const r of batch) { if (!r.team) continue; const date = new Date(r.at).toLocaleDateString('en-CA'), id = detId('playlog_', r.team, date, app.config.machineId || ''); if (!byDoc.has(id)) byDoc.set(id, { team: r.team, date, recs: new Map() }); byDoc.get(id).recs.set(r.id, Object.assign({}, r)); }
      for (const [id, x] of byDoc) {
        try {
          const c0 = app.cache.get(id), list = ((c0 && !c0.deleted && c0.data.entries) || []).slice();
          for (const r of x.recs.values()) { const i = list.findIndex((e) => e.id === r.id); if (i >= 0) list[i] = r; else list.push(r); }
          await app.save(x.team, 'playlog', id, { date: x.date, machine: app.config.machineName || '', entries: list.slice(-8000) }, '');
        } catch (e) { log('Play log:', e.message); }
      }
    }, 1500);
    plTimer.unref();
  }

  async function show(id, p, overrides, preview, team) {
    const g = get0(id), ch = channelFor(g, preview), key = keyOf(ch, g.layer), template = templateOf(g);
    const data = buildData(g, p, overrides, team);
    cancelClear(key);
    const prev = onAir.get(key);
    if (prev && prev.clip) await send(cmd.stop(ch, g.layer));
    const json = JSON.stringify(resolve(data, 'web'));
    out('add', ch, g.layer, template, json);
    if (prev) plEnd(key);
    onAir.set(key, { key, graphicId: g.id, name: g.name, template, channel: ch, layer: g.layer, preview: !!preview, params: Object.assign({}, p || {}), overrides: Object.assign({}, overrides || {}), since: new Date().toISOString(), team: team || '', sig: sig(data), lastJson: json });
    plStart(onAir.get(key));
    await send(`CG ${ch}-${g.layer} ADD 1 ${quote(template)} 1 ${quote(payloadOf(g, data))}`);
    if (g.autoClearMs > 0) {                         // "take off after N seconds": a normal OUT (CG STOP), not a hard clear
      cancelClear(key);
      const t = setTimeout(() => { if (pendingClear.get(key) !== t) return; pendingClear.delete(key); hideKey(key).then(changed).catch(() => {}); }, g.autoClearMs);
      t.unref(); pendingClear.set(key, t);
    }
    return onAir.get(key);
  }
  async function update(id, p, overrides, preview, team) {
    const g = get0(id), ch = channelFor(g, preview), key = keyOf(ch, g.layer), entry = onAir.get(key);
    if (!entry || entry.graphicId !== id) return show(id, p, overrides, preview, team);
    const data = buildData(g, p, overrides, team || entry.team), json = JSON.stringify(resolve(data, 'web'));
    out('update', ch, g.layer, entry.template, json);
    Object.assign(entry, { params: Object.assign({}, p || {}), overrides: Object.assign({}, overrides || {}), sig: sig(data), lastJson: json });
    await send(cmd.cgUpdate(ch, g.layer, payloadOf(g, data)));
    return entry;
  }
  async function hideKey(key) {
    if (key === adKey && adRef) { const r = adRef; adRef = null; endPlay(r).catch(() => {}); }   // an advert taken off early: log its real air time
    const entry = onAir.get(key);
    plEnd(key);
    onAir.delete(key);
    const [ch, layer] = String(key).split('-').map(Number);
    if (!Number.isFinite(ch) || !Number.isFinite(layer)) return;
    if ((layer === AD_LAYER && ch === programCh()) || key === adKey) { playlist = null; clearTimeout(adTimer); }
    out('stop', ch, layer);
    await send(entry && entry.clip ? cmd.stop(ch, layer) : cmd.cgStop(ch, layer));
    // OUT sends CG STOP only, so the template plays its own out animation to the end. A CLEAR follows only if a time is set for it
    // (Graphics control → Settings). The older "clearAfterStopMs" (1.5 s by default) cut long out animations short and is no longer read.
    const ms = Number(C().clearAfterOutMs) || 0;
    if (ms > 0 && !(entry && entry.clip)) scheduleClear(key, ms);
  }
  const hide = (id, preview) => { const g = get0(id); return hideKey(keyOf(channelFor(g, preview), g.layer)); };
  async function hideAll(includePreview) { for (const e of [...onAir.values()]) if (includePreview || !e.preview) await hideKey(e.key); }
  async function invoke(key, method, fresh) {
    stash(key, '', fresh);
    const [ch, layer] = String(key).split('-').map(Number);
    if (!Number.isFinite(ch) || !Number.isFinite(layer)) return;
    out(method === 'next' ? 'next' : 'invoke', ch, layer, null, null, method);
    await send(method === 'next' ? cmd.cgNext(ch, layer) : `CG ${ch}-${layer} INVOKE 1 ${quote(method)}`);
    await invoked(key, method);
  }
  // Anything outside the catalog (worship slides, speaker lower thirds): the caller owns the template, channel, layer and data.
  async function custom(o) {
    const ch = Number(o.channel) > 0 ? Number(o.channel) : programCh(), layer = Number(o.layer), key = keyOf(ch, layer);
    const template = String(o.template || '').includes('/') ? o.template : `${folderFor(o.template)}/${o.template}`;
    const json = JSON.stringify(resolve(o.data, 'web')), prev = onAir.get(key);
    cancelClear(key);
    if (prev && prev.graphicId === o.id && prev.template === template) {
      if (prev.lastJson === json) return prev;
      prev.lastJson = json; prev.name = o.name || prev.name;
      out('update', ch, layer, template, json);
      await send(cmd.cgUpdate(ch, layer, payloadOf({}, o.data)));
      return prev;
    }
    if (prev && prev.clip) await send(cmd.stop(ch, layer));
    out('add', ch, layer, template, json);
    if (prev) plEnd(key);
    onAir.set(key, { key, graphicId: o.id, name: o.name || o.id, template, channel: ch, layer, preview: false, params: {}, overrides: {}, since: new Date().toISOString(), team: o.team || '', sig: '', lastJson: json, custom: true });
    plStart(onAir.get(key), 'custom');
    await send(`CG ${ch}-${layer} ADD 1 ${quote(template)} 1 ${quote(payloadOf({}, o.data))}`);
    changed();
    return onAir.get(key);
  }
  async function customStop(channel, layer) {
    const key = keyOf(Number(channel) > 0 ? Number(channel) : programCh(), Number(layer));
    if (onAir.has(key)) { await hideKey(key); changed(); }
  }

  // Called after every score change: push fresh data to live graphics that are on air.
  async function refreshLive() {
    for (const e of [...onAir.values()]) {
      const g = find0(e.graphicId);
      if (!g || !g.live || e.clip) continue;
      const data = buildData(g, e.params, e.overrides, e.team), s = sig(data);
      if (s === e.sig) continue;
      e.sig = s; e.lastJson = JSON.stringify(resolve(data, 'web'));
      out('update', e.channel, e.layer, e.template, e.lastJson);
      await send(cmd.cgUpdate(e.channel, e.layer, payloadOf(g, data)));
    }
  }
  let ticker = null, ticking = false;
  async function tick() {
    runTriggers().catch(() => {});
    if (ticking || !onAir.size) return;
    ticking = true;
    try {
      for (const e of [...onAir.values()]) {
        const g = find0(e.graphicId);
        if (!g || !g.ticking || e.clip) continue;
        const data = buildData(g, e.params, e.overrides, e.team), json = JSON.stringify(resolve(data, 'web'));
        if (json === e.lastJson) continue;
        e.lastJson = json; e.sig = sig(data);
        out('update', e.channel, e.layer, e.template, json);
        await send(cmd.cgUpdate(e.channel, e.layer, payloadOf(g, data)));
      }
    } finally { ticking = false; }
  }
  app.on('doc', (d) => { if (d.type === 'graphic' || d.type === 'theme' || d.type === 'competition' || d.type === 'org') { userCache = null; emit({ type: 'catalog' }); if (d.type !== 'graphic') changed(); }
    if (!onAir.size || d.type === 'adlog') return; clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refreshLive().catch((e) => log('Graphics refresh:', e.message)), 60); });

  // ---- adverts ------------------------------------------------------------------------------
  // Proof of play: one line per play, with where and how long it was on air (ended early when it is taken off sooner).
  async function logPlay(team, advertId, a, seconds, more) {
    const date = new Date().toLocaleDateString('en-CA'), id = detId('adlog_', team, date, app.config.machineId || ''), c0 = app.cache.get(id);
    const fx = doc(fixtureId), entry = Object.assign({ id: Math.random().toString(36).slice(2, 10), advert: advertId, name: a.name || '', sponsor: a.sponsor || '', kind: a.kind || 'Image', layout: a.layout || 'Full screen',
      at: Date.now(), seconds, planned: seconds, match: fx ? fx.data.name || fx.data.autoName || '' : '', production: productionOf(fixtureId), playlist: playlist ? playlist.name || '' : '', machine: app.config.machineName || require('node:os').hostname(), ...whoNow() }, more || {});
    const entries = [...((c0 && !c0.deleted && c0.data.entries) || []), entry].slice(-5000);
    await app.save(team, 'adlog', id, { date, machine: app.config.machineName || '', entries }, '');
    return { id, entry: entry.id, team };
  }
  async function endPlay(ref) {                      // taken off before its time: the log keeps the real air time
    if (!ref) return;
    const c0 = app.cache.get(ref.id); if (!c0 || c0.deleted) return;
    const entries = (c0.data.entries || []).map((e) => (e.id === ref.entry && !e.ended ? Object.assign({}, e, { seconds: Math.max(0, Math.round((Date.now() - e.at) / 100) / 10), ended: Date.now() }) : e));
    await app.save(ref.team, 'adlog', ref.id, Object.assign({}, c0.data, { entries }), '');
  }
  const playsToday = (advertId) => { const date = new Date().toLocaleDateString('en-CA'); let n = 0; for (const d of app.cache.values()) if (d.type === 'adlog' && !d.deleted && d.data.date === date) n += (d.data.entries || []).filter((e) => e.advert === advertId).length; return n; };
  const runsToday = (a) => { const t = new Date().toLocaleDateString('en-CA'); return !(a.from && t < a.from) && !(a.until && t > a.until); };
  let adKey = null, adRef = null;
  async function playAdvert(team, advertId, { hold, seconds } = {}) {
    const a = get(advertId), d = doc(advertId);
    if (!a) fail(404, 'Advert not found');
    const secs = Math.max(1, Number(seconds) || Number(a.duration) || 10);
    const ch = Number(a.channel) > 0 ? Number(a.channel) : programCh(), layer = Number(a.layer) > 0 ? Number(a.layer) : AD_LAYER, key = keyOf(ch, layer);
    clearTimeout(adTimer);
    if (adKey && adKey !== key && onAir.has(adKey) && !playlist) await hideKey(adKey);
    await endPlay(adRef); adRef = null;
    const tsecs = Math.max(0, Math.min(5, a.transitionSecs === '' || a.transitionSecs == null ? 0.4 : Number(a.transitionSecs) || 0));
    const trans = ({ Fade: 'fade', 'Slide up': 'up', 'Slide from left': 'left', 'Slide from right': 'right', Cut: 'cut' })[a.transition] || 'fade';
    if (a.kind === 'CasparCG clip' && a.clip) {
      cancelClear(key);
      const json = JSON.stringify({ layout: 'clip', name: a.name || '', sponsor: a.sponsor || '', clip: a.clip, accent: (get(d.team) || {}).accentColor || '#00ff82' });
      onAir.set(key, { key, graphicId: 'advert', name: 'Ad: ' + a.name, template: `${folderFor('advert')}/advert`, channel: ch, layer, preview: false, params: {}, overrides: {}, since: new Date().toISOString(), team: d.team, sig: '', lastJson: json, clip: true });
      out('add', ch, layer, `${folderFor('advert')}/advert`, json);
      // as before: a half-second mix in, unless the advert sets its own transition
      const frames = a.transitionSecs === '' || a.transitionSecs == null ? 12 : Math.round(tsecs * 25);
      await send(`PLAY ${ch}-${layer} ${quote(a.clip)}${a.loop ? ' LOOP' : ''}${trans !== 'cut' && frames > 0 ? ` MIX ${frames}` : ''}`);
      if (a.volume !== undefined && a.volume !== '' && Number(a.volume) !== 100) await send(`MIXER ${ch}-${layer} VOLUME ${Math.max(0, Math.min(2, (Number(a.volume) || 0) / 100))}`);
    } else {
      const layout = ({ 'Full screen': 'full', 'Lower banner': 'lower', 'Corner bug': 'bug', 'Side panel': 'side', 'Custom position': 'custom' })[a.layout] || 'full';
      const num = (v, dflt) => (v === '' || v == null || !Number.isFinite(Number(v)) ? dflt : String(Number(v)));
      const data = { layout, image: a.image || '', sponsor: a.sponsor || '', name: a.name || '', text: a.text || '', fit: ({ 'Fill (crop)': 'cover', Stretch: 'fill' })[a.fit] || 'contain',
        bg: a.background || '', trans, tsecs: String(tsecs), x: num(a.x, '0'), y: num(a.y, '0'), w: num(a.width, '1920'), h: num(a.height, '1080'), accent: (get(d.team) || {}).accentColor || '#00ff82' };
      const tpl = String(a.template || '').trim().replace(/\.html?$/i, '');
      if (tpl || ch !== programCh() || layer !== AD_LAYER) await custom({ id: 'advert', name: 'Ad: ' + a.name, template: tpl || 'advert', channel: ch, layer, data, team: d.team });
      else { const e = await show('advert', {}, data, false, d.team); e.name = 'Ad: ' + a.name; }
    }
    adKey = key;
    adRef = await logPlay(d.team, advertId, a, secs, { channel: ch, layer, how: playlist ? 'playlist' : hold ? 'held' : 'manual' });
    if (playlist) adTimer = setTimeout(() => nextAd().catch((e) => log('Ad playlist:', e.message)), secs * 1000);
    else if (!hold) adTimer = setTimeout(() => { adRef = null; hideKey(key).then(changed).catch(() => {}); }, secs * 1000);
    changed();
  }
  async function nextAd() {
    if (!playlist) return;
    if (!(actor.who() && actor.who().via === 'Ad playlist')) return actor.also({ via: 'Ad playlist', name: playlist.name || '' }, nextAd);
    const p = get(playlist.id), items = ((p && p.items) || []).filter((i) => get(i.advert));
    const key = keyOf(programCh(), AD_LAYER);
    if (!items.length) { playlist = null; await hideKey(key); return changed(); }
    const ok = (i) => { const x = get(items[i].advert); return x && runsToday(x) && !(Number(x.maxPerDay) > 0 && playsToday(items[i].advert) >= Number(x.maxPerDay)); };
    let tries = 0;
    do {
      playlist.index++;
      if (playlist.index >= items.length) {
        if (!p.loop) { playlist = null; await endPlay(adRef); adRef = null; await hideKey(adKey || key); return changed(); }
        playlist.index = 0;
      }
    } while (!ok(playlist.index) && ++tries <= items.length);
    if (tries > items.length) { log('Ad playlist: no advert in it may run today (dates or daily limits)'); playlist = null; await hideKey(adKey || key); return changed(); }
    await playAdvert(playlist.team, items[playlist.index].advert, { seconds: items[playlist.index].duration });
  }
  async function startPlaylist(team, id) {
    const p = get(id);
    if (!p) fail(404, 'Playlist not found');
    playlist = { id, team, index: -1, name: p.name };
    await nextAd();
  }
  async function stopPlaylist() { playlist = null; clearTimeout(adTimer); await endPlay(adRef); adRef = null; await hideKey(adKey || keyOf(programCh(), AD_LAYER)); changed(); }

  // ---- state --------------------------------------------------------------------------------
  const onAirList = () => [...onAir.values()].sort((a, b) => (a.preview - b.preview) || (a.layer - b.layer)).map(({ sig: _s, lastJson: _j, ...e }) => e);
  const outputSnapshot = () => [...onAir.values()].map((e) => ({ channel: e.channel, layer: e.layer, template: e.template, data: e.lastJson }));
  function casparState() {
    const a = amcp.status(), c = C();
    return { connected: a.connected, enabled: a.enabled, endpoint: `${a.host}:${a.port}`, version: a.version,
      settings: { enabled: a.enabled, host: a.host, port: Number(a.port), programChannel: programCh(), previewChannel: previewCh(), defaultFormat: c.format || 'json', clearAfterStopMs: Number(c.clearAfterOutMs) || 0, images: c.images || 'file', templateFolder: c.templateFolder || 'rfp' } };
  }
  function saveCasparSettings(d) {
    const c = app.config.caspar;
    if (String(d.host || '').trim()) c.host = String(d.host).trim();
    if (Number(d.port) > 0) c.port = Number(d.port);
    if (Number(d.programChannel) > 0) c.channel = Number(d.programChannel);
    if (Number(d.previewChannel) > 0) c.previewChannel = Number(d.previewChannel);
    if (d.clearAfterStopMs !== undefined && Number(d.clearAfterStopMs) >= 0) c.clearAfterOutMs = Number(d.clearAfterStopMs);
    if (d.enabled !== undefined) c.enabled = !!d.enabled;
    if (d.defaultFormat === 'json' || d.defaultFormat === 'xml') c.format = d.defaultFormat;
    if (d.images === 'file' || d.images === 'http') c.images = d.images;
    if (d.templateFolder !== undefined) c.templateFolder = String(d.templateFolder || 'rfp').replace(/[^\w/-]/g, '') || 'rfp';
    app.saveConfig();
    amcp.reconnect();
  }
  async function setFixture(id) {
    const d = id ? doc(id) : null;
    if (id && (!d || d.type !== 'fixture')) fail(404, 'Match not found');
    fixtureId = id || null;
    await app.store.kvSet('gfx:fixture', fixtureId);
    emit({ type: 'fixture', fixtureId });
    emit({ type: 'catalog' });                         // the active theme may have changed with the match
    await refreshLive();
    changed();
  }
  async function start() {
    fixtureId = (await app.store.kvGet('gfx:fixture')) || null;
    themeChoice = String((await app.store.kvGet('gfx:theme')) || '');
    if (themeChoice && themeChoice !== 'none' && !doc(themeChoice)) themeChoice = '';
    ticker = setInterval(() => { tick().catch(() => {}); }, 500); ticker.unref();
    if (fixtureId && !doc(fixtureId)) fixtureId = null;
    // a device value changed (streaming time, a keyer, program input …): graphics showing it update, triggers see it on the next tick
    if (app.devices) {
      app.devices.on('change', () => { if (!onAir.size) return; clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refreshLive().catch((e) => log('Graphics refresh:', e.message)), 60); });
      app.devices.on('status', () => changed());
    }
    amcp.start();
  }
  function stop() { clearInterval(ticker); clearTimeout(adTimer); clearTimeout(refreshTimer); for (const t of pendingClear.values()) clearTimeout(t); amcp.stop(); }

  return { amcp, start, stop, catalog, publicCatalog, get: get0, buildData: (id, p, o, team) => resolve(buildData(get0(id), p, o, team), 'web'), show, update, hide, hideKey, hideAll, invoke, refreshLive,
    onAirList, runButton, liveValues, reference, runActions: (list, o) => runActions(cleanActions(list), o), cleanActions, macrosFor, outputSnapshot, casparState, saveCasparSettings, setFixture, setTheme, themeState, custom, customStop, variables, playAdvert, startPlaylist, stopPlaylist, raw: (c) => send(c), log: () => amcpLog.slice(),
    get fixtureId() { return fixtureId; }, get strip() { return strip; }, set strip(v) { strip = String(v || ''); }, get autoWipes() { return autoWipes; }, set autoWipes(v) { autoWipes = !!v; }, get triggersOn() { return triggersOn; }, set triggersOn(v) { triggersOn = !!v; },
    playlistState: () => (playlist ? Object.assign({}, playlist) : null), setProvider: (fn) => { provider = fn; }, onMessage: (fn) => listeners.add(fn), templateFolder: folder };
}

module.exports = { makeGfx };
