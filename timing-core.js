'use strict';
// Timing systems → athletics: reading what photo-finish systems and timers send, and putting it into the meet.
// Pure functions (no network, no files), so they can be tested: lib/timing.js does the listening.
//
// What comes in is turned into messages:
//   { t: 'clock', ms, running }        the race clock (running time from a scoreboard port)
//   { t: 'start' } / { t: 'stop', ms }  the gun / the clock stopped
//   { t: 'event', key, name, num, round, heat, wind }          which race this is about
//   { t: 'startlist', key, name, num, round, heat, entries: [{ lane, bib, name, team }] }
//   { t: 'result', key?, place, lane, bib, name, team, time, reaction }
//   { t: 'results', key, name, num, round, heat, wind, rows: [result…] }
//   { t: 'wind', value }
const Athletics = require('../shared/athletics');

// ---------------------------------------------------------------- times
const TIME_RE = /^(?:\d{1,2}:){0,2}\d{1,2}[.,]\d{1,4}$|^\d{1,2}:\d{2}(?::\d{2})?$/;
const isTime = (s) => TIME_RE.test(String(s || '').trim());
function timeMs(s) {
  const t = String(s || '').trim().replace(',', '.');
  if (!isTime(t)) return null;
  const parts = t.split(':').map(Number);
  return Math.round(parts.reduce((a, p) => a * 60 + p, 0) * 1000);
}
const STATUS = /^(DNS|DNF|DQ|DSQ|DNQ|NM|NH|FS|SCR|LAP)$/i;
const isReaction = (s) => /^0[.,]\d{3}$/.test(String(s || '').trim());
const windOf = (s) => { const m = /([+-]?\d{1,2}[.,]\d)\s*(?:m\/s|mps)?/i.exec(String(s || '')); return m ? fmtWind(m[1]) : ''; };
function fmtWind(v) {
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n)) return '';
  return (n > 0 ? '+' : n === 0 ? '±' : '') + n.toFixed(1);
}

// ---------------------------------------------------------------- raw data → text
// Scoreboard protocols use control codes between fields; they become "|".
const cleanText = (s) => String(s || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, '|').replace(/\|+/g, '|').replace(/^[|\s]+|[|\s]+$/g, '');
// what the monitor shows: control codes as <02>
const visible = (s) => String(s || '').replace(/[\x00-\x1f\x7f]/g, (c) => (c === '\r' ? '' : c === '\n' ? '' : `<${c.charCodeAt(0).toString(16).padStart(2, '0')}>`));
// one chunk (a UDP packet, a TCP read) can hold many records
const splitRecords = (s) => String(s || '').split(/[\r\n\x03\x04\x17]+/).filter((x) => x.replace(/[\x00-\x1f\s]/g, '').length);

// ---------------------------------------------------------------- CSV (Lynx files, other systems' exports)
function csvLine(line, sep = ',') {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

// ---------------------------------------------------------------- FinishLynx / Hy-Tek database files
// lynx.evt: "event,round,heat,name,…" then competitor lines ",ID,lane,last,first,affiliation,…"
const lynxKey = (num, round, heat) => `lynx:${Number(num) || 0}-${Number(round) || 1}-${Number(heat) || 1}`;
function parseEvt(text, people) {
  const out = [];
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '');
    if (!line.trim() || line.trim().startsWith(';')) continue;
    if (/^[\s,\t\\]/.test(line)) {
      if (!cur) continue;
      const status = /^\s*\\(\w+)/.exec(line);
      const f = csvLine(line.replace(/^\s*\\\w+/, '').replace(/^[\s\t]*,?/, ''));
      const [id, lane, last, first, aff] = f;
      const p = people && people.get(String(id || '').trim());
      const name = [first || (p && p.first) || '', last || (p && p.last) || ''].join(' ').trim();
      if (!name && !id) continue;
      cur.entries.push({ bib: id && id !== '0' ? id : '', lane: lane || '', name, team: aff || (p && p.team) || '', status: status ? status[1].toUpperCase() : '' });
    } else {
      const f = csvLine(line);
      if (!/^\d+$/.test(f[0] || '')) continue;
      cur = { t: 'startlist', num: f[0], round: f[1] || '1', heat: f[2] || '1', name: f[3] || '', wind: f[4] ? fmtWind(f[4]) : '', entries: [] };
      cur.key = lynxKey(cur.num, cur.round, cur.heat);
      out.push(cur);
    }
  }
  return out;
}
// lynx.ppl: "ID,last,first,affiliation"
function parsePpl(text) {
  const m = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith(';')) continue;
    const [id, last, first, team] = csvLine(line);
    if (id) m.set(id, { last: last || '', first: first || '', team: team || '' });
  }
  return m;
}
// result file (.lif): header "event,round,heat,name,wind,unit,…" then "place,ID,lane,last,first,affiliation,time,license,delta,reaction,…"
function parseLif(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/^﻿/, '')).filter((l) => l.trim() && !l.trim().startsWith(';'));
  if (!lines.length) return null;
  const h = csvLine(lines[0]);
  if (!/^\d+$/.test(h[0] || '')) return null;
  const r = { t: 'results', num: h[0], round: h[1] || '1', heat: h[2] || '1', name: h[3] || '', wind: h[4] ? fmtWind(h[4]) : '', rows: [] };
  r.key = lynxKey(r.num, r.round, r.heat);
  for (const line of lines.slice(1)) {
    const f = csvLine(line);
    const [place, id, lane, last, first, aff, time, , , reac] = f;
    const name = [first, last].filter(Boolean).join(' ').trim();
    if (!name && !id && !lane) continue;
    const status = STATUS.test(place || '') ? place.toUpperCase() : '';
    r.rows.push({ place: status ? '' : place || '', bib: id || '', lane: lane || '', name, team: aff || '', time: status || (time || '').trim(), reaction: isReaction(reac) ? reac.replace(',', '.') : '' });
  }
  return r;
}

// ---------------------------------------------------------------- ALGE timers (Timy, Comet): " 0012 C1  12:34:56.7890 00"
//   C0 start · C1 finish (time of day) · RT / RTM run (net) time · M = manual
function parseAlge(line) {
  const m = /^\s*[?n!]?\s*(\d{1,5})\s+(C\d{1,2}M?|RTM?|TTM?)\s+(\d{1,2}:\d{2}:\d{2}[.,]\d{1,5}|\d{1,2}:\d{2}[.,]\d{1,5}|\d{1,5}[.,]\d{1,5})/i.exec(line);
  if (!m) return null;
  const bib = String(Number(m[1])), ch = m[2].toUpperCase(), time = m[3].replace(',', '.');
  if (ch.startsWith('C0')) return { t: 'start', bib, tod: time };
  if (ch.startsWith('RT') || ch.startsWith('TT')) {
    // net time "00:00:12.3456" → "12.34" (hundredths, rounded up as the rules ask)
    const ms = timeMs(time.split(':').length === 3 ? time : time);
    return { t: 'result', bib, time: fmtResult(ms) };
  }
  return { t: 'finish', bib, tod: time };
}
/** 12345 ms → "12.35" (hundredths rounded up), 105320 → "1:45.32" */
function fmtResult(ms, digits = 2) {
  if (ms == null) return '';
  const f = 10 ** (3 - digits), up = Math.ceil(ms / f) * f;
  const s = up / 1000, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(digits);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${sec.padStart(digits + 3, '0')}`;
  if (m) return `${m}:${sec.padStart(digits + 3, '0')}`;
  return sec;
}

// ---------------------------------------------------------------- anything else: read the fields from what they look like
// Works with most scoreboard scripts: a time on its own is the running clock; a line with a name and a time is a result;
// a line with an event name and no time says which race it is.
function tokens(text) {
  let parts = text.split('|').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1) parts = text.split(/\t|\s{2,}/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1) {
    // single spaces: join words into names
    const words = text.split(/\s+/), out = [];
    for (const w of words) { const prev = out[out.length - 1]; if (prev && /[A-Za-zÀ-ÿ'’-]$/.test(prev) && /^[A-Za-zÀ-ÿ'’][A-Za-zÀ-ÿ'’.-]*$/.test(w) && !STATUS.test(w)) out[out.length - 1] = prev + ' ' + w; else out.push(w); }
    parts = out;
  }
  return parts;
}
function parseAuto(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (isTime(t)) return { t: 'clock', ms: timeMs(t), running: true };
  const tk = tokens(t);
  if (tk.length === 1 && isTime(tk[0])) return { t: 'clock', ms: timeMs(tk[0]), running: true };
  if (/\bwind\b|m\/s/i.test(t) && windOf(t) && tk.length <= 3) return { t: 'wind', value: windOf(t) };
  let timeI = tk.findIndex((x, i) => i > 0 && (isTime(x) || STATUS.test(x)) && !isReaction(x));
  if (timeI < 0 && STATUS.test(tk[0] || '')) timeI = 0;
  const alpha = tk.map((x, i) => (/[A-Za-zÀ-ÿ]{2,}/.test(x) && !STATUS.test(x) && !/^(m\/s|wind)$/i.test(x) ? i : -1)).filter((i) => i >= 0);
  if (timeI >= 0 && alpha.length) {
    const r = { t: 'result', place: '', lane: '', bib: '', name: '', team: '', time: '', reaction: '' };
    const lead = tk.slice(0, alpha[0]).filter((x) => /^\d{1,5}$/.test(x) || STATUS.test(x));
    if (lead.length >= 3) [r.place, r.lane, r.bib] = lead;
    else if (lead.length === 2) [r.place, r.lane] = lead;
    else if (lead.length === 1) r.place = lead[0];
    if (STATUS.test(r.place)) { r.time = r.place.toUpperCase(); r.place = ''; }
    r.name = tk[alpha[0]];
    if (alpha[1] !== undefined && (alpha[1] < timeI || timeI === 0)) r.team = tk[alpha[1]];
    if (!r.time) r.time = STATUS.test(tk[timeI]) ? tk[timeI].toUpperCase() : tk[timeI];
    const reac = tk.find(isReaction); if (reac) r.reaction = reac.replace(',', '.');
    // a bib between the name and the time
    if (!r.bib && timeI > alpha[0]) { const b = tk.slice(alpha[0] + 1, timeI).find((x) => /^\d{1,5}$/.test(x)); if (b) r.bib = b; }
    return r;
  }
  if (!tk.some(isTime)) {
    const p = Athletics.parseEvent(t);
    if (p.discipline) return { t: 'event', name: t, wind: /wind/i.test(t) ? windOf(t) : '' };
  }
  return null;
}

// ---------------------------------------------------------------- your own layout (Timing tab → rules)
// rule: { when: 'any'|'contains'|'starts'|'regex', match, type, split, fields: { name: column, … } } (columns count from 1)
const SPLITS = { controls: /\|/, comma: ',', semicolon: ';', tab: '\t', pipe: '|', spaces: /\s{2,}|\t/, space: /\s+/ };
function columns(text, split) {
  if (split === 'comma' || split === 'semicolon') return csvLine(text, split === 'comma' ? ',' : ';');
  const re = SPLITS[split] || SPLITS.controls;
  return String(text).split(re).map((x) => x.trim());
}
function ruleMatches(rule, raw, text) {
  const m = String(rule.match || '');
  switch (rule.when) {
    case 'contains': return text.includes(m) || raw.includes(m);
    case 'starts': return text.startsWith(m) || raw.replace(/^[\x00-\x1f]+/, '').startsWith(m);
    case 'regex': try { return new RegExp(m, 'i').test(text); } catch { return false; }
    default: return true;
  }
}
function parseRule(rule, raw) {
  const text = cleanText(raw);
  if (!ruleMatches(rule, raw, text)) return undefined;
  if (rule.type === 'ignore') return null;
  const cols = columns(rule.split === 'controls' || !rule.split ? text : text, rule.split || 'controls');
  const col = (k) => { const i = Number((rule.fields || {})[k]); return i > 0 ? String(cols[i - 1] == null ? '' : cols[i - 1]).trim() : ''; };
  const name = col('name') || [col('first'), col('last')].filter(Boolean).join(' ');
  switch (rule.type) {
    case 'clock': { const ms = timeMs(col('clock') || col('time') || text); return ms == null ? null : { t: 'clock', ms, running: true }; }
    case 'start': return { t: 'start' };
    case 'stop': { const ms = timeMs(col('clock') || col('time')); return { t: 'stop', ms }; }
    case 'wind': return { t: 'wind', value: windOf(col('wind') || text) };
    case 'event': return { t: 'event', name: col('event') || text, wind: col('wind') ? windOf(col('wind')) : '', heat: col('heat'), key: col('key') ? 'rule:' + col('key') : '' };
    case 'result': {
      const time = col('time'), place = col('place');
      const status = STATUS.test(place) ? place.toUpperCase() : STATUS.test(time) ? time.toUpperCase() : '';
      if (!name && !col('bib') && !col('lane')) return null;
      return { t: 'result', place: status ? '' : place, lane: col('lane'), bib: col('bib'), name, team: col('team'), time: status || time, reaction: col('reaction') };
    }
    case 'entry': return { t: 'entry', lane: col('lane'), bib: col('bib'), name, team: col('team') };
    default: return null;
  }
}

/** One record from a line-based input → message (or null) */
function parseRecord(raw, input) {
  const fmt = (input && input.format) || 'auto';
  const text = cleanText(raw);
  if (!text) return null;
  if (input && Array.isArray(input.rules) && input.rules.length) {
    for (const rule of input.rules) { const r = parseRule(rule, raw); if (r !== undefined) return r; }
    if (fmt === 'custom') return null;
  }
  if (fmt === 'alge') return parseAlge(text) || (isTime(text) ? { t: 'clock', ms: timeMs(text), running: true } : null);
  if (fmt === 'running') { const tk = tokens(text).filter(isTime); return tk.length ? { t: 'clock', ms: timeMs(tk[tk.length - 1]), running: true } : null; }
  if (fmt === 'custom') return null;
  return parseAlge(text) || parseAuto(text);
}

// ---------------------------------------------------------------- into the meet
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const uid = () => Math.random().toString(36).slice(2, 10);
function eventFields(m) {
  const p = Athletics.parseEvent(`${m.name || ''}`);
  let roundType = p.round, heat = p.heat;
  if (!roundType && m.heat && Number(m.heat) > 1) { roundType = 'Heat'; heat = String(Number(m.heat)); }
  if (roundType && Athletics.NUMBERED.includes(roundType) && !heat && m.heat) heat = String(Number(m.heat));
  return { discipline: p.discipline, gender: p.gender, age: p.age || 'Open', roundType: roundType || '', heat: heat || '', kind: p.kind || 'track' };
}
function makeEvent(m) {
  const f = eventFields(m);
  const e = Object.assign({ id: uid(), entries: [], wind: m.wind || '', timing: m.key || '', num: m.num ? String(Number(m.num)) : '' }, f);
  e.name = f.discipline ? Athletics.eventName(e) : String(m.name || 'Event').trim();
  e.round = Athletics.roundLabel(e.roundType, e.heat);
  return e;
}
function findEvent(setup, m, opts, created) {
  const evs = setup.ath.events;
  let e = m.key ? evs.find((x) => x.timing === m.key) : null;
  if (!e && m.name) {
    const f = eventFields(m), round = Athletics.roundLabel(f.roundType, f.heat);
    e = evs.find((x) => f.discipline && x.discipline === f.discipline && (x.gender || '') === f.gender && (x.age || 'Open') === f.age && (x.round || '') === round)
      || evs.find((x) => norm(x.name) === norm(m.name) || norm(`${x.name} ${x.round || ''}`) === norm(m.name));
    if (e && m.key && !e.timing) e.timing = m.key;
  }
  if (!e && m.name && opts.autoCreate !== false) {
    e = makeEvent(m);
    // the same race number in another heat: the first one becomes "Heat 1"
    if (m.key && /^lynx:/.test(m.key)) {
      const base = m.key.replace(/-\d+$/, '-');
      const sib = evs.find((x) => x.timing && x.timing.startsWith(base) && x.timing !== m.key && !x.roundType);
      if (sib) { sib.roundType = 'Heat'; sib.heat = sib.timing.split('-').pop(); sib.round = Athletics.roundLabel('Heat', sib.heat); if (!e.roundType) { e.roundType = 'Heat'; e.heat = String(Number(m.heat) || 1); e.round = Athletics.roundLabel('Heat', e.heat); } }
    }
    evs.push(e);
    if (created) created.push(e.name + (e.round ? ' · ' + e.round : ''));
  }
  return e || null;
}
function findEntry(e, r) {
  const bib = String(r.bib || '').trim(), lane = String(r.lane || '').trim(), name = norm(r.name);
  return (bib && e.entries.find((x) => String(x.bib || '').trim() === bib))
    || (name && e.entries.find((x) => norm(x.name) === name))
    || (lane && !name && e.entries.find((x) => String(x.lane || '') === lane))
    || (lane && name && e.entries.find((x) => String(x.lane || '') === lane && !x.name))
    || null;
}
function upsertEntry(e, r) {
  let en = findEntry(e, r);
  let changed = false;
  if (!en) {
    if (!r.name && !r.bib) return { en: null, changed };
    en = { id: uid(), lane: r.lane || '', bib: r.bib || '', name: r.name || (r.bib ? '#' + r.bib : ''), team: r.team || '', pb: '', sb: '' };
    e.entries.push(en); changed = true;
  } else {
    for (const k of ['lane', 'bib', 'name', 'team']) if (r[k] && String(en[k] || '') !== String(r[k]) && !(k === 'name' && /^#/.test(r[k]))) { en[k] = String(r[k]); changed = true; }
  }
  return { en, changed };
}
function lastResults(events) {
  const m = new Map();
  for (const ev of events) if (ev.type === 'result' && !ev.void) m.set(`${ev.eventId}|${ev.entry}`, ev);
  return m;
}

/**
 * Puts messages into a meet. state: { setup, events, clocks, Clock, now }, ctx: per-input memory ({ eventKey, eventName,
 * clockSame, lastClock }). Returns { data, clock, notes[] } – what changed.
 */
function applyMessages(state, msgs, ctx, opts = {}) {
  const { setup, events, clocks, Clock, now } = state;
  if (!setup.ath) setup.ath = { events: [], current: '' };
  const out = { data: false, clock: false, notes: [] };
  const created = [];
  const results = lastResults(events);
  const g = clocks.game || (clocks.game = Clock.make({ direction: 1 }));
  const cur = () => (ctx.eventKey || ctx.eventName ? findEvent(setup, { key: ctx.eventKey, name: ctx.eventName }, { autoCreate: false }) : null)
    || setup.ath.events.find((x) => x.id === setup.ath.current) || null;
  const follow = (e) => { if (opts.follow !== false && e && setup.ath.current !== e.id) { setup.ath.current = e.id; out.data = true; } };
  const putResult = (e, r, official) => {
    const { en, changed } = upsertEntry(e, r);
    if (changed) out.data = true;
    if (!en) return;
    const value = String(r.time || '').trim();
    if (!value) return;
    const key = `${e.id}|${en.id}`, last = results.get(key);
    const reaction = r.reaction || (last && last.reaction) || '';
    if (last && last.value === value && (last.reaction || '') === reaction) return;
    if (last && last.official && !official) return;                  // the photo-finish result file is the official one
    const ev = { id: uid(), type: 'result', eventId: e.id, entry: en.id, value, note: last ? last.note || '' : '', reaction, from: 'timing' };
    if (official) ev.official = true;
    events.push(ev); results.set(key, ev); out.data = true;
  };
  for (const m of msgs) {
    if (!m) continue;
    switch (m.t) {
      case 'event': {
        const e = findEvent(setup, m, opts, created);
        ctx.eventKey = m.key || ''; ctx.eventName = m.name || '';
        if (e) { follow(e); if (m.wind && e.wind !== m.wind) { e.wind = m.wind; out.data = true; } }
        break;
      }
      case 'startlist': {
        const e = findEvent(setup, m, opts, created);
        if (!e) break;
        for (const r of m.entries || []) { const { changed } = upsertEntry(e, r); if (changed) out.data = true; }
        if (opts.followStartLists) follow(e);
        break;
      }
      case 'results': {
        const e = findEvent(setup, m, opts, created);
        if (!e) break;
        ctx.eventKey = m.key || ''; ctx.eventName = m.name || '';
        if (m.wind && e.wind !== m.wind) { e.wind = m.wind; out.data = true; }
        for (const r of m.rows || []) putResult(e, r, true);
        follow(e);
        break;
      }
      case 'entry': { const e = cur(); if (e) { const { changed } = upsertEntry(e, m); if (changed) out.data = true; } break; }
      case 'result': { const e = cur(); if (e) putResult(e, m); else out.notes.push('A result came in, but no event is chosen.'); break; }
      case 'wind': { const e = cur(); if (e && m.value && e.wind !== m.value) { e.wind = m.value; out.data = true; } break; }
      case 'finish': {
        const t0 = (ctx.tods || {})[m.bib] || ctx.gunTod;
        if (!t0) break;
        let ms = timeMs(m.tod) - timeMs(t0);
        if (ms < 0) ms += 86400e3;
        const e = cur(); if (e) putResult(e, { bib: m.bib, time: fmtResult(ms) });
        break;
      }
      case 'start': {
        if (m.tod) { ctx.tods = ctx.tods || {}; ctx.tods[m.bib || ''] = m.tod; if (!ctx.started || now - ctx.started >= 3000) ctx.gunTod = m.tod; }
        if (opts.clock === false) break;
        if (m.bib && ctx.started && now - ctx.started < 3000) break;     // timers send one start per athlete: one gun
        ctx.started = now;
        Clock.stop(g, now); g.direction = 1; g.limitMs = 0; g.stopAtLimit = false; Clock.set(g, 0, now); Clock.start(g, now);
        ctx.lastClock = 0; ctx.clockSame = 0; out.clock = true;
        break;
      }
      case 'stop': {
        if (opts.clock === false) break;
        Clock.stop(g, now); if (m.ms != null) Clock.set(g, m.ms, now); out.clock = true; break;
      }
      case 'clock': {
        if (opts.clock === false) break;
        // a time that stops changing is a stopped clock (most scripts keep sending the frozen time)
        ctx.clockSame = ctx.lastClock === m.ms ? (ctx.clockSame || 0) + 1 : 0;
        ctx.lastClock = m.ms; ctx.clockAt = now;
        if (ctx.clockSame >= 2) { if (g.running) { Clock.stop(g, now); Clock.set(g, m.ms, now); out.clock = true; } break; }
        if (!g.running) {
          if (ctx.clockSame === 0 && m.ms != null) { g.direction = 1; g.limitMs = 0; g.stopAtLimit = false; Clock.set(g, m.ms, now); if (ctx.prevMs !== undefined && m.ms > ctx.prevMs) Clock.start(g, now); out.clock = true; }
        } else if (Math.abs(Clock.value(g, now) - m.ms) > 150) { Clock.set(g, m.ms, now); out.clock = true; }
        ctx.prevMs = m.ms;
        break;
      }
      default: break;
    }
  }
  if (created.length) out.notes.push('New events: ' + created.join(', '));
  return out;
}

/** A clock that runs from a scoreboard feed and then goes quiet (the race is over, the cable is out): stop it where the feed left it. */
function quietClock(state, ctx, afterMs = 2500) {
  const g = state.clocks.game;
  if (!g || !g.running || ctx.clockAt == null || state.now - ctx.clockAt < afterMs || ctx.lastClock == null) return false;
  state.Clock.stop(g, state.now); state.Clock.set(g, ctx.lastClock, state.now);
  ctx.clockAt = null;
  return true;
}

module.exports = { quietClock,  isTime, timeMs, fmtResult, fmtWind, cleanText, visible, splitRecords, csvLine, parseEvt, parsePpl, parseLif, parseAlge, parseAuto, parseRule, parseRecord, applyMessages, lynxKey, tokens };
