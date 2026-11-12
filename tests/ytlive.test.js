'use strict';
// YouTube Live: a site admin adds the Google client secret, a team connects its channel (OAuth), schedules a
// broadcast for a production (a restream destination appears), changes it, reads its key and cancels it.
// Google and YouTube are stand-ins here.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('YouTube Live: connect the channel, schedule, change, key, cancel', async (t) => {
  const seen = [];
  const broadcasts = new Map();
  const yt = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      seen.push(req.method + ' ' + u.pathname + ' ' + (req.headers.authorization || ''));
      const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/token') {
        const f = new URLSearchParams(body);
        if (f.get('client_secret') !== 'GOCSPX-test-secret') return json(401, { error: 'invalid_client' });
        if (f.get('grant_type') === 'authorization_code') return json(200, f.get('code') === 'good' ? { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 } : { error: 'invalid_grant' });
        return json(200, { access_token: 'at2', expires_in: 3600 });
      }
      if (!/^Bearer at[12]$/.test(req.headers.authorization || '')) return json(401, { error: { message: 'no token' } });
      const b = body ? JSON.parse(body) : {};
      if (u.pathname === '/yt/channels') return json(200, { items: [{ id: 'UC1', snippet: { title: 'RegemarkFP', thumbnails: { default: { url: 'https://img.example/c.jpg' } } } }] });
      if (u.pathname === '/yt/liveBroadcasts' && req.method === 'POST') { const x = { id: 'bc' + (broadcasts.size + 1), snippet: b.snippet, status: { ...b.status, lifeCycleStatus: 'created' }, contentDetails: { ...b.contentDetails } }; broadcasts.set(x.id, x); return json(200, x); }
      if (u.pathname === '/yt/liveStreams' && req.method === 'POST') return json(200, { id: 'st1', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2', streamName: 'abcd-1234-efgh' } } });
      if (u.pathname === '/yt/liveStreams') return json(200, { items: [{ id: 'st1', cdn: { ingestionInfo: { ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2', streamName: 'abcd-1234-efgh' } } }] });
      if (u.pathname === '/yt/liveBroadcasts/bind') { const x = broadcasts.get(u.searchParams.get('id')); x.contentDetails.boundStreamId = u.searchParams.get('streamId'); return json(200, x); }
      if (u.pathname === '/yt/liveBroadcasts' && req.method === 'GET') {
        const id = u.searchParams.get('id');
        if (id) return json(200, { items: broadcasts.has(id) ? [broadcasts.get(id)] : [] });
        return json(200, { items: u.searchParams.get('broadcastStatus') === 'upcoming' ? [...broadcasts.values()] : [] });
      }
      if (u.pathname === '/yt/liveBroadcasts' && req.method === 'PUT') { const x = broadcasts.get(b.id); x.snippet = { ...x.snippet, ...b.snippet }; x.status = { ...x.status, ...b.status }; return json(200, x); }
      if (u.pathname === '/yt/liveBroadcasts' && req.method === 'DELETE') { broadcasts.delete(u.searchParams.get('id')); res.writeHead(204); return res.end(); }
      json(404, { error: { message: 'unknown ' + u.pathname } });
    });
  });
  await new Promise((r) => yt.listen(0, '127.0.0.1', r));
  t.after(() => yt.close());
  const base = `http://127.0.0.1:${yt.address().port}`;
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', siteAdmins: ['admin@example.com'], google: { clientId: 'cid.apps.googleusercontent.com' },
    ytOauthAuth: base + '/auth', ytOauthToken: base + '/token', ytOauthRevoke: base + '/revoke', youtubeApi: base + '/yt', mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Org' })).data.id;
  const q = '?team=' + team;

  // not set up: no secret yet
  let st = (await admin.get('/api/ytlive' + q)).data;
  assert.deepEqual([st.connected, st.server.hasSecret, st.server.clientId], [false, false, true]);
  assert.equal((await admin.post('/api/ytlive/connect' + q, {})).status, 400);
  assert.equal((await admin.put('/api/ytlive/server', { secret: 'bad secret!' })).status, 400);
  assert.equal((await admin.put('/api/ytlive/server', { secret: 'GOCSPX-test-secret' })).data.hasSecret, true);
  assert.equal(JSON.stringify((await admin.get('/api/ytlive/server')).data).includes('GOCSPX'), false, 'the secret never goes back');

  // connect: Google's page, then back with a code
  const go = (await admin.post('/api/ytlive/connect' + q, {})).data.url;
  const gu = new URL(go);
  assert.equal(gu.origin + gu.pathname, base + '/auth');
  assert.deepEqual([gu.searchParams.get('scope'), gu.searchParams.get('access_type'), gu.searchParams.get('redirect_uri')], ['https://www.googleapis.com/auth/youtube', 'offline', 'https://site.example/api/ytlive/callback']);
  const state = gu.searchParams.get('state');
  const other = client(app.url);
  await other.post('/api/auth/signup', { name: 'Someone Else', email: 'else@example.com', password: 'correct horse' });
  const cb = await fetch(`${app.url}/api/ytlive/callback?code=good&state=${state}`, { redirect: 'manual', headers: { cookie: other.cookie() } });
  assert.match(decodeURIComponent(cb.headers.get('location')), /#\/youtube\/error\/Sign in as the person who pressed Connect/);
  const go2 = new URL((await admin.post('/api/ytlive/connect' + q, {})).data.url).searchParams.get('state');
  const cb2 = await fetch(`${app.url}/api/ytlive/callback?code=good&state=${go2}`, { redirect: 'manual', headers: { cookie: admin.cookie() } });
  assert.equal(cb2.headers.get('location'), '/app#/youtube/connected');
  st = (await admin.get('/api/ytlive' + q)).data;
  assert.deepEqual([st.connected, st.channel.title, st.by], [true, 'RegemarkFP', 'admin@example.com']);
  assert.equal(JSON.stringify(st).includes('rt1'), false, 'the refresh token stays on the server');

  // schedule for a production: the broadcast and its key, bound; a restream destination on the production
  await admin.put(`/api/docs/production/prod_1${q}`, { data: { name: 'Cup final', date: '2026-12-05' } });
  assert.equal((await admin.post('/api/ytlive/broadcasts' + q, { title: '', start: '2026-12-05T12:00:00Z' })).status, 400);
  assert.equal((await admin.post('/api/ytlive/broadcasts' + q, { title: 'Old', start: '2020-01-01T12:00:00Z' })).status, 400);
  const sc = (await admin.post('/api/ytlive/broadcasts' + q, { title: 'Cup final LIVE', start: '2026-12-05T12:00:00Z', privacy: 'unlisted', description: 'The final', production: 'prod_1' })).data;
  assert.deepEqual([sc.id, sc.key, sc.server, sc.url, sc.privacy, sc.production.id], ['bc1', 'abcd-1234-efgh', 'rtmp://a.rtmp.youtube.com/live2', 'https://www.youtube.com/watch?v=bc1', 'unlisted', 'prod_1']);
  const bc = broadcasts.get('bc1');
  assert.deepEqual([bc.contentDetails.enableAutoStart, bc.contentDetails.enableAutoStop, bc.contentDetails.boundStreamId, bc.status.selfDeclaredMadeForKids], [true, true, 'st1', false]);
  let p = (await app.store.get('prod_1')).data;
  assert.deepEqual(p.streamRestream.map((r) => [r.name, r.url, r.key, r.on, r.ytBroadcast]), [['YouTube: Cup final LIVE', 'rtmp://a.rtmp.youtube.com/live2', 'abcd-1234-efgh', true, 'bc1']]);
  assert.equal(p.ytLive.broadcastId, 'bc1');
  assert.equal((await admin.post('/api/ytlive/broadcasts' + q, { title: 'Again', start: '2026-12-05T12:00:00Z', production: 'prod_1' })).status, 409);

  // the list, a change, the key, cancelling
  const list = (await admin.get('/api/ytlive/broadcasts' + q)).data.list;
  assert.deepEqual(list.map((b) => [b.id, b.title, b.production && b.production.name]), [['bc1', 'Cup final LIVE', 'Cup final']]);
  assert.equal((await admin.put('/api/ytlive/broadcasts/bc1' + q, { title: 'Cup final – LIVE', privacy: 'public' })).data.title, 'Cup final – LIVE');
  assert.equal((await app.store.get('prod_1')).data.ytLive.title, 'Cup final – LIVE');
  assert.deepEqual((await admin.get('/api/ytlive/broadcasts/bc1/key' + q)).data, { server: 'rtmp://a.rtmp.youtube.com/live2', key: 'abcd-1234-efgh' });
  // a form that saved the production without our marker: the row is still found by its key
  p = (await app.store.get('prod_1')).data;
  await admin.put(`/api/docs/production/prod_1${q}`, { data: { ...p, streamRestream: [{ name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2', key: 'abcd-1234-efgh', on: true }, { name: 'Facebook', url: 'rtmps://fb', key: 'k', on: true }] } });
  assert.equal((await admin.del('/api/ytlive/broadcasts/bc1' + q)).status, 200);
  p = (await app.store.get('prod_1')).data;
  assert.deepEqual([p.streamRestream.map((r) => r.name), p.ytLive], [['Facebook'], undefined]);
  assert.equal(broadcasts.size, 0);

  // without a production: just the key (for vMix / OBS)
  const solo = (await admin.post('/api/ytlive/broadcasts' + q, { title: 'Church service', start: new Date(Date.now() + 86400e3).toISOString() })).data;
  assert.deepEqual([solo.key, solo.production], ['abcd-1234-efgh', undefined]);

  // who may: a guest no; disconnecting
  assert.equal((await client(app.url).get('/api/ytlive/broadcasts' + q)).status, 401);
  assert.equal((await admin.del('/api/ytlive/connect' + q)).data.connected, false);
  assert.equal((await admin.get('/api/ytlive/broadcasts' + q)).status, 400);
  assert.ok(seen.some((s) => s.startsWith('POST /token')));
});
