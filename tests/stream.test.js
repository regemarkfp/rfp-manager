'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

// A stand-in for MediaMTX's API: which paths are live and who watches.
async function fakeMediaMtx(t) {
  const state = { items: [] };
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/v3/paths/list')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ itemCount: state.items.length, pageCount: 1, items: state.items })); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { url: 'http://127.0.0.1:' + srv.address().port, state };
}

async function site(t, extra = {}) {
  const mtx = await fakeMediaMtx(t);
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: '', siteAdmins: ['ruan@example.com'], mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' },
    streaming: { host: 'tv.example.com', rtmpPort: 1935, srtPort: 8890, api: mtx.url, hookSecret: 'hook-secret' }, ...extra }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  assert.equal((await web.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' })).status, 200);
  const team = (await web.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const hook = (body) => fetch(cloud.url + '/api/stream/auth?s=hook-secret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  return { cloud, web, team, mtx, hook };
}

test('channels: stream keys, who may publish and watch, live status', async (t) => {
  const { cloud, web, team, mtx, hook } = await site(t);
  const put = (id, data, tm = team, c = web) => c.put(`/api/docs/channel/${id}?team=${tm}`, { data });

  const r = await put('channel_main', { name: 'Main Field!' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ch = r.data.doc.data;
  assert.equal(ch.slug, 'main-field');
  assert.equal(ch.access, 'Public');
  assert.match(ch.streamKey, /^[a-z2-9]{24}$/);
  // the browser cannot choose the key, and saving again keeps it
  const again = await put('channel_main', { ...ch, name: 'Main field', streamKey: 'mine' });
  assert.equal(again.data.doc.data.streamKey, ch.streamKey);
  // web addresses are unique across every team, some are reserved
  const other = (await web.post('/api/orgs', { name: 'Other team' })).data.id;
  assert.equal((await put('channel_x', { name: 'x', slug: 'main-field' }, other)).status, 409);
  assert.equal((await put('channel_y', { name: 'hls' })).status, 400);
  assert.equal((await put('channel_z', { name: 'Secret', access: 'Password' })).status, 400, 'a password channel needs its password');

  // MediaMTX's check: only with the hook secret
  assert.equal(await fetch(cloud.url + '/api/stream/auth?s=wrong', { method: 'POST', body: '{}' }).then((x) => x.status), 403);
  assert.equal(await hook({ action: 'publish', path: 'live/main-field', protocol: 'srt', user: 'publish', password: 'nope' }), 401);
  assert.equal(await hook({ action: 'publish', path: 'live/main-field', protocol: 'srt', user: 'publish', password: ch.streamKey }), 200);
  assert.equal(await hook({ action: 'publish', path: 'live/main-field', protocol: 'rtmp', user: '', password: '', query: `user=publish&pass=${ch.streamKey}` }), 200);
  assert.equal(await hook({ action: 'publish', path: 'live/nobody', protocol: 'rtmp', password: ch.streamKey }), 401);
  assert.equal(await hook({ action: 'read', path: 'live/main-field', protocol: 'webrtc' }), 200, 'public: anyone watches');
  assert.equal(await hook({ action: 'playback', path: 'live/main-field' }), 401);

  // the ingest settings for OBS / vMix
  mtx.state.items = [{ name: 'live/main-field', ready: true, readyTime: new Date(Date.now() - 60000).toISOString(), tracks: ['H264', 'MPEG-4 Audio'], bytesReceived: 1000, readers: [{ type: 'webRTCSession' }, { type: 'hlsMuxer' }] }];
  await cloud.streaming.poll();
  const s = (await web.get('/api/streams?team=' + team)).data;
  assert.equal(s.enabled, true);
  const row = s.list.find((x) => x.id === 'channel_main');
  assert.equal(row.live, true);
  assert.equal(row.viewers, 2);
  assert.deepEqual(row.tracks, ['H264', 'MPEG-4 Audio']);
  assert.equal(row.ingest.rtmpServer, 'rtmp://tv.example.com/live');
  assert.equal(row.ingest.rtmpKey, `main-field?user=publish&pass=${ch.streamKey}`);
  assert.equal(row.ingest.srtStreamId, `publish:live/main-field:publish:${ch.streamKey}`);

  // a crew member sees the channel but not its key
  const crew = client(cloud.url);
  await crew.post('/api/auth/signup', { name: 'Crew', email: 'crew@example.com', password: 'correct horse' });
  assert.equal((await web.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Crew' })).status, 200);
  const seen = (await crew.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'channel_main');
  assert.equal(seen.data.streamKey, undefined);
  assert.equal((await crew.get('/api/streams?team=' + team)).data.list[0].ingest, null);

  // a new key: the old one stops working
  const nk = (await web.post(`/api/channels/channel_main/newkey?team=${team}`)).data;
  assert.notEqual(nk.doc.data.streamKey, ch.streamKey);
  assert.equal(await hook({ action: 'publish', path: 'live/main-field', protocol: 'srt', password: ch.streamKey }), 401);
  assert.equal(await hook({ action: 'publish', path: 'live/main-field', protocol: 'srt', password: nk.doc.data.streamKey }), 200);

  // team-only: the watch page asks to sign in; a member gets a viewer token MediaMTX accepts
  await put('channel_main', { ...nk.doc.data, access: 'Team members' });
  const anon = client(cloud.url);
  const w0 = (await anon.get('/api/watch/main-field')).data;
  assert.equal(w0.needs, 'signin');
  assert.equal(w0.token, undefined);
  assert.equal(await hook({ action: 'read', path: 'live/main-field', protocol: 'webrtc' }), 401);
  const w1 = (await crew.get('/api/watch/main-field')).data;
  assert.equal(w1.needs, null);
  assert.equal(w1.live, true);
  assert.equal(w1.whep, '/webrtc/live/main-field/whep');
  assert.equal(await hook({ action: 'read', path: 'live/main-field', protocol: 'webrtc', user: 'viewer', password: w1.token }), 200);
  assert.equal(await hook({ action: 'read', path: 'live/main-field', protocol: 'hls', query: 'token=' + encodeURIComponent(w1.token) }), 200);
  assert.equal(await hook({ action: 'read', path: 'live/other', protocol: 'webrtc', password: w1.token }), 401, 'a token is for one channel');

  // password channel
  await put('channel_main', { ...nk.doc.data, access: 'Password', viewerPassword: 'braai' });
  assert.equal((await anon.get('/api/watch/main-field')).data.needs, 'password');
  assert.equal((await anon.post('/api/watch/main-field', { password: 'wrong' })).status, 403);
  const w2 = (await anon.post('/api/watch/main-field', { password: 'braai' })).data;
  assert.ok(w2.token);
  assert.equal((await crew.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'channel_main').data.viewerPassword, undefined);

  // switched off: nobody streams
  await put('channel_main', { ...nk.doc.data, access: 'Public', disabled: true });
  assert.equal(await hook({ action: 'publish', path: 'live/main-field', protocol: 'srt', password: nk.doc.data.streamKey }), 401);

  // the page itself, and an unknown channel
  const page = await fetch(cloud.url + '/watch/main-field');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/js\/watch\.js/);
  assert.match(page.headers.get('content-security-policy'), /media-src 'self' blob:/);
  assert.equal((await anon.get('/api/watch/nobody')).status, 404);

  // the stream stops
  mtx.state.items = [];
  await cloud.streaming.poll();
  assert.equal((await web.get('/api/streams?team=' + team)).data.list[0].live, false);
});

test('server setup: one command for a site admin hands out the program and the site settings', async (t) => {
  const { cloud, web } = await site(t);
  const me = (await web.get('/api/me')).data;
  assert.equal(me.machine.siteAdmin, true);
  const made = await web.post('/api/server/setup');
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const token = made.data.command.match(/--token (\S+)/)[1];
  assert.match(made.data.command, /^curl -fsSL http:\/\/127\.0\.0\.1:\d+\/server\/install\.sh \| sudo bash -s -- --from http:\/\/127\.0\.0\.1:\d+ --token \S+$/);

  const sh = await fetch(cloud.url + '/server/install.sh');
  assert.equal(sh.status, 200);
  assert.match(await sh.text(), /^#!\/usr\/bin\/env bash/);
  const env = await fetch(`${cloud.url}/api/server/env?t=${token}`).then((r) => r.text());
  assert.match(env, /^MODE=cloud$/m);
  assert.match(env, /^MONGODB_URI=mongodb:\/\/fake-/m);
  assert.match(env, /^SITE_ADMINS=ruan@example\.com$/m);
  const tgz = Buffer.from(await fetch(`${cloud.url}/api/server/bundle.tgz?t=${token}`).then((r) => r.arrayBuffer()));
  const tar = zlib.gunzipSync(tgz);
  const names = [];
  for (let o = 0; o + 512 <= tar.length;) {
    const name = tar.subarray(o, o + 100).toString().replace(/\0.*$/s, '');
    if (!name) break;
    const prefix = tar.subarray(o + 345, o + 500).toString().replace(/\0.*$/s, '');
    const size = parseInt(tar.subarray(o + 124, o + 136).toString(), 8);
    names.push(prefix ? prefix + '/' + name : name);
    o += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(names.includes('rfp-manager/server.js'));
  assert.ok(names.includes('rfp-manager/lib/stream.js'));
  assert.ok(names.includes('rfp-manager/tools/server/install.sh'));
  assert.ok(!names.some((n) => /config\.json$|\/data\//.test(n)), 'no data or config in the bundle');

  // wrong or old links, and people who are not site admins
  assert.equal((await fetch(`${cloud.url}/api/server/env?t=nope`)).status, 403);
  const eve = client(cloud.url);
  await eve.post('/api/auth/signup', { name: 'Eve', email: 'eve@example.com', password: 'correct horse' });
  assert.equal((await eve.post('/api/server/setup')).status, 403);
  assert.equal((await eve.get('/api/me')).data.machine.siteAdmin, false);
  assert.equal((await web.del('/api/server/setup')).status, 200);
  assert.equal((await fetch(`${cloud.url}/api/server/bundle.tgz?t=${token}`)).status, 403);
});
