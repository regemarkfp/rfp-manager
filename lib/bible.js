'use strict';
// Bibles on this machine: one JSON file per translation in <data>/bibles. Nothing copyrighted ships with the app;
// the King James Version can be downloaded (public domain) and any translation you are licensed for can be imported.
const fs = require('node:fs');
const path = require('node:path');
const W = require('../shared/worship');
const { fail, slug, log } = require('./util');

const KJV_URL = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/KJV.json';
const decode = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag); return m ? m[1] : ''; };

// Every reader returns { name, books: [{ n (1-66, 0 = unknown), name, chapters: [[verse text, …], …] }] }
function fromJson(text) {
  const j = JSON.parse(text);
  const books = [];
  const put = (name, chapters) => books.push({ n: W.bookNumber(name), name: String(name || ''), chapters });
  if (j && Array.isArray(j.books)) {                                    // { translation, books: [{ name, chapters: [{ chapter, verses: [{ verse, text }] }] }] }
    for (const b of j.books) {
      const chapters = [];
      for (const c of b.chapters || []) {
        const cn = Number(c.chapter) || chapters.length + 1, vs = [];
        if (Array.isArray(c)) c.forEach((t, i) => { vs[i] = String(t); });
        else for (const v of c.verses || []) vs[(Number(v.verse) || vs.length + 1) - 1] = String(v.text || '');
        chapters[cn - 1] = vs;
      }
      put(b.name || b.book, chapters);
    }
    return { name: String(j.translation || j.name || ''), books };
  }
  if (Array.isArray(j) && j.length && Array.isArray(j[0].chapters)) {   // [{ name | abbrev, chapters: [[text, …], …] }]
    j.forEach((b, i) => { const name = b.name || b.book || b.abbrev || W.bookName(i + 1); books.push({ n: W.bookNumber(name) || (j.length === 66 ? i + 1 : 0), name: String(name), chapters: b.chapters.map((c) => c.map(String)) }); });
    return { name: '', books };
  }
  fail(400, 'That JSON file is not a Bible this app can read');
}
function fromZefania(text) {
  const books = [];
  const re = /<BIBLEBOOK\b([^>]*)>([\s\S]*?)<\/BIBLEBOOK>/gi;
  for (let m; (m = re.exec(text));) {
    const n = Number(attr(m[1], 'bnumber')) || 0, chapters = [];
    const cre = /<CHAPTER\b([^>]*)>([\s\S]*?)<\/CHAPTER>/gi;
    for (let c; (c = cre.exec(m[2]));) {
      const vs = [], vre = /<VERS\b([^>]*)>([\s\S]*?)<\/VERS>/gi;
      for (let v; (v = vre.exec(c[2]));) vs[(Number(attr(v[1], 'vnumber')) || vs.length + 1) - 1] = decode(v[2]);
      chapters[(Number(attr(c[1], 'cnumber')) || chapters.length + 1) - 1] = vs;
    }
    books.push({ n: n >= 1 && n <= 66 ? n : W.bookNumber(attr(m[1], 'bname')), name: attr(m[1], 'bname') || W.bookName(n), chapters });
  }
  return { name: attr((/<XMLBIBLE\b[^>]*>/i.exec(text) || [''])[0], 'biblename'), books };
}
function fromOsis(text) {
  const by = new Map();
  const add = (id, t) => {
    const p = id.split('.');
    if (p.length < 3) return;
    const n = W.OSIS_IDS.indexOf(p[0]) + 1 || W.bookNumber(p[0]);
    if (!by.has(p[0])) by.set(p[0], { n, name: W.bookName(n) || p[0], chapters: [] });
    const b = by.get(p[0]), c = Number(p[1]) - 1, v = Number(p[2]) - 1;
    if (!(c >= 0 && v >= 0)) return;
    (b.chapters[c] = b.chapters[c] || [])[v] = ((b.chapters[c][v] || '') + ' ' + decode(t)).trim();
  };
  const body = text.replace(/<note\b[\s\S]*?<\/note>/gi, '').replace(/<title\b[\s\S]*?<\/title>/gi, '');
  let found = false;
  const re = /<verse\b[^>]*\bosisID="([^"]+)"[^>]*?(?<!\/)>([\s\S]*?)<\/verse>/gi;            // container form
  for (let m; (m = re.exec(body));) { found = true; add(m[1].split(' ')[0], m[2]); }
  if (!found) {                                                                                 // milestone form: <verse sID="Gen.1.1"/> text <verse eID="Gen.1.1"/>
    const ms = /<verse\b[^>]*\bsID="([^"]+)"[^>]*\/>([\s\S]*?)<verse\b[^>]*\beID="[^"]+"[^>]*\/>/gi;
    for (let m; (m = ms.exec(body));) add(m[1].split(' ')[0], m[2]);
  }
  const t = /<title\b[^>]*>([^<]+)<\/title>/i.exec(text);
  return { name: t ? decode(t[1]) : '', books: [...by.values()] };
}
function fromUsfm(text) {
  const books = [];
  let b = null, c = -1, v = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = /^\\id\s+(\w{3})/.exec(line))) { const n = W.USFM_IDS.indexOf(m[1].toUpperCase()) + 1; b = { n, name: W.bookName(n) || m[1], chapters: [] }; books.push(b); c = -1; v = -1; continue; }
    if (!b) continue;
    if ((m = /^\\(?:h|toc2)\s+(.+)$/.exec(line))) { b.name = m[1].trim(); continue; }
    if ((m = /^\\c\s+(\d+)/.exec(line))) { c = +m[1] - 1; b.chapters[c] = b.chapters[c] || []; v = -1; continue; }
    if (c < 0) continue;
    const tidy = (s) => s.replace(/\\f\s[\s\S]*?\\f\*/g, '').replace(/\\x\s[\s\S]*?\\x\*/g, '').replace(/\\\+?[a-z0-9]+\*?/gi, '').replace(/\|[^\\]*$/, '').replace(/\s+/g, ' ').trim();
    if ((m = /^\\v\s+(\d+)\S*\s*(.*)$/.exec(line))) { v = +m[1] - 1; b.chapters[c][v] = tidy(m[2]); continue; }
    if (v >= 0 && /^\\(q\d?|m|p|pi\d?|li\d?|nb)\b/.test(line)) { const t = tidy(line.replace(/^\\\w+\s*/, '')); if (t) b.chapters[c][v] = (b.chapters[c][v] + ' ' + t).trim(); }
    else if (v >= 0 && line && !line.startsWith('\\')) b.chapters[c][v] = (b.chapters[c][v] + ' ' + tidy(line)).trim();
  }
  return { name: '', books };
}
function read(text) {
  const t = String(text).replace(/^﻿/, '').trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return fromJson(t);
  if (/<XMLBIBLE\b/i.test(t.slice(0, 4000))) return fromZefania(t);
  if (/<osis\b/i.test(t.slice(0, 4000))) return fromOsis(t);
  if (/^\\id\s/m.test(t.slice(0, 2000))) return fromUsfm(t);
  fail(400, 'Not a Bible file this app can read. Use OSIS XML, Zefania XML, USFM or JSON.');
}

function makeBibles(app) {
  const dir = () => path.join(app.dataDir(), 'bibles');
  const cache = new Map();
  const file = (id) => path.join(dir(), id + '.json');
  const idOf = (name) => (slug(name) || 'bible').slice(0, 40);

  function list() {
    if (!fs.existsSync(dir())) return [];
    return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => {
      try { const b = load(f.slice(0, -5)); return { id: b.id, name: b.name, lang: b.lang || '', books: b.books.length, verses: b.verses || 0, source: b.source || '' }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }
  function load(id) {
    if (!/^[\w-]{1,60}$/.test(id || '')) fail(404, 'Bible not found');
    if (cache.has(id)) return cache.get(id);
    if (!fs.existsSync(file(id))) fail(404, 'That Bible is not on this machine');
    const b = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    cache.set(id, b);
    return b;
  }
  /** Add a file to a translation. Importing more books under the same name (USFM comes as one file per book) adds to it. */
  function importText(name, text, meta) {
    const parsed = read(text);
    if (!parsed.books.length) fail(400, 'No books were found in that file');
    const title = String(name || parsed.name || 'Bible').trim().slice(0, 80), id = idOf(title);
    let cur = null;
    try { cur = load(id); } catch { /* new translation */ }
    const books = cur ? cur.books.slice() : [];
    for (const b of parsed.books) {
      if (!b.chapters.some((c) => c && c.length)) continue;
      b.chapters = b.chapters.map((c) => (c || []).map((v) => v || ''));
      const i = books.findIndex((x) => (b.n && x.n === b.n) || (!b.n && x.name === b.name));
      if (i >= 0) books[i] = b; else books.push(b);
    }
    books.sort((a, b) => (a.n || 999) - (b.n || 999));
    const verses = books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.filter(Boolean).length, 0), 0);
    const afr = books.filter((b) => /^(eksodus|rigters|spreuke|handelinge|openbaring|romeine)/i.test(b.name)).length;
    const doc = Object.assign({ id, name: title, lang: afr >= 2 ? 'af' : 'en', source: '' }, cur ? { lang: cur.lang, source: cur.source } : {}, meta || {}, { books, verses });
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(file(id), JSON.stringify(doc));
    cache.set(id, doc);
    return { id, name: title, books: books.length, verses, added: parsed.books.length };
  }
  async function downloadKjv() {
    const url = (app.config.worship && app.config.worship.kjvUrl) || KJV_URL;
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(120000) }); } catch (e) { fail(502, 'Could not reach the download address. Check the internet connection on this PC, or import a Bible file instead.'); }
    if (!r.ok) fail(502, `The download address answered ${r.status}. Import a Bible file instead.`);
    const out = importText('King James Version', await r.text(), { lang: 'en', source: 'Public domain. Downloaded from ' + new URL(url).host });
    log(`Bibles: King James Version saved (${out.verses} verses)`);
    return out;
  }
  function remove(id) { load(id); fs.rmSync(file(id)); cache.delete(id); }

  /** "John 3:16-18" -> { ref, label, bible, verses: [{ c, v, text }], text (ready for slides) } */
  function passage(id, refText, opts) {
    const b = load(id), ref = W.parseRef(refText);
    if (!ref) fail(400, 'Could not read that reference. Try "John 3:16-18" or "Ps 23".');
    const book = b.books.find((x) => x.n === ref.book) || (b.books.length === 66 ? b.books[ref.book - 1] : null);
    if (!book) fail(404, `${W.bookName(ref.book)} is not in ${b.name}`);
    const verses = [];
    for (const p of ref.parts) {
      for (let c = p.c1; c <= p.c2; c++) {
        const ch = book.chapters[c - 1];
        if (!ch) continue;
        const from = c === p.c1 ? p.v1 : 1, to = c === p.c2 ? Math.min(p.v2, ch.length) : ch.length;
        for (let v = from; v <= to; v++) if (ch[v - 1]) verses.push({ c, v, text: ch[v - 1] });
      }
    }
    if (!verses.length) fail(404, 'No verses found for that reference');
    const last = verses[verses.length - 1];
    ref.parts.forEach((p) => { if (p.v2 === 999 && !(p.v1 === 1)) p.v2 = last.v; });
    const bookLabel = book.name || W.bookName(ref.book, b.lang);
    const label = bookLabel + W.refLabel(ref, b.lang).slice(W.bookName(ref.book, b.lang).length);
    return { ref: label, bible: b.id, bibleName: b.name, verses, text: W.scriptureText(bookLabel, verses, opts) };
  }
  function search(id, words, limit) {
    const b = load(id), q = String(words || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1), out = [];
    if (!q.length) return out;
    for (const book of b.books) for (let c = 0; c < book.chapters.length; c++) for (let v = 0; v < (book.chapters[c] || []).length; v++) {
      const t = book.chapters[c][v];
      if (t && q.every((w) => t.toLowerCase().includes(w))) { out.push({ ref: `${book.name} ${c + 1}:${v + 1}`, text: t }); if (out.length >= (limit || 30)) return out; }
    }
    return out;
  }
  return { list, load, importText, downloadKjv, remove, passage, search, read };
}

module.exports = { makeBibles, read, KJV_URL };
