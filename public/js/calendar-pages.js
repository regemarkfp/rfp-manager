/* The productions calendar (month and list), crew members' home (their gigs, what they earned, what they are still
 * owed) and what a crew member sees of an event, and the verse of the day on every home page. */
'use strict';
(() => {
  const money = (n) => UI.money(Number(n) || 0, (App.org() || {}).currency || 'ZAR');
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => iso(new Date(Date.parse(s + 'T12:00:00Z') + n * 86400e3));
  const isCrew = () => App.role === 'Crew';

  // ---- verse of the day
  let verse = null;
  App.verseCard = (small) => {
    const box = h('div', { class: 'card verse', style: { borderLeft: '4px solid var(--accent)', ...(small ? { padding: '10px 16px' } : {}) } });
    const paint = (v) => box.replaceChildren(h('div', { class: 'dim small', style: { textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: small ? '3px' : '6px', fontSize: small ? '11px' : null } }, 'Verse of the day'),
      v.text ? h('div', { style: { fontSize: small ? '14px' : '17px', lineHeight: 1.5, fontStyle: 'italic' } }, '“' + v.text + '”') : null,
      h('div', { style: { marginTop: small ? '3px' : '6px', fontWeight: 600, fontSize: small ? '13px' : null } }, v.ref, v.translation ? h('span', { class: 'dim small', style: { fontWeight: 400 } }, ' · ' + v.translation) : null));
    if (verse) paint(verse); else api('GET', '/api/verse').then((v) => { verse = v; paint(v); }).catch(() => box.remove());
    return box;
  };
  const home0 = App.pages.dashboard;
  App.pages.dashboard = () => {
    if (isCrew()) return crewHome();
    return home0();
  };

  // ---- the events on the calendar
  const myCrew = () => new Set(App.list('crewMember').filter((c) => (c.data.email || '').toLowerCase() === (App.me.email || '').toLowerCase()).map((c) => c.id));
  function events(withMatches) {
    const mine = myCrew();
    const out = App.list('production').filter((p) => p.data.date).map((p) => ({
      kind: 'production', id: p.id, title: p.data.name, start: p.data.date, end: addDays(p.data.date, Math.max(1, Number(p.data.days) || 1) - 1), time: p.data.txTime || '',
      venue: App.title('venue', p.data.venue), booked: (p.data.crew || []).some((r) => mine.has(r.crewMember)), doc: p }));
    if (withMatches) for (const f of App.list('fixture')) if (f.data.startDate) out.push({ kind: 'fixture', id: f.id, title: App.fixtureName(f.data), start: f.data.startDate, end: f.data.endDate || f.data.startDate, time: f.data.startTime || '', venue: App.title('venue', f.data.venue), doc: f });
    return out.sort((a, b) => (a.start + a.time).localeCompare(b.start + b.time));
  }
  function open(ev) {
    if (ev.kind === 'fixture') { location.hash = '#/edit/fixture/' + ev.id; return; }
    if (App.can('edit')) { location.hash = '#/edit/production/' + ev.id; return; }
    eventDetails(ev.doc);
  }

  // what a crew member sees of a production: details, and who they work with if they are on it
  function eventDetails(p) {
    const d = p.data, mine = myCrew();
    const me = (d.crew || []).filter((r) => mine.has(r.crewMember));
    const venue = App.docs.get(d.venue);
    const row = (label, value) => (value ? h('div', { class: 'row', style: { gap: '10px', padding: '4px 0' } }, h('span', { class: 'dim', style: { width: '110px', flex: 'none' } }, label), h('span', {}, value)) : null);
    const days = Math.max(1, Number(d.days) || 1);
    const body = h('div', {},
      row('Date', UI.fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (days > 1 ? ` (${days} days)` : '')),
      row('TX / kick-off', d.txTime), row('Venue', venue ? [venue.data.name, venue.data.city].filter(Boolean).join(', ') : ''), row('Event', d.event), row('Client', d.client),
      d.description ? h('p', { class: 'dim', style: { whiteSpace: 'pre-wrap' } }, d.description) : null,
      me.length ? h('div', { class: 'card', style: { background: 'var(--panel2)', margin: '12px 0' } }, h('b', {}, 'You are booked'),
        me.map((r) => h('div', { class: 'small' }, [App.title('crewRole', r.role), r.location, r.callTime && 'call ' + r.callTime, r.productionTime && 'TX ' + r.productionTime].filter(Boolean).join(' · ')))) : h('p', { class: 'dim' }, 'You are not booked on this production.'),
      me.length && d.crewNotes ? h('div', {}, h('h3', {}, 'Good to know'), h('div', { style: { whiteSpace: 'pre-wrap' } }, d.crewNotes)) : null,
      me.length ? h('div', {}, h('h3', { style: { marginTop: '12px' } }, 'Crew you work with'),
        h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, (d.crew || []).filter((r) => r.crewMember).map((r) => {
          const c = App.docs.get(r.crewMember), cd = (c && c.data) || {};
          const person = App.personByEmail(cd.email);
          return h('tr', {}, h('td', {}, App.avatar((person && person.image) || cd.image, cd.name, 24), ' ', [cd.name, cd.surname].filter(Boolean).join(' ') || 'Crew', mine.has(r.crewMember) ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'you') : null),
            h('td', {}, App.title('crewRole', r.role)), h('td', { class: 'dim' }, r.location || ''), h('td', { class: 'nowrap' }, cd.phone ? h('a', { href: 'tel:' + cd.phone }, cd.phone) : ''));
        }))))) : null,
      me.length && (d.hospitals || []).length ? h('div', {}, h('h3', { style: { marginTop: '12px' } }, 'Nearest hospitals'), d.hospitals.map((x) => h('div', { class: 'small' }, [x.name, x.area, x.phone].filter(Boolean).join(' · ')))) : null,
      me.length ? h('p', {}, h('a', { class: 'btn sm', href: '#/callsheet/' + p.id }, 'Call sheet')) : null);
    modal({ title: d.name, wide: true, body, actions: [{ label: 'Close' }] });
  }

  // ---- the calendar page
  let monthStart = null, showMatches = false, view = 'month';
  App.pages.calendar = () => {
    if (!monthStart) { const t = new Date(); monthStart = new Date(Date.UTC(t.getFullYear(), t.getMonth(), 1)); }
    try { view = localStorage.getItem('rfp.cal.view') || (innerWidth < 700 ? 'list' : 'month'); } catch { /* default */ }
    const el = h('div', {});
    const paint = () => {
      const evs = events(showMatches && !isCrew());
      const y = monthStart.getUTCFullYear(), m = monthStart.getUTCMonth();
      const first = iso(monthStart), last = iso(new Date(Date.UTC(y, m + 1, 0)));
      const title = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const move = (n) => { monthStart = new Date(Date.UTC(y, m + n, 1)); paint(); };
      const today = UI.today();
      const chip = (ev) => h('div', { class: 'cal-ev ' + ev.kind + (ev.booked ? ' booked' : ''), title: [ev.title, ev.time, ev.venue].filter(Boolean).join(' · '), onclick: (e) => { e.stopPropagation(); open(ev); } }, ev.time ? h('b', {}, ev.time + ' ') : null, ev.title);
      let body;
      if (view === 'month') {
        const lead = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;            // weeks start on Monday
        const cells = [];
        for (let i = 0; i < 42; i++) {
          const d = addDays(first, i - lead);
          if (i >= 35 && d > last) break;
          const on = evs.filter((ev) => ev.start <= d && ev.end >= d);
          cells.push(h('div', { class: 'cal-day' + (d.slice(0, 7) !== first.slice(0, 7) ? ' other' : '') + (d === today ? ' today' : '') },
            h('div', { class: 'cal-n' }, String(Number(d.slice(8)))), on.map(chip)));
        }
        body = h('div', { class: 'cal' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => h('div', { class: 'cal-head' }, w)), cells);
      } else {
        const list = evs.filter((ev) => ev.end >= first && ev.start <= last);
        body = list.length ? h('div', { class: 'card' }, list.map((ev) => h('div', { class: 'fx click', style: { cursor: 'pointer' }, onclick: () => open(ev) },
          h('div', { class: 'when' }, UI.fmtDate(ev.start, { day: 'numeric', month: 'short' })), h('div', { class: 'grow' }, h('b', {}, ev.title), h('div', { class: 'dim small' }, [ev.kind === 'fixture' ? 'Match' : 'Production', ev.time, ev.venue].filter(Boolean).join(' · '))),
          ev.booked ? h('span', { class: 'pill ok' }, 'You are booked') : null))) : h('div', { class: 'card empty' }, 'Nothing this month.');
      }
      el.replaceChildren(pageHead(title,
        h('button', { onclick: () => move(-1), 'aria-label': 'Previous month' }, '‹'), h('button', { onclick: () => { const t = new Date(); monthStart = new Date(Date.UTC(t.getFullYear(), t.getMonth(), 1)); paint(); } }, 'Today'), h('button', { onclick: () => move(1), 'aria-label': 'Next month' }, '›'),
        h('select', { style: { width: 'auto' }, onchange: (e) => { view = e.target.value; try { localStorage.setItem('rfp.cal.view', view); } catch { /* not kept */ } paint(); } }, h('option', { value: 'month', selected: view === 'month' }, 'Month'), h('option', { value: 'list', selected: view === 'list' }, 'List')),
        isCrew() ? null : h('label', { class: 'row small', style: { gap: '6px' } }, h('input', { type: 'checkbox', checked: showMatches, onchange: (e) => { showMatches = e.target.checked; paint(); } }), 'Matches too'),
        App.canCreate('production') ? h('a', { class: 'btn primary', href: '#/edit/production/new' }, '+ New production') : null),
        isCrew() ? h('p', { class: 'dim', style: { marginTop: 0 } }, 'Every production of ', h('b', {}, App.org().name || 'the team'), '. Green ones are yours: click one for the details and the crew you work with.') : null,
        body);
    };
    paint();
    return { el, keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc') paint(); }, 200) };
  };

  // ---- a crew member's home: gigs and money
  function crewHome() {
    const el = h('div', {});
    const verseBox = App.verseCard(); verseBox.style.marginBottom = '16px';
    const paint = async () => {
      let r;
      try { r = await api('GET', '/api/crew/me?team=' + App.team); } catch (e) { el.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      const gig = (g) => h('div', { class: 'fx click', style: { cursor: 'pointer' }, onclick: () => { const p = App.docs.get(g.production); if (p) eventDetails(p); } },
        h('div', { class: 'when' }, UI.fmtDate(g.date, { day: 'numeric', month: 'short' })),
        h('div', { class: 'grow' }, h('b', {}, g.name), h('div', { class: 'dim small' }, [g.role, g.location, g.callTime && 'call ' + g.callTime, g.txTime && 'TX ' + g.txTime, g.venue].filter(Boolean).join(' · '))),
        g.days > 1 ? h('span', { class: 'pill' }, g.days + ' days') : null);
      el.replaceChildren(
        h('div', { class: 'hero' }, App.avatar(App.me.image, App.me.name, 56), h('div', {}, h('h1', {}, 'My gigs'), h('div', { class: 'dim' }, `${App.me.name || App.me.email} · Crew · ${App.org().name || ''}`)),
          h('div', { class: 'row', style: { marginLeft: 'auto' } }, h('a', { class: 'btn', href: '#/calendar' }, 'Calendar'))),
        verseBox,
        r.linked ? null : h('div', { class: 'card' }, h('p', { style: { margin: 0 } }, 'Your gigs show here once a producer adds you to the crew list with your email address (', h('b', {}, App.me.email), ').')),
        h('div', { class: 'cards', style: { marginBottom: '16px' } },
          h('div', { class: 'tile' }, h('b', {}, money(r.earned30)), h('span', {}, 'Earned in the last 30 days')),
          h('div', { class: 'tile' }, h('b', { style: { color: r.owed ? 'var(--warn)' : 'var(--accent)' } }, money(r.owed)), h('span', {}, `Still owed${r.owedGigs ? ` · ${r.owedGigs} gig${r.owedGigs === 1 ? '' : 's'}` : ''}${r.owedExpenses ? ' + expenses' : ''}`)),
          h('div', { class: 'tile' }, h('b', {}, r.upcoming.length), h('span', {}, 'Upcoming gigs'))),
        h('div', { class: 'two' },
          h('div', { class: 'card' }, h('h2', {}, 'Coming up'), r.upcoming.length ? r.upcoming.map(gig) : h('div', { class: 'empty' }, 'No gigs booked yet.')),
          h('div', { class: 'card' }, h('h2', {}, 'Recent'), r.past.length ? r.past.map((g) => h('div', {}, gig(g), h('div', { class: 'small', style: { margin: '-6px 0 8px 72px' } }, money(g.pay), ' · ', h('span', { class: 'pill ' + (g.paid ? 'ok' : 'warn') }, g.paid ? 'paid' : 'not paid yet')))) : h('div', { class: 'empty' }, 'Nothing yet.'))));
    };
    paint();
    return { el, keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc' && ['production', 'expense', 'crewMember'].includes(m.doc.type)) paint(); }, 400) };
  }
})();
