'use strict';
// Timeline: a show laid out on tracks against time (shots, graphics, lyrics, lights, audio, playback …).
// Each cue sits at a time on a track and can carry actions (take a graphic, cut the ATEM, start a vMix input, run a macro,
// send AMCP …). Running the timeline fires the cues of armed tracks as the playhead passes them; a "hold" cue stops the
// playhead until GO. Crew follow along on their own screens. The timeline is a record (type "timeline") like any other,
// so it syncs to the website; running it happens on the machine that runs the show (the production PC).
const Schema = require('../shared/schema');
const { newId, fail, log, HttpError } = require('./util');
const actor = require('./actor');

const KINDS = ['shots', 'graphics', 'lyrics', 'lights', 'audio', 'playback', 'notes', 'other'];
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
const t2 = (v) => Math.round(num(v, 0, 86400, 0) * 100) / 100;
const color = (v) => (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v || '') ? v : '');
const clockText = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };

function makeTimeline(app) {
  const runs = new Map();          // timeline id -> { state: stopped|playing|paused|held, pos, startedAt, fired:Set, holdId }
  let watchers = new Set();         // live clients watching a timeline (c.tl = id)
  let lastId = '';                  // the timeline that was last started: its values are live values for templates
  const gfx = () => app.gfx || null;

  // ---------------------------------------------------------------- data
  const cleanActs = (a) => {
    if (gfx()) return gfx().cleanActions(a);
    return (Array.isArray(a) ? a : []).slice(0, 16).filter((x) => x && typeof x === 'object' && typeof x.do === 'string')
      .map((x) => Object.fromEntries(Object.entries(x).slice(0, 12).map(([k, v]) => [str(k, 20), typeof v === 'object' && v ? Object.fromEntries(Object.entries(v).slice(0, 80).map(([a1, b1]) => [str(a1, 80), str(b1, 2000)])) : typeof v === 'number' ? v : str(v, 2000)])));
  };
  function clean(d, cur) {
    d = d && typeof d === 'object' ? d : {};
    const tracks = (Array.isArray(d.tracks) ? d.tracks : []).slice(0, 40).filter((t) => t && typeof t === 'object').map((t) => ({
      id: str(t.id || newId('trk'), 40), name: str(t.name || 'Track', 40), kind: KINDS.includes(t.kind) ? t.kind : 'other', color: color(t.color), armed: t.armed !== false, crew: str(t.crew, 120) }));
    const ids = new Set(tracks.map((t) => t.id));
    const cues = (Array.isArray(d.cues) ? d.cues : []).slice(0, 3000).filter((c) => c && typeof c === 'object' && ids.has(c.track)).map((c) => ({
      id: str(c.id || newId('cue'), 40), track: c.track, at: t2(c.at), dur: t2(c.dur), label: str(c.label, 120), text: str(c.text, 4000), color: color(c.color),
      kind: c.kind === 'hold' ? 'hold' : 'auto', actions: cleanActs(c.actions) })).sort((a, b) => a.at - b.at);
    const sections = (Array.isArray(d.sections) ? d.sections : []).slice(0, 300).filter((s) => s && typeof s === 'object').map((s) => ({
      id: str(s.id || newId('sec'), 40), at: t2(s.at), label: str(s.label || 'Section', 80), color: color(s.color), bpm: num(s.bpm, 0, 400, 0) })).sort((a, b) => a.at - b.at);
    return Object.assign({}, cur || {}, {
      name: str(d.name || (cur && cur.name) || 'Timeline', 120), bpm: num(d.bpm, 0, 400, 120), beatsPerBar: Math.round(num(d.beatsPerBar, 1, 16, 4)), units: d.units === 'beats' ? 'beats' : 'time',
      length: t2(d.length === undefined ? (cur && cur.length) || 600 : d.length) || 600, tracks, cues, sections,
    });
  }
  async function getDoc(id) {
    const d = await app.store.get(String(id || ''));
    if (!d || d.deleted || d.type !== 'timeline') fail(404, 'Timeline not found');
    return d;
  }

  // ---------------------------------------------------------------- running
  const runOf = (id) => { if (!runs.has(id)) runs.set(id, { state: 'stopped', pos: 0, startedAt: 0, fired: new Set(), holdId: '' }); return runs.get(id); };
  const posOf = (r, now) => (r.state === 'playing' ? Math.max(0, (now - r.startedAt) / 1000) : r.pos);
  const runView = (id) => { const r = runOf(id), now = Date.now(); return { state: r.state, pos: Math.round(posOf(r, now) * 1000) / 1000, now, holdId: r.holdId }; };
  const cache = new Map();          // id -> data (kept fresh from 'doc' events, so the ticker needs no database read)
  async function dataOf(id) { if (!cache.has(id)) cache.set(id, (await getDoc(id)).data); return cache.get(id); }
  function mark(r, d, pos) { r.fired = new Set((d.cues || []).filter((c) => c.at < pos - 1e-6).map((c) => c.id)); }

  async function fire(id, cue, d, how) {
    const team = (await getDoc(id)).team, tr = (d.tracks || []).find((t) => t.id === cue.track);
    send(id, { ev: { fired: cue.id, how: how || 'auto', at: Date.now() } });
    if (!cue.actions || !cue.actions.length) return;
    if (!gfx()) return;              // the website shows the timeline; the production PC runs the actions
    const sec = [...(d.sections || [])].reverse().find((s) => s.at <= cue.at);
    await actor.also({ via: 'Timeline' + (how === 'go' ? ' GO' : how === 'manual' ? ' (try)' : ''), name: (actor.who() && actor.who().name && how !== 'auto' ? actor.who().name + ' · ' : '') + d.name + ': ' + (cue.label || (tr ? tr.name : 'cue')), ip: how === 'auto' ? '' : (actor.who() || {}).ip || '' }, () => gfx().runActions(cue.actions, { team, label: `Timeline ${d.name}: ${cue.label || (tr ? tr.name : 'cue')}`, vars: { cue_label: cue.label, cue_text: cue.text, section: sec ? sec.label : '', track: tr ? tr.name : '' } }));
  }
  async function control(id, cmd, o) {
    o = o || {};
    const d = await dataOf(id), r = runOf(id), now = Date.now(), pos = posOf(r, now);
    const armed = new Set((d.tracks || []).filter((t) => t.armed).map((t) => t.id));
    const startAt = (p) => { r.startedAt = now - p * 1000; r.state = 'playing'; if (lastId !== id) { lastId = id; followers().catch(() => {}); } };
    switch (cmd) {
      case 'play': {
        if (r.state === 'playing') break;
        if (r.state === 'stopped') mark(r, d, r.pos);
        const held = r.state === 'held' && d.cues.find((c) => c.id === r.holdId);
        r.holdId = ''; startAt(r.pos);
        if (held) { r.fired.add(held.id); await fire(id, held, d, 'go'); }   // PLAY on a hold releases it, like GO
        break;
      }
      case 'pause': if (r.state === 'playing') { r.pos = pos; r.state = 'paused'; } break;
      case 'stop': r.state = 'stopped'; r.pos = 0; r.holdId = ''; r.fired.clear(); break;
      case 'seek': {
        const p = t2(o.pos); r.pos = Math.min(p, d.length || p); mark(r, d, r.pos); r.holdId = '';
        if (r.state === 'playing') startAt(r.pos); else if (r.state === 'held') r.state = 'paused';
        break;
      }
      case 'go': {
        // a hold is waiting: fire it and run on. Otherwise jump to the next cue on an armed track, fire it, and run.
        let cue = r.holdId ? d.cues.find((c) => c.id === r.holdId) : null;
        if (!cue) cue = d.cues.find((c) => armed.has(c.track) && c.at > pos + 1e-3 && !r.fired.has(c.id));
        if (!cue) fail(400, 'No cue after the playhead');
        mark(r, d, cue.at); r.fired.add(cue.id); r.holdId = '';
        startAt(cue.at);
        await fire(id, cue, d, 'go');
        break;
      }
      case 'prev': {
        const marks = [...d.cues.filter((c) => armed.has(c.track)).map((c) => c.at), ...(d.sections || []).map((s) => s.at), 0].filter((a) => a < pos - 0.5).sort((a, b) => b - a);
        return control(id, 'seek', { pos: marks[0] || 0 });
      }
      case 'fire': {                // try one cue now, without moving the playhead
        const cue = d.cues.find((c) => c.id === o.cue);
        if (!cue) fail(404, 'Cue not found');
        await fire(id, cue, d, 'manual');
        return;
      }
      default: fail(400, 'Unknown timeline command');
    }
    send(id, { run: runView(id) });
  }
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      for (const [id, r] of runs) {
        if (r.state !== 'playing') continue;
        let d; try { d = await dataOf(id); } catch { runs.delete(id); continue; }
        const now = Date.now(), p = posOf(r, now), armed = new Set(d.tracks.filter((t) => t.armed).map((t) => t.id));
        for (const c of d.cues) {
          if (c.at > p) break;
          if (r.fired.has(c.id)) continue;
          if (c.kind === 'hold' && armed.has(c.track)) { r.state = 'held'; r.pos = c.at; r.holdId = c.id; send(id, { run: runView(id) }); break; }
          r.fired.add(c.id);
          if (armed.has(c.track)) fire(id, c, d, 'auto').catch((e) => log('Timeline cue:', e.message));
        }
        if (r.state === 'playing' && d.length && p >= d.length) { r.state = 'paused'; r.pos = d.length; send(id, { run: runView(id) }); }
      }
    } finally { ticking = false; }
  }
  const ticker = setInterval(() => { tick().catch(() => {}); }, 20);
  ticker.unref();

  // live values for templates and triggers: the timeline that was started last
  function vars() {
    const d = lastId && cache.get(lastId);
    if (!d) return {};
    const r = runOf(lastId), p = posOf(r, Date.now()), secs = d.sections || [];
    const sec = [...secs].reverse().find((s) => s.at <= p), nextSec = secs.find((s) => s.at > p);
    const armed = new Set(d.tracks.filter((t) => t.armed).map((t) => t.id)), next = d.cues.find((c) => armed.has(c.track) && c.at > p);
    return { timeline_name: d.name, timeline_state: r.state, timeline_time: clockText(p), timeline_remaining: clockText((d.length || 0) - p), timeline_section: sec ? sec.label : '',
      timeline_section_left: nextSec ? clockText(nextSec.at - p) : '', timeline_next: next ? next.label : '', timeline_next_in: next ? clockText(next.at - p) : '' };
  }

  // ---------------------------------------------------------------- screens
  // Screens opened without a timeline (the /crew link) follow the timeline that was started last.
  async function followers() { for (const c of watchers) if (c.tlFollow && c.tl !== lastId) await openFor(c, lastId).catch(() => {}); }
  async function openFor(c, id) {
    const doc = await getDoc(id), can = await canFor(c, doc);
    c.tl = id; watchers.add(c); cache.set(id, doc.data);
    c.ws.send({ type: 'tl', id, doc: doc.data, run: runView(id), can, me: c.user ? { id: c.user.id, name: c.name } : null, kinds: KINDS, follow: !!c.tlFollow });
  }
  function send(id, msg) { const m = Object.assign({ type: 'tl', id }, msg); for (const c of watchers) if (c.tl === id) c.ws.send(m); }
  async function canFor(c, doc) {
    const role = c.user ? await app.auth.roleIn(c.user, doc.team) : null;
    if (c.user && !role) fail(403, 'You are not in the production team this timeline belongs to');
    return { role, edit: !!role && Schema.CAN.edit(role), run: !!role && Schema.CAN.score(role) && !!gfx(), comment: !!role, local: !!gfx() };
  }
  async function handle(c, action, d) {
    let id = str(d.id, 80);
    if (action === 'open' && !id) {
      c.tlFollow = true; watchers.add(c);
      if (!lastId) { c.tl = ''; c.ws.send({ type: 'tl', id: '', waiting: true }); return; }
      id = lastId;
    }
    if (action === 'list') {
      const out = [];
      for (const t of c.user ? await app.auth.teamsFor(c.user) : []) for (const x of await app.store.list(t.id, 'timeline')) out.push({ id: x.id, name: x.data.name || 'Timeline', date: x.data.date || '' });
      c.ws.send({ type: 'tlList', list: out.sort((a, b) => String(b.date).localeCompare(String(a.date))) });
      return;
    }
    const doc = await getDoc(id), can = await canFor(c, doc);
    switch (action) {
      case 'open':
        if (d.id) c.tlFollow = false;
        await openFor(c, id);
        return;
      case 'save': {
        if (!can.edit) fail(403, 'You need the Producer role to change the timeline');
        const next = clean(d.data, doc.data);
        next.comments = doc.data.comments || [];          // comments are added one by one (crew can comment, not edit)
        await app.save(doc.team, 'timeline', id, next, c.user.id);
        return;
      }
      case 'comment': case 'resolve': case 'uncomment': {
        if (!can.comment) fail(403, 'Sign in to leave a comment');
        let list = (doc.data.comments || []).slice();
        if (action === 'comment') {
          const text = str(d.text, 1000).trim(); if (!text) fail(400, 'Write a comment first');
          list.push({ id: newId('cmt'), at: t2(d.at), track: str(d.track, 40), text, by: c.user.id, name: str(c.name, 60), ts: Date.now(), done: false });
        } else if (action === 'resolve') list = list.map((x) => (x.id === d.cid ? Object.assign({}, x, { done: !x.done }) : x));
        else { const x = list.find((y) => y.id === d.cid); if (x && x.by !== c.user.id && !can.edit) fail(403, 'Only who wrote it (or a Producer) can delete a comment'); list = list.filter((y) => y.id !== d.cid); }
        await app.save(doc.team, 'timeline', id, Object.assign({}, doc.data, { comments: list.slice(-1000) }), c.user.id);
        return;
      }
      case 'importRundown': {
        if (!can.edit) fail(403, 'You need the Producer role to change the timeline');
        const src = await app.store.get(str(d.from, 80));
        if (!src || src.deleted || !['production', 'fixture'].includes(src.type) || src.team !== doc.team) fail(404, 'Rundown not found');
        const rows = Schema.rundownTimes(src.data.rundown || [], src.type === 'fixture' ? src.data.startTime : '');
        if (!rows.length) fail(400, 'That rundown has no items');
        const base = rows[0].start, cur = clean(doc.data, doc.data);
        let tr = cur.tracks.find((t) => t.id === 'trk_rundown');
        if (!tr) { tr = { id: 'trk_rundown', name: 'Rundown', kind: 'notes', color: '#9bc2e6', armed: true, crew: '' }; cur.tracks.unshift(tr); }
        cur.cues = cur.cues.filter((x) => x.track !== tr.id).concat(rows.map((r, i) => ({ id: 'cue_rd' + i, track: tr.id, at: r.start - base, dur: r.end - r.start, label: str(r.content, 120), text: [r.description, r.source && 'Source: ' + r.source, r.audio && 'Sound: ' + r.audio, r.graphics && 'Graphics: ' + r.graphics].filter(Boolean).join('\n'), color: color(r.color), kind: 'auto', actions: [] })));
        cur.sections = rows.map((r, i) => ({ id: 'sec_rd' + i, at: r.start - base, label: str(r.content || 'Item ' + (i + 1), 80), color: color(r.color), bpm: 0 }));
        cur.length = Math.max(cur.length || 0, rows[rows.length - 1].end - base);
        await app.save(doc.team, 'timeline', id, clean(cur, doc.data), c.user.id);
        return;
      }
      case 'run': {
        if (!can.run) fail(403, gfx() ? 'You need the Scorer role (or higher) to run the timeline' : 'The timeline runs on the production PC. Open it there.');
        await control(id, str(d.cmd, 20), d);
        return;
      }
      default: throw new HttpError(400, 'Unknown timeline action');
    }
  }
  function drop(c) { watchers.delete(c); }
  app.on('doc', (doc) => {
    if (doc.type !== 'timeline') return;
    if (doc.deleted) { cache.delete(doc.id); runs.delete(doc.id); send(doc.id, { gone: true }); return; }
    if (cache.has(doc.id) || runs.has(doc.id)) cache.set(doc.id, doc.data);
    send(doc.id, { doc: doc.data });
  });
  function close() { clearInterval(ticker); watchers = new Set(); }
  return { handle, drop, close, vars, control, clean, KINDS, runView, current: () => lastId };
}

module.exports = { makeTimeline, KINDS };
