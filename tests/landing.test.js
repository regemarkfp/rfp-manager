'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('landing page: about us and services edited by site admins; booking requests reach the team', async (t) => {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://tv.example.com', publicName: 'RegemarkFP', siteAdmins: ['ruan@example.com'], mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const admin = client(cloud.url);
  assert.equal((await admin.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' })).status, 200);
  await admin.post('/api/orgs', { name: 'Other Team' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const crew = client(cloud.url);
  await crew.post('/api/auth/signup', { name: 'Crew', email: 'crew@example.com', password: 'correct horse' });
  await admin.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Crew' });

  // the page, with defaults; only site admins change it
  const guest = client(cloud.url);
  let l = (await guest.get('/api/public/landing')).data;
  assert.equal(l.site, 'RegemarkFP');
  assert.ok(l.about.length > 20 && l.services.length >= 3);
  assert.equal((await crew.put('/api/site/landing', { title: 'x' })).status, 403);
  const cur = (await admin.get('/api/site/landing')).data;
  assert.equal(cur.bookingTeam, team, 'the team named like the website gets the bookings');
  assert.equal((await admin.put('/api/site/landing', { ...cur, title: 'Live sport, streamed', about: 'About us text', services: [{ title: 'Streaming', text: 'Live' }, { title: '' }], email: 'info@example.com' })).status, 200);
  l = (await guest.get('/api/public/landing')).data;
  assert.equal(l.title, 'Live sport, streamed');
  assert.deepEqual(l.services, [{ title: 'Streaming', text: 'Live' }]);
  for (const p of ['/', '/browse', '/book']) { const r = await fetch(cloud.url + p); assert.equal(r.status, 200, p); assert.match(await r.text(), /public\.js/); }

  // a booking request
  assert.equal((await guest.post('/api/public/booking', { name: '' })).status, 400);
  assert.equal((await guest.post('/api/public/booking', { name: 'Sam' })).status, 400, 'needs a way to answer');
  const ok = await guest.post('/api/public/booking', { name: 'Sam Client', email: 'sam@example.com', service: 'Streaming', date: '2026-11-21', venue: 'Bloemfontein', details: 'School derby, 3 cameras' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const b = (await cloud.store.list(team, 'booking'))[0];
  assert.equal(b.data.status, 'New');
  assert.equal(b.data.service, 'Streaming');
  await cloud.notify.idle();
  assert.ok(cloud.mail.outbox.find((m) => m.to.includes('ruan@example.com') && /Booking request: Streaming – Sam Client/.test(m.subject)));
  assert.ok(cloud.mail.outbox.find((m) => m.to.includes('sam@example.com') && /Thank you/.test(m.subject)));
  // a robot filling the hidden field is ignored
  assert.equal((await guest.post('/api/public/booking', { name: 'Bot', email: 'b@example.com', website: 'http://spam' })).status, 200);
  assert.equal((await cloud.store.list(team, 'booking')).length, 1);
  // Admins allocate a Producer; only that Producer sees it; they accept (a production is made) or decline
  const prodA = client(cloud.url), prodB = client(cloud.url);
  await prodA.post('/api/auth/signup', { name: 'Pat Producer', email: 'pat@example.com', password: 'correct horse' });
  await prodB.post('/api/auth/signup', { name: 'Lee Producer', email: 'lee@example.com', password: 'correct horse' });
  await admin.post('/api/members?team=' + team, { email: 'pat@example.com', role: 'Producer' });
  await admin.post('/api/members?team=' + team, { email: 'lee@example.com', role: 'Producer' });
  const sees = async (c) => (await c.get('/api/docs?team=' + team)).data.docs.some((d) => d.type === 'booking');
  assert.equal(await sees(prodA), false, 'not allocated: Producers do not see it');
  assert.equal((await prodA.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...b.data, producer: 'pat@example.com' } })).status, 403, 'a Producer cannot take it');
  assert.equal((await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...b.data, producer: 'pat@example.com' } })).status, 200);
  assert.equal((await cloud.store.get(b.id)).data.status, 'Assigned');
  assert.equal(await sees(prodA), true);
  assert.equal(await sees(prodB), false);
  await cloud.notify.idle();
  assert.ok(cloud.mail.outbox.find((m) => m.to.includes('pat@example.com') && /Booking for you/.test(m.subject)));
  assert.equal((await prodB.post(`/api/bookings/${b.id}/respond?team=${team}`, { accept: true })).status, 403);
  // Pat edits notes but cannot change who or the status by saving
  const bb = (await cloud.store.get(b.id)).data;
  assert.equal((await prodA.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...bb, notes: 'Called them', producer: 'lee@example.com', status: 'Booked' } })).status, 200);
  assert.equal((await cloud.store.get(b.id)).data.producer, 'pat@example.com');
  assert.equal((await cloud.store.get(b.id)).data.status, 'Assigned');
  assert.equal((await cloud.store.get(b.id)).data.notes, 'Called them');
  // decline → Admins hear of it; allocate to Lee, who accepts → a production for it
  assert.equal((await prodA.post(`/api/bookings/${b.id}/respond?team=${team}`, { accept: false, note: 'Away that weekend' })).status, 200);
  assert.equal((await cloud.store.get(b.id)).data.status, 'Declined by producer');
  await cloud.notify.idle();
  assert.ok(cloud.mail.outbox.find((m) => m.to.includes('ruan@example.com') && /Declined/.test(m.subject) && /Away that weekend/.test(m.text)));
  assert.equal((await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...(await cloud.store.get(b.id)).data, producer: 'lee@example.com' } })).status, 200);
  assert.equal((await cloud.store.get(b.id)).data.status, 'Assigned');
  const acc = await prodB.post(`/api/bookings/${b.id}/respond?team=${team}`, { accept: true });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  const prod = await cloud.store.get(acc.data.production);
  assert.equal(prod.type, 'production');
  assert.equal(prod.data.date, '2026-11-21');
  assert.equal(prod.data.producer, 'lee@example.com');
  assert.equal(prod.data.booking, b.id);
  assert.match(prod.data.description, /3 cameras/);
  assert.equal((await cloud.store.get(b.id)).data.status, 'Accepted');
  assert.equal((await prodB.del(`/api/docs/booking/${b.id}?team=${team}`)).status, 403, 'only Admins delete');

  // Admins see requests, crew do not
  assert.ok((await admin.get('/api/docs?team=' + team)).data.docs.some((d) => d.type === 'booking'));
  assert.ok(!(await crew.get('/api/docs?team=' + team)).data.docs.some((d) => d.type === 'booking'));
});
