'use strict';
// Live screens (1.9.0): the meter counts what each person sends and gets, the network ports from /proc/net/dev, and
// the files being read or written; Universe → Live and a shared folder's live panel show them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, client, tmp } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { makeMeter } = require('../lib/meter');

test('meter: people, ports, files touched', () => {
  const dir = tmp('net'), dev = path.join(dir, 'dev');
  const write = (rx, tx) => fs.writeFileSync(dev, 'Inter-|   Receive |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets\n' +
    `    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n  eno1: ${rx} 10 0 0 0 0 0 0 ${tx} 10 0 0 0 0 0 0\ntailscale0: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`);
  write(1000, 2000);
  const m = makeMeter({ config: { procNetDev: dev } });
  m.second();
  m.add({ name: 'Jana', ip: '10.0.0.5', share: 'share_a' }, 'in', 3e6, { area: 'Sharing' });
  m.add({ name: '', ip: '10.0.0.9' }, 'out', 500, { area: 'Website' });
  m.add({ name: '', ip: '10.0.0.9' }, 'out', 700, {});
  write(1000 + 125000, 2000 + 250000);
  m.second();
  const ppl = m.people();
  assert.equal(ppl[0].name, 'Jana'); assert.equal(ppl[0].area, 'Sharing'); assert.ok(ppl[0].in > 0); assert.deepEqual(ppl[0].total, [3e6, 0]);
  assert.equal(ppl[1].ip, '10.0.0.9'); assert.deepEqual(ppl[1].total, [0, 1200]);
  assert.equal(ppl[0].hist.length, 60);
  assert.deepEqual(m.people({ share: 'share_a' }).map((x) => x.name), ['Jana'], 'per shared folder');
  assert.equal(m.people({ share: 'share_a' })[0].ip, undefined, 'no addresses in a folder');
  const ports = m.ports();
  assert.deepEqual(ports.map((x) => x.label).sort(), ['Tailscale', 'eno1'], 'not lo');
  const eno = ports.find((x) => x.name === 'eno1');
  assert.deepEqual(eno.hist.at(-1), [1e6, 2e6], 'bits per second');
  m.touch({ share: 'share_a', path: 'Video/a.mp4', kind: 'read' }); m.touch({ path: 'Recordings/x.mp4', kind: 'write' });
  assert.deepEqual(m.hot('share_a'), [{ path: 'Video/a.mp4', kind: 'read' }]);
  assert.equal(m.hot().length, 2); assert.ok(m.hot()[1].h >= 0 && m.hot()[1].h < 1);
  assert.ok(m.hardware().mem.total > 0);
});

test('live: Universe → Live and a shared folder', async (t) => {
  const nas = tmp('nas');
  fs.mkdirSync(path.join(nas, 'Recordings'), { recursive: true }); fs.writeFileSync(path.join(nas, 'Recordings', 'a.mp4'), Buffer.alloc(5000));
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', superUsers: ['boss@site.example'], nasDir: nas, sharingDir: path.join(nas, 'Sharing'),
    mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const su = client(app.url), admin = client(app.url), other = client(app.url);
  assert.equal((await su.get('/api/super/live')).status, 401);
  await su.post('/api/super/reset', { email: 'boss@site.example' });
  const token = /\?set=([\w-]+)/.exec(app.mail.outbox.find((m) => m.to.includes('boss@site.example')).text)[1];
  await su.post('/api/super/password', { token, password: 'a long enough secret' });
  await admin.post('/api/auth/signup', { name: 'Ruan', email: 'admin@example.com', password: 'correct horse' });
  await other.post('/api/auth/signup', { name: 'Someone', email: 'other@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Team' })).data.id;
  const id = (await admin.post('/api/share', { team, name: 'Gala' })).data.id;
  // an upload in a piece and a download: counted for Ruan, in this folder, and lit on the map
  const up = (await admin.post(`/api/share/${id}/upload`, { dir: 'Video', name: 'clip.mp4', size: 200000 })).data;
  await admin.put(`/api/share/${id}/upload/${up.upload}?offset=0`, Buffer.alloc(200000, 3), { 'content-type': 'application/octet-stream' });
  await admin.post(`/api/share/${id}/upload/${up.upload}/done`, {});
  await admin.get(`/api/share/${id}/file?path=${encodeURIComponent('Video/clip.mp4')}`);
  app.meter.second();
  // the Sharing home page, Admins only: their shared folders on one map, not inside each folder
  const live = (await admin.get('/api/share-live')).data;
  assert.deepEqual(live.items.map((x) => [x.path, x.name, x.size, x.files]), [[id, 'Gala', 200000, 1]]);
  assert.deepEqual(live.folder, { size: 200000, files: 1, folders: 1 });
  assert.ok(live.disk && live.disk.total > 0);
  const me = live.people.find((x) => x.name === 'Ruan');
  assert.ok(me && me.total[0] >= 200000 && me.total[1] >= 200000, JSON.stringify(live.people));
  assert.equal(me.ip, undefined, 'no addresses');
  assert.ok(live.hot.some((x) => x.path === id + '/Video/clip.mp4' && x.kind === 'write') && live.hot.some((x) => x.path === id + '/Video/clip.mp4' && x.kind === 'read'));
  assert.equal((await other.get('/api/share-live')).status, 403, 'not for others');
  const inv = await admin.post(`/api/share/${id}/people`, { emails: 'editor@example.com', role: 'editor' });
  const editor = client(app.url); await editor.post(`/api/sharing/invite/${inv.data.links[0].url.split('/').pop()}/password`, { name: 'Ed', password: 'long enough' });
  assert.equal((await editor.get('/api/share-live')).status, 403, 'not for people invited to a folder');
  assert.equal((await admin.get(`/api/share/${id}/live`)).status, 404, 'no storage view inside folders');
  // the Universe: the NAS, the people, the machine, the touched files placed in their NAS folder
  const u = (await su.get('/api/super/live')).data;
  assert.equal(u.storage.exists, true); assert.ok(u.storage.total > 0);
  assert.ok(u.people.some((x) => x.name === 'Ruan' && x.area === 'Sharing'));
  assert.ok(u.hardware && u.hardware.cpus > 0 && u.hardware.hist.length === 60);
  assert.ok(Array.isArray(u.ports));
  assert.ok(u.hot.some((x) => x.key === 'Sharing' && x.kind === 'write'), JSON.stringify(u.hot));
  assert.equal((await su.get('/super')).status, 200);
});
