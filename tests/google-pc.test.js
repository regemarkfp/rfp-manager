'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { boot, client, until } = require('./helpers');
const fakeMongo = require('./fake-mongo');

// Google sign-in on a production PC: the PC uses the website's Google client, links itself to the website as the
// Admin who signs in, and later lets anyone in the synced teams sign in with Google too.
test('Google sign-in on a production PC links it to the website and syncs', async (t) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const certs = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise((r) => certs.listen(0, '127.0.0.1', r));
  t.after(() => certs.close());
  const certsUrl = `http://127.0.0.1:${certs.address().port}/`;
  const google = (email, name = email.split('@')[0]) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: 'site-client', exp: Math.floor(Date.now() / 1000) + 600, email, email_verified: true, name, sub: 'g-' + email });
    return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url');
  };

  // the website: Ruan signs in with Google and has a team with a crew member
  const cloud = await boot({ mode: 'cloud', google: { clientId: 'site-client', certsUrl }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  assert.equal((await web.post('/api/auth/google', { credential: google('ruan@example.com', 'Ruan') })).status, 200);
  const team = (await web.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  assert.equal((await web.put(`/api/docs/venue/venue_main?team=${team}`, { data: { name: 'Main Field' } })).status, 200);
  assert.equal((await web.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Crew' })).status, 200);
  const crewWeb = client(cloud.url);
  assert.equal((await crewWeb.post('/api/auth/google', { credential: google('crew@example.com') })).status, 200);

  // a new production PC: it learns the website's Google client by itself
  const pc = await boot({ defaultCloudUrl: cloud.url, google: { clientId: '', certsUrl }, syncSeconds: 2, machineName: 'OB truck' });
  t.after(() => pc.stop());
  const local = client(pc.url);
  await until(async () => (await local.get('/api/config')).data.googleClientId === 'site-client', 8000, 'the PC to learn the Google client');
  assert.equal((await local.get('/api/config')).data.needsSetup, true);

  // someone unknown, and someone who is not an Admin, cannot link the PC
  const nobody = await local.post('/api/auth/google', { credential: google('nobody@example.com') });
  assert.equal(nobody.status, 403, JSON.stringify(nobody.data));
  const crewFirst = await local.post('/api/auth/google', { credential: google('crew@example.com') });
  assert.equal(crewFirst.status, 403);
  assert.match(crewFirst.data.error, /not an Admin/);
  assert.equal(pc.sync.linked(), false);

  // the Admin signs in with Google on the PC: it links, the team comes down, and they are signed in
  const ok = await local.post('/api/auth/google', { credential: google('ruan@example.com', 'Ruan') });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(pc.sync.linked(), true);
  assert.equal(pc.config.cloud.url, cloud.url);
  const me = (await local.get('/api/me')).data;
  assert.deepEqual(me.teams.map((x) => [x.name, x.role]), [['RegemarkFP', 'Admin']]);
  assert.ok((await local.get('/api/docs?team=' + team)).data.docs.some((d) => d.id === 'venue_main'));
  assert.deepEqual((await web.get('/api/keys')).data.keys.map((k) => k.name), ['OB truck']);

  // the crew member now signs in with Google on the PC as well
  const crew = client(pc.url);
  assert.equal((await crew.post('/api/auth/google', { credential: google('crew@example.com') })).status, 200);
  assert.equal((await crew.get('/api/me')).data.teams[0].role, 'Crew');

  // someone added on the website a moment ago: the PC asks the website first, then lets them in
  assert.equal((await web.post('/api/members?team=' + team, { email: 'new@example.com', role: 'Scorer' })).status, 200);
  const fresh = client(pc.url);
  const r = await fresh.post('/api/auth/google', { credential: google('new@example.com') });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await fresh.get('/api/me')).data.teams[0].role, 'Scorer');

  // work done on the PC goes up to the website
  assert.equal((await local.put(`/api/docs/venue/venue_pc?team=${team}`, { data: { name: 'Back Field' } })).status, 200);
  await until(async () => (await web.get('/api/docs?team=' + team)).data.docs.some((d) => d.id === 'venue_pc'), 8000, 'the PC\'s change on the website');
});
