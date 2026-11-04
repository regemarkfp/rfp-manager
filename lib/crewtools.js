'use strict';
// Production-company tools on the website:
//  · crew answer a booking from the email (I'm in / Can't make it) without signing in: signed links, /r/<token>
//  · clashes: a crew member booked on a day they said they are not available, or on two productions the same day
//  · the client page: a private link (/client/<key>) with the production, its call sheet, rundown, stream, recordings,
//    report, quotes and invoices — nothing else of the team
//  · sponsor reports: proof of play per sponsor and month (adverts on air, streams with their adverts), PDF and email
const crypto = require('node:crypto');
const { makePdf } = require('./pdf');
const { fail, log } = require('./util');

const day = (t) => new Date(t).toISOString().slice(0, 10);
const daysOf = (p) => { const n = Math.max(1, Number(p.days) || 1), out = []; if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return out; for (let i = 0; i < n; i++) out.push(day(Date.parse(p.date + 'T12:00:00Z') + i * 86400e3)); return out; };

function makeCrewTools(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const site = () => String(app.config.publicUrl || app.config.adminUrl || '').replace(/\/+$/, '');
  async function secret() {
    let s = await app.store.kvGet('crew:secret').catch(() => null);
    if (!s) { s = crypto.randomBytes(24).toString('hex'); await app.store.kvSet('crew:secret', s); }
    return s;
  }
  const sign = async (x) => crypto.createHmac('sha256', await secret()).update(x).digest('base64url').slice(0, 22);

  // ---- answering a booking from the email
  async function respondLinks(prodId, crewMember) {
    const base = site();
    if (!base) return null;
    const make = async (a) => { const body = Buffer.from(`${prodId}|${crewMember}|${a}`).toString('base64url'); return `${base}/r/${body}.${await sign(body)}`; };
    return { yes: await make('yes'), no: await make('no') };
  }
  async function respond(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig || sig !== (await sign(body))) fail(403, 'This link is not valid (any more)');
    const [prodId, member, a] = Buffer.from(body, 'base64url').toString().split('|');
    const prod = await get(prodId);
    if (!prod || prod.type !== 'production') fail(404, 'That production is no longer on the calendar');
    const rows = prod.data.crew || [];
    if (!rows.some((r) => r.crewMember === member)) fail(404, 'You are no longer on this production\'s crew');
    const yes = a === 'yes';
    const crew = rows.map((r) => (r.crewMember === member ? { ...r, confirmed: yes, declined: !yes, answeredAt: Date.now() } : r));
    await app.save(prod.team, 'production', prod.id, { ...prod.data, crew }, '');
    const m = ((await get(member)) || {}).data || {}, who = [m.name, m.surname].filter(Boolean).join(' ') || 'A crew member';
    if (app.push) {
      const producers = (await app.store.list(prod.team, 'member')).filter((d) => !d.deleted && ['Admin', 'Producer'].includes(d.data.role)).map((d) => d.data.email).filter(Boolean);
      await app.push.send(producers, { kind: 'production_changed', title: `${who} ${yes ? 'is in' : 'can\'t make it'}: ${prod.data.name}`, body: prod.data.date || '', url: String(app.config.adminUrl || site()).replace(/\/+$/, '') + '/app/#/edit/production/' + prod.id, tag: `ans:${prod.id}:${member}` }).catch(() => {});
    }
    log(`Crew: ${who} ${yes ? 'confirmed' : 'declined'} ${prod.data.name}`);
    return { yes, who, production: prod.data.name, date: prod.data.date || '' };
  }

  // ---- clashes for a production's crew
  async function clashes(prod) {
    const dates = daysOf(prod.data), out = [];
    if (!dates.length) return out;
    const others = (await app.store.list(prod.team, 'production')).filter((d) => !d.deleted && d.id !== prod.id && (d.data.status || '') !== 'Cancelled' && daysOf(d.data).some((x) => dates.includes(x)));
    for (const r of prod.data.crew || []) {
      if (!r.crewMember) continue;
      const m = await get(r.crewMember), name = m ? [m.data.name, m.data.surname].filter(Boolean).join(' ') : '';
      for (const u of (m && m.data.unavailable) || []) {
        const from = u.from || u.to, to = u.to || u.from;
        if (from && dates.some((x) => x >= from && x <= to)) out.push({ crewMember: r.crewMember, name, kind: 'unavailable', text: `${name} is not available ${from === to ? 'on ' + from : `${from} – ${to}`}${u.note ? ' (' + u.note + ')' : ''}` });
      }
      for (const o of others) if ((o.data.crew || []).some((x) => x.crewMember === r.crewMember && !x.declined)) out.push({ crewMember: r.crewMember, name, kind: 'double', production: o.id, text: `${name} is also on ${o.data.name} (${o.data.date})` });
      if (r.declined) out.push({ crewMember: r.crewMember, name, kind: 'declined', text: `${name} said they can't make it` });
    }
    return out;
  }
  // a crew member's own days off (their crew record, found by their email in the team)
  async function memberFor(user, team) {
    const email = String(user.data.email || '').toLowerCase();
    return (await app.store.list(team, 'crewMember')).find((d) => !d.deleted && String(d.data.email || '').trim().toLowerCase() === email) || null;
  }
  async function setUnavailable(user, team, list) {
    const m = await memberFor(user, team);
    if (!m) fail(404, 'You are not on this team\'s crew list (with this email address)');
    const clean = (Array.isArray(list) ? list : []).slice(0, 200).map((u) => ({ from: /^\d{4}-\d{2}-\d{2}$/.test(u.from) ? u.from : '', to: /^\d{4}-\d{2}-\d{2}$/.test(u.to) ? u.to : (u.from || ''), note: String(u.note || '').slice(0, 100) })).filter((u) => u.from);
    await app.save(team, 'crewMember', m.id, { ...m.data, unavailable: clean }, user.id);
    return clean;
  }

  // ---- the client page
  async function clientKey(prod) {
    if (prod.data.clientKey) return prod.data.clientKey;
    const key = crypto.randomBytes(12).toString('base64url');
    await app.save(prod.team, 'production', prod.id, { ...prod.data, clientKey: key }, '');
    return key;
  }
  async function byKey(key) {
    if (!/^[\w-]{12,40}$/.test(String(key || ''))) fail(404, 'This link is not valid');
    const p = (await app.store.find('production', 'clientKey', String(key))).find((d) => !d.deleted);
    if (!p) fail(404, 'This link is not valid (any more)');
    return p;
  }
  async function clientView(key) {
    const p = await byKey(key), d = p.data, org = ((await get(p.team)) || {}).data || {}, venue = ((await get(d.venue)) || {}).data || {};
    const base = `/api/client/${encodeURIComponent(key)}`;
    let videos = [];
    if (d.streamSlug && app.streaming && !app.isLocal) { try { videos = (app.streaming.videosOf(d.streamSlug) || []).map((v) => ({ start: v.start, duration: Math.round(v.duration || 0), url: `/watch/${d.streamSlug}?v=${encodeURIComponent(v.start)}` })); } catch { videos = []; } }
    const matches = [];
    for (const r of d.fixtures || []) { const f = await get(r && r.fixture); if (f) matches.push({ id: f.id, name: f.data.name || f.data.autoName || '', date: f.data.startDate || '', status: f.data.status || '' }); }
    return { company: org.name || '', logo: org.image || '', name: d.name, number: d.number || '', date: d.date || '', days: Number(d.days) || 1, txTime: d.txTime || '', venue: [venue.name, venue.city].filter(Boolean).join(', '), status: d.status || 'Planned',
      description: d.description || '', matches, watch: d.streamSlug ? `/watch/${d.streamSlug}` : '', videos, callsheet: `${base}/callsheet.pdf`, report: d.status === 'Completed' ? `${base}/report.pdf` : '',
      rundown: (d.rundown || []).length > 0, invoices: (d.invoices || []).filter((x) => x.status !== 'Draft').map((x) => ({ number: x.number, kind: x.kind, date: x.date, due: x.due, state: app.invoices.statusOf(x), total: app.invoices.totals(x).total, url: `${base}/doc/${encodeURIComponent(x.number)}.pdf` })) };
  }

  // ---- proof of play per sponsor and month
  async function sponsorReport(team, month) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) fail(400, 'Which month (YYYY-MM)?');
    const adverts = new Map((await app.store.list(team, 'advert')).filter((d) => !d.deleted).map((d) => [d.id, d.data]));
    const by = new Map();
    const row = (sponsor) => { if (!by.has(sponsor)) by.set(sponsor, { sponsor, email: '', plays: 0, seconds: 0, adverts: new Map(), matches: new Set(), days: new Set() }); return by.get(sponsor); };
    for (const d of await app.store.list(team, 'adlog')) {
      if (d.deleted || !String(d.data.date || '').startsWith(month)) continue;
      for (const e of d.data.entries || []) {
        const a = adverts.get(e.advert) || {}, s = row(e.sponsor || a.sponsor || 'No sponsor');
        if (!s.email && a.sponsorEmail) s.email = a.sponsorEmail;
        s.plays++; s.seconds += Number(e.seconds) || 0; s.days.add(d.data.date);
        if (e.match || e.production) s.matches.add(e.match || e.production);
        const k = e.name || a.name || 'Advert', x = s.adverts.get(k) || { name: k, plays: 0, seconds: 0 };
        x.plays++; x.seconds += Number(e.seconds) || 0; s.adverts.set(k, x);
      }
    }
    return [...by.values()].map((s) => ({ ...s, adverts: [...s.adverts.values()].sort((a, b) => b.plays - a.plays), matches: [...s.matches], days: s.days.size })).sort((a, b) => b.plays - a.plays);
  }
  async function sponsorPdf(team, month, sponsor) {
    const r = (await sponsorReport(team, month)).find((x) => x.sponsor === sponsor);
    if (!r) fail(404, 'No plays for that sponsor in that month');
    const org = ((await get(team)) || {}).data || {}, hms = (s) => { s = Math.round(s); return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`; };
    const label = new Date(month + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const doc = makePdf({ title: `Proof of play – ${sponsor} – ${label}`, footer: `${org.name || ''} · proof of play` });
    doc.para([{ text: 'PROOF OF PLAY', bold: true }], { size: 16, after: 4 });
    doc.para([{ text: `${sponsor} · ${label}`, bold: true }], { size: 12, after: 8 });
    doc.para([{ text: 'Plays: ', bold: true }, { text: `${r.plays}   ` }, { text: 'Time on air: ', bold: true }, { text: `${hms(r.seconds)}   ` }, { text: 'Days: ', bold: true }, { text: String(r.days) }]);
    doc.heading('Per advert');
    doc.table([{ label: 'Advert', w: 4 }, { label: 'Plays', w: 1, align: 'right' }, { label: 'On air', w: 1.6, align: 'right' }], r.adverts.map((a) => ({ cells: [a.name, String(a.plays), hms(a.seconds)] })), { zebra: '#f4f4f4', size: 9.5 });
    if (r.matches.length) { doc.heading('Matches and productions'); for (const m of r.matches.slice(0, 80)) doc.para('· ' + m, { size: 9.5, after: 1 }); }
    doc.space(10); doc.para(`Logged automatically by ${org.name || 'RFP Manager'}'s playout system: every play with its start time and real time on air.`, { size: 8.5, color: '#555555' });
    return { buf: doc.finish(), name: `Proof of play - ${sponsor} - ${month}.pdf`.replace(/[\\/:*?"<>|]+/g, '-'), email: r.email };
  }
  async function sendSponsor(team, month, sponsor, to) {
    if (!app.mail || !app.mail.enabled()) fail(400, 'Email is not set up on this website yet');
    const f = await sponsorPdf(team, month, sponsor), email = String(to || f.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Add the sponsor\'s email on their advert (Sponsor email), or type it here');
    const org = ((await get(team)) || {}).data || {};
    const res = await app.mail.send(email, { kind: 'sponsor', subject: `Proof of play: ${sponsor} – ${month}`, title: 'Your proof of play', lines: [`Attached: every play of your adverts in ${month}.`, `Thank you for supporting ${org.name || 'us'}.`],
      attachments: [{ filename: f.name, content: f.buf, contentType: 'application/pdf' }], footer: org.name || '' });
    if (!res.sent) fail(502, 'The email could not be sent: ' + (res.error || 'unknown'));
    return { sent: true, to: email };
  }
  return { respondLinks, respond, clashes, memberFor, setUnavailable, clientKey, byKey, clientView, sponsorReport, sponsorPdf, sendSponsor, daysOf };
}

module.exports = { makeCrewTools };
