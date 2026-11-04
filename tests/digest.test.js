'use strict';
// How often fans hear about their teams (scores only when the lead changes, digest only, a muted match, a pause), the
// score digest (when it is due in the fan's time zone, what is in it), and each person's verse of the day.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const Sports = require('../shared/sports');
const { cleanPrefs } = require('../lib/follows');

test('digest timing: the fan\'s time and day, once a day', async (t) => {
  const app = await boot({});
  t.after(() => app.stop());
  const f = app.follows;
  const at = (iso) => new Date(iso);
  const p = cleanPrefs({ digest: 'daily', time: '19:00', tz: 'Africa/Johannesburg' });
  assert.equal(f.due(p, null, at('2026-11-04T16:59:00Z')), false, '18:59 in Johannesburg');
  assert.equal(f.due(p, null, at('2026-11-04T17:00:00Z')).day, '2026-11-04');
  assert.equal(f.due(p, { day: '2026-11-04' }, at('2026-11-04T20:00:00Z')), false, 'already sent today');
  const w = cleanPrefs({ digest: 'weekly', day: 1, time: '08:00', tz: 'Europe/London' });
  assert.equal(f.due(w, null, at('2026-11-09T08:30:00Z')).day, '2026-11-09', 'a Monday');
  assert.equal(f.due(w, null, at('2026-11-10T08:30:00Z')), false, 'a Tuesday');
  assert.equal(cleanPrefs({ digest: 'hourly', time: '7pm', tz: 'Mars/Base' }).digest, 'off');
  assert.equal(cleanPrefs({ tz: 'Mars/Base' }).tz, '');
});

test('how often: lead changes only, digest only, muted match, pause; the digest; the verse of the day per person', async (t) => {
  const sent = [];
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', verse: false, push: { webFetch: async (url, opts) => { sent.push({ url, opts }); return { status: 201 }; }, alertDelayMs: 5 },
    mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Org' })).data.id;
  const put = async (type, id, data) => { const x = await admin.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(x.status, 200, type + ' ' + JSON.stringify(x.data)); };
  await put('club', 'club_a', { name: 'Alpha' }); await put('club', 'club_b', { name: 'Beta' });
  await put('squad', 'squad_a', { club: 'club_a', sport: 'Rugby' }); await put('squad', 'squad_b', { club: 'club_b', sport: 'Rugby' });
  const today = new Date().toISOString().slice(0, 10);
  await put('fixture', 'fixture_1', { sport: 'Rugby', team1: 'squad_a', team2: 'squad_b', startDate: today });
  await put('fixture', 'fixture_2', { sport: 'Rugby', team1: 'squad_b', team2: 'squad_a', startDate: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10), startTime: '15:00' });
  const org = await app.store.get(team); await app.save(team, 'org', team, { ...org.data, publicMatches: true });

  const fan = async (email) => { const c = client(app.url); await c.post('/api/auth/signup', { name: 'Fan', email, password: 'correct horse' }); return c; };
  const lead = await fan('lead@example.com'), quiet = await fan('quiet@example.com'), muter = await fan('mute@example.com');
  await lead.post('/api/public/follow', { id: 'squad_a', scoreRate: 'lead' });
  await quiet.post('/api/public/follow', { id: 'club_b', live: false });                      // only in the digest
  await muter.post('/api/public/follow', { id: 'squad_a' });
  assert.equal((await muter.post('/api/public/mute', { fixture: 'fixture_1' })).data.muted, true);
  const fl = (await lead.get('/api/public/follows')).data;
  assert.equal(fl.list[0].scoreRate, 'lead'); assert.equal(fl.prefs.digest, 'off'); assert.ok(fl.scoreRates.length >= 4 && fl.digests.length === 4);

  const su = Sports.newSetup('rugby'); su.teams.A.name = 'Alpha'; su.teams.B.name = 'Beta';
  const events = [];
  const score = async (...evs) => { events.push(...evs); const fx = await app.store.get('fixture_1'); await app.save(team, 'fixture', 'fixture_1', { ...fx.data, live: { kind: 'sport', sport: 'rugby', setup: su, events: [...events] } }); await new Promise((r) => setTimeout(r, 20)); await app.follows.idle(); };
  const inbox = async (c) => (await c.get('/api/notifications')).data.list.map((n) => n.title).reverse();
  await score();
  await score({ id: '1', type: 'status', key: 'kickoff' });
  await score({ id: '2', type: 'score', key: 'try', team: 'A' });          // Alpha lead: told
  await score({ id: '3', type: 'score', key: 'conv', team: 'A' });         // still Alpha: not told
  await score({ id: '4', type: 'score', key: 'try', team: 'B' });          // 7-5, still Alpha: not told
  await score({ id: '5', type: 'score', key: 'pen', team: 'B' });          // Beta lead: told
  assert.deepEqual((await inbox(lead)).filter((x) => !/^Kick-off/.test(x)), ['Try – Alpha', 'Penalty – Beta']);
  assert.deepEqual(await inbox(quiet), [], 'digest only: nothing live');
  assert.deepEqual(await inbox(muter), [], 'muted match');
  // a pause stops live updates too
  await lead.put('/api/public/follow-prefs', { pausedUntil: Date.now() + 3600e3 });
  await score({ id: '6', type: 'score', key: 'try', team: 'A' });
  assert.equal((await inbox(lead)).length, 3, 'paused');
  await score({ id: '7', type: 'end' });

  // the digest: the result and the coming fixture of the fan's club, by notification and email
  const r = await quiet.put('/api/public/follow-prefs', { digest: 'daily', time: '00:00', tz: 'Africa/Johannesburg', email: true });
  assert.equal(r.data.prefs.digest, 'daily');
  await app.follows.digestTick();
  const dg = (await quiet.get('/api/notifications')).data.list.find((n) => /Your teams/.test(n.title));
  assert.ok(dg, 'digest in the inbox'); assert.match(dg.body, /Results: Alpha 12 – 8 Beta/); assert.match(dg.body, /Coming up: Beta v Alpha/);
  assert.ok(app.mail.outbox.some((m) => m.to.includes('quiet@example.com') && /Your teams/.test(m.subject)), 'by email');
  await app.follows.digestTick();
  assert.equal((await quiet.get('/api/notifications')).data.list.filter((n) => /Your teams/.test(n.title)).length, 1, 'once a day');
  assert.equal((await quiet.post('/api/public/digest/now', {})).data.sent, true);

  // the verse of the day: a translation and turn-over time per person; the day comes from their computer
  const me = (await quiet.get('/api/me')).data.user;
  assert.deepEqual(me.versePrefs, { on: true, translation: '', time: '00:00' });
  await quiet.post('/api/me', { versePrefs: { on: true, translation: 'api:web', time: '05:30' } });
  assert.deepEqual((await quiet.get('/api/me')).data.user.versePrefs, { on: true, translation: 'api:web', time: '05:30' });
  await quiet.post('/api/me', { versePrefs: { on: false, translation: 'nonsense', time: '25:00' } });
  assert.deepEqual((await quiet.get('/api/me')).data.user.versePrefs, { on: false, translation: '', time: '00:00' });
  const tl = (await quiet.get('/api/verse/translations')).data.list;
  assert.ok(tl.some((x) => x.id === 'api:kjv' && x.language === 'English'));
  const d1 = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  const v = (await quiet.get(`/api/verse?date=${d1}&t=api:web`)).data;
  assert.equal(v.date, d1, 'the person\'s own day');
  assert.equal(v.ref, app.verse.pick(d1));
  assert.equal((await quiet.get('/api/verse?date=1999-01-01')).data.date, new Date().toISOString().slice(0, 10), 'a day far off is not taken');
});
