'use strict';
// 1.0.0: Producers get crew notifications but do not write to clients; the superuser page (its own sign-in, website
// health, companies, only Admins who accepted the terms are named); quotes signed as contracts (drawn or a picture),
// universal terms; clients sign in on their portal (password or Google) and keep their details up to date.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

function tinyPng() {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 128, 2, 0, 0, 255, 255, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = () => 'data:image/png;base64,' + tinyPng().toString('base64');

async function setup(t, extra = {}) {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', adminUrl: 'https://admin.site.example', siteAdmins: ['admin@example.com'], superUsers: ['boss@site.example'],
    mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' }, ...extra }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Team' })).data.id;
  return { app, admin, team };
}
const member = async (app, admin, team, email, role) => {
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: role + ' Person', email, password: 'correct horse' });
  await admin.post('/api/members?team=' + team, { email, role });
  return c;
};

test('producers: notified when crew are booked, but only Admins write to clients', async (t) => {
  const { app, admin, team } = await setup(t);
  const prod = await member(app, admin, team, 'producer@example.com', 'Producer');
  await admin.put(`/api/docs/crewMember/crew_one?team=${team}`, { data: { name: 'Test', surname: 'Camera', email: 'cam@example.com' } });
  await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: { name: 'League round', date: '2099-03-01', producer: 'producer@example.com', crew: [{ crewMember: 'crew_one' }] } });
  await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: { name: 'League round', date: '2099-03-01', producer: 'producer@example.com', crew: [{ crewMember: 'crew_one', confirmed: true }] } });
  await app.notify.idle();
  const pu = await app.auth.userByEmail('producer@example.com');
  const got = (await app.push.inbox(pu)).list.find((n) => n.kind === 'crew_booked');
  assert.ok(got, 'the producer hears that crew were booked');
  assert.match(got.title, /Crew booked: League round/);
  assert.match(got.body, /Test Camera/);

  // a booking allocated to the producer: they see it but cannot write to the client; client messages go to Admins
  const b = await app.save(team, 'booking', 'bkg_one1', { name: 'Test Client', email: 'client@client.example', service: 'Live stream', producer: 'producer@example.com', status: 'Accepted', trackKey: 'trk_test_key_123456' }, '');
  assert.equal((await prod.post(`/api/bookings/${b.id}/reply?team=${team}`, { text: 'hello' })).status, 403);
  assert.equal((await admin.post(`/api/bookings/${b.id}/reply?team=${team}`, { text: 'hello' })).status, 200);
  await app.bookings.fromClient(await app.store.get(b.id), 'A question from the client', 'page');
  await app.notify.idle();
  const au = await app.auth.userByEmail('admin@example.com');
  assert.ok((await app.push.inbox(au)).list.some((n) => /replied/.test(n.title)), 'Admins hear from the client');
  assert.ok(!(await app.push.inbox(pu)).list.some((n) => /replied/.test(n.title)), 'the producer does not');
});

test('superuser page: emailed link sets the password, own sign-in, health and companies; only Admins who accepted are named', async (t) => {
  const { app, admin, team } = await setup(t);
  await member(app, admin, team, 'crew@example.com', 'Crew');
  const other = client(app.url);
  await other.post('/api/auth/signup', { name: 'Second Admin', email: 'second@example.com', password: 'correct horse' });
  await other.post('/api/orgs', { name: 'Second Company' });

  // the page: /super, and / on analytics.<website>
  const page = await fetch(app.url + '/super');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /super\.js/);
  const viaHost = (h) => new Promise((resolve, reject) => { const u = new URL(app.url); require('node:http').get({ host: u.hostname, port: u.port, path: '/', headers: { host: h } }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve(d)); }).on('error', reject); });
  assert.match(await viaHost('analytics.site.example'), /super\.js/);
  assert.doesNotMatch(await viaHost('site.example'), /super\.js/, 'the website itself stays the website');

  const su = client(app.url);
  assert.equal((await su.get('/api/super/overview')).status, 401);
  // the reset link goes only to a superuser email; the answer is the same for anyone
  const before = app.mail.outbox.length;
  assert.equal((await su.post('/api/super/reset', { email: 'admin@example.com' })).status, 200);
  assert.equal(app.mail.outbox.length, before, 'no email for someone who is not a superuser');
  assert.equal((await su.post('/api/super/reset', { email: 'Boss@Site.example' })).status, 200);
  const mail = app.mail.outbox.find((m) => m.to.includes('boss@site.example'));
  const token = /\?set=([\w-]+)/.exec(mail.text)[1];
  assert.equal((await su.post('/api/super/password', { token, password: 'short' })).status, 400);
  assert.equal((await su.post('/api/super/password', { token, password: 'a long enough secret' })).status, 200);
  assert.equal((await su.post('/api/super/password', { token, password: 'a long enough secret' })).status, 400, 'the link works once');
  // a Studio account is not a superuser session, and the other way round
  assert.equal((await admin.get('/api/super/overview')).status, 401);
  const su2 = client(app.url);
  assert.equal((await su2.post('/api/super/login', { email: 'boss@site.example', password: 'wrong password!' })).status, 401);
  assert.equal((await su2.post('/api/super/login', { email: 'boss@site.example', password: 'a long enough secret' })).status, 200);

  let o = (await su2.get('/api/super/overview')).data;
  assert.equal(o.health.version, require('../package.json').version);
  assert.ok(o.health.db.ok);
  const co = o.companies.find((c) => c.name === 'Test Team');
  assert.equal(co.users, 2);
  assert.deepEqual(co.roles, { Admin: 1, Crew: 1 });
  assert.deepEqual(co.admins, [{ hidden: true }], 'no names before the terms are accepted');
  assert.ok(!JSON.stringify(o).includes('crew@example.com') && !JSON.stringify(o).includes('Crew Person'), 'other people are never named');

  // the Admin accepts the terms (and opts out of marketing): named and emailable, marked as no marketing
  const me = (await admin.post('/api/me', { acceptTerms: true, marketingOptOut: true })).data.user;
  assert.equal(me.superTerms.version, 1);
  assert.equal(me.marketingOptOut, true);
  o = (await su2.get('/api/super/overview')).data;
  const named = o.companies.find((c) => c.name === 'Test Team').admins[0];
  assert.deepEqual([named.name, named.email, named.marketing], ['Test Admin', 'admin@example.com', false]);
  const csv = await fetch(app.url + '/api/super/contacts.csv', { headers: { cookie: su2.cookie() } });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text, /admin@example\.com.*opted out/);
  assert.ok(!text.includes('second@example.com'), 'Admins who did not accept are not exported');
  assert.equal((await su2.post('/api/super/logout', {})).status, 200);
  assert.equal((await su2.get('/api/super/overview')).status, 401);
});

test('quotes as contracts: universal terms, a signature loaded as a picture, the contract PDF; clients sign in and edit their details', async (t) => {
  const { app, admin, team } = await setup(t);
  const q = (path) => `${path}${path.includes('?') ? '&' : '?'}team=${team}`;
  await admin.put(q('/api/billing'), { docTerms: 'Payment within 7 days of the event.', conditions: '1. Bookings\nA booking is confirmed once the quote is signed.' });
  await admin.put(q('/api/docs/client/cli_park'), { data: { name: 'Park School', email: 'bursar@park.example' } });
  await app.notify.idle();
  // the new client was welcomed with their portal link
  const welcome = app.mail.outbox.find((m) => m.to.includes('bursar@park.example') && /Welcome/.test(m.subject));
  assert.ok(welcome, 'welcome email');
  assert.match(welcome.text, /Google or create a password/);
  const key = /\/portal\/([\w-]+)/.exec(welcome.text)[1];
  // saving the client again does not welcome them twice
  await admin.put(q('/api/docs/client/cli_park'), { data: { name: 'Park School', email: 'bursar@park.example', phone: '0110000000' } });
  await app.notify.idle();
  assert.equal(app.mail.outbox.filter((m) => m.to.includes('bursar@park.example') && /Welcome/.test(m.subject)).length, 1);

  let quote = (await admin.post(q('/api/invoices'), { kind: 'quote', client: 'cli_park', title: 'Sports day', lines: [{ item: 'Stream', rate: 3000, qty: 1 }] })).data.doc;
  await admin.post(q(`/api/invoices/${quote.id}/send`), {});
  const guest = client(app.url);
  let pv = (await guest.get('/api/portal/' + key)).data;
  assert.deepEqual(pv.terms, { docTerms: 'Payment within 7 days of the event.', conditions: '1. Bookings\nA booking is confirmed once the quote is signed.', acknowledge: '' });
  const doc = pv.docs.find((d) => d.id === quote.id);
  // a picture of a signature (JPEG or PNG) is fine too
  assert.equal((await guest.post(doc.sign, { name: 'Test Bursar', agree: true, method: 'upload', image: 'data:image/gif;base64,R0lGOD' })).status, 400);
  const r = await guest.post(doc.sign, { name: 'Test Bursar', agree: true, method: 'upload', image: PNG() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  quote = await app.invoices.one(team, quote.id);
  assert.equal(quote.signature.method, 'upload');
  assert.deepEqual(quote.contract.terms, { docTerms: 'Payment within 7 days of the event.', conditions: '1. Bookings\nA booking is confirmed once the quote is signed.' });
  // later changes to the terms do not change the signed contract
  await admin.put(q('/api/billing'), { conditions: 'Changed afterwards.' });
  assert.match((await app.invoices.one(team, quote.id)).contract.terms.conditions, /confirmed once the quote is signed/);
  const c = await fetch(app.url + (await guest.get('/api/portal/' + key)).data.docs.find((d) => d.id === quote.id).contract);
  assert.equal(c.status, 200);

  // details: only signed in
  pv = (await guest.get('/api/portal/' + key)).data;
  assert.equal(pv.me.signedIn, false);
  assert.deepEqual(pv.account, { exists: false, password: false, google: false });
  assert.equal((await guest.put(`/api/portal/${key}/details`, { phone: '0119999999' })).status, 401);
  assert.equal((await guest.post(`/api/portal/${key}/password`, { password: 'short' })).status, 400);
  assert.equal((await guest.post(`/api/portal/${key}/password`, { password: 'portal password' })).status, 200);
  assert.equal((await client(app.url).post(`/api/portal/${key}/password`, { password: 'another password' })).status, 409, 'a password is set once; then they sign in with it');
  pv = (await guest.get('/api/portal/' + key)).data;
  assert.equal(pv.me.signedIn, true);
  const saved = await guest.put(`/api/portal/${key}/details`, { name: 'Park High School', vatNo: '4000000000', address: '1 School Lane\nTest Town' });
  assert.deepEqual(saved.data.changed, ['Name', 'VAT number', 'Address']);
  assert.equal((await app.store.get('cli_park')).data.vatNo, '4000000000');
  assert.equal((await app.invoices.one(team, quote.id)).clientName, 'Park High School', 'their documents carry the new name');
  // the same person can sign in with their password later; their portals are in the website's account menu
  const again = client(app.url);
  assert.equal((await again.post('/api/auth/login', { email: 'bursar@park.example', password: 'portal password' })).status, 200);
  assert.deepEqual((await again.get('/api/public/my-portals')).data.portals.map((p) => p.client), ['Park High School']);
  // someone else signed in does not count as the person of this link
  assert.equal((await admin.put(`/api/portal/${key}/details`, { phone: '1' })).status, 401);
});

test('release forms: a link per form, signed on the phone (adult or for a child), choices kept, withdrawn, only for the team', async (t) => {
  const { app, admin, team } = await setup(t);
  const q = (path) => `${path}${path.includes('?') ? '&' : '?'}team=${team}`;
  await admin.put(q('/api/docs/production/prod_rel1'), { data: { name: 'Schools derby', date: '2099-04-01' } });
  const saved = (await admin.put(q('/api/docs/releaseForm/rform_one'), { data: { name: 'Derby release', production: 'prod_rel1', active: true, minors: true, askRaw: true, askPromo: true } })).data.doc;
  const key = saved.data.key;
  assert.match(key, /^[\w-]{12,40}$/);
  // editing keeps the link
  assert.equal((await admin.put(q('/api/docs/releaseForm/rform_one'), { data: { ...saved.data, key: 'someone-elses-key' } })).data.doc.data.key, key);
  const page = await fetch(app.url + '/release/' + key);
  assert.equal(page.status, 200);
  const anon = client(app.url);
  const v = (await anon.get('/api/public/release/' + key)).data;
  assert.equal(v.form.production, 'Schools derby');
  assert.match(v.form.text, /POPIA/);
  assert.match(v.form.text, /nobody can be identified/);
  // the final production is required; a signature is required
  assert.equal((await anon.post('/api/public/release/' + key, { name: 'Test Adult', image: PNG() })).status, 400);
  assert.equal((await anon.post('/api/public/release/' + key, { name: 'Test Adult', agree: true })).status, 400);
  const a = await anon.post('/api/public/release/' + key, { name: 'Test Adult', email: 'adult@example.com', agree: true, raw: true, promo: false, image: PNG() });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.allows, 'final production, raw footage');
  // a parent signs for a child, uploaded signature
  assert.equal((await anon.post('/api/public/release/' + key, { name: 'Test Parent', minor: true, agree: true, image: PNG() })).status, 400, 'the child\'s name is needed');
  assert.equal((await anon.post('/api/public/release/' + key, { name: 'Test Parent', minor: true, minorName: 'Test Child', relation: 'Legal guardian', agree: true, promo: true, method: 'upload', image: PNG() })).status, 200);
  await app.notify.idle();
  const copy = app.mail.outbox.find((m) => m.to.includes('adult@example.com'));
  assert.ok(copy && copy.attachments[0].filename.endsWith('.pdf'), 'the signer gets a PDF copy');
  // the team sees them; nobody else does, and they never travel as records
  let list = (await admin.get(q('/api/releases/form/rform_one'))).data;
  assert.equal(list.link, app.config.publicUrl.replace(/\/+$/, '') + '/release/' + key);
  assert.equal(list.releases.length, 2);
  const child = list.releases.find((x) => x.minor);
  assert.deepEqual([child.minorName, child.relation, child.consents.raw, child.consents.promo, child.method], ['Test Child', 'Legal guardian', false, true, 'upload']);
  const crew = await member(app, admin, team, 'crewrel@example.com', 'Crew');
  assert.equal((await crew.get(q('/api/releases/form/rform_one'))).status, 403);
  assert.ok(!(await admin.get(q('/api/docs'))).data.docs?.some?.((d) => d.type === 'release'));
  const pdf = await fetch(app.url + q(`/api/releases/${child.id}/pdf`), { headers: { cookie: admin.cookie() } });
  assert.equal(pdf.status, 200);
  // withdrawn: kept, marked; closing the form stops new signatures
  await admin.post(q(`/api/releases/${child.id}/withdraw`), { withdrawn: true });
  list = (await admin.get(q('/api/releases/form/rform_one'))).data;
  assert.ok(list.releases.find((x) => x.id === child.id).withdrawn);
  assert.equal((await admin.get(q('/api/releases/production/prod_rel1'))).data.releases.length, 1, 'withdrawn releases are not counted for the production');
  await admin.put(q('/api/docs/releaseForm/rform_one'), { data: { ...saved.data, active: false } });
  assert.equal((await anon.post('/api/public/release/' + key, { name: 'Late Person', agree: true, image: PNG() })).status, 409);
  assert.equal((await client(app.url).post('/api/public/release/notarealkey123', { name: 'X', agree: true, image: PNG() })).status, 404);
});

test('contracts: clauses pointed out need their own tick', async (t) => {
  const { app, admin, team } = await setup(t);
  const q = (path) => `${path}${path.includes('?') ? '&' : '?'}team=${team}`;
  await admin.put(q('/api/billing'), { acknowledge: 'I have read clauses 4 and 7.' });
  await admin.put(q('/api/docs/client/cli_ack1'), { data: { name: 'Ack Client', email: 'ack@client.example' } });
  const quote = (await admin.post(q('/api/invoices'), { kind: 'quote', client: 'cli_ack1', lines: [{ item: 'Stream', rate: 1000, qty: 1 }] })).data.doc;
  const sent = (await admin.post(q(`/api/invoices/${quote.id}/send`), {})).data;
  const key = sent.portal.split('/portal/')[1];
  const g = client(app.url);
  const pv = (await g.get('/api/portal/' + key)).data;
  assert.equal(pv.terms.acknowledge, 'I have read clauses 4 and 7.');
  const sign = pv.docs.find((d) => d.id === quote.id).sign;
  assert.equal((await g.post(sign, { name: 'Ack Person', agree: true, image: PNG() })).status, 400);
  assert.equal((await g.post(sign, { name: 'Ack Person', agree: true, acknowledged: true, image: PNG() })).status, 200);
  assert.equal((await app.invoices.one(team, quote.id)).contract.acknowledged, 'I have read clauses 4 and 7.');
});

test('legal pages: company information, terms from Billing details, standard POPIA privacy policy, copyright line', async (t) => {
  const { app, admin, team } = await setup(t, { publicName: 'RegemarkFP' });
  await admin.put(`/api/billing?team=${team}`, { conditions: '1. Bookings\nA booking is confirmed once the quote is signed.' });
  const cfg = (await client(app.url).get('/api/config')).data;
  assert.equal(cfg.copyright, `© ${new Date().getFullYear()} RegemarkFP (Pty) Ltd. All rights reserved.`);
  let L = (await client(app.url).get('/api/public/legal')).data;
  assert.equal(L.company, 'RegemarkFP (Pty) Ltd');
  assert.match(L.terms, /confirmed once the quote is signed/, 'the terms come from Billing details');
  assert.match(L.privacy, /POPIA/);
  for (const p of ['/legal', '/terms', '/privacy']) assert.equal((await fetch(app.url + p)).status, 200);
  assert.equal((await client(app.url).put('/api/site/legal', { company: 'X' })).status, 401);
  await admin.put('/api/site/legal', { company: 'Test Company (Pty) Ltd', regNo: '2026/000000/07', address: '1 Test Street' });
  L = (await client(app.url).get('/api/public/legal')).data;
  assert.deepEqual([L.company, L.regNo, L.address], ['Test Company (Pty) Ltd', '2026/000000/07', '1 Test Street']);
  assert.match((await client(app.url).get('/api/config')).data.copyright, /Test Company \(Pty\) Ltd/);
});

test('deleting a club deletes its teams (players stay)', async (t) => {
  const { admin, team } = await setup(t);
  const q = (path) => `${path}${path.includes('?') ? '&' : '?'}team=${team}`;
  await admin.put(q('/api/docs/club/club_del1'), { data: { name: 'Test Club' } });
  await admin.put(q('/api/docs/club/club_keep'), { data: { name: 'Other Club' } });
  await admin.put(q('/api/docs/player/plr_one1'), { data: { name: 'Test', surname: 'Player' } });
  await admin.put(q('/api/docs/squad/sq_del1a'), { data: { club: 'club_del1', sport: 'Rugby', ageGroup: 'U16', players: [{ player: 'plr_one1' }] } });
  await admin.put(q('/api/docs/squad/sq_del1b'), { data: { club: 'club_del1', sport: 'Hockey', ageGroup: '1st' } });
  await admin.put(q('/api/docs/squad/sq_keep1'), { data: { club: 'club_keep', sport: 'Rugby', ageGroup: 'U16' } });
  const r = await admin.del(q('/api/docs/club/club_del1'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.removed.sort(), ['sq_del1a', 'sq_del1b']);
  const docs = (await admin.get(q('/api/docs'))).data;
  const ids = (docs.docs || docs).map ? (docs.docs || docs).map((d) => d.id) : [];
  assert.ok(!ids.includes('sq_del1a') && !ids.includes('sq_del1b'));
  assert.ok(ids.includes('sq_keep1') && ids.includes('plr_one1'));
});

test('Universe: NAS tab (space, mirror, folders) and company logos', async (t) => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-'));
  fs.mkdirSync(path.join(dir, 'assets')); fs.writeFileSync(path.join(dir, 'assets', 'a.bin'), Buffer.alloc(200000));
  fs.mkdirSync(path.join(dir, 'software')); fs.writeFileSync(path.join(dir, 'software', 'b.bin'), Buffer.alloc(50000));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { app, admin, team } = await setup(t, { nasDir: dir });
  await admin.put('/api/docs/org/' + team + '?team=' + team, { data: { name: 'Test Team', image: 'https://example.com/logo.png' } });
  const su = client(app.url);
  assert.equal((await su.get('/api/super/nas')).status, 401);
  await su.post('/api/super/reset', { email: 'boss@site.example' });
  const token = /\?set=([\w-]+)/.exec(app.mail.outbox.find((m) => m.to.includes('boss@site.example')).text)[1];
  await su.post('/api/super/password', { token, password: 'a long enough secret' });
  let n = (await su.get('/api/super/nas')).data;
  assert.equal(n.path, dir); assert.equal(n.exists, true); assert.ok(n.total > 0 && n.free > 0);
  for (let i = 0; i < 50 && !(n.folders || []).length; i++) { await new Promise((r) => setTimeout(r, 100)); n = (await su.get('/api/super/nas')).data; }
  assert.deepEqual(n.folders.map((f) => f.name), ['assets', 'software'], 'biggest first');
  const co = (await su.get('/api/super/overview')).data.companies.find((c) => c.id === team);
  assert.equal(co.logo, 'https://example.com/logo.png');
  const { parseMdstat } = require('../lib/super');
  const r = parseMdstat('md0 : active raid1 sdb1[0] sdc1[1](F)\n      976630464 blocks super 1.2 [2/1] [U_]\n', '/dev/md0');
  assert.deepEqual([r.healthy, r.working, r.wanted, r.disks[1].failed], [false, 1, 2, true]);
});

test('Universe: NAS users through the helper, and the file browser stays inside the NAS', async (t) => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-')), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'no');
  fs.symlinkSync(outside, path.join(dir, 'escape'));
  // a stand-in for /usr/local/sbin/rfp-nas-users: remembers what it was asked
  const log = path.join(dir, '..', path.basename(dir) + '-helper.log');
  const helper = path.join(os.tmpdir(), 'fake-nas-users-' + process.pid + '.sh');
  fs.writeFileSync(helper, `#!/bin/sh\ncase "$1" in\n list) printf 'ruan\\tenabled\\tmade-here\\nguest\\tdisabled\\texisting\\n' ;;\n info) printf 'rfp-server\\trfp-server.tail.ts.net\\t100.1.2.3\\t${dir}\\n' ;;\n *) read pw; echo "$1 $2 \${#pw}" >> ${log} ;;\nesac\n`, { mode: 0o755 });
  t.after(() => { for (const p of [dir, outside, log, helper]) fs.rmSync(p, { recursive: true, force: true }); });
  const { app } = await setup(t, { nasDir: dir, nasUsersHelper: helper });
  const su = client(app.url);
  await su.post('/api/super/reset', { email: 'boss@site.example' });
  const token = /\?set=([\w-]+)/.exec(app.mail.outbox.find((m) => m.to.includes('boss@site.example')).text)[1];
  await su.post('/api/super/password', { token, password: 'a long enough secret' });
  // users
  let u = (await su.get('/api/super/nas/users')).data;
  assert.equal(u.ready, true);
  assert.deepEqual(u.users, [{ name: 'ruan', enabled: true, madeHere: true }, { name: 'guest', enabled: false, madeHere: false }]);
  assert.equal(u.info.tailscale, 'rfp-server.tail.ts.net');
  assert.equal((await su.post('/api/super/nas/users/add', { name: 'Bad Name!', password: 'longenough' })).status, 400);
  assert.equal((await su.post('/api/super/nas/users/add', { name: 'tiaan', password: 'short' })).status, 400);
  assert.equal((await su.post('/api/super/nas/users/add', { name: 'tiaan', password: 'longenough1' })).status, 200);
  assert.equal((await su.post('/api/super/nas/users/disable', { name: 'tiaan' })).status, 200);
  assert.equal((await su.post('/api/super/nas/users/format', { name: 'tiaan' })).status, 400);
  assert.match(fs.readFileSync(log, 'utf8'), /^add tiaan 11\n/);
  assert.equal((await client(app.url).get('/api/super/nas/users')).status, 401);
  // files: make, upload, list, download, rename, delete
  assert.equal((await su.post('/api/super/files/mkdir', { path: '', name: 'clips' })).status, 200);
  const up = await fetch(app.url + '/api/super/files/upload?path=clips&name=hello.txt', { method: 'POST', headers: { cookie: su.cookie(), 'x-rfp': '1' }, body: 'hello nas' });
  assert.equal(up.status, 200);
  let l = (await su.get('/api/super/files?path=clips')).data;
  assert.deepEqual(l.items.map((x) => [x.name, x.size]), [['hello.txt', 9]]);
  const dl = await fetch(app.url + '/api/super/files/get?path=clips/hello.txt', { headers: { cookie: su.cookie() } });
  assert.equal(await dl.text(), 'hello nas');
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  const part = await fetch(app.url + '/api/super/files/get?path=clips/hello.txt', { headers: { cookie: su.cookie(), range: 'bytes=6-' } });
  assert.equal(part.status, 206); assert.equal(await part.text(), 'nas');
  assert.equal((await su.post('/api/super/files/rename', { path: 'clips/hello.txt', to: 'hi.txt' })).status, 200);
  assert.equal((await su.post('/api/super/files/rename', { path: 'clips/hi.txt', to: '../x.txt' })).status, 400);
  // never outside the NAS: .. and symlinks out are refused
  assert.equal((await su.get('/api/super/files?path=..')).status, 400);
  assert.equal((await su.get('/api/super/files?path=escape')).status, 403);
  assert.equal((await fetch(app.url + '/api/super/files/get?path=escape/secret.txt', { headers: { cookie: su.cookie() } })).status, 403);
  assert.equal((await su.post('/api/super/files/delete', { path: '' })).status, 400, 'not the NAS itself');
  assert.equal((await su.post('/api/super/files/delete', { path: 'clips' })).status, 200);
  assert.ok(!fs.existsSync(path.join(dir, 'clips')));
  assert.equal((await client(app.url).get('/api/super/files')).status, 401);
});
