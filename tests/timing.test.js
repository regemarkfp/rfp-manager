'use strict';
// Timing systems → athletics: FinishLynx files, a scoreboard port (UDP running time, TCP results), ALGE lines,
// your own layout, and events named from dropdowns (gender, age group, discipline, round).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const dgram = require('node:dgram');
const { boot, client, until, liveClient } = require('./helpers');
const Core = require('../lib/timing-core');
const Athletics = require('../shared/athletics');
const Sports = require('../shared/sports');

test('athletics catalogue: names from dropdowns, and names from timing systems read back into dropdowns', () => {
  assert.equal(Athletics.eventName({ discipline: '80m Hurdles', gender: 'Girls', age: 'U16' }), '80m Hurdles Girls U16');
  assert.equal(Athletics.eventName({ discipline: '100m', gender: 'Men', age: 'Open' }), '100m Men');
  assert.equal(Athletics.roundLabel('Heat', '2'), 'Heat 2');
  const p = Athletics.parseEvent("Boys U16 80m Hurdles Heat 2");
  assert.deepEqual([p.gender, p.age, p.discipline, p.round, p.heat, p.kind], ['Boys', 'U16', '80m Hurdles', 'Heat', '2', 'track']);
  assert.equal(Athletics.parseEvent('WOMEN LONG JUMP').kind, 'field');
  assert.equal(Athletics.parseEvent('Men 110mH A Final').discipline, '110m Hurdles');
  assert.equal(Athletics.parseEvent('Mixed 4x400m Relay').discipline, '4x400m Relay');
});

test('timing parsers: Lynx files, ALGE, scoreboard lines, your own layout', () => {
  const ppl = Core.parsePpl('23,Duck,Don,MIT\n');
  const evt = Core.parseEvt("999,1,1,Men's 100 Meter\n,23,1\n,67,3,Mouse,Michael,Florida State\n", ppl);
  assert.equal(evt[0].key, 'lynx:999-1-1');
  assert.deepEqual(evt[0].entries.map((e) => [e.lane, e.bib, e.name]), [['1', '23', 'Don Duck'], ['3', '67', 'Michael Mouse']]);
  const lif = Core.parseLif("999,1,1,Men's 100 Meter,+1.3,m/s\n1,67,3,Mouse,Michael,Florida State,10.234,,,0.141\n2,23,1,Duck,Don,MIT,10.51\nDNF,44,4,Bear,Smokey,Maine\n");
  assert.equal(lif.wind, '+1.3');
  assert.deepEqual(lif.rows.map((r) => [r.bib, r.time, r.reaction]), [['67', '10.234', '0.141'], ['23', '10.51', ''], ['44', 'DNF', '']]);
  assert.deepEqual(Core.parseRecord('\x0212.3\x03', {}), { t: 'clock', ms: 12300, running: true });
  assert.equal(Core.parseRecord(' 0012 RT 00:00:10.2341 00', { format: 'alge' }).time, '10.24', 'hundredths, rounded up');
  const r = Core.parseRecord('2|4|1234|Mary Jones|TUKS|11.05|0.145', {});
  assert.deepEqual([r.place, r.lane, r.bib, r.name, r.team, r.time, r.reaction], ['2', '4', '1234', 'Mary Jones', 'TUKS', '11.05', '0.145']);
  const mine = { format: 'custom', rules: [{ when: 'starts', match: 'R', type: 'result', split: 'semicolon', fields: { lane: 2, name: 3, time: 4 } }, { when: 'starts', match: 'T', type: 'clock', split: 'semicolon', fields: { clock: 2 } }] };
  assert.deepEqual(Core.parseRecord('R;5;Ann Lee;12.01', mine), { t: 'result', place: '', lane: '5', bib: '', name: 'Ann Lee', team: '', time: '12.01', reaction: '' });
  assert.equal(Core.parseRecord('T;1:02.3', mine).ms, 62300);
  assert.equal(Core.parseRecord('X;whatever', mine), null);
  assert.equal(Core.fmtResult(105320), '1:45.32');
});

test('timing systems fill the live athletics meet: start lists, running clock, results, wind', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-lynx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = await boot({});
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  const r0 = await c.put(`/api/docs/fixture/fixture_ath?team=${team}`, { data: { sport: 'Athletics', name: 'Spring meet', startDate: '2026-10-10' } });
  assert.equal(r0.status, 200, JSON.stringify(r0.data));
  const ctl = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_ath', role: 'control' });
  t.after(() => ctl.close());
  await ctl.send('rfp', 'onAir', { fixtureId: 'fixture_ath' });
  const sc = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_ath', role: 'sport' });
  t.after(() => sc.close());
  await until(() => sc.state && sc.state.sport && sc.state.sport.setup && sc.state.sport.setup.sport === 'athletics', 3000, 'athletics setup');
  await sc.send('sport', 'mode', { mode: 'sport' });

  const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
  const uport = port + 1;
  let st = (await c.put('/api/timing', { inputs: [
    { id: 'files', name: 'FinishLynx files', kind: 'folder', format: 'lynx', folder: dir },
    { id: 'board', name: 'Results board', kind: 'tcp', mode: 'listen', port, format: 'auto' },
    { id: 'clock', name: 'Running time', kind: 'udp', port: uport, format: 'running' },
  ] })).data;
  assert.equal(st.inputs.length, 3);
  await until(async () => (await c.get('/api/timing')).data.inputs.every((i) => ['listening', 'connected'].includes(i.state)), 3000, 'inputs up');

  // start lists from Lynx: events made from the names, with dropdown fields filled in
  fs.writeFileSync(path.join(dir, 'lynx.ppl'), '23,Duck,Don,MIT\n');
  fs.writeFileSync(path.join(dir, 'lynx.evt'), "1,1,1,Men's 100 Meter\n,23,1\n,67,3,Mouse,Michael,Florida State\n2,1,1,Girls U16 80m Hurdles\n,5,4,Lee,Ann,Tuks\n2,1,2,Girls U16 80m Hurdles\n,6,2,Ray,Sue,Maties\n");
  const ath = () => sc.state.sport.setup.ath;
  await until(() => ath() && ath().events.length === 3, 5000, 'three events from lynx.evt');
  const [m100, h1, h2] = ath().events;
  assert.deepEqual([m100.discipline, m100.gender, m100.name, m100.kind], ['100m', 'Men', '100m Men', 'track']);
  assert.deepEqual(m100.entries.map((e) => e.name), ['Don Duck', 'Michael Mouse']);
  assert.deepEqual([h1.name, h1.round, h2.round, h1.age], ['80m Hurdles Girls U16', 'Heat 1', 'Heat 2', 'U16']);

  // running time on UDP: the race clock runs, then stops where the feed stops
  const u = dgram.createSocket('udp4');
  t.after(() => u.close());
  const sendU = (s) => new Promise((res) => u.send(Buffer.from(s, 'latin1'), uport, '127.0.0.1', res));
  for (const x of ['0.5', '0.6', '0.7', '0.8']) { await sendU(`\x02${x}\x03`); await new Promise((r) => setTimeout(r, 100)); }
  await until(() => sc.state.sport.clocks.game.running, 3000, 'clock running');
  for (const x of ['9.87', '9.87', '9.87']) await sendU(`\x02${x}\x03`);
  await until(() => !sc.state.sport.clocks.game.running && sc.state.sport.clocks.game.valueMs === 9870, 3000, 'clock stopped at 9.87');

  // results on the scoreboard port (TCP): the event, then the places; the meet follows the race
  const sock = net.connect(port, '127.0.0.1');
  t.after(() => sock.destroy());
  await new Promise((r) => sock.on('connect', r));
  sock.write("Men's 100 Meter\r\nWind +1.2 m/s\r\n1|3|67|Michael Mouse|Florida State|10.23|0.141\r\n2|1|23|Don Duck|MIT|10.51\r\n");
  await until(() => sc.state.sport.events.filter((e) => e.type === 'result').length === 2, 5000, 'two results');
  let v = Sports.compute(sc.state.sport.setup, sc.state.sport.events);
  let cur = v.extra.current;
  assert.equal(cur.name, '100m Men');
  assert.equal(cur.wind, '+1.2');
  assert.deepEqual(cur.results.map((r) => [r.rank, r.name, r.result, r.reaction]), [[1, 'Michael Mouse', '10.23', '0.141'], [2, 'Don Duck', '10.51', '']]);
  assert.equal(v.flat.ath_discipline, '100M'); assert.equal(v.flat.ath_gender, 'MEN'); assert.equal(v.flat.rs1_reaction, '0.141');
  // the same result again changes nothing
  const n = sc.state.sport.events.length;
  sock.write('1|3|67|Michael Mouse|Florida State|10.23|0.141\r\n');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(sc.state.sport.events.length, n);

  // official results from the .lif file: the heat becomes the current event
  fs.writeFileSync(path.join(dir, '002-1-02.lif'), '2,1,2,Girls U16 80m Hurdles,-0.4,m/s\n1,6,2,Ray,Sue,Maties,12.01,,,0.160\n');
  await until(() => ath().current === h2.id && sc.state.sport.events.some((e) => e.type === 'result' && e.eventId === h2.id), 5000, 'heat 2 results');
  v = Sports.compute(sc.state.sport.setup, sc.state.sport.events); cur = v.extra.current;
  assert.deepEqual([cur.round, cur.wind, cur.results[0].name, cur.results[0].result], ['Heat 2', '-0.4', 'Sue Ray', '12.01']);

  // the monitor and the preview
  st = (await c.get('/api/timing')).data;
  assert.ok(st.recent.some((x) => x.type === 'result'));
  assert.ok(st.inputs.find((i) => i.id === 'board').parsed >= 4);
  const pv = (await c.post('/api/timing/preview', { input: { kind: 'tcp', format: 'auto' }, text: '3|5|Ann Lee|12.40' })).data.lines;
  assert.equal(pv[0].msg.name, 'Ann Lee');
  // typed in by hand
  await c.post('/api/timing/inject', { input: 'board', text: 'Girls U16 80m Hurdles Heat 2\n2|6|Sue Ray|Maties|12.90' });
  assert.equal(ath().events.length, 3, 'found the heat by its name, no new event');
  v = Sports.compute(sc.state.sport.setup, sc.state.sport.events);
  assert.equal(v.extra.current.results.find((r) => r.name === 'Sue Ray').result, '12.01', 'the official (.lif) result stays');
  await c.post('/api/timing/inject', { input: 'board', text: '3|7|Kim Bo|Tuks|13.20' });
  v = Sports.compute(sc.state.sport.setup, sc.state.sport.events);
  assert.equal(v.extra.current.results.find((r) => r.name === 'Kim Bo').result, '13.20', 'a new athlete from the board is added');
});
