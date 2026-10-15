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
    if (u.pathname.startsWith('/v3/recordings/get/')) { const name = decodeURIComponent(u.pathname.slice(19)); return json({ name, segments: (state.recordings[name] || []).map((r) => ({ start: r.start })) }); }
    if (u.pathname === '/v3/recordings/deletesegment' && req.method === 'DELETE') { const name = u.searchParams.get('path'), st = u.searchParams.get('start'); state.deleted = (state.deleted || []).concat([[name, st]]); state.recordings[name] = (state.recordings[name] || []).filter((r) => r.start !== st); return json({}); }
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



test('video analytics from watch beats, and managing recordings (title, hide, delete)', async (t) => {
  const { cloud, web, team, mtx } = await site(t);
  const put = (type, id, data) => web.put(`/api/docs/${type}/${id}?team=${team}`, { data });
  await put('channel', 'channel_tv', { name: 'Schools TV' });
  assert.equal((await put('production', 'prod_show', { name: 'Prize giving', date: '2026-10-15', streamChannel: 'channel_tv' })).status, 200);
  const slug = (await cloud.store.get('prod_show')).data.streamSlug;
  const path = 'live/' + slug;
  const a = new Date(Date.now() - 7200e3).toISOString(), b = new Date(Date.now() - 3600e3).toISOString();
  mtx.state.items = [{ name: path, ready: true, readyTime: new Date().toISOString(), tracks: ['H264', 'MPEG-4 Audio'], bytesReceived: 1, readers: [] }];
  mtx.state.recordings[path] = [{ start: a, duration: 1200 }, { start: b, duration: 900 }];
  await cloud.streaming.poll(); await cloud.streaming.pollVods();

  // three viewers live, one watches a recording
  const beat = (sid, body) => fetch(cloud.url + `/api/watch/${slug}/beat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify({ sid, ...body }) }).then((r) => r.json());
  for (const sid of ['viewer-aaaa-1', 'viewer-bbbb-2', 'viewer-cccc-3']) assert.equal((await beat(sid, { kind: 'live' })).ok, true);
  await beat('viewer-dddd-4', { kind: 'vod', start: a });
  assert.equal((await beat('short', { kind: 'live' })).ok, false, 'a made-up id is ignored');
  // later beats add watch time (time is moved on by hand here)
  const real = Date.now; let shift = 0; Date.now = () => real() + shift;
  t.after(() => { Date.now = real; });
  shift = 30000; await beat('viewer-aaaa-1', { kind: 'live' }); await beat('viewer-dddd-4', { kind: 'vod', start: a });
  shift = 31000; assert.equal((await beat('viewer-aaaa-1', { kind: 'live' })).ok, true, 'too soon: ignored quietly');
  shift = 60000; await beat('viewer-aaaa-1', { kind: 'live' });
  Date.now = real;

  const r = (await web.get(`/api/analytics?team=${team}&days=7`)).data;
  assert.equal(r.totals.viewers, 4);
  assert.equal(r.totals.peak, 3);
  assert.equal(r.days.length, 7);
  const s = r.streams[0];
  assert.equal(s.title, 'Prize giving');
  assert.equal(s.viewers, 4);
  assert.equal(s.seconds, 90);
  assert.deepEqual(s.videos.map((v) => [v.key, v.viewers, v.seconds]), [['live', 3, 60], ['v:' + a, 1, 30]]);
  assert.equal((await client(cloud.url).get(`/api/analytics?team=${team}`)).status, 401);
  // analytics are not records anyone loads
  assert.ok(!(await web.get(`/api/docs?team=${team}`)).data.docs.some((d) => d.type === 'viewstat'));
  // live viewers now come from the beats too
  for (const sid of ['viewer-aaaa-1', 'viewer-bbbb-2', 'viewer-cccc-3']) await beat(sid, { kind: 'live' });
  assert.equal((await fetch(cloud.url + `/api/watch/${slug}`).then((x) => x.json())).viewers, 3);

  // recordings: list with their numbers
  let list = (await web.get(`/api/productions/prod_show/recordings?team=${team}`)).data;
  assert.equal(list.list.length, 2);
  assert.equal(list.list.find((v) => v.start === a).viewers, 1);
  assert.equal(list.live.peak, 3);
  // a title, and hidden from viewers
  assert.equal((await web.put(`/api/productions/prod_show/recordings/${encodeURIComponent(a)}?team=${team}`, { title: 'Full ceremony' })).status, 200);
  assert.equal((await web.put(`/api/productions/prod_show/recordings/${encodeURIComponent(b)}?team=${team}`, { hidden: true })).status, 200);
  const pubWatch = await fetch(cloud.url + `/api/watch/${slug}`).then((x) => x.json());
  assert.deepEqual(pubWatch.videos.map((v) => [v.start, v.title]), [[a, 'Full ceremony']], 'the hidden one is not shown');
  const mine = (await web.get(`/api/watch/${slug}`)).data;
  assert.equal(mine.videos.length, 2, 'the team still sees it');
  assert.equal((await web.put(`/api/productions/prod_show/recordings/nope?team=${team}`, { title: 'x' })).status, 404);
  // delete: its files go from the streaming server
  const del = await web.del(`/api/productions/prod_show/recordings/${encodeURIComponent(b)}?team=${team}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.deepEqual(mtx.state.deleted, [[path, b]]);
  list = (await web.get(`/api/productions/prod_show/recordings?team=${team}`)).data;
  assert.deepEqual(list.list.map((v) => v.start), [a]);
});
