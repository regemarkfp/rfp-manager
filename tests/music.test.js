'use strict';
// Music rights: the track library, clearance, theme music from the competition and production, the use log (CasparCG,
// vMix, stream slates, by hand), the music cue sheet (SAMRO / broadcaster, CSV and PDF), rights reports and the
// post-production report.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');

test('music: clearance, theme music, use log, cue sheets, rights report and the production report', async (t) => {
  const app = await boot({});
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Org' })).data.id;
  const put = async (type, id, data) => { const x = await c.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(x.status, 200, type + ' ' + JSON.stringify(x.data)); return x; };
  await put('track', 'track_theme', { title: 'Example Theme', artist: 'Example Band', composers: 'A Writer (100%)', publisher: 'Example Music Publishing', iswc: 'T-000.000.001-0', isrc: 'ZA-XXX-26-00001', duration: '0:45', cleared: 'Cleared', clearedFor: ['TV broadcast', 'Live stream'], casparClip: 'MUSIC/THEME', usage: 'Theme', vmixInput: 'Theme Bed' });
  await put('track', 'track_bed', { title: 'Example Bed', composers: 'B Writer', publisher: 'Library Co', library: 'Library Co', cleared: 'Pending', duration: '2:00' });
  await put('track', 'track_old', { title: 'Old Licence', composers: 'C Writer', cleared: 'Cleared', validUntil: '2020-01-01' });
  await put('competition', 'competition_1', { name: 'Test Cup', sport: 'Rugby', music: [{ track: 'track_theme', usage: 'Opening titles' }] });
  await put('fixture', 'fixture_1', { sport: 'Rugby', name: 'Alpha v Beta', competition: 'competition_1', startDate: '2026-11-10' });
  await put('production', 'production_1', { name: 'Cup final', date: '2026-11-10', txTime: '15:00', broadcaster: 'Example TV', fixtures: [{ fixture: 'fixture_1' }], music: [{ track: 'track_bed', usage: 'Background' }],
    musicLog: [{ title: 'Stadium anthem', composers: 'D Writer', publisher: 'Pub D', usage: 'Source (live at venue)', at: '14:58', duration: '1:30', source: 'DJ / PA' }],
    incidents: [{ time: '15:20', category: 'Stream', text: 'Stream dropped for a minute' }], reportNotes: 'A good day.' });

  // clearance
  const m = app.music;
  assert.equal(m.clearance({ title: 'x', cleared: 'Cleared' }).ok, true);
  assert.match(m.clearance({ title: 'x', cleared: 'Pending' }).why, /not cleared/);
  assert.match(m.clearance({ title: 'x', cleared: 'Cleared', validUntil: '2020-01-01' }).why, /ended/);
  assert.match(m.clearance({ title: 'x', cleared: 'Cleared', clearedFor: ['Radio'] }, ['TV broadcast', 'Live stream']).why, /not cleared for TV broadcast or Live stream/);
  assert.equal(m.clearance({ title: 'x', cleared: 'Cleared', clearedFor: ['Live stream'] }, ['TV broadcast', 'Live stream']).ok, true);

  // theme music for the match: the production's first, then the competition's
  const th = await c.get(`/api/music/theme?team=${team}&fixture=fixture_1`);
  assert.equal(th.status, 200);
  assert.deepEqual(th.data.tracks.map((x) => [x.id, x.usage, x.clearance.ok]), [['track_bed', 'Background', false], ['track_theme', 'Opening titles', true]]);

  // CasparCG: playing logs a use (the PC has no CasparCG in tests: commands fail quietly), pending tracks are refused
  await assert.rejects(app.gfx.playMusic(team, 'track_bed'), /not cleared/);
  await app.gfx.setFixture('fixture_1');
  await app.gfx.playMusic(team, 'track_theme', { usage: 'Opening titles' }).catch(() => {});
  if (app.gfx.musicState()) { assert.equal(app.gfx.musicState().title, 'Example Theme'); await app.gfx.stopMusic(); }
  // vMix: an input titled like a track logs while it runs
  await m.vmixTick({ id: 'vmix', state: { inputs: { 3: { title: 'Theme Bed', state: 'Running' } } } });
  await m.vmixTick({ id: 'vmix', state: { inputs: { 3: { title: 'Theme Bed', state: 'Paused' } } } });
  // by hand (a ref started outside RFP Manager)
  const ref = await m.start(team, { title: 'Walk-on music', composers: 'E Writer', usage: 'Featured', source: 'ATEM', productionId: 'production_1' });
  await m.end(ref);

  const prod = await app.store.get('production_1');
  const uses = await m.usesOf(prod);
  assert.ok(uses.some((u) => u.source === 'vMix' && u.title === 'Example Theme'), 'vMix use logged');
  assert.ok(uses.some((u) => u.source === 'ATEM' && u.title === 'Walk-on music'));
  assert.ok(uses.some((u) => u.manual && u.title === 'Stadium anthem' && u.seconds === 90));

  // the cue sheet: JSON, CSV (SAMRO and broadcaster) and PDF
  const cs = await c.get(`/api/productions/production_1/cuesheet?team=${team}`);
  assert.equal(cs.status, 200);
  assert.equal(cs.data.programme, 'Cup final'); assert.equal(cs.data.broadcaster, 'Example TV');
  const anthem = cs.data.rows.find((r) => r.title === 'Stadium anthem');
  assert.equal(anthem.timeIn, '-2:00', 'timed from the TX time'); assert.equal(anthem.duration, '1:30');
  const csv = await c.get(`/api/productions/production_1/cuesheet.csv?team=${team}&layout=samro`);
  assert.equal(csv.status, 200);
  const text = csv.data.toString('utf8');
  assert.match(text, /^﻿"Programme title","Broadcast date","Broadcaster","Production company","Cue no\."/);
  assert.match(text, /"Stadium anthem","D Writer","Pub D"/);
  const csvB = (await c.get(`/api/productions/production_1/cuesheet.csv?team=${team}&layout=broadcaster`)).data.toString('utf8');
  assert.match(csvB, /"Time of day","Title","Artist"/);
  for (const layout of ['samro', 'broadcaster', 'rights']) {
    const pdf = await c.get(`/api/productions/production_1/cuesheet.pdf?team=${team}&layout=${layout}`);
    assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.ok(pdf.data.toString('latin1').startsWith('%PDF-1.4'));
  }

  // a rights holder's report
  const rr = await c.get(`/api/music/rights-report?team=${team}&who=writer`);
  assert.equal(rr.status, 200);
  assert.ok(rr.data.rows.some((r) => r.title === 'Stadium anthem'));
  assert.ok(rr.data.rows.some((r) => r.title === 'Walk-on music'));
  const onlyD = await c.get(`/api/music/rights-report?team=${team}&who=Pub%20D`);
  assert.deepEqual(onlyD.data.rows.map((r) => r.title), ['Stadium anthem']);
  assert.equal((await c.get(`/api/music/rights-report.csv?team=${team}`)).status, 200);

  // the production report
  const rep = await c.get(`/api/productions/production_1/report?team=${team}`);
  assert.equal(rep.status, 200, JSON.stringify(rep.data));
  assert.equal(rep.data.matches[0].name, 'Alpha v Beta');
  assert.equal(rep.data.incidents[0].category, 'Stream');
  assert.ok(rep.data.music.cues >= 3);
  assert.equal(rep.data.summary, 'A good day.');
  const rpdf = await c.get(`/api/productions/production_1/report.pdf?team=${team}`);
  assert.equal(rpdf.status, 200);
  assert.match(rpdf.headers.get('content-disposition'), /Production report - Cup final - 2026-11-10\.pdf/);
});
