'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { boot, client, seed, liveClient, PNG } = require('./helpers');


test('accounts, roles and records', async (t) => {
  const app = await boot();
  t.after(() => app.stop());
  const admin = client(app.url);

  assert.equal((await admin.get('/api/config')).data.needsSetup, true);
  assert.equal((await admin.get('/api/docs?team=x')).status, 401);
  assert.equal((await admin.post('/api/auth/signup', { email: 'ruan@example.com', password: 'short' })).status, 400);
  assert.equal((await admin.post('/api/auth/signup', { name: 'Ruan', email: 'Ruan@Example.com', password: 'correct horse' })).status, 200);
  // The first account closes the door: nobody else can sign themselves up on this machine.
  assert.equal((await client(app.url).post('/api/auth/signup', { email: 'x@example.com', password: 'correct horse' })).status, 403);
  // State-changing requests without the app's header are refused (cross-site request protection).
  assert.equal((await fetch(app.url + '/api/orgs', { method: 'POST', headers: { cookie: admin.cookie(), 'content-type': 'application/json' }, body: '{"name":"x"}' })).status, 403);

  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const fx = await seed(admin, team);
  assert.equal(fx.data.autoName, 'Cheetahs vs Bulls (19A)');

  let docs = (await admin.get('/api/docs?team=' + team)).data.docs;
  const prod = docs.find((d) => d.type === 'production');
  assert.equal(prod.data.name, 'Toyota Stadium – 2026-10-10');       // a production per venue per match day
  assert.deepEqual(prod.data.fixtures, [{ fixture: 'fixture_one' }]);
  await admin.put(`/api/docs/fixture/fixture_two?team=${team}`, { data: { sport: 'Rugby', team1: 'squad_bul', team2: 'squad_che', startDate: '2026-10-10', startTime: '17:00', venue: 'venue_toyota' } });
  docs = (await admin.get('/api/docs?team=' + team)).data.docs;
  assert.equal(docs.filter((d) => d.type === 'production').length, 1);
  assert.equal(docs.find((d) => d.type === 'production').data.fixtures.length, 2);

  await admin.put(`/api/docs/crewMember/crew_one1?team=${team}`, { data: { name: 'Sam', idNumber: '0000000000000' } });
  assert.equal((await admin.put(`/api/docs/venue/venue_bad1?team=${team}`, { data: { city: 'Nowhere' } })).status, 400);       // name is required

  // Members: a scorer can score but not edit; crew cannot see ID numbers.
  for (const [email, role] of [['scorer@example.com', 'Scorer'], ['crew@example.com', 'Crew']]) {
    assert.equal((await admin.post('/api/members?team=' + team, { email, role, name: role, password: 'password ' + role })).status, 200);
  }
  const scorer = client(app.url), crew = client(app.url);
  assert.equal((await scorer.post('/api/auth/login', { email: 'scorer@example.com', password: 'wrong' })).status, 401);
  assert.equal((await scorer.post('/api/auth/login', { email: 'scorer@example.com', password: 'password Scorer' })).status, 200);
  assert.equal((await crew.post('/api/auth/login', { email: 'crew@example.com', password: 'password Crew' })).status, 200);
  assert.equal((await scorer.put(`/api/docs/venue/venue_toyota?team=${team}`, { data: { name: 'Hacked' } })).status, 403);
  const crewDocs = (await crew.get('/api/docs?team=' + team)).data.docs;
  assert.equal(crewDocs.find((d) => d.id === 'crew_one1').data.idNumber, undefined);
  assert.equal((await admin.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'crew_one1').data.idNumber, '0000000000000');
  // Scoring needs the Scorer role; editing the match details afterwards never wipes the live score.
  const cs = await liveClient(app, { cookie: scorer.cookie(), fixture: 'fixture_one', role: 'stats' }), cc = await liveClient(app, { cookie: crew.cookie(), fixture: 'fixture_one' });
  t.after(() => { cs.close(); cc.close(); });
  const tryEv = { version: cs.state.sport.version, setup: cs.state.sport.setup, events: [{ id: 'e1', type: 'score', key: 'try', team: 'A', player: 'player_ruan' }] };
  await assert.rejects(cc.send('sport', 'apply', tryEv), /Scorer role/);
  await cs.send('sport', 'apply', tryEv);
  let live = (await admin.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'fixture_one').data;
  assert.deepEqual([live.status, live.result.text, live.live.setup.teams.A.players[0].name], ['Live', '5 – 0', 'Ruan Osborne']);
  await admin.put(`/api/docs/fixture/fixture_one?team=${team}`, { data: { ...fx.data, notes: 'Wet weather', live: null, result: null } });
  live = (await admin.get('/api/docs?team=' + team)).data.docs.find((d) => d.id === 'fixture_one').data;
  assert.deepEqual([live.notes, live.live.events.length, live.result.text], ['Wet weather', 1, '5 – 0']);
  // Someone outside the team sees nothing.
  assert.equal((await admin.post('/api/members?team=' + team, { email: 'out@example.com', role: 'Crew', password: 'password out' })).status, 200);
  const outMember = (await admin.get('/api/docs?team=' + team)).data.docs.find((d) => d.type === 'member' && d.data.email === 'out@example.com');
  assert.equal((await admin.del(`/api/members/${outMember.id}?team=${team}`)).status, 200);
  const out = client(app.url);
  await out.post('/api/auth/login', { email: 'out@example.com', password: 'password out' });
  assert.equal((await out.get('/api/docs?team=' + team)).status, 403);
  // The last Admin cannot be demoted.
  assert.equal((await admin.post('/api/members?team=' + team, { email: 'ruan@example.com', role: 'Crew' })).status, 400);
});

test('images are saved into this machine\'s image folder, and the folder can be moved', async (t) => {
  const app = await boot();
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const up = await c.post(`/api/images?team=${team}&name=${encodeURIComponent('Cheetahs Logo.png')}`, PNG, { 'content-type': 'image/png' });
  assert.equal(up.status, 200);
  const file = up.data.doc.data.file;
  assert.match(file, /^cheetahs-logo_\w{8}\.png$/);
  assert.ok(fs.existsSync(path.join(app.mediaFolder(), file)));
  const media = await c.get('/media/' + up.data.doc.id);
  assert.equal(media.headers.get('content-type'), 'image/png');
  assert.ok(media.data.equals(PNG));
  assert.equal((await c.post(`/api/images?team=${team}&name=evil.html`, '<script>1</script>', { 'content-type': 'text/html' })).status, 415);
  // Download by URL (served here by a throwaway web server).
  const web = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); });
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  t.after(() => web.close());
  const byUrl = await c.post('/api/images/url', { team, url: `http://127.0.0.1:${web.address().port}/sponsors/acme.png`, name: 'Acme' });
  assert.equal(byUrl.status, 200, JSON.stringify(byUrl.data));
  assert.equal(fs.readdirSync(app.mediaFolder()).length, 2);
  // Move the per-machine folder: existing images follow.
  const next = path.join(app.tmpDir, 'CasparCG', 'media', 'rfp');
  const moved = await c.put('/api/machine', { mediaFolder: next });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.mediaFolder, next);
  assert.equal(fs.readdirSync(next).length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.tmpDir, 'config.json'), 'utf8')).mediaFolder, next);
});

test('Google sign-in is checked against Google\'s keys', async (t) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const certs = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise((r) => certs.listen(0, '127.0.0.1', r));
  t.after(() => certs.close());
  const app = await boot({ mode: 'cloud', google: { clientId: 'my-client-id', certsUrl: `http://127.0.0.1:${certs.address().port}/` } });
  t.after(() => app.stop());
  const token = (claims, key = privateKey) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + enc({ iss: 'https://accounts.google.com', aud: 'my-client-id', exp: Math.floor(Date.now() / 1000) + 600, email: 'Ruan@Example.com', email_verified: true, name: 'Ruan Osborne', sub: '123', ...claims });
    return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url');
  };
  const c = client(app.url);
  assert.equal((await c.post('/api/auth/google', { credential: token({ aud: 'someone-else' }) })).status, 401);
  assert.equal((await c.post('/api/auth/google', { credential: token({ exp: 1 }) })).status, 401);
  assert.equal((await c.post('/api/auth/google', { credential: token({}, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey) })).status, 401);
  assert.equal((await c.post('/api/auth/google', { credential: token({ email_verified: false }) })).status, 401);
  const ok = await c.post('/api/auth/google', { credential: token({}) });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.user.email, 'ruan@example.com');
  assert.match(c.cookie(), /^rfp_sid=/);
  const me = await c.get('/api/me');
  assert.equal(me.data.user.name, 'Ruan Osborne');
  assert.deepEqual(me.data.teams, []);
  // Online there are no password sign-ups and no admin-set passwords.
  assert.equal((await client(app.url).post('/api/auth/signup', { email: 'x@example.com', password: 'correct horse' })).status, 403);
  const team = (await c.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  assert.equal((await c.post('/api/members?team=' + team, { email: 'x@example.com', role: 'Crew', password: 'correct horse' })).status, 400);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/me')).status, 401);
});

test('XML save file: export and import round trip', async (t) => {
  const app = await boot();
  t.after(() => app.stop());
  const c = client(app.url);
  await c.post('/api/auth/signup', { name: 'Ruan', email: 'ruan@example.com', password: 'correct horse' });
  const team = (await c.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  await seed(c, team);
  await c.put(`/api/docs/crewRole/role_dir1?team=${team}`, { data: { name: 'Director', maxQuantity: 2, rate: 2000, invoiceRate: 2500 } });
  const xml = (await c.get('/api/export.xml?team=' + team)).data.toString('utf8');
  assert.match(xml, /<competition-name>Carling Currie Cup<\/competition-name>/);
  assert.match(xml, /<team-player number="10" position="Flyhalf" player-id="player_ruan">Ruan Osborne<\/team-player>/);
  assert.match(xml, /<match-team1>Toyota Cheetahs 19A<\/match-team1>/);
  const team2 = (await c.post('/api/orgs', { name: 'Second Team' })).data.id;
  const imp = await c.post('/api/import.xml?team=' + team2, xml, { 'content-type': 'application/xml' });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  assert.deepEqual(imp.data.counts, { competition: 1, player: 1, venue: 1, club: 2, squad: 2, fixture: 1, crewRole: 1, production: 1 });
  // The original hand-written template (unclosed tags, named colours, dd/mm/yyyy dates) also loads.
  const template = `<?xml version="1.0"?><production-Team><account-details><user-production-team><user-production-team-accent-color>#00ff82</user-production-team-accent-color></user-production-team></account-details>
    <assets><players><player><player-id>player####</player-id><player-name>Sam</player-name><player-surname>Example</player-surname><player-sport>Rugby, Cricket, Hockey></player-sport><player-height>186cm</player-height><player-date_of_birth>25/02/2001</player-date_of_birth></player></players>
    <venues><venue><venue-name>Mangaung Oval</venue-name><venue-capacity>18 000</venue-capacity><venue-sport>Cricket</venue-sport></venue></venues>
    <clubs><club><club-name>Toyota Cheetahs</club-name><club-abreviation>CHE</club-abreviation><club-secondary-color>orange</club-secondary-color><teams><team><team-sport>Rugby</team-sport><team-age-group>19A</team-age-group><team-name>Toyota Cheetahs</team-name><team-secondary-color>orange</team-secondary-color></team></teams></club></clubs></assets>
    <results><match><match-id>####</match-id><match-sport>Rugby</match-sport><match-start-date>dd/mm/yyyy</match-start-date><match-status>completed</match-status><match-rundown><rundown-item><match-rundown-content>Intro Sting</match-rundown-content><match-rundown-duration>00:00:30</match-rundown-duration></rundown-item></match-rundown></match></results>
    <productions><production><production-name>Test Production</production-name><production-type>Corporate</production-type><production-date><production-description> </production-description></production></productions>
    <crew><crew-members><crew-member><crew-member-name>Sam</crew-member-name><crew-member-phone-number>+27 00 000 0000</crew-member-phone-number></crew-members><crew-roles><role><role-name>Camera Operator</role-name><role-rate>1500</role-rate></role></crew-roles></crew></production-Team>`;
  const team3 = (await c.post('/api/orgs', { name: 'Third Team' })).data.id;
  const imp3 = await c.post('/api/import.xml?team=' + team3, template, { 'content-type': 'application/xml' });
  assert.equal(imp3.status, 200, JSON.stringify(imp3.data));
  const docs = (await c.get('/api/docs?team=' + team3)).data.docs;
  const one = (type) => docs.find((d) => d.type === type).data;
  assert.deepEqual([one('player').sports, one('player').height, one('player').dateOfBirth], [['Rugby', 'Cricket', 'Hockey'], 186, '2001-02-25']);
  assert.equal(one('venue').capacity, 18000);
  assert.equal(one('club').secondaryColor, '#ffa500');                 // named colours become hex codes
  assert.equal(one('squad').name, undefined);                          // same as the club, so it stays inherited
  assert.equal(one('fixture').rundown[0].content, 'Intro Sting');
  assert.equal(one('fixture').status, 'Completed');
  assert.equal(one('production').type, 'Corporate');
  assert.equal(one('crewMember').phone, '+27 00 000 0000');
  assert.equal(one('crewRole').rate, 1500);
});
