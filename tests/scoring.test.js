'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/scoring');
const Schema = require('../shared/schema');

let n = 0;
const ctx = (now) => ({ now, user: 'test', id: () => 'e' + String(++n).padStart(5, '0') });
const teams = [{ id: 'sA', name: 'Cheetahs', short: 'CHE', players: [{ id: 'p1', name: 'Ruan O' }] }, { id: 'sB', name: 'Bulls', short: 'BUL', players: [] }];
const mk = (sport, opts) => S.newLive(S.sportDef(sport), teams, 1000, opts);
const run = (live, steps, t0 = 2000) => steps.reduce((L, [a, d], i) => S.apply(L, a, d, ctx(t0 + i * 10)), live);

test('rugby: points, scorers, clock, half time, full time, undo', () => {
  let L = mk('Rugby');
  L = S.apply(L, 'clockStart', {}, ctx(10_000));
  L = S.apply(L, 'score', { side: 0, scoreId: 'try', pid: 'p1', pname: 'Ruan O' }, ctx(10_000 + 12 * 60000));
  L = S.apply(L, 'score', { side: 0, scoreId: 'con' }, ctx(10_000 + 13 * 60000));
  L = S.apply(L, 'score', { side: 1, scoreId: 'pen' }, ctx(10_000 + 20 * 60000));
  let v = S.compute(L, 10_000 + 25 * 60000);
  assert.deepEqual(v.score, [7, 3]);
  assert.equal(v.clockText, '25:00');
  assert.equal(v.periodText, '1st Half');
  assert.equal(v.scorers[0][0].name, 'Ruan O');
  assert.equal(v.scorers[0][0].items[0].min, 13);
  L = S.apply(L, 'endPeriod', {}, ctx(10_000 + 40 * 60000));
  assert.equal(S.compute(L, 99e6).periodText, 'Half Time');
  assert.equal(S.compute(L, 99e6).clockText, '40:00');
  L = S.apply(L, 'nextPeriod', { start: true }, ctx(20_000_000));
  v = S.compute(L, 20_000_000 + 5 * 60000);
  assert.equal(v.clockText, '45:00');                 // rugby clock runs on from 40
  assert.equal(v.periodText, '2nd Half');
  L = S.apply(L, 'undo', {}, ctx(20_100_000));
  assert.deepEqual(S.compute(L, 0).score, [7, 0]);
  L = S.apply(L, 'final', {}, ctx(30_000_000));
  v = S.compute(L, 0);
  assert.equal(v.periodText, 'Full Time');
  assert.equal(v.winner, 0);
  assert.throws(() => S.apply(L, 'score', { side: 0, scoreId: 'try' }, ctx(1)), /final/);
});

test('sin bin counts down on the match clock and expires', () => {
  let L = mk('Rugby');
  L = S.apply(L, 'clockStart', {}, ctx(0));
  L = S.apply(L, 'event', { side: 1, eventId: 'yellow', pname: 'No 7' }, ctx(60_000));
  assert.equal(Math.round(S.compute(L, 4 * 60_000).sinbins[0].remainMs / 1000), 7 * 60);
  assert.equal(S.compute(L, 12 * 60_000).sinbins.length, 0);
});

test('countdown sports show time remaining; fixture overrides period settings', () => {
  let L = mk('Netball', { periods: 4, periodLength: 12 });
  L = S.apply(L, 'clockStart', {}, ctx(0));
  const v = S.compute(L, 2 * 60000 + 30000);
  assert.equal(v.clockText, '09:30');
  assert.equal(v.clockDir, 'down');
  assert.equal(v.periodText, '1st Quarter');
});

test('tennis: games, deuce, advantage, tiebreak, match', () => {
  let L = mk('Tennis');
  const pt = (side, k = 1) => { for (let i = 0; i < k; i++) L = S.apply(L, 'point', { side }, ctx(5000 + ++n)); };
  pt(0, 3); pt(1, 3);
  assert.deepEqual(S.compute(L, 0).sets.pointText, ['40', '40']);
  pt(0);
  assert.deepEqual(S.compute(L, 0).sets.pointText, ['AD', '40']);
  pt(1); pt(1); pt(1);
  assert.deepEqual(S.compute(L, 0).sets.games, [0, 1]);
  for (let g = 0; g < 5; g++) { pt(0, 4); pt(1, 4); }            // 5-6
  pt(0, 4);                                                    // 6-6 -> tiebreak
  let v = S.compute(L, 0);
  assert.equal(v.sets.tb, true);
  pt(0, 6);
  assert.equal(S.compute(L, 0).sets.flag, 'SET POINT');
  pt(0);
  v = S.compute(L, 0);
  assert.deepEqual(v.sets.sets, [[7, 6]]);
  assert.deepEqual(v.score, [1, 0]);
  for (let g = 0; g < 6; g++) pt(0, 4);
  v = S.compute(L, 0);
  assert.equal(v.sets.done, true);
  assert.equal(v.winner, 0);
  assert.deepEqual(v.sets.sets, [[7, 6], [6, 0]]);
  assert.throws(() => S.apply(L, 'point', { side: 1 }, ctx(1)), /complete/);
});

test('padel golden point and volleyball deciding set', () => {
  let L = mk('Padel');
  for (const s of [0, 0, 0, 1, 1, 1, 1]) L = S.apply(L, 'point', { side: s }, ctx(100 + ++n));
  assert.deepEqual(S.compute(L, 0).sets.games, [0, 1]);
  let V = mk('Volleyball');
  const set = (side, k) => { for (let i = 0; i < k; i++) V = S.apply(V, 'point', { side }, ctx(9000 + ++n)); };
  set(0, 25); set(1, 25); set(0, 25); set(1, 25);
  assert.deepEqual(S.compute(V, 0).score, [2, 2]);
  set(0, 14); set(1, 14); set(0, 1);
  assert.equal(S.compute(V, 0).sets.done, false);              // 15-14 is not enough
  set(0, 1);
  assert.deepEqual(S.compute(V, 0).sets.sets[4], [16, 14]);
  assert.equal(S.compute(V, 0).winner, 0);
});

test('cricket: runs, extras, wickets, overs, chase result', () => {
  let L = mk('Cricket', { overs: 1 });
  L = run(L, [['ball', { runs: 4 }], ['ball', { runs: 0, extra: 'wd' }], ['ball', { runs: 1 }], ['ball', { wicket: true }], ['ball', { runs: 6 }], ['ball', { runs: 2, extra: 'nb' }], ['ball', { runs: 0 }], ['ball', { runs: 1 }]]);
  let v = S.compute(L, 0);
  assert.equal(v.cricket.text[0], '16/1');
  assert.equal(v.cricket.innings[0].overs, '1.0');
  assert.equal(v.cricket.innings[0].done, true);
  L = run(L, [['ball', { runs: 6 }], ['ball', { runs: 6 }], ['ball', { runs: 6 }]], 9000);
  v = S.compute(L, 0);
  assert.equal(v.cricket.done, true);
  assert.equal(v.winner, 1);
  assert.match(v.statusText, /Bulls won by 10 wickets/);
});

test('custom sport from team settings', () => {
  const def = S.sportDef('Touch Rugby', [{ name: 'Touch Rugby', kind: 'timed', periods: 2, periodLength: 20, clock: 'down', scoresText: 'Touchdown=1, Bonus=2', eventsText: 'Sin Bin=2, Sent Off' }]);
  assert.equal(def.scores[1].points, 2);
  assert.equal(def.events[0].sinbin, 2);
  assert.equal(def.clock, 'down');
  assert.equal(S.sportDef('Underwater Chess').kind, 'timed');
});

test('merging two machines keeps every event and converges both ways', () => {
  let base = mk('Rugby');
  base = S.apply(base, 'clockStart', {}, ctx(1000));
  const a = S.apply(base, 'score', { side: 0, scoreId: 'try' }, ctx(2000));
  let b = S.apply(base, 'score', { side: 1, scoreId: 'pen' }, ctx(2500));
  b = S.apply(b, 'clockStop', {}, ctx(3000));
  const a2 = S.apply(a, 'undo', {}, ctx(3500));
  const m1 = S.mergeLive(a2, b), m2 = S.mergeLive(b, a2);
  assert.deepEqual(m1, m2);
  assert.deepEqual(S.mergeLive(m1, a2), m1);
  assert.deepEqual(S.compute(m1, 0).score, [0, 3]);            // the undo and the penalty both survive
  assert.equal(m1.ctl.running, false);
});

test('standings and player statistics come from completed matches', () => {
  const done = (s1, s2) => { let L = mk('Rugby'); for (let i = 0; i < s1; i++) L = S.apply(L, 'score', { side: 0, scoreId: 'try', pid: 'p1', pname: 'Ruan O' }, ctx(100 + ++n)); for (let i = 0; i < s2; i++) L = S.apply(L, 'score', { side: 1, scoreId: 'pen' }, ctx(100 + ++n)); return S.apply(L, 'final', {}, ctx(999999)); };
  const fx = [{ status: 'Completed', team1: 'sA', team2: 'sB', live: done(2, 1) }, { status: 'Completed', team1: 'sA', team2: 'sB', live: done(0, 0) }, { status: 'Live', team1: 'sA', team2: 'sB', live: done(9, 0) }];
  const rows = S.standings(fx, { win: 4, draw: 2, loss: 0 });
  assert.deepEqual(rows.map((r) => [r.name, r.P, r.W, r.D, r.L, r.PD, r.Pts]), [['Cheetahs', 2, 1, 1, 0, 7, 6], ['Bulls', 2, 0, 1, 1, -7, 2]]);
  const st = S.playerStats(fx);
  assert.deepEqual(st.p1.stats, { Try: 2, Points: 10 });
  assert.equal(st.p1.matches, 2);
  assert.deepEqual(st.p1.teams, ['Cheetahs']);
});

test('schema helpers: club inheritance, rundown times, costing, age', () => {
  const club = { name: 'Toyota Cheetahs', graphicName: 'Cheetahs', abbreviation: 'CHE', primaryColor: '#ffffff', secondaryColor: '#ffa500', image: 'img_1' };
  const r = Schema.resolveSquad({ club: 'c', sport: 'Rugby', ageGroup: '19A', primaryColor: '#000000' }, club);
  assert.deepEqual([r.name, r.graphicName, r.abbreviation, r.primaryColor, r.secondaryColor, r.image], ['Toyota Cheetahs', 'Cheetahs', 'CHE', '#000000', '#ffa500', 'img_1']);
  const rows = Schema.rundownTimes([{ content: 'Sting', duration: '00:00:30' }, { content: 'Welcome', duration: '1:00' }, { content: 'Kick off', startTime: '15:00', duration: '40:00' }], '14:55');
  assert.deepEqual(rows.map((x) => x.startText), ['14:55:00', '14:55:30', '15:00:00']);
  assert.equal(rows[2].endText, '15:40:00');
  const get = (id) => ({ r1: { name: 'Director', rate: 2000, invoiceRate: 2500 }, r2: { name: 'Camera', rate: 1500, invoiceRate: 2000 }, e1: { name: 'Camera chain', rate: 500, invoiceRate: 1200 } })[id];
  const c = Schema.costing({ days: 2, crew: [{ role: 'r1' }, { role: 'r2' }, { role: 'r2' }], equipment: [{ item: 'e1', quantity: 3 }], extras: [{ description: 'Travel', cost: 800, invoice: 1000 }] }, get);
  assert.deepEqual([c.cost, c.invoice, c.profit], [13800, 21200, 7400]);
  assert.equal(Schema.age('2001-02-25', '2026-10-05'), 25);
});
