'use strict';
// Tech riders (1.6.0) and the production in phases: templates, the venue's technical profile, the PDF, the private
// link where the venue answers, what they confirm saved on the venue, emails, and the client page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const Schema = require('../shared/schema');
const Riders = require('../shared/riders');

test('riders: phases on the production, templates and the venue profile', () => {
  const P = Schema.ENTITIES.production;
  assert.deepEqual(Object.keys(P.phases), ['Pre-production', 'Production', 'Post-production']);
  const groups = new Set(P.fields.filter((f) => !f.hidden && f.group).map((f) => f.group));
  for (const g of groups) assert.ok(Object.values(P.phases).some((list) => list.includes(g)), `group "${g}" is in a phase`);
  assert.ok(P.fields.some((f) => f.k === 'riderNeeds' && f.group === 'Tech rider'));
  assert.ok(Schema.ENTITIES.venue.fields.some((f) => f.k === 'tech' && f.group === 'Technical'));
  assert.ok(Schema.ENTITIES.riderTemplate);
  // a template filled with what the venue has
  const t = Riders.BUILT_IN.find((x) => x.id === 'builtin_sport');
  const r = Riders.fromTemplate(t, { tech: [{ category: 'Internet', item: 'Wired connection for the stream', detail: '100 Mbps fibre in the media room' }] });
  assert.equal(r.riderNeeds.find((x) => x.category === 'Internet').venueHas, '100 Mbps fibre in the media room');
  assert.equal(r.riderNeeds.filter((x) => x.venueHas).length, 1);
  assert.ok(r.riderDeliverables.length && r.riderSetup);
  const pr = Riders.progress(r.riderNeeds, { [Riders.needKey(r.riderNeeds[0])]: { status: 'ok' }, [Riders.needKey(r.riderNeeds[1])]: { status: 'issue' } });
  assert.equal(pr.total, r.riderNeeds.length); assert.equal(pr.ok, 1); assert.equal(pr.issues, 1); assert.equal(pr.answered, 2);
});

test('riders: PDF, link, the venue answers, saved on the venue, emails, client page', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://rfp.example', mail: { provider: 'test', from: 'RFP Manager <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), anon = client(app.url), crew = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Pat Producer', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Productions' })).data.id;
  const put = async (type, id, data) => { const r = await admin.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.doc; };
  await put('venue', 'venue_park', { name: 'Free State Park', city: 'Bloemfontein', techContact: 'Facilities', techEmail: 'facilities@example.com', tech: [{ category: 'Power', item: 'Gallery / OB position', detail: '32 A at the tunnel' }] });
  await put('crewRole', 'crewRole_cam', { name: 'Camera operator', rate: 1500 });
  await put('equipment', 'equipment_cam', { name: 'URSA Broadcast', category: 'Camera', rate: 900 });
  const tpl = Riders.fromTemplate(Riders.BUILT_IN[0], { tech: [{ category: 'Power', item: 'Gallery / OB position', detail: '32 A at the tunnel' }] });
  await put('production', 'production_final', { name: 'Final', date: '2026-12-01', venue: 'venue_park', producer: 'admin@example.com', status: 'Confirmed', crew: [{ role: 'crewRole_cam', location: 'Venue', rate: 1500 }, { role: 'crewRole_cam', location: 'Venue' }], equipment: [{ item: 'equipment_cam', quantity: 2 }], ...tpl, riderNotes: 'Rain plan: covered stand.' });

  // the PDF (signed in) and the link (Producers and Admins)
  const pdf = await admin.get(`/api/productions/production_final/rider.pdf?team=${team}`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.ok(pdf.data.toString('latin1').startsWith('%PDF'));
  assert.equal((await anon.post(`/api/productions/production_final/rider/link?team=${team}`, {})).status, 401);
  const link = (await admin.post(`/api/productions/production_final/rider/link?team=${team}`, {})).data;
  assert.match(link.url, /^https:\/\/rfp\.example\/rider\/[\w-]{16,40}$/);
  assert.equal((await admin.post(`/api/productions/production_final/rider/link?team=${team}`, {})).data.key, link.key, 'the same link every time');

  // what the venue sees: no prices, no crew names
  const v = (await anon.get('/api/rider/' + link.key)).data;
  assert.equal(v.name, 'Final'); assert.equal(v.venue.name, 'Free State Park'); assert.equal(v.venue.email, 'facilities@example.com');
  assert.deepEqual(v.crew, [{ role: 'Camera operator (Venue)', n: 2 }]);
  assert.deepEqual(v.equipment, [['Camera', ['2 × URSA Broadcast']]]);
  assert.equal(v.needs.find((x) => x.category === 'Power' && x.item === 'Gallery / OB position').venueHas, '32 A at the tunnel');
  assert.ok(!JSON.stringify(v).includes('1500'), 'no rates');
  assert.equal(v.progress.answered, 0);
  assert.equal((await anon.get('/api/rider/' + link.key + '/rider.pdf')).status, 200);
  assert.equal((await anon.get('/api/rider/nope-nope-nope-nope')).status, 404);
  assert.equal((await anon.get('/rider/' + link.key)).status, 200, 'the page');

  // the venue answers: a name is needed; unknown items are ignored
  const k = (cat, item) => v.needs.find((x) => x.category === cat && x.item === item).key;
  assert.equal((await anon.post(`/api/rider/${link.key}/reply`, { items: [] })).status, 400);
  const reply = await anon.post(`/api/rider/${link.key}/reply`, { name: 'Sam (facilities)', note: 'Gate 3 for the van.', items: [
    { key: k('Internet', 'Wired connection for the stream'), status: 'ok', note: '50 Mbps fibre, cable in the media room' },
    { key: k('Positions', 'Main camera (halfway line)'), status: 'issue', note: 'The tower is being repaired' },
    { key: k('Catering', 'Crew meals and water'), status: 'na' },
    { key: 'made|up', status: 'ok' }] });
  assert.equal(reply.status, 200, JSON.stringify(reply.data)); assert.equal(reply.data.changed, 3);
  assert.equal(reply.data.progress.issues, 1); assert.equal(reply.data.progress.ok, 2);
  const prod = (await admin.get(`/api/docs?team=${team}`)).data;
  const p = (prod.docs || prod.list || prod).find ? (prod.docs || prod.list || prod).find((d) => d.id === 'production_final').data : null;
  assert.ok(p, JSON.stringify(Object.keys(prod)));
  assert.equal(p.riderReplies[k('Positions', 'Main camera (halfway line)')].status, 'issue');
  assert.equal(p.riderLog.at(-1).by, 'Sam (facilities)'); assert.equal(p.riderLog.at(-1).note, 'Gate 3 for the van.');
  // what was sorted is now on the venue (with their note), next to what was there
  const venue = ((prod.docs || prod.list || prod).find((d) => d.id === 'venue_park')).data;
  assert.deepEqual(venue.tech.map((x) => [x.category, x.item, x.detail]), [['Power', 'Gallery / OB position', '32 A at the tunnel'], ['Internet', 'Wired connection for the stream', '50 Mbps fibre, cable in the media room']]);
  // the producer is told, with the problem
  const told = app.mail.outbox.find((m) => m.to.includes('admin@example.com') && /answered the tech rider/.test(m.subject));
  assert.ok(told && told.text.includes('The tower is being repaired'));
  // the same answers again change nothing
  assert.equal((await anon.post(`/api/rider/${link.key}/reply`, { name: 'Sam', items: [{ key: k('Catering', 'Crew meals and water'), status: 'na' }] })).data.changed, 0);

  // sending it: the PDF attached, the link in the email, sent marked on the production
  assert.equal((await admin.post(`/api/productions/production_final/rider/send?team=${team}`, { to: ['not-an-email'] })).status, 400);
  const sent = await admin.post(`/api/productions/production_final/rider/send?team=${team}`, { to: ['facilities@example.com'], note: 'See you Saturday' });
  assert.equal(sent.status, 200, JSON.stringify(sent.data)); assert.equal(sent.data.sent, 1);
  const mail = app.mail.outbox.find((m) => m.to.includes('facilities@example.com') && /^Tech rider: Final/.test(m.subject));
  assert.ok(mail && mail.text.includes('https://rfp.example/rider/' + link.key) && mail.text.includes('See you Saturday'));
  assert.ok((mail.attachments || []).some((a) => /Tech rider - Final/.test(a.filename)), 'the PDF is attached');
  const after = ((await admin.get(`/api/docs?team=${team}`)).data);
  const p2 = (after.docs || after.list || after).find((d) => d.id === 'production_final').data;
  assert.ok(p2.riderSentAt); assert.deepEqual(p2.riderSentTo, ['facilities@example.com']); assert.equal(p2.riderSentBy, 'admin@example.com');

  // the client page shows the rider with its progress
  const ck = (await admin.post(`/api/productions/production_final/client-link?team=${team}`, {})).data.key;
  const cv = (await anon.get('/api/client/' + ck)).data;
  assert.equal(cv.rider.url, '/rider/' + link.key); assert.equal(cv.rider.progress.issues, 1);
  void crew;
});
