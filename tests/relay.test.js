'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until, seed, liveClient } = require('./helpers');
const fakeMongo = require('./fake-mongo');

// The website (MongoDB stand-in) and a production PC (SQLite) in one process: the PC links by sign-in, then the
// PC's live screens are used through the website.
async function world(t) {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: '', mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const web = client(cloud.url);
  assert.equal((await web.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' })).status, 200);
  const team = (await web.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await seed(web, team);
  const pc = await boot({ syncSeconds: 2, machineName: 'OB truck' });
  t.after(() => pc.stop());
  const local = client(pc.url);
  return { cloud, web, team, pc, local };
}

test('a production PC links to the website by signing in there, no key to copy', async (t) => {
  const { cloud, web, team, pc, local } = await world(t);
  assert.equal((await local.get('/api/config')).data.needsSetup, true);
  const start = await local.post('/api/link/start', { url: cloud.url });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const code = start.data.pending.code;
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(start.data.pending.approveUrl.endsWith('/#/link/' + code));
  // the website shows which PC asks; only a signed-in person can see it, only an Admin can approve
  assert.equal((await client(cloud.url).get('/api/pair/' + code)).status, 401);
  assert.equal((await web.get('/api/pair/' + code)).data.name, 'OB truck');
  assert.equal((await client(cloud.url).post('/api/pair/poll', { code, secret: 'wrong' })).status, 404);
  assert.equal((await web.post(`/api/pair/${code}/approve`)).status, 200);
  await until(async () => (await local.get('/api/link/status')).data.done, 8000, 'the PC to pick up its key');
  await until(() => pc.sync.status().linked && !pc.sync.status().lastError && pc.cache.get(team), 8000, 'first sync');
  assert.ok(pc.config.cloud.key.startsWith('mk_'));
  // the key shows on the website like any other machine key
  assert.deepEqual((await web.get('/api/keys')).data.keys.map((k) => k.name), ['OB truck']);
  // a used code cannot be used again
  assert.equal((await client(cloud.url).post('/api/pair/poll', { code, secret: start.data.secret })).status, 404);
});

test('remote access: the PC\'s live screens, settings and adverts through the website, with team checks', async (t) => {
  const { cloud, web, team, pc, local } = await world(t);
  const key = (await web.post('/api/keys', { name: 'OB truck' })).data.key;
  assert.equal((await local.post('/api/setup/link', { url: cloud.url, key })).status, 200);
  await until(() => pc.relay.status().connected, 8000, 'the PC to come online on the website');

  // the website lists the PC; with one PC online it is used straight away
  const pcs = (await web.get('/api/pcs')).data;
  assert.equal(pcs.pcs.length, 1);
  assert.equal(pcs.pcs[0].name, 'OB truck');
  const id = pcs.pcs[0].id;
  assert.equal(pcs.pc, id);
  const me = (await web.get('/api/me')).data;
  assert.equal(me.machine.remote.id, id);
  assert.equal(me.machine.admin, true);
  assert.equal(me.machine.outputKey, pc.config.outputKey);

  // live data comes from the PC (it says "local"), the PC's settings too
  assert.equal((await web.get('/live/api/info')).data.mode, 'local');
  assert.ok((await web.get('/live/api/variables')).data.builtIn.length > 10);
  const conn = await web.get('/api/connections');
  assert.equal(conn.status, 200, JSON.stringify(conn.data));
  assert.ok(conn.data.caspar);

  // Graphics control in a browser anywhere: the WebSocket goes through the website to the PC
  const ctl = await liveClient({ url: cloud.url }, { cookie: web.cookie(), role: 'control' });
  t.after(() => ctl.close());
  assert.ok(ctl.catalog.length >= 30, 'the PC\'s graphics catalog');
  await ctl.send('gfx', 'show', { id: 'custom_lt', overrides: { line1: 'FROM THE WEBSITE' } });
  await until(() => pc.gfx.onAirList().some((e) => e.graphicId === 'custom_lt'), 4000, 'the take to reach the PC');
  // the play log says it came through the website, by whom
  await until(() => [...pc.cache.values()].some((d) => d.type === 'playlog' && (d.data.entries || []).some((e) => /Ruan/.test(e.by || ''))), 4000, 'play log entry by Ruan');

  // the Adverts screen: graphics actions on the website's own connection reach the PC as well
  const hub = new WebSocket(cloud.url.replace('http', 'ws') + '/ws', { headers: { cookie: web.cookie() } });
  t.after(() => hub.close());
  const got = [];
  hub.onmessage = (ev) => got.push(JSON.parse(ev.data));
  await new Promise((r) => { hub.onopen = r; });
  hub.send(JSON.stringify({ type: 'hello', team }));
  const welcome = await until(() => got.find((m) => m.type === 'welcome'), 4000, 'hub welcome');
  assert.ok(welcome.gfx && welcome.gfx.state.onAir.some((e) => e.graphicId === 'custom_lt'), 'on-air state of the PC ' + JSON.stringify(welcome.gfx) + JSON.stringify([...cloud.relayServer.machines.values()].map((m) => m.gfxState)));
  hub.send(JSON.stringify({ type: 'gfx', action: 'out', key: pc.gfx.onAirList().find((e) => e.graphicId === 'custom_lt').key, rid: 7 }));
  const ack = await until(() => got.find((m) => m.rid === 7), 4000, 'graphics action answer');
  assert.equal(ack.type, 'ack', JSON.stringify(ack));
  await until(() => !pc.gfx.onAirList().some((e) => e.graphicId === 'custom_lt' && !e.leaving), 4000, 'OUT on the PC');

  // screen links: view-only screens through the website need the screen key; the PC adds nothing by itself
  const noKey = await fetch(cloud.url + '/output?pc=' + id, { redirect: 'manual' });
  assert.equal(noKey.status, 302);
  assert.equal(noKey.headers.get('location'), '/live/output.html?pc=' + id);
  const withKey = await fetch(`${cloud.url}/output?pc=${id}&key=${pc.config.outputKey}`, { redirect: 'manual' });
  assert.match(withKey.headers.get('location'), new RegExp(`^/live/output\\.html\\?key=${pc.config.outputKey}.*&pc=${id}$`));
  // Companion addresses are not "local" just because the PC fetched them itself
  assert.equal((await fetch(`${cloud.url}/live/api/companion/hideall?pc=${id}`)).status, 401);
  assert.equal((await fetch(`${cloud.url}/live/api/companion/hideall?pc=${id}&key=${pc.config.outputKey}`)).status, 200);

  // someone outside the team cannot use the PC, even naming it
  const other = client(cloud.url);
  await other.post('/api/auth/signup', { name: 'Eve', email: 'eve@example.com', password: 'correct horse' });
  assert.equal((await other.get('/api/pcs')).data.pcs.length, 0);
  assert.equal((await other.get('/live/api/info?pc=' + id)).status, 403);
  assert.equal((await other.get('/live/api/info')).data.mode, 'cloud', 'without a PC: the website itself');
  // and a forged identity header from the network is ignored by the PC
  const forged = await fetch(pc.url + '/api/connections', { headers: { 'x-rfp-relay': 'guess', 'x-rfp-relay-user': 'ruan@example.com' } });
  assert.equal(forged.status, 401);

  // choosing "no PC" uses the website's own engine; the PC going offline is said clearly
  assert.equal((await web.post('/api/pcs/choose', { id: 'none' })).status, 200);
  assert.equal((await web.get('/live/api/info')).data.mode, 'cloud');
  assert.equal((await web.post('/api/pcs/choose', { id })).status, 200);
  pc.relay.stop();
  await until(async () => (await web.get('/api/pcs')).data.pcs.length === 0, 4000, 'PC offline');
  const off = await web.get('/live/api/info');
  assert.equal(off.status, 503);
  assert.equal(off.data.code, 'PC_OFFLINE');
  pc.relay.start();
  await until(async () => (await web.get('/live/api/info')).data.mode === 'local', 8000, 'PC back online');
});
