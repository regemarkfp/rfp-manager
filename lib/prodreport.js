'use strict';
// The post-production report of a production: what it was (programme, matches and results, people), what it cost,
// what went to air (graphics, adverts, music), how the stream did, and what went wrong. As JSON for the page and as a PDF.
const Schema = require('../shared/schema');
const { makePdf } = require('./pdf');

const money = (n) => 'R ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hms = (s) => { s = Math.max(0, Math.round(Number(s) || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(x).padStart(2, '0')}s` : `${x}s`; };
const full = (m) => [m && m.name, m && m.surname].filter(Boolean).join(' ');

function makeProdReport(app) {
  const getDoc = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const get = async (id) => ((await getDoc(id)) || {}).data || null;

  async function build(prod) {
    const p = prod.data, team = prod.team;
    const org = (await get(team)) || {}, venue = (await get(p.venue)) || {};
    const producer = p.producer ? full((await get(p.producer)) || {}) : '';
    const days = new Set([p.date].filter(Boolean));
    for (let i = 1; i < (Number(p.days) || 1) && p.date; i++) days.add(new Date(Date.parse(p.date + 'T12:00:00Z') + i * 86400e3).toISOString().slice(0, 10));

    // matches and results
    const matches = [];
    for (const r of p.fixtures || []) {
      const f = await getDoc(r && r.fixture); if (!f) continue;
      const x = f.data, res = x.result || require('../shared/scoring').summary(x.live) || {}, comp = (await get(x.competition)) || {};
      let t = [{ name: '' }, { name: '' }]; try { t = await app.domain.snapshotTeams(x); } catch { /* teams gone */ }
      const score = res.kind === 'cricket' ? String(res.text || '') : res.started ? `${res.a} – ${res.b}` : '';
      matches.push({ id: f.id, name: x.name || x.autoName || `${t[0].name} v ${t[1].name}`, competition: comp.name || '', date: x.startDate || '', time: x.startTime || '', status: x.status || '',
        score, result: res.finished ? res.status || '' : '', commentators: String(x.commentators || '').split('\n').map((s) => s.trim()).filter(Boolean), officials: String(x.officials || '').split('\n').map((s) => s.trim()).filter(Boolean) });
    }
    const names = new Set(matches.map((m) => m.name));

    // people and money
    const cache = new Map();
    const getSync = (id) => (cache.has(id) ? cache.get(id) : null);
    for (const r of [...(p.crew || []), ...(p.equipment || [])]) for (const id of [r.role, r.crewMember, r.item]) if (id && !cache.has(id)) cache.set(id, await get(id));
    const crew = (p.crew || []).filter((r) => r.role || r.crewMember).map((r) => ({ role: (getSync(r.role) || {}).name || 'Crew', name: full(getSync(r.crewMember)) || 'Not booked', location: r.location || '', confirmed: !!r.confirmed, paid: !!r.paid }));
    let costs = null;
    try { costs = Schema.costing(p, getSync); } catch { costs = null; }

    // what went to air: graphics and adverts from the play logs of the production's days
    const inProd = (e) => e && (e.production === prod.id || e.production === p.name || (e.match && names.has(e.match)));
    const graphics = new Map(), adverts = new Map();
    for (const type of ['playlog', 'adlog']) {
      for (const d of await app.store.list(team, type)) {
        if (d.deleted || (days.size && !days.has(d.data.date))) continue;
        for (const e of d.data.entries || []) {
          if (!inProd(e)) continue;
          const m = type === 'playlog' ? graphics : adverts, k = type === 'playlog' ? e.graphic || e.name : e.advert || e.name;
          const g = m.get(k) || { name: type === 'playlog' ? e.name || e.graphic : e.name, sponsor: e.sponsor || '', plays: 0, seconds: 0 };
          g.plays++; g.seconds += Number(e.seconds) || 0; m.set(k, g);
        }
      }
    }
    const sortPlays = (m) => [...m.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds);

    // music
    let cue = { rows: [], totals: [], totalSeconds: 0 };
    if (app.music) cue = await app.music.cueSheet(prod);
    const uncleared = [];
    for (const r of cue.rows) if (r.track) { const t = await get(r.track); if (t && app.music && !app.music.clearance(t).ok && !uncleared.includes(t.title)) uncleared.push(t.title); }

    // the stream: viewers and recordings
    let stream = null;
    if (p.streamSlug && app.analytics && !app.isLocal) {
      try {
        const rep = await app.analytics.report(team, 366);
        const s = rep.streams.find((x) => x.slug === p.streamSlug);
        stream = { slug: p.streamSlug, title: p.streamTitle || p.name, viewers: s ? s.viewers : 0, peak: s ? s.peak : 0, seconds: s ? s.seconds : 0, videos: s ? s.videos.slice(0, 20) : [] };
      } catch { stream = { slug: p.streamSlug, title: p.streamTitle || p.name, viewers: 0, peak: 0, seconds: 0, videos: [] }; }
    } else if (p.streamSlug) stream = { slug: p.streamSlug, title: p.streamTitle || p.name, viewers: null, peak: null, seconds: null, videos: [] };

    const incidents = (p.incidents || []).filter((x) => x && x.text).map((x) => ({ time: x.time || '', category: x.category || 'Other', severity: x.severity || 'Minor', text: x.text, action: x.action || '', resolved: !!x.resolved }));
    // the ratings given when the production was completed (1–5 per aspect, with a note)
    const rt = p.ratings || {}, ratings = Schema.REPORT_ASPECTS.filter(([k]) => Number(rt[k]) > 0).map(([k, label]) => ({ key: k, label, stars: Math.max(1, Math.min(5, Math.round(Number(rt[k])))), note: (p.ratingNotes || {})[k] || '' }));
    const avg = ratings.length ? Math.round((ratings.reduce((n, r) => n + r.stars, 0) / ratings.length) * 10) / 10 : 0;
    return {
      id: prod.id, team, number: p.number || '', company: org.name || '', name: p.name || 'Production', programme: p.programmeTitle || p.name || '', date: p.date || '', days: Number(p.days) || 1, type: p.type || '', client: p.client || '',
      broadcaster: p.broadcaster || '', producer, venue: [venue.name, venue.city].filter(Boolean).join(', '), txTime: p.txTime || '', summary: p.reportNotes || '',
      matches, crew, costs, graphics: sortPlays(graphics), adverts: sortPlays(adverts),
      music: { cues: cue.rows.length, seconds: cue.totalSeconds, totals: cue.totals, uncleared }, stream, incidents,
      status: p.status || 'Planned', completedAt: p.completedAt || '', completedBy: p.completedBy || '', ratings, average: avg,
      openIssues: incidents.filter((x) => !x.resolved).length, majorIssues: incidents.filter((x) => ['Major', 'Critical'].includes(x.severity)).length,
    };
  }

  function pdf(r) {
    const doc = makePdf({ title: `Production report – ${r.name}`, footer: [r.company, r.name, r.date].filter(Boolean).join('  ·  ') });
    doc.para([{ text: 'PRODUCTION REPORT', bold: true }], { size: 16, after: 4 });
    doc.para([{ text: r.name, bold: true }], { size: 12, after: 6 });
    const det = [['Production no.', r.number], ['Programme', r.programme !== r.name ? r.programme : ''], ['Date', r.date + (r.days > 1 ? ` (${r.days} days)` : '')], ['Type', r.type], ['Client', r.client], ['Broadcaster / channel', r.broadcaster], ['Producer', r.producer], ['Venue', r.venue], ['TX time', r.txTime]].filter((x) => x[1]);
    for (const [k, v] of det) doc.para([{ text: k + ': ', bold: true }, { text: v }], { size: 10, after: 1 });
    if (r.status === 'Completed') doc.para([{ text: 'Completed', bold: true, color: '#1a7f45' }, { text: r.completedAt ? ` on ${String(r.completedAt).slice(0, 10)}${r.completedBy ? ' by ' + r.completedBy : ''}` : '' }], { size: 9.5 });
    if (r.summary) { doc.heading('Summary'); doc.para(r.summary); }
    if (r.ratings.length) {
      doc.heading(`Quality rating: ${r.average} / 5`);
      const stars = (n) => '*'.repeat(n) + '-'.repeat(5 - n);
      doc.table([{ label: 'Aspect', w: 2.2 }, { label: 'Rating', w: 1.2 }, { label: 'Note', w: 5 }], r.ratings.map((x) => ({ cells: [x.label, `${x.stars}/5  ${stars(x.stars)}`, x.note] })), { size: 9, zebra: '#f4f4f4' });
    }

    if (r.matches.length) {
      doc.heading('Matches');
      doc.table([{ label: 'Match', w: 3 }, { label: 'Competition', w: 2 }, { label: 'Score', w: 1.6 }, { label: 'Result', w: 2.2 }],
        r.matches.map((m) => ({ cells: [[{ text: m.name, bold: true }, { text: m.date ? `\n${m.date} ${m.time}` : '' }], m.competition, m.score, m.result || m.status] })), { size: 9 });
      const ppl = r.matches.filter((m) => m.commentators.length || m.officials.length);
      for (const m of ppl) doc.para([{ text: m.name + ': ', bold: true }, { text: [m.commentators.length ? 'Commentators: ' + m.commentators.join(', ') : '', m.officials.length ? 'Officials: ' + m.officials.join(', ') : ''].filter(Boolean).join('  ·  ') }], { size: 9 });
    }

    if (r.crew.length) {
      doc.heading('Crew');
      doc.table([{ label: 'Role', w: 2.5 }, { label: 'Name', w: 2.5 }, { label: 'Location', w: 1.5 }, { label: 'Confirmed', w: 1, align: 'center' }, { label: 'Paid', w: 0.8, align: 'center' }],
        r.crew.map((c) => ({ cells: [c.role, c.name, c.location, c.confirmed ? 'Yes' : '', c.paid ? 'Yes' : ''] })), { size: 9, zebra: '#f4f4f4' });
    }
    if (r.costs && r.costs.lines.length) {
      doc.heading('Costs');
      doc.table([{ label: 'Item', w: 4 }, { label: 'Group', w: 1.4 }, { label: 'Cost', w: 1.4, align: 'right' }, { label: 'Invoice', w: 1.4, align: 'right' }],
        [...r.costs.lines.map((l) => ({ cells: [l.label, l.group, money(l.cost), money(l.invoice)] })),
          { fill: '#e8e8e8', cells: [[{ text: 'Total', bold: true }], '', [{ text: money(r.costs.cost), bold: true }], [{ text: money(r.costs.invoice), bold: true }]] }], { size: 9 });
      doc.para([{ text: `Profit ${money(r.costs.profit)} (${r.costs.margin}% margin)`, bold: true }], { size: 10 });
    }

    doc.heading('What went to air');
    const playTable = (rows, label) => doc.table([{ label, w: 4.5 }, { label: 'Plays', w: 1, align: 'right' }, { label: 'On air', w: 1.4, align: 'right' }], rows.map((g) => ({ cells: [g.sponsor ? `${g.name} (${g.sponsor})` : g.name, String(g.plays), hms(g.seconds)] })), { size: 9, zebra: '#f4f4f4' });
    if (r.graphics.length) playTable(r.graphics, 'Graphics'); else doc.para('No graphics were logged for this production.', { color: '#666666' });
    if (r.adverts.length) playTable(r.adverts, 'Adverts');
    doc.para([{ text: 'Music: ', bold: true }, { text: `${r.music.cues} cue${r.music.cues === 1 ? '' : 's'}, ${hms(r.music.seconds)} in total. The full list is on the music cue sheet.` }], { size: 9.5 });
    if (r.music.uncleared.length) doc.para([{ text: 'Not cleared: ', bold: true, color: '#c62828' }, { text: r.music.uncleared.join(', ') }], { size: 9.5 });

    if (r.stream) {
      doc.heading('Live stream');
      if (r.stream.viewers === null) doc.para(`Watch page /watch/${r.stream.slug}. The viewer numbers are on the website.`);
      else {
        doc.para([{ text: 'Viewers: ', bold: true }, { text: `${r.stream.viewers}   ` }, { text: 'Peak: ', bold: true }, { text: `${r.stream.peak}   ` }, { text: 'Watched: ', bold: true }, { text: hms(r.stream.seconds) }]);
        if (r.stream.videos.length) doc.table([{ label: 'Recording', w: 4 }, { label: 'Viewers', w: 1, align: 'right' }, { label: 'Watched', w: 1.4, align: 'right' }], r.stream.videos.map((v) => ({ cells: [v.title || v.key, String(v.viewers), hms(v.seconds)] })), { size: 9 });
      }
    }
    doc.heading(`Issues${r.incidents.length ? ` (${r.incidents.length}${r.openIssues ? `, ${r.openIssues} open` : ''})` : ''}`);
    const sevFill = { Critical: '#f8d7d7', Major: '#fde7cf' };
    if (r.incidents.length) doc.table([{ label: 'Time', w: 0.8 }, { label: 'Kind', w: 1.1 }, { label: 'Severity', w: 1 }, { label: 'What happened', w: 3.4 }, { label: 'Action', w: 2.4 }, { label: 'Resolved', w: 0.9, align: 'center' }],
      r.incidents.map((x) => ({ fill: sevFill[x.severity] || '', cells: [x.time, x.category, x.severity, x.text, x.action, x.resolved ? 'Yes' : 'No'] })), { size: 8.5, headFill: '#c62828' });
    else doc.para('None recorded.', { color: '#666666' });
    return doc.finish();
  }
  const fileName = (r, what = 'Production report') => `${what} - ${r.name}${r.date && !String(r.name).includes(r.date) ? ' - ' + r.date : ''}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 120);

  return { build, pdf, fileName, hms, money };
}

module.exports = { makeProdReport };
