/* Dashboard, generic list / edit screens, fixtures, images. */
'use strict';
(() => {
  const E = Schema.ENTITIES;
  const cur = () => App.org().currency || 'ZAR';
  const res = (f) => f.result || null;
  const scoreText = (f) => (res(f) && res(f).started ? res(f).text : '');
  const statusPill = (f) => h('span', { class: 'pill' + (f.status === 'Live' ? ' live' : f.status === 'Completed' ? ' ok' : '') }, f.status || 'Upcoming');

  function fixtureRow(d, { showDate } = {}) {
    const f = d.data, r = res(f), air = App.machine.onAirFixture === d.id;
    return h('div', { class: 'fx' },
      h('div', { class: 'when' }, showDate ? UI.fmtDate(f.startDate, { day: 'numeric', month: 'short' }) : (f.startTime || '--:--')),
      h('div', { class: 'grow' }, h('a', { href: '#/edit/fixture/' + d.id }, h('b', {}, App.fixtureName(f))),
        h('div', { class: 'dim small' }, [f.sport, App.title('competition', f.competition), App.title('venue', f.venue), showDate ? f.startTime : ''].filter(Boolean).join(' · '))),
      r && r.started ? h('span', { class: 'sc' }, r.text) : f.officialReport && f.officialReport.scoreA !== '' ? h('span', { class: 'sc', title: 'Confirmed by ' + f.officialReport.by }, `${f.officialReport.scoreA} – ${f.officialReport.scoreB}`) : null,
      r && f.status === 'Live' ? h('span', { class: 'dim small' }, r.period) : null,
      air ? h('span', { class: 'pill live', title: 'Graphics, outputs and monitors follow this match' }, 'ON AIR') : null,
      statusPill(f),
      App.canScore() ? h('a', { class: 'btn sm' + (f.status === 'Live' ? ' primary' : ''), href: App.scorerUrl(d.id, f) }, 'Score') : null,
      App.gfx && App.can('score') && !air ? h('button', { class: 'sm', title: 'Graphics control, outputs and monitors switch to this match', onclick: () => App.gfxDo('setFixture', { fixtureId: d.id }).then(() => { App.machine.onAirFixture = d.id; toast('On air: ' + App.fixtureName(f)); route(); }).catch(oops) }, 'Put on air') : null,
      App.gfx && App.can('score') && air ? h('a', { class: 'btn sm primary', href: '/live/control.html', title: 'Graphics control for the match on air' }, 'Graphics ↗') : null,
      App.limited() ? null : h('a', { class: 'btn sm', href: '#/rundown/fixture/' + d.id }, 'Rundown'));
  }
  App.fixtureRow = fixtureRow;

  // ---- dashboard ------------------------------------------------------------------------------
  App.pages.dashboard = () => {
    const el = h('div', {});
    const paint = () => {
      const org = App.org(), today = UI.today();
      const fx = App.list('fixture').sort((a, b) => String(a.data.startDate + a.data.startTime).localeCompare(String(b.data.startDate + b.data.startTime)));
      const live = fx.filter((d) => d.data.status === 'Live');
      const todays = fx.filter((d) => d.data.startDate === today && d.data.status !== 'Live');
      const next = fx.filter((d) => d.data.startDate > today && d.data.status === 'Upcoming').slice(0, 6);
      const prods = App.list('production').filter((d) => d.data.date >= today).sort((a, b) => String(a.data.date).localeCompare(String(b.data.date))).slice(0, 6);
      const first = !App.list('club').length && !App.list('production').length && !fx.length;
      el.replaceChildren(
        h('div', { class: 'hero' }, org.image && App.img(org.image) ? h('img', { src: App.img(org.image), alt: '' }) : null,
          h('div', {}, h('h1', {}, org.name || 'Production team'), h('div', { class: 'dim' }, UI.fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))),
          (App.gfx || App.machine.outputKey) && App.can('score') ? h('div', { class: 'row', style: { marginLeft: 'auto' } },
            h('a', { class: 'btn', href: '/live/worship.html', title: 'Songs, scripture and slides for services' }, 'Worship control ↗'),
            h('a', { class: 'btn primary', href: '/live/control.html', title: 'Take graphics for the match on air' }, 'Graphics control ↗')) : null),
        App.dashBelowHero ? App.dashBelowHero() : null,
        h('div', { class: 'cards', style: { marginBottom: '16px' } },
          h('div', { class: 'tile' }, h('b', {}, live.length), h('span', {}, 'Live now')),
          h('div', { class: 'tile' }, h('b', {}, todays.length + live.length), h('span', {}, 'Matches today')),
          h('div', { class: 'tile' }, h('b', {}, App.list('production').filter((d) => d.data.date === today).length), h('span', {}, 'Productions today')),
          h('div', { class: 'tile' }, h('b', {}, App.list('crewMember').length), h('span', {}, 'Crew on the books'))),
        first ? h('div', { class: 'card' }, h('h2', {}, 'Getting started'), h('ol', { style: { margin: 0, paddingLeft: '20px', lineHeight: 1.9 } },
          h('li', {}, 'Add your ', h('a', { href: '#/list/club' }, 'clubs'), ', their ', h('a', { href: '#/list/squad' }, 'teams'), ' and ', h('a', { href: '#/list/player' }, 'players'), ' (or import your XML save file in ', h('a', { href: '#/settings' }, 'Settings'), ').'),
          h('li', {}, 'Create ', h('a', { href: '#/fixtures' }, 'fixtures'), '. Each venue gets its own production for the day automatically.'),
          h('li', {}, 'Set up ', h('a', { href: '#/list/crewRole' }, 'crew roles'), ', ', h('a', { href: '#/list/crewMember' }, 'crew'), ' and ', h('a', { href: '#/list/equipment' }, 'equipment'), ' to cost productions.'),
          h('li', {}, 'Score a match, then take graphics from ', h('a', { href: '/live/control.html' }, 'Graphics control'), '.'))) : '',
        h('div', { class: 'two' },
          h('div', { class: 'card' }, h('h2', {}, 'Live & today'),
            live.length + todays.length ? [...live, ...todays].map((d) => fixtureRow(d)) : h('div', { class: 'empty' }, 'No matches today.')),
          h('div', { class: 'card' }, h('h2', {}, 'Coming up'),
            next.length ? next.map((d) => fixtureRow(d, { showDate: true })) : h('div', { class: 'empty' }, 'Nothing scheduled. ', App.canEdit('fixture') ? h('a', { href: '#/edit/fixture/new' }, 'Add a fixture') : null))),
        h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'spread' }, h('h2', {}, 'Upcoming productions'), App.canEdit('production') ? h('a', { class: 'btn sm', href: '#/edit/production/new' }, '+ New production') : null),
          prods.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, prods.map((d) => h('tr', { class: 'click', onclick: () => { location.hash = '#/edit/production/' + d.id; } },
            h('td', { class: 'nowrap' }, UI.fmtDate(d.data.date)), h('td', {}, h('b', {}, d.data.name)), h('td', {}, d.data.type || ''), h('td', {}, App.title('venue', d.data.venue)), h('td', { class: 'r dim' }, `${(d.data.crew || []).length} crew`))))))
            : h('div', { class: 'empty' }, 'No productions planned.')));
    };
    paint();
    return { el, keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc') paint(); }, 150) };
  };

  // ---- generic list ---------------------------------------------------------------------------
  function cell(type, f, v, data) {
    if (v === undefined || v === null || v === '') {
      if (type === 'squad' && f.inherit) { const c = App.get(data.club); return c && c[f.inherit] ? h('span', { class: 'dim' }, c[f.inherit]) : ''; }
      return '';
    }
    switch (f.t) {
      case 'image': return App.img(v) ? h('img', { class: 'thumb', src: App.img(v), alt: '', loading: 'lazy' }) : '';
      case 'color': return h('span', { class: 'nowrap' }, h('span', { class: 'swatch', style: { background: v } }), v);
      case 'ref': return App.title(f.ref, v);
      case 'member': { const m = App.list('member').find((x) => x.data.email === v); return m ? (m.data.name || m.data.email) : v || ''; }
      case 'multi': return (v || []).join(', ');
      case 'money': return UI.money(v, cur());
      case 'date': return UI.fmtDate(v);
      case 'bool': return v ? 'Yes' : '';
      default: return String(v);
    }
  }

  App.pages.list = (type) => {
    const e = E[type];
    if (!e) return App.pages.notfound();
    let q = '';
    const fields = Schema.fieldsFor(type, App.org());
    const cols = e.cols.map((k) => fields.find((f) => f.k === k)).filter(Boolean);
    const body = h('div', {});
    const paint = () => {
      const needle = q.toLowerCase();
      const docs = App.sorted(type).filter((d) => !needle || JSON.stringify(d.data).toLowerCase().includes(needle) || App.title(type, d.id).toLowerCase().includes(needle));
      if (type === 'production') docs.sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || '')));
      body.replaceChildren(docs.length
        ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, cols.map((f) => h('th', { class: f.t === 'money' || f.t === 'number' ? 'r' : '' }, f.t === 'image' ? '' : f.l)))),
          h('tbody', {}, docs.map((d) => h('tr', { class: 'click', tabindex: '0', onclick: () => { location.hash = `#/edit/${type}/${d.id}`; }, onkeydown: (ev) => { if (ev.key === 'Enter') location.hash = `#/edit/${type}/${d.id}`; } },
            cols.map((f) => h('td', { class: f.t === 'money' || f.t === 'number' ? 'r num' : '' }, cell(type, f, d.data[f.k], d.data))))))))
        : h('div', { class: 'card empty' }, q ? 'Nothing matches that search.' : `No ${e.plural.toLowerCase()} yet.`, ' ', App.canCreate(type) && !q ? h('a', { href: `#/edit/${type}/new` }, 'Add the first one') : null),
      type === 'advert' ? adReport() : null);
    };
    paint();
    const el = h('div', {}, pageHead(e.plural,
      h('input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search', style: { width: '220px' }, oninput: (ev) => { q = ev.target.value; paint(); } }),
      type === 'song' && App.canEdit('song') ? h('button', { title: 'SongSelect lyrics (.txt), SongSelect .usr and ChordPro files', onclick: () => App.importSongs() }, 'Import song files…') : null,
      (type === 'song' || type === 'service') && (App.gfx || App.machine.outputKey) && App.can('score') ? h('a', { class: 'btn', href: '/live/worship.html' }, 'Worship control ↗') : null,
      !App.editable(type) && App.can('edit') ? h('a', { class: 'btn', href: App.onlineUrl(`#/list/${type}`), target: '_blank', rel: 'noopener', title: 'Records are managed on the website' }, 'Manage on the website ↗') : null,
      App.canCreate(type) ? h('a', { class: 'btn primary', href: `#/edit/${type}/new` }, '+ New ' + e.label.toLowerCase()) : null), body);
    return { el, keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc') paint(); }, 200) };
  };

  // Proof of play for sponsors: how often and how long each advert has been on air.
  function adReport() {
    const rows = {};
    for (const d of App.list('adlog')) for (const e of d.data.entries || []) {
      const r = (rows[e.advert] = rows[e.advert] || { name: e.name, sponsor: e.sponsor, plays: 0, seconds: 0, last: 0 });
      r.plays++; r.seconds += Number(e.seconds) || 0; r.last = Math.max(r.last, e.at);
    }
    const list = Object.values(rows).sort((a, b) => b.plays - a.plays);
    if (!list.length) return null;
    return h('div', { class: 'card', style: { marginTop: '16px' } }, h('h2', {}, 'Proof of play'), h('div', { class: 'tablewrap' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Advert'), h('th', {}, 'Sponsor'), h('th', { class: 'r' }, 'Plays'), h('th', { class: 'r' }, 'Air time'), h('th', {}, 'Last played'))),
      h('tbody', {}, list.map((r) => h('tr', {}, h('td', {}, r.name), h('td', {}, r.sponsor), h('td', { class: 'r num' }, r.plays), h('td', { class: 'r num' }, Schema.fmtDuration(r.seconds)), h('td', {}, new Date(r.last).toLocaleString('en-GB'))))))));
  }

  // ---- generic edit ---------------------------------------------------------------------------
  const PANELS = {
    dashboard(doc) {
      const d = doc.data, n = (d.pages || []).reduce((s, p) => s + (p.controls || []).length, 0);
      const url = '/live/dash.html?id=' + encodeURIComponent(doc.id);
      return h('div', { class: 'card' }, h('div', { class: 'spread' }, h('div', {}, h('h2', { style: { margin: 0 } }, 'Dashboard'), h('div', { class: 'dim small' }, `${(d.pages || []).length || 1} page${(d.pages || []).length > 1 ? 's' : ''} · ${n} control${n === 1 ? '' : 's'} · ${d.width || 1280} × ${d.height || 720}`)),
        h('div', { class: 'row' }, App.can('edit') ? h('a', { class: 'btn primary', href: url + '&edit=1', target: '_blank', rel: 'noopener' }, 'Design ↗') : null, h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Open ↗'))),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Drag buttons, take / out buttons, toggles, faders, lists, text boxes, number steppers, live text, clocks and pictures onto a page and link them to graphics, macros, adverts, devices and your own variables (Live → Variables & triggers). Use it on the PC, a tablet or a phone: it scales to the screen.'));
    },
    timeline(doc) {
      const d = doc.data, n = (d.cues || []).length, t = (d.tracks || []).length;
      const url = '/live/timeline.html?id=' + encodeURIComponent(doc.id);
      return h('div', { class: 'card' }, h('div', { class: 'spread' }, h('div', {}, h('h2', { style: { margin: 0 } }, 'Timeline'),
        h('div', { class: 'dim small' }, `${t} track${t === 1 ? '' : 's'} · ${n} cue${n === 1 ? '' : 's'} · ${(d.sections || []).length} sections · ${(d.comments || []).filter((c) => !c.done).length} open comments`)),
        h('div', { class: 'row' }, h('a', { class: 'btn primary', href: url, target: '_blank', rel: 'noopener' }, 'Open timeline ↗'), h('a', { class: 'btn', href: url + '&view=crew', target: '_blank', rel: 'noopener' }, 'Crew view ↗'))),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Lay the show out on tracks (shots, graphics, lyrics, lights, audio, playback), give cues actions (graphics, vMix, ATEM, HyperDeck, macros, AMCP) and run it from the production PC with PLAY and GO. Crew follow their tracks in the crew view (Monitors → Timeline crew view). Choose a production or match below to bring its rundown in.'));
    },
    player(doc) {
      const d = doc.data, st = Scoring.playerStats(App.list('fixture').map((x) => x.data))[doc.id] || { matches: 0, stats: {}, teams: [] };
      const sq = App.list('squad').filter((s) => (s.data.players || []).some((r) => r.player === doc.id));
      const names = sq.map((s) => Schema.resolveSquad(s.data, App.get(s.data.club)).name);
      return h('div', { class: 'card' }, h('h2', {}, 'Profile & statistics'), h('div', { class: 'cards' },
        h('div', { class: 'tile' }, h('b', {}, Schema.age(d.dateOfBirth) || '–'), h('span', {}, 'Age')),
        h('div', { class: 'tile' }, h('b', {}, st.matches), h('span', {}, 'Matches')),
        Object.entries(st.stats).map(([k, v]) => h('div', { class: 'tile' }, h('b', {}, v), h('span', {}, k)))),
      h('p', { class: 'dim small' }, 'Statistics are pulled from completed matches.'),
      h('div', { class: 'row' }, h('span', { class: 'dim' }, 'Current team:'), sq.length ? sq.map((s) => h('a', { class: 'pill', href: '#/edit/squad/' + s.id }, App.title('squad', s.id))) : '–'),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'dim' }, 'Previous teams:'), st.teams.filter((t) => !names.includes(t)).map((t) => h('span', { class: 'pill' }, t)), st.teams.filter((t) => !names.includes(t)).length ? null : '–'));
    },
    competition(doc) {
      const c = doc.data, fx = App.list('fixture').filter((d) => d.data.competition === doc.id);
      const n = (v, def) => (v === undefined || v === '' ? def : Number(v));
      const rows = Scoring.standings(fx.map((d) => d.data), { win: n(c.pointsWin, 3), draw: n(c.pointsDraw, 1), loss: n(c.pointsLoss, 0) });
      return h('div', { class: 'card' }, h('h2', {}, 'Log'), rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' },
        h('thead', {}, h('tr', {}, ['#', 'Team', 'P', 'W', 'D', 'L', 'For', 'Agst', '+/-', 'Pts'].map((x, i) => h('th', { class: i > 1 ? 'r' : '' }, x)))),
        h('tbody', {}, rows.map((r, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, h('b', {}, r.name)), [r.P, r.W, r.D, r.L, r.PF, r.PA, r.PD, r.Pts].map((x) => h('td', { class: 'r num' }, x)))))))
        : h('div', { class: 'dim' }, 'The log fills in as matches in this competition are completed.'),
      h('p', { class: 'dim small', style: { marginBottom: 0 } }, `${fx.length} match${fx.length === 1 ? '' : 'es'} in this competition.`));
    },
    squad(doc, form) {
      const ta = h('textarea', { placeholder: '10 Ruan Osborne, Flyhalf\n9 Sam Example, Scrumhalf', style: { minHeight: '110px' } });
      return h('div', { class: 'card' }, h('h2', {}, 'Add players quickly'), h('p', { class: 'dim small', style: { marginTop: 0 } }, 'One player per line: number, name, then a comma and the position (optional). New players are created in the players database.'), ta,
        h('div', { style: { marginTop: '10px' } }, h('button', { onclick: async () => {
          const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
          if (!lines.length) return;
          const rows = (form.data.players || []).slice();
          try {
            for (const line of lines) {
              const m = /^(\d+)?[\s.)-]*([^,]+?)(?:\s*,\s*(.+))?$/.exec(line);
              if (!m) continue;
              const parts = m[2].trim().split(/\s+/), surname = parts.length > 1 ? parts.pop() : '', name = parts.join(' ');
              let p = App.list('player').find((x) => (x.data.name || '').toLowerCase() === name.toLowerCase() && (x.data.surname || '').toLowerCase() === surname.toLowerCase());
              if (!p) p = await App.save('player', App.newId('player'), { name, surname, sports: form.data.sport ? [form.data.sport] : [] });
              if (!rows.some((r) => r.player === p.id)) rows.push({ number: m[1] || '', player: p.id, position: m[3] || '' });
            }
            form.data.players = rows; form.widgets.players.setRows(rows); ta.value = '';
            toast('Players added. Press Save to keep the squad list.');
          } catch (e) { oops(e); }
        } }, 'Add to squad')));
    },
    fixture(doc) {
      const f = doc.data, r = res(f), sp = Scoring.sportFor(f.sport);
      return h('div', { class: 'card' }, h('div', { class: 'spread' }, h('div', {}, h('h2', { style: { marginBottom: '4px' } }, App.fixtureName(f)), h('div', { class: 'row' }, statusPill(f), r && r.started ? h('b', {}, r.text) : null, r && r.started ? h('span', { class: 'dim' }, r.status || r.period) : null)),
        h('div', { class: 'row' }, App.canScore() ? h('a', { class: 'btn primary', href: App.scorerUrl(doc.id, f) }, sp && sp.id === 'cricket' ? 'Open cricket scorer' : 'Open scorer') : null,
          App.gfx && App.can('score') ? (App.machine.onAirFixture === doc.id ? h('a', { class: 'btn', href: '/live/control.html' }, 'Graphics control ↗')
            : h('button', { title: 'Graphics control, outputs and monitors switch to this match', onclick: () => App.gfxDo('setFixture', { fixtureId: doc.id }).then(() => { App.machine.onAirFixture = doc.id; toast('On air: ' + App.fixtureName(f)); route(); }).catch(oops) }, 'Put on air')) : null,
          h('a', { class: 'btn', href: App.commsUrl(doc.id, f), target: '_blank', rel: 'noopener' }, 'Commentary screen ↗'), h('a', { class: 'btn', href: '#/rundown/fixture/' + doc.id }, `Rundown (${(f.rundown || []).length})`))),
        sp ? null : h('p', { class: 'pill warn', style: { marginTop: '10px' } }, f.sport ? `There are no built-in rules for "${f.sport}". The scorer opens on its Setup tab so you can pick the closest sport.` : 'Choose a sport so the right scorer and rules are used.'));
    },
    production(doc, form) {
      const box = h('div', {});
      const paint = () => {
        const p = form.data, c = Schema.costing({ ...p, expenses: App.list('expense').filter((x) => x.data.production === doc.id).map((x) => ({ id: x.id, ...x.data })) }, (id) => App.get(id));
        const over = {};
        for (const r of p.crew || []) if (r.role) over[r.role] = (over[r.role] || 0) + 1;
        const warn = Object.entries(over).map(([id, n]) => { const role = App.get(id); return role && Number(role.maxQuantity) && n > Number(role.maxQuantity) ? `${role.name}: ${n} booked, maximum is ${role.maxQuantity}` : null; }).filter(Boolean);
        const clash = (p.crew || []).filter((r) => r.crewMember).map((r) => r.crewMember).filter((id, i, a) => a.indexOf(id) !== i).map((id) => App.title('crewMember', id));
        const fx = (p.fixtures || []).map((r) => App.docs.get(r.fixture)).filter(Boolean);
        box.replaceChildren(...[
          fx.length ? h('div', { class: 'card' }, h('h2', {}, 'Matches in this production'), fx.map((d) => App.fixtureRow(d))) : null,
          h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Costing'), h('div', { class: 'row no-print' }, h('a', { class: 'btn sm', href: '#/rundown/production/' + doc.id }, `Rundown (${(p.rundown || []).length})`), h('a', { class: 'btn sm', href: '#/callsheet/' + doc.id }, 'Call sheet'))),
            warn.concat(clash.length ? ['Booked twice: ' + [...new Set(clash)].join(', ')] : []).map((w) => h('div', { class: 'pill warn', style: { marginBottom: '8px', marginRight: '6px' } }, w)),
            c.lines.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', { class: 'r' }, 'Qty'), h('th', { class: 'r' }, 'Days'), h('th', { class: 'r' }, 'Cost'), h('th', { class: 'r' }, 'Invoice'))),
              h('tbody', {}, c.lines.map((l) => h('tr', {}, h('td', {}, h('span', { class: 'dim small' }, l.group + ' · '), l.label), h('td', { class: 'r num' }, l.qty), h('td', { class: 'r num' }, l.days), h('td', { class: 'r num' }, UI.money(l.cost, cur())), h('td', { class: 'r num' }, UI.money(l.invoice, cur())))),
                h('tr', {}, h('td', { colspan: '3' }, h('b', {}, 'Total')), h('td', { class: 'r num' }, h('b', {}, UI.money(c.cost, cur()))), h('td', { class: 'r num' }, h('b', {}, UI.money(c.invoice, cur()))))))) : h('div', { class: 'dim' }, 'Add crew, equipment or other costs above to see the numbers.'),
            c.lines.length ? h('div', { class: 'cards', style: { marginTop: '12px' } },
              h('div', { class: 'tile' }, h('b', {}, UI.money(c.cost, cur())), h('span', {}, 'What it costs you')),
              h('div', { class: 'tile' }, h('b', {}, UI.money(c.invoice, cur())), h('span', {}, 'What you invoice')),
              h('div', { class: 'tile' }, h('b', { style: { color: c.profit < 0 ? 'var(--danger)' : 'var(--accent)' } }, UI.money(c.profit, cur())), h('span', {}, `Profit · ${c.margin}% margin`))) : null)].filter(Boolean));
      };
      paint();
      box.repaint = paint;
      return box;
    },
  };

  App.panels = PANELS;               // more panels are added by other pages (stream-pages.js: channel)

  App.pages.edit = (type, id) => {
    const e = E[type];
    if (!e) return App.pages.notfound();
    const isNew = id === 'new';
    const doc = isNew ? { id: App.newId(type), type, data: {} } : App.docs.get(id);
    if (!doc) return { el: h('div', { class: 'card' }, 'This record no longer exists. ', h('a', { href: '#/list/' + type }, 'Back to the list')) };
    const canEdit = App.canEdit(type) && (isNew || App.coachOwns(type, doc));
    const online = !App.editable(type);
    const pre = {};
    if (isNew && type === 'fixture') pre.startDate = UI.today();
    if (isNew && type === 'production') pre.date = UI.today();
    let panel = null, dirty = false;
    const form = buildForm(type, isNew ? pre : doc.data, { onChange: () => { dirty = true; if (panel && panel.repaint) panel.repaint(); } });
    panel = !isNew && PANELS[type] ? PANELS[type](doc, form) : (type === 'production' ? PANELS.production(doc, form) : null);
    // Panels built from other records (statistics, log, live score) follow those records as they change.
    if (panel && ['player', 'competition', 'fixture'].includes(type)) {
      const holder = h('div', {}, panel);
      holder.repaint = () => holder.replaceChildren(PANELS[type](App.docs.get(doc.id) || doc, form));
      panel = holder;
    }
    const back = type === 'fixture' ? '#/fixtures' : '#/list/' + type;
    const save = async () => {
      try {
        const keep = isNew ? {} : Object.fromEntries(Object.entries((App.docs.get(doc.id) || doc).data).filter(([k]) => !(k in form.data)));   // fields this form does not show (rundown, live score…)
        await App.save(type, doc.id, { ...keep, ...form.data });
        dirty = false;
        toast(e.label + ' saved');
        if (isNew) location.hash = `#/edit/${type}/${doc.id}`; else if (panel && panel.repaint) panel.repaint();
      } catch (err) { oops(err); }
    };
    const el = h('div', {}, pageHead(h('div', {}, h('a', { class: 'small', href: back }, '← ' + e.plural), h('h1', {}, isNew ? 'New ' + e.label.toLowerCase() : e.title(doc.data, (x) => App.get(x)) || e.label)),
      !isNew && canEdit ? h('button', { class: 'danger no-print', onclick: async () => { if (await confirmBox(`Delete this ${e.label.toLowerCase()}? This cannot be undone.`)) { try { await App.remove(type, doc.id); toast('Deleted'); location.hash = back; } catch (err) { oops(err); } } } }, 'Delete') : null,
      canEdit ? h('button', { class: 'primary no-print', onclick: save }, 'Save') : null),
    type !== 'production' || !canEdit ? panel : null,
    App.limited() && type === 'fixture' ? null : h('div', { class: 'card' }, canEdit ? null : online ? h('div', { class: 'spread', style: { marginBottom: '10px' } }, h('p', { class: 'dim', style: { margin: 0 } }, `${e.plural} are managed on the website. This PC shows them and keeps a copy for when the internet is down.`), App.can('edit') && !isNew ? h('a', { class: 'btn sm', href: App.onlineUrl(`#/edit/${type}/${doc.id}`), target: '_blank', rel: 'noopener' }, 'Edit on the website ↗') : null) : h('p', { class: 'dim' }, 'You can view this but your role cannot change it.'), form.el),
    type === 'production' && canEdit ? panel : null);
    if (!canEdit) {
      el.querySelectorAll('.form input, .form select, .form textarea').forEach((x) => { x.disabled = true; });
      el.querySelectorAll('.form button').forEach((x) => { x.style.display = 'none'; });     // upload, add row … mean nothing when it cannot be saved
    }
    const onKey = (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (canEdit) save(); } };
    document.addEventListener('keydown', onKey);
    return { el, destroy: () => document.removeEventListener('keydown', onKey), onMessage: UI.debounce((m) => { if (m.type === 'doc' && panel && panel.repaint) panel.repaint(); }, 250) };
  };

  // ---- call sheet (print) ---------------------------------------------------------------------
  // Laid out like a broadcast call sheet: company header, event details, key contacts, crew by location with
  // call and TX times, additional information and emergency contacts.
  App.pages.callsheet = (id) => {
    const p = App.get(id);
    if (!p) return App.pages.notfound();
    const venue = App.get(p.venue) || {}, org = App.org();
    const person = (cid) => App.get(cid) || {};
    const full = (m) => [m.name, m.surname].filter(Boolean).join(' ');
    const fx = (p.fixtures || []).map((r) => App.get(r.fixture)).filter(Boolean);
    const event = p.event || [...new Set(fx.map((f) => App.title('competition', f.competition)).filter(Boolean))].join(', ') || p.type || '';
    const fixtureLine = fx.map((f) => App.fixtureName(f).replace(/\s*\([^)]*\)$/, '')).join('  ·  ');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? new Date(p.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).replace(/^(\w+) /, '$1, ') : '';
    const line = (label, value, italic) => (value ? h('p', {}, h('b', {}, label + ': '), italic ? h('i', {}, value) : value) : null);
    const contacts = (p.contacts || []).filter((c) => c.title || c.name || c.crewMember).map((c) => { const m = person(c.crewMember); return { title: c.title || 'Contact', name: c.name || full(m), phone: c.phone || m.phone || '' }; });
    // crew grouped by location, in the order locations first appear
    const groups = [];
    for (const r of p.crew || []) { const k = r.location || ''; let g = groups.find((x) => x.k === k); if (!g) { g = { k, rows: [] }; groups.push(g); } g.rows.push(r); }
    const where = { Venue: venue.city || venue.name || '', Gallery: p.remoteStudio ? (p.remoteStudioAddress || '').split(',').slice(-2, -1)[0] || '' : '' };
    const crewRows = groups.flatMap((g) => [
      g.k || groups.length > 1 ? h('tr', { class: 'cs-group' }, h('td', { colspan: '5' }, h('b', {}, g.k || 'Crew'), where[g.k] ? ` (${where[g.k].trim()})` : '')) : null,
      ...g.rows.map((r) => { const m = person(r.crewMember); return h('tr', {}, h('td', {}, h('b', {}, App.title('crewRole', r.role) || '')), h('td', {}, full(m) || 'To be confirmed'), h('td', {}, m.phone || ''), h('td', {}, r.callTime || ''), h('td', {}, r.productionTime || p.txTime || '')); })]);
    const info = String(p.crewNotes || '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^([^:]{2,40}):\s*(.+)$/.exec(x); return m ? h('p', {}, h('b', {}, m[1] + ': '), m[2]) : h('p', {}, x); });
    const eq = {};
    for (const r of p.equipment || []) { const it = App.get(r.item); if (it) (eq[it.category || 'Other'] = eq[it.category || 'Other'] || []).push(`${r.quantity || 1} × ${it.name}${r.notes ? ' (' + r.notes + ')' : ''}`); }
    const company = [org.address, org.phone, org.email, org.website].filter(Boolean).join('  ·  ');
    const sheet = h('div', { class: 'callsheet' },
      h('div', { class: 'cs-box' },
        h('div', { class: 'cs-top' }, h('div', {},
          h('p', {}, h('b', {}, `${String(org.name || 'Production').toUpperCase()} CALL SHEET`)),
          line('Date', date), line('Production', !fx.length || p.name !== `${venue.name} – ${p.date}` ? p.name : ''), line('Event', event), line('Fixture', fixtureLine, true),
          line('Venue', [venue.name, venue.city].filter(Boolean).join(', ')), line('Remote Studio', p.remoteStudio), p.remoteStudioAddress ? h('p', {}, h('i', {}, p.remoteStudioAddress)) : null,
          contacts.map((c) => h('p', {}, h('b', {}, c.title + ': '), [c.name, c.phone].filter(Boolean).join(' ')))),
        App.img(org.image) ? h('img', { class: 'cs-logo', src: App.img(org.image), alt: org.name || '' }) : h('div', { class: 'cs-name' }, org.name || '')),
        h('table', { class: 'cs' }, h('thead', {}, h('tr', {}, ['Role', 'Name', 'Contact', 'Call Time', 'TX Time'].map((x) => h('th', {}, x)))),
          h('tbody', {}, crewRows.length ? crewRows : h('tr', {}, h('td', { colspan: '5' }, 'No crew booked yet.'))))),
      info.length || p.description ? h('div', { class: 'cs-more' }, h('p', {}, h('b', {}, h('u', {}, 'Additional Information'))), p.description ? h('p', {}, p.description) : null, info) : null,
      (p.hospitals || []).some((x) => x.name) ? h('div', { class: 'cs-more' }, h('p', {}, h('b', {}, 'Emergency Contact Details:')), h('p', {}, 'Nearest Hospital'),
        h('table', { class: 'cs-plain' }, h('tbody', {}, p.hospitals.filter((x) => x.name).map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, x.area || ''), h('td', {}, x.phone || '')))))) : null,
      Object.keys(eq).length ? h('div', { class: 'cs-more' }, h('p', {}, h('b', {}, h('u', {}, 'Equipment'))), Object.entries(eq).map(([c, items]) => h('p', {}, h('b', {}, c + ': '), items.join(', ')))) : null,
      (p.rundown || []).length ? h('div', { class: 'cs-more cs-break' }, App.rundownSheet('production', p, p.rundown)) : null,
      company ? h('div', { class: 'cs-foot' }, `${org.name || ''}  ·  ${company}`) : null);
    const el = h('div', {}, h('div', { class: 'no-print' }, pageHead(h('div', {}, h('a', { class: 'small', href: '#/edit/production/' + id }, '← Production'), h('h1', {}, 'Call sheet')), h('button', { class: 'primary', onclick: () => window.print() }, 'Print / save as PDF')),
      contacts.length && (p.crew || []).length ? null : h('p', { class: 'dim' }, 'Fill in Key contacts, Crew (with a location for each), Additional information and Emergency hospitals on the production to complete this sheet. Your company name and logo come from Settings → Production team.')), sheet);
    return { el };
  };

  // ---- fixtures -------------------------------------------------------------------------------
  let fxTab = 'Upcoming';
  App.pages.fixtures = () => {
    const body = h('div', {}), tabs = h('div', { class: 'tabs' });
    const paint = () => {
      const all = App.list('fixture');
      const groups = { Upcoming: all.filter((d) => !['Live', 'Completed'].includes(d.data.status)), Live: all.filter((d) => d.data.status === 'Live'), Results: all.filter((d) => d.data.status === 'Completed'), All: all };
      tabs.replaceChildren(...Object.keys(groups).map((t) => h('button', { class: t === fxTab ? 'on' : '', onclick: () => { fxTab = t; paint(); } }, `${t} (${groups[t].length})`)));
      const desc = fxTab === 'Results';
      const list = groups[fxTab].sort((a, b) => String(a.data.startDate + a.data.startTime).localeCompare(String(b.data.startDate + b.data.startTime)) * (desc ? -1 : 1));
      const days = [...new Set(list.map((d) => d.data.startDate || ''))];
      body.replaceChildren(list.length ? h('div', { class: 'card' }, days.map((day) => [h('div', { class: 'day' }, day ? UI.fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'No date'), list.filter((d) => (d.data.startDate || '') === day).map((d) => fixtureRow(d))]))
        : h('div', { class: 'card empty' }, fxTab === 'Results' ? 'Completed matches show up here.' : fxTab === 'Live' ? 'Nothing is live right now.' : 'No fixtures yet.'));
    };
    paint();
    return { el: h('div', {}, pageHead('Fixtures & Results', App.canEdit('fixture') ? h('a', { class: 'btn primary', href: '#/edit/fixture/new' }, '+ New match') : null), tabs, body), keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc') paint(); }, 200) };
  };

  // ---- images ---------------------------------------------------------------------------------
  App.pages.images = () => {
    const grid = h('div', {});
    const used = (id) => [...App.docs.values()].some((d) => d.type !== 'image' && JSON.stringify(d.data).includes(id));
    const paint = () => {
      const imgs = App.list('image').sort((a, b) => b.updatedAt - a.updatedAt);
      grid.replaceChildren(imgs.length ? h('div', { class: 'gallery' }, imgs.map((d) => h('div', { class: 'g', style: { cursor: 'default' } }, h('img', { src: '/media/' + d.id, alt: d.data.name, loading: 'lazy' }), h('div', { title: d.data.name }, h('b', {}, d.data.name)), h('div', { class: 'dim', title: d.data.file }, d.data.file), h('div', { class: 'dim' }, Math.max(1, Math.round(d.data.size / 1024)) + ' KB'),
        App.canEdit('image') ? h('button', { class: 'sm ghost danger', onclick: async () => { if (await confirmBox(used(d.id) ? 'This image is in use. Delete it anyway?' : 'Delete this image?')) { try { await App.remove('image', d.id); paint(); } catch (e) { oops(e); } } } }, 'Delete') : null)))
        : h('div', { class: 'card empty' }, 'No images yet. Upload logos, player photos and sponsor boards here, or from any record that has an image field.'));
    };
    const file = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', class: 'hide', onchange: async () => {
      let n = 0;
      for (const f of file.files) { try { await App.uploadImage(f); n++; } catch (e) { oops(new Error(f.name + ': ' + e.message)); } }
      file.value = ''; if (n) toast(`${n} image${n === 1 ? '' : 's'} saved`); paint();
    } });
    paint();
    const local = App.cfg.mode === 'local';
    return { el: h('div', {}, pageHead('Images', file, App.canEdit('image') ? h('button', { class: 'primary', onclick: () => file.click() }, 'Upload images') : null),
      h('p', { class: 'dim', style: { marginTop: '-8px' } }, local ? 'Every image is saved as a file in this machine\'s image folder, so CasparCG can load it from disk. Images added on other machines or the website are downloaded here automatically. Change the folder in Settings → This machine.'
        : 'Images uploaded here are downloaded to every linked production PC, into the image folder chosen on that machine.'), grid),
    keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc' && m.doc.type === 'image') paint(); }, 300) };
  };
})();
