'use strict';
// Rocket League: game data from SOS / the official Stats API (WebSocket and TCP) / a relay, the pages and templates on
// /rl/ws, CasparCG layers per graphic, live values {rl_…}, game triggers on goals and at a game-clock time.
// The game and CasparCG are stand-ins.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { accept } = require('../lib/ws');
const { boot, client, until, fakeCaspar } = require('./helpers');

// a stand-in for the game's WebSocket (SOS on 49122, the official API's WebPort): sends what the test gives it
async function fakeGame(t) {
  const socks = new Set();
  const server = http.createServer();
  server.on('upgrade', (req, sock) => { const ws = accept(req, sock); if (ws) { socks.add(ws); ws.on('close', () => socks.delete(ws)); } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { for (const s of socks) s.end(); server.close(); });
  return { url: `ws://127.0.0.1:${server.address().port}`, send: (o) => { for (const s of socks) s.send(typeof o === 'string' ? o : JSON.stringify(o)); }, get count() { return socks.size; } };
}
const sosState = (o = {}) => ({ event: 'game:update_state', data: { event: 'gamestate', hasGame: true, players: {
  Ruan_1: { name: 'Ruan', id: 'Ruan_1', team: 0, shortcut: 1, score: 320, goals: 1, assists: 0, saves: 2, shots: 3, demos: 1, boost: 64, speed: 87 },
  Nova_4: { name: 'Nova', id: 'Nova_4', team: 1, shortcut: 4, score: 180, goals: 0, assists: 1, saves: 1, shots: 1, demos: 0, boost: 12, speed: 40 } },
  game: { arena: 'Stadium_P', isOT: false, isReplay: false, hasWinner: false, time_seconds: 61, target: 'Ruan_1', ball: { speed: 50, team: 0 }, teams: [{ name: 'BLUE', team_num: 0, score: 2 }, { name: 'ORANGE', team_num: 1, score: 1 }], ...o } } });

test('Rocket League: SOS, official API and relay feeds, pages, CasparCG layers, live values and triggers', async (t) => {
  const cg = await fakeCaspar(t);
  const game = await fakeGame(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1, previewChannel: 2, clearAfterOutMs: 0 } });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  await until(() => app.gfx.amcp.connected, 3000, 'CasparCG');
  assert.equal(app.rocket.on, true, 'on the production PC');

  // the pages: control panel and the graphics (the same files as the CasparCG templates)
  for (const p of ['/rl/control', '/rl/overlay', '/rl/stats', '/rl/postgame', '/rl/lib.js', '/rl/theme.css']) assert.equal((await fetch(app.url + p)).status, 200, p);
  assert.match(await (await fetch(app.url + '/rl/overlay')).text(), /window\.update = /);
  assert.equal((await client(app.url).get('/api/rl')).status, 401, 'settings need a sign-in');

  // the game: SOS
  await c.post('/api/rl/control', { sosUrl: game.url, source: 'sos', demo: true });
  await until(() => app.rocket.status === 'connected' && game.count === 1, 4000, 'connected to SOS');
  assert.equal(app.rocket.control.demo, undefined, 'no demo mode');

  // a page (or CasparCG) reads /rl/ws without signing in, but cannot change anything
  const seen = [];
  const ws = new WebSocket(app.url.replace('http', 'ws') + '/rl/ws');
  ws.onmessage = (e) => seen.push(JSON.parse(e.data));
  t.after(() => ws.close());
  await until(() => seen.some((m) => m.t === 'hello'), 3000, 'hello');
  assert.equal(seen.find((m) => m.t === 'hello').canControl, false);
  ws.send(JSON.stringify({ t: 'control', patch: { title: 'HACKED' } }));
  await until(() => seen.some((m) => m.t === 'error'), 2000, 'refused');
  assert.notEqual(app.rocket.control.title, 'HACKED');

  game.send(sosState());
  await until(() => seen.some((m) => m.t === 'update'), 3000, 'update relayed');
  let v = app.rocket.values();
  assert.deepEqual([v.rl_connected, v.rl_score_a, v.rl_score_b, v.rl_clock, v.rl_target, v.rl_target_boost, v.rl_team_a], ['1', '2', '1', '1:01', 'Ruan', '64', 'Blue Team']);
  assert.equal(app.gfx.liveValues().rl_score_a, '2', 'live values for graphics triggers, dashboards and templates');

  // game triggers: a goal takes the minimap in; one minute left takes the scorebug out
  const put = async (id, data) => { const r = await c.put(`/api/docs/gametrigger/${id}?team=${team}`, { data }); assert.equal(r.status, 200, JSON.stringify(r.data)); };
  await put('gametrigger_goal', { name: 'Goal minimap', when: 'goal', team: 'A', sport: 'Rocket League', actions: [{ do: 'rocket', method: 'show', target: 'minimap' }] });
  await put('gametrigger_min', { name: 'One minute', when: 'clock', at: '1:00', actions: [{ do: 'rocket', method: 'hide', target: 'scorebug' }] });
  await put('gametrigger_end', { name: 'Game over', when: 'match_end', actions: [{ do: 'rocket', method: 'show', target: 'postgame' }] });
  assert.equal(app.rocket.control.show.minimap, false);
  game.send({ event: 'game:goal_scored', data: { scorer: { name: 'Nova', teamnum: 1 }, goalspeed: 101 } });
  await until(() => seen.some((m) => m.t === 'ev' && m.e === 'game:goal_scored'), 2000, 'goal relayed');
  assert.equal(app.rocket.control.show.minimap, false, 'orange scored: the trigger is for blue');
  game.send({ event: 'game:goal_scored', data: { scorer: { name: 'Ruan', teamnum: 0 }, goalspeed: 99 } });
  await until(() => app.rocket.control.show.minimap === true, 2000, 'goal trigger');
  assert.equal(app.rocket.values().rl_last_goal, 'Ruan');
  assert.equal(app.rocket.control.show.scorebug, true);
  game.send(sosState({ time_seconds: 60 }));
  await until(() => app.rocket.control.show.scorebug === false, 2000, 'clock trigger at 1:00');

  // a game ends: the series moves on, the post-game board comes, the trigger fires
  game.send({ event: 'game:match_ended', data: { winner_team_num: 0 } });
  await until(() => app.rocket.control.series[0] === 1, 2000, 'series win');
  await until(() => app.rocket.control.show.postgame === true, 2000, 'match_end trigger');
  assert.ok(seen.some((m) => m.t === 'postgame' && m.d.winner === 0));

  // CasparCG: one layer per graphic from layer 40; switches take them in and out
  cg.got.length = 0;
  await c.post('/api/rl/control', { caspar: { on: true, layer: 40 } });
  await until(() => cg.got.filter((l) => / ADD 1 "rfp\/rocket\/overlay" /.test(l)).length === 7, 3000, 'seven layers');
  const add = (n) => cg.got.find((l) => l.startsWith(`CG 1-${n} ADD 1 "rfp/rocket/overlay"`));
  assert.match(add(40), / 0 "/, 'scorebug was switched off by the trigger: loaded, not played');
  assert.match(add(41), / 1 "/); assert.match(add(41), /\\"part\\":\\"boost\\"/); assert.match(add(41), /\\"ws\\":\\"ws:\/\/127\.0\.0\.1:\d+\/rl\/ws\\"/);
  assert.match(add(44), /\\"part\\":\\"moments\\".* 1 "|1 "\{\\"part\\":\\"moments/, 'moments always play');
  cg.got.length = 0;
  assert.equal((await c.post('/api/rl/action', { method: 'show', target: 'scorebug' })).status, 200);
  await until(() => cg.got.includes('CG 1-40 PLAY 1'), 2000, 'scorebug in');
  await c.post('/api/rl/action', { method: 'toggle', target: 'boost' });
  await until(() => cg.got.includes('CG 1-41 STOP 1'), 2000, 'boost out');
  assert.equal((await c.post('/api/rl/action', { method: 'show', target: 'nope' })).status, 400);
  const view = (await c.get('/api/rl')).data;
  assert.deepEqual(view.parts.map((p) => [p.id, p.layer]).slice(0, 2), [['scorebug', 40], ['boost', 41]]);
  assert.equal(view.parts[0].playing, true);
  cg.got.length = 0;
  await c.post('/api/rl/control', { caspar: { on: false } });
  await until(() => cg.got.filter((l) => /^CLEAR 1-4\d$/.test(l)).length === 7, 2000, 'layers cleared');

  // the official Stats API through a relay address (the format is recognised): several objects in one frame
  await c.post('/api/rl/control', { source: 'relay', relayUrl: game.url });
  await until(() => app.rocket.status === 'connected' && game.count === 1, 4000, 'relay connected');
  game.send(JSON.stringify({ Event: 'UpdateState', Data: { MatchGuid: 'x', Players: [{ Name: 'Kai', Shortcut: 2, TeamNum: 1, Score: 50, Goals: 1, Boost: 0.5, Speed: 2000 }],
    Game: { Teams: [{ Name: 'Blue', TeamNum: 0, Score: 0 }, { Name: 'Orange', TeamNum: 1, Score: 3 }], TimeSeconds: 30, bOvertime: false, Ball: { Speed: 1000, TeamNum: 1 }, bHasTarget: true, Target: { Name: 'Kai', Shortcut: 2, TeamNum: 1 } } } })
    + JSON.stringify({ Event: 'StatfeedEvent', Data: { EventName: 'EpicSave', Type: 'Epic Save', MainTarget: { Name: 'Kai', Shortcut: 2, TeamNum: 1 } } }));
  await until(() => app.rocket.values().rl_score_b === '3', 3000, 'official update');
  v = app.rocket.values();
  assert.deepEqual([v.rl_target, v.rl_target_boost, v.rl_target_speed, v.rl_ball_speed], ['Kai', '50', '72', '36'], 'boost 0–1 → %, uu/s → km/h');
  await until(() => seen.some((m) => m.t === 'ev' && m.e === 'game:statfeed_event' && m.d.event_name === 'EpicSave'), 2000, 'statfeed from the official API');

  // the official API's TCP port: JSON objects split across reads
  const tcp = net.createServer((s) => {
    const msg = JSON.stringify({ Event: 'UpdateState', Data: { Players: [], Game: { Teams: [{ Name: 'B', TeamNum: 0, Score: 4 }, { Name: 'O', TeamNum: 1, Score: 4 }], TimeSeconds: 12, bOvertime: true } } });
    s.write(msg.slice(0, 40)); setTimeout(() => s.write(msg.slice(40)), 60);
  });
  await new Promise((r) => tcp.listen(0, '127.0.0.1', r));
  t.after(() => tcp.close());
  await c.post('/api/rl/control', { source: 'official', officialUrl: `tcp://127.0.0.1:${tcp.address().port}` });
  await until(() => app.rocket.values().rl_score_a === '4', 3000, 'TCP update');
  assert.deepEqual([app.rocket.values().rl_ot, app.rocket.values().rl_clock], ['1', '+0:12']);
});
