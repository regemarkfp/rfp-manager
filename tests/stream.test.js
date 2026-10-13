'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

// A stand-in for MediaMTX: its API (what is live, which recordings) and its playback server (the recordings' times).
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

test('streams: a production streams on a branded channel; keys, who may watch, live, recordings, the public site, subscribing', async (t) => {
  const { cloud, web, team, mtx, hook } = await site(t);
  const put = (type, id, data, tm = team, c = web) => c.put(`/api/docs/${type}/${id}?team=${tm}`, { data });
  await put('club', 'club_che', { name: 'Toyota Cheetahs', primaryColor: '#ff8800', image: '' });
  const chr = await put('channel', 'channel_che', { name: 'Cheetahs TV!', owner: 'Club', club: 'club_che', description: 'Rugby from Bloemfontein' });
  assert.equal(chr.status, 200, JSON.stringify(chr.data));
  assert.equal(chr.data.doc.data.slug, 'cheetahs-tv');
  assert.equal((await put('channel', 'channel_x', { name: 'x', slug: 'cheetahs-tv' })).status, 409);
  assert.equal((await put('channel', 'channel_y', { name: 'videos' })).status, 400, 'reserved');
  await put('channel', 'channel_team', { name: 'Crew only', access: 'Team members' });

  // the production gets the stream key
  const pr = await put('production', 'prod_one', { name: 'Saturday Rugby', date: '2026-10-17', streamChannel: 'channel_che' });
  assert.equal(pr.status, 200, JSON.stringify(pr.data));
  const p = pr.data.doc.data;
  assert.equal(p.streamSlug, 'saturday-rugby-2026-10-17');
  assert.match(p.streamKey, /^[a-z2-9]{24}$/);
  assert.equal(p.streamRecord, true);
  const again = await put('production', 'prod_one', { ...p, streamKey: 'mine', notes: 'x' });
  assert.equal(again.data.doc.data.streamKey, p.streamKey, 'the browser cannot choose the key');
  const p2 = (await put('production', 'prod_two', { name: 'Saturday Rugby', date: '2026-10-17', streamChannel: 'channel_che' })).data.doc.data;
  assert.equal(p2.streamSlug, 'saturday-rugby-2026-10-17-2', 'stream addresses are unique');
  assert.equal((await put('production', 'prod_three', { name: 'Elsewhere', streamChannel: 'nope' })).status, 400);

  // MediaMTX's check
  assert.equal(await fetch(cloud.url + '/api/stream/auth?s=wrong', { method: 'POST', body: '{}' }).then((x) => x.status), 403);
  const path = 'live/' + p.streamSlug;
  assert.equal(await hook({ action: 'publish', path, protocol: 'srt', password: 'nope' }), 401);
  assert.equal(await hook({ action: 'publish', path, protocol: 'srt', password: p.streamKey }), 200);
  assert.equal(await hook({ action: 'publish', path, protocol: 'rtmp', query: `user=publish&pass=${p.streamKey}` }), 200);
  assert.equal(await hook({ action: 'publish', path: 'live/' + p2.streamSlug, protocol: 'srt', password: p.streamKey }), 401, 'a key is for its own production');
  assert.equal(await hook({ action: 'read', path, protocol: 'webrtc' }), 200, 'public channel: anyone watches');
  assert.equal(await hook({ action: 'playback', path }), 200, 'and plays the recordings');

  // live and a recording
  mtx.state.items = [{ name: path, ready: true, readyTime: new Date(Date.now() - 60000).toISOString(), tracks: ['H264', 'MPEG-4 Audio'], bytesReceived: 1000, readers: [{}, {}] }];
  mtx.state.recordings[path] = [{ start: '2026-10-10T13:00:00Z', duration: 5400, url: 'x' }, { start: '2026-10-10T16:00:00Z', duration: 5, url: 'x' }];
  await cloud.streaming.poll();
  await cloud.streaming.pollVods();
  assert.equal(mtx.state.auth[0], 'Basic ' + Buffer.from('rfp:hook-secret').toString('base64'), 'the site lists recordings with its own secret');
  assert.equal(await hook({ action: 'playback', path, user: 'rfp', password: 'hook-secret' }), 200);
  const s = (await web.get('/api/streams?team=' + team)).data;
  const row = s.list.find((x) => x.id === 'prod_one');
  assert.equal(row.live, true);
  assert.equal(row.viewers, 2);
  assert.equal(row.videos, 1, 'a few seconds is not a video');
  assert.equal(row.ingest.rtmpKey, `${p.streamSlug}?user=publish&pass=${p.streamKey}`);
  assert.equal(row.ingest.srtStreamId, `publish:${path}:publish:${p.streamKey}`);
  const nk = (await web.post(`/api/productions/prod_one/newkey?team=${team}`)).data;
  assert.notEqual(nk.doc.data.streamKey, p.streamKey);
  assert.equal(await hook({ action: 'publish', path, protocol: 'srt', password: p.streamKey }), 401);

  // the watch page: live, and a recording
  const anon = client(cloud.url);
  const w = (await anon.get('/api/watch/' + p.streamSlug)).data;
  assert.equal(w.live, true);
  assert.equal(w.title, 'Saturday Rugby');
  assert.equal(w.channel.name, 'Cheetahs TV!');
  assert.equal(w.channel.color, '#ff8800', 'a club channel takes the club colour');
  assert.equal(w.whep, `/webrtc/${path}/whep`);
  const wv = (await anon.get(`/api/watch/${p.streamSlug}?v=2026-10-10T13:00:00Z`)).data;
  assert.equal(wv.vod.duration, 5400);
  assert.match(wv.vod.url, /^\/vod\/get\?path=live%2Fsaturday-rugby-2026-10-17&start=2026-10-10T13%3A00%3A00Z&duration=5400&format=mp4$/);

  // the public website
  const home = (await anon.get('/api/public/home')).data;
  assert.equal(home.live.length, 1);
  assert.equal(home.live[0].slug, p.streamSlug);
  assert.equal(home.videos.length, 1);
  assert.deepEqual(home.channels.map((c) => c.slug), ['cheetahs-tv'], 'team-only channels are not on the public site');
  assert.equal(home.me, null);
  assert.equal(home.matches.upcoming.length, 0, 'matches only when the team says so');
  const page = await fetch(cloud.url + '/');
  assert.match(await page.text(), /\/js\/public\.js/);
  assert.match(await (await fetch(cloud.url + '/c/cheetahs-tv')).text(), /\/js\/public\.js/);
  assert.match(await (await fetch(cloud.url + '/app')).text(), /\/js\/app\.js/, 'the production teams\' app');
  const chp = (await anon.get('/api/public/c/cheetahs-tv')).data;
  assert.equal(chp.channel.description, 'Rugby from Bloemfontein');
  assert.equal(chp.streams.length, 2);
  assert.equal((await anon.get('/api/public/c/crew-only')).status, 404);

  // subscribing; subscribers hear when it goes live
  assert.equal((await anon.post('/api/public/subscribe', { channel: 'channel_che' })).status, 401);
  const fan = client(cloud.url);
  await fan.post('/api/auth/signup', { name: 'Fan', email: 'fan@example.com', password: 'correct horse' });
  const sub = await fan.post('/api/public/subscribe', { channel: 'channel_che' });
  assert.equal(sub.data.subscribed, true);
  assert.equal((await fan.get('/api/public/c/cheetahs-tv')).data.subscribers, 1);
  assert.deepEqual((await fan.get('/api/public/home')).data.me.subscriptions, ['channel_che']);
  mtx.state.items = [];
  await cloud.streaming.poll();
  mtx.state.items = [{ name: 'live/' + p2.streamSlug, ready: true, readers: [] }];
  await cloud.streaming.poll();
  await cloud.notify.idle();
  const mail = cloud.mail.outbox.find((m) => m.to.includes('fan@example.com'));
  assert.ok(mail, JSON.stringify(cloud.mail.outbox.map((m) => m.subject)));
  assert.match(mail.subject, /Cheetahs TV! is live: Saturday Rugby/);
  assert.match(mail.text, /https:\/\/tv\.example\.com\/watch\/saturday-rugby-2026-10-17-2/);
  assert.equal((await fan.post('/api/public/subscribe', { channel: 'channel_che', on: false })).data.subscribed, false);

  // team-only channel: sign in, then a viewer token
  await put('production', 'prod_team', { name: 'Crew briefing', streamChannel: 'channel_team' });
  const ps = (await cloud.store.get('prod_team')).data.streamSlug;
  assert.equal((await anon.get('/api/watch/' + ps)).data.needs, 'signin');
  assert.equal(await hook({ action: 'read', path: 'live/' + ps, protocol: 'webrtc' }), 401);
  const tw = (await web.get('/api/watch/' + ps)).data;
  assert.equal(tw.needs, null);
  assert.equal(await hook({ action: 'read', path: 'live/' + ps, protocol: 'webrtc', user: 'viewer', password: tw.token }), 200);
  assert.equal(await hook({ action: 'read', path: 'live/' + p.streamSlug, protocol: 'webrtc', password: 'x' }), 200, 'the public one stays public');

  // not recorded: MediaMTX gets a path setting with recording off
  await put('production', 'prod_two', { ...(await cloud.store.get('prod_two')).data, streamRecord: false });
  await cloud.streaming.pollVods();
  assert.deepEqual(mtx.state.pathConfigs.map((c) => [c.name, c.record]), [['live/' + p2.streamSlug, false]]);

  // a crew member sees the production but not its stream key
  const crew = client(cloud.url);
  await crew.post('/api/auth/signup', { name: 'Crew', email: 'crew@example.com', password: 'correct horse' });
  await web.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Crew' });
  assert.equal((await crew.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'prod_one').data.streamKey, undefined);

  // matches on the front page once the team allows it
  await put('fixture', 'fx_one', { sport: 'Rugby', name: 'Cheetahs vs Bulls', startDate: '2099-01-01', startTime: '15:00' });
  const org = (await cloud.store.get(team)).data;
  await put('org', team, { ...org, publicMatches: true }, team);
  const h2 = (await client(cloud.url).get('/api/public/home')).data;
  const m = h2.matches.upcoming.find((x) => x.name === 'Cheetahs vs Bulls');
  assert.ok(m, JSON.stringify(h2.matches));
  assert.equal(m.company, 'RegemarkFP');
});

test('server setup: one command for a site admin hands out the program and the site settings', async (t) => {
  const { cloud, web } = await site(t);
  const me = (await web.get('/api/me')).data;
  assert.equal(me.machine.siteAdmin, true);
  const made = await web.post('/api/server/setup');
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const token = made.data.command.match(/--token (\S+)/)[1];
  assert.match(made.data.command, /^curl -fsSL https:\/\/tv\.example\.com\/server\/install\.sh \| sudo bash -s -- --from https:\/\/tv\.example\.com --token \S+$/);

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
