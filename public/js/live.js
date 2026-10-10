/* Rundown (edit, print, live running order), advert playout and monitor links. Scoring and graphics control are the
   live screens under /live/ (ported from CricketCG). */
'use strict';
(() => {
  const up = (s) => String(s || '').toUpperCase();
  const longDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const clubName = (squadId) => { const s = App.get(squadId); if (!s) return ''; const r = Schema.resolveSquad(s, App.get(s.club)); return r.graphicName || r.name; };

  // The box at the top of a run order: event, teams, date and venue, start time.
  function rundownHeader(type, d) {
    if (type === 'fixture') {
      const v = App.get(d.venue) || {};
      return { event: App.title('competition', d.competition) || d.sport || '', teams: d.team1 && d.team2 ? `${up(clubName(d.team1))}  vs  ${up(clubName(d.team2))}` : up(App.fixtureName(d)),
        where: [up(longDate(d.startDate)), up([v.name, v.city].filter(Boolean).join(', '))].filter(Boolean).join(', '), start: d.startTime ? `KICK OFF - ${d.startTime}` : '' };
    }
    const v = App.get(d.venue) || {}, fx = (d.fixtures || []).map((r) => App.get(r.fixture)).filter(Boolean);
    const one = fx.length === 1 ? fx[0] : null;
    return { event: d.event || (one ? App.title('competition', one.competition) : '') || d.type || '', teams: one && one.team1 && one.team2 ? `${up(clubName(one.team1))}  vs  ${up(clubName(one.team2))}` : up(d.name),
      where: [up(longDate(d.date)), up([v.name, v.city].filter(Boolean).join(', '))].filter(Boolean).join(', '), start: d.txTime || (one && one.startTime) ? `${one ? 'KICK OFF' : 'TX'} - ${d.txTime || one.startTime}` : '' };
  }
  App.rundownHeader = rundownHeader;

  // A run order laid out like the printed sheet: header box, blue column heads, coloured lines.
  function rundownSheet(type, d, rows, opts = {}) {
    const hd = rundownHeader(type, d), timed = Schema.rundownTimes(rows, type === 'fixture' ? d.startTime : '');
    const short = (t) => t.replace(/^(\d{2}:\d{2}:\d{2}).*$/, '$1');
    return h('div', { class: 'runorder' },
      h('div', { class: 'ro-head' }, h('b', {}, 'RUNORDER'), hd.event ? h('div', {}, hd.event) : null, h('b', {}, hd.teams), hd.where ? h('div', {}, hd.where) : null, hd.start ? h('b', {}, hd.start) : null),
      h('table', { class: 'ro' },
        h('thead', {}, h('tr', {}, ['Item', 'Time', 'Content', 'Source', 'Sound', 'Graphics', 'Duration'].map((x, i) => h('th', { class: i === 1 ? 'thin' : '' }, x)))),
        h('tbody', {}, timed.map((r, i) => h('tr', { class: (i === opts.at ? 'ro-now ' : i < opts.at ? 'ro-done ' : '') + (opts.onCue ? 'click' : ''), style: r.color ? { background: r.color } : {}, onclick: opts.onCue ? () => opts.onCue(i) : null, title: opts.onCue ? 'Click to jump to this item' : '' },
          h('td', { class: 'c' }, i + 1), h('td', { class: 'c' }, short(r.startText)),
          h('td', {}, h('b', {}, up(r.content)), r.description ? h('div', {}, up(r.description)) : null),
          h('td', { class: 'c pre' }, up(r.source)), h('td', { class: 'c pre' }, up(r.audio)), h('td', { class: 'c pre' + (r.graphics ? ' b' : '') }, up(r.graphics)),
          h('td', { class: 'c' }, r.duration ? Schema.fmtDuration(Schema.parseDuration(r.duration)) : ''))))));
  }

  // ---- rundown --------------------------------------------------------------------------------
  App.pages.rundown = (type, id) => {
    const doc0 = App.docs.get(id);
    if (!doc0 || !['fixture', 'production'].includes(type)) return App.pages.notfound();
    const can = App.canEdit(type);
    const field = Schema.ENTITIES[type].fields.find((x) => x.k === 'rundown');
    const d = () => (App.docs.get(id) || doc0).data;
    let rows = (d().rundown || []).map((r) => ({ ...r })), dirty = false, editing = !rows.length && can;
    const el = h('div', {});
    const save = async (patch) => { try { await App.save(type, id, { ...d(), rundown: rows, ...(patch || {}) }); dirty = false; } catch (e) { oops(e); } };
    const cue = (i) => save({ rundownLive: i === null ? null : { index: i, startedAt: App.now() } });
    const monitor = () => `/live/rundown.html?${type}=${encodeURIComponent(id)}${App.machine.outputKey ? '&key=' + App.machine.outputKey : ''}`;

    function paint() {
      const data = d(), live = data.rundownLive || null;
      const total = rows.reduce((s, r) => s + Schema.parseDuration(r.duration), 0);
      const title = type === 'fixture' ? App.fixtureName(data) : data.name;
      const head = pageHead(h('div', { class: 'no-print' }, h('a', { class: 'small', href: `#/edit/${type}/${id}` }, '← ' + (type === 'fixture' ? 'Match' : 'Production')), h('h1', {}, 'Rundown · ' + title), h('div', { class: 'dim small' }, `${rows.length} items · total ${Schema.fmtDuration(total)}`)),
        h('a', { class: 'btn no-print', href: monitor(), target: '_blank', rel: 'noopener', title: 'Full-screen rundown monitor for the production gallery' }, 'Monitor ↗'),
        h('button', { class: 'no-print', onclick: () => window.print() }, 'Print'),
        can ? h('button', { class: 'no-print', onclick: () => { if (editing && dirty) save().then(paint); editing = !editing; paint(); } }, editing ? 'Done editing' : 'Edit') : null,
        can && editing ? h('button', { class: 'primary no-print', onclick: () => save().then(() => { toast('Rundown saved'); paint(); }) }, 'Save') : null);
      if (editing) {
        const lf = fieldInput(field, rows, (v) => { rows = v; dirty = true; }, {});
        el.replaceChildren(head, h('div', { class: 'card' }, h('p', { class: 'dim small', style: { marginTop: 0 } }, 'Leave Time empty and each item follows the one before it; type a time (15:55:00) to pin an item to the clock. Durations are mm:ss or hh:mm:ss. Content prints in bold with the detail line under it. Pick a line colour for kick-offs, breaks and off air.'), lf));
        return;
      }
      const at = live ? live.index : -1;
      const bar = can && rows.length ? h('div', { class: 'card no-print', style: { marginBottom: '14px' } }, h('div', { class: 'spread' },
        h('div', {}, h('h3', {}, 'Running order'), at >= 0 && rows[at] ? h('div', {}, h('b', {}, `${at + 1}. ${rows[at].content}`), ' ', h('span', { id: 'rd-timer', class: 'pill' }, '')) : h('span', { class: 'dim' }, 'Not started')),
        h('div', { class: 'row' }, h('button', { disabled: at <= 0, onclick: () => cue(at - 1) }, '← Previous'), h('button', { class: 'primary', disabled: at >= rows.length - 1 && at >= 0, onclick: () => cue(at + 1) }, at < 0 ? 'Start rundown' : 'Next →'), at >= 0 ? h('button', { class: 'ghost', onclick: () => cue(null) }, 'Reset') : null))) : null;
      el.replaceChildren(head, bar, rows.length ? rundownSheet(type, data, rows, { at, onCue: can ? cue : null }) : h('div', { class: 'card empty' }, 'No rundown yet.', can ? ' Press Edit to build one.' : ''));
      tick();
    }
    function tick() {
      const t = document.getElementById('rd-timer'), live = d().rundownLive;
      if (!t || !live || !rows[live.index]) return;
      const dur = Schema.parseDuration(rows[live.index].duration), gone = Math.max(0, (App.now() - live.startedAt) / 1000), left = dur - gone;
      t.textContent = dur ? (left >= 0 ? Schema.fmtDuration(left) + ' left' : Schema.fmtDuration(-left) + ' over') : Schema.fmtDuration(gone);
      t.className = 'pill ' + (dur && left < 0 ? 'live' : dur && left < 15 ? 'warn' : 'ok');
    }
    paint();
    const iv = setInterval(tick, 500);
    return { el, keepScroll: true, destroy: () => clearInterval(iv), onMessage: (m) => { if (m.type === 'doc' && m.doc.id === id && !editing) { rows = (m.doc.data.rundown || []).map((r) => ({ ...r })); paint(); } } };
  };

  // ---- advert playout -------------------------------------------------------------------------
  App.pages.adverts = () => {
    if (!App.gfx) {
      return { el: h('div', {}, pageHead('Advert playout'), h('div', { class: 'card' }, h('h2', {}, 'Adverts play out from the production PC'),
        h('p', {}, 'CasparCG is driven by RFP Manager running on the machine next to it. Open RFP Manager on that PC and use Advert playout there.'),
        h('p', { class: 'dim' }, 'Adverts and playlists you set up here reach that PC within a moment.'))) };
    }
    const can = App.can('score'), el = h('div', {});
    const run = (p) => p.then((r) => { if (r && r.onAir) App.gfx.state = r; paint(); }).catch(oops);
    function paint() {
      const s = App.gfx.state || { onAir: [], playlist: null, caspar: {} }, c = s.caspar || {};
      const ads = App.sorted('advert'), lists = App.sorted('playlist');
      el.replaceChildren(pageHead('Advert playout', h('a', { class: 'btn', href: '#/list/advert' }, 'Manage adverts')),
        h('div', { class: 'two' },
          h('div', { class: 'card' }, h('h2', {}, 'Adverts'), ads.length ? h('div', { class: 'pad' }, ads.map((d) => h('button', { disabled: !can, title: `${d.data.layout || 'Full screen'} · ${d.data.duration || 10}s`, onclick: () => run(App.gfxDo('advert', { advertId: d.id })) },
            App.img(d.data.image) ? h('img', { src: App.img(d.data.image), alt: '', style: { height: '44px', maxWidth: '100%', objectFit: 'contain' } }) : null, d.data.name, h('small', {}, `${d.data.kind === 'CasparCG clip' ? 'clip' : d.data.layout || 'Full screen'} · ${d.data.duration || 10}s`))))
            : h('p', { class: 'dim' }, 'No adverts yet. ', h('a', { href: '#/edit/advert/new' }, 'Add a sponsor board or clip'), '.'),
          h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'An advert plays for its own duration and then clears. Every play is logged for proof of play.')),
          h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Playlists'), s.playlist ? h('span', { class: 'pill live' }, `Playing: ${s.playlist.name} (${s.playlist.index + 1})`) : null),
            lists.length ? h('div', { class: 'row' }, lists.map((d) => h('button', { disabled: !can, onclick: () => run(App.gfxDo('playlist', { playlistId: d.id })) }, `▶ ${d.data.name}${d.data.loop ? ' (loop)' : ''}`)), s.playlist ? h('button', { class: 'danger', onclick: () => run(App.gfxDo('playlistStop')) }, 'Stop playlist') : null)
              : h('p', { class: 'dim' }, 'No playlists yet. ', h('a', { href: '#/edit/playlist/new' }, 'Build one for half time or a break'), '.'),
            h('h3', { style: { marginTop: '18px' } }, 'On air'),
            s.onAir.length ? s.onAir.map((e) => h('div', { class: 'fx' }, h('span', { class: 'pill live' }, e.key), h('span', { class: 'grow' }, h('b', {}, e.name), e.clip ? h('span', { class: 'dim small' }, ' ' + e.clip) : null), can ? h('button', { class: 'sm', onclick: () => run(App.gfxDo('out', { key: e.key })) }, 'OUT') : null)) : h('div', { class: 'dim' }, 'Nothing on air.'),
            h('div', { class: 'row', style: { marginTop: '14px' } }, h('span', { class: 'led ' + (!c.enabled ? '' : c.connected ? 'ok' : 'bad') }), h('span', { class: 'dim small' }, !c.enabled ? 'CasparCG switched off (browser output only)' : c.connected ? `CasparCG connected · ${c.endpoint}` : `CasparCG not connected · ${c.endpoint}`)))));
    }
    paint();
    return { el, keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'gfx-state' || (m.type === 'doc' && ['advert', 'playlist'].includes(m.doc.type))) paint(); }, 150) };
  };

  // ---- monitors -------------------------------------------------------------------------------
  App.pages.monitors = () => {
    if (!App.gfx && !App.machine.outputKey) {
      return { el: h('div', {}, pageHead('Monitors'), h('div', { class: 'card' }, h('h2', {}, 'Monitors are served by the production PC'),
        h('p', {}, 'The commentary confidence monitor, rundown monitor and program output are opened from the production PC\'s address over Tailscale. Open RFP Manager on that PC and go to Monitors for the links.'),
        h('p', { class: 'dim' }, 'From here you can still open a commentary screen for one match: Fixtures → open a match → Commentary screen.'))) };
    }
    const m = App.machine, local = /^(localhost|127\.)/.test(location.hostname);
    // Short links belong to this PC: http://pc-name/scorer. Opened as localhost, show them with the PC's own name instead.
    const base = local && m.hostname && !(m.remote && App.cfg.mode === 'cloud') ? `http://${m.hostname.toLowerCase()}${Number(m.port) === 80 ? '' : ':' + m.port}` : location.origin;
    // on the website, screens of the production PC in use: the open ones carry the PC and its screen key
    const remote = m.remote && App.cfg.mode === 'cloud';
    const link = (title, text, path, signIn) => { const url = base + path + (remote && !signIn ? `?pc=${encodeURIComponent(m.remote.id)}&key=${encodeURIComponent(m.outputKey)}` : ''); return h('tr', {}, h('td', {}, h('b', {}, title), h('div', { class: 'dim small' }, text)),
      h('td', { style: { width: '42%' } }, h('input', { readonly: true, value: url, onfocus: (e) => e.target.select(), 'aria-label': title + ' link' })),
      h('td', { class: 'nowrap' }, signIn ? h('span', { class: 'pill' }, 'sign-in') : h('span', { class: 'pill ok' }, 'open')),
      h('td', { class: 'right nowrap' }, h('button', { class: 'sm', onclick: () => { navigator.clipboard.writeText(url).then(() => toast('Link copied')).catch(() => {}); } }, 'Copy'), ' ', h('a', { class: 'btn sm', href: remote ? url : path, target: '_blank', rel: 'noopener' }, 'Open ↗'))); };
    const on = App.get(m.onAirFixture);
    return { el: h('div', {}, pageHead('Monitors & screen links'),
      remote ? h('p', { class: 'pill ok', style: { whiteSpace: 'normal' } }, `These links reach the production PC "${m.remote.name}" through this website, from anywhere. The PC must be running and linked.`) : null,
      h('div', { class: 'card' }, h('div', { class: 'spread' }, h('div', {}, h('h3', {}, remote ? 'Live production on ' + m.remote.name : 'Live production on this PC'), h('b', {}, on ? App.fixtureName(on) : 'No match on air yet')), h('a', { class: 'btn', href: '#/fixtures' }, 'Choose in Fixtures')),
        h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'One link per screen. Each follows whatever is live on this PC, so the links never change from match to match. Screens marked "open" are view-only and need no sign-in',
          m.shortLinks ? '' : ' (switched off on this machine: they ask for a sign-in)', '; the scorer and the control screens ask people to sign in.'),
        local && !remote ? h('p', { class: 'pill warn', style: { marginTop: '10px', whiteSpace: 'normal' } }, `Other devices reach this PC by its name (${m.hostname || 'pc-name'}) or its Tailscale address, not "localhost". The links below already use the PC name.`) : null,
        Number(m.port) !== 80 && !remote ? h('p', { class: 'dim small', style: { margin: '8px 0 0' } }, `To drop the ":${m.port}" from the links, set "port": 80 in config.json and restart RFP Manager (nothing else on the PC may be using port 80).`) : null),
      h('div', { class: 'card' }, h('h2', {}, 'Sport'), h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {},
        App.cfg.mode !== 'local' ? null : link('Scorer', 'The right scorer for the match on air, with teams, squads and rules from the match.', '/scorer', true),
        link('Graphics control', 'Take, update and clear graphics.', '/graphics-control', true),
        link('Confidence monitor', 'Commentary box: score, clock, players, cards, stats and talking points.', '/confidence'),
        link('Rundown', 'Running order with the item on air, time left and what is next.', '/rundown'),
        link('Output', 'Program output in a browser (OBS / vMix browser source, 1920×1080).', '/output'),
        link('Preview', 'Preview channel with tally and safe areas.', '/preview'),
        link('Fill + key', 'Program output with its key signal side by side (3840×1080) for a Raspberry Pi with two HDMI outputs: left = fill, right = key. See tools/pi-output.sh.', '/fill-key'),
        link('Key', 'Key signal only: white where the graphics are, black elsewhere.', '/key'),
        link('Fill', 'Program output over black, to go with the key.', '/fill'))))),
      h('div', { class: 'card' }, h('h2', {}, 'Timeline'), h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {},
        link('Timeline', 'Edit and run a show timeline: tracks, cues, holds and GO.', '/timeline', true),
        link('Dashboards', 'Your own control panels (Live → Dashboards), on a PC, tablet or phone.', '/dash', true),
        link('Timeline crew view', 'Now and next for the tracks each person follows, with countdowns. Follows the timeline that is running.', '/crew'))))),
      h('div', { class: 'card' }, h('h2', {}, 'Worship'), h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {},
        link('Worship control', 'Songs, scripture, slides, names and stage tools.', '/worship', true),
        link('Stage display', 'Current and next slide, clock, timer and messages for the platform.', '/stage')))))) };
  };

  // Old addresses still work.
  App.pages.control = () => { location.href = '/live/control.html'; return { el: h('div', { class: 'card' }, 'Opening graphics control…') }; };
  App.pages.score = (id) => { const f = App.get(id); if (f) location.href = App.scorerUrl(id, f); return { el: h('div', { class: 'card' }, f ? 'Opening the scorer…' : 'Match not found.') }; };
  // ---- play log: what was on air, when, for how long, who took it (screen, person, address) and in which production;
  // filters, CSV export and a printed report
  App.pages.playlog = () => {
    const day = (n) => { const d = new Date(Date.now() + n * 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    const f = { from: day(-6), to: day(0), what: 'all', q: '', names: new Set(), prod: '', by: '', match: '' };
    const body = h('div', {});
    const dur = (s) => { s = Math.round(Number(s) || 0); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const time = (t) => (t ? new Date(t).toLocaleTimeString('en-GB') : '');
    const byText = (r) => [r.via, r.by].filter(Boolean).join(' · ');
    const all = () => {
      const out = [];
      for (const d of App.list('adlog')) if ((!f.from || d.data.date >= f.from) && (!f.to || d.data.date <= f.to)) for (const e of d.data.entries || []) out.push({ kind: 'Advert', date: d.data.date, at: e.at, ended: e.ended || (e.at + (Number(e.seconds) || 0) * 1000), seconds: Number(e.seconds) || 0, planned: e.planned, name: e.name, who: e.sponsor || '', where: e.channel ? `${e.channel}-${e.layer}` : '', how: e.how || '', match: e.match || '', production: e.production || '', playlist: e.playlist || '', machine: e.machine || d.data.machine || '', by: e.by || '', ip: e.ip || '', via: e.via || '', offBy: '', open: false });
      for (const d of App.list('playlog')) if ((!f.from || d.data.date >= f.from) && (!f.to || d.data.date <= f.to)) for (const e of d.data.entries || []) out.push({ kind: 'Graphic', date: d.data.date, at: e.at, ended: e.ended || 0, seconds: e.ended ? Number(e.seconds) || 0 : (Date.now() - e.at) / 1000, name: e.name, who: e.text || '', where: `${e.channel}-${e.layer}`, how: e.how || '', match: e.match || '', production: e.production || '', playlist: '', machine: e.machine || '', by: e.by || '', ip: e.ip || '', via: e.via || '', offBy: e.offBy || '', offIp: e.offIp || '', open: !e.ended });
      return out.sort((a, b) => b.at - a.at);
    };
    const filter = (list) => {
      const q = f.q.toLowerCase();
      return list.filter((r) => (f.what === 'all' || (f.what === 'ads') === (r.kind === 'Advert')) && (!f.names.size || f.names.has(r.name)) && (!f.prod || r.production === f.prod) && (!f.match || r.match === f.match) && (!f.by || byText(r) === f.by || r.ip === f.by)
        && (!q || [r.name, r.who, r.match, r.playlist, r.production, r.by, r.ip, r.via].join(' ').toLowerCase().includes(q)));
    };
    const csv = (list) => {
      const head = ['Date', 'On air', 'Off air', 'Seconds', 'Kind', 'What', 'Sponsor / text', 'Channel-layer', 'How', 'Taken by', 'Address', 'Taken off by', 'Match', 'Production', 'Playlist', 'Machine'];
      const cell = (x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`;
      const text = [head, ...list.map((r) => [r.date, time(r.at), r.open ? 'on air' : time(r.ended), Math.round(r.seconds), r.kind, r.name, r.who, r.where, r.how, byText(r), r.ip, r.offBy, r.match, r.production, r.playlist, r.machine])].map((r) => r.map(cell).join(',')).join('\r\n');
      const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })), download: `play-log-${f.from}-to-${f.to}.csv` }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    // a printed report of what the filters show: header, totals per item, then every play
    const report = (list) => {
      const org = App.org() || {}, esc2 = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const tot = {}; for (const r of list) { const k = r.kind + '|' + r.name + '|' + (r.kind === 'Advert' ? r.who : ''); const x = (tot[k] = tot[k] || { kind: r.kind, name: r.name, who: r.kind === 'Advert' ? r.who : '', plays: 0, secs: 0 }); x.plays++; x.secs += r.seconds; }
      const filters = [f.what !== 'all' ? (f.what === 'ads' ? 'Adverts only' : 'Graphics only') : '', f.names.size ? 'What: ' + [...f.names].join(', ') : '', f.prod ? 'Production: ' + f.prod : '', f.match ? 'Match: ' + f.match : '', f.by ? 'By: ' + f.by : '', f.q ? 'Search: ' + f.q : ''].filter(Boolean);
      const logo = org.image && App.img(org.image) ? `<img src="${esc2(App.img(org.image))}" style="height:54px;float:right">` : '';
      const w = window.open('', '_blank');
      if (!w) { toast('Allow pop-ups for this page to print the report', 'error'); return; }
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Play log ${esc2(f.from)} to ${esc2(f.to)}</title><style>
        body{font:12px/1.35 'Segoe UI',Arial,sans-serif;color:#111;margin:24px} h1{font-size:20px;margin:0 0 4px} .meta{color:#555;margin-bottom:14px}
        table{width:100%;border-collapse:collapse;margin:8px 0 18px} th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top} th{background:#eee;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
        td.r,th.r{text-align:right} h2{font-size:14px;margin:18px 0 4px} @media print{body{margin:10mm}}</style></head><body>
        ${logo}<h1>${esc2(org.name || 'RFP Manager')} – play log</h1>
        <div class="meta">${esc2(f.from)} to ${esc2(f.to)} · ${list.length} item${list.length === 1 ? '' : 's'} · ${dur(list.reduce((s, r) => s + r.seconds, 0))} on air${filters.length ? '<br>' + esc2(filters.join(' · ')) : ''}<br>Printed ${esc2(new Date().toLocaleString('en-GB'))}</div>
        <h2>Totals</h2><table><tr><th>Kind</th><th>What</th><th>Sponsor</th><th class="r">Plays</th><th class="r">Air time</th></tr>
        ${Object.values(tot).sort((a, b) => b.secs - a.secs).map((x) => `<tr><td>${x.kind}</td><td>${esc2(x.name)}</td><td>${esc2(x.who)}</td><td class="r">${x.plays}</td><td class="r">${dur(x.secs)}</td></tr>`).join('')}</table>
        <h2>Every play</h2><table><tr><th>Date</th><th>On</th><th>Off</th><th class="r">Time</th><th>What</th><th>Sponsor / text</th><th>Taken by</th><th>Production / match</th></tr>
        ${list.slice().reverse().map((r) => `<tr><td>${esc2(r.date)}</td><td>${time(r.at)}</td><td>${r.open ? 'on air' : time(r.ended)}</td><td class="r">${dur(r.seconds)}</td><td><b>${esc2(r.name)}</b><br><small>${r.kind}${r.where ? ' · ' + esc2(r.where) : ''}</small></td><td>${esc2(r.who)}</td><td>${esc2(byText(r))}${r.ip ? '<br><small>' + esc2(r.ip) + '</small>' : ''}</td><td>${esc2(r.production)}${r.production && r.match ? '<br>' : ''}<small>${esc2(r.match)}</small></td></tr>`).join('')}</table>
        <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
      w.document.close();
    };
    const sel = (key, label, opts) => h('select', { style: { width: 'auto', maxWidth: '220px' }, onchange: (e) => { f[key] = e.target.value; paint(); } }, [h('option', { value: '' }, label), ...opts.map((o) => h('option', { value: o, selected: f[key] === o }, o))]);
    const paint = () => {
      const base = all(), list = filter(base), ads = list.filter((r) => r.kind === 'Advert');
      const uniq = (fn) => [...new Set(base.map(fn).filter(Boolean))].sort();
      const names = {}; for (const r of base.filter((x) => f.what === 'all' || (f.what === 'ads') === (x.kind === 'Advert'))) names[r.name] = (names[r.name] || 0) + 1;
      const by = {}; for (const r of ads) { const k = r.name + '|' + r.who; const x = (by[k] = by[k] || { name: r.name, who: r.who, plays: 0, secs: 0 }); x.plays++; x.secs += r.seconds; }
      const sponsors = {}; for (const r of ads) { const x = (sponsors[r.who || '–'] = sponsors[r.who || '–'] || { plays: 0, secs: 0 }); x.plays++; x.secs += r.seconds; }
      body.replaceChildren(
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Filter'), h('div', { class: 'row' },
          sel('prod', 'Every production', uniq((r) => r.production)), sel('match', 'Every match', uniq((r) => r.match)), sel('by', 'Anyone, any screen', [...uniq(byText), ...uniq((r) => r.ip)]),
          h('button', { onclick: () => { f.names.clear(); f.prod = ''; f.by = ''; f.match = ''; paint(); } }, 'Clear filters'))),
          h('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } }, h('span', { class: 'dim small' }, 'Only these:'), Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([n, c]) => h('button', { class: 'sm' + (f.names.has(n) ? ' primary' : ''), onclick: () => { if (f.names.has(n)) f.names.delete(n); else f.names.add(n); paint(); } }, `${n} (${c})`)),
            !Object.keys(names).length ? h('span', { class: 'dim small' }, 'nothing in this period') : null)),
        ads.length ? h('div', { class: 'card' }, h('h2', {}, 'Adverts'), h('div', { class: 'cards' }, Object.entries(sponsors).map(([k, x]) => h('div', { class: 'tile' }, h('b', {}, dur(x.secs)), h('span', {}, `${k} · ${x.plays} play${x.plays === 1 ? '' : 's'}`)))),
          h('div', { class: 'tablewrap', style: { marginTop: '10px' } }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Advert'), h('th', {}, 'Sponsor'), h('th', { class: 'r' }, 'Plays'), h('th', { class: 'r' }, 'Air time'))),
            h('tbody', {}, Object.values(by).sort((a, b) => b.secs - a.secs).map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, x.who), h('td', { class: 'r num' }, x.plays), h('td', { class: 'r num' }, dur(x.secs)))))))) : null,
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, `On air (${list.length}${list.length !== base.length ? ' of ' + base.length : ''})`), h('div', { class: 'row' }, h('button', { onclick: () => report(list), disabled: !list.length }, 'Print report'), h('button', { onclick: () => csv(list), disabled: !list.length }, 'Export CSV'))),
          list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Date', 'On', 'Off', 'Air time', '', 'What', 'Sponsor / text', 'Ch-layer', 'Taken by', 'Production / match'].map((x) => h('th', {}, x)))),
            h('tbody', {}, list.slice(0, 1500).map((r) => h('tr', {}, h('td', { class: 'dim' }, r.date), h('td', { class: 'num' }, time(r.at)), h('td', { class: 'num', title: r.offBy ? 'Taken off by ' + r.offBy + (r.offIp ? ' · ' + r.offIp : '') : '' }, r.open ? h('span', { class: 'pill ok' }, 'on air') : time(r.ended)), h('td', { class: 'num' }, dur(r.seconds)),
              h('td', {}, h('span', { class: 'pill' + (r.kind === 'Advert' ? ' warn' : '') }, r.kind)), h('td', {}, h('b', {}, r.name), r.how && r.how !== 'take' ? h('div', { class: 'dim small' }, r.how) : null), h('td', { class: 'dim' }, r.who), h('td', { class: 'num dim' }, r.where),
              h('td', {}, byText(r) || h('span', { class: 'dim' }, '–'), r.ip ? h('div', { class: 'dim small mono' }, r.ip) : null),
              h('td', { class: 'dim' }, r.production ? h('div', {}, r.production) : null, h('div', { class: 'small' }, [r.match, r.playlist].filter(Boolean).join(' · '))))))))
            : h('p', { class: 'dim' }, 'Nothing matches. Graphics are logged from version 0.11 on, who took them from 0.13; adverts since they were first played.'),
          list.length > 1500 ? h('p', { class: 'help' }, `Showing the latest 1500 of ${list.length}. The CSV and the report have all of them.`) : null));
    };
    const ctl = h('div', { class: 'row' },
      h('input', { type: 'date', value: f.from, style: { width: 'auto' }, onchange: (e) => { f.from = e.target.value; paint(); } }), h('span', { class: 'dim' }, 'to'),
      h('input', { type: 'date', value: f.to, style: { width: 'auto' }, onchange: (e) => { f.to = e.target.value; paint(); } }),
      h('select', { style: { width: 'auto' }, onchange: (e) => { f.what = e.target.value; f.names.clear(); paint(); } }, [['all', 'Graphics and adverts'], ['ads', 'Adverts only'], ['gfx', 'Graphics only']].map(([v, l]) => h('option', { value: v }, l))),
      h('input', { type: 'search', placeholder: 'Search…', style: { width: '180px' }, oninput: UI.debounce((e) => { f.q = e.target.value; paint(); }, 200) }));
    paint();
    return { el: h('div', {}, pageHead('Play log', ctl), body), keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc' && ['adlog', 'playlog'].includes(m.doc.type)) paint(); }, 800) };
  };
  App.rundownSheet = rundownSheet;
})();
