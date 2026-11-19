'use strict';
// External producers (1.7.0): access to one production (its live stream and crew & kit) for someone outside the team,
// without rates or costs, ending by itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('external producers: one production, its stream and crew & kit, no costs, access ends', async (t) => {
  const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://rfp.example', mail: { provider: 'test', from: 'RFP Manager <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), guest = client(app.url), other = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Pat Producer', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Productions' })).data.id;
  const put = async (type, id, data) => { const r = await admin.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.doc; };
  await put('crewRole', 'crewRole_cam', { name: 'Camera operator', rate: 1500, invoiceRate: 2000 });
  await put('crewMember', 'crewMember_a', { name: 'Alex', email: 'alex@example.com', phone: '+27 82 000 0000', idNumber: '0000000000000', rate: 900 });
  await put('equipment', 'equipment_cam', { name: 'URSA Broadcast', category: 'Camera', rate: 800 });
  await put('client', 'client_x', { name: 'A client', email: 'client@example.com' });
  await put('production', 'production_gala', { name: 'Gala', date: day(30), days: 2, status: 'Confirmed', crew: [{ role: 'crewRole_cam', crewMember: 'crewMember_a', rate: 1200, paid: true }], extras: [{ description: 'Truck', cost: 5000, invoice: 6000 }], streamTitle: 'Gala live' });
  await put('production', 'production_other', { name: 'Other show', date: day(40) });

  // only Producers / Admins give access; a team member cannot be a guest
  assert.equal((await other.post(`/api/productions/production_gala/guests?team=${team}`, { email: 'x@example.com' })).status, 401);
  assert.equal((await admin.post(`/api/productions/production_gala/guests?team=${team}`, { email: 'admin@example.com' })).status, 409);
  const add = await admin.post(`/api/productions/production_gala/guests?team=${team}`, { email: 'Guest.Producer@Example.com', name: 'Gina Guest', note: 'Welcome!' });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.equal(add.data.guest.email, 'guest.producer@example.com');
  assert.equal(add.data.guest.until, day(38), 'the last day of the event + 7');
  assert.equal(add.data.mailed, true);
  const invite = app.mail.outbox.find((m) => m.to.includes('guest.producer@example.com'));
  assert.ok(invite && invite.text.includes('https://rfp.example/app#/edit/production/production_gala') && invite.text.includes('Welcome!'));

  // the guest signs in: the team shows as Guest, with only their production and lists without rates
  await guest.post('/api/auth/signup', { name: 'Gina Guest', email: 'guest.producer@example.com', password: 'correct horse' });
  const me = (await guest.get('/api/me')).data;
  assert.deepEqual(me.teams.map((x) => [x.id, x.role]), [[team, 'Guest']]);
  const docs = (await guest.get(`/api/docs?team=${team}`)).data.docs;
  const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
  assert.ok(byId.production_gala); assert.ok(!byId.production_other, 'not the other production'); assert.ok(!byId.client_x, 'no clients');
  assert.equal(byId.production_gala.data.extras, undefined, 'no costs');
  assert.deepEqual(byId.production_gala.data.crew, [{ role: 'crewRole_cam', crewMember: 'crewMember_a' }], 'no rates or paid');
  assert.deepEqual(byId.crewRole_cam.data, { name: 'Camera operator' });
  assert.deepEqual(Object.keys(byId.crewMember_a.data).sort(), ['email', 'name', 'phone']);
  assert.equal(byId.equipment_cam.data.rate, undefined);
  assert.ok(!docs.some((d) => d.type === 'member'), 'not the members');

  // they change the crew & kit and the stream; nothing else, and the rates stay
  const save = await guest.put(`/api/docs/production/production_gala?team=${team}`, { data: { ...byId.production_gala.data, name: 'Renamed', status: 'Cancelled', extras: [], guests: [],
    crew: [{ role: 'crewRole_cam', crewMember: 'crewMember_a', rate: 1 }, { role: 'crewRole_cam', location: 'Venue' }], equipment: [{ item: 'equipment_cam', quantity: 2 }], streamTitle: 'Gala – live from the hall' } });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  assert.equal(save.data.doc.data.extras, undefined, 'the answer has no costs either');
  const after = (await admin.get(`/api/docs?team=${team}`)).data.docs.find((d) => d.id === 'production_gala').data;
  assert.equal(after.name, 'Gala'); assert.equal(after.status, 'Confirmed'); assert.equal(after.extras.length, 1); assert.equal(after.guests.length, 1);
  assert.equal(after.crew[0].rate, 1200); assert.equal(after.crew[0].paid, true); assert.equal(after.crew.length, 2);
  assert.equal(after.equipment[0].quantity, 2); assert.equal(after.streamTitle, 'Gala – live from the hall');
  // not the other production, nor other records
  assert.equal((await guest.put(`/api/docs/production/production_other?team=${team}`, { data: { name: 'x' } })).status, 403);
  assert.equal((await guest.put(`/api/docs/venue/venue_new01?team=${team}`, { data: { name: 'x' } })).status, 403);
  assert.equal((await guest.put(`/api/docs/production/production_new01?team=${team}`, { data: { name: 'x' } })).status, 403);
  // their production's call sheet, not the other one's; no quotes, no members, no deleting
  assert.equal((await guest.get(`/api/productions/production_gala/callsheet.pdf?team=${team}`)).status, 200);
  assert.equal((await guest.get(`/api/productions/production_other/callsheet.pdf?team=${team}`)).status, 403);
  assert.equal((await guest.get(`/api/invoices/list?team=${team}`)).status, 403);
  assert.equal((await guest.post(`/api/members?team=${team}`, { email: 'z@example.com', role: 'Admin' })).status, 403);
  assert.equal((await guest.del(`/api/docs/production/production_gala?team=${team}`)).status, 403);
  assert.equal((await guest.post(`/api/productions/production_gala/guests?team=${team}`, { email: 'friend@example.com' })).status, 403);
  // a Producer saving the production keeps the guests (they are kept by the server)
  await put('production', 'production_gala', { ...after, guests: [] });
  assert.equal((await admin.get(`/api/docs?team=${team}`)).data.docs.find((d) => d.id === 'production_gala').data.guests.length, 1);

  // access ends: after the day, the production is gone for them; the sweep tidies up
  const cur = await app.store.get('production_gala');
  await app.save(team, 'production', 'production_gala', { ...cur.data, guests: cur.data.guests.map((g) => ({ ...g, until: '2020-01-01' })) }, '');
  assert.equal((await guest.get(`/api/docs?team=${team}`)).status, 403);
  assert.deepEqual((await guest.get('/api/me')).data.teams, []);
  assert.equal(await app.guests.sweep(), 1);
  assert.equal((await app.store.get('production_gala')).data.guests.length, 0);
  // given again, then taken away by the producer
  await admin.post(`/api/productions/production_gala/guests?team=${team}`, { email: 'guest.producer@example.com', until: '2099-01-01', notify: false });
  assert.equal((await guest.get(`/api/docs?team=${team}`)).status, 200);
  assert.equal((await admin.del(`/api/productions/production_gala/guests/${encodeURIComponent('guest.producer@example.com')}?team=${team}`)).status, 200);
  assert.equal((await guest.get(`/api/docs?team=${team}`)).status, 403);
});
