/* Running the company: quotes and invoices (per production and an overview of what is owed), billing details, kit
 * check-out and check-in, crew clashes and days off, the client page link, and sponsors' proof-of-play reports. */
'use strict';
(() => {
  const enc = encodeURIComponent;
  const money = (n) => 'R ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pill = (state) => h('span', { class: 'pill ' + ({ Paid: 'ok', Accepted: 'ok', Overdue: 'bad', Declined: 'bad', Sent: 'warn', Cancelled: '' })[state] }, state);
  const base = (id) => `/api/productions/${enc(id)}`;
  const today = () => new Date().toISOString().slice(0, 10);

  // ---- on the production page: clashes, the client page, quotes & invoices, kit
  const prev = App.panels.production;
  App.panels.production = (doc, form) => {
    const inner = prev(doc, form);
    if (!App.docs.has(doc.id) || !App.can('edit') || App.cfg.bridge) return inner;
    const card = h('div', { class: 'card' });
    async function paint() {
      const p = (App.docs.get(doc.id) || doc).data;
      let cl = []; try { cl = (await api('GET', `${base(doc.id)}/clashes?team=${App.team}`)).list; } catch { cl = []; }
      card.replaceChildren(h('div', { class: 'spread' }, h('h2', {}, 'Business'), h('div', { class: 'row' },
        h('a', { class: 'btn sm', href: '#/invoices/' + doc.id }, `Quotes & invoices (${(p.invoices || []).length})`),
        h('a', { class: 'btn sm', href: '#/kit/' + doc.id }, 'Kit out / in'),
        App.cfg.mode === 'cloud' ? h('button', { class: 'sm', onclick: async () => { try { const r = await api('POST', `${base(doc.id)}/client-link?team=${App.team}`); await navigator.clipboard.writeText(r.url).catch(() => {}); UI.modal({ title: 'Client page', body: h('div', {}, h('p', {}, 'A private page for your client: this production, its call sheet, stream, recordings, report and the quotes and invoices you have sent. Nothing else of your team.'), h('input', { readonly: true, value: r.url, onfocus: (e) => e.target.select() }), h('p', { class: 'dim small' }, 'Copied. Anyone with the link can open it.')), actions: [{ label: 'Stop sharing', danger: true, onClick: async () => { await api('DELETE', `${base(doc.id)}/client-link?team=${App.team}`); toast('The old link no longer works'); } }, { label: 'Done', primary: true }] }); } catch (e) { oops(e); } } }, p.clientKey ? 'Client page ✓' : 'Client page') : null)),
        cl.length ? h('div', { style: { marginTop: '10px' } }, cl.map((c) => h('p', { class: 'pill ' + (c.kind === 'declined' ? 'bad' : 'warn'), style: { whiteSpace: 'normal', margin: '4px 0', display: 'block' } }, '⚠ ' + c.text))) : h('p', { class: 'dim small', style: { margin: '8px 0 0' } }, 'No crew clashes.'));
    }
    paint();
    const box = h('div', {}, card, inner);
    box.repaint = () => { if (inner && inner.repaint) inner.repaint(); paint(); };
    return box;
  };

  // ---- quotes and invoices of one production
  App.pages.invoices = (id) => {
    const doc = App.docs.get(id);
    if (!doc) return App.pages.notfound();
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    async function paint() {
      let r; try { r = await api('GET', `${base(id)}/invoices?team=${App.team}`); } catch (e) { body.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      const p = App.docs.get(id).data;
      body.replaceChildren(
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('div', {}, h('b', {}, [p.number, p.name].filter(Boolean).join(' · ')), h('div', { class: 'dim small' }, [p.client, p.clientEmail].filter(Boolean).join(' · ') || 'Add the client and their email on the production.')),
          h('div', { class: 'row' }, h('button', { onclick: () => make('quote') }, '+ Quote'), h('button', { class: 'primary', onclick: () => make('invoice') }, '+ Invoice'))),
          r.lines.length ? h('p', { class: 'dim small', style: { margin: '8px 0 0' } }, `From the costing: ${r.lines.length} line${r.lines.length === 1 ? '' : 's'}, ${money(r.lines.reduce((n, l) => n + l.qty * l.amount, 0))} before VAT. You can change the lines on each one.`)
            : h('p', { class: 'dim small', style: { margin: '8px 0 0' } }, 'Nothing to invoice yet: give the crew roles and equipment invoice rates, or add other costs, on the production.')),
        r.list.length ? r.list.slice().reverse().map((x) => docCard(x, r.billing)) : h('div', { class: 'card empty' }, 'No quotes or invoices yet.'),
        !r.billing.bank ? h('p', { class: 'pill warn', style: { whiteSpace: 'normal' } }, 'Add your bank details and VAT number under Quotes & invoices → Billing details, so they print on your invoices.') : null);
    }
    async function make(kind) { try { await api('POST', `${base(id)}/invoices?team=${App.team}`, { kind }); toast(kind === 'quote' ? 'Quote made' : 'Invoice made'); paint(); } catch (e) { oops(e); } }
    function docCard(x, billing) {
      const lines = x.lines.map((l) => ({ ...l }));
      const save = async (b) => { try { await api('PUT', `${base(id)}/invoices/${enc(x.number)}?team=${App.team}`, b); paint(); } catch (e) { oops(e); } };
      const edit = () => {
        const tb = h('tbody', {});
        const row = (l) => h('tr', {}, h('td', {}, h('input', { value: l.label, oninput: (e) => { l.label = e.target.value; } })), h('td', { style: { width: '80px' } }, h('input', { type: 'number', value: l.qty, oninput: (e) => { l.qty = Number(e.target.value) || 0; } })),
          h('td', { style: { width: '140px' } }, h('input', { type: 'number', step: '0.01', value: l.amount, oninput: (e) => { l.amount = Number(e.target.value) || 0; } })), h('td', {}, h('button', { class: 'sm ghost danger', onclick: () => { lines.splice(lines.indexOf(l), 1); tb.replaceChildren(...lines.map(row)); } }, '✕')));
        tb.replaceChildren(...lines.map(row));
        const f = { due: x.due, vatRate: x.vatRate, notes: x.notes || '' };
        UI.modal({ title: `Edit ${x.number}`, wide: true, body: h('div', {}, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Description', 'Qty', 'Unit price', ''].map((t) => h('th', {}, t)))), tb),
          h('button', { class: 'sm', onclick: () => { const l = { label: '', qty: 1, amount: 0 }; lines.push(l); tb.append(row(l)); } }, '+ Line'),
          h('div', { class: 'form', style: { marginTop: '12px' } }, h('label', { class: 'f' }, h('span', {}, x.kind === 'quote' ? 'Valid until' : 'Due'), h('input', { type: 'date', value: f.due, onchange: (e) => { f.due = e.target.value; } })),
            h('label', { class: 'f' }, h('span', {}, 'VAT %'), h('input', { type: 'number', value: f.vatRate, onchange: (e) => { f.vatRate = Number(e.target.value) || 0; } })),
            h('label', { class: 'f wide' }, h('span', {}, 'Note on the document'), h('textarea', { rows: 2, oninput: (e) => { f.notes = e.target.value; } }, f.notes)))),
          actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => save({ lines, ...f }) }] });
      };
      const sendIt = () => {
        const f = { to: App.docs.get(id).data.clientEmail || '', note: '' };
        UI.modal({ title: `Email ${x.number}`, body: h('div', { class: 'form' }, h('label', { class: 'f wide' }, h('span', {}, 'To'), h('input', { type: 'email', value: f.to, oninput: (e) => { f.to = e.target.value; } })), h('label', { class: 'f wide' }, h('span', {}, 'A line from you (optional)'), h('textarea', { rows: 2, oninput: (e) => { f.note = e.target.value; } }))),
          actions: [{ label: 'Cancel' }, { label: 'Send with the PDF', primary: true, onClick: async () => { const r = await api('POST', `${base(id)}/invoices/${enc(x.number)}/send?team=${App.team}`, f); toast('Sent to ' + r.to); paint(); } }] });
      };
      const next = x.kind === 'quote' ? ['Accepted', 'Declined'] : ['Paid', 'Cancelled'];
      return h('div', { class: 'card' }, h('div', { class: 'spread' }, h('div', {}, h('b', {}, `${x.kind === 'quote' ? 'Quote' : 'Invoice'} ${x.number}`), ' ', pill(x.state), h('div', { class: 'dim small' }, `${x.date} · ${x.kind === 'quote' ? 'valid until' : 'due'} ${x.due}${x.paidAt ? ' · paid ' + new Date(x.paidAt).toISOString().slice(0, 10) : ''}`)),
        h('div', { style: { fontSize: '20px', fontWeight: 700 } }, money(x.total))),
        h('div', { class: 'tablewrap', style: { marginTop: '8px' } }, h('table', { class: 't' }, h('tbody', {}, x.lines.map((l) => h('tr', {}, h('td', {}, l.label), h('td', { class: 'right' }, String(l.qty)), h('td', { class: 'right' }, money(l.amount)), h('td', { class: 'right' }, money(l.qty * l.amount)))),
          h('tr', {}, h('td', { colspan: 3, class: 'right dim' }, `Subtotal${x.vatRate ? ` + VAT ${x.vatRate}%` : ''}`), h('td', { class: 'right' }, money(x.subtotal) + (x.vatRate ? ' + ' + money(x.vat) : '')))))),
        h('div', { class: 'row', style: { marginTop: '10px', flexWrap: 'wrap' } }, h('a', { class: 'btn sm', href: `${base(id)}/invoices/${enc(x.number)}.pdf?team=${App.team}`, target: '_blank', rel: 'noopener' }, 'PDF'),
          h('button', { class: 'sm', onclick: edit }, 'Edit'), App.cfg.mail ? h('button', { class: 'sm primary', onclick: sendIt }, x.status === 'Draft' ? 'Email to client' : 'Email again') : null,
          x.status === 'Draft' ? h('button', { class: 'sm', onclick: () => save({ status: 'Sent' }) }, 'Mark as sent') : null,
          next.filter((s) => s !== x.status).map((s) => h('button', { class: 'sm' + (s === 'Paid' || s === 'Accepted' ? ' primary' : ''), onclick: () => save({ status: s }) }, 'Mark ' + s.toLowerCase())),
          x.status !== 'Draft' && x.status !== 'Sent' ? h('button', { class: 'sm ghost', onclick: () => save({ status: 'Sent' }) }, 'Undo') : null));
    }
    paint();
    return { el: h('div', {}, pageHead('Quotes & invoices', h('a', { class: 'btn', href: '#/edit/production/' + id }, 'Production'), h('a', { class: 'btn', href: '#/money' }, 'All')), body) };
  };

  // ---- everything owed, and billing details
  App.pages.money = () => {
    if (!App.can('edit')) return { el: h('div', {}, pageHead('Quotes & invoices'), h('div', { class: 'card empty' }, 'Producers and Admins see this.')) };
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    let tab = 'owed';
    const billingForm = async () => {
      const b = await api('GET', `/api/billing?team=${App.team}`);
      const f = { ...b };
      const t = (k, l, ph, area) => h('label', { class: 'f' + (area ? ' wide' : '') }, h('span', {}, l), area ? h('textarea', { rows: 3, placeholder: ph || '', oninput: (e) => { f[k] = e.target.value; } }, f[k] || '') : h('input', { value: f[k] || '', placeholder: ph || '', oninput: (e) => { f[k] = e.target.value; } }));
      UI.modal({ title: 'Billing details', wide: true, body: h('div', { class: 'form' }, t('legalName', 'Registered name', 'RegemarkFP (Pty) Ltd'), t('regNo', 'Registration number', '2026/123456/07'), t('vatNo', 'VAT number (empty if not registered)'), t('email', 'Accounts email'), t('phone', 'Phone'),
        h('label', { class: 'f' }, h('span', {}, 'VAT %'), h('input', { type: 'number', value: f.vatRate, oninput: (e) => { f.vatRate = Number(e.target.value) || 0; } })), h('label', { class: 'f' }, h('span', {}, 'Payment terms (days)'), h('input', { type: 'number', value: f.terms, oninput: (e) => { f.terms = Number(e.target.value) || 0; } })),
        t('address', 'Address', '', true), t('bank', 'Bank details (printed on invoices)', 'Bank · Account name · Account number · Branch code', true), t('notes', 'Small print', 'Terms and conditions …', true)),
        actions: [{ label: 'Cancel' }, App.can('admin') ? { label: 'Save', primary: true, onClick: async () => { await api('PUT', `/api/billing?team=${App.team}`, f); toast('Billing details saved'); } } : { label: 'Only Admins can change these' }] });
    };
    async function paint() {
      let r; try { r = await api('GET', `/api/invoices?team=${App.team}`); } catch (e) { body.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      const tile = (l, v, cls) => h('div', { class: 'card', style: { margin: 0 } }, h('div', { class: 'dim small' }, l), h('div', { style: { fontSize: '22px', fontWeight: 700 }, class: cls || '' }, v));
      const list = tab === 'owed' ? r.docs.filter((x) => x.kind === 'invoice' && ['Sent', 'Overdue'].includes(x.state)) : tab === 'quotes' ? r.docs.filter((x) => x.kind === 'quote') : r.docs;
      body.replaceChildren(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px' } }, tile('Owed to you', money(r.owed)), tile('Overdue', money(r.overdue)), tile('Crew still to pay', money(r.crewOwed))),
        h('div', { class: 'tabs' }, [['owed', 'Owed'], ['quotes', 'Quotes'], ['all', 'Everything'], ['crew', 'Crew to pay']].map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; paint(); } }, l))),
        tab === 'crew' ? (r.crew.length ? h('div', { class: 'card' }, h('table', { class: 't' }, h('tbody', {}, r.crew.map((c) => h('tr', {}, h('td', {}, c.date), h('td', {}, c.name, h('div', { class: 'dim small' }, c.role)), h('td', {}, h('a', { href: '#/edit/production/' + c.production }, c.productionName)), h('td', { class: 'right' }, money(c.amount)))))),
          h('p', { class: 'dim small' }, 'Tick "Paid" on the production\'s crew row once you have paid someone.')) : h('div', { class: 'card empty' }, 'Every crew member has been paid.'))
          : list.length ? h('div', { class: 'card' }, h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, list.map((x) => h('tr', {}, h('td', {}, h('a', { href: '#/invoices/' + x.production }, x.number)), h('td', {}, x.client || '', h('div', { class: 'dim small' }, [x.productionNumber, x.productionName].filter(Boolean).join(' · '))), h('td', {}, x.date, h('div', { class: 'dim small' }, 'due ' + x.due)), h('td', {}, pill(x.state)), h('td', { class: 'right' }, money(x.total))))))))
            : h('div', { class: 'card empty' }, tab === 'owed' ? 'Nothing owed to you right now.' : 'None yet. Open a production → Quotes & invoices.'));
    }
    paint();
    return { el: h('div', {}, pageHead('Quotes & invoices', h('button', { onclick: () => billingForm().catch(oops) }, 'Billing details')), body) };
  };

  // ---- kit out and back in for a production (scan a barcode or type a serial / name)
  App.pages.kit = (id) => {
    const doc = App.docs.get(id);
    if (!doc) return App.pages.notfound();
    const el = h('div', {});
    const scan = h('input', { placeholder: 'Scan a barcode, or type a serial or name, then Enter', autofocus: true, onkeydown: (e) => { if (e.key === 'Enter') { hit(e.target.value.trim()); e.target.value = ''; } } });
    const kitOf = () => (App.docs.get(id).data.kit || []).map((k) => ({ ...k }));
    const unitsOf = () => { const out = []; for (const r of App.docs.get(id).data.equipment || []) { const it = App.docs.get(r.item); if (!it) continue; for (let i = 0; i < Math.max(1, Number(r.quantity) || 1); i++) out.push({ key: `${r.item}#${i + 1}`, item: r.item, n: i + 1, of: Math.max(1, Number(r.quantity) || 1), data: it.data }); } return out; };
    const me = () => (App.me && (App.me.name || App.me.email)) || '';
    async function save(kit) { const cur = App.docs.get(id).data; await App.save('production', id, { ...cur, kit }); paint(); }
    function hit(text) {
      if (!text) return;
      const t = text.toLowerCase(), units = unitsOf(), kit = kitOf();
      const cands = units.filter((u) => [u.data.barcode, u.data.serial, u.data.name].some((x) => String(x || '').toLowerCase() === t)) .concat(units.filter((u) => String(u.data.name || '').toLowerCase().includes(t)));
      // the next unit of that item that is not out yet (going out), else the first that is out (coming back)
      const isOut = (u) => { const k = kit.find((x) => x.key === u.key); return k && k.out && !k.in; };
      const u = cands.find((x) => !kit.find((k) => k.key === x.key)) || cands.find(isOut);
      if (!u) { toast('Not on this production\'s equipment list: ' + text, 'error'); return; }
      const k = kit.find((x) => x.key === u.key);
      if (!k) kit.push({ key: u.key, item: u.item, out: Date.now(), outBy: me(), in: 0, condition: 'OK' });
      else if (!k.in) { k.in = Date.now(); k.inBy = me(); }
      else { toast(`${u.data.name} ${u.of > 1 ? '#' + u.n + ' ' : ''}is already back`); return; }
      toast(`${u.data.name}${u.of > 1 ? ' #' + u.n : ''}: ${!k ? 'out' : 'back in'}`);
      save(kit).catch(oops);
    }
    function paint() {
      const kit = kitOf(), units = unitsOf();
      const st = (u) => { const k = kit.find((x) => x.key === u.key); return !k ? 'Not out' : k.in ? (k.condition === 'OK' ? 'Back' : 'Back: ' + k.condition) : k.condition === 'Missing' ? 'Missing' : 'Out'; };
      const n = (s) => units.filter((u) => st(u) === s).length;
      el.replaceChildren(pageHead('Kit out / in', h('a', { class: 'btn', href: '#/edit/production/' + id }, 'Production')),
        h('div', { class: 'card' }, h('b', {}, doc.data.name), h('div', { class: 'dim small' }, `${units.length} items · ${n('Out')} out · ${units.length - n('Not out') - n('Out') - n('Missing')} back · ${n('Missing')} missing`), h('div', { style: { marginTop: '10px' } }, scan)),
        units.length ? h('div', { class: 'card' }, h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, units.map((u) => {
          const k = kit.find((x) => x.key === u.key), s = st(u);
          const set = (patch) => { const all = kitOf(); let x = all.find((y) => y.key === u.key); if (!x) { x = { key: u.key, item: u.item, out: Date.now(), outBy: me(), in: 0, condition: 'OK' }; all.push(x); } Object.assign(x, patch); save(all).catch(oops); };
          return h('tr', {}, h('td', {}, h('b', {}, u.data.name), u.of > 1 ? ` #${u.n}` : '', h('div', { class: 'dim small' }, [u.data.category, u.data.serial, u.data.barcode].filter(Boolean).join(' · '))),
            h('td', {}, h('span', { class: 'pill ' + (s === 'Back' ? 'ok' : s === 'Out' ? 'warn' : s === 'Not out' ? '' : 'bad') }, s), k && k.out ? h('div', { class: 'dim small' }, `out ${new Date(k.out).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${k.in ? ' · back ' + new Date(k.in).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}`) : null),
            h('td', { class: 'right nowrap' }, !k ? h('button', { class: 'sm', onclick: () => set({}) }, 'Out') : !k.in ? [h('button', { class: 'sm primary', onclick: () => set({ in: Date.now(), inBy: me(), condition: 'OK' }) }, 'Back'), ' ', h('button', { class: 'sm', onclick: () => set({ in: Date.now(), inBy: me(), condition: 'Damaged' }) }, 'Back damaged'), ' ', h('button', { class: 'sm ghost danger', onclick: () => set({ condition: 'Missing' }) }, 'Missing')]
              : h('button', { class: 'sm ghost', onclick: () => set({ in: 0, condition: 'OK' }) }, 'Undo')));
        }))))) : h('div', { class: 'card empty' }, 'Add equipment to the production first.'),
        units.some((u) => u.data.serviceDue && u.data.serviceDue <= today()) ? h('p', { class: 'pill warn', style: { whiteSpace: 'normal' } }, 'Service or test due: ' + [...new Set(units.filter((u) => u.data.serviceDue && u.data.serviceDue <= today()).map((u) => u.data.name))].join(', ')) : null);
    }
    paint();
    return { el, onMessage: UI.debounce((m) => { if (m.type === 'doc' && m.doc.id === id) paint(); }, 200) };
  };

  // ---- days a crew member cannot work (their own)
  App.pages.availability = () => {
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    let list = [];
    const paint = () => body.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'dim', style: { marginTop: 0 } }, 'Days you cannot work. Producers see a clash when they book you on one of them.'),
      list.length ? h('table', { class: 't' }, h('tbody', {}, list.map((u, i) => h('tr', {}, h('td', {}, u.from === u.to ? u.from : `${u.from} – ${u.to}`), h('td', { class: 'dim' }, u.note || ''), h('td', { class: 'right' }, h('button', { class: 'sm ghost danger', onclick: () => { list.splice(i, 1); save(); } }, 'Remove')))))) : h('p', {}, 'None: you are available.'),
      (() => { const f = { from: '', to: '', note: '' }; return h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px', marginTop: '10px' } }, h('input', { type: 'date', onchange: (e) => { f.from = e.target.value; } }), h('span', {}, 'to'), h('input', { type: 'date', onchange: (e) => { f.to = e.target.value; } }), h('input', { placeholder: 'Note (optional)', oninput: (e) => { f.note = e.target.value; } }), h('button', { class: 'primary', onclick: () => { if (!f.from) return toast('Pick a day', 'error'); list.push({ from: f.from, to: f.to || f.from, note: f.note }); save(); } }, 'Add')); })()));
    const save = async () => { try { list = (await api('PUT', `/api/me/availability?team=${App.team}`, { list })).list; paint(); } catch (e) { oops(e); } };
    api('GET', `/api/me/availability?team=${App.team}`).then((r) => { if (!r.onCrew) return body.replaceChildren(h('div', { class: 'card empty' }, 'You are not on this team\'s crew list with your email address. Ask a Producer to add you.')); list = r.list; paint(); }).catch((e) => body.replaceChildren(h('div', { class: 'card' }, e.message)));
    return { el: h('div', {}, pageHead('My availability'), body) };
  };

  // ---- proof of play for sponsors, per month
  App.pages.sponsors = () => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    let month = d.toISOString().slice(0, 7);
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    const hm = (s) => { s = Math.round(s); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    async function paint() {
      let r; try { r = await api('GET', `/api/sponsors?team=${App.team}&month=${month}`); } catch (e) { body.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      body.replaceChildren(r.list.length ? h('div', { class: 'card' }, h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Sponsor', 'Plays', 'On air', 'Days', ''].map((t) => h('th', {}, t)))), h('tbody', {}, r.list.map((s) => h('tr', {},
        h('td', {}, h('b', {}, s.sponsor), h('div', { class: 'dim small' }, s.email || 'no email on their adverts')), h('td', { class: 'right' }, String(s.plays)), h('td', { class: 'right' }, hm(s.seconds)), h('td', { class: 'right' }, String(s.days)),
        h('td', { class: 'right nowrap' }, h('a', { class: 'btn sm', href: `/api/sponsors/report.pdf?team=${App.team}&month=${month}&sponsor=${enc(s.sponsor)}`, target: '_blank', rel: 'noopener' }, 'PDF'), ' ',
          App.cfg.mail ? h('button', { class: 'sm primary', onclick: async () => { const to = s.email || (await promptBox('Email the report to', 'Sponsor email', '')); if (!to) return; try { const x = await api('POST', `/api/sponsors/send?team=${App.team}`, { month, sponsor: s.sponsor, to }); toast('Sent to ' + x.to); } catch (e) { oops(e); } } }, 'Email') : null)))))))
        : h('div', { class: 'card empty' }, 'No adverts were played in this month.'));
    }
    paint();
    return { el: h('div', {}, pageHead('Sponsor reports', h('input', { type: 'month', value: month, onchange: (e) => { month = e.target.value; paint(); } })),
      h('p', { class: 'dim', style: { marginTop: '-8px' } }, 'Proof of play for each sponsor: every play of their adverts in the month, from the playout log. Add the sponsor\'s email on their adverts to email it in one click.'), body) };
  };
})();
