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

test('whatsapp linked like WhatsApp Web (Baileys, faked here): link, send, replies, ticks, logged out', async (t) => {
  const { EventEmitter } = require('node:events');
  const fs = require('node:fs'), path = require('node:path');
  const sockets = [], sentMsgs = [];
  const fakeLib = {
    make: (opts) => {
      const ev = new EventEmitter();
      const s = { ev, opts, user: null, signalRepository: { lidMapping: { getPNForLID: async (lid) => (lid === '999@lid' ? '27820000000@s.whatsapp.net' : null) } },
        end: () => {}, logout: async () => {},
        requestPairingCode: async (n) => { s.paired = n; return 'ABCD1234'; },
        onWhatsApp: async (jid) => [{ jid, exists: !jid.startsWith('27829999999') }],
        sendMessage: async (jid, content) => { const id = 'LNK' + (sentMsgs.length + 1); sentMsgs.push({ jid, content, id }); return { key: { id, remoteJid: jid, fromMe: true } }; } };
      sockets.push(s);
      setTimeout(() => ev.emit('connection.update', { qr: '2@fake-qr' }), 5);
      return s;
    },
    useMultiFileAuthState: async (dir) => ({ state: { creds: { registered: false } }, saveCreds: async () => { fs.writeFileSync(path.join(dir, 'creds.json'), '{}'); } }),
    DisconnectReason: { loggedOut: 401, restartRequired: 515 },
    Browsers: { ubuntu: (b) => ['Ubuntu', b, '22.04.4'] },
    qrcode: { toDataURL: async (t) => 'data:image/png;base64,' + Buffer.from(t).toString('base64') }
  };
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', publicName: 'RegemarkFP', siteAdmins: ['admin@example.com'], mail: { provider: 'test', from: 'RFP <rfp@example.com>' },
    whatsapp: { loadLib: async () => fakeLib, gapMs: 0 }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const settle = async () => { await new Promise((r) => setTimeout(r, 400)); await app.bookings.idle(); await app.notify.idle(); };
  const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timed out'); };

  assert.equal((await client(app.url).post('/api/whatsapp/link', {})).status, 401);
  // link with a QR code
  await admin.post('/api/whatsapp/link', {});
  let L = await waitFor(async () => { const x = (await admin.get('/api/whatsapp/link')).data; return x.state === 'waiting' && x; });
  assert.match(L.qr, /^data:image\/png;base64,/);
  assert.equal((await admin.get('/api/whatsapp/config')).data.mode, 'linked');
  assert.equal((await admin.get('/api/config')).data.whatsapp, false, 'not until the phone has linked');
  const s = sockets.slice(-1)[0];
  s.user = { id: '27831112222:7@s.whatsapp.net', name: 'RegemarkFP' };
  s.ev.emit('connection.update', { connection: 'open' });
  L = (await admin.get('/api/whatsapp/link')).data;
  assert.deepEqual([L.state, L.me], ['open', '27831112222']);
  assert.equal((await admin.get('/api/config')).data.whatsapp, true);

  // a booking: the step update and a reply go from the linked phone, as plain text with the link
  const sent = await client(app.url).post('/api/public/booking', { name: 'Sam Client', email: 'sam@example.com', phone: '082 000 0000', service: 'Streaming', date: '2099-01-10' });
  const key = sent.data.track.slice(7);
  const b = (await app.store.list(team, 'booking'))[0];
  await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...(await app.store.get(b.id)).data, producer: 'admin@example.com' } });
  await settle();
  assert.equal(sentMsgs.length, 1);
  assert.equal(sentMsgs[0].jid, '27820000000@s.whatsapp.net');
  assert.equal(sentMsgs[0].content.text, 'A producer is looking at your request.\n\nFollow your booking: https://site.example/track/' + key);
  const r = await admin.post(`/api/bookings/${b.id}/reply?team=${team}`, { text: 'Hi Sam' });
  let m = r.data.doc.data.messages.slice(-1)[0];
  assert.deepEqual([m.whatsapp.ok, m.whatsapp.kind, m.whatsapp.id], [true, 'linked', 'LNK2']);

  // the client answers from a "@lid" address WhatsApp now uses: matched to the phone number, then to the booking
  s.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: '999@lid', id: 'IN1', fromMe: false }, pushName: 'Sam', messageTimestamp: 1, message: { conversation: 'Hello back' } }] });
  s.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: '123@g.us', id: 'G1', fromMe: false }, message: { conversation: 'group chatter' } }] });
  s.ev.emit('messages.update', [{ key: { id: 'LNK2', fromMe: true, remoteJid: '999@lid' }, update: { status: 4 } }]);
  await settle();
  const d = (await app.store.get(b.id)).data;
  assert.deepEqual(d.messages.filter((x) => x.from === 'client').map((x) => [x.text, x.via]), [['Hello back', 'whatsapp']]);
  assert.equal(d.messages.find((x) => x.whatsapp && x.whatsapp.id === 'LNK2').whatsapp.status, 'read');

  // a number not on WhatsApp: kept, with the reason
  await app.save(team, 'booking', b.id, { ...d, phone: '082 999 9999' }, '');
  m = (await admin.post(`/api/bookings/${b.id}/reply?team=${team}`, { text: 'Hello?' })).data.doc.data.messages.slice(-1)[0];
  assert.deepEqual([m.whatsapp.ok, m.whatsapp.error], [false, 'This number is not on WhatsApp']);

  // the phone unlinks the website: off, and it says so
  s.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  L = (await admin.get('/api/whatsapp/link')).data;
  assert.equal(L.state, 'off'); assert.match(L.error, /unlinked/);
  assert.equal((await admin.get('/api/config')).data.whatsapp, false);
  // linking with a code instead of a QR
  await admin.post('/api/whatsapp/link', { phone: '083 111 2222' });
  L = await waitFor(async () => { const x = (await admin.get('/api/whatsapp/link')).data; return x.code && x; });
  assert.equal(L.code, 'ABCD1234'); assert.equal(sockets.slice(-1)[0].paired, '27831112222');
  assert.equal((await admin.del('/api/whatsapp/link')).status, 200);
  assert.equal((await admin.get('/api/whatsapp/link')).data.state, 'off');
});
