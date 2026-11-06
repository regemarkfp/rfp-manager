'use strict';
// A client who talks to us on WhatsApp is written to on WhatsApp only (email only when WhatsApp fails); one who chose
// email gets email only; otherwise both.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('booking messages go the way the client talks to us', async (t) => {
  const wa = [];
  const fetchMock = async (url, opts) => { const body = JSON.parse(opts.body); wa.push(body); if (body.to === '27829999999') return { ok: false, status: 400, json: async () => ({ error: { message: 'Not on WhatsApp' } }) }; return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.' + wa.length }] }) }; };
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', publicName: 'RegemarkFP', siteAdmins: ['admin@example.com'], mail: { provider: 'test', from: 'RFP <rfp@example.com>' },
    whatsapp: { fetch: fetchMock, api: 'https://graph.example/v21.0' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await admin.post('/api/whatsapp/config', { phoneNumberId: '1098765432101', token: 'TEST-TOKEN' });
  const settle = async () => { await new Promise((r) => setTimeout(r, 400)); await app.bookings.idle(); await app.notify.idle(); };
  const guest = client(app.url);
  const mails = (to, re) => app.mail.outbox.filter((m) => m.to.includes(to) && re.test(m.subject)).length;
  const book = async (name, email, phone, contactBy) => { await guest.post('/api/public/booking', { name, email, phone, contactBy, service: 'Streaming', date: '2099-01-10' }); return (await app.store.list(team, 'booking')).find((d) => d.data.name === name); };
  const allocate = async (b) => { await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...(await app.store.get(b.id)).data, producer: 'admin@example.com' } }); await settle(); };

  // chose WhatsApp: the step update and a reply go by WhatsApp only
  const a = await book('Ann WhatsApp', 'ann@example.com', '082 000 0001', 'WhatsApp');
  await allocate(a);
  assert.equal(mails('ann@example.com', /Being reviewed/), 0, 'no email');
  assert.equal(wa.filter((x) => x.to === '27820000001').length, 1, 'WhatsApp');
  let m = (await admin.post(`/api/bookings/${a.id}/reply?team=${team}`, { text: 'Hi Ann' })).data.doc.data.messages.slice(-1)[0];
  assert.equal(m.email, null); assert.equal(m.whatsapp.ok, true);
  assert.equal((await admin.get(`/api/bookings/${a.id}/prefers?team=${team}`)).data.prefers, 'whatsapp');
  // the Producer can still tick email too
  m = (await admin.post(`/api/bookings/${a.id}/reply?team=${team}`, { text: 'Also by email', email: true, whatsapp: true })).data.doc.data.messages.slice(-1)[0];
  assert.equal(m.email.ok, true);

  // chose email: email only
  const e = await book('Eve Email', 'eve@example.com', '082 000 0002', 'Email');
  await allocate(e);
  assert.equal(mails('eve@example.com', /Being reviewed/), 1);
  assert.equal(wa.filter((x) => x.to === '27820000002').length, 0);

  // no choice, then they answer on WhatsApp: from then on WhatsApp only
  const n = await book('Neo None', 'neo@example.com', '082 000 0003', '');
  await allocate(n);
  assert.equal(mails('neo@example.com', /Being reviewed/), 1); assert.equal(wa.filter((x) => x.to === '27820000003').length, 1, 'both');
  await app.bookings.fromClient(await app.store.get(n.id), 'Hello from WhatsApp', 'whatsapp');
  const before = app.mail.outbox.filter((x) => x.to.includes('neo@example.com')).length;
  m = (await admin.post(`/api/bookings/${n.id}/reply?team=${team}`, { text: 'Got it' })).data.doc.data.messages.slice(-1)[0];
  assert.equal(m.email, null); assert.equal(app.mail.outbox.filter((x) => x.to.includes('neo@example.com')).length, before, 'no email to them');

  // WhatsApp that fails: email instead, and it says so
  const f = await book('Fay Fails', 'fay@example.com', '082 999 9999', 'WhatsApp');
  await allocate(f);
  const fm = (await app.store.get(f.id)).data.messages.slice(-1)[0];
  assert.deepEqual([fm.whatsapp.ok, fm.email.ok, fm.email.fallback], [false, true, true]);
});
