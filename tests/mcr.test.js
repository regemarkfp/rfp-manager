'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { target, destinationsOf, hideKey } = require('../lib/restream');

// a stand-in for MediaMTX: what is live, and kicking a camera off
async function fakeMediaMtx(t) {
  const state = { items: [], kicked: [] };
  const srv = http.createServer((req, res) => {
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/v3/paths/list') return json({ items: state.items });
    if (u.pathname === '/v3/recordings/list') return json({ items: [] });
    if (u.pathname === '/v3/config/paths/list') return json({ items: [] });
    if (u.pathname.startsWith('/v3/paths/get/')) { const it = state.items.find((x) => x.name === decodeURIComponent(u.pathname.slice(14))); return it ? json({ ...it, source: { type: 'srtConn', id: 'conn-' + it.name } }) : (res.writeHead(404), res.end()); }
    if (u.pathname.startsWith('/v3/srtconns/kick/') && req.method === 'POST') { const id = decodeURIComponent(u.pathname.slice(18)); state.kicked.push(id); state.items = state.items.filter((x) => 'conn-' + x.name !== id); return json({}); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { url: 'http://127.0.0.1:' + srv.address().port, state };
}
async function site(t) {
  const mtx = await fakeMediaMtx(t);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-mcr-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://tv.example.com', dataDir, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' },
    streaming: { host: 'tv.example.com', rtmpPort: 1935, srtPort: 8890, api: mtx.url, playback: mtx.url, hookSecret: 'hook-secret' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  assert.equal((await web.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' })).status, 200);
  const team = (await web.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const put = (type, id, data) => web.put(`/api/docs/${type}/${id}?team=${team}`, { data });
  const hook = (body) => fetch(cloud.url + '/api/stream/auth?s=hook-secret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  return { cloud, web, team, mtx, put, hook };
}
const haveFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('master control: slates (timed, cued), video adverts with a countdown, overlays only in the app', async (t) => {
  const { cloud, web, team, mtx, put } = await site(t);
  await put('channel', 'channel_tv', { name: 'Schools TV' });
  assert.equal((await put('production', 'prod_show', { name: 'Derby day', date: '2026-10-17', txTime: '15:00', streamChannel: 'channel_tv' })).status, 200);
  const slug = (await cloud.store.get('prod_show')).data.streamSlug;
  mtx.state.items = [{ name: 'live/' + slug, ready: true, readyTime: new Date().toISOString(), tracks: ['H264'], readers: [] }];
  await cloud.streaming.poll();
  const mcr = (body) => web.post(`/api/productions/prod_show/mcr?team=${team}`, body);
  const viewer = () => fetch(cloud.url + `/api/watch/${slug}/mcr`).then((r) => r.json());

  // nothing on: the viewers get a clean picture
  let v = await viewer();
  assert.equal(v.slate, null); assert.equal(v.ad, null); assert.deepEqual(v.overlays, []);

  // a weather slate for 20 minutes, sound off
  let r = await mcr({ action: 'slate', kind: 'weather', minutes: 20 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.state.slate.title, 'Weather delay');
  assert.equal(r.data.state.slate.mute, false, 'the sound stays on unless asked');
  v = await viewer();
  assert.equal(v.slate.kind, 'weather');
  assert.ok(Date.parse(v.slate.until) - Date.now() > 19 * 60e3);
  // the Live streams page shows it
  let streams = (await web.get(`/api/streams?team=${team}`)).data.list;
  assert.equal(streams[0].mcr.slate.kind, 'weather');
  // a custom slate with its own words; then cleared
  r = await mcr({ action: 'slate', kind: 'custom', title: 'Lightning in the area', text: 'Players are off the field.', mute: true });
  assert.equal(r.data.state.slate.title, 'Lightning in the area'); assert.equal(r.data.state.slate.mute, true);
  await mcr({ action: 'clearSlate' });
  assert.equal((await viewer()).slate, null);
  // a countdown slate: to a time (or for some minutes); it goes off by itself at zero
  const to = new Date(Date.now() + 90e3).toISOString();
  r = await mcr({ action: 'slate', kind: 'countdown', title: 'Kick-off in', countTo: to });
  assert.equal(r.data.state.slate.countTo, to); assert.equal(r.data.state.slate.until, to); assert.equal(r.data.state.slate.title, 'Kick-off in');
  r = await mcr({ action: 'slate', kind: 'countdown', minutes: 10 });
  assert.ok(Math.abs(Date.parse(r.data.state.slate.countTo) - Date.now() - 600e3) < 3000);
  assert.equal(r.data.state.slate.title, 'Starting soon');
  await mcr({ action: 'clearSlate' });
  // before the stream: the watch page counts down to the production's TX time (South African time unless set)
  const w = (await client(cloud.url).get('/api/watch/' + slug)).data;
  assert.equal(w.startsAt, '2026-10-17T13:00:00.000Z');
  assert.equal((await mcr({ action: 'nonsense' })).status, 400);

  // a cue: a connection slate in a moment; the clock (tick) puts it on
  const at = new Date(Date.now() + 1500).toISOString();
  r = await mcr({ action: 'addCue', at, do: 'slate', kind: 'connection', minutes: 0 });
  assert.equal(r.data.state.cues.length, 1);
  await cloud.mcr.tick();
  assert.equal((await viewer()).slate, null, 'not yet');
  await new Promise((res) => setTimeout(res, 1600));
  await cloud.mcr.tick();
  v = await viewer();
  assert.equal(v.slate.kind, 'connection');
  assert.equal((await cloud.mcr.state({ prod: await cloud.store.get('prod_show') })).cues.length, 0, 'a cue runs once');
  await mcr({ action: 'clearAll' });

  // overlays: only the ones switched on reach the viewers
  r = await mcr({ action: 'overlays', overlays: [{ kind: 'bug', on: true, text: 'LIVE', pos: 'tr' }, { kind: 'lower', on: false, text: 'Not shown' }, { kind: 'ticker', on: true, text: 'Next match 15:00' }, { kind: 'nope', on: true }] });
  assert.equal(r.data.state.overlays.length, 3);
  v = await viewer();
  assert.deepEqual(v.overlays.map((o) => o.kind), ['bug', 'ticker']);

  // ad break without adverts: refused
  assert.equal((await mcr({ action: 'ads', ads: [] })).status, 400);

  // a viewer of another team cannot drive it
  const other = client(cloud.url);
  await other.post('/api/auth/signup', { name: 'Other', email: 'other@example.com', password: 'correct horse' });
  assert.equal((await other.post(`/api/productions/prod_show/mcr?team=${team}`, { action: 'clearAll' })).status, 403);

  if (!haveFfmpeg) return t.diagnostic('ffmpeg not installed: video adverts not tested');
  // video adverts: upload two (4 s and 2 s), play them as an ad break
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-ads-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const make = (secs, name) => { const f = path.join(dir, name); execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=160x90:rate=25:duration=${secs}`, '-f', 'lavfi', '-i', `sine=duration=${secs}`, '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', '-y', f]); return fs.readFileSync(f); };
  const up = (buf, name) => fetch(cloud.url + `/api/videoads?team=${team}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'x-rfp': '1', cookie: web.cookie(), 'content-type': 'video/mp4' }, body: buf }).then(async (x) => ({ status: x.status, data: await x.json() }));
  const a1 = await up(make(4, 'a.mp4'), 'Sponsor one.mp4');
  assert.equal(a1.status, 200, JSON.stringify(a1.data));
  assert.equal(a1.data.ad.title, 'Sponsor one');
  assert.ok(Math.abs(a1.data.ad.duration - 4) < 0.3, 'length from ffprobe: ' + a1.data.ad.duration);
  const a2 = await up(make(2, 'b.mp4'), 'Sponsor two.mp4');
  assert.equal((await fetch(cloud.url + `/api/videoads?team=${team}&name=x`, { method: 'POST', headers: { 'x-rfp': '1', cookie: web.cookie(), 'content-type': 'image/png' }, body: Buffer.from('x') })).status, 415);
  assert.equal((await web.get(`/api/videoads?team=${team}`)).data.list.length, 2);
  // the file plays with byte ranges
  const whole = await fetch(cloud.url + a1.data.ad.url);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('content-type'), 'video/mp4');
  const size = (await whole.arrayBuffer()).byteLength;
  const part = await fetch(cloud.url + a1.data.ad.url, { headers: { range: 'bytes=0-99' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 0-99/${size}`); assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(cloud.url + '/ads/vad_nothere.mp4')).status, 404);

  r = await mcr({ action: 'ads', ads: [a1.data.ad.id, a2.data.ad.id] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Math.abs(Date.parse(r.data.state.ad.endsAt) - Date.parse(r.data.state.ad.startedAt) - 6000) < 400);
  v = await viewer();
  assert.deepEqual(v.ad.items.map((i) => i.title), ['Sponsor one', 'Sponsor two']);
  assert.ok(v.ad.items[0].url.startsWith('/ads/vad_'));
  // the countdown: the Studio, and the production PC's pages (signed in)
  streams = (await web.get(`/api/streams?team=${team}`)).data.list;
  assert.equal(streams[0].mcr.ad.count, 2); assert.equal(streams[0].mcr.ad.index, 0); assert.equal(streams[0].mcr.ad.title, 'Sponsor one');
  const act = (await web.get('/api/mcr/active')).data;
  assert.equal(act.list.length, 1); assert.equal(act.list[0].title, 'Derby day'); assert.ok(Date.parse(act.list[0].ad.endsAt) > act.now);
  assert.equal((await client(cloud.url).get('/api/mcr/active')).status, 401);
  assert.equal((await other.get('/api/mcr/active')).data.list.length, 0, 'other teams see nothing');
  // stop the ad break: back to the live picture
  await mcr({ action: 'stopAds' });
  assert.equal((await viewer()).ad, null);
  // the clock ends ad breaks by itself
  await mcr({ action: 'ads', ads: [a2.data.ad.id] });
  await new Promise((res) => setTimeout(res, 2100));
  await cloud.mcr.tick();
  assert.equal((await cloud.mcr.state({ prod: await cloud.store.get('prod_show') })).ad, null);
  // deleting an advert deletes its file
  assert.equal((await web.del(`/api/videoads/${a2.data.ad.id}?team=${team}`)).status, 200);
  assert.equal((await fetch(cloud.url + a2.data.ad.url)).status, 404);

  // squeeze-back videos are a list of their own; presets play an ad break or a squeeze-back in one go
  const up2 = (buf, name, kind, type = 'video/mp4') => fetch(cloud.url + `/api/videoads?team=${team}&kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'x-rfp': '1', cookie: web.cookie(), 'content-type': type }, body: buf }).then(async (x) => ({ status: x.status, data: await x.json() }));
  const sq1 = await up2(make(3, 'c.mp4'), 'Sponsor loop.mp4', 'squeeze');
  assert.equal(sq1.data.ad.kind, 'squeeze');
  assert.equal(sq1.data.ad.faststart, true, 'ready to play at once on phones');
  const lib = (await web.get(`/api/videoads?team=${team}`)).data.list;
  assert.deepEqual(lib.map((x) => [x.title, x.kind]).sort(), [['Sponsor loop', 'squeeze'], ['Sponsor one', 'ad']]);
  assert.equal((await web.put(`/api/adpresets/new?team=${team}`, { kind: 'ads', name: 'Empty' })).status, 400);
  const pa = (await web.put(`/api/adpresets/new?team=${team}`, { kind: 'ads', name: 'Half time', ads: [a1.data.ad.id, 'vad_nothere'] })).data.preset;
  assert.deepEqual(pa.ads, [a1.data.ad.id]);
  const ps = (await web.put(`/api/adpresets/new?team=${team}`, { kind: 'squeeze', name: 'Sponsor squeeze', ads: [sq1.data.ad.id], pos: 'bl', sound: 'live' })).data.preset;
  assert.equal((await web.get(`/api/adpresets?team=${team}`)).data.list.length, 2);
  r = await mcr({ action: 'preset', preset: ps.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  v = await viewer();
  assert.equal(v.squeeze.pos, 'bl'); assert.equal(v.squeeze.sound, 'live'); assert.equal(v.squeeze.size, 75); assert.equal(v.squeeze.items[0].title, 'Sponsor loop');
  r = await mcr({ action: 'preset', preset: pa.id });
  v = await viewer();
  assert.equal(v.ad.items[0].title, 'Sponsor one'); assert.equal(v.squeeze, null, 'an ad break takes over from a squeeze-back');
  await mcr({ action: 'stopAds' });
  // a preset on a cue and on an automatic rule
  r = await mcr({ action: 'addCue', at: new Date(Date.now() + 60e3).toISOString(), do: 'preset', preset: ps.id });
  assert.equal(r.data.state.cues.at(-1).preset, ps.id);
  r = await mcr({ action: 'setAuto', rules: [{ when: 'try', do: 'preset', preset: ps.id }] });
  assert.equal(r.data.state.auto[0].preset, ps.id);
  assert.equal((await web.del(`/api/adpresets/${pa.id}?team=${team}`)).status, 200);

  // music under a slate: any sound file, made AAC; the stream's slate music plays under every slate
  const wav = path.join(dir, 'm.wav'); execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-y', wav]);
  const mu = await up2(fs.readFileSync(wav), 'Hold music.wav', 'music', 'audio/wav');
  assert.equal(mu.status, 200, JSON.stringify(mu.data));
  assert.equal(mu.data.ad.kind, 'music'); assert.equal(mu.data.ad.mime, 'audio/mp4');
  assert.equal((await up2(Buffer.from('x'), 'x.png', 'music', 'image/png')).status, 415);
  assert.equal((await fetch(cloud.url + mu.data.ad.url)).headers.get('content-type'), 'audio/mp4');
  await mcr({ action: 'setMusic', music: mu.data.ad.id });
  await mcr({ action: 'slate', kind: 'weather' });
  v = await viewer();
  assert.equal(v.slate.music, mu.data.ad.url);
  await mcr({ action: 'slate', kind: 'break', music: '' });
  assert.equal((await viewer()).slate.music, '', 'one slate without music');
  assert.equal((await mcr({ action: 'setMusic', music: 'vad_nothere' })).status, 400);
});

test('several venues at once: a stream per match, each with its own key, page, ending and restreams', async (t) => {
  const { cloud, web, team, mtx, put, hook } = await site(t);
  await put('channel', 'channel_tv', { name: 'Schools TV' });
  await put('fixture', 'fixture_a1', { name: 'Grey v Shimla', sport: 'Rugby', startDate: '2026-10-17' });
  await put('fixture', 'fixture_b2', { name: 'Grey v Paul Roos', sport: 'Rugby', startDate: '2026-10-17' });
  let r = await put('production', 'prod_day', { name: 'Schools rugby day', date: '2026-10-17', streamChannel: 'channel_tv', streamPerMatch: true, fixtures: [{ fixture: 'fixture_a1' }, { fixture: 'fixture_b2' }],
    streamRestream: [{ name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2', key: 'yt-secret-key', on: true }, { name: 'Facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', key: 'fb-secret', fixture: 'fixture_b2', on: true }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const prod = await cloud.store.get('prod_day');
  const ms = prod.data.matchStreams;
  assert.deepEqual(Object.keys(ms).sort(), ['fixture_a1', 'fixture_b2']);
  assert.equal(ms.fixture_a1.slug, 'schools-rugby-day-2026-grey-v-shimla');
  assert.notEqual(ms.fixture_a1.key, ms.fixture_b2.key);
  // saving again keeps the addresses and keys (whatever the form sends)
  await put('production', 'prod_day', { ...prod.data, name: 'Schools rugby day!', matchStreams: { fixture_a1: { slug: 'hijack', key: 'mine' } } });
  assert.deepEqual((await cloud.store.get('prod_day')).data.matchStreams, ms);

  // the cameras: each match's key publishes on its own address only
  const pub = (slug, key) => hook({ action: 'publish', path: 'live/' + slug, query: `user=publish&pass=${key}`, ip: '10.0.0.1' });
  assert.equal(await pub(ms.fixture_a1.slug, ms.fixture_a1.key), 200);
  assert.equal(await pub(ms.fixture_b2.slug, ms.fixture_b2.key), 200);
  assert.equal(await pub(ms.fixture_a1.slug, ms.fixture_b2.key), 401);
  assert.equal(await pub(prod.data.streamSlug, prod.data.streamKey), 200);

  // the Live streams page: the production and both matches, with their ingest and restreams
  let list = (await web.get(`/api/streams?team=${team}`)).data.list;
  assert.equal(list.length, 3);
  const a1 = list.find((x) => x.fixture === 'fixture_a1'), b2 = list.find((x) => x.fixture === 'fixture_b2'), main = list.find((x) => !x.fixture);
  assert.equal(a1.id, 'prod_day~fixture_a1'); assert.equal(a1.parent, 'prod_day'); assert.equal(a1.title, 'Grey v Shimla');
  assert.ok(a1.ingest.srtStreamId.includes(ms.fixture_a1.key));
  assert.deepEqual(main.restream.map((d) => [d.name, d.state]), [['YouTube', 'waiting']]);
  assert.deepEqual(b2.restream.map((d) => d.name), ['Facebook']);
  assert.ok(!JSON.stringify(main.restream).includes('yt-secret-key'), 'restream keys are not shown');
  assert.deepEqual(a1.restream, []);

  // the watch pages
  mtx.state.items = [{ name: 'live/' + ms.fixture_a1.slug, ready: true, readyTime: new Date().toISOString(), tracks: ['H264'], readers: [] }];
  await cloud.streaming.poll();
  const w = (await client(cloud.url).get('/api/watch/' + ms.fixture_a1.slug)).data;
  assert.equal(w.title, 'Grey v Shimla'); assert.equal(w.live, true);
  assert.equal((await client(cloud.url).get('/api/watch/' + ms.fixture_b2.slug)).data.live, false);
  // master control works per match
  assert.equal((await web.post(`/api/productions/prod_day~fixture_a1/mcr?team=${team}`, { action: 'slate', kind: 'weather' })).status, 200);
  assert.equal((await fetch(cloud.url + `/api/watch/${ms.fixture_a1.slug}/mcr`).then((x) => x.json())).slate.kind, 'weather');
  assert.equal((await fetch(cloud.url + `/api/watch/${ms.fixture_b2.slug}/mcr`).then((x) => x.json())).slate, null);

  // ending one match closes that key only
  r = await web.post(`/api/productions/prod_day~fixture_a1/stream/end?team=${team}`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(mtx.state.kicked, ['conn-live/' + ms.fixture_a1.slug]);
  assert.equal(await pub(ms.fixture_a1.slug, ms.fixture_a1.key), 401);
  assert.equal(await pub(ms.fixture_b2.slug, ms.fixture_b2.key), 200);
  assert.equal((await cloud.store.get('prod_day')).data.matchStreams.fixture_a1.closed, true);
  await web.post(`/api/productions/prod_day~fixture_a1/stream/reopen?team=${team}`, {});
  assert.equal(await pub(ms.fixture_a1.slug, ms.fixture_a1.key), 200);
  // a new key for one match
  r = await web.post(`/api/productions/prod_day~fixture_b2/newkey?team=${team}`, {});
  assert.equal(r.status, 200);
  const nk = (await cloud.store.get('prod_day')).data.matchStreams.fixture_b2.key;
  assert.notEqual(nk, ms.fixture_b2.key);
  assert.equal(await pub(ms.fixture_b2.slug, ms.fixture_b2.key), 401);
  assert.equal(await pub(ms.fixture_b2.slug, nk), 200);

  // a Crew member sees the streams but no keys
  const crew = client(cloud.url);
  await crew.post('/api/auth/signup', { name: 'Cam Op', email: 'cam@example.com', password: 'correct horse' });
  assert.equal((await web.post(`/api/members?team=${team}`, { email: 'cam@example.com', role: 'Crew' })).status, 200);
  const docs = (await crew.get(`/api/docs?team=${team}`)).data.docs;
  const p2 = docs.find((d) => d.id === 'prod_day');
  assert.ok(p2 && p2.data.matchStreams.fixture_b2.slug, 'the match streams are there');
  const text = JSON.stringify(docs);
  assert.ok(!text.includes(nk), 'no match keys'); assert.ok(!text.includes('yt-secret-key'), 'no restream keys');
  assert.equal(p2.data.streamRestream[0].name, 'YouTube');
});

test('restream destinations: the address joined with the key, per production or match', () => {
  assert.equal(target('rtmp://a.rtmp.youtube.com/live2', 'abcd-efgh'), 'rtmp://a.rtmp.youtube.com/live2/abcd-efgh');
  assert.equal(target('rtmps://live-api-s.facebook.com:443/rtmp/', 'FB-1'), 'rtmps://live-api-s.facebook.com:443/rtmp/FB-1');
  assert.equal(target('rtmp://server/app/stream', ''), 'rtmp://server/app/stream');
  assert.equal(target('http://nope', 'x'), '');
  assert.equal(hideKey('rtmp://a.rtmp.youtube.com/live2/abcd-efgh'), 'rtmp://a.rtmp.youtube.com/live2/ab…');
  const rows = [{ name: 'YT', url: 'rtmp://yt/live2', key: 'k1' }, { name: 'FB', url: 'rtmps://fb/rtmp', key: 'k2', fixture: 'fixture_x', on: false }, { url: 'bad' }];
  assert.deepEqual(destinationsOf({ data: { streamRestream: rows } }).map((d) => [d.name, d.url, d.on]), [['YT', 'rtmp://yt/live2/k1', true]]);
  assert.deepEqual(destinationsOf({ fixtureId: 'fixture_x', data: { streamRestream: rows } }).map((d) => [d.name, d.on]), [['FB', false]]);
});

test('squeeze-backs, by hand and automatically on game events from the scorer', async (t) => {
  const { cloud, web, team, mtx, put } = await site(t);
  await put('channel', 'channel_tv', { name: 'Schools TV' });
  await put('fixture', 'fixture_a1', { name: 'Grey v Shimla', sport: 'Rugby', startDate: '2026-10-17' });
  assert.equal((await put('production', 'prod_show', { name: 'Derby day', date: '2026-10-17', streamChannel: 'channel_tv', fixtures: [{ fixture: 'fixture_a1' }] })).status, 200);
  const slug = (await cloud.store.get('prod_show')).data.streamSlug;
  const mcr = (body) => web.post(`/api/productions/prod_show/mcr?team=${team}`, body);
  const viewer = () => fetch(cloud.url + `/api/watch/${slug}/mcr`).then((r) => r.json());
  // a sponsor board (an image) for 30 seconds, the live picture top right
  const img = (await fetch(cloud.url + `/api/images?team=${team}&name=board.png`, { method: 'POST', headers: { 'x-rfp': '1', cookie: web.cookie(), 'content-type': 'image/png' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }).then((r) => r.json())).doc.id;
  assert.equal((await mcr({ action: 'squeeze' })).status, 400, 'nothing to show');
  let r = await mcr({ action: 'squeeze', image: img, seconds: 30, pos: 'tr', text: 'Brought to you by …' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let v = await viewer();
  assert.equal(v.squeeze.image, img); assert.equal(v.squeeze.pos, 'tr');
  assert.ok(Math.abs(Date.parse(v.squeeze.endsAt) - Date.parse(v.squeeze.startedAt) - 30000) < 50);
  assert.ok((await web.get(`/api/streams?team=${team}`)).data.list[0].mcr.squeeze.board);
  await mcr({ action: 'stopSqueeze' });
  assert.equal((await viewer()).squeeze, null);

  // automation: a try squeezes back (only while live, once per cool-down, never on top of a break)
  r = await mcr({ action: 'setAuto', rules: [{ when: 'try', do: 'squeeze', image: img, seconds: 20, cooldown: 300 }, { when: 'Red Card!', do: 'slate', kind: 'break', minutes: 2 }] });
  assert.deepEqual(r.data.state.auto.map((x) => [x.when, x.do]), [['try', 'squeeze'], ['redcard', 'slate']]);
  const event = (body) => web.post('/api/mcr/event', { fixtureId: 'fixture_a1', ...body });
  assert.equal((await event({ kind: 'try', team: 'A' })).data.ran, 0, 'not live: nothing');
  mtx.state.items = [{ name: 'live/' + slug, ready: true, readyTime: new Date().toISOString(), tracks: ['H264'], readers: [] }];
  await cloud.streaming.poll();
  assert.equal((await event({ kind: 'conversion', team: 'A' })).data.ran, 0, 'no rule for a conversion');
  assert.equal((await event({ kind: 'try', team: 'A' })).data.ran, 1);
  v = await viewer();
  assert.equal(v.squeeze.image, img);
  await mcr({ action: 'stopSqueeze' });
  assert.equal((await event({ kind: 'try', team: 'B' })).data.ran, 0, 'resting (cool-down)');
  // an event from the scorer on a production PC arrives the same way; another team cannot send one
  const other = client(cloud.url);
  await other.post('/api/auth/signup', { name: 'Other', email: 'other@example.com', password: 'correct horse' });
  assert.equal((await other.post('/api/mcr/event', { fixtureId: 'fixture_a1', kind: 'try' })).status, 403);
  // the game-event hook on the website itself (the Android scorer through the website) also runs the rules
  await mcr({ action: 'setAuto', rules: [{ when: 'wicket', do: 'squeeze', image: img, seconds: 15, cooldown: 0 }] });
  cloud.emit('gameevent', { fixtureId: 'fixture_a1', kind: 'wicket', also: ['ball'], team: 'B' });
  await new Promise((res) => setTimeout(res, 300));
  assert.ok((await viewer()).squeeze, 'squeezed back on the wicket');
});

test('the production PC: ad break countdown for its screens (screen key), and the /mcr monitor link', async (t) => {
  const pc = await boot({});
  t.after(() => pc.stop());
  const end = new Date(Date.now() + 45000).toISOString();
  await pc.save('org_x', 'mcr', 'mcr_abc', { slug: 'derby', production: 'prod_x', ad: { items: [{ id: 'vad_one', title: 'One', duration: 45 }], startedAt: new Date().toISOString(), endsAt: end }, slate: null, overlays: [], cues: [] }, '');
  const r = await fetch(`${pc.url}/api/mcr/active?key=${pc.config.outputKey}`).then((x) => x.json());
  assert.equal(r.list.length, 1); assert.equal(r.list[0].ad.endsAt, end);
  assert.equal((await fetch(`${pc.url}/api/mcr/active?key=wrong`)).status, 401);
  const go = await fetch(`${pc.url}/mcr`, { redirect: 'manual' });
  assert.equal(go.status, 302); assert.ok(go.headers.get('location').startsWith('/live/mcr.html?key='));
  assert.equal((await fetch(pc.url + '/live/mcr.html')).status, 200);
});
