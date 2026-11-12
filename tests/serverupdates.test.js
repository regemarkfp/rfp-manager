'use strict';
// Universe → Updates: check GitHub (a stand-in), what is new from the README, install now / once / on a schedule
// through the root helper (a stand-in that records what it was asked), checking settings and the email.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { boot, client, tmp } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('updates from the Universe page: check, notes, install now, once, schedule, settings', async (t) => {
  const dir = tmp('upd');
  // GitHub stand-in
  let remote = '9.9.9';
  const readme = '# RFP Manager\n\n### 9.9.9\n\n- **Shiny** new thing.\n- Another one.\n\n### 9.9.8\n\n- Older but still new.\n\n### 1.0.0\n\n- Ancient.\n\n## 1. Run it\n';
  const gh = http.createServer((req, res) => {
    if (req.url.startsWith('/package.json')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ version: remote })); }
    if (req.url.startsWith('/README.md')) return res.end(readme);
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  t.after(() => gh.close());
  // root helper stand-in: logs its arguments, answers status like the real one
  const logFile = path.join(dir, 'calls.txt'), ctl = path.join(dir, 'ctl.sh');
  fs.writeFileSync(ctl, `#!/usr/bin/env bash
echo "$*" >> "${logFile}"
case "$1" in
  status) cat <<EOF
installed=yes
enabled=enabled
calendar=Mon..Fri *-*-* 03:15
next=Tue 2026-11-17 03:15:00 SAST
running=inactive
result=success
lastStart=Mon 2026-11-16 03:15:01 SAST
lastEnd=Mon 2026-11-16 03:16:40 SAST
lastCode=0
once=Fri 2030-01-04 02:00:00 SAST
onceActive=active
repo=regemarkfp/rfp-manager
EOF
  ;;
  log) echo "Up to date (1.1.0)" ;;
  schedule) [ "$2" = bad ] && { echo "Days: daily, weekdays or mon … sun" >&2; exit 1; }; echo ok ;;
  *) echo ok ;;
esac
`, { mode: 0o755 });
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', superUsers: ['boss@site.example'], updateSource: `http://127.0.0.1:${gh.address().port}`, updateCtl: ctl, updateTickMs: 100000,
    mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const su = client(app.url);
  assert.equal((await su.get('/api/super/updates')).status, 401, 'superusers only');
  await su.post('/api/super/reset', { email: 'boss@site.example' });
  const token = /\?set=([\w-]+)/.exec(app.mail.outbox.find((m) => m.to.includes('boss@site.example')).text)[1];
  await su.post('/api/super/password', { token, password: 'a long enough secret' });

  // before a check: the server's schedule is read back from the helper
  let u = (await su.get('/api/super/updates')).data;
  assert.equal(u.version, app.version); assert.equal(u.latest, '');
  assert.deepEqual([u.server.ready, u.server.auto, u.server.days, u.server.time, u.server.result], [true, true, 'weekdays', '03:15', 'success']);
  assert.ok(u.server.once > Date.parse('2030-01-01'));
  assert.deepEqual(u.settings, { check: '6h', email: true });

  // check: newer on GitHub, with the README's notes between this version and the newest
  u = (await su.post('/api/super/updates/check', {})).data;
  assert.equal(u.latest, '9.9.9'); assert.equal(u.newer, true); assert.equal(u.error, '');
  assert.deepEqual(u.notes.map((n) => n.version), ['9.9.9', '9.9.8']);
  assert.match(u.notes[0].text, /Shiny/);
  assert.ok(!app.mail.outbox.some((m) => /is available/.test(m.subject)), 'a check by hand sends no email');
  // the automatic check emails the superusers once per version
  await app.store.kvSet('super:updates:last', { ...(await app.store.kvGet('super:updates:last')), checkedAt: 1 });
  await app.serverUpdates.tick();
  await app.store.kvSet('super:updates:last', { ...(await app.store.kvGet('super:updates:last')), checkedAt: 1 });
  await app.serverUpdates.tick();
  assert.equal(app.mail.outbox.filter((m) => /9\.9\.9 is available/.test(m.subject)).length, 1);
  // same version on GitHub: up to date
  remote = app.version;
  u = (await su.post('/api/super/updates/check', {})).data;
  assert.equal(u.newer, false); assert.deepEqual(u.notes, []);

  // install now, reinstall, once, schedule, cancel: the helper is asked exactly that
  assert.deepEqual((await su.post('/api/super/updates/install', {})).data, { started: true });
  await su.post('/api/super/updates/install', { force: true });
  assert.equal((await su.post('/api/super/updates/once', { date: '2020-01-01', time: '02:00' })).status, 400, 'not in the past');
  assert.equal((await su.post('/api/super/updates/once', { date: '2030-01-04', time: '2am' })).status, 400);
  assert.equal((await su.post('/api/super/updates/once', { date: '2030-01-04', time: '02:00' })).status, 200);
  assert.equal((await su.post('/api/super/updates/schedule', { days: 'someday', time: '03:15' })).status, 400);
  assert.equal((await su.post('/api/super/updates/schedule', { days: 'weekdays', time: '03:15' })).status, 200);
  await su.post('/api/super/updates/schedule', { off: true });
  await su.post('/api/super/updates/cancel', {});
  assert.match((await su.get('/api/super/updates/log')).data.log, /Up to date/);
  const calls = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => l && l !== 'status');
  assert.deepEqual(calls, ['now', 'now force', 'once 2030-01-04 02:00', 'schedule weekdays 03:15', 'schedule off', 'cancel', 'log']);

  // checking settings
  assert.equal((await su.put('/api/super/updates/settings', { check: 'weekly' })).status, 400);
  assert.deepEqual((await su.put('/api/super/updates/settings', { check: 'daily', email: false })).data, { check: 'daily', email: false });
});

test('updates: the README notes between two versions', () => {
  const { makeServerUpdates } = require('../lib/serverupdates');
  const u = makeServerUpdates({ config: {}, store: {}, version: '1.0.0' });
  const md = '### 1.2.0\n\n- c\n\n### 1.1.0\n\n- b\n\n### 1.0.0\n\n- a\n\n## Next part\n';
  assert.deepEqual(u.notesBetween(md, '1.0.0', '1.2.0').map((n) => [n.version, n.text]), [['1.2.0', '- c'], ['1.1.0', '- b']]);
  assert.deepEqual(u.notesBetween(md, '1.1.0', '1.1.0'), []);
});
