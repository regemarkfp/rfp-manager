'use strict';
// Verse of the day for the dashboard: a verse picked at random for each day (the same for everyone that day).
// The text comes from a Bible on this machine (worship control), else from bible-api.com (King James Version,
// public domain). Kept for the day.
const { makeBibles } = require('./bible');
const { log } = require('./util');

// Well-known verses (references only); one is picked per day.
const REFS = ['Genesis 1:1', 'Genesis 28:15', 'Exodus 14:14', 'Exodus 15:2', 'Numbers 6:24-26', 'Deuteronomy 31:6', 'Deuteronomy 31:8', 'Joshua 1:9', '1 Samuel 16:7', '2 Samuel 22:31',
  '1 Chronicles 16:11', '2 Chronicles 7:14', 'Nehemiah 8:10', 'Psalm 1:1-2', 'Psalm 16:8', 'Psalm 18:2', 'Psalm 19:14', 'Psalm 23:1', 'Psalm 27:1', 'Psalm 28:7', 'Psalm 34:8', 'Psalm 37:4',
  'Psalm 37:5', 'Psalm 46:1', 'Psalm 46:10', 'Psalm 55:22', 'Psalm 56:3', 'Psalm 62:1', 'Psalm 73:26', 'Psalm 84:11', 'Psalm 90:12', 'Psalm 91:1', 'Psalm 91:11', 'Psalm 100:4', 'Psalm 103:2',
  'Psalm 107:1', 'Psalm 118:24', 'Psalm 119:105', 'Psalm 121:1-2', 'Psalm 127:1', 'Psalm 136:1', 'Psalm 139:14', 'Psalm 143:8', 'Psalm 145:18', 'Psalm 147:3', 'Proverbs 3:5-6', 'Proverbs 4:23',
  'Proverbs 16:3', 'Proverbs 16:9', 'Proverbs 17:17', 'Proverbs 18:10', 'Proverbs 22:6', 'Proverbs 27:17', 'Ecclesiastes 3:1', 'Ecclesiastes 4:9', 'Isaiah 26:3', 'Isaiah 40:8', 'Isaiah 40:29',
  'Isaiah 40:31', 'Isaiah 41:10', 'Isaiah 43:2', 'Isaiah 55:8', 'Jeremiah 29:11', 'Jeremiah 33:3', 'Lamentations 3:22-23', 'Micah 6:8', 'Nahum 1:7', 'Zephaniah 3:17', 'Habakkuk 3:19',
  'Matthew 5:9', 'Matthew 5:14', 'Matthew 5:16', 'Matthew 6:33', 'Matthew 6:34', 'Matthew 7:7', 'Matthew 11:28', 'Matthew 19:26', 'Matthew 28:20', 'Mark 9:23', 'Mark 10:27', 'Mark 11:24',
  'Luke 1:37', 'Luke 6:31', 'Luke 12:34', 'John 1:5', 'John 3:16', 'John 8:12', 'John 10:10', 'John 13:34', 'John 14:6', 'John 14:27', 'John 15:5', 'John 15:13', 'John 16:33', 'Acts 1:8',
  'Acts 20:35', 'Romans 5:8', 'Romans 8:28', 'Romans 8:31', 'Romans 12:2', 'Romans 12:12', 'Romans 15:13', '1 Corinthians 10:13', '1 Corinthians 13:4', '1 Corinthians 15:58', '1 Corinthians 16:14',
  '2 Corinthians 4:16', '2 Corinthians 5:7', '2 Corinthians 5:17', '2 Corinthians 12:9', 'Galatians 2:20', 'Galatians 5:22-23', 'Galatians 6:9', 'Ephesians 2:8', 'Ephesians 3:20', 'Ephesians 4:32',
  'Ephesians 6:10', 'Philippians 1:6', 'Philippians 4:6', 'Philippians 4:7', 'Philippians 4:8', 'Philippians 4:13', 'Philippians 4:19', 'Colossians 3:2', 'Colossians 3:23', '1 Thessalonians 5:11',
  '1 Thessalonians 5:16-18', '2 Timothy 1:7', '2 Timothy 3:16', 'Hebrews 4:16', 'Hebrews 10:24', 'Hebrews 11:1', 'Hebrews 12:1', 'Hebrews 13:5', 'Hebrews 13:8', 'James 1:5', 'James 1:17',
  'James 4:8', '1 Peter 4:10', '1 Peter 5:7', '1 John 1:9', '1 John 4:8', '1 John 4:18', '1 John 4:19', 'Revelation 21:4'];

// the same pick all day, a different one tomorrow
function pick(date) {
  let h = 2166136261;
  for (const c of 'rfp-verse-' + date) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return REFS[h % REFS.length];
}

// translations from bible-api.com (public domain or free to use), with their language
const API = [['kjv', 'King James Version', 'English'], ['web', 'World English Bible', 'English'], ['webbe', 'World English Bible (British)', 'English'], ['bbe', 'Bible in Basic English', 'English'],
  ['oeb-us', 'Open English Bible', 'English'], ['almeida', 'João Ferreira de Almeida', 'Portuguese'], ['rccv', 'Romanian Corrected Cornilescu', 'Romanian'], ['clementine', 'Clementine Latin Vulgate', 'Latin']];

function makeVerse(app) {
  const bibles = makeBibles(app);
  const mem = new Map();
  // what a person can pick: the Bibles on this machine (any language you are licensed for), then the online ones
  // the website's Bibles (lib/sitebibles.js): here on the website, or asked of the website from a production PC
  const siteUrl = () => String((app.config.cloud && app.config.cloud.url) || app.config.defaultCloudUrl || '').replace(/\/+$/, '');
  let remoteList = null;
  async function siteList() {
    if (app.siteBibles && !app.isLocal) return (await app.siteBibles.list()).map((b) => ({ id: 'site:' + b.id, name: b.name, language: b.language || '', copyright: b.copyright || '', where: 'website' }));
    if (!siteUrl()) return [];
    if (remoteList && remoteList.at > Date.now() - 3600e3) return remoteList.list;
    try {
      const r = await fetch(siteUrl() + '/api/public/bibles', { signal: AbortSignal.timeout(8000) });
      const list = r.ok ? ((await r.json()).list || []).map((b) => ({ id: 'site:' + b.id, name: b.name, language: b.language || '', copyright: b.copyright || '', where: 'website' })) : [];
      remoteList = { at: Date.now(), list };
      return list;
    } catch { return (remoteList && remoteList.list) || []; }
  }
  async function translations() {
    const local = bibles.list().map((b) => ({ id: 'local:' + b.id, name: b.name, language: b.lang === 'af' ? 'Afrikaans' : b.lang === 'en' ? 'English' : '', where: 'this machine' }));
    return [...(await siteList()), ...local, ...API.map(([id, name, language]) => ({ id: 'api:' + id, name, language, where: 'online' }))];
  }
  async function fromSite(id, ref, date) {
    if (app.siteBibles && !app.isLocal) {
      const p = await app.siteBibles.passage(id, ref).catch(() => null);
      return p ? { date, ref: p.ref, text: p.text, translation: p.translation, copyright: p.copyright, id: 'site:' + id } : null;
    }
    if (!siteUrl()) return null;
    try {
      const r = await fetch(`${siteUrl()}/api/public/verse?date=${date}&t=${encodeURIComponent('site:' + id)}`, { signal: AbortSignal.timeout(8000) });
      const j = r.ok ? await r.json() : null;
      return j && j.text && j.id === 'site:' + id ? j : null;
    } catch { return null; }
  }
  async function fromLocal(id, ref, date) {
    const b = bibles.list().find((x) => x.id === id);
    if (!b) return null;
    try { const p = bibles.passage(b.id, ref, { verseNumbers: false, maxChars: 2000 }); return { date, ref: p.ref, text: p.verses.map((v) => v.text).join(' '), translation: b.name, id: 'local:' + b.id }; } catch { return null; }
  }
  async function fromApi(code, ref, date) {
    if (app.config.verse === false) return null;
    try {
      const base = (app.config.verseUrl || 'https://bible-api.com').replace(/\/+$/, '');
      const r = await fetch(`${base}/${encodeURIComponent(ref)}?translation=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const j = await r.json();
      return j.text ? { date, ref: j.reference || ref, text: String(j.text).replace(/\s+/g, ' ').trim(), translation: j.translation_name || (API.find((a) => a[0] === code) || [])[1] || code, id: 'api:' + code } : null;
    } catch (e) { log('Verse of the day:', e.message); return null; }
  }
  // date: the person's own day (their computer works it out, with the time their day turns over); want: a translation id
  async function today(date = new Date().toISOString().slice(0, 10), want = '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) date = new Date().toISOString().slice(0, 10);
    want = /^(local|api|site):[\w.-]{1,70}$/.test(String(want || '')) ? String(want) : '';
    const key = `verse:${date}:${want || 'default'}`;
    if (mem.has(key)) return mem.get(key);
    const kept = await app.store.kvGet(key).catch(() => null) || (!want ? await app.store.kvGet('verse:' + date).catch(() => null) : null);
    if (kept) { mem.set(key, kept); return kept; }
    const ref = pick(date);
    let out = null;
    if (want.startsWith('site:')) out = await fromSite(want.slice(5), ref, date);
    else if (want.startsWith('local:')) out = await fromLocal(want.slice(6), ref, date);
    else if (want.startsWith('api:')) out = await fromApi(want.slice(4), ref, date);
    // the default (or the chosen one is not there): a Bible on this machine, else the King James Version online
    if (!out) for (const b of bibles.list()) { out = await fromLocal(b.id, ref, date); if (out) break; }
    if (!out) out = await fromApi('kjv', ref, date);
    if (!out) return { date, ref, text: '', translation: '' };          // offline: the reference only, try again later
    if (mem.size > 500) mem.clear();
    mem.set(key, out);
    await app.store.kvSet(key, out).catch(() => {});
    return out;
  }
  return { today, pick, translations };
}

module.exports = { makeVerse, pick, REFS };
