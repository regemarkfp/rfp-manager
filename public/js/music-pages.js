/* Music: playout of theme music and the library on the production PC (CasparCG), the production report and music cue
 * sheets after a production, and rights holders' reports. Tracks themselves are edited in Media & music → Music library. */
'use strict';
(() => {
  const dur = (s) => { s = Math.round(Number(s) || 0); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };
  const day = (n) => { const d = new Date(Date.now() + n * 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const money = (n) => 'R ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const enc = encodeURIComponent;

  // ---- Music playout ------------------------------------------------------------------------------------------------
  App.pages.music = () => {
    if (!App.gfx) {
      return { el: h('div', {}, pageHead('Music playout', h('a', { class: 'btn', href: '#/list/track' }, 'Music library')), h('div', { class: 'card' }, h('h2', {}, 'Music plays out from the production PC'),
        h('p', {}, 'Theme music and library tracks play through CasparCG, driven by RFP Manager on the machine next to it. Open Music playout there (or choose that PC at the top).'),
        h('p', { class: 'dim' }, 'Every play is logged for the music cue sheet, and so are tracks that play in vMix and the music under stream slates.'))),
        onMessage: (m) => { if (m.type === 'gfx-state' && App.gfx) route(); } };   // the PC's state arrives just after the page opens
    }
    const can = App.can('score'), el = h('div', {});
    let theme = [], themeFor = null, q = '';
    const run = (p) => p.then((r) => { if (r && r.onAir) App.gfx.state = r; paint(); }).catch(oops);
    const play = (id, usage, force) => run(App.gfxDo('music', { trackId: id, usage, force }));
    async function loadTheme(fid) {
      themeFor = fid;
      if (!fid) { theme = []; return paint(); }
      try { theme = (await api('GET', `/api/music/theme?team=${App.team}&fixture=${enc(fid)}`)).tracks || []; } catch { theme = []; }
      paint();
    }
    const btn = (t, usage) => {
      const ok = t.cleared === 'Cleared' && !(t.validUntil && day(0) > t.validUntil) && !(t.validFrom && day(0) < t.validFrom);
      return h('button', { disabled: !can || !t.casparClip, title: !t.casparClip ? 'No CasparCG clip set on this track' : ok ? `${t.composers || ''}` : 'Not cleared: ask before playing',
        class: ok ? '' : 'warn', onclick: async () => {
          if (!ok && !(await confirmBox(`"${t.title}" is not cleared (${t.cleared || 'Pending'}${t.validUntil && day(0) > t.validUntil ? ', licence ended' : ''}). Play it anyway? It will show on the cue sheet.`, 'Play anyway'))) return;
          play(t.id, usage, !ok);
        } },
      h('b', {}, t.title), h('small', {}, [usage || t.usage, t.duration].filter(Boolean).join(' · ')), ok ? null : h('small', { style: { color: '#ff6b6b' } }, 'not cleared'), t.casparClip ? null : h('small', { class: 'dim' }, 'no clip'));
    };
    function paint() {
      const s = App.gfx.state || {}, m = s.music, fid = s.fixtureId || '';
      if (fid !== themeFor) { loadTheme(fid); }
      const lib = App.sorted('track').map((d) => ({ id: d.id, ...d.data })).filter((t) => !q || [t.title, t.artist, t.composers, t.library].some((x) => String(x || '').toLowerCase().includes(q)));
      const fx = fid ? App.get(fid) : null;
      el.replaceChildren(pageHead('Music playout', h('a', { class: 'btn', href: '#/list/track' }, 'Music library')),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Now playing'),
          m ? h('div', { class: 'row' }, h('button', { class: 'danger', disabled: !can, onclick: () => run(App.gfxDo('musicStop', { fade: 25 })) }, 'Fade out'), h('button', { disabled: !can, onclick: () => run(App.gfxDo('musicStop', {})) }, 'Stop')) : null),
          m ? h('p', {}, h('span', { class: 'pill live' }, m.usage || 'Music'), ' ', h('b', {}, m.title), h('span', { class: 'dim small' }, ` since ${new Date(m.since).toLocaleTimeString('en-GB')}${m.loop ? ' · looping' : ''}`)) : h('p', { class: 'dim' }, 'Nothing playing.')),
        h('div', { class: 'card' }, h('h2', {}, fx ? `Theme music: ${App.fixtureName(fx)}` : 'Theme music'),
          !fid ? h('p', { class: 'dim' }, 'Put a match on air (Fixtures) to get its competition\'s and production\'s theme music here.')
            : theme.length ? h('div', { class: 'pad' }, theme.map((t) => btn(t, t.usage)))
              : h('p', { class: 'dim' }, 'No theme music for this match. Add it on the competition (Theme music) or on the production (Music & report).')),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Library'), h('input', { type: 'search', placeholder: 'Search title, composer, library…', value: q, style: { maxWidth: '280px' }, oninput: UI.debounce((e) => { q = e.target.value.trim().toLowerCase(); paint(); }, 200) })),
          lib.length ? h('div', { class: 'pad' }, lib.slice(0, 120).map((t) => btn(t))) : h('p', { class: 'dim' }, 'No tracks yet. ', h('a', { href: '#/edit/track/new' }, 'Add one to the library'), '.'),
          h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Tracks play on CasparCG layer 60 of the program channel. Every play is logged for the music cue sheet; tracks that are not cleared ask first.')));
    }
    paint();
    return { el, keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'gfx-state' || (m.type === 'doc' && ['track', 'competition', 'production'].includes(m.doc.type))) { if (m.type === 'doc') themeFor = null; paint(); } }, 150) };
  };

  // ---- the production report and the music cue sheet -----------------------------------------------------------------
  const base = (id) => `/api/productions/${enc(id)}`;
  const cueLinks = (id) => h('div', { class: 'row no-print' },
    h('a', { class: 'btn sm', href: `${base(id)}/cuesheet.pdf?team=${App.team}&layout=samro`, target: '_blank', rel: 'noopener' }, 'SAMRO cue sheet (PDF)'),
    h('a', { class: 'btn sm', href: `${base(id)}/cuesheet.csv?team=${App.team}&layout=samro` }, 'SAMRO (CSV)'),
    h('a', { class: 'btn sm', href: `${base(id)}/cuesheet.pdf?team=${App.team}&layout=broadcaster`, target: '_blank', rel: 'noopener' }, 'Broadcaster cue sheet (PDF)'),
    h('a', { class: 'btn sm', href: `${base(id)}/cuesheet.csv?team=${App.team}&layout=broadcaster` }, 'Broadcaster (CSV)'));

  App.pages.report = (id) => {
    const p = App.get(id);
    if (!p) return App.pages.notfound();
    const body = h('div', {}, h('div', { class: 'card dim' }, 'Loading…'));
    const el = h('div', {}, pageHead(`Report: ${p.number ? p.number + ' · ' : ''}${p.name}`, h('a', { class: 'btn', href: '#/edit/production/' + id }, 'Production'),
      App.canEdit('production') ? h('a', { class: 'btn' + (p.status === 'Completed' ? '' : ' primary'), href: '#/complete/' + id }, p.status === 'Completed' ? 'Edit report' : 'Complete production') : null, h('a', { class: 'btn', href: `${base(id)}/report.pdf?team=${App.team}`, target: '_blank', rel: 'noopener' }, 'PDF'), h('button', { onclick: () => window.print() }, 'Print')), body);
    const tbl = (head, rows) => h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows)));
    Promise.all([api('GET', `${base(id)}/report?team=${App.team}`), api('GET', `${base(id)}/cuesheet?team=${App.team}`)]).then(([r, cs]) => {
      const det = [['Production no.', r.number], ['Programme', r.programme !== r.name ? r.programme : ''], ['Date', r.date + (r.days > 1 ? ` (${r.days} days)` : '')], ['Client', r.client], ['Broadcaster', r.broadcaster], ['Producer', r.producer], ['Venue', r.venue], ['TX', r.txTime]].filter((x) => x[1]);
      body.replaceChildren(
        h('div', { class: 'card' }, det.map(([k, v]) => h('p', { style: { margin: '2px 0' } }, h('b', {}, k + ': '), v)),
          r.status === 'Completed' ? h('p', { style: { margin: '6px 0' } }, h('span', { class: 'pill ok' }, 'Completed'), r.completedAt ? h('span', { class: 'dim small' }, ` ${new Date(r.completedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${r.completedBy ? ' by ' + r.completedBy : ''}`) : null) : null,
          r.summary ? h('p', { style: { whiteSpace: 'pre-wrap' } }, r.summary) : h('p', { class: 'dim no-print' }, r.status === 'Completed' ? 'No summary written.' : 'Complete the production to write its report.')),
        r.ratings.length ? h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Quality rating'), h('div', { style: { fontSize: '26px', fontWeight: 800 } }, `${r.average}`, h('span', { class: 'dim', style: { fontSize: '15px', fontWeight: 400 } }, ' / 5'))),
          tbl(['Aspect', 'Rating', 'Note'], r.ratings.map((x) => h('tr', {}, h('td', {}, x.label), h('td', { class: 'nowrap', style: { color: '#f5b301', letterSpacing: '2px' } }, '★'.repeat(x.stars), h('span', { style: { color: 'var(--line, #444)' } }, '★'.repeat(5 - x.stars))), h('td', {}, x.note))))) : null,
        r.matches.length ? h('div', { class: 'card' }, h('h2', {}, 'Matches'), tbl(['Match', 'Competition', 'Score', 'Result'], r.matches.map((m) => h('tr', {}, h('td', {}, h('b', {}, m.name), h('div', { class: 'dim small' }, [m.date, m.time].filter(Boolean).join(' '))), h('td', {}, m.competition), h('td', {}, m.score), h('td', {}, m.result || m.status)))),
          r.matches.filter((m) => m.commentators.length || m.officials.length).map((m) => h('p', { class: 'small' }, h('b', {}, m.name + ': '), [m.commentators.length ? 'Commentators: ' + m.commentators.join(', ') : '', m.officials.length ? 'Officials: ' + m.officials.join(', ') : ''].filter(Boolean).join(' · ')))) : null,
        r.crew.length ? h('div', { class: 'card' }, h('h2', {}, 'Crew'), tbl(['Role', 'Name', 'Location', 'Confirmed', 'Paid'], r.crew.map((c) => h('tr', {}, h('td', {}, c.role), h('td', {}, c.name), h('td', {}, c.location), h('td', {}, c.confirmed ? '✓' : ''), h('td', {}, c.paid ? '✓' : ''))))) : null,
        r.costs && r.costs.lines.length && App.can('edit') ? h('div', { class: 'card' }, h('h2', {}, 'Costs'), tbl(['Item', 'Group', 'Cost', 'Invoice'], [...r.costs.lines.map((l) => h('tr', {}, h('td', {}, l.label), h('td', {}, l.group), h('td', { class: 'right' }, money(l.cost)), h('td', { class: 'right' }, money(l.invoice)))),
          h('tr', {}, h('td', {}, h('b', {}, 'Total')), h('td'), h('td', { class: 'right' }, h('b', {}, money(r.costs.cost))), h('td', { class: 'right' }, h('b', {}, money(r.costs.invoice))))]),
          h('p', {}, h('b', {}, `Profit ${money(r.costs.profit)} (${r.costs.margin}% margin)`))) : null,
        h('div', { class: 'card' }, h('h2', {}, 'What went to air'),
          r.graphics.length ? tbl(['Graphic', 'Plays', 'On air'], r.graphics.map((g) => h('tr', {}, h('td', {}, g.name), h('td', { class: 'right' }, String(g.plays)), h('td', { class: 'right' }, dur(g.seconds))))) : h('p', { class: 'dim' }, 'No graphics logged for this production.'),
          r.adverts.length ? tbl(['Advert', 'Plays', 'On air'], r.adverts.map((g) => h('tr', {}, h('td', {}, g.sponsor ? `${g.name} (${g.sponsor})` : g.name), h('td', { class: 'right' }, String(g.plays)), h('td', { class: 'right' }, dur(g.seconds))))) : null),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, `Music cue sheet (${cs.rows.length} cue${cs.rows.length === 1 ? '' : 's'}, ${dur(cs.totalSeconds)})`), cueLinks(id)),
          r.music.uncleared.length ? h('p', { class: 'pill bad', style: { whiteSpace: 'normal' } }, 'Not cleared: ' + r.music.uncleared.join(', ')) : null,
          cs.rows.length ? tbl(['#', 'In', 'Title', 'Composer(s) / publisher', 'Use', 'From', 'Dur.'], cs.rows.map((x) => h('tr', {}, h('td', {}, String(x.n)), h('td', { class: 'mono' }, x.timeIn || x.clock), h('td', {}, h('b', {}, x.title), x.artist ? h('div', { class: 'dim small' }, x.artist) : null),
            h('td', {}, x.composers, x.publisher ? h('div', { class: 'dim small' }, x.publisher) : null), h('td', {}, x.usage), h('td', {}, x.source), h('td', { class: 'right' }, x.duration))))
            : h('p', { class: 'dim' }, 'No music logged. Plays from Music playout (CasparCG), vMix inputs named like a track and stream slate music are logged by themselves; add anything else on the production under "Music used (added by hand)".')),
        r.stream ? h('div', { class: 'card' }, h('h2', {}, 'Live stream'), r.stream.viewers === null ? h('p', { class: 'dim' }, 'Viewer numbers are on the website.')
          : h('p', {}, h('b', {}, 'Viewers: '), String(r.stream.viewers), '   ', h('b', {}, 'Peak: '), String(r.stream.peak), '   ', h('b', {}, 'Watched: '), dur(r.stream.seconds)),
        r.stream.videos.length ? tbl(['Recording', 'Viewers', 'Watched'], r.stream.videos.map((v) => h('tr', {}, h('td', {}, v.title || v.key), h('td', { class: 'right' }, String(v.viewers)), h('td', { class: 'right' }, dur(v.seconds))))) : null) : null,
        h('div', { class: 'card' }, h('h2', {}, `Issues${r.incidents.length ? ` (${r.incidents.length}${r.openIssues ? `, ${r.openIssues} open` : ''})` : ''}`), r.incidents.length ? tbl(['Time', 'Kind', 'Severity', 'What happened', 'Action', 'Resolved'], r.incidents.map((x) => h('tr', {}, h('td', {}, x.time), h('td', {}, x.category), h('td', {}, h('span', { class: 'pill ' + (({ Critical: 'bad', Major: 'bad', Moderate: 'warn' })[x.severity] || '') }, x.severity)), h('td', {}, x.text), h('td', {}, x.action), h('td', {}, x.resolved ? '✓' : h('span', { class: 'pill warn' }, 'open'))))) : h('p', { class: 'dim' }, 'No issues reported.')));
    }).catch((e) => body.replaceChildren(h('div', { class: 'card' }, 'Could not load the report: ' + e.message)));
    return { el };
  };

  // ---- completing a production: the report form (ratings 1–5 per aspect with a note, issues, summary), then the report
  App.pages.complete = (id) => {
    const doc = App.docs.get(id);
    if (!doc) return App.pages.notfound();
    if (!App.canEdit('production')) return { el: h('div', {}, pageHead('Complete production'), h('div', { class: 'card empty' }, 'Producers and Admins complete productions.')) };
    const p = doc.data, done = p.status === 'Completed';
    const ratings = { ...(p.ratings || {}) }, notes = { ...(p.ratingNotes || {}) };
    const issues = (p.incidents || []).map((x) => ({ ...x }));
    let summary = p.reportNotes || '';
    const box = h('div', {});
    const starRow = (k, label) => {
      const stars = h('span', { class: 'stars', role: 'radiogroup', 'aria-label': label });
      const paintStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: 'star' + (n <= (ratings[k] || 0) ? ' on' : ''), role: 'radio', 'aria-checked': String(n === ratings[k]), title: `${n} of 5`,
        onclick: () => { ratings[k] = ratings[k] === n ? 0 : n; paintStars(); paintAvg(); } }, '★')));
      paintStars();
      return h('tr', {}, h('td', { style: { width: '30%' } }, h('b', {}, label)), h('td', { class: 'nowrap' }, stars),
        h('td', {}, h('input', { value: notes[k] || '', placeholder: 'What went well / what to improve', oninput: (e) => { notes[k] = e.target.value; } })));
    };
    const avgEl = h('span', {});
    const paintAvg = () => { const v = Schema.REPORT_ASPECTS.map(([k]) => ratings[k]).filter((x) => x > 0); avgEl.textContent = v.length ? `Average ${Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10} / 5` : 'Tap the stars to rate'; };
    paintAvg();
    const issuesBox = h('div', {});
    const field = (x, k, attrs) => h('input', { value: x[k] || '', oninput: (e) => { x[k] = e.target.value; }, ...attrs });
    const paintIssues = () => issuesBox.replaceChildren(
      issues.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Time', 'Kind', 'Severity', 'What happened', 'What was done / to do', 'Resolved', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, issues.map((x, i) => h('tr', {},
          h('td', { style: { width: '96px' } }, field(x, 'time', { type: 'time' })),
          h('td', { style: { width: '130px' } }, h('select', { onchange: (e) => { x.category = e.target.value; } }, ['Technical', 'Delay', 'Graphics', 'Audio', 'Vision', 'Stream', 'Crew', 'Equipment', 'Client', 'Weather', 'Other'].map((o) => h('option', { selected: (x.category || 'Technical') === o }, o)))),
          h('td', { style: { width: '120px' } }, h('select', { onchange: (e) => { x.severity = e.target.value; } }, Schema.ISSUE_SEVERITY.map((o) => h('option', { selected: (x.severity || 'Minor') === o }, o)))),
          h('td', {}, field(x, 'text', { placeholder: 'What went wrong' })), h('td', {}, field(x, 'action', { placeholder: 'Fixed on the day / follow up' })),
          h('td', { style: { textAlign: 'center' } }, h('input', { type: 'checkbox', checked: !!x.resolved, onchange: (e) => { x.resolved = e.target.checked; } })),
          h('td', {}, h('button', { class: 'sm ghost danger', title: 'Remove', onclick: () => { issues.splice(i, 1); paintIssues(); } }, '✕'))))))) : h('p', { class: 'dim' }, 'No issues. Add one for anything that went wrong (faults, delays, complaints), even if it was fixed on the day.'),
      h('button', { class: 'sm', onclick: () => { issues.push({ category: 'Technical', severity: 'Minor', text: '', action: '', resolved: false }); paintIssues(); } }, '+ Add an issue'));
    paintIssues();
    const save = async (complete) => {
      const rated = Schema.REPORT_ASPECTS.filter(([k]) => ratings[k] > 0).length;
      if (complete && !ratings.overall) { toast('Give an overall rating first', 'error'); return; }
      const cur = App.docs.get(id).data;
      const me = App.me && (App.me.name || App.me.email) || '';
      const data = { ...cur, ratings, ratingNotes: notes, incidents: issues.filter((x) => String(x.text || '').trim()), reportNotes: summary };
      if (complete) Object.assign(data, { status: 'Completed', completedAt: cur.completedAt || new Date().toISOString(), completedBy: cur.completedBy || me });
      try { await App.save('production', id, data); toast(complete ? `Production completed (${rated} rating${rated === 1 ? '' : 's'})` : 'Report saved'); location.hash = '#/report/' + id; } catch (e) { oops(e); }
    };
    box.replaceChildren(
      h('div', { class: 'card' }, h('p', { style: { marginTop: 0 } }, h('b', {}, p.name), h('span', { class: 'dim' }, ` · ${[p.number, p.date].filter(Boolean).join(' · ')}`)),
        h('p', { class: 'dim', style: { margin: 0 } }, done ? 'This production is completed. Change the report here.' : 'Rate how it went, list anything that went wrong and write a short summary. Completing it marks the production as Completed and opens its report: matches, crew and costs, what went to air, music cue sheet, stream and issues.')),
      h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Quality'), h('span', { class: 'dim' }, avgEl)),
        h('div', { class: 'tablewrap' }, h('table', { class: 't rate' }, h('tbody', {}, Schema.REPORT_ASPECTS.map(([k, l]) => starRow(k, l))))),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'Leave an aspect empty if it did not apply (for example no stream). Tap a star again to clear it.')),
      h('div', { class: 'card' }, h('h2', {}, 'Issues'), issuesBox),
      h('div', { class: 'card' }, h('h2', {}, 'Summary'), h('textarea', { rows: 5, placeholder: 'How did it go? Highlights, lessons, follow-ups for next time.', oninput: (e) => { summary = e.target.value; } }, summary)),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } }, h('a', { class: 'btn', href: '#/edit/production/' + id }, 'Cancel'), h('button', { onclick: () => save(false) }, 'Save draft'),
        h('button', { class: 'primary', onclick: () => save(true) }, done ? 'Save report' : 'Complete production')));
    return { el: h('div', {}, pageHead(done ? 'Production report' : 'Complete production'), box) };
  };

  // ---- rights holders' reports --------------------------------------------------------------------------------------
  App.pages.musicrights = () => {
    if (!App.can('edit')) return { el: h('div', {}, pageHead('Music use report'), h('div', { class: 'card empty' }, 'Producers and Admins make music use reports.')) };
    const f = { who: '', from: day(-30), to: day(0) };
    const out = h('div', {});
    const qs = () => `team=${App.team}&who=${enc(f.who)}&from=${f.from}&to=${f.to}`;
    async function load() {
      out.replaceChildren(h('div', { class: 'card dim' }, 'Loading…'));
      let rows = [];
      try { rows = (await api('GET', `/api/music/rights-report?${qs()}`)).rows || []; } catch (e) { return out.replaceChildren(h('div', { class: 'card' }, e.message)); }
      const secs = rows.reduce((n, r) => n + (Number(r.seconds) || 0), 0);
      out.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, `${rows.length} use${rows.length === 1 ? '' : 's'} · ${dur(secs)}`), h('a', { class: 'btn sm', href: `/api/music/rights-report.csv?${qs()}` }, 'Download CSV')),
        rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Date', 'Production / match', 'Title', 'Composer(s) / publisher', 'Library', 'Use', 'From', 'Dur.'].map((x) => h('th', {}, x)))),
          h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { class: 'nowrap' }, r.date, r.at ? h('div', { class: 'dim small' }, new Date(r.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) : null), h('td', {}, r.productionName || '', r.match ? h('div', { class: 'dim small' }, r.match) : null),
            h('td', {}, h('b', {}, r.title), r.artist ? h('div', { class: 'dim small' }, r.artist) : null), h('td', {}, r.composers, r.publisher ? h('div', { class: 'dim small' }, r.publisher) : null), h('td', {}, r.library || ''), h('td', {}, r.usage), h('td', {}, r.source), h('td', { class: 'right' }, r.duration))))))
          : h('p', { class: 'dim' }, 'No music used in this period' + (f.who ? ` for "${f.who}"` : '') + '.')));
    }
    const input = (k, type, ph) => h('label', {}, h('span', { class: 'dim small' }, ph), h('input', { type, value: f[k], placeholder: type === 'search' ? 'Composer, publisher, library…' : '', onchange: (e) => { f[k] = e.target.value.trim(); load(); } }));
    load();
    return { el: h('div', {}, pageHead('Music use report'),
      h('div', { class: 'card' }, h('p', { class: 'dim', style: { marginTop: 0 } }, 'Every use of music over a period, for a rights holder (a composer, publisher or production music library) or for your own records. Per-production cue sheets for SAMRO and broadcasters are on each production\'s report.'),
        h('div', { class: 'row' }, input('who', 'search', 'Rights holder'), input('from', 'date', 'From'), input('to', 'date', 'To'))), out) };
  };
})();
