'use strict';
// Software on the website: a product names its GitHub repo, releases are copied to this server (a stand-in GitHub
// here), the public pages and downloads, paid apps, and the apps' update check.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { platformOf } = require('../lib/software');

test('installers: which platform a file is for', () => {
  assert.deepEqual(platformOf('RegemarkReplay-Setup-1.1.0.exe'), { platform: 'windows', arch: '' });
  assert.deepEqual(platformOf('RegemarkReplay-1.1.0-arm64.dmg'), { platform: 'mac', arch: 'arm64' });
  assert.deepEqual(platformOf('regemark-replay_1.1.0_amd64.deb'), { platform: 'linux', arch: 'x64' });
  assert.deepEqual(platformOf('RegemarkReplay-1.1.0-x86_64.AppImage'), { platform: 'linux', arch: 'x64' });
  assert.equal(platformOf('checksums.txt').platform, 'other');
});

test('software: GitHub releases copied here, pages, downloads, paid apps, update check', async (t) => {
  const files = { 'Replay-Setup-1.1.0.exe': Buffer.alloc(3000, 1), 'replay_1.1.0_amd64.deb': Buffer.alloc(2000, 2), 'SHA256SUMS.txt': Buffer.from('x') };
  let gets = 0;
  const gh = http.createServer((req, res) => {
    const base = 'http://127.0.0.1:' + gh.address().port;
    if (req.url.startsWith('/repos/regemarkfp/regemark-replay/releases')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify([
        { tag_name: 'v1.2.0-beta', name: 'Beta', prerelease: true, draft: false, published_at: '2026-11-04T10:00:00Z', assets: [] },
        { tag_name: 'v1.1.0', name: '1.1.0', prerelease: false, draft: false, published_at: '2026-11-03T10:00:00Z', body: '- Jog and shuttle\n- Linux build', html_url: 'https://github.example/r', assets: Object.entries(files).map(([name, b]) => ({ name, size: b.length, browser_download_url: `${base}/dl/${name}` })) }]));
    }
    const m = /^\/dl\/(.+)$/.exec(req.url);
    if (m && files[m[1]]) { gets++; return res.end(files[m[1]]); }
    res.statusCode = 404; res.end('[]');
  });
  await new Promise((r) => gh.listen(0, r));
  t.after(() => gh.close());
  const app = await boot({ mode: 'cloud', allowSignup: true, siteAdmins: ['admin@example.com'], publicUrl: 'https://site.example', software: { api: 'http://127.0.0.1:' + gh.address().port }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), anon = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Site Admin', email: 'admin@example.com', password: 'correct horse' });

  assert.equal((await anon.post('/api/software', { name: 'X' })).status, 401);
  assert.equal((await admin.post('/api/software', { name: 'Replay', repo: 'not a repo' })).status, 400);
  const saved = await admin.post('/api/software', { name: 'Regemark Replay', tagline: 'Replay for live sport', repo: 'regemarkfp/regemark-replay', description: 'EVS-style replay.' });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const sync = (await admin.post('/api/software/regemark-replay/sync', {})).data;
  assert.deepEqual(sync, { releases: 1, copied: 2 }, 'betas left out; installers only');
  assert.equal((await admin.post('/api/software/regemark-replay/sync', {})).data.copied, 0, 'nothing copied twice');
  assert.equal(gets, 2);
  assert.ok(fs.existsSync(require('node:path').join(app.software.root(), 'regemark-replay', 'v1.1.0', 'Replay-Setup-1.1.0.exe')));

  // the public pages and the download
  const list = (await anon.get('/api/public/software')).data.list;
  assert.deepEqual(list.map((p) => [p.name, p.releases[0].version]), [['Regemark Replay', '1.1.0']]);
  const page = (await anon.get('/api/public/software/regemark-replay')).data;
  assert.deepEqual(page.releases[0].assets.map((a) => [a.platform, a.kind]), [['windows', 'exe'], ['linux', 'deb']]);
  assert.equal(page.access, undefined, 'who may download a paid app is not shown');
  const dl = await anon.get(page.releases[0].assets[0].url);
  assert.equal(dl.status, 200); assert.equal(dl.data.length, 3000); assert.match(dl.headers.get('content-disposition'), /attachment; filename="Replay-Setup-1.1.0.exe"/);
  assert.equal((await anon.get('/software/regemark-replay')).status, 200, 'the page');
  assert.equal((await admin.get('/api/software')).data.list[0].downloads, 1);
  // the apps' update check
  const up = (await anon.get('/api/software/regemark-replay/latest')).data;
  assert.equal(up.version, '1.1.0'); assert.equal(up.assets[0].url, 'https://site.example/download/regemark-replay/v1.1.0/Replay-Setup-1.1.0.exe');

  // a paid app: only the people given access download it (until buying is switched on)
  await admin.post('/api/software', { id: saved.data.product.id, name: 'Regemark Replay', repo: 'regemarkfp/regemark-replay', price: 499, access: ['admin@example.com'] });
  assert.equal((await anon.get(page.releases[0].assets[0].url)).status, 402);
  assert.equal((await admin.get(page.releases[0].assets[0].url)).status, 200);
});
