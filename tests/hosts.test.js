'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
const fakeMongo = require('./fake-mongo');

test('two addresses: website and Studio (admin.) share one sign-in', async (t) => {
  const cloud = await boot({ mode: 'cloud', allowSignup: true, publicUrl: 'https://example.com', adminUrl: 'https://admin.example.com', mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => cloud.stop());
  const http = require('node:http');
  const go = (host, p, opts = {}) => new Promise((resolve, reject) => {
    const u = new URL(cloud.url + p);
    const q = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers: { host, ...(opts.headers || {}) } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const body = Buffer.concat(chunks).toString(); const sc = res.headers['set-cookie']; resolve({ status: res.statusCode, headers: { get: (k) => (k === 'set-cookie' ? (sc || []).join('\n') : res.headers[k]) }, json: async () => JSON.parse(body) }); });
    });
    q.on('error', reject); if (opts.body) q.write(opts.body); q.end();
  });
  let r = await go('admin.example.com', '/?x=1');
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/app?x=1');
  r = await go('example.com', '/app?android=3');
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://admin.example.com/app?android=3');
  assert.equal((await go('example.com', '/')).status, 200, 'the website stays');
  assert.equal((await go('admin.example.com', '/app')).status, 200);
  assert.equal((await go('139-84-251-145.sslip.io', '/app')).status, 200, 'other addresses keep everything');
  assert.equal((await go('139-84-251-145.sslip.io', '/')).status, 200);
  const cfg = await (await go('admin.example.com', '/api/config')).json();
  assert.equal(cfg.siteUrl, 'https://example.com');
  // the session cookie covers both on example.com, and stays host-only elsewhere
  const signup = (host) => go(host, '/api/auth/signup', { method: 'POST', headers: { 'x-rfp': '1', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'A', email: Math.random() + '@example.org', password: 'correct horse' }) });
  r = await signup('admin.example.com');
  assert.match(r.headers.get('set-cookie'), /Domain=example\.com/);
  r = await signup('139-84-251-145.sslip.io');
  assert.doesNotMatch(r.headers.get('set-cookie') || '', /Domain=/);
});
