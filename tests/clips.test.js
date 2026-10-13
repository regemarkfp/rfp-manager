'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

// (copied from stream.test.js) A stand-in for MediaMTX: its API (what is live, which recordings) and its playback server (the recordings' times).
async function fakeMediaMtx(t) {
  const state = { items: [], recordings: {}, pathConfigs: [], auth: [] };
  const srv = http.createServer((req, res) => {
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/v3/paths/list') return json({ itemCount: state.items.length, pageCount: 1, items: state.items });
    if (u.pathname === '/v3/recordings/list') return json({ items: Object.keys(state.recordings).map((name) => ({ name, segments: state.recordings[name].map((r) => ({ start: r.start })) })) });
    if (u.pathname === '/list') { state.auth.push(req.headers.authorization || ''); return json(state.recordings[u.searchParams.get('path')] || []); }
    if (u.pathname === '/v3/config/paths/list') return json({ items: state.pathConfigs });
    if (u.pathname.startsWith('/v3/config/paths/add/')) { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { state.pathConfigs.push({ name: decodeURIComponent(u.pathname.slice(21)), ...JSON.parse(b) }); json({}); }); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { url: 'http://127.0.0.1:' + srv.address().port, state };
}

async function site(t, extra = {}) {
  const mtx = await fakeMediaMtx(t);
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://tv.example.com', siteAdmins: ['ruan@example.com'], mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' },
    streaming: { host: 'tv.example.com', rtmpPort: 1935, srtPort: 8890, api: mtx.url, playback: mtx.url, hookSecret: 'hook-secret' }, ...extra }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  assert.equal((await web.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' })).status, 200);
  const team = (await web.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const hook = (body) => fetch(cloud.url + '/api/stream/auth?s=hook-secret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  return { cloud, web, team, mtx, hook };
}


test('one stream key per production, one video per match: marked when each match starts and ends', async (t) => {
  const { cloud, web, team, mtx } = await site(t);
  const put = (type, id, data) => web.put(`/api/docs/${type}/${id}?team=${team}`, { data });
  await put('venue', 'venue_one', { name: 'Free State Stadium' });
  await put('channel', 'channel_tv', { name: 'Schools TV' });
  // two matches on the same day and venue: one production with both, streaming on one key
  assert.equal((await put('fixture', 'fixture_a1', { name: 'Grey v Shimla', sport: 'Rugby', startDate: '2026-10-17', startTime: '10:00', venue: 'venue_one' })).status, 200);
  assert.equal((await put('fixture', 'fixture_b2', { name: 'Grey v Paul Roos', sport: 'Rugby', startDate: '2026-10-17', startTime: '13:00', venue: 'venue_one' })).status, 200);
  const prod = (await cloud.store.list(team, 'production')).find((p) => (p.data.fixtures || []).length === 2);
  assert.ok(prod, 'the matches share a production');
  assert.equal((await put('production', prod.id, { ...prod.data, streamChannel: 'channel_tv' })).status, 200);
  const slug = (await cloud.store.get(prod.id)).data.streamSlug;
  const path = 'live/' + slug;
  const recStart = Date.now() - 3600e3;
  mtx.state.items = [{ name: path, ready: true, readyTime: new Date(recStart).toISOString(), tracks: ['H264'], bytesReceived: 1, readers: [] }];
  mtx.state.recordings[path] = [{ start: new Date(recStart).toISOString(), duration: 7200 }];
  await cloud.streaming.poll(); await cloud.streaming.pollVods();

  // the scorer starts match 1 (it turns Live) and later it ends
  const fx1 = await cloud.store.get('fixture_a1');
  await put('fixture', 'fixture_a1', { ...fx1.data, status: 'Live' });
  await new Promise((r) => setTimeout(r, 300));
  let clips = (await web.get(`/api/productions/${prod.id}/clips?team=${team}`)).data.clips;
  assert.equal(clips.length, 1);
  assert.equal(clips[0].fixture, 'fixture_a1');
  assert.ok(Math.abs(Date.parse(clips[0].start) - (Date.now() - 30000)) < 5000, 'starts 30 s before');
  assert.ok(!clips[0].end);
  await put('fixture', 'fixture_a1', { ...fx1.data, status: 'Live', notes: 'edit while live' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await web.get(`/api/productions/${prod.id}/clips?team=${team}`)).data.clips[0].start, clips[0].start, 'not moved by another edit');
  await put('fixture', 'fixture_a1', { ...fx1.data, status: 'Completed' });
  await new Promise((r) => setTimeout(r, 300));
  clips = (await web.get(`/api/productions/${prod.id}/clips?team=${team}`)).data.clips;
  assert.ok(clips[0].end);

  // match 2 was not scored: a Producer marks it by hand
  assert.equal((await web.post(`/api/productions/${prod.id}/clips?team=${team}`, { fixture: 'fixture_b2', end: 'now' })).status, 400, 'start first');
  const s2 = new Date(Date.now() - 1800e3).toISOString(), e2 = new Date(Date.now() - 600e3).toISOString();
  assert.equal((await web.post(`/api/productions/${prod.id}/clips?team=${team}`, { fixture: 'fixture_b2', start: s2, end: e2 })).status, 200);
  assert.equal((await web.post(`/api/productions/${prod.id}/clips?team=${team}`, { fixture: 'fixture_x', start: 'now' })).status, 400, 'only matches of this production');
  // a later automatic mark does not overwrite the hand-set one
  const fx2 = await cloud.store.get('fixture_b2');
  await put('fixture', 'fixture_b2', { ...fx2.data, status: 'Live' });
  await new Promise((r) => setTimeout(r, 300));
  clips = (await web.get(`/api/productions/${prod.id}/clips?team=${team}`)).data.clips;
  const c2 = clips.find((c) => c.fixture === 'fixture_b2');
  assert.equal(c2.start, s2);
  assert.equal(c2.auto, false);
  assert.equal(c2.video.duration, 1200);

  // each match is its own video for viewers: watch page, front page, channel page, match card
  const viewer = client(cloud.url);
  const w = (await viewer.get(`/api/watch/${slug}?m=fixture_b2`)).data;
  assert.equal(w.vod.title, 'Grey v Paul Roos');
  assert.equal(w.vod.duration, 1200);
  assert.match(w.vod.url, new RegExp('start=' + encodeURIComponent(s2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '&duration=1200'));
  assert.equal(w.matches.length, 2);
  const home = (await viewer.get('/api/public/home')).data;
  const titles = home.videos.map((v) => v.title);
  assert.ok(titles.includes('Grey v Shimla') && titles.includes('Grey v Paul Roos'), JSON.stringify(titles));
  assert.ok(titles.some((x) => /full stream/.test(x)));
  assert.equal(home.videos.find((v) => v.title === 'Grey v Paul Roos').match, 'fixture_b2');
  const ch = (await viewer.get('/api/public/c/schools-tv')).data;
  assert.equal(ch.streams[0].matches.length, 2);

  // clearing removes the match video, the recording stays
  assert.equal((await web.post(`/api/productions/${prod.id}/clips?team=${team}`, { fixture: 'fixture_b2', clear: true })).status, 200);
  assert.equal((await viewer.get(`/api/watch/${slug}`)).data.matches.length, 1);
  assert.equal((await viewer.get(`/api/watch/${slug}`)).data.videos.length, 1);
});
