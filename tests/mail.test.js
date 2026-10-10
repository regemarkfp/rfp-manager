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

  // booked on a production (the crew member's email is on their crew record)
  await admin.put(`/api/docs/crewMember/cm_crew?team=${team}`, { data: { name: 'Crew', surname: 'A', email: 'crew@example.com' } });
  await admin.put(`/api/docs/crewRole/role_cam?team=${team}`, { data: { name: 'Camera operator' } });
  await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: { name: 'Saturday rugby', date: '2026-10-17', venue: 'venue_toyota', crew: [{ crewMember: 'cm_crew', role: 'role_cam', callTime: '09:00' }] } });
  const booked = (await mails('crew@example.com')).find((m) => /Booked/.test(m.subject));
  assert.ok(booked);
  assert.match(booked.text, /Camera operator · Date: 2026-10-17 · Call \/ TX: 09:00 · Venue: Toyota Stadium/);
  await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: { name: 'Saturday rugby', date: '2026-10-17', notes: 'x', crew: [{ crewMember: 'cm_crew', role: 'role_cam' }] } });
  assert.equal((await mails('crew@example.com')).filter((m) => /Booked/.test(m.subject)).length, 1, 'only when newly booked');

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
