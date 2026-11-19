'use strict';
// Tech riders (1.6.0). A production's rider is what we bring and deliver and what we need from the venue or client
// (fields riderSetup, riderDeliverables, riderNeeds, riderNotes on the production). It is a PDF, an email, and a private
// link (/rider/<key>) where the venue answers each need: Sorted / Problem / Not needed, with a note. Their answers are
// kept on the production (riderReplies) and what they confirm goes into the venue's technical profile for next time.
const crypto = require('node:crypto');
const Riders = require('../shared/riders');
const { makePdf, loadImage } = require('./pdf');
const { fail, log } = require('./util');

const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const longDate = (iso) => { const t = new Date(String(iso) + 'T12:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && !isNaN(t) ? t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : String(iso || ''); };
const full = (m) => [m.name, m.surname].filter(Boolean).join(' ');
const today = () => new Date().toISOString().slice(0, 10);

function makeRiders(app) {
  const get = async (id) => { const d = id ? await app.store.get(id).catch(() => null) : null; return d && !d.deleted ? d : null; };
  const base = () => String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '');
  const has = (p) => !!((p.riderNeeds || []).some((x) => x.item) || (p.riderDeliverables || []).some((x) => x.item) || p.riderSetup);

  // everything on the rider, as plain values
  async function build(prod) {
    const p = prod.data, org = ((await get(prod.team)) || {}).data || {}, venueDoc = await get(p.venue), venue = (venueDoc && venueDoc.data) || {};
    const crew = new Map();
    for (const r of p.crew || []) { if (!r.role) continue; const role = await get(r.role); const k = ((role && role.data.name) || 'Crew') + (r.location ? ` (${r.location})` : ''); crew.set(k, (crew.get(k) || 0) + 1); }
    const equipment = [];
    for (const r of p.equipment || []) { const it = await get(r.item); if (!it) continue; const cat = it.data.category || 'Other'; let e = equipment.find((x) => x[0] === cat); if (!e) { e = [cat, []]; equipment.push(e); } e[1].push(`${r.quantity || 1} × ${it.data.name}`); }
    const replies = p.riderReplies || {};
    const needs = (p.riderNeeds || []).filter((x) => x.item).map((x) => { const r = replies[Riders.needKey(x)] || {}; return { key: Riders.needKey(x), category: x.category || 'Other', item: x.item, detail: x.detail || '', venueHas: x.venueHas || '', required: x.required !== false, status: r.status || '', note: r.note || '', by: r.by || '', at: r.at || 0 }; });
    let producer = null;
    if (p.producer) { const u = await app.auth.userByEmail(p.producer).catch(() => null); producer = { name: (u && u.data.name) || p.producer, email: p.producer }; }
    let logo = null;
    if (org.image) { try { const img = await app.store.get(org.image); if (img && !img.deleted) logo = loadImage(await app.blobs.get(img)); } catch { logo = null; } }
    return {
      id: prod.id, team: prod.team, orgName: org.name || 'Production', company: [org.address, org.phone, org.email, org.website].filter(Boolean).join('  ·  '), logoId: org.image || '', logo,
      name: p.name || 'Production', number: p.number || '', date: p.date || '', dateText: p.date ? longDate(p.date) + (Number(p.days) > 1 ? ` (${p.days} days)` : '') : '',
      txTime: p.txTime || '', type: p.type || '', event: p.event || '',
      venue: { id: venueDoc ? venueDoc.id : '', name: venue.name || '', city: venue.city || '', address: venue.address || '', contact: p.riderContact || venue.techContact || '', phone: venue.techPhone || '', email: p.riderEmail || venue.techEmail || '' },
      setup: p.riderSetup || '', crew: [...crew].map(([role, n]) => ({ role, n })), equipment,
      deliverables: (p.riderDeliverables || []).filter((x) => x.item).map((x) => ({ item: x.item, detail: x.detail || '' })),
      needs, notes: p.riderNotes || '', producer, progress: Riders.progress(p.riderNeeds, replies), log: (p.riderLog || []).slice(-20),
    };
  }

  function pdf(r) {
    const doc = makePdf({ title: `${r.orgName} tech rider – ${r.name}`, footer: [r.orgName, r.company].filter(Boolean).join('  ·  ') });
    const L = doc.left, top = doc.y, logoW = r.logo ? 130 : 0, colW = doc.width - logoW - (logoW ? 14 : 0);
    if (r.logo) doc.image(r.logo, L + doc.width - logoW, top, logoW, 70);
    doc.para([{ text: `${String(r.orgName).toUpperCase()} TECH RIDER`, bold: true }], { size: 16, width: colW, after: 6 });
    const details = [['Production', r.name], ['Production no.', r.number], ['Date', r.dateText], ['TX / start', r.txTime], ['Venue', [r.venue.name, r.venue.city].filter(Boolean).join(', ')], ['Venue address', r.venue.address],
      ['Venue contact', [r.venue.contact, r.venue.phone].filter(Boolean).join('  ')], ['Our producer', r.producer ? [r.producer.name, r.producer.email].filter(Boolean).join('  ') : '']].filter((x) => x[1]);
    for (const [k, v] of details) doc.para([{ text: k + ': ', bold: true }, { text: v }], { size: 10, width: colW, after: 1 });
    if (r.logo && doc.y > top - 76) doc.y = top - 76;
    doc.space(8);
    if (r.setup || r.crew.length || r.equipment.length) {
      doc.heading('What we bring');
      if (r.setup) doc.para(r.setup);
      if (r.crew.length) doc.para([{ text: 'Crew: ', bold: true }, { text: r.crew.map((c) => `${c.n} × ${c.role}`).join(', ') }]);
      for (const [c, items] of r.equipment) doc.para([{ text: c + ': ', bold: true }, { text: items.join(', ') }]);
    }
    if (r.deliverables.length) {
      doc.heading('What we deliver');
      doc.table([{ label: 'Deliverable', w: 2 }, { label: 'Detail', w: 4 }], r.deliverables.map((x) => ({ cells: [[{ text: x.item, bold: true }], x.detail] })), { size: 9.5 });
    }
    if (r.needs.length) {
      doc.heading('What we need from the venue / client');
      const rows = [];
      for (const cat of [...new Set(r.needs.map((x) => x.category))]) {
        rows.push({ span: true, fill: '#e3f6ec', cells: [[{ text: cat.toUpperCase(), bold: true }]] });
        for (const x of r.needs.filter((y) => y.category === cat)) {
          const ans = x.status ? `${Riders.STATUS[x.status]}${x.note ? ': ' + x.note : ''}` : (x.venueHas ? 'Venue has: ' + x.venueHas : '');
          rows.push({ fill: x.status === 'issue' ? '#fde2e2' : '', cells: [[{ text: x.item, bold: true }], x.detail, x.required ? 'Must' : 'Nice to have', ans] });
        }
      }
      doc.table([{ label: 'What', w: 2.6 }, { label: 'What we need', w: 4 }, { label: '', w: 1.3, align: 'center' }, { label: 'Answer', w: 3 }], rows, { size: 9 });
    }
    if (r.notes) { doc.heading('Notes'); for (const l of String(r.notes).split('\n').filter((x) => x.trim())) doc.para(l); }
    const link = r.key && base() ? `${base()}/rider/${r.key}` : '';
    if (link) { doc.space(6); doc.para([{ text: 'Answer online: ', bold: true }, { text: link }], { size: 9, color: '#333333' }); }
    return doc.finish();
  }
  const fileName = (r) => `Tech rider - ${r.name}${r.date && !r.name.includes(r.date) ? ' - ' + r.date : ''}.pdf`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 120);

  // the private link
  async function key(prod) {
    if (prod.data.riderKey) return prod.data.riderKey;
    const cur = (await app.store.get(prod.id)).data;
    if (cur.riderKey) return cur.riderKey;
    const k = crypto.randomBytes(15).toString('base64url');
    await app.save(prod.team, 'production', prod.id, { ...cur, riderKey: k }, '');
    return k;
  }
  async function byKey(k) {
    if (!/^[\w-]{16,40}$/.test(String(k || ''))) fail(404, 'This link is not valid');
    const p = (await app.store.find('production', 'riderKey', String(k))).find((d) => !d.deleted);
    if (!p) fail(404, 'This link is not valid (any more)');
    return p;
  }
  // what the venue / client sees (no prices, no names of crew)
  async function view(k) {
    const prod = await byKey(k), r = await build(prod);
    const { logo, team, id, ...rest } = r;
    return { ...rest, key: k, logo: r.logoId, pdf: `/api/rider/${encodeURIComponent(k)}/rider.pdf`, status: prod.data.status || 'Planned' };
  }
  async function pdfFor(prod) { const r = await build(prod); if (prod.data.riderKey) r.key = prod.data.riderKey; return { buf: pdf(r), name: fileName(r) }; }

  // the venue / client answers: [{ key, status: ok | issue | na | '', note }]
  async function reply(k, b) {
    const prod = await byKey(k), p = { ...prod.data };
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) fail(400, 'Your name, so the production team knows who answered');
    const known = new Map((p.riderNeeds || []).filter((x) => x.item).map((x) => [Riders.needKey(x), x]));
    const replies = { ...(p.riderReplies || {}) }, changed = [];
    for (const it of Array.isArray(b.items) ? b.items.slice(0, 300) : []) {
      const need = known.get(String(it.key || ''));
      if (!need) continue;
      const status = ['ok', 'issue', 'na', ''].includes(it.status) ? it.status : '';
      const note = String(it.note || '').slice(0, 500);
      const was = replies[Riders.needKey(need)] || {};
      if ((was.status || '') === status && (was.note || '') === note) continue;
      replies[Riders.needKey(need)] = { status, note, by: name, at: Date.now() };
      changed.push({ need, status, note });
    }
    const note = String(b.note || '').slice(0, 2000);
    if (!changed.length && !note) return { ok: true, changed: 0 };
    p.riderReplies = replies;
    p.riderLog = [...(p.riderLog || []), { at: Date.now(), by: name, n: changed.length, issues: changed.filter((c) => c.status === 'issue').length, note }].slice(-50);
    await app.save(prod.team, 'production', prod.id, p, '');
    // what is sorted goes into the venue's profile (their note, or what we asked for)
    const venue = await get(p.venue);
    const sorted = changed.filter((c) => c.status === 'ok');
    if (venue && sorted.length) {
      const v = { ...venue.data }, tech = [...(v.tech || [])];
      for (const c of sorted) {
        const kk = Riders.needKey(c.need), i = tech.findIndex((x) => Riders.needKey(x) === kk);
        const row = { category: c.need.category || 'Other', item: c.need.item, detail: c.note || c.need.detail || '', updated: today() };
        if (i >= 0) tech[i] = { ...tech[i], ...row }; else tech.push(row);
      }
      await app.save(venue.team, 'venue', venue.id, { ...v, tech: tech.slice(0, 200) }, '');
    }
    // tell the producer and whoever sent it
    const to = [...new Set([p.producer, p.riderSentBy].filter(okEmail).map((e) => e.toLowerCase()))];
    const issues = changed.filter((c) => c.status === 'issue');
    const pr = Riders.progress(p.riderNeeds, replies);
    const url = base() ? `${base()}/app/#/edit/production/${prod.id}` : '';
    const title = `${name} answered the tech rider: ${p.name}`;
    for (const e of to) {
      app.mail.send(e, { kind: 'rider', subject: title, title, lines: [
        `${pr.ok} of ${pr.total} sorted${pr.issues ? `, ${pr.issues} problem${pr.issues === 1 ? '' : 's'}` : ''}${pr.mustOpen ? `, ${pr.mustOpen} must-have${pr.mustOpen === 1 ? '' : 's'} still open` : ''}.`,
        ...issues.map((c) => `Problem – ${c.need.item}${c.note ? ': ' + c.note : ''}`), note ? `Note: ${note}` : ''].filter(Boolean),
        button: url ? { url, label: 'Open the production' } : null }).catch(() => {});
    }
    if (app.push && !app.isLocal && to.length) app.push.send(to, { kind: 'rider_reply', title, body: issues.length ? `${issues.length} problem${issues.length === 1 ? '' : 's'}: ${issues.map((c) => c.need.item).join(', ')}` : `${pr.ok} of ${pr.total} sorted`, url, tag: 'rider:' + prod.id }).catch(() => {});
    log(`Tech rider for ${p.name}: ${name} answered ${changed.length} item${changed.length === 1 ? '' : 's'}.`);
    return { ok: true, changed: changed.length, progress: pr };
  }

  // email it: to venue / client addresses, with the PDF and the link to answer
  async function send(prod, { to = [], note = '' } = {}, by) {
    if (!app.mail.enabled()) fail(400, 'Email is not set up on this website yet (Settings → My account → Send me a test email shows what is missing).');
    if (!has(prod.data)) fail(400, 'The tech rider is empty: fill it in (or start from a template) first');
    const list = [...new Set((Array.isArray(to) ? to : String(to || '').split(/[\s,;]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    const bad = list.filter((e) => !okEmail(e));
    if (bad.length) fail(400, `Not an email address: ${bad.join(', ')}`);
    if (!list.length) fail(400, 'Who gets the tech rider? Add an email address');
    const k = await key(prod);
    const fresh = await app.store.get(prod.id);
    const r = await build(fresh); r.key = k;
    const link = `${base()}/rider/${k}`;
    const byName = (by && by.data && (by.data.name || by.data.email)) || '';
    let sent = 0; const failed = [];
    for (const e of list) {
      const res = await app.mail.send(e, { kind: 'rider', subject: `Tech rider: ${r.name}${r.dateText ? ' – ' + r.dateText : ''}`, title: `Tech rider: ${r.name}`,
        lines: [`Here is what ${r.orgName} brings to ${r.name}${r.dateText ? ' on ' + r.dateText : ''}${r.venue.name ? ' at ' + r.venue.name : ''}, and what we need from you. The PDF is attached.`,
          r.needs.length ? `Please answer each item on the link below (Sorted, Problem or Not needed, with a note): ${r.progress.total} item${r.progress.total === 1 ? '' : 's'}, no sign-in needed.` : '',
          note ? String(note).slice(0, 1000) : '', byName ? `Sent by ${byName}.` : ''].filter(Boolean),
        button: { url: link, label: r.needs.length ? 'Answer the tech rider' : 'Open the tech rider' },
        attachments: [{ filename: fileName(r), content: pdf(r), contentType: 'application/pdf' }],
        footer: `Sent from ${app.config.name || 'RFP Manager'} for ${r.orgName}.` });
      if (res.sent) sent++; else failed.push({ email: e, why: res.error || 'could not be sent' });
    }
    if (sent) {
      const cur = (await app.store.get(prod.id)).data;
      await app.save(prod.team, 'production', prod.id, { ...cur, riderSentAt: Date.now(), riderSentTo: [...new Set([...(cur.riderSentTo || []), ...list])].slice(-20), riderSentBy: (by && by.data && by.data.email) || cur.riderSentBy || '' }, by ? by.id : '');
    }
    log(`Tech rider for ${r.name} emailed to ${sent} of ${list.length}${byName ? ' by ' + byName : ''}.`);
    return { sent, failed, url: link };
  }

  return { build, pdf, pdfFor, fileName, key, byKey, view, reply, send, has };
}

module.exports = { makeRiders };
