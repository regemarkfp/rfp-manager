'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('production team names are unique; two teams merge into one and linked PCs follow', async (t) => {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  await web.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const a = (await web.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const dup = await web.post('/api/orgs', { name: '  regemarkfp ' });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /already a production team called "RegemarkFP"/);
  const b = (await web.post('/api/orgs', { name: 'RegemarkFP PC' })).data.id;
  assert.equal((await web.put(`/api/docs/org/${b}?team=${b}`, { data: { name: 'REGEMARKFP' } })).status, 409, 'no renaming onto another team');
  assert.equal((await web.put(`/api/docs/org/${a}?team=${a}`, { data: { name: 'RegemarkFP', currency: 'ZAR' } })).status, 200, 'saving a team under its own name is fine');

  await web.put(`/api/docs/competition/comp_web?team=${a}`, { data: { name: 'BETWAY SA20' } });
  await web.put(`/api/docs/competition/comp_pc?team=${b}`, { data: { name: 'Test' } });
  const other = client(cloud.url);
  await other.post('/api/auth/signup', { name: 'Crew', email: 'crew@example.com', password: 'correct horse' });
  await web.post('/api/members?team=' + b, { email: 'crew@example.com', role: 'Crew' });

  // a production PC that holds both teams
  const key = (await web.post('/api/keys', { name: 'OB truck' })).data.key;
  const pc = await boot({ syncSeconds: 1 });
  t.after(() => pc.stop());
  assert.equal((await client(pc.url).post('/api/setup/link', { url: cloud.url, key })).status, 200);
  assert.ok((await pc.store.get('comp_pc')) && (await pc.store.get(b)));

  // only an Admin of both
  assert.equal((await other.post(`/api/orgs/${a}/merge`, { from: b })).status, 403);
  const m = await web.post(`/api/orgs/${a}/merge`, { from: b });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  assert.equal(m.data.moved, 1);
  const me = (await web.get('/api/me')).data;
  assert.deepEqual(me.teams.map((x) => x.name), ['RegemarkFP']);
  const docs = (await web.get('/api/docs?team=' + a)).data.docs;
  assert.deepEqual(docs.filter((d) => d.type === 'competition').map((d) => d.data.name).sort(), ['BETWAY SA20', 'Test']);
  assert.ok(docs.some((d) => d.type === 'member' && d.data.email === 'crew@example.com'), 'members come along');
  assert.deepEqual((await other.get('/api/me')).data.teams.map((x) => x.name), ['RegemarkFP']);
  // the PC follows: one team, with both competitions
  await pc.sync.run();
  await until(async () => (await pc.store.get('comp_pc')).team === a && (await pc.store.get(b)).deleted, 8000, 'the PC to follow the merge');
  const local = await pc.auth.teamsFor(await pc.auth.userByEmail('ruan@example.com'));
  assert.deepEqual(local.map((x) => x.org.name), ['RegemarkFP']);
  // and the old team does not come back from the PC
  await pc.sync.run();
  assert.ok((await cloud.store.get(b)).deleted);
});
