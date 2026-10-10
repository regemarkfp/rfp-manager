'use strict';
// Scorer buttons (per theme), macros, actions with {team} values, advert options and the play log.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until, seed, liveClient, fakeCaspar, payload, PNG } = require('./helpers');

test('scorer buttons and macros are kept per theme and run graphics with the team pressed', async (t) => {
  const cg = await fakeCaspar(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1, previewChannel: 2, clearAfterOutMs: 0 } });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  await seed(c, team);
  const put = (type, id, data) => c.put(`/api/docs/${type}/${id}?team=${team}`, { data });
  await until(() => app.gfx.amcp.connected, 3000, 'CasparCG');
  const sc = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one' });
  t.after(() => sc.close());
  await sc.send('rfp', 'onAir', { fixtureId: 'fixture_one' });
  await until(() => sc.state && sc.state.pads && sc.state.pads.where, 3000, 'pads');
  assert.equal(sc.state.pads.where.kind, 'standard');
  // without a theme: saved on the team
  const pad = { buttons: { 'pt=try': { label: 'TRY!', color: '#ff0000', actions: [{ do: 'show', target: 'custom_lt', values: { line1: 'TRY {team}', line2: '{team{team}_name}' } }] } }, custom: [{ id: 'btn_x', label: 'Hide LT', more: true, actions: [{ do: 'hide', target: 'custom_lt' }] }] };
  await sc.send('rfp', 'pads', { pad });
  await until(() => sc.state.pads.pad.buttons['pt=try'], 3000, 'saved pad');
  assert.equal((await app.store.get(team)).data.scorerPads.rugby.buttons['pt=try'].label, 'TRY!');
  // a theme in use: its own mapping, the standard one stays as it was
  await put('theme', 'theme_x', { name: 'Look X', templateFolder: 'lookx' });
  await sc.send('rfp', 'theme', { theme: 'theme_x' });
  await until(() => sc.state.pads.where.kind === 'theme', 3000, 'theme pads');
  assert.deepEqual(sc.state.pads.pad.buttons, {});
  await sc.send('rfp', 'pads', { pad: { buttons: { 'pt=try': { hidden: true } }, custom: [] } });
  await sc.send('rfp', 'macros', { list: [{ id: 'mac_1', name: 'Name strap', actions: [{ do: 'show', target: 'custom_lt', values: { line1: 'MACRO {team}', line2: '{teamA_short}' } }, { do: 'nonsense' }] }] });
  const th = (await app.store.get('theme_x')).data;
  assert.equal(th.scorerPads.rugby.buttons['pt=try'].hidden, true);
  assert.deepEqual(th.macros[0].actions.map((a) => a.do), ['show']);
  assert.equal((await app.store.get(team)).data.scorerPads.rugby.buttons['pt=try'].label, 'TRY!');
  // back to no theme: the team's mapping returns
  await sc.send('rfp', 'theme', { theme: 'none' });
  await until(() => sc.state.pads.where.kind === 'standard' && sc.state.pads.pad.buttons['pt=try'].label === 'TRY!', 3000, 'standard pads');
  // a scorer button's actions, with the team that was pressed
  cg.got.length = 0;
  await sc.send('gfx', 'run', { actions: pad.buttons['pt=try'].actions, side: 'B', label: 'Try' });
  let d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-30 ADD 1 "rfp/lowerthird"')), 3000, 'take'));
  assert.deepEqual([d.line1, d.line2], ['TRY B', 'BULLS']);
  // a macro of the theme runs while that theme is in use (and not without it)
  await assert.rejects(sc.send('gfx', 'macro', { id: 'mac_1', side: 'A' }), /no longer exists/);
  await sc.send('rfp', 'theme', { theme: 'theme_x' });
  cg.got.length = 0;
  await sc.send('gfx', 'macro', { id: 'mac_1', side: 'A' });
  d = payload(await until(() => cg.got.find((l) => / ADD 1 ".*lowerthird"/.test(l)), 3000, 'macro take'));
  assert.deepEqual([d.line1, d.line2], ['MACRO A', 'CHE']);
  // a delayed action follows by itself
  cg.got.length = 0;
  await sc.send('gfx', 'run', { actions: [{ do: 'hide', target: 'custom_lt', delay: 0.3 }] });
  assert.ok(!cg.got.some((l) => l.startsWith('CG 1-30 STOP')));
  await until(() => cg.got.some((l) => l.startsWith('CG 1-30 STOP')), 3000, 'delayed hide');
  // every graphic on air is in the play log, with the time it was on
  await until(async () => (await app.store.list(team, 'playlog')).some((x) => (x.data.entries || []).some((e) => e.graphic === 'custom_lt' && e.seconds >= 0 && e.ended)), 4000, 'play log');
});

test('adverts: run dates, plays per day, position and real air time in the log', async (t) => {
  const cg = await fakeCaspar(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1, previewChannel: 2, clearAfterOutMs: 0 } });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  await seed(c, team);
  await until(() => app.gfx.amcp.connected, 3000, 'CasparCG');
  const put = async (type, id, data) => { const r = await c.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.doc; };
  const img = (await c.post(`/api/media?team=${team}&name=board.png`, PNG, { 'content-type': 'image/png' })).data;
  const today = new Date().toISOString().slice(0, 10);
  await put('advert', 'advert_pos', { name: 'Corner board', sponsor: 'Acme', kind: 'Image', image: img.id, layout: 'Custom position', x: 70, y: 5, width: 25, height: 15, fit: 'contain', transition: 'Slide from left', transitionSecs: 0.5, duration: 1, maxPerDay: 1, from: today });
  await put('advert', 'advert_old', { name: 'Expired', sponsor: 'Acme', kind: 'Image', image: img.id, duration: 1, until: '2020-01-01' });
  await put('advert', 'advert_clip', { name: 'TVC', sponsor: 'Acme', kind: 'CasparCG clip', clip: 'ADS/TVC', duration: 1, channel: 2, layer: 55, loop: true, volume: 50, transitionSecs: 1 });
  await put('playlist', 'playlist_pl', { name: 'Break', items: [{ advert: 'advert_old' }, { advert: 'advert_pos' }, { advert: 'advert_clip' }] });
  await app.gfx.startPlaylist(team, 'playlist_pl');
  const d = payload(await until(() => cg.got.find((l) => / ADD 1 "rfp\/advert"/.test(l)), 3000, 'image advert'));
  assert.deepEqual([d.layout, d.x, d.y, d.w, d.h, d.fit, d.trans], ['custom', '70', '5', '25', '15', 'contain', 'left']);
  await until(() => cg.got.some((l) => /^PLAY 2-55 "ADS\/TVC" LOOP MIX \d+/.test(l)), 4000, 'clip on its own channel and layer');
  assert.ok(cg.got.some((l) => /^MIXER 2-55 VOLUME 0\.5/.test(l)), cg.got.filter((l) => l.startsWith('MIXER')).join(' | '));
  await until(() => cg.got.includes('STOP 2-55'), 4000, 'end of playlist');
  const entries = (await app.store.list(team, 'adlog')).flatMap((x) => x.data.entries);
  assert.deepEqual(entries.map((e) => e.name), ['Corner board', 'TVC']);              // the expired advert is skipped
  assert.ok(entries.every((e) => e.seconds >= 0));
  // played once today already: the board is skipped the next time round
  cg.got.length = 0;
  await app.gfx.startPlaylist(team, 'playlist_pl');
  await until(() => cg.got.some((l) => l.includes('ADS/TVC')), 4000, 'second round');
  assert.ok(!cg.got.some((l) => / ADD 1 "rfp\/advert"/.test(l)));
  await app.gfx.stopPlaylist();
});

test('play log: who took a graphic (screen, person, address), who took it off, and the production', async (t) => {
  const cg = await fakeCaspar(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1, previewChannel: 2, clearAfterOutMs: 0 } });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  await seed(c, team);
  await until(() => app.gfx.amcp.connected, 3000, 'CasparCG');
  const prod = (await app.store.list(team, 'production')).find((p) => (p.data.fixtures || []).some((r) => r.fixture === 'fixture_one'));
  assert.ok(prod, 'saving the fixture made a production');
  const ctl = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  t.after(() => ctl.close());
  await ctl.send('rfp', 'onAir', { fixtureId: 'fixture_one' });
  await ctl.send('gfx', 'show', { id: 'custom_lt', overrides: { line1: 'Hello' } });
  await fetch(app.url + '/live/api/companion/out/custom_lt', { method: 'POST' });
  const e = await until(async () => { const l = (await app.store.list(team, 'playlog')).flatMap((x) => x.data.entries || []); return l.find((x) => x.graphic === 'custom_lt' && x.ended); }, 4000, 'play log entry');
  assert.deepEqual([e.by, e.via, e.ip, e.production, e.offBy], ['Test Admin', 'Graphics control', '127.0.0.1', prod.data.name, 'Companion']);
});
