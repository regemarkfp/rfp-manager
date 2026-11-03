'use strict';
// LIGR-style data and scoring: competition match settings, club colours and graphic names, player graphic names and
// line-ups, and the tap scorer's match phases (players entering → start → end of period → next period → full time).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until, liveClient } = require('./helpers');
const Sports = require('../shared/sports');
const Schema = require('../shared/schema');

test('match settings: the match overrides its competition', () => {
  const comp = { periodLength: 35, sinbinMin: 7, red20: true, statCoverage: 'Minimum', lineupSize: 15 };
  assert.deepEqual(Schema.matchSettings({}, comp), { periodLength: 35, sinbinMin: 7, lineupSize: 15, red20: true, statCoverage: 'Minimum', playerEvents: 'All' });
  const m = Schema.matchSettings({ periodLength: '40', red20: 'No', statCoverage: 'Standard' }, comp);
  assert.equal(m.periodLength, 40); assert.equal(m.red20, false); assert.equal(m.statCoverage, 'Standard'); assert.equal(m.sinbinMin, 7);
  assert.ok(Schema.ENTITIES.club.fields.some((f) => f.k === 'primaryTextColor'));
  assert.ok(Schema.ENTITIES.squad.fields.find((f) => f.k === 'players').fields.some((f) => f.k === 'starter'));
});

test('match phases, on-field count and the 20-minute red card setting', () => {
  const su = Sports.newSetup('rugby');
  su.teams.A.players = [{ id: 'a1', name: 'Ann One', number: '1', lineup: 'start' }, { id: 'a2', name: 'Ann Two', number: '2', lineup: 'start' }, { id: 'a16', name: 'Ann Sub', number: '16', lineup: 'bench' }];
  const ev = [];
  const add = (e) => { ev.push(Object.assign({ id: String(ev.length + 1) }, e)); return Sports.compute(su, ev); };
  let v = add({ type: 'status', key: 'entering' });
  assert.equal(v.extra.phase, 'pre');
  v = add({ type: 'status', key: 'kickoff' });
  assert.equal(v.extra.phase, 'live');
  v = add({ type: 'score', key: 'try', team: 'A', player: 'a1' });
  v = add({ type: 'sub', team: 'A', off: 'a1', on: 'a16' });
  assert.deepEqual(v.extra.onField.A.sort(), ['a16', 'a2']);
  assert.equal(v.extra.onFieldCount.B, 15, 'no line-up: the line-up size');
  v = add({ type: 'card', key: 'red', team: 'B' });
  assert.equal(v.extra.onFieldCount.B, 14);
  v = add({ type: 'status', key: 'periodEnd' });
  assert.equal(v.extra.phase, 'break'); assert.equal(v.periodLabel, 'HALF TIME'); assert.equal(v.flat.match_phase, 'HALF TIME');
  v = add({ type: 'period', to: 2 }); v = add({ type: 'status', key: 'kickoff' });
  assert.equal(v.extra.phase, 'live'); assert.equal(v.periodLabel, 'SECOND HALF');
  v = add({ type: 'end' });
  assert.equal(v.extra.phase, 'final');
  assert.deepEqual(v.timeline.filter((t) => t.kind === 'status').map((t) => t.text), ['PLAYERS ENTERING', 'FIRST HALF STARTED', 'FIRST HALF FINISHED', 'SECOND HALF STARTED']);
  assert.ok(Sports.cards('rugby').some((c) => c.key === 'red20'));
  assert.ok(!Sports.cards('rugby', { red20: false }).some((c) => c.key === 'red20'));
  su.options.dropPts = 2;
  assert.equal(Sports.compute(su, [{ id: 'd', type: 'score', key: 'drop', team: 'A' }]).score.A, '2', 'field goal points from the competition');
});

test('the scorer takes competition settings, club colours, graphic names and starters from the database', async (t) => {
  const app = await boot({});
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  const put = async (type, id, data) => { const x = await c.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(x.status, 200, type + ' ' + JSON.stringify(x.data)); return x; };
  await put('venue', 'venue_home', { name: 'Home Park', graphicName: 'HOME PARK', city: 'Bloemfontein' });
  await put('club', 'club_a', { name: 'Alpha', graphicName: 'Alpha RFC', abbreviation: 'ALP', primaryColor: '#ff6600', primaryTextColor: '#000000', defaultVenue: 'venue_home' });
  await put('club', 'club_b', { name: 'Beta', abbreviation: 'BET', primaryColor: '#003399' });
  await put('player', 'player_1', { name: 'Sam', surname: 'Example', graphicFirstName: 'S.', graphicLastName: 'Example' });
  await put('player', 'player_2', { name: 'Lee', surname: 'Sample' });
  await put('squad', 'squad_a', { club: 'club_a', sport: 'Rugby', ageGroup: 'Adults', gender: 'Male', players: [{ player: 'player_1', number: '15', position: 'Fullback', positionType: 'Back', starter: true }, { player: 'player_2', number: '22', position: 'Centre', starter: false }] });
  await put('squad', 'squad_b', { club: 'club_b', sport: 'Rugby' });
  await put('competition', 'competition_1', { name: 'Test Cup', sport: 'Rugby', periodLength: 35, sinbinMin: 7, red20: false, statCoverage: 'Minimum', playerEvents: 'Scoring only' });
  const r = await put('fixture', 'fixture_r', { sport: 'Rugby', competition: 'competition_1', team1: 'squad_a', team2: 'squad_b', startDate: '2026-11-10' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ctl = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_r', role: 'control' });
  t.after(() => ctl.close());
  await ctl.send('rfp', 'onAir', { fixtureId: 'fixture_r' });
  const sc = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_r', role: 'sport' });
  t.after(() => sc.close());
  await until(() => sc.state && sc.state.sport && sc.state.sport.setup && sc.state.sport.setup.sport === 'rugby', 3000, 'rugby setup');
  const su = sc.state.sport.setup;
  assert.equal(su.options.periodMin, 35); assert.equal(su.options.sinbinMin, 7); assert.equal(su.options.red20, false);
  assert.equal(su.options.coverage, 'minimum'); assert.equal(su.options.playerEvents, 'scoring');
  assert.equal(su.venue, 'Home Park, Bloemfontein', 'no venue on the match: the home club\'s ground');
  assert.equal(su.teams.A.color1, '#ff6600'); assert.equal(su.teams.A.text1, '#000000'); assert.equal(su.teams.A.short, 'ALP');
  const [p1, p2] = su.teams.A.players;
  assert.deepEqual([p1.tvName, p1.lineup, p1.positionType, p2.lineup], ['S. EXAMPLE', 'start', 'Back', 'bench']);
  const v = Sports.compute(su, []);
  assert.deepEqual(v.extra.onField.A, ['player_1']);
});
