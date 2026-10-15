'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until } = require('./helpers');
const fakeMongo = require('./fake-mongo');

// The production PC: signing in with the website account (email + password) is all it takes.
test('PC sign-in with the website account connects the PC, and team members sign in after', async (t) => {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  assert.equal((await web.post('/api/auth/signup', { name: 'Admin A', email: 'admin@example.com', password: 'correct horse' })).status, 200);
  const team = (await web.post('/api/orgs', { name: 'Test Team' })).data.id;
  assert.equal((await web.put(`/api/docs/venue/venue_main?team=${team}`, { data: { name: 'Main Field' } })).status, 200);
  const crewWeb = client(cloud.url);
  await crewWeb.post('/api/auth/signup', { name: 'Crew C', email: 'crew@example.com', password: 'battery staple' });
  await web.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Crew' });
  const later = client(cloud.url);
  await later.post('/api/auth/signup', { name: 'Late L', email: 'late@example.com', password: 'late password' });

  const pc = await boot({ defaultCloudUrl: cloud.url, fallbackCloudUrls: [], syncSeconds: 30, machineName: 'OB truck', standalone: false });
  t.after(() => pc.stop());
  const p1 = client(pc.url);
  assert.equal((await p1.get('/api/config')).data.linked, false);
  // a crew member cannot connect the PC
  const bad = await client(pc.url).post('/api/auth/login', { email: 'crew@example.com', password: 'battery staple' });
  assert.equal(bad.status, 403, JSON.stringify(bad.data));
  assert.match(bad.data.error, /not an Admin/);
  assert.equal((await client(pc.url).post('/api/auth/login', { email: 'admin@example.com', password: 'wrong one' })).status, 401);
  // the Admin signs in: connected, data down, signed in
  const r = await p1.post('/api/auth/login', { email: 'admin@example.com', password: 'correct horse' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await p1.get('/api/config')).data.linked, true);
  const me = (await p1.get('/api/me')).data;
  assert.deepEqual(me.teams.map((x) => [x.name, x.role]), [['Test Team', 'Admin']]);
  assert.ok((await p1.get(`/api/docs?team=${team}`)).data.docs.some((d) => d.id === 'venue_main'), 'the data came down');
  // the crew member now signs in on the PC
  const p2 = client(pc.url);
  assert.equal((await p2.post('/api/auth/login', { email: 'crew@example.com', password: 'battery staple' })).status, 200);
  assert.equal((await p2.get('/api/me')).data.teams[0].role, 'Crew');
  // someone added on the website after the PC connected: the PC asks the website
  await web.post('/api/members?team=' + team, { email: 'late@example.com', role: 'Scorer' });
  const p3 = client(pc.url);
  const l = await p3.post('/api/auth/login', { email: 'late@example.com', password: 'late password' });
  assert.equal(l.status, 200, JSON.stringify(l.data));
  await until(async () => ((await p3.get('/api/me')).data.teams || []).length === 1, 8000, 'the new member to come down');
  assert.equal((await p3.get('/api/me')).data.teams[0].role, 'Scorer');
  // and a stranger with a website account is turned away
  const stranger = client(cloud.url);
  await stranger.post('/api/auth/signup', { name: 'S', email: 'stranger@example.com', password: 'stranger pw' });
  assert.equal((await client(pc.url).post('/api/auth/login', { email: 'stranger@example.com', password: 'stranger pw' })).status, 403);
});
