'use strict';
// A stream's own visibility (Public / Unlisted / Private, else as its channel) and how long it stays public after it ends.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('stream visibility and days public after the stream', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://tv.example.com', mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' }, streaming: { host: 'tv.example.com', api: '', hookSecret: 'hook-secret' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  assert.equal((await admin.put(`/api/docs/channel/chan_tv?team=${team}`, { data: { name: 'RegemarkFP TV' } })).status, 200);
  const put = async (id, extra) => { const r = await admin.put(`/api/docs/production/${id}?team=${team}`, { data: { name: id, date: '2026-11-07', streamChannel: 'chan_tv', ...extra } }); assert.equal(r.status, 200, JSON.stringify(r.data)); return (await app.store.get(id)).data.streamSlug; };
  const ended = async (id, daysAgo) => { const p = await app.store.get(id); await app.save(team, 'production', id, { ...p.data, streamClosed: true, streamEndedAt: new Date(Date.now() - daysAgo * 86400e3).toISOString() }, ''); };
  const listed = async () => (await app.streaming.publicStreams()).map((s) => s.slug);
  const guest = client(app.url);
  const watch = async (c, slug) => (await c.get('/api/watch/' + slug)).data;
  const allow = (slug) => app.streaming.allow({ action: 'read', path: 'live/' + slug, token: '', ip: '1.2.3.4' });

  const pub = await put('prod_pub', {});
  const unl = await put('prod_unl', { streamVisibility: 'Unlisted' });
  const prv = await put('prod_prv', { streamVisibility: 'Private' });
  let L = await listed();
  assert.ok(L.includes(pub)); assert.ok(!L.includes(unl), 'unlisted is not listed'); assert.ok(!L.includes(prv));
  assert.equal((await watch(guest, pub)).needs, null);
  assert.equal((await watch(guest, unl)).needs, null, 'unlisted: anyone with the link');
  assert.equal(await allow(unl), true);
  assert.equal((await watch(guest, prv)).needs, 'signin', 'private: the team only');
  assert.equal(await allow(prv), false);
  assert.equal((await watch(admin, prv)).needs, null, 'the team watches');

  // public for 7 days after the stream
  const wk = await put('prod_week', { streamPublicDays: 7 });
  await ended('prod_week', 3);
  let w = await watch(guest, wk);
  assert.equal(w.needs, null); assert.equal(w.expired, false); assert.ok(w.publicUntil > Date.now() + 3 * 86400e3);
  assert.ok((await listed()).includes(wk));
  await ended('prod_week', 10);
  w = await watch(guest, wk);
  assert.deepEqual([w.needs, w.expired], ['signin', true]);
  assert.ok(!(await listed()).includes(wk), 'no longer listed');
  assert.equal(await allow(wk), false);
  assert.equal((await watch(admin, wk)).needs, null, 'the team still can');

  // the channel's default; a stream's own days win; never-ended streams stay open
  const ch = await app.store.get('chan_tv');
  await admin.put(`/api/docs/channel/chan_tv?team=${team}`, { data: { ...ch.data, publicDays: 5 } });
  const dflt = await put('prod_dflt', {});
  await ended('prod_dflt', 6);
  assert.equal((await watch(guest, dflt)).expired, true, 'the channel says 5 days');
  const own = await put('prod_own', { streamPublicDays: 30 });
  await ended('prod_own', 6);
  assert.equal((await watch(guest, own)).needs, null, 'its own 30 days win');
  assert.equal((await watch(guest, pub)).needs, null, 'not ended yet: open');
});
