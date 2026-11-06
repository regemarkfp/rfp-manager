'use strict';
// Phone numbers keep their country code: typed with a 0 they get the default (South Africa, or the WhatsApp setting)
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/phone');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('phone numbers: formatting and splitting', () => {
  assert.equal(P.format('082 123 4567', '27'), '+27 82 123 4567');
  assert.equal(P.format('0027821234567'), '+27 82 123 4567');
  assert.equal(P.format('+264 81 123 4567', '27'), '+264 81 123 4567');
  assert.equal(P.format('081 234 5678', '264'), '+264 81 234 5678');
  assert.equal(P.format(''), '');
  assert.equal(P.format('ask reception'), 'ask reception');
  assert.deepEqual(P.split('+44 7700 900123'), { dial: '44', local: '770 090 0123' });
  assert.deepEqual(P.split('082 123', '27'), { dial: '27', local: '082 123' });
});

test('a booking from the website is saved with the country code', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  await admin.post('/api/orgs', { name: 'Test Team' });
  assert.equal((await admin.get('/api/config')).data.dial, '27');
  const r = await client(app.url).post('/api/public/booking', { name: 'Sam Client', phone: '082 000 0001', service: 'Streaming', date: '2099-01-10' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const b = (await app.store.listType('booking'))[0];
  assert.equal(b.data.phone, '+27 82 000 0001');
});
