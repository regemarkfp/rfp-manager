'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/cricket');

function match(format) {
  const e = new C.Engine(C.newMatch());
  e.setup({ format: format || 'T20', tournament: 'Test Cup' });
  const squad = (p) => Array.from({ length: 11 }, (_, i) => ({ name: `${p} Player${i + 1}` }));
  e.setTeam({ key: 'A', name: 'Lions', shortName: 'LIO', players: squad('Alpha') });
  e.setTeam({ key: 'B', name: 'Titans', shortName: 'TIT', players: squad('Beta') });
  return e;
}
const ids = (e, k) => C.team(e.match, k).players.map((p) => p.id);
function open(e, bat) {
  e.startInnings(bat);
  const b = ids(e, bat), f = ids(e, bat === 'A' ? 'B' : 'A');
  e.setStriker(b[0]); e.setNonStriker(b[1]); e.setBowler(f[10]);
  return { b, f };
}
// Bowl whole overs with `runs` off the first ball of each, rotating five bowlers.
function overs(e, n, runs, f, from = 0) {
  for (let o = 0; o < n; o++) { e.setBowler(f[10 - ((from + o) % 5)], true); for (let i = 0; i < e.match.ballsPerOver; i++) e.addBall({ runs: i === 0 ? runs : 0 }); }
}
const stats = (e, o) => C.compute(e.match, o);

test('ball by ball: extras, strike rotation, free hit, cards', () => {
  const e = match();
  const { b, f } = open(e, 'A');
  e.addBall({ runs: 1 });                                   // strike rotates
  assert.equal(e.match.innings[0].strikerId, b[1]);
  e.addBall({ runs: 4, boundary: true });
  e.addBall({ runs: 0, extra: 'nb' });                      // no-ball: 1 extra, free hit next
  let s = stats(e).innings[0];
  assert.equal(s.freeHit, true);
  assert.throws(() => e.addBall({ runs: 0, wicket: { kind: 'bowled' } }), /free hit/);
  e.addBall({ runs: 0, wicket: { kind: 'runout', playerOutId: b[1] } });   // run out is allowed on a free hit
  e.newBatter(b[2]);
  e.addBall({ runs: 2, extra: 'wd' });                      // wide + 2 = 3 extras, not a legal ball
  e.addBall({ runs: 1, extra: 'lb' });
  e.addBall({ runs: 6, boundary: true });
  e.addBall({ runs: 0, wicket: { kind: 'caught', fielderId: f[3] } });
  s = stats(e).innings[0];
  assert.equal(s.score, '16/2');
  assert.equal(s.overs, '1');
  assert.equal(s.extras.detail, 'lb 1, w 3, nb 1');
  assert.deepEqual(s.overList[0].balls, ['1', '4', 'nb', 'W', '3wd', '1lb', '6', 'W']);
  assert.equal(s.overComplete, true);
  assert.equal(e.match.innings[0].bowlerId, null);          // new over needs a new bowler
  assert.deepEqual(s.fow.map((x) => `${x.wicket}-${x.score}`), ['1-6', '2-16']);
  assert.equal(s.bowling[0].figures, '1-15');               // byes/leg-byes are not charged to the bowler; the run out is not his wicket
  assert.equal(s.batting.find((x) => x.playerId === b[0]).howOut, `c ${C.display(C.findPlayer(e.match, f[3]))} b ${C.display(C.findPlayer(e.match, f[10]))}`);
  e.undo();
  assert.equal(stats(e).innings[0].score, '16/1');
});

test('ICC playing conditions: consecutive overs, bowler limit, powerplay phases', () => {
  const e = match('T20');
  const { f } = open(e, 'A');
  for (let i = 0; i < 6; i++) e.addBall({ runs: 0 });
  assert.equal(stats(e).innings[0].bowling[0].maidens, 1);
  assert.throws(() => e.setBowler(f[10]), /two in a row/);
  overs(e, 7, 1, [...f.slice(0, 9), f[9], f[10]].map((x, i, a) => a[i]), 1);     // overs 2-8
  // f[10] has now bowled overs 1 and 6 … keep going until someone reaches 4
  const s = stats(e).innings[0];
  assert.equal(s.powerplayName, '');                        // powerplay (overs 1-6) is over
  assert.equal(s.bowlerLimit, 4);
  const e2 = match('T20'); const o2 = open(e2, 'A');
  for (let o = 0; o < 8; o++) { e2.setBowler(o % 2 ? o2.f[9] : o2.f[10]); for (let i = 0; i < 6; i++) e2.addBall({ runs: 1 }); }
  assert.throws(() => e2.setBowler(o2.f[10]), /maximum of 4 overs/);
  e2.setBowler(o2.f[10], true);                             // the scorer can still force it
  const odi = match('ODI'); const od = open(odi, 'A');
  assert.equal(odi.match.oversPerInnings, 50);
  assert.equal(stats(odi).innings[0].powerplayName, 'P1');
  overs(odi, 10, 0, od.f);
  assert.equal(stats(odi).innings[0].powerplayName, 'P2');
  assert.equal(stats(odi).innings[0].bowlerLimit, 10);
  // Shortened T20 (rain before the start): 12 overs -> powerplay 3.4 overs, 3 overs a bowler
  const r = match('T20'); const ro = open(r, 'A'); r.addInterruption(12, 'rain', null);
  assert.equal(stats(r).innings[0].bowlerLimit, 3);
  for (let i = 0; i < 6; i++) r.addBall({ runs: 0 });
  overs(r, 2, 0, ro.f, 1);
  r.setBowler(ro.f[6], true); for (let i = 0; i < 3; i++) r.addBall({ runs: 0 });
  assert.equal(stats(r).innings[0].powerplayName, 'P');     // 3.3 overs: still in
  r.addBall({ runs: 0 });
  assert.equal(stats(r).innings[0].powerplayName, '');      // 3.4 overs: powerplay done
});

test('chase, result text and super over', () => {
  const e = match('T10');
  let o = open(e, 'A');
  overs(e, 10, 1, o.f);                                     // 10
  let ms = stats(e);
  assert.equal(ms.innings[0].complete, true);
  assert.equal(ms.statusText, 'END OF INNINGS: LIONS 10/0 (10 OV)');
  o = open(e, 'B');
  ms = stats(e);
  assert.equal(ms.innings[1].target, 11);
  assert.equal(ms.statusText, 'TITANS NEED 11 RUNS TO WIN FROM 60 BALLS');
  overs(e, 10, 1, o.f);                                     // 60: tied
  ms = stats(e);
  assert.equal(ms.resultText, 'MATCH TIED');
  e.startInnings('B', { superOver: true });
  let so = ids(e, 'B'), fo = ids(e, 'A');
  e.setStriker(so[0]); e.setNonStriker(so[1]); e.setBowler(fo[10]);
  for (let i = 0; i < 6; i++) e.addBall({ runs: 2 });
  assert.equal(stats(e).resultText, 'MATCH TIED · SUPER OVER');
  e.startInnings('A', { superOver: true });
  e.setStriker(fo[0]); e.setNonStriker(fo[1]); e.setBowler(so[10]);
  assert.equal(stats(e).innings[3].target, 13);
  e.addBall({ runs: 6, boundary: true }); e.addBall({ runs: 6, boundary: true }); e.addBall({ runs: 1 });
  ms = stats(e);
  assert.equal(ms.resultText, 'LIONS WON THE SUPER OVER');
  assert.equal(ms.winner, 'A');
  assert.equal(ms.innings[3].maxWickets, 2);
});

test('DLS: resources, revised target, par score, official table import', () => {
  assert.ok(Math.abs(C.resource(20, 0) - 56.6) < 0.2);       // Standard Edition headline value
  assert.equal(C.resource(50, 0), 100);
  const e = match('ODI');
  let o = open(e, 'A');
  overs(e, 50, 5, o.f);                                     // 250 from 50
  o = open(e, 'B');
  overs(e, 20, 4, o.f);                                     // 80/0 after 20
  e.addInterruption(40, 'rain', null);                      // 10 overs lost
  const ms = stats(e);
  assert.equal(ms.dls.applied, true);
  const lost = C.resource(30, 0) - C.resource(20, 0);
  assert.equal(ms.dls.r2, Math.round((100 - lost) * 100) / 100);
  assert.equal(ms.dls.target, Math.floor(250 * (100 - lost) / 100) + 1);
  assert.equal(ms.innings[1].target, ms.dls.target);
  assert.equal(ms.innings[1].targetRevised, true);
  assert.match(ms.dls.parText, /^DLS PAR \d+ · TITANS \d+ (AHEAD|BEHIND)$/);
  e.setDls({ enabled: true, g50: 245, parOverride: 77 });
  assert.equal(stats(e).dls.par, 77);
  e.setTargetOverride(222);                                 // officials' Professional Edition figure wins
  assert.equal(stats(e).innings[1].target, 222);
  const text = C.builtInTable().map((r, u) => [u, ...r.map((x) => x + 1 > 100 ? 100 : x)].join('\t')).reverse().join('\n');
  const parsed = C.parseTable(text);
  assert.equal(parsed.rows.length, 51);
  assert.match(stats(e, { dlsTable: parsed.rows }).dls.tableSource, /custom/);
  assert.match(C.parseTable('1 2 3').error, /Expected 51 rows/);
});

test('two-innings cricket: lead, declaration, fourth-innings target, innings victory', () => {
  const e = match('TEST');
  assert.equal(C.perSide(e.match), 2);
  let o = open(e, 'A');
  overs(e, 30, 6, o.f);                                     // 180
  e.endInnings(true);
  let ms = stats(e);
  assert.equal(ms.innings[0].score, '180/0d');
  assert.equal(ms.innings[0].maxBalls, 0);                  // no over limit
  o = open(e, 'B');
  overs(e, 10, 6, o.f);                                     // 60
  assert.equal(stats(e).statusText, 'TITANS TRAIL BY 120 RUNS');
  e.endInnings();
  o = open(e, 'B');                                         // follow-on
  overs(e, 10, 5, o.f);                                     // 50 -> 110 in the match, still 70 behind
  e.endInnings();
  ms = stats(e);
  assert.equal(ms.resultText, 'LIONS WON BY AN INNINGS AND 70 RUNS');
  // a normal fourth-innings chase
  const t = match('FC');
  for (const [k, n] of [['A', 20], ['B', 15], ['A', 10]]) { const x = open(t, k); overs(t, n, 6, x.f); t.endInnings(); }
  const x = open(t, 'B');
  assert.equal(stats(t).innings[3].target, 120 + 60 - 90 + 1);
  overs(t, 15, 6, x.f); for (let i = 0; i < 1; i++) { t.setBowler(x.f[3], true); t.addBall({ runs: 1 }); }
  assert.equal(stats(t).resultText, 'TITANS WON BY 10 WICKETS');
});
