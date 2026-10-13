'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { pick, REFS } = require('../lib/verse');

const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

test('crew: gigs, earned in the last 30 days, still owed; no rates of others; verse of the day', async (t) => {
  // a stand-in for bible-api.com (no real Bible text in the tests)
  const asked = [];
  const verses = http.createServer((req, res) => { asked.push(decodeURIComponent(req.url)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ reference: 'Test 1:1', text: 'Stand-in verse text.\n', translation_name: 'Test Version' })); });
  await new Promise((r) => verses.listen(0, '127.0.0.1', r));
  t.after(() => verses.close());
  const cloud = await boot({ mode: 'cloud', allowSignup: true, verseUrl: `http://127.0.0.1:${verses.address().port}`, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const admin = client(cloud.url);
  await admin.post('/api/auth/signup', { name: 'Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const put = (type, id, data) => admin.put(`/api/docs/${type}/${id}?team=${team}`, { data });
  const crew = client(cloud.url);
  await crew.post('/api/auth/signup', { name: 'Crew A', email: 'crew@example.com', password: 'correct horse' });
  await admin.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Crew' });
  await put('crewRole', 'role_cam', { name: 'Camera', rate: 1500, invoiceRate: 2500 });
  await put('crewMember', 'cm_aaaa', { name: 'Crew', surname: 'A', email: 'CREW@example.com', phone: '082 000 0001' });
  await put('crewMember', 'cm_bbbb', { name: 'Other', surname: 'B', email: 'b@example.com' });
  await put('production', 'p_past_paid', { name: 'Past paid', date: day(-10), days: 2, crew: [{ crewMember: 'cm_aaaa', role: 'role_cam', paid: true }, { crewMember: 'cm_bbbb', role: 'role_cam', rate: 999 }] });
  await put('production', 'p_past_unpaid', { name: 'Past unpaid', date: day(-3), crew: [{ crewMember: 'cm_aaaa', role: 'role_cam', rate: 1800 }] });
  await put('production', 'p_oldone', { name: 'Long ago', date: day(-60), crew: [{ crewMember: 'cm_aaaa', role: 'role_cam', paid: true }] });
  await put('production', 'p_next', { name: 'Next week', date: day(7), txTime: '15:00', crew: [{ crewMember: 'cm_aaaa', role: 'role_cam', callTime: '10:00' }], extras: [{ description: 'Hire', cost: 5000 }] });
  await put('production', 'p_other', { name: 'Not mine', date: day(3) });
  const e = await crew.post('/api/expenses?team=' + team, { id: 'expense_1', data: { production: 'p_past_unpaid', description: 'Fuel', amount: 200 } });
  await admin.post('/api/expenses?team=' + team, { id: 'expense_1', data: { ...e.data.doc.data, status: 'Approved' } });

  const me = (await crew.get('/api/crew/me?team=' + team)).data;
  assert.equal(me.linked, true);
  assert.deepEqual(me.upcoming.map((g) => [g.name, g.role, g.callTime, g.txTime]), [['Next week', 'Camera', '10:00', '15:00']]);
  assert.equal(me.earned30, 1500 * 2 + 1800, 'two days at the role rate, plus one at their own rate; not the one 60 days ago');
  assert.equal(me.owed, 1800 + 200, 'the unpaid gig and the approved expense');
  assert.equal(me.owedGigs, 1);

  // crew see productions and who they work with, not the money
  const docs = (await crew.get('/api/docs?team=' + team)).data.docs;
  const role = docs.find((d) => d.id === 'role_cam');
  assert.equal(role.data.rate, undefined);
  assert.equal(role.data.name, 'Camera');
  const p = docs.find((d) => d.id === 'p_past_paid');
  assert.deepEqual(p.data.crew.map((r) => Object.keys(r).sort()), [['crewMember', 'role'], ['crewMember', 'role']]);
  assert.equal(docs.find((d) => d.id === 'p_next').data.extras, undefined);
  assert.ok(docs.some((d) => d.id === 'p_other'), 'every production is on the calendar');
  assert.equal(docs.find((d) => d.id === 'cm_bbbb').data.name, 'Other');
  // Producers still see it all
  assert.equal((await admin.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'role_cam').data.rate, 1500);

  // verse of the day: one per day, kept
  const v = (await crew.get('/api/verse')).data;
  assert.equal(v.text, 'Stand-in verse text.');
  assert.equal(v.translation, 'Test Version');
  assert.equal((await client(cloud.url).get('/api/verse')).status, 401);
  await crew.get('/api/verse');
  assert.equal(asked.length, 1, 'fetched once a day');
  assert.match(asked[0], /translation=kjv/);
  assert.ok(REFS.includes(pick('2026-10-13')));
  assert.equal(pick('2026-10-13'), pick('2026-10-13'));
});
