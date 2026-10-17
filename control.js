/* CricketCG – Graphics control surface */
(function () {
  'use strict';
  const { $, $$, esc, h } = CG;

  let page = CG.store.get('ctlPage', 'main');
  let sel = null;            // { id, params, overrides }
  let data = null;           // last computed data for the selection
  let dataSeq = 0;
  let viewInnings = null;    // innings shown on Batting/Bowling tabs
  let viewTeam = 'A';
  let frame = null, frameTemplate = null, frameReady = false, framePlayed = false;

  const def = id => CG.catalog.find(g => g.id === id);
  let fixtureList = null, fixtureAt = 0;
  CG.on('rfpFixtures', list => { const first = !fixtureList; fixtureList = list; if (first && page === 'production') renderCenter(); });
  const st = () => CG.state;

  // ================================================================ navigation (depends on the live event: cricket or another sport)
  const NAV = {
    cricket: [['main', 'Main / Bug'], ['match', 'Match'], ['batting', 'Batting'], ['bowling', 'Bowling'], ['teams', 'Teams'], ['officials', 'Officials'], ['custom', 'Captions / Custom'], ['wipes', 'Wipes'], ['production', 'Production']],
    sport: [['smain', 'Main / Bug'], ['sscores', 'Scores & Stats'], ['steams', 'Teams & Players'], ['sofficials', 'Officials'], ['sath', 'Athletics'], ['custom', 'Captions / Custom'], ['wipes', 'Wipes'], ['production', 'Production']],
  };
  let navMode = null;
  const mode = () => (CG.isSportMode() ? 'sport' : 'cricket');
  function renderSide() {
    const m = mode();
    const items = NAV[m].filter(([p]) => p !== 'sath' || (CG.sportView() && CG.sportView().kind === 'athletics'));
    const key = m + items.length;
    if (navMode !== key) {
      navMode = key;
      $('#side').innerHTML = items.map(([p, l]) => `<button class="tab" data-page="${p}">${l}</button>`).join('') +
        '<hr><button class="tab" data-page="log">AMCP Log</button><button class="tab" data-page="settings">Settings</button>';
      $$('#side .tab').forEach(t => t.onclick = () => { page = t.dataset.page; CG.store.set('ctlPage', page); renderCenter(); });
    }
    if (!items.some(([p]) => p === page) && page !== 'log' && page !== 'settings') page = items[0][0];
    $$('#side .tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  }
  setInterval(() => {
    $$('[data-sclock]').forEach(el => { el.textContent = CG.fmtClock(CG.clockMs(el.dataset.sclock), el.dataset.sclock === 'shot' ? 10 : 0); });
  }, 200);

  CG.on('catalog', () => renderCenter());
  CG.on('state', () => {
    renderHeader();
    renderCenter(true);
    renderOnAir();
    markButtons();
    if (sel) requestData();
  });
  CG.on('log', e => { if (page === 'log') appendLog(e); });
  CG.on('logReset', () => { if (page === 'log') renderCenter(); });

  function renderHeader() {
    if (CG.isSportMode()) {
      const v = CG.sportView();
      $('#matchline').innerHTML = v ? `${esc(v.name.toUpperCase())} · ${esc(v.flat.match_line)}<span class="sub">${esc(v.periodLabel)} · ${esc(v.status)}</span>` : 'No sport event set up – open the Sports scorer';
      return;
    }
    const s = st(), m = s.match, c = CG.currentInnings();
    const score = c ? ` — ${c.battingTeamShort || c.battingTeamName} ${c.score} (${c.overs})` : '';
    $('#matchline').innerHTML = `${esc(m.teamA.name)} v ${esc(m.teamB.name)}${esc(score)}<span class="sub">${esc(s.stats.statusText)}</span>`;
  }

  // ================================================================ graphic buttons
  function gbtn(id, opts) {
    opts = opts || {};
    const d = def(id);
    if (!d) return '';
    const params = opts.params || {};
    const kind = { bug: 'BUG', lt: 'LT', fs: 'FS', wipe: 'WIPE' }[d.kind] || '';
    return `<button class="gbtn" data-g="${id}" data-params='${esc(JSON.stringify(params))}' title="${esc(d.description || d.template)}">
      <span class="kind">${kind}${d.replacedBy ? ' · THEME' : ''}</span><span class="nm">${esc(opts.label || d.name)}</span>${opts.sub ? `<span class="ds">${esc(opts.sub)}</span>` : ''}</button>`;
  }
  function groupButtons(group, params) {
    const list = CG.catalog.filter(g => g.group === group && !g.hidden);
    const twice = n => list.filter(g => g.name === n).length > 1;      // same name from two sub-folders: say which is which
    return `<div class="gbtns">${list.map(g => gbtn(g.id, { params: params && paramsFor(g, params), sub: g.user && g.folder && twice(g.name) ? g.folder : '' })).join('')}</div>`;
  }
  function paramsFor(g, p) {
    const out = {};
    if (['innings', 'batter', 'bowler'].includes(g.param) && p.innings != null) out.innings = p.innings;
    if (g.param === 'team' && p.team) out.team = p.team;
    return out;
  }

  function wireButtons(root) {
    $$('[data-g]', root).forEach(b => {
      b.onclick = () => select(b.dataset.g, JSON.parse(b.dataset.params || '{}'));
      b.ondblclick = async () => { select(b.dataset.g, JSON.parse(b.dataset.params || '{}')); take(); };
    });
    markButtons();
  }

  function markButtons() {
    const onAir = st() ? st().gfx.onAir : [];
    $$('[data-g]').forEach(b => {
      const id = b.dataset.g;
      b.classList.toggle('pgm', onAir.some(e => e.graphicId === id && !e.preview));
      b.classList.toggle('pvw', onAir.some(e => e.graphicId === id && e.preview));
      b.classList.toggle('sel', !!sel && sel.id === id && JSON.stringify(sel.params) === b.dataset.params);
    });
  }

  // ================================================================ center pages
  function renderCenter(fromState) {
    if (!st() || !CG.catalog.length) return;
    renderSide();
    const center = $('#center');
    // Avoid wiping inputs the operator is typing in
    if (fromState && center.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) return;
    const fn = pages[page] || pages.main;
    const scroll = center.scrollTop;
    center.innerHTML = '';
    center.appendChild(fn());
    wireButtons(center);
    center.scrollTop = scroll;
  }

  function inningsPicker(onPick) {
    const s = st().stats;
    if (viewInnings == null || viewInnings >= s.innings.length) viewInnings = s.currentIndex;
    const wrap = h(`<div class="row" style="margin-bottom:10px"><span class="muted">Innings:</span></div>`);
    if (!s.innings.length) wrap.appendChild(h('<span class="muted">none yet</span>'));
    s.innings.forEach(i => {
      const b = h(`<button class="btn sm ${i.index === viewInnings ? 'on' : ''}">${i.number}. ${esc(i.battingTeamName)} ${i.score} (${i.overs})</button>`);
      b.onclick = () => { viewInnings = i.index; onPick ? onPick() : renderCenter(); };
      wrap.appendChild(b);
    });
    return wrap;
  }

  const pages = {
    main() {
      const s = st(), c = CG.currentInnings(), m = s.match, stats = s.stats;
      const bugOn = s.gfx.onAir.some(e => e.graphicId === 'scorebug' && !e.preview);
      const el = h(`<div>
        <div class="panel">
          <h4>Score bug <span class="sp"></span>${bugOn ? '<span class="badge live">ON AIR</span>' : ''}</h4>
          <div class="row">
            <button class="btn lg danger" data-bug="show">TAKE BUG</button>
            <button class="btn lg primary" data-bug="update">UPDATE</button>
            <button class="btn lg" data-bug="hide">OUT</button>
            <span class="grow"></span>
            <label class="chk"><input type="checkbox" id="auto-wipes" ${s.gfx.autoWipes ? 'checked' : ''}> Auto FOUR / SIX / WICKET wipes</label>
          </div>
          <p class="small muted" style="margin:8px 0 0">The bug updates itself on every ball. Click it below to select it for preview / field edits.</p>
          <div class="gbtns" style="margin-top:8px">${gbtn('scorebug')}</div>
        </div>
        <div class="grid cols-2" style="margin-top:12px">
          <div class="panel">
            <h4>Bug strip / ticker line <span class="sp"></span><button class="btn sm" data-strip-clear>Clear</button></h4>
            <div class="strip-list" id="strips"></div>
            <div class="row" style="margin-top:8px"><input type="text" id="strip-custom" class="grow" placeholder="Type custom strip text and press Enter"><button class="btn" id="strip-go">Set</button></div>
          </div>
          <div class="panel">
            <h4>Quick graphics</h4>
            <div class="gbtns">${['batters_lt', 'batter_lt', 'bowler_lt', 'partnership_lt', 'status_lt', 'over_summary', 'batter_out', 'toss', 'dls_par_lt', 'dls_target_lt'].map(id => gbtn(id)).join('')}</div>
          </div>
        </div>
      </div>`);
      // strip messages built from live match data
      const o = m.officials;
      const strips = [
        ['MATCH SITUATION', stats.statusText],
        ['DLS PAR', stats.dls && stats.dls.par != null && m.dls.enabled && stats.currentIndex === 1 ? stats.dls.parText : ''],
        ['DLS TARGET', stats.dls && stats.dls.applied ? stats.dls.targetText : ''],
        ['TOSS', stats.tossText],
        ['VENUE', [m.venue, m.city].filter(Boolean).length ? `LIVE FROM ${[m.venue, m.city].filter(Boolean).join(', ')}`.toUpperCase() : ''],
        ['MATCH', `${m.teamA.name} V ${m.teamB.name}`.toUpperCase()],
        ['TOURNAMENT', (m.tournament + (m.matchNumber ? ` · MATCH ${m.matchNumber}` : '')).toUpperCase()],
        ['UMPIRES', o.umpire1 || o.umpire2 ? `UMPIRES: ${o.umpire1} & ${o.umpire2}`.toUpperCase() : ''],
        ['PARTNERSHIP', c && c.partnerships.length && c.partnerships[c.partnerships.length - 1].current ? `PARTNERSHIP ${c.partnerships[c.partnerships.length - 1].runs} (${c.partnerships[c.partnerships.length - 1].balls})` : ''],
        ['RUN RATE', c ? (c.target != null ? `REQUIRED RATE ${c.requiredRate}  ·  CURRENT RATE ${c.runRate}` : `RUN RATE ${c.runRate}${c.projectedScore ? '  ·  PROJECTED ' + c.projectedScore : ''}`) : ''],
        ['LAST WICKET', c && c.fow.length ? (() => { const f = c.fow[c.fow.length - 1]; return `LAST WICKET: ${f.name} ${f.playerRuns}  ·  ${f.wicket}-${f.score} (${f.over})`; })() : ''],
        ['COMMENTATORS', (m.commentators || []).length ? `COMMENTARY: ${m.commentators.join(' & ')}`.toUpperCase() : ''],
      ].filter(x => x[1]);
      const list = $('#strips', el);
      strips.forEach(([label, text]) => {
        const it = h(`<div class="strip-item ${s.gfx.strip === text ? 'on' : ''}"><small>${esc(label)}</small>${esc(text)}</div>`);
        it.onclick = () => CG.gfx('strip', { text: s.gfx.strip === text ? '' : text });
        list.appendChild(it);
      });
      if (s.gfx.strip && !strips.some(x => x[1] === s.gfx.strip))
        list.prepend(h(`<div class="strip-item on"><small>CUSTOM</small>${esc(s.gfx.strip)}</div>`));
      $('[data-strip-clear]', el).onclick = () => CG.gfx('strip', { text: '' });
      const setCustom = () => { const v = $('#strip-custom', el).value.trim(); if (v) CG.gfx('strip', { text: v }); $('#strip-custom', el).value = ''; };
      $('#strip-go', el).onclick = setCustom;
      $('#strip-custom', el).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setCustom(); } };
      $$('[data-bug]', el).forEach(b => b.onclick = () => CG.gfx(b.dataset.bug, { id: 'scorebug' }));
      $('#auto-wipes', el).onchange = e => CG.gfx('autoWipes', { enabled: e.target.checked });
      return el;
    },

    match() {
      const el = h(`<div><div class="panel"><h4>Match graphics</h4></div></div>`);
      const p = el.firstElementChild;
      p.appendChild(inningsPicker());
      p.appendChild(h(groupButtons('Match', { innings: viewInnings })));
      p.appendChild(h(`<p class="small muted">Manhattan uses the innings selected above. Worm always shows both innings.</p>`));
      return el;
    },

    batting() {
      const s = st(), el = h(`<div></div>`);
      el.appendChild(inningsPicker());
      const inn = s.stats.innings[viewInnings];
      el.appendChild(h(`<div class="panel"><h4>Batting graphics</h4>${groupButtons('Batting', { innings: viewInnings })}</div>`));
      const tbl = h(`<div class="panel"><h4>${inn ? esc(inn.battingTeamName) + ' – click a batter for a lower third' : 'No innings'}</h4><table class="t"></table></div>`);
      if (inn) {
        const t = $('table', tbl);
        t.innerHTML = `<tr><th>Batter</th><th></th><th class="n">R</th><th class="n">B</th><th class="n">4s</th><th class="n">6s</th><th class="n">SR</th><th></th></tr>`;
        inn.batting.concat(inn.yetToBat).forEach(b => {
          const tr = h(`<table><tr class="click ${b.status === 'batting' ? 'hl' : ''} ${b.status === 'out' ? 'out' : ''}">
            <td>${b.onStrike ? '▶ ' : ''}<b>${esc(b.tvName)}</b></td><td class="how">${esc(b.status === 'dnb' ? 'yet to bat' : b.howOut)}</td>
            <td class="n"><b>${b.status === 'dnb' ? '' : b.runs}</b></td><td class="n">${b.status === 'dnb' ? '' : b.balls}</td><td class="n">${b.status === 'dnb' ? '' : b.fours}</td><td class="n">${b.status === 'dnb' ? '' : b.sixes}</td><td class="n">${b.status === 'dnb' ? '' : b.strikeRate}</td>
            <td class="n"><button class="btn sm" data-pl="${b.playerId}">Name LT</button></td></tr></table>`).querySelector('tr');
          tr.onclick = e => {
            if (e.target.closest('[data-pl]')) select('player_lt', { playerId: b.playerId });
            else select('batter_lt', { playerId: b.playerId, innings: viewInnings });
          };
          tr.ondblclick = () => take();
          if (sel && sel.id === 'batter_lt' && sel.params.playerId === b.playerId) tr.classList.add('sel');
          t.appendChild(tr);
        });
      }
      el.appendChild(tbl);
      return el;
    },

    bowling() {
      const s = st(), el = h(`<div></div>`);
      el.appendChild(inningsPicker());
      const inn = s.stats.innings[viewInnings];
      el.appendChild(h(`<div class="panel"><h4>Bowling graphics</h4>${groupButtons('Bowling', { innings: viewInnings })}</div>`));
      const tbl = h(`<div class="panel"><h4>${inn ? esc(inn.bowlingTeamName) + ' – click a bowler for a lower third' : 'No innings'}</h4><table class="t"></table></div>`);
      if (inn) {
        const t = $('table', tbl);
        t.innerHTML = `<tr><th>Bowler</th><th class="n">O</th><th class="n">M</th><th class="n">R</th><th class="n">W</th><th class="n">Econ</th><th class="n">Dots</th></tr>`;
        const bowled = new Set(inn.bowling.map(b => b.playerId));
        const rows = inn.bowling.concat(CG.team(inn.bowlingTeam).players.filter(p => !bowled.has(p.id)).map(p => ({ playerId: p.id, tvName: p.tvName || p.name, none: true })));
        rows.forEach(b => {
          const tr = h(`<table><tr class="click ${b.current ? 'hl' : ''}"><td>${b.current ? '▶ ' : ''}<b>${esc(b.tvName)}</b></td>
            ${b.none ? '<td colspan="6" class="how">has not bowled</td>' : `<td class="n">${b.overs}</td><td class="n">${b.maidens}</td><td class="n">${b.runs}</td><td class="n"><b>${b.wickets}</b></td><td class="n">${b.economy}</td><td class="n">${b.dots}</td>`}</tr></table>`).querySelector('tr');
          tr.onclick = () => select('bowler_lt', { playerId: b.playerId, innings: viewInnings });
          tr.ondblclick = () => take();
          if (sel && sel.id === 'bowler_lt' && sel.params.playerId === b.playerId) tr.classList.add('sel');
          t.appendChild(tr);
        });
      }
      el.appendChild(tbl);
      return el;
    },

    teams() {
      const m = st().match, el = h(`<div></div>`);
      const pick = h(`<div class="row" style="margin-bottom:10px"><span class="muted">Team:</span>
        <button class="btn sm ${viewTeam === 'A' ? 'on' : ''}" data-t="A">${esc(m.teamA.name)}</button>
        <button class="btn sm ${viewTeam === 'B' ? 'on' : ''}" data-t="B">${esc(m.teamB.name)}</button></div>`);
      $$('[data-t]', pick).forEach(b => b.onclick = () => { viewTeam = b.dataset.t; renderCenter(); });
      el.appendChild(pick);
      el.appendChild(h(`<div class="panel"><h4>Team graphics</h4>${groupButtons('Teams', { team: viewTeam })}</div>`));
      const t = CG.team(viewTeam);
      const list = h(`<div class="panel"><h4>Squad – click a player for a name lower third</h4><table class="t"><tr><th>#</th><th>Name</th><th>TV name</th><th>Role</th></tr></table></div>`);
      const tbl = $('table', list);
      t.players.forEach((p, i) => {
        const tr = h(`<table><tr class="click"><td class="muted">${i + 1}</td><td><b>${esc(p.name)}</b>${p.captain ? ' (c)' : ''}${p.keeper ? ' †' : ''}</td><td>${esc(p.tvName)}</td><td class="muted">${esc(p.role)}</td></tr></table>`).querySelector('tr');
        tr.onclick = () => select('player_lt', { playerId: p.id });
        tr.ondblclick = () => take();
        if (sel && sel.id === 'player_lt' && sel.params.playerId === p.id) tr.classList.add('sel');
        tbl.appendChild(tr);
      });
      if (!t.players.length) tbl.appendChild(h('<table><tr><td colspan="4" class="muted">No players. Add the squad in the Stats surface → Teams.</td></tr></table>').querySelector('tr'));
      el.appendChild(list);
      return el;
    },

    sofficials() {
      const su = (st().sport && st().sport.setup) || {}, offs = Sports.officialsOf(su), t = su.teams || { A: {}, B: {} };
      return h(`<div><div class="panel"><h4>Officials & commentators</h4>${groupButtons('Sport Officials')}</div>
        <div class="panel"><h4>Names (edit in the scorer → Setup, or on the match in RFP Manager)</h4>
          <table class="t">
            ${offs.map(o => `<tr><td class="muted">${esc(o.role)}</td><td>${esc(o.name) || '<span class="muted">–</span>'}</td></tr>`).join('')}
            <tr><td class="muted">Commentators</td><td>${esc((su.commentators || []).join(', ')) || '<span class="muted">–</span>'}</td></tr>
            <tr><td class="muted">Coaches</td><td>${esc(t.A.coach || '')} (${esc(t.A.short || '')}) · ${esc(t.B.coach || '')} (${esc(t.B.short || '')})</td></tr>
          </table></div></div>`);
    },

    officials() {
      const m = st().match, o = m.officials;
      return h(`<div><div class="panel"><h4>Officials & commentators</h4>${groupButtons('Officials')}</div>
        <div class="panel"><h4>Names (edit in Stats → Match Setup)</h4>
          <table class="t">
            <tr><td class="muted">Umpires</td><td>${esc(o.umpire1)} &amp; ${esc(o.umpire2)}</td></tr>
            <tr><td class="muted">TV umpire</td><td>${esc(o.tvUmpire)}</td></tr>
            <tr><td class="muted">4th umpire</td><td>${esc(o.fourthUmpire)}</td></tr>
            <tr><td class="muted">Referee</td><td>${esc(o.referee)}</td></tr>
            <tr><td class="muted">Commentators</td><td>${esc((m.commentators || []).join(', '))}</td></tr>
            <tr><td class="muted">Coaches</td><td>${esc(m.teamA.coach)} (${esc(m.teamA.shortName)}) · ${esc(m.teamB.coach)} (${esc(m.teamB.shortName)})</td></tr>
          </table></div></div>`);
    },

    custom() {
      const s = st();
      const el = h(`<div class="grid cols-2">
        <div class="panel"><h4>Caption presets <span class="sp"></span><span class="small muted">click = load into Custom LT</span></h4>
          <div class="row" style="margin-bottom:8px"><input type="text" id="cap-search" class="grow" placeholder="Search…"></div>
          <div class="captions" id="caps"></div>
          <hr>
          <div class="stack">
            <input type="text" id="cap-l1" placeholder="Line 1">
            <input type="text" id="cap-l2" placeholder="Line 2 (optional)">
            <div class="row"><button class="btn" id="cap-add">Add preset</button></div>
          </div>
        </div>
        <div><div class="panel"><h4>Custom graphics</h4>${groupButtons('Custom')}
          <p class="small muted">Select a custom graphic, then type in the Data panel on the right (orange fields), then TAKE.</p></div>
        ${(() => {
          const ps = ((st() && st().presets) || []).filter(p => def(p.graphic));
          return ps.length ? `<div class="panel" style="margin-top:12px"><h4>Presets</h4><div class="gbtns">${ps.map(p => `<button class="gbtn" data-preset="${esc(p.id)}" title="${esc(def(p.graphic).name)}"><span class="kind">PRESET</span><span class="nm">${esc(p.name)}</span><span class="ds">${esc(def(p.graphic).name)}</span></button>`).join('')}</div>
            <p class="small muted">A preset is a graphic with its values already filled in. Make one with "Save as preset" above the Data fields.</p></div>` : '';
        })()}
        ${(() => {
          const groups = [...new Set(CG.catalog.filter(g => g.user && !g.hidden).map(g => g.group))].sort((a, b) => (CG.catalog.some(g => g.group === b && g.activeTheme) - CG.catalog.some(g => g.group === a && g.activeTheme)) || (a === 'My templates') - (b === 'My templates') || a.localeCompare(b));
          if (!groups.length) return `<div class="panel" style="margin-top:12px"><h4>My templates <span class="sp"></span><a class="btn sm" href="/#/templates">Manage templates ↗</a></h4><p class="small muted">Templates and themes loaded from your template folder appear here. Load them in RFP Manager → Templates.</p></div>`;
          return groups.map((g, i) => `<div class="panel" style="margin-top:12px"><h4>${esc(g)} ${CG.catalog.some(x => x.group === g && x.activeTheme) ? '<span class="badge live">THIS COMPETITION</span>' : ''}<span class="sp"></span>${i === 0 ? '<a class="btn sm" href="/#/templates">Manage templates ↗</a>' : ''}</h4>${groupButtons(g)}${(n => n ? `<p class="small muted" style="margin:8px 0 0">${n} hidden · <a href="/#/templates">show or hide buttons ↗</a></p>` : '')(CG.catalog.filter(x => x.group === g && x.hidden).length)}</div>`).join('')
            + '<p class="small muted">Select one, change its fields in the Data panel on the right (orange), then TAKE. Linked fields follow the match by themselves.</p>';
        })()}</div>
      </div>`);
      $$('[data-preset]', el).forEach(b => b.onclick = e => { e.stopPropagation(); const p = (st().presets || []).find(x => x.id === b.dataset.preset); if (p) applyPreset(p); });
      const caps = $('#caps', el);
      const draw = () => {
        const q = $('#cap-search', el).value.toLowerCase();
        caps.innerHTML = '';
        s.captions.forEach((c, i) => {
          if (q && !(c.line1 + ' ' + c.line2).toLowerCase().includes(q)) return;
          const it = h(`<div class="caption"><div><div class="l1">${esc(c.line1)}</div>${c.line2 ? `<div class="l2">${esc(c.line2)}</div>` : ''}</div><button class="btn sm ghost" title="Delete">✕</button></div>`);
          it.onclick = e => {
            if (e.target.closest('button')) {
              const list = s.captions.slice(); list.splice(i, 1);
              CG.gfx('captions', { list });
              return;
            }
            select('custom_lt', {}, { line1: c.line1, line2: c.line2 });
          };
          it.ondblclick = () => take();
          caps.appendChild(it);
        });
      };
      $('#cap-search', el).oninput = draw;
      $('#cap-add', el).onclick = () => {
        const l1 = $('#cap-l1', el).value.trim(), l2 = $('#cap-l2', el).value.trim();
        if (!l1) return;
        CG.gfx('captions', { list: s.captions.concat([{ line1: l1, line2: l2 }]) });
        $('#cap-l1', el).value = ''; $('#cap-l2', el).value = '';
      };
      draw();
      return el;
    },

    // ------------------------------------------------------------ other sports
    smain() {
      const s = st(), v = CG.sportView();
      const bugOn = s.gfx.onAir.some(e => e.graphicId === 'sport_bug' && !e.preview);
      const timed = v && (v.kind === 'timed' || v.kind === 'athletics');
      const el = h(`<div>
        <div class="panel">
          <h4>Score bug <span class="sp"></span>${bugOn ? '<span class="badge live">ON AIR</span>' : ''}</h4>
          <div class="row">
            <button class="btn lg danger" data-bug="show">TAKE BUG</button>
            <button class="btn lg primary" data-bug="update">UPDATE</button>
            <button class="btn lg" data-bug="hide">OUT</button>
            <span class="grow"></span>
            <label class="chk"><input type="checkbox" id="auto-wipes" ${s.gfx.autoWipes ? 'checked' : ''}> Auto wipes (try, goal, ace, home run…)</label>
          </div>
          <p class="small muted" style="margin:8px 0 0">${v ? `${esc(v.name)} · ${esc(v.periodLabel)} · ${esc(v.status)}` : 'No sport event yet – open the Sports scorer and press MAKE LIVE EVENT.'}</p>
          <div class="gbtns" style="margin-top:8px">${gbtn('sport_bug')}${gbtn('sport_clock')}</div>
        </div>
        ${timed ? `<div class="panel"><h4>Clock (from the scorer)</h4><div class="row"><span style="font-size:40px;font-weight:800" class="mono" data-sclock="game">--:--</span>
          ${v.clock.shot ? '<span style="font-size:30px;font-weight:800;color:#ff9b9e" class="mono" data-sclock="shot">--</span>' : ''}
          <span class="grow"></span><button class="btn" id="ck-t">Start / stop</button></div>
          <p class="small muted" style="margin:6px 0 0">Templates tick the clock themselves; data is only re-sent when the scorer starts, stops or changes it.</p></div>` : ''}
        <div class="panel"><h4>Quick graphics</h4>${groupButtons('Sport Main')}</div>
      </div>`);
      $$('[data-bug]', el).forEach(b => b.onclick = () => CG.gfx(b.dataset.bug, { id: 'sport_bug' }));
      $('#auto-wipes', el).onchange = e => CG.gfx('autoWipes', { enabled: e.target.checked });
      const ck = $('#ck-t', el); if (ck) ck.onclick = () => CG.send('sport', 'clock', { name: 'game', action: 'toggle' }).catch(() => { });
      return el;
    },

    sscores() {
      const v = CG.sportView();
      const el = h(`<div><div class="panel"><h4>Scores & stats graphics</h4>${groupButtons('Sport Scores')}</div>
        <div class="panel"><h4>Statistics with team badges</h4>${groupButtons('Sport Stats')}
          <p class="small muted">Stat comparison and Player stats: choose the statistic or player in the panel on the right, then TAKE. They update themselves while on air.</p></div></div>`);
      if (v) {
        el.appendChild(h(`<div class="panel"><h4>${esc(v.table.title)}</h4><table class="t"><tr><th></th>${v.table.cols.map(c => `<th class="n">${esc(c)}</th>`).join('')}<th class="n">T</th></tr>
          ${['A', 'B'].map(k => `<tr><td><b>${esc(v.teams[k].short)}</b></td>${v.table[k].map(c => `<td class="n">${esc(c)}</td>`).join('')}<td class="n"><b>${esc(v.score[k])}</b></td></tr>`).join('')}</table></div>`));
        el.appendChild(h(`<div class="panel"><h4>Team stats</h4><table class="t"><tr><th>Stat</th><th class="n">${esc(v.teams.A.short)}</th><th class="n">${esc(v.teams.B.short)}</th></tr>
          ${v.teamStats.map(x => `<tr><td>${esc(x.label)}</td><td class="n">${esc(x.a)}</td><td class="n">${esc(x.b)}</td></tr>`).join('')}</table></div>`));
        el.appendChild(h(`<div class="panel"><h4>Latest events</h4><table class="t">${v.timeline.slice(-10).reverse().map(e => `<tr><td class="mono muted">${esc(e.ct || '')}</td><td>${e.team ? esc(v.teams[e.team].short) : ''}</td><td>${esc(e.text)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div>`));
      }
      return el;
    },

    steams() {
      const v = CG.sportView();
      const el = h(`<div></div>`);
      const pick = h(`<div class="row" style="margin-bottom:10px"><span class="muted">Team:</span>
        <button class="btn sm ${viewTeam === 'A' ? 'on' : ''}" data-t="A">${esc(v ? v.teams.A.name : 'A')}</button>
        <button class="btn sm ${viewTeam === 'B' ? 'on' : ''}" data-t="B">${esc(v ? v.teams.B.name : 'B')}</button></div>`);
      $$('[data-t]', pick).forEach(b => b.onclick = () => { viewTeam = b.dataset.t; renderCenter(); });
      el.appendChild(pick);
      el.appendChild(h(`<div class="panel"><h4>Team graphics</h4>${groupButtons('Sport Teams', { team: viewTeam })}</div>`));
      const list = h(`<div class="panel"><h4>Players – click for a name lower third</h4><table class="t"><tr><th>No.</th><th>Name</th><th>Position</th><th>Today</th></tr></table></div>`);
      const tbl = $('table', list);
      (v ? v.players.filter(p => p.team === viewTeam) : []).forEach(p => {
        const tr = h(`<table><tr class="click"><td class="muted">${esc(p.number)}</td><td><b>${esc(p.tvName)}</b></td><td class="muted">${esc(p.position)}</td><td>${esc(p.statsText)}</td></tr></table>`).querySelector('tr');
        tr.onclick = () => select('sport_player_lt', { playerId: p.id });
        tr.ondblclick = () => take();
        if (sel && sel.id === 'sport_player_lt' && sel.params.playerId === p.id) tr.classList.add('sel');
        tbl.appendChild(tr);
      });
      el.appendChild(list);
      return el;
    },

    sath() {
      const v = CG.sportView();
      const x = v && v.extra, c = x && x.current, auto = (x && x.auto) || { mode: 'off', delay: 20 };
      const onAir = st() ? st().gfx.onAir.filter(e => !e.preview) : [];
      const ltOn = id => onAir.some(e => e.graphicId === 'ath_athlete_lt' && e.params && String(e.params.playerId) === String(id));
      const el = h(`<div>
        <div class="panel"><h4>Events <span class="sp"></span>
            <button class="btn sm" id="ath-prev" title="Previous event">◀ Prev</button><button class="btn sm" id="ath-next" title="Next event">Next ▶</button></h4>
          <div class="row" style="flex-wrap:wrap;gap:6px">${x ? x.events.map(e => `<button class="btn sm ${c && c.id === e.id ? 'go' : ''}" data-aev="${esc(e.id)}" title="${e.complete ? 'Results complete' : ''}">${esc(e.name)}${e.round ? ' · ' + esc(e.round) : ''}${e.complete ? ' ✓' : ''}</button>`).join('') : ''}</div>
          <div class="row" style="margin-top:10px;gap:8px"><span class="small muted">Change events</span>
            <select id="ath-auto" style="width:auto"><option value="off" ${auto.mode !== 'results' ? 'selected' : ''}>By hand (or the timing system)</option><option value="results" ${auto.mode === 'results' ? 'selected' : ''}>Automatically when the results are in</option></select>
            ${auto.mode === 'results' ? `<span class="small muted">after</span><select id="ath-delay" style="width:auto">${[[0, 'straight away'], [5, '5 s'], [10, '10 s'], [20, '20 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']].map(([n, l]) => `<option value="${n}" ${Number(auto.delay) === n ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</div>
        </div>
        <div class="panel"><h4>Athletics graphics</h4>${groupButtons('Athletics')}</div></div>`);
      if (c) {
        const field = c.kind === 'field';
        const up = field && c.rows.find(r => r.id === c.up);
        if (field) el.appendChild(h(`<div class="panel"><h4>Up now <span class="sp"></span>${c.vertical ? `<span class="small muted">Bar ${esc(c.bar || '–')}</span>` : `<span class="small muted">Round ${esc(c.attemptRound || '–')} of ${esc(c.rounds)}</span>`}</h4>
          ${up ? `<div class="row" style="gap:14px;align-items:center"><div style="font-size:22px;font-weight:800">${esc(up.tvName)}</div><div class="muted">${esc(up.team)}</div>
            <div class="mono">${esc(up.attempts.join('  ') || 'no attempts yet')}</div>${up.best != null ? `<div>Best <b>${esc(up.best.toFixed(2))}</b></div>` : ''}<span class="grow"></span>${gbtn('ath_up_lt', { label: 'Up now LT' })}</div>` : `<p class="muted">${c.complete ? 'Event complete.' : 'Nobody is up – log attempts on the scorer (or raise the bar).'}</p>`}</div>`));
        const lanes = h(`<div class="panel"><h4>${field ? 'Athletes' : 'Lanes'} – click for a lower third, click again to take it off</h4><div class="lanegrid"></div></div>`);
        c.startlist.forEach(r => {
          const on = ltOn(r.id);
          const b = h(`<button class="lanebtn ${on ? 'pgm' : ''} ${field && r.id === c.up ? 'up' : ''}"><span class="ln">${esc(r.lane || '–')}</span><span class="nm">${esc(r.tvName)}</span><span class="tm">${esc(r.team)}${r.result ? ' · ' + esc(r.result) : ''}</span></button>`);
          b.onclick = () => {
            if (ltOn(r.id)) { CG.gfx('hide', { id: 'ath_athlete_lt' }); return; }
            select('ath_athlete_lt', { playerId: r.id }); take();
          };
          b.oncontextmenu = (e) => { e.preventDefault(); select('ath_athlete_lt', { playerId: r.id }); };
          $('.lanegrid', lanes).appendChild(b);
        });
        el.appendChild(lanes);
        const rows = (c.hasResults ? c.results : c.startlist);
        const tbl = h(`<div class="panel"><h4>${esc(c.name)} ${esc(c.round || '')} – ${c.hasResults ? 'results' : 'start list'}</h4><table class="t"><tr><th>Pos</th><th>${field ? 'Order' : 'Lane'}</th><th>Athlete</th><th>Team</th>${field ? '<th>Attempts</th>' : ''}<th>Result</th></tr></table></div>`);
        rows.forEach(r => {
          const tr = h(`<table><tr class="click"><td>${esc(r.rank || '')}</td><td>${esc(r.lane)}</td><td><b>${esc(r.tvName)}</b></td><td class="muted">${esc(r.team)}</td>${field ? `<td class="mono small">${esc(r.attempts.join('  '))}</td>` : ''}<td>${esc(r.result)} ${esc(r.note)}</td></tr></table>`).querySelector('tr');
          tr.onclick = () => select('ath_athlete_lt', { playerId: r.id });
          tr.ondblclick = () => take();
          $('table', tbl).appendChild(tr);
        });
        el.appendChild(tbl);
      }
      const send = (a, d) => CG.send('sport', a, d).catch(e => CG.toast(e.message, 'err'));
      $$('[data-aev]', el).forEach(b => b.onclick = () => send('athCurrent', { eventId: b.dataset.aev }));
      $('#ath-prev', el).onclick = () => send('athCurrent', { step: -1 });
      $('#ath-next', el).onclick = () => send('athCurrent', { step: 1 });
      $('#ath-auto', el).onchange = (e) => send('athAuto', { mode: e.target.value, delay: auto.delay == null ? 20 : auto.delay });
      const dl = $('#ath-delay', el); if (dl) dl.onchange = (e) => send('athAuto', { mode: 'results', delay: Number(e.target.value) });
      return el;
    },

    // RFP Manager: which match is on air, plus production graphics that work with or without a match.
    production() {
      const s = st(), r = s.rfp || {};
      const el = h(`<div>
        <div class="panel"><h4>Match on air</h4>
          <div class="row"><select id="rfp-fx" class="grow"><option value="">${esc(r.name ? r.name : 'No match (captions, countdown and adverts only)')}</option></select>
          <a class="btn" href="/#/fixtures">Fixtures in RFP Manager ↗</a></div>
          <p class="small muted">Every screen opened without a match in its address (control, outputs, commentary, rundown monitor) follows this match.</p></div>
        <div class="panel"><h4>Theme <span class="sp"></span>${r.theme && r.theme.active ? `<span class="badge pp">${esc(r.theme.active.name)}</span>` : '<span class="small muted">standard graphics</span>'}</h4>
          <div class="row"><select id="rfp-theme" class="grow"><option value="" ${r.theme && !r.theme.choice ? 'selected' : ''}>Automatic: the competition's theme, else the team's default</option>
            <option value="none" ${r.theme && r.theme.choice === 'none' ? 'selected' : ''}>Standard graphics only</option>
            ${((r.theme && r.theme.themes) || []).map(t => `<option value="${esc(t.id)}" ${r.theme.choice === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
          <a class="btn" href="/#/templates">Templates ↗</a></div>
          <p class="small muted">With a theme in use, its graphics are listed first under Captions / Custom, and any built-in graphic it replaces plays the theme's template instead${r.theme && r.theme.active ? ` (${CG.catalog.filter(g => g.replacedBy).length} replaced now)` : ''}.</p></div>
        <div class="panel"><h4>Template triggers</h4>
          <label class="chk"><input type="checkbox" id="trig-on" ${s.gfx.triggersOn ? 'checked' : ''}> Let templates show, hide and update by themselves (${CG.catalog.filter(g => g.rules && g.rules.some(r => r.then !== 'set' && !r.off)).length} template${CG.catalog.filter(g => g.rules && g.rules.some(r => r.then !== 'set' && !r.off)).length === 1 ? '' : 's'} with triggers)</label>
          <p class="small muted">Triggers are the IF … THEN rules set on a template in RFP Manager → Templates. Untick to take full manual control; rules that only set a field keep working.</p></div>
        <div class="panel"><h4>Production graphics</h4>${groupButtons('Production')}
          <p class="small muted">Countdown: type a label and a time of day (HH:MM) in the Data panel, then TAKE. Log table and fixtures use the competition of the match on air.
          Adverts and ad playlists are played from <a href="/#/adverts">RFP Manager → Adverts</a>${r.playlist ? ` · playlist running: <b>${esc(r.playlist.name)}</b>` : ''}.</p></div>
      </div>`);
      $('#rfp-theme', el).onchange = e => CG.send('rfp', 'theme', { theme: e.target.value }).then(() => CG.toast('Theme changed', 'ok')).catch(err => CG.toast(err.message, 'err'));
      const sel = $('#rfp-fx', el);
      const fill = list => {
        sel.innerHTML = '<option value="">No match (captions, countdown and adverts only)</option>' + list.map(f => `<option value="${esc(f.id)}" ${f.id === r.onAirFixture ? 'selected' : ''}>${f.status === 'Live' ? '● ' : ''}${esc(f.name)} · ${esc(f.sport)} · ${esc(f.date)} ${esc(f.time)}</option>`).join('');
      };
      if (fixtureList) fill(fixtureList);
      if (!fixtureList || Date.now() - fixtureAt > 15000) { fixtureAt = Date.now(); CG.send('rfp', 'fixtures', {}).catch(() => { }); }
      sel.onchange = () => CG.send('rfp', 'onAir', { fixtureId: sel.value }).then(() => CG.toast('Match on air changed', 'ok')).catch(e => CG.toast(e.message, 'err'));
      const tg = $('#trig-on', el); if (tg) tg.onchange = e => CG.gfx('triggers', { enabled: e.target.checked });
      return el;
    },

    wipes() {
      const s = st();
      const el = h(`<div><div class="panel"><h4>Wipes & stingers</h4>${groupButtons(CG.isSportMode() ? 'Sport Wipes' : 'Wipes')}
        <p class="small muted">Wipes clear themselves after a few seconds.</p>
        <label class="chk"><input type="checkbox" id="aw" ${s.gfx.autoWipes ? 'checked' : ''}> Fire FOUR / SIX / WICKET automatically when the scorer enters them</label></div></div>`);
      $('#aw', el).onchange = e => CG.gfx('autoWipes', { enabled: e.target.checked });
      return el;
    },

    log() {
      const el = h(`<div class="panel"><h4>AMCP traffic <span class="sp"></span><button class="btn sm" id="log-clear">Clear view</button></h4>
        <div class="log" id="log"></div>
        <div class="row" style="margin-top:8px"><input type="text" id="raw-cmd" class="grow mono" placeholder='Raw AMCP, e.g. INFO  or  CLEAR 1-30'><button class="btn" id="raw-send">Send</button></div>
        <p class="small muted">Raw commands go straight to CasparCG. Be careful on air.</p></div>`);
      const box = $('#log', el);
      CG.log.forEach(e => box.appendChild(logLine(e)));
      setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
      $('#log-clear', el).onclick = () => { CG.log.length = 0; box.innerHTML = ''; };
      const send = () => { const v = $('#raw-cmd', el).value.trim(); if (v) CG.send('caspar', 'raw', { command: v }).catch(() => { }); $('#raw-cmd', el).value = ''; };
      $('#raw-send', el).onclick = send;
      $('#raw-cmd', el).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); send(); } };
      return el;
    },

    settings() {
      const s = st(), c = s.caspar.settings;
      const el = h(`<div>
        <div class="panel"><h4>CasparCG connection</h4>
          <label class="chk" style="margin-bottom:10px"><input type="checkbox" id="cs-enabled" ${c.enabled !== false ? 'checked' : ''}> Send to CasparCG (untick for standalone: graphics only in the browser outputs)</label>
          <div class="form-grid" id="cs">
            <label class="f"><span>Host / IP</span><input type="text" name="host" value="${esc(c.host)}"></label>
            <label class="f"><span>AMCP port</span><input type="number" name="port" value="${c.port}"></label>
            <label class="f"><span>Program channel</span><input type="number" name="programChannel" value="${c.programChannel}"></label>
            <label class="f"><span>Preview channel</span><input type="number" name="previewChannel" value="${c.previewChannel}"></label>
            <label class="f"><span>Default data format</span><select name="defaultFormat"><option value="json" ${c.defaultFormat === 'json' ? 'selected' : ''}>JSON</option><option value="xml" ${c.defaultFormat === 'xml' ? 'selected' : ''}>XML (templateData)</option></select></label>
            <label class="f"><span title="OUT sends CG STOP so the template plays its out animation. Set a time here only if a template has no out animation and must be cleared.">Clear layer after OUT (ms, 0 = never, only STOP)</span><input type="number" name="clearAfterStopMs" value="${c.clearAfterStopMs}"></label>
          </div>
          <div class="row" style="margin-top:10px"><button class="btn primary" id="cs-save">Save & reconnect</button><button class="btn" id="cs-rc">Reconnect</button>
            <span class="muted small">${s.caspar.connected ? 'Connected · ' + esc(s.caspar.version) : 'Not connected'}</span></div>
        </div>
        <div class="panel"><h4>Graphics catalog <span class="sp"></span><span class="small muted">override template / channel / layer / format per graphic in config.json → "graphics"</span></h4>
          <table class="t"><tr><th>Id</th><th>Name</th><th>Template</th><th class="n">Ch</th><th class="n">Layer</th><th>Format</th><th>Live</th></tr>
          ${CG.catalog.map(g => `<tr><td class="mono">${g.id}</td><td>${esc(g.name)}</td><td class="mono">${esc(g.template)}</td><td class="n">${g.channel || 'PGM'}</td><td class="n">${g.layer}</td><td>${g.format || c.defaultFormat}</td><td>${g.live ? '●' : ''}</td></tr>`).join('')}</table>
        </div></div>`);
      $('#cs-save', el).onclick = () => {
        const d = {};
        $$('#cs [name]', el).forEach(i => d[i.name] = i.type === 'number' ? +i.value : i.value);
        d.enabled = $('#cs-enabled', el).checked;
        CG.send('caspar', 'settings', d).then(() => CG.toast('Saved – reconnecting', 'ok')).catch(e => CG.toast(e.message, 'err'));
      };
      $('#cs-rc', el).onclick = () => CG.send('caspar', 'reconnect', {}).catch(() => { });
      if (s.devices) el.appendChild(devicesPanel(s.devices));
      return el;
    },
  };

  // ================================================================ vMix / ATEM / HyperDeck
  // Unsaved edits live in devDraft so a status update from the server does not wipe them.
  function devicesPanel(D) {
    const kinds = D.kinds || {}, live = D.list || [];
    const el = h(`<div class="panel"><h4>Devices <span class="sp"></span><a class="small" href="/#/settings" target="_blank">Set up in Settings → Connections ↗</a></h4>
      ${live.length ? `<table class="t"><tr><th>Device</th><th>Id</th><th>Status</th></tr>${live.map(d => `<tr><td><b>${esc(d.name)}</b> <span class="muted small">${esc((kinds[d.type] || {}).name || d.type)}</span></td><td class="mono">${esc(d.id)}</td>
        <td class="small">${d.enabled === false ? '<span class="muted">off</span>' : d.connected ? '<span style="color:var(--ok,#2c9)">● connected</span> ' + esc(d.summary || '') : '<span class="muted">○ ' + esc(d.error || 'not connected') + '</span>'}</td></tr>`).join('')}</table>
      <h4 style="margin-top:14px">Try a command</h4><div class="row" style="gap:6px;flex-wrap:wrap">
        <select id="dv-dev" style="width:auto;min-width:160px">${live.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select>
        <input type="text" id="dv-cmd" list="dv-cmds" placeholder="command" style="width:200px"><datalist id="dv-cmds"></datalist>
        <input type="text" id="dv-val" placeholder="value" style="width:220px"><button class="btn" id="dv-send">Send</button></div>`
      : '<p class="muted">No devices yet. Add vMix, ATEM, HyperDeck, OBS, Companion, OSC, Art-Net, MIDI, X-keys or a Pi GPIO box in RFP Manager → Settings → Connections.</p>'}</div>`);
    const send = $('#dv-send', el);
    if (send) send.onclick = () => CG.send('caspar', 'device', { id: $('#dv-dev', el).value, command: $('#dv-cmd', el).value.trim(), value: $('#dv-val', el).value.trim() }).then(() => CG.toast('Sent', 'ok')).catch(er => CG.toast(er.message, 'err'));
    const fillCmds = () => { const sel = $('#dv-dev', el), dl = $('#dv-cmds', el); if (!sel || !dl) return; const d = live.find(x => x.id === sel.value); dl.innerHTML = ((d && d.commands) || []).map(c => `<option value="${esc(c)}">`).join(''); };
    const sel = $('#dv-dev', el); if (sel) { sel.onchange = fillCmds; fillCmds(); }
    return el;
  }

  function logLine(e) {
    const cls = e.error ? 'e' : e.direction === '>>' ? 'o' : e.direction === '<<' ? 'i' : 's';
    const t = new Date(e.time);
    const ts = isNaN(t) ? '' : t.toTimeString().slice(0, 8);
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = `${ts} ${e.direction} ${e.text}`;
    return div;
  }
  function appendLog(e) {
    const box = $('#log');
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    box.appendChild(logLine(e));
    while (box.childElementCount > 400) box.firstElementChild.remove();
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  // ================================================================ selection / right panel
  function select(id, params, overrides) {
    const d = def(id);
    if (!d) return;
    if (rowsEl) { rowsEl.remove(); rowsEl = null; }
    sel = { id, params: params || {}, overrides: overrides || {} };
    data = null;
    $('#sel-title').textContent = d.name;
    renderParams();
    requestData();
    markButtons();
    renderInvokes();
    if (page === 'batting' || page === 'bowling' || page === 'teams') renderCenter();
  }

  function target(d, preview) {
    const c = st().caspar.settings;
    const ch = preview ? c.previewChannel : (d.channel || c.programChannel);
    return `${ch}-${d.layer}`;
  }

  function renderParams() {
    const box = $('#sel-params');
    box.innerHTML = '';
    if (!sel) return;
    const d = def(sel.id), s = st(), stats = s.stats;
    $('#sel-target').textContent = `${d.template} → ${target(d)}`;
    const add = (label, html, onchange) => {
      const w = h(`<label class="f grow"><span>${label}</span><select>${html}</select></label>`);
      $('select', w).onchange = e => { onchange(e.target.value); requestData(); markButtons(); };
      box.appendChild(w);
    };
    const innOpts = cur => stats.innings.map(i => `<option value="${i.index}" ${i.index === cur ? 'selected' : ''}>${i.number}. ${esc(i.battingTeamShort || i.battingTeamName)} ${i.score}</option>`).join('');
    const curInn = sel.params.innings != null ? sel.params.innings : stats.currentIndex;
    if (['innings', 'batter', 'bowler'].includes(d.param) && stats.innings.length)
      add('Innings', innOpts(curInn), v => { sel.params.innings = +v; renderParams(); });
    if (d.param === 'batter' || d.param === 'bowler') {
      const inn = stats.innings[curInn];
      if (inn) {
        const teamKey = d.param === 'batter' ? inn.battingTeam : inn.bowlingTeam;
        add(d.param === 'batter' ? 'Batter' : 'Bowler', CG.playerOptions(teamKey, sel.params.playerId || '', { blankLabel: d.param === 'batter' ? '(striker)' : '(current bowler)' }), v => sel.params.playerId = v || undefined);
      }
    }
    const sv = CG.isSportMode() ? CG.sportView() : null;
    if (sv && d.param === 'stat') {
      const cur = sel.params.stat || '';
      add('Statistic', '<option value="">(first with numbers)</option>' + sv.teamStats.map(x => `<option value="${esc(x.label)}" ${x.label === cur ? 'selected' : ''}>${esc(x.label)} · ${esc(x.a)} – ${esc(x.b)}</option>`).join(''), v => sel.params.stat = v || undefined);
      return;
    }
    if (sv && (d.param === 'player' || d.param === 'team')) {
      if (d.param === 'player') {
        const grp = k => { const ps = sv.players.filter(p => p.team === k); return ps.length ? `<optgroup label="${esc(k ? sv.teams[k].name : 'Entries')}">${ps.map(p => `<option value="${esc(p.id)}" ${p.id === sel.params.playerId ? 'selected' : ''}>${esc(p.number ? '#' + p.number + ' ' : '')}${esc(p.tvName)}</option>`).join('')}</optgroup>` : ''; };
        add('Player', '<option value="">— select —</option>' + grp('A') + grp('B') + grp(''), v => sel.params.playerId = v || undefined);
      } else {
        const t = sel.params.team || 'A';
        add('Team', `<option value="A" ${t === 'A' ? 'selected' : ''}>${esc(sv.teams.A.name)}</option><option value="B" ${t === 'B' ? 'selected' : ''}>${esc(sv.teams.B.name)}</option>`, v => sel.params.team = v);
      }
      return;
    }
    if (d.param === 'player') {
      const opt = k => `<optgroup label="${esc(CG.team(k).name)}">${CG.playerOptions(k, sel.params.playerId || '', { blank: false })}</optgroup>`;
      add('Player', '<option value="">— select —</option>' + opt('A') + opt('B'), v => sel.params.playerId = v || undefined);
    }
    if (d.param === 'team') {
      const t = sel.params.team || 'A';
      add('Team', `<option value="A" ${t === 'A' ? 'selected' : ''}>${esc(s.match.teamA.name)}</option><option value="B" ${t === 'B' ? 'selected' : ''}>${esc(s.match.teamB.name)}</option>`, v => sel.params.team = v);
    }
  }

  let reqTimer = null;
  function requestData() {
    clearTimeout(reqTimer);
    reqTimer = setTimeout(() => {
      if (!sel) return;
      const my = ++dataSeq, id = sel.id;
      CG.send('gfx', 'data', { id, params: sel.params }).then(msg => {
        if (my !== dataSeq || !sel || sel.id !== id) return;
        data = msg.data || {};
        renderFields();
        pushPreview();
      }).catch(() => { });
    }, 60);
  }

  function merged() {
    return Object.assign({}, data || {}, sel ? sel.overrides : {});
  }

  // ---------------------------------------------------------------- table templates: rows editor
  // A template whose variables are numbered (_t1name1 … _t1name12, _time1 …) is a table. Its rows are edited as a grid, and
  // variables like _fixtures-opacity3 / _results-opacity3 / _heading-opacity3 become one "kind of row" choice per row.
  const FLAG = /[-_]?(opacity|visible|visibility|show|alpha|vis)[-_]?$/i;
  function rowModel(keys) {
    const by = new Map();
    keys.forEach(k => { const m = /^(.*?)(\d+)$/.exec(k); if (!m || !m[1]) return; if (!by.has(m[1])) by.set(m[1], new Set()); by.get(m[1]).add(Number(m[2])); });
    const bases = [...by].filter(([, s]) => s.size >= 3).map(([b]) => b);
    if (bases.length < 2) return null;
    const flags = bases.filter(b => FLAG.test(b)), cols = bases.filter(b => !FLAG.test(b));
    if (!cols.length) return null;
    const nice = b => b.replace(FLAG, '').replace(/^[_-]+|[_-]+$/g, '');
    const find = re => cols.find(b => re.test(nice(b))) || '';
    const role = { heading: find(/^(head|title|date|round)/i), t1: find(/^(t1|home|team1|teama|a)(name)?$/i), t2: find(/^(t2|away|team2|teamb|b)(name)?$/i), time: find(/^(time|score|result|info)/i), image: find(/^(image|img|logo|pic|badge)/i),
      s1: find(/^(t1|home|team1|teama|a)[-_]?(score|pts|points|runs|goals|total)$/i) || find(/^(score|pts|points)[-_]?(1|a|home)$/i), s2: find(/^(t2|away|team2|teamb|b)[-_]?(score|pts|points|runs|goals|total)$/i) || find(/^(score|pts|points)[-_]?(2|b|away)$/i) };
    const flagFor = re => flags.find(b => re.test(nice(b))) || '';
    const kind = { heading: flagFor(/^head/i), fixture: flagFor(/^fixt/i), result: flagFor(/^res/i) };
    const label = b => ({ [role.heading]: 'Heading', [role.t1]: 'Team 1', [role.t2]: 'Team 2', [role.time]: role.s1 && role.s2 ? 'Time' : 'Time / score', [role.image]: 'Picture', [role.s1]: 'Score 1', [role.s2]: 'Score 2' })[b] || nice(b);
    // a column that has the same name as a kind of row belongs to that kind (the heading text of a heading row)
    const owner = c => flags.find(f => nice(f).toLowerCase().replace(/s$/, '') === nice(c).toLowerCase().replace(/s$/, '')) || '';
    return { n: Math.max(...bases.map(b => Math.max(...by.get(b)))), flags, cols, role, kind, label, nice, owner, has: (b, i) => by.get(b).has(i),
      keys: new Set(keys.filter(k => { const m = /^(.*?)(\d+)$/.exec(k); return m && bases.includes(m[1]); })) };
  }
  const rv = k => { const m = merged(); return m[k] == null ? '' : String(m[k]); };
  function rset(k, v) {
    if (!sel || !data || !(k in data || (def(sel.id).inputs || []).includes(k))) return;    // an empty picture is not in the data yet
    v = v == null ? '' : String(v);
    if (v === (data[k] == null ? '' : String(data[k]))) delete sel.overrides[k]; else sel.overrides[k] = v;
  }
  const isOn = v => { const n = parseFloat(v); return Number.isFinite(n) ? n > 0 : /^(true|yes|on)$/i.test(String(v).trim()); };
  const typeOf = (rm, i) => rm.flags.find(f => rm.has(f, i) && isOn(rv(f + i))) || '';
  const rowsInUse = rm => { let n = 0; for (let i = 1; i <= rm.n; i++) if (rm.flags.length ? typeOf(rm, i) : rm.cols.some(c => rm.has(c, i) && rv(c + i))) n++; return n; };
  function onValue(rm) {
    let v = ''; try { v = localStorage.getItem('rfp-rows-on-' + sel.id) || ''; } catch (e) { /* default */ }
    if (v) return v;
    for (let i = 1; i <= rm.n; i++) for (const f of rm.flags) { const x = parseFloat(rv(f + i)); if (x > 0) return String(x); }
    return rm.flags.some(f => /opacity|alpha/i.test(f)) ? '100' : '1';
  }
  let rowsEl = null, matchList = null;
  function closeRows() { if (rowsEl) { rowsEl.remove(); rowsEl = null; } if (sel) { $('#fields').dataset.keys = ''; renderFields(); } }
  function openRows() {
    if (!sel || !data) return;
    const d = def(sel.id), rm = rowModel([...new Set((d.inputs || []).concat(Object.keys(data)))]);
    if (!rm) return;
    if (rowsEl) rowsEl.remove();
    let on = onValue(rm);
    const after = () => { pushPreview(); const u = $('#rows-used'); if (u) u.textContent = rowsInUse(rm) + ' in use'; };
    const setType = (i, f) => rm.flags.forEach(x => { if (rm.has(x, i)) rset(x + i, x === f ? on : '0'); });
    const clearRow = i => { setType(i, ''); rm.cols.forEach(c => { if (rm.has(c, i)) rset(c + i, ''); }); };
    const readRow = i => ({ type: typeOf(rm, i), v: Object.fromEntries(rm.cols.map(c => [c, rv(c + i)])) });
    const writeRow = (i, r) => { setType(i, r.type); rm.cols.forEach(c => { if (rm.has(c, i)) rset(c + i, r.v[c] || ''); }); };
    const enabled = (c, t) => { const o = rm.owner(c); return !rm.flags.length ? true : !t ? false : o ? o === t : !rm.cols.some(x => rm.owner(x) === t); };
    const imgOpts = cur => `<option value="">–</option>${cur && !picks.images.some(x => x.url === cur) ? `<option value="${esc(cur)}" selected>${esc(cur.split('/').pop().slice(0, 18))}</option>` : ''}${picks.images.map(x => `<option value="${esc(x.url)}" ${x.url === cur ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}`;
    const canFill = !!(rm.role.t1 && rm.role.t2);
    // A template with one "time / score" text per row and no score of its own per team: a result row still gets a score box
    // per team, and the two are written into that text as "24 - 17".
    const joined = !(rm.role.s1 && rm.role.s2) && !!rm.role.time && !!rm.kind.result;
    const split = v => { v = String(v || ''); let m = /^(.*?)\s+[-–—]\s+(.*)$/.exec(v) || /^([^-–—]*)[-–—](.*)$/.exec(v); return m ? [m[1].trim(), m[2].trim()] : [v.trim(), '']; };
    const join = (a, b) => (a === '' && b === '' ? '' : `${a} - ${b}`);
    rowsEl = h(`<div style="position:fixed;left:176px;right:432px;top:52px;bottom:12px;z-index:60;background:var(--bg2,#1c1c1c);border:1px solid var(--line2);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)">
        <b style="font-size:15px">${esc(d.name)} – rows</b><span class="muted small">The preview on the right follows as you type. TAKE or UPDATE when it is right.</span><span style="flex:1"></span>
        ${rm.flags.length ? `<label class="small muted" title="What the template expects for a row that is shown: 100 for an opacity in percent, 1 for on/off">Shown = <input type="text" id="rw-on" value="${esc(on)}" style="width:54px;padding:3px 6px"></label>` : ''}
        <button class="btn sm" id="rw-clear">Clear all</button><button class="btn sm primary" id="rw-close">Done</button></div>
      ${canFill ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--panel2)">
        <b class="small">Fill from matches</b>
        <select id="rf-comp" style="width:auto;max-width:220px"><option value="">Loading…</option></select>
        <select id="rf-what" style="width:auto"><option value="both">Results and fixtures</option><option value="fixtures">Fixtures only</option><option value="results">Results only</option></select>
        <input type="date" id="rf-from" style="width:auto"><span class="muted small">to</span><input type="date" id="rf-to" style="width:auto">
        <label class="chk small"><input type="checkbox" id="rf-head" ${rm.kind.heading ? 'checked' : 'disabled'}> Date headings</label>
        <label class="chk small"><input type="checkbox" id="rf-short"> Short names</label>
        ${rm.role.image ? '<select id="rf-img" style="width:auto"><option value="">No row picture</option><option value="logo1">Team 1 logo</option><option value="logo2">Team 2 logo</option><option value="comp">Competition logo</option></select>' : ''}
        <button class="btn sm primary" id="rf-go">Fill</button><span class="small muted" id="rf-note"></span></div>` : ''}
      <div style="flex:1;overflow:auto;padding:8px 14px"><table class="t" id="rw-table" style="width:100%"></table></div></div>`);
    document.body.appendChild(rowsEl);
    const table = rowsEl.querySelector('#rw-table');
    const draw = () => {
      table.innerHTML = `<tr><th style="width:34px">#</th>${rm.flags.length ? '<th style="width:130px">Kind of row</th>' : ''}${rm.cols.map(c => `<th>${esc(joined && c === rm.role.time ? 'Time, or score per team' : rm.label(c))}</th>`).join('')}<th style="width:128px"></th></tr>` +
        Array.from({ length: rm.n }, (_, x) => x + 1).map(i => {
          const t = typeOf(rm, i);
          return `<tr data-i="${i}" style="${rm.flags.length && !t ? 'opacity:.55' : ''}"><td class="muted num">${i}</td>
            ${rm.flags.length ? `<td><select data-type style="padding:4px 6px"><option value="">Off</option>${rm.flags.filter(f => rm.has(f, i)).map(f => `<option value="${esc(f)}" ${f === t ? 'selected' : ''}>${esc(rm.nice(f).replace(/s$/, '').replace(/^./, ch => ch.toUpperCase()))}</option>`).join('')}</select></td>` : ''}
            ${rm.cols.map(c => {
              if (!rm.has(c, i)) return '<td></td>';
              const off = !enabled(c, t), cur = rv(c + i);
              if (c === rm.role.image || (d.types && d.types[c + i] === 'image')) return `<td><select data-c="${esc(c)}" ${off ? 'disabled' : ''} style="padding:4px 6px;max-width:150px">${imgOpts(cur)}</select></td>`;
              if (joined && c === rm.role.time && t === rm.kind.result) { const sc = split(cur); return `<td><div style="display:flex;gap:6px;align-items:center"><input type="text" data-s="0" value="${esc(sc[0])}" placeholder="Team 1" title="Score of team 1" style="padding:4px 6px;width:100%;text-align:center"><span class="muted">–</span><input type="text" data-s="1" value="${esc(sc[1])}" placeholder="Team 2" title="Score of team 2" style="padding:4px 6px;width:100%;text-align:center"></div></td>`; }
              return `<td><input type="text" data-c="${esc(c)}" value="${esc(cur)}" ${off ? 'disabled' : ''} ${c === rm.role.t1 || c === rm.role.t2 ? 'list="dl-names"' : ''} style="padding:4px 6px;width:100%;${off ? 'opacity:.3' : ''}"></td>`;
            }).join('')}
            <td class="nowrap"><button class="btn sm ghost" data-up title="Move up" ${i === 1 ? 'disabled' : ''}>↑</button><button class="btn sm ghost" data-down title="Move down" ${i === rm.n ? 'disabled' : ''}>↓</button><button class="btn sm ghost" data-x title="Clear this row">✕</button></td></tr>`;
        }).join('');
    };
    draw();
    table.addEventListener('input', e => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      if (e.target.dataset.s !== undefined) { const b = tr.querySelectorAll('input[data-s]'); rset(rm.role.time + tr.dataset.i, join(b[0].value.trim(), b[1].value.trim())); after(); return; }
      if (!e.target.dataset.c) return;
      rset(e.target.dataset.c + tr.dataset.i, e.target.value); after();
    });
    table.addEventListener('change', e => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      if (e.target.matches('[data-type]')) { setType(Number(tr.dataset.i), e.target.value); draw(); after(); }
      else if (e.target.dataset.c) { rset(e.target.dataset.c + tr.dataset.i, e.target.value); after(); }
    });
    table.addEventListener('click', e => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      const i = Number(tr.dataset.i), swap = j => { const a = readRow(i), b = readRow(j); writeRow(i, b); writeRow(j, a); draw(); after(); };
      if (e.target.closest('[data-up]') && i > 1) swap(i - 1);
      else if (e.target.closest('[data-down]') && i < rm.n) swap(i + 1);
      else if (e.target.closest('[data-x]')) { clearRow(i); draw(); after(); }
    });
    rowsEl.querySelector('#rw-close').onclick = closeRows;
    rowsEl.querySelector('#rw-clear').onclick = () => { for (let i = 1; i <= rm.n; i++) clearRow(i); draw(); after(); };
    const onIn = rowsEl.querySelector('#rw-on');
    if (onIn) onIn.onchange = () => { const v = onIn.value.trim() || '1'; const types = Array.from({ length: rm.n }, (_, x) => typeOf(rm, x + 1)); on = v; try { localStorage.setItem('rfp-rows-on-' + sel.id, v); } catch (e) { /* not kept */ } types.forEach((t, x) => setType(x + 1, t)); after(); };
    if (!canFill) return;
    // ---- fill from the matches in RFP Manager
    const q = id => rowsEl.querySelector(id), day = n => { const t = new Date(Date.now() + n * 86400000); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    q('#rf-from').value = day(-7); q('#rf-to').value = day(7);
    const comps = j => { q('#rf-comp').innerHTML = `<option value="">All competitions</option>${j.competitions.map(c => `<option value="${esc(c.id)}" ${c.id === j.current ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`; };
    const load = () => fetch('api/matches' + CG.query).then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not read the matches')))).then(j => { matchList = j; return j; });
    load().then(comps).catch(e => { q('#rf-note').textContent = e.message; });
    q('#rf-go').onclick = async () => {
      let j; try { j = await load(); } catch (e) { q('#rf-note').textContent = e.message; return; }
      const comp = q('#rf-comp').value, what = q('#rf-what').value, from = q('#rf-from').value, to = q('#rf-to').value, short = q('#rf-short').checked, heads = q('#rf-head').checked && rm.kind.heading, img = q('#rf-img') ? q('#rf-img').value : '';
      const cdoc = j.competitions.find(c => c.id === comp);
      const list = j.matches.filter(x => (!comp || x.competition === comp) && (!from || !x.date || x.date >= from) && (!to || !x.date || x.date <= to) && (what === 'both' || (what === 'results') === !!(x.finished || x.started)));
      const rows = []; let last = null;
      for (const x of list) {
        if (heads && x.date !== last) { last = x.date; const dt = x.date ? new Date(x.date + 'T12:00:00') : null; rows.push({ type: rm.kind.heading, v: { [rm.role.heading || '_']: dt ? dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase() : 'DATE TO BE CONFIRMED' } }); }
        const res = x.finished || x.started, v = { [rm.role.t1]: (short ? x.short1 : x.team1).toUpperCase(), [rm.role.t2]: (short ? x.short2 : x.team2).toUpperCase() };
        if (rm.role.s1 && rm.role.s2) { v[rm.role.s1] = res ? x.score1 : ''; v[rm.role.s2] = res ? x.score2 : ''; if (rm.role.time) v[rm.role.time] = res ? '' : x.time || ''; }
        else if (rm.role.time) v[rm.role.time] = res ? join(x.score1, x.score2) : x.time || '';
        if (rm.role.image && img) v[rm.role.image] = img === 'comp' ? ((j.competitions.find(c => c.id === x.competition) || {}).logo || '') : x[img] || '';
        rows.push({ type: (res ? rm.kind.result : rm.kind.fixture) || rm.kind.fixture || rm.kind.result || rm.flags[0] || '', v });
      }
      // never leave a date heading as the last line of the table
      let fit = rows.slice(0, rm.n); while (fit.length && fit[fit.length - 1].type === rm.kind.heading && rm.kind.heading) fit = fit.slice(0, -1);
      for (let i = 1; i <= rm.n; i++) { clearRow(i); if (fit[i - 1]) writeRow(i, fit[i - 1]); }
      // the title of the table follows the competition that was chosen
      if (cdoc && rm.role.heading) { const top = rm.role.heading.replace(/[-_]$/, ''); if (top in data) rset(top, cdoc.name.toUpperCase()); }
      const left = list.length - fit.filter(r => r.type !== rm.kind.heading || !rm.kind.heading).length;
      q('#rf-note').textContent = !list.length ? 'No matches in that range.' : `${list.length - Math.max(0, left)} match${list.length - Math.max(0, left) === 1 ? '' : 'es'} filled` + (left > 0 ? `, ${left} did not fit. Narrow the dates, or untick date headings.` : '.');
      draw(); after();
    };
  }

  // What a field can be chosen from: the people, pictures and colours of the match (asked for when a template is selected).
  let picks = { names: [], images: [], colors: [] }, picksAt = 0;
  function loadPicks() {
    if (Date.now() - picksAt < 8000) return;
    picksAt = Date.now();
    fetch('api/picks' + CG.query).then(r => (r.ok ? r.json() : null)).then(j => {
      if (!j) return;
      const before = JSON.stringify(picks); picks = j;
      let dl = $('#dl-names'); if (!dl) { dl = h('<datalist id="dl-names"></datalist>'); document.body.appendChild(dl); }
      dl.innerHTML = j.names.map(x => `<option value="${esc(x.name)}">${esc(x.group)}</option>`).join('');
      if (before !== JSON.stringify(j) && sel && def(sel.id) && def(sel.id).user) { $('#fields').dataset.keys = ''; renderFields(); }
    }).catch(() => { });
  }
  let allValues = false;
  // a box of several lines grows with its text (up to 8 lines)
  function fit(t) { t.rows = Math.min(8, Math.max(2, String(t.value || '').split('\n').length)); }
  function renderFields() {
    const box = $('#fields');
    if (!sel || !data) { box.innerHTML = '<span class="muted small">—</span>'; return; }
    const d = def(sel.id);
    if (d.user) loadPicks();
    const keys = Object.keys(data).filter(k => k !== 'graphic_id');
    const inputs = (d.inputs || []);
    const ordered = inputs.concat(keys.filter(k => !inputs.includes(k)));
    const m = merged();
    const rm = d.user ? rowModel(ordered) : null;        // a table template (fixtures, results, standings…): its rows get their own editor
    const same = box.dataset.keys === ordered.join('|') && box.dataset.gid === sel.id;
    if (same) {
      // update values in place, leave focused / edited fields alone
      // a value that now has line breaks needs a box of several lines
      if ($$('input[data-k]', box).some(i => i.type === 'text' && String(m[i.dataset.k] == null ? '' : m[i.dataset.k]).includes('\n') && !(i.dataset.k in sel.overrides))) box.dataset.keys = '';
      else {
        $$('[data-k]', box).forEach(i => {
          if (i === document.activeElement || (i.dataset.k in sel.overrides)) return;
          i.value = m[i.dataset.k] == null ? '' : m[i.dataset.k];
          if (i.tagName === 'TEXTAREA') fit(i);
        });
        return;
      }
    }
    box.dataset.keys = ordered.join('|');
    box.dataset.gid = sel.id;
    box.innerHTML = '';
    if (rm) {
      const used = rowsInUse(rm);
      const blk = h(`<div style="grid-column:1/-1;display:flex;gap:8px;align-items:center;padding:6px 8px;margin-bottom:4px;border:1px solid var(--line2);border-radius:6px;background:var(--panel2)">
        <b>${rm.n} rows</b><span class="muted small" id="rows-used">${used} in use</span><span style="flex:1"></span><button class="btn sm primary" id="rows-open">Edit rows…</button></div>`);
      box.appendChild(blk);
      blk.querySelector('#rows-open').onclick = () => openRows();
    }
    ordered.forEach(k => {
      if (rm && rm.keys.has(k)) return;                  // edited in the rows editor, not one by one
      const isInput = inputs.includes(k);
      const lab = h(`<label class="${isInput ? 'inp' : ''}" title="${esc(k)}">${esc((d.labels && d.labels[k]) || k)}</label>`);
      if (isInput) lab.style.color = 'var(--amber)';
      // a field with a fixed set of choices (the layout of a template, say) is a list to pick from
      const cur = m[k] == null ? '' : String(m[k]), opts = d.options && d.options[k];
      const type = (d.types && d.types[k]) || (d.user ? 'text' : '');
      // text of several lines: a "Text, several lines" field, a value that has line breaks, or one switched with ¶
      const plain = !opts && type !== 'image' && type !== 'color';
      const mlKey = 'cg.ml.' + sel.id + '.' + k, mlSet = CG.store.get(mlKey, '');
      const ml = plain && (cur.includes('\n') || (type === 'multiline' ? mlSet !== '0' : mlSet === '1'));
      const inp = opts ? h(`<select data-k="${esc(k)}">${(opts.includes(cur) ? opts : [cur].concat(opts)).map(o => `<option value="${esc(o)}">${esc(o ? o.replace(/[_-]+/g, ' ') : '–')}</option>`).join('')}</select>`)
        : ml ? h(`<textarea data-k="${esc(k)}" rows="2" spellcheck="false" placeholder="Several lines – Enter for a new line, Ctrl+Enter to send"></textarea>`)
        : h(`<input type="text" data-k="${esc(k)}" ${(type === 'text' || type === 'multiline') && picks.names.length ? 'list="dl-names"' : ''}>`);
      inp.value = cur;
      let cell = inp;
      if (ml) { fit(inp); inp.addEventListener('input', () => fit(inp)); }
      if (plain) {
        // ¶ switches the field between one line and several lines
        const tg = h(`<button type="button" class="ml-tg${ml ? ' on' : ''}" tabindex="-1" title="${ml ? 'Back to one line (line breaks become spaces)' : 'Several lines of text (or press Shift+Enter in the field)'}">¶</button>`);
        const swap = (to, insert) => {
          const v = inp.value, at = inp.selectionStart == null ? v.length : inp.selectionStart, end = inp.selectionEnd == null ? at : inp.selectionEnd;
          CG.store.set(mlKey, to ? '1' : '0');
          let nv = v, caret = at;
          if (insert != null) { nv = v.slice(0, at) + insert + v.slice(end); caret = at + insert.length; }
          if (!to) nv = nv.replace(/\s*\r?\n\s*/g, ' ');
          if (nv !== v) { sel.overrides[k] = nv; }
          box.dataset.keys = ''; renderFields(); pushPreview();
          const again = box.querySelector(`[data-k="${CSS.escape(k)}"]`);
          if (again) { if (nv !== v) { again.value = nv; again.oninput && again.oninput(); } again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* not text */ } }
        };
        tg.onclick = () => swap(!ml);
        if (!ml) {
          inp.addEventListener('paste', e => {
            const t = (e.clipboardData || window.clipboardData) ? (e.clipboardData || window.clipboardData).getData('text') : '';
            if (/\r?\n/.test(t.trim())) { e.preventDefault(); swap(true, t.replace(/\r\n?/g, '\n').replace(/\n+$/, '')); }
          });
          inp.__shiftEnter = () => swap(true, '\n');
        }
        cell = h('<div class="fcell"></div>'); cell.append(inp, tg);
      }
      const setVal = v => { inp.value = v; inp.oninput(); };
      if (!opts && type === 'image') {
        // a picture: choose from the logos and photos of this match or the image library
        const groups = [...new Set(picks.images.map(x => x.group))];
        const pick = h(`<select title="Choose a picture" style="flex:1;min-width:0"><option value="__pick__">Choose a picture…</option><option value="">No picture (the template's own)</option>${groups.map(g => `<optgroup label="${esc(g)}">${picks.images.filter(x => x.group === g).map(x => `<option value="${esc(x.url)}">${esc(x.label)}</option>`).join('')}</optgroup>`).join('')}</select>`);
        const thumb = h('<img alt="" style="height:26px;width:34px;object-fit:contain;flex:none;background:repeating-conic-gradient(#333 0 25%,#222 0 50%) 0 0/10px 10px;border-radius:3px">');
        const show = () => { thumb.src = inp.value || ''; thumb.style.visibility = inp.value ? '' : 'hidden'; pick.value = picks.images.some(x => x.url === inp.value) ? inp.value : '__pick__'; };
        pick.onchange = () => { if (pick.value !== '__pick__') setVal(pick.value); show(); };
        inp.addEventListener('input', show); inp.style.display = 'none'; show();
        cell = h('<div class="fcell" style="gap:6px;align-items:center"></div>'); cell.append(thumb, pick, inp);
      } else if (!opts && type === 'color') {
        // a colour: the colour box, or one of the colours of this match, or transparent
        const hex = v => (window.ColorPicker && window.ColorPicker.toHex(v)) || (/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000');
        const box = h('<input type="color" title="Choose a colour" style="width:34px;height:26px;padding:0;flex:none">');
        const pick = h(`<select title="Colours of this match" style="width:112px;flex:none"><option value="__pick__">Pick…</option><option value="transparent">Transparent</option>${picks.colors.map(x => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('')}</select>`);
        const show = () => { box.value = hex(inp.value); box.style.opacity = !inp.value ? '.35' : '1'; };
        if (window.ColorPicker) window.ColorPicker.setSuggestions(picks.colors);
        box.oninput = () => setVal(box.value);
        pick.onchange = () => { if (pick.value !== '__pick__') setVal(pick.value); pick.value = '__pick__'; show(); };
        inp.addEventListener('input', show); inp.style.cssText = 'flex:1;min-width:0'; show();
        cell = h('<div class="fcell" style="gap:6px;align-items:center"></div>'); cell.append(box, inp, pick);
      } else if (!opts && type === 'text' && d.user) {
        // a name chosen from the list brings its picture and colour along (…name → …image / …photo / …logo and …color)
        inp.addEventListener('change', () => {
          const hit = picks.names.find(x => x.name.toLowerCase() === inp.value.trim().toLowerCase()); if (!hit) return;
          const pre = k.replace(/(name|text|title|line\d?)$/i, '');
          if (pre === k) return;
          ordered.forEach(o => {
            if (o === k || !o.startsWith(pre)) return;
            const rest = o.slice(pre.length).toLowerCase(), t = (d.types && d.types[o]) || 'text';
            const v = t === 'image' && /^(image|img|photo|logo|pic|picture|badge)$/.test(rest) ? hit.image : t === 'color' && /^(colou?r|bg|background)$/.test(rest) ? hit.color : null;
            const el = v ? box.querySelector(`[data-k="${CSS.escape(o)}"]`) : null;
            if (el) { el.value = v; el.dispatchEvent(new Event('input')); }
          });
        });
      }
      if (k in sel.overrides) inp.classList.add('ovr');
      inp.oninput = () => {
        if (inp.value === (data[k] == null ? '' : String(data[k]))) { delete sel.overrides[k]; inp.classList.remove('ovr'); }
        else { sel.overrides[k] = inp.value; inp.classList.add('ovr'); }
        pushPreview();
      };
      if (opts) inp.onchange = inp.oninput;
      inp.onkeydown = e => {
        if (e.key !== 'Enter') return;
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); takeOrUpdate(); return; }
        if (inp.tagName === 'TEXTAREA') { e.stopPropagation(); return; }   // a new line
        if (e.shiftKey && inp.__shiftEnter) { e.preventDefault(); e.stopPropagation(); inp.__shiftEnter(); return; }
        e.preventDefault(); e.stopPropagation(); take();
      };
      if (!isInput && inputs.length + (rm ? 1 : 0) > 0 || (!isInput && !d.user && ordered.length > 14)) { lab.classList.add('extra'); cell.classList.add('extra'); if (k in sel.overrides) { lab.classList.add('ovr-on'); cell.classList.add('ovr-on'); } }
      box.appendChild(lab); box.appendChild(cell);
    });
    const nx = box.querySelectorAll('label.extra').length;
    if (nx) {
      const more = h(`<button class="btn sm ghost" style="grid-column:1/-1;justify-self:start;margin-top:4px"></button>`);
      const txt = () => { more.textContent = box.classList.contains('all') ? 'Show only the fields to fill in' : `All ${nx} values this graphic gets…`; };
      more.onclick = () => { box.classList.toggle('all'); allValues = box.classList.contains('all'); txt(); };
      box.classList.toggle('all', allValues); txt();
      box.appendChild(more);
    } else box.classList.remove('all');
    renderPresets();
    const first = box.querySelector('[data-k="' + CSS.escape(inputs[0] || '') + '"]:not(select)');
    if (first && inputs.length && !first.value) setTimeout(() => first.focus(), 0);
  }
  // ---------------------------------------------------------------- presets: a graphic with its values filled in, under a name
  const presetsOf = id => ((st() && st().presets) || []).filter(p => p.graphic === id);
  function applyPreset(p) {
    if (!def(p.graphic)) { CG.toast('That graphic is no longer loaded', 'err'); return; }
    select(p.graphic, Object.assign({}, p.params || {}), Object.assign({}, p.overrides || {}));
    $('#fields').dataset.keys = '';
  }
  function renderPresets() {
    const box = $('#presets'); if (!box) return;
    const list = sel ? presetsOf(sel.id) : [];
    box.innerHTML = list.map(p => `<span class="btn sm" data-pre="${esc(p.id)}" style="display:inline-flex;gap:6px;align-items:center">${esc(p.name)}<b data-del title="Delete this preset" style="opacity:.6">✕</b></span>`).join('');
    $$('[data-pre]', box).forEach(b => b.onclick = async e => {
      const p = list.find(x => x.id === b.dataset.pre); if (!p) return;
      if (e.target.closest('[data-del]')) { CG.gfx('presets', { list: st().presets.filter(x => x.id !== p.id) }); return; }
      applyPreset(p);
    });
  }
  $('#btn-save-preset').onclick = async () => {
    if (!sel || !data) { CG.toast('Select a graphic first', 'err'); return; }
    const d = def(sel.id), m = merged();
    // what is kept: everything typed or chosen here, plus the fields this graphic is filled in by hand
    const keep = Object.assign({}, sel.overrides);
    (d.inputs || []).forEach(k => { if (!(k in keep) && d.user && m[k] != null && !d.live) keep[k] = String(m[k]); });
    const guess = keep.layout ? String(keep.layout).replace(/[_-]+/g, ' ') : (keep.line1 || keep.title || d.name);
    const r = await CG.modal('Save as preset', `<label class="f"><span>Name of the preset</span><input type="text" name="name" value="${esc(String(guess).slice(0, 40))}" autofocus></label>
      <p class="small muted">Saves the ${Object.keys(keep).length} value${Object.keys(keep).length === 1 ? '' : 's'} you set here for "${esc(d.name)}". Values you did not touch keep following the match. The preset appears above the Data fields and under Captions / Custom → Presets.</p>`, { ok: 'Save' });
    if (!r || !String(r.name || '').trim()) return;
    const all = ((st() && st().presets) || []).filter(p => !(p.graphic === sel.id && p.name.toLowerCase() === String(r.name).trim().toLowerCase()));
    CG.gfx('presets', { list: all.concat([{ name: String(r.name).trim(), graphic: sel.id, params: sel.params, overrides: keep }]) });
    CG.toast('Preset saved', 'ok');
  };
  CG.on('state', () => renderPresets());

  $('#btn-reset-ovr').onclick = () => { if (sel) { sel.overrides = {}; $('#fields').dataset.keys = ''; renderFields(); pushPreview(); } };

  // ---------------------------------------------------------------- in-browser preview
  const pv = $('#preview');
  const scaleFrame = () => { if (frame) frame.style.transform = `scale(${pv.clientWidth / 1920})`; };
  new ResizeObserver(scaleFrame).observe(pv);

  function pushPreview() {
    if (!sel || !data) return;
    const d = def(sel.id);
    if (frameTemplate !== d.template) {
      if (frame) frame.remove();
      frameReady = false; framePlayed = false;
      frameTemplate = d.template;
      frame = document.createElement('iframe');
      frame.src = `templates/${d.template}.html` + (CG.pcQuery || '');
      frame.onload = () => { frameReady = true; framePlayed = false; sendToFrame(); };
      pv.appendChild(frame);
      scaleFrame();
      $('#preview-ph').textContent = 'Loading template…';
      return;
    }
    sendToFrame();
  }

  function sendToFrame() {
    if (!frame || !frameReady || !sel || !data) return;
    const w = frame.contentWindow;
    try {
      if (typeof w.update !== 'function') throw new Error('no update()');
      w.update(JSON.stringify(merged()));
      if (!framePlayed && typeof w.play === 'function') { w.play(); framePlayed = true; }
      $('#preview-ph').textContent = '';
    } catch (e) {
      $('#preview-ph').innerHTML = `Preview unavailable for <span class="mono">${esc(frameTemplate)}</span>.<br>The template isn't in the server's templates folder (it may only exist on the CasparCG machine).`;
    }
  }

  // ---------------------------------------------------------------- actions
  function payload(preview) {
    return { id: sel.id, params: sel.params, overrides: sel.overrides, preview: !!preview };
  }
  function take() { if (sel) CG.gfx('show', payload(false)); }
  // Ctrl+Enter in a field: changes the graphic if it is on air already, otherwise takes it
  function takeOrUpdate() {
    if (!sel) return;
    const on = st() && st().gfx.onAir.some(e => e.graphicId === sel.id && !e.preview);
    if (on) { CG.gfx('update', payload(false)); CG.toast('Updated on air', 'ok'); } else take();
  }
  $('#btn-take').onclick = take;
  $('#btn-pvw').onclick = () => { if (sel) CG.gfx('show', payload(true)); };
  $('#btn-update').onclick = () => { if (sel) CG.gfx('update', payload(false)); };
  $('#btn-out').onclick = () => { if (sel) CG.gfx('hide', { id: sel.id }); };
  $('#btn-hideall').onclick = () => CG.gfx('hideAll', { includePreview: false });
  $('#btn-clear-pvw').onclick = () => {
    (st() ? st().gfx.onAir : []).filter(e => e.preview).forEach(e => CG.gfx('hideKey', { key: e.key }));
  };

  function renderOnAir() {
    const box = $('#onair'), list = st().gfx.onAir;
    box.innerHTML = list.length ? '' : '<span class="muted small">Nothing on air</span>';
    list.forEach(e => {
      const it = h(`<div class="onair-item ${e.preview ? 'pv' : ''}"><span class="badge ${e.preview ? '' : 'live'}" style="${e.preview ? 'background:var(--green)' : ''}">${e.preview ? 'PVW' : 'PGM'}</span>
        <span><b>${esc(e.name)}</b> <span class="ly">${e.key}</span></span>
        <button class="btn sm" data-next title="Template next()">NEXT</button><button class="btn sm" data-out>OUT</button></div>`);
      $('[data-out]', it).onclick = () => CG.gfx('hideKey', { key: e.key });
      $('[data-next]', it).onclick = () => CG.gfx('invoke', { key: e.key, method: 'next' });
      $('b', it).style.cursor = 'pointer';
      $('b', it).onclick = () => select(e.graphicId, e.params || {}, e.overrides || {});
      box.appendChild(it);
    });
    renderInvokes();
  }
  // The selected graphic is in Program: its invoke buttons (set on the template in RFP Manager), NEXT, and a box for any other method.
  const btnTitle = v => (v.actions || []).map(a => ({ invoke: `invoke ${a.method}`, show: 'take', hide: 'take off', update: 'update', set: `set ${a.field}`, amcp: 'AMCP command', wait: `wait ${a.ms} ms`, macro: 'macro', device: `${a.target} ${a.method}` })[a.do] + (a.target && def(a.target) ? ' → ' + def(a.target).name : '')).join('  +  ');
  // the values in the Data panel go along with a press, for the graphic they belong to
  const freshFor = id => (sel && data && sel.id === id ? { params: sel.params, overrides: sel.overrides } : undefined);
  function renderInvokes() {
    const box = $('#invokes'); if (!box) return;
    const e = sel && st() ? st().gfx.onAir.find(x => x.graphicId === sel.id && !x.preview) : null;
    if (!e) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const list = (def(sel.id) || {}).invokes || [];
    const sig = e.key + '|' + JSON.stringify(list);
    if (box.dataset.sig === sig && box.style.display !== 'none') return;         // keep what is being typed
    box.dataset.sig = sig; box.style.display = 'flex';
    box.innerHTML = `<span class="small muted" style="letter-spacing:.06em">INVOKE</span>${list.map((v, i) => `<button class="btn sm" data-inv="${i}" title="${esc(btnTitle(v))}">${esc(v.label)}</button>`).join('')}
      <button class="btn sm" data-next title="Template next()">NEXT</button>
      <button class="btn sm ghost" id="inv-more" title="Type any other method of the template">…</button>
      <span id="inv-other" style="display:none;gap:6px;flex:1 1 100%"><input type="text" id="inv-free" placeholder="other method, e.g. page(2)" style="flex:1;min-width:90px;padding:4px 6px;font-size:12px"><button class="btn sm" id="inv-go" title="Invoke the method typed here">Send</button></span>`;
    $('#inv-more', box).onclick = () => { const o = $('#inv-other', box); o.style.display = o.style.display === 'none' ? 'flex' : 'none'; if (o.style.display !== 'none') $('#inv-free', box).focus(); };
    $$('[data-inv]', box).forEach(b => b.onclick = () => CG.gfx('button', { graphic: sel.id, index: Number(b.dataset.inv), key: e.key, fresh: freshFor(sel.id) }));
    $('[data-next]', box).onclick = () => CG.gfx('invoke', { key: e.key, method: 'next', fresh: freshFor(sel.id) });
    const go = () => { const m = $('#inv-free', box).value.trim(); if (m) CG.gfx('invoke', { key: e.key, method: m, fresh: freshFor(sel.id) }); };
    $('#inv-go', box).onclick = go;
    $('#inv-free', box).onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); go(); } };
  }

  document.addEventListener('click', e => { $$('details.pill-menu[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('a')) d.removeAttribute('open'); }); });

  // ---------------------------------------------------------------- keyboard
  document.addEventListener('keydown', e => {
    if (document.querySelector('.modal')) return;
    const typing = e.target.matches('input,textarea,select');
    if (e.key === 'Escape' && e.shiftKey) { e.preventDefault(); $('#btn-hideall').click(); return; }
    if (typing) return;
    if (e.key === 'Enter') { e.preventDefault(); take(); }
    else if (e.key === 'Escape') { e.preventDefault(); $('#btn-out').click(); }
    else if (e.key === 'F2') { e.preventDefault(); $('#btn-pvw').click(); }
    else if (e.key === 'F4') { e.preventDefault(); $('#btn-update').click(); }
  });

  renderCenter();
  CG.connect('control');
})();
