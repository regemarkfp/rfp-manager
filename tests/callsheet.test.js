'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { boot, client, seed } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { makePdf, loadImage, winAnsi } = require('../lib/pdf');
const { mimeBody } = require('../lib/mail');

// a 2×2 PNG with transparency
function tinyPng() {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 128, 2, 0, 0, 255, 255, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('pdf writer: text, tables over several pages, PNG with transparency', () => {
  const img = loadImage(tinyPng());
  assert.equal(img.w, 2); assert.equal(img.colors, 3); assert.ok(img.alpha);
  assert.deepEqual([...zlib.inflateSync(img.alpha)], [255, 128, 254, 128]);
  assert.deepEqual(winAnsi('A – é ×'), [65, 32, 0x96, 32, 0xe9, 32, 0xd7]);
  const doc = makePdf({ title: 'Test', footer: 'Footer text' });
  doc.image(img, doc.left, doc.y, 50, 50);
  doc.para([{ text: 'Bold: ', bold: true }, { text: 'a long line of words '.repeat(30) }]);
  doc.table([{ label: 'A' }, { label: 'B', w: 2 }], Array.from({ length: 80 }, (_, i) => ({ cells: ['Row ' + i, 'value ' + i], fill: i % 2 ? '#eeeeee' : '' })));
  const buf = doc.finish();
  const s = buf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /\/Count [2-9]/);
  assert.match(s, /\/SMask \d+ 0 R/);
  // the xref points at the objects
  const start = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.equal(s.slice(start, start + 4), 'xref');
  const first = /0000000000 65535 f \n(\d{10})/.exec(s)[1];
  assert.equal(s.slice(Number(first), Number(first) + 7), '1 0 obj');
});

test('mime: attachments go in multipart/mixed', () => {
  const lines = mimeBody('b1', 'hi', '<p>hi</p>', [{ filename: 'Call sheet – x.pdf', content: Buffer.from('%PDF-1.4 x'), contentType: 'application/pdf' }]).join('\r\n');
  assert.match(lines, /^Content-Type: multipart\/mixed; boundary="b1m"/);
  assert.match(lines, /Content-Type: multipart\/alternative; boundary="b1"/);
  assert.match(lines, /Content-Disposition: attachment; filename="Call sheet _ x\.pdf"; filename\*=UTF-8''Call%20sheet%20%E2%80%93%20x\.pdf/);
  assert.match(lines, new RegExp(Buffer.from('%PDF-1.4 x').toString('base64')));
  assert.match(lines, /--b1m--$/);
});

test('call sheets: PDF download, recipients, and emailing the crew (body + PDF)', async (t) => {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://rfp.example', mail: { provider: 'test', from: 'RFP Manager <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const out = cloud.mail.outbox;
  const admin = client(cloud.url);
  await admin.post('/api/auth/signup', { name: 'Admin A', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Productions' })).data.id;
  await seed(admin, team);
  const crewC = client(cloud.url);
  await crewC.post('/api/auth/signup', { name: 'Crew A', email: 'crew@example.com', password: 'correct horse' });
  await admin.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Crew' });

  const logo = await admin.post(`/api/images?team=${team}&name=logo`, tinyPng(), { 'content-type': 'image/png' });
  assert.equal(logo.status, 200, JSON.stringify(logo.data));
  const org = await cloud.store.get(team);
  await cloud.save(team, org.type, team, { ...org.data, image: logo.data.doc.id, address: '1 Test Road', phone: '000 000 0000' }, '');

  await admin.put(`/api/docs/crewMember/cm_one?team=${team}`, { data: { name: 'Crew', surname: 'A', email: 'crew@example.com', phone: '000 000 0001' } });
  await admin.put(`/api/docs/crewMember/cm_two?team=${team}`, { data: { name: 'Second', surname: 'Person', email: 'two@example.com' } });
  await admin.put(`/api/docs/crewMember/cm_three?team=${team}`, { data: { name: 'No', surname: 'Email' } });
  await admin.put(`/api/docs/crewRole/role_cam?team=${team}`, { data: { name: 'Camera operator' } });
  await admin.put(`/api/docs/crewRole/role_dir?team=${team}`, { data: { name: 'Director' } });
  await admin.put(`/api/docs/equipment/eq_cam?team=${team}`, { data: { name: 'Camera kit', category: 'Cameras' } });
  await admin.put(`/api/docs/production/prod_cs?team=${team}`, { data: { name: 'Saturday rugby', date: '2026-10-17', venue: 'venue_toyota', txTime: '15:00',
    contacts: [{ title: 'Producer', crewMember: 'cm_two' }], crewNotes: 'Parking: use gate 4\nBring headphones', hospitals: [{ name: 'Test Hospital', area: 'Centre', phone: '000 111' }],
    equipment: [{ item: 'eq_cam', quantity: 3, notes: 'with tripods' }], rundown: [{ startTime: '14:30', content: 'Opening', duration: '00:05:00', source: 'VT', color: '#fff3a0' }, { content: 'Kick off', duration: '40:00' }],
    crew: [{ crewMember: 'cm_one', role: 'role_cam', location: 'Venue', callTime: '09:00', confirmed: true }, { crewMember: 'cm_two', role: 'role_dir', location: 'Gallery', callTime: '08:00' }, { crewMember: 'cm_three', role: 'role_cam', location: 'Venue' }] } });

  // the PDF
  const pdf = await admin.get(`/api/productions/prod_cs/callsheet.pdf?team=${team}`);
  assert.equal(pdf.status, 200);
  if (process.env.CS_OUT) require('node:fs').writeFileSync(process.env.CS_OUT, pdf.data);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /Call sheet - Saturday rugby - 2026-10-17\.pdf/);
  assert.ok(pdf.data.subarray(0, 5).toString() === '%PDF-');
  assert.match(pdf.data.toString('latin1'), /\/Subtype \/Image/, 'the team logo');
  assert.equal((await crewC.get(`/api/productions/prod_cs/callsheet.pdf?team=${team}`)).status, 200, 'crew can read it');

  // recipients: Producers only
  assert.equal((await crewC.get(`/api/productions/prod_cs/callsheet/recipients?team=${team}`)).status, 403);
  const rec = (await admin.get(`/api/productions/prod_cs/callsheet/recipients?team=${team}`)).data;
  assert.equal(rec.mail, true);
  assert.deepEqual(rec.list.map((r) => [r.crewMember, r.hasEmail, r.confirmed]), [['cm_one', true, true], ['cm_three', false, false], ['cm_two', true, false]]);
  assert.equal((await crewC.post(`/api/productions/prod_cs/callsheet/send?team=${team}`, { to: ['cm_one'] })).status, 403);

  // send
  const before = out.length;
  const r = await admin.post(`/api/productions/prod_cs/callsheet/send?team=${team}`, { to: ['cm_one', 'cm_two', 'cm_three'], extra: 'client@example.com, nope', note: 'See you there' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sent, 3);
  assert.deepEqual(r.data.skipped.map((x) => x.why), ['no email address on their crew record', 'not an email address']);
  const mails = out.slice(before);
  assert.deepEqual(mails.map((m) => m.to[0]).sort(), ['client@example.com', 'crew@example.com', 'two@example.com']);
  const m = mails.find((x) => x.to[0] === 'crew@example.com');
  assert.match(m.subject, /Call sheet: Saturday rugby – Saturday, 17 October 2026/);
  assert.match(m.text, /Hi Crew, here is the call sheet/);
  assert.match(m.text, /You: Camera operator · Venue · call time 09:00/);
  assert.match(m.text, /See you there/);
  assert.match(m.text, /TEST PRODUCTIONS CALL SHEET/);
  assert.match(m.text, /Camera operator  ·  Crew A  ·  000 000 0001  ·  Call 09:00  ·  TX 15:00/);
  assert.match(m.text, /Parking  ·  use gate 4/);
  assert.match(m.text, /Cameras  ·  3 × Camera kit \(with tripods\)/);
  assert.match(m.text, /RUNDOWN\n1  ·  00:14:30|RUNDOWN\n1  ·  14:30/);
  assert.match(m.html, /font-weight:700">Camera operator/);
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'Call sheet - Saturday rugby - 2026-10-17.pdf');
  assert.ok(Buffer.from(m.attachments[0].content).subarray(0, 5).toString() === '%PDF-');

  assert.equal((await admin.post(`/api/productions/prod_cs/callsheet/send?team=${team}`, { to: ['cm_three'] })).status, 400, 'nobody with an email');
});
