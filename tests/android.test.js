'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('Android app: installable website (manifest, service worker), app link file, Google pictures on members', async (t) => {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const links = await fetch(cloud.url + '/.well-known/assetlinks.json');
  assert.equal(links.status, 200);
  const l = await links.json();
  assert.equal(l[0].target.package_name, 'com.regemarkfp.rfpmanager');
  assert.match(l[0].target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  const man = await fetch(cloud.url + '/manifest.webmanifest');
  assert.equal(man.headers.get('content-type'), 'application/manifest+json');
  assert.equal((await man.json()).display, 'standalone');
  assert.equal((await fetch(cloud.url + '/sw.js')).status, 200);
  assert.equal((await fetch(cloud.url + '/offline.html')).status, 200);
  assert.equal((await fetch(cloud.url + '/icons/icon-512.png')).headers.get('content-type'), 'image/png');

  // the Google profile picture follows the person onto every team they are in
  const admin = client(cloud.url);
  await admin.post('/api/auth/signup', { name: 'Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await admin.post('/api/members?team=' + team, { email: 'g@example.com', role: 'Crew' });
  await cloud.auth.ensureUser({ email: 'g@example.com', name: 'G Person', image: 'https://lh3.googleusercontent.com/a/pic1', sub: 'g1' });
  const m = (await admin.get('/api/docs?team=' + team)).data.docs.find((d) => d.type === 'member' && d.data.email === 'g@example.com');
  assert.equal(m.data.image, 'https://lh3.googleusercontent.com/a/pic1');
  await cloud.auth.ensureUser({ email: 'g@example.com', image: 'https://lh3.googleusercontent.com/a/pic2', sub: 'g1' });
  assert.equal((await cloud.auth.userByEmail('g@example.com')).data.image, 'https://lh3.googleusercontent.com/a/pic2', 'a new Google picture replaces the old one');
});
