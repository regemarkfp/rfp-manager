/* Running the company (quotes and invoices are in money-pages.js): kit
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
        h('a', { class: 'btn sm', href: '#/invoices/' + doc.id }, 'Quotes & invoices'),
        h('a', { class: 'btn sm', href: '#/kit/' + doc.id }, 'Kit out / in'),
        App.cfg.mode === 'cloud' ? h('button', { class: 'sm', onclick: async () => { try { const r = await api('POST', `${base(doc.id)}/client-link?team=${App.team}`); await navigator.clipboard.writeText(r.url).catch(() => {}); UI.modal({ title: 'Client page', body: h('div', {}, h('p', {}, 'A private page for your client: this production, its call sheet, stream, recordings, report and the quotes and invoices you have sent. Nothing else of your team.'), h('input', { readonly: true, value: r.url, onfocus: (e) => e.target.select() }), h('p', { class: 'dim small' }, 'Copied. Anyone with the link can open it.')), actions: [{ label: 'Stop sharing', danger: true, onClick: async () => { await api('DELETE', `${base(doc.id)}/client-link?team=${App.team}`); toast('The old link no longer works'); } }, { label: 'Done', primary: true }] }); } catch (e) { oops(e); } } }, p.clientKey ? 'Client page ✓' : 'Client page') : null)),
        cl.length ? h('div', { style: { marginTop: '10px' } }, cl.map((c) => h('p', { class: 'pill ' + (c.kind === 'declined' ? 'bad' : 'warn'), style: { whiteSpace: 'normal', margin: '4px 0', display: 'block' } }, '⚠ ' + c.text))) : h('p', { class: 'dim small', style: { margin: '8px 0 0' } }, 'No crew clashes.'));
    }
    paint();
    const box = h('div', {}, card, inner);
    box.repaint = () => { if (inner && inner.repaint) inner.repaint(); paint(); };
    return box;
  };

  // ---- what clients thought: their ratings after the event (from the booking's tracking page)
  App.pages.ratings = () => {
    if (!App.can('edit')) return { el: h('div', {}, pageHead('Ratings'), h('div', { class: 'card empty' }, 'Producers and Admins see this.')) };
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    const stars = (n) => h('span', { style: { color: '#ffc531', letterSpacing: '1px' } }, '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)));
    api('GET', `/api/ratings?team=${App.team}`).then((r) => {
      const tile = (l, v) => h('div', { class: 'card', style: { margin: 0 } }, h('div', { class: 'dim small' }, l), h('div', { style: { fontSize: '22px', fontWeight: 700 } }, v));
      body.replaceChildren(
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px' } },
          tile('Average', r.count ? h('span', {}, `${r.average} `, stars(r.average)) : '–'), tile('Ratings', String(r.count)),
          ...r.aspects.filter((a) => a.average).map((a) => tile(a.aspect, h('span', {}, `${a.average} `, stars(a.average))))),
        r.list.length ? h('div', { class: 'card' }, h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, r.list.map((x) => h('tr', {},
          h('td', { class: 'nowrap' }, stars(x.stars)), h('td', {}, h('a', { href: '#/edit/booking/' + x.id }, [x.name, x.organisation].filter(Boolean).join(' · ')), h('div', { class: 'dim small' }, [x.service, x.date].filter(Boolean).join(' · '))),
          h('td', {}, x.comment || h('span', { class: 'dim' }, 'No comment')), h('td', { class: 'dim small nowrap' }, x.publicOk ? (x.hidden ? 'Hidden' : 'On the website') : 'Private'))))))) :
          h('div', { class: 'card empty' }, 'No ratings yet. When a booking\'s production is completed, the client is asked to rate it (and once more three days later).'),
        r.google ? h('p', { class: 'dim small' }, 'Clients get a button to post their review on Google too. ', h('a', { href: r.google, target: '_blank', rel: 'noopener' }, 'Your Google review page ↗')) : h('p', { class: 'dim small' }, 'Add your Google review link in Settings → Website so clients can post their review on Google too.'));
    }).catch((e) => body.replaceChildren(h('div', { class: 'card' }, e.message)));
    return { el: h('div', {}, pageHead('Ratings'), body) };
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
