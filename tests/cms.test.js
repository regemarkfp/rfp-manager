'use strict';
// Content: YouTube links and playlists (oEmbed without a key, the Data API with the team's key, syncing), playlists of
// VOD, YouTube and live streams on the website, and the front page / channel page arrangement.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { boot, client, until } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { parse, isoSeconds } = require('../lib/youtube');

test('YouTube links: every kind of address', () => {
  assert.deepEqual(parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), { video: 'dQw4w9WgXcQ', list: '' });
  assert.deepEqual(parse('youtu.be/dQw4w9WgXcQ'), { video: 'dQw4w9WgXcQ', list: '' });
  assert.deepEqual(parse('https://youtube.com/shorts/abcdefghijk'), { video: 'abcdefghijk', list: '' });
  assert.deepEqual(parse('https://m.youtube.com/live/abcdefghijk?feature=share'), { video: 'abcdefghijk', list: '' });
  assert.deepEqual(parse('https://www.youtube.com/playlist?list=PLabcdefghij123'), { video: '', list: 'PLabcdefghij123' });
  assert.deepEqual(parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij123'), { video: 'dQw4w9WgXcQ', list: 'PLabcdefghij123' });
  assert.equal(parse('https://vimeo.com/123'), null);
  assert.equal(parse('hello'), null);
  assert.equal(isoSeconds('PT1H2M10S'), 3730);
  assert.equal(isoSeconds('PT45S'), 45);
});

test('Content: YouTube import and sync, playlists with live streams, the website arrangement', async (t) => {
  // a stand-in for YouTube: oEmbed and the Data API
  const vids = { aaaaaaaaaaa: 'Try of the year', bbbbbbbbbbb: 'Coach interview', ccccccccccc: 'Final highlights', ddddddddddd: 'No embedding' };
  let listIds = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ddddddddddd'];
  const yt = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (u.pathname === '/oembed') { const id = new URL(u.searchParams.get('url')).searchParams.get('v'); return vids[id] ? send(200, { title: vids[id], author_name: 'Fan Channel' }) : send(404, {}); }
    if (u.searchParams.get('key') !== 'AIzaGoodKey1234567890abc') return send(400, { error: { message: 'API key not valid' } });
    if (u.pathname === '/api/videos') return send(200, { items: u.searchParams.get('id').split(',').filter((id) => vids[id]).map((id) => ({ id, snippet: { title: vids[id], description: 'About ' + vids[id], channelTitle: 'Fan Channel', thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hq.jpg` } }, liveBroadcastContent: 'none' }, contentDetails: { duration: 'PT2M5S' }, status: { embeddable: id !== 'ddddddddddd' } })) });
    if (u.pathname === '/api/playlists') return send(200, { items: [{ id: 'PLtest1234567', snippet: { title: 'Season highlights', description: 'All the best bits', thumbnails: {} } }] });
    if (u.pathname === '/api/playlistItems') return send(200, { items: listIds.map((id) => ({ contentDetails: { videoId: id } })) });
    send(404, {});
  });
  await new Promise((r) => yt.listen(0, '127.0.0.1', r));
  t.after(() => yt.close());
  const base = `http://127.0.0.1:${yt.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-cms-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://tv.example.com', siteAdmins: ['ruan@example.com'], mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' }, vodDir: dir, ffmpeg: '/nonexistent/ffmpeg',
    streaming: { host: 'tv.example.com', api: '', hookSecret: 'hook-secret' }, youtubeApi: base + '/api', youtubeOembed: base + '/oembed' }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await admin.put(`/api/docs/channel/chan_tv?team=${team}`, { data: { name: 'RegemarkFP TV', slug: 'regemarkfp-tv', access: 'Public' } });

  // a single video without a key: oEmbed gives the title and picture
  let r = await admin.post(`/api/yt/import?team=${team}`, { links: 'https://youtu.be/ccccccccccc', channel: 'chan_tv', category: 'Highlights' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.videos[0].data.title, r.data.videos[0].data.source, r.data.videos[0].data.ytPoster, r.data.key], ['Final highlights', 'YouTube', 'https://i.ytimg.com/vi/ccccccccccc/hqdefault.jpg', false]);
  const solo = r.data.videos[0].id;
  // a playlist needs the key; a bad key is refused; then the playlist comes in whole (videos that cannot be embedded are left out)
  assert.equal((await admin.post(`/api/yt/import?team=${team}`, { links: 'https://www.youtube.com/playlist?list=PLtest1234567', channel: 'chan_tv' })).status, 400);
  assert.equal((await admin.put(`/api/yt/key?team=${team}`, { key: 'AIzaBadKey123456789012345' })).status, 400);
  assert.equal((await admin.put(`/api/yt/key?team=${team}`, { key: 'AIzaGoodKey1234567890abc' })).data.set, true);
  assert.equal((await admin.get(`/api/yt/key?team=${team}`)).data.set, true);
  r = await admin.post(`/api/yt/import?team=${team}`, { links: 'https://www.youtube.com/playlist?list=PLtest1234567', channel: 'chan_tv' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.videos.map((v) => [v.data.title, v.data.duration]), [['Try of the year', 125], ['Coach interview', 125]]);
  assert.deepEqual(r.data.skipped, ['No embedding']);
  const pl = r.data.playlists[0];
  assert.deepEqual([pl.data.title, pl.data.youtubePlaylist, pl.data.items.length], ['Season highlights', 'PLtest1234567', 2]);
  // the same link again does not double the videos
  await admin.post(`/api/yt/import?team=${team}`, { links: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', channel: 'chan_tv' });
  assert.equal((await app.store.list(team, 'vodvideo')).filter((v) => v.data.youtube === 'aaaaaaaaaaa').length, 1);

  // a live stream in the playlist, with our own extra item at the end; YouTube adds a video: sync keeps ours after theirs
  await admin.put(`/api/docs/production/prod_final?team=${team}`, { data: { name: 'Cup final', date: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10), txTime: '15:00', streamChannel: 'chan_tv' } });
  const prod = await app.store.get('prod_final');
  assert.ok(prod.data.streamSlug, 'the production streams');
  await admin.put(`/api/docs/vodplaylist/${pl.id}?team=${team}`, { data: { ...pl.data, items: [...pl.data.items, { kind: 'live', id: 'prod_final' }, { kind: 'vod', id: solo }] } });
  listIds = ['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb'];
  const sy = await admin.post(`/api/yt/sync/${pl.id}?team=${team}`);
  assert.equal(sy.status, 200, JSON.stringify(sy.data));
  assert.deepEqual(sy.data.doc.data.items.map((x) => x.kind + ':' + (x.kind === 'live' ? x.id : (x.id === solo ? 'solo' : 'yt'))), ['vod:solo', 'vod:yt', 'vod:yt', 'live:prod_final']);

  // the website: the playlist plays YouTube videos and the live stream (coming up)
  const guest = client(app.url);
  const pp = (await guest.get('/api/public/p/' + pl.id)).data;
  assert.deepEqual(pp.items.map((x) => [x.kind, x.title, !!x.youtube]), [['vod', 'Final highlights', true], ['vod', 'Try of the year', true], ['vod', 'Coach interview', true], ['live', 'Cup final', false]]);
  assert.equal(pp.items[3].slug, prod.data.streamSlug);
  assert.equal(pp.items[3].live, false);
  const v = (await guest.get('/api/public/v/' + solo)).data;
  assert.deepEqual([v.needs, v.youtube, v.src, v.price], [null, 'ccccccccccc', '', null]);
  const home = (await guest.get('/api/public/home')).data;
  assert.equal(home.playlists[0].title, 'Season highlights');
  assert.equal(home.playlists[0].count, 4);
  assert.ok(home.videos.some((x) => x.href === '/v/' + solo && x.youtube));
  assert.equal(home.layout, null, 'automatic until arranged');

  // Browse: search and filters over everything public
  const find = async (q) => (await guest.get('/api/public/search?' + new URLSearchParams(q))).data;
  let sr = await find({ q: 'highlights' });
  assert.ok(sr.total >= 2, JSON.stringify(sr.counts));
  assert.ok(sr.items.some((x) => x.kind === 'playlist' && x.title === 'Season highlights'));
  assert.equal(sr.sort, 'relevant');
  sr = await find({ q: 'highlights', kind: 'video' });
  assert.ok(sr.items.length && sr.items.every((x) => x.kind === 'video'));
  assert.ok(sr.counts.playlist >= 1, 'the kind counts ignore the kind filter');
  sr = await find({ category: 'Highlights' });
  assert.ok(sr.items.length && sr.items.every((x) => x.category === 'Highlights'));
  assert.ok((await find({})).facets.categories.some((c) => c.value === 'Highlights'));
  assert.ok((await find({})).facets.channels.some((c) => c.value === 'chan_tv'));
  assert.equal((await find({ q: 'zzzz nothing like this' })).total, 0);
  sr = await find({ kind: 'video', sort: 'az', limit: 1 });
  assert.equal(sr.items.length, 1); assert.ok(sr.total >= 3);
  const page2 = await find({ kind: 'video', sort: 'az', limit: 1, offset: 1 });
  assert.ok(page2.items[0].title.localeCompare(sr.items[0].title) >= 0);

  // the front page arranged by a site admin: a featured series of rows; only site admins may
  const outsider = client(app.url);
  await outsider.post('/api/auth/signup', { name: 'Other', email: 'other@example.com', password: 'correct horse' });
  assert.equal((await outsider.put('/api/site/layout', { layout: { rows: [] } })).status, 403);
  assert.equal((await admin.put('/api/site/layout', { layout: { hero: { mode: 'pick', item: { kind: 'playlist', id: pl.id } }, rows: [{ type: 'playlist', id: pl.id, title: 'Watch these' }, { type: 'builtin', key: 'upcoming' }, { type: 'category', name: 'Highlights' }, { type: 'nonsense' }] } })).status, 200);
  const L = (await guest.get('/api/public/home')).data.layout;
  assert.deepEqual([L.heroMode, L.hero.title, L.hero.kind], ['pick', 'Season highlights', 'playlist']);
  assert.deepEqual(L.rows.map((x) => [x.type, x.title, (x.cards || []).length]), [['cards', 'Watch these', 4], ['builtin', 'Coming up', 0], ['cards', 'Highlights', 1]]);
  assert.equal(L.rows[0].cards[3].href, '/watch/' + prod.data.streamSlug);
  // a channel page arranged by its team
  await admin.put(`/api/docs/channel/chan_tv?team=${team}`, { data: { ...(await app.store.get('chan_tv')).data, layout: { hero: { mode: 'auto' }, rows: [{ type: 'builtin', key: 'playlists' }, { type: 'builtin', key: 'fixtures' }, { type: 'series', id: 'nope' }] } } });
  const c = (await guest.get('/api/public/c/regemarkfp-tv')).data;
  assert.deepEqual(c.layout.rows.map((x) => x.key || x.type), ['playlists'], 'front-page-only rows and missing series are left out');
  assert.equal(c.playlists.length, 1);
  // hidden playlists are not shown
  await admin.put(`/api/docs/vodplaylist/${pl.id}?team=${team}`, { data: { ...(await app.store.get(pl.id)).data, visibility: 'Hidden' } });
  assert.equal((await guest.get('/api/public/p/' + pl.id)).status, 404);
  assert.equal((await admin.get('/api/public/p/' + pl.id)).status, 200, 'the team still sees it');
  await until(async () => !(await guest.get('/api/public/c/regemarkfp-tv')).data.playlists.length, 3000, 'gone from the channel');
});
