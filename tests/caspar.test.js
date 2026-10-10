'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { boot, client, until, seed, PNG } = require('./helpers');

// A pretend CasparCG server: records every AMCP command and answers 202 OK.
async function fakeCaspar(t) {
  const got = [];
  const server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        got.push(line);
        if (line === 'VERSION') sock.write('201 VERSION OK\r\n2.4.0 Fake\r\n');
        else if (line.includes('missing/')) sock.write('404 CG ERROR\r\n');
        else sock.write('202 ' + line.split(' ')[0] + ' OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { got, port: server.address().port };
}
const unq = (cmd) => JSON.parse(JSON.parse('"' + cmd.slice(cmd.indexOf(' "{') + 2, -1) + '"'));

test('graphics: take, live update on score, out, adverts and the browser output', async (t) => {
  const cg = await fakeCaspar(t);
  const app = await boot({ caspar: { enabled: true, host: '127.0.0.1', port: cg.port, channel: 1 } });
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await seed(c, team);
  const logo = (await c.post(`/api/images?team=${team}&name=Cheetahs.png`, PNG, { 'content-type': 'image/png' })).data.doc;
  await c.put(`/api/docs/club/club_che?team=${team}`, { data: { name: 'Toyota Cheetahs', graphicName: 'Cheetahs', abbreviation: 'CHE', primaryColor: '#ffffff', image: logo.id } });
  await c.put(`/api/docs/advert/advert_img1?team=${team}`, { data: { name: 'Acme board', sponsor: 'Acme', kind: 'Image', image: logo.id, layout: 'Lower banner', duration: 1 } });
  await c.put(`/api/docs/advert/advert_clip?team=${team}`, { data: { name: 'Acme TVC', sponsor: 'Acme', kind: 'CasparCG clip', clip: 'ADS/ACME_30', duration: 1 } });
  await c.put(`/api/docs/playlist/playlist_1?team=${team}`, { data: { name: 'Half time', items: [{ advert: 'advert_img1' }, { advert: 'advert_clip' }] } });
  await until(() => app.gfx.amcp.connected && app.gfx.amcp.version, 3000, 'CasparCG connection');
  assert.equal(app.gfx.amcp.version, '2.4.0 Fake');

  // A browser output (OBS / vMix browser source) signs in with the machine's output key.
  const out = new WebSocket(app.url.replace('http', 'ws') + '/ws');
  const seen = [];
  out.onmessage = (ev) => seen.push(JSON.parse(ev.data));
  await new Promise((r) => { out.onopen = r; });
  t.after(() => out.close());
  out.send(JSON.stringify({ type: 'output', key: app.config.outputKey }));
  await until(() => seen.some((m) => m.op === 'clear'));

  const user = await app.auth.userByEmail('ruan@example.com');
  assert.throws(() => app.gfx.build('scorebug', team, {}), /Choose a match/);
  await app.gfx.setFixture('fixture_one');
  await app.domain.scoreAction(user, 'fixture_one', 'clockStart');
  await app.gfx.take({ id: 'scorebug', team });
  const add = await until(() => cg.got.find((l) => l.startsWith('CG 1-20 ADD 1 "rfp/bug" 1 ')));
  const data = unq(add);
  assert.deepEqual([data.teamA_name, data.teamA_short, data.teamB_name, data.scoreA, data.scoreB, data.competition, data.clock_running], ['Cheetahs', 'CHE', 'Bulls', '0', '0', 'Carling Currie Cup', '1']);
  assert.match(data.teamA_logo, /^file:\/\/\/.*cheetahs_\w{8}\.png$/);          // CasparCG loads the logo straight from the image folder
  assert.equal((await until(() => seen.find((m) => m.op === 'add' && m.layer === 20))).data.teamA_logo, '/media/' + logo.id);

  // Scoring updates the bug on air without anyone touching the graphics controls.
  await app.domain.scoreAction(user, 'fixture_one', 'score', { side: 0, scoreId: 'try', pid: 'player_ruan', pname: 'Ruan Osborne' });
  const upd = await until(() => cg.got.find((l) => l.startsWith('CG 1-20 UPDATE 1 ')));
  assert.equal(unq(upd).scoreA, '5');
  assert.equal(unq(upd).last_text, 'Try – Ruan Osborne (CHE)');
  await until(() => seen.some((m) => m.op === 'update' && m.layer === 20 && m.data.scoreA === '5'));

  const pv = app.gfx.preview({ id: 'player_lt', team, params: { player: '0:player_ruan' } });
  assert.deepEqual([pv.data.line1, pv.data.line2], ['10  Ruan Osborne', 'Toyota Cheetahs 19A · Flyhalf · Try']);
  const lineup = app.gfx.preview({ id: 'lineup', team, params: { side: 0 } });
  assert.deepEqual([lineup.data.layout, lineup.data.rows, lineup.data.r1_c2], ['table', '1', 'Ruan Osborne (c)']);
  await app.gfx.take({ id: 'name_lt', team, params: { line1: 'Pastor J. Smith', line2: 'He said "welcome"\nto all' } });
  const lt = await until(() => cg.got.find((l) => l.startsWith('CG 1-21 ADD 1 "rfp/lowerthird"')));
  assert.equal(unq(lt).line2, 'He said "welcome"\nto all');                         // quotes and new lines survive AMCP escaping

  await app.gfx.out(20);
  await until(() => cg.got.includes('CG 1-20 STOP 1'));
  assert.deepEqual(app.gfx.state().onAir.map((e) => e.id), ['name_lt']);

  // XML template data, for templates built that way.
  app.config.caspar.format = 'xml';
  await app.gfx.take({ id: 'title_fs', team, params: { title: 'John 3:16', body: 'For God so loved the world' } });
  const xml = await until(() => cg.got.find((l) => l.startsWith('CG 1-22 ADD') && l.includes('templateData')));
  assert.match(xml, /<componentData id=\\"title\\"><data id=\\"text\\" value=\\"John 3:16\\"\/>/);
  app.config.caspar.format = 'json';

  // Advert playlist: image advert through the template, then a CasparCG clip, then off.
  await app.gfx.startPlaylist(team, 'playlist_1');
  const ad = await until(() => cg.got.find((l) => l.startsWith('CG 1-30 ADD 1 "rfp/advert"')));
  assert.deepEqual([unq(ad).layout, unq(ad).sponsor], ['lower', 'Acme']);
  await until(() => cg.got.includes('PLAY 1-30 "ADS/ACME_30" MIX 12'), 3000, 'clip advert');
  await until(() => cg.got.includes('STOP 1-30'), 3000, 'end of playlist');
  assert.equal(app.gfx.state().playlist, null);
  const adlog = (await app.store.list(team, 'adlog'))[0];
  assert.deepEqual(adlog.data.entries.map((e) => e.name), ['Acme board', 'Acme TVC']);

  // A missing template is reported, not fatal; the graphic still shows on browser outputs.
  app.config.caspar.templateFolder = 'missing';
  const warn = [];
  app.gfx.onMessage((m) => { if (m.type === 'gfx-warn') warn.push(m.text); });
  await c.put(`/api/docs/org/${team}?team=${team}`, { data: { name: 'RegemarkFP', templateFolder: 'missing' } });
  await app.gfx.take({ id: 'name_lt', team, params: { line1: 'x' } });
  assert.match(warn[0], /404/);

  await app.gfx.clearAll();
  await until(() => cg.got.includes('CLEAR 1'));
  assert.equal(app.gfx.state().onAir.length, 0);
});
