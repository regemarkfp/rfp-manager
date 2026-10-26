'use strict';
// The score of a match syncs by how far the scoring has got, not by the clock of the machine that saved it last.
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRemote } = require('../lib/sync');

function fakeApp(doc) {
  const db = new Map(doc ? [[doc.id, doc]] : []);
  const dirty = [];
  return { db, dirty, store: { get: async (id) => db.get(id) || null }, put: async (d, o) => { db.set(d.id, d); if (o && o.dirty) dirty.push(d.id); } };
}
const fx = (updatedAt, version, extra) => ({ id: 'fixture_x1', team: 'org_1', type: 'fixture', updatedAt, deleted: false, data: Object.assign({ name: 'Meet', sport: 'Athletics', live: { kind: 'sport', sport: 'athletics', version, setup: { ath: { events: Array.from({ length: version }, (_, i) => ({ id: 'e' + i })) } }, events: [] } }, extra || {}) });

test('a PC with a slow clock still gets its newer score onto the website', async () => {
  const site = fakeApp(fx(2000, 2, { venue: 'v1' }));                 // the website saved the match last (its clock)
  assert.equal(await applyRemote(site, fx(1500, 5)), 'merged');           // the PC's copy: older clock, more scoring
  const d = site.db.get('fixture_x1');
  assert.equal(d.data.live.version, 5);
  assert.equal(d.data.venue, 'v1', 'the rest of the website record stays');
  assert.ok(d.updatedAt > 2000, 'newer, so every PC picks it up');
});

test('the website saving the match never takes back events the PC already scored', async () => {
  const pc = fakeApp(fx(1000, 7));
  assert.equal(await applyRemote(pc, fx(3000, 4, { venue: 'new venue' }), { fromSite: true }), 'merged');
  const d = pc.db.get('fixture_x1');
  assert.equal(d.data.live.version, 7, 'the PC keeps its score');
  assert.equal(d.data.venue, 'new venue', 'and takes the new match details');
  assert.deepEqual(pc.dirty, ['fixture_x1'], 'and sends its score up again');
});

test('same scoring: the newer record wins as before', async () => {
  const site = fakeApp(fx(1000, 3));
  assert.equal(await applyRemote(site, fx(2000, 3, { venue: 'x' })), 'applied');
  assert.equal(await applyRemote(site, fx(500, 3)), 'stale');
});
