'use strict';
// Quotes and invoices: "invoice" records of a production team (kind quote | invoice), numbered RFPQ0001 / RFPINV0001
// (prefixes and the next numbers in the billing details). Every new one starts with the booking fee line (billing
// details), then the production's costing if it is made from a production. Everything stays editable like in Invoice
// Ninja: client, dates, number, lines (item, date, description, unit cost, quantity, discount %), a discount on the
// whole document (% or an amount), VAT, notes, terms, payments. A quote is signed by the client in their portal
// (lib/portal.js), which confirms the production; it becomes an invoice with Convert.
// The PDF follows RegemarkFP's Invoice Ninja layout: logo and company, the document's numbers and the client, the
// lines with their dates, invoice terms with the bank details and the totals, terms and conditions, the tagline.
// Billing details per team (kv "billing:<team>").
const Schema = require('../shared/schema');
const { makePdf, loadImage } = require('./pdf');
const { fail, log, newId } = require('./util');

const STATUS = { quote: ['Draft', 'Sent', 'Accepted', 'Declined', 'Converted'], invoice: ['Draft', 'Sent', 'Partial', 'Paid', 'Cancelled'] };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => (r2(n) < 0 ? '-R' : 'R') + Math.abs(r2(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + (Number(n) || 0) * 86400e3).toISOString().slice(0, 10);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (d) => (isDate(d) ? `${d.slice(8, 10)}-${MON[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}` : '');
const str = (v, n) => String(v === undefined || v === null ? '' : v).slice(0, n);
const FEE_TEXT = 'Secures your date: covers planning, scheduling the crew and preparing the equipment for your production.';

function makeInvoices(app) {
  const get = async (id) => { const d = id ? await app.store.get(id) : null; return d && !d.deleted ? d : null; };
  const typed = async (team, id, type) => { const d = await get(id); return d && d.team === team && d.type === type ? d : null; };

  // ---- billing details
  const DEFAULTS = { legalName: '', regNo: '', vatNo: '', address: '', email: '', phone: '', website: '', bank: '', vatRate: 0, terms: 14, quoteDays: 30, notes: '', conditions: '', tagline: '',
    bookingFeeOn: true, bookingFee: 1500, bookingFeeLabel: 'Booking fee', bookingFeeText: FEE_TEXT, quotePrefix: 'RFPQ', invoicePrefix: 'RFPINV', digits: 4, accent: '#1a8cff' };
  const billing = async (team) => ({ ...DEFAULTS, ...((await app.store.kvGet('billing:' + team).catch(() => null)) || {}) });
  async function setBilling(team, b) {
    const cur = await billing(team), pick = (k) => (b[k] === undefined ? cur[k] : b[k]);
    const next = { ...cur };
    for (const [k, n] of [['legalName', 120], ['regNo', 40], ['vatNo', 40], ['address', 400], ['email', 120], ['phone', 40], ['website', 120], ['bank', 600], ['notes', 600], ['conditions', 20000], ['tagline', 120], ['bookingFeeLabel', 80], ['bookingFeeText', 400]]) next[k] = str(pick(k), n);
    next.vatRate = Math.max(0, Math.min(30, Number(pick('vatRate')) || 0));
    next.terms = Math.max(0, Math.min(365, Number(pick('terms')) || 0));
    next.quoteDays = Math.max(1, Math.min(365, Number(pick('quoteDays')) || 30));
    next.bookingFeeOn = pick('bookingFeeOn') !== false;
    next.bookingFee = Math.max(0, r2(pick('bookingFee')));
    next.quotePrefix = str(pick('quotePrefix'), 12).replace(/[^\w-]/g, '') || 'RFPQ';
    next.invoicePrefix = str(pick('invoicePrefix'), 12).replace(/[^\w-]/g, '') || 'RFPINV';
    next.digits = Math.max(1, Math.min(8, Number(pick('digits')) || 4));
    next.accent = /^#[0-9a-f]{6}$/i.test(String(pick('accent'))) ? pick('accent') : DEFAULTS.accent;
    await app.store.kvSet('billing:' + team, next);
    // the next numbers, when the admin sets them (e.g. to carry on from Invoice Ninja)
    for (const kind of ['quote', 'invoice']) { const n = Number(b[kind === 'quote' ? 'nextQuote' : 'nextInvoice']); if (n >= 1) await app.store.kvSet(`invseq:${team}:${kind}`, Math.floor(n) - 1); }
    return { ...next, ...(await nextNumbers(team)) };
  }

  // ---- numbers: one sequence per team and kind, never a number twice
  const all = async (team) => (await app.store.list(team, 'invoice')).filter((d) => !d.deleted);
  async function nextNumbers(team) {
    const b = await billing(team), out = {};
    for (const kind of ['quote', 'invoice']) out[kind === 'quote' ? 'nextQuote' : 'nextInvoice'] = (Number(await app.store.kvGet(`invseq:${team}:${kind}`).catch(() => 0)) || 0) + 1;
    out.nextQuoteNumber = b.quotePrefix + String(out.nextQuote).padStart(b.digits, '0');
    out.nextInvoiceNumber = b.invoicePrefix + String(out.nextInvoice).padStart(b.digits, '0');
    return out;
  }
  let numbering = Promise.resolve();
  function nextNumber(team, kind) {
    const run = async () => {
      const b = await billing(team), prefix = kind === 'quote' ? b.quotePrefix : b.invoicePrefix, key = `invseq:${team}:${kind}`;
      const taken = new Set((await all(team)).map((d) => d.data.number));
      let n = (Number(await app.store.kvGet(key).catch(() => 0)) || 0) + 1, num;
      for (;; n++) { num = prefix + String(n).padStart(b.digits, '0'); if (!taken.has(num)) break; }
      await app.store.kvSet(key, n);
      return num;
    };
    numbering = numbering.then(run, run);
    return numbering;
  }
  // after an import: carry on after the highest number with our prefix
  async function bumpTo(team, kind, number) {
    const b = await billing(team), prefix = kind === 'quote' ? b.quotePrefix : b.invoicePrefix;
    const m = new RegExp(`^${prefix.replace(/[-]/g, '\\-')}(\\d+)$`).exec(String(number || ''));
    if (!m) return;
    const key = `invseq:${team}:${kind}`, cur = Number(await app.store.kvGet(key).catch(() => 0)) || 0;
    if (Number(m[1]) > cur) await app.store.kvSet(key, Number(m[1]));
  }

  // ---- lines and totals
  const cleanLine = (l) => ({ item: str(l.item !== undefined ? l.item : l.label, 160).trim(), description: str(l.description, 2000), date: isDate(l.date) ? l.date : '',
    qty: l.qty === '' || l.qty === undefined || l.qty === null || isNaN(Number(l.qty)) ? 1 : Number(l.qty), rate: r2(l.rate !== undefined ? l.rate : l.amount),
    discount: Math.max(0, Math.min(100, Number(l.discount) || 0)), service: str(l.service, 80), fee: !!l.fee });
  function totals(x) {
    const lineTotals = (x.lines || []).map((l) => r2((Number(l.qty) || 0) * (Number(l.rate) || 0) * (1 - (Number(l.discount) || 0) / 100)));
    const net = r2(lineTotals.reduce((n, v) => n + v, 0));
    const discountAmount = x.discountType === 'amount' ? Math.min(net, r2(x.discount)) : r2((net * (Number(x.discount) || 0)) / 100);
    const subtotal = r2(net - discountAmount), vat = r2((subtotal * (Number(x.vatRate) || 0)) / 100), total = r2(subtotal + vat);
    const paid = r2((x.payments || []).reduce((n, p) => n + (Number(p.amount) || 0), 0));
    return { lineTotals, net, discountAmount, subtotal, vat, total, paid, balance: r2(total - paid) };
  }
  // what the client and the lists show: an invoice past its due date with something owed is Overdue; a sent quote past it Expired
  function statusOf(x) {
    const t = totals(x);
    if (x.kind === 'invoice' && ['Sent', 'Partial'].includes(x.status) && t.balance > 0 && x.due && x.due < today()) return 'Overdue';
    if (x.kind === 'quote' && x.status === 'Sent' && x.due && x.due < today()) return 'Expired';
    return x.status;
  }
  const shape = (d, { full = true } = {}) => {
    if (!d) return null;
    const x = d.data, t = totals(x);
    const out = { id: d.id, ...x, ...t, state: statusOf(x), updatedAt: d.updatedAt };
    if (!full && out.signature) out.signature = { name: out.signature.name, at: out.signature.at };
    return out;
  };

  // the lines of a production's costing that are invoiced (crew by role, equipment, other costs, recharged expenses)
  async function linesOf(prod) {
    const cache = new Map();
    for (const r of [...(prod.data.crew || []), ...(prod.data.equipment || [])]) for (const id of [r.role, r.crewMember, r.item]) if (id && !cache.has(id)) cache.set(id, ((await get(id)) || {}).data || null);
    const c = Schema.costing(prod.data, (id) => cache.get(id) || null);
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

  const clientEmailOf = (c) => (c ? String(c.data.email || ((c.data.contacts || []).find((x) => x.primary && x.email) || (c.data.contacts || []).find((x) => x.email) || {}).email || '').trim() : '');
  // a client's own price for a product or service
  const rateFor = (client, l) => { const r = client && l.service && (client.data.rates || []).find((x) => x.service === l.service); return r && r.rate !== '' && r.rate !== undefined ? r2(r.rate) : l.rate; };

  async function create(team, { kind, client, production, booking, lines, title } = {}, by) {
    if (!STATUS[kind]) fail(400, 'A quote or an invoice?');
    const b = await billing(team);
    const prod = production ? await typed(team, production, 'production') : null;
    if (production && !prod) fail(404, 'No such production');
    let cl = client ? await typed(team, client, 'client') : null;
    if (client && !cl) fail(404, 'No such client');
    if (!cl && prod && prod.data.clientRef) cl = await typed(team, prod.data.clientRef, 'client');
    const date = today(), ls = [];
    if (b.bookingFeeOn && b.bookingFee > 0) ls.push({ item: b.bookingFeeLabel || 'Booking fee', description: b.bookingFeeText, qty: 1, rate: b.bookingFee, fee: true, date: (prod && prod.data.date) || '' });
    if (prod) for (const l of await linesOf(prod)) ls.push({ item: l.label, qty: l.qty, rate: l.amount, date: prod.data.date || '' });
    if (Array.isArray(lines)) ls.push(...lines.slice(0, 200));
    const data = { kind, number: await nextNumber(team, kind), client: cl ? cl.id : '', clientName: cl ? cl.data.name : (prod && prod.data.client) || '', clientEmail: cl ? '' : (prod && prod.data.clientEmail) || '',
      production: prod ? prod.id : '', booking: booking || (prod && prod.data.booking) || '', title: str(title || (prod && prod.data.name) || '', 160), date,
      due: plusDays(date, kind === 'quote' ? b.quoteDays : (cl && Number(cl.data.terms) > 0 ? Number(cl.data.terms) : b.terms)),
      lines: ls.map(cleanLine).map((l) => ({ ...l, rate: rateFor(cl, l) })).filter((l) => l.item || l.description),
      discount: cl ? Math.max(0, Math.min(100, Number(cl.data.discount) || 0)) : 0, discountType: 'percent', vatRate: b.vatRate, notes: '', terms: '', poNumber: '',
      status: 'Draft', payments: [], createdBy: str(by, 120), createdAt: Date.now() };
    const doc = await app.save(team, 'invoice', newId('inv_'), data, '');
    log(`Invoices: ${data.number} made${prod ? ' for ' + prod.data.name : ''}`);
    return shape(doc);
  }
  async function docOf(team, id) { const d = await typed(team, id, 'invoice'); if (!d) fail(404, 'No such quote or invoice'); return d; }
  async function one(team, id) { return shape(await docOf(team, id)); }
  async function list(team, { client, production, kind } = {}) {
    return (await all(team)).filter((d) => (!client || d.data.client === client) && (!production || d.data.production === production) && (!kind || d.data.kind === kind))
      .map((d) => shape(d, { full: false })).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)));
  }

  async function update(team, id, b, by) {
    const d = await docOf(team, id), x = { ...d.data };
    if (b.number !== undefined && b.number !== x.number) {
      const n = str(b.number, 40).trim();
      if (!n) fail(400, 'Give it a number');
      if ((await all(team)).some((o) => o.id !== id && o.data.number === n)) fail(409, `${n} is already used`);
      x.number = n;
    }
    if (b.client !== undefined) {
      const cl = b.client ? await typed(team, b.client, 'client') : null;
      if (b.client && !cl) fail(404, 'No such client');
      x.client = cl ? cl.id : ''; if (cl) { x.clientName = cl.data.name; x.clientEmail = ''; }
    }
    if (b.clientName !== undefined && !x.client) x.clientName = str(b.clientName, 160);
    if (b.clientEmail !== undefined) x.clientEmail = str(b.clientEmail, 160).trim();
    if (b.production !== undefined) { const p = b.production ? await typed(team, b.production, 'production') : null; x.production = p ? p.id : ''; }
    for (const [k, n] of [['title', 160], ['notes', 4000], ['terms', 4000], ['poNumber', 60]]) if (b[k] !== undefined) x[k] = str(b[k], n);
    for (const k of ['date', 'due']) if (b[k] !== undefined && isDate(b[k])) x[k] = b[k];
    if (Array.isArray(b.lines)) x.lines = b.lines.slice(0, 300).map(cleanLine).filter((l) => l.item || l.description || l.rate);
    if (b.discount !== undefined) x.discount = Math.max(0, Number(b.discount) || 0);
    if (b.discountType !== undefined) x.discountType = b.discountType === 'amount' ? 'amount' : 'percent';
    if (x.discountType === 'percent') x.discount = Math.min(100, x.discount || 0);
    if (b.vatRate !== undefined) x.vatRate = Math.max(0, Math.min(30, Number(b.vatRate) || 0));
    if (b.status !== undefined && b.status !== x.status) {
      if (!STATUS[x.kind].includes(b.status)) fail(400, 'Not a status for this');
      x.status = b.status;
      if (b.status === 'Sent') x.sentAt = x.sentAt || Date.now();
      // marked paid by hand: the rest is recorded as a payment, like Invoice Ninja
      if (b.status === 'Paid') { const t = totals(x); if (t.balance > 0) x.payments = [...(x.payments || []), { amount: t.balance, date: today(), method: 'Marked paid', ref: '', by: str(by, 120), at: Date.now() }]; x.paidAt = Date.now(); }
    }
    const saved = await app.save(team, 'invoice', id, x, '');
    return shape(saved);
  }
  async function addPayment(team, id, p, by) {
    const d = await docOf(team, id), x = { ...d.data };
    if (x.kind !== 'invoice') fail(400, 'Payments are for invoices');
    const amount = r2(p.amount);
    if (!(amount !== 0)) fail(400, 'How much was paid?');
    x.payments = [...(x.payments || []), { amount, date: isDate(p.date) ? p.date : today(), method: str(p.method || 'EFT', 40), ref: str(p.ref, 80), by: str(by, 120), at: Date.now() }];
    const t = totals(x);
    x.status = t.balance <= 0 ? 'Paid' : 'Partial';
    if (x.status === 'Paid') x.paidAt = Date.now();
    return shape(await app.save(team, 'invoice', id, x, ''));
  }
  async function removePayment(team, id, index) {
    const d = await docOf(team, id), x = { ...d.data }, ps = [...(x.payments || [])];
    if (!ps[index]) fail(404, 'No such payment');
    ps.splice(index, 1); x.payments = ps;
    const t = totals(x);
    if (x.kind === 'invoice' && ['Paid', 'Partial'].includes(x.status)) x.status = t.paid <= 0 ? 'Sent' : t.balance <= 0 ? 'Paid' : 'Partial';
    return shape(await app.save(team, 'invoice', id, x, ''));
  }
  async function convert(team, id, by) {
    const d = await docOf(team, id), q = d.data;
    if (q.kind !== 'quote') fail(400, 'Only a quote becomes an invoice');
    if (q.convertedTo && await get(q.convertedTo)) fail(409, 'This quote is an invoice already');
    const b = await billing(team), cl = q.client ? await typed(team, q.client, 'client') : null, date = today();
    const data = { ...q, kind: 'invoice', number: await nextNumber(team, 'invoice'), date, due: plusDays(date, cl && Number(cl.data.terms) > 0 ? Number(cl.data.terms) : b.terms), status: 'Draft', payments: [], quote: d.id,
      signature: undefined, sentAt: undefined, convertedTo: undefined, source: undefined, createdBy: str(by, 120), createdAt: Date.now() };
    for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
    const inv = await app.save(team, 'invoice', newId('inv_'), data, '');
    await app.save(team, 'invoice', d.id, { ...q, status: q.status === 'Accepted' ? 'Accepted' : 'Converted', convertedTo: inv.id }, '');
    return shape(inv);
  }
  async function duplicate(team, id, kind, by) {
    const d = await docOf(team, id), k = STATUS[kind] ? kind : d.data.kind, b = await billing(team), date = today();
    const data = { ...d.data, kind: k, number: await nextNumber(team, k), date, due: plusDays(date, k === 'quote' ? b.quoteDays : b.terms), status: 'Draft', payments: [], createdBy: str(by, 120), createdAt: Date.now() };
    for (const key of ['signature', 'sentAt', 'paidAt', 'convertedTo', 'quote', 'source', 'viewedAt']) delete data[key];
    return shape(await app.save(team, 'invoice', newId('inv_'), data, ''));
  }
  async function remove(team, id, userId) { await docOf(team, id); await app.remove(id, userId || ''); return {}; }

  // ---- the client signs a quote (portal): accepted, the production is confirmed, the team hears
  async function sign(team, id, { name, image, email, ip }) {
    const d = await docOf(team, id), x = { ...d.data };
    if (x.kind !== 'quote') fail(400, 'Only quotes are signed');
    if (x.status === 'Draft') fail(409, 'This quote is not sent yet');
    if (x.signature) fail(409, `This quote was signed by ${x.signature.name}`);
    if (['Declined', 'Converted'].includes(x.status)) fail(409, 'This quote is not open any more');
    const nm = str(name, 120).trim();
    if (nm.length < 2) fail(400, 'Type your full name');
    const img = String(image || '');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 400000) fail(400, 'Sign in the box first');
    x.signature = { name: nm, image: img, email: str(email, 160), ip: str(ip, 60), at: Date.now() };
    x.status = 'Accepted';
    const saved = await app.save(team, 'invoice', id, x, '');
    if (x.production) {
      const p = await typed(team, x.production, 'production');
      if (p && ['Planned', '', undefined].includes(p.data.status)) await app.save(team, 'production', p.id, { ...p.data, status: 'Confirmed', quoteSigned: x.number }, '');
    }
    if (x.booking && app.bookings && app.bookings.refresh) app.bookings.refresh(x.booking).catch(() => {});
    const to = (await app.store.list(team, 'member')).filter((m) => !m.deleted && Schema.CAN.edit(m.data.role)).map((m) => m.data.email);
    const url = String(app.config.adminUrl || app.config.publicUrl || '').replace(/\/+$/, '') + '/app/#/doc/' + id;
    if (app.push) app.push.send(to, { kind: 'booking', title: `Quote ${x.number} signed`, body: `${nm} (${x.clientName || ''}) accepted ${money(totals(x).total)}.${x.production ? ' The production is confirmed.' : ''}`, url }).catch(() => {});
    if (app.mail) app.mail.send(to, { subject: `Quote ${x.number} signed by ${nm}`, title: `Quote ${x.number} accepted`, lines: [`${nm} signed quote ${x.number} for ${x.clientName || 'the client'} (${money(totals(x).total)}).`, x.production ? 'The production is now Confirmed.' : ''].filter(Boolean), button: { url, label: 'Open the quote' } }).catch(() => {});
    log(`Invoices: ${x.number} signed by ${nm}`);
    return shape(saved);
  }

  // ---- the PDF, laid out like RegemarkFP's Invoice Ninja documents
  async function pdf(team, id) {
    const d = await docOf(team, id), x = d.data, t = totals(x), b = await billing(team), org = ((await get(team)) || {}).data || {};
    const cl = x.client ? await typed(team, x.client, 'client') : null, c = cl ? cl.data : {};
    const accent = b.accent || '#1a8cff', quote = x.kind === 'quote';
    const doc = makePdf({ title: `${quote ? 'Quote' : 'Invoice'} ${x.number}`, footer: [b.legalName || org.name, b.regNo && 'Reg. ' + b.regNo, b.vatNo && 'VAT ' + b.vatNo].filter(Boolean).join('  ·  ') });
    const M = doc.left, W = doc.width;
    let logo = null;
    if (org.image) { try { const im = await app.store.get(org.image); if (im && !im.deleted) logo = loadImage(await app.blobs.get(im)); } catch { logo = null; } }
    const top = doc.y;
    let logoH = 0;
    if (logo) { const s = Math.min(200 / logo.w, 78 / logo.h, 1.5), w = logo.w * s; logoH = logo.h * s; doc.image(logo, M - (200 - w), top, 200, 78); }
    // the company (middle) and its address (right)
    const lines = (s) => String(s || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let yy = top - 10;
    const col = (x0, rows) => { let y = top - 10; for (const r of rows) { doc.text(x0, y, r.text, { size: 9.5, color: r.color || '#1d1d1d', bold: !!r.bold }); y -= 14.5; } return y; };
    const y1 = col(M + 215, [{ text: b.legalName || org.name || '', color: accent }, ...[b.email || org.email, b.phone || org.phone, b.website].filter(Boolean).map((v) => ({ text: v }))]);
    const y2 = col(M + 375, lines(b.address).map((v) => ({ text: v })));
    yy = Math.min(y1, y2, top - logoH) - 22;
    doc.y = yy;
    doc.para([{ text: quote ? 'QUOTE' : (b.vatNo && t.vat ? 'TAX INVOICE' : 'INVOICE'), color: accent }], { size: 10, after: 6 });
    doc.hline(M, M + W, doc.y, '#d0d0d0', 0.8); doc.y -= 12;
    // the document's numbers (left) and the client (right)
    const clientTotal = cl ? r2((await all(team)).filter((o) => o.data.client === cl.id && o.data.kind === 'invoice' && !['Draft', 'Cancelled'].includes(o.data.status)).reduce((n, o) => n + totals(o.data).balance, 0)) : t.balance;
    const meta = quote ? [['Quote Number', x.number], ['Quote Date', dmy(x.date)], ['Valid Until', dmy(x.due)], ['Quote Total', money(t.total)]]
      : [['Invoice Number', x.number], ['Invoice Date', dmy(x.date)], ['Due Date', dmy(x.due)], ['Invoice Total', money(t.total)], ['Balance Due', money(t.balance)], ['Account Balance', money(clientTotal)]];
    if (x.poNumber) meta.push(['PO Number', x.poNumber]);
    const m0 = doc.y;
    let ym = m0;
    for (const [k, v] of meta) { doc.text(M + 2, ym - 9.5, k, { size: 9.5 }); doc.text(M + 106, ym - 9.5, v, { size: 9.5 }); ym -= 15; }
    let yc = m0;
    const crow = (txt, bold) => { if (!txt) return; for (const ln of doc.wrap([{ text: txt, bold }], W - 270, 9.5)) { doc.text(M + 270, yc - 9.5, ln.map((r) => r.text).join(''), { size: 9.5, bold }); yc -= 15; } };
    crow(c.name || x.clientName || '', true);
    crow(c.vatNo ? 'VAT ' + c.vatNo : c.regNo || '');
    for (const l of lines(c.address)) crow(l);
    crow(c.phone || '');
    crow(clientEmailOf(cl) || x.clientEmail || '');
    if (x.title) { yc -= 4; crow((quote ? 'For: ' : 'Re: ') + x.title); }
    doc.y = Math.min(ym, yc) - 8;
    doc.hline(M, M + W, doc.y, '#d0d0d0', 0.8); doc.y -= 6;
    // the lines
    const hasDisc = (x.lines || []).some((l) => Number(l.discount) > 0);
    doc.table([{ label: 'Item', w: 1.85 }, { label: 'Production/\nRental Date', w: 1.4 }, { label: 'Description', w: 2.2 }, { label: 'Unit Cost', w: 1.1 }, { label: 'Quantity', w: 1.0 }, { label: 'Discount', w: 1.0 }, { label: 'Line Total', w: 1.2, align: 'right' }],
      (x.lines || []).map((l, i) => ({ cells: [[{ text: l.item || '', color: accent }], dmy(l.date), l.description || '', money(l.rate), String(l.qty), hasDisc && Number(l.discount) ? `${Number(l.discount)}%` : '', money(t.lineTotals[i])] })),
      { headFill: '#ffffff', headColor: '#111111', size: 9, pad: 6, zebra: '#f4f4f4', lines: '#d6d6d6' });
    // invoice terms + bank (left), totals (right)
    const tot = [['Net', money(t.net)]];
    if (t.discountAmount) tot.push([x.discountType === 'amount' ? 'Discount' : `Discount ${Number(x.discount)}%`, '-' + money(t.discountAmount)]);
    tot.push(['Subtotal', money(t.subtotal)]);
    if (Number(x.vatRate)) tot.push([`VAT ${Number(x.vatRate)}%`, money(t.vat)]);
    tot.push(['Total', money(t.total)]);
    if (!quote) tot.push(['Paid to Date', money(t.paid)], ['Balance Due', money(t.balance)]);
    doc.ensure(Math.max(tot.length * 16 + 30, 140));
    doc.y -= 12;
    const t0 = doc.y;
    tot.forEach(([k, v], i) => { const yv = t0 - 10 - i * 16; doc.text(M + 345, yv, k, { size: 9.5 }); doc.text(M + W - 6 - doc.widthOf(v, false, 9.5), yv, v, { size: 9.5, bold: k === 'Balance Due' || (quote && k === 'Total') }); });
    doc.y = t0 - 8;
    doc.para([{ text: quote ? 'Quote Terms:' : 'Invoice Terms:', bold: true }], { size: 9.5, width: 320, after: 6 });
    if (x.terms) doc.para(x.terms, { size: 9.5, width: 320, after: 6 });
    if (b.bank) doc.para([{ text: 'BANKING DETAILS\n' + b.bank, bold: true }], { size: 9.5, width: 320, lead: 1.25, after: 6 });
    if (x.notes) doc.para(x.notes, { size: 9.5, width: 320, after: 6 });
    doc.y = Math.min(doc.y, t0 - tot.length * 16 - 14);
    // the client's signature on a quote: the production goes ahead once it is signed
    if (quote) {
      doc.ensure(130); doc.space(10);
      doc.para([{ text: 'Acceptance', bold: true }], { size: 12, after: 4 });
      doc.para('By signing, the client accepts this quote and the terms and conditions below. The production is confirmed once the quote is signed.', { size: 9, color: '#444444', after: 10 });
      const s = x.signature;
      const y0 = doc.y;
      if (s && s.image) { try { const img = loadImage(Buffer.from(s.image.split(',')[1], 'base64')); const sc = Math.min(200 / img.w, 60 / img.h, 1), w = img.w * sc; doc.image(img, M - (200 - w), y0, 200, 60); } catch { /* the name below still shows */ } }
      const ly = y0 - 66;
      doc.hline(M, M + 210, ly, '#333333', 0.7); doc.hline(M + 235, M + 400, ly, '#333333', 0.7); doc.hline(M + 425, M + W, ly, '#333333', 0.7);
      if (s) { doc.text(M + 237, ly + 4, s.name, { size: 10 }); doc.text(M + 427, ly + 4, dmy(new Date(s.at).toISOString().slice(0, 10)), { size: 10 }); }
      doc.text(M, ly - 11, 'Client signature', { size: 8.5, color: '#555555' }); doc.text(M + 235, ly - 11, 'Full name', { size: 8.5, color: '#555555' }); doc.text(M + 425, ly - 11, 'Date', { size: 8.5, color: '#555555' });
      doc.y = ly - 18;
      if (s) doc.para(`Signed electronically on ${new Date(s.at).toISOString().replace('T', ' ').slice(0, 16)} UTC${s.email ? ' by ' + s.email : ''}${s.ip ? ' from ' + s.ip : ''}.`, { size: 8, color: '#666666' });
    }
    // terms and conditions, the tagline and the bank details again
    if (b.conditions) {
      doc.ensure(80); doc.space(14);
      doc.para([{ text: 'Terms and Conditions', bold: false }], { size: 14, after: 8 });
      for (const raw of String(b.conditions).split(/\n/)) {
        const l = raw.trim();
        if (!l) { doc.space(4); continue; }
        if (/^\d+\.\s+\S/.test(l) && l.length < 70 && !/^\d+\.\d/.test(l)) doc.para([{ text: l, bold: true }], { size: 9.5, after: 4 });
        else if (/^[-•*]\s+/.test(l)) doc.para('•  ' + l.replace(/^[-•*]\s+/, ''), { size: 9.5, x: M + 14, width: W - 14, after: 2 });
        else doc.para(l, { size: 9.5, after: 5 });
      }
    }
    if (b.notes) { doc.space(6); doc.para(b.notes, { size: 8.5, color: '#555555' }); }
    if (b.tagline) { doc.space(12); doc.para([{ text: b.tagline.toUpperCase(), color: '#00b85c' }], { size: 10, after: 8 }); }
    if (b.bank && b.conditions) doc.para([{ text: 'BANKING DETAILS\n' + b.bank, bold: true }], { size: 9.5, lead: 1.25 });
    if (!quote && x.status === 'Paid') { doc.space(8); doc.para([{ text: `PAID${x.paidAt ? ' on ' + dmy(new Date(x.paidAt).toISOString().slice(0, 10)) : ''}`, bold: true, color: '#1a7f45' }], { size: 12 }); }
    const prod = x.production ? await get(x.production) : null;
    return { buf: doc.finish(), name: `${quote ? 'Quote' : 'Invoice'} ${x.number}${x.title || (prod && prod.data.name) ? ' - ' + (x.title || prod.data.name) : ''}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) + '.pdf' };
  }

  // ---- email it: the PDF attached, and a button to the client's portal (sign the quote / pay the invoice)
  async function send(team, id, { to, note } = {}, by) {
    if (!app.mail || !app.mail.enabled()) fail(400, 'Email is not set up on this website yet');
    let d = await docOf(team, id), x = d.data;
    let cl = x.client ? await typed(team, x.client, 'client') : null;
    const email = String(to || x.clientEmail || clientEmailOf(cl) || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Give the client\'s email address');
    // a client without a record gets one, so they have a portal
    if (!cl && app.portal) {
      cl = await app.save(team, 'client', newId('cli_'), { name: x.clientName || email, email, contacts: [{ name: x.clientName || '', email, primary: true }] }, '');
      d = await app.save(team, 'invoice', id, { ...x, client: cl.id, clientEmail: '' }, ''); x = d.data;
    }
    const portal = cl && app.portal ? await app.portal.linkFor(cl, email, by) : '';
    const f = await pdf(team, id), b = await billing(team), t = totals(x), org = ((await get(team)) || {}).data || {};
    const quote = x.kind === 'quote', what = quote ? 'quote' : 'invoice';
    const buttons = portal ? [{ url: `${portal}?doc=${encodeURIComponent(id)}`, label: quote ? 'Review and sign the quote' : app.pay && app.pay.enabled() && t.balance > 0 ? `Pay ${money(t.balance)} now` : 'Open your client portal' }] : [];
    const res = await app.mail.send(email, { kind: 'invoice', buttons, subject: `${quote ? 'Quote' : 'Invoice'} ${x.number} from ${b.legalName || org.name || ''}${x.title ? ': ' + x.title : ''}`, title: `${quote ? 'Quote' : 'Invoice'} ${x.number}`,
      lines: [`Please find our ${what}${x.title ? ' for ' + x.title : ''} attached.`, quote ? 'To go ahead, sign the quote in your client portal: the production is confirmed once it is signed.' : '', portal ? 'Your client portal has all your quotes, invoices, productions and adverts, and you can add colleagues there.' : '', note ? str(note, 1000) : '', by ? `Sent by ${by}.` : ''].filter(Boolean),
      sections: [{ heading: quote ? 'Quote' : 'Invoice', rows: [['Number', x.number], ['Date', dmy(x.date)], [quote ? 'Valid until' : 'Due', dmy(x.due)], [quote ? 'Total' : 'Balance due', money(quote ? t.total : t.balance)]] }, ...(!quote && b.bank ? [{ heading: 'Banking details', rows: [['', b.bank], ['Reference', x.number]] }] : [])],
      attachments: [{ filename: f.name, content: f.buf, contentType: 'application/pdf' }], footer: b.legalName || org.name || '' });
    if (!res.sent) fail(502, 'The email could not be sent: ' + (res.error || 'unknown'));
    const cur = (await get(id)).data;
    await app.save(team, 'invoice', id, { ...cur, status: cur.status === 'Draft' ? 'Sent' : cur.status, sentAt: Date.now(), sentTo: email }, '');
    if (x.booking && app.bookings && app.bookings.refresh) app.bookings.refresh(x.booking).catch(() => {});
    log(`Invoices: ${x.number} emailed to ${email}`);
    return { sent: true, to: email, portal };
  }

  // ---- everything owed and to pay, for the team: documents (by state) and crew not yet paid on finished productions
  async function overview(team) {
    const prods = new Map((await app.store.list(team, 'production')).filter((d) => !d.deleted).map((d) => [d.id, d]));
    const docs = (await list(team)).map((x) => { const p = prods.get(x.production); return { ...x, productionName: p ? p.data.name : '', productionNumber: p ? p.data.number || '' : '', client: x.clientName || '' }; });
    const crew = [];
    const cache = new Map(); const g = async (id) => { if (!cache.has(id)) cache.set(id, ((await get(id)) || {}).data || null); return cache.get(id); };
    for (const p of prods.values()) {
      if (p.data.date && p.data.date <= today()) for (const r of p.data.crew || []) {
        if (!r.crewMember || r.paid) continue;
        const role = await g(r.role), m = await g(r.crewMember);
        const days = Math.max(1, Number(p.data.days) || 1), rate = Number(r.rate) || Number(role && role.rate) || 0;
        crew.push({ production: p.id, productionName: p.data.name, date: p.data.date, name: [m && m.name, m && m.surname].filter(Boolean).join(' '), role: (role && role.name) || '', amount: r2(rate * days) });
      }
    }
    const open = docs.filter((x) => x.kind === 'invoice' && ['Sent', 'Partial', 'Overdue'].includes(x.state));
    return { docs, crew: crew.sort((a, b) => String(a.date).localeCompare(String(b.date))), owed: r2(open.reduce((n, x) => n + x.balance, 0)),
      overdue: r2(docs.filter((x) => x.state === 'Overdue').reduce((n, x) => n + x.balance, 0)), quotesOpen: r2(docs.filter((x) => x.kind === 'quote' && x.state === 'Sent').reduce((n, x) => n + x.total, 0)), crewOwed: r2(crew.reduce((n, c) => n + c.amount, 0)) };
  }
  const forProduction = async (prod) => (await all(prod.team)).filter((d) => d.data.production === prod.id).map((d) => shape(d, { full: false }));

  // ---- once, on the website: quotes and invoices kept on productions (before 0.1.48) become records of their own
  async function migrate() {
    if (app.isLocal) return 0;
    let n = 0;
    for (const p of await app.store.listType('production')) {
      if (p.deleted || !(p.data.invoices || []).length) continue;
      const have = new Set((await all(p.team)).map((d) => d.data.number));
      for (const x of p.data.invoices) {
        if (have.has(x.number)) continue;
        const data = { kind: x.kind, number: x.number, client: p.data.clientRef || '', clientName: p.data.client || '', clientEmail: p.data.clientEmail || '', production: p.id, booking: p.data.booking || '', title: p.data.name || '',
          date: x.date || today(), due: x.due || x.date || today(), lines: (x.lines || []).map((l) => cleanLine({ item: l.label, qty: l.qty, rate: l.amount, date: p.data.date || '' })), discount: 0, discountType: 'percent', vatRate: Number(x.vatRate) || 0,
          notes: x.notes || '', terms: '', poNumber: '', status: x.status === 'Paid' ? 'Paid' : x.status || 'Draft', payments: [], createdBy: x.createdBy || '', createdAt: x.createdAt || Date.now(), sentAt: x.sentAt, paidAt: x.paidAt };
        if (data.status === 'Paid') data.payments = [{ amount: totals(data).total, date: x.paidAt ? new Date(x.paidAt).toISOString().slice(0, 10) : data.date, method: 'Before 0.1.48', ref: '', at: x.paidAt || Date.now() }];
        for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
        await app.save(p.team, 'invoice', newId('inv_'), data, '');
        n++;
      }
      const cur = await get(p.id);
      if (cur) await app.save(p.team, 'production', p.id, { ...cur.data, invoices: [], invoicesMoved: Date.now() }, '');
    }
    if (n) log(`Invoices: ${n} quotes and invoices moved off their productions`);
    return n;
  }

  return { billing, setBilling, nextNumbers, nextNumber, bumpTo, create, one, list, update, addPayment, removePayment, convert, duplicate, remove, sign, pdf, send, overview, forProduction, migrate, linesOf, totals, statusOf, shape, cleanLine, clientEmailOf, money, dmy, STATUS };
}

module.exports = { makeInvoices };
