'use strict';
// Bibles kept by the website (not only on one PC): for everyone's verse of the day, in their own language. A site admin
// adds them from the Beblia collection (github.com/Beblia/Holy-Bible-XML-Format, 1000+ translations in 200+
// languages) or from a file. Each one is a "bible" record (name, language, copyright line, where from) with the text
// as a compressed file in the website's storage (the database, and the NAS folder when there is one).
// Most modern translations are under copyright: the copyright line goes with every verse shown, and the site admin
// confirms the website may use the translation before it is added.
const zlib = require('node:zlib');
const { read } = require('./bible');
const W = require('../shared/worship');
const { fail, log, slug } = require('./util');

const REPO = 'Beblia/Holy-Bible-XML-Format', BRANCH = 'master';

// Beblia's own format: <bible translation status link><testament><book number><chapter number><verse number>
function fromBeblia(text) {
  const head = (/<bible\b([^>]*)>/i.exec(text) || ['', ''])[1];
  const at = (k) => { const m = new RegExp('\\b' + k + '\\s*=\\s*"([^"]*)"', 'i').exec(head); return m ? decode(m[1]) : ''; };
  const books = [];
  for (const b of text.matchAll(/<book\b[^>]*\bnumber="(\d+)"[^>]*>([\s\S]*?)<\/book>/gi)) {
    const n = Number(b[1]), chapters = [];
    for (const c of b[2].matchAll(/<chapter\b[^>]*\bnumber="(\d+)"[^>]*>([\s\S]*?)<\/chapter>/gi)) {
      const vs = [];
      for (const v of c[2].matchAll(/<verse\b[^>]*\bnumber="(\d+)"[^>]*>([\s\S]*?)<\/verse>/gi)) vs[Number(v[1]) - 1] = decode(v[2]).replace(/\s+/g, ' ').trim();
      chapters[Number(c[1]) - 1] = vs.map((x) => x || '');
    }
    if (n >= 1 && n <= 66 && chapters.length) books.push({ n, name: W.bookName(n), chapters: chapters.map((c) => c || []) });
  }
  return { name: at('translation'), status: at('status'), link: at('link'), books };
}
function decode(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
}
// "Afrikaans1983Bible.xml" → { language: 'Afrikaans', version: '1983' }; "AmharicDawroDFBEBible.xml" → Amharic, Dawro DFBE
function nameOf(file) {
  const base = String(file).replace(/Bible\.xml$/i, '').replace(/\.xml$/i, '');
  const m = /^([A-Z][a-z]+(?:[A-Z][a-z]+)?)(.*)$/.exec(base) || [base, base, ''];
  let language = m[1], version = m[2];
  // a two-word language ("NorthernSotho") stays together only when what follows starts like a version
  const two = /^([A-Z][a-z]+)([A-Z][a-z]+)$/.exec(language);
  if (two && !['Sotho', 'Ndebele', 'Creole', 'Malay', 'Arabic', 'Quechua', 'Nahuatl', 'Zapotec', 'Mixtec', 'Otomi'].includes(two[2])) { language = two[1]; version = two[2] + version; }
  return { language: language.replace(/([a-z])([A-Z])/g, '$1 $2'), version: version.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').trim() };
}

function makeSiteBibles(app) {
  const docOf = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted && d.type === 'bible' ? d : null; };
  const mem = new Map();            // id → the text (a few kept in memory)
  async function list() {
    return (await app.store.listType('bible')).filter((d) => !d.deleted).map((d) => ({ id: d.id, ...d.data, file: undefined })).sort((a, b) => (a.language || '').localeCompare(b.language || '') || a.name.localeCompare(b.name));
  }
  async function load(id) {
    if (mem.has(id)) return mem.get(id);
    const d = await docOf(id);
    if (!d) return null;
    const buf = await app.blobs.get({ id: d.id, team: '', data: { file: d.data.file } });
    if (!buf) return null;
    const b = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
    if (mem.size >= 4) mem.delete(mem.keys().next().value);
    mem.set(id, b);
    return b;
  }
  // a verse (or a few) for the verse of the day
  async function passage(id, refText) {
    const b = await load(id), d = await docOf(id);
    if (!b || !d) return null;
    const ref = W.parseRef(refText);
    if (!ref) return null;
    const book = b.books.find((x) => x.n === ref.book);
    if (!book) return null;
    const verses = [];
    for (const p of ref.parts) for (let c = p.c1; c <= p.c2; c++) {
      const ch = book.chapters[c - 1]; if (!ch) continue;
      const from = c === p.c1 ? p.v1 : 1, to = c === p.c2 ? Math.min(p.v2, ch.length) : ch.length;
      for (let v = from; v <= to; v++) if (ch[v - 1]) verses.push(ch[v - 1]);
    }
    if (!verses.length) return null;
    const lang = /^afrikaans/i.test(d.data.language || '') ? 'af' : 'en';
    return { ref: W.refLabel(ref, lang), text: verses.join(' '), translation: d.data.name, copyright: d.data.copyright || '', language: d.data.language || '' };
  }

  // ---- the Beblia collection: what is in it (once a day from GitHub)
  let cat = null;
  async function catalog() {
    if (cat && cat.at > Date.now() - 86400e3) return cat.list;
    const base = (app.config.beblia && app.config.beblia.api) || 'https://api.github.com';
    const r = await fetch(`${base}/repos/${REPO}/git/trees/${BRANCH}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'RFP-Manager' }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!r || !r.ok) fail(502, 'Could not reach the Bible collection on GitHub just now. Try again in a minute.');
    const j = await r.json();
    const list = (j.tree || []).filter((t) => t.type === 'blob' && /\.xml$/i.test(t.path) && !t.path.includes('/')).map((t) => ({ file: t.path, size: t.size || 0, ...nameOf(t.path) }));
    cat = { at: Date.now(), list };
    return list;
  }
  async function save(parsed, { name, language, copyright, link, source, by }) {
    const books = parsed.books.filter((b) => b.n >= 1 && b.n <= 66 && b.chapters.some((c) => c && c.length));
    if (books.length < 1) fail(400, 'No Bible books were found in that file');
    const title = String(name || parsed.name || 'Bible').trim().slice(0, 100);
    const id = 'bible_' + (slug(title) || 'bible').slice(0, 50);
    const verses = books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + (c || []).filter(Boolean).length, 0), 0);
    const buf = zlib.gzipSync(JSON.stringify({ name: title, books }), { level: 9 });
    const file = id + '.json.gz';
    await app.blobs.put({ id, team: '', data: { file } }, buf);
    mem.delete(id);
    const doc = await app.save('', 'bible', id, { name: title, language: String(language || '').slice(0, 40), copyright: String(copyright || parsed.status || '').slice(0, 300), link: String(link || parsed.link || '').slice(0, 300),
      source: String(source || '').slice(0, 200), books: books.length, verses, size: buf.length, file, addedBy: by || '', addedAt: Date.now() }, '');
    log(`Bibles on the website: ${title} added (${verses} verses)`);
    return { id: doc.id, ...doc.data };
  }
  // from the collection: one file, which the site admin confirmed the website may use
  async function addFromBeblia(file, { by } = {}) {
    if (!/^[\w.-]{3,120}\.xml$/i.test(String(file || ''))) fail(400, 'Pick a Bible from the list');
    const raw = (app.config.beblia && app.config.beblia.raw) || 'https://raw.githubusercontent.com';
    const r = await fetch(`${raw}/${REPO}/${BRANCH}/${encodeURIComponent(file)}`, { signal: AbortSignal.timeout(120000) }).catch(() => null);
    if (!r || !r.ok) fail(502, 'Could not download that Bible. Try again in a minute.');
    const text = await r.text();
    const parsed = /<bible\b/i.test(text.slice(0, 2000)) ? fromBeblia(text) : read(text);
    const n = nameOf(file);
    return save(parsed, { name: parsed.name || `${n.language} ${n.version}`.trim(), language: n.language, source: `github.com/${REPO} (${file})`, by });
  }
  // from a file the site admin has (OSIS, Zefania, USFM, JSON, or Beblia XML)
  async function addFromFile(name, text, { language, copyright, by } = {}) {
    const parsed = /<bible\b/i.test(String(text).slice(0, 2000)) ? fromBeblia(text) : read(text);
    return save(parsed, { name: name || parsed.name, language, copyright, source: 'Uploaded file', by });
  }
  async function remove(id) {
    const d = await docOf(id);
    if (!d) fail(404, 'That Bible is not on the website');
    await app.put({ ...d, deleted: true, updatedAt: Math.max(Date.now(), d.updatedAt + 1) });
    mem.delete(id);
  }
  return { list, load, passage, catalog, addFromBeblia, addFromFile, remove, fromBeblia, nameOf };
}

module.exports = { makeSiteBibles, fromBeblia, nameOf };
