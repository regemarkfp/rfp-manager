'use strict';
// Videos on demand: chunked uploads (resumable), processing, who may watch, series with seasons, paying for a video,
// a series or the channel pass, and seeking (byte ranges).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { boot, client, until } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { itnParamString, pfEncode } = require('../lib/pay');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const PASS = 'vod pass phrase';
let ffmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); ffmpeg = true; } catch { ffmpeg = false; }

async function site(t, extra = {}) {
  const pf = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('VALID')); });
  await new Promise((r) => pf.listen(0, '127.0.0.1', r));
  t.after(() => pf.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-vod-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://tv.example.com', mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' },
    streaming: { host: 'tv.example.com', api: '', hookSecret: 'hook-secret' }, vodDir: dir,
    payfast: { merchantId: '10000100', merchantKey: '46f0cd694581a', passphrase: PASS, sandbox: true, checkIp: false, validateUrl: `http://127.0.0.1:${pf.address().port}/eng/query/validate` }, ...extra }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  assert.equal((await admin.put(`/api/docs/channel/chan_tv?team=${team}`, { data: { name: 'RegemarkFP TV', slug: 'regemarkfp-tv', access: 'Public', passPrice: 150, passDays: 30 } })).status, 200);
  const itn = (id, amount) => {
    const pairs = [['m_payment_id', id], ['pf_payment_id', '123'], ['payment_status', 'COMPLETE'], ['item_name', 'x'], ['amount_gross', amount], ['amount_fee', '-2.30'], ['amount_net', '1'], ['email_address', 'fan@example.com'], ['merchant_id', '10000100']];
    pairs.push(['signature', md5(itnParamString(pairs) + '&passphrase=' + pfEncode(PASS))]);
    return fetch(app.url + '/api/pay/payfast/itn', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(pairs).toString() });
  };
  return { app, admin, team, dir, itn };
}
// uploads a file in chunks (the browser does the same), with one chunk sent twice as after a dropped connection
async function upload(c, team, buf, meta, chunk = 1000) {
  const r = await c.post(`/api/vod?team=${team}`, { size: buf.length, ...meta });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const id = r.data.doc.id;
  for (let o = 0; o < buf.length; o += chunk) {
    const part = buf.subarray(o, o + chunk);
    const x = await c.put(`/api/vod/${id}/upload?team=${team}&offset=${o}`, part, { 'content-type': 'application/octet-stream' });
    assert.equal(x.status, 200, JSON.stringify(x.data));
    if (o === chunk) assert.equal((await c.put(`/api/vod/${id}/upload?team=${team}&offset=${o}`, part, { 'content-type': 'application/octet-stream' })).data.received, o + part.length, 'a chunk sent again');
  }
  return id;
}

test('VOD: chunked upload, series and seasons, who may watch, tickets for a video, a series and the pass, seeking', async (t) => {
  const { app, admin, team, dir, itn } = await site(t, { ffmpeg: '/nonexistent/ffmpeg' });
  // a series with names for its seasons, and a price for all of it
  assert.equal((await admin.put(`/api/docs/vodseries/ser_road?team=${team}`, { data: { title: 'Road to the Final', channel: 'chan_tv', price: 99, seasonNames: '1: The pool games\n2: Knock-outs', visibility: 'Public' } })).status, 200);
  const bytes = crypto.randomBytes(5500);
  // not a video, or no channel: refused
  assert.equal((await admin.post(`/api/vod?team=${team}`, { size: 10, name: 'notes.txt', channel: 'chan_tv' })).status, 400);
  assert.equal((await admin.post(`/api/vod?team=${team}`, { size: 10, name: 'a.mp4' })).status, 400);
  const ep1 = await upload(admin, team, bytes, { name: 'Episode_one.mp4', mime: 'video/mp4', channel: 'chan_tv', series: 'ser_road', season: 1, episode: 1 });
  // a chunk from a wrong place is refused; the upload is not done until every byte is there
  const ep2 = (await admin.post(`/api/vod?team=${team}`, { size: 3000, name: 'ep2.mp4', channel: 'chan_tv', series: 'ser_road', season: 1, episode: 2 })).data.doc.id;
  assert.equal((await admin.put(`/api/vod/${ep2}/upload?team=${team}&offset=500`, Buffer.alloc(10), { 'content-type': 'application/octet-stream' })).status, 409);
  await admin.put(`/api/vod/${ep2}/upload?team=${team}&offset=0`, Buffer.alloc(2000), { 'content-type': 'application/octet-stream' });
  assert.equal((await admin.get(`/api/vod/${ep2}/upload?team=${team}`)).data.received, 2000, 'resume from here');
  assert.equal((await admin.post(`/api/vod/${ep2}/done?team=${team}`)).status, 409);
  await admin.put(`/api/vod/${ep2}/upload?team=${team}&offset=2000`, Buffer.alloc(1000), { 'content-type': 'application/octet-stream' });
  const s3 = await upload(admin, team, crypto.randomBytes(800), { name: 'Final.mp4', channel: 'chan_tv', series: 'ser_road', season: 2, episode: 1 });
  for (const id of [ep1, ep2, s3]) assert.equal((await admin.post(`/api/vod/${id}/done?team=${team}`)).status, 200);
  await until(async () => (await admin.get(`/api/vod?team=${team}`)).data.list.every((x) => x.file.status === 'ready'), 3000, 'ready');
  const listed = (await admin.get(`/api/vod?team=${team}`)).data;
  assert.equal(listed.ffmpeg, false);
  assert.match(listed.list[0].file.note, /as uploaded/);
  assert.equal(fs.readFileSync(path.join(dir, team, ep1, 'source.mp4')).equals(bytes), true, 'the file arrived whole');
  // the titles came from the file names; episode 2 is free in the paid series
  const v1 = (await admin.get(`/api/docs?team=${team}`)).data.docs.find((d) => d.id === ep1);
  assert.equal(v1.data.title, 'Episode one');
  await admin.put(`/api/docs/vodvideo/${ep2}?team=${team}`, { data: { ...(await app.store.get(ep2)).data, title: 'The trailer', freeInSeries: true } });
  // a single video with its own price, not in a series
  const solo = await upload(admin, team, crypto.randomBytes(1200), { name: 'Highlights.mp4', channel: 'chan_tv' });
  await admin.post(`/api/vod/${solo}/done?team=${team}`);
  await admin.put(`/api/docs/vodvideo/${solo}?team=${team}`, { data: { ...(await app.store.get(solo)).data, price: 25, description: 'The best tries' } });
  const hidden = await upload(admin, team, crypto.randomBytes(500), { name: 'Raw.mp4', channel: 'chan_tv', visibility: 'Hidden' });
  await admin.post(`/api/vod/${hidden}/done?team=${team}`);
  await until(async () => (await admin.get(`/api/vod?team=${team}`)).data.list.every((x) => x.file.status === 'ready'), 3000, 'ready');

  // the public side: home page, channel page, series page
  const guest = client(app.url);
  const home = (await guest.get('/api/public/home')).data;
  assert.deepEqual(home.series.map((s) => [s.title, s.episodes, s.seasons, s.price.ticket]), [['Road to the Final', 3, 2, 99]]);
  assert.ok(home.videos.some((v) => v.href === '/v/' + solo && v.price.ticket === 25));
  assert.ok(!home.videos.some((v) => v.href === '/v/' + hidden), 'hidden videos are not listed');
  const ch = (await guest.get('/api/public/c/regemarkfp-tv')).data;
  assert.equal(ch.vods.length, 4);
  assert.equal(ch.series.length, 1);
  const ser = (await guest.get('/api/public/s/ser_road')).data;
  assert.deepEqual(ser.seasons.map((s) => [s.title, s.episodes.map((e) => [e.title, e.free])]), [['The pool games', [['Episode one', false], ['The trailer', true]]], ['Knock-outs', [['Final', false]]]]);
  assert.deepEqual([ser.price.series, ser.price.pass.amount, ser.owned], [99, 150, false]);
  assert.equal((await guest.get('/api/public/v/' + hidden)).status, 404);

  // the free episode plays; the next episode follows; the paid one needs a ticket (series or pass)
  let w = (await guest.get('/api/public/v/' + ep2)).data;
  assert.equal(w.needs, null);
  assert.equal(w.label, 'S1 E2');
  assert.deepEqual(w.next, { id: s3, title: 'Final' });
  assert.match(w.src, /^\/vodfiles\/vod_\w+\/video\?t=\d+\.[\w-]{27}$/);
  // seeking: byte ranges
  const part = await fetch(app.url + w.src.replace(ep2, ep2), { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/3000');
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(app.url + w.src.replace(/t=[^&]+/, 't=123.bad'))).status, 403);
  assert.equal((await fetch(app.url + `/vodfiles/${ep1}/video?` + w.src.split('?')[1])).status, 403, 'a token is for one video');
  w = (await guest.get('/api/public/v/' + ep1)).data;
  assert.deepEqual([w.needs, w.src, w.price.video, w.price.series.amount, w.price.pass.amount], ['ticket', '', 0, 99, 150]);
  assert.equal((await guest.post('/api/public/vod/buy', { kind: 'vod', id: ep1, email: 'fan@example.com' })).status, 400, 'episode 1 has no price of its own');
  const buy = await guest.post('/api/public/vod/buy', { kind: 'series', id: ep1, email: 'Fan@Example.com', name: 'Sam Fan' });
  assert.equal(buy.status, 200, JSON.stringify(buy.data));
  const f = Object.fromEntries(buy.data.fields);
  assert.equal(f.amount, '99.00');
  assert.match(f.return_url, new RegExp(`/v/${ep1}\\?paid=pur_`));
  await itn(buy.data.id, '99.00');
  await until(async () => (await guest.get('/api/pay/status/' + buy.data.id)).data.status === 'Paid', 3000, 'paid');
  const ticket = (await guest.get('/api/pay/status/' + buy.data.id)).data.ticket;
  await until(() => app.mail.outbox.some((m) => m.subject === 'Your ticket: Road to the Final'), 3000, 'ticket email');
  // the series ticket opens every episode of the series, not the solo video
  assert.equal((await guest.get('/api/public/v/' + ep1, { 'x-rfp-tickets': ticket })).data.needs, null);
  assert.equal((await guest.get('/api/public/v/' + s3, { 'x-rfp-tickets': ticket })).data.needs, null);
  assert.equal((await guest.get('/api/public/v/' + solo, { 'x-rfp-tickets': ticket })).data.needs, 'ticket');
  assert.equal((await guest.get('/api/public/s/ser_road', { 'x-rfp-tickets': ticket })).data.owned, true);
  // buying the solo video
  const b2 = await guest.post('/api/public/vod/buy', { kind: 'vod', id: solo, email: 'fan@example.com' });
  assert.equal(Object.fromEntries(b2.data.fields).amount, '25.00');
  await itn(b2.data.id, '25.00');
  await until(async () => (await guest.get('/api/pay/status/' + b2.data.id)).data.status === 'Paid', 3000, 'paid 2');
  const t2 = (await guest.get('/api/pay/status/' + b2.data.id)).data.ticket;
  assert.equal((await guest.get('/api/public/v/' + solo, { 'x-rfp-tickets': t2 })).data.needs, null);
  // the channel pass opens everything paid on the channel
  const b3 = await guest.post('/api/public/vod/buy', { kind: 'pass', id: solo, email: 'other@example.com' });
  await itn(b3.data.id, '150.00');
  await until(async () => (await guest.get('/api/pay/status/' + b3.data.id)).data.status === 'Paid', 3000, 'pass');
  const t3 = (await guest.get('/api/pay/status/' + b3.data.id)).data.ticket;
  assert.equal((await guest.get('/api/public/v/' + ep1, { 'x-rfp-tickets': t3 })).data.needs, null);
  assert.equal((await guest.get('/api/public/v/' + solo, { 'x-rfp-tickets': t3 })).data.needs, null);
  // the production team watches everything free, hidden ones included; sales list the purchases
  assert.equal((await admin.get('/api/public/v/' + hidden)).data.needs, null);
  assert.equal((await admin.get(`/api/sales?team=${team}`)).data.list.filter((x) => x.status === 'Paid').length, 3);
  // subtitles: an SRT becomes WebVTT; the player gets the tracks with the video's token; a default track
  const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\nWelcome to the final\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\n<i>Kick-off</i>\r\n';
  assert.equal((await admin.post(`/api/vod/${ep2}/subtitles?team=${team}&lang=en&label=English`, 'not subtitles', { 'content-type': 'text/plain' })).status, 400);
  let sb = await admin.post(`/api/vod/${ep2}/subtitles?team=${team}&lang=en&label=English`, srt, { 'content-type': 'text/plain' });
  assert.equal(sb.status, 200, JSON.stringify(sb.data));
  sb = await admin.post(`/api/vod/${ep2}/subtitles?team=${team}&lang=af&label=Afrikaans&default=1`, 'WEBVTT\n\n00:01.000 --> 00:02.000\nWelkom\n', { 'content-type': 'text/plain' });
  assert.deepEqual(sb.data.list.map((x) => [x.label, x.lang, x.default, x.cues]), [['English', 'en', false, 2], ['Afrikaans', 'af', true, 1]]);
  assert.equal((await guest.post(`/api/vod/${ep2}/subtitles?team=${team}&lang=en`, srt, { 'content-type': 'text/plain' })).status, 401, 'not signed in');
  const ws = (await guest.get('/api/public/v/' + ep2)).data.subtitles;
  assert.deepEqual(ws.map((x) => [x.label, x.lang, x.default]), [['English', 'en', false], ['Afrikaans', 'af', true]]);
  const vtt = await fetch(app.url + ws[0].url);
  assert.equal(vtt.headers.get('content-type'), 'text/vtt; charset=utf-8');
  assert.equal(await vtt.text(), 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\nWelcome to the final\n\n2\n00:00:04.000 --> 00:00:06.000\n<i>Kick-off</i>\n');
  assert.equal((await fetch(app.url + ws[0].url.replace(/t=.*/, 't=1.x'))).status, 403);
  assert.deepEqual((await guest.get('/api/public/v/' + ep1)).data.subtitles, [], 'no tracks without access');
  const sid = sb.data.list[0].id;
  assert.deepEqual((await admin.put(`/api/vod/${ep2}/subtitles/${sid}?team=${team}`, { default: true })).data.list.map((x) => x.default), [true, false]);
  assert.deepEqual((await admin.del(`/api/vod/${ep2}/subtitles/${sid}?team=${team}`)).data.list.map((x) => x.label), ['Afrikaans']);
  assert.equal((await admin.get(`/api/vod?team=${team}`)).data.list.find((x) => x.id === ep2).subtitles, 1);
  // a YouTube item gets our own file (the team's own video): same item, it plays the file once ready
  await admin.put(`/api/docs/vodvideo/vod_ytown12345?team=${team}`, { data: { title: 'Our final on YouTube', channel: 'chan_tv', source: 'YouTube', youtube: 'abcdefghijk', visibility: 'Public' } });
  assert.equal((await guest.get('/api/public/v/vod_ytown12345')).data.youtube, 'abcdefghijk');
  const own = await upload(admin, team, crypto.randomBytes(900), { name: 'final.mp4', replace: 'vod_ytown12345', quality: 'small' });
  assert.equal(own, 'vod_ytown12345');
  assert.equal((await guest.get('/api/public/v/vod_ytown12345')).data.youtube, 'abcdefghijk', 'YouTube until the file is ready');
  await admin.post(`/api/vod/${own}/done?team=${team}`);
  await until(async () => (await app.store.get(own)).data.source === 'Upload', 3000, 'switched to the file');
  const ow = (await guest.get('/api/public/v/' + own)).data;
  assert.deepEqual([ow.youtube, /^\/vodfiles\/vod_ytown12345\/video/.test(ow.src), ow.title], ['', true, 'Our final on YouTube']);
  assert.equal((await app.store.get(own)).data.ytOrigin, 'abcdefghijk');
  assert.equal((await admin.post(`/api/vod?team=${team}`, { size: 10, name: 'again.mp4', replace: own })).status, 409, 'it has a file now');
  // views count once per viewer and hour
  assert.equal((await guest.post('/api/public/v/' + ep2 + '/view', {})).data.counted, true);
  assert.equal((await guest.post('/api/public/v/' + ep2 + '/view', {})).data.counted, false);
  // a password channel; a team-members channel
  await admin.put(`/api/docs/channel/chan_tv?team=${team}`, { data: { ...(await app.store.get('chan_tv')).data, access: 'Password', viewerPassword: 'rugby' } });
  assert.equal((await guest.get('/api/public/v/' + ep2)).data.needs, 'password');
  assert.equal((await guest.post('/api/public/v/' + ep2, { password: 'rugby' })).data.needs, null);
  await admin.put(`/api/docs/channel/chan_tv?team=${team}`, { data: { ...(await app.store.get('chan_tv')).data, access: 'Team members' } });
  assert.equal((await guest.get('/api/public/v/' + ep2)).data.needs, 'signin');
  // only Producers upload; deleting a video deletes its files
  const outsider = client(app.url);
  await outsider.post('/api/auth/signup', { name: 'Other', email: 'other2@example.com', password: 'correct horse' });
  assert.equal((await outsider.post(`/api/vod?team=${team}`, { size: 10, name: 'a.mp4', channel: 'chan_tv' })).status, 403);
  assert.equal((await admin.del(`/api/docs/vodvideo/${hidden}?team=${team}`)).status, 200);
  await until(() => !fs.existsSync(path.join(dir, team, hidden)), 3000, 'files removed');
});

test('VOD with ffmpeg: a web copy that starts at once, a poster frame, the length', { skip: !ffmpeg && 'ffmpeg is not installed' }, async (t) => {
  const { app, admin, team, dir } = await site(t);
  const tmp = path.join(dir, 'in.mkv');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'mpeg4', '-c:a', 'mp2', '-shortest', tmp]);
  const id = await upload(admin, team, fs.readFileSync(tmp), { name: 'match.mkv', channel: 'chan_tv' }, 64 * 1024);
  await admin.post(`/api/vod/${id}/done?team=${team}`);
  const f = await until(async () => { const x = (await admin.get(`/api/vod?team=${team}`)).data.list.find((y) => y.id === id).file; return ['ready', 'failed'].includes(x.status) && x; }, 30000, 'processed');
  assert.equal(f.status, 'ready', f.error);
  assert.deepEqual([f.duration, f.width, f.height, f.poster], [3, 320, 180, true]);
  assert.ok(fs.existsSync(path.join(dir, team, id, 'web.mp4')));
  assert.ok(!fs.existsSync(path.join(dir, team, id, 'source.mkv')), 'the upload is replaced by the web copy');
  const w = (await client(app.url).get('/api/public/v/' + id)).data;
  assert.equal(w.poster, `/vodfiles/${id}/poster.jpg`);
  assert.equal((await fetch(app.url + w.poster)).headers.get('content-type'), 'image/jpeg');
  const head = Buffer.from(await (await fetch(app.url + w.src, { headers: { range: 'bytes=0-4095' } })).arrayBuffer());
  assert.ok(head.indexOf('moov') > 0 && head.indexOf('moov') < 4096, 'the index is at the front (plays before it has all downloaded)');
});
