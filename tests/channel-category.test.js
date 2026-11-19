'use strict';
// Channels have a category (Church, Sport …): on the public channel list and in Browse.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('channels: a category, shown publicly and searchable', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://tv.example.com', mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), anon = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Pat', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Productions' })).data.id;
  assert.ok(require('../shared/schema').ENTITIES.channel.fields.find((f) => f.k === 'category').opts.includes('Church'));
  for (const [id, name, category] of [['channel_church', 'Grace Church Live', 'Church'], ['channel_rugby', 'Rugby TV', 'Sport']]) {
    const r = await admin.put(`/api/docs/channel/${id}?team=${team}`, { data: { name, category, access: 'Public' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const home = (await anon.get('/api/public/home')).data;
  assert.deepEqual(home.channels.map((c) => [c.name, c.category]).sort(), [['Grace Church Live', 'Church'], ['Rugby TV', 'Sport']]);
  const found = (await anon.get('/api/public/search?q=church&kind=channel')).data;
  assert.ok(JSON.stringify(found).includes('Grace Church Live'));
  assert.ok(!JSON.stringify(found.results || found.list || found).includes('Rugby TV'));
});
