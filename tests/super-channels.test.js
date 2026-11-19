'use strict';
// Universe → Channels (1.8.0): every channel with its numbers, and its subscribers (name, email, since; CSV).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('universe: channels with their numbers and subscribers', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', superUsers: ['boss@site.example'], mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), fan = client(app.url), fan2 = client(app.url), su = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Pat', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Grace Media' })).data.id;
  const put = async (type, id, data) => { const r = await admin.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.doc; };
  await put('channel', 'channel_grace', { name: 'Grace Church Live', category: 'Church', owner: 'Church', access: 'Public' });
  await put('channel', 'channel_quiet', { name: 'Quiet channel', access: 'Public' });
  const today = new Date().toISOString().slice(0, 10);
  await put('production', 'production_sun', { name: 'Sunday service', date: today, streamChannel: 'channel_grace', streamSlug: 'sunday-service' });
  await app.save(team, 'viewstat', 'vs_test1', { slug: 'sunday-service', production: 'production_sun', day: today, viewers: ['a1', 'b2', 'c3'], seconds: 7200, peak: 3, videos: {} }, '');
  await fan.post('/api/auth/signup', { name: 'Faith Fan', email: 'faith@example.com', password: 'correct horse' });
  await fan2.post('/api/auth/signup', { name: 'Sam Subscriber', email: 'sam@example.com', password: 'correct horse' });
  assert.equal((await fan.post('/api/public/subscribe', { channel: 'channel_grace' })).data.subscribed, true);
  await fan2.post('/api/public/subscribe', { channel: 'channel_grace' });
  await fan2.post('/api/public/subscribe', { channel: 'channel_quiet' });
  await fan2.post('/api/public/subscribe', { channel: 'channel_quiet', on: false });

  // only for the superuser
  assert.equal((await su.get('/api/super/channels')).status, 401);
  assert.equal((await admin.get('/api/super/channels')).status, 401);
  await su.post('/api/super/reset', { email: 'boss@site.example' });
  const token = /\?set=([\w-]+)/.exec(app.mail.outbox.find((m) => m.to.includes('boss@site.example')).text)[1];
  assert.equal((await su.post('/api/super/password', { token, password: 'a long enough secret' })).status, 200);

  const r = (await su.get('/api/super/channels?days=30')).data;
  assert.equal(r.days, 30);
  const g = r.list.find((c) => c.id === 'channel_grace'), q = r.list.find((c) => c.id === 'channel_quiet');
  assert.deepEqual([g.name, g.company, g.category, g.owner, g.subscribers, g.newSubscribers, g.streams, g.viewers, g.watchHours, g.peak], ['Grace Church Live', 'Grace Media', 'Church', 'Church', 2, 2, 1, 3, 2, 3]);
  assert.equal(q.subscribers, 0, 'unsubscribed');
  assert.equal(r.list[0].id, 'channel_grace', 'most subscribers first');
  assert.deepEqual([r.totals.channels, r.totals.subscribers, r.totals.people], [2, 2, 2]);

  const d = (await su.get('/api/super/channels/channel_grace?days=7')).data;
  assert.equal(d.perDay.length, 7); assert.equal(d.perDay[6].viewers, 3);
  assert.deepEqual(d.subscribers.map((x) => x.email).sort(), ['faith@example.com', 'sam@example.com']);
  assert.ok(d.subscribers.every((x) => x.since > 0));
  assert.equal(d.streams[0].title, 'Sunday service');
  const csv = await su.get('/api/super/channels/channel_grace/subscribers.csv');
  assert.equal(csv.status, 200); assert.match(csv.data.toString(), /"Faith Fan","faith@example.com"/);
  assert.equal((await su.get('/api/super/channels/nope')).status, 404);
});
