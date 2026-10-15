'use strict';
// The call sheet of a production, on the server: the same content as the Call sheet page in the app, laid out as
// email sections (the email body) and as a PDF (the attachment). send() emails it to the crew a Producer picks.
const Schema = require('../shared/schema');
const { makePdf, loadImage } = require('./pdf');
const { fail, log } = require('./util');

const longDate = (iso) => { const t = new Date(String(iso) + 'T12:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && !isNaN(t) ? t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : String(iso || ''); };
const full = (m) => [m.name, m.surname].filter(Boolean).join(' ');
const up = (s) => String(s || '').toUpperCase();
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());

function makeCallsheet(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d.data : null; };

  // everything on the sheet, as plain values
  async function build(prod) {
    const p = prod.data, team = prod.team;
    const org = (await get(team)) || {}, venue = (await get(p.venue)) || {};
    const people = new Map();
    const person = async (id) => { if (!id) return {}; if (!people.has(id)) people.set(id, (await get(id)) || {}); return people.get(id); };
    const fx = [];
    for (const r of p.fixtures || []) { const f = await get(r.fixture); if (f) fx.push(f); }
    const comps = [];
    for (const f of fx) { const c = await get(f.competition); if (c && c.name && !comps.includes(c.name)) comps.push(c.name); }
    const event = p.event || comps.join(', ') || p.type || '';
    const fixtureLine = fx.map((f) => String(f.name || f.autoName || '').replace(/\s*\([^)]*\)$/, '')).filter(Boolean).join('  ·  ');

    const contacts = [];
    for (const c of p.contacts || []) { if (!(c.title || c.name || c.crewMember)) continue; const m = await person(c.crewMember); contacts.push({ title: c.title || 'Contact', name: c.name || full(m), phone: c.phone || m.phone || '', email: m.email || '', crewMember: c.crewMember || '' }); }

    const roleName = new Map();
    const groups = [];
    for (const r of p.crew || []) {
      if (!(r.role || r.crewMember)) continue;
      if (r.role && !roleName.has(r.role)) roleName.set(r.role, ((await get(r.role)) || {}).name || '');
      const m = await person(r.crewMember);
      const k = r.location || '';
      let g = groups.find((x) => x.name === k); if (!g) { g = { name: k, rows: [] }; groups.push(g); }
      g.rows.push({ crewMember: r.crewMember || '', role: roleName.get(r.role) || 'Crew', name: full(m), phone: m.phone || '', email: m.email || '', call: r.callTime || '', tx: r.productionTime || p.txTime || '', location: k, confirmed: !!r.confirmed });
    }
    const where = { Venue: venue.city || venue.name || '', Gallery: p.remoteStudio ? (String(p.remoteStudioAddress || '').split(',').slice(-2, -1)[0] || '').trim() : '' };
    for (const g of groups) g.where = where[g.name] || '';

    const info = String(p.crewNotes || '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^([^:]{2,40}):\s*(.+)$/.exec(x); return m ? [m[1], m[2]] : ['', x]; });
    const equipment = [];
    for (const r of p.equipment || []) { const it = await get(r.item); if (!it) continue; const cat = it.category || 'Other'; let e = equipment.find((x) => x[0] === cat); if (!e) { e = [cat, []]; equipment.push(e); } e[1].push(`${r.quantity || 1} × ${it.name}${r.notes ? ' (' + r.notes + ')' : ''}`); }
    const rundown = Schema.rundownTimes(p.rundown || [], '').map((r, i) => ({ n: i + 1, time: r.startText, content: r.content || '', description: r.description || '', source: r.source || '', audio: r.audio || '', graphics: r.graphics || '', duration: r.duration ? Schema.fmtDuration(Schema.parseDuration(r.duration)) : '', color: r.color || '' }));

    let logo = null;
    if (org.image) { try { const img = await app.store.get(org.image); if (img && !img.deleted) logo = loadImage(await app.blobs.get(img)); } catch { logo = null; } }

    const autoName = venue.name && p.date && p.name === `${venue.name} – ${p.date}`;
    return {
      id: prod.id, team, orgName: org.name || 'Production', name: p.name || 'Production', date: p.date || '', dateText: p.date ? longDate(p.date) + (Number(p.days) > 1 ? ` (${p.days} days)` : '') : '',
      details: [['Date', p.date ? longDate(p.date) + (Number(p.days) > 1 ? ` (${p.days} days)` : '') : ''], ['Production', !fx.length || !autoName ? p.name : ''], ['Event', event], ['Fixture', fixtureLine],
        ['Venue', [venue.name, venue.city].filter(Boolean).join(', ')], ['Venue address', venue.address || ''], ['Remote studio', [p.remoteStudio, p.remoteStudioAddress].filter(Boolean).join(', ')], ['TX time', p.txTime || '']].filter((r) => r[1]),
      contacts, groups, description: p.description || '', info,
      hospitals: (p.hospitals || []).filter((x) => x.name).map((x) => ({ name: x.name, area: x.area || '', phone: x.phone || '' })),
      equipment, rundown, logo,
      company: [org.address, org.phone, org.email, org.website].filter(Boolean).join('  ·  '),
    };
  }

  // the email body: sections for mail.layout; `me` = the crew member it goes to (their rows in bold)
  function sections(cs, me) {
    const crewRows = [];
    for (const g of cs.groups) {
      if (g.name || cs.groups.length > 1) crewRows.push(Object.assign([up(g.name || 'Crew') + (g.where ? ` (${g.where})` : ''), '', '', '', ''], { mine: true }));
      for (const r of g.rows) { const row = [r.role, r.name || 'To be confirmed', r.phone, r.call ? 'Call ' + r.call : '', r.tx ? 'TX ' + r.tx : '']; if (me && r.crewMember === me) row.mine = true; crewRows.push(row); }
    }
    return [
      { heading: `${cs.orgName} call sheet`, rows: cs.details },
      { heading: 'Key contacts', rows: cs.contacts.map((c) => [c.title, [c.name, c.phone].filter(Boolean).join('  ')]) },
      { heading: 'Crew', rows: crewRows },
      { heading: 'Additional information', rows: [...(cs.description ? [['', cs.description]] : []), ...cs.info] },
      { heading: 'Emergency: nearest hospitals', rows: cs.hospitals.map((x) => [x.name, [x.area, x.phone].filter(Boolean).join('  ·  ')]) },
      { heading: 'Equipment', rows: cs.equipment.map(([c, items]) => [c, items.join(', ')]) },
      { heading: 'Rundown', rows: cs.rundown.map((r) => [String(r.n), r.time, [up(r.content), up(r.description)].filter(Boolean).join(' – '), [r.source, r.audio, r.graphics].filter(Boolean).map(up).join(' / '), r.duration]) },
    ];
  }

  // the PDF: laid out like the printed call sheet
  function pdf(cs) {
    const doc = makePdf({ title: `${cs.orgName} call sheet – ${cs.name}`, footer: [cs.orgName, cs.company].filter(Boolean).join('  ·  ') });
    const L = doc.left, top = doc.y;
    // header: title and details on the left, logo on the right
    const logoW = cs.logo ? 130 : 0;
    const colW = doc.width - logoW - (logoW ? 14 : 0);
    if (cs.logo) doc.image(cs.logo, L + doc.width - logoW, top, logoW, 70);
    doc.para([{ text: `${up(cs.orgName)} CALL SHEET`, bold: true }], { size: 16, width: colW, after: 6 });
    for (const [k, v] of cs.details) doc.para([{ text: k + ': ', bold: true }, { text: v }], { size: 10, width: colW, after: 1 });
    for (const c of cs.contacts) doc.para([{ text: c.title + ': ', bold: true }, { text: [c.name, c.phone].filter(Boolean).join('  ') }], { size: 10, width: colW, after: 1 });
    if (cs.logo && doc.y > top - 76) doc.y = top - 76;
    doc.space(8);

    doc.heading('Crew', { before: 4 });
    const rows = [];
    for (const g of cs.groups) {
      if (g.name || cs.groups.length > 1) rows.push({ span: true, fill: '#e3f6ec', cells: [[{ text: up(g.name || 'Crew'), bold: true }, { text: g.where ? `  (${g.where})` : '' }]] });
      for (const r of g.rows) rows.push({ cells: [[{ text: r.role, bold: true }], r.name || 'To be confirmed', r.phone, r.call, r.tx] });
    }
    if (rows.length) doc.table([{ label: 'Role', w: 3 }, { label: 'Name', w: 3 }, { label: 'Contact', w: 2.2 }, { label: 'Call time', w: 1.3, align: 'center' }, { label: 'TX time', w: 1.3, align: 'center' }], rows, { size: 9.5 });
    else doc.para('No crew booked yet.', { color: '#666666' });

    if (cs.description || cs.info.length) {
      doc.heading('Additional information');
      if (cs.description) doc.para(cs.description);
      for (const [k, v] of cs.info) doc.para(k ? [{ text: k + ': ', bold: true }, { text: v }] : v);
    }
    if (cs.hospitals.length) {
      doc.heading('Emergency: nearest hospitals', { color: '#c62828' });
      doc.table([{ label: 'Hospital', w: 3 }, { label: 'Area', w: 2 }, { label: 'Phone', w: 2 }], cs.hospitals.map((x) => ({ cells: [[{ text: x.name, bold: true }], x.area, x.phone] })), { headFill: '#c62828' });
    }
    if (cs.equipment.length) {
      doc.heading('Equipment');
      for (const [c, items] of cs.equipment) doc.para([{ text: c + ': ', bold: true }, { text: items.join(', ') }]);
    }
    if (cs.rundown.length) {
      doc.heading('Rundown');
      doc.table([{ label: '#', w: 0.5, align: 'center' }, { label: 'Time', w: 1.2, align: 'center' }, { label: 'Content', w: 4 }, { label: 'Source', w: 1.5 }, { label: 'Sound', w: 1.5 }, { label: 'Graphics', w: 1.6 }, { label: 'Duration', w: 1.2, align: 'center' }],
        cs.rundown.map((r) => ({ fill: /^#?[0-9a-f]{6}$/i.test(r.color) ? r.color : '', cells: [String(r.n), r.time, [{ text: up(r.content), bold: true }, ...(r.description ? [{ text: '\n' + up(r.description) }] : [])], up(r.source), up(r.audio), up(r.graphics), r.duration] })),
        { size: 8, headFill: '#1f4e9c' });
    }
    return doc.finish();
  }

  const fileName = (cs) => `Call sheet - ${cs.name}${cs.date && !cs.name.includes(cs.date) ? ' - ' + cs.date : ''}.pdf`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 120);

  // who can get it: the crew (and key contacts picked from the crew list), one entry per person
  function recipients(cs) {
    const out = new Map();
    for (const g of cs.groups) for (const r of g.rows) {
      if (!r.crewMember) continue;
      const cur = out.get(r.crewMember);
      if (cur) { if (!cur.roles.includes(r.role)) cur.roles.push(r.role); cur.confirmed = cur.confirmed || r.confirmed; continue; }
      out.set(r.crewMember, { crewMember: r.crewMember, name: r.name, email: r.email, roles: [r.role], call: r.call, location: r.location, confirmed: r.confirmed, contact: false });
    }
    for (const c of cs.contacts) if (c.crewMember && !out.has(c.crewMember)) out.set(c.crewMember, { crewMember: c.crewMember, name: c.name, email: c.email, roles: [c.title], call: '', location: '', confirmed: false, contact: true });
    return [...out.values()];
  }

  // email the call sheet. to: crew member ids; extra: more addresses; note: a line from the Producer
  async function send(prod, { to = [], extra = [], note = '' } = {}, by) {
    if (!app.mail.enabled()) fail(400, 'Email is not set up on this website yet (Settings → My account → Send me a test email shows what is missing).');
    const cs = await build(prod);
    const list = recipients(cs);
    const picked = new Set((Array.isArray(to) ? to : []).map(String));
    const people = list.filter((r) => picked.has(r.crewMember));
    const skipped = people.filter((r) => !okEmail(r.email)).map((r) => ({ name: r.name, why: 'no email address on their crew record' }));
    const targets = people.filter((r) => okEmail(r.email)).map((r) => ({ email: r.email.trim(), name: r.name, crewMember: r.crewMember, row: r }));
    for (const e of (Array.isArray(extra) ? extra : String(extra || '').split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 30)) {
      if (!okEmail(e)) { skipped.push({ name: e, why: 'not an email address' }); continue; }
      if (!targets.some((t) => t.email.toLowerCase() === e.toLowerCase())) targets.push({ email: e, name: '', crewMember: '' });
    }
    if (!targets.length) fail(400, skipped.length ? 'None of the people picked has an email address. Add one on their crew record.' : 'Pick who gets the call sheet');
    const attachment = { filename: fileName(cs), content: pdf(cs), contentType: 'application/pdf' };
    const byName = (by && by.data && (by.data.name || by.data.email)) || '';
    const base = String(app.config.publicUrl || '').replace(/\/+$/, '');
    let sent = 0;
    const failed = [];
    for (const t of targets) {
      const r = t.row;
      const lines = [
        `${t.name ? 'Hi ' + t.name.split(' ')[0] + ', here' : 'Here'} is the call sheet for ${cs.name}${cs.dateText ? ' on ' + cs.dateText : ''}. It is also attached as a PDF.`,
        r && (r.roles.length || r.call) ? `You: ${[r.roles.join(', '), r.location, r.call && 'call time ' + r.call].filter(Boolean).join(' · ')}.` : '',
        note ? String(note).slice(0, 1000) : '',
        byName ? `Sent by ${byName}.` : ''].filter(Boolean);
      const res = await app.mail.send(t.email, {
        kind: 'callsheet', subject: `Call sheet: ${cs.name}${cs.dateText ? ' – ' + cs.dateText : ''}`, title: `Call sheet: ${cs.name}`, lines, sections: sections(cs, t.crewMember),
        button: base ? { url: `${base}/app/#/callsheet/${cs.id}`, label: 'Open the call sheet' } : null,
        attachments: [attachment], footer: `Sent from ${app.config.name || 'RFP Manager'} because you are on the crew of ${cs.name}.` });
      if (res.sent) sent++; else failed.push({ name: t.name || t.email, why: res.error || 'could not be sent' });
    }
    log(`Call sheet for ${cs.name} emailed to ${sent} of ${targets.length}${byName ? ' by ' + byName : ''}.`);
    return { sent, failed, skipped, file: attachment.filename };
  }

  return { build, sections, pdf, recipients, send, fileName };
}

module.exports = { makeCallsheet };
