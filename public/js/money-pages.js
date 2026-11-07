/* Quotes and invoices (lib/invoices.js): the list of everything (what is owed, quotes, crew to pay), the editor
 * (every field, like Invoice Ninja: client, dates, number, lines with item / date / description / unit cost /
 * quantity / discount, a discount on the whole, VAT, notes, terms, payments), billing details (booking fee, numbers,
 * bank, terms and conditions), importing from Invoice Ninja, a production's own quotes and invoices, and on a
 * client's page: their portal (who is on it) and their documents. */
'use strict';
(() => {
  const enc = encodeURIComponent;
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const money = (n) => (r2(n) < 0 ? '-R' : 'R') + Math.abs(r2(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const STATES = { Paid: 'ok', Accepted: 'ok', Converted: 'ok', Overdue: 'bad', Declined: 'bad', Expired: 'bad', Sent: 'warn', Partial: 'warn', Cancelled: '', Draft: '' };
  const pill = (state) => h('span', { class: 'pill ' + (STATES[state] || '') }, state);
  const T = () => 'team=' + App.team;
  const kindName = (k) => (k === 'quote' ? 'Quote' : 'Invoice');
  // the same sums as the website (lib/invoices.js)
  function totals(x) {
    const lineTotals = (x.lines || []).map((l) => r2((Number(l.qty) || 0) * (Number(l.rate) || 0) * (1 - (Number(l.discount) || 0) / 100)));
    const net = r2(lineTotals.reduce((n, v) => n + v, 0));
    const discountAmount = x.discountType === 'amount' ? Math.min(net, r2(x.discount)) : r2((net * (Number(x.discount) || 0)) / 100);
    const subtotal = r2(net - discountAmount), vat = r2((subtotal * (Number(x.vatRate) || 0)) / 100), total = r2(subtotal + vat);
    const paid = r2((x.payments || []).reduce((n, p) => n + (Number(p.amount) || 0), 0));
    return { lineTotals, net, discountAmount, subtotal, vat, total, paid, balance: r2(total - paid) };
  }
  const go = (id) => { location.hash = '#/doc/' + id; };
  async function make(kind, extra = {}) {
    try { const r = await api('POST', `/api/invoices?${T()}`, { kind, ...extra }); toast(`${kindName(kind)} ${r.doc.number} made`); go(r.doc.id); } catch (e) { oops(e); }
  }
  // new quote / invoice: pick the client (and production) first
  function newDoc(kind, preset = {}) {
    const f = { client: preset.client || '', production: preset.production || '' };
    const clients = App.sorted ? App.sorted('client') : App.list('client');
    const prods = App.list('production').filter((p) => !p.deleted).sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || ''))).slice(0, 200);
    UI.modal({ title: `New ${kindName(kind).toLowerCase()}`, body: h('div', { class: 'form' },
      h('label', { class: 'f' }, h('span', {}, 'Client'), h('select', { onchange: (e) => { f.client = e.target.value; } }, h('option', { value: '' }, '— none yet —'), clients.map((c) => h('option', { value: c.id, selected: c.id === f.client || null }, c.data.name)))),
      h('label', { class: 'f' }, h('span', {}, 'Production (adds its costing)'), h('select', { onchange: (e) => { f.production = e.target.value; } }, h('option', { value: '' }, '— none —'), prods.map((p) => h('option', { value: p.id, selected: p.id === f.production || null }, [p.data.number, p.data.date, p.data.name].filter(Boolean).join(' · '))))),
      h('p', { class: 'help wide' }, 'The booking fee is added as the first line (Billing details). Everything can be changed afterwards.')),
    actions: [{ label: 'Cancel' }, { label: 'Make it', primary: true, onClick: () => make(kind, f) }] });
  }

  // ---- billing details: company, bank, terms, booking fee, numbering
  async function billingForm() {
    const b = await api('GET', `/api/billing?${T()}`);
    const f = { ...b };
    const t = (k, l, ph, area, rows) => h('label', { class: 'f' + (area ? ' wide' : '') }, h('span', {}, l), area ? h('textarea', { rows: rows || 3, placeholder: ph || '', oninput: (e) => { f[k] = e.target.value; } }, f[k] || '') : h('input', { value: f[k] ?? '', placeholder: ph || '', oninput: (e) => { f[k] = e.target.value; } }));
    const n = (k, l, help) => h('label', { class: 'f' }, h('span', {}, l), h('input', { type: 'number', step: 'any', value: f[k] ?? '', oninput: (e) => { f[k] = e.target.value === '' ? '' : Number(e.target.value); } }), help ? h('div', { class: 'help' }, help) : null);
    const sec = (title) => h('h4', { class: 'wide fgroup' }, title);
    const body = h('div', { class: 'form' },
      sec('Your company'), t('legalName', 'Name on documents', 'RegemarkFP'), t('regNo', 'Registration number'), t('vatNo', 'VAT number (empty if not registered)'), t('email', 'Email'), t('phone', 'Phone'), t('website', 'Website'), t('address', 'Address', 'Street\nTown, Province 0000\nSouth Africa', true),
      n('vatRate', 'VAT %'), n('terms', 'Invoices due after (days)'), n('quoteDays', 'Quotes valid for (days)'),
      sec('Booking fee (first line of every new quote and invoice)'),
      h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: f.bookingFeeOn !== false, onchange: (e) => { f.bookingFeeOn = e.target.checked; } }), 'Add the booking fee'),
      n('bookingFee', 'Amount (R)'), t('bookingFeeLabel', 'Item', 'Booking fee'), t('bookingFeeText', 'Description: what it is for', '', true, 2),
      sec('Numbers'), t('quotePrefix', 'Quote prefix', 'RFPQ'), t('invoicePrefix', 'Invoice prefix', 'RFPINV'), n('digits', 'Digits', 'RFPINV0557 has 4.'),
      n('nextQuote', 'Next quote number', `Next: ${b.nextQuoteNumber}`), n('nextInvoice', 'Next invoice number', `Next: ${b.nextInvoiceNumber}`),
      sec('On the document'), t('bank', 'Banking details', 'Bank Name: …\nBranch Code: …\nAccount Name: …\nAccount Number: …', true, 5), t('tagline', 'Tagline', 'Capturing life in motion'),
      h('label', { class: 'f' }, h('span', {}, 'Colour of headings and items'), h('input', { type: 'color', value: f.accent || '#1a8cff', oninput: (e) => { f.accent = e.target.value; } })),
      t('docTerms', 'Quote and invoice terms (every document, unless it has its own)', 'Payment is due within 14 days. A 50% deposit confirms the booking.', true, 3),
      t('acknowledge', 'Point out when signing (a second tick box)', 'I have read clauses 4 (cancellations) and 7 (liability), which set cancellation fees and limit liability.', true, 2),
      t('conditions', 'Terms and conditions (printed after the totals)', 'Lines starting with "1. Title" print bold; lines starting with "- " are bullets.', true, 10), t('notes', 'Small print', '', true, 2));
    // saves by itself as you type (Admins); the next numbers only when they were changed
    const status = App.can('admin') ? UI.autosave(body, async () => {
      const out = { ...f };
      if (out.nextQuote === b.nextQuote) delete out.nextQuote;
      if (out.nextInvoice === b.nextInvoice) delete out.nextInvoice;
      await api('PUT', `/api/billing?${T()}`, out);
      if (out.nextQuote !== undefined) b.nextQuote = out.nextQuote;
      if (out.nextInvoice !== undefined) b.nextInvoice = out.nextInvoice;
    }) : h('span', { class: 'dim small' }, 'Only Admins can change these');
    if (!App.can('admin')) body.querySelectorAll('input, textarea, select').forEach((x) => { x.disabled = true; });
    UI.modal({ title: 'Billing details', wide: true, body: h('div', {}, body, h('div', { style: { marginTop: '12px' } }, status)),
      actions: [{ label: 'Close', primary: true, onClick: () => (status.flush ? status.flush().then(() => true) : true) }] });
  }

  // ---- importing from Invoice Ninja
  function ninjaImport(after) {
    const f = { url: 'https://invoicing.co', token: '', pdfs: true };
    const st = h('div', { class: 'dim small' });
    let timer = null;
    const poll = async () => {
      let s; try { s = await api('GET', `/api/invoices/import/invoiceninja?${T()}`); } catch (e) { st.textContent = e.message; return; }
      const c = s.counts || {};
      st.replaceChildren(s.running ? h('b', {}, 'Importing… ' + (s.step || '')) : s.error ? h('span', { class: 'pill bad', style: { whiteSpace: 'normal' } }, s.error) : s.finished ? h('b', {}, 'Done.') : '',
        s.counts ? h('div', {}, `${c.clients || 0} clients · ${c.products || 0} products · ${c.quotes || 0} quotes · ${c.invoices || 0} invoices · ${c.pdfs || 0} PDFs${c.skipped ? ` · ${c.skipped} skipped` : ''}`) : null,
        (s.notes || []).length ? h('ul', {}, s.notes.slice(0, 20).map((n) => h('li', {}, n))) : null);
      if (s.running) timer = setTimeout(poll, 1500); else if (s.finished && after) after();
    };
    UI.modal({ title: 'Import from Invoice Ninja', wide: true, body: h('div', {},
      h('p', { class: 'dim', style: { marginTop: 0 } }, 'Copies your clients, products, quotes and invoices (with what was paid) into RFP Manager, as a backup and to carry on here. Nothing changes in Invoice Ninja. Run it again to bring in anything newer.'),
      h('div', { class: 'form' },
        h('label', { class: 'f wide' }, h('span', {}, 'Invoice Ninja address'), h('input', { value: f.url, oninput: (e) => { f.url = e.target.value; } }), h('div', { class: 'help' }, 'https://invoicing.co for the hosted version, or your own server.')),
        h('label', { class: 'f wide' }, h('span', {}, 'API token'), h('input', { type: 'password', autocomplete: 'off', oninput: (e) => { f.token = e.target.value; } }), h('div', { class: 'help' }, 'Invoice Ninja → Settings → Account Management → Integrations → API Tokens → New token. It is used for this import only and not kept.')),
        h('label', { class: 'row wide', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { f.pdfs = e.target.checked; } }), 'Keep a copy of each Invoice Ninja PDF')),
      st),
    actions: [{ label: 'Close', onClick: () => { clearTimeout(timer); } }, { label: 'Import', primary: true, onClick: async () => { await api('POST', `/api/invoices/import/invoiceninja?${T()}`, f); poll(); return false; } }] });
    poll();
  }

  // ---- the list of everything
  App.pages.money = () => {
    if (!App.can('edit')) return { el: h('div', {}, pageHead('Quotes & invoices'), h('div', { class: 'card empty' }, 'Producers and Admins see this.')) };
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    let tab = App.moneyTab || 'owed', find = '';
    async function paint() {
      let r; try { r = await api('GET', `/api/invoices?${T()}`); } catch (e) { body.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      const tile = (l, v) => h('div', { class: 'tile' }, h('b', {}, v), h('span', {}, l));
      const q = find.toLowerCase();
      let list = tab === 'owed' ? r.docs.filter((x) => x.kind === 'invoice' && ['Sent', 'Partial', 'Overdue'].includes(x.state)) : tab === 'quotes' ? r.docs.filter((x) => x.kind === 'quote') : tab === 'invoices' ? r.docs.filter((x) => x.kind === 'invoice') : r.docs;
      if (q) list = list.filter((x) => [x.number, x.clientName, x.title, x.productionName, x.state].some((v) => String(v || '').toLowerCase().includes(q)));
      body.replaceChildren(
        h('div', { class: 'cards', style: { marginBottom: '14px' } }, tile('Owed to you', money(r.owed)), tile('Overdue', money(r.overdue)), tile('Quotes waiting', money(r.quotesOpen)), tile('Crew still to pay', money(r.crewOwed))),
        h('div', { class: 'tabs' }, [['owed', 'Owed'], ['quotes', 'Quotes'], ['invoices', 'Invoices'], ['all', 'Everything'], ['crew', 'Crew to pay']].map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = App.moneyTab = k; paint(); } }, l))),
        tab === 'crew' ? (r.crew.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, r.crew.map((c) => h('tr', {}, h('td', {}, c.date), h('td', {}, c.name, h('div', { class: 'dim small' }, c.role)), h('td', {}, h('a', { href: '#/edit/production/' + c.production }, c.productionName)), h('td', { class: 'r' }, money(c.amount)))))))
          : h('div', { class: 'card empty' }, 'Every crew member has been paid.'))
          : [h('input', { type: 'search', placeholder: 'Find a number, client, production…', value: find, style: { maxWidth: '360px', marginBottom: '10px' }, oninput: UI.debounce((e) => { find = e.target.value; paint(); }, 250) }),
            list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Number', 'Client', 'For', 'Date', 'Status', 'Total', 'Balance'].map((x, i) => h('th', { class: i >= 5 ? 'r' : '' }, x)))),
              h('tbody', {}, list.map((x) => h('tr', { class: 'click', onclick: () => go(x.id) }, h('td', { class: 'nowrap' }, h('b', {}, x.number), x.source && x.source.system === 'invoiceninja' ? h('span', { class: 'pill', style: { marginLeft: '6px' }, title: 'Imported from Invoice Ninja' }, 'IN') : null),
                h('td', {}, x.clientName || h('span', { class: 'dim' }, '—')), h('td', { class: 'small' }, x.title || x.productionName || ''), h('td', { class: 'nowrap small' }, x.date), h('td', {}, pill(x.state), x.signature ? h('span', { class: 'dim small', title: 'Signed by ' + x.signature.name }, ' ✍') : null),
                h('td', { class: 'r num' }, money(x.total)), h('td', { class: 'r num' }, x.kind === 'invoice' ? money(x.balance) : ''))))))
              : h('div', { class: 'card empty' }, tab === 'owed' ? 'Nothing owed to you right now.' : 'None yet.')]);
    }
    paint();
    return { el: h('div', {}, pageHead('Quotes & invoices', h('button', { onclick: () => newDoc('quote') }, '+ Quote'), h('button', { class: 'primary', onclick: () => newDoc('invoice') }, '+ Invoice'),
      h('button', { onclick: () => billingForm().catch(oops) }, 'Billing details'), App.can('admin') ? h('button', { class: 'ghost', onclick: () => ninjaImport(paint) }, 'Import from Invoice Ninja') : null), body),
      onMessage: UI.debounce((m) => { if (m.type === 'doc' && m.doc.type === 'invoice') paint(); }, 600) };
  };

  // ---- one quote or invoice: everything editable
  App.pages.doc = (id) => {
    const el = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    let x = null, dirty = false;
    const mark = () => { dirty = true; paintTotals(); };
    const totalsBox = h('div', {});
    let lineRows = null;
    function paintTotals() {
      if (!x) return;
      const t = totals(x);
      if (lineRows) lineRows.forEach((td, i) => { td.textContent = money(t.lineTotals[i]); });
      const row = (l, v, b) => h('tr', {}, h('td', { class: 'dim' }, l), h('td', { class: 'r num', style: b ? { fontWeight: 700, fontSize: '17px' } : {} }, v));
      totalsBox.replaceChildren(h('table', { class: 't', style: { maxWidth: '340px', marginLeft: 'auto' } }, h('tbody', {},
        row('Net', money(t.net)), t.discountAmount ? row(x.discountType === 'amount' ? 'Discount' : `Discount ${x.discount}%`, '-' + money(t.discountAmount)) : null, row('Subtotal', money(t.subtotal)),
        Number(x.vatRate) ? row(`VAT ${x.vatRate}%`, money(t.vat)) : null, row('Total', money(t.total), x.kind === 'quote'),
        x.kind === 'invoice' ? [row('Paid to date', money(t.paid)), row('Balance due', money(t.balance), true)] : null)));
    }
    async function load() {
      try { x = (await api('GET', `/api/invoices/${enc(id)}?${T()}`)).doc; dirty = false; paint(); } catch (e) { el.replaceChildren(pageHead('Quote or invoice'), h('div', { class: 'card' }, e.message)); }
    }
    async function save(extra = {}) {
      const body = { number: x.number, client: x.client, clientName: x.clientName, clientEmail: x.clientEmail, production: x.production, title: x.title, date: x.date, due: x.due, poNumber: x.poNumber,
        lines: x.lines, discount: x.discount, discountType: x.discountType, vatRate: x.vatRate, notes: x.notes, terms: x.terms, ...extra };
      x = (await api('PUT', `/api/invoices/${enc(id)}?${T()}`, body)).doc; dirty = false; paint();
      return x;
    }
    const saveBtn = () => h('button', { class: 'primary', onclick: async () => { try { await save(); toast('Saved'); } catch (e) { oops(e); } } }, 'Save');
    function paint() {
      const quote = x.kind === 'quote';
      const clients = App.list('client').filter((c) => !c.deleted).sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
      const prods = App.list('production').filter((p) => !p.deleted).sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || ''))).slice(0, 300);
      const services = App.list('service').filter((s) => !s.deleted && s.data.active !== false).sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
      const client = x.client ? App.docs.get(x.client) : null;
      const inp = (k, attrs = {}) => h('input', { value: x[k] ?? '', ...attrs, oninput: (e) => { x[k] = attrs.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value; mark(); } });
      const f = (l, input, wide) => h('label', { class: 'f' + (wide ? ' wide' : '') }, h('span', {}, l), input);
      // the lines
      const tb = h('tbody', {});
      const svcList = h('datalist', { id: 'svc-list' }, services.map((s) => h('option', { value: s.data.name })));
      const paintLines = () => {
        lineRows = [];
        tb.replaceChildren(...x.lines.map((l, i) => {
          const total = h('td', { class: 'r num nowrap' });
          lineRows.push(total);
          const pickService = (name) => {
            const s = services.find((y) => y.data.name === name);
            if (!s) return;
            const own = client && (client.data.rates || []).find((r) => r.service === s.id);
            l.service = s.id; l.description = l.description || s.data.description || ''; l.rate = own && own.rate !== '' && own.rate !== undefined ? Number(own.rate) : Number(s.data.rate) || 0; if (!l.qty) l.qty = Number(s.data.qty) || 1;
            paintLines(); mark();
          };
          const num = (k, w, step) => h('td', { style: { width: w } }, h('input', { type: 'number', step: step || 'any', value: l[k] ?? '', oninput: (e) => { l[k] = e.target.value === '' ? 0 : Number(e.target.value); mark(); } }));
          return h('tr', {},
            h('td', { style: { minWidth: '150px' } }, h('input', { value: l.item || '', list: 'svc-list', placeholder: 'Item', oninput: (e) => { l.item = e.target.value; dirty = true; }, onchange: (e) => pickService(e.target.value) }), l.fee ? h('div', { class: 'dim small' }, 'Booking fee') : null),
            h('td', { style: { width: '150px' } }, h('input', { type: 'date', value: l.date || '', oninput: (e) => { l.date = e.target.value; dirty = true; } })),
            h('td', { style: { minWidth: '180px' } }, h('textarea', { rows: 2, style: { minHeight: '40px' }, oninput: (e) => { l.description = e.target.value; dirty = true; } }, l.description || '')),
            num('rate', '110px', '0.01'), num('qty', '80px'), num('discount', '80px'), total,
            h('td', { class: 'nowrap', style: { width: '96px' } },
              h('button', { class: 'ghost sm', title: 'Up', disabled: i === 0 || null, onclick: () => { [x.lines[i - 1], x.lines[i]] = [x.lines[i], x.lines[i - 1]]; paintLines(); mark(); } }, '↑'),
              h('button', { class: 'ghost sm', title: 'Down', disabled: i === x.lines.length - 1 || null, onclick: () => { [x.lines[i + 1], x.lines[i]] = [x.lines[i], x.lines[i + 1]]; paintLines(); mark(); } }, '↓'),
              h('button', { class: 'ghost sm danger', title: 'Remove', onclick: () => { x.lines.splice(i, 1); paintLines(); mark(); } }, '✕')));
        }));
        paintTotals();
      };
      paintLines();
      const addLine = (l) => { x.lines.push({ item: '', date: '', description: '', rate: 0, qty: 1, discount: 0, ...l }); paintLines(); mark(); const ins = tb.querySelectorAll('tr:last-child input'); if (ins[0]) ins[0].focus(); };
      const fromProducts = () => {
        let close;
        const grid = h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, services.map((s) => h('tr', { class: 'click', onclick: () => {
          const own = client && (client.data.rates || []).find((r) => r.service === s.id);
          addLine({ item: s.data.name, description: s.data.description || '', rate: own && own.rate !== '' && own.rate !== undefined ? Number(own.rate) : Number(s.data.rate) || 0, qty: Number(s.data.qty) || 1, service: s.id, date: (App.docs.get(x.production) || { data: {} }).data.date || '' }); close();
        } }, h('td', {}, h('b', {}, s.data.name), h('div', { class: 'dim small' }, s.data.description || '')), h('td', { class: 'dim small' }, s.data.category || ''), h('td', { class: 'r num' }, money(s.data.rate) + (s.data.unit ? ' / ' + s.data.unit : '')))))));
        close = UI.modal({ title: 'Add from products & services', wide: true, body: services.length ? grid : h('div', { class: 'empty' }, 'No products or services yet: add them under Productions → Products & services.'), actions: [{ label: 'Close' }] });
      };
      // payments (invoices)
      const pay = { amount: '', date: new Date().toISOString().slice(0, 10), method: 'EFT', ref: '' };
      const payments = quote ? null : h('div', { class: 'card' }, h('h2', {}, 'Payments'),
        (x.payments || []).length ? h('table', { class: 't' }, h('tbody', {}, x.payments.map((p, i) => h('tr', {}, h('td', {}, p.date), h('td', {}, p.method || ''), h('td', { class: 'dim small' }, p.ref || ''), h('td', { class: 'r num' }, money(p.amount)),
          h('td', { class: 'r' }, h('button', { class: 'sm ghost danger', onclick: async () => { if (!(await confirmBox(`Remove the payment of ${money(p.amount)}?`, 'Remove'))) return; try { x = (await api('DELETE', `/api/invoices/${enc(id)}/payments/${i}?${T()}`)).doc; paint(); } catch (e) { oops(e); } } }, '✕')))))) : h('p', { class: 'dim' }, 'Nothing paid yet.'),
        h('div', { class: 'row', style: { marginTop: '10px', flexWrap: 'wrap' } },
          h('input', { type: 'number', step: '0.01', placeholder: `Amount (${money(totals(x).balance)} owed)`, style: { width: '200px' }, oninput: (e) => { pay.amount = e.target.value; } }),
          h('input', { type: 'date', value: pay.date, style: { width: '160px' }, oninput: (e) => { pay.date = e.target.value; } }),
          h('select', { style: { width: '140px' }, onchange: (e) => { pay.method = e.target.value; } }, ['EFT', 'Cash', 'Card', 'PayFast', 'Other'].map((m) => h('option', {}, m))),
          h('input', { placeholder: 'Reference', style: { width: '160px' }, oninput: (e) => { pay.ref = e.target.value; } }),
          h('button', { class: 'primary', onclick: async () => { try { if (dirty) await save(); x = (await api('POST', `/api/invoices/${enc(id)}/payments?${T()}`, { ...pay, amount: Number(pay.amount) || totals(x).balance })).doc; toast('Payment recorded'); paint(); } catch (e) { oops(e); } } }, 'Record payment')));
      const s = x.signature;
      el.replaceChildren(
        pageHead(h('span', {}, `${kindName(x.kind)} ${x.number} `, pill(x.state)),
          h('a', { class: 'btn', href: '#/money' }, '‹ All'), saveBtn(),
          h('button', { onclick: async () => { try { if (dirty) await save(); App.openDoc(`/api/invoices/${enc(id)}/pdf?${T()}`); } catch (e) { oops(e); } } }, 'PDF'),
          App.cfg.mail ? h('button', { class: 'primary', onclick: async () => {
            if (dirty) { try { await save(); } catch (e) { return oops(e); } }
            const m = { to: x.clientEmail || (client && (client.data.email || ((client.data.contacts || []).find((c) => c.primary && c.email) || (client.data.contacts || []).find((c) => c.email) || {}).email)) || '', note: '' };
            UI.modal({ title: `Email ${x.number}`, body: h('div', { class: 'form' }, h('label', { class: 'f wide' }, h('span', {}, 'To'), h('input', { type: 'email', value: m.to, oninput: (e) => { m.to = e.target.value; } })),
              h('label', { class: 'f wide' }, h('span', {}, 'Message (optional)'), h('textarea', { rows: 3, oninput: (e) => { m.note = e.target.value; } })),
              h('p', { class: 'help wide' }, quote ? 'They get the PDF and a link to their client portal, where they sign the quote. The production is confirmed when they sign.' : 'They get the PDF and a link to their portal to pay (PayFast, when it is set up).')),
            actions: [{ label: 'Cancel' }, { label: 'Send', primary: true, onClick: async () => { const r = await api('POST', `/api/invoices/${enc(id)}/send?${T()}`, m); toast('Sent to ' + r.to); load(); } }] });
          } }, x.status === 'Draft' ? 'Email' : 'Email again') : null,
          quote && !x.convertedTo ? h('button', { onclick: async () => { try { if (dirty) await save(); const r = await api('POST', `/api/invoices/${enc(id)}/convert?${T()}`); toast(`Invoice ${r.doc.number} made`); go(r.doc.id); } catch (e) { oops(e); } } }, 'Convert to invoice') : null,
          x.convertedTo ? h('a', { class: 'btn', href: '#/doc/' + x.convertedTo }, 'Its invoice ›') : null, x.quote ? h('a', { class: 'btn', href: '#/doc/' + x.quote }, '‹ The quote') : null,
          h('button', { class: 'ghost', onclick: async () => { try { const r = await api('POST', `/api/invoices/${enc(id)}/duplicate?${T()}`, {}); toast(`${r.doc.number} made`); go(r.doc.id); } catch (e) { oops(e); } } }, 'Copy'),
          h('button', { class: 'ghost danger', onclick: async () => { if (!(await confirmBox(`Delete ${x.number}? This cannot be undone.`))) return; try { await api('DELETE', `/api/invoices/${enc(id)}?${T()}`); location.hash = '#/money'; } catch (e) { oops(e); } } }, 'Delete')),
        x.source && x.source.system === 'invoiceninja' ? h('p', { class: 'pill', style: { whiteSpace: 'normal', marginBottom: '12px' } }, `Imported from Invoice Ninja${Math.abs((x.source.amount || 0) - totals(x).total) > 0.05 ? ` (its total there: ${money(x.source.amount)})` : ''}. `, x.source.pdf ? h('a', { href: '/media/' + x.source.pdf, target: '_blank', rel: 'noopener' }, 'Their PDF ↗') : null) : null,
        s ? h('div', { class: 'card', style: { borderLeft: '4px solid var(--accent)' } }, h('div', { class: 'row' }, s.image ? h('img', { src: s.image, alt: 'Signature', style: { height: '56px', background: '#fff', borderRadius: '4px', padding: '4px' } }) : null,
          h('div', { class: 'grow' }, h('b', {}, `Contract signed by ${s.name}`), h('div', { class: 'dim small' }, `${new Date(s.at).toLocaleString('en-GB')}${s.email ? ' · ' + s.email : ''}${s.ip ? ' · ' + s.ip : ''}${s.method === 'upload' ? ' · picture loaded' : ''}`)),
            x.contract ? h('button', { onclick: () => App.openDoc(`/api/invoices/${enc(id)}/contract.pdf?${T()}`) }, 'Contract (PDF)') : null)) : quote && x.status !== 'Draft' ? h('p', { class: 'pill warn', style: { whiteSpace: 'normal' } }, 'Waiting for the client to sign it in their portal.') : null,
        h('div', { class: 'card' }, h('div', { class: 'form' },
          f('Client', h('select', { onchange: (e) => { x.client = e.target.value; const c = App.docs.get(x.client); if (c) x.clientName = c.data.name; paint(); mark(); } }, h('option', { value: '' }, '— not in Clients —'), clients.map((c) => h('option', { value: c.id, selected: c.id === x.client || null }, c.data.name)))),
          !x.client ? f('Client name', inp('clientName')) : h('div', { class: 'f' }, h('span', { class: 'flabel' }, 'Client'), h('a', { href: '#/edit/client/' + x.client }, (client && client.data.name) || x.clientName), client && Number(client.data.discount) ? h('div', { class: 'help' }, `Their discount: ${client.data.discount}%`) : null),
          f('Send to (email)', inp('clientEmail', { type: 'email', placeholder: 'the client\'s email' })),
          f('Production', h('select', { onchange: (e) => { x.production = e.target.value; mark(); } }, h('option', { value: '' }, '— none —'), prods.map((p) => h('option', { value: p.id, selected: p.id === x.production || null }, [p.data.number, p.data.date, p.data.name].filter(Boolean).join(' · '))))),
          f('Title (what it is for)', inp('title')), f('Number', inp('number')), f(quote ? 'Quote date' : 'Invoice date', inp('date', { type: 'date' })), f(quote ? 'Valid until' : 'Due date', inp('due', { type: 'date' })), f('PO number', inp('poNumber')),
          f('Status', h('select', { onchange: async (e) => { try { if (dirty) await save(); x = (await api('PUT', `/api/invoices/${enc(id)}?${T()}`, { status: e.target.value })).doc; paint(); } catch (err) { oops(err); paint(); } } }, (quote ? ['Draft', 'Sent', 'Accepted', 'Declined', 'Converted'] : ['Draft', 'Sent', 'Partial', 'Paid', 'Cancelled']).map((st) => h('option', { selected: st === x.status || null }, st)))))),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Lines'), h('div', { class: 'row' }, h('button', { class: 'sm', onclick: fromProducts }, '+ From products & services'), h('button', { class: 'sm', onclick: () => addLine({}) }, '+ Line'))),
          svcList,
          h('div', { style: { overflowX: 'auto', marginTop: '10px' } }, h('table', { class: 't sub' }, h('thead', {}, h('tr', {}, ['Item', 'Production / rental date', 'Description', 'Unit cost', 'Qty', 'Disc. %', 'Line total', ''].map((c, i) => h('th', { class: i === 6 ? 'r' : '' }, c)))), tb)),
          h('div', { class: 'form', style: { marginTop: '14px' } },
            f('Discount on the whole', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('input', { type: 'number', step: 'any', value: x.discount || 0, oninput: (e) => { x.discount = Number(e.target.value) || 0; mark(); } }),
              h('select', { style: { width: '90px' }, onchange: (e) => { x.discountType = e.target.value; mark(); } }, h('option', { value: 'percent', selected: x.discountType !== 'amount' || null }, '%'), h('option', { value: 'amount', selected: x.discountType === 'amount' || null }, 'R')))),
            f('VAT %', h('input', { type: 'number', step: 'any', value: x.vatRate || 0, oninput: (e) => { x.vatRate = Number(e.target.value) || 0; mark(); } }))),
          totalsBox),
        h('div', { class: 'card' }, h('div', { class: 'form' }, f(quote ? 'Quote terms (above the banking details)' : 'Invoice terms (above the banking details)', h('textarea', { rows: 3, placeholder: 'Empty: your quote and invoice terms from Billing details', oninput: (e) => { x.terms = e.target.value; dirty = true; } }, x.terms || ''), true),
          f('Note to the client', h('textarea', { rows: 2, oninput: (e) => { x.notes = e.target.value; dirty = true; } }, x.notes || ''), true)),
          h('div', { class: 'row', style: { marginTop: '10px' } }, saveBtn())),
        payments);
      paintTotals();
    }
    load();
    window.addEventListener('beforeunload', (e) => { if (dirty && location.hash === '#/doc/' + id) { e.preventDefault(); e.returnValue = ''; } });
    return { el, destroy: () => { if (dirty) toast('Unsaved changes on the quote or invoice were left', 'error'); } };
  };

  // ---- a production's own quotes and invoices
  App.pages.invoices = (prodId) => {
    const prod = App.docs.get(prodId);
    if (!prod) return App.pages.notfound();
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    api('GET', `/api/productions/${enc(prodId)}/invoices?${T()}`).then((r) => {
      const make2 = async (kind) => { try { const x = await api('POST', `/api/productions/${enc(prodId)}/invoices?${T()}`, { kind }); toast(`${kindName(kind)} ${x.doc.number} made`); go(x.doc.id); } catch (e) { oops(e); } };
      body.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'spread' }, h('div', {}, h('b', {}, [prod.data.number, prod.data.name].filter(Boolean).join(' · ')),
        h('div', { class: 'dim small' }, r.lines.length ? `From the costing: ${r.lines.length} line${r.lines.length === 1 ? '' : 's'}, ${money(r.lines.reduce((n, l) => n + l.qty * l.amount, 0))} before VAT, after the booking fee.` : 'Only the booking fee so far: give crew roles and equipment invoice rates, or add other costs, to bring in the costing.')),
        h('div', { class: 'row' }, h('button', { onclick: () => make2('quote') }, '+ Quote'), h('button', { class: 'primary', onclick: () => make2('invoice') }, '+ Invoice')))),
        r.list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, r.list.map((x) => h('tr', { class: 'click', onclick: () => go(x.id) }, h('td', {}, h('b', {}, x.number)), h('td', {}, kindName(x.kind)), h('td', {}, x.date), h('td', {}, pill(x.state)), h('td', { class: 'r num' }, money(x.total)))))))
          : h('div', { class: 'card empty' }, 'No quotes or invoices for this production yet.'));
    }).catch((e) => body.replaceChildren(h('div', { class: 'card' }, e.message)));
    return { el: h('div', {}, pageHead('Quotes & invoices', h('a', { class: 'btn', href: '#/edit/production/' + prodId }, 'Production'), h('a', { class: 'btn', href: '#/money' }, 'All')), body) };
  };

  // ---- on a client's page: their portal and their documents
  App.panels = App.panels || {};
  App.panels.client = (doc) => {
    const box = h('div', { class: 'card' }, h('div', { class: 'dim' }, 'Loading…'));
    const f = { email: '', name: '' };
    async function paint() {
      let users = [], docs = [];
      try { users = (await api('GET', `/api/clients/${enc(doc.id)}/portal?${T()}`)).users; docs = (await api('GET', `/api/invoices/list?${T()}&client=${enc(doc.id)}`)).list; } catch (e) { box.replaceChildren(h('div', {}, e.message)); return; }
      const owed = docs.filter((x) => x.kind === 'invoice' && !['Draft', 'Cancelled'].includes(x.status)).reduce((n, x) => n + x.balance, 0);
      box.replaceChildren(
        h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Quotes & invoices'), h('div', { class: 'row' }, h('span', { class: 'dim' }, `Owed: ${money(owed)}`), h('button', { class: 'sm', onclick: () => newDoc('quote', { client: doc.id }) }, '+ Quote'), h('button', { class: 'sm primary', onclick: () => newDoc('invoice', { client: doc.id }) }, '+ Invoice'))),
        docs.length ? h('div', { class: 'tablewrap', style: { marginTop: '10px' } }, h('table', { class: 't' }, h('tbody', {}, docs.map((x) => h('tr', { class: 'click', onclick: () => go(x.id) }, h('td', {}, h('b', {}, x.number)), h('td', { class: 'small' }, x.title || ''), h('td', { class: 'small' }, x.date), h('td', {}, pill(x.state)), h('td', { class: 'r num' }, money(x.total)), h('td', { class: 'r num' }, x.kind === 'invoice' ? money(x.balance) : '')))))) : h('p', { class: 'dim' }, 'None yet.'),
        h('h2', { style: { marginTop: '18px' } }, 'Client portal'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, 'Their quotes to sign, invoices to pay, productions, bookings and reviews, and their adverts (ad spaces under Advertising). Everyone on it has their own link; they can add colleagues themselves. Sending a quote or invoice adds the person it goes to.'),
        users.length ? h('table', { class: 't' }, h('tbody', {}, users.map((u) => h('tr', {}, h('td', {}, h('b', {}, u.email), u.name ? h('div', { class: 'dim small' }, u.name) : null),
          h('td', { class: 'r nowrap' }, h('button', { class: 'sm', onclick: async () => { await navigator.clipboard.writeText(u.url).catch(() => {}); toast('Portal link copied'); } }, 'Copy link'), ' ', h('a', { class: 'btn sm', href: u.url, target: '_blank', rel: 'noopener' }, 'Open ↗'), ' ',
            h('button', { class: 'sm ghost danger', onclick: async () => { if (!(await confirmBox(`Take ${u.email} off the portal? Their link stops working.`, 'Remove'))) return; try { await api('DELETE', `/api/clients/${enc(doc.id)}/portal/${enc(u.email)}?${T()}`); paint(); } catch (e) { oops(e); } } }, 'Remove'))))))
          : h('p', { class: 'dim' }, 'Nobody on it yet.'),
        h('div', { class: 'row', style: { marginTop: '10px', flexWrap: 'wrap' } }, h('input', { type: 'email', placeholder: 'Email', style: { width: '240px' }, oninput: (e) => { f.email = e.target.value; } }), h('input', { placeholder: 'Name', style: { width: '180px' }, oninput: (e) => { f.name = e.target.value; } }),
          h('button', { class: 'primary', onclick: async () => { try { await api('POST', `/api/clients/${enc(doc.id)}/portal?${T()}`, f); toast('Invited: they got an email with their link'); paint(); } catch (e) { oops(e); } } }, 'Invite to the portal')));
    }
    paint();
    return box;
  };
  // ---- on a release form's page: its link (copy, WhatsApp, email) and everyone who signed
  App.panels.releaseForm = (doc) => {
    const box = h('div', { class: 'card' }, h('div', { class: 'dim' }, 'Loading…'));
    if (!doc || !doc.id || !doc.data || !doc.data.key) return h('div', { class: 'card dim' }, 'Save the release form to get its link.');
    const yes = (b) => h('span', { class: 'pill' + (b ? ' ok' : '') }, b ? 'Yes' : 'No');
    async function paint() {
      let r;
      try { r = await api('GET', `/api/releases/form/${enc(doc.id)}?${T()}`); } catch (e) { box.replaceChildren(h('div', { class: 'dim' }, e.message)); return; }
      const m = { to: '', note: '' };
      const live = r.releases.filter((x) => !x.withdrawn);
      box.replaceChildren(
        h('h2', { style: { marginTop: 0 } }, 'Send the form'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, r.open ? 'People open the link on their phone, fill it in and sign with a finger (or load a picture of their signature). Parents and guardians sign for children.' : 'This form is closed: tick "Open for signing" to use the link.'),
        h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('input', { value: r.link, readonly: true, style: { width: '360px', maxWidth: '100%' }, onclick: (e) => e.target.select() }),
          h('button', { class: 'primary', onclick: async () => { await navigator.clipboard.writeText(r.link).catch(() => {}); toast('Link copied'); } }, 'Copy link'),
          h('a', { class: 'btn', href: 'https://wa.me/?text=' + enc(`Please sign the filming release for ${doc.data.name}: ${r.link}`), target: '_blank', rel: 'noopener' }, 'Share on WhatsApp'),
          h('a', { class: 'btn', href: r.link, target: '_blank', rel: 'noopener' }, 'Open the form')),
        App.cfg.mail ? h('div', { class: 'form', style: { marginTop: '12px' } },
          h('label', { class: 'f wide' }, h('span', {}, 'Email it to (one or more, separated by commas)'), h('textarea', { rows: 2, placeholder: 'parent@example.com, player@example.com', oninput: (e) => { m.to = e.target.value; } })),
          h('label', { class: 'f wide' }, h('span', {}, 'Message (optional)'), h('input', { oninput: (e) => { m.note = e.target.value; } })),
          h('div', { class: 'wide' }, h('button', { onclick: async () => { try { const x = await api('POST', `/api/releases/form/${enc(doc.id)}/send?${T()}`, m); toast(`Sent to ${x.sent}`); } catch (e) { oops(e); } } }, 'Email the form'))) : null,
        h('h2', { style: { marginTop: '18px' } }, `Signed (${live.length})`, r.releases.length > live.length ? h('span', { class: 'dim small' }, ` · ${r.releases.length - live.length} withdrawn`) : null),
        r.releases.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Person'), h('th', {}, 'Raw footage'), h('th', {}, 'Promotion'), h('th', {}, 'Signed'), h('th', {}))),
          h('tbody', {}, r.releases.map((x) => h('tr', { style: x.withdrawn ? { opacity: 0.55 } : null },
            h('td', {}, h('b', {}, x.minor ? x.minorName : x.name), x.minor ? h('div', { class: 'dim small' }, `child · signed by ${x.name} (${String(x.relation || '').toLowerCase()})`) : null, h('div', { class: 'dim small' }, [x.email, x.phone].filter(Boolean).join(' · ')), x.withdrawn ? h('div', { class: 'pill warn' }, 'Withdrawn ' + new Date(x.withdrawn.at).toLocaleDateString('en-GB')) : null),
            h('td', {}, yes(x.consents.raw)), h('td', {}, yes(x.consents.promo)), h('td', { class: 'small nowrap' }, new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
            h('td', { class: 'r nowrap' }, h('button', { class: 'sm', onclick: () => App.openDoc(`/api/releases/${enc(x.id)}/pdf?${T()}`) }, 'PDF'), ' ',
              h('button', { class: 'sm ghost', onclick: async () => { if (!x.withdrawn && !(await confirmBox(`Mark the release of ${x.minor ? x.minorName : x.name} as withdrawn? Their footage may then only be used where it was already published.`, 'Withdraw'))) return; try { await api('POST', `/api/releases/${enc(x.id)}/withdraw?${T()}`, { withdrawn: !x.withdrawn }); paint(); } catch (e) { oops(e); } } }, x.withdrawn ? 'Undo withdraw' : 'Withdrawn'),
              App.can('admin') ? [' ', h('button', { class: 'sm ghost danger', onclick: async () => { if (!(await confirmBox('Delete this signed release for good?'))) return; try { await api('DELETE', `/api/releases/${enc(x.id)}?${T()}`); paint(); } catch (e) { oops(e); } } }, 'Delete')] : null)))))) : h('p', { class: 'dim' }, 'Nobody has signed yet.'));
    }
    paint();
    return box;
  };
  App.money = { newDoc, billingForm, ninjaImport, totals };
})();
