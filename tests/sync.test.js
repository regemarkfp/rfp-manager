'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, client, until, sleep, seed, liveClient, PNG } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const Scoring = require('../shared/scoring');

// The online site runs on the MongoDB store (in-memory stand-in), the production PCs on SQLite.
async function world(t, n) {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  assert.equal((await web.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' })).status, 200);
  const team = (await web.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const key = (await web.post('/api/keys', { name: 'OB truck' })).data.key;
  return { cloud, web, team, key, n };
}
async function machine(t, cloud, key) {
  const pc = await boot({ syncSeconds: 2 });
  t.after(() => pc.stop());
  const c = client(pc.url);
  const link = await c.post('/api/setup/link', { url: cloud.url, key });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  assert.equal(link.data.error, '');
  return { pc, c };
}
const docsOf = async (c, team) => (await c.get('/api/docs?team=' + team)).data.docs;

test('a new production PC links to the website and downloads everything, images included', async (t) => {
  const { cloud, web, team, key } = await world(t);
  await seed(web, team);
  const img = (await web.post(`/api/images?team=${team}&name=Cheetahs.png`, PNG, { 'content-type': 'image/png' })).data.doc;
  await web.put(`/api/docs/club/club_che?team=${team}`, { data: { name: 'Toyota Cheetahs', graphicName: 'Cheetahs', abbreviation: 'CHE', image: img.id } });

  assert.equal((await client(cloud.url).post('/api/sync/pull', { since: 0 }, { authorization: 'Bearer mk_' + 'x'.repeat(30) })).status, 401);
  const { pc, c } = await machine(t, cloud, key);
  // The account came down with the data, so the same person can sign in at the venue without internet.
  assert.equal((await c.post('/api/auth/login', { email: 'ruan@example.com', password: 'correct horse' })).status, 200);
  const local = await docsOf(c, team);
  assert.equal(local.find((d) => d.id === 'fixture_one').data.autoName, 'Cheetahs vs Bulls (19A)');
  assert.equal(local.find((d) => d.id === 'club_che').data.image, img.id);
  assert.ok(fs.readFileSync(path.join(pc.mediaFolder(), img.data.file)).equals(PNG), 'image file is in this machine\'s folder');
  assert.equal(pc.sync.status().pending, 0);

  // Changes made online arrive on their own (pushed over the live link, no waiting for the timer).
  await web.put(`/api/docs/venue/venue_oval?team=${team}`, { data: { name: 'Mangaung Oval', city: 'Bloemfontein' } });
  await until(async () => (await docsOf(c, team)).some((d) => d.id === 'venue_oval'), 1500, 'online change to reach the PC');

  // Changes and images made at the venue go up.
  const up = (await c.post(`/api/images?team=${team}&name=Sponsor.png`, PNG, { 'content-type': 'image/png' })).data.doc;
  await c.put(`/api/docs/advert/advert_one?team=${team}`, { data: { name: 'Sponsor board', sponsor: 'Acme', image: up.id, duration: 5 } });
  await until(async () => (await docsOf(web, team)).some((d) => d.id === 'advert_one'), 3000, 'local change to reach the website');
  assert.ok((await web.get('/media/' + up.id)).data.equals(PNG));

  // Deleting syncs too.
  await c.del(`/api/docs/venue/venue_oval?team=${team}`);
  await until(async () => !(await docsOf(web, team)).some((d) => d.id === 'venue_oval'), 3000, 'delete to reach the website');

  // A second machine gets its own copy of every image in its own folder.
  const second = await machine(t, cloud, key);
  assert.ok(fs.existsSync(path.join(second.pc.mediaFolder(), up.data.file)));
  assert.ok(fs.existsSync(path.join(second.pc.mediaFolder(), img.data.file)));
  assert.notEqual(second.pc.mediaFolder(), pc.mediaFolder());
  // Pointing a machine at a new empty folder fetches the images again.
  await second.c.post('/api/auth/login', { email: 'ruan@example.com', password: 'correct horse' });
  const fresh = path.join(second.pc.tmpDir, 'logos');
  const moved = await second.c.put('/api/machine', { mediaFolder: fresh });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  fs.rmSync(path.join(fresh, img.data.file));
  assert.deepEqual((await second.c.post('/api/machine/sync')).data.media, { downloaded: 1, missing: 0 });
  assert.ok(fs.existsSync(path.join(fresh, img.data.file)));
});

test('a match scored at the venue reaches the website; newest change wins', async (t) => {
  const { cloud, web, team, key } = await world(t);
  await seed(web, team);
  const { pc, c } = await machine(t, cloud, key);
  await c.post('/api/auth/login', { email: 'ruan@example.com', password: 'correct horse' });
  await until(async () => (await docsOf(c, team)).some((d) => d.id === 'fixture_one'), 4000, 'fixture to reach the PC');
  const sc = await liveClient(pc, { cookie: c.cookie(), fixture: 'fixture_one' });
  t.after(() => sc.close());
  const apply = (events) => sc.send('sport', 'apply', { version: sc.state.sport.version, setup: sc.state.sport.setup, events });
  const e1 = { id: 'e1', type: 'score', key: 'try', team: 'A', gt: 60000 }, e2 = { id: 'e2', type: 'score', key: 'conv', team: 'A', gt: 90000 };
  await apply([e1]);
  const fx = async (cl) => (await docsOf(cl, team)).find((d) => d.id === 'fixture_one').data;
  await until(async () => ((await fx(web)).result || {}).text === '5 – 0', 5000, 'the try to reach the website');
  // Off line at the venue: scoring carries on and catches up when the line is back.
  pc.sync.stop();
  await apply([e1, e2]);
  assert.equal((await fx(web)).result.text, '5 – 0');
  pc.sync.start();
  await until(async () => ((await fx(web)).result || {}).text === '7 – 0', 5000, 'the conversion to reach the website');
  await until(async () => pc.sync.status().pending === 0, 3000, 'nothing left to upload');
  assert.deepEqual((await fx(web)).live.events.map((e) => e.id), ['e1', 'e2']);
  assert.equal(Scoring.summary((await fx(web)).live).text, '7 – 0');
});

test('a team created offline at the venue is claimed online on first link; other teams stay private', async (t) => {
  const { cloud, web, team, key } = await world(t);
  // Another company on the same website.
  const other = client(cloud.url);
  await other.post('/api/auth/signup', { name: 'Other', email: 'other@example.com', password: 'correct horse' });
  const otherTeam = (await other.post('/api/orgs', { name: 'Other Productions' })).data.id;
  await other.put(`/api/docs/venue/venue_secret?team=${otherTeam}`, { data: { name: 'Secret Venue' } });

  const pc = await boot({ syncSeconds: 2 });
  t.after(() => pc.stop());
  const c = client(pc.url);
  await c.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'local pass 1' });
  const offline = (await c.post('/api/orgs', { name: 'Offline Team' })).data.id;
  const img = (await c.post(`/api/images?team=${offline}&name=Logo.png`, PNG, { 'content-type': 'image/png' })).data.doc;
  await c.put(`/api/docs/venue/venue_local?team=${offline}`, { data: { name: 'Church Hall', image: img.id } });
  const linked = await c.put('/api/machine', { cloud: { url: cloud.url, key } });
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  await until(async () => (await web.get('/api/me')).data.teams.some((x) => x.id === offline), 4000, 'offline team to appear online');
  await until(async () => (await web.get('/media/' + img.id)).status === 200, 4000, 'offline image to upload');
  assert.ok((await docsOf(web, offline)).some((d) => d.id === 'venue_local'));
  // The machine only ever receives teams its key owner administers.
  const ids = (await pc.store.listAll()).map((d) => d.team);
  assert.ok(ids.includes(team) && ids.includes(offline));
  assert.ok(!ids.includes(otherTeam));
  // A machine cannot write into someone else's team or overwrite accounts.
  const push = await client(cloud.url).post('/api/sync/push', { docs: [
    { id: 'venue_secret', team: otherTeam, type: 'venue', data: { name: 'Defaced' }, updatedAt: Date.now() + 5000 },
    { id: (await cloud.auth.userByEmail('other@example.com')).id, team: '', type: 'user', data: { email: 'other@example.com', passwordHash: 'x' }, updatedAt: Date.now() + 5000 },
  ] }, { authorization: 'Bearer ' + key });
  assert.deepEqual(Object.values(push.data.results), ['rejected', 'skipped']);
  assert.equal((await docsOf(other, otherTeam)).find((d) => d.id === 'venue_secret').data.name, 'Secret Venue');
  // The local password still works after the account synced with the website copy.
  assert.equal((await client(pc.url).post('/api/auth/login', { email: 'ruan@example.com', password: 'local pass 1' })).status, 200);
});
