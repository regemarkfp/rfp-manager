'use strict';
// Booking requests followed like a parcel (/track/<key>), replies by email and WhatsApp (Cloud API, mocked here),
// clients' answers through the tracking page and the WhatsApp webhook, delivery ticks.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { normalize, flat } = require('../lib/whatsapp');

test('whatsapp: numbers and template values', () => {
  assert.equal(normalize('082 000 0000'), '27820000000');
  assert.equal(normalize('+27 82 000 0000'), '27820000000');
  assert.equal(normalize('0044 20 0000 0000'), '442000000000');
  assert.equal(normalize('12'), '');
  assert.equal(flat('a\nb\t\tc     d'), 'a · b · c   d');
});

test('booking tracking, replies by email + WhatsApp, answers back', async (t) => {
  const wa = [];
  let nextId = 1;
  const fetchMock = async (url, opts) => {
    const body = JSON.parse(opts.body);
    wa.push({ url, auth: opts.headers.authorization, body });
    if (body.to === '27829999999') return { ok: false, status: 400, json: async () => ({ error: { message: 'Recipient not on WhatsApp', code: 131026 } }) };
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.' + nextId++ }] }) };
  };
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', publicName: 'RegemarkFP', siteAdmins: ['admin@example.com'], mail: { provider: 'test', from: 'RFP <rfp@example.com>' },
    whatsapp: { fetch: fetchMock, api: 'https://graph.example/v21.0' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const settle = async () => { await new Promise((r) => setTimeout(r, 400)); await app.bookings.idle(); await app.notify.idle(); };

  // WhatsApp: only site admins set it up; the token never comes back
  const guest = client(app.url);
  assert.equal((await guest.get('/api/whatsapp/config')).status, 401);
  let c = (await admin.get('/api/whatsapp/config')).data;
  assert.equal(c.on, false); assert.match(c.verifyToken, /^[0-9a-f]{32}$/); assert.equal(c.webhook, 'https://site.example/api/whatsapp/webhook');
  assert.equal((await admin.post('/api/whatsapp/config', { phoneNumberId: '0821234' })).status, 400, 'that is a phone number, not the ID');
  c = (await admin.post('/api/whatsapp/config', { phoneNumberId: '1098765432101', token: 'TEST-TOKEN', template: 'booking_update', lang: 'en' })).data;
  assert.equal(c.on, true); assert.equal(c.hasToken, true); assert.equal(c.token, undefined);
  assert.equal((await admin.get('/api/config')).data.whatsapp, true);

  // a request from the website: a tracking link at once, in the thank-you email too
  const sent = await guest.post('/api/public/booking', { name: 'Sam Client', email: 'sam@example.com', phone: '082 000 0000', service: 'Streaming', date: '2099-01-10', venue: 'Town hall', details: 'Two cameras' });
  assert.equal(sent.status, 200);
  assert.match(sent.data.track, /^\/track\/[\w-]{16}$/);
  const key = sent.data.track.slice(7);
  assert.equal((await fetch(app.url + sent.data.track)).status, 200, 'the page');
  await settle();
  assert.ok(app.mail.outbox.find((m) => m.to.includes('sam@example.com') && m.text.includes('https://site.example/track/' + key)), 'thank-you email with the link');
  let tr = (await guest.get('/api/public/track/' + key)).data;
  assert.equal(tr.stage, 'Received'); assert.equal(tr.company, 'RegemarkFP'); assert.equal(tr.name, 'Sam');
  assert.deepEqual(tr.steps.map((s) => s.stage), ['Received', 'Being reviewed', 'Quote sent', 'Confirmed', 'Crew booked', 'Event day', 'Completed']);
  assert.equal(tr.steps[0].done, true); assert.equal(tr.steps[1].done, false);
  assert.equal(wa.length, 0, 'nothing on WhatsApp for "Received" (the email says it)');
  assert.equal((await guest.get('/api/public/track/not-a-valid-key-x')).status, 404);
  const b = (await app.store.list(team, 'booking'))[0];

  // allocated to a Producer: "Being reviewed", sent to the client by email and the WhatsApp template
  assert.equal((await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...(await app.store.get(b.id)).data, producer: 'admin@example.com' } })).status, 200);
  await settle();
  tr = (await guest.get('/api/public/track/' + key)).data;
  assert.equal(tr.stage, 'Being reviewed');
  assert.ok(app.mail.outbox.find((m) => m.to.includes('sam@example.com') && /Being reviewed/.test(m.subject)));
  assert.equal(wa.length, 1);
  assert.equal(wa[0].url, 'https://graph.example/v21.0/1098765432101/messages');
  assert.equal(wa[0].auth, 'Bearer TEST-TOKEN');
  assert.equal(wa[0].body.to, '27820000000');
  assert.equal(wa[0].body.type, 'template', 'no message from them yet: the approved template');
  assert.equal(wa[0].body.template.name, 'booking_update');
  assert.deepEqual(wa[0].body.template.components[0].parameters.map((p) => p.text), ['Sam', 'Streaming on Sat, 10 Jan 2099', 'A producer is looking at your request.', 'https://site.example/track/' + key]);

  // a reply from the Studio: email + WhatsApp at once, kept on the booking
  const r1 = await admin.post(`/api/bookings/${b.id}/reply?team=${team}`, { text: 'Hi Sam,\nwhich town hall?' });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  let m = r1.data.doc.data.messages.slice(-1)[0];
  assert.equal(m.from, 'us'); assert.equal(m.by, 'Test Admin');
  assert.deepEqual([m.email.ok, m.whatsapp.ok, m.whatsapp.kind, m.whatsapp.status], [true, true, 'template', 'sent']);
  assert.equal(wa[1].body.template.components[0].parameters[2].text, 'Hi Sam, · which town hall?', 'no new lines in a template value');
  assert.ok(app.mail.outbox.find((x) => x.to.includes('sam@example.com') && /Re: your booking/.test(x.subject) && x.text.includes('which town hall?')));
  assert.equal((await admin.post(`/api/bookings/${b.id}/reply?team=${team}`, { text: ' ' })).status, 400);

  // the webhook: Meta checks it, then sends the client's answer and the ticks
  c = (await admin.get('/api/whatsapp/config')).data;
  assert.equal((await fetch(`${app.url}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`)).status, 403);
  const v = await fetch(`${app.url}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${c.verifyToken}&hub.challenge=42`);
  assert.equal(v.status, 200); assert.equal(await v.text(), '42');
  const hook = (value, headers = {}) => fetch(app.url + '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value }] }] }) });
  assert.equal((await hook({ statuses: [{ id: m.whatsapp.id, status: 'delivered', recipient_id: '27820000000' }] })).status, 200);
  assert.equal((await hook({ statuses: [{ id: m.whatsapp.id, status: 'sent', recipient_id: '27820000000' }] })).status, 200, 'a late "sent" does not undo "delivered"');
  assert.equal((await hook({ contacts: [{ wa_id: '27820000000', profile: { name: 'Sam' } }], messages: [{ from: '27820000000', id: 'wamid.in1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'The one on Main Street' } }] })).status, 200);
  await settle();
  let d = (await app.store.get(b.id)).data;
  assert.equal(d.messages.find((x) => x.id === m.id).whatsapp.status, 'delivered');
  const ans = d.messages.slice(-1)[0];
  assert.deepEqual([ans.from, ans.via, ans.text], ['client', 'whatsapp', 'The one on Main Street']);
  assert.equal(d.unread, true);
  assert.ok(app.mail.outbox.find((x) => x.to.includes('admin@example.com') && /Sam Client replied/.test(x.subject)), 'the Producer hears of it');
  // inside the 24 hours: a normal message, not the template; the reply clears "unread"
  const r2 = await admin.post(`/api/bookings/${b.id}/reply?team=${team}`, { text: 'Thanks, noted', email: false });
  m = r2.data.doc.data.messages.slice(-1)[0];
  assert.equal(m.email, null, 'email unticked');
  assert.equal(m.whatsapp.kind, 'text');
  assert.equal(wa.slice(-1)[0].body.text.body, 'Thanks, noted\n\nFollow your booking: https://site.example/track/' + key);
  assert.equal(r2.data.doc.data.unread, false);

  // the client writes on the tracking page
  tr = (await guest.post(`/api/public/track/${key}/message`, { text: 'Parking is behind the hall' })).data;
  assert.deepEqual(tr.messages.slice(-1)[0], { ...tr.messages.slice(-1)[0], from: 'client', by: 'You', text: 'Parking is behind the hall' });
  assert.ok(tr.messages.some((x) => x.from === 'us' && x.by === 'Test' && x.text.includes('which town hall')));
  assert.equal((await guest.post(`/api/public/track/${key}/message`, { text: '' })).status, 400);

  // saving the form never loses the conversation or the steps
  const before = (await app.store.get(b.id)).data;
  assert.equal((await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...before, messages: [], track: [], trackKey: 'x', notes: 'Main Street' } })).status, 200);
  d = (await app.store.get(b.id)).data;
  assert.equal(d.messages.length, before.messages.length); assert.equal(d.trackKey, key); assert.equal(d.notes, 'Main Street');

  // the steps follow the work: accepted (a production), quote sent, confirmed, crew booked, completed
  const acc = await admin.post(`/api/bookings/${b.id}/respond?team=${team}`, { accept: true });
  const pid = acc.data.production;
  await settle();
  assert.equal((await guest.get('/api/public/track/' + key)).data.stage, 'Being reviewed');
  let p = (await app.store.get(pid)).data;
  await app.save(team, 'production', pid, { ...p, invoices: [{ kind: 'quote', number: 'Q2099-001', status: 'Sent', lines: [] }] }, '');
  await settle();
  assert.equal((await guest.get('/api/public/track/' + key)).data.stage, 'Quote sent');
  assert.ok(app.mail.outbox.find((x) => x.to.includes('sam@example.com') && /^Quote sent/.test(x.subject)));
  p = (await app.store.get(pid)).data;
  assert.equal((await admin.put(`/api/docs/production/${pid}?team=${team}`, { data: { ...p, status: 'Confirmed' } })).status, 200);
  await settle();
  assert.equal((await guest.get('/api/public/track/' + key)).data.stage, 'Confirmed');
  p = (await app.store.get(pid)).data;
  await app.save(team, 'production', pid, { ...p, crew: [{ crewMember: 'crewMember_x', confirmed: true }] }, '');
  await settle();
  assert.equal((await guest.get('/api/public/track/' + key)).data.stage, 'Crew booked');
  // quiet: no more step messages; set by hand: the client sees that step
  d = (await app.store.get(b.id)).data;
  const waBefore = wa.length;
  assert.equal((await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...d, quiet: true } })).status, 200);
  p = (await app.store.get(pid)).data;
  await app.save(team, 'production', pid, { ...p, status: 'Completed' }, '');
  await settle();
  tr = (await guest.get('/api/public/track/' + key)).data;
  assert.equal(tr.stage, 'Completed');
  assert.ok(tr.steps.every((s) => s.done && (s.at || s.stage === 'Event day')), 'every step done, with its date (the event is far off: no "Event day" reached)');
  assert.equal(wa.length, waBefore, 'quiet');
  d = (await app.store.get(b.id)).data;
  assert.equal((await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...d, clientStage: 'Cancelled' } })).status, 200);
  await settle();
  tr = (await guest.get('/api/public/track/' + key)).data;
  assert.equal(tr.stage, 'Cancelled'); assert.equal(tr.ended, true);
  assert.equal(tr.steps.slice(-1)[0].stage, 'Cancelled');

  // a number WhatsApp cannot reach: the reply is kept, the failure shown; email still goes
  d = (await app.store.get(b.id)).data;
  await app.save(team, 'booking', b.id, { ...d, phone: '082 999 9999' }, '');
  const r3 = await admin.post(`/api/bookings/${b.id}/reply?team=${team}`, { text: 'Are you there?' });
  m = r3.data.doc.data.messages.slice(-1)[0];
  assert.deepEqual([m.email.ok, m.whatsapp.ok, m.whatsapp.error], [true, false, 'Recipient not on WhatsApp']);

  // only the allocated Producer (or an Admin) replies
  const other = client(app.url);
  await other.post('/api/auth/signup', { name: 'Other', email: 'other@example.com', password: 'correct horse' });
  await admin.post('/api/members?team=' + team, { email: 'other@example.com', role: 'Producer' });
  assert.equal((await other.post(`/api/bookings/${b.id}/reply?team=${team}`, { text: 'hi' })).status, 403);

  // with an app secret, the webhook needs Meta's signature
  await admin.post('/api/whatsapp/config', { appSecret: 'test-secret' });
  const val = { messages: [{ from: '27820000000', id: 'wamid.in2', timestamp: '1', type: 'text', text: { body: 'signed?' } }] };
  assert.equal((await hook(val)).status, 403);
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: val }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(raw).digest('hex');
  assert.equal((await fetch(app.url + '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw })).status, 200);
});
