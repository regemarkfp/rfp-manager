'use strict';
// Email invitations: adding a member emails an "Accept the invitation" link; the person sets a password there (no
// Google account) and is signed in to the team; Send invite gives a fresh link; removed = the link stops working.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

const form = (url, fields, cookie) => fetch(url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(fields).toString() });

test('invitations: accept with your own password, resend, cancelled when removed', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Team' })).data.id;

  const add = await admin.post('/api/members?team=' + team, { email: 'Cam.Op@Example.com', role: 'Crew' });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  await app.notify.idle();
  const mail = app.mail.outbox.find((m) => m.to.includes('cam.op@example.com'));
  assert.ok(mail, 'invited');
  assert.match(mail.subject, /invited to Test Team/);
  const url = (mail.text.match(/https:\/\/site\.example\/join\/\S+/) || [])[0];
  assert.ok(url, mail.text);
  const path = url.replace('https://site.example', '');

  // the page: team, role, email; a tampered link is refused
  let page = await (await fetch(app.url + path)).text();
  assert.match(page, /Join Test Team/); assert.match(page, /Crew/); assert.match(page, /cam\.op@example\.com/);
  assert.match(await (await fetch(app.url + path.slice(0, -2) + 'xx')).text(), /not valid/);

  // passwords must match and be long enough; then the account is made and signed in
  assert.match(await (await form(app.url + path, { name: 'Cam Op', password: 'long enough', password2: 'different!' })).text(), /not the same/);
  assert.match(await (await form(app.url + path, { name: 'Cam Op', password: 'short', password2: 'short' })).text(), /at least 8/);
  const ok = await form(app.url + path, { name: 'Cam Op', password: 'long enough', password2: 'long enough' });
  assert.equal(ok.status, 303); assert.equal(ok.headers.get('location'), '/app');
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  const me = await (await fetch(app.url + '/api/me', { headers: { cookie } })).json();
  assert.equal(me.user.email, 'cam.op@example.com');
  assert.deepEqual(me.teams.map((x) => x.name), ['Test Team']);
  // the same password signs in later; the link can't be used again to change it
  const cam = client(app.url);
  assert.equal((await cam.post('/api/auth/login', { email: 'cam.op@example.com', password: 'long enough' })).status, 200);
  assert.match(await (await fetch(app.url + path)).text(), /already have a password/);
  assert.match(await (await form(app.url + path, { name: 'X', password: 'other pass', password2: 'other pass' })).text(), /already have a password/);
  assert.equal((await cam.post('/api/auth/login', { email: 'cam.op@example.com', password: 'other pass' })).status, 401);

  // Send invite: only Admins; a fresh link; removing the member cancels it
  await admin.post('/api/members?team=' + team, { email: 'sound@example.com', role: 'Scorer' });
  const mem = (await app.store.list(team, 'member')).find((m) => m.data.email === 'sound@example.com');
  assert.equal((await cam.post(`/api/members/${mem.id}/invite?team=${team}`, {})).status, 403);
  const before = app.mail.outbox.length;
  const re = await admin.post(`/api/members/${mem.id}/invite?team=${team}`, {});
  assert.equal(re.status, 200, JSON.stringify(re.data));
  const again = app.mail.outbox.slice(before).find((m) => m.to.includes('sound@example.com'));
  assert.match(again.subject, /Invitation to Test Team/);
  const p2 = again.text.match(/https:\/\/site\.example(\/join\/\S+)/)[1];
  assert.match(await (await fetch(app.url + p2)).text(), /Join Test Team/);
  assert.equal((await admin.del(`/api/members/${mem.id}?team=${team}`)).status, 200);
  assert.match(await (await fetch(app.url + p2)).text(), /cancelled/);
  assert.match(await (await form(app.url + p2, { name: 'S', password: 'long enough', password2: 'long enough' })).text(), /cancelled/);
  assert.equal((await client(app.url).post('/api/auth/login', { email: 'sound@example.com', password: 'long enough' })).status, 401);

  // someone who already has a password is told to sign in, with no link
  await client(app.url).post('/api/auth/signup', { name: 'Has Account', email: 'has@example.com', password: 'correct horse' });
  await admin.post('/api/members?team=' + team, { email: 'has@example.com', role: 'Producer' });
  await app.notify.idle();
  const m3 = app.mail.outbox.find((m) => m.to.includes('has@example.com'));
  assert.ok(!/\/join\//.test(m3.text) && /your password/.test(m3.text), m3.text);
});
