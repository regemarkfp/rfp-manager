'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until, seed, liveClient, PNG, fakeCaspar, payload } = require('./helpers');

async function world(t, caspar) {
  const app = await boot(caspar ? { caspar: { enabled: true, host: '127.0.0.1', port: caspar.port, channel: 1, previewChannel: 2, clearAfterOutMs: 0 } } : {});
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await seed(c, team);
  const put = (type, id, data) => c.put(`/api/docs/${type}/${id}?team=${team}`, { data });
  for (const k of ['a', 'b']) {
    for (let i = 1; i <= 11; i++) await put('player', `player_${k}${i}x`, { name: k === 'a' ? 'Alpha' : 'Beta', surname: 'Player' + i });
    await put('squad', `squad_cr_${k}`, { club: k === 'a' ? 'club_che' : 'club_bul', sport: 'Cricket', ageGroup: '1st XI', players: Array.from({ length: 11 }, (_, i) => ({ number: String(i + 1), player: `player_${k}${i + 1}x`, position: i === 5 ? 'Wicketkeeper' : '', captain: i === 0 })) });
  }
  await put('fixture', 'fixture_cric', { sport: 'Cricket', team1: 'squad_cr_a', team2: 'squad_cr_b', startDate: '2026-10-11', startTime: '10:00', venue: 'venue_toyota', competition: 'comp_cc' });
  const fixture = async (id) => (await c.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === id).data;
  return { app, c, team, put, fixture };
}

test('cricket scorer: the match is built from the fixture, scored ball by ball and shared with every screen', async (t) => {
  const { app, c, fixture } = await world(t);
  const a = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_cric' });
  const b = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_cric', role: 'commentary' });
  const screen = await liveClient(app, { key: app.config.outputKey, fixture: 'fixture_cric', role: 'commentary' });      // a monitor opened with the key
  t.after(() => { a.close(); b.close(); screen.close(); });
  const m = a.state.match, A = m.teamA.players, B = m.teamB.players;
  assert.deepEqual([a.state.mode, m.teamA.name, m.teamA.shortName, m.tournament, m.venue, A.length, A[0].id, A[0].captain, A[5].keeper, A[0].tvName], ['cricket', 'Cheetahs', 'CHE', 'Carling Currie Cup 2026', 'Toyota Stadium', 11, 'player_a1x', true, true, 'PLAYER1']);
  assert.equal((await fixture('fixture_cric')).live, undefined);          // nothing is stored until scoring starts
  await assert.rejects(screen.send('score', 'toss', { winner: 'A', decision: 'bat' }), /view-only/);
  await assert.rejects(a.send('score', 'ball', { runs: 1 }), /Start an innings first/);
  await a.send('score', 'toss', { winner: 'A', decision: 'bat' });
  await a.send('score', 'startInnings', { battingTeam: 'A' });
  await a.send('score', 'striker', { id: A[0].id }); await a.send('score', 'nonStriker', { id: A[1].id }); await a.send('score', 'bowler', { id: B[10].id });
  for (const ball of [{ runs: 4, boundary: true }, { runs: 1 }, { runs: 0, extra: 'wd' }, { runs: 0, wicket: { kind: 'bowled' } }]) await a.send('score', 'ball', ball);
  await until(() => b.state.stats.innings[0] && b.state.stats.innings[0].score === '5/1' ? false : b.state.stats.innings[0] && b.state.stats.innings[0].score === '6/1', 3000, 'second screen to see 6/1');
  assert.equal(screen.state.stats.innings[0].thisOver.join(' '), '4 1 wd W');
  assert.equal(b.state.clients.length, 3);
  let f = await fixture('fixture_cric');
  assert.deepEqual([f.status, f.result.text, f.result.period, f.live.kind, f.live.match.innings[0].balls.length], ['Live', '6/1 | -', 'Innings 1 · 0.3 ov', 'cricket', 4]);
  await a.send('score', 'undo');
  assert.equal((await fixture('fixture_cric')).result.text, '6/0 | -');
  // ICC bowling restrictions come back as an error the scorer can override
  await a.send('score', 'ball', { runs: 0 }); for (let i = 0; i < 3; i++) await a.send('score', 'ball', { runs: 0 });
  await assert.rejects(a.send('score', 'bowler', { id: B[10].id }), /two in a row/);
  await a.send('score', 'bowler', { id: B[10].id, force: true });
  // saving the Match Setup form with empty boxes, or starting the scoring again, never loses what the match provides
  await a.send('score', 'setup', { tournament: '', venue: '', city: '', matchNumber: '12' });
  assert.deepEqual([a.state.match.tournament, a.state.match.venue, a.state.match.matchNumber, a.state.match.teamA.name], ['Carling Currie Cup 2026', 'Toyota Stadium', '12', 'Cheetahs']);
  // DLS table is kept per production team; the page reads it back
  const dls = await c.get('/live/api/dls-table?fixture=fixture_cric');
  assert.equal(dls.data.rows.length, 51);
  const exp = await c.get('/live/api/export?fixture=fixture_cric');
  assert.equal(exp.data.teamA.name, 'Cheetahs');
  assert.equal((await client(app.url).get('/live/api/export?fixture=fixture_cric')).status, 401);
  // squads can be pulled in again, and other squads of the sport are offered as presets
  assert.deepEqual(a.got.filter((x) => x.type === 'lists').pop().teams, ['Toyota Cheetahs 1st XI · Cricket', 'Vodacom Bulls 1st XI · Cricket']);
  await a.send('rfp', 'refreshTeams');
  assert.equal(a.state.match.innings[0].balls.length, 7);
  // a restart loads the match back from the fixture
  app.live.sessions.clear();
  const again = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_cric' });
  t.after(() => again.close());
  assert.equal(again.state.stats.innings[0].overs, '1');
});

test('sports scorer: rules run in the browser module, the server checks versions, keeps the clocks and stores the result', async (t) => {
  const { app, c, fixture, put } = await world(t);
  const Sports = require('../shared/sports');
  await put('fixture', 'fixture_sev', { sport: 'Rugby Sevens', team1: 'squad_che', team2: 'squad_bul', totalPeriods: 2, periodLength: 10 });
  const sev = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_sev' });
  assert.deepEqual([sev.state.sport.setup.sport, sev.state.sport.setup.variant, sev.state.sport.setup.options.periodMin, sev.state.sport.clocks.game.limitMs], ['rugby', 'sevens', 10, 600000]);
  sev.close();
  const a = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one' }), b = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one' });
  t.after(() => { a.close(); b.close(); });
  const sp = () => a.state.sport;
  assert.deepEqual([a.state.mode, sp().setup.sport, sp().setup.variant, sp().setup.teams.A.name, sp().setup.teams.A.players[0].id, sp().setup.competition, sp().clocks.game.limitMs], ['sport', 'rugby', 'union', 'Cheetahs', 'player_ruan', 'Carling Currie Cup 2026', 2400000]);
  const apply = (cl, events) => cl.send('sport', 'apply', { version: cl.state.sport.version, setup: cl.state.sport.setup, events });
  const e1 = { id: 'e1', type: 'score', key: 'try', team: 'A', player: 'player_ruan', gt: 60000, ct: "2'" };
  await a.send('sport', 'clock', { name: 'game', action: 'start' });
  await apply(a, [e1]);
  await until(() => b.state.sport.version === 1 && b.state.sport.clocks.game.running);
  // a second scorer working from an old version is told to refresh instead of overwriting
  await assert.rejects(b.send('sport', 'apply', { version: 0, setup: b.state.sport.setup, events: [] }), /VERSION_CONFLICT/);
  await assert.rejects(apply(a, [{ id: 'x', type: 'score', key: 'try', team: 'A' }].concat([null])), /Rules error|Cannot read/);
  await apply(b, [e1, { id: 'e2', type: 'card', key: 'yellow', team: 'B', gt: 120000 }]);
  let f = await fixture('fixture_one');
  assert.deepEqual([f.status, f.result.text, f.result.period, f.live.events.length, f.live.clocks.game.running], ['Live', '5 – 0', 'FIRST HALF', 2, true]);
  assert.equal(Sports.compute(f.live.setup, f.live.events).sinbins[0].untilGt, 120000 + 600000);
  await a.send('sport', 'undo');
  assert.equal((await fixture('fixture_one')).live.events.length, 1);
  await apply(a, [e1, { id: 'e3', type: 'end' }]);
  f = await fixture('fixture_one');
  assert.deepEqual([f.status, f.result.finished, f.result.winner], ['Completed', true, 0]);
  // a sport with no rules engine opens with an empty event so the scorer can choose
  await put('fixture', 'fixture_chess', { sport: 'Chess', name: 'Board 1' });
  const ch = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_chess' });
  t.after(() => ch.close());
  assert.deepEqual([ch.state.mode, ch.state.sport.setup], ['sport', null]);
});

test('graphics control: take, live update, wipes, preview channel, captions, production graphics, outputs', async (t) => {
  const cg = await fakeCaspar(t);
  const { app, c, team, put, fixture } = await world(t, cg);
  const logo = (await c.post(`/api/images?team=${team}&name=Cheetahs.png`, PNG, { 'content-type': 'image/png' })).data.doc;
  await put('club', 'club_che', { name: 'Toyota Cheetahs', graphicName: 'Cheetahs', abbreviation: 'CHE', primaryColor: '#ff8a00', image: logo.id });
  await until(() => app.gfx.amcp.connected && app.gfx.amcp.version, 3000, 'CasparCG connection');
  const ctl = await liveClient(app, { cookie: c.cookie(), role: 'control' });                    // no match in the address: follows the match on air
  assert.equal(ctl.state.rfp.fixtureId, '');
  const out = await liveClient(app, { key: app.config.outputKey, role: 'output' });
  // the first match a scorer opens becomes this PC's live production
  const sc = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_cric', role: 'stats' });
  t.after(() => { ctl.close(); out.close(); sc.close(); });
  await until(() => ctl.state.rfp.fixtureId === 'fixture_cric', 3000, 'scorer to put its match on air');
  assert.ok(ctl.catalog.length >= 60);
  assert.equal(ctl.catalog.find((g) => g.id === 'scorebug').template, 'rfp/scorebug');
  await ctl.send('rfp', 'onAir', { fixtureId: 'fixture_cric' });
  await until(() => ctl.state.rfp.fixtureId === 'fixture_cric' && ctl.state.match.teamA.name === 'Cheetahs', 3000, 'control to follow the match on air');
  const A = sc.state.match.teamA.players, B = sc.state.match.teamB.players;
  await sc.send('score', 'startInnings', { battingTeam: 'A' });
  await sc.send('score', 'striker', { id: A[0].id }); await sc.send('score', 'nonStriker', { id: A[1].id }); await sc.send('score', 'bowler', { id: B[10].id });
  await ctl.send('gfx', 'show', { id: 'scorebug', params: {} });
  const add = await until(() => cg.got.find((l) => l.startsWith('CG 1-20 ADD 1 "rfp/scorebug" 1 ')));
  let d = payload(add);
  assert.deepEqual([d.layout, d.bat_short, d.score, d.overs, d.striker_name, d.bowler_name, d.tournament, d.powerplay], ['bug', 'CHE', '0/0', '0', 'PLAYER1', '', 'Carling Currie Cup 2026', 'P']);
  assert.match(d.bat_logo, /^file:\/\/\/.*cheetahs_\w{8}\.png$/);                    // CasparCG reads the logo from this machine's image folder
  const mirrored = await until(() => out.got.find((m) => m.type === 'output' && m.action === 'add' && m.layer === 20));
  assert.equal(JSON.parse(mirrored.data).bat_logo, '/media/' + logo.id);
  // the bug follows the scorer; a six fires its wipe when auto wipes are on
  await ctl.send('gfx', 'autoWipes', { enabled: true });
  await sc.send('score', 'ball', { runs: 6, boundary: true });
  const upd = await until(() => cg.got.find((l) => l.startsWith('CG 1-20 UPDATE 1 ') && payload(l).score === '6/0'));
  assert.deepEqual([payload(upd).striker_runs, payload(upd).ball1, payload(upd).crr], ['6', '6', '36.00']);
  assert.equal(payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-60 ADD 1 "rfp/wipe"')))).type, 'SIX');
  assert.deepEqual(ctl.state.gfx.onAir.map((e) => e.graphicId), ['scorebug', 'wipe_six']);
  // preview channel, params, operator overrides, strip text
  await ctl.send('gfx', 'show', { id: 'batter_lt', params: { playerId: A[0].id }, overrides: { line2: 'FIFTY!' }, preview: true });
  d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 2-30 ADD 1 "rfp/lowerthird"'))));
  assert.deepEqual([d.line1, d.line2, d.player_runs], ['PLAYER1', 'FIFTY!', '6']);
  const dataMsg = await ctl.send('gfx', 'data', { id: 'batting_card', params: {} });
  assert.deepEqual([dataMsg.data.b1_name, dataMsg.data.b1_runs, dataMsg.data.rows], ['PLAYER1', '6', '2']);
  await ctl.send('gfx', 'strip', { text: 'LIVE FROM BLOEMFONTEIN' });
  await until(() => cg.got.some((l) => l.startsWith('CG 1-20 UPDATE 1 ') && payload(l).strip_text === 'LIVE FROM BLOEMFONTEIN'));
  await ctl.send('gfx', 'hide', { id: 'scorebug' });
  await until(() => cg.got.includes('CG 1-20 STOP 1'));
  await ctl.send('gfx', 'invoke', { key: '2-30', method: 'next' });
  await until(() => cg.got.includes('CG 2-30 NEXT 1'));
  // captions are saved with the production team
  await ctl.send('gfx', 'captions', { list: [{ line1: 'Pastor John Smith', line2: 'Grace Church' }] });
  await until(() => ctl.state.captions.length === 1);
  await ctl.send('gfx', 'show', { id: 'custom_lt', overrides: { line1: 'He said "welcome"', line2: 'line two' } });
  assert.equal(payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-30 ADD 1 "rfp/lowerthird"')))).line1, 'He said "welcome"');
  // text of several lines: typed with line breaks, or {nl} in a button's values
  await ctl.send('gfx', 'update', { id: 'custom_lt', overrides: { line1: 'He said "welcome"', line2: 'FIRST LINE\nSECOND LINE' } });
  const ml = await until(() => cg.got.find((l) => l.startsWith('CG 1-30 UPDATE 1 ') && /SECOND LINE/.test(l)));
  assert.ok(!/[\r\n]/.test(ml), 'one AMCP line'); assert.equal(payload(ml).line2, 'FIRST LINE\nSECOND LINE');
  await ctl.send('gfx', 'run', { actions: [{ do: 'set', target: 'custom_lt', field: 'line2', value: 'ONE{nl}TWO' }] });
  assert.ok(await until(() => cg.got.some((l) => l.startsWith('CG 1-30 UPDATE 1 ') && payload(l).line2 === 'ONE\nTWO')));
  // production graphics: countdown and the competition log
  await ctl.send('gfx', 'show', { id: 'countdown', overrides: { label: 'KICK-OFF IN', time: '23:59' } });
  d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-25 ADD 1 "rfp/countdown"'))));
  assert.ok(d.label === 'KICK-OFF IN' && Number(d.countdown_ms) > 0 && Number(d.countdown_ms) <= 86400000);
  await ctl.send('gfx', 'show', { id: 'standings_fs' });
  assert.deepEqual([payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-40 ADD 1 "rfp/table"')))).title], ['CARLING CURRIE CUP']);
  // XML template data on request
  app.config.caspar.format = 'xml';
  await ctl.send('gfx', 'show', { id: 'custom_fs', overrides: { title: 'John 3:16', subtitle: 'LINE ONE\nLINE TWO' } });
  const xml = await until(() => cg.got.find((l) => l.startsWith('CG 1-40 ADD 1 "rfp/fullframe"') && l.includes('templateData')));
  assert.match(xml, /<componentData id=\\"title\\"><data id=\\"text\\" value=\\"John 3:16\\"\/>/);
  assert.match(xml, /value=\\"LINE ONE&#10;LINE TWO\\"/);                     // a line break survives XML as &#10;
  app.config.caspar.format = 'json';
  // switching the match on air to another sport: the same control screen now gets the sport graphics data
  await ctl.send('rfp', 'onAir', { fixtureId: 'fixture_one' });
  await until(() => ctl.state.mode === 'sport' && ctl.state.sport.setup);
  const rug = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one' });
  t.after(() => rug.close());
  await rug.send('sport', 'clock', { name: 'game', action: 'set', ms: 754000 });
  await ctl.send('gfx', 'show', { id: 'sport_bug' });
  d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-20 ADD 1 "rfp/sport_bug"'))));
  assert.deepEqual([d.teamA_short, d.scoreA, d.clock_text, d.clock_running, d.period, d.sport], ['CHE', '0', '12:34', '', 'FIRST HALF', 'rugby']);
  assert.match(d.teamA_logo, /^file:\/\/\//);
  await rug.send('sport', 'apply', { version: rug.state.sport.version, setup: rug.state.sport.setup, events: [{ id: 'e1', type: 'score', key: 'try', team: 'A', player: 'player_ruan' }], wipe: 'TRY' });
  await until(() => cg.got.some((l) => l.startsWith('CG 1-20 UPDATE 1 ') && payload(l).scoreA === '5'));
  assert.equal(payload(await until(() => cg.got.filter((l) => l.startsWith('CG 1-60 ADD 1 "rfp/wipe"')).find((l) => payload(l).text === 'TRY'))).team_name, 'CHEETAHS');
  await rug.send('sport', 'clock', { name: 'game', action: 'start' });
  await until(() => cg.got.some((l) => l.startsWith('CG 1-20 UPDATE 1 ') && payload(l).clock_running === '1'), 3000, 'clock start to reach the bug');
  // adverts: image through the template, clip through CasparCG, logged for proof of play
  await put('advert', 'advert_img1', { name: 'Acme board', sponsor: 'Acme', kind: 'Image', image: logo.id, layout: 'Lower banner', duration: 1 });
  await put('advert', 'advert_clip', { name: 'Acme TVC', sponsor: 'Acme', kind: 'CasparCG clip', clip: 'ADS/ACME_30', duration: 1 });
  await put('playlist', 'playlist_1', { name: 'Half time', items: [{ advert: 'advert_img1' }, { advert: 'advert_clip' }] });
  await app.gfx.startPlaylist(team, 'playlist_1');
  d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-50 ADD 1 "rfp/advert"'))));
  assert.deepEqual([d.layout, d.sponsor], ['lower', 'Acme']);
  assert.match(d.image, /^file:\/\/\//);
  await until(() => cg.got.includes('PLAY 1-50 "ADS/ACME_30" MIX 12'), 4000, 'clip advert');
  await until(() => cg.got.includes('STOP 1-50'), 4000, 'end of playlist');
  assert.deepEqual((await app.store.list(team, 'adlog'))[0].data.entries.map((e) => e.name), ['Acme board', 'Acme TVC']);
  // a missing template is logged, not fatal
  await ctl.send('caspar', 'raw', { command: 'CG 1-99 ADD 1 "missing/x" 1 ""' });
  await until(() => ctl.got.some((m) => m.type === 'log' && m.entry.error && /404/.test(m.entry.text)));
  await ctl.send('gfx', 'hideAll', { includePreview: true });
  assert.equal(ctl.state.gfx.onAir.length, 0);
  assert.equal((await fixture('fixture_one')).result.text, '5 – 0');
});

test('rundown monitor: follows the match on air, shows timers and can be cued by signed-in crew only', async (t) => {
  const { app, c, team, put, fixture } = await world(t);
  const f = await fixture('fixture_one');
  await put('fixture', 'fixture_one', { ...f, rundown: [{ content: 'Intro sting', startTime: '14:55:00', duration: '00:30', source: 'EVS', audio: 'EVS' }, { content: 'Hello and welcome', description: 'Presenters', duration: '1:00', source: 'CAMS', graphics: 'MATCH IDENT (15")\nWEATHER (10")' }, { content: '1st half', description: 'Kick off', startTime: '15:00', duration: '46:00', color: '#ffff00' }] });
  const anon = client(app.url), key = app.config.outputKey;
  assert.equal((await anon.get('/live/api/rundown')).status, 401);
  assert.equal((await anon.get('/live/api/rundown?key=wrong')).status, 401);
  let r = (await anon.get('/live/api/rundown?key=' + key)).data;
  assert.equal(r.empty, true);                                         // nothing on air yet
  await app.gfx.setFixture('fixture_one');
  r = (await anon.get('/live/api/rundown?key=' + key)).data;
  assert.deepEqual([r.type, r.title, r.rows.length, r.live, r.canCue, r.anchored], ['fixture', 'Cheetahs vs Bulls (19A)', 3, null, false, true]);
  assert.deepEqual(r.header, { event: 'Carling Currie Cup', teams: 'CHEETAHS  vs  BULLS', where: '10 OCTOBER 2026, TOYOTA STADIUM, BLOEMFONTEIN', start: 'KICK OFF - 15:00' });
  assert.deepEqual(r.rows.map((x) => [x.startText, x.seconds, x.color]), [['14:55:00', 30, ''], ['14:55:30', 60, ''], ['15:00:00', 2760, '#ffff00']]);
  assert.equal((await anon.post('/live/api/rundown-cue?key=' + key, { index: 1 })).status, 403);     // a view-only screen cannot run the rundown
  assert.equal((await c.post('/live/api/rundown-cue', { index: 1 })).status, 200);
  r = (await c.get('/live/api/rundown')).data;
  assert.deepEqual([r.live.index, r.canCue, Math.abs(r.live.startedAt - r.now) < 2000], [1, true, true]);
  // a production's own rundown by address
  const prod = (await c.get('/api/docs?team=' + team)).data.docs.find((d) => d.type === 'production');
  await put('production', prod.id, { ...prod.data, txTime: '15:00', rundown: [{ content: 'Doors', duration: '10:00' }] });
  r = (await anon.get(`/live/api/rundown?key=${key}&production=${prod.id}`)).data;
  assert.deepEqual([r.type, r.rows[0].content, r.header.start, r.anchored], ['production', 'Doors', 'KICK OFF - 15:00', false]);
});

test('templates from a folder on the PC: variables are read, loaded as graphics, filled in and played; stat graphics carry badges', async (t) => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const { readFields } = require('../lib/templates');
  // the ways a template can show which fields it has
  const classic = '<html><body><div id="f0"></div><span id="f1"></span><img id="logo"><script>function update(str){var d=JSON.parse(str);document.getElementById("f0").innerHTML=d.f0;document.getElementById("f1").innerHTML=d.f1;x.src=d["sponsor_logo"];}function play(){}function stop(){}</script></body></html>';
  assert.deepEqual(readFields(classic).map((f) => [f.key, f.type]), [['f0', 'text'], ['f1', 'text'], ['sponsor_logo', 'image']]);
  assert.deepEqual(readFields('<meta name="rfp-fields" content="title, who:Speaker name, pic:image"><div>{{subtitle}}</div><script>window.CG_DEMO = { title: \'Hello\', bar_color: \'#ff0000\' };</script>').map((f) => [f.key, f.label, f.type, f.value]),
    [['title', 'Title', 'text', 'Hello'], ['who', 'Speaker name', 'text', ''], ['pic', 'Pic', 'image', ''], ['bar_color', 'Bar color', 'color', '#ff0000'], ['subtitle', 'Subtitle', 'text', '']]);
  assert.ok(readFields(fs.readFileSync(path.join(__dirname, '..', 'templates', 'rfp', 'lowerthird.html'), 'utf8')).some((f) => f.key === 'line1'));

  // a Lottie page: only what an operator can change (renamed text layers, pictures, layers named as colours), each with what the template shows now
  const { readTemplate } = require('../lib/templates');
  const T = (nm, text, fc) => ({ ty: 5, nm, t: { d: { k: [{ s: { t: text, fc: fc || [1, 1, 1] } }] } } });
  const anim = { v: '5.9.0', fr: 25, ip: 0, op: 100, w: 1920, h: 1080, assets: [{ id: 'image_0', u: 'images/', p: 'img_0.png' }, { id: 'comp_0', layers: [T('wind_speed', '30 km/h')] }],
    layers: [T('WEATHER FORECAST', 'WEATHER FORECAST'), T('temperature', '30°', [1, 0.5, 0]), T('#note', 'x'), T('{venue} · {city}', 'A · B'), { ty: 2, nm: 'sponsor_logo', refId: 'image_0' }, { ty: 2, nm: 'img_1.png', refId: 'image_0' },
      { ty: 0, nm: 'pre', refId: 'comp_0' }, { ty: 4, nm: 'bar colour', shapes: [{ ty: 'gr', it: [{ ty: 'fl', c: { k: [0.8, 0, 0, 1] } }] }] }, { ty: 4, nm: 'Shape Layer 1', shapes: [] }] };
  const lot = readTemplate(`<div id="anim"></div><script>var animationData = ${JSON.stringify(anim)};function update(s){var data=JSON.parse(s);go(data.layers, data.render, data.shapes, data.ip, data.op, data.ks);}</script>`, { urlOf: (x) => '/t/' + x });
  assert.equal(lot.lottie, true);
  assert.deepEqual(lot.fields.map((f) => [f.key, f.type, f.sample, f.color || '', f.preview || '']), [['temperature', 'text', '30°', '#ff8000', ''], ['venue', 'text', 'in "{venue} · {city}"', '#ffffff', ''], ['city', 'text', 'in "{venue} · {city}"', '#ffffff', ''],
    ['sponsor_logo', 'image', 'img_0.png', '', '/t/images/img_0.png'], ['wind_speed', 'text', '30 km/h', '#ffffff', ''], ['bar colour', 'color', '#cc0000', '#cc0000', '']]);
  assert.deepEqual(lot.more.map((f) => f.key), ['WEATHER FORECAST', 'img_1.png']);                          // fixed labels and unnamed artwork are offered separately
  assert.deepEqual(readTemplate(`<script>var animationData = ${JSON.stringify({ ...anim, assets: [], layers: [T('SUNNY', 'SUNNY'), T('30 km/h', '30 km/h')] })};</script>`).fields.map((f) => f.key), ['SUNNY', '30 km/h']);   // nothing renamed: every text layer is offered

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-tpl-'));
  fs.mkdirSync(path.join(dir, 'church', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'church', 'welcome.html'), classic);
  fs.writeFileSync(path.join(dir, 'church', 'lib', 'helper.html'), '<html></html>');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const cg = await fakeCaspar(t);
  const { app, c, team, put } = await world(t, cg);
  const badge = (await c.post(`/api/images?team=${team}&name=Badge.png`, PNG, { 'content-type': 'image/png' })).data.doc;
  await put('club', 'club_che', { name: 'Toyota Cheetahs', graphicName: 'Cheetahs', abbreviation: 'CHE', primaryColor: '#ff8a00', image: badge.id });
  assert.equal((await c.put('/api/templates/folder', { folder: path.join(dir, 'missing') })).status, 400);
  const set = await c.put('/api/templates/folder', { folder: dir });
  assert.deepEqual([set.status, set.data.templates.map((x) => [x.path, x.fields])], [200, [['church/welcome', 3]]]);
  assert.equal((await c.get('/api/templates/fields?path=../secret')).status, 400);
  const f = (await c.get('/api/templates/fields?path=church/welcome')).data.fields;
  assert.equal((await fetch(app.url + '/live/templates/church/welcome.html')).status, 200);                 // browser outputs can render it too
  await until(() => app.gfx.amcp.connected && app.gfx.amcp.version, 3000, 'CasparCG connection');
  const ctl = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  t.after(() => ctl.close());
  // loading it makes a graphic in Graphics control straight away
  const r = await put('graphic', 'graphic_welcome', { name: 'Welcome', template: 'church/welcome', kind: 'lt', channel: 0, layer: 36, autoClear: 0,
    fields: f.map((x) => ({ ...x, value: x.key === 'f0' ? '{teamA_name} v {teamB_name}' : x.key === 'f1' ? 'Welcome' : '' })) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = await until(() => ctl.got.filter((m) => m.type === 'catalog').map((m) => m.catalog.find((x) => x.id === 'tpl_graphic_welcome')).filter(Boolean).pop(), 3000, 'the new graphic to reach graphics control');
  assert.deepEqual([g.group, g.template, g.layer, g.inputs, g.live], ['My templates', 'church/welcome', 36, ['f0', 'f1', 'sponsor_logo'], true]);
  await ctl.send('gfx', 'show', { id: 'tpl_graphic_welcome', params: {}, overrides: { f1: 'Good morning' } });
  let d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-36 ADD 1 "church/welcome" 1 '))));
  assert.deepEqual([d.f0, d.f1, 'sponsor_logo' in d], ['CHEETAHS v BULLS', 'Good morning', false]);   // an empty picture is left to the template                 // {tokens} follow the match on air, the operator's edit wins
  // statistics graphics: the chosen stat with both badges, and one player's numbers
  const sc = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one' });
  t.after(() => sc.close());
  const ev = (o, i) => Object.assign({ id: 's' + i, gt: 1000 * i }, o);
  await sc.send('sport', 'apply', { version: sc.state.sport.version, setup: sc.state.sport.setup, events: [{ type: 'stat', key: 'tackle', team: 'A', player: 'player_ruan' }, { type: 'stat', key: 'tackle', team: 'A', player: 'player_ruan' }, { type: 'stat', key: 'tackle_miss', team: 'A' }, { type: 'stat', key: 'carry', team: 'B' }, { type: 'score', key: 'try', team: 'A', player: 'player_ruan' }].map(ev) });
  await ctl.send('gfx', 'show', { id: 'sport_stat_lt', params: { stat: 'TACKLES MADE' } });
  d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-30 ADD 1 "rfp/sport_stat" 1 '))));
  assert.deepEqual([d.layout, d.rows, d.row1_label, d.row1_a, d.row1_b, d.teamA_short, d.teamB_short], ['compare', '1', 'TACKLES MADE', '2/3 (67%)', '0/0', 'CHE', 'BUL']);
  assert.match(d.teamA_logo, /^file:\/\/\/.*\.png$/);
  await ctl.send('gfx', 'show', { id: 'sport_keystats_lt', params: {} });
  d = payload(cg.got.filter((l) => l.startsWith('CG 1-30 ADD 1 "rfp/sport_stat" 1 ')).pop());
  assert.deepEqual([d.rows, d.row1_label, d.row2_label, d.row3_label], ['3', 'TRIES', 'TACKLES MADE', 'CARRIES']);
  await ctl.send('gfx', 'show', { id: 'sport_playerstats_lt', params: { playerId: 'player_ruan' } });
  d = payload(cg.got.filter((l) => l.startsWith('CG 1-30 ADD 1 "rfp/sport_stat" 1 ')).pop());
  assert.deepEqual([d.layout, d.player_name, d.player_number, d.player_team, d.boxes, d.box1_label, d.box1_value, d.box2_label, d.box2_value, d.box3_label, d.box3_value], ['player', 'OSBORNE', '10', 'CHEETAHS', '3', 'POINTS', '5', 'TRY', '1', 'TACKLE MADE', '2']);
  assert.match(d.player_logo, /^file:\/\/\//);
  // live values a template variable can be linked to, with what they hold right now
  const vars = (await c.get('/live/api/variables')).data;
  const val = (k) => (vars.vars.find((v) => v.key === k) || {}).value;
  assert.deepEqual([vars.onAir, vars.mode, val('teamA_name'), val('scoreA'), val('competition'), val('tournament'), val('stat1_label')], [true, 'sport', 'CHEETAHS', '5', 'CARLING CURRIE CUP 2026', 'CARLING CURRIE CUP 2026', 'TRIES']);
  assert.match(val('teamA_logo'), /^\/media\/img_/);
  // a folder used as a theme: its graphics are grouped under it and marked when the match on air uses it; a file named like a
  // built-in template replaces that built-in graphic, everything else still comes from the standard folder
  fs.writeFileSync(path.join(dir, 'church', 'lowerthird.html'), '<html><body><div data-f="line1"></div><script>function update(){}function play(){}</script></body></html>');
  await put('theme', 'theme_church', { name: 'Church look', templateFolder: 'church' });
  await put('graphic', 'graphic_themed', { name: 'Welcome (theme)', template: 'church/welcome', theme: 'theme_church', kind: 'lt', layer: 37, fields: [{ key: 'f0', type: 'text', value: '{teamA_name}' }, { key: 'logo', type: 'image', value: '{teamA_logo}' }] });
  let cat = await until(() => { const m = ctl.got.filter((x) => x.type === 'catalog').pop(); return m && m.catalog.some((x) => x.id === 'tpl_graphic_themed') ? m.catalog : null; }, 3000, 'themed graphic');
  assert.deepEqual([cat.find((x) => x.id === 'tpl_graphic_themed').group, cat.find((x) => x.id === 'tpl_graphic_themed').activeTheme, cat.find((x) => x.id === 'sport_score_lt').template], ['Theme: Church look', false, 'rfp/lowerthird']);
  await put('competition', 'comp_cc', { name: 'Carling Currie Cup', sport: 'Rugby', season: '2026', theme: 'theme_church' });
  cat = await until(() => { const m = ctl.got.filter((x) => x.type === 'catalog').pop(); return m.catalog.find((x) => x.id === 'tpl_graphic_themed').activeTheme ? m.catalog : null; }, 3000, 'theme to become active');
  assert.deepEqual([cat.find((x) => x.id === 'sport_score_lt').template, cat.find((x) => x.id === 'sport_bug').template], ['church/lowerthird', 'rfp/sport_bug']);
  await ctl.send('gfx', 'show', { id: 'tpl_graphic_themed', params: {} });
  d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-37 ADD 1 "church/welcome" 1 '))));
  assert.equal(d.f0, 'CHEETAHS');
  assert.match(d.logo, /^file:\/\/\/.*\.png$/);                                                           // a linked badge reaches CasparCG as the image file
  // ---- a theme's graphic standing in for a built-in one, chosen theme, auto update, card colours, transparency
  const compLogo = (await c.post(`/api/images?team=${team}&name=Comp.png`, PNG, { 'content-type': 'image/png' })).data.doc;
  await put('competition', 'comp_cc', { name: 'Carling Currie Cup', sport: 'Rugby', season: '2026', logo: compLogo.id, primaryColor: '#112233' });      // no theme on the competition any more
  fs.writeFileSync(path.join(dir, 'church', 'CLOCK.html'), '<html><body><div id="_time"></div><script>function update(s){}function play(){}</script></body></html>');
  await put('graphic', 'graphic_clock1', { name: 'CLOCK', template: 'church/CLOCK', theme: 'theme_church', replaces: 'sport_clock', kind: 'bug', channel: 0, layer: 20, transparentAs: '#00000000',
    fields: [{ key: '_t1name', type: 'text', value: '{teamA_name}' }, { key: '_time', type: 'text', value: '{clock_text}' }, { key: '_logo', type: 'image', value: '{tournament_logo}' }, { key: '_card', type: 'color', value: '{card_color}', emptyTransparent: true },
      { key: '_bg', type: 'color', value: 'transparent' }, { key: '_t1color', type: 'color', value: '{teamA_color1}' }] });
  const catNow = async (test, label) => until(() => { const m = ctl.got.filter((x) => x.type === 'catalog').pop(); return m && test(m.catalog) ? m.catalog : null; }, 3000, label);
  cat = await catNow((k) => k.some((x) => x.id === 'tpl_graphic_clock1') && !k.find((x) => x.id === 'tpl_graphic_themed').activeTheme, 'theme to drop off the competition');
  await until(() => ctl.state.rfp.theme.active === null, 3000, 'no theme in use');
  assert.deepEqual([cat.find((x) => x.id === 'sport_clock').template, ctl.state.rfp.theme.active], ['rfp/sport_bug', null]);                            // no theme in use: the built-in clock
  await ctl.send('rfp', 'theme', { theme: 'theme_church' });                                                                                              // choose the theme for this PC
  cat = await catNow((k) => !!k.find((x) => x.id === 'sport_clock').replacedBy, 'the theme to take over the clock');
  await until(() => ctl.state.rfp.theme.active, 3000, 'chosen theme in the state');
  const clk = cat.find((x) => x.id === 'sport_clock');
  assert.deepEqual([clk.template, clk.replacedBy, clk.name, clk.layer, ctl.state.rfp.theme.active.name, ctl.state.rfp.theme.active.source], ['church/CLOCK', 'tpl_graphic_clock1', 'Clock Only', 20, 'Church look', 'chosen']);
  await ctl.send('gfx', 'show', { id: 'sport_clock', params: {} });                                                                                       // the built-in button plays the theme's template
  d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-20 ADD 1 "church/CLOCK" 1 '))));
  assert.deepEqual([d._t1name, d._time, d._card, d._bg, d._t1color], ['CHEETAHS', '00:00', '#00000000', '#00000000', '#ff8a00']);                         // no card yet: transparent
  assert.match(d._logo, /^file:\/\/\/.*\.png$/);                                                                                                       // the tournament logo is a live value too
  // a card gives its colour at once, and the running clock reaches the template without anyone pressing UPDATE
  const n0 = cg.got.length;
  await sc.send('sport', 'apply', { version: sc.state.sport.version, setup: sc.state.sport.setup, events: sc.state.sport.events.concat([{ id: 'yc', type: 'card', key: 'yellow', team: 'B', gt: 9000 }]) });
  d = payload(await until(() => cg.got.slice(n0).find((l) => l.startsWith('CG 1-20 UPDATE 1 '))));
  assert.equal(d._card, '#f4c20d');
  // up to four card slots per team: the sin bin while it runs, sendings-off for good
  await sc.send('sport', 'apply', { version: sc.state.sport.version, setup: sc.state.sport.setup, events: sc.state.sport.events.concat([{ id: 'rc', type: 'card', key: 'red', team: 'B', player: '', gt: 9500 }, { id: 'ya', type: 'card', key: 'yellow', team: 'A', player: 'player_ruan', gt: 9600 }]) });
  const cv = (await c.get('/live/api/variables')).data, cval = (k) => (cv.vars.find((x) => x.key === k) || {}).value;
  assert.deepEqual([cval('teamB_cards'), cval('teamB_card1_color'), cval('teamB_card1_key'), cval('teamB_card2_color'), /^\d\d:\d\d$/.test(cval('teamB_card2_text')), cval('teamB_card1_text'), cval('teamB_card3_color'), cval('teamA_card1_color'), cval('teamA_card1_name'), cval('teamA_card1_number'), cval('teamA_card2_color'), cval('teamA_card4_color')],
    ['2', '#e5484d', 'red', '#f4c20d', true, '', '', '#f4c20d', 'OSBORNE', '10', '', '']);
  await sc.send('sport', 'clock', { name: 'game', action: 'start' });
  d = payload(await until(() => cg.got.slice(n0).filter((l) => l.startsWith('CG 1-20 UPDATE 1 ')).find((l) => /00:0[1-9]/.test(l)), 6000, 'the clock to tick on the template'));
  assert.match(d._time, /^00:0[1-9]$/);
  await sc.send('sport', 'clock', { name: 'game', action: 'stop' });
  const v2 = (await c.get('/live/api/variables?graphic=sport_score_lt')).data;
  const of = (k) => v2.vars.find((x) => x.key === k) || {};
  assert.deepEqual([of('card_color').value, of('card_name').value, of('competition_color1').value, of('line1').group, v2.builtIn.some((g) => g.id === 'sport_clock')], ['#f4c20d', 'YELLOW CARD', '#112233', 'This graphic (Score Lower Third)', true]);
  assert.match(of('tournament_logo').value, /^\/media\/img_/);
  // linked to the cricket bug only: with rugby on air it replaces nothing and takes no cricket data; linked to both bugs it takes over this match's bug
  await put('graphic', 'graphic_clock1', { name: 'CLOCK', template: 'church/CLOCK', theme: 'theme_church', replaces: 'scorebug', kind: 'bug', layer: 20, fields: [{ key: '_t1name', type: 'text', value: '{teamA_name}' }] });
  cat = await catNow((k) => !k.find((x) => x.id === 'sport_clock').replacedBy && !!k.find((x) => x.id === 'scorebug').replacedBy, 'link moved to the cricket bug');
  assert.deepEqual([cat.find((x) => x.id === 'sport_bug').template, cat.find((x) => x.id === 'scorebug').template], ['rfp/sport_bug', 'church/CLOCK']);
  assert.equal(((await c.get('/live/api/variables?graphic=scorebug')).data.vars.find((x) => x.key === 'teamA_name') || {}).value, 'CHEETAHS');
  await put('graphic', 'graphic_clock1', { name: 'CLOCK', template: 'church/CLOCK', theme: 'theme_church', replaces: ['scorebug', 'sport_bug'], kind: 'bug', layer: 20, fields: [{ key: '_t1name', type: 'text', value: '{teamA_name}' }, { key: '_score', type: 'text', value: '{scoreA}-{scoreB}' }] });
  cat = await catNow((k) => !!k.find((x) => x.id === 'sport_bug').replacedBy, 'both bugs linked');
  const n1 = cg.got.length;
  await ctl.send('gfx', 'show', { id: 'sport_bug', params: {} });
  d = payload(await until(() => cg.got.slice(n1).find((l) => l.startsWith('CG 1-20 ADD 1 "church/CLOCK" 1 '))));
  assert.deepEqual([d._t1name, d._score], ['CHEETAHS', '5-0']);
  assert.equal((await c.post('/live/api/theme', { theme: 'theme_church' })).data.active.name, 'Church look');
  await ctl.send('rfp', 'theme', { theme: 'none' });
  cat = await catNow((k) => !k.find((x) => x.id === 'sport_clock').replacedBy, 'standard graphics again');
  assert.equal(cat.find((x) => x.id === 'sport_clock').template, 'rfp/sport_bug');
  // removing the record removes the graphic
  await c.del(`/api/docs/graphic/graphic_welcome?team=${team}`);
  await until(() => !ctl.got.filter((m) => m.type === 'catalog').pop().catalog.some((x) => x.id === 'tpl_graphic_welcome'), 3000, 'the graphic to leave graphics control');
});

test('cricket: starting the scoring again keeps the teams, squads, competition and format of the match', async (t) => {
  const { app, c, team, put } = await world(t);
  await put('fixture', 'fixture_t20', { sport: 'Cricket', format: 'Cricket: One-day (50 overs)', competition: 'comp_cc', team1: 'squad_cr_a', team2: 'squad_cr_b' });
  const a = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_t20' });
  t.after(() => a.close());
  const m = () => a.state.match;
  assert.deepEqual([m().teamA.name, m().teamB.name, m().teamA.players.length, m().tournament, m().oversPerInnings], ['Cheetahs', 'Bulls', 11, 'Carling Currie Cup 2026', 50]);
  await a.send('score', 'toss', { winner: 'A', decision: 'bat' });
  await a.send('score', 'startInnings', { battingTeam: 'A' });
  await a.send('score', 'newMatch', { keepTeams: false });
  assert.deepEqual([m().teamA.name, m().teamB.name, m().teamA.players.length, m().tournament, m().oversPerInnings, m().innings.length], ['Cheetahs', 'Bulls', 11, 'Carling Currie Cup 2026', 50, 0]);
  void team;
});

test('a match changed to another sport after its scorer was saved opens with the teams of the match, not TEAM A v TEAM B', async (t) => {
  const { app, c, team } = await world(t);
  const fx = async () => (await c.get(`/api/docs?team=${team}`)).data.docs.find((d) => d.id === 'fixture_one');
  let l = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'sport' });
  await until(() => l.state && l.state.sport.setup, 3000, 'rugby setup');
  await l.send('sport', 'apply', { version: l.state.sport.version, setup: l.state.sport.setup, events: [] });
  await until(async () => ((await fx()).data.live || {}).kind === 'sport', 3000, 'saved as a sport session');
  const r = await c.put(`/api/docs/fixture/fixture_one?team=${team}`, { data: { ...(await fx()).data, sport: 'Cricket', format: 'Cricket: T20 (20 overs)' } });
  assert.equal(r.status, 200);
  await until(() => l.state.mode === 'cricket' && l.state.match.teamA.name === 'Cheetahs', 4000, 'open scorer switches to cricket with the match teams');
  assert.equal(l.state.match.teamB.name, 'Bulls');
  assert.equal(l.state.match.format, 'T20');
  l.close();
  l = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'stats' });
  await until(() => l.state && l.state.match.teamA.name === 'Cheetahs', 3000, 'reopened scorer');
  assert.equal(l.state.rfp.pullError, '');
  l.close();
});

test('commentators: every sport has them, from the match or typed in the scorer, with a graphic and linkable values', async (t) => {
  const { app, c, team } = await world(t);
  const fx = (await c.get(`/api/docs?team=${team}`)).data.docs.find((d) => d.id === 'fixture_one');
  await c.put(`/api/docs/fixture/fixture_one?team=${team}`, { data: { ...fx.data, commentators: 'First Voice\nSecond Voice', officials: 'Referee: Ref One\nSecond Official\nTMO: Tv Three' } });
  await app.gfx.setFixture('fixture_one');
  const l = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'sport' });
  await until(() => l.state && l.state.sport.setup && (l.state.sport.setup.commentators || []).length === 2, 3000, 'commentators from the match');
  const d = await l.send('gfx', 'data', { id: 'sport_commentators_lt', params: {} });
  const data = d.data || d;
  assert.equal(data.line1, 'COMMENTATORS');
  assert.equal(data.line2, 'FIRST VOICE  &  SECOND VOICE');
  assert.equal(data.commentator2, 'SECOND VOICE');
  assert.deepEqual([data.referee, data.official2_role, data.official2_name, data.official3_role, data.official3_name], ['REF ONE', 'ASSISTANT REFEREE 1', 'SECOND OFFICIAL', 'TMO', 'TV THREE']);
  const ref = await l.send('gfx', 'data', { id: 'sport_referee_lt', params: {} });
  assert.deepEqual([(ref.data || ref).line1, (ref.data || ref).line2], ['REF ONE', 'REFEREE']);
  const vars = (await c.get('/live/api/variables')).data.vars;
  assert.equal(vars.find((v) => v.key === 'commentator1').value, 'FIRST VOICE');
  l.close();
});

test('template triggers: IF a live value THEN show the graphic or set a field; Data fields can be picked from the match', async (t) => {
  const { app, c, team } = await world(t);
  await c.put(`/api/docs/graphic/graphic_trig?team=${team}`, { data: { name: 'Voices', template: 'rfp/lowerthird', kind: 'lt', layer: 36,
    fields: [{ key: '_name', label: 'Name', type: 'text', value: '{commentator1}' }, { key: '_color', label: 'Colour', type: 'color', value: '#111111' }, { key: '_image', label: 'Picture', type: 'image', value: '' }],
    triggers: [{ when: 'commentators_count', op: '>', value: '0', then: 'show', seconds: 0 }, { when: 'commentators_count', op: '>=', value: '2', then: 'set', field: '_color', to: '#ff0000' }, { when: 'nonsense', op: 'bogus', then: 'show' }] } });
  await app.gfx.setFixture('fixture_one');
  const l = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  await until(() => l.state && l.state.sport.setup, 3000, 'session');
  const g = (await c.get('/live/api/catalog')).data.find((x) => x.id === 'tpl_graphic_trig');
  assert.deepEqual([g.rules.length, g.types._color, g.types._image], [2, 'color', 'image']);
  await new Promise((r) => setTimeout(r, 1300));                       // the rules have had their first look: nothing fires for what is already so
  assert.equal(app.gfx.onAirList().some((e) => e.graphicId === 'tpl_graphic_trig'), false);
  const fx = (await c.get(`/api/docs?team=${team}`)).data.docs.find((d) => d.id === 'fixture_one');
  await c.put(`/api/docs/fixture/fixture_one?team=${team}`, { data: { ...fx.data, commentators: 'First Voice\nSecond Voice' } });
  await until(() => app.gfx.onAirList().some((e) => e.graphicId === 'tpl_graphic_trig'), 5000, 'the trigger takes the graphic');
  const d = await l.send('gfx', 'data', { id: 'tpl_graphic_trig', params: {} }), data = d.data || d;
  assert.deepEqual([data._name, data._color], ['FIRST VOICE', '#ff0000']);
  // switched off by the operator: the same change does nothing
  await l.send('gfx', 'hideAll', {});
  await l.send('gfx', 'triggers', { enabled: false });
  assert.equal(l.state.gfx.triggersOn, false);
  const picks = (await c.get('/live/api/picks?fixture=fixture_one')).data;
  assert.ok(picks.names.some((x) => x.name === 'First Voice' && x.group === 'Commentators'));
  assert.ok(picks.names.some((x) => x.group === 'Teams' && x.color));
  assert.ok(picks.colors.length >= 2);
  l.close();
});

test('a picture chosen in Graphics control (or kept in a preset) reaches CasparCG as a file on the PC, not as a browser address', async (t) => {
  const cg = await fakeCaspar(t);
  const { app, c, team } = await world(t, cg);
  const pic = (await c.post(`/api/images?team=${team}&name=Promo.png`, PNG, { 'content-type': 'image/png' })).data.doc;
  await c.put(`/api/docs/graphic/graphic_pic?team=${team}`, { data: { name: 'Promo', template: 'rfp/lowerthird', kind: 'lt', layer: 37, fields: [{ key: '_heading', label: 'Heading', type: 'text', value: 'PROMO' }, { key: '_image', label: 'Picture', type: 'image', value: '' }] } });
  await app.gfx.setFixture('fixture_one');
  const l = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  await until(() => cg.got.some((x) => /^VERSION/.test(x)), 3000, 'caspar connected');
  await l.send('gfx', 'show', { id: 'tpl_graphic_pic', params: {}, overrides: { _image: '/media/' + pic.id } });
  const add = await until(() => cg.got.find((x) => x.startsWith('CG 1-37 ADD')), 3000, 'the graphic is played');
  assert.match(payload(add)._image, /^file:\/\/\/.+promo|^http:\/\/127\.0\.0\.1:\d+\/media\/img_/);
  l.close();
});

test('invoke buttons: set on a template, listed with the graphic, sent to CasparCG as CG INVOKE on its layer', async (t) => {
  const cg = await fakeCaspar(t);
  const { app, c, team } = await world(t, cg);
  await c.put(`/api/docs/graphic/graphic_inv?team=${team}`, { data: { name: 'Pages', template: 'rfp/lowerthird', kind: 'lt', layer: 38, fields: [{ key: 'line1', label: 'Line 1', type: 'text', value: 'A' }],
    invokes: [{ label: 'Page 2', method: 'page(2)' }, { label: '', method: 'highlight' }, { label: 'Nothing', method: '  ' }] } });
  await app.gfx.setFixture('fixture_one');
  const l = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  const g = (await c.get('/live/api/catalog')).data.find((x) => x.id === 'tpl_graphic_inv');
  assert.deepEqual(g.invokes.map((v) => [v.label, v.method, v.actions.length]), [['Page 2', 'page(2)', 1], ['highlight', 'highlight', 1]]);
  await l.send('gfx', 'show', { id: 'tpl_graphic_inv', params: {} });
  await l.send('gfx', 'invoke', { key: '1-38', method: 'page(2)' });
  await until(() => cg.got.some((x) => x === 'CG 1-38 INVOKE 1 "page(2)"'), 3000, 'the invoke reaches CasparCG');
  const f = (await c.get('/api/templates/fields?path=' + encodeURIComponent('rfp/lowerthird'))).data;
  assert.ok(Array.isArray(f.functions));
  l.close();
});

test('a button does several things at once, some after a delay, and a trigger can react to an invoke', async (t) => {
  const cg = await fakeCaspar(t);
  const { app, c, team } = await world(t, cg);
  await c.put(`/api/docs/graphic/graphic_b?team=${team}`, { data: { name: 'Main', template: 'rfp/lowerthird', kind: 'lt', layer: 38, fields: [{ key: 'line1', label: 'Line 1', type: 'text', value: 'A' }],
    triggers: [{ when: 'invoke', op: '=', value: 'page', then: 'update' }],
    invokes: [{ label: 'Go', actions: [{ do: 'invoke', target: '', method: 'page(2)' }, { do: 'show', target: 'tpl_graphic_o' }, { do: 'set', field: 'line1', value: 'B' }, { do: 'amcp', value: 'PLAY {channel}-9 "STING"' }, { do: 'hide', target: 'tpl_graphic_o', delay: 0.6 }, { do: 'bogus' }] }] } });
  await c.put(`/api/docs/graphic/graphic_o?team=${team}`, { data: { name: 'Other', template: 'rfp/lowerthird', kind: 'lt', layer: 39, fields: [{ key: 'line1', label: 'Line 1', type: 'text', value: 'O' }] } });
  await app.gfx.setFixture('fixture_one');
  const l = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  await l.send('gfx', 'show', { id: 'tpl_graphic_b', params: {} });
  const mark = cg.got.length;
  await l.send('gfx', 'button', { graphic: 'tpl_graphic_b', index: 0, key: '1-38' });
  const since = () => cg.got.slice(mark);
  await until(() => since().some((x) => x === 'PLAY 1-9 "STING"'), 3000, 'the AMCP command');
  assert.ok(since().some((x) => x === 'CG 1-38 INVOKE 1 "page(2)"'), 'invoke');
  assert.ok(since().some((x) => x.startsWith('CG 1-39 ADD')), 'the other graphic is taken');
  assert.ok(since().filter((x) => x.startsWith('CG 1-38 UPDATE')).length >= 2, 'the trigger on invoke updates, and the field is set');
  assert.equal(payload(since().filter((x) => x.startsWith('CG 1-38 UPDATE')).pop()).line1, 'B');
  assert.equal(since().some((x) => x.startsWith('CG 1-39 STOP')), false, 'the delayed action has not happened yet');
  await until(() => since().some((x) => x.startsWith('CG 1-39 STOP')), 3000, 'the delayed take-off');
  l.close();
});

test('OUT sends CG STOP and no CLEAR, even with an older config that asked for a clear after 1.5 s', async (t) => {
  const cg = await fakeCaspar(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1, previewChannel: 2, clearAfterStopMs: 200 } });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'T', email: 't@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Acme' })).data.id;
  await seed(c, team);
  await app.gfx.setFixture('fixture_one');
  const l = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  await l.send('gfx', 'show', { id: 'custom_lt', params: {}, overrides: { line1: 'A' } });
  await l.send('gfx', 'hide', { id: 'custom_lt' });
  await until(() => cg.got.some((x) => /^CG 1-\d+ STOP 1$/.test(x)), 3000, 'STOP');
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(cg.got.some((x) => /CLEAR/.test(x)), false, cg.got.filter((x) => /CLEAR/.test(x)).join(' | '));
  l.close();
});

test('an update after an invoke sends the values in the Data panel at the moment the button was pressed', async (t) => {
  const cg = await fakeCaspar(t);
  const { app, c, team } = await world(t, cg);
  await c.put(`/api/docs/graphic/graphic_sw?team=${team}`, { data: { name: 'Swap', template: 'rfp/lowerthird', kind: 'lt', layer: 38, fields: [{ key: 'line1', label: 'Line 1', type: 'text', value: 'A' }],
    invokes: [{ label: 'Change', actions: [{ do: 'invoke', target: '', method: 'UpdateOut' }, { do: 'update', target: '', delay: 0.3 }, { do: 'invoke', target: '', method: 'UpdateIn', delay: 0.6 }] }] } });
  await app.gfx.setFixture('fixture_one');
  const l = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_one', role: 'control' });
  await l.send('gfx', 'show', { id: 'tpl_graphic_sw', params: {}, overrides: { line1: 'FIRST' } });
  const mark = cg.got.length, since = () => cg.got.slice(mark);
  await l.send('gfx', 'button', { graphic: 'tpl_graphic_sw', index: 0, key: '1-38', fresh: { params: {}, overrides: { line1: 'SECOND' } } });
  await until(() => since().some((x) => x === 'CG 1-38 INVOKE 1 "UpdateIn"'), 3000, 'the last step');
  const order = since().filter((x) => /^CG 1-38 (INVOKE|UPDATE)/.test(x)).map((x) => (x.includes('UPDATE') ? 'UPDATE ' + payload(x).line1 : x.split('"')[1]));
  assert.deepEqual(order, ['UpdateOut', 'UPDATE SECOND', 'UpdateIn']);
  l.close();
});
