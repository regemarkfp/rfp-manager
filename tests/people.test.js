'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, seed, PNG } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const Schema = require('../shared/schema');

// Coaches look after their own clubs and pick team sheets, officials confirm results, crew add expenses with
// receipts and Producers approve them into the costing.
test('coaches, officials, and expenses with receipts', async (t) => {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const person = async (email, name) => { const c = client(cloud.url); assert.equal((await c.post('/api/auth/signup', { name, email, password: 'correct horse' })).status, 200); return c; };
  const admin = await person('admin@example.com', 'Admin');
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const fx = await seed(admin, team);
  assert.equal((await admin.put(`/api/docs/fixture/fixture_one?team=${team}`, { data: { ...fx.data, officials: 'Referee: Ref One\nTMO: Someone Else' } })).status, 200);
  assert.equal((await admin.put(`/api/docs/fixture/fixture_two?team=${team}`, { data: { sport: 'Rugby', team1: 'squad_bul', team2: 'squad_che', startDate: '2026-10-17', officials: 'Referee: Another Ref' } })).status, 200);
  assert.equal((await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: { name: 'Saturday rugby', date: '2026-10-10' } })).status, 200);

  const coach = await person('coach@example.com', 'Coach C');
  const ref = await person('ref@example.com', 'R One');
  const crew = await person('crew@example.com', 'Crew A');
  const crew2 = await person('crew2@example.com', 'Crew B');
  const prod = await person('prod@example.com', 'Producer P');
  const add = (email, role, extra = {}) => admin.post('/api/members?team=' + team, { email, role, ...extra });
  assert.equal((await add('coach@example.com', 'Coach', { clubs: ['club_che'] })).status, 200);
  assert.equal((await add('ref@example.com', 'Official', { officialName: 'Ref One' })).status, 200);
  assert.equal((await add('crew@example.com', 'Crew')).status, 200);
  assert.equal((await add('crew2@example.com', 'Crew')).status, 200);
  assert.equal((await add('prod@example.com', 'Producer')).status, 200);
  assert.equal((await add('x@example.com', 'Coach', { clubs: ['nope'] })).status, 400, 'clubs must be this team\'s');

  // ---- coach: sees clubs and matches, not productions or other members
  const seen = (await coach.get('/api/docs?team=' + team)).data.docs;
  assert.ok(seen.some((d) => d.id === 'club_che') && seen.some((d) => d.id === 'fixture_one'));
  assert.ok(!seen.some((d) => d.type === 'production' || d.type === 'crewMember' || d.type === 'expense'));
  assert.deepEqual(seen.filter((d) => d.type === 'member').map((d) => d.data.email), ['coach@example.com']);
  const club = seen.find((d) => d.id === 'club_che');
  assert.equal((await coach.put(`/api/docs/club/club_che?team=${team}`, { data: { ...club.data, abbreviation: 'CHT' } })).status, 200);
  assert.equal((await coach.put(`/api/docs/club/club_bul?team=${team}`, { data: { name: 'Bulls!' } })).status, 403);
  assert.equal((await coach.put(`/api/docs/club/club_new?team=${team}`, { data: { name: 'My new club' } })).status, 403, 'coaches do not create clubs');
  const np = await coach.put(`/api/docs/player/player_new1?team=${team}`, { data: { name: 'New', surname: 'Player' } });
  assert.equal(np.status, 200);
  assert.equal(np.data.doc.data.addedBy, 'coach@example.com');
  const squad = seen.find((d) => d.id === 'squad_che');
  assert.equal((await coach.put(`/api/docs/squad/squad_che?team=${team}`, { data: { ...squad.data, players: [...squad.data.players, { number: '15', player: 'player_new1', position: 'Fullback' }] } })).status, 200);
  assert.equal((await coach.put(`/api/docs/squad/squad_bul?team=${team}`, { data: { club: 'club_bul', sport: 'Rugby' } })).status, 403);
  assert.equal((await coach.put(`/api/docs/squad/squad_x?team=${team}`, { data: { club: 'club_bul', sport: 'Rugby' } })).status, 403, 'not a team of another club');
  assert.equal((await coach.put(`/api/docs/fixture/fixture_one?team=${team}`, { data: { ...fx.data, name: 'x' } })).status, 403);

  // team sheet: their team only; the scorer and graphics take it for that match
  const sheet = await coach.put(`/api/fixtures/fixture_one/teamsheet?team=${team}`, { squad: 'squad_che', rows: [{ player: 'player_new1', number: '15', position: 'Fullback' }, { player: 'player_ruan', number: '10', position: 'Flyhalf', captain: true, bench: true }] });
  assert.equal(sheet.status, 200, JSON.stringify(sheet.data));
  assert.equal((await coach.put(`/api/fixtures/fixture_one/teamsheet?team=${team}`, { squad: 'squad_bul', rows: [] })).status, 403);
  const teams = await cloud.domain.snapshotTeams((await cloud.store.get('fixture_one')).data);
  assert.deepEqual(teams[0].players.map((p) => [p.number, p.name]), [['15', 'New Player'], ['10', 'Ruan Osborne']]);
  // a Producer editing the match keeps the team sheet
  const fNow = (await admin.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'fixture_one');
  const { teamSheets, ...withoutSheets } = fNow.data;
  assert.equal((await admin.put(`/api/docs/fixture/fixture_one?team=${team}`, { data: { ...withoutSheets, notes: 'edited' } })).status, 200);
  assert.ok((await cloud.store.get('fixture_one')).data.teamSheets.squad_che);

  // ---- official: confirms the result of their match only
  assert.equal((await ref.put(`/api/fixtures/fixture_one/report?team=${team}`, { scoreA: 24, scoreB: 17, cards: 'Yellow: someone 34\'', notes: 'Good game' })).status, 200);
  const rep = (await cloud.store.get('fixture_one')).data.officialReport;
  assert.equal(rep.scoreA, 24);
  assert.equal(rep.by, 'R One');
  assert.equal((await ref.put(`/api/fixtures/fixture_two/report?team=${team}`, { scoreA: 1, scoreB: 0 })).status, 403);
  assert.equal((await coach.put(`/api/fixtures/fixture_one/report?team=${team}`, { scoreA: 99, scoreB: 0 })).status, 403);
  assert.ok(Schema.officiates({ officials: 'Referee: Ref One' }, ' ref one '));

  // ---- expenses: crew add with a receipt; status is the Producer's
  const up = await crew.post(`/api/images?team=${team}&name=fuel.png&kind=receipt`, PNG, { 'content-type': 'image/png' });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const pdf = await crew.post(`/api/images?team=${team}&name=hotel.pdf&kind=receipt`, Buffer.from('%PDF-1.4\n%fake\n'), { 'content-type': 'application/pdf' });
  assert.equal(pdf.status, 200);
  assert.equal((await crew.post(`/api/images?team=${team}&name=logo.pdf`, Buffer.from('%PDF-1.4'), { 'content-type': 'application/pdf' })).status, 403, 'crew add receipts, not library images');
  const e1 = await crew.post('/api/expenses?team=' + team, { id: 'expense_fuel1', data: { production: 'prod_one', description: 'Fuel to the venue', category: 'Fuel', amount: 650.5, receipt: up.data.doc.id, status: 'Approved' } });
  assert.equal(e1.status, 200, JSON.stringify(e1.data));
  assert.equal(e1.data.doc.data.status, 'Submitted');
  assert.equal(e1.data.doc.data.paidBy, 'Crew A');
  assert.equal((await crew.post('/api/expenses?team=' + team, { data: { production: 'prod_one', description: 'No amount' } })).status, 400);
  assert.equal((await coach.post('/api/expenses?team=' + team, { data: { production: 'prod_one', description: 'x', amount: 1 } })).status, 403);
  // who sees it
  assert.ok((await crew.get('/api/docs?team=' + team)).data.docs.some((d) => d.id === 'expense_fuel1'));
  assert.ok(!(await crew2.get('/api/docs?team=' + team)).data.docs.some((d) => d.id === 'expense_fuel1'));
  assert.ok(!(await crew2.get('/api/docs?team=' + team)).data.docs.some((d) => d.id === up.data.doc.id), 'nor the receipt');
  assert.ok((await prod.get('/api/docs?team=' + team)).data.docs.some((d) => d.id === 'expense_fuel1'));
  // the receipt file itself
  assert.equal((await fetch(cloud.url + '/media/' + up.data.doc.id)).status, 401);
  assert.equal((await crew2.get('/media/' + up.data.doc.id)).status, 403);
  assert.equal((await crew.get('/media/' + up.data.doc.id)).status, 200);
  const pdfGet = await prod.get('/media/' + pdf.data.doc.id);
  assert.equal(pdfGet.status, 200);
  assert.equal(pdfGet.headers.get('content-type'), 'application/pdf');
  // the producer approves; then the crew member can no longer change it
  const appr = await prod.post('/api/expenses?team=' + team, { id: 'expense_fuel1', data: { ...e1.data.doc.data, status: 'Approved', recharge: true } });
  assert.equal(appr.data.doc.data.status, 'Approved');
  assert.equal(appr.data.doc.data.decidedBy, 'Producer P');
  assert.equal((await crew.post('/api/expenses?team=' + team, { id: 'expense_fuel1', data: { ...appr.data.doc.data, amount: 9999 } })).status, 403);
  assert.equal((await crew.del(`/api/docs/expense/expense_fuel1?team=${team}`)).status, 403);
  // approved expenses go into the costing (and to the client when marked)
  const c = Schema.costing({ name: 'x', expenses: [{ id: 'a', ...appr.data.doc.data }, { id: 'b', status: 'Submitted', amount: 100, description: 'waiting' }] }, () => null);
  assert.equal(c.cost, 650.5);
  assert.equal(c.invoice, 650.5);
  assert.equal(c.lines[0].group, 'Expenses');

  // profile: phone and photo
  const prof = await ref.post(`/api/images?team=${team}&name=me.png&kind=profile`, PNG, { 'content-type': 'image/png' });
  assert.equal(prof.status, 200);
  assert.equal((await ref.post('/api/me', { name: 'Ref One', phone: '082 000 0000', image: prof.data.doc.id })).status, 200);
  const me = (await ref.get('/api/me')).data.user;
  assert.equal(me.phone, '082 000 0000');
  assert.equal(me.image, prof.data.doc.id);
});
