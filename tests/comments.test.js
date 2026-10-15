'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('watch pages: anyone reads the live chat and video comments; signing in to write; moderation', async (t) => {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' }, streaming: { host: 'tv.example.com', hookSecret: 'h' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const admin = client(cloud.url);
  await admin.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await admin.put(`/api/docs/channel/chan_tv?team=${team}`, { data: { name: 'TV' } });
  await admin.put(`/api/docs/channel/chan_crew?team=${team}`, { data: { name: 'Crew only', access: 'Team members' } });
  await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: { name: 'Final', date: '2026-11-07', streamChannel: 'chan_tv' } });
  await admin.put(`/api/docs/production/prod_two?team=${team}`, { data: { name: 'Briefing', date: '2026-11-07', streamChannel: 'chan_crew' } });
  const slug = (await cloud.store.get('prod_one')).data.streamSlug, hidden = (await cloud.store.get('prod_two')).data.streamSlug;

  const guest = client(cloud.url);
  let r = (await guest.get(`/api/watch/${slug}/comments`)).data;
  assert.deepEqual(r.comments, []);
  assert.equal(r.signedIn, false);
  assert.equal((await guest.post(`/api/watch/${slug}/comments`, { text: 'hi' })).status, 401, 'sign in to write');

  const fan = client(cloud.url);
  await fan.post('/api/auth/signup', { name: 'Sam Fan', email: 'sam@example.com', password: 'correct horse' });
  assert.equal((await fan.post(`/api/watch/${slug}/comments`, { text: '  Go team!  ' })).status, 200);
  assert.equal((await fan.post(`/api/watch/${slug}/comments`, { text: 'again' })).status, 429, 'not too fast');
  assert.equal((await fan.post(`/api/watch/${slug}/comments`, { text: '   ' })).status, 400);
  assert.equal((await fan.post(`/api/watch/${slug}/comments?v=2026-11-07T10:00:00Z`, { text: 'x'.repeat(900) })).status, 429);
  r = (await guest.get(`/api/watch/${slug}/comments`)).data;
  assert.equal(r.comments.length, 1);
  assert.equal(r.comments[0].text, 'Go team!');
  assert.equal(r.comments[0].name, 'Sam Fan');
  assert.equal(r.comments[0].mine, false);
  // video comments are their own thread
  await new Promise((res) => setTimeout(res, 3100));
  assert.equal((await fan.post(`/api/watch/${slug}/comments?m=fixture_a`, { text: 'What a try' })).status, 200);
  assert.equal((await guest.get(`/api/watch/${slug}/comments?m=fixture_a`)).data.comments.length, 1);
  assert.equal((await guest.get(`/api/watch/${slug}/comments`)).data.comments.length, 1);
  // a team-only channel: not for guests
  assert.equal((await guest.get(`/api/watch/${hidden}/comments`)).status, 403);
  assert.equal((await admin.get(`/api/watch/${hidden}/comments`)).status, 200);
  // the team moderates; others cannot remove someone else's comment
  const id = (await guest.get(`/api/watch/${slug}/comments`)).data.comments[0].id;
  const other = client(cloud.url);
  await other.post('/api/auth/signup', { name: 'Other', email: 'o@example.com', password: 'correct horse' });
  assert.equal((await other.del('/api/comments/' + id)).status, 403);
  assert.equal((await admin.get(`/api/watch/${slug}/comments`)).data.canModerate, true);
  assert.equal((await admin.del('/api/comments/' + id)).status, 200);
  assert.equal((await guest.get(`/api/watch/${slug}/comments`)).data.comments.length, 0);
  // the public pages need no sign-in
  for (const p of ['/', '/browse', '/channels', '/videos', '/book', '/watch/' + slug]) assert.equal((await fetch(cloud.url + p)).status, 200, p);
  assert.equal((await guest.get('/api/public/home')).status, 200);
  assert.equal((await guest.get('/api/watch/' + slug)).data.needs, null);
});
