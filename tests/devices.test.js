'use strict';
// vMix, ATEM and HyperDeck: each one against a small fake on this machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const dgram = require('node:dgram');
const { boot, client, until, liveClient, seed } = require('./helpers');
const { Atem, HyperDeck } = require('../lib/devices');

function fakeVmix() {
  const s = { streaming: false, active: 1, overlay1: '', calls: [] };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.searchParams.get('Function')) {
      s.calls.push(u.searchParams.get('Function') + ' ' + [...u.searchParams].filter(([k]) => k !== 'Function').map(([k, v]) => k + '=' + v).join('&'));
      if (u.searchParams.get('Function') === 'StartStreaming') s.streaming = true;
      if (u.searchParams.get('Function') === 'OverlayInput1In') s.overlay1 = u.searchParams.get('Input') || '2';
      res.end('Function completed successfully.'); return;
    }
    res.setHeader('content-type', 'text/xml');
    res.end(`<vmix><version>27.0.0.49</version><inputs><input key="a" number="1" type="Capture" title="Camera 1" state="Running">Camera 1</input>
      <input key="b" number="2" type="GT" title="Lower third.gtzip" state="Paused">Lower third.gtzip</input></inputs>
      <overlays><overlay number="1">${s.overlay1}</overlay><overlay number="2" /></overlays>
      <preview>2</preview><active>${s.active}</active><fadeToBlack>False</fadeToBlack><recording>False</recording><external>False</external><streaming>${s.streaming ? 'True' : 'False'}</streaming></vmix>`);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => { s.port = server.address().port; s.close = () => server.close(); r(s); }));
}

test('vMix: live values in templates, triggers and buttons; commands from buttons and settings', async (t) => {
  const vm = await fakeVmix();
  t.after(() => vm.close());
  const app = await boot({ devices: [{ type: 'vmix', name: 'vMix', id: 'vmix', host: '127.0.0.1', port: vm.port }] });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  await seed(c, team);
  await until(() => app.devices.state()[0].connected, 4000, 'vMix connection');
  let v = app.devices.vars();
  assert.deepEqual([v.vmix_connected, v.vmix_active, v.vmix_active_title, v.vmix_preview_title, v.vmix_streaming, v.vmix_overlay1_onair], ['1', '1', 'Camera 1', 'Lower third.gtzip', '', '']);
  // every device value is listed for linking, in its own group
  const vars = (await c.get('/live/api/variables')).data;
  const dv = vars.vars.filter((x) => x.group.startsWith('Devices')).map((x) => x.key);
  for (const k of ['vmix_streaming_time', 'vmix_overlay1_onair', 'vmix_active_title', 'vmix_connected']) assert.ok(dv.includes(k), k);
  assert.equal(vars.devices[0].id, 'vmix');
  // a button action sends a vMix function; the values it changes come back as live values
  await app.gfx.runActions([{ do: 'device', target: 'vmix', method: 'StartStreaming' }, { do: 'device', target: 'vmix', method: 'OverlayInput1In', value: 'Input=2' }], { label: 'test' });
  assert.deepEqual(vm.calls, ['StartStreaming ', 'OverlayInput1In Input=2']);
  await until(() => app.devices.vars().vmix_streaming === '1' && app.devices.vars().vmix_overlay1_onair === '1', 3000, 'streaming state');
  v = app.devices.vars();
  assert.match(v.vmix_streaming_time, /^0:00:0\d$/);
  assert.equal(v.vmix_overlay1_title, 'Lower third.gtzip');
  // the settings page: state carries the device list, and a command can be tried from there
  const lc = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  t.after(() => lc.close());
  await until(() => lc.state && lc.state.devices, 3000, 'state');
  assert.equal(lc.state.devices.list[0].connected, true);
  assert.ok(lc.state.devices.kinds.atem.commands.includes('dsk-on'));
  await lc.send('caspar', 'device', { id: 'vmix', command: 'Cut', value: '' });
  assert.equal(vm.calls.at(-1), 'Cut ');
  await assert.rejects(lc.send('caspar', 'device', { id: 'nope', command: 'Cut' }), /No device/);
  // saving the list: kept in config.json, a new id, switched off = no values
  await lc.send('caspar', 'devices', { list: [{ type: 'vmix', name: 'Main vMix', id: 'main', host: '127.0.0.1', port: vm.port, enabled: false }, { type: 'atem', name: 'ATEM' }] });
  assert.deepEqual(app.config.devices.map((d) => [d.id, d.type, d.port, d.enabled]), [['main', 'vmix', vm.port, false], ['atem', 'atem', 9910, true]]);
  assert.equal(app.devices.vars().main_active, undefined);
  await assert.rejects(app.devices.command('main', 'Cut'), /switched off/);
});

test('ATEM: state from the switcher becomes live values, commands go out as switcher packets', async (t) => {
  const sock = dgram.createSocket('udp4'), got = [];
  await new Promise((r) => sock.bind(0, '127.0.0.1', r));
  t.after(() => sock.close());
  const cmd = (name, data) => { const b = Buffer.alloc(8 + data.length); b.writeUInt16BE(8 + data.length, 0); b.write(name, 4, 'ascii'); Buffer.from(data).copy(b, 8); return b; };
  const packet = (flags, id, body) => { const h = Buffer.alloc(12); h.writeUInt16BE((flags << 11) | (12 + body.length), 0); h.writeUInt16BE(0x8001, 2); h.writeUInt16BE(id, 10); return Buffer.concat([h, body]); };
  const name = (n, text) => { const d = Buffer.alloc(36); d.writeUInt16BE(n, 0); d.write(text, 2, 'utf8'); return d; };
  sock.on('message', (m, from) => {
    const flags = m.readUInt16BE(0) >> 11;
    if (flags & 0x02) {                                    // hello: answer, then the state dump
      sock.send(packet(0x02, 0, Buffer.alloc(8)), from.port, from.address);
      const body = Buffer.concat([cmd('_pin', Buffer.from('ATEM Test Switcher\0'.padEnd(44, '\0'))), cmd('InPr', name(3, 'Wide')), cmd('PrgI', [0, 0, 0, 3]), cmd('PrvI', [0, 0, 0, 1]),
        cmd('KeOn', [0, 0, 1, 0]), cmd('DskS', [0, 1, 0, 0]), cmd('StRS', [0, 4]), cmd('SRST', [0, 12, 34, 0])]);
      sock.send(packet(0x01, 1, body), from.port, from.address);
      return;
    }
    if (m.length > 12) got.push(m.toString('ascii', 16, 20) + ':' + [...m.subarray(20)].join(','));
  });
  const a = new Atem({ host: '127.0.0.1', port: sock.address().port });
  t.after(() => a.stop());
  a.start();
  await until(() => a.vars().program === '3', 3000, 'ATEM state');
  const v = a.vars();
  assert.deepEqual([v.model, v.program, v.program_name, v.preview, v.key1_onair, v.dsk1_onair, v.streaming, v.streaming_state, v.streaming_time, v.recording], ['ATEM Test Switcher', '3', 'Wide', '1', '1', '1', '1', 'streaming', '0:12:34', '']);
  await a.command('dsk-on', 'dsk=2');
  await a.command('program', 'input=5 me=1');
  await a.command('key-off', 'key=1');
  await until(() => got.length >= 3, 2000, 'commands');
  assert.deepEqual(got.slice(0, 3), ['CDsL:1,1,0,0', 'CPgI:0,0,0,5', 'CKOn:0,0,0,0']);
  await assert.rejects(a.command('explode', ''), /Unknown ATEM command/);
});

test('HyperDeck: transport info becomes live values, commands are sent as text', async (t) => {
  const lines = [];
  const server = net.createServer((s) => {
    s.write('500 connection info:\r\nprotocol version: 1.11\r\nmodel: HyperDeck Test\r\n\r\n');
    s.on('data', (d) => { for (const l of String(d).split(/\r?\n/).filter(Boolean)) { lines.push(l); if (l === 'transport info') s.write('208 transport info:\r\nstatus: record\r\nslot id: 1\r\nclip id: 4\r\ndisplay timecode: 00:01:02:03\r\n\r\n'); } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const d = new HyperDeck({ host: '127.0.0.1', port: server.address().port });
  t.after(() => d.stop());
  d.start();
  await until(() => d.vars().status === 'record', 3000, 'HyperDeck state');
  assert.deepEqual(d.vars(), { status: 'record', recording: '1', playing: '', timecode: '00:01:02:03', clip: '4', slot: '1' });
  await d.command('stop', '');
  await d.command('goto: clip id:', '2');
  await until(() => lines.includes('goto: clip id: 2'), 2000, 'commands');
  assert.ok(lines.includes('stop'));
});

test('Raspberry Pi GPIO: inputs and outputs from the Pi service become live values, commands pulse a relay', async (t) => {
  const { PiGpio } = require('../lib/devices');
  const st = { name: 'pi-test', outputs: { 1: 0, 2: 0 }, inputs: { 1: 0 } }, calls = [], streams = new Set();
  const push = () => { for (const r of streams) r.write(`data: ${JSON.stringify(st)}\n\n`); };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); streams.add(res); req.on('close', () => streams.delete(res)); res.write(`data: ${JSON.stringify(st)}\n\n`); return; }
    if (u.pathname === '/cmd') {
      const n = u.searchParams.get('gpo');
      if (!st.outputs[n]) { if (st.outputs[n] === undefined) { res.writeHead(400); res.end(JSON.stringify({ error: `There is no GPO ${n}` })); return; } }
      calls.push([u.searchParams.get('do'), n, u.searchParams.get('ms')]); st.outputs[n] = u.searchParams.get('do') === 'off' ? 0 : 1; push(); res.end('{"ok":true}'); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { for (const r of streams) r.destroy(); server.close(); });
  const d = new PiGpio({ host: '127.0.0.1', port: server.address().port });
  t.after(() => d.stop());
  d.start();
  await until(() => d.connected, 3000, 'Pi connection');
  assert.deepEqual(d.vars(), { gpo1: '', gpo2: '', gpi1: '', name: 'pi-test' });
  st.inputs[1] = 1; push();
  await until(() => d.vars().gpi1 === '1', 2000, 'input closed');
  await d.command('pulse', 'gpo=2 ms=150');
  assert.deepEqual(calls[0], ['pulse', '2', '150']);
  await until(() => d.vars().gpo2 === '1', 2000, 'output on');
  await assert.rejects(d.command('on', 'gpo=7'), /no GPO 7/);
  assert.match(d.status().summary, /2 GPO, 1 on · 1 GPI, 1 on/);
});

test('OBS: password handshake, scenes and stream state as live values, commands as requests', async (t) => {
  const crypto = require('node:crypto');
  const { accept } = require('../lib/ws');
  const { Obs } = require('../lib/devices');
  const got = [], st = { program: 'Wide', preview: 'Close', streaming: false };
  const server = http.createServer();
  server.on('upgrade', (req, sock) => {
    const ws = accept(req, sock); if (!ws) return;
    const salt = 'c2FsdA==', challenge = 'Y2hhbA==', sha = (x) => crypto.createHash('sha256').update(x).digest('base64');
    ws.send({ op: 0, d: { rpcVersion: 1, authentication: { salt, challenge } } });
    ws.on('message', (txt) => {
      const m = JSON.parse(txt);
      if (m.op === 1) { if (m.d.authentication !== sha(sha('s3cret' + salt) + challenge)) { ws.end(); return; } ws.send({ op: 2, d: { negotiatedRpcVersion: 1 } }); return; }
      if (m.op !== 6) return;
      const { requestType: rt, requestId, requestData: rd } = m.d; got.push([rt, rd]);
      const ok = (data) => ws.send({ op: 7, d: { requestType: rt, requestId, requestStatus: { result: true, code: 100 }, responseData: data } });
      if (rt === 'GetCurrentProgramScene') ok({ currentProgramSceneName: st.program });
      else if (rt === 'GetStudioModeEnabled') ok({ studioModeEnabled: true });
      else if (rt === 'GetCurrentPreviewScene') ok({ currentPreviewSceneName: st.preview });
      else if (rt === 'GetSceneList') ok({ scenes: [{ sceneName: 'Wide' }, { sceneName: 'Close' }] });
      else if (rt === 'GetStreamStatus') ok({ outputActive: st.streaming, outputTimecode: st.streaming ? '00:01:05.250' : '00:00:00.000' });
      else if (rt === 'GetRecordStatus') ok({ outputActive: false });
      else if (rt === 'SetCurrentProgramScene') { st.program = rd.sceneName; ok({}); ws.send({ op: 5, d: { eventType: 'CurrentProgramSceneChanged', eventData: { sceneName: rd.sceneName } } }); }
      else if (rt === 'StartStream') { st.streaming = true; ok({}); ws.send({ op: 5, d: { eventType: 'StreamStateChanged', eventData: { outputActive: true } } }); }
      else ws.send({ op: 7, d: { requestType: rt, requestId, requestStatus: { result: false, code: 600, comment: 'No source called that' } } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const bad = new Obs({ host: '127.0.0.1', port: server.address().port, password: 'nope' });
  t.after(() => bad.stop());
  const o = new Obs({ host: '127.0.0.1', port: server.address().port, password: 's3cret' });
  t.after(() => o.stop());
  o.start(); bad.start();
  await until(() => o.connected && o.vars().program_scene === 'Wide', 3000, 'OBS connection');
  assert.equal(bad.connected, false);
  assert.deepEqual([o.vars().preview_scene, o.vars().studio_mode, o.vars().scenes], ['Close', '1', 'Wide, Close']);
  await o.command('scene', 'Close');
  await until(() => o.vars().program_scene === 'Close', 2000, 'scene change');
  await o.command('stream-start', '');
  await until(() => o.vars().streaming === '1' && o.vars().streaming_time === '00:01:05', 3000, 'stream state');
  await assert.rejects(o.command('mute', 'Mic 9'), /No source called that/);
  await assert.rejects(o.command('SetInputVolume', 'not json'), /must be JSON/);
  assert.ok(got.some(([rt, rd]) => rt === 'SetCurrentProgramScene' && rd.sceneName === 'Close'));
});

test('Companion, OSC and Art-Net: commands go out in each protocol, OSC comes back in as live values', async (t) => {
  const dgram = require('node:dgram');
  const { Companion, Osc, ArtNet, oscEncode, oscArgs, oscDecode } = require('../lib/devices');
  // Companion HTTP API
  const calls = [];
  const cs = http.createServer((req, res) => { calls.push(req.method + ' ' + req.url); res.end('ok'); });
  await new Promise((r) => cs.listen(0, '127.0.0.1', r)); t.after(() => cs.close());
  const comp = new Companion({ host: '127.0.0.1', port: cs.address().port }); t.after(() => comp.stop()); comp.start();
  await until(() => comp.connected, 2000, 'Companion');
  await comp.command('press', '2/1/3'); await comp.command('down', 'page=1 row=0 col=4'); await comp.command('set-variable', 'score=12 - 7');
  assert.deepEqual(calls.filter((c) => c.startsWith('POST')), ['POST /api/location/2/1/3/press', 'POST /api/location/1/0/4/down', 'POST /api/custom-variable/score/value?value=12%20-%207']);
  // OSC: encode / decode and a round trip
  assert.deepEqual(oscDecode(oscEncode('/cue/1/start', oscArgs('3 0.5 "two words" T')), []), [{ address: '/cue/1/start', args: [3, 0.5, 'two words', 1] }]);
  const rx = dgram.createSocket('udp4'), seen = [];
  await new Promise((r) => rx.bind(0, '127.0.0.1', r)); t.after(() => rx.close());
  rx.on('message', (m) => seen.push(oscDecode(m, [])[0]));
  const osc = new Osc({ host: '127.0.0.1', port: rx.address().port, listen: 0 }); t.after(() => osc.stop()); osc.start();
  await until(() => osc.connected, 2000, 'OSC socket');
  await osc.command('/eos/key/go_0', '1');
  await until(() => seen.length, 2000, 'OSC out');
  assert.deepEqual(seen[0], { address: '/eos/key/go_0', args: [1] });
  const lp = 20000 + Math.floor(Math.random() * 20000);
  const osc2 = new Osc({ host: '127.0.0.1', port: 9, listen: lp }); t.after(() => osc2.stop()); osc2.start();
  await until(() => osc2.connected, 2000, 'OSC listen');
  const tx = dgram.createSocket('udp4'); t.after(() => tx.close());
  tx.send(oscEncode('/1/fader1', [['f', 0.75]]), lp, '127.0.0.1');
  await until(() => osc2.vars()['1_fader1'] === '0.75', 2000, 'OSC in');
  // Art-Net: ArtDMX packets with the channels set, a fade, blackout
  const an = dgram.createSocket('udp4'), pk = [];
  await new Promise((r) => an.bind(0, '127.0.0.1', r)); t.after(() => an.close());
  an.on('message', (m) => pk.push(m));
  const art = new ArtNet({ host: '127.0.0.1', port: an.address().port, universe: 3 }); t.after(() => art.stop()); art.start();
  await until(() => art.connected, 2000, 'Art-Net socket');
  await art.command('set', '1=255 2=128 10-12=50%');
  await until(() => pk.length && pk[pk.length - 1][18] === 255, 2000, 'ArtDMX');
  const p = pk[pk.length - 1];
  assert.equal(p.toString('ascii', 0, 7), 'Art-Net');
  assert.deepEqual([p.readUInt16LE(8), p[14], p.readUInt16BE(16), p[18], p[19], p[27], p[29], p[30]], [0x5000, 3, 512, 255, 128, 128, 128, 0]);
  await art.command('fade', '1=0 time=0.2');
  await until(() => art.vars().ch1 === '0', 2000, 'fade to 0');
  await art.command('blackout');
  assert.equal(art.vars().ch2, '0');
  await assert.rejects(art.command('set', 'nonsense'), /Give channels/);
});

test('MIDI and X-keys through the bridge page; input mappings run actions; Companion can drive RFP Manager', async (t) => {
  const { fakeCaspar, seed, payload } = require('./helpers');
  const cg = await fakeCaspar(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1, previewChannel: 2, clearAfterOutMs: 0 },
    devices: [{ type: 'midi', id: 'midi', name: 'MIDI' }, { type: 'xkeys', id: 'xk', name: 'X-keys' }],
    deviceMappings: [{ when: 'xk_key5', on: 'press', actions: [{ do: 'show', target: 'custom_lt', values: { line1: 'FROM X-KEYS' } }] }, { when: 'midi_note60', on: 'press', actions: [{ do: 'hideall' }] }] });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  await seed(c, team);
  await until(() => app.gfx.amcp.connected, 3000, 'CasparCG');
  assert.equal(app.devices.state().find((d) => d.id === 'xk').connected, false);
  const br = await liveClient(app, { cookie: c.cookie(), role: 'bridge' });
  t.after(() => br.close());
  await br.send('bridge', 'hello', {});
  await until(() => app.devices.state().every((d) => d.connected), 2000, 'bridge counted');
  // X-keys key 5 → mapping takes a graphic
  await br.send('bridge', 'input', { kind: 'xkeys', key: 5, down: true });
  assert.equal(payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-30 ADD 1 "rfp/lowerthird"')), 2000, 'mapping')).line1, 'FROM X-KEYS');
  assert.equal(app.devices.vars().xk_key5, '1');
  await br.send('bridge', 'input', { kind: 'xkeys', key: 5, down: false });
  // MIDI note 60 → take everything off
  await br.send('bridge', 'input', { kind: 'note', note: 60, velocity: 100, channel: 1, port: 'nanoKONTROL' });
  await until(() => cg.got.some((l) => l.startsWith('CG 1-30 STOP')), 2000, 'hide all from MIDI');
  assert.equal(app.devices.vars().midi_last, 'note 60 ch 1');
  // Learn: the next press says which live value it was; screens get every press as a shortcut
  const learning = c.post('/api/connections/learn', {});
  await new Promise((r) => setTimeout(r, 150));
  await br.send('bridge', 'input', { kind: 'note', note: 61, velocity: 90, channel: 1, port: 'pads' });
  const learnt = (await learning).data.input;
  assert.deepEqual([learnt.key, learnt.value, learnt.pressed, learnt.kind], ['midi_note61', '90', true, 'midi']);
  const sc = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'sport' });
  t.after(() => sc.close());
  await br.send('bridge', 'input', { kind: 'xkeys', key: 7, down: true });
  assert.ok((await until(() => sc.got.find((m) => m.type === 'devInput' && m.key === 'xk_key7'), 2000, 'devInput')).pressed);
  await sc.send('rfp', 'pads', { pad: { buttons: {}, custom: [], shortcuts: { 'pt=try|A': { key: 'T', input: '{xk_key7}' }, 'x|': { key: '', input: '' } } } });
  assert.deepEqual((await app.store.get(team)).data.scorerPads.rugby.shortcuts, { 'pt=try|A': { key: 'T', input: 'xk_key7' } });
  // MIDI and X-keys out go to the bridge page
  await app.devices.command('midi', 'cc', 'cc=7 value=100 ch=2');
  await app.devices.command('xk', 'light-on', 'key=5');
  await until(() => br.got.filter((m) => m.type === 'bridgeOut').length >= 2, 2000, 'bridge out');
  const outs = br.got.filter((m) => m.type === 'bridgeOut');
  assert.deepEqual(outs[0].bytes, [0xb1, 7, 100]);
  assert.deepEqual([outs[1].kind, outs[1].what, outs[1].key], ['xkeys', 'light-on', 5]);
  // Companion → RFP Manager (from this PC, no key)
  cg.got.length = 0;
  let r = await fetch(app.url + '/live/api/companion/take/custom_lt', { method: 'POST' });
  assert.equal(r.status, 200);
  await until(() => cg.got.some((l) => l.includes('rfp/lowerthird')), 2000, 'take from Companion');
  r = await fetch(app.url + '/live/api/companion/macro/nope');
  assert.equal(r.status, 404);
  const vals = await (await fetch(app.url + '/live/api/companion/values')).json();
  assert.equal(vals.xk_connected, '1');
  // Settings → Connections (REST)
  const cn = (await c.get('/api/connections')).data;
  assert.ok(cn.kinds.obs && cn.kinds.artnet && cn.kinds.companion && cn.kinds.osc);
  await c.put('/api/connections/devices', { list: [...cn.devices, { type: 'obs', id: 'obs', name: 'OBS', host: '127.0.0.1', port: 1, password: 'pw' }] });
  let st = (await c.get('/api/connections')).data.devices.find((d) => d.id === 'obs');
  assert.equal(st.password, '********');
  assert.equal(app.config.devices.find((d) => d.id === 'obs').password, 'pw');
  await c.put('/api/connections/devices', { list: (await c.get('/api/connections')).data.devices });   // saving with the mask keeps the password
  assert.equal(app.config.devices.find((d) => d.id === 'obs').password, 'pw');
  await c.put('/api/connections/mappings', { list: [{ when: '{xk_key1}', on: 'release', actions: [{ do: 'timeline', method: 'go' }, { do: 'bogus' }] }] });
  assert.deepEqual(app.config.deviceMappings.map((m) => [m.when, m.on, m.actions.map((a) => a.do)]), [['xk_key1', 'release', ['timeline']]]);
  await c.put('/api/connections/caspar', { host: '127.0.0.1', port: cg.port, programChannel: 1, previewChannel: 3, images: 'http' });
  assert.deepEqual([app.config.caspar.previewChannel, app.config.caspar.images], [3, 'http']);
});

test('MIDI and X-keys straight on the PC: the helper (Windows) and the device files (Linux)', async (t) => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
  const { midiParser, xkeysKeys } = require('../lib/hw');
  // the pieces: MIDI bytes with running status, X-keys key bits
  const got = []; const p = midiParser((m) => got.push(m));
  p(Buffer.from([0x90, 60, 100, 62, 90, 0xf8, 0xb0, 7, 64, 0xf0, 1, 2, 3, 0xf7, 0xc1, 5]));
  assert.deepEqual(got, [[0x90, 60, 100], [0x90, 62, 90], [0xb0, 7, 64], [0xc1, 5]]);
  assert.deepEqual([...xkeysKeys([0, 0, 0b101, 0, 0b10])], [1, 3, 18]);
  // Windows: the helper process (a stand-in here) passes MIDI and X-keys both ways
  const logFile = path.join(os.tmpdir(), 'rfp-hw-' + process.pid + '.log');
  fs.writeFileSync(logFile, '');
  const app = await boot({ hwHelper: [process.execPath, path.join(__dirname, 'fixtures', 'fake-hw-helper.js'), logFile],
    devices: [{ type: 'midi', id: 'pads', name: 'Pads', host: 'nanopad' }, { type: 'xkeys', id: 'xk', name: 'X-keys' }] });
  t.after(() => app.stop());
  await until(() => app.devices.state().every((d) => d.connected), 4000, 'helper ports');
  assert.match(app.devices.state().find((d) => d.id === 'pads').summary, /nanoPAD2/);
  app.devices.hwRaw('fake-midi\tnanoPAD2\t144 60 99');
  app.devices.hwRaw('fake-midi\tLaunchpad Mini\t144 61 99');        // another port: not this device
  app.devices.hwRaw('fake-hid\th1\t0 0 0 4');                         // column 2, row 3 → key 11
  await until(() => app.devices.vars().pads_note60 === '99' && app.devices.vars().xk_key11 === '1', 3000, 'inputs');
  assert.equal(app.devices.vars().pads_note61, undefined);
  app.devices.hwRaw('fake-hid\th1\t0 0 0 0');
  await until(() => app.devices.vars().xk_key11 === '', 3000, 'key up');
  await app.devices.command('pads', 'cc', 'cc=7 value=100');
  await app.devices.command('xk', 'light-on', 'key=4');
  await assert.rejects(app.devices.command('pads', 'bogus', ''), /Unknown MIDI command/);
  await until(() => /hid\th1\t0 181 3 1/.test(fs.readFileSync(logFile, 'utf8')), 2000, 'commands to the helper');
  assert.match(fs.readFileSync(logFile, 'utf8'), /^midi\tnanopad\t176 7 100$/m);
  assert.equal(app.devices.hw().midiIn.length, 2);
  // Linux: raw MIDI and hidraw device files (FIFOs stand in for them)
  if (process.platform !== 'linux') return;
  const dev = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-dev-')), sys = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-sys-'));
  fs.mkdirSync(path.join(dev, 'snd'));
  execFileSync('mkfifo', [path.join(dev, 'snd', 'midiC1D0'), path.join(dev, 'hidraw3')]);
  fs.mkdirSync(path.join(sys, 'hidraw', 'hidraw3', 'device'), { recursive: true });
  fs.writeFileSync(path.join(sys, 'hidraw', 'hidraw3', 'device', 'uevent'), 'HID_ID=0003:000005F3:00000405\nHID_NAME=P. I. Engineering XK-24\n');
  const app2 = await boot({ hwDevDir: dev, hwSysDir: sys, devices: [{ type: 'midi', id: 'm', name: 'MIDI' }, { type: 'xkeys', id: 'x', name: 'X-keys', host: 'xk-24' }] });
  t.after(() => app2.stop());
  await until(() => app2.devices.state().every((d) => d.connected), 5000, 'device files found');
  const wm = fs.createWriteStream(path.join(dev, 'snd', 'midiC1D0')), wh = fs.createWriteStream(path.join(dev, 'hidraw3'));
  t.after(() => { wm.destroy(); wh.destroy(); });
  wm.write(Buffer.from([0x99, 36, 127]));
  wh.write(Buffer.from([0, 0, 1, 0]));
  await until(() => app2.devices.vars().m_note36 === '127' && app2.devices.vars().x_key1 === '1', 3000, 'Linux inputs');
  assert.match(app2.devices.vars().m_last, /note 36 ch 10/);
});
