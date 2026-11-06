'use strict';
// The company and fan features: quotes and invoices, crew answers from the email and clashes, kit, the client page,
// sponsor reports, health alerts, competitions (follow, log), reminders, the calendar, predictions and player of the
// match, player profiles, the sermon archive and gift tickets.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const Sports = require('../shared/sports');

test('company and fan features', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', verse: false, mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, push: { webFetch: async () => ({ status: 201 }), alertDelayMs: 5 },
    mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), anon = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Org' })).data.id;
  const put = async (type, id, data) => { const x = await admin.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(x.status, 200, type + ' ' + JSON.stringify(x.data)); return x.data.doc; };
  const q = `?team=${team}`;
  const today = new Date().toISOString().slice(0, 10);

  // ---- quotes and invoices
  await put('crewRole', 'crewRole_cam', { name: 'Camera operator', rate: 1000, invoiceRate: 1800 });
  await put('crewMember', 'crewMember_a', { name: 'Crew', surname: 'One', email: 'crew@example.com', unavailable: [{ from: '2026-12-05', to: '2026-12-06', note: 'Away' }] });
  await put('equipment', 'equipment_cam', { name: 'Camera kit', rate: 300, invoiceRate: 900, barcode: 'CAM-01', serviceDue: '2020-01-01' });
  await put('production', 'production_1', { name: 'Final', date: '2026-12-05', client: 'Client Ltd', clientEmail: 'client@example.com', crew: [{ role: 'crewRole_cam', crewMember: 'crewMember_a' }], equipment: [{ item: 'equipment_cam', quantity: 2 }], extras: [{ description: 'Travel', cost: 200, invoice: 500 }] });
  await put('production', 'production_2', { name: 'Same day', date: '2026-12-05', crew: [{ role: 'crewRole_cam', crewMember: 'crewMember_a' }] });
  assert.equal((await admin.put(`/api/billing${q}`, { legalName: 'Test Productions (Pty) Ltd', vatNo: '4000000000', vatRate: 15, terms: 7, bank: 'Bank · 123' })).status, 200);
  const inv = (await admin.post(`/api/productions/production_1/invoices${q}`, { kind: 'invoice' })).data.doc;
  assert.equal(inv.number, 'RFPINV0001');
  // the booking fee, then the costing
  assert.deepEqual(inv.lines.map((l) => [l.item, l.qty, l.rate]), [['Booking fee', 1, 1500], ['Camera operator', 1, 1800], ['Camera kit', 2, 900], ['Travel', 1, 500]]);
  assert.equal(inv.subtotal, 5600); assert.equal(inv.vat, 840); assert.equal(inv.total, 6440);
  assert.equal((await admin.post(`/api/productions/production_1/invoices${q}`, { kind: 'quote' })).data.doc.number, 'RFPQ0001');
  const pdf = await admin.get(`/api/invoices/${inv.id}/pdf${q}`);
  assert.equal(pdf.status, 200); assert.ok(pdf.data.toString('latin1').startsWith('%PDF'));
  const sent = await admin.post(`/api/invoices/${inv.id}/send${q}`, {});
  assert.equal(sent.data.to, 'client@example.com');
  assert.ok(app.mail.outbox.some((m) => m.to.includes('client@example.com') && m.attachments.length === 1));
  await admin.put(`/api/invoices/${inv.id}${q}`, { due: '2020-01-01' });
  let ov = (await admin.get(`/api/invoices${q}`)).data;
  assert.equal(ov.overdue, 6440, 'sent and past due: overdue');
  await admin.put(`/api/invoices/${inv.id}${q}`, { status: 'Paid' });
  ov = (await admin.get(`/api/invoices${q}`)).data;
  assert.equal(ov.owed, 0);

  // ---- crew: clashes, an answer from the email, their own days off
  const cl = (await admin.get(`/api/productions/production_1/clashes${q}`)).data.list.map((c) => c.kind).sort();
  assert.deepEqual(cl, ['double', 'unavailable']);
  const links = await app.crewtools.respondLinks('production_1', 'crewMember_a');
  const no = await anon.get(links.no.replace('https://site.example', ''));
  assert.match(no.data.toString(), /not available for <b>Final<\/b>/);
  assert.equal((await app.store.get('production_1')).data.crew[0].declined, true);
  assert.match((await anon.get(links.no.replace('https://site.example', '').slice(0, -3) + 'xyz')).data.toString(), /not valid/);
  const crew = client(app.url);
  await crew.post('/api/auth/signup', { name: 'Crew One', email: 'crew@example.com', password: 'correct horse' });
  await admin.post(`/api/members${q}`, { email: 'crew@example.com', role: 'Crew' });
  assert.equal((await crew.get(`/api/me/availability${q}`)).data.onCrew, true);
  assert.deepEqual((await crew.put(`/api/me/availability${q}`, { list: [{ from: '2026-12-24', note: 'Christmas' }] })).data.list, [{ from: '2026-12-24', to: '2026-12-24', note: 'Christmas' }]);

  // ---- the client page
  const link = (await admin.post(`/api/productions/production_1/client-link${q}`, {})).data;
  assert.match(link.url, /^https:\/\/site\.example\/client\/[\w-]{16}$/);
  const key = link.key, cv = (await anon.get('/api/client/' + key)).data;
  assert.equal(cv.name, 'Final'); assert.deepEqual(cv.invoices.map((x) => [x.number, x.state]), [['RFPINV0001', 'Paid']], 'drafts (the quote) are not shown');
  assert.equal((await anon.get(cv.invoices[0].url)).status, 200);
  assert.equal((await anon.get(`/api/client/${key}/callsheet.pdf`)).status, 200);
  assert.equal((await anon.get('/api/client/nonsense-key-123')).status, 404);
  assert.equal((await anon.get('/client/' + key)).status, 200, 'the page');

  // ---- sponsors: proof of play
  await put('advert', 'advert_1', { name: 'Board', sponsor: 'Sponsor Co', sponsorEmail: 'sponsor@example.com' });
  const month = today.slice(0, 7);
  await app.save(team, 'adlog', 'adlog_x', { date: today, entries: [{ id: 'a', advert: 'advert_1', name: 'Board', sponsor: 'Sponsor Co', at: Date.now(), seconds: 30, match: 'Alpha v Beta' }, { id: 'b', advert: 'advert_1', name: 'Board', sponsor: 'Sponsor Co', at: Date.now(), seconds: 15 }] });
  const sp = (await admin.get(`/api/sponsors${q}&month=${month}`)).data.list;
  assert.deepEqual(sp.map((x) => [x.sponsor, x.plays, x.seconds, x.email]), [['Sponsor Co', 2, 45, 'sponsor@example.com']]);
  assert.equal((await admin.get(`/api/sponsors/report.pdf${q}&month=${month}&sponsor=Sponsor%20Co`)).status, 200);
  assert.equal((await admin.post(`/api/sponsors/send${q}`, { month, sponsor: 'Sponsor Co' })).data.to, 'sponsor@example.com');

  // ---- competitions, a log, a reminder, the calendar, the fans' corner, players
  const org = await app.store.get(team); await app.save(team, 'org', team, { ...org.data, publicMatches: true, publicPlayers: true });
  await put('club', 'club_a', { name: 'Alpha' }); await put('club', 'club_b', { name: 'Beta' });
  await put('player', 'player_1', { name: 'Ann', surname: 'One' });
  await put('squad', 'squad_a', { club: 'club_a', sport: 'Rugby', players: [{ player: 'player_1', number: '9' }] }); await put('squad', 'squad_b', { club: 'club_b', sport: 'Rugby' });
  await put('competition', 'competition_1', { name: 'Cup', sport: 'Rugby', pointsWin: 4, pointsDraw: 2 });
  const soon = new Date(Date.now() + 60 * 60e3), hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(soon);
  const dayJhb = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(soon);
  await put('fixture', 'fixture_1', { sport: 'Rugby', competition: 'competition_1', team1: 'squad_a', team2: 'squad_b', startDate: dayJhb, startTime: hm });
  const fan = client(app.url);
  await fan.post('/api/auth/signup', { name: 'Fan', email: 'fan@example.com', password: 'correct horse' });
  assert.equal((await fan.post('/api/public/follow', { id: 'competition_1' })).status, 200, 'a competition can be followed');
  await app.follows.digestTick();
  assert.ok((await fan.get('/api/notifications')).data.list.some((n) => /^Kick-off in an hour: Alpha v Beta/.test(n.title)), 'the reminder');
  const ics = (await fan.get('/api/public/ical-link')).data;
  const cal = await anon.get(ics.url.replace('https://site.example', ''));
  assert.match(cal.data.toString(), /BEGIN:VEVENT[\s\S]*SUMMARY:Alpha v Beta[\s\S]*END:VCALENDAR/);
  // predictions before kick-off, then the match, then the player of the match
  assert.equal((await fan.post('/api/public/match/fixture_1/fans', { predict: 'A' })).data.predict.counts.A, 1);
  assert.equal((await anon.post('/api/public/match/fixture_1/fans', { predict: 'B' })).status, 401);
  const su = Sports.newSetup('rugby'); su.teams.A.name = 'Alpha'; su.teams.B.name = 'Beta';
  su.teams.A.players = [{ id: 'player_1', name: 'Ann One', tvName: 'ANN ONE', number: '9', lineup: 'start' }];
  const fx = await app.store.get('fixture_1');
  await app.save(team, 'fixture', 'fixture_1', { ...fx.data, status: 'Completed', live: { kind: 'sport', sport: 'rugby', setup: su, events: [{ id: '1', type: 'status', key: 'kickoff', t: Date.now() }, { id: '2', type: 'score', key: 'try', team: 'A', player: 'player_1', t: Date.now() }, { id: '3', type: 'end' }] } });
  assert.equal((await fan.post('/api/public/match/fixture_1/fans', { predict: 'B' })).status, 409, 'closed at kick-off');
  const fz = (await fan.get('/api/public/match/fixture_1/fans')).data;
  assert.equal(fz.potm.open, true);
  assert.equal((await fan.post('/api/public/match/fixture_1/fans', { potm: fz.potm.options[0].key })).data.potm.leader[1], 1);
  const page = (await anon.get('/api/public/team/competition_1')).data;
  assert.deepEqual(page.table.map((r) => [r.name, r.W, r.Pts]), [['Alpha', 1, 4], ['Beta', 0, 0]]);
  const pl = (await anon.get('/api/public/player/player_1')).data;
  assert.equal(pl.name, 'Ann One'); assert.equal(pl.matches, 1); assert.equal(pl.teams[0].number, '9');
  const mc = (await anon.get('/api/public/match/fixture_1')).data;
  assert.equal(mc.players_public, true); assert.equal(mc.players.A[0].id, 'player_1');

  // ---- health: an idle scorer during play
  const fx2 = await app.store.get('fixture_1');
  await app.store.put({ ...fx2, data: { ...fx2.data, status: 'Live', startDate: today, live: { ...fx2.data.live, events: fx2.data.live.events.slice(0, 2) } }, updatedAt: Date.now() - 20 * 60e3 });
  await app.health.tick();
  assert.ok((await admin.get('/api/notifications')).data.list.some((n) => /^No scoring for 12 minutes/.test(n.title)));

  // ---- the sermon archive (a church channel's services with recordings) and gift tickets
  assert.equal((await anon.get('/api/public/c/nope/sermons')).status, 404);
});
