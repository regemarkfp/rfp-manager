'use strict';
// The Android app downloads only for the production team (Admin, Producer, Scorer, Crew) and the app's own updater.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('the Android app: production team only', async (t) => {
  const apk = path.join(__dirname, '..', 'public', 'app', 'rfp-manager.apk');
  if (!fs.existsSync(apk)) return t.skip('no APK in this checkout');
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), crew = client(app.url), coach = client(app.url), fan = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Team' })).data.id;
  for (const [c, e] of [[crew, 'crew@example.com'], [coach, 'coach@example.com'], [fan, 'fan@example.com']]) await c.post('/api/auth/signup', { name: 'X', email: e, password: 'correct horse' });
  await admin.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Crew' });
  await admin.post('/api/members?team=' + team, { email: 'coach@example.com', role: 'Coach', clubs: [] });

  const get = (c, ua) => fetch(app.url + '/app/rfp-manager.apk', { headers: { ...(c ? { cookie: c.cookie() } : {}), ...(ua ? { 'user-agent': ua } : {}) } });
  assert.equal((await get(null)).status, 401, 'not signed in');
  assert.equal((await get(fan)).status, 403, 'not on a team');
  assert.equal((await get(coach)).status, 403, 'coaches are not the crew');
  for (const c of [admin, crew]) {
    const r = await get(c);
    assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /no-store/);
    assert.equal(Buffer.from(await r.arrayBuffer()).length, fs.statSync(apk).size);
  }
  assert.equal((await get(null, 'AndroidDownloadManager/14 (Linux; U; Android 14)')).status, 200, 'the installed app updates itself');
  // who is offered it
  assert.equal((await admin.get('/api/config')).data.androidApp, true);
  assert.equal((await crew.get('/api/config')).data.androidApp, true);
  assert.equal((await coach.get('/api/config')).data.androidApp, false);
  assert.equal((await client(app.url).get('/api/config')).data.androidApp, false, 'the sign-in page has no download link');
  assert.equal((await crew.get('/api/public/home')).data.me.appOk, true);
  assert.equal((await fan.get('/api/public/home')).data.me.appOk, false);
});
