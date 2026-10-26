/* CricketCG – scorer for the other sports (rules in js/sports.js). */
(function () {
  'use strict';
  const { $, $$, esc, h } = CG;
  const U = Sports.U;

  let page = new URLSearchParams(location.search).get('page') || CG.store.get('sportPage', 'score');
  let statsOpen = CG.store.get('sportStatsOpen', '') === '1';
  let askPlayer = CG.store.get('sportStatsAsk', '1') === '1';
  const pend = { serve2: false, net: { A: false, B: false } };   // tennis: details of the point being played
  let draft = null;          // setup being edited on the Setup tab
  let draftDirty = false;
  let athEdit = null;        // athletics event id being edited in setup
  let focusNext = '';        // athletics: the result box to go to after Enter

  const sm = () => CG.state && CG.state.sport;
  const view = () => CG.sportView();
  const hasEvent = () => !!(sm() && sm().setup && sm().setup.sport);

  // ================================================================ tabs
  $$('#tabs .tab').forEach(t => t.onclick = async () => {
    if (page === 'setup' && t.dataset.page !== 'setup' && draftDirty && canScoreHere()) {
      if (!(await saveSetup(true))) CG.toast('The setup is not saved yet: press Save setup', 'err');
    }
    page = t.dataset.page; CG.store.set('sportPage', page); render();
  });

  // ================================================================ committing changes (optimistic concurrency)
  let waiters = [];
  CG.on('state', () => { waiters.splice(0).forEach(f => f()); render(); });
  const nextState = () => new Promise(r => { waiters.push(r); setTimeout(r, 1500); });

  function derivedOf(v) {
    return {
      kind: v.kind, timing: v.timing, sinbins: v.sinbins, lastEvent: v.lastEvent, periodLabel: v.periodLabel, score: v.score,
      players: v.players.map(p => ({ id: p.id, team: p.team, name: p.name, tvName: p.tvName, number: p.number, position: p.position,
        statsText: p.statsText, teamName: p.teamName || '', result: p.result || '', rank: p.rank === undefined ? '' : String(p.rank) })),
    };
  }

  /** Apply a mutation to (setup, events), recompute and send. Retries on version conflicts. */
  async function commit(mutate, newEventId) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = sm();
      const setup = U.clone(cur && cur.setup && cur.setup.sport ? cur.setup : Sports.newSetup('rugby'));
      const events = U.clone((cur && cur.events) || []);
      if (mutate(setup, events) === false) return null;
      let v;
      try { v = Sports.compute(setup, events); } catch (e) { CG.toast('Rules error: ' + e.message, 'err'); return null; }
      const last = v.timeline[v.timeline.length - 1];
      const wipe = newEventId && last && last.id === newEventId && v.lastEvent ? (v.lastEvent.wipe || '') : '';
      try {
        await CG.send('sport', 'apply', { version: cur ? cur.version : 0, setup, events, derived: derivedOf(v), flat: v.flat, wipe });
        return v;
      } catch (e) {
        if (e.message !== 'VERSION_CONFLICT') { if (e.message !== 'offline') CG.toast(e.message, 'err'); return null; }
        await nextState();
      }
    }
    CG.toast('Another scorer is updating at the same time – try again', 'err');
    return null;
  }

  /** Time stamp for timed sports: continuous game time (for sin bins) and a display time. */
  function stamp() {
    const v = view();
    if (!v || v.kind !== 'timed') return {};
    const ms = CG.clockMs('game');
    const g = v.clock.game;
    const ct = g.dir > 0 && v.timing.continuous ? `${Math.floor(ms / 60000) + 1}'` : `${v.table.cols[v.timing.period - 1] || ''} ${CG.fmtClock(ms)}`.trim();
    return { gt: Sports.gameTime(v, ms), ct, period: v.timing.period };
  }

  function addEvent(ev) {
    const id = U.id();
    return commit((setup, events) => { events.push(Object.assign({ id, t: Date.now() }, stamp(), ev)); }, id);
  }
  const removeEvent = id => commit((setup, events) => { const i = events.findIndex(e => e.id === id); if (i < 0) return false; events.splice(i, 1); });

  // ---------------------------------------------------------------- clocks
  const clock = (action, extra) => CG.send('sport', 'clock', Object.assign({ name: 'game', action }, extra || {})).catch(() => { });
  function resetClockFor(v, name) {
    const c = v && v.clock[name || 'game'];
    if (!c) return;
    CG.send('sport', 'clock', { name: name || 'game', action: 'reset', dir: c.dir, limitMs: c.limitMs, startMs: c.startMs, stopAtLimit: !!c.stopAtLimit }).catch(() => { });
  }
  function parseClock(s) {
    const m = String(s || '').trim().match(/^(\d+)(?::(\d{1,2}))?(?:\.(\d))?$/);
    if (!m) return null;
    return m[2] !== undefined ? (+m[1] * 60 + +m[2]) * 1000 + (m[3] ? +m[3] * 100 : 0) : +m[1] * 60000;
  }
  // athletics: the race clock with decimals (setup.ath.clockDigits, hundredths unless chosen), drawn every frame
  const raceDigits = () => { const s0 = sm() && sm().setup; if (!s0 || s0.sport !== 'athletics') return null; const n = s0.ath && s0.ath.clockDigits; return n === undefined || n === null || n === '' ? 2 : Math.max(0, Math.min(3, +n || 0)); };
  let lastTick = 0;
  function tickClocks(now) {
    const dg = raceDigits();
    if (dg >= 2 || now - lastTick >= 100) {
      lastTick = now;
      $$('[data-sclock]').forEach(el => {
        const name = el.dataset.sclock, c = sm() && sm().clocks && sm().clocks[name];
        const t = dg !== null && name === 'game' ? CG.raceClock(CG.clockMs(name), dg) : CG.fmtClock(CG.clockMs(name), name === 'shot' ? 10 : (c && c.direction < 0 && view() && view().sport === 'basketball' ? 60 : 0));
        if (el.textContent !== t) el.textContent = t;
        el.classList.toggle('run', !!(c && c.ticking));
      });
    }
    requestAnimationFrame(tickClocks);
  }
  requestAnimationFrame(tickClocks);

  // ================================================================ player picker
  function pickPlayer(team, title, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const v = view();
      const players = (v ? v.players : []).filter(p => !team || p.team === team);
      const back = h(`<div class="modal-back"><div class="modal" style="width:min(760px,96vw)"><h3>${esc(title)}</h3>
        <div class="pgrid">${players.map(p => `<button class="btn" data-id="${esc(p.id)}"><b>${esc(p.number)}</b>${esc(p.tvName)}</button>`).join('')}</div>
        ${players.length ? '' : '<p class="muted">No players in this squad – add them on the Setup tab.</p>'}
        <div class="modal-actions">${opts.allowNone !== false ? '<button class="btn" data-id="">No player / team only</button>' : ''}<button class="btn ghost" data-cancel>Cancel</button></div></div></div>`);
      const done = v2 => { back.remove(); document.removeEventListener('keydown', key, true); resolve(v2); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', key, true);
      back.addEventListener('click', e => {
        const b = e.target.closest('[data-id]');
        if (b) done(b.dataset.id);
        else if (e.target.closest('[data-cancel]') || e.target === back) done(null);
      });
      document.body.appendChild(back);
    });
  }

  // ================================================================ render
  function render() {
    $$('#tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
    $$('.page').forEach(s => s.classList.toggle('active', s.id === 'page-' + page));
    const st = CG.state;
    if (!st) return;
    const v = view();
    const live = st.mode === 'sport';
    const mb = $('#btn-mode');
    mb.textContent = live ? 'LIVE EVENT ✓' : 'MAKE LIVE EVENT';
    mb.className = 'btn sm ' + (live ? 'go' : 'warn');
    $('#matchline').innerHTML = v ? `${esc(v.name)} · ${esc(v.flat.match_line)}<span class="sub">${esc(v.periodLabel)} · ${esc(v.status)}</span>` : 'No sport event yet – set one up on the Setup tab';
    if (st.rfp && st.rfp.pullError) $('#matchline').innerHTML += `<span class="sub" style="color:var(--red)">${esc(st.rfp.pullError)}</span>`;
    if (page === 'score') renderScore(v);
    if (page === 'setup') renderSetup(v);
    if (page === 'timeline') renderTimeline(v);
    if (page === 'stats') renderStats(v);
    if (page === 'entry') renderEntry(v);
    // athletics: photo-finish systems and timers (Timing tab)
    const ath = !!(v && v.kind === 'athletics');
    $('#tab-timing').hidden = !ath;
    if (page === 'timing' && !ath && v) { page = 'score'; CG.store.set('sportPage', page); render(); return; }
    if (page === 'timing' && window.RFPTimingUI) window.RFPTimingUI.show($('#timing-root')); else if (window.RFPTimingUI) window.RFPTimingUI.hide();
  }

  $('#btn-mode').onclick = () => {
    const live = CG.state && CG.state.mode === 'sport';
    CG.send('sport', 'mode', { mode: live ? 'cricket' : 'sport' }).then(() => CG.toast(live ? 'Cricket is the live event again' : 'This sport is now the live event', 'ok')).catch(() => { });
  };

  // ---------------------------------------------------------------- SCORE
  function header(v, extra) {
    const t = v.teams;
    return `<div class="panel"><div class="board">
      <div class="tm">${CG.badge(t.A, 64)}<span class="sw" style="background:${esc(t.A.color1)}"></span><span class="up">${esc(U.up(t.A.name))}</span></div>
      <div class="mid"><div class="sc">${esc(v.score.A)}<span>–</span>${esc(v.score.B)}</div><div class="per">${esc(v.periodLabel)}</div><div class="st">${esc(v.status)}</div></div>
      <div class="tm b"><span class="up">${esc(U.up(t.B.name))}</span><span class="sw" style="background:${esc(t.B.color1)}"></span>${CG.badge(t.B, 64)}</div>
    </div>${extra || ''}</div>`;
  }

  function renderScore(v) {
    const root = $('#score-root');
    if (root.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return;
    if (!v) {
      root.innerHTML = `<div class="banner info"><span class="grow">No sport event set up yet.</span><button class="btn primary" id="go-setup">Set up an event</button></div>`;
      $('#go-setup').onclick = () => { page = 'setup'; CG.store.set('sportPage', page); render(); };
      return;
    }
    const common = `<div class="row" style="margin-top:12px"><button class="btn" id="btn-undo">↶ Undo <span class="kbd">Ctrl+Z</span></button>
      <button class="btn" id="btn-note2">+ Note</button><span class="grow"></span>
      ${v.finished ? '<span class="badge live">FINISHED</span>' : '<button class="btn warn" id="btn-end">End match</button>'}</div>`;
    if (v.kind === 'timed') root.innerHTML = timedHtml(v) + common;
    else if (v.kind === 'sets') root.innerHTML = setsHtml(v) + common;
    else if (v.kind === 'baseball') root.innerHTML = baseballHtml(v) + common;
    else if (v.kind === 'athletics') root.innerHTML = athleticsHtml(v) + common.replace(/<button class="btn warn" id="btn-end">End match<\/button>/, '');
    root.appendChild(h(`<div class="panel" style="margin-top:12px"><h4>Latest</h4><table class="t" id="recent"></table></div>`));
    $('#recent').innerHTML = v.timeline.slice(-8).reverse().map(e => `<tr><td class="mono muted">${esc(e.ct || '')}</td><td>${e.team ? `<span class="badge" style="background:${esc(v.teams[e.team].color1)}">${esc(v.teams[e.team].short)}</span>` : ''}</td><td>${esc(e.text)}</td>
      <td class="n"><button class="btn sm ghost" data-del="${esc(e.id)}" title="Delete this event">✕</button></td></tr>`).join('') || '<tr><td class="muted">Nothing yet</td></tr>';
    wireCommon(v);
    if (v.kind === 'timed') wireTimed(v);
    if (v.kind === 'sets') wireSets(v);
    if (v.kind === 'baseball') wireBaseball(v);
    if (v.kind === 'athletics') {
      wireAthletics(v);
      if (focusNext) { const b = document.querySelector(`tr[data-entry="${CSS.escape(focusNext)}"] [data-res]`); focusNext = ''; if (b) { b.focus(); b.select(); } }
    }
  }

  function wireCommon(v) {
    const u = $('#btn-undo'); if (u) u.onclick = () => CG.send('sport', 'undo', {}).then(() => CG.toast('Undone', 'ok')).catch(e => CG.toast(e.message, 'err'));
    const e = $('#btn-end'); if (e) e.onclick = async () => {
      const r = await CG.modal('End match', '<p>Mark the match as finished?</p>', { ok: 'End match', danger: true });
      if (r) { await addEvent({ type: 'end' }); if (v.kind === 'timed') clock('stop'); }
    };
    const n = $('#btn-note2'); if (n) n.onclick = addNote;
    $$('[data-del]', $('#score-root')).forEach(b => b.onclick = () => removeEvent(b.dataset.del));
  }

  async function addNote() {
    const r = await CG.modal('Add note to timeline', `<label class="f"><span>Text</span><input type="text" name="text" autofocus></label>
      <label class="f"><span>Team</span><select name="team"><option value="">—</option><option value="A">${esc(view().teams.A.name)}</option><option value="B">${esc(view().teams.B.name)}</option></select></label>`);
    if (r && r.text) addEvent({ type: 'note', text: r.text, team: r.team || '' });
  }

  // ---------------------------------------------------------------- timed sports
  function clockPanel(v) {
    const shot = v.clock.shot;
    return `<div class="row" style="justify-content:center;margin-top:12px;gap:14px">
      <div class="clock" data-sclock="game">--:--</div>
      <button class="btn go lg" id="ck-toggle">START / STOP <span class="kbd">Space</span></button>
      <button class="btn sm" data-adj="-60000">−1m</button><button class="btn sm" data-adj="-1000">−1s</button>
      <button class="btn sm" data-adj="1000">+1s</button><button class="btn sm" data-adj="60000">+1m</button>
      <button class="btn sm" id="ck-set">Set…</button><button class="btn sm" id="ck-reset" title="Reset to the start of this period">Reset period</button>
      <span class="grow"></span>
      <button class="btn primary" id="ck-next">Next period ▸</button>
    </div>
    ${shot ? `<div class="row" style="justify-content:center;margin-top:8px;gap:10px"><span class="muted">SHOT CLOCK</span><span class="shotclock" data-sclock="shot">--</span>
      <button class="btn sm" data-shot="toggle">Start/Stop</button><button class="btn sm" data-shot="full">${shot.limitMs / 1000}</button>${shot.reset2 ? `<button class="btn sm" data-shot="short">${shot.reset2 / 1000}</button>` : ''}</div>` : ''}`;
  }

  function timedHtml(v) {
    const actions = Sports.actions(v.sport, v.variant, v.options);
    const cards = Sports.cards(v.sport);
    const isBB = v.sport === 'basketball';
    const soActive = !!Sports.SPORTS[v.sport].shootout && v.timing && (sm().events || []).some(e => e.type === 'period' && e.to > v.options.periods);
    const col = k => {
      const t = v.teams[k];
      const scoreBtns = actions.filter(a => !a.type).map(a => `<button class="btn ${a.btn === 'big' ? 'big primary' : ''}" data-act="${a.key}" data-team="${k}">${esc(a.label)}${a.pts ? ` <span class="muted">+${a.pts}</span>` : ''}</button>`).join('');
      const otherBtns = actions.filter(a => a.type && a.group !== 'stats').map(a => `<button class="btn sm" data-act="${a.key}" data-kind="${a.type}" data-team="${k}">${esc(a.label)}</button>`).join('');
      const cardBtns = cards.map(c => `<button class="btn sm" data-card="${c.key}" data-team="${k}" style="border-color:${c.color || { yellow: '#f4c20d', red: '#e5484d', green: '#2ea043' }[c.key] || ''}">${esc(c.label)}</button>`).join('');
      const extra = (isBB ? `<button class="btn sm" data-foul="${k}">Foul</button><button class="btn sm" data-to="${k}">Timeout</button>` : '')
        + `<button class="btn sm" data-sub="${k}">Substitution</button><button class="btn sm" data-adjs="${k}" data-d="1">+1 fix</button><button class="btn sm" data-adjs="${k}" data-d="-1">−1 fix</button>`
        + (soActive ? `<button class="btn sm go" data-so="${k}" data-s="1">SO goal</button><button class="btn sm" data-so="${k}" data-s="0">SO miss</button>` : '');
      const inf = [];
      if (isBB) inf.push(`TEAM FOULS ${v.extra.teamFouls[k]}`, `TIMEOUTS ${v.extra.timeouts[k]}`, v.extra.bonus && v.extra.bonus[k] ? 'IN BONUS' : '');
      if (v.extra.centrePass === k) inf.push('CENTRE PASS');
      const gtNow = Sports.gameTime(v, CG.clockMs('game'));
      v.sinbins.forEach(s => { if (s.team === k && s.untilGt > gtNow) inf.push(`${s.card.toUpperCase()}: ${s.number ? '#' + s.number + ' ' : ''}${s.name}`); });
      return `<div class="panel teamcol"><h4>${CG.badge(t, 22)}<span class="sw" style="background:${esc(t.color1)}"></span> ${esc(U.up(t.name))}<span class="sp"></span><span class="small">${esc(inf.filter(Boolean).join(' · '))}</span></h4>
        <div class="actgrid">${scoreBtns}</div><div class="row" style="margin-top:8px">${otherBtns}</div>
        <div class="row" style="margin-top:8px">${cardBtns}${extra}</div></div>`;
    };
    const hasStats = actions.some(a => a.group === 'stats') || (v.shareDefs || []).length;
    return header(v, clockPanel(v)) + `<div class="grid cols-2" style="margin-top:12px">${col('A')}${col('B')}</div>`
      + (hasStats ? `<div class="panel" style="margin-top:12px"><h4>Match statistics <span class="sp"></span><button class="btn sm" id="stats-toggle">${statsOpen ? 'Hide' : 'Show'}</button></h4>
        ${statsOpen ? statsEntryHtml(v, false) : '<div class="muted small">Tackles, turnovers, set pieces, possession and the rest. Open this panel to record them here, or use the Stats entry tab on a second screen.</div>'}</div>` : '');
  }

  // ---------------------------------------------------------------- detailed statistics (same buttons on the scorer panel and the Stats entry tab)
  function statsEntryHtml(v, big) {
    const actions = Sports.actions(v.sport, v.variant, v.options).filter(a => a.group === 'stats' || (big && a.type));
    const cats = [];
    actions.forEach(a => { const c = a.cat || 'General'; if (!cats.includes(c)) cats.push(c); });
    const shares = (v.shareDefs || []).map(d => {
      const sh = (v.extra.shares || {})[d.key] || { A: 0, B: 0, cur: '', any: false };
      const b = (k, label) => `<button class="btn ${big ? '' : 'sm'} ${sh.cur === k ? 'on' : ''}" data-share="${d.key}" data-team="${k}">${esc(label)}${k && sh.any ? ` <b>${sh[k]}%</b>` : ''}</button>`;
      return `<div class="row" style="margin-bottom:8px"><span class="muted" style="min-width:90px">${esc(U.up(d.label))}</span>${b('A', v.teams.A.short)}${b('B', v.teams.B.short)}${b('', 'Nobody / stopped')}</div>`;
    }).join('');
    const col = k => `<div><div class="muted small" style="margin-bottom:6px;display:flex;align-items:center;gap:6px">${CG.badge(v.teams[k], 22)}<span class="sw" style="display:inline-block;width:10px;height:12px;border-radius:2px;background:${esc(v.teams[k].color1)}"></span> ${esc(U.up(v.teams[k].name))}</div>
      ${cats.map(c => `<div class="statcat"><span>${esc(c)}</span><div class="statgrid ${big ? 'big' : ''}">${actions.filter(a => (a.cat || 'General') === c).map(a =>
        `<button class="btn ${big ? '' : 'sm'}" data-stat="${a.key}" data-kind="${a.type}" data-team="${k}">${esc(a.label)} <b>${(v.raw && v.raw[k][a.stat || a.key]) || 0}</b></button>`).join('')}</div></div>`).join('')}</div>`;
    return `${shares}<div class="row" style="margin-bottom:8px"><label class="chk"><input type="checkbox" class="stats-ask" ${askPlayer ? 'checked' : ''}> Ask which player (off = team totals only, one click per stat)</label></div>
      <div class="grid cols-2">${col('A')}${col('B')}</div>`;
  }
  function wireStatsEntry(v, root) {
    const actions = Sports.actions(v.sport, v.variant, v.options);
    const ask = $(".stats-ask", root); if (ask) ask.onchange = () => { askPlayer = ask.checked; CG.store.set('sportStatsAsk', askPlayer ? '1' : '0'); };
    $$('[data-stat]', root).forEach(b => b.onclick = async () => {
      const a = actions.find(x => x.key === b.dataset.stat), team = b.dataset.team;
      let player = '';
      if (a.player && askPlayer) { player = await pickPlayer(team, `${a.label} – ${v.teams[team].name}`); if (player === null) return; }
      addEvent({ type: a.type, key: a.key, team, player });
    });
    $$('[data-share]', root).forEach(b => b.onclick = () => addEvent({ type: 'share', key: b.dataset.share, team: b.dataset.team }));
  }
  function renderEntry(v) {
    const root = $('#entry-root');
    if (!v) { root.innerHTML = '<div class="banner info"><span class="grow">No match yet.</span></div>'; return; }
    if (v.kind !== 'timed') {
      root.innerHTML = `<div class="panel"><h4>Statistics</h4><p class="muted">For ${esc(v.name.toLowerCase())}, statistics come from how each point is recorded on the Score tab (ace, winner, error, second serve, net point). The Stats tab shows the full table.</p></div>`;
      return;
    }
    root.innerHTML = header(v, `<div class="row" style="justify-content:center;margin-top:10px"><div class="clock" data-sclock="game" style="font-size:36px">--:--</div></div>`)
      + `<div class="panel" style="margin-top:12px"><h4>Statistics entry <span class="sp"></span><button class="btn sm" id="entry-undo">↶ Undo last</button></h4>${statsEntryHtml(v, true)}</div>`;
    wireStatsEntry(v, root);
    $('#entry-undo').onclick = () => CG.send('sport', 'undo', {}).then(() => CG.toast('Undone', 'ok')).catch(e => CG.toast(e.message, 'err'));
  }

  function wireTimed(v) {
    const actions = Sports.actions(v.sport, v.variant, v.options);
    const tg = $('#stats-toggle'); if (tg) tg.onclick = () => { statsOpen = !statsOpen; CG.store.set('sportStatsOpen', statsOpen ? '1' : ''); render(); };
    if (statsOpen) wireStatsEntry(v, $('#score-root'));
    $('#ck-toggle').onclick = () => clock('toggle');
    $$('[data-adj]').forEach(b => b.onclick = () => clock('adjust', { delta: +b.dataset.adj }));
    $('#ck-set').onclick = async () => {
      const r = await CG.modal('Set clock', `<label class="f"><span>Clock value (mm:ss)</span><input type="text" name="v" value="${CG.fmtClock(CG.clockMs('game'))}" autofocus></label>`);
      const ms = r && parseClock(r.v);
      if (ms != null) clock('set', { ms });
    };
    $('#ck-reset').onclick = () => resetClockFor(v, 'game');
    $('#ck-next').onclick = async () => {
      const next = v.timing.period + (v.periodLabel === 'FULL TIME' ? 0 : 1);
      const periods = v.options.periods;
      const label = next <= periods ? `period ${next}` : 'extra time / overtime';
      const r = await CG.modal('Next period', `<p>Stop the clock and start <b>${esc(label)}</b>?</p>`, { ok: 'Start next period' });
      if (!r) return;
      clock('stop');
      const nv = await addEvent({ type: 'period', to: (sm().events || []).filter(e => e.type === 'period').reduce((a, e) => Math.max(a, e.to || 0), 1) + 1 });
      if (nv) { resetClockFor(nv, 'game'); if (nv.clock.shot) resetClockFor(nv, 'shot'); }
    };
    $$('[data-shot]').forEach(b => b.onclick = () => {
      const s = v.clock.shot;
      if (b.dataset.shot === 'toggle') CG.send('sport', 'clock', { name: 'shot', action: 'toggle' }).catch(() => { });
      else CG.send('sport', 'clock', { name: 'shot', action: 'reset', dir: -1, limitMs: s.limitMs, startMs: b.dataset.shot === 'full' ? s.limitMs : s.reset2, stopAtLimit: true }).then(() => {
        if (sm().clocks.game && sm().clocks.game.running) CG.send('sport', 'clock', { name: 'shot', action: 'start' });
      }).catch(() => { });
    });
    $$('[data-act]').forEach(b => b.onclick = async () => {
      const a = actions.find(x => x.key === b.dataset.act), team = b.dataset.team;
      let player = '';
      if (a.player) { player = await pickPlayer(team, `${a.label} – ${v.teams[team].name}`); if (player === null) return; }
      addEvent({ type: a.type || 'score', key: a.key, team, player });
    });
    $$('[data-card]').forEach(b => b.onclick = async () => {
      const team = b.dataset.team, c = Sports.cards(v.sport).find(x => x.key === b.dataset.card);
      const player = await pickPlayer(team, `${c.label} – ${v.teams[team].name}`); if (player === null) return;
      addEvent({ type: 'card', key: c.key, team, player });
    });
    $$('[data-foul]').forEach(b => b.onclick = async () => {
      const team = b.dataset.foul, player = await pickPlayer(team, `Foul – ${v.teams[team].name}`); if (player === null) return;
      addEvent({ type: 'foul', team, player });
    });
    $$('[data-to]').forEach(b => b.onclick = () => { addEvent({ type: 'timeout', team: b.dataset.to }); clock('stop'); });
    $$('[data-sub]').forEach(b => b.onclick = async () => {
      const team = b.dataset.sub;
      const on = await pickPlayer(team, `Player ON – ${v.teams[team].name}`, { allowNone: false }); if (!on) return;
      const off = await pickPlayer(team, `Player OFF – ${v.teams[team].name}`); if (off === null) return;
      addEvent({ type: 'sub', team, on, off });
    });
    $$('[data-adjs]').forEach(b => b.onclick = () => addEvent({ type: 'adjust', team: b.dataset.adjs, delta: +b.dataset.d }));
    $$('[data-so]').forEach(b => b.onclick = async () => {
      const team = b.dataset.so, player = await pickPlayer(team, 'Shoot-out taker'); if (player === null) return;
      addEvent({ type: 'shootout', team, scored: b.dataset.s === '1', player });
    });
  }

  // ---------------------------------------------------------------- sets sports
  function setsHtml(v) {
    const x = v.extra, t = v.teams, racket = v.sport === 'tennis' || v.sport === 'padel';
    const table = `<table class="t" style="margin-top:12px"><tr><th></th><th></th>${v.table.cols.map(c => `<th class="n">${esc(c)}</th>`).join('')}<th class="n">${racket ? 'GAMES' : ''}</th><th class="n">PTS</th></tr>
      ${['A', 'B'].map(k => `<tr><td class="srvdot">${x.server === k ? '●' : ''}</td><td>${CG.badge(t[k], 22)} <b>${esc(U.up(t[k].name))}</b></td>${v.table[k].map(c => `<td class="n">${esc(c)}</td>`).join('')}
        <td class="n"><b>${racket && x.games ? x.games[k] : ''}</b></td><td class="n" style="font-size:22px"><b>${esc(x.points[k])}</b></td></tr>`).join('')}</table>`;
    const flag = x.flag ? `<div class="banner warn" style="margin-top:10px"><span class="grow">${esc(x.flag)}${x.flagTeam ? ' – ' + esc(U.up(t[x.flagTeam].name)) : ''}</span></div>` : '';
    const hows = racket
      ? k => `<button class="btn sm" data-pt="${k}" data-how="ace" ${x.server !== k ? 'disabled' : ''}>Ace</button><button class="btn sm" data-pt="${k}" data-how="winner">Winner</button>
              <button class="btn sm" data-pt="${U.other(k)}" data-how="df" ${x.server !== k ? 'disabled' : ''}>Double fault</button><button class="btn sm" data-pt="${U.other(k)}" data-how="ue">Unforced error</button><button class="btn sm" data-pt="${U.other(k)}" data-how="fe">Forced error</button>`
      : k => Sports.hows(v.sport).map(([key, label]) => `<button class="btn sm" data-pt="${k}" data-how="${key}">${esc(label)}</button>`).join('')
        + (v.sport === 'volleyball' ? `<button class="btn sm" data-to="${k}">Timeout (${x.timeouts ? x.timeouts[k] : 0})</button>` : '');
    const col = k => `<div class="panel"><h4>${CG.badge(t[k], 22)}${esc(U.up(t[k].name))}<span class="sp"></span><button class="btn sm ghost" data-srv="${k}">Set as server</button></h4>
      <button class="btn primary bigpt" style="width:100%" data-pt="${k}" data-how="">POINT ${esc(U.up(t[k].short))} <span class="kbd">${k === 'A' ? 'Q' : 'P'}</span></button>
      <div class="row" style="margin-top:8px">${hows(k)}</div>
      ${racket ? `<div class="row" style="margin-top:8px">${x.server === k ? `<button class="btn sm ${pend.serve2 ? 'on' : ''}" data-serve2 title="First serve was a fault: the next point counts as played on the second serve">1st serve fault</button>` : ''}
        <button class="btn sm ${pend.net[k] ? 'on' : ''}" data-net="${k}" title="This side came to the net during the point">At the net</button></div>` : ''}
      ${v.sport !== 'tennis' && v.sport !== 'padel' ? `<div class="row" style="margin-top:8px"><button class="btn sm" data-scard="${k}" data-key="yellow">Yellow card</button><button class="btn sm" data-scard="${k}" data-key="red">Red card</button></div>` : ''}</div>`;
    return header(v, table + flag + `<div class="row" style="margin-top:10px"><button class="btn sm" id="btn-ovr">Correct score…</button>${x.note ? `<span class="badge fh">${esc(x.note)}</span>` : ''}</div>`)
      + `<div class="grid cols-2" style="margin-top:12px">${col('A')}${col('B')}</div>`;
  }

  function wireSets(v) {
    $$('[data-pt]').forEach(b => b.onclick = () => {
      const ev = { type: 'point', team: b.dataset.pt, how: b.dataset.how || '' };
      if (v.sport === 'tennis' || v.sport === 'padel') { ev.serve = pend.serve2 || ev.how === 'df' ? 2 : 1; ev.net = (pend.net.A ? 'A' : '') + (pend.net.B ? 'B' : ''); pend.serve2 = false; pend.net = { A: false, B: false }; }
      addEvent(ev);
    });
    $$('[data-serve2]').forEach(b => b.onclick = () => { pend.serve2 = !pend.serve2; render(); });
    $$('[data-net]').forEach(b => b.onclick = () => { pend.net[b.dataset.net] = !pend.net[b.dataset.net]; render(); });
    $$('[data-srv]').forEach(b => b.onclick = () => addEvent({ type: 'server', team: b.dataset.srv }));
    $$('[data-to]').forEach(b => b.onclick = () => addEvent({ type: 'timeout', team: b.dataset.to }));
    $$('[data-scard]').forEach(b => b.onclick = async () => {
      const team = b.dataset.scard, player = await pickPlayer(team, 'Card'); if (player === null) return;
      addEvent({ type: 'card', team, key: b.dataset.key, player });
    });
    $('#btn-ovr').onclick = async () => {
      const racket = v.sport === 'tennis' || v.sport === 'padel', x = v.extra;
      const r = await CG.modal('Correct the current score', `<p class="small muted">Completed ${racket ? 'sets' : 'games/sets'} can be fixed by deleting points in the timeline or with Undo.</p>
        <div class="form-grid">
          ${racket ? `<label class="f"><span>Games ${esc(v.teams.A.short)}</span><input type="number" name="gamesA" value="${x.games.A}"></label><label class="f"><span>Games ${esc(v.teams.B.short)}</span><input type="number" name="gamesB" value="${x.games.B}"></label>` : ''}
          <label class="f"><span>Points ${esc(v.teams.A.short)} ${racket ? '(0,1,2,3,4 = 0/15/30/40/AD)' : ''}</span><input type="number" name="pointsA" value="${racket && !x.tiebreak ? ({ '0': 0, '15': 1, '30': 2, '40': 3, AD: 4 })[x.points.A] : x.points.A}"></label>
          <label class="f"><span>Points ${esc(v.teams.B.short)}</span><input type="number" name="pointsB" value="${racket && !x.tiebreak ? ({ '0': 0, '15': 1, '30': 2, '40': 3, AD: 4 })[x.points.B] : x.points.B}"></label>
          ${racket ? `<label class="chk"><input type="checkbox" name="tiebreak" ${x.tiebreak ? 'checked' : ''}> In a tie-break</label>` : ''}
        </div>`, { ok: 'Apply correction' });
      if (!r) return;
      addEvent({ type: 'override', gamesA: r.gamesA, gamesB: r.gamesB, pointsA: r.pointsA, pointsB: r.pointsB, tiebreak: !!r.tiebreak });
    };
  }

  // ---------------------------------------------------------------- baseball
  function baseballHtml(v) {
    const x = v.extra, t = v.teams;
    const table = `<table class="t" style="margin-top:12px"><tr><th></th>${v.table.cols.map(c => `<th class="n">${esc(c)}</th>`).join('')}${v.table.extraCols.map(c => `<th class="n">${c}</th>`).join('')}</tr>
      ${['A', 'B'].map(k => `<tr class="${x.batting === k ? 'hl' : ''}"><td><b>${esc(U.up(t[k].short))}</b></td>${v.table[k].map(c => `<td class="n">${esc(c)}</td>`).join('')}${v.table['extra' + k].map(c => `<td class="n"><b>${esc(c)}</b></td>`).join('')}</tr>`).join('')}</table>`;
    const fld = U.other(x.batting);
    const pitcherOpts = `<option value="">— pitcher —</option>` + t[fld].players.map(p => `<option value="${esc(p.id)}" ${x.pitcher && x.pitcher.id === p.id ? 'selected' : ''}>${esc(p.number ? '#' + p.number + ' ' : '')}${esc(p.name)}</option>`).join('');
    const batterOpts = t[x.batting].players.map((p, i) => `<option value="${i}" ${x.batter && x.batter.id === p.id ? 'selected' : ''}>${i + 1}. ${esc(p.number ? '#' + p.number + ' ' : '')}${esc(p.name)}</option>`).join('');
    const state = `<div class="grid cols-3" style="margin-top:12px;grid-template-columns:1fr 1fr 1fr">
      <div class="panel"><h4>Count</h4><div class="count">${x.balls}-${x.strikes}</div><div style="text-align:center" class="outs">${[1, 2].map(i => `<i class="${x.outs >= i ? 'on' : ''}"></i>`).join('')} <span class="muted">${x.outs} OUT</span></div></div>
      <div class="panel"><h4>Bases (click to toggle)</h4><div class="diamond">
        <span></span><button class="btn ${x.bases[1] ? 'on' : ''}" data-base="2"><span>2</span></button><span></span>
        <button class="btn ${x.bases[2] ? 'on' : ''}" data-base="3"><span>3</span></button><span></span><button class="btn ${x.bases[0] ? 'on' : ''}" data-base="1"><span>1</span></button></div></div>
      <div class="panel"><h4>At bat · pitching</h4>
        <label class="f"><span>Batter (${esc(t[x.batting].short)})</span><select id="bb-batter">${batterOpts || '<option>add a line-up in Setup</option>'}</select></label>
        <div class="small muted" style="margin:4px 0 8px">${x.batter ? esc(x.batter.line) : ''}</div>
        <label class="f"><span>Pitcher (${esc(t[fld].short)})${x.pitcher ? ` · ${x.pitcher.pitches} pitches` : ''}</span><select id="bb-pitcher">${pitcherOpts}</select></label></div></div>`;
    const btn = (attrs, label, cls) => `<button class="btn ${cls || ''}" ${attrs}>${label}</button>`;
    const pad = `<div class="grid cols-3" style="margin-top:12px;grid-template-columns:1fr 1fr 1fr">
      <div class="panel"><h4>Pitch</h4><div class="actgrid">${btn('data-pitch="ball"', 'Ball', 'big')}${btn('data-pitch="strike"', 'Strike', 'big')}${btn('data-pitch="foul"', 'Foul')}</div></div>
      <div class="panel"><h4>Reaches base</h4><div class="actgrid">${btn('data-hit="1"', 'Single', 'primary')}${btn('data-hit="2"', 'Double', 'primary')}${btn('data-hit="3"', 'Triple', 'primary')}${btn('data-hit="4"', 'Home run', 'danger')}
        ${btn('data-ev="walk"', 'Walk')}${btn('data-ev="hbp"', 'Hit by pitch')}${btn('data-ev="error"', 'Error')}${btn('data-run="1"', 'Run scores +1')}</div></div>
      <div class="panel"><h4>Out</h4><div class="actgrid">${btn('data-out="k"', 'Strikeout')}${btn('data-out="fly"', 'Fly out')}${btn('data-out="ground"', 'Ground out')}${btn('data-out="line"', 'Line out')}
        ${btn('data-out="dp"', 'Double play')}${btn('data-out="fc"', "Fielder's choice")}${btn('data-rout="1"', 'Runner out')}${btn('data-halfend="1"', 'End half-inning', 'warn')}</div></div></div>`;
    return header(v, table) + state + pad;
  }

  function wireBaseball(v) {
    const x = v.extra;
    $$('[data-pitch]').forEach(b => b.onclick = () => addEvent({ type: 'pitch', kind: b.dataset.pitch }));
    $$('[data-hit]').forEach(b => b.onclick = () => addEvent({ type: 'hit', bases: +b.dataset.hit }));
    $$('[data-ev]').forEach(b => b.onclick = () => addEvent({ type: b.dataset.ev }));
    $$('[data-out]').forEach(b => b.onclick = () => addEvent({ type: 'out', how: b.dataset.out }));
    $$('[data-run]').forEach(b => b.onclick = () => addEvent({ type: 'run', n: 1 }));
    $$('[data-halfend]').forEach(b => b.onclick = () => addEvent({ type: 'halfend' }));
    $$('[data-rout]').forEach(b => b.onclick = async () => {
      const r = await CG.modal('Runner out', `<label class="f"><span>From which base?</span><select name="base"><option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option></select></label>`);
      if (r) addEvent({ type: 'runner_out', base: +r.base });
    });
    $$('[data-base]').forEach(b => b.onclick = () => {
      const bases = x.bases.slice(); const i = +b.dataset.base - 1; bases[i] = !bases[i];
      addEvent({ type: 'bases', b1: bases[0], b2: bases[1], b3: bases[2] });
    });
    const bs = $('#bb-batter'); if (bs) bs.onchange = () => addEvent({ type: 'batter', team: x.batting, index: +bs.value });
    const ps = $('#bb-pitcher'); if (ps) ps.onchange = () => addEvent({ type: 'pitcher', team: U.other(x.batting), player: ps.value });
  }

  // ---------------------------------------------------------------- athletics
  const NOTES = ['', 'PB', 'SB', 'NR', 'AR', 'CR', 'MR', 'WR', 'Q', 'q', 'DNF', 'DNS', 'DQ'];
  function athleticsHtml(v) {
    const x = v.extra, c = x.current;
    const evBtns = x.events.map(e => `<button class="btn sm ${c && c.id === e.id ? 'on' : ''}" data-cur="${esc(e.id)}">${e.num ? `<span class="muted">#${esc(e.num)}</span> ` : ''}${esc(e.name)}${e.round ? ' · ' + esc(e.round) : ''} <span class="muted">(${e.results}/${e.entries})</span>${e.complete ? ' ✓' : ''}</button>`).join(' ');
    const auto = x.auto || {};
    const dg = x.clockDigits === undefined || x.clockDigits === null || x.clockDigits === '' ? 2 : +x.clockDigits;
    const clockRow = `<div class="row" style="justify-content:center;margin-top:12px;gap:14px"><span class="muted">RACE CLOCK</span><div class="clock" data-sclock="game" style="min-width:3.6em;text-align:right">--:--</div>
      <button class="btn go" id="ck-toggle">START / STOP <span class="kbd">Space</span></button><button class="btn" id="ck-zero">Reset to 0</button>
      <select id="ck-digits" style="width:auto" title="Decimals on the race clock (scorer and graphics)">${[[0, '9'], [1, '9.8'], [2, '9.87'], [3, '9.876']].map(([n, l]) => `<option value="${n}" ${n === dg ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    if (!c) return `<div class="panel"><h4>Events</h4><p class="muted">No events yet – add events and entries on the Setup tab.</p></div>` + clockRow;
    const field = c.kind === 'field';
    const head = `<div class="panel"><h4>Event <span class="sp"></span>${auto.mode === 'results' ? '<span class="badge" title="Set in graphics control → Athletics">AUTO NEXT</span> ' : ''}${esc(v.status)}</h4><div class="row">${evBtns}</div>${field ? '' : clockRow}</div>`;
    if (!field) {
      const rows = c.startlist.map(r => `<tr data-entry="${esc(r.id)}"><td class="n">${esc(r.lane)}</td><td class="muted">${esc(r.bib)}</td><td><b>${esc(r.tvName)}</b></td><td class="muted">${esc(r.team)}</td><td class="muted small">${esc(r.pb)}${r.sb ? ' / ' + esc(r.sb) : ''}</td>
        <td><input type="text" data-res style="width:100px" value="${esc(r.result)}" placeholder="10.23">${r.reaction ? ` <span class="small muted" title="Reaction time">RT ${esc(r.reaction)}</span>` : ''}</td>
        <td><select data-note>${NOTES.map(n => `<option ${n === r.note ? 'selected' : ''}>${n}</option>`).join('')}</select></td><td class="n"><b>${esc(r.rank || '')}</b></td><td><button class="btn sm ghost" data-lt="${esc(r.id)}" title="Lower third on air">LT</button></td></tr>`).join('');
      return head + `<div class="panel" style="margin-top:12px"><h4>${c.num ? 'EVENT ' + esc(c.num) + ' · ' : ''}${esc(U.up(c.name))} ${c.round ? '· ' + esc(U.up(c.round)) : ''} ${c.wind ? '· WIND ' + esc(c.wind) : ''}</h4>
        <table class="t"><tr><th class="n">Lane</th><th>Bib</th><th>Athlete</th><th>Team</th><th>PB / SB</th><th>Result</th><th>Note</th><th class="n">Pos</th><th></th></tr>${rows}</table>
        <p class="small muted">Type a time (10.23 or 1:45.32) and press Enter.</p></div>`;
    }
    // ---- field events: the athlete who is up, their attempt, then the next one
    const up = c.rows.find(r => r.id === c.up);
    const heights = (() => { const l = []; const lo = /pole/i.test(c.discipline || c.name) ? 100 : 60, hi = /pole/i.test(c.discipline || c.name) ? 650 : 260; for (let h = lo; h <= hi; h++) l.push((h / 100).toFixed(2)); return l; })();
    const chips = r => (r.attempts.length ? r.attempts : []).map(a => `<span class="att ${/X/i.test(a) ? 'x' : /-/.test(a) && !/\d/.test(a.replace(/-$/, '')) ? 'p' : /O|\d/.test(a) ? 'ok' : ''}">${esc(String(a).toUpperCase())}</span>`).join('') || '<span class="muted small">no attempts yet</span>';
    const settings = c.vertical
      ? `<span class="small muted">Bar</span><select id="fe-bar" style="width:auto"><option value="">–</option>${heights.map(hh => `<option ${hh === c.bar ? 'selected' : ''}>${hh}</option>`).join('')}</select><button class="btn sm" data-raise="0.03">+3 cm</button><button class="btn sm" data-raise="0.05">+5 cm</button><button class="btn sm" data-raise="0.10">+10 cm</button>`
      : `<span class="small muted">Round <b>${esc(c.attemptRound || '–')}</b> of</span><select id="fe-rounds" style="width:auto">${[3, 4, 5, 6].map(n => `<option ${n === c.rounds ? 'selected' : ''}>${n}</option>`).join('')}</select>
         <label class="row small" style="gap:4px"><input type="checkbox" id="fe-cut" ${c.cut ? 'checked' : ''}> Top 8 after round 3</label>`;
    const upPanel = `<div class="panel fe-up" style="margin-top:12px"><h4>Up now <span class="sp"></span>${settings}</h4>
      ${up ? `<div class="row" style="gap:16px;align-items:center;flex-wrap:wrap"><div class="fe-name">${esc(up.tvName)}</div><div class="muted">${esc(up.team)}${up.lane ? ' · order ' + esc(up.lane) : ''}</div>
          <div class="fe-chips">${chips(up)}</div>${up.best != null ? `<div>Best <b>${esc(up.best.toFixed(2))}</b>${up.rank ? ` · pos ${esc(up.rank)}` : ''}</div>` : ''}</div>
        <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
          ${c.vertical ? `<button class="btn go big" data-mk="O">O Clear</button><button class="btn danger big" data-mk="X">X Fail</button><button class="btn big" data-mk="-">– Pass</button><span class="muted small">at ${esc(c.bar || '–')} · try ${esc((up.atBar || '').length + 1)} of 3</span>`
            : `<input type="text" id="fe-mark" inputmode="decimal" placeholder="7.85" style="width:120px;font-size:20px" autocomplete="off"><button class="btn go big" id="fe-rec">Record</button><button class="btn danger big" data-mk="X">X Foul</button><button class="btn big" data-mk="-">– Pass</button>`}
          <span class="grow"></span><button class="btn" id="fe-skip">Skip ▶</button><button class="btn" id="fe-lt">LT on air</button></div>`
        : `<p class="muted">${c.complete ? 'The event is complete.' : c.vertical ? (c.bar ? 'Everyone still in has cleared or passed this height: raise the bar.' : 'Choose the starting height.') : 'Nobody is up.'}</p>`}</div>`;
    const rows = c.startlist.map(r => `<tr data-entry="${esc(r.id)}" class="${r.id === c.up ? 'hl' : ''} ${r.out || r.status ? 'out' : ''}"><td class="n">${esc(r.lane)}</td><td><b>${esc(r.tvName)}</b></td><td class="muted">${esc(r.team)}</td>
      <td class="fe-chips">${chips(r)}</td><td><b>${esc(r.result)}</b></td><td class="n"><b>${esc(r.rank || '')}</b></td>
      <td><select data-note>${NOTES.map(n => `<option ${n === r.note ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
      <td class="n" style="white-space:nowrap"><button class="btn sm" data-upnow="${esc(r.id)}" title="Make this athlete up now">Up</button><button class="btn sm ghost" data-undo="${esc(r.id)}" title="Remove the last attempt" ${r.attempts.length ? '' : 'disabled'}>↶</button><button class="btn sm ghost" data-lt="${esc(r.id)}" title="Lower third on air">LT</button></td></tr>`).join('');
    return head + upPanel + `<div class="panel" style="margin-top:12px"><h4>${c.num ? 'EVENT ' + esc(c.num) + ' · ' : ''}${esc(U.up(c.name))} ${c.round ? '· ' + esc(U.up(c.round)) : ''}</h4>
      <table class="t"><tr><th class="n">Order</th><th>Athlete</th><th>Team</th><th>Attempts</th><th>Best</th><th class="n">Pos</th><th>Note</th><th></th></tr>${rows}</table>
      <p class="small muted">${c.vertical ? 'O = cleared, X = failed, – = passed. Three failures in a row and the athlete is out; the best cleared height counts (ties: fewer failures).' : 'Type the mark and press Enter (or X / – for a foul or a pass). The next athlete comes up by themselves: fewest attempts first, in competition order.'}</p></div>`;
  }

  function wireAthletics(v) {
    const c = v.extra.current;
    const ck = $('#ck-toggle'); if (ck) ck.onclick = () => clock('toggle');
    const cd = $('#ck-digits'); if (cd) cd.onchange = () => CG.send('sport', 'athClock', { digits: +cd.value }).catch(e => CG.toast(e.message, 'err'));
    const cz = $('#ck-zero'); if (cz) cz.onclick = () => CG.send('sport', 'clock', { name: 'game', action: 'reset', dir: 1, limitMs: 0, startMs: 0, stopAtLimit: false }).catch(() => { });
    $$('[data-cur]').forEach(b => b.onclick = () => commit(setup => { setup.ath.current = b.dataset.cur; }));
    if (!c) return;
    $$('[data-lt]').forEach(b => b.onclick = () => {
      const on = (CG.state.gfx.onAir || []).some(e => !e.preview && e.graphicId === 'ath_athlete_lt' && e.params && String(e.params.playerId) === b.dataset.lt);
      CG.gfx(on ? 'hide' : 'show', on ? { id: 'ath_athlete_lt' } : { id: 'ath_athlete_lt', params: { playerId: b.dataset.lt } });
    });
    const ev = setup => setup.ath.events.find(e => e.id === c.id);
    $$('tr[data-entry]').forEach(tr => {
      const id = tr.dataset.entry;
      const res = $('[data-res]', tr), note = $('[data-note]', tr);
      const save = () => addEvent({ type: 'result', eventId: c.id, entry: id, value: res ? res.value.trim() : (v.extra.current.rows.find(r => r.id === id) || {}).result || '', note: note.value });
      if (res) {
        res.onkeydown = e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          res.onchange = null;
          const rows = $$('tr[data-entry]'), i = rows.indexOf(tr);
          focusNext = rows[i + 1] ? rows[i + 1].dataset.entry : '';
          res.blur();                                        // the screen updates once the box is left, then on to the next athlete
          save();
        };
        res.onchange = save;
      }
      if (c.kind === 'field') note.onchange = () => addEvent({ type: 'result', eventId: c.id, entry: id, value: '', note: note.value });
      else note.onchange = save;
    });
    if (c.kind !== 'field') return;
    const up = c.rows.find(r => r.id === c.up);
    const record = mark => {
      if (!up) return;
      let value = String(mark).trim().toUpperCase().replace(',', '.');
      if (!value) return;
      if (c.vertical) { if (!c.bar) { CG.toast('Choose the bar height first', 'err'); return; } value = `${c.bar} ${value}`; }
      else if (!/^(X|-|\d+(\.\d+)?)$/.test(value)) { CG.toast('A mark like 7.85, or X / –', 'err'); return; }
      const id = U.id();
      const mkEl = $('#fe-mark'); if (mkEl) { mkEl.value = ''; mkEl.blur(); }     // let the screen move on to the next athlete
      commit((setup, events) => { events.push({ id, t: Date.now(), type: 'attempt', eventId: c.id, entry: up.id, value }); const e = ev(setup); if (e) e.up = ''; }, id)
        .then(() => { const m2 = $('#fe-mark'); if (m2 && (!document.activeElement || document.activeElement === document.body)) m2.focus(); });
    };
    $$('[data-mk]').forEach(b => b.onclick = () => record(b.dataset.mk));
    const mk = $('#fe-mark');
    if (mk) {
      mk.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); record(mk.value); } };
      if (!document.activeElement || document.activeElement === document.body) setTimeout(() => mk.focus(), 30);
    }
    const rec = $('#fe-rec'); if (rec) rec.onclick = () => record(mk.value);
    const skip = $('#fe-skip'); if (skip) skip.onclick = () => {
      const act = c.startlist.filter(r => c.active.includes(r.id));
      const i = act.findIndex(r => r.id === c.up);
      const next = act[(i + 1) % act.length];
      if (next) commit(setup => { const e = ev(setup); if (e) e.up = next.id; });
    };
    const lt = $('#fe-lt'); if (lt) lt.onclick = () => CG.gfx('show', { id: 'ath_up_lt' });
    $$('[data-upnow]').forEach(b => b.onclick = () => commit(setup => { const e = ev(setup); if (e) e.up = b.dataset.upnow; }));
    $$('[data-undo]').forEach(b => b.onclick = () => commit((setup, events) => {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'attempt' && events[i].eventId === c.id && events[i].entry === b.dataset.undo) { events.splice(i, 1); return; }
      return false;
    }));
    const bar = $('#fe-bar'); if (bar) bar.onchange = () => commit(setup => { const e = ev(setup); if (e) { e.bar = bar.value; e.up = ''; } });
    $$('[data-raise]').forEach(b => b.onclick = () => commit(setup => { const e = ev(setup); if (!e) return false; const h0 = parseFloat(e.bar) || (/pole/i.test(c.discipline || c.name) ? 3.00 : 1.50); e.bar = (h0 + Number(b.dataset.raise)).toFixed(2); e.up = ''; }));
    const rounds = $('#fe-rounds'); if (rounds) rounds.onchange = () => commit(setup => { const e = ev(setup); if (e) e.rounds = Number(rounds.value); });
    const cut = $('#fe-cut'); if (cut) cut.onchange = () => commit(setup => { const e = ev(setup); if (e) e.cut = cut.checked ? 8 : 0; });
  }

  // ---------------------------------------------------------------- keyboard
  document.addEventListener('keydown', e => {
    if (page !== 'score' || document.querySelector('.modal-back')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); const u = $('#btn-undo'); if (u) u.click(); return; }
    if (e.target.matches('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const v = view(); if (!v) return;
    if (v.kind === 'athletics' && v.extra.current && v.extra.current.kind === 'field') {
      const k = e.key.toUpperCase(), b = document.querySelector(`[data-mk="${k === '-' ? '-' : k}"]`);
      if (b && ['X', 'O', '-'].includes(k)) { e.preventDefault(); b.click(); }
      return;
    }
    if (e.key === ' ' && (v.kind === 'timed' || v.kind === 'athletics')) { e.preventDefault(); clock('toggle'); }
    if (v.kind === 'sets' && (e.key === 'q' || e.key === 'Q')) addEvent({ type: 'point', team: 'A', how: '' });
    if (v.kind === 'sets' && (e.key === 'p' || e.key === 'P')) addEvent({ type: 'point', team: 'B', how: '' });
  });

  // ---------------------------------------------------------------- SETUP
  function renderSetup(v) {
    const root = $('#setup-root');
    if (draftDirty && root.childElementCount) return; // keep the operator's edits
    if (root.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return;
    draft = U.clone(hasEvent() ? sm().setup : Sports.newSetup('rugby'));
    if (draft.sport === 'athletics' && !draft.ath) draft.ath = { events: [], current: '' };
    buildSetup(root);
  }

  function buildSetup(root) {
    const d = draft, list = Sports.list(), sp = list.find(s => s.id === d.sport) || list[0];
    const kind = sp.kind;
    const opt = (k, def) => (d.options && d.options[k] !== undefined ? d.options[k] : def);
    root.innerHTML = `
      <div class="grid cols-2">
        <div class="panel"><h4>Event</h4>
          <div class="form-grid">
            <label class="f"><span>Sport</span><select id="s-sport">${list.map(s => `<option value="${s.id}" ${s.id === d.sport ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
            <label class="f"><span>Format</span><select id="s-variant">${sp.variants.map(x => `<option value="${x.id}" ${x.id === d.variant ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
            <label class="f"><span>Title / match</span><input type="text" data-k="title" value="${esc(d.title)}"></label>
            <label class="f"><span>Competition</span><input type="text" data-k="competition" value="${esc(d.competition)}"></label>
            <label class="f"><span>Venue</span><input type="text" data-k="venue" value="${esc(d.venue)}"></label>
            ${kind === 'sets' ? `<label class="f"><span>First to serve</span><select data-o="firstServer"><option value="A" ${opt('firstServer', 'A') === 'A' ? 'selected' : ''}>Team / player A</option><option value="B" ${opt('firstServer', 'A') === 'B' ? 'selected' : ''}>Team / player B</option></select></label>` : ''}
            ${d.sport === 'netball' ? `<label class="f"><span>First centre pass</span><select data-o="centreFirst"><option value="A" ${opt('centreFirst', 'A') === 'A' ? 'selected' : ''}>A</option><option value="B" ${opt('centreFirst', 'A') === 'B' ? 'selected' : ''}>B</option></select></label>` : ''}
            ${kind === 'timed' ? `<label class="f"><span>Clock</span><select data-o="clockDir"><option value="">Default</option><option value="up" ${opt('clockDir', '') === 'up' ? 'selected' : ''}>Counts up</option><option value="down" ${opt('clockDir', '') === 'down' ? 'selected' : ''}>Counts down</option></select></label>
              <label class="f"><span>Period length (min, blank = default)</span><input type="number" data-o="periodMin" data-num value="${esc(d.options && d.options.periodMin != null ? d.options.periodMin : '')}"></label>` : ''}
          </div>
          <div class="row" style="margin-top:12px"><button class="btn primary" id="s-save">Save setup</button><button class="btn ghost" id="s-discard">Discard edits</button><span class="grow"></span>
            <button class="btn danger" id="s-new">New match (clear score)</button></div>
          <p class="small muted">Saving keeps the score. Changing the sport or format starts a fresh score.</p>
        </div>
        <div><div class="panel"><h4>Commentators and officials</h4><div class="form-grid">
            <label class="f" style="grid-column:1/-1"><span>Commentators (one per line)</span><textarea id="s-comms" rows="3" placeholder="One per line">${esc((d.commentators || []).join('\n'))}</textarea></label>
            <div class="f" style="grid-column:1/-1"><span>Match officials</span>
              <div id="s-offs">${Sports.officialsOf(d).concat([{ role: '', name: '' }]).map(o => `<div class="row" style="flex-wrap:nowrap;margin-bottom:4px"><select data-orole style="max-width:240px">${roleOptions(d.sport, o.role)}</select><input type="text" data-oname value="${esc(o.name)}" placeholder="Name"></div>`).join('')}</div></div>
          </div><p class="small muted" style="margin:8px 0 0">Saved with "Save setup". They also come from the match in RFP Manager (Fixtures).</p></div>
        <div class="panel"><h4>Tips</h4><p class="small muted" style="margin:0">${tipsFor(d.sport)}</p></div></div>
      </div>
      ${kind === 'athletics' ? athSetupHtml(d) : `<div class="grid cols-2" style="margin-top:12px">${teamEditor('A')}${teamEditor('B')}</div>`}`;
    wireSetup(root);
  }

  function tipsFor(sport) {
    return ({
      rugby: 'Players: enter shirt numbers so scorers show as "#10 POLLARD". Yellow cards start a sin-bin timer that runs with the game clock (sevens: 2 min).',
      hockey: 'Green card = 2 min, yellow = 5 min suspension timers. Use "Next period" beyond the last quarter to start a shoot-out.',
      netball: 'Missed shots feed the shooting %. Centre pass alternates automatically after each goal and at each quarter.',
      basketball: 'Shot clock buttons reset to 24 / 14. Team fouls reset each quarter; the bonus shows from the 5th foul.',
      tennis: 'Q = point A, P = point B. Ace / double fault are only enabled for the server. Break, set and match points are flagged automatically.',
      padel: 'Q = point A, P = point B. Golden point is flagged at 40-40.',
      badminton: 'Rally scoring: the rally winner serves next. Intervals at 11 are flagged.',
      volleyball: 'Timeouts are counted per set. Change of courts is flagged in the deciding set.',
      baseball: 'Team A is the visiting team (bats first). Hits advance all runners by the same number of bases; fix runners with the base diamond.',
      athletics: 'Add events and entries below. Track results sort fastest first; field events use the best attempt.',
    })[sport] || '';
  }

  function teamEditor(k) {
    const t = draft.teams[k];
    return `<div class="panel" data-team="${k}"><h4>${k === 'A' ? 'Team / player A' : 'Team / player B'}${draft.sport === 'baseball' ? (k === 'A' ? ' (visitors)' : ' (home)') : ''}</h4>
      <div class="form-grid">
        <label class="f"><span>Name</span><input type="text" data-t="name" value="${esc(t.name)}"></label>
        <label class="f"><span>Short name</span><input type="text" data-t="short" value="${esc(t.short)}"></label>
        <label class="f"><span>Logo key</span><input type="text" data-t="logo" value="${esc(t.logo)}"></label>
        <label class="f"><span>Coach</span><input type="text" data-t="coach" value="${esc(t.coach)}"></label>
        <label class="f"><span>Colours</span><span class="row"><input type="color" data-t="color1" value="${esc(t.color1 || '#1f6feb')}"><input type="color" data-t="color2" value="${esc(t.color2 || '#ffffff')}"></span></label>
      </div><hr>
      <table class="t" data-players><tr><th>No.</th><th>Name</th><th>TV name</th><th>Position</th><th></th></tr>
        ${(t.players || []).map(p => playerRow(p)).join('')}</table>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-addp>+ Player</button><button class="btn sm" data-bulk>Bulk paste…</button></div></div>`;
  }
  const playerRow = p => `<tr data-pid="${esc(p.id || '')}"><td><input type="text" data-p="number" value="${esc(p.number == null ? '' : p.number)}" style="width:56px"></td>
    <td><input type="text" data-p="name" value="${esc(p.name || '')}"></td><td><input type="text" data-p="tvName" value="${esc(p.tvName || '')}" placeholder="auto"></td>
    <td><input type="text" data-p="position" value="${esc(p.position || '')}"></td><td><button class="btn sm ghost" data-delp>✕</button></td></tr>`;

  // ---- athletics setup: events are built from dropdowns (gender, age group, discipline, round, heat)
  const A = window.Athletics;
  const sel = (attr, list, cur, blank) => `<select ${attr}>${blank !== undefined ? `<option value="">${esc(blank)}</option>` : ''}${list.map(x => { const v = typeof x === 'string' ? x : x.value, l = typeof x === 'string' ? x : x.label; return `<option value="${esc(v)}" ${String(v) === String(cur == null ? '' : cur) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}${cur && !list.some(x => String(typeof x === 'string' ? x : x.value) === String(cur)) ? `<option selected>${esc(cur)}</option>` : ''}</select>`;
  const discSelect = (attr, cur) => `<select ${attr}><option value="">Choose…</option>${A.groups().map(g => `<optgroup label="${esc(g.group)}">${g.list.map(x => `<option ${x.name === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  function roleOptions(sport, cur) {
    const list = [...new Set([...Sports.officialRoles(sport), ...(sport === 'athletics' ? A.ROLES : ['Referee', 'Assistant referee', 'Umpire', 'Judge', 'Timekeeper', 'Scorer', 'Commissioner', 'Match commissioner', 'Technical official'])])];
    return `<option value="">Role…</option>` + list.concat(cur && !list.includes(cur) ? [cur] : []).map(r => `<option ${r === cur ? 'selected' : ''}>${esc(r)}</option>`).join('');
  }
  // an event's name and type follow from its dropdowns
  function athFix(e) {
    if (e.discipline) {
      const dd = A.byName(e.discipline);
      e.name = A.eventName(e);
      if (dd) e.kind = dd.kind;
      if (dd && !dd.wind) e.wind = '';
    }
    if (e.roundType !== undefined) e.round = A.roundLabel(e.roundType, e.heat);
    return e;
  }
  // events from older setups or a timing system: fill the dropdowns from the name
  function athUpgrade(e) {
    if (e.discipline !== undefined) return e;
    const p = A.parseEvent(`${e.name || ''} ${e.round || ''}`);
    Object.assign(e, { discipline: p.discipline, gender: p.gender, age: p.age || 'Open', roundType: p.round || (e.round ? '' : ''), heat: p.heat || '' });
    if (!p.discipline) { e.discipline = ''; }
    if (!p.round && e.round) { delete e.roundType; }
    return athFix(e);
  }
  function athKnown(d) {
    const people = new Map(), teams = new Set(), bibs = new Set();
    for (const e of d.ath.events) for (const en of e.entries || []) {
      if (en.name && !people.has(en.name)) people.set(en.name, en);
      if (en.team) teams.add(en.team);
      if (en.bib) bibs.add(en.bib);
    }
    ['A', 'B'].forEach(k => { const t = d.teams && d.teams[k]; if (t && t.name && !/^(HOME|AWAY)$/.test(t.name)) teams.add(t.name); });
    return { people, teams: [...teams].sort(), bibs: [...bibs] };
  }
  function athSetupHtml(d) {
    d.ath.events.forEach(athUpgrade);
    if (d.ath.events.length && d.ath.events.every(e => !e.num)) d.ath.events.forEach((e, i) => { e.num = String(i + 1); });   // older meets: number them in order
    const evs = d.ath.events;
    if (!athEdit || !evs.find(e => e.id === athEdit)) athEdit = evs.length ? evs[0].id : null;
    const e = evs.find(x => x.id === athEdit);
    const known = athKnown(d);
    const dd = e && A.byName(e.discipline);
    const field = e && e.kind === 'field';
    const numbered = e && A.NUMBERED.includes(e.roundType);
    return `<datalist id="a-people">${[...known.people.keys()].map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <datalist id="a-teams">${known.teams.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <datalist id="a-bibs">${known.bibs.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="grid cols-2" style="margin-top:12px">
      <div class="panel" data-nofold><h4>Events <span class="sp"></span><button class="btn sm" id="a-many">+ Several events</button><button class="btn sm" id="a-add">+ Event</button></h4>
        <table class="t"><tr><th>No.</th><th>Event</th><th>Gender</th><th>Age group</th><th>Round</th><th>Type</th><th>Entries</th><th></th></tr>${evs.map(x => `<tr class="click ${x.id === athEdit ? 'sel' : ''}" data-aev="${esc(x.id)}"><td class="muted">${esc(x.num || '')}</td><td><b>${esc(x.name)}</b></td><td class="muted">${esc(x.gender || '')}</td><td>${esc(x.age || 'Open')}</td><td class="muted">${esc(x.round || '')}</td><td class="muted">${x.kind === 'field' ? 'Field' : 'Track'}</td><td>${x.entries.length}</td><td class="n">${d.ath.current === x.id ? '<span class="badge live">CURRENT</span>' : ''}${x.timing ? ' <span class="badge" title="From the timing system">⏱</span>' : ''}</td></tr>`).join('') || '<tr><td class="muted" colspan="8">No events yet. Add them here, or let the timing system bring its start lists (Timing tab).</td></tr>'}</table></div>
      <div class="panel" data-nofold>${e ? `<h4>Edit event<span class="sp"></span><button class="btn sm" id="a-dup">Copy as next heat</button><button class="btn sm" id="a-cur">Make current</button><button class="btn sm ghost" id="a-del">Delete event</button></h4>
        <div class="form-grid">
          <label class="f"><span>Event no.</span>${sel('data-ae="num"', Array.from({ length: 300 }, (_, i) => String(i + 1)), e.num, '–')}</label>
          <label class="f"><span>Gender</span>${sel('data-ae="gender"', A.GENDERS, e.gender, 'Choose…')}</label>
          <label class="f"><span>Age group</span>${sel('data-ae="age"', A.AGES, e.age || 'Open')}</label>
          <label class="f"><span>Discipline</span>${discSelect('data-ae="discipline"', e.discipline)}</label>
          <label class="f"><span>Round</span>${sel('data-ae="roundType"', A.ROUNDS, e.roundType !== undefined ? e.roundType : e.round, 'None')}</label>
          ${numbered ? `<label class="f"><span>${e.roundType === 'Qualification' ? 'Group' : e.roundType === 'Race' ? 'Race' : 'Number'}</span>${sel('data-ae="heat"', A.HEATS.map(n => ({ value: n, label: e.roundType === 'Qualification' ? String.fromCharCode(64 + Number(n)) : n })), e.heat, '–')}</label>` : ''}
          ${!e.discipline ? `<label class="f"><span>Name (no discipline chosen)</span><input type="text" data-ae="name" value="${esc(e.name || '')}"></label><label class="f"><span>Type</span>${sel('data-ae="kind"', [{ value: 'track', label: 'Track (time)' }, { value: 'field', label: 'Field (distance / height)' }], e.kind || 'track')}</label>` : ''}
          ${!e.discipline || (dd && dd.wind) ? `<label class="f"><span>Wind (m/s)</span>${sel('data-ae="wind"', windList(), e.wind, '–')}</label>` : ''}
        </div>
        <p class="small muted" style="margin:6px 0 0">Shows as <b>${esc(e.name || '…')}</b>${e.round ? ' · ' + esc(e.round) : ''}${dd ? ` · ${dd.kind === 'field' ? 'field event, best mark counts' : 'track event, fastest time first'}` : ''}</p><hr>
        <table class="t" id="a-entries"><tr><th>${field ? 'Order' : 'Lane'}</th><th>Bib</th><th>Name</th><th>Team</th><th>PB</th><th>SB</th><th></th></tr>
          ${e.entries.map(en => `<tr data-eid="${esc(en.id)}"><td>${sel('data-en="lane"', field ? A.HEATS : A.LANES, en.lane, '–')}</td>
            <td><input type="text" data-en="bib" list="a-bibs" value="${esc(en.bib == null ? '' : en.bib)}" style="width:70px"></td>
            <td><input type="text" data-en="name" list="a-people" value="${esc(en.name || '')}" placeholder="Pick or type a name"></td>
            <td><input type="text" data-en="team" list="a-teams" value="${esc(en.team || '')}" style="width:120px" placeholder="Pick or type"></td>
            <td><input type="text" data-en="pb" value="${esc(en.pb || '')}" style="width:70px"></td><td><input type="text" data-en="sb" value="${esc(en.sb || '')}" style="width:70px"></td>
            <td><button class="btn sm ghost" data-dele>✕</button></td></tr>`).join('')}</table>
        <div class="row" style="margin-top:8px"><button class="btn sm" id="a-adde">+ Entry</button><button class="btn sm" id="a-fill">Fill lanes</button><button class="btn sm" id="a-bulk">Bulk paste…</button></div>` : '<p class="muted">Add an event to start.</p>'}</div></div>`;
  }
  function windList() { const l = []; for (let w = -50; w <= 50; w++) { const v = w / 10; l.push((v > 0 ? '+' : v === 0 ? '±' : '') + v.toFixed(1)); } return l.concat(['NWI']); }
  const nextNum = () => String(Math.max(0, ...draft.ath.events.map(e => parseInt(e.num, 10) || 0)) + 1);
  function newAthEvent(o) {
    return athFix(Object.assign({ id: U.id(), num: nextNum(), name: '', gender: '', age: 'Open', discipline: '', roundType: 'Final', heat: '', round: '', kind: 'track', wind: '', entries: [] }, o || {}));
  }

  // Saving the setup. quiet: leaving the Setup tab with changes saves them by itself (unless the sport or format changed,
  // which clears the score: that one is only done with "Save setup").
  async function saveSetup(quiet) {
    const root = $('#setup-root');
    if (!draft) return true;
    if (!canScoreHere()) { CG.toast(VIEW_ONLY, 'err'); return false; }
    collectDraft(root);
    const cur = sm() && sm().setup;
    const reset = !cur || !cur.sport || cur.sport !== draft.sport || cur.variant !== draft.variant;
    if (reset && sm() && (sm().events || []).length) {
      if (quiet) return false;
      const ok = await CG.modal('Change sport / format', '<p>Changing the sport or format clears the current score and timeline. Continue?</p>', { ok: 'Change and clear', danger: true });
      if (!ok) return false;
    }
    const d = U.clone(draft);
    // what graphics control or the timing system changed meanwhile (current event, automatic changes, clock) is kept
    const v = await commit((setup, events) => {
      const keep = quiet && setup.ath ? { current: setup.ath.current, auto: setup.ath.auto, clockDigits: setup.ath.clockDigits } : null;
      Object.keys(setup).forEach(k => delete setup[k]); Object.assign(setup, d);
      if (keep && setup.ath) Object.assign(setup.ath, Object.fromEntries(Object.entries(keep).filter(([, x]) => x !== undefined)));
      if (reset) events.length = 0;
    });
    if (v) {
      draftDirty = false; CG.toast('Setup saved', 'ok'); markDirty();
      if (reset) { resetClockFor(v, 'game'); if (v.clock.shot) resetClockFor(v, 'shot'); }
      if (!quiet && CG.state.mode !== 'sport') CG.toast('Tip: press MAKE LIVE EVENT so the graphics use this sport', '');
    }
    return !!v;
  }
  // "Save setup •" while there are changes that are not saved
  function markDirty() {
    const b = $('#s-save'); if (!b) return;
    b.textContent = draftDirty ? 'Save setup •' : 'Save setup';
    b.title = draftDirty ? 'There are changes that are not saved yet' : '';
  }
  // scoring is done in the RFP Manager app (production PC, or the Android app), not in a web browser
  const VIEW_ONLY = 'View only: scoring and setup are saved from the RFP Manager app (on the production PC or the Android app), not from a web browser.';
  const canScoreHere = () => !CG.rfp || CG.rfp.canScore !== false;
  function viewOnlyBanner() {
    let b = document.getElementById('view-only-banner');
    if (canScoreHere()) { if (b) b.remove(); return; }
    if (b) return;
    b = h(`<div id="view-only-banner" class="banner warn" style="margin:12px 12px 0;padding:10px 14px;border-radius:8px;background:#5a4300;color:#ffe08a;font-weight:600"></div>`);
    b.textContent = VIEW_ONLY + ' Open this match in RFP Manager on the production PC to make changes.';
    const main = document.querySelector('main'); main.parentNode.insertBefore(b, main);
  }
  CG.on('rfp', viewOnlyBanner);

  function collectDraft(root) {
    $$('[data-k]', root).forEach(i => { draft[i.dataset.k] = i.value; });
    const cm = $('#s-comms', root); if (cm) draft.commentators = cm.value.split('\n').map(x => x.trim()).filter(Boolean);
    const ob = $('#s-offs', root); if (ob) draft.officials = $$('.row', ob).map(r => ({ role: r.querySelector('[data-orole]').value.trim(), name: r.querySelector('[data-oname]').value.trim() })).filter(o => o.role || o.name);
    draft.options = draft.options || {};
    $$('[data-o]', root).forEach(i => {
      const k = i.dataset.o;
      if (i.value === '') delete draft.options[k];
      else draft.options[k] = i.hasAttribute('data-num') ? +i.value : i.value;
    });
    $$('[data-team]', root).forEach(box => {
      const k = box.dataset.team, t = draft.teams[k];
      $$('[data-t]', box).forEach(i => { t[i.dataset.t] = i.value; });
      t.players = $$('tr[data-pid]', box).map(tr => {
        const g = f => $(`[data-p="${f}"]`, tr).value.trim();
        return { id: tr.dataset.pid || U.id(), number: g('number'), name: g('name'), tvName: g('tvName'), position: g('position') };
      }).filter(p => p.name);
    });
    if (draft.sport === 'athletics' && athEdit) {
      const e = draft.ath.events.find(x => x.id === athEdit);
      if (e) {
        $$('[data-ae]', root).forEach(i => { e[i.dataset.ae] = i.value; });
        if (!A.NUMBERED.includes(e.roundType)) e.heat = '';
        athFix(e);
        e.entries = $$('tr[data-eid]', root).map(tr => {
          const en = { id: tr.dataset.eid || U.id() };
          $$('[data-en]', tr).forEach(i => { en[i.dataset.en] = i.value.trim(); });
          return en;
        }).filter(en => en.name);
      }
    }
  }

  function wireSetup(root) {
    const dirty = () => { draftDirty = true; markDirty(); };
    root.addEventListener('input', dirty);
    root.addEventListener('change', dirty);
    markDirty();
    $('#s-sport').onchange = e => {
      collectDraft(root);
      const keepTeams = draft.teams;
      draft = Object.assign(Sports.newSetup(e.target.value), { title: draft.title, competition: draft.competition, venue: draft.venue, commentators: draft.commentators || [], officials: (draft.officials || []).some(o => o.name) ? draft.officials : undefined, teams: keepTeams });
      if (draft.sport === 'athletics' && !draft.ath) draft.ath = { events: [], current: '' };
      draftDirty = true; buildSetup(root);
    };
    $('#s-variant').onchange = e => { collectDraft(root); draft.variant = e.target.value; draftDirty = true; };
    $('#s-discard').onclick = () => { draftDirty = false; renderSetup(view()); };
    $('#s-save').onclick = () => saveSetup(false);
    $('#s-new').onclick = async () => {
      const ok = await CG.modal('New match', '<p>Clear the score and timeline and keep the setup (teams, players, format)?</p>', { ok: 'Clear score', danger: true });
      if (!ok) return;
      const v = await commit((setup, events) => { events.length = 0; });
      if (v) { resetClockFor(v, 'game'); if (v.clock.shot) resetClockFor(v, 'shot'); CG.toast('New match started', 'ok'); }
    };
    $$('[data-team]', root).forEach(box => {
      const tbl = $('[data-players]', box);
      $('[data-addp]', box).onclick = () => { tbl.appendChild(h(`<table>${playerRow({})}</table>`).querySelector('tr')); dirty(); wireRows(); };
      $('[data-bulk]', box).onclick = async () => {
        const r = await CG.modal('Bulk paste players', `<p class="small muted">One per line: <span class="mono">number | Full Name | TV NAME | position</span>, or just <span class="mono">7 Full Name</span>. Replaces the list.</p><textarea name="text" rows="14"></textarea>`, { ok: 'Use list' });
        if (!r) return;
        $$('tr[data-pid]', tbl).forEach(tr => tr.remove());
        r.text.split('\n').map(x => x.trim()).filter(Boolean).forEach(line => {
          let parts = line.split('|').map(x => x.trim());
          if (parts.length === 1) { const m = line.match(/^(\d+)[\s.)-]+(.+)$/); parts = m ? [m[1], m[2]] : ['', line]; }
          tbl.appendChild(h(`<table>${playerRow({ number: parts[0], name: parts[1] || '', tvName: parts[2] || '', position: parts[3] || '' })}</table>`).querySelector('tr'));
        });
        dirty(); wireRows();
      };
    });
    const wireRows = () => $$('[data-delp]', root).forEach(b => b.onclick = () => { b.closest('tr').remove(); dirty(); });
    wireRows();
    // athletics
    const aAdd = $('#a-add');
    const cur0 = () => draft.ath.events.find(x => x.id === athEdit);
    if (aAdd) aAdd.onclick = () => { collectDraft(root); const p = cur0(); const e = newAthEvent(p ? { gender: p.gender, age: p.age } : {}); draft.ath.events.push(e); athEdit = e.id; if (!draft.ath.current) draft.ath.current = e.id; dirty(); buildSetup(root); };
    // a field that changes the event (discipline, round, …): rebuild so the name, the heat and the wind follow
    $$('[data-ae]', root).forEach(i => { i.onchange = () => { collectDraft(root); dirty(); buildSetup(root); }; });
    // a known athlete: bib and team come with the name
    $$('tr[data-eid] [data-en="name"]', root).forEach(i => i.onchange = () => {
      const p = athKnown(draft).people.get(i.value.trim()), tr = i.closest('tr');
      if (!p) return;
      ['bib', 'team', 'pb', 'sb'].forEach(k => { const f = $(`[data-en="${k}"]`, tr); if (f && !f.value && p[k]) f.value = p[k]; });
      dirty();
    });
    const aDup = $('#a-dup'); if (aDup) aDup.onclick = () => {
      collectDraft(root);
      const p = cur0(); if (!p) return;
      const roundType = A.NUMBERED.includes(p.roundType) ? p.roundType : 'Heat';
      const heat = String((Number(p.heat) || (A.NUMBERED.includes(p.roundType) ? 1 : 0)) + 1);
      if (!A.NUMBERED.includes(p.roundType)) { p.roundType = 'Heat'; p.heat = '1'; athFix(p); }
      const e = newAthEvent({ num: p.num, gender: p.gender, age: p.age, discipline: p.discipline, kind: p.kind, roundType, heat });
      draft.ath.events.splice(draft.ath.events.indexOf(p) + 1, 0, e); athEdit = e.id; dirty(); buildSetup(root);
    };
    const aMany = $('#a-many'); if (aMany) aMany.onclick = async () => {
      collectDraft(root);
      let form = null;
      const chk = (name, list, on) => `<div class="row" style="flex-wrap:wrap;gap:4px 14px">${list.map(x => `<label class="row" style="gap:4px"><input type="checkbox" name="${name}" value="${esc(x)}" ${on.includes(x) ? 'checked' : ''}> ${esc(x)}</label>`).join('')}</div>`;
      const r = await CG.modal('Add several events', `<div class="form-grid">
          <label class="f"><span>Discipline</span>${discSelect('name="discipline"', '')}</label>
          <label class="f"><span>Round</span>${sel('name="roundType"', A.ROUNDS, 'Final')}</label>
          <label class="f"><span>How many (heats, groups, races)</span>${sel('name="count"', A.HEATS, '1')}</label></div>
        <p class="small muted" style="margin:10px 0 4px">Gender</p>${chk('gender', A.GENDERS, ['Men', 'Women'])}
        <p class="small muted" style="margin:10px 0 4px">Age groups</p>${chk('age', A.AGES, ['Open'])}
        <p class="small muted" style="margin:10px 0 0">One event is made for every gender and age group ticked (and every heat).</p>`, { ok: 'Add events', onOpen: f => { form = f; } });
      if (!r || !r.discipline) return;
      const pick = n => $$(`input[name="${n}"]`, form).filter(c => c.checked).map(c => c.value);
      const genders = pick('gender').length ? pick('gender') : [''], ages = pick('age').length ? pick('age') : ['Open'];
      const n = A.NUMBERED.includes(r.roundType) ? Number(r.count) || 1 : 1;
      let first = null;
      for (const g of genders) for (const a of ages) for (let i = 1; i <= n; i++) {
        const e = newAthEvent({ gender: g, age: a, discipline: r.discipline, roundType: r.roundType, heat: A.NUMBERED.includes(r.roundType) && n > 1 ? String(i) : '' });
        draft.ath.events.push(e); if (!first) first = e;
      }
      if (first) { athEdit = first.id; if (!draft.ath.current) draft.ath.current = first.id; }
      dirty(); buildSetup(root);
    };
    const aFill = $('#a-fill'); if (aFill) aFill.onclick = () => {
      collectDraft(root);
      const e = cur0(); if (!e) return;
      const free = (e.kind === 'field' ? A.HEATS : A.LANES).filter(l => !e.entries.some(x => x.lane === l));
      e.entries.forEach(x => { if (!x.lane && free.length) x.lane = free.shift(); });
      dirty(); buildSetup(root);
    };
    $$('[data-aev]', root).forEach(tr => tr.onclick = () => { collectDraft(root); athEdit = tr.dataset.aev; buildSetup(root); });
    const aCur = $('#a-cur'); if (aCur) aCur.onclick = () => { collectDraft(root); draft.ath.current = athEdit; dirty(); buildSetup(root); };
    const aDel = $('#a-del'); if (aDel) aDel.onclick = () => { draft.ath.events = draft.ath.events.filter(e => e.id !== athEdit); if (draft.ath.current === athEdit) draft.ath.current = draft.ath.events[0] ? draft.ath.events[0].id : ''; athEdit = null; dirty(); buildSetup(root); };
    const aAddE = $('#a-adde'); if (aAddE) aAddE.onclick = () => {
      collectDraft(root);
      const e = draft.ath.events.find(x => x.id === athEdit);
      const free = (e.kind === 'field' ? A.HEATS : A.LANES).find(l => !e.entries.some(x => x.lane === l)) || '';
      e.entries.push({ id: U.id(), lane: free, bib: '', name: '', team: '', pb: '', sb: '', _new: true });
      dirty(); buildSetup(root);
      const last = $$('tr[data-eid] [data-en="name"]', root).pop(); if (last) last.focus();
    };
    $$('[data-dele]', root).forEach(b => b.onclick = () => { b.closest('tr').remove(); dirty(); });
    const aBulk = $('#a-bulk'); if (aBulk) aBulk.onclick = async () => {
      const r = await CG.modal('Bulk paste entries', `<p class="small muted">One per line: <span class="mono">lane | Name | Team | PB | SB | bib</span>. Replaces the entries of this event.</p><textarea name="text" rows="12"></textarea>`, { ok: 'Use list' });
      if (!r) return;
      collectDraft(root);
      const e = draft.ath.events.find(x => x.id === athEdit);
      e.entries = r.text.split('\n').map(x => x.trim()).filter(Boolean).map(line => {
        const p = line.split('|').map(x => x.trim());
        return { id: U.id(), lane: p[0] || '', name: p[1] || '', team: p[2] || '', pb: p[3] || '', sb: p[4] || '', bib: p[5] || '' };
      });
      dirty(); buildSetup(root);
    };
  }

  // ---------------------------------------------------------------- TIMELINE / STATS
  function renderTimeline(v) {
    const evs = (sm() && sm().events) || [];
    const byId = {};
    if (v) v.timeline.forEach(e => { byId[e.id] = e; });
    $('#tl').innerHTML = `<tr><th>#</th><th>Time</th><th>Team</th><th>Event</th><th></th></tr>` + evs.slice().reverse().map((e, i) => {
      const t = byId[e.id];
      const desc = t ? t.text : [e.type, e.key || e.how || e.kind || '', e.value || ''].filter(Boolean).join(' ').toUpperCase();
      const team = e.team && v ? v.teams[e.team] : null;
      return `<tr><td class="muted">${evs.length - i}</td><td class="mono">${esc(e.ct || (t && t.ct) || '')}</td><td>${team ? `<span class="badge" style="background:${esc(team.color1)}">${esc(team.short)}</span>` : ''}</td><td>${esc(desc)}</td>
        <td class="n"><button class="btn sm ghost" data-del="${esc(e.id)}">✕</button></td></tr>`;
    }).join('');
    $$('[data-del]', $('#tl')).forEach(b => b.onclick = async () => {
      const ok = await CG.modal('Delete event', '<p>Delete this event? Everything after it is recalculated.</p>', { ok: 'Delete', danger: true });
      if (ok) removeEvent(b.dataset.del);
    });
  }
  $('#btn-note').onclick = () => { if (view()) addNote(); };

  // Every counted statistic per player, in the order the sport defines them.
  function playerColumns(v) {
    if (v.kind !== 'timed') return [];
    const cols = [{ key: 'points', label: 'PTS' }], seen = new Set(['points']);
    Sports.actions(v.sport, v.variant, v.options).filter(a => a.player).forEach(a => {
      const key = a.stat || a.key;
      if (seen.has(key)) return; seen.add(key);
      cols.push({ key, label: a.abbr || U.up(a.label).replace(/[^A-Z0-9 ]/g, '').split(' ').map(w => w.slice(0, 3)).join(' ').slice(0, 7), title: a.label });
    });
    Sports.cards(v.sport).forEach(c => cols.push({ key: c.key + '_cards', label: U.up(c.key).slice(0, 3), title: c.label }));
    return cols.filter(c => v.players.some(p => p.stats && p.stats[c.key]));
  }
  function statsCsv(v) {
    const q = x => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`;
    const cols = playerColumns(v);
    const lines = [['TEAM STATISTICS'], ['Stat', v.teams.A.name, v.teams.B.name], ...v.teamStats.map(s => [s.label, s.a, s.b]), [],
      ['PLAYER STATISTICS'], ['Team', 'No.', 'Player', 'Position', ...cols.map(c => c.title || c.label), 'Summary'],
      ...v.players.map(p => [p.team ? v.teams[p.team].name : p.teamName || '', p.number, p.name, p.position || '', ...cols.map(c => (p.stats && p.stats[c.key]) || 0), p.statsText || '']), [],
      ['TIMELINE'], ['Time', 'Team', 'Event'], ...v.timeline.map(e => [e.ct || '', e.team ? v.teams[e.team].name : '', e.text])];
    return '\ufeff' + lines.map(r => r.map(q).join(',')).join('\r\n');
  }
  function renderStats(v) {
    if (!v) { $('#tstats').innerHTML = ''; $('#pstats').innerHTML = ''; return; }
    $('#tstats').innerHTML = `<tr><th>Stat</th><th class="n">${CG.badge(v.teams.A, 26)} ${esc(v.teams.A.short)}</th><th class="n">${CG.badge(v.teams.B, 26)} ${esc(v.teams.B.short)}</th></tr>` +
      v.teamStats.map(s => `<tr><td>${esc(s.label)}</td><td class="n"><b>${esc(s.a)}</b></td><td class="n"><b>${esc(s.b)}</b></td></tr>`).join('');
    const cols = playerColumns(v);
    $('#pstats').innerHTML = `<tr><th>No.</th><th>Player</th><th>Team</th>${cols.map(c => `<th class="n" title="${esc(c.title || '')}">${esc(c.label)}</th>`).join('')}${cols.length ? '' : '<th>Stats</th>'}</tr>` +
      v.players.map(p => `<tr><td class="muted">${esc(p.number)}</td><td><b>${esc(p.tvName)}</b></td><td class="muted">${p.team ? CG.badge(v.teams[p.team], 16) + ' ' : ''}${esc(p.team ? v.teams[p.team].short : p.teamName || '')}</td>
        ${cols.length ? cols.map(c => `<td class="n">${(p.stats && p.stats[c.key]) || ''}</td>`).join('') : `<td>${esc(p.statsText || '')}${p.result ? ' · ' + esc(p.result) : ''}</td>`}</tr>`).join('');
    const ex = $('#stats-export');
    if (ex) ex.onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([statsCsv(v)], { type: 'text/csv' }));
      a.download = `${v.teams.A.short}-v-${v.teams.B.short}-stats.csv`.replace(/[^\w.-]+/g, '_');
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }

  render();
  CG.connect('sport');
})();
