'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { boot, client, until } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { formSignature, itnParamString, pfEncode, inRange } = require('../lib/pay');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

test('PayFast signature encoding', () => {
  assert.equal(pfEncode('Saturday rugby – ticket'), 'Saturday+rugby+%E2%80%93+ticket');
  assert.equal(pfEncode("it's (live)! ~*"), 'it%27s+%28live%29%21+%7E%2A');
  assert.equal(pfEncode(' a@b.co '), 'a%40b.co');
  const pairs = [['merchant_id', '10000100'], ['merchant_key', '46f0cd694581a'], ['name_first', ''], ['amount', '50.00'], ['item_name', 'A ticket']];
  assert.equal(formSignature(pairs, 'my pass'), md5('merchant_id=10000100&merchant_key=46f0cd694581a&amount=50.00&item_name=A+ticket&passphrase=my+pass'));
  assert.equal(formSignature(pairs, ''), md5('merchant_id=10000100&merchant_key=46f0cd694581a&amount=50.00&item_name=A+ticket'));
  assert.equal(itnParamString([['a', '1'], ['b', ''], ['signature', 'x'], ['c', 'x y']]), 'a=1&b=&c=x+y');
  assert.ok(inRange('197.97.145.150', '197.97.145.144/28'));
  assert.ok(!inRange('197.97.145.160', '197.97.145.144/28'));
});

test('paid streams: tickets and channel passes through PayFast, ticket links, who may watch, sales', async (t) => {
  // a stand-in for PayFast's confirmation call
  const confirms = [];
  let answer = 'VALID';
  const pf = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { confirms.push(b); res.end(answer); }); });
  await new Promise((r) => pf.listen(0, '127.0.0.1', r));
  t.after(() => pf.close());
  const PASS = 'test pass phrase';
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://tv.example.com', mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' },
    streaming: { host: 'tv.example.com', api: '', hookSecret: 'hook-secret' },
    payfast: { merchantId: '10000100', merchantKey: '46f0cd694581a', passphrase: PASS, sandbox: true, checkIp: false, validateUrl: `http://127.0.0.1:${pf.address().port}/eng/query/validate` } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const admin = client(cloud.url);
  assert.equal((await admin.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' })).status, 200);
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  assert.equal((await admin.get('/api/config')).data.payments, true);
  assert.equal((await admin.put(`/api/docs/channel/chan_tv?team=${team}`, { data: { name: 'RegemarkFP TV', passPrice: 120, passDays: 30 } })).status, 200);
  assert.equal((await admin.put(`/api/docs/production/prod_final?team=${team}`, { data: { name: 'Cup final', date: '2026-11-07', streamChannel: 'chan_tv', streamPrice: 50 } })).status, 200);
  assert.equal((await admin.put(`/api/docs/production/prod_semi?team=${team}`, { data: { name: 'Cup semi', date: '2026-10-31', streamChannel: 'chan_tv', streamPrice: 40 } })).status, 200);
  assert.equal((await admin.put(`/api/docs/production/prod_free?team=${team}`, { data: { name: 'Club day', date: '2026-10-24', streamChannel: 'chan_tv' } })).status, 200);
  const slug = (await cloud.store.get('prod_final')).data.streamSlug;
  const semi = (await cloud.store.get('prod_semi')).data.streamSlug;
  const free = (await cloud.store.get('prod_free')).data.streamSlug;
  const allow = (s, token) => cloud.streaming.allow({ action: 'read', path: 'live/' + s, token: token || '', ip: '1.2.3.4' });

  // free stays free; a paid stream asks for a ticket, also on the public site and in MediaMTX
  assert.equal((await client(cloud.url).get('/api/watch/' + free)).data.needs, null);
  assert.equal(await allow(free), true);
  const guest = client(cloud.url);
  let w = (await guest.get('/api/watch/' + slug)).data;
  assert.equal(w.needs, 'ticket');
  assert.equal(w.price.ticket, 50);
  assert.deepEqual(w.price.pass, { amount: 120, days: 30 });
  assert.equal(w.payments, true);
  assert.equal(await allow(slug), false, 'no token, no video');
  const home = (await guest.get('/api/public/home')).data;
  assert.equal([...(home.upcoming || []), ...(home.live || [])].find((s) => s.slug === slug).price.ticket, 50);
  // the team itself watches without paying
  assert.equal((await admin.get('/api/watch/' + slug)).data.needs, null);

  // a guest buys a ticket with an email address
  assert.equal((await guest.post('/api/pay/start', { slug, kind: 'ticket' })).status, 400);
  const st = await guest.post('/api/pay/start', { slug, kind: 'ticket', email: 'Fan@Example.com', name: 'Sam Fan' });
  assert.equal(st.status, 200, JSON.stringify(st.data));
  const fields = st.data.fields;
  assert.equal(st.data.url, 'https://sandbox.payfast.co.za/eng/process');
  const f = Object.fromEntries(fields);
  assert.equal(f.amount, '50.00');
  assert.equal(f.email_address, 'fan@example.com');
  assert.equal(f.notify_url, 'https://tv.example.com/api/pay/payfast/itn');
  assert.match(f.return_url, /^https:\/\/tv\.example\.com\/watch\/.+\?paid=pur_/);
  assert.equal(fields[fields.length - 1][0], 'signature');
  assert.equal(f.signature, formSignature(fields.slice(0, -1), PASS));
  assert.equal((await guest.get('/api/pay/status/' + st.data.id)).data.status, 'Pending');

  // PayFast's notification
  const itn = (id, amount, status = 'COMPLETE', sigOverride) => {
    const pairs = [['m_payment_id', id], ['pf_payment_id', String(Math.floor(Math.random() * 1e7))], ['payment_status', status], ['item_name', 'x'], ['item_description', ''],
      ['amount_gross', amount], ['amount_fee', '-2.30'], ['amount_net', String(Number(amount) - 2.3)], ['name_first', 'Sam'], ['name_last', 'Fan'], ['email_address', 'fan@example.com'], ['merchant_id', '10000100']];
    pairs.push(['signature', sigOverride || md5(itnParamString(pairs) + '&passphrase=' + pfEncode(PASS))]);
    return fetch(cloud.url + '/api/pay/payfast/itn', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(pairs).toString() }).then((r) => r.status);
  };
  // forged or wrong ones change nothing
  assert.equal(await itn(st.data.id, '50.00', 'COMPLETE', 'f'.repeat(32)), 200);
  assert.equal(await itn(st.data.id, '5.00'), 200);
  answer = 'INVALID';
  assert.equal(await itn(st.data.id, '50.00'), 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await guest.get('/api/pay/status/' + st.data.id)).data.status, 'Pending');
  answer = 'VALID';
  assert.equal(await itn(st.data.id, '50.00'), 200);
  await until(async () => (await guest.get('/api/pay/status/' + st.data.id)).data.status === 'Paid', 3000, 'ticket paid');
  assert.match(confirms[confirms.length - 1], /^m_payment_id=pur_.*&merchant_id=10000100$/);
  const ticket = (await guest.get('/api/pay/status/' + st.data.id)).data.ticket;
  assert.match(ticket, /^tk_pur_/);
  // a late "cancelled" does not undo it
  await itn(st.data.id, '50.00', 'CANCELLED');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await guest.get('/api/pay/status/' + st.data.id)).data.status, 'Paid');

  // the ticket opens the stream (and its token opens MediaMTX); not another paid stream; a made-up ticket does nothing
  w = (await guest.get('/api/watch/' + slug, { 'x-rfp-tickets': ticket })).data;
  assert.equal(w.needs, null);
  assert.ok(w.token);
  assert.equal(await allow(slug, w.token), true);
  assert.equal((await guest.get('/api/watch/' + slug + '?ticket=' + encodeURIComponent(ticket))).data.needs, null);
  assert.equal((await guest.get('/api/watch/' + semi, { 'x-rfp-tickets': ticket })).data.needs, 'ticket');
  assert.equal((await guest.get('/api/watch/' + slug, { 'x-rfp-tickets': ticket.slice(0, -2) + 'xx' })).data.needs, 'ticket');
  // the ticket email
  await cloud.notify.idle();
  const mail = cloud.mail.outbox.find((m) => m.to.includes('fan@example.com'));
  assert.ok(mail, 'ticket email');
  assert.match(mail.subject, /Your ticket: Cup final/);
  assert.ok(mail.text.includes(`https://tv.example.com/watch/${slug}?ticket=${ticket}`));

  // a signed-in viewer buys a channel pass: every paid stream on the channel, on their account
  const fan = client(cloud.url);
  assert.equal((await fan.post('/api/auth/signup', { name: 'Pat Viewer', email: 'pat@example.com', password: 'correct horse' })).status, 200);
  const ps = await fan.post('/api/pay/start', { slug: semi, kind: 'pass' });
  assert.equal(ps.status, 200, JSON.stringify(ps.data));
  assert.equal(Object.fromEntries(ps.data.fields).amount, '120.00');
  assert.equal(Object.fromEntries(ps.data.fields).email_address, 'pat@example.com');
  assert.equal(await itn(ps.data.id, '120.00'), 200);
  await until(async () => (await fan.get('/api/pay/status/' + ps.data.id)).data.status === 'Paid', 3000, 'pass paid');
  assert.equal((await fan.get('/api/watch/' + semi)).data.needs, null);
  assert.equal((await fan.get('/api/watch/' + slug)).data.needs, null);
  assert.equal((await fan.post('/api/pay/start', { slug, kind: 'ticket' })).status, 409, 'already covered');
  const pass = await cloud.store.get(ps.data.id);
  assert.ok(pass.data.expiresAt > Date.now() + 29 * 86400e3);
  assert.equal(pass.team, '', 'purchases are not team records');

  // sales for the team; not for crew
  const sales = (await admin.get('/api/sales?team=' + team)).data;
  assert.equal(sales.count, 2);
  assert.equal(sales.total, 170);
  assert.equal(sales.sandbox, true);
  assert.equal((await fan.get('/api/sales?team=' + team)).status, 403);

  // without PayFast set up, nothing can be bought
  cloud.config.payfast = {};
  assert.equal((await guest.post('/api/pay/start', { slug: semi, kind: 'ticket', email: 'x@example.com' })).status, 400);
  assert.equal((await guest.get('/api/watch/' + semi)).data.payments, false);
});
