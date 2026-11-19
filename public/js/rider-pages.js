/* Productions in three phases, and tech riders (1.6.0)
 *  · The production page is split into Pre-production, Production and Post-production. Each phase has its steps
 *    (details, quote, crew, kit, tech rider, call sheet … report, invoice, crew paid) with a tick when done, and a
 *    click takes you to where it is done.
 *  · Tech rider tab: start from a ready-made or saved template, fill from the venue's technical profile, preview the
 *    PDF, send it (email with the PDF and a link) and see the venue's answers per item. */
'use strict';
(() => {
  const R = window.RFPRiders;
  const enc = encodeURIComponent;
  const base = (id) => `/api/productions/${enc(id)}`;
  const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
  const docsOf = (type, test) => [...App.docs.values()].filter((d) => d.type === type && !d.deleted && test(d.data));

  // ---- the steps of each phase, worked out from the production
  function steps(id, p) {
    const saved = App.docs.has(id), money = App.can('edit') && !App.cfg.bridge;
    const inv = saved ? docsOf('invoice', (x) => x.production === id) : [];
    const quote = inv.filter((x) => x.data.kind === 'quote'), bills = inv.filter((x) => x.data.kind === 'invoice');
    const crew = (p.crew || []).filter((r) => r.role || r.crewMember);
    const pr = R.progress(p.riderNeeds, p.riderReplies);
    const riderOn = (p.riderNeeds || []).some((x) => x.item) || (p.riderDeliverables || []).some((x) => x.item) || !!p.riderSetup;
    const S = (label, done, go, sub, opt) => ({ label, done: done === true ? 'done' : done === 'half' ? 'half' : 'todo', go, sub: sub || '', opt: !!opt });
    return {
      'Pre-production': [
        S('Details', p.date && p.venue && (p.clientRef || p.client) ? true : p.date ? 'half' : false, { group: 'Details' }, [p.date ? UI.fmtDate(p.date) : 'no date', p.venue ? App.title('venue', p.venue) : 'no venue'].join(' · ')),
        money ? S('Quote', quote.some((x) => ['Accepted', 'Converted'].includes(x.data.status)) ? true : quote.some((x) => x.data.status === 'Sent') ? 'half' : false, { href: '#/invoices/' + id },
          quote.length ? quote.map((x) => `${x.data.number || 'Quote'} ${x.data.status}`).join(', ') : 'no quote yet', true) : null,
        S('Crew', crew.length && crew.every((r) => r.confirmed) ? true : crew.length ? 'half' : false, { group: 'Crew & kit' }, crew.length ? `${crew.filter((r) => r.confirmed).length} of ${crew.length} confirmed` : 'nobody booked'),
        S('Equipment', (p.equipment || []).some((r) => r.item) ? true : false, { group: 'Crew & kit' }, `${(p.equipment || []).filter((r) => r.item).length} item${(p.equipment || []).filter((r) => r.item).length === 1 ? '' : 's'}`),
        S('Tech rider', riderOn && p.riderSentAt && pr.total && !pr.mustOpen && !pr.issues ? true : riderOn ? 'half' : false, { group: 'Tech rider' },
          !riderOn ? 'not made yet' : !p.riderSentAt ? 'not sent' : pr.issues ? `${pr.issues} problem${pr.issues === 1 ? '' : 's'}` : pr.total ? `${pr.ok} of ${pr.total} sorted` : 'sent', true),
        S('Call sheet', p.callsheetSentAt ? true : false, { href: '#/callsheet/' + id }, p.callsheetSentAt ? 'sent ' + when(p.callsheetSentAt) : 'not sent'),
        p.streamChannel ? S('Live stream', p.streamSlug ? true : 'half', { group: 'Live stream' }, App.title('channel', p.streamChannel)) : null,
      ].filter(Boolean),
      Production: [
        S('Confirmed', ['Confirmed', 'Completed'].includes(p.status) ? true : false, { group: 'Details' }, p.status || 'Planned'),
        S('Rundown', (p.rundown || []).length ? true : false, { href: '#/rundown/production/' + id }, `${(p.rundown || []).length} item${(p.rundown || []).length === 1 ? '' : 's'}`, true),
        (p.fixtures || []).length ? S('Matches', true, { group: 'Details' }, `${p.fixtures.length} match${p.fixtures.length === 1 ? '' : 'es'}`) : null,
        S('Issues on the day', true, { group: 'On the day' }, (p.incidents || []).length ? `${p.incidents.length} logged, ${(p.incidents || []).filter((x) => !x.resolved).length} open` : 'none logged', true),
      ].filter(Boolean),
      'Post-production': [
        S('Report', p.status === 'Completed' ? true : false, { href: '#/complete/' + id }, p.status === 'Completed' ? 'completed' : 'rate it and list issues'),
        S('Music cue sheet', p.status === 'Completed' ? true : 'half', { href: '#/report/' + id }, 'report & cue sheet', true),
        money ? S('Invoice', bills.length && bills.every((x) => x.data.status === 'Paid') ? true : bills.some((x) => !['Draft', 'Cancelled'].includes(x.data.status)) ? 'half' : false, { href: '#/invoices/' + id },
          bills.length ? bills.map((x) => `${x.data.number || 'Invoice'} ${x.data.status}`).join(', ') : 'not invoiced') : null,
        money && crew.length ? S('Crew paid', crew.every((r) => r.paid) ? true : crew.some((r) => r.paid) ? 'half' : false, { group: 'Crew & kit' }, `${crew.filter((r) => r.paid).length} of ${crew.length} paid`) : null,
      ].filter(Boolean),
    };
  }
  App.productionSteps = steps;

  // ---- the strip under the phase bar: the steps of this phase (or a short line per phase on "All")
  function phaseTop(doc, phase, goPhase, goGroup, data) {
    const all = steps(doc.id, data);
    const count = (list) => `${list.filter((s) => s.done === 'done').length}/${list.length}`;
    const go = (s) => { if (s.go.href) location.hash = s.go.href; else if (s.go.group) goGroup(s.go.group); };
    if (!phase) return h('div', { class: 'ph-steps' }, Object.entries(all).map(([n, list]) => h('button', { type: 'button', class: 'ph-step', onclick: () => goPhase(n) }, h('b', {}, n), h('span', { class: 'dim small' }, count(list) + ' done'))));
    const list = all[phase] || [];
    return h('div', { class: 'ph-steps' }, list.map((s, i) => h('button', { type: 'button', class: 'ph-step ' + s.done, title: s.go.href ? 'Open' : 'Go to ' + s.go.group, onclick: () => go(s) },
      h('span', { class: 'ph-tick' }, s.done === 'done' ? '✓' : s.done === 'half' ? '◐' : String(i + 1)), h('span', {}, h('b', {}, s.label + (s.opt ? '' : '')), h('span', { class: 'dim small' }, s.sub)))));
  }

  // ---- the Tech rider tab: templates, venue, PDF, link, send, answers
  function riderBox(doc, form, markDirty) {
    const saved = App.docs.has(doc.id);
    const cur = () => (App.docs.get(doc.id) || doc).data;
    const F = () => form();
    const apply = (vals, msg) => { const f = F(); Object.assign(f.data, vals); markDirty(); f.repaint(); toast(msg + ' Press Save to keep it.'); };
    const templates = () => [...R.BUILT_IN.map((t) => ({ ...t, built: true })), ...App.sorted('riderTemplate').map((d) => ({ id: d.id, ...d.data }))];
    const venueOf = () => { const v = F() && F().data.venue ? App.docs.get(F().data.venue) : null; return v && !v.deleted ? v.data : null; };
    const startFrom = async (id) => {
      const t = templates().find((x) => x.id === id); if (!t) return;
      const f = F(); const hasRows = (f.data.riderNeeds || []).some((x) => x.item) || f.data.riderSetup;
      if (hasRows && !(await confirmBox(`Replace this production's tech rider with "${t.name}"? The answers already given stay with the items that keep their name.`, 'Replace'))) return;
      apply({ ...R.fromTemplate(t, venueOf()), riderTemplate: t.id }, `Tech rider filled from "${t.name}".`);
    };
    const fromVenue = () => {
      const v = venueOf();
      if (!v) { toast('Choose the venue on the Details tab first'); return; }
      const tech = v.tech || [];
      const f = F(); let n = 0;
      const needs = (f.data.riderNeeds || []).map((x) => { const m = tech.find((t) => R.needKey(t) === R.needKey(x)) || tech.find((t) => t.category === x.category && String(t.item || '').toLowerCase() === String(x.item || '').toLowerCase()); if (m && m.detail && m.detail !== x.venueHas) { n++; return { ...x, venueHas: m.detail }; } return x; });
      apply({ riderNeeds: needs, riderContact: f.data.riderContact || v.techContact || '', riderEmail: f.data.riderEmail || v.techEmail || '' }, n ? `${n} item${n === 1 ? '' : 's'} filled from ${v.name}.` : `Nothing new from ${v.name}'s technical profile.`);
    };
    const saveTemplate = async () => {
      const f = F().data;
      const name = await UI.promptBox('Save as a tech rider template', 'Name', `${f.type || 'Production'} rider`);
      if (!name) return;
      try {
        await App.save('riderTemplate', App.newId('riderTemplate'), { name, productionType: f.type || '', setup: f.riderSetup || '', deliverables: (f.riderDeliverables || []).filter((x) => x.item),
          needs: (f.riderNeeds || []).filter((x) => x.item).map(({ category, item, detail, required }) => ({ category, item, detail, required })) });
        toast(`Saved: "${name}" is in Start from, and under Productions → Tech riders`);
      } catch (e) { oops(e); }
    };
    const copyLink = async () => {
      try { const r = await api('POST', `${base(doc.id)}/rider/link?team=${App.team}`); await navigator.clipboard.writeText(r.url).catch(() => {}); UI.modal({ title: 'Tech rider link', body: h('div', {}, h('p', {}, 'Anyone with this link sees the rider and can answer each item (no sign-in). It is copied: paste it into WhatsApp or an email.'), h('input', { value: r.url, readonly: true, style: { width: '100%' }, onfocus: (e) => e.target.select() })), actions: [{ label: 'Open it', onClick: () => window.open(r.url, '_blank', 'noopener') }, { label: 'Done', primary: true }] }); } catch (e) { oops(e); }
    };
    const sendIt = () => {
      const f = F().data, v = venueOf() || {};
      const client = f.clientRef ? App.docs.get(f.clientRef) : null;
      const found = [[f.riderEmail || v.techEmail, `Venue technical contact${f.riderContact || v.techContact ? ' – ' + (f.riderContact || v.techContact) : ''}`], [f.clientEmail || (client && client.data.email), `Client${client ? ' – ' + client.data.name : f.client ? ' – ' + f.client : ''}`]].filter(([e]) => okEmail(e));
      const picked = new Set(found.map(([e]) => e.toLowerCase()));
      const extra = h('input', { placeholder: 'more@example.com, another@example.com' }), note = h('textarea', { rows: 3, placeholder: 'A line from you (optional)' });
      const body = h('div', { class: 'form' },
        found.length ? h('div', { class: 'wide' }, h('div', { class: 'flabel' }, 'Send to'), found.map(([e, l]) => h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: true, onchange: (ev) => { if (ev.target.checked) picked.add(e.toLowerCase()); else picked.delete(e.toLowerCase()); } }), h('span', {}, h('b', {}, e), ' ', h('span', { class: 'dim small' }, l)))))
          : h('p', { class: 'wide dim' }, 'No venue or client email yet: type the addresses below (or add a technical contact on the venue).'),
        h('label', { class: 'f wide' }, h('span', {}, found.length ? 'Also send to' : 'Send to'), extra),
        h('label', { class: 'f wide' }, h('span', {}, 'Note'), note),
        h('p', { class: 'wide help', style: { margin: 0 } }, 'They get the PDF and a link to answer each item (Sorted, Problem or Not needed). You are told when they answer, and what they confirm is saved on the venue for next time.'));
      UI.modal({ title: 'Send the tech rider', wide: true, body, actions: [{ label: 'Cancel' }, { label: 'Send', primary: true, onClick: async () => {
        const to = [...picked, ...extra.value.split(/[\s,;]+/).filter(Boolean)];
        const r = await api('POST', `${base(doc.id)}/rider/send?team=${App.team}`, { to, note: note.value });
        toast(r.failed.length ? `Sent to ${r.sent}; not sent: ${r.failed.map((x) => x.email).join(', ')}` : `Tech rider sent to ${r.sent}`);
      } }] });
    };

    const p = cur(), pr = R.progress(p.riderNeeds, p.riderReplies), replies = p.riderReplies || {};
    const answered = (p.riderNeeds || []).filter((x) => x.item && replies[R.needKey(x)] && replies[R.needKey(x)].status);
    const tsel = h('select', { onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) startFrom(v); } }, h('option', { value: '' }, '— Start from a template —'),
      h('optgroup', { label: 'Ready-made' }, R.BUILT_IN.map((t) => h('option', { value: t.id }, t.name))),
      App.sorted('riderTemplate').length ? h('optgroup', { label: 'Your templates' }, App.sorted('riderTemplate').map((d) => h('option', { value: d.id }, d.data.name))) : null);
    const cloud = App.cfg.mode === 'cloud' && !App.cfg.bridge;
    return h('div', { class: 'card rider-box' },
      h('div', { class: 'spread' }, h('div', { class: 'em-title', style: { fontWeight: 700, fontSize: '16px' } }, 'Send & answers'), h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
        tsel, h('button', { type: 'button', class: 'sm', onclick: fromVenue, title: 'What the venue already has (Venues → Technical)' }, 'Fill from the venue'), h('button', { type: 'button', class: 'sm', onclick: saveTemplate }, 'Save as a template'))),
      saved ? h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginTop: '10px' } },
        h('button', { type: 'button', class: 'sm', onclick: () => App.openDoc(`${base(doc.id)}/rider.pdf?team=${App.team}`) }, 'Preview PDF'),
        cloud ? h('button', { type: 'button', class: 'sm', onclick: copyLink }, 'Copy the link') : null,
        cloud ? h('button', { type: 'button', class: 'sm primary', onclick: sendIt }, p.riderSentAt ? 'Send again' : 'Send to venue / client') : null,
        h('span', { class: 'dim small' }, [p.riderSentAt ? `Sent ${when(p.riderSentAt)}${(p.riderSentTo || []).length ? ' to ' + p.riderSentTo.join(', ') : ''}` : 'Not sent yet', pr.total ? `${pr.ok} of ${pr.total} sorted` : '', pr.issues ? `${pr.issues} problem${pr.issues === 1 ? '' : 's'}` : '', pr.mustOpen && p.riderSentAt ? `${pr.mustOpen} must-have${pr.mustOpen === 1 ? '' : 's'} waiting` : ''].filter(Boolean).join(' · ')))
        : h('p', { class: 'dim small' }, 'Save the production to preview, send or share the rider.'),
      answered.length ? h('div', { class: 'tablewrap', style: { marginTop: '10px' } }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Kind'), h('th', {}, 'What'), h('th', {}, 'Answer'), h('th', {}, 'Their note'), h('th', {}, 'By'))),
        h('tbody', {}, answered.map((x) => { const a = replies[R.needKey(x)]; return h('tr', {}, h('td', { class: 'dim small' }, x.category), h('td', {}, x.item), h('td', {}, h('span', { class: 'pill ' + ({ ok: 'ok', issue: 'bad', na: '' })[a.status] }, R.STATUS[a.status])), h('td', {}, a.note || ''), h('td', { class: 'dim small' }, `${a.by || ''} ${when(a.at)}`)); })))) : null,
      (p.riderLog || []).filter((l) => l.note).slice(-3).map((l) => h('p', { class: 'dim small', style: { margin: '6px 0 0' } }, `💬 ${l.by}, ${when(l.at)}: ${l.note}`)));
  }

  // the production form: phases with steps, and the rider box on its tab
  App.productionFormOpts = (doc, form, markDirty) => ({
    phaseTop: (phase, goPhase, goGroup, data) => phaseTop(doc, phase, goPhase, goGroup, data),
    tabExtras: { 'Tech rider': () => (App.can('edit') ? riderBox(doc, form, markDirty) : null) },
  });
})();
