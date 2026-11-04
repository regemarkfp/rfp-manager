'use strict';
// Bibles kept by the website: the Beblia collection (a stand-in server here), adding one (site admins, with the
// copyright confirmation), and the verse of the day from it, with its copyright line. Placeholder text only.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client } = require('./helpers');
const fakeMongo = require('./fake-mongo');
const { fromBeblia, nameOf } = require('../lib/sitebibles');

// a tiny Bible in Beblia's format: every verse is "Placeholder <book>.<chapter>.<verse>"
// (each book has as many chapters as the verse-of-the-day list needs)
const W = require('../shared/worship');
const need = {}, needV = {};
for (const r of require('../lib/verse').REFS) { const x = W.parseRef(r); if (x) { need[x.book] = Math.max(need[x.book] || 3, ...x.parts.map((p) => p.c2)); needV[x.book] = Math.max(needV[x.book] || 40, ...x.parts.map((p) => (p.v2 === 999 ? 40 : p.v2))); } }
function tinyBible(name, status) {
  const books = [];
  for (let b = 1; b <= 66; b++) {
    const chapters = [];
    for (let c = 1; c <= (need[b] || 3); c++) chapters.push(`<chapter number="${c}">${Array.from({ length: needV[b] || 40 }, (_, v) => `<verse number="${v + 1}">Placeholder ${b}.${c}.${v + 1} &amp; more</verse>`).join('')}</chapter>`);
    books.push(`<book number="${b}">${chapters.join('')}</book>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<bible translation="${name}" status="${status}" link="https://example.org"><testament name="Old">${books.slice(0, 39).join('')}</testament><testament name="New">${books.slice(39).join('')}</testament></bible>`;
}

test('Beblia files: the format and the names', () => {
  const b = fromBeblia(tinyBible('Test Taal 1999', '© Test Society'));
  assert.equal(b.name, 'Test Taal 1999'); assert.equal(b.status, '© Test Society');
  assert.equal(b.books.length, 66); assert.equal(b.books[42].chapters[2][15], 'Placeholder 43.3.16 & more');
  assert.deepEqual(nameOf('Afrikaans1983Bible.xml'), { language: 'Afrikaans', version: '1983' });
  assert.deepEqual(nameOf('AfrikaansNLVBible.xml'), { language: 'Afrikaans', version: 'NLV' });
  assert.deepEqual(nameOf('AfrikaansBible.xml'), { language: 'Afrikaans', version: '' });
  assert.deepEqual(nameOf('NorthernSothoBible.xml'), { language: 'Northern Sotho', version: '' });
});

test('Bibles on the website: added by a site admin, used for everyone\'s verse of the day', async (t) => {
  let downloads = 0;
  const gh = http.createServer((req, res) => {
    if (req.url.startsWith('/repos/Beblia/Holy-Bible-XML-Format/git/trees/master')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ tree: [{ path: 'TesttaalBible.xml', type: 'blob', size: 4000000 }, { path: 'Testtaal2020Bible.xml', type: 'blob', size: 4100000 }, { path: 'README.md', type: 'blob' }] })); }
    if (req.url === '/Beblia/Holy-Bible-XML-Format/master/TesttaalBible.xml') { downloads++; return res.end(tinyBible('Testtaal 1933', '© Test Bible Society. All rights reserved')); }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => gh.listen(0, r));
  t.after(() => gh.close());
  const base = 'http://127.0.0.1:' + gh.address().port;
  const app = await boot({ mode: 'cloud', allowSignup: true, verse: false, siteAdmins: ['admin@example.com'], beblia: { api: base, raw: base }, mongo: { uri: 'mongodb://fake-' + Math.random(), db: 'rfp' } }, { mongoDriver: fakeMongo });
  t.after(() => app.stop());
  const admin = client(app.url), other = client(app.url);
  await admin.post('/api/auth/signup', { name: 'Site Admin', email: 'admin@example.com', password: 'correct horse' });
  await other.post('/api/auth/signup', { name: 'Someone', email: 'someone@example.com', password: 'correct horse' });

  assert.equal((await other.get('/api/bibles/catalog')).status, 403, 'site admins only');
  const cat = (await admin.get('/api/bibles/catalog')).data.list;
  assert.deepEqual(cat.map((c) => [c.file, c.language, c.version]), [['TesttaalBible.xml', 'Testtaal', ''], ['Testtaal2020Bible.xml', 'Testtaal', '2020']]);
  assert.equal((await admin.post('/api/bibles/site', { file: 'TesttaalBible.xml' })).status, 400, 'the copyright confirmation');
  const add = await admin.post('/api/bibles/site', { file: 'TesttaalBible.xml', confirm: true });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.equal(add.data.bible.name, 'Testtaal 1933'); assert.equal(add.data.bible.verses, Array.from({ length: 66 }, (_, i) => (need[i + 1] || 3) * (needV[i + 1] || 40)).reduce((a, b) => a + b, 0));
  assert.equal(add.data.bible.copyright, '© Test Bible Society. All rights reserved');
  assert.ok(add.data.bible.size < 400000, 'kept compressed');

  // everyone sees it, with its language, and can pick it
  const pub = (await client(app.url).get('/api/public/bibles')).data.list;
  assert.deepEqual(pub.map((b) => [b.name, b.language]), [['Testtaal 1933', 'Testtaal']]);
  const tl = (await other.get('/api/verse/translations')).data.list;
  assert.equal(tl[0].id, 'site:' + add.data.bible.id); assert.equal(tl[0].where, 'website');
  await other.post('/api/me', { versePrefs: { on: true, translation: 'site:' + add.data.bible.id, time: '00:00' } });
  const today = new Date().toISOString().slice(0, 10);
  const v = (await other.get('/api/verse?date=' + today)).data;
  assert.equal(v.translation, 'Testtaal 1933'); assert.match(v.text, /^Placeholder \d+\.\d+\.\d+ & more/); assert.equal(v.copyright, '© Test Bible Society. All rights reserved');
  // production PCs ask the website (public, one verse)
  const pv = (await client(app.url).get(`/api/public/verse?date=${today}&t=site:${add.data.bible.id}`)).data;
  assert.equal(pv.text, v.text);
  assert.equal(downloads, 1);

  // removing it: back to the default
  assert.equal((await admin.del('/api/bibles/site/' + add.data.bible.id)).status, 200);
  assert.deepEqual((await client(app.url).get('/api/public/bibles')).data.list, []);
});
