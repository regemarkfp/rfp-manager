'use strict';
// Scopes (1.9.3): the page is served on any address with a policy that lets it play the stream (blob: media) and open
// a capture input (camera / microphone on this site only); the Studio links to it from a stream.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('scopes: the page, its policy and the links', async (t) => {
  const app = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://site.example', mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const r = await client(app.url).get('/scopes');
  assert.equal(r.status, 200);
  const html = r.data.toString();
  assert.ok(html.includes('/js/scopes.js') && html.includes('/js/vendor/hls.min.js') && html.includes('/fonts/fonts.css'));
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /media-src 'self' blob:/); assert.match(csp, /connect-src 'self'/);
  assert.match(r.headers.get('permissions-policy'), /camera=\(self\)/);
  assert.equal((await client(app.url).get('/js/scopes.js')).status, 200);
  const sp = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'stream-pages.js'), 'utf8');
  assert.equal((sp.match(/\/scopes\?slug=/g) || []).length, 2, 'the stream card and the Live streams page link to it');
  assert.equal((await client(app.url).get('/js/scopes-worklet.js')).status, 200);
  // RFP Scopes (the Windows app, its own release): the build copies files that are there, the workflow publishes scopes-v<version>
  const root = path.join(__dirname, '..');
  const build = fs.readFileSync(path.join(root, 'tools', 'scopes', 'build.ps1'), 'utf8');
  const files = (/\$files = @\(([^)]*)\)/.exec(build) || [])[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1).replace(/\\/g, '/'));
  assert.ok(files.length >= 5);
  for (const f of files) assert.ok(fs.existsSync(path.join(root, 'public', f)), 'public/' + f);
  assert.match(fs.readFileSync(path.join(root, 'tools', 'scopes', 'VERSION'), 'utf8').trim(), /^\d+\.\d+\.\d+$/);
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'scopes.yml'), 'utf8');
  assert.ok(wf.includes('scopes-v') && wf.includes('--latest=false') && wf.includes('tools\\scopes\\build.ps1'));
  const cs = fs.readFileSync(path.join(root, 'tools', 'scopes', 'RFPScopes.cs'), 'utf8');
  assert.ok(cs.includes('NDIlib_recv_capture_v2') && cs.includes('PostSharedBufferToScript') && !/\$"/.test(cs), 'C# 5: no interpolated strings');
  // the K-weighting and the gates are the BS.1770 ones
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'scopes.js'), 'utf8');
  assert.ok(js.includes('1681.97') && js.includes('38.13') && js.includes('-0.691') && js.includes('> -70'));
});
