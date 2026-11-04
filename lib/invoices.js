'use strict';
// Quotes and invoices from a production's costing: numbered per production team and year (Q2026-001, INV2026-001),
// kept on the production (data.invoices), as a PDF with the team's billing details, emailed to the client, and
// followed up: Draft → Sent → Paid (Overdue once the due date passes); quotes Accepted or Declined.
// Billing details per team (kv "billing:<team>"): legal name, registration and VAT numbers, address, bank, VAT %,
// payment terms (days).
const Schema = require('../shared/schema');
const { makePdf, loadImage } = require('./pdf');
const { fail, log } = require('./util');

const STATUS = { quote: ['Draft', 'Sent', 'Accepted', 'Declined'], invoice: ['Draft', 'Sent', 'Paid', 'Cancelled'] };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => 'R ' + r2(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

function makeInvoices(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const billing = async (team) => ({ legalName: '', regNo: '', vatNo: '', address: '', email: '', phone: '', bank: '', vatRate: 0, terms: 14, notes: '', ...((await app.store.kvGet('billing:' + team).catch(() => null)) || {}) });
  async function setBilling(team, b) {
    const cur = await billing(team), s = (x, n) => String(x === undefined ? '' : x).slice(0, n);
    const next = { legalName: s(b.legalName ?? cur.legalName, 120), regNo: s(b.regNo ?? cur.regNo, 40), vatNo: s(b.vatNo ?? cur.vatNo, 40), address: s(b.address ?? cur.address, 400), email: s(b.email ?? cur.email, 120),
      phone: s(b.phone ?? cur.phone, 40), bank: s(b.bank ?? cur.bank, 400), vatRate: Math.max(0, Math.min(30, Number(b.vatRate ?? cur.vatRate) || 0)), terms: Math.max(0, Math.min(120, Number(b.terms ?? cur.terms) || 0)), notes: s(b.notes ?? cur.notes, 600) };
    await app.store.kvSet('billing:' + team, next);
    return next;
  }
  // what is owed when: an invoice that is Sent and past its due date is Overdue
  const statusOf = (x) => (x.kind === 'invoice' && x.status === 'Sent' && x.due && x.due < today() ? 'Overdue' : x.status);
  const totals = (x) => { const sub = r2((x.lines || []).reduce((n, l) => n + r2((Number(l.qty) || 1) * (Number(l.amount) || 0)), 0)); const vat = r2((sub * (Number(x.vatRate) || 0)) / 100); return { subtotal: sub, vat, total: r2(sub + vat) }; };
  const shape = (x) => ({ ...x, ...totals(x), state: statusOf(x) });

  async function nextNumber(team, kind, date) {
    const year = String(date || today()).slice(0, 4), key = `invno:${team}:${year}:${kind}`;
    const n = (Number(await app.store.kvGet(key).catch(() => 0)) || 0) + 1;
    await app.store.kvSet(key, n);
    return `${kind === 'quote' ? 'Q' : 'INV'}${year}-${String(n).padStart(3, '0')}`;
  }
  // the lines of a production's costing that are invoiced (crew, equipment, other costs, recharged expenses)
  async function linesOf(prod) {
    const cache = new Map();
    for (const r of [...(prod.data.crew || []), ...(prod.data.equipment || [])]) for (const id of [r.role, r.crewMember, r.item]) if (id && !cache.has(id)) cache.set(id, ((await get(id)) || {}).data || null);
    const c = Schema.costing(prod.data, (id) => cache.get(id) || null);
    // crew by role (no names on a client's invoice), the rest as they are
    const out = new Map();
    for (const l of c.lines) {
      if (!(l.invoice > 0)) continue;
      const label = l.group === 'Crew' ? (l.label.split(' – ')[0] || 'Crew') : l.label;
      const k = l.group + ':' + label, cur = out.get(k) || { label: label + (l.days > 1 ? ` (${l.days} days)` : ''), qty: 0, amount: r2(l.invoice / (l.group === 'Equipment' ? l.qty : 1)) };
      cur.qty += l.group === 'Equipment' ? l.qty : 1;
      out.set(k, cur);
    }
    return [...out.values()];
  }
  async function create(prod, kind, by) {
    if (!['quote', 'invoice'].includes(kind)) fail(400, 'A quote or an invoice?');
    const b = await billing(prod.team), date = today(), lines = await linesOf(prod);
    if (!lines.length) fail(400, 'Nothing to invoice yet: add crew, equipment or other costs with invoice amounts to the production');
    const x = { id: Math.random().toString(36).slice(2, 10), kind, number: await nextNumber(prod.team, kind, date), date, due: kind === 'invoice' ? plusDays(date, b.terms) : plusDays(date, 30),
      lines, vatRate: b.vatRate, status: 'Draft', notes: '', createdBy: by || '', createdAt: Date.now() };
    const cur = (await get(prod.id)).data;
    await app.save(prod.team, 'production', prod.id, { ...cur, invoices: [...(cur.invoices || []), x] }, '');
    return shape(x);
  }
  async function update(prod, number, b) {
    const cur = (await get(prod.id)).data, list = cur.invoices || [], i = list.findIndex((x) => x.number === number);
    if (i < 0) fail(404, 'No such quote or invoice');
    const x = { ...list[i] };
    if (b.status !== undefined) { if (!STATUS[x.kind].includes(b.status)) fail(400, 'Not a status for this'); x.status = b.status; if (b.status === 'Paid') x.paidAt = x.paidAt || Date.now(); if (b.status === 'Sent') x.sentAt = x.sentAt || Date.now(); }
    if (Array.isArray(b.lines)) x.lines = b.lines.slice(0, 60).map((l) => ({ label: String(l.label || '').slice(0, 160), qty: Math.max(0, Number(l.qty) || 0), amount: r2(l.amount) })).filter((l) => l.label);
    for (const k of ['due', 'date']) if (b[k] !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(b[k])) x[k] = b[k];
    if (b.vatRate !== undefined) x.vatRate = Math.max(0, Math.min(30, Number(b.vatRate) || 0));
    if (b.notes !== undefined) x.notes = String(b.notes).slice(0, 1000);
    list[i] = x;
    await app.save(prod.team, 'production', prod.id, { ...cur, invoices: list }, '');
    return shape(x);
  }
  async function pdf(prod, number) {
    const x = (prod.data.invoices || []).find((y) => y.number === number);
    if (!x) fail(404, 'No such quote or invoice');
    const b = await billing(prod.team), org = ((await get(prod.team)) || {}).data || {}, t = totals(x);
    const doc = makePdf({ title: `${x.kind === 'quote' ? 'Quote' : 'Tax invoice'} ${x.number}`, footer: [b.legalName || org.name, b.regNo && 'Reg. ' + b.regNo, b.vatNo && 'VAT ' + b.vatNo].filter(Boolean).join('  ·  ') });
    let logo = null;
    if (org.image) { try { const im = await app.store.get(org.image); if (im && !im.deleted) logo = loadImage(await app.blobs.get(im)); } catch { logo = null; } }
    const top = doc.y;
    if (logo) doc.image(logo, doc.left + doc.width - 120, top, 120, 60);
    doc.para([{ text: x.kind === 'quote' ? 'QUOTE' : (b.vatNo && t.vat ? 'TAX INVOICE' : 'INVOICE'), bold: true }], { size: 18, width: doc.width - 140, after: 4 });
    doc.para([{ text: b.legalName || org.name || '', bold: true }], { size: 10, width: doc.width - 140, after: 1 });
    for (const l of [b.address, [b.email || org.email, b.phone || org.phone].filter(Boolean).join('  ·  '), b.regNo && 'Registration ' + b.regNo, b.vatNo && 'VAT number ' + b.vatNo].filter(Boolean)) doc.para(l, { size: 9, width: doc.width - 140, after: 1 });
    if (logo && doc.y > top - 66) doc.y = top - 66;
    doc.space(10);
    doc.table([{ label: '', w: 1.3 }, { label: '', w: 2.4 }, { label: '', w: 1.3 }, { label: '', w: 2 }],
      [{ cells: [[{ text: x.kind === 'quote' ? 'Quote no.' : 'Invoice no.', bold: true }], x.number, [{ text: 'Date', bold: true }], x.date] },
        { cells: [[{ text: 'To', bold: true }], prod.data.client || '', [{ text: x.kind === 'quote' ? 'Valid until' : 'Due', bold: true }], x.due] },
        { cells: [[{ text: 'Production', bold: true }], [prod.data.number, prod.data.name].filter(Boolean).join(' · '), [{ text: 'Production date', bold: true }], prod.data.date || ''] }], { headFill: '#ffffff', headColor: '#ffffff', size: 9.5 });
    doc.space(6);
    doc.table([{ label: 'Description', w: 5 }, { label: 'Qty', w: 0.8, align: 'right' }, { label: 'Unit price', w: 1.6, align: 'right' }, { label: 'Amount', w: 1.6, align: 'right' }],
      [...x.lines.map((l) => ({ cells: [l.label, String(l.qty), money(l.amount), money((Number(l.qty) || 1) * l.amount)] })),
        { cells: ['', '', [{ text: 'Subtotal', bold: true }], money(t.subtotal)] },
        ...(Number(x.vatRate) ? [{ cells: ['', '', `VAT ${x.vatRate}%`, money(t.vat)] }] : []),
        { fill: '#e8e8e8', cells: ['', '', [{ text: 'Total', bold: true }], [{ text: money(t.total), bold: true }]] }], { size: 9.5, zebra: '#f6f6f6' });
    if (x.notes) { doc.space(6); doc.para(x.notes, { size: 9.5 }); }
    if (x.kind === 'invoice' && b.bank) { doc.heading('Payment details'); doc.para(b.bank, { size: 9.5 }); doc.para(`Please use ${x.number} as the reference.`, { size: 9.5 }); }
    if (b.notes) { doc.space(6); doc.para(b.notes, { size: 8.5, color: '#555555' }); }
    if (x.status === 'Paid') { doc.space(8); doc.para([{ text: `PAID${x.paidAt ? ' on ' + new Date(x.paidAt).toISOString().slice(0, 10) : ''}`, bold: true, color: '#1a7f45' }], { size: 12 }); }
    return { buf: doc.finish(), name: `${x.kind === 'quote' ? 'Quote' : 'Invoice'} ${x.number} - ${prod.data.name || ''}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) + '.pdf' };
  }
  async function send(prod, number, { to, note } = {}, by) {
    if (!app.mail || !app.mail.enabled()) fail(400, 'Email is not set up on this website yet');
    const email = String(to || prod.data.clientEmail || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Give the client\'s email address (on the production, or here)');
    const x = (prod.data.invoices || []).find((y) => y.number === number);
    if (!x) fail(404, 'No such quote or invoice');
    const f = await pdf(prod, number), b = await billing(prod.team), t = totals(x), org = ((await get(prod.team)) || {}).data || {};
    const what = x.kind === 'quote' ? 'quote' : 'invoice';
    const res = await app.mail.send(email, { kind: 'invoice', subject: `${what === 'quote' ? 'Quote' : 'Invoice'} ${x.number} from ${b.legalName || org.name || ''}: ${prod.data.name || ''}`, title: `${what === 'quote' ? 'Quote' : 'Invoice'} ${x.number}`,
      lines: [`Please find our ${what} for ${prod.data.name || 'the production'} attached.`, note ? String(note).slice(0, 1000) : '', by ? `Sent by ${by}.` : ''].filter(Boolean),
      sections: [{ heading: what === 'quote' ? 'Quote' : 'Invoice', rows: [['Number', x.number], ['Date', x.date], [what === 'quote' ? 'Valid until' : 'Due', x.due], ['Total', money(t.total)]] }, ...(what === 'invoice' && b.bank ? [{ heading: 'Payment details', rows: [['', b.bank], ['Reference', x.number]] }] : [])],
      attachments: [{ filename: f.name, content: f.buf, contentType: 'application/pdf' }], footer: b.legalName || org.name || '' });
    if (!res.sent) fail(502, 'The email could not be sent: ' + (res.error || 'unknown'));
    if (x.status === 'Draft') await update(prod, number, { status: 'Sent' });
    log(`Invoices: ${x.number} emailed to ${email}`);
    return { sent: true, to: email };
  }
  // everything owed and to pay, for the team: invoices (by state) and crew not yet paid on finished productions
  async function overview(team) {
    const prods = (await app.store.list(team, 'production')).filter((d) => !d.deleted);
    const docs = [], crew = [];
    const cache = new Map(); const g = async (id) => { if (!cache.has(id)) cache.set(id, ((await get(id)) || {}).data || null); return cache.get(id); };
    for (const p of prods) {
      for (const x of p.data.invoices || []) docs.push({ ...shape(x), production: p.id, productionName: p.data.name, productionNumber: p.data.number || '', client: p.data.client || '' });
      if (p.data.date && p.data.date <= today()) for (const r of p.data.crew || []) {
        if (!r.crewMember || r.paid) continue;
        const role = await g(r.role), m = await g(r.crewMember);
        const days = Math.max(1, Number(p.data.days) || 1), rate = Number(r.rate) || Number(role && role.rate) || 0;
        crew.push({ production: p.id, productionName: p.data.name, date: p.data.date, name: [m && m.name, m && m.surname].filter(Boolean).join(' '), role: (role && role.name) || '', amount: r2(rate * days) });
      }
    }
    docs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const owed = r2(docs.filter((x) => x.kind === 'invoice' && ['Sent', 'Overdue'].includes(x.state)).reduce((n, x) => n + x.total, 0));
    const overdue = r2(docs.filter((x) => x.state === 'Overdue').reduce((n, x) => n + x.total, 0));
    return { docs, crew: crew.sort((a, b) => String(a.date).localeCompare(String(b.date))), owed, overdue, crewOwed: r2(crew.reduce((n, c) => n + c.amount, 0)) };
  }
  return { billing, setBilling, create, update, pdf, send, overview, linesOf, totals, statusOf, STATUS };
}

module.exports = { makeInvoices };
