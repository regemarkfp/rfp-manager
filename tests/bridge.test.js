'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { boot, client, until, seed, liveClient } = require('./helpers');
const fakeMongo = require('./fake-mongo');

// The production PC as the CasparCG bridge: records are managed on the website, the PC shows them, scores and plays
// graphics, keeps working on its own copy when the website cannot be reached, and sends everything up afterwards.
test('bridge PC: website manages records, PC scores and plays out, works offline and catches up', async (t) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const certs = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise((r) => certs.listen(0, '127.0.0.1', r));
  t.after(() => certs.close());
  const certsUrl = `http://127.0.0.1:${certs.address().port}/`;
  const google = (email) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: 'site-client', exp: Math.floor(Date.now() / 1000) + 600, email, email_verified: true, name: email.split('@')[0], sub: 'g-' + email });
    return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url');
  };

  const cloud = await boot({ mode: 'cloud', google: { clientId: 'site-client', certsUrl }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  assert.equal((await web.post('/api/auth/google', { credential: google('ruan@example.com') })).status, 200);
  const team = (await web.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await seed(web, team);
  assert.equal((await web.post('/api/members?team=' + team, { email: 'scorer@example.com', role: 'Scorer' })).status, 200);

  // no scoring on the website, with or without a production PC
  const webScorer = await liveClient(cloud, { cookie: web.cookie(), fixture: 'fixture_one', role: 'sport' });
  t.after(() => webScorer.close());
  await until(() => webScorer.state && webScorer.state.sport && webScorer.state.sport.setup, 3000, 'website scorer state');
  await assert.rejects(webScorer.send('sport', 'apply', { version: webScorer.state.sport.version, setup: webScorer.state.sport.setup, events: [] }), /not in a web browser/);
  assert.equal(webScorer.got.find((m) => m.type === 'rfp').canScore, false);
  // the Android app scores on the website
  const appScorer = await liveClient(cloud, { cookie: web.cookie(), fixture: 'fixture_one', role: 'sport', extra: { app: 'android' } });
  t.after(() => appScorer.close());
  await until(() => appScorer.state && appScorer.state.sport && appScorer.state.sport.setup, 3000, 'app scorer state');
  assert.equal(appScorer.got.find((m) => m.type === 'rfp').canScore, true);
  await appScorer.send('sport', 'apply', { version: appScorer.state.sport.version, setup: appScorer.state.sport.setup, events: [] });

  // a bridge PC: cannot be used on its own, links with Google
  const pc = await boot({ standalone: false, defaultCloudUrl: cloud.url, google: { clientId: '', certsUrl }, syncSeconds: 1, machineName: 'OB truck' });
  t.after(() => pc.stop());
  const local = client(pc.url);
  const cfg = (await local.get('/api/config')).data;
  assert.equal(cfg.bridge, true);
  assert.ok(cfg.pcEdit.includes('graphic') && !cfg.pcEdit.includes('club'));
  assert.equal((await local.post('/api/auth/signup', { name: 'X', email: 'x@example.com', password: 'correct horse' })).status, 403);
  await until(async () => (await local.get('/api/config')).data.googleClientId === 'site-client', 8000, 'Google client from the website');
  assert.equal((await local.post('/api/auth/google', { credential: google('ruan@example.com') })).status, 200);
  assert.equal(pc.sync.linked(), true);

  // records from the website are there, read-only; the playout side can be changed
  const docs = (await local.get('/api/docs?team=' + team)).data.docs;
  const club = docs.find((d) => d.id === 'club_che');
  assert.ok(club);
  const no = await local.put(`/api/docs/club/club_che?team=${team}`, { data: { ...club.data, name: 'Changed on the PC' } });
  assert.equal(no.status, 403);
  assert.equal(no.data.code, 'ONLINE_ONLY');
  assert.match(no.data.error, /Clubs are managed on the website/);
  assert.equal((await local.del(`/api/docs/fixture/fixture_one?team=${team}`)).status, 403);
  assert.equal((await local.put(`/api/docs/org/${team}?team=${team}`, { data: { name: 'x' } })).status, 403);
  assert.equal((await local.post('/api/orgs', { name: 'New team' })).status, 403);
  assert.equal((await local.post('/api/members?team=' + team, { email: 'new@example.com', role: 'Crew' })).status, 403);
  assert.equal((await local.post('/api/members?team=' + team, { email: 'scorer@example.com', role: 'Admin', password: 'correct horse' })).status, 403, 'no role changes on the PC');
  assert.equal((await local.post('/api/images/url', { team, url: 'https://example.com/x.png' })).status, 403);
  assert.equal((await local.put(`/api/docs/graphic/graphic_lt?team=${team}`, { data: { name: 'Lower third', template: 'rfp/lowerthird' } })).status, 200);

  // a password for this PC only, for a venue without internet
  assert.equal((await local.post('/api/members?team=' + team, { email: 'scorer@example.com', role: 'Scorer', password: 'correct horse' })).status, 200);
  const scorer = client(pc.url);
  assert.equal((await scorer.post('/api/auth/login', { email: 'scorer@example.com', password: 'correct horse' })).status, 200);

  // the internet goes: the PC keeps scoring and working on its own copy
  const realUrl = pc.config.cloud.url;
  pc.config.cloud.url = 'http://127.0.0.1:9';                 // nothing listens there
  await pc.sync.run();
  assert.ok(pc.sync.status().lastError, 'sync says it cannot reach the website');
  const sc = await liveClient(pc, { cookie: scorer.cookie(), fixture: 'fixture_one', role: 'sport' });
  t.after(() => sc.close());
  await until(() => sc.state && sc.state.sport && sc.state.sport.setup, 3000, 'PC scorer state');
  await sc.send('sport', 'apply', { version: sc.state.sport.version, setup: sc.state.sport.setup, events: [{ id: 'e1', type: 'score', key: 'try', team: 'A' }] });
  await until(async () => (((await local.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'fixture_one').data.live || {}).events || []).length === 1, 3000, 'score saved on the PC');
  assert.equal((await local.put(`/api/docs/graphic/graphic_bug?team=${team}`, { data: { name: 'Score bug', template: 'rfp/scorebug' } })).status, 200);
  await until(() => pc.sync.status().pending > 0, 3000, 'changes waiting');
  assert.ok(!(await web.get('/api/docs?team=' + team)).data.docs.some((d) => d.id === 'graphic_bug'), 'not on the website yet');

  // back online: everything goes up
  pc.config.cloud.url = realUrl;
  await pc.sync.run();
  await until(async () => {
    const d = (await web.get('/api/docs?team=' + team)).data.docs;
    const fx = d.find((x) => x.id === 'fixture_one');
    return d.some((x) => x.id === 'graphic_bug') && ((fx.data.live || {}).events || []).length === 1;
  }, 8000, 'the PC\'s offline work on the website');
  assert.equal(pc.sync.status().lastError, '');
  // and the website's records still come down
  await web.put(`/api/docs/venue/venue_new?team=${team}`, { data: { name: 'New Ground' } });
  await until(async () => (await local.get('/api/docs?team=' + team)).data.docs.some((d) => d.id === 'venue_new'), 8000, 'website change on the PC');
});
