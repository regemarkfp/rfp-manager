/* Coaches, officials and production expenses:
 *  - a coach's home (their clubs, teams and matches) and the team sheet they pick for a match
 *  - an official's home (the matches they are named on) and the result they confirm
 *  - expenses with receipts on a production: crew add them from their phone, Producers approve. */
'use strict';
(() => {
  const today = () => UI.today();
  const money = (n) => UI.money(Number(n) || 0, (App.org() || {}).currency || 'ZAR');
  const byDate = (a, b) => String(a.data.startDate + (a.data.startTime || '')).localeCompare(String(b.data.startDate + (b.data.startTime || '')));
  const myOfficialName = () => { const m = App.myMember(); return (m && m.data.officialName) || App.me.name || ''; };
  const myFixturesAsOfficial = () => App.list('fixture').filter((d) => Schema.officiates(d.data, myOfficialName()));
  const coachSquads = () => { const clubs = App.coachClubs(); return App.list('squad').filter((s) => clubs.has(s.data.club)); };
  const fixturesOf = (squadIds) => App.list('fixture').filter((d) => squadIds.has(d.data.team1) || squadIds.has(d.data.team2));

  function matchList(list, empty, extra) {
    return list.length ? list.map((d) => h('div', {}, App.fixtureRow(d, { showDate: true }), extra ? extra(d) : null)) : h('div', { class: 'empty' }, empty);
  }

  // ---- a coach's home ----------------------------------------------------------------------
  function coachHome() {
    const el = h('div', {});
    const paint = () => {
      const clubs = [...App.coachClubs()].map((id) => App.docs.get(id)).filter(Boolean);
      const squads = coachSquads(), ids = new Set(squads.map((s) => s.id));
      const fx = fixturesOf(ids).sort(byDate);
      const next = fx.filter((d) => d.data.startDate >= today() && d.data.status !== 'Completed');
      const past = fx.filter((d) => d.data.startDate < today() || d.data.status === 'Completed').reverse().slice(0, 10);
      const sheetState = (d) => {
        const mine = [d.data.team1, d.data.team2].filter((s) => ids.has(s));
        return h('div', { class: 'small', style: { margin: '-4px 0 10px 72px' } }, mine.map((s) => {
          const sh = d.data.teamSheets && d.data.teamSheets[s];
          return h('a', { class: 'pill ' + (sh ? 'ok' : 'warn'), href: '#/edit/fixture/' + d.id, style: { marginRight: '6px' } }, `${App.title('squad', s)}: ${sh ? sh.rows.length + ' picked' : 'pick the team sheet'}`);
        }));
      };
      el.replaceChildren(...[
        h('div', { class: 'hero' }, App.avatar(App.me.image, App.me.name, 56), h('div', {}, h('h1', {}, 'My teams'), h('div', { class: 'dim' }, `${App.me.name || App.me.email} · Coach · ${App.org().name || ''}`))),
        clubs.length ? null : h('div', { class: 'card' }, h('p', { style: { margin: 0 } }, 'No club has been given to you yet. Ask an Admin of ', h('b', {}, App.org().name || 'the production team'), ' to choose your club under Settings → Members.')),
        h('div', { class: 'two' },
          h('div', { class: 'card' }, h('h2', {}, 'Clubs and teams'),
            clubs.map((c) => h('div', { style: { marginBottom: '10px' } }, h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, App.img(c.data.image) ? h('img', { src: App.img(c.data.image), alt: '', style: { width: '32px', height: '32px', objectFit: 'contain' } }) : null, h('a', { href: '#/edit/club/' + c.id }, h('b', {}, c.data.name))),
              squads.filter((s) => s.data.club === c.id).map((s) => h('div', { class: 'small', style: { marginLeft: '40px' } }, h('a', { href: '#/edit/squad/' + s.id }, App.title('squad', s.id)), h('span', { class: 'dim' }, ` · ${(s.data.players || []).length} players`))))),
            clubs.length ? h('div', { class: 'row', style: { marginTop: '8px' } }, h('a', { class: 'btn sm', href: '#/edit/squad/new' }, '+ New team'), h('a', { class: 'btn sm', href: '#/edit/player/new' }, '+ New player')) : null),
          h('div', { class: 'card' }, h('h2', {}, 'Next matches'), matchList(next, 'No matches coming up.', sheetState))),
        h('div', { class: 'card', style: { marginTop: '16px' } }, h('h2', {}, 'Results'), matchList(past, 'No results yet.'))].filter(Boolean));
    };
    paint();
    return { el, keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc') paint(); }, 200) };
  }

  // ---- an official's home ------------------------------------------------------------------
  function officialHome() {
    const el = h('div', {});
    const paint = () => {
      const fx = myFixturesAsOfficial().sort(byDate);
      const next = fx.filter((d) => d.data.startDate >= today() && d.data.status !== 'Completed');
      const past = fx.filter((d) => !next.includes(d)).reverse();
      const roleOn = (d) => { const line = String(d.data.officials || '').split(/\n+/).find((l) => Schema.officiates({ officials: l }, myOfficialName())); return line && line.includes(':') ? line.split(':')[0].trim() : 'Official'; };
      el.replaceChildren(
        h('div', { class: 'hero' }, App.avatar(App.me.image, App.me.name, 56), h('div', {}, h('h1', {}, 'My matches'), h('div', { class: 'dim' }, `${myOfficialName() || App.me.email} · Official · ${App.org().name || ''}`))),
        h('div', { class: 'two' },
          h('div', { class: 'card' }, h('h2', {}, 'Coming up'), matchList(next, `You are not named on any match yet. Matches list their officials as "Role: Name"; yours is "${myOfficialName()}".`, (d) => h('div', { class: 'dim small', style: { margin: '-4px 0 10px 72px' } }, roleOn(d)))),
          h('div', { class: 'card' }, h('h2', {}, 'Played'), matchList(past, 'Nothing yet.', (d) => h('div', { class: 'small', style: { margin: '-4px 0 10px 72px' } },
            d.data.officialReport ? h('span', { class: 'pill ok' }, `Result confirmed by ${d.data.officialReport.by}`) : h('a', { class: 'pill warn', href: '#/edit/fixture/' + d.id }, 'Confirm the result'))))));
    };
    paint();
    return { el, keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc') paint(); }, 200) };
  }

  const home = App.pages.dashboard;
  App.pages.dashboard = () => (App.role === 'Coach' ? coachHome() : App.role === 'Official' ? officialHome() : home());

  // ---- a match: team sheets and the official's report ----------------------------------------
  function teamSheetCard(doc, squadId) {
    const sq = App.docs.get(squadId);
    if (!sq) return null;
    const f = doc.data, sheet = (f.teamSheets || {})[squadId];
    const can = App.can('edit') || (App.role === 'Coach' && App.coachClubs().has(sq.data.club));
    if (!can && !sheet) return null;
    const pool = (sq.data.players || []).filter((r) => r.player);
    const chosen = new Map(((sheet && sheet.rows) || []).map((r) => [r.player, r]));
    const rows = (sheet ? sheet.rows : []).concat(pool.filter((r) => !chosen.has(r.player)).map((r) => ({ ...r, out: true }))).map((r) => ({ ...r, out: sheet ? !chosen.has(r.player) : false }));
    if (!sheet) for (const r of rows) r.out = false;
    const body = h('tbody', {});
    const paintRows = () => body.replaceChildren(...rows.map((r, i) => {
      const p = App.docs.get(r.player);
      const name = p ? [p.data.name, p.data.surname].filter(Boolean).join(' ') : 'Player';
      return h('tr', { style: { opacity: r.out ? 0.45 : 1 } },
        h('td', {}, can ? h('input', { type: 'checkbox', checked: !r.out, title: 'In the squad for this match', onchange: (e) => { r.out = !e.target.checked; paintRows(); } }) : null),
        h('td', { style: { width: '70px' } }, can ? h('input', { value: r.number || '', style: { width: '56px' }, oninput: (e) => { r.number = e.target.value; } }) : r.number || ''),
        h('td', {}, name),
        h('td', {}, can ? h('input', { value: r.position || '', placeholder: 'Position', oninput: (e) => { r.position = e.target.value; } }) : r.position || ''),
        h('td', {}, can ? h('label', { class: 'row small', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: !!r.bench, onchange: (e) => { r.bench = e.target.checked; } }), 'Bench') : r.bench ? 'Bench' : ''),
        h('td', {}, can ? h('label', { class: 'row small', style: { gap: '4px' } }, h('input', { type: 'radio', name: 'capt-' + squadId, checked: !!r.captain, onchange: () => { rows.forEach((x) => { x.captain = x === r; }); } }), 'Capt.') : r.captain ? 'Captain' : ''),
        can ? h('td', { class: 'r nowrap' }, h('button', { class: 'sm ghost', disabled: i === 0, onclick: () => { rows.splice(i - 1, 0, rows.splice(i, 1)[0]); paintRows(); } }, '↑')) : null);
    }));
    paintRows();
    return h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Team sheet: ' + App.title('squad', squadId)),
      sheet ? h('span', { class: 'dim small' }, `Picked by ${sheet.by} · ${new Date(sheet.at).toLocaleString('en-GB')}`) : h('span', { class: 'pill warn' }, 'Not picked yet: the whole squad is used')),
      pool.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, body)) : h('p', { class: 'dim' }, 'This team has no players yet. ', can ? h('a', { href: '#/edit/squad/' + squadId }, 'Add players to the team') : null),
      can && pool.length ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'primary', onclick: async () => {
        try {
          const r = await api('PUT', `/api/fixtures/${encodeURIComponent(doc.id)}/teamsheet?team=${App.team}`, { squad: squadId, rows: rows.filter((x) => !x.out) });
          App.docs.set(r.doc.id, r.doc); toast('Team sheet saved. The scorer and graphics use it for this match.');
        } catch (e) { oops(e); }
      } }, 'Save team sheet'), h('span', { class: 'dim small' }, 'Ticked players play in this match, in this order (starters, then the bench).')) : null);
  }

  function reportCard(doc) {
    const f = doc.data, rep = f.officialReport;
    const mine = App.role === 'Official' && Schema.officiates(f, myOfficialName());
    const can = mine || App.can('edit');
    if (!can && !rep) return null;
    const v = { scoreA: rep ? rep.scoreA : '', scoreB: rep ? rep.scoreB : '', cards: rep ? rep.cards : '', notes: rep ? rep.notes : '' };
    const names = App.fixtureName(f).split(/\s+vs?\s+/i);
    const inp = (k, ph, type) => h('input', { type: type || 'text', value: v[k], placeholder: ph, disabled: !can, oninput: (e) => { v[k] = e.target.value; } });
    return h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Result from the officials'),
      rep ? h('span', { class: 'pill ok' }, `Confirmed by ${rep.by} · ${new Date(rep.at).toLocaleString('en-GB')}`) : h('span', { class: 'dim small' }, 'Not confirmed yet')),
      h('div', { class: 'form' },
        h('label', { class: 'f' }, h('span', {}, names[0] || 'Team 1'), inp('scoreA', 'Score', 'number')),
        h('label', { class: 'f' }, h('span', {}, names[1] || 'Team 2'), inp('scoreB', 'Score', 'number')),
        h('label', { class: 'f', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Cards and incidents'), h('textarea', { rows: 3, disabled: !can, placeholder: 'Yellow: Player name (Team) 34\'', oninput: (e) => { v.cards = e.target.value; } }, v.cards)),
        h('label', { class: 'f', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Match notes'), h('textarea', { rows: 3, disabled: !can, oninput: (e) => { v.notes = e.target.value; } }, v.notes))),
      can ? h('button', { class: 'primary', style: { marginTop: '10px' }, onclick: async () => {
        try { const r = await api('PUT', `/api/fixtures/${encodeURIComponent(doc.id)}/report?team=${App.team}`, v); App.docs.set(r.doc.id, r.doc); toast('Result confirmed'); route(); } catch (e) { oops(e); }
      } }, rep ? 'Update the result' : 'Confirm the result') : null);
  }

  const fixturePanel = App.panels.fixture;
  App.panels.fixture = (doc, form) => {
    const cur = App.docs.get(doc.id) || doc;
    const coachOnly = App.role === 'Coach' || App.role === 'Official';
    return h('div', {}, coachOnly ? h('div', { class: 'card' }, h('h2', { style: { marginBottom: '4px' } }, App.fixtureName(cur.data)), h('div', { class: 'dim' }, [UI.fmtDate(cur.data.startDate), cur.data.startTime, App.title('venue', cur.data.venue)].filter(Boolean).join(' · '))) : fixturePanel(doc, form),
      [cur.data.team1, cur.data.team2].filter(Boolean).map((s) => teamSheetCard(cur, s)),
      reportCard(cur));
  };

  // ---- a production: expenses and receipts -------------------------------------------------
  function expenseModal(prodId, existing) {
    const can = App.can('edit');
    const data = existing ? { ...existing.data } : { production: prodId, date: today(), category: 'Fuel' };
    const fields = Schema.fieldsFor('expense').filter((f) => (can || !['status'].includes(f.k)) && f.k !== 'paidBy' && f.k !== 'production');
    const form = buildForm('expense', data, { fields });
    const id = existing ? existing.id : App.newId('expense');
    modal({ title: existing ? 'Expense' : 'Add an expense', wide: true, body: form.el, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
      try { await App.save('expense', id, { ...data, ...form.data, production: prodId }); toast(can ? 'Expense saved' : 'Expense sent to the producer'); return true; } catch (e) { oops(e); return false; }
    } }] });
  }

  function expensesCard(doc) {
    const box = h('div', { class: 'card' });
    const paint = () => {
      const list = App.list('expense').filter((x) => x.data.production === doc.id).sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
      const can = App.can('edit'), canAdd = App.canEdit('expense');
      const sum = (st) => list.filter((x) => st.includes(x.data.status)).reduce((s, x) => s + (Number(x.data.amount) || 0), 0);
      box.replaceChildren(...[
        h('div', { class: 'spread' }, h('h2', {}, can ? 'Expenses and receipts' : 'My expenses'), canAdd ? h('button', { class: 'primary sm', onclick: () => expenseModal(doc.id) }, '+ Add expense') : null),
        list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'What'), h('th', {}, 'Paid by'), h('th', {}, 'Receipt'), h('th', { class: 'r' }, 'Amount'), h('th', {}, 'Status'))),
          h('tbody', {}, list.map((x) => h('tr', {},
            h('td', { class: 'nowrap' }, UI.fmtDate(x.data.date)),
            h('td', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); expenseModal(doc.id, x); } }, x.data.description || 'Expense'), h('div', { class: 'dim small' }, [x.data.category, x.data.recharge ? 'to the client' : ''].filter(Boolean).join(' · '))),
            h('td', { class: 'nowrap' }, (() => { const pp = App.personByEmail(x.data.submittedBy); return [App.avatar(pp && pp.image, x.data.paidBy, 22), ' ', x.data.paidBy || '']; })()),
            h('td', {}, x.data.receipt ? h('a', { href: '/media/' + x.data.receipt, target: '_blank', rel: 'noopener' }, (App.docs.get(x.data.receipt) || { data: {} }).data.mime === 'application/pdf' ? 'PDF ↗' : 'Photo ↗') : h('span', { class: 'pill warn' }, 'none')),
            h('td', { class: 'r num' }, money(x.data.amount)),
            h('td', {}, can ? h('select', { style: { width: '130px' }, onchange: async (e) => { try { await App.save('expense', x.id, { ...x.data, status: e.target.value }); toast('Expense ' + e.target.value.toLowerCase()); } catch (err) { oops(err); } } },
              Schema.EXPENSE_STATUS.map((s) => h('option', { selected: s === x.data.status }, s))) : h('span', { class: 'pill ' + (x.data.status === 'Approved' || x.data.status === 'Paid back' ? 'ok' : x.data.status === 'Rejected' ? 'warn' : '') }, x.data.status))))))) : h('div', { class: 'empty' }, 'No expenses yet. Add fuel, meals, parking … with a photo of the receipt.'),
        list.length ? h('p', { class: 'dim small', style: { marginBottom: 0 } }, `Approved ${money(sum(['Approved', 'Paid back']))} · waiting ${money(sum(['Submitted']))}${can ? ' · approved expenses are in the costing' : ''}`) : null].filter(Boolean));
    };
    paint();
    box.repaint = paint;
    return box;
  }

  const productionPanel = App.panels.production;
  App.panels.production = (doc, form) => {
    const base = App.can('edit') ? productionPanel(doc, form) : null;           // costing: Producers and Admins
    const exp = App.docs.has(doc.id) && !App.cfg.bridge ? expensesCard(doc) : null;
    const box = h('div', {}, exp, base);
    box.repaint = () => { if (base && base.repaint) base.repaint(); if (exp) exp.repaint(); };
    return box;
  };
})();
