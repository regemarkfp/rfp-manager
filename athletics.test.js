'use strict';
// Athletics control: automatic event changes, lower thirds per lane, and field events that cycle through the athletes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until, liveClient } = require('./helpers');
const Sports = require('../shared/sports');

test('field events: who is up, rounds, the cut, vertical jumps', () => {
  const su = Sports.newSetup('athletics');
  su.ath.events = [
    { id: 'lj', name: 'Long Jump Men', kind: 'field', discipline: 'Long Jump', rounds: 3, entries: [{ id: 'a', name: 'Ann', lane: '1' }, { id: 'b', name: 'Bea', lane: '2' }, { id: 'c', name: 'Cat', lane: '3' }] },
    { id: 'hj', name: 'High Jump Women', kind: 'field', discipline: 'High Jump', bar: '1.70', entries: [{ id: 'x', name: 'Xia', lane: '1' }, { id: 'y', name: 'Yas', lane: '2' }] },
  ];
  su.ath.current = 'lj';
  const ev = [];
  const at = (e, en, value) => ev.push({ id: String(ev.length), type: 'attempt', eventId: e, entry: en, value });
  const cur = () => Sports.compute(su, ev).extra.current;
  assert.deepEqual([cur().up, cur().attemptRound], ['a', 1]);
  at('lj', 'a', '7.10'); at('lj', 'b', 'X');
  assert.equal(cur().up, 'c');
  at('lj', 'c', '7.30');
  assert.deepEqual([cur().up, cur().attemptRound], ['a', 2], 'round 2 starts with the first in order');
  su.ath.events[0].up = 'c';
  assert.equal(cur().up, 'c', 'the operator can choose who is up');
  delete su.ath.events[0].up;
  for (const id of ['a', 'b', 'c']) { at('lj', id, '-'); at('lj', id, id === 'b' ? '6.90' : 'X'); }
  const lj = cur();
  assert.equal(lj.complete, true);
  assert.deepEqual(lj.results.map((r) => [r.name, r.rank, r.result]), [['Cat', 1, '7.30'], ['Ann', 2, '7.10'], ['Bea', 3, '6.90']]);
  // high jump: three failures in a row and out; ties broken by failures
  su.ath.current = 'hj';
  at('hj', 'x', '1.70 O'); at('hj', 'y', '1.70 X');
  assert.equal(cur().up, 'y', 'Yas has tries left at 1.70; Xia cleared');
  at('hj', 'y', '1.70 O');
  assert.equal(cur().up, '', 'everyone cleared: raise the bar');
  su.ath.events[1].bar = '1.75';
  assert.equal(cur().up, 'x');
  at('hj', 'x', '1.75 X'); at('hj', 'y', '1.75 X'); at('hj', 'x', '1.75 X'); at('hj', 'y', '1.75 X'); at('hj', 'x', '1.75 X'); at('hj', 'y', '1.75 X');
  const hj = cur();
  assert.equal(hj.complete, true);
  assert.deepEqual(hj.results.map((r) => [r.name, r.rank, r.result]), [['Xia', 1, '1.70'], ['Yas', 2, '1.70']], 'Xia cleared 1.70 first time');
  const f = Sports.compute(su, ev).flat;
  assert.equal(f.ath_up_name, '');
});

test('athletics control: automatic next event, lane lower thirds, the field athlete who is up', async (t) => {
  const app = await boot({});
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  await c.put(`/api/docs/fixture/fixture_ath?team=${team}`, { data: { sport: 'Athletics', name: 'Spring meet', startDate: '2026-10-10' } });
  const ctl = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_ath', role: 'control' });
  t.after(() => ctl.close());
  await ctl.send('rfp', 'onAir', { fixtureId: 'fixture_ath' });
  const sc = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_ath', role: 'sport' });
  t.after(() => sc.close());
  await until(() => sc.state && sc.state.sport && sc.state.sport.setup && sc.state.sport.setup.sport === 'athletics', 3000, 'setup');
  const setup = JSON.parse(JSON.stringify(sc.state.sport.setup));
  setup.ath.events = [
    { id: 'm100', name: '100m Men', kind: 'track', discipline: '100m', entries: [{ id: 'r1', name: 'Run One', lane: '4', team: 'Tuks', pb: '10.40' }, { id: 'r2', name: 'Run Two', lane: '5', team: 'Maties' }] },
    { id: 'lj', name: 'Long Jump Women', kind: 'field', discipline: 'Long Jump', rounds: 3, entries: [{ id: 'j1', name: 'Jump One', lane: '1', team: 'UCT' }, { id: 'j2', name: 'Jump Two', lane: '2', team: 'UJ' }] },
  ];
  setup.ath.current = 'm100';
  await sc.send('sport', 'apply', { version: sc.state.sport.version, setup, events: [] });
  await until(() => sc.state.sport.setup.ath.events.length === 2, 2000, 'events');

  // a lower third for the athlete in lane 4: name, lane, team, PB
  const lt = app.gfx.buildData('ath_athlete_lt', { playerId: 'r1' }, null, team);
  assert.equal(lt.line1, 'RUN ONE');
  assert.match(lt.line2, /LANE 4.*TUKS.*PB 10\.40/);

  // the next event comes up by itself once the results are in
  const r = await ctl.send('sport', 'athAuto', { mode: 'results', delay: 0 });
  await until(() => sc.state.sport.setup.ath.auto, 2000, 'auto saved ' + JSON.stringify(r));
  assert.deepEqual(sc.state.sport.setup.ath.auto, { mode: 'results', delay: 0 });
  const add = async (ev) => { const events = sc.state.sport.events.concat([ev]); await sc.send('sport', 'apply', { version: sc.state.sport.version, setup: sc.state.sport.setup, events }); };
  await add({ id: 'e1', type: 'result', eventId: 'm100', entry: 'r1', value: '10.31' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sc.state.sport.setup.ath.current, 'm100', 'not yet: one result missing');
  assert.match(app.gfx.buildData('ath_athlete_lt', { playerId: 'r1' }, null, team).line2, /POS 1.*10\.31/, 'the result is in the lower third');
  await add({ id: 'e2', type: 'result', eventId: 'm100', entry: 'r2', value: '10.52' });
  await until(() => sc.state.sport.setup.ath.current === 'lj', 3000, 'auto next event');

  // field: the athlete who is up, and the operator's choice from control
  let v = Sports.compute(sc.state.sport.setup, sc.state.sport.events);
  assert.equal(v.extra.current.up, 'j1');
  await add({ id: 'e3', type: 'attempt', eventId: 'lj', entry: 'j1', value: '6.12' });
  await until(() => Sports.compute(sc.state.sport.setup, sc.state.sport.events).extra.current.up === 'j2', 2000, 'next athlete up');
  const upLt = app.gfx.buildData('ath_up_lt', {}, null, team);
  assert.equal(upLt.line1, 'JUMP TWO');
  assert.match(upLt.line2, /ROUND 1.*ATTEMPT 1/);
  await ctl.send('sport', 'athUp', { entry: 'j1' });
  await until(() => Sports.compute(sc.state.sport.setup, sc.state.sport.events).extra.current.up === 'j1', 2000, 'chosen athlete up');
  // prev / next from control
  await ctl.send('sport', 'athCurrent', { step: -1 });
  await until(() => sc.state.sport.setup.ath.current === 'm100', 2000, 'previous event');
  await ctl.send('sport', 'athCurrent', { eventId: 'lj' });
  await until(() => sc.state.sport.setup.ath.current === 'lj', 2000, 'chosen event');
});
