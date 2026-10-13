'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { boot, client, seed } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { smtpSend } = require('../lib/mail');

test('email notifications: added to a team, booked, officiating, expenses, results; and switching them off', async (t) => {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://rfp.example', mail: { provider: 'test', from: 'RFP Manager <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const out = cloud.mail.outbox;
  const mails = async (to) => { await cloud.notify.idle(); return out.filter((m) => m.to.includes(to)); };
  const person = async (email, name) => { const c = client(cloud.url); await c.post('/api/auth/signup', { name, email, password: 'correct horse' }); return c; };
  const admin = await person('admin@example.com', 'Admin A');
  const team = (await admin.post('/api/orgs', { name: 'RegemarkFP' })).data.id;
  const fx = await seed(admin, team);
  assert.equal((await admin.get('/api/config')).data.mail, true);

  // added to the team
  const crew = await person('crew@example.com', 'Crew A');
  const ref = await person('ref@example.com', 'Ref One');
  const coach = await person('coach@example.com', 'Coach C');
  await admin.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Crew' });
  await admin.post('/api/members?team=' + team, { email: 'ref@example.com', role: 'Official', officialName: 'Ref One' });
  await admin.post('/api/members?team=' + team, { email: 'coach@example.com', role: 'Coach', clubs: ['club_che'] });
  const welcome = (await mails('crew@example.com'))[0];
  assert.match(welcome.subject, /added to RegemarkFP/);
  assert.match(welcome.text, /Admin A added you as Crew/);
  assert.match(welcome.html, /https:\/\/rfp\.example\//);
  await admin.post('/api/members?team=' + team, { email: 'crew@example.com', role: 'Scorer' });
  assert.equal((await mails('crew@example.com')).length, 1, 'a role change is not a welcome');

  // a new production: the team hears of it (not whoever added it); hired once confirmed, with the call sheet
  await admin.put(`/api/docs/crewMember/cm_crew?team=${team}`, { data: { name: 'Crew', surname: 'A', email: 'crew@example.com', phone: '000 000 0001' } });
  await admin.put(`/api/docs/crewMember/cm_two?team=${team}`, { data: { name: 'Second Person', email: 'two@example.com' } });
  await admin.put(`/api/docs/crewRole/role_cam?team=${team}`, { data: { name: 'Camera operator' } });
  await admin.put(`/api/docs/crewRole/role_dir?team=${team}`, { data: { name: 'Director' } });
  const prod = { name: 'Saturday rugby', date: '2026-10-17', venue: 'venue_toyota', txTime: '15:00', crewNotes: 'Parking: use gate 4\nBring headphones', hospitals: [{ name: 'Test Hospital', area: 'Centre', phone: '000 111' }],
    crew: [{ crewMember: 'cm_crew', role: 'role_cam', location: 'Venue', callTime: '09:00' }, { crewMember: 'cm_two', role: 'role_dir', location: 'Gallery', callTime: '08:00' }] };
  await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: prod });
  const fresh = (await mails('crew@example.com')).find((m) => /New production/.test(m.subject));
  assert.ok(fresh, JSON.stringify(out.map((m) => m.subject)));
  assert.match(fresh.subject, /New production: Saturday rugby on Sat, 17 Oct 2026/);
  assert.match(fresh.text, /Toyota Stadium/);
  assert.match(fresh.html, /https:\/\/rfp\.example\/app\/#\/calendar/);
  assert.equal((await mails('admin@example.com')).filter((m) => /New production/.test(m.subject)).length, 0, 'not to whoever added it');
  assert.equal((await mails('crew@example.com')).filter((m) => /Hired/.test(m.subject)).length, 0, 'on the call sheet, not confirmed yet');
  prod.crew[0].confirmed = true;
  await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: prod });
  const hired = (await mails('crew@example.com')).find((m) => /Hired/.test(m.subject));
  assert.ok(hired);
  assert.match(hired.subject, /Hired: Saturday rugby on Sat, 17 Oct 2026/);
  assert.match(hired.text, /confirmed as Camera operator/);
  assert.match(hired.text, /REGEMARKFP CALL SHEET/);
  assert.match(hired.text, /Your call time  ·  09:00/);
  assert.match(hired.text, /CREW YOU WILL WORK WITH\n.*Camera operator.*\nDirector  ·  Second Person  ·  Gallery · call 08:00/);
  assert.match(hired.text, /Parking  ·  use gate 4/);
  assert.match(hired.text, /Test Hospital/);
  assert.match(hired.html, /#\/callsheet\/prod_one/);
  assert.equal((await mails('two@example.com')).filter((m) => /Hired/.test(m.subject)).length, 0, 'the other person is not confirmed');
  await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: { ...prod, notes: 'x' } });
  assert.equal((await mails('crew@example.com')).filter((m) => /Hired/.test(m.subject)).length, 1, 'only once');
  assert.equal((await mails('crew@example.com')).filter((m) => /New production/.test(m.subject)).length, 1, 'only when new');
  // switching off new-production emails keeps the others
  assert.equal((await crew.post('/api/me', { emailNoNew: true })).status, 200);
  await admin.put(`/api/docs/production/prod_two?team=${team}`, { data: { name: 'Sunday soccer', date: '2026-10-18', crew: [{ crewMember: 'cm_crew', role: 'role_cam', confirmed: true }] } });
  assert.equal((await mails('crew@example.com')).filter((m) => /New production/.test(m.subject)).length, 1, 'switched off');
  assert.equal((await mails('crew@example.com')).filter((m) => /Hired/.test(m.subject)).length, 2, 'hired still comes');

  // named as an official
  await admin.put(`/api/docs/fixture/fixture_one?team=${team}`, { data: { ...fx.data, officials: 'Referee: Ref One' } });
  const off = (await mails('ref@example.com')).find((m) => /Referee/.test(m.subject));
  assert.ok(off, JSON.stringify(out.map((m) => m.subject)));
  assert.match(off.subject, /Referee: Cheetahs vs Bulls/);

  // expense: producers hear of it; the person who added it hears the decision
  const e = await crew.post('/api/expenses?team=' + team, { id: 'expense_1', data: { production: 'prod_one', description: 'Fuel', amount: 300 } });
  assert.equal(e.status, 200);
  assert.match((await mails('admin@example.com')).find((m) => /approve/.test(m.subject)).text, /Fuel · ZAR 300\.00 · Saturday rugby/);
  await admin.post('/api/expenses?team=' + team, { id: 'expense_1', data: { ...e.data.doc.data, status: 'Approved' } });
  assert.match((await mails('crew@example.com')).find((m) => /approved/.test(m.subject)).text, /Your expense was approved/);

  // result: the coaches of both teams and the producers
  await ref.put(`/api/fixtures/fixture_one/report?team=${team}`, { scoreA: 24, scoreB: 17 });
  assert.match((await mails('coach@example.com')).find((m) => /Result/.test(m.subject)).subject, /24–17/);
  assert.ok((await mails('admin@example.com')).some((m) => /Result/.test(m.subject)));
  assert.ok(!(await mails('ref@example.com')).some((m) => /Result/.test(m.subject)), 'not the official who sent it');

  // switched off
  assert.equal((await crew.post('/api/me', { emailOff: true })).status, 200);
  const n = (await mails('crew@example.com')).length;
  await admin.post('/api/expenses?team=' + team, { id: 'expense_1', data: { ...e.data.doc.data, status: 'Paid back' } });
  assert.equal((await mails('crew@example.com')).length, n);
});

test('SMTP: a message goes through a plain SMTP conversation', async (t) => {
  const got = [];
  const srv = net.createServer((s) => {
    let data = false, msg = '', auth = 0;
    s.write('220 test ESMTP\r\n');
    s.on('data', (d) => {
      for (const line of d.toString().split('\r\n').filter((x, i, a) => i < a.length - 1 || x)) {
        if (data) { if (line === '.') { data = false; got.push(msg); s.write('250 queued\r\n'); } else msg += line + '\n'; continue; }
        got.push(line);
        if (auth === 1) { auth = 2; s.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (auth === 2) { auth = 3; s.write('235 ok\r\n'); continue; }
        if (/^EHLO/.test(line)) s.write('250-test\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') { auth = 1; s.write('334 VXNlcm5hbWU6\r\n'); }
        else if (line === 'DATA') { data = true; s.write('354 go\r\n'); }
        else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
        else s.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  await smtpSend(`smtp://me%40example.com:secret@127.0.0.1:${srv.address().port}`, 'RFP Manager <rfp@example.com>', ['you@example.com'], 'Hello ✓', 'Plain text', '<p>HTML</p>');
  assert.ok(got.includes('MAIL FROM:<rfp@example.com>'));
  assert.ok(got.includes('RCPT TO:<you@example.com>'));
  assert.ok(got.includes(Buffer.from('me@example.com').toString('base64')));
  const body = got.find((x) => x.includes('Subject:'));
  assert.match(body, /Subject: =\?UTF-8\?B\?/);
  assert.match(body, /multipart\/alternative/);
});
