'use strict';
// PayFast for more than streams: set up from Settings → Server, booking deposits (tracking page), invoices (client
// page and the invoice email's "Pay now"), and software on /software.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { boot, client, until } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { itnParamString, pfEncode } = require('../lib/pay');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

test('PayFast: settings, booking deposits, invoices paid online, software sold', async (t) => {
  const pf = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('VALID')); });
  await new Promise((r) => pf.listen(0, '127.0.0.1', r));
  t.after(() => pf.close());
  const PASS = 'test pass phrase';
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', publicName: 'RegemarkFP', siteAdmins: ['admin@example.com'], mail: { provider: 'test', from: 'RFP <rfp@example.com>' },
    payfast: { checkIp: false, validateUrl: `http://127.0.0.1:${pf.address().port}/eng/query/validate` }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const settle = async () => { await new Promise((r) => setTimeout(r, 400)); await app.bookings.idle(); await app.notify.idle(); };
  const itn = (id, amount) => {
    const pairs = [['m_payment_id', id], ['pf_payment_id', String(Math.floor(Math.random() * 1e7))], ['payment_status', 'COMPLETE'], ['item_name', 'x'], ['amount_gross', amount], ['amount_fee', '-2.30'], ['amount_net', String(Number(amount) - 2.3)], ['merchant_id', '10000100']];
    pairs.push(['signature', md5(itnParamString(pairs) + '&passphrase=' + pfEncode(PASS))]);
    return fetch(app.url + '/api/pay/payfast/itn', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(pairs).toString() }).then((r) => r.status);
  };
  const field = (r, k) => (r.fields.find((f) => f[0] === k) || [])[1];

  // switched on by a site admin; the key and passphrase never come back
  assert.equal((await admin.get('/api/config')).data.payments, false);
  assert.equal((await client(app.url).get('/api/pay/config')).status, 401);
  assert.equal((await admin.post('/api/pay/config', { merchantId: 'abc' })).status, 400);
  let c = (await admin.post('/api/pay/config', { merchantId: '10000100', merchantKey: '46f0cd694581a', passphrase: PASS, sandbox: true })).data;
  assert.deepEqual([c.on, c.sandbox, c.hasKey, c.hasPassphrase, c.merchantKey, c.passphrase], [true, true, true, true, undefined, undefined]);
  assert.equal(c.notifyUrl, 'https://site.example/api/pay/payfast/itn');
  assert.equal((await admin.get('/api/config')).data.payments, true);

  // ---- a booking's deposit, paid from its tracking page: Booked, the client sees Confirmed
  const guest = client(app.url);
  const key = (await guest.post('/api/public/booking', { name: 'Sam Client', email: 'sam@example.com', service: 'Streaming', date: '2099-01-10' })).data.track.slice(7);
  assert.equal((await guest.post(`/api/public/track/${key}/pay`, {})).status, 400, 'no deposit asked yet');
  const b = (await app.store.list(team, 'booking'))[0];
  assert.equal((await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...(await app.store.get(b.id)).data, producer: 'admin@example.com', deposit: 500 } })).status, 200);
  await settle();
  let tr = (await guest.get('/api/public/track/' + key)).data;
  assert.deepEqual(tr.deposit, { amount: 500, paid: false, at: 0, pay: true });
  let r = (await guest.post(`/api/public/track/${key}/pay`, {})).data;
  assert.equal(r.url, 'https://sandbox.payfast.co.za/eng/process');
  assert.equal(field(r, 'amount'), '500.00');
  assert.equal(field(r, 'email_address'), 'sam@example.com');
  assert.equal(field(r, 'return_url'), `https://site.example/track/${key}?paid=${r.id}`);
  assert.equal((await guest.get('/api/pay/status/' + r.id)).data.status, 'Pending');
  assert.equal(await itn(r.id, '500.00'), 200);
  await until(async () => (await app.store.get(b.id)).data.depositPaidAt, 5000, 'deposit paid');
  await settle();
  let d = (await app.store.get(b.id)).data;
  assert.equal(d.status, 'Booked'); assert.equal(d.depositPaid, 500);
  tr = (await guest.get('/api/public/track/' + key)).data;
  assert.equal(tr.stage, 'Confirmed');
  assert.equal(tr.deposit.paid, true); assert.equal(tr.deposit.pay, false);
  assert.ok(tr.messages.some((m) => /Deposit of R 500\.00 received/.test(m.text)));
  assert.equal((await guest.get('/api/pay/status/' + r.id)).data.status, 'Paid');
  assert.ok(app.mail.outbox.find((m) => m.to.includes('sam@example.com') && /Payment received/.test(m.subject)), 'receipt');
  assert.ok(app.mail.outbox.find((m) => m.to.includes('admin@example.com') && /Deposit paid: Sam Client/.test(m.subject)), 'the Producer hears');
  assert.equal((await guest.post(`/api/public/track/${key}/pay`, {})).status, 409, 'paid once');
  // saving the booking form keeps the deposit paid
  assert.equal((await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...d, depositPaidAt: 0, notes: 'x' } })).status, 200);
  assert.ok((await app.store.get(b.id)).data.depositPaidAt);

  // ---- an invoice paid online from the client page; the email has a "Pay now"
  await admin.put(`/api/docs/production/prod_x?team=${team}`, { data: { name: 'Cup final', date: '2099-01-10', client: 'Test Club', clientEmail: 'club@example.com' } });
  let prod = await app.store.get('prod_x');
  await app.save(team, 'production', prod.id, { ...prod.data, invoices: [{ kind: 'invoice', number: 'INV2099-001', date: '2099-01-01', due: '2099-01-31', status: 'Draft', vatRate: 15, lines: [{ label: 'Cameras', qty: 1, amount: 1000 }] }] }, '');
  await app.invoices.send(await app.store.get(prod.id), 'INV2099-001', {}, 'Test Admin');
  prod = await app.store.get(prod.id);
  const ck = prod.data.clientKey;
  assert.ok(ck, 'a client page made for paying');
  const mail = app.mail.outbox.find((m) => /Invoice INV2099-001/.test(m.subject));
  assert.ok(mail.text.includes(`https://site.example/client/${ck}?pay=INV2099-001`), mail.text);
  let cv = (await guest.get('/api/client/' + ck)).data;
  assert.equal(cv.invoices[0].pay, `/api/client/${ck}/pay/INV2099-001`);
  r = (await guest.post(cv.invoices[0].pay, {})).data;
  assert.equal(field(r, 'amount'), '1150.00');
  assert.equal(field(r, 'email_address'), 'club@example.com');
  assert.equal(await itn(r.id, '1150.00'), 200);
  await until(async () => ((await app.store.get(prod.id)).data.invoices[0].status === 'Paid'), 5000, 'invoice paid');
  cv = (await guest.get('/api/client/' + ck)).data;
  assert.deepEqual([cv.invoices[0].state, cv.invoices[0].pay], ['Paid', '']);
  assert.equal((await guest.post(`/api/client/${ck}/pay/INV2099-001`, {})).status, 409);
  assert.equal((await guest.post(`/api/client/${ck}/pay/NOPE`, {})).status, 404);

  // ---- software with a price: bought on the account, then it downloads
  const sp = await admin.post('/api/software', { name: 'CG Motion', slug: 'cg-motion', price: 250, visible: true });
  assert.ok([200, 201].includes(sp.status), JSON.stringify(sp.data));
  let page = (await guest.get('/api/public/software/cg-motion')).data;
  assert.deepEqual([page.canDownload, page.payments], [false, true], JSON.stringify(page));
  assert.equal((await guest.post('/api/public/software/cg-motion/buy', {})).status, 401, 'sign in first');
  const buyer = client(app.url);
  await buyer.post('/api/auth/signup', { name: 'Ben Buyer', email: 'ben@example.com', password: 'correct horse' });
  r = await buyer.post('/api/public/software/cg-motion/buy', {}); assert.equal(r.status, 200, JSON.stringify(r.data)); r = r.data;
  assert.equal(field(r, 'amount'), '250.00');
  assert.equal(field(r, 'return_url'), `https://site.example/software/cg-motion?paid=${r.id}`);
  assert.equal(await itn(r.id, '250.00'), 200);
  await until(async () => (await buyer.get('/api/public/software/cg-motion')).data.canDownload, 5000, 'download unlocked');
  assert.equal((await buyer.post('/api/public/software/cg-motion/buy', {})).status, 409);
  assert.equal((await guest.get('/api/public/software/cg-motion')).data.canDownload, false, 'only the buyer');
  assert.ok(app.mail.outbox.find((m) => m.to.includes('ben@example.com') && /CG Motion is yours/.test(m.subject)));
  // switched off: nothing can be paid
  await admin.post('/api/pay/config', { off: true });
  assert.equal((await admin.get('/api/config')).data.payments, false);
  assert.equal((await buyer.post('/api/public/software/cg-motion/buy', {})).status, 409);
});
