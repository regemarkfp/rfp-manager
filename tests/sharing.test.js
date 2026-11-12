'use strict';
// Sharing (sharing.<website>): a production's folder, email invites with a password, uploads in pieces that carry on,
// viewer/editor rights, previews, ZIP downloads, comments and activity, and the page on its own subdomain.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { boot, client, tmp } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('sharing: production folder, invites, resumable uploads, rights, ZIP, comments', async (t) => {
  const nas = tmp('nas');
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', sharingUrl: 'https://sharing.site.example', sharingDir: nas, sharingDigestMs: 50, ffmpeg: '/nonexistent/ffmpeg',
    mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Team' })).data.id;
  const prod = (await admin.put(`/api/docs/production/prod_one?team=${team}`, { data: { name: 'Cup final', date: '2026-11-20' } })).data.doc;

  // the production's folder is made the first time, then the same one comes back
  const s1 = await admin.post(`/api/share/production/${prod.id}?team=${team}`, {});
  assert.equal(s1.status, 200, JSON.stringify(s1.data));
  assert.equal(s1.data.name, 'Cup final · 2026-11-20');
  assert.equal(s1.data.url, 'https://sharing.site.example/f/' + s1.data.id);
  const id = s1.data.id;
  assert.equal((await admin.post(`/api/share/production/${prod.id}?team=${team}`, {})).data.id, id);
  assert.ok(fs.existsSync(path.join(nas, id, 'files')), 'folder on the NAS');
  const mine = await admin.get('/api/share');
  assert.deepEqual(mine.data.shares.map((s) => s.id), [id]); assert.deepEqual(mine.data.canCreate, [team]);

  // invite: an email with a link; the link page names the folder; a password makes the account and signs in
  const inv = await admin.post(`/api/share/${id}/people`, { emails: 'Client@Example.com, editor@example.com', role: 'viewer', note: 'Footage from Saturday' });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  assert.deepEqual(inv.data.added, ['client@example.com', 'editor@example.com']);
  assert.equal(inv.data.mailed, 2);
  const mail = app.mail.outbox.find((m) => m.to.includes('client@example.com'));
  assert.match(mail.subject, /shared “Cup final/);
  const link = (mail.text.match(/https:\/\/sharing\.site\.example\/invite\/[\w-]+/) || [])[0];
  assert.ok(link, mail.text);
  const token = link.split('/').pop();
  const v = await client(app.url).get('/api/sharing/invite/' + token);
  assert.equal(v.data.id, id); assert.equal(v.data.email, 'client@example.com'); assert.equal(v.data.account, null);
  assert.equal((await client(app.url).get('/api/sharing/invite/not-a-real-token-123')).status, 404);
  await admin.put(`/api/share/${id}/people/${encodeURIComponent('editor@example.com')}`, { role: 'editor' });

  const viewer = client(app.url);
  assert.equal((await viewer.post(`/api/sharing/invite/${token}/password`, { name: 'Client', password: 'short' })).status, 400);
  assert.equal((await viewer.post(`/api/sharing/invite/${token}/password`, { name: 'Client', password: 'long enough' })).status, 200);
  assert.equal((await client(app.url).post(`/api/sharing/invite/${token}/password`, { password: 'another one' })).status, 409, 'only once');
  const eTok = inv.data.links.find((l) => l.email === 'editor@example.com').url.split('/').pop();
  const editor = client(app.url);
  await editor.post(`/api/sharing/invite/${eTok}/password`, { name: 'Editor', password: 'long enough' });
  const outsider = client(app.url);
  await outsider.post('/api/auth/signup', { name: 'Someone', email: 'other@example.com', password: 'correct horse' });

  // who sees what
  assert.equal((await viewer.get('/api/share')).data.shares[0].role, 'viewer');
  assert.equal((await outsider.get('/api/share')).data.shares.length, 0);
  assert.equal((await outsider.get(`/api/share/${id}/list`)).status, 403);
  assert.equal((await viewer.get(`/api/share/${id}`)).data.members, undefined, 'only managers see the people');

  // an upload in pieces; the connection drops after the first piece and it carries on from where it was
  const data = Buffer.alloc(300000); for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 251;
  const start = async (c) => (await c.post(`/api/share/${id}/upload`, { dir: 'Day 1', name: 'A001.mp4', size: data.length })).data;
  assert.equal((await viewer.post(`/api/share/${id}/upload`, { dir: '', name: 'x.txt', size: 3 })).status, 403, 'viewers cannot upload');
  let up = await start(editor);
  assert.equal(up.received, 0);
  await editor.put(`/api/share/${id}/upload/${up.upload}?offset=0`, data.subarray(0, 100000), { 'content-type': 'application/octet-stream' });
  up = await start(editor);                                   // "after a refresh": same id, knows what it has
  assert.equal(up.received, 100000);
  const wrong = await editor.put(`/api/share/${id}/upload/${up.upload}?offset=200000`, data.subarray(200000), { 'content-type': 'application/octet-stream' });
  assert.equal(wrong.status, 409); assert.match(wrong.data.error, /Send from byte 100000/);
  assert.equal((await editor.post(`/api/share/${id}/upload/${up.upload}/done`, {})).status, 409, 'not complete yet');
  await editor.put(`/api/share/${id}/upload/${up.upload}?offset=100000`, data.subarray(100000), { 'content-type': 'application/octet-stream' });
  const done = await editor.post(`/api/share/${id}/upload/${up.upload}/done`, {});
  assert.equal(done.status, 200, JSON.stringify(done.data)); assert.equal(done.data.path, 'Day 1/A001.mp4');
  // the same name again: a second copy, not over the first
  const up2 = (await editor.post(`/api/share/${id}/upload`, { dir: 'Day 1', name: 'A001.mp4', size: 4 })).data;
  await editor.put(`/api/share/${id}/upload/${up2.upload}?offset=0`, Buffer.from('abcd'), { 'content-type': 'application/octet-stream' });
  assert.equal((await editor.post(`/api/share/${id}/upload/${up2.upload}/done`, {})).data.path, 'Day 1/A001 (2).mp4');
  const notes = (await editor.post(`/api/share/${id}/upload`, { dir: '', name: 'notes.txt', size: 5 })).data;
  await editor.put(`/api/share/${id}/upload/${notes.upload}?offset=0`, Buffer.from('hello'), { 'content-type': 'application/octet-stream' });
  await editor.post(`/api/share/${id}/upload/${notes.upload}/done`, {});

  // the list: folders first, who added each file
  const root = (await viewer.get(`/api/share/${id}/list`)).data;
  assert.deepEqual(root.items.map((x) => x.name), ['Day 1', 'notes.txt']);
  const day = (await viewer.get(`/api/share/${id}/list?path=${encodeURIComponent('Day 1')}`)).data;
  assert.deepEqual(day.items.map((x) => [x.name, x.size, x.by, x.kind]), [['A001 (2).mp4', 4, 'Editor', 'video'], ['A001.mp4', data.length, 'Editor', 'video']]);
  assert.equal((await viewer.get(`/api/share/${id}/list?path=..%2F..`)).status, 400, 'no way out of the folder');

  // download one file (and a byte range), and a preview of a browser-friendly video
  const f = await viewer.get(`/api/share/${id}/file?path=${encodeURIComponent('Day 1/A001.mp4')}`);
  assert.equal(f.status, 200); assert.ok(Buffer.compare(f.data, data) === 0); assert.match(f.headers.get('content-disposition'), /attachment/);
  const part = await viewer.get(`/api/share/${id}/file?path=${encodeURIComponent('Day 1/A001.mp4')}`, { range: 'bytes=10-19' });
  assert.equal(part.status, 206); assert.ok(Buffer.compare(part.data, data.subarray(10, 20)) === 0);
  assert.deepEqual((await viewer.get(`/api/share/${id}/preview?path=${encodeURIComponent('Day 1/A001.mp4')}&check=1`)).data, { ready: true });

  // ZIP of everything and of a selection: real ZIPs with the files in their folders
  const z = await viewer.get(`/api/share/${id}/zip?p=`);
  assert.equal(z.status, 200); assert.equal(z.headers.get('content-type'), 'application/zip');
  const zf = path.join(tmp('zip'), 'all.zip'); fs.writeFileSync(zf, z.data);
  const names = execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("\\n".join(sorted(z.namelist())))', zf]).toString().trim().split('\n');
  assert.deepEqual(names, ['Day 1/A001 (2).mp4', 'Day 1/A001.mp4', 'notes.txt']);
  const zs = await viewer.get(`/api/share/${id}/zip?p=notes.txt&p=${encodeURIComponent('Day 1/A001 (2).mp4')}`);
  fs.writeFileSync(zf, zs.data);
  assert.equal(execFileSync('python3', ['-c', 'import sys,zipfile; print(len(zipfile.ZipFile(sys.argv[1]).namelist()))', zf]).toString().trim(), '2');

  // viewers cannot change anything; editors rename, move and delete (to the bin)
  assert.equal((await viewer.post(`/api/share/${id}/delete`, { paths: ['notes.txt'] })).status, 403);
  assert.equal((await editor.post(`/api/share/${id}/move`, { from: 'notes.txt', name: 'call notes.txt' })).status, 200);
  assert.equal((await editor.post(`/api/share/${id}/folder`, { path: 'Day 2' })).status, 200);
  assert.equal((await editor.post(`/api/share/${id}/move`, { from: 'Day 1/A001 (2).mp4', to: 'Day 2/B001.mp4' })).status, 200);
  assert.equal((await editor.post(`/api/share/${id}/delete`, { paths: ['call notes.txt'] })).data.deleted, 1);
  assert.deepEqual((await viewer.get(`/api/share/${id}/list`)).data.items.map((x) => x.name), ['Day 1', 'Day 2']);
  assert.ok(fs.readdirSync(path.join(nas, id, '.rfp', 'bin')).length, 'kept in the bin');

  // comments with a timecode; only your own can be removed (or a manager's)
  const cm = await viewer.post(`/api/share/${id}/comments?path=${encodeURIComponent('Day 1/A001.mp4')}`, { text: 'Use this shot', tc: 12.5 });
  assert.equal(cm.status, 200, JSON.stringify(cm.data));
  const cl = (await editor.get(`/api/share/${id}/comments?path=${encodeURIComponent('Day 1/A001.mp4')}`)).data.comments;
  assert.equal(cl.length, 1); assert.equal(cl[0].tc, 12.5); assert.equal(cl[0].canRemove, false);
  assert.equal((await editor.del(`/api/share/${id}/comments/${cl[0].id}`)).status, 403);
  assert.equal((await viewer.get(`/api/share/${id}/list?path=${encodeURIComponent('Day 1')}`)).data.items.find((x) => x.name === 'A001.mp4').comments, 1);

  // activity, and the summary email to the others
  const act = (await viewer.get(`/api/share/${id}/activity`)).data.activity.map((a) => a.what);
  for (const w of ['create', 'invite', 'upload', 'move', 'delete', 'comment']) assert.ok(act.includes(w), w);
  const deadline = Date.now() + 3000;
  while (!app.mail.outbox.some((m) => /new comment|new file/.test(m.subject)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 40));
  assert.ok(app.mail.outbox.some((m) => /new (file|comment)/.test(m.subject)), 'summary email');

  // the folder knows its production's name (shown next to "File Sharing")
  assert.equal((await viewer.get(`/api/share/${id}/list`)).data.share.productionName, 'Cup final · 2026-11-20');
  // Media → File sharing: everyone invited to the team's folders; only Producers and Admins
  const pp = await admin.get('/api/share-people?team=' + team);
  assert.equal(pp.status, 200, JSON.stringify(pp.data));
  assert.deepEqual(pp.data.folders.map((f) => [f.id, f.productionName, f.members]), [[id, 'Cup final · 2026-11-20', 2]]);
  assert.deepEqual(pp.data.people.map((p) => [p.email, p.name, p.accepted, p.folders.map((f) => f.role)]), [['client@example.com', 'Client', true, ['viewer']], ['editor@example.com', 'Editor', true, ['editor']]]);
  assert.ok(pp.data.people[1].lastSeen > 0);
  assert.equal((await viewer.get('/api/share-people?team=' + team)).status, 403);
  // the invite again: the same link
  const before2 = app.mail.outbox.length;
  const rs = await admin.post(`/api/share/${id}/people/${encodeURIComponent('client@example.com')}/resend`, {});
  assert.equal(rs.data.sent, true); assert.equal(rs.data.url, link);
  assert.equal(app.mail.outbox.length, before2 + 1);
  assert.equal((await editor.post(`/api/share/${id}/people/${encodeURIComponent('client@example.com')}/resend`, {})).status, 403);

  // removed from the folder: no access any more; the invite link stops working
  await admin.del(`/api/share/${id}/people/${encodeURIComponent('client@example.com')}`);
  assert.equal((await viewer.get(`/api/share/${id}/list`)).status, 403);
  assert.equal((await client(app.url).get('/api/sharing/invite/' + token)).status, 404);

  // the page: on the sharing subdomain and under /sharing on the website
  const onHost = (p, host) => new Promise((ok, no) => require('node:http').get(app.url + p, { headers: { host } }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => ok({ status: r.statusCode, body: b })); }).on('error', no));
  const page = await onHost('/f/' + id + '/Day%201', 'sharing.site.example');
  assert.equal(page.status, 200); assert.match(page.body, /sharing\.js/);
  assert.doesNotMatch((await onHost('/', 'sharing.site.example')).body, /<title>(?!File Sharing)/, 'the subdomain front page is Sharing');
  assert.match((await onHost('/', 'sharing.other.example')).body, /sharing\.js/, 'any sharing.<name> is the Sharing site');
  assert.match(await (await fetch(app.url + '/sharing/invite/' + token)).text(), /sharing\.js/);
  assert.match(await (await fetch(app.url + '/sharing/sharing.js')).text(), /Uploads go in 32 MB pieces/);
  assert.equal((await admin.get('/api/config')).data.sharingUrl, 'https://sharing.site.example');

  // editing a folder: name, production, removal date (Producers and Admins only)
  const dPlus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  assert.equal((await editor.put(`/api/share/${id}`, { expires: dPlus(5) })).status, 403);
  assert.equal((await admin.put(`/api/share/${id}`, { expires: '2020-01-01' })).status, 400, 'not in the past');
  assert.equal((await admin.put(`/api/share/${id}`, { expires: 'soon' })).status, 400);
  let ed = await admin.put(`/api/share/${id}`, { name: 'Cup final footage', expires: dPlus(30), production: '' });
  assert.equal(ed.status, 200, JSON.stringify(ed.data));
  assert.deepEqual([ed.data.name, ed.data.expires, ed.data.production, ed.data.productionName], ['Cup final footage', dPlus(30), '', '']);
  ed = await admin.put(`/api/share/${id}`, { production: prod.id });
  assert.equal(ed.data.productionName, 'Cup final · 2026-11-20');
  assert.equal((await admin.get('/api/share-people?team=' + team)).data.folders[0].expires, dPlus(30));
  // a new folder with a removal date, from the Studio
  const nf = await admin.post('/api/share', { team, name: 'Logos', expires: dPlus(2) });
  assert.equal(nf.status, 200, JSON.stringify(nf.data)); assert.equal(nf.data.expires, dPlus(2));
  assert.equal((await admin.post('/api/share', { team, name: 'Old', expires: '2020-01-01' })).status, 400);
  await admin.post(`/api/share/${nf.data.id}/people`, { emails: 'agency@example.com', role: 'viewer' });
  // the daily tidy: 3 days before, one warning email; on the day, the folder is removed; kept files go after 30 days
  let mails = app.mail.outbox.length;
  let sw = await app.sharing.sweep();
  assert.deepEqual([sw.removed, sw.warned], [0, 1]);
  assert.ok(app.mail.outbox.slice(mails).some((m) => m.to.includes('agency@example.com') && /is removed on/.test(m.subject)));
  mails = app.mail.outbox.length;
  assert.equal((await app.sharing.sweep()).warned, 0, 'warned once');
  const nd = await app.store.get(nf.data.id);
  await app.save(nd.team, 'share', nd.id, { ...nd.data, expires: new Date().toISOString().slice(0, 10) }, 'test');
  fs.mkdirSync(path.join(nas, '.deleted', 'shr_old-' + (Date.now() - 40 * 864e5)), { recursive: true });
  sw = await app.sharing.sweep();
  assert.equal(sw.removed, 1); assert.ok(sw.purged >= 1);
  assert.equal((await admin.get(`/api/share/${nf.data.id}/list`)).status, 404);
  assert.ok(!fs.readdirSync(path.join(nas, '.deleted')).some((n) => n.startsWith('shr_old-')), 'kept files older than 30 days are deleted');
  assert.ok(fs.readdirSync(path.join(nas, '.deleted')).some((n) => n.startsWith(nf.data.id)), 'the expired folder is kept aside for now');

  // deleting the folder: gone for everyone, the files kept aside
  assert.equal((await admin.del(`/api/share/${id}`)).status, 200);
  assert.equal((await editor.get(`/api/share/${id}/list`)).status, 404);
  assert.ok(fs.readdirSync(path.join(nas, '.deleted')).some((n) => n.startsWith(id)));
});
