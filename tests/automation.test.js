'use strict';
// Custom variables, game triggers (an advert on a try, a graphic on a six) and dashboards.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until, seed, liveClient, fakeCaspar, payload } = require('./helpers');

async function world(t) {
  const cg = await fakeCaspar(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1, previewChannel: 2, clearAfterOutMs: 0 } });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  await seed(c, team);
  const put = async (type, id, data) => { const r = await c.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.doc; };
  await until(() => app.gfx.amcp.connected, 3000, 'CasparCG');
  return { app, c, cg, team, put };
}

test('custom variables per match / competition / sport, in templates, actions and dashboards', async (t) => {
  const { app, c, cg, put } = await world(t);
  await put('variable', 'variable_att', { name: 'Attendance', key: 'attendance', type: 'number', scope: 'match', default: '0', min: 0 });
  await put('variable', 'variable_motm', { name: 'Man of the match', key: 'motm', type: 'text', scope: 'competition', competition: 'comp_cc' });
  await put('variable', 'variable_cricket', { name: 'Only cricket', key: 'only_cricket', scope: 'sport', sport: 'Cricket', default: 'x' });
  await app.gfx.setFixture('fixture_one');
  let v = app.automation.vars();
  assert.deepEqual([v.var_attendance, v.var_motm, v.var_only_cricket], ['0', '', undefined]);
  app.automation.set('attendance', '12500'); app.automation.set('var_attendance', '+500'); app.automation.set('attendance', '-99999');
  assert.equal(app.automation.vars().var_attendance, '0', 'min 0');
  app.automation.set('attendance', '13000');
  // an action sets one, a template field shows it
  await app.gfx.runActions([{ do: 'setvar', target: 'motm', value: 'No. {var_attendance}' }, { do: 'show', target: 'custom_lt', values: { line1: 'Crowd {var_attendance}', line2: '{var_motm}' } }], { label: 'test' });
  const d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-30 ADD 1 "rfp/lowerthird"')), 2000, 'take'));
  assert.deepEqual([d.line1, d.line2], ['Crowd 13000', 'No. 13000']);
  // per match: another match has its own value; listed in the live values for templates
  assert.equal(app.automation.vars('').var_attendance, '0');
  const vars = (await c.get('/live/api/variables')).data.vars;
  assert.ok(vars.some((x) => x.key === 'var_attendance' && x.group === 'Custom variables' && x.value === '13000'));
  assert.equal((await c.post('/api/vars/value', { key: 'attendance', value: '+1' })).data.value, '13001');
  assert.equal((await c.post('/api/vars/value', { key: 'nope', value: '1' })).status, 400);
  // kept on this PC across restarts (they are saved a moment later)
  await until(async () => { const kv = await app.store.kvGet('vars:values'); return kv && Object.values(kv).includes('13001'); }, 3000, 'saved');
  // dashboards: open, save, live values, setvar from a control
  await put('dashboard', 'dashboard_a', { name: 'Desk' });
  const lc = await liveClient(app, { cookie: c.cookie(), role: 'dash' });
  t.after(() => lc.close());
  await lc.send('dash', 'open', { id: 'dashboard_a' });
  const open = lc.got.find((m) => m.type === 'dash');
  assert.deepEqual([open.can.edit, open.can.use], [true, true]);
  assert.ok(open.lists.variables.some((x) => x.key === 'attendance' && x.value === '13001'));
  await lc.send('dash', 'save', { id: 'dashboard_a', data: { name: 'Desk', pages: [{ id: 'p1', name: 'Main', controls: [{ id: 'b1', type: 'button', x: 10.4, y: 20, w: 100, h: 40, label: 'Strap', actions: [{ do: 'show', target: 'custom_lt' }, { do: 'bogus' }] }, { id: 'f1', type: 'fader', x: 0, y: 0, w: 40, h: 200, bind: 'attendance' }] }] } });
  const saved = (await app.store.get('dashboard_a')).data;
  assert.deepEqual([saved.pages[0].controls[0].x, saved.pages[0].controls[0].actions.map((a) => a.do), saved.width], [10, ['show'], 1280]);
  const vmsg = await until(() => [...lc.got].reverse().find((m) => m.type === 'values' && m.values.var_attendance), 3000, 'values feed');
  assert.equal(vmsg.values.teamA_name, 'CHEETAHS');
  await lc.send('gfx', 'setvar', { key: 'attendance', value: '20000' });
  await until(() => [...lc.got].reverse().find((m) => m.type === 'values' && m.values.var_attendance === '20000'), 3000, 'value pushed');
});

test('game triggers: an advert after every second try for team A, a six graphic in cricket, cool-down and most per match', async (t) => {
  const { app, c, cg, put } = await world(t);
  await put('advert', 'advert_try', { name: 'Try sponsor', sponsor: 'Acme', kind: 'CasparCG clip', clip: 'ADS/TRY_SPONSOR', duration: 1 });
  await put('gametrigger', 'gametrigger_try', { name: 'Try sponsor', when: 'try', team: 'A', every: 2, actions: [{ do: 'advert', target: 'advert_try' }] });
  await put('gametrigger', 'gametrigger_card', { name: 'Card', when: 'card', maxPerMatch: 1, actions: [{ do: 'show', target: 'custom_lt', values: { line1: 'CARD {event_text}' } }] });
  await put('gametrigger', 'gametrigger_off', { name: 'Off', when: 'try', off: true, actions: [{ do: 'hideall' }] });
  const ctl = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  t.after(() => ctl.close());
  await ctl.send('rfp', 'onAir', { fixtureId: 'fixture_one' });
  const rug = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'sport' });
  t.after(() => rug.close());
  await until(() => rug.state && rug.state.sport && rug.state.sport.setup, 3000, 'setup');
  const events = [];
  const add = async (ev) => { events.push(ev); await rug.send('sport', 'apply', { version: rug.state.sport.version, setup: rug.state.sport.setup, events: events.slice() }); await until(() => rug.state.sport.events.length === events.length, 2000, 'applied'); };
  cg.got.length = 0;
  await add({ id: 'e1', type: 'score', key: 'try', team: 'A' });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!cg.got.some((l) => l.includes('TRY_SPONSOR')), 'first try: not yet (every 2nd)');
  await add({ id: 'e2', type: 'score', key: 'try', team: 'B' });
  await add({ id: 'e3', type: 'score', key: 'try', team: 'A' });
  await until(() => cg.got.some((l) => l.includes('"ADS/TRY_SPONSOR"')), 3000, 'advert on the 2nd try by A');
  await add({ id: 'e4', type: 'card', key: 'yellow', team: 'B' });
  assert.equal(payload(await until(() => cg.got.find((l) => l.includes('rfp/lowerthird')), 2000, 'card graphic')).line1, 'CARD yellow');
  cg.got.length = 0;
  await add({ id: 'e5', type: 'card', key: 'red', team: 'A' });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!cg.got.some((l) => l.includes('rfp/lowerthird')), 'most once per match');
  const log = (await app.store.list((await app.store.get('fixture_one')).team, 'adlog')).flatMap((x) => x.data.entries);
  assert.equal(log[0].via, 'Game trigger');
});
