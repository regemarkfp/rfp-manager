'use strict';
// Federation rules across the sports engines (shared/sports.js) and the sport-aware match settings (shared/schema.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/sports');
const Scoring = require('../shared/scoring');
const Schema = require('../shared/schema');

let n = 0;
const ev = (type, o) => Object.assign({ id: 'e' + (++n), type, t: n * 1000 }, o);
const setup = (sport, variant) => { const s = S.newSetup(sport, variant); s.teams.A.name = 'Lions'; s.teams.B.name = 'Sharks'; return s; };
const points = (team, k) => Array.from({ length: k }, () => ev('point', { team }));

test('team sports do not say "X lead by Y" (only cricket does); the result still shows at the end', () => {
  for (const [sport, key] of [['rugby', 'try'], ['football', 'goal'], ['hockey', 'goal'], ['netball', 'goal'], ['basketball', 'two'], ['rocketleague', 'goal']]) {
    const v = S.compute(setup(sport), [ev('score', { team: 'A', key })]);
    assert.equal(v.score.A > v.score.B, true, sport + ' scored');
    assert.doesNotMatch(v.status, /LEAD|LEVEL/, sport + ' live status');
    const end = S.compute(setup(sport), [ev('score', { team: 'A', key }), ev('end', {})]);
    assert.equal(end.status, 'LIONS WIN', sport + ' result');
  }
  // tennis: no "LEAD 1-0 IN SETS", the server instead
  const t = S.compute(setup('tennis'), points('A', 24));
  assert.equal(t.score.A, '1');
  assert.doesNotMatch(t.status, /LEAD/);
  assert.match(t.status, /TO SERVE|POINT/);
  // the flat graphics fields fall back to the period name while live
  assert.equal(S.compute(setup('rugby'), []).status, '');
});

test('padel: FIP star point (2026) – two advantage rounds, then one deciding point', () => {
  const su = setup('padel');
  assert.equal(su.variant, 'star');
  // 40-40, A ad, back to deuce, B ad, back to deuce (5-5 in points) → star point
  const deuce3 = [...points('A', 3), ...points('B', 3), ev('point', { team: 'A' }), ev('point', { team: 'B' }), ev('point', { team: 'B' }), ev('point', { team: 'A' })];
  let v = S.compute(su, deuce3);
  assert.equal(v.extra.flag, 'STAR POINT');
  assert.deepEqual(v.extra.points, { A: '40', B: '40' });
  v = S.compute(su, [...deuce3, ev('point', { team: 'B' })]);
  assert.deepEqual(v.extra.games, { A: 0, B: 1 }, 'star point wins the game');
  // first deuce is still advantage
  v = S.compute(su, [...points('A', 3), ...points('B', 3), ev('point', { team: 'A' })]);
  assert.deepEqual([v.extra.points.A, v.extra.games.A], ['AD', 0]);
  // golden point variant still there
  assert.equal(S.compute(setup('padel', 'golden'), [...points('A', 3), ...points('B', 3)]).extra.flag, 'GOLDEN POINT');
});

test('badminton: BWF 3 × 15 (from 2027) – win by 2 from 14-14, 21 caps it, interval at 8', () => {
  const su = setup('badminton', 'bwf15');
  let v = S.compute(su, points('A', 15));
  assert.deepEqual([v.extra.sets.length, v.score.A], [1, '1']);
  v = S.compute(su, [...Array.from({ length: 28 }, (_, i) => ev('point', { team: i % 2 ? 'B' : 'A' })), ev('point', { team: 'A' })]);
  assert.equal(v.extra.sets.length, 0, '15-14 is not a game');
  const alt = (k) => Array.from({ length: k }, (_, i) => ev('point', { team: i % 2 ? 'B' : 'A' }));
  v = S.compute(su, [...alt(40), ev('point', { team: 'B' })]);
  assert.deepEqual([v.extra.sets.length, v.extra.sets[0].B], [1, 21], '21-20 wins at the cap');
  assert.equal(S.compute(su, points('A', 8)).extra.note, 'INTERVAL');
});

test('basketball: the bonus starts after 4 team fouls (FIBA, NBA) and after 6 in 3x3', () => {
  const fouls = (k) => Array.from({ length: k }, () => ev('foul', { team: 'A' }));
  for (const [variant, limit] of [['fiba', 4], ['nba', 4], ['3x3', 6]]) {
    assert.equal(S.compute(setup('basketball', variant), fouls(limit - 1)).extra.bonus.B, false, variant + ' under the limit');
    assert.equal(S.compute(setup('basketball', variant), fouls(limit)).extra.bonus.B, true, variant + ' at the limit');
  }
});

test('rugby league 2-point field goal (NRL) and Fast5 netball 3-point shot', () => {
  const lg = setup('rugby', 'league');
  let v = S.compute(lg, [ev('score', { team: 'A', key: 'drop2' }), ev('score', { team: 'A', key: 'drop' })]);
  assert.equal(String(v.score.A), '3');
  v = S.compute(setup('netball', 'fast5'), [ev('score', { team: 'A', key: 'long3' }), ev('score', { team: 'A', key: 'super' }), ev('score', { team: 'A', key: 'goal' })]);
  assert.equal(String(v.score.A), '6');
});

test('match settings only show for the sports they apply to', () => {
  const f = Object.fromEntries(Schema.ENTITIES.fixture.fields.map((x) => [x.k, x]));
  const shows = (k, sport) => !f[k].sports || f[k].sports.includes(Scoring.sportFor(sport).id);
  assert.deepEqual(['red20', 'goldenPoint', 'sinbinMin', 'totalPeriods', 'statCoverage'].map((k) => shows(k, 'Rugby')), [true, true, true, true, true]);
  assert.deepEqual(['red20', 'goldenPoint', 'sinbinMin', 'totalPeriods', 'lineupSize'].map((k) => shows(k, 'Tennis')), [false, false, false, false, false]);
  assert.deepEqual(['red20', 'sinbinMin', 'totalPeriods', 'kickingComp'].map((k) => shows(k, 'Hockey')), [false, true, true, true]);
  assert.deepEqual(['totalPeriods', 'lineupSize', 'red20'].map((k) => shows(k, 'Cricket')), [false, true, false]);
  // fixture fields sit in groups so the form can show them as sub-tabs
  assert.deepEqual([f.sport.group, f.venue.group, f.scorer.group], ['Match', 'When & where', 'People']);
  const c = Object.fromEntries(Schema.ENTITIES.competition.fields.map((x) => [x.k, x]));
  assert.deepEqual([c.name.group, c.logo.group, c.fieldGoalPoints.sports], ['Competition', 'Branding', ['rugby']]);
});

test('Rocket League (E-Sports): goals, saves and demos; 5 minutes then overtime; 3v3 / 2v2 / 1v1', () => {
  const su = setup('rocketleague');
  assert.equal(su.variant, 'standard');
  const v = S.compute(su, [ev('score', { team: 'A', key: 'goal' }), ev('score', { team: 'B', key: 'goal' }), ev('stat', { team: 'B', key: 'epic_save' }), ev('stat', { team: 'A', key: 'demo' }), ev('period', {})]);
  assert.deepEqual([v.score.A, v.score.B, v.periodLabel], ['1', '1', 'OVERTIME']);
  assert.equal(v.teamStats.find((x) => x.label === 'SAVES').b, '1', 'an epic save is also a save');
  assert.equal(S.compute(su, []).clock.game.startMs, 5 * 60000);
  assert.equal(S.list().find((x) => x.id === 'rocketleague').category, 'E-Sports');
  assert.equal(S.compute(setup('rocketleague', 'doubles'), []).extra.lineupSize, 2);
});
