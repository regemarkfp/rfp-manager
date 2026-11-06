'use strict';
// After the event: the client rates the service on the tracking page, it reaches the team and (if they allow) the
// home page, with a button to post it on Google too; a reminder three days later if they have not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('client ratings after the event, testimonials, Google link, reminder', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', publicName: 'RegemarkFP', siteAdmins: ['admin@example.com'], mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const settle = async () => { await new Promise((r) => setTimeout(r, 400)); await app.bookings.idle(); await app.notify.idle(); };
  const l = (await admin.get('/api/site/landing')).data;
  await admin.put('/api/site/landing', { ...l, googleReview: 'ChIJ_test_place_id_123' });
  const guest = client(app.url);
  const book = async (name) => { const r = await guest.post('/api/public/booking', { name, email: name.toLowerCase().split(' ')[0] + '@example.com', service: 'Streaming', date: '2099-01-10', contactBy: 'Email' }); return { key: r.data.track.slice(7), b: (await app.store.list(team, 'booking')).find((d) => d.data.name === name) }; };
  const complete = async (b) => {
    await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...(await app.store.get(b.id)).data, producer: 'admin@example.com' } });
    const pid = (await admin.post(`/api/bookings/${b.id}/respond?team=${team}`, { accept: true })).data.production;
    const p = await app.store.get(pid);
    await app.save(team, 'production', pid, { ...p.data, status: 'Completed' }, '');
    await settle();
  };

  const { key, b } = await book('Sam Client');
  assert.equal((await guest.get('/api/public/track/' + key)).data.rating, null, 'no rating before the event');
  assert.equal((await guest.post(`/api/public/track/${key}/rate`, { stars: 5 })).status, 409);
  await complete(b);
  // the Completed message asks for a rating, with a link straight to it
  const ask = app.mail.outbox.find((m) => m.to.includes('sam@example.com') && /How did we do/.test(m.subject));
  assert.ok(ask, 'asked'); assert.ok(ask.text.includes(`https://site.example/track/${key}?rate=1`));
  let tr = (await guest.get('/api/public/track/' + key)).data;
  assert.equal(tr.stage, 'Completed');
  assert.equal(tr.rating.done, null); assert.ok(tr.rating.aspects.includes('Communication'));
  assert.equal(tr.rating.google, 'https://search.google.com/local/writereview?placeid=ChIJ_test_place_id_123');
  assert.equal((await guest.post(`/api/public/track/${key}/rate`, { stars: 0 })).status, 400);
  tr = (await guest.post(`/api/public/track/${key}/rate`, { stars: 5, aspects: { Communication: 4, 'Value for money': 5, Bogus: 3 }, comment: 'Great crew, great stream', publicOk: true, shownAs: 'Sam, Test Club' })).data;
  assert.deepEqual(tr.rating.done, { stars: 5, comment: 'Great crew, great stream' });
  assert.equal((await guest.post(`/api/public/track/${key}/rate`, { stars: 1 })).status, 409, 'once');
  await settle();
  assert.ok(app.mail.outbox.find((m) => m.to.includes('admin@example.com') && /New rating: 5\/5 from Sam Client/.test(m.subject)));
  const d = (await app.store.get(b.id)).data;
  assert.deepEqual(Object.keys(d.rating.aspects), ['Communication', 'Value for money'], 'unknown aspects dropped');
  // the form never loses it
  await admin.put(`/api/docs/booking/${b.id}?team=${team}`, { data: { ...d, rating: null, notes: 'x' } });
  assert.equal((await app.store.get(b.id)).data.rating.stars, 5);

  // a second one, private, 3 stars
  const two = await book('Ben Two');
  await complete(two.b);
  await guest.post(`/api/public/track/${two.key}/rate`, { stars: 3, comment: 'Late to set up', publicOk: false });
  // the home page shows only what clients allowed; the Studio sees all
  let home = (await client(app.url).get('/api/public/landing')).data.reviews;
  assert.deepEqual(home.list.map((x) => [x.stars, x.by]), [[5, 'Sam, Test Club']]);
  assert.deepEqual([home.count, home.average], [2, 4]);
  const r = (await admin.get(`/api/ratings?team=${team}`)).data;
  assert.deepEqual([r.count, r.average, r.list.length], [2, 4, 2]);
  assert.equal(r.aspects.find((a) => a.aspect === 'Communication').average, 4);
  // the team can hide one from the website
  await admin.post(`/api/bookings/${b.id}/rating?team=${team}`, { hidden: true });
  home = (await client(app.url).get('/api/public/landing')).data.reviews;
  assert.equal(home.list.length, 0);

  // a third, never rated: one reminder three days after the ask
  const three = await book('Cy Three');
  await complete(three.b);
  const c = await app.store.get(three.b.id);
  await app.save(team, 'booking', c.id, { ...c.data, ratingAsked: Date.now() - 4 * 86400e3 }, '');
  await app.bookings.tick(); await settle();
  await app.bookings.tick(); await settle();
  assert.equal(app.mail.outbox.filter((m) => m.to.includes('cy@example.com') && /How did we do/.test(m.subject)).length, 2, 'asked, then reminded once');
});
