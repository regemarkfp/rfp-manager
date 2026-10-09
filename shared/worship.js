/* RFP Manager – worship: turning songs, scripture and text into slides, reading song files, reading Bible references.
   Runs in the browser (worship control, song import) and in Node (outputs, tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Worship = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------------------------------ lyrics -> sections -> slides
  // A section heading is anything in [brackets] on its own line, or a bare "Verse 2" / "Pre-Chorus" / "Bridge (x2)" line.
  const KEYWORD = '(?:verse|chorus|pre[- ]?chorus|bridge|tag|intro|outro|ending|interlude|instrumental|refrain|vamp|turnaround|koor|vers|brug|refrein)';
  const SECTION = new RegExp('^\\s*(?:\\[\\s*([^\\]\\n]{1,30}?)\\s*\\]|(' + KEYWORD + '(?:\\s*\\d+[a-z]?)?(?:\\s*\\([^)]{1,12}\\))?))\\s*:?\\s*$', 'i');
  const GROUP_COLOURS = { verse: '#3b82f6', chorus: '#e5484d', prechorus: '#f59e0b', bridge: '#a855f7', tag: '#14b8a6', intro: '#6b7280', outro: '#6b7280', ending: '#6b7280', interlude: '#6b7280', instrumental: '#6b7280', refrain: '#e5484d', vamp: '#14b8a6', turnaround: '#6b7280', koor: '#e5484d', vers: '#3b82f6', brug: '#a855f7', refrein: '#e5484d' };
  const groupOf = (label) => { const k = String(label || '').toLowerCase().replace(/[^a-z]/g, ''); for (const g of Object.keys(GROUP_COLOURS)) if (k.startsWith(g)) return g; return ''; };
  const colourOf = (label) => GROUP_COLOURS[groupOf(label)] || '#4b5563';
  const clean = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n');
  // Chords written as [G] or [Am7/E] inside a lyric line are for the band, not the screen.
  const stripChords = (line) => line.replace(/\[[A-G][#b]?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G][#b]?)?\]/g, '').replace(/\s{2,}/g, ' ').trimEnd();

  /** "[Verse 1]\nline\nline\n\n[Chorus]\n…" -> [{ label, lines[] }]. A blank line inside a section starts a new slide of the same section. */
  function parseLyrics(text) {
    const out = [];
    let cur = null;
    const push = (label) => { cur = { label, lines: [] }; out.push(cur); };
    for (const raw of clean(text).split('\n')) {
      const line = raw.trimEnd();
      const m = SECTION.exec(line);
      if (m && line.length < 40 && !/^\s*\[[A-G][#b]?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G][#b]?)?\]\s*$/.test(line)) { push((m[1] || m[2]).trim().replace(/\s+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())); continue; }
      if (!line.trim()) { if (cur && cur.lines.length) cur = null; continue; }
      if (!cur) { const prev = out[out.length - 1]; push(prev ? prev.label : ''); }
      cur.lines.push(stripChords(line));
    }
    return out.filter((s) => s.lines.length);
  }

  /** Split a block of lines into slides of at most `max` lines, keeping pairs together where it can. */
  function chunk(lines, max) {
    max = Math.max(1, Number(max) || 4);
    if (lines.length <= max) return [lines];
    const parts = Math.ceil(lines.length / max), size = Math.ceil(lines.length / parts), out = [];
    for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
    return out;
  }

  /** Slides for a song: [{ label, group, colour, lines[] }], sections longer than `linesPerSlide` are split. */
  function songSlides(song, opts) {
    const max = (opts && opts.linesPerSlide) || 4, slides = [];
    for (const sec of parseLyrics(song && song.lyrics)) for (const part of chunk(sec.lines, max)) slides.push({ label: sec.label, group: groupOf(sec.label), colour: colourOf(sec.label), lines: part });
    return slides;
  }

  /** Slides from free text: a blank line starts a new slide. A first line ending in ":" or written "# Title" is the slide's label. */
  function textSlides(text, opts) {
    const slides = [];
    for (const block of clean(text).split(/\n\s*\n/)) {
      let lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
      if (!lines.length) continue;
      let label = '';
      if (/^#\s*/.test(lines[0])) { label = lines[0].replace(/^#\s*/, ''); lines = lines.slice(1); }
      slides.push({ label, group: '', colour: (opts && opts.colour) || '#4b5563', lines });
    }
    return slides;
  }

  const copyrightLine = (song, licence) => {
    if (!song) return '';
    const parts = [];
    if (song.title) parts.push(`"${song.title}"${song.author ? ' – ' + song.author : ''}`);
    if (song.copyright) parts.push(/^\s*(©|\(c\)|public domain)/i.test(song.copyright) ? song.copyright.trim() : '© ' + song.copyright.trim());
    if (licence) parts.push('CCLI Licence No. ' + licence);
    return parts.join('  ·  ');
  };

  /** Everything a service item puts on screen. `ctx.song(id)` returns the song record; `ctx.licence` is the CCLI licence number. */
  function itemSlides(item, ctx) {
    ctx = ctx || {};
    if (!item) return [];
    const look = ctx.look || {};
    if (item.kind === 'song') {
      const song = ctx.song ? ctx.song(item.song) : null;
      if (!song) return [];
      const footer = ctx.showCopyright === false ? '' : copyrightLine(song, ctx.licence);
      const slides = songSlides(song, { linesPerSlide: look.linesPerSlide });
      // CCLI asks for the copyright line to be shown; the first and last slide is the usual place.
      return slides.map((s, i) => Object.assign(s, { kind: 'song', footer: i === 0 || i === slides.length - 1 ? footer : '', caption: '' }));
    }
    if (item.kind === 'scripture') return textSlides(item.text, { colour: '#0ea5e9' }).map((s) => Object.assign(s, { kind: 'scripture', caption: s.label || item.ref || '', label: s.label || item.ref || '', footer: item.bibleName || '' }));
    if (item.kind === 'media') return [{ kind: 'media', label: item.title || 'Media', group: '', colour: '#10b981', lines: [], image: item.image || '', clip: item.clip || '', caption: '', footer: '' }];
    if (item.kind === 'header') return [];
    return textSlides(item.text).map((s) => Object.assign(s, { kind: 'text', caption: '', footer: '' }));
  }

  // ------------------------------------------------------------------------------------------ song files
  const KNOWN_TAIL = /^(ccli song ?#|ccli licen[cs]e ?#|©|\(c\)|copyright|for use solely|all rights reserved|note: reproduction|songselect)/i;

  /** SongSelect lyrics text file: title, sections, then author / copyright / "CCLI Song # 123" at the foot. */
  function parseSongSelectText(text) {
    const lines = clean(text).replace(/^﻿/, '').split('\n').map((l) => l.trimEnd());
    while (lines.length && !lines[0].trim()) lines.shift();
    const song = { title: (lines.shift() || '').trim(), author: '', copyright: '', ccliNumber: '', lyrics: '' };
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) { const m = /^ccli song ?#\s*(\d+)/i.exec(lines[i].trim()); if (m) { song.ccliNumber = m[1]; end = i; break; } }
    const tail = lines.slice(end + 1).map((l) => l.trim()).filter(Boolean);
    const body = lines.slice(0, end);
    while (body.length && !body[body.length - 1].trim()) body.pop();
    // The writers sit on their own line between the lyrics and the "CCLI Song #" line.
    if (end < lines.length && body.length > 1 && !body[body.length - 2].trim() && !SECTION.test(body[body.length - 1].trim())) song.author = body.pop().trim().replace(/\s*\|\s*/g, ', ');
    // Older exports put the credits above the "CCLI Song #" line instead of below it.
    const foot = tail.length ? tail : [];
    for (const l of foot) {
      if (/^(©|\(c\)|copyright)/i.test(l)) song.copyright = l.replace(/^(©|\(c\)|copyright)\s*/i, '').trim();
      else if (!KNOWN_TAIL.test(l) && !song.author) song.author = l.replace(/\s*\|\s*/g, ', ');
    }
    const out = [];
    for (const l of body) {
      if (SECTION.test(l.trim()) && l.trim().length < 40) out.push((out.length ? '\n' : '') + '[' + l.trim().replace(/^\[|\]$/g, '') + ']');
      else out.push(l);
    }
    song.lyrics = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return song;
  }

  /** SongSelect ".usr" file: an ini-style file with Fields= (section names, /t separated) and Words= (sections /t separated, lines /n separated). */
  function parseUsr(text) {
    const get = (k) => { const m = new RegExp('^' + k + '=(.*)$', 'mi').exec(clean(text)); return m ? m[1].trim() : ''; };
    const titleM = /^\[S A(\d+)\]/m.exec(clean(text));
    const fields = get('Fields').split('/t'), words = get('Words').split('/t');
    const lyrics = fields.map((f, i) => `[${f.trim()}]\n${(words[i] || '').split('/n').map((l) => l.trim()).join('\n')}`).join('\n\n');
    return { title: get('Title'), author: get('Author').replace(/\s*\|\s*/g, ', '), copyright: get('Copyright').replace(/^©\s*/, ''), ccliNumber: titleM ? titleM[1] : (/\[S A(\d+)\]/.exec(get('Admin')) || [])[1] || '', key: get('Keys'), themes: get('Themes').replace(/\/t/g, ', '), lyrics: lyrics.trim() };
  }

  /** ChordPro: {title: …}, {artist: …}, {ccli: …}, {start_of_chorus}, chords in [brackets] (dropped for the screen). */
  function parseChordPro(text) {
    const song = { title: '', author: '', copyright: '', ccliNumber: '', key: '', lyrics: '' }, out = [];
    for (const raw of clean(text).split('\n')) {
      const d = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i.exec(raw);
      if (!d) { if (!/^\s*#/.test(raw)) out.push(stripChords(raw)); continue; }
      const k = d[1].toLowerCase(), v = d[2] || '';
      if (k === 'title' || k === 't') song.title = v;
      else if (k === 'artist' || k === 'composer' || k === 'author' || k === 'subtitle' || k === 'st') { if (!song.author) song.author = v; }
      else if (k === 'copyright') song.copyright = v.replace(/^(©|\(c\))\s*/i, '');
      else if (k === 'ccli') song.ccliNumber = v.replace(/\D/g, '');
      else if (k === 'key') song.key = v;
      else if (k === 'comment' || k === 'c' || k === 'ci') { if (SECTION.test(v)) out.push('', '[' + v + ']'); }
      else if (/^(start_of_|so)/.test(k)) { const name = k.replace(/^start_of_/, '').replace(/^so([cvb])$/, (_, c) => ({ c: 'chorus', v: 'verse', b: 'bridge' })[c]); out.push('', '[' + (v || name.charAt(0).toUpperCase() + name.slice(1)) + ']'); }
      else if (/^(end_of_|eo)/.test(k)) out.push('');
    }
    song.lyrics = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return song;
  }

  /** Works out which kind of song file this is and reads it. */
  function parseSongFile(name, text) {
    const t = clean(text);
    const ext = String(name || '').toLowerCase().split('.').pop();
    let song;
    if (ext === 'usr' || /^\[File\]/m.test(t) && /^Words=/m.test(t)) song = parseUsr(t);
    else if (['cho', 'chopro', 'chordpro', 'crd', 'pro'].includes(ext) || /^\s*\{(title|t)\s*:/mi.test(t)) song = parseChordPro(t);
    else song = parseSongSelectText(t);
    if (!song.title) song.title = String(name || 'Song').replace(/\.[^.]+$/, '');
    return song;
  }

  // ------------------------------------------------------------------------------------------ Bible references
  // The 66 books in Protestant order: [English name, Afrikaans name, other abbreviations…]
  const BOOKS = [
    ['Genesis', 'Genesis', 'gen', 'ge', 'gn'], ['Exodus', 'Eksodus', 'ex', 'exo', 'eks'], ['Leviticus', 'Levitikus', 'lev', 'lv'], ['Numbers', 'Numeri', 'num', 'nm', 'nu'], ['Deuteronomy', 'Deuteronomium', 'deut', 'dt', 'deu'],
    ['Joshua', 'Josua', 'josh', 'jos'], ['Judges', 'Rigters', 'judg', 'jdg', 'rig'], ['Ruth', 'Rut', 'ru', 'rth'], ['1 Samuel', '1 Samuel', '1sam', '1sa', '1sm'], ['2 Samuel', '2 Samuel', '2sam', '2sa', '2sm'],
    ['1 Kings', '1 Konings', '1kgs', '1ki', '1kon'], ['2 Kings', '2 Konings', '2kgs', '2ki', '2kon'], ['1 Chronicles', '1 Kronieke', '1chr', '1ch', '1kron'], ['2 Chronicles', '2 Kronieke', '2chr', '2ch', '2kron'],
    ['Ezra', 'Esra', 'ezr', 'esr'], ['Nehemiah', 'Nehemia', 'neh', 'ne'], ['Esther', 'Ester', 'est', 'esth'], ['Job', 'Job', 'jb'], ['Psalms', 'Psalms', 'ps', 'psalm', 'psa', 'pss'], ['Proverbs', 'Spreuke', 'prov', 'pr', 'spr'],
    ['Ecclesiastes', 'Prediker', 'eccl', 'ecc', 'pred', 'qoh'], ['Song of Solomon', 'Hooglied', 'song', 'sos', 'songofsongs', 'hoogl', 'canticles'], ['Isaiah', 'Jesaja', 'isa', 'is', 'jes'], ['Jeremiah', 'Jeremia', 'jer', 'je'],
    ['Lamentations', 'Klaagliedere', 'lam', 'la', 'klaagl'], ['Ezekiel', 'Esegiel', 'ezek', 'eze', 'ezk', 'eseg'], ['Daniel', 'Daniel', 'dan', 'da', 'dn'], ['Hosea', 'Hosea', 'hos', 'ho'], ['Joel', 'Joel', 'jl'], ['Amos', 'Amos', 'am'],
    ['Obadiah', 'Obadja', 'obad', 'ob'], ['Jonah', 'Jona', 'jon', 'jnh'], ['Micah', 'Miga', 'mic', 'mi', 'mig'], ['Nahum', 'Nahum', 'nah', 'na'], ['Habakkuk', 'Habakuk', 'hab'], ['Zephaniah', 'Sefanja', 'zeph', 'zep', 'sef'],
    ['Haggai', 'Haggai', 'hag', 'hg'], ['Zechariah', 'Sagaria', 'zech', 'zec', 'sag'], ['Malachi', 'Maleagi', 'mal', 'ml'],
    ['Matthew', 'Matteus', 'matt', 'mt', 'mat'], ['Mark', 'Markus', 'mk', 'mrk', 'mar'], ['Luke', 'Lukas', 'lk', 'luk', 'lu'], ['John', 'Johannes', 'jn', 'jhn', 'joh'], ['Acts', 'Handelinge', 'act', 'ac', 'hand'],
    ['Romans', 'Romeine', 'rom', 'ro', 'rm'], ['1 Corinthians', '1 Korintiers', '1cor', '1co', '1kor', '1korinthiers'], ['2 Corinthians', '2 Korintiers', '2cor', '2co', '2kor', '2korinthiers'], ['Galatians', 'Galasiers', 'gal', 'ga'],
    ['Ephesians', 'Efesiers', 'eph', 'ef', 'efes'], ['Philippians', 'Filippense', 'phil', 'php', 'fil'], ['Colossians', 'Kolossense', 'col', 'kol'], ['1 Thessalonians', '1 Tessalonisense', '1thess', '1th', '1tess', '1thessalonicense'],
    ['2 Thessalonians', '2 Tessalonisense', '2thess', '2th', '2tess', '2thessalonicense'], ['1 Timothy', '1 Timoteus', '1tim', '1ti', '1timotheus'], ['2 Timothy', '2 Timoteus', '2tim', '2ti', '2timotheus'], ['Titus', 'Titus', 'tit', 'ti'],
    ['Philemon', 'Filemon', 'phlm', 'phm', 'filem'], ['Hebrews', 'Hebreers', 'heb'], ['James', 'Jakobus', 'jas', 'jm', 'jak'], ['1 Peter', '1 Petrus', '1pet', '1pe', '1pt'], ['2 Peter', '2 Petrus', '2pet', '2pe', '2pt'],
    ['1 John', '1 Johannes', '1jn', '1jo', '1joh'], ['2 John', '2 Johannes', '2jn', '2jo', '2joh'], ['3 John', '3 Johannes', '3jn', '3jo', '3joh'], ['Jude', 'Judas', 'jud', 'jd'], ['Revelation', 'Openbaring', 'rev', 're', 'op', 'openb', 'apocalypse'],
  ];
  const USFM_IDS = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
  const OSIS_IDS = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev'.split(' ');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(i{1,3})\s+(?=[a-z])/, (m, r) => r.length + '').replace(/^(first|second|third|eerste|tweede|derde)\s+/, (m, w) => ({ first: 1, eerste: 1, second: 2, tweede: 2, third: 3, derde: 3 })[w] + '').replace(/[^a-z0-9]/g, '');
  let index = null;
  function bookIndex() {
    if (index) return index;
    index = new Map();
    BOOKS.forEach((names, i) => { names.forEach((n) => index.set(norm(n), i + 1)); index.set(norm(USFM_IDS[i]), i + 1); index.set(norm(OSIS_IDS[i]), i + 1); });
    return index;
  }
  /** Book number 1–66 for a name in English or Afrikaans, an abbreviation, or the start of a name ("Joh", "1 Kor", "Rev"). 0 when unknown. */
  function bookNumber(name) {
    const k = norm(name), ix = bookIndex();
    if (!k) return 0;
    if (ix.has(k)) return ix.get(k);
    let hit = 0;
    for (let i = 0; i < BOOKS.length; i++) for (const n of BOOKS[i].slice(0, 2)) if (norm(n).startsWith(k) && k.length >= 2) { if (hit && hit !== i + 1) return hit; hit = hit || i + 1; }
    return hit;
  }
  const bookName = (n, lang) => (BOOKS[n - 1] ? BOOKS[n - 1][lang === 'af' ? 1 : 0] : '');

  /** "John 3:16-18", "Joh 3:16", "Ps 23", "1 Kor 13:4-7", "Rom 8:38-9:1", "Gen 1:1,3,5-7" -> { book, parts: [{ c1, v1, c2, v2 }] } or null. */
  function parseRef(text) {
    const m = /^\s*((?:[1-3]|i{1,3})?\s*[^\d:]+?)\.?\s*(\d.*)?$/i.exec(String(text || '').trim());
    if (!m) return null;
    const book = bookNumber(m[1]);
    if (!book) return null;
    const rest = (m[2] || '1').replace(/\s+/g, '').replace(/[–—]/g, '-').replace(/\./g, ':');
    const parts = [];
    let chapter = 0;
    for (const seg of rest.split(/[,;]/)) {
      if (!seg) continue;
      const r = /^(?:(\d+):)?(\d+)(?:-(?:(\d+):)?(\d+))?$/.exec(seg);
      if (!r) return null;
      if (r[1]) { chapter = +r[1]; parts.push({ c1: chapter, v1: +r[2], c2: r[3] ? +r[3] : chapter, v2: r[4] ? +r[4] : +r[2] }); if (r[3]) chapter = +r[3]; }
      else if (chapter) parts.push({ c1: chapter, v1: +r[2], c2: chapter, v2: r[4] ? +r[4] : +r[2] });                 // "…,18" continues the chapter
      else if (r[4] && !r[3]) { parts.push({ c1: +r[2], v1: 1, c2: +r[4], v2: 999 }); }                                // "Ps 23-24"
      else { chapter = 0; parts.push({ c1: +r[2], v1: 1, c2: +r[2], v2: 999 }); }                                       // whole chapter
    }
    return parts.length ? { book, parts } : null;
  }

  /** Verses [{ c, v, text }] -> slide text: verses are grouped until a slide reaches about `maxChars`; each slide is labelled with its reference. */
  function scriptureText(bookLabel, verses, opts) {
    const max = (opts && opts.maxChars) || 260, numbers = !(opts && opts.verseNumbers === false), blocks = [];
    let cur = null;
    const refOf = (b) => `${bookLabel} ${b.c}:${b.from}${b.to !== b.from ? '-' + b.to : ''}`;
    for (const x of verses) {
      const piece = (numbers ? x.v + ' ' : '') + String(x.text).trim();
      if (cur && cur.c === x.c && cur.text.length + piece.length + 1 <= max) { cur.text += ' ' + piece; cur.to = x.v; }
      else { cur = { c: x.c, from: x.v, to: x.v, text: piece }; blocks.push(cur); }
    }
    return blocks.map((b) => `# ${refOf(b)}\n${b.text}`).join('\n\n');
  }
  function refLabel(ref, lang) {
    if (!ref) return '';
    return bookName(ref.book, lang) + ' ' + ref.parts.map((p, i) => {
      const whole = p.v1 === 1 && p.v2 === 999;
      const a = whole ? String(p.c1) : (i && ref.parts[i - 1].c2 === p.c1 ? '' : p.c1 + ':') + p.v1;
      const b = whole ? (p.c2 !== p.c1 ? '-' + p.c2 : '') : p.c2 !== p.c1 ? `-${p.c2}:${p.v2}` : p.v2 !== p.v1 ? '-' + p.v2 : '';
      return a + b;
    }).join(',');
  }

  return { parseLyrics, songSlides, textSlides, itemSlides, copyrightLine, colourOf, groupOf, chunk,
    parseSongFile, parseSongSelectText, parseUsr, parseChordPro,
    BOOKS, USFM_IDS, OSIS_IDS, bookNumber, bookName, parseRef, refLabel, scriptureText };
});
