'use strict';
// Music rights: every use of a track is logged (CasparCG plays from RFP Manager, vMix inputs that play, slate music on
// the website's streams, and uses entered by hand), and the uses of a production become its music cue sheet (SAMRO,
// the broadcaster's layout, or a rights holder's report). Tracks keep their rights: clearance, where they may be
// used and until when.
const Schema = require('../shared/schema');
const { detId } = require('./util');

function makeMusic(app) {
  // the store, not the cache: the website keeps no cache (the production PC does, and its store is the same data)
  const doc = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const all = async (team, type) => (await app.store.list(team, type)).filter((d) => !d.deleted);
  const today = () => new Date().toLocaleDateString('en-CA');

  // may this track be played now (and on this kind of output)?
  function clearance(t, medium) {
    if (!t) return { ok: false, why: 'Track not found' };
    if ((t.cleared || 'Pending') !== 'Cleared') return { ok: false, why: `"${t.title}" is not cleared for use (${t.cleared || 'Pending'})` };
    const d = today();
    if (t.validFrom && d < t.validFrom) return { ok: false, why: `The licence for "${t.title}" starts on ${t.validFrom}` };
    if (t.validUntil && d > t.validUntil) return { ok: false, why: `The licence for "${t.title}" ended on ${t.validUntil}` };
    const want = [].concat(medium || []).filter(Boolean);
    if (want.length && Array.isArray(t.clearedFor) && t.clearedFor.length && !want.some((m) => t.clearedFor.includes(m))) return { ok: false, why: `"${t.title}" is not cleared for ${want.join(' or ')}` };
    return { ok: true, why: '' };
  }

  // the production a match belongs to (a cue sheet is per production)
  async function productionOfFixture(fid) {
    const fx = fid ? await doc(fid) : null; if (!fx) return null;
    for (const d of await all(fx.team, 'production')) if ((d.data.fixtures || []).some((r) => r && r.fixture === fid)) return d;
    return null;
  }

  // the tracks to offer for a match: its production's, then its competition's theme music
  async function themeFor(fixtureId) {
    const out = [], seen = new Set();
    const add = async (rows, from) => { for (const r of rows || []) { if (!r || !r.track || seen.has(r.track)) continue; const t = await doc(r.track); if (!t) continue; seen.add(r.track); out.push({ ...t.data, id: r.track, usage: r.usage || t.data.usage || 'Theme', from, clearance: clearance(t.data) }); } };
    const fx = await doc(fixtureId), prod = await productionOfFixture(fixtureId);
    if (prod) await add(prod.data.music, 'Production');
    if (fx && fx.data.competition) { const c = await doc(fx.data.competition); if (c) await add(c.data.music, c.data.name || 'Competition'); }
    return out;
  }

  // one line per use, in a day's log for the team on this machine (like the advert play log)
  async function start(team, { track, title, composers, publisher, usage, source, fixtureId, productionId, at } = {}) {
    const t = track ? ((await doc(track)) || {}).data || {} : {};
    const fx = await doc(fixtureId), prod = productionId ? await doc(productionId) : await productionOfFixture(fixtureId);
    const date = today(), id = detId('musicuse_', team, date, (app.config && app.config.machineId) || 'site'), c0 = await app.store.get(id);
    const entry = { id: Math.random().toString(36).slice(2, 10), track: track || '', title: title || t.title || '', artist: t.artist || '', composers: composers || t.composers || '', publisher: publisher || t.publisher || '',
      isrc: t.isrc || '', iswc: t.iswc || '', library: t.library || '', usage: usage || t.usage || 'Background', source: source || 'Manual', at: at || Date.now(), seconds: 0, ended: 0,
      production: prod ? prod.id : '', productionName: prod ? prod.data.name || '' : '', match: fx ? fx.data.name || fx.data.autoName || '' : '', machine: (app.config && app.config.machineName) || require('node:os').hostname() };
    const entries = [...((c0 && !c0.deleted && c0.data.entries) || []), entry].slice(-5000);
    await app.save(team, 'musicuse', id, { date, entries }, '');
    return { id, entry: entry.id, team };
  }
  async function end(ref) {
    if (!ref) return;
    const c0 = await app.store.get(ref.id); if (!c0 || c0.deleted) return;
    const entries = (c0.data.entries || []).map((e) => (e.id === ref.entry && !e.ended ? { ...e, seconds: Math.max(0, Math.round((Date.now() - e.at) / 1000)), ended: Date.now() } : e));
    await app.save(ref.team, 'musicuse', ref.id, { ...c0.data, entries }, '');
  }

  // ---- vMix: an input whose title is a track's "vMix input title" is logged while it runs ----------------------------
  const vmixOpen = new Map();                                         // device:input → { ref, trackId }
  async function vmixTick(dev) {
    const st = dev && dev.state; if (!st || !st.inputs) return;
    const tracks = [];
    for (const d of (app.cache || new Map()).values()) if (d.type === 'track' && !d.deleted && d.data.vmixInput) tracks.push(d);
    if (!tracks.length && !vmixOpen.size) return;
    const fixtureId = (app.gfx && app.gfx.fixtureId) || '';
    const running = new Set();
    for (const [num, inp] of Object.entries(st.inputs)) {
      const t = tracks.find((d) => String(d.data.vmixInput).trim().toLowerCase() === String(inp.title || '').trim().toLowerCase());
      if (!t || !/running/i.test(inp.state || '') || inp.muted) continue;
      const key = (dev.id || 'vmix') + ':' + num; running.add(key);
      if (!vmixOpen.has(key)) {
        const team = t.team;
        vmixOpen.set(key, { pending: true });
        const ref = await start(team, { track: t.id, source: 'vMix', fixtureId }).catch(() => null);
        vmixOpen.set(key, { ref, trackId: t.id });
      }
    }
    for (const [key, v] of [...vmixOpen]) if (key.startsWith((dev.id || 'vmix') + ':') && !running.has(key) && !v.pending) { vmixOpen.delete(key); await end(v.ref).catch(() => {}); }
  }

  // ---- the cue sheet of a production ----------------------------------------------------------------------------------
  async function usesOf(prod, uses) {
    const p = prod.data, out = [];
    const fxNames = new Set();
    for (const r of p.fixtures || []) { const f = await doc(r && r.fixture); if (f) fxNames.add(f.data.name || f.data.autoName || ''); }
    for (const d of uses || await all(prod.team, 'musicuse')) {
      for (const e of d.data.entries || []) if (e.production === prod.id || (!e.production && e.match && fxNames.has(e.match))) out.push({ ...e, auto: true });
    }
    for (const m of p.musicLog || []) {
      if (!m || !(m.track || m.title)) continue;
      const t = m.track ? ((await doc(m.track)) || {}).data || {} : {};
      out.push({ id: 'm' + out.length, track: m.track || '', title: m.title || t.title || '', artist: m.artist || t.artist || '', composers: m.composers || t.composers || '', publisher: m.publisher || t.publisher || '',
        isrc: m.isrc || t.isrc || '', iswc: m.iswc || t.iswc || '', library: t.library || '', usage: m.usage || t.usage || 'Background', source: m.source || 'Manual',
        at: m.at ? Date.parse(`${p.date || today()}T${m.at}`) || 0 : 0, seconds: Schema.parseDuration(m.duration || '') || 0, manual: true });
    }
    return out.sort((a, b) => (a.at || 0) - (b.at || 0));
  }
  const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };
  async function cueSheet(prod) {
    const p = prod.data, org = ((await doc(prod.team)) || {}).data || {}, uses = await usesOf(prod);
    // timings from the start of the programme (its TX time on its date), else from the first use
    const tx = p.date && p.txTime ? Date.parse(`${p.date}T${p.txTime}:00`) : 0;
    const zero = tx || (uses.find((u) => u.at) || {}).at || 0;
    const tc = (t) => (t && zero ? (t < zero ? '-' : '') + mmss(Math.abs(t - zero) / 1000) : '');
    const rows = uses.map((u, i) => ({ n: i + 1, ...u, timeIn: u.at ? tc(u.at) : '', timeOut: u.at && u.seconds ? tc(u.at + u.seconds * 1000) : '', duration: mmss(u.seconds), clock: u.at ? new Date(u.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '' }));
    const totals = {};
    for (const r of rows) { const k = r.track || r.title; totals[k] = totals[k] || { title: r.title, composers: r.composers, publisher: r.publisher, usage: r.usage, uses: 0, seconds: 0 }; totals[k].uses++; totals[k].seconds += r.seconds || 0; }
    return { programme: p.programmeTitle || p.name || 'Production', date: p.date || '', broadcaster: p.broadcaster || '', company: org.name || '', producer: p.producer ? (((await doc(p.producer)) || {}).data || {}).name || '' : '', txTime: p.txTime || '',
      rows, totals: Object.values(totals).map((x) => ({ ...x, duration: mmss(x.seconds) })), totalSeconds: rows.reduce((s, r) => s + (r.seconds || 0), 0) };
  }
  const csvCell = (x) => `"${String(x === undefined || x === null ? '' : x).replace(/"/g, '""')}"`;
  // layout: samro | broadcaster
  function cueCsv(cs, layout) {
    const head = layout === 'broadcaster'
      ? ['Programme', 'Date', 'Broadcaster', 'Cue', 'Time of day', 'Title', 'Artist', 'Composer(s)', 'Publisher(s)', 'Library / label', 'ISRC', 'Use', 'In', 'Out', 'Duration']
      : ['Programme title', 'Broadcast date', 'Broadcaster', 'Production company', 'Cue no.', 'Music title', 'Composer(s)', 'Publisher(s)', 'ISWC', 'ISRC', 'Usage', 'Timing in', 'Timing out', 'Duration'];
    const lines = [head, ...cs.rows.map((r) => (layout === 'broadcaster'
      ? [cs.programme, cs.date, cs.broadcaster, r.n, r.clock, r.title, r.artist, r.composers, r.publisher, r.library, r.isrc, r.usage, r.timeIn, r.timeOut, r.duration]
      : [cs.programme, cs.date, cs.broadcaster, cs.company, r.n, r.title, r.composers, r.publisher, r.iswc, r.isrc, r.usage, r.timeIn, r.timeOut, r.duration]))];
    return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
  }
  function cuePdf(cs, layout) {
    const { makePdf } = require('./pdf');
    const titles = { samro: 'Music cue sheet (SAMRO)', broadcaster: 'Music cue sheet', rights: 'Music use report' };
    const pdf = makePdf({ title: `${titles[layout] || titles.samro} – ${cs.programme}`, footer: `${cs.company} · ${cs.programme} · ${cs.date}` });
    pdf.para([{ text: titles[layout] || titles.samro, bold: true }], { size: 16, after: 6 });
    pdf.table([{ label: '', w: 1 }, { label: '', w: 3 }], [['Programme', cs.programme], ['Broadcast date', cs.date], ['TX time', cs.txTime], ['Broadcaster / channel', cs.broadcaster], ['Production company', cs.company], ['Producer', cs.producer]]
      .filter((r) => r[1]).map((r) => ({ cells: [{ text: r[0], bold: true }, r[1]] })), { headFill: '#ffffff', headColor: '#ffffff', size: 9 });
    pdf.heading('Cues');
    const cols = layout === 'broadcaster'
      ? [{ label: '#', w: 0.4 }, { label: 'Time', w: 0.9 }, { label: 'Title / artist', w: 2.4 }, { label: 'Composer(s) / publisher', w: 2.4 }, { label: 'Library / ISRC', w: 1.6 }, { label: 'Use', w: 1 }, { label: 'Dur.', w: 0.7, align: 'right' }]
      : [{ label: '#', w: 0.4 }, { label: 'Title', w: 2 }, { label: 'Composer(s)', w: 1.8 }, { label: 'Publisher(s)', w: 1.5 }, { label: 'ISWC / ISRC', w: 1.4 }, { label: 'Usage', w: 1 }, { label: 'In', w: 0.7 }, { label: 'Dur.', w: 0.7, align: 'right' }];
    const rows = cs.rows.map((r) => ({ cells: layout === 'broadcaster'
      ? [String(r.n), r.clock, [{ text: r.title, bold: true }, { text: r.artist ? '\n' + r.artist : '' }], [{ text: r.composers }, { text: r.publisher ? '\n' + r.publisher : '' }], [{ text: r.library }, { text: r.isrc ? '\n' + r.isrc : '' }], r.usage, r.duration]
      : [String(r.n), [{ text: r.title, bold: true }], r.composers, r.publisher, [r.iswc, r.isrc].filter(Boolean).join('\n'), r.usage, r.timeIn, r.duration] }));
    if (rows.length) pdf.table(cols, rows, { zebra: '#f4f4f4', size: 8.5 }); else pdf.para('No music was used.');
    pdf.para([{ text: `Total music: ${mmss(cs.totalSeconds)} in ${cs.rows.length} cue${cs.rows.length === 1 ? '' : 's'}.`, bold: true }], { size: 9, after: 10 });
    if (cs.totals.length) {
      pdf.heading('Per title');
      pdf.table([{ label: 'Title', w: 2.4 }, { label: 'Composer(s)', w: 2 }, { label: 'Publisher(s)', w: 1.8 }, { label: 'Uses', w: 0.6, align: 'right' }, { label: 'Total', w: 0.8, align: 'right' }],
        cs.totals.map((x) => ({ cells: [x.title, x.composers, x.publisher, String(x.uses), x.duration] })), { zebra: '#f4f4f4', size: 8.5 });
    }
    pdf.space(18);
    pdf.para(`Signed: ____________________________    Date: ______________`, { size: 9 });
    return pdf.finish();
  }

  // a rights holder's report: every use of the tracks of a composer, publisher or library over a period
  async function rightsReport(team, { who = '', from = '', to = '' } = {}) {
    const q = String(who || '').trim().toLowerCase(), rows = [];
    for (const d of await all(team, 'musicuse')) {
      if ((from && d.data.date < from) || (to && d.data.date > to)) continue;
      for (const e of d.data.entries || []) if (!q || [e.composers, e.publisher, e.library, e.artist, e.title].some((x) => String(x || '').toLowerCase().includes(q))) rows.push({ ...e, date: d.data.date });
    }
    for (const d of await all(team, 'production')) {
      if (!(d.data.musicLog || []).length) continue;
      if ((from && d.data.date < from) || (to && d.data.date > to)) continue;
      for (const r of await usesOf(d, [])) if (r.manual && (!q || [r.composers, r.publisher, r.library, r.artist, r.title].some((x) => String(x || '').toLowerCase().includes(q)))) rows.push({ ...r, date: d.data.date, productionName: d.data.name });
    }
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.at || 0) - (b.at || 0));
    return rows.map((r, i) => ({ n: i + 1, ...r, duration: mmss(r.seconds) }));
  }

  return { clearance, themeFor, start, end, vmixTick, usesOf, cueSheet, cueCsv, cuePdf, rightsReport, productionOfFixture, mmss };
}

module.exports = { makeMusic };
