'use strict';
// Fans follow teams and clubs: the list of teams, a team's page, following with alert choices, and match updates
// (line-ups, kick-off, scores, half time, full time, red cards) to the inbox and to the browser (Web Push, encrypted).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const Sports = require('../shared/sports');
const { encrypt, decrypt, b64u } = require('../lib/webpush');

test('web push: the message is encrypted for the browser (aes128gcm) and readable with its keys', () => {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: 'https://push.example/x', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };
  const body = encrypt(sub, JSON.stringify({ title: 'Try – Alpha' }));
  assert.equal(body.readUInt32BE(16), 4096); assert.equal(body[20], 65);
  assert.deepEqual(JSON.parse(decrypt(body, ua, auth)), { title: 'Try – Alpha' });
});

test('following teams and clubs: pages, alerts and match updates', async (t) => {
  const sent = [];
  const webFetch = async (url, opts) => { sent.push({ url, opts }); return { status: 201 }; };
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', push: { webFetch, alertDelayMs: 5 }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Org' })).data.id;
  const put = async (type, id, data) => { const x = await admin.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(x.status, 200, type + ' ' + JSON.stringify(x.data)); return x.data.doc; };
  await put('club', 'club_a', { name: 'Alpha', primaryColor: '#ff6600' });
  await put('club', 'club_b', { name: 'Beta', primaryColor: '#003399' });
  await put('squad', 'squad_a', { club: 'club_a', sport: 'Rugby', ageGroup: 'U19' });
  await put('squad', 'squad_b', { club: 'club_b', sport: 'Rugby', ageGroup: 'U19' });
  await put('fixture', 'fixture_1', { sport: 'Rugby', team1: 'squad_a', team2: 'squad_b', startDate: new Date().toISOString().slice(0, 10), startTime: '15:00' });

  // nothing to follow until the team shows its matches on the website
  assert.deepEqual((await client(app.url).get('/api/public/teams')).data, { clubs: [], teams: [] });
  const org = await app.store.get(team);
  await app.save(team, 'org', team, { ...org.data, publicMatches: true });
  const cat = (await client(app.url).get('/api/public/teams')).data;
  assert.deepEqual(cat.clubs.map((c) => c.name), ['Alpha', 'Beta']);
  assert.deepEqual(cat.teams.map((x) => [x.id, x.name, x.clubName]), [['squad_a', 'Alpha U19', 'Alpha'], ['squad_b', 'Beta U19', 'Beta']]);

  // a fan: signs in, turns on browser notifications, follows the Alpha club (every alert) and Beta U19 (scores off)
  const fan = client(app.url);
  assert.equal((await fan.post('/api/public/follow', { id: 'club_a' })).status, 401, 'sign in first');
  await fan.post('/api/auth/signup', { name: 'Fan', email: 'fan@example.com', password: 'correct horse' });
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const key = (await fan.get('/api/push/web-key')).data.key;
  assert.equal(Buffer.from(key.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length, 65, 'the VAPID public key');
  const reg = await fan.post('/api/push/register', { platform: 'web', name: 'Chrome on Android', subscription: { endpoint: 'https://push.example/sub1', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } } });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.equal((await fan.post('/api/public/follow', { id: 'club_a' })).status, 200);
  await fan.post('/api/public/follow', { id: 'squad_b', alerts: { scores: false } });
  assert.equal((await fan.post('/api/public/follow', { id: 'nope' })).status, 404);
  const mine = (await fan.get('/api/public/follows')).data.list;
  assert.deepEqual(mine.map((x) => [x.id, x.alerts.scores]), [['club_a', true], ['squad_b', false]]);
  const page = (await fan.get('/api/public/team/club_a')).data;
  assert.equal(page.following, true); assert.equal(page.followers, 1);
  assert.deepEqual(page.teams.map((x) => x.id), ['squad_a']);
  assert.equal(page.matches.upcoming.length, 1, 'the club page lists its teams\' matches');
  assert.equal((await client(app.url).get('/match/fixture_1')).status, 200);
  assert.equal((await client(app.url).get('/team/club_a')).status, 200);

  // the scorer works the match (on the production PC; it reaches the website through sync)
  const su = Sports.newSetup('rugby');
  su.teams.A.name = 'Alpha'; su.teams.B.name = 'Beta';
  su.teams.A.players = [{ id: 'a1', name: 'Ann One', tvName: 'ANN ONE', number: '1', lineup: 'start' }];
  su.teams.B.players = [{ id: 'b1', name: 'Bob One', tvName: 'BOB ONE', number: '1', lineup: 'start' }];
  const events = [];
  const score = async (...evs) => {
    events.push(...evs);
    const fx = await app.store.get('fixture_1');
    await app.save(team, 'fixture', 'fixture_1', { ...fx.data, live: { kind: 'sport', sport: 'rugby', setup: su, events: [...events] } });
    await new Promise((r) => setTimeout(r, 20)); await app.follows.idle();
  };
  await score();                                                   // the scorer opens it: line-ups out
  await score({ id: '1', type: 'status', key: 'kickoff', ct: "0'" });
  await score({ id: '2', type: 'score', key: 'try', team: 'A', player: 'a1', ct: "12'" });
  await score({ id: '3', type: 'card', key: 'red', team: 'B', player: 'b1', ct: "20'" });
  await score({ id: '4', type: 'status', key: 'periodEnd', ct: "40'" });
  await score({ id: '5', type: 'period', to: 2 }, { id: '6', type: 'status', key: 'kickoff', ct: "40'" });
  await score({ id: '7', type: 'end', ct: "80'" });

  const inbox = (await fan.get('/api/notifications')).data.list.map((n) => n.title).reverse();
  assert.deepEqual(inbox.map((x) => x.replace(/:.*/, '')), ['Line-ups', 'Kick-off', 'Try – Alpha', 'Red Card – Beta', 'Half Time', 'Back under way', 'Full time'], inbox.join(' | '));
  assert.ok(inbox.includes('Half Time: Alpha 5 – 0 Beta'), inbox.join(' | '));
  // pushed to the browser, encrypted for it, opening the match page
  assert.equal(sent.length, inbox.length);
  const last = sent[sent.length - 1];
  assert.equal(last.url, 'https://push.example/sub1');
  assert.match(last.opts.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{80,}$/);
  const msg = JSON.parse(decrypt(last.opts.body, ua, auth));
  assert.equal(msg.title, 'Full time: Alpha 5 – 0 Beta'); assert.equal(msg.url, 'https://site.example/match/fixture_1');

  // the try reached the fan through the club (scores on), not through Beta U19 (scores off); and a gone browser is forgotten
  await fan.post('/api/public/follow', { id: 'club_a', follow: false });
  sent.length = 0;
  await score({ id: '8', type: 'score', key: 'pen', team: 'B', ct: "81'" });
  assert.equal(sent.length, 0, 'Beta U19: scores are off');
  const devs = (await fan.get('/api/push/prefs')).data.devices;
  assert.deepEqual(devs.map((d) => d.platform), ['web']);
});
