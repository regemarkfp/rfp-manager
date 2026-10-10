'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const Scoring = require('../shared/scoring');
const Sports = require('../shared/sports');
const Cricket = require('../shared/cricket');
const Schema = require('../shared/schema');

test('sports rules engine: CricketCG\'s rule checks plus the federation rules', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'sports-rules.js')], { encoding: 'utf8' });
  assert.match(out, /\b87 passed, 0 failed/);
});

test('one summary, log table and player statistics across every sport', () => {
  assert.deepEqual([Scoring.sportFor('Cricket').id, Scoring.sportFor('Rugby Sevens'), Scoring.sportFor('Soccer').id, Scoring.sportFor('Field Hockey').id, Scoring.sportFor('Chess')],
    ['cricket', { id: 'rugby', variant: 'sevens' }, 'football', 'hockey', null]);
  const ev = (type, o) => Object.assign({ id: Math.random().toString(36).slice(2), type }, o);
  const setup = Sports.newSetup('rugby');
  setup.teams.A = { name: 'Cheetahs', short: 'CHE', players: [{ id: 'p1', name: 'Ruan Osborne', number: 10 }] }; setup.teams.B = { name: 'Bulls', short: 'BUL', players: [] };
  const rugby = (a, b, done) => ({ kind: 'sport', sport: 'rugby', setup, events: [...Array.from({ length: a }, () => ev('score', { key: 'try', team: 'A', player: 'p1' })), ...Array.from({ length: b }, () => ev('score', { key: 'pen', team: 'B' })), ...(done ? [ev('end', {})] : [])] });
  let r = Scoring.summary(rugby(2, 1, false));
  assert.deepEqual([r.text, r.started, r.finished, r.period, r.teams], ['10 – 3', true, false, 'FIRST HALF', ['Cheetahs', 'Bulls']]);
  r = Scoring.summary(rugby(2, 1, true));
  assert.deepEqual([r.finished, r.winner, r.period], [true, 0, 'FULL TIME']);
  assert.equal(Scoring.summary(null).started, false);
  const fx = [{ status: 'Completed', team1: 'sA', team2: 'sB', live: rugby(2, 1, true) }, { status: 'Completed', team1: 'sA', team2: 'sB', live: rugby(0, 0, true) }, { status: 'Live', team1: 'sA', team2: 'sB', live: rugby(9, 0, false) }];
  fx[1].live.events.unshift(ev('note', { text: 'kick off' }));
  assert.deepEqual(Scoring.standings(fx, { win: 4, draw: 2, loss: 0 }).map((x) => [x.name, x.P, x.W, x.D, x.L, x.PD, x.Pts]), [['Cheetahs', 2, 1, 1, 0, 7, 6], ['Bulls', 2, 0, 1, 1, -7, 2]]);
  const st = Scoring.playerStats(fx);
  assert.deepEqual([st.p1.matches, st.p1.stats.Tries, st.p1.stats.Points, st.p1.teams], [2, 2, 10, ['Cheetahs']]);
  // cricket through the same door
  const e = new Cricket.Engine(Cricket.newMatch());
  e.setTeam({ key: 'A', name: 'Lions', players: [{ id: 'a1', name: 'A One' }, { id: 'a2', name: 'A Two' }, { id: 'a3', name: 'A Three' }] });
  e.setTeam({ key: 'B', name: 'Titans', players: [{ id: 'b1', name: 'B One' }, { id: 'b2', name: 'B Two' }] });
  e.startInnings('A'); e.setStriker('a1'); e.setNonStriker('a2'); e.setBowler('b1');
  e.addBall({ runs: 6, boundary: true }); e.addBall({ runs: 0, wicket: { kind: 'bowled' } });
  r = Scoring.summary({ kind: 'cricket', match: e.match });
  assert.deepEqual([r.text, r.a, r.started, r.period], ['6/1 | -', 6, true, 'Innings 1 · 0.2 ov']);
  const cs = Scoring.playerStats([{ status: 'Completed', live: { kind: 'cricket', match: e.match } }]);
  assert.deepEqual([cs.a1.stats.Runs, cs.a1.stats.Sixes, cs.b1.stats.Wickets, cs.a3.matches], [6, 1, 1, 1]);
});

test('schema helpers: club inheritance, rundown times and colours, costing, age', () => {
  const club = { name: 'Toyota Cheetahs', graphicName: 'Cheetahs', abbreviation: 'CHE', primaryColor: '#ffffff', secondaryColor: '#ffa500', image: 'img_1' };
  const r = Schema.resolveSquad({ club: 'c', sport: 'Rugby', ageGroup: '19A', primaryColor: '#000000' }, club);
  assert.deepEqual([r.name, r.graphicName, r.abbreviation, r.primaryColor, r.secondaryColor, r.image], ['Toyota Cheetahs', 'Cheetahs', 'CHE', '#000000', '#ffa500', 'img_1']);
  const rows = Schema.rundownTimes([{ content: 'Intro sting', startTime: '15:55:00', duration: '00:00:30' }, { content: 'Hello and welcome', duration: '1:00' }, { content: '1st half', startTime: '16:00', duration: '46:00', color: '#ffff00' }, { content: 'Half time', duration: '00:30' }], '');
  assert.deepEqual(rows.map((x) => x.startText), ['15:55:00', '15:55:30', '16:00:00', '16:46:00']);
  assert.equal(rows[2].color, '#ffff00');
  assert.ok(Schema.ENTITIES.fixture.fields.find((f) => f.k === 'rundown').fields.some((f) => f.k === 'color'));
  const get = (id) => ({ r1: { name: 'Director', rate: 2000, invoiceRate: 2500 }, r2: { name: 'Camera', rate: 1500, invoiceRate: 2000 }, e1: { name: 'Camera chain', rate: 500, invoiceRate: 1200 } })[id];
  const c = Schema.costing({ days: 2, crew: [{ role: 'r1' }, { role: 'r2' }, { role: 'r2' }], equipment: [{ item: 'e1', quantity: 3 }], extras: [{ description: 'Travel', cost: 800, invoice: 1000 }] }, get);
  assert.deepEqual([c.cost, c.invoice, c.profit], [13800, 21200, 7400]);
  assert.equal(Schema.age('2001-02-25', '2026-10-05'), 25);
  for (const k of ['event', 'remoteStudio', 'contacts', 'hospitals', 'txTime']) assert.ok(Schema.ENTITIES.production.fields.some((f) => f.k === k), k);
});
