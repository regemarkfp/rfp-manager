'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

// a stand-in for Google: the token endpoint and FCM
async function fakeGoogle(t) {
  const state = { tokens: 0, sent: [], gone: new Set() };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/token') { state.tokens++; state.assertion = new URLSearchParams(b).get('assertion'); return json(200, { access_token: 'ya29.test', expires_in: 3600 }); }
      if (/^\/v1\/projects\/rfp-test\/messages:send$/.test(req.url)) {
        if (req.headers.authorization !== 'Bearer ya29.test') return json(401, { error: { message: 'no' } });
        const m = JSON.parse(b).message;
        if (state.gone.has(m.token)) return json(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
        state.sent.push(m); return json(200, { name: 'projects/rfp-test/messages/1' });
      }
      json(404, {});
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { url: 'http://127.0.0.1:' + srv.address().port, state };
}

test('push notifications: Firebase set-up, Android devices, choices, quiet hours, inbox, Windows PCs', async (t) => {
  const g = await fakeGoogle(t);
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://tv.example.com', adminUrl: 'https://admin.example.com', siteAdmins: ['ruan@example.com'], mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' },
    push: { tokenUrl: g.url + '/token', fcmBase: g.url } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  await web.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await web.post('/api/orgs', { name: 'RegemarkFP' })).data.id;

  // the site admin uploads the two Firebase files
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  assert.equal((await web.post('/api/push/config', { serviceAccount: '{"nope":1}' })).status, 400);
  let r = await web.post('/api/push/config', { serviceAccount: JSON.stringify({ project_id: 'rfp-test', client_email: 'push@rfp-test.iam.gserviceaccount.com', private_key: privateKey }),
    googleServices: JSON.stringify({ project_info: { project_id: 'rfp-test', project_number: '123456' }, client: [{ client_info: { mobilesdk_app_id: '1:123456:android:abc', android_client_info: { package_name: 'com.regemarkfp.rfpmanager' } }, api_key: [{ current_key: 'AIzaTest' }] }] }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { fcm: true, android: true, project: 'rfp-test', windows: 0 });
  assert.deepEqual((await client(cloud.url).get('/api/push/android-config')).data, { apiKey: 'AIzaTest', appId: '1:123456:android:abc', projectId: 'rfp-test', senderId: '123456', storageBucket: '' });
  assert.equal((await client(cloud.url).get('/api/push/config')).status, 401);

  // the Android app registers its token; a test notification reaches it (signed by the service account)
  assert.equal((await web.post('/api/push/register', { platform: 'android', token: 'short' })).status, 400);
  r = await web.post('/api/push/register', { platform: 'android', token: 'fcm-token-aaaaaaaaaaaaaaaaaaaa', name: 'Pixel 8' });
  assert.equal(r.status, 200);
  r = await web.post('/api/push/test', {});
  assert.deepEqual(r.data, { devices: 1, pushed: 1 });
  const [h, c, sig] = g.state.assertion.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), publicKey, Buffer.from(sig, 'base64url')), 'the JWT is signed with the service account');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(g.state.sent[0].token, 'fcm-token-aaaaaaaaaaaaaaaaaaaa');
  assert.equal(g.state.sent[0].data.title, 'Test notification'); assert.equal(g.state.sent[0].data.channel, 'streams'); assert.equal(g.state.sent[0].android.priority, 'HIGH');

  // choices: a kind switched off is neither pushed nor kept; quiet hours keep it in the inbox only
  let p = (await web.get('/api/push/prefs')).data;
  assert.ok(p.events.length >= 16); assert.equal(p.prefs.chat, true); assert.equal(p.devices[0].name, 'Pixel 8'); assert.equal(p.android, true);
  await web.put('/api/push/prefs', { prefs: { chat: false, nonsense: true } });
  const me = await cloud.auth.userByEmail('ruan@example.com');
  assert.equal(await cloud.push.send([me.id], { kind: 'chat', title: 'Hi' }), 0);
  assert.equal(await cloud.push.send(['ruan@example.com'], { kind: 'sales', title: 'Ticket sold', body: 'R50' }), 1);
  await web.put('/api/push/prefs', { quiet: { on: true, from: '00:00', to: '23:59' } });
  assert.equal(await cloud.push.send(['ruan@example.com'], { kind: 'sales', title: 'Quiet one' }), 0);
  let inbox = (await web.get('/api/notifications')).data;
  assert.deepEqual(inbox.list.map((n) => n.title), ['Quiet one', 'Ticket sold', 'Test notification']);
  assert.equal(inbox.unread, 3);
  await web.post('/api/notifications/read', { ids: [inbox.list[0].id] });
  assert.equal((await web.get('/api/notifications')).data.unread, 2);
  await web.post('/api/notifications/read', { all: true });
  assert.equal((await web.get('/api/notifications')).data.unread, 0);
  await web.put('/api/push/prefs', { quiet: { on: false } });
  // the same news within a minute (same tag) is sent once
  assert.equal(await cloud.push.send(['ruan@example.com'], { kind: 'sales', title: 'A', tag: 'x1' }), 1);
  assert.equal(await cloud.push.send(['ruan@example.com'], { kind: 'sales', title: 'A', tag: 'x1' }), 0);

  // a removed app: FCM says UNREGISTERED, the device goes
  g.state.gone.add('fcm-token-aaaaaaaaaaaaaaaaaaaa');
  await cloud.push.send(['ruan@example.com'], { kind: 'sales', title: 'B' });
  assert.equal((await web.get('/api/push/prefs')).data.devices.length, 0);

  // events: a booking request from the website reaches the Admins' phones
  await web.post('/api/push/register', { platform: 'android', token: 'fcm-token-bbbbbbbbbbbbbbbbbbbb' });
  const before = g.state.sent.length;
  cloud.notify.bookingReceived(team, { id: 'booking_x1', data: { name: 'A School', service: 'Live stream', date: '2026-11-01' } });
  await cloud.notify.idle(); await new Promise((res) => setTimeout(res, 100));
  const sentNow = g.state.sent.slice(before);
  assert.equal(sentNow.length, 1); assert.equal(sentNow[0].data.kind, 'booking'); assert.equal(sentNow[0].data.channel, 'crew');
  assert.equal(sentNow[0].data.url, 'https://admin.example.com/app/#/edit/booking/booking_x1');

  // Windows: a linked PC registers the people who sign in on it and gets their notifications on its stream
  const { key } = await cloud.auth.createKey(me, 'Studio PC');
  assert.equal((await fetch(cloud.url + '/api/push/register', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer mk_wrongwrongwrongwrongwrong' }, body: JSON.stringify({ platform: 'windows', email: 'ruan@example.com' }) })).status, 401);
  r = await fetch(cloud.url + '/api/push/register', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ platform: 'windows', email: 'ruan@example.com', name: 'STUDIO (Windows)' }) });
  assert.equal(r.status, 200);
  const ctrl = new AbortController();
  const s = await fetch(cloud.url + '/api/push/stream', { headers: { authorization: 'Bearer ' + key }, signal: ctrl.signal });
  assert.equal(s.headers.get('content-type'), 'text/event-stream');
  const reader = s.body.getReader();
  let text = '';
  const got = (async () => { const dec = new TextDecoder(); while (!text.includes('event: notify')) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); } })();
  await new Promise((res) => setTimeout(res, 100));
  assert.equal((await cloud.push.config()).windows, 1);
  assert.equal(await cloud.push.send(['ruan@example.com'], { kind: 'crew_hired', title: 'You are hired: Derby', url: 'https://admin.example.com/app/#/callsheet/prod_1' }), 2, 'phone and PC');
  await Promise.race([got, new Promise((res) => setTimeout(res, 2000))]);
  ctrl.abort();
  assert.match(text, /event: notify\ndata: .*You are hired: Derby/);
  assert.match(text, /"user":"ruan@example.com"/);
  // another team's person cannot be put on this PC
  await client(cloud.url).post('/api/auth/signup', { name: 'Other', email: 'other@example.com', password: 'correct horse' });
  r = await fetch(cloud.url + '/api/push/register', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ platform: 'windows', email: 'other@example.com' }) });
  assert.equal(r.status, 403);
  // push records are never sent to the Studio or a PC as records
  const docs = (await web.get(`/api/docs?team=${team}`)).data.docs;
  assert.ok(!docs.some((d) => ['pushdevice', 'notification'].includes(d.type)));
});
