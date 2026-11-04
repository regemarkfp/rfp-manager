'use strict';
// The public match centre (/api/public/match/:id, /match/<id>, the stats under watch pages) and production numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const Sports = require('../shared/sports');

test('match centre: live rugby stats for the public, hidden matches stay hidden; production numbers', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'http://127.0.0.1', mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  const put = async (type, id, data) => { const x = await c.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(x.status, 200, type + ' ' + JSON.stringify(x.data)); return x.data.doc; };
  await put('competition', 'competition_1', { name: 'Test Cup', sport: 'Rugby' });
  await put('fixture', 'fixture_1', { sport: 'Rugby', name: 'Alpha v Beta', competition: 'competition_1', startDate: '2026-11-10', officials: 'Referee: A Name', commentators: 'B Name' });
  const fx = await app.store.get('fixture_1');
  const su = Sports.newSetup('rugby');
  su.teams.A.name = 'Alpha'; su.teams.B.name = 'Beta';
  su.teams.A.players = [{ id: 'a1', name: 'Ann One', number: '1', lineup: 'start' }, { id: 'a16', name: 'Ann Sub', number: '16', lineup: 'bench' }];
  const events = [{ id: '1', type: 'status', key: 'kickoff', ct: "0'" }, { id: '2', type: 'score', key: 'try', team: 'A', player: 'a1', ct: "12'" }, { id: '3', type: 'card', key: 'yellow', team: 'B', ct: "20'" }];
  await app.save(team, 'fixture', 'fixture_1', { ...fx.data, status: 'Live', live: { kind: 'sport', sport: 'rugby', setup: su, events, clocks: { game: { baseMs: 1200000, startedAt: Date.now(), running: true, direction: 1 } } } });

  // not public yet: neither the team shows matches nor a production streams it
  assert.equal((await client(app.url).get('/api/public/match/fixture_1')).status, 404);
  const org = await app.store.get(team);
  await app.save(team, 'org', team, { ...org.data, publicMatches: true });
  const anon = client(app.url);
  const r = await anon.get('/api/public/match/fixture_1');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const m = r.data;
  assert.equal(m.status, 'Live'); assert.deepEqual(m.score, ['5', '0']);
  assert.equal(m.competition, 'Test Cup');
  assert.ok(m.clock && m.clock.running && m.clock.ms >= 1200000, 'the game clock');
  assert.equal(m.timeline[0].kind, 'card', 'newest first');
  assert.ok(m.timeline.some((e) => e.kind === 'score' && e.team === 'A'));
  assert.ok(m.teamStats.length > 0);
  const ann = m.players.A.find((p) => p.number === '1');
  assert.ok(ann.stats.some(([label, n]) => /tr/i.test(label) && n === 1), JSON.stringify(ann.stats));
  assert.deepEqual(m.officials, ['Referee: A Name']);
  assert.equal(JSON.stringify(m).includes('admin@example.com'), false, 'nobody\'s email');
  // the page itself
  const page = await anon.get('/match/fixture_1');
  assert.equal(page.status, 200); assert.match(page.data.toString(), /matchstats\.js/);

  // production numbers: in order per year, kept when a form sends none, never changed by an edit
  const p1 = await put('production', 'production_a', { name: 'First', date: '2026-11-01' });
  const p2 = await put('production', 'production_b', { name: 'Second', date: '2026-11-02' });
  const p3 = await put('production', 'production_c', { name: 'Next year', date: '2027-01-05' });
  assert.equal(p1.data.number, 'P2026-001'); assert.equal(p2.data.number, 'P2026-002'); assert.equal(p3.data.number, 'P2027-001');
  const again = await put('production', 'production_a', { name: 'First (renamed)', date: '2026-11-01', number: 'P2026-999' });
  assert.equal(again.data.number, 'P2026-001');
  await app.store.put({ ...(await app.store.get('production_b')), data: { name: 'Second', date: '2026-11-02' } });      // an old one without a number
  await app.numberProductions();
  assert.equal((await app.store.get('production_b')).data.number, 'P2026-003', 'a new number, never a reused one');

  // completing a production: ratings and issues in its report
  await put('production', 'production_a', { name: 'First', date: '2026-11-01', status: 'Completed', completedAt: '2026-11-01T20:00:00Z', completedBy: 'Test Admin',
    ratings: { overall: 4, audio: 5, vision: 0 }, ratingNotes: { audio: 'Clean mix' }, reportNotes: 'Good day.',
    incidents: [{ time: '15:20', category: 'Stream', severity: 'Major', text: 'Stream dropped', action: 'Restarted the encoder', resolved: true }, { category: 'Crew', severity: 'Minor', text: 'Late call', resolved: false }] });
  const rep = (await c.get(`/api/productions/production_a/report?team=${team}`)).data;
  assert.equal(rep.status, 'Completed'); assert.equal(rep.number, 'P2026-001');
  assert.deepEqual(rep.ratings.map((x) => [x.key, x.stars]), [['overall', 4], ['audio', 5]]);
  assert.equal(rep.average, 4.5); assert.equal(rep.ratings[1].note, 'Clean mix');
  assert.equal(rep.openIssues, 1); assert.equal(rep.majorIssues, 1);
  const pdf = await c.get(`/api/productions/production_a/report.pdf?team=${team}`);
  assert.equal(pdf.status, 200);
});
