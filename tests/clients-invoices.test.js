'use strict';
// Clients, products & services, quotes and invoices (RFPQ / RFPINV, booking fee, full editing), the client portal
// (signing quotes, paying, users, adverts in ad spaces) and importing from Invoice Ninja.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { boot, client, until } = require('./helpers');
const fakeMongo = require('./fake-mongo');

function tinyPng() {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 128, 2, 0, 0, 255, 255, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function setup(t, extra = {}) {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', siteAdmins: ['admin@example.com'], mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' }, ...extra }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Team' })).data.id;
  return { app, admin, team };
}

test('quotes and invoices: numbers, booking fee, client discount and rates, editing, signing in the portal, converting, payments', async (t) => {
  const { app, admin, team } = await setup(t);
  const q = (path) => `${path}${path.includes('?') ? '&' : '?'}team=${team}`;
  // a product and a client with a custom discount and their own price for it
  await admin.put(q('/api/docs/service/svc_day'), { data: { name: 'Full Day Tariff', description: 'Full day of work up to 10 hours', rate: 2000, unit: 'day', active: true } });
  await admin.put(q('/api/docs/client/cli_mega'), { data: { name: 'Test Client Co', email: 'accounts@client.example', address: '1 Test Road\nTest Town 1234', discount: 10, rates: [{ service: 'svc_day', rate: 1800 }], contacts: [{ name: 'Sam Contact', email: 'sam@client.example', primary: true }] } });
  await admin.put(q('/api/docs/production/prod_a'), { data: { name: 'Cup final', date: '2099-02-01', clientRef: 'cli_mega' } });

  // a quote from the production: RFPQ0001, the booking fee first, the client's discount
  let quote = (await admin.post(q('/api/productions/prod_a/invoices'), { kind: 'quote' })).data.doc;
  assert.equal(quote.number, 'RFPQ0001');
  assert.equal(quote.client, 'cli_mega');
  assert.deepEqual([quote.lines[0].item, quote.lines[0].rate, quote.lines[0].fee], ['Booking fee', 1500, true]);
  assert.match(quote.lines[0].description, /Secures your date/);
  assert.equal(quote.discount, 10);
  // the client's own rate for a service line
  const made = (await admin.post(q('/api/invoices'), { kind: 'quote', client: 'cli_mega', lines: [{ item: 'Full Day Tariff', service: 'svc_day', rate: 2000, qty: 2, date: '2099-02-01' }] })).data.doc;
  assert.equal(made.number, 'RFPQ0002');
  assert.equal(made.lines[1].rate, 1800);

  // everything editable: lines with dates and discounts, an amount off, VAT, the number itself
  quote = (await admin.put(q(`/api/invoices/${quote.id}`), { lines: [...quote.lines, { item: 'Full Day Tariff', date: '2099-02-01', description: 'Up to 10 hours', rate: 2000, qty: 2, discount: 25 }, { item: 'Travel', rate: 4.5, qty: 395 }],
    discount: 500, discountType: 'amount', vatRate: 15, notes: 'Thank you', title: 'Cup final' })).data.doc;
  // 1500 + 3000 (2×2000 less 25%) + 1777.50 = 6277.50; less 500 = 5777.50; VAT 866.63 → 6644.13
  assert.deepEqual([quote.net, quote.discountAmount, quote.subtotal, quote.vat, quote.total], [6277.5, 500, 5777.5, 866.63, 6644.13]);
  assert.equal((await admin.put(q(`/api/invoices/${quote.id}`), { number: 'RFPQ0002' })).status, 409, 'numbers are unique');

  // the PDF in RegemarkFP's layout
  const pdf = await fetch(app.url + q(`/api/invoices/${quote.id}/pdf`), { headers: { cookie: admin.cookie() } });
  assert.equal(pdf.status, 200);
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.slice(0, 5).toString(), '%PDF-');

  // emailed: the client gets the PDF and their portal, where they sign it
  const sent = (await admin.post(q(`/api/invoices/${quote.id}/send`), {})).data;
  assert.equal(sent.to, 'accounts@client.example');
  const mail = app.mail.outbox.find((m) => /Quote RFPQ0001/.test(m.subject));
  assert.ok(mail.attachments && mail.attachments[0].filename.endsWith('.pdf'));
  assert.ok(mail.text.includes(sent.portal) && /Review and sign/.test(mail.text), mail.text);
  const key = sent.portal.split('/portal/')[1];
  const guest = client(app.url);
  let pv = (await guest.get('/api/portal/' + key)).data;
  assert.equal(pv.client.name, 'Test Client Co');
  assert.deepEqual(pv.docs.map((d) => d.number), ['RFPQ0001'], 'drafts are not shown');
  const doc = pv.docs[0];
  assert.ok(doc.sign);
  assert.equal((await fetch(app.url + doc.pdf)).status, 200);
  assert.equal((await guest.post(doc.sign, { name: 'Sam Contact', image: 'data:image/png;base64,' + tinyPng().toString('base64') })).status, 400, 'must agree');
  assert.equal((await guest.post(doc.sign, { name: 'Sam Contact', agree: true })).status, 400, 'must sign');
  const signed = await guest.post(doc.sign, { name: 'Sam Contact', agree: true, image: 'data:image/png;base64,' + tinyPng().toString('base64') });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  quote = await app.invoices.one(team, quote.id);
  assert.equal(quote.status, 'Accepted');
  assert.equal(quote.signature.name, 'Sam Contact');
  assert.equal((await app.store.get('prod_a')).data.status, 'Confirmed', 'a signed quote confirms the production');
  assert.equal((await guest.post(doc.sign, { name: 'X', agree: true, image: 'data:image/png;base64,' + tinyPng().toString('base64') })).status, 409, 'signed once');
  await app.notify.idle();
  assert.ok(app.mail.outbox.find((m) => m.to.includes('admin@example.com') && /Quote RFPQ0001 signed by Sam Contact/.test(m.subject)));
  const signedPdf = await fetch(app.url + doc.pdf);
  assert.ok(Buffer.from(await signedPdf.arrayBuffer()).length > buf.length, 'the signature is on the PDF');

  // the quote becomes an invoice: RFPINV0001 with the same lines; payments make it Partial then Paid
  let inv = (await admin.post(q(`/api/invoices/${quote.id}/convert`), {})).data.doc;
  assert.equal(inv.number, 'RFPINV0001');
  assert.equal(inv.total, 6644.13);
  assert.equal((await admin.post(q(`/api/invoices/${quote.id}/convert`), {})).status, 409);
  inv = (await admin.put(q(`/api/invoices/${inv.id}`), { status: 'Sent' })).data.doc;
  inv = (await admin.post(q(`/api/invoices/${inv.id}/payments`), { amount: 3322.07, method: 'EFT', ref: 'ABC' })).data.doc;
  assert.deepEqual([inv.status, inv.paid, inv.balance], ['Partial', 3322.07, 3322.06]);
  inv = (await admin.put(q(`/api/invoices/${inv.id}`), { status: 'Paid' })).data.doc;
  assert.deepEqual([inv.status, inv.balance, inv.payments.length], ['Paid', 0, 2]);
  inv = (await admin.del(q(`/api/invoices/${inv.id}/payments/1`))).data.doc;
  assert.deepEqual([inv.status, inv.balance], ['Partial', 3322.06]);

  // carrying on from Invoice Ninja's numbers; the booking fee can be changed or switched off
  const b = (await admin.put(q('/api/billing'), { nextInvoice: 557, bookingFee: 1750, bookingFeeText: 'Reserves the day', tagline: 'Capturing life in motion', conditions: '1. Definitions\nTerms here.\n- A point' })).data;
  assert.equal(b.nextInvoiceNumber, 'RFPINV0557');
  const n = (await admin.post(q('/api/invoices'), { kind: 'invoice', client: 'cli_mega' })).data.doc;
  assert.deepEqual([n.number, n.lines[0].rate, n.lines[0].description], ['RFPINV0557', 1750, 'Reserves the day']);
  await admin.put(q('/api/billing'), { bookingFeeOn: false });
  assert.equal((await admin.post(q('/api/invoices'), { kind: 'invoice' })).data.doc.lines.length, 0);
  assert.equal((await fetch(app.url + q(`/api/invoices/${n.id}/pdf`), { headers: { cookie: admin.cookie() } })).status, 200);

  // the overview
  const ov = (await admin.get(q('/api/invoices'))).data;
  assert.equal(ov.owed, 3322.06);
  // crew can't see any of it
  const crew = client(app.url);
  await crew.post('/api/auth/signup', { name: 'Crew', email: 'crew@example.com', password: 'correct horse' });
  await admin.post(q('/api/members'), { email: 'crew@example.com', role: 'Crew' });
  assert.equal((await crew.get(q('/api/invoices'))).status, 403);
  assert.ok(!(await crew.get(q('/api/docs'))).data.docs.some((d) => d.type === 'invoice' || d.type === 'client'));
});

test('client portal: colleagues, adverts in ad spaces (pending, invoiced), the team\'s view', async (t) => {
  const { app, admin, team } = await setup(t);
  const q = (path) => `${path}${path.includes('?') ? '&' : '?'}team=${team}`;
  await admin.put(q('/api/docs/client/cli_sch'), { data: { name: 'Sponsor School', email: 'office@school.example' } });
  await admin.put(q('/api/docs/adSlot/slot_free'), { data: { name: 'Corner logo', sport: 'General', layout: 'Corner bug', width: 300, height: 150, active: true } });
  await admin.put(q('/api/docs/adSlot/slot_paid'), { data: { name: 'Lower banner', sport: 'General', layout: 'Lower banner', width: 1920, height: 200, price: 2500, period: 'month', active: true } });
  // the team invites someone; they get their own link
  assert.equal((await admin.post(q('/api/clients/cli_sch/portal'), { email: 'Head@School.example', name: 'Head' })).status, 200);
  await app.notify.idle();
  const inviteMail = app.mail.outbox.find((m) => m.to.includes('head@school.example'));
  const link = /https:\/\/site\.example\/portal\/[\w-]+/.exec(inviteMail.text)[0];
  const key = link.split('/portal/')[1];
  const head = client(app.url);
  let pv = (await head.get('/api/portal/' + key)).data;
  assert.deepEqual(pv.users.map((u) => u.email), ['head@school.example']);
  assert.deepEqual(pv.slots.map((s) => s.name).sort(), ['Corner logo', 'Lower banner']);
  // they add a colleague, who can be taken off again (and their link stops working)
  assert.equal((await head.post(`/api/portal/${key}/users`, { email: 'bursar@school.example', name: 'Bursar' })).status, 200);
  const bursarKey = /portal\/([\w-]+)/.exec(app.mail.outbox.find((m) => m.to.includes('bursar@school.example')).text)[1];
  assert.equal((await head.get('/api/portal/' + bursarKey)).status, 200);
  assert.equal((await head.del(`/api/portal/${key}/users/${encodeURIComponent('bursar@school.example')}`)).status, 200);
  assert.equal((await head.get('/api/portal/' + bursarKey)).status, 404);

  // an advert for the free space: Pending, no invoice; for the paid one: an invoice to pay (no booking fee on it)
  const up = (slot, name) => fetch(`${app.url}/api/portal/${key}/ads?slot=${slot}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-rfp': '1' }, body: tinyPng() }).then(async (r) => ({ status: r.status, data: await r.json() }));
  let r = await up('slot_free', 'Our logo');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.invoice, null);
  let ad = await app.store.get(r.data.advert);
  assert.deepEqual([ad.data.approval, ad.data.client, ad.data.layout, ad.data.width, ad.data.sponsor], ['Pending', 'cli_sch', 'Corner bug', 300, 'Sponsor School']);
  r = await up('slot_paid', 'Big banner');
  assert.equal(r.data.invoice.total, 2500);
  const inv = await app.invoices.one(team, r.data.invoice.id);
  assert.deepEqual([inv.status, inv.lines.length, inv.lines[0].item], ['Sent', 1, 'Sponsorship – Lower banner']);
  pv = (await head.get('/api/portal/' + key)).data;
  assert.equal(pv.ads.length, 2);
  assert.equal(pv.owed, 2500);
  assert.equal((await up('nope', 'x')).status, 404);
  // a pending advert can be taken off by the client; an approved one not
  assert.equal((await head.del(`/api/portal/${key}/ads/${ad.id}`)).status, 200);
  await admin.put(q(`/api/docs/advert/${pv.ads.find((a) => a.name === 'Big banner').id}`), { data: { ...(await app.store.get(pv.ads.find((a) => a.name === 'Big banner').id)).data, approval: 'Approved' } });
  assert.equal((await head.del(`/api/portal/${key}/ads/${pv.ads.find((a) => a.name === 'Big banner').id}`)).status, 409);
  await app.notify.idle();
  assert.ok(app.mail.outbox.find((m) => m.to.includes('admin@example.com') && /New advert from Sponsor School/.test(m.subject)));
  // the team's view of the portal
  const tv = (await admin.get(q('/api/clients/cli_sch/portal'))).data;
  assert.deepEqual(tv.users.map((u) => u.email), ['head@school.example']);
  assert.equal((await admin.del(q(`/api/clients/cli_sch/portal/${encodeURIComponent('head@school.example')}`))).status, 200);
  assert.equal((await head.get('/api/portal/' + key)).status, 404);
});

test('Invoice Ninja: clients, products, quotes and invoices come across; numbering carries on', async (t) => {
  const seen = [];
  const ninja = http.createServer((req, res) => {
    seen.push(req.url);
    if (req.headers['x-api-token'] !== 'tok_0123456789abcdefghijklmnop') { res.writeHead(401); return res.end('{}'); }
    const u = new URL(req.url, 'http://x'), json = (data, pages = 1) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data, meta: { pagination: { total_pages: pages } } })); };
    if (u.pathname === '/api/v1/clients') return json(u.searchParams.get('page') === '1' ? [{ id: 'c1', name: 'Mega Test', vat_number: '4730000000', address1: '2 Test Road', city: 'Johannesburg', postal_code: '2191', phone: '011 000 0000', contacts: [{ first_name: 'Sean', last_name: 'T', email: 'sean@mega.example', is_primary: true }] }]
      : [{ id: 'c2', name: 'Second Client', contacts: [] }], 2);
    if (u.pathname === '/api/v1/products') return json([{ id: 'p1', product_key: 'Full Day Tariff', notes: 'Booking fee for full day of work up to 10 Hours', price: 2000, cost: 0 }, { id: 'p2', product_key: 'Travel', notes: 'Per kilometre', price: 4.5 }]);
    if (u.pathname === '/api/v1/invoices') return json([{ id: 'i1', number: 'RFPINV0556', client_id: 'c1', date: '2026-10-28', due_date: '2026-11-28', status_id: '2', amount: 5777.5, balance: 5777.5, paid_to_date: 0, discount: 0, is_amount_discount: false, tax_rate1: 0,
      line_items: [{ product_key: 'Full Day Tariff', notes: 'Booking fee for full day', cost: 2000, quantity: 2, discount: 0, custom_value1: '24-Sep-2026' }, { product_key: 'Travel', notes: 'To and from', cost: 4.5, quantity: 395, discount: 0, custom_value1: '2026-09-24' }], terms: 'Banking details' },
    { id: 'i2', number: 'RFPINV0555', client_id: 'c2', date: '2026-10-01', due_date: '2026-10-31', status_id: '4', amount: 1000, balance: 0, paid_to_date: 1000, line_items: [{ product_key: 'Video Camera', notes: '', cost: 500, quantity: 2 }] }]);
    if (u.pathname === '/api/v1/quotes') return json([{ id: 'q1', number: 'RFPQ0042', client_id: 'c1', date: '2026-10-20', due_date: '2026-11-20', status_id: '3', amount: 2000, line_items: [{ product_key: 'Full Day Tariff', cost: 2000, quantity: 1 }] }]);
    if (/\/download$/.test(u.pathname)) { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end('%PDF-1.4\n' + 'x'.repeat(200)); }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => ninja.listen(0, '127.0.0.1', r));
  t.after(() => ninja.close());
  const { app, admin, team } = await setup(t);
  const q = (path) => `${path}${path.includes('?') ? '&' : '?'}team=${team}`;
  const base = `http://127.0.0.1:${ninja.address().port}`;
  assert.equal((await admin.post(q('/api/invoices/import/invoiceninja'), { url: base, token: 'short' })).status, 400);
  assert.equal((await admin.post(q('/api/invoices/import/invoiceninja'), { url: base, token: 'tok_0123456789abcdefghijklmnop' })).status, 200);
  await until(async () => !(await admin.get(q('/api/invoices/import/invoiceninja'))).data.running, 8000, 'import done');
  const st = (await admin.get(q('/api/invoices/import/invoiceninja'))).data;
  assert.ok(!st.error, st.error);
  assert.deepEqual(st.counts, { clients: 2, products: 2, quotes: 1, invoices: 2, pdfs: 3, skipped: 0 });
  const clients = (await app.store.list(team, 'client')).filter((d) => !d.deleted);
  const mega = clients.find((c) => c.data.name === 'Mega Test');
  assert.deepEqual([mega.data.vatNo, mega.data.contacts[0].email, mega.data.address], ['4730000000', 'sean@mega.example', '2 Test Road\nJohannesburg, 2191']);
  assert.deepEqual((await app.store.list(team, 'service')).map((s) => s.data.name).sort(), ['Full Day Tariff', 'Travel']);
  const docs = await app.invoices.list(team);
  const i556 = docs.find((d) => d.number === 'RFPINV0556');
  assert.deepEqual([i556.client, i556.status, i556.total, i556.lines[0].date, i556.lines[1].date, i556.terms], [mega.id, 'Sent', 5777.5, '2026-09-24', '2026-09-24', 'Banking details']);
  assert.ok(i556.source.pdf, 'a copy of the Invoice Ninja PDF');
  const i555 = docs.find((d) => d.number === 'RFPINV0555');
  assert.deepEqual([i555.status, i555.balance], ['Paid', 0]);
  assert.equal(docs.find((d) => d.number === 'RFPQ0042').status, 'Accepted');
  // carrying on: the next invoice is RFPINV0557, the next quote RFPQ0043
  assert.equal((await admin.post(q('/api/invoices'), { kind: 'invoice', client: mega.id })).data.doc.number, 'RFPINV0557');
  assert.equal((await admin.post(q('/api/invoices'), { kind: 'quote', client: mega.id })).data.doc.number, 'RFPQ0043');
  // running it again updates instead of doubling
  await admin.post(q('/api/invoices/import/invoiceninja'), { url: base, token: 'tok_0123456789abcdefghijklmnop' });
  await until(async () => !(await admin.get(q('/api/invoices/import/invoiceninja'))).data.running, 8000, 'second import done');
  assert.equal((await app.store.list(team, 'client')).filter((d) => !d.deleted).length, 2);
  assert.equal((await app.invoices.list(team)).filter((d) => d.number === 'RFPINV0556').length, 1);
  assert.ok(seen.some((s) => /download/.test(s)));
  assert.equal((await admin.post(q('/api/invoices/import/invoiceninja'), { url: base, token: 'wrong_token_wrong_token_wrong' })).status, 200);
  await until(async () => !(await admin.get(q('/api/invoices/import/invoiceninja'))).data.running, 8000, 'bad token run done');
  assert.match((await admin.get(q('/api/invoices/import/invoiceninja'))).data.error, /did not accept the token/);
});

test('quotes and invoices kept on productions before move to their own records', async (t) => {
  const { app, team } = await setup(t);
  await app.save(team, 'production', 'prod_old', { name: 'Old show', date: '2026-05-01', client: 'Old Client', clientEmail: 'old@example.com', invoices: [{ id: 'x', kind: 'invoice', number: 'INV2026-001', date: '2026-05-02', due: '2026-05-16', status: 'Paid', vatRate: 15, lines: [{ label: 'Cameras', qty: 2, amount: 500 }], paidAt: Date.now() }] }, '');
  assert.equal(await app.invoices.migrate(), 1);
  const docs = await app.invoices.list(team);
  assert.deepEqual([docs[0].number, docs[0].production, docs[0].clientName, docs[0].total, docs[0].balance, docs[0].status], ['INV2026-001', 'prod_old', 'Old Client', 1150, 0, 'Paid']);
  assert.deepEqual((await app.store.get('prod_old')).data.invoices, []);
  assert.equal(await app.invoices.migrate(), 0, 'once');
});
