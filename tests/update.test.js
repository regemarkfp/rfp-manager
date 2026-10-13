'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { boot, client, until } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { newer, untar, safeRel } = require('../lib/update');
const { bundle, PC_PARTS } = require('../lib/tarball');

test('versions, the bundle and safe paths', async () => {
  assert.equal(newer('0.22.0', '0.21.0'), true);
  assert.equal(newer('0.21.10', '0.21.9'), true);
  assert.equal(newer('1.0', '0.99.99'), true);
  assert.equal(newer('0.21.0', '0.21.0'), false);
  assert.equal(newer('0.20.9', '0.21.0'), false);
  const files = untar(await bundle(path.join(__dirname, '..'), 'rfp-manager', PC_PARTS)).map((f) => f.name);
  for (const f of ['rfp-manager/server.js', 'rfp-manager/package.json', 'rfp-manager/lib/update.js', 'rfp-manager/run.bat', 'rfp-manager/tools/launcher/RFPManager.cs', 'rfp-manager/public/js/updates.js']) assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => /config\.json$|\/data\/|webview2|rfp-manager\.apk$|\/tests\//.test(f)));
  assert.equal(safeRel('rfp-manager/lib/app.js'), 'lib/app.js');
  for (const bad of ['rfp-manager/../evil.js', 'rfp-manager/config.json', 'rfp-manager/data/rfp.db', 'rfp-manager/C:/x', 'rfp-manager/']) assert.equal(safeRel(bad), null, bad);
});

test('a linked PC finds a newer version on the website and installs it', async (t) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const certs = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise((r) => certs.listen(0, '127.0.0.1', r));
  t.after(() => certs.close());
  const certsUrl = `http://127.0.0.1:${certs.address().port}/`;
  const google = (email) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: 'site-client', exp: Math.floor(Date.now() / 1000) + 600, email, email_verified: true, name: 'Ruan', sub: 'g-' + email });
    return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url');
  };
  const cloud = await boot({ mode: 'cloud', google: { clientId: 'site-client', certsUrl }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  assert.equal((await web.post('/api/auth/google', { credential: google('ruan@example.com') })).status, 200);
  await web.post('/api/orgs', { name: 'Update Team' });

  // without a machine key the website does not hand out the program
  assert.equal((await client(cloud.url).get('/api/update/bundle.tgz')).status, 401);
  const info = (await client(cloud.url).get('/api/update/info')).data;
  assert.equal(info.version, cloud.version);
  assert.equal(info.pc, true);

  const pc = await boot({ standalone: false, defaultCloudUrl: cloud.url, google: { clientId: '', certsUrl }, syncSeconds: 1 });
  t.after(() => pc.stop());
  const local = client(pc.url);
  await until(async () => (await local.get('/api/config')).data.googleClientId === 'site-client', 8000, 'Google client from the website');
  assert.equal((await local.post('/api/auth/google', { credential: google('ruan@example.com') })).status, 200);
  assert.equal(pc.sync.linked(), true);

  // same version: nothing to install
  let st = (await local.post('/api/update/check', {})).data;
  assert.equal(st.canUpdate, true);
  assert.equal(st.available, false);
  assert.equal((await local.post('/api/update/install', {})).status, 400);

  // the website gets a newer version
  cloud.version = '9.9.9';
  st = (await local.post('/api/update/check', {})).data;
  assert.equal(st.latest, '9.9.9');
  assert.equal(st.available, true);
  assert.equal((await local.get('/api/update')).data.available, true);

  // install into a copy of the folder (not over the program running these tests), without restarting
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-update-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'config.json'), '{"keep":"me"}');
  fs.mkdirSync(path.join(dir, 'data')); fs.writeFileSync(path.join(dir, 'data', 'rfp.db'), 'my data');
  fs.writeFileSync(path.join(dir, 'server.js'), '// the old one');
  const realRoot = pc.root;
  pc.root = dir;
  t.after(() => { pc.root = realRoot; });
  const out = await pc.updates.install({ restart: false });
  assert.ok(out.files > 50);
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'), '{"keep":"me"}');
  assert.equal(fs.readFileSync(path.join(dir, 'data', 'rfp.db'), 'utf8'), 'my data');
  assert.match(fs.readFileSync(path.join(dir, 'server.js'), 'utf8'), /RFP Manager|require/);
  assert.ok(fs.existsSync(path.join(dir, 'lib', 'update.js')));
  assert.equal(fs.readFileSync(path.join(dir, '.update-backup', pc.version, 'server.js'), 'utf8'), '// the old one');
  assert.ok(!fs.existsSync(path.join(dir, '.update-tmp')));
});

test('channels are shared with every production team unless kept for one team', async (t) => {
  const { boot: _b } = require('./helpers');
  const cloud = await _b({ mode: 'cloud', allowSignup: true, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const a = client(cloud.url), b = client(cloud.url);
  assert.equal((await a.post('/api/auth/signup', { name: 'A', email: 'a@example.com', password: 'correct horse' })).status, 200);
  assert.equal((await b.post('/api/auth/signup', { name: 'B', email: 'b@example.com', password: 'correct horse' })).status, 200);
  const ta = (await a.post('/api/orgs', { name: 'Team Alpha' })).data.id;
  const tb = (await b.post('/api/orgs', { name: 'Team Bravo' })).data.id;
  assert.equal((await a.put(`/api/docs/channel/chan_shared?team=${ta}`, { data: { name: 'Alpha TV' } })).status, 200);
  assert.equal((await a.put(`/api/docs/channel/chan_alonly?team=${ta}`, { data: { name: 'Alpha Private', teamOnly: true } })).status, 200);
  const shared = (await b.get('/api/channels/shared')).data.list;
  assert.deepEqual(shared.map((c) => c.id), ['chan_shared']);
  assert.equal(shared[0].teamName, 'Team Alpha');
  // team Bravo streams a production on Alpha's shared channel, but not on the team-only one
  const ok = await b.put(`/api/docs/production/prod_bravo1?team=${tb}`, { data: { name: 'Bravo final', date: '2026-11-01', streamChannel: 'chan_shared' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.doc ? ok.data.doc.data.streamSlug : true);
  const no = await b.put(`/api/docs/production/prod_bravo2?team=${tb}`, { data: { name: 'Bravo semi', date: '2026-10-25', streamChannel: 'chan_alonly' } });
  assert.equal(no.status, 400);
  assert.match(no.data.error, /only for its own production team/);
});
