'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../shared/worship');
const { read } = require('../lib/bible');
const { boot, client, until, seed, fakeCaspar, payload } = require('./helpers');

// Every lyric and verse in this file is made up for the test.
const SONG = '[Verse 1]\nMorning light on the hill\nEvery field is standing still\n\n[Chorus]\nSing it out, sing it loud\nOne more time for the crowd\nSing it out, sing it clear\nEveryone who gathers here\nLine five\nLine six\n\n[Bridge]\nHold the [G]note a little [D]longer';

test('songs become slides: sections, long sections split, chords removed, copyright line on first and last slide', () => {
  const slides = W.itemSlides({ kind: 'song', song: 's1' }, { song: () => ({ title: 'Morning Light', author: 'A Writer', copyright: '2020 Test Music', ccliNumber: '1234567', lyrics: SONG }), licence: '99999', look: { linesPerSlide: 4 } });
  assert.deepEqual(slides.map((s) => [s.label, s.lines.length]), [['Verse 1', 2], ['Chorus', 3], ['Chorus', 3], ['Bridge', 1]]);
  assert.equal(slides[3].lines[0], 'Hold the note a little longer');
  assert.equal(slides[0].footer, '"Morning Light" – A Writer  ·  © 2020 Test Music  ·  CCLI Licence No. 99999');
  assert.deepEqual([slides[1].footer, slides[3].footer !== ''], ['', true]);
  assert.equal(W.colourOf('Chorus 2'), '#e5484d');
  assert.deepEqual(W.textSlides('# Welcome\nGlad you are here\n\nSecond slide').map((s) => [s.label, s.lines[0]]), [['Welcome', 'Glad you are here'], ['', 'Second slide']]);
});

test('song files: SongSelect text, SongSelect .usr and ChordPro', () => {
  const txt = W.parseSongFile('song.txt', 'Morning Light\n\nVerse 1\nMorning light on the hill\n\nChorus\nSing it out\n\nA Writer | B Writer\nCCLI Song # 1234567\n© 2020 Test Music\nFor use solely with the SongSelect Terms of Use.\nCCLI License # 99999');
  assert.deepEqual([txt.title, txt.author, txt.copyright, txt.ccliNumber], ['Morning Light', 'A Writer, B Writer', '2020 Test Music', '1234567']);
  assert.deepEqual(W.parseLyrics(txt.lyrics).map((s) => s.label), ['Verse 1', 'Chorus']);
  const usr = W.parseSongFile('song.usr', '[File]\nType=SongSelect Import File\nVersion=3.0\n[S A7654321]\nTitle=Evening Song\nAuthor=One | Two\nCopyright=2001 Test Pub\nKeys=G\nFields=Verse 1/tChorus\nWords=line a/nline b/tchorus x/nchorus y');
  assert.deepEqual([usr.title, usr.author, usr.ccliNumber, usr.key], ['Evening Song', 'One, Two', '7654321', 'G']);
  assert.deepEqual(W.parseLyrics(usr.lyrics), [{ label: 'Verse 1', lines: ['line a', 'line b'] }, { label: 'Chorus', lines: ['chorus x', 'chorus y'] }]);
  const cho = W.parseSongFile('song.cho', '{title: Cho Song}\n{artist: Me}\n{ccli: 555}\n{start_of_verse}\n[G]Hello [D]there\n{end_of_verse}\n{soc}\nChorus line\n{eoc}');
  assert.deepEqual([cho.title, cho.author, cho.ccliNumber, W.parseLyrics(cho.lyrics).map((s) => s.label + ':' + s.lines[0]).join('|')], ['Cho Song', 'Me', '555', 'Verse:Hello there|Chorus:Chorus line']);
});

test('Bible references in English and Afrikaans, and the four file formats', () => {
  assert.deepEqual(W.parseRef('John 3:16-18'), { book: 43, parts: [{ c1: 3, v1: 16, c2: 3, v2: 18 }] });
  assert.equal(W.parseRef('Joh 3:16').book, 43);
  assert.equal(W.parseRef('1 Kor 13:4-7,13').parts.length, 2);
  assert.equal(W.parseRef('Openbaring 21:4').book, 66);
  assert.equal(W.parseRef('II Tim 1:7').book, 55);
  assert.deepEqual(W.parseRef('Ps 23').parts[0], { c1: 23, v1: 1, c2: 23, v2: 999 });
  assert.equal(W.parseRef('Hezekiah 1:1'), null);
  assert.equal(W.refLabel(W.parseRef('1 kor 13:4-7,13'), 'af'), '1 Korintiers 13:4-7,13');
  const want = (b) => assert.deepEqual([b.books[0].n, b.books[0].chapters[0][0], b.books[0].chapters[0][1]], [43, 'Test verse one.', 'Test verse two.']);
  want(read(JSON.stringify({ translation: 'T', books: [{ name: 'John', chapters: [{ chapter: 1, verses: [{ verse: 1, text: 'Test verse one.' }, { verse: 2, text: 'Test verse two.' }] }] }] })));
  want(read('<?xml version="1.0"?><XMLBIBLE biblename="T"><BIBLEBOOK bnumber="43" bname="Johannes"><CHAPTER cnumber="1"><VERS vnumber="1">Test verse one.</VERS><VERS vnumber="2">Test <STYLE>verse</STYLE> two.</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>'));
  want(read('<osis><osisText><div type="book" osisID="John"><chapter osisID="John.1"><verse osisID="John.1.1">Test verse one.</verse><verse osisID="John.1.2">Test verse two.<note>n</note></verse></chapter></div></osisText></osis>'));
  want(read('<osis><osisText><div type="book" osisID="John"><chapter sID="John.1"/><verse sID="John.1.1"/>Test verse one.<verse eID="John.1.1"/><verse sID="John.1.2"/>Test verse two.<verse eID="John.1.2"/></div></osisText></osis>'));
  want(read('\\id JHN Test\n\\h Johannes\n\\c 1\n\\p\n\\v 1 Test verse one.\n\\v 2 Test \\add verse\\add* two.\\f + \\fr 1:2 \\ft note\\f*'));
});

test('worship control: slides to the audience and the stream, name super, stage display, CCLI log, your own buttons', async (t) => {
  const cg = await fakeCaspar(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1, previewChannel: 2, clearAfterOutMs: 0 } });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'Test Church' })).data.id;
  const put = async (type, id, data) => { const r = await c.put(`/api/docs/${type}/${id}?team=${team}`, { data }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.doc; };
  const org = (await c.get('/api/docs?team=' + team)).data.docs.find((d) => d.type === 'org');
  await put('org', team, { ...org.data, worship: { ccliLicence: '99999', look: { linesPerSlide: 4, lowerLines: 2 } } });
  await put('song', 'song_light', { title: 'Morning Light', author: 'A Writer', copyright: '2020 Test Music', ccliNumber: '1234567', lyrics: SONG });
  // a Bible imported on this machine, then a passage from it
  const imp = await c.post('/worship/api/bibles/import?name=Test%20Bible', Buffer.from(JSON.stringify({ books: [{ name: 'John', chapters: [{ chapter: 3, verses: [{ verse: 16, text: 'Made-up verse sixteen.' }, { verse: 17, text: 'Made-up verse seventeen.' }] }] }] })), { 'content-type': 'application/octet-stream' });
  assert.deepEqual([imp.status, imp.data.id, imp.data.verses], [200, 'test-bible', 2]);
  assert.ok(fs.existsSync(path.join(app.dataDir(), 'bibles', 'test-bible.json')));
  const pas = (await c.get('/worship/api/passage?bible=test-bible&ref=Joh%203:16-17&max=30')).data;
  assert.deepEqual([pas.ref, pas.verses.length, pas.text], ['John 3:16-17', 2, '# John 3:16\n16 Made-up verse sixteen.\n\n# John 3:17\n17 Made-up verse seventeen.']);
  assert.equal((await c.get('/worship/api/search?bible=test-bible&q=seventeen')).data.results[0].ref, 'John 3:17');
  await put('service', 'service_sun', { name: 'Sunday', date: '2026-10-11', items: [{ id: 'it1', kind: 'header', title: 'Worship' }, { id: 'it2', kind: 'song', song: 'song_light' }, { id: 'it3', kind: 'scripture', ref: pas.ref, bibleName: 'Test Bible', text: pas.text }] });
  await until(() => app.gfx.amcp.connected && app.gfx.amcp.version, 3000, 'CasparCG connection');
  const act = async (b) => { const r = await c.post('/worship/api/act', b); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  // turn on the stream lower third as a second output on its own channel
  const set = await c.post('/worship/api/settings', { outputs: [{ id: 'audience', name: 'Audience', enabled: true, channel: 0, layer: 60, template: 'worship', layout: 'full' }, { id: 'stream', name: 'Stream', enabled: true, channel: 3, layer: 61, template: 'mychurch/lower', layout: 'lower' }],
    macros: [{ id: 'sting', name: 'Sting', commands: 'PLAY 1-10 "STING" MIX 10\nCG 1-25 ADD 1 "mychurch/welcome" 1 "{}"' }] });
  assert.equal(set.status, 200, JSON.stringify(set.data));

  let s = await act({ action: 'go', service: 'service_sun', item: 'it2', index: 1 });
  assert.deepEqual([s.title, s.index, s.count, s.slide.label, s.next.label], ['Morning Light', 1, 4, 'Chorus', 'Chorus']);
  const full = await until(() => cg.got.find((l) => l.startsWith('CG 1-60 ADD 1 "rfp/worship" 1 ')));
  let d = payload(full);
  assert.deepEqual([d.layout, d.text, d.footer, d.lines_count], ['full', 'Sing it out, sing it loud\nOne more time for the crowd\nSing it out, sing it clear', '', '3']);
  d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 3-61 ADD 1 "mychurch/lower" 1 '))));
  assert.deepEqual([d.layout, d.text], ['lower', 'Sing it out, sing it loud\nOne more time for the crowd']);        // two lines for the stream
  // next walks through the song and on into the next item of the service
  s = await act({ action: 'next' }); s = await act({ action: 'next' });
  assert.deepEqual([s.index, s.slide.label, s.slide.footer.includes('CCLI Licence No. 99999')], [3, 'Bridge', true]);
  s = await act({ action: 'next' });
  assert.deepEqual([s.kind, s.title, s.index, s.slide.caption, s.slide.lines[0]], ['scripture', 'John 3:16-17', 0, 'John 3:16', '16 Made-up verse sixteen.']);
  assert.ok(cg.got.some((l) => l.startsWith('CG 1-60 UPDATE 1 ') && l.includes('Made-up verse sixteen')));
  s = await act({ action: 'prev' });
  assert.deepEqual([s.title, s.index], ['Morning Light', 3]);
  // the song was logged once for CCLI reporting, as projected and streamed
  const uses = (await c.get('/api/docs?team=' + team)).data.docs.filter((x) => x.type === 'songuse');
  assert.deepEqual(uses.map((u) => [u.data.title, u.data.ccliNumber, u.data.projected, u.data.streamed, u.data.serviceName]), [['Morning Light', '1234567', true, true, 'Sunday']]);
  // name super on its own layer, blank, logo and clear
  await act({ action: 'lt', line1: 'Sam Example', line2: 'Guest speaker' });
  d = payload(await until(() => cg.got.find((l) => l.startsWith('CG 1-62 ADD 1 "rfp/worship" 1 '))));
  assert.deepEqual([d.layout, d.line1, d.line2], ['name', 'Sam Example', 'Guest speaker']);
  s = await act({ action: 'blank' });
  assert.equal(s.slide, null);
  assert.equal(payload(cg.got.filter((l) => l.startsWith('CG 1-60 UPDATE 1 ')).pop()).layout, 'blank');
  assert.ok(cg.got.includes('CG 3-61 STOP 1'));                                                                   // the stream shows nothing while the room is blank
  s = await act({ action: 'message', text: 'Wrap up' });
  s = await act({ action: 'timer', op: 'start', seconds: 600, label: 'Sermon' });
  assert.deepEqual([s.message, s.timer.running, s.timer.label, Math.round((s.timer.endsAt - s.now) / 1000)], ['Wrap up', true, 'Sermon', 600]);
  await act({ action: 'macro', id: 'sting' });
  assert.ok(cg.got.includes('PLAY 1-10 "STING" MIX 10') && cg.got.includes('CG 1-25 ADD 1 "mychurch/welcome" 1 "{}"'));
  s = await act({ action: 'clear', what: 'all' });
  assert.deepEqual([s.index, s.lt, s.message], [-1, null, '']);
  assert.ok(cg.got.includes('CG 1-60 STOP 1') && cg.got.includes('CG 1-62 STOP 1'));
  // the stage display reads the state with the screen key and cannot control anything
  const anon = client(app.url);
  assert.equal((await anon.get('/worship/api/state')).status, 401);
  assert.equal((await anon.get('/worship/api/state?key=' + app.config.outputKey)).data.team, team);
  assert.equal((await anon.post('/worship/api/act?key=' + app.config.outputKey, { action: 'next' })).status, 403);
});

test('short device links follow the live production', async (t) => {
  const app = await boot({});
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await seed(c, team);
  const to = async (p, headers) => (await fetch(app.url + p, { redirect: 'manual', headers: headers || {} })).headers.get('location');
  const key = app.config.outputKey;
  assert.equal(await to('/confidence'), '/live/comms.html?key=' + key);
  assert.equal(await to('/rundown'), '/live/rundown.html?key=' + key);
  assert.equal(await to('/output'), '/live/output.html?key=' + key);
  assert.equal(await to('/preview'), '/live/preview.html?key=' + key);
  assert.equal(await to('/stage'), '/live/stage.html?key=' + key);
  assert.equal(await to('/graphics-control'), '/live/control.html');          // control and scorer never get the key: they ask for a sign-in
  assert.equal(await to('/worship'), '/live/worship.html');
  assert.equal(await to('/scorer'), '/live/sport.html');
  await c.put(`/api/docs/fixture/fixture_cric?team=${team}`, { data: { sport: 'Cricket', name: 'Test match', startDate: '2026-10-10' } });
  await app.gfx.setFixture('fixture_cric');
  assert.equal(await to('/scorer'), '/live/stats.html');
  await app.gfx.setFixture('fixture_one');
  assert.equal(await to('/Scorer/'), '/live/sport.html');
  // the scorer needs no set-up: format, periods, teams and squads come from the match and its competition
  await c.put(`/api/docs/fixture/fixture_sev?team=${team}`, { data: { sport: 'Rugby', format: 'Rugby: Rugby sevens (2 × 7)', team1: 'squad_che', team2: 'squad_bul' } });
  const Scoring = require('../shared/scoring');
  assert.equal(Scoring.formatFor('Rugby', 'Rugby: Rugby sevens (2 × 7)'), 'sevens');
  assert.equal(Scoring.formatFor('Cricket', 'Cricket: T20 (20 overs)'), 'T20');
  assert.equal(Scoring.formatFor('Rugby', 'Cricket: T20 (20 overs)'), '');
  const { liveClient } = require('./helpers');
  const sc = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_sev' });
  t.after(() => sc.close());
  assert.deepEqual([sc.state.sport.setup.variant, sc.state.sport.setup.teams.A.name, sc.state.sport.setup.teams.A.players.length, sc.state.sport.clocks.game.limitMs], ['sevens', 'Cheetahs', 1, 420000]);
  // a match with only a typed name gives the scorer its team names; squads added after scoring has started still come through
  await c.put(`/api/docs/fixture/fixture_late?team=${team}`, { data: { sport: 'Rugby', name: 'CHEETAHS vs GRIQUAS', competition: 'comp_cc', venue: 'venue_toyota' } });
  const late = await liveClient(app, { cookie: c.cookie(), fixture: 'fixture_late' });
  t.after(() => late.close());
  const su = () => late.state.sport.setup;
  assert.deepEqual([su().teams.A.name, su().teams.B.name, su().teams.A.short, su().competition, su().venue], ['CHEETAHS', 'GRIQUAS', 'CHE', 'Carling Currie Cup 2026', 'Toyota Stadium, Bloemfontein']);
  await late.send('sport', 'apply', { version: late.state.sport.version, setup: su(), events: [{ id: 'e1', type: 'score', key: 'try', team: 'A', gt: 1000 }] });
  const fx = async () => (await c.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'fixture_late').data;
  await c.put(`/api/docs/fixture/fixture_late?team=${team}`, { data: { ...(await fx()), team1: 'squad_che', team2: 'squad_bul' } });
  await until(() => su().teams.A.name === 'Cheetahs' && su().teams.A.players.length === 1 && su().teams.B.name === 'Bulls', 4000, 'squads to reach the running scorer');
  assert.deepEqual([late.state.sport.events.length, (await fx()).result.text, (await fx()).live.setup.teams.A.players[0].id], [1, '5 – 0', 'player_ruan']);
  await c.put(`/api/docs/club/club_che?team=${team}`, { data: { name: 'Toyota Cheetahs', graphicName: 'Free State Cheetahs', abbreviation: 'FSC', primaryColor: '#ff8800' } });
  await until(() => su().teams.A.name === 'Free State Cheetahs' && su().teams.A.color1 === '#ff8800', 4000, 'a club change to reach the running scorer');
  // the same holds for every sport: names from the match name first, then names, colours, badge and squad once teams are chosen
  const logo = (await c.post(`/api/images?team=${team}&name=Bulls.png`, require('./helpers').PNG, { 'content-type': 'image/png' })).data.doc;
  await c.put(`/api/docs/club/club_bul?team=${team}`, { data: { name: 'Vodacom Bulls', graphicName: 'Bulls', abbreviation: 'BUL', primaryColor: '#0000ff', image: logo.id } });
  const sports = ['Cricket', ...Scoring.sportNames().filter((n) => n !== 'Cricket'), 'Rugby Sevens', 'Soccer'];
  assert.ok(sports.length >= 14);
  for (const [i, sport] of sports.entries()) {
    const id = 'fixture_all' + i;
    await c.put(`/api/docs/fixture/${id}?team=${team}`, { data: { sport, name: 'Lions v Sharks (U19)' } });
    const x = await liveClient(app, { cookie: c.cookie(), fixture: id });
    const cricket = x.state.mode !== 'sport';
    const names = () => (cricket ? [x.state.match.teamA, x.state.match.teamB] : [x.state.sport.setup.teams.A, x.state.sport.setup.teams.B]);
    assert.deepEqual(names().map((n) => n.name), ['Lions', 'Sharks'], sport + ': names from the match name');
    if (cricket) await x.send('score', 'toss', { winner: 'A', decision: 'bat' });
    else await x.send('sport', 'apply', { version: x.state.sport.version, setup: x.state.sport.setup, events: [] });
    const cur = (await c.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === id).data;
    assert.ok(cur.live, sport + ': match stored');
    await c.put(`/api/docs/fixture/${id}?team=${team}`, { data: { ...cur, name: '', team1: 'squad_che', team2: 'squad_bul' } });
    await until(() => names()[0].name === 'Free State Cheetahs' && names()[1].name === 'Bulls' && names()[1].logo === logo.id && names()[0].players.length === 1, 4000, sport + ': teams to reach the scorer after it has started');
    assert.equal(names()[0].players[0].id, 'player_ruan', sport);
    x.close();
  }
  // a match that was stored with placeholder teams (scored before its squads were chosen) is corrected when the scorer next opens it
  late.close();
  const stored = await app.store.get('fixture_late');
  stored.data.live.setup.teams = { A: { name: 'HOME', short: 'HOM', players: [] }, B: { name: 'AWAY', short: 'AWY', players: [] } };
  await app.put({ ...stored, updatedAt: stored.updatedAt + 1 }, { dirty: false });
  const dir = app.dataDir();
  await app.stop();
  const again = await boot({ dataDir: dir });
  t.after(() => again.stop());
  const c2 = client(again.url);
  await c2.post('/api/auth/login', { email: 'ruan@example.com', password: 'correct horse' });
  const re = await liveClient(again, { cookie: c2.cookie(), fixture: 'fixture_late' });
  t.after(() => re.close());
  assert.deepEqual([re.state.sport.setup.teams.A.name, re.state.sport.setup.teams.B.name, re.state.sport.setup.teams.A.players.length, re.state.sport.events.length], ['Free State Cheetahs', 'Bulls', 1, 1]);
});
