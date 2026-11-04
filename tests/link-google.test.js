'use strict';
// A production PC links to the website with the Google account signed in on it: one button, no codes or keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client, until } = require('./helpers');

test('a production PC links with Google when that person is an Admin on the website', async (t) => {
  const site = await boot({ mode: 'cloud', allowSignup: true });
  t.after(() => site.stop());
  const w = client(site.url);
  await w.post('/api/auth/signup', { name: 'Test Admin', email: 'admin@example.com', password: 'correct horse' });
  await w.post('/api/orgs', { name: 'Test Org' });
  site.auth.verifyGoogle = async (c) => { if (c !== 'good') { const e = new Error('Google sign-in could not be verified'); e.status = 401; throw e; } return { email: 'admin@example.com', name: 'Test Admin', image: '', sub: '1' }; };

  const pc = await boot({});
  t.after(() => pc.stop());
  const p = client(pc.url);
  const bad = await p.post('/api/link/google', { credential: 'bad', url: site.url });
  assert.equal(bad.status, 401, JSON.stringify(bad.data));
  const r = await p.post('/api/link/google', { credential: 'good', url: site.url });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.url, site.url);
  await until(() => pc.sync.linked() && pc.sync.status().lastSync, 8000, 'first sync');
  assert.ok((await pc.store.listType('user')).some((u) => u.data.email === 'admin@example.com'), 'the Admin came down with the first sync');
});
