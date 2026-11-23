'use strict';
// Sharing (1.8.3): "anyone with the link" – a folder or one file opened without signing in, look and download only,
// with an end date, a password, switched off or renewed, and views and downloads counted in the history.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { boot, client, tmp } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('sharing: anyone with the link', async (t) => {
  const nas = tmp('nas');
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', sharingUrl: 'https://sharing.site.example', sharingDir: nas, sharingDigestMs: 50, ffmpeg: '/nonexistent/ffmpeg',
    mail: { provider: 'test', from: 'RFP <rfp@example.com>' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), anon = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  const team = (await admin.post('/api/orgs', { name: 'Test Team' })).data.id;
  const id = (await admin.post('/api/share', { team, name: 'Client videos' })).data.id;
  const files = path.join(nas, id, 'files');
  fs.mkdirSync(path.join(files, 'Final', 'Raw'), { recursive: true });
  const video = Buffer.alloc(50000, 7);
  fs.writeFileSync(path.join(files, 'Final', 'Highlights.mp4'), video);
  fs.writeFileSync(path.join(files, 'Final', 'Raw', 'A001.mov'), Buffer.from('raw'));
  fs.writeFileSync(path.join(files, 'contract.pdf'), Buffer.from('%PDF-1.4'));

  // a viewer may not make links; an outsider cannot list them
  const viewer = client(app.url);
  const inv = await admin.post(`/api/share/${id}/people`, { emails: 'viewer@example.com', role: 'viewer' });
  await viewer.post(`/api/sharing/invite/${inv.data.links[0].url.split('/').pop()}/password`, { name: 'Viewer', password: 'long enough' });
  assert.equal((await viewer.post(`/api/share/${id}/links`, { path: 'Final' })).status, 403);
  assert.equal((await anon.get(`/api/share/${id}/links`)).status, 401);

  // one file: plays and downloads, nothing else
  const fl = await admin.post(`/api/share/${id}/links`, { path: 'Final/Highlights.mp4' });
  assert.equal(fl.status, 200, JSON.stringify(fl.data));
  assert.equal(fl.data.link.kind, 'file'); assert.match(fl.data.link.url, /^https:\/\/sharing\.site\.example\/l\/[\w-]{16,}$/);
  const fk = fl.data.link.url.split('/').pop();
  const fi = (await anon.get('/api/sharing/link/' + fk)).data;
  assert.equal(fi.kind, 'file'); assert.equal(fi.from, 'Test Team'); assert.equal(fi.file.name, 'Highlights.mp4'); assert.equal(fi.file.size, video.length);
  const got = await anon.get(`/api/sharing/link/${fk}/file`);
  assert.equal(got.status, 200); assert.ok(Buffer.compare(got.data, video) === 0); assert.match(got.headers.get('content-disposition'), /attachment/);
  assert.equal((await anon.get(`/api/sharing/link/${fk}/file?download=0`, { range: 'bytes=5-9' })).status, 206, 'seeking in the video');
  assert.deepEqual((await anon.get(`/api/sharing/link/${fk}/preview?check=1`)).data, { ready: true });
  assert.equal((await anon.get(`/api/sharing/link/${fk}/file?path=contract.pdf`)).status, 403, 'only that file');
  assert.equal((await anon.get(`/api/sharing/link/${fk}/zip`)).status, 400);
  assert.equal((await anon.get('/api/sharing/link/not-a-real-link-key')).status, 404);
  assert.equal((await anon.get('/sharing/l/' + fk)).status, 200, 'the page');

  // a folder: its files and sub-folders, never outside it
  const dl = (await admin.post(`/api/share/${id}/links`, { path: 'Final' })).data.link;
  const dk = dl.url.split('/').pop();
  const di = (await anon.get('/api/sharing/link/' + dk)).data;
  assert.equal(di.name, 'Final'); assert.deepEqual(di.items.map((x) => [x.name, x.path, x.dir]), [['Raw', 'Raw', true], ['Highlights.mp4', 'Highlights.mp4', false]]);
  assert.equal(di.items[1].by, undefined, 'not who uploaded it');
  assert.deepEqual((await anon.get(`/api/sharing/link/${dk}?path=Raw`)).data.items.map((x) => x.path), ['Raw/A001.mov']);
  assert.equal((await anon.get(`/api/sharing/link/${dk}/file?path=Raw%2FA001.mov`)).data.toString(), 'raw');
  assert.equal((await anon.get(`/api/sharing/link/${dk}/file?path=..%2Fcontract.pdf`)).status, 400, 'no way out');
  assert.equal((await anon.get(`/api/sharing/link/${dk}/file?path=contract.pdf`)).status, 404, 'not the parent folder');
  const z = await anon.get(`/api/sharing/link/${dk}/zip?p=`);
  assert.equal(z.status, 200); assert.match(z.headers.get('content-disposition'), /Final\.zip/);
  const zf = path.join(tmp('zip'), 'l.zip'); fs.writeFileSync(zf, z.data);
  assert.deepEqual(execFileSync('python3', ['-c', 'import sys,zipfile; print("\\n".join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))', zf]).toString().trim().split('\n'), ['Final/Highlights.mp4', 'Final/Raw/A001.mov'], 'in a folder named after the link');
  // nothing that changes anything
  assert.equal((await anon.post(`/api/share/${id}/delete`, { paths: ['Final'] })).status, 401);

  // views and downloads are counted (a view once per visitor for a while) and show in the history
  await anon.get('/api/sharing/link/' + dk);
  const ls = (await admin.get(`/api/share/${id}/links`)).data.links;
  const dStat = ls.find((x) => x.id === dl.id), fStat = ls.find((x) => x.id === fl.data.link.id);
  assert.equal(dStat.views, 1); assert.equal(dStat.downloads, 2); assert.equal(fStat.views, 1); assert.equal(fStat.downloads, 1, 'the range request is not a download');
  const act = (await admin.get(`/api/share/${id}/activity`)).data.activity.map((a) => a.what);
  assert.ok(act.includes('link-open') && act.includes('link-download') && act.includes('link'));

  // a password: nothing without it, a pass after it (a wrong one is refused)
  assert.equal((await admin.put(`/api/share/${id}/links/${dl.id}`, { password: 'ab' })).status, 400);
  assert.equal((await admin.put(`/api/share/${id}/links/${dl.id}`, { password: 'gala2026' })).data.link.password, true);
  const locked = (await anon.get('/api/sharing/link/' + dk)).data;
  assert.equal(locked.needsPassword, true); assert.equal(locked.items, undefined);
  assert.equal((await anon.get(`/api/sharing/link/${dk}/file?path=Highlights.mp4`)).status, 401);
  assert.equal((await anon.post(`/api/sharing/link/${dk}/unlock`, { password: 'nope' })).status, 403);
  const pass = (await anon.post(`/api/sharing/link/${dk}/unlock`, { password: 'gala2026' })).data.t;
  assert.ok(pass);
  assert.equal((await anon.get(`/api/sharing/link/${dk}?t=${pass}`)).data.items.length, 2);
  assert.equal((await anon.get(`/api/sharing/link/${dk}/file?path=Highlights.mp4&t=${pass}`)).status, 200);
  assert.equal((await anon.get(`/api/sharing/link/${dk}/file?path=Highlights.mp4&t=${pass.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))}`)).status, 401);
  // a new password: the old pass stops working
  await admin.put(`/api/share/${id}/links/${dl.id}`, { password: 'another1' });
  assert.equal((await anon.get(`/api/sharing/link/${dk}/file?path=Highlights.mp4&t=${pass}`)).status, 401);
  await admin.put(`/api/share/${id}/links/${dl.id}`, { password: '' });
  assert.equal((await anon.get(`/api/sharing/link/${dk}/file?path=Highlights.mp4`)).status, 200, 'password removed');

  // an end date, switched off, a new address, deleted
  assert.equal((await admin.put(`/api/share/${id}/links/${dl.id}`, { expires: '2020-01-01' })).status, 400);
  const cur = await app.store.get(id);
  await app.save(team, 'share', id, { ...cur.data, links: cur.data.links.map((l) => (l.id === dl.id ? { ...l, expires: '2020-01-01' } : l)) }, '');
  assert.equal((await anon.get('/api/sharing/link/' + dk)).status, 410);
  assert.equal((await admin.put(`/api/share/${id}/links/${dl.id}`, { expires: '' })).data.link.expired, false);
  assert.equal((await admin.put(`/api/share/${id}/links/${dl.id}`, { on: false })).status, 200);
  assert.equal((await anon.get('/api/sharing/link/' + dk)).status, 410);
  await admin.put(`/api/share/${id}/links/${dl.id}`, { on: true });
  const renewed = (await admin.put(`/api/share/${id}/links/${dl.id}`, { newKey: true })).data.link;
  assert.notEqual(renewed.url, dl.url);
  assert.equal((await anon.get('/api/sharing/link/' + dk)).status, 404, 'the old address stops');
  assert.equal((await anon.get('/api/sharing/link/' + renewed.url.split('/').pop())).status, 200);
  // a manager saving the folder (name, date) keeps the links
  await admin.put(`/api/share/${id}`, { name: 'Client videos 2' });
  assert.equal((await admin.get(`/api/share/${id}/links`)).data.links.length, 2);
  assert.equal((await admin.del(`/api/share/${id}/links/${fl.data.link.id}`)).status, 200);
  assert.equal((await anon.get('/api/sharing/link/' + fk)).status, 404);
  // the whole folder deleted: its links stop
  await admin.del(`/api/share/${id}`);
  assert.equal((await anon.get('/api/sharing/link/' + renewed.url.split('/').pop())).status, 404);
});
