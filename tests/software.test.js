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
  // an app icon (an uploaded image) is kept and shown on the public list; anything else is not an icon
  const withIcon = await admin.post('/api/software', { ...saved.data.product, id: 'product_regemark-replay', logo: 'img_icon1' });
  assert.equal(withIcon.data.product.logo, 'img_icon1');
  assert.equal((await anon.get('/api/public/software')).data.list.find((x) => x.slug === 'regemark-replay').logo, 'img_icon1');
  assert.equal((await admin.post('/api/software', { ...saved.data.product, id: 'product_regemark-replay', logo: 'javascript:x' })).data.product.logo, '');
  await admin.post('/api/software', { ...saved.data.product, id: 'product_regemark-replay', logo: 'img_icon1' });
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

test('software: icon and screenshots from GitHub, apps and media loaded straight to the website', async (t) => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
  const hits = [];
  let releases = [{ tag_name: 'v2.0.0', name: '2.0.0', prerelease: false, draft: false, published_at: '2026-10-01T10:00:00Z', assets: [] }];
  const gh = http.createServer((req, res) => {
    const base = 'http://127.0.0.1:' + gh.address().port; hits.push(req.url);
    const json = (x) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(x)); };
    if (req.url === '/repos/acme/tool') return json({ default_branch: 'trunk', description: 'A tool from GitHub', owner: { avatar_url: base + '/avatar' } });
    if (req.url.startsWith('/repos/acme/tool/releases')) return json(releases);
    if (req.url.startsWith('/repos/acme/tool/contents/screenshots')) return json([{ type: 'file', name: 'main-window.png', path: 'screenshots/main-window.png', download_url: base + '/raw/acme/tool/trunk/screenshots/main-window.png' }, { type: 'file', name: 'notes.txt', path: 'screenshots/notes.txt' }]);
    if (req.url === '/repos/acme/tool/readme') return res.end('# Tool\n![build](https://img.shields.io/badge/x.svg)\n![The editor](docs/editor.png)\n<img src="https://example.invalid/nope.png">\n');
    if (req.url === '/raw/acme/tool/trunk/assets/icon.png' || req.url === '/raw/acme/tool/trunk/screenshots/main-window.png' || req.url === '/raw/acme/tool/trunk/docs/editor.png') return res.end(PNG);
    res.statusCode = 404; res.end('<html>not found</html>');
  });
  await new Promise((r) => gh.listen(0, r));
  t.after(() => gh.close());
  const base = 'http://127.0.0.1:' + gh.address().port;
  const app = await boot({ mode: 'cloud', allowSignup: true, siteAdmins: ['admin@example.com'], software: { api: base, raw: base + '/raw' }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), anon = client(app.url), other = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Site Admin', email: 'admin@example.com', password: 'correct horse' });
  await other.post('/api/auth/signup', { name: 'Someone', email: 'someone@example.com', password: 'correct horse' });

  // GitHub: the icon from the repo (assets/icon.png on its default branch), the screenshots folder and README pictures (no badges)
  await admin.post('/api/software', { name: 'Tool', repo: 'acme/tool' });
  await admin.post('/api/software/tool/sync', {});
  let page = (await anon.get('/api/public/software/tool')).data;
  assert.match(page.icon, /^\/software-media\/tool\/gh\/[0-9a-f]{16}\.png$/); assert.equal(page.iconFrom, 'github');
  assert.equal(page.ghDescription, 'A tool from GitHub');
  assert.deepEqual(page.media.map((m) => [m.source, m.kind, m.caption]), [['github', 'image', 'main window'], ['github', 'image', 'The editor']]);
  assert.ok(!hits.some((u) => /shields/.test(u)), 'badges are left alone');
  const pic = await anon.get(page.media[0].url);
  assert.equal(pic.status, 200); assert.equal(pic.headers.get('content-type'), 'image/png'); assert.equal(pic.data.length, PNG.length);
  assert.equal((await anon.get('/software-media/tool/gh/..%2F..%2Fsecret')).status, 404);
  // a GitHub picture can be hidden (and stays hidden after the next sync)
  await admin.post('/api/software/tool/media-remove', { file: page.media[1].file });
  await admin.post('/api/software/tool/sync', {});
  assert.equal((await anon.get('/api/public/software/tool')).data.media.length, 1);
  assert.equal((await admin.get('/api/software')).data.list[0].media.length, 2, 'the admin still sees it, marked hidden');

  // uploads: only site admins; in pieces; a version loaded straight here, kept by the next sync
  const exe = Buffer.alloc(5000, 3);
  assert.equal((await other.post('/api/software/tool/upload', { name: 'Tool-Setup.exe', size: exe.length })).status, 403);
  const st = (await admin.post('/api/software/tool/upload', { name: 'Tool-Setup-2.1.0.exe', size: exe.length })).data;
  assert.equal(st.received, 0);
  assert.equal((await admin.post('/api/software/tool/release', { version: '2.1.0', uploads: [st.upload] })).status, 409, 'not complete yet');
  assert.equal((await admin.put(`/api/software/tool/upload/${st.upload}?offset=0`, exe.subarray(0, 3000))).data.received, 3000);
  assert.equal((await admin.put(`/api/software/tool/upload/${st.upload}?offset=4000`, exe.subarray(3000))).status, 409, 'a gap is refused');
  assert.equal((await admin.put(`/api/software/tool/upload/${st.upload}?offset=3000`, exe.subarray(3000))).data.received, 5000);
  const rel = await admin.post('/api/software/tool/release', { version: 'v2.1.0', notes: 'Loaded here', uploads: [st.upload] });
  assert.equal(rel.status, 200, JSON.stringify(rel.data)); assert.equal(rel.data.release.manual, true);
  assert.equal((await admin.post('/api/software/tool/release', { version: '2.1.0', uploads: [st.upload] })).status, 409, 'that version is there already');
  page = (await anon.get('/api/public/software/tool')).data;
  assert.equal(page.releases[0].version, '2.1.0'); assert.deepEqual(page.releases[0].assets.map((a) => [a.name, a.platform]), [['Tool-Setup-2.1.0.exe', 'windows']]);
  const got = await anon.get(page.releases[0].assets[0].url);
  assert.equal(got.status, 200); assert.equal(Buffer.compare(got.data, exe), 0);
  releases = [{ tag_name: 'v2.0.1', name: '2.0.1', prerelease: false, draft: false, published_at: '2026-10-05T10:00:00Z', assets: [] }];
  await admin.post('/api/software/tool/sync', {});
  assert.deepEqual((await anon.get('/api/public/software/tool')).data.releases.map((r) => r.version), ['2.1.0', '2.0.1'], 'the uploaded version stays next to GitHub\'s');
  assert.ok(fs.existsSync(require('node:path').join(app.software.root(), 'tool', 'v2.1.0', 'Tool-Setup-2.1.0.exe')));
  assert.equal((await admin.del('/api/software/tool/release/v2.0.1')).status, 400, 'GitHub versions are removed on GitHub');
  assert.equal((await admin.del('/api/software/tool/release/v2.1.0')).status, 200);
  assert.deepEqual((await anon.get('/api/public/software/tool')).data.releases.map((r) => r.version), ['2.0.1']);

  // screenshots uploaded here: pictures and videos only, with a caption; an uploaded icon wins over GitHub's
  const up = (await admin.post('/api/software/tool/upload', { name: 'shot.png', size: PNG.length })).data;
  await admin.put(`/api/software/tool/upload/${up.upload}?offset=0`, PNG);
  const m = await admin.post('/api/software/tool/media', { uploads: [up.upload], caption: 'Live view' });
  assert.equal(m.status, 200, JSON.stringify(m.data)); assert.equal(m.data.media[0].file, 'media/shot.png');
  const bad = (await admin.post('/api/software/tool/upload', { name: 'run.sh', size: 2 })).data;
  await admin.put(`/api/software/tool/upload/${bad.upload}?offset=0`, Buffer.from('hi'));
  assert.equal((await admin.post('/api/software/tool/media', { uploads: [bad.upload] })).status, 400);
  const prod = (await admin.get('/api/software')).data.list[0];
  await admin.post('/api/software', { ...prod, releases: undefined, releasesAll: undefined, logo: 'img_mine' });
  page = (await anon.get('/api/public/software/tool')).data;
  assert.equal(page.icon, '/media/img_mine'); assert.equal(page.iconFrom, 'upload');
  assert.deepEqual(page.media.map((x) => [x.source, x.caption]), [['upload', 'Live view'], ['github', 'main window']], 'editing the app keeps its media');
  assert.equal((await anon.get('/software-media/tool/media/shot.png')).status, 200);
  await admin.post('/api/software/tool/media-remove', { file: 'media/shot.png' });
  assert.equal((await anon.get('/software-media/tool/media/shot.png')).status, 404);
  // an app without a GitHub repository: versions only from here
  assert.equal((await admin.post('/api/software', { name: 'Local Only' })).status, 200);
  assert.equal((await admin.post('/api/software/local-only/sync', {})).status, 400);
});
