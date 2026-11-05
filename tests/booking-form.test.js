'use strict';
// The detailed booking form: times, town, contact preference, budget and the questions for the kind of job.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('booking form: details and job questions reach the team, the client copy and the production', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', publicName: 'RegemarkFP', mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const guest = client(app.url);
  const r = await guest.post('/api/public/booking', { name: 'Sam Coach', email: 'sam@example.com', phone: '082 000 0000', service: 'Sport broadcasts', date: '2099-03-14', endDate: '2099-03-15', startTime: '09:00', endTime: '17:30',
    venue: 'Test College, A-field', town: 'Bloemfontein', contactBy: 'WhatsApp', budget: 'R10 000 – R25 000', heard: 'Google', details: 'Festival weekend',
    answers: [{ q: 'Sport', a: 'Rugby' }, { q: 'Level', a: 'High school' }, { q: 'Number of matches', a: '6' }, { q: 'For the broadcast', a: 'Live score bug & match graphics, Replays / slow motion' }, { q: '', a: 'x' }, { q: 'Cameras', a: '' }],
    endDateBad: 'x' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const b = (await app.store.list(team, 'booking'))[0].data;
  assert.deepEqual([b.endDate, b.startTime, b.endTime, b.town, b.contactBy, b.budget, b.heard], ['2099-03-15', '09:00', '17:30', 'Bloemfontein', 'WhatsApp', 'R10 000 – R25 000', 'Google']);
  assert.deepEqual(b.answers.map((x) => x.q), ['Sport', 'Level', 'Number of matches', 'For the broadcast'], 'empty ones dropped');
  await app.notify.idle();
  const toTeam = app.mail.outbox.find((m) => m.to.includes('admin@example.com') && /Booking request/.test(m.subject));
  assert.match(toTeam.text, /WHAT THEY NEED/); assert.match(toTeam.text, /Sport {2}·  Rugby/); assert.match(toTeam.text, /09:00 – 17:30/); assert.match(toTeam.text, /Test College, A-field, Bloemfontein/);
  const toClient = app.mail.outbox.find((m) => m.to.includes('sam@example.com') && /Thank you/.test(m.subject));
  assert.match(toClient.text, /WHAT YOU NEED/);
  // a bad end date (before the start) and bad times are dropped
  await guest.post('/api/public/booking', { name: 'X', email: 'x@example.com', date: '2099-03-14', endDate: '2099-03-01', startTime: '9am' });
  const x = (await app.store.list(team, 'booking')).find((d) => d.data.name === 'X').data;
  assert.deepEqual([x.endDate, x.startTime, x.answers], ['', '', []]);
  // the production made for it carries what they asked
  const id = (await app.store.list(team, 'booking')).find((d) => d.data.name === 'Sam Coach').id;
  await admin.put(`/api/docs/booking/${id}?team=${team}`, { data: { ...(await app.store.get(id)).data, producer: 'admin@example.com', answers: [] } });
  assert.equal((await app.store.get(id)).data.answers.length, 4, 'the form never drops the answers');
  const acc = await admin.post(`/api/bookings/${id}/respond?team=${team}`, { accept: true });
  const prod = (await app.store.get(acc.data.production)).data;
  assert.match(prod.description, /Sport: Rugby/); assert.match(prod.description, /Time: 09:00–17:30/); assert.match(prod.description, /prefers WhatsApp/);
  assert.equal(prod.txTime, '09:00'); assert.equal(prod.type, 'Sport');
});
