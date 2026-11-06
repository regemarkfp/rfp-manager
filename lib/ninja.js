'use strict';
// Importing from Invoice Ninja (v5 API): clients (with their contacts), products, quotes and invoices (with what was
// paid), and optionally each document's own PDF as a copy. Run from Settings (Admins) with the Invoice Ninja address
// and an API token; the token is used for this run only and never stored. Running it again updates what came from
// Invoice Ninja before (matched by Invoice Ninja's ids) and adds what is new. Numbering carries on after the highest
// imported number (RFPINV0556 → the next invoice is RFPINV0557).
const crypto = require('node:crypto');
const { fail, log, newId } = require('./util');
const { fileNameFor } = require('./blobs');

const INV_STATUS = { 1: 'Draft', 2: 'Sent', 3: 'Partial', 4: 'Paid', 5: 'Cancelled', 6: 'Cancelled' };
const QUOTE_STATUS = { 1: 'Draft', 2: 'Sent', 3: 'Accepted', 4: 'Converted', '-1': 'Sent' };
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// "2026-09-24", "24-Sep-2026", "24/09/2026" → 2026-09-24 ('' when it is not a date)
function isoDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{4})$/.exec(s);
  if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function makeNinja(app) {
  const jobs = new Map();          // team → status
  const fetcher = () => (app.config.ninja && app.config.ninja.fetch) || fetch;

  async function call(base, token, path) {
    const r = await fetcher()(`${base}/api/v1/${path}`, { headers: { 'X-API-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (r.status === 401 || r.status === 403) fail(401, 'Invoice Ninja did not accept the token');
    if (!r.ok) fail(502, `Invoice Ninja said ${r.status} for ${path.split('?')[0]}`);
    return r;
  }
  async function pages(base, token, what, status) {
    const out = [];
    for (let page = 1; page <= 500; page++) {
      const j = await (await call(base, token, `${what}?per_page=100&page=${page}&status=active,archived`)).json();
      out.push(...(j.data || []));
      status.step = `${what}: ${out.length}`;
      const pg = j.meta && j.meta.pagination;
      if (!pg || page >= (Number(pg.total_pages) || 1) || !(j.data || []).length) break;
    }
    return out.filter((x) => !x.is_deleted);
  }

  function start(team, { url, token, pdfs }, by) {
    const base = String(url || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    if (!/^https?:\/\/[^\s/]+/.test(base)) fail(400, 'Give the address of your Invoice Ninja, e.g. https://invoicing.co');
    if (String(token || '').trim().length < 20) fail(400, 'Paste an API token from Invoice Ninja (Settings → Account Management → Integrations → API Tokens)');
    const cur = jobs.get(team);
    if (cur && cur.running) fail(409, 'An import is already running');
    const status = { running: true, step: 'Starting', started: Date.now(), by, counts: { clients: 0, products: 0, quotes: 0, invoices: 0, pdfs: 0, skipped: 0 }, notes: [] };
    jobs.set(team, status);
    run(team, base, String(token).trim(), !!pdfs, status).then(() => { status.running = false; status.finished = Date.now(); status.step = 'Done'; })
      .catch((e) => { status.running = false; status.finished = Date.now(); status.error = e.message; log('Invoice Ninja import:', e.message); })
      .finally(() => app.store.kvSet('ninja:last:' + team, { ...status }).catch(() => {}));
    return { started: true };
  }
  async function status(team) { return jobs.get(team) || (await app.store.kvGet('ninja:last:' + team).catch(() => null)) || { running: false }; }

  async function run(team, base, token, pdfs, status) {
    const existing = (type) => app.store.list(team, type).then((l) => l.filter((d) => !d.deleted));
    const fromNinja = (list) => new Map(list.filter((d) => d.data.source && d.data.source.system === 'invoiceninja').map((d) => [String(d.data.source.id), d]));

    // ---- clients
    const nClients = await pages(base, token, 'clients', status);
    const clients = await existing('client'), byNinja = fromNinja(clients), byName = new Map(clients.map((d) => [String(d.data.name || '').trim().toLowerCase(), d]));
    const clientId = new Map();             // Invoice Ninja client id → our client id
    for (const c of nClients) {
      const name = String(c.display_name || c.name || '').trim() || ((c.contacts || [])[0] ? `${c.contacts[0].first_name || ''} ${c.contacts[0].last_name || ''}`.trim() : '') || 'Client';
      const cur = byNinja.get(String(c.id)) || byName.get(name.toLowerCase());
      const contacts = (c.contacts || []).filter((x) => !x.is_deleted).map((x) => ({ name: `${x.first_name || ''} ${x.last_name || ''}`.trim(), role: '', email: String(x.email || '').trim(), phone: String(x.phone || '').trim(), primary: !!x.is_primary }));
      const address = [[c.address1, c.address2].filter(Boolean).join(', '), [c.city, c.state, c.postal_code].filter(Boolean).join(', ')].filter(Boolean).join('\n');
      const data = { ...(cur ? cur.data : {}), name, phone: (cur && cur.data.phone) || c.phone || '', website: (cur && cur.data.website) || c.website || '', vatNo: (cur && cur.data.vatNo) || c.vat_number || '', regNo: (cur && cur.data.regNo) || c.id_number || '',
        address: (cur && cur.data.address) || address, contacts: cur && (cur.data.contacts || []).length ? cur.data.contacts : contacts, notes: (cur && cur.data.notes) || [c.public_notes, c.private_notes].filter(Boolean).join('\n'),
        source: { system: 'invoiceninja', id: String(c.id), number: c.number || '' } };
      const saved = await app.save(team, 'client', cur ? cur.id : newId('cli_'), data, '');
      clientId.set(String(c.id), saved.id);
      status.counts.clients++;
    }

    // ---- products and services
    const nProducts = await pages(base, token, 'products', status);
    const services = await existing('service'), sByNinja = fromNinja(services), sByName = new Map(services.map((d) => [String(d.data.name || '').trim().toLowerCase(), d]));
    for (const p of nProducts) {
      const name = String(p.product_key || '').trim();
      if (!name) continue;
      const cur = sByNinja.get(String(p.id)) || sByName.get(name.toLowerCase());
      await app.save(team, 'service', cur ? cur.id : newId('svc_'), { ...(cur ? cur.data : { active: true }), name, description: (cur && cur.data.description) || p.notes || '', rate: cur && cur.data.rate !== undefined && cur.data.rate !== '' ? cur.data.rate : r2(p.price),
        cost: cur && cur.data.cost ? cur.data.cost : r2(p.cost), qty: Number(p.quantity) || 1, source: { system: 'invoiceninja', id: String(p.id) } }, '');
      status.counts.products++;
    }

    // ---- quotes and invoices
    const docs = await existing('invoice'), dByNinja = fromNinja(docs), dByNumber = new Map(docs.map((d) => [d.data.number, d]));
    const vatOf = (x) => Number(x.tax_rate1) || Number(((x.line_items || []).find((l) => Number(l.tax_rate1)) || {}).tax_rate1) || 0;
    for (const kind of ['quote', 'invoice']) {
      const list = await pages(base, token, kind === 'quote' ? 'quotes' : 'invoices', status);
      for (const x of list) {
        const cur = dByNinja.get(String(x.id)), clash = !cur && dByNumber.get(x.number);
        if (clash) { status.counts.skipped++; status.notes.push(`${x.number} is already used here: not imported`); continue; }
        const amountDiscount = !!x.is_amount_discount;
        const lines = (x.line_items || []).map((l) => {
          const qty = Number(l.quantity) || 0, cost = r2(l.cost), gross = qty * cost;
          const pct = amountDiscount ? (gross ? Math.min(100, (Number(l.discount) || 0) / gross * 100) : 0) : Number(l.discount) || 0;
          return app.invoices.cleanLine({ item: l.product_key || '', description: l.notes || '', qty, rate: cost, discount: Math.round(pct * 10000) / 10000,
            date: isoDate(l.custom_value1) || isoDate(l.custom_value2) || isoDate(l.date) });
        });
        const st = (kind === 'quote' ? QUOTE_STATUS : INV_STATUS)[String(x.status_id)] || 'Sent';
        const paid = r2(x.paid_to_date);
        const data = { ...(cur ? cur.data : {}), kind, number: x.number || (cur && cur.data.number) || '', client: clientId.get(String(x.client_id)) || (cur && cur.data.client) || '', clientName: '', clientEmail: '',
          production: (cur && cur.data.production) || '', booking: (cur && cur.data.booking) || '', title: (cur && cur.data.title) || x.po_number || '',
          date: isoDate(x.date) || (cur && cur.data.date) || new Date().toISOString().slice(0, 10), due: isoDate(x.due_date) || isoDate(x.partial_due_date) || isoDate(x.date) || '',
          lines, discount: r2(x.discount), discountType: amountDiscount ? 'amount' : 'percent', vatRate: vatOf(x), notes: x.public_notes || '', terms: x.terms || '', poNumber: x.po_number || '',
          status: st, payments: paid > 0 ? [{ amount: paid, date: isoDate(x.updated_at ? new Date(Number(x.updated_at) * 1000).toISOString() : '') || isoDate(x.date), method: 'Invoice Ninja', ref: '', at: Date.now() }] : [],
          createdBy: 'Invoice Ninja', createdAt: cur ? cur.data.createdAt : (Number(x.created_at) * 1000 || Date.now()),
          source: { system: 'invoiceninja', id: String(x.id), number: x.number, amount: r2(x.amount), balance: r2(x.balance), importedAt: Date.now(), pdf: (cur && cur.data.source && cur.data.source.pdf) || '' } };
        if (!data.client) { data.clientName = 'Unknown client'; }
        else { const c = await app.store.get(data.client); data.clientName = c ? c.data.name : ''; }
        if (!data.due) data.due = data.date;
        const id = cur ? cur.id : newId('inv_');
        // a copy of Invoice Ninja's own PDF, kept with it (only team editors can open it)
        if (pdfs && !data.source.pdf) {
          try {
            const r = await call(base, token, `${kind === 'quote' ? 'quotes' : 'invoices'}/${encodeURIComponent(x.id)}/download`);
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > 100 && buf.slice(0, 4).toString() === '%PDF' && buf.length < 20 * 1024 * 1024) {
              const imgId = newId('img_'), name = `Invoice Ninja ${x.number}`;
              const doc = { id: imgId, team, type: 'image', data: { name, file: fileNameFor(imgId, name, 'application/pdf').replace(/\.bin$/, '.pdf'), mime: 'application/pdf', size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), kind: 'receipt', by: 'Invoice Ninja' } };
              await app.blobs.put(doc, buf);
              await app.save(team, 'image', imgId, doc.data, '');
              data.source.pdf = imgId; status.counts.pdfs++;
            }
          } catch (e) { status.notes.push(`${x.number}: PDF not copied (${e.message})`); }
        }
        await app.save(team, 'invoice', id, data, '');
        await app.invoices.bumpTo(team, kind, data.number);
        status.counts[kind === 'quote' ? 'quotes' : 'invoices']++;
      }
    }
    log(`Invoice Ninja import for ${team}: ${JSON.stringify(status.counts)}`);
  }

  return { start, status, isoDate };
}

module.exports = { makeNinja };
