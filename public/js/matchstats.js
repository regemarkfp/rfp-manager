/* The match centre on the public website: a scoreboard, what happened (scores, cards, substitutions), team statistics,
 * players and line-ups, or the full scorecard for cricket. Used on /match/<id> and under the video on watch pages.
 * MatchStats.mount(box, fixtureId, { compact }) → { stop() }. Updates every few seconds while the match is live. */
'use strict';
(() => {
  const CSS = `
  .ms { --ms-panel: var(--panel, #1b1b1b); --ms-line: var(--line, #333); --ms-dim: var(--dim, #a3a3a3); --ms-accent: var(--accent, #00ff82); --ms-live: var(--live, #ff3b3b); margin: 16px 0; }
  .ms * { box-sizing: border-box; }
  .ms .board { background: var(--ms-panel); border: 1px solid var(--ms-line); border-radius: 10px; padding: 14px 16px; }
  .ms .meta { display: flex; justify-content: space-between; gap: 10px; color: var(--ms-dim); font-size: 13px; flex-wrap: wrap; }
  .ms .live { color: var(--ms-live); font-weight: 700; }
  .ms .teams { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin: 12px 0 4px; }
  .ms .team { display: flex; align-items: center; gap: 10px; min-width: 0; font-weight: 700; font-size: 17px; }
  .ms .team.b { justify-content: flex-end; text-align: right; }
  .ms .team img, .ms .team .ph { width: 40px; height: 40px; object-fit: contain; flex: none; border-radius: 6px; }
  .ms .team span { overflow: hidden; text-overflow: ellipsis; }
  .ms .sc { font-size: 32px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: center; letter-spacing: .02em; }
  .ms .sc.ck { font-size: 18px; display: grid; gap: 2px; }
  .ms .under { text-align: center; color: var(--ms-dim); font-size: 13px; }
  .ms .clock { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--text, #f2f2f2); }
  .ms .tabs { display: flex; gap: 4px; margin: 12px 0 8px; border-bottom: 1px solid var(--ms-line); overflow-x: auto; }
  .ms .tabs button { background: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0; color: var(--ms-dim); padding: 8px 12px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .ms .tabs button.on { color: var(--text, #f2f2f2); border-bottom-color: var(--ms-accent); }
  .ms table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .ms td, .ms th { padding: 7px 6px; border-bottom: 1px solid var(--ms-line); text-align: left; vertical-align: top; }
  .ms th { color: var(--ms-dim); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .ms .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ms .tl { display: grid; gap: 0; }
  .ms .ev { display: grid; grid-template-columns: 52px 1fr; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--ms-line); align-items: center; }
  .ms .ev .t { color: var(--ms-dim); font-variant-numeric: tabular-nums; font-size: 13px; }
  .ms .ev.B .x { text-align: right; } .ms .ev.status { color: var(--ms-dim); font-size: 13px; } .ms .ev.status .x { text-align: center; text-transform: uppercase; letter-spacing: .05em; }
  .ms .ev .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 6px; vertical-align: middle; }
  .ms .bars { display: grid; gap: 10px; }
  .ms .bar { display: grid; grid-template-columns: 52px 1fr 52px; gap: 8px; align-items: center; font-variant-numeric: tabular-nums; }
  .ms .bar .l { text-align: center; color: var(--ms-dim); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; grid-column: 1 / -1; margin-bottom: -6px; }
  .ms .bar .v { font-weight: 700; } .ms .bar .v.b { text-align: right; }
  .ms .bar .track { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--ms-line); }
  .ms .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .ms h4 { margin: 14px 0 6px; font-size: 14px; }
  .ms .empty { color: var(--ms-dim); padding: 14px 4px; }
  .ms .small { font-size: 12px; color: var(--ms-dim); }
  .ms .inn { margin-bottom: 16px; } .ms .inn .hd { display: flex; justify-content: space-between; gap: 10px; font-weight: 700; margin: 10px 0 4px; }
  .ms tr.cur td:first-child { font-weight: 700; } .ms .ball { display: inline-block; min-width: 24px; padding: 2px 6px; margin: 2px; border-radius: 12px; background: var(--ms-line); text-align: center; font-size: 12px; }
  @media (max-width: 640px) { .ms .two { grid-template-columns: 1fr; } .ms .sc { font-size: 26px; } .ms .team { font-size: 14px; } .ms .team img, .ms .team .ph { width: 30px; height: 30px; } .ms .hide-s { display: none; } }`;
  if (!document.getElementById('ms-css')) { const s = document.createElement('style'); s.id = 'ms-css'; s.textContent = CSS; document.head.append(s); }

  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === null || v === undefined || v === false) continue; if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  };
  const img = (id) => (!id ? '' : /^https?:|^\//.test(id) ? id : '/media/' + id);
  const fmt = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
  const num = (x) => { const n = parseFloat(String(x).replace('%', '')); return Number.isFinite(n) ? n : 0; };

  function mount(box, id, opts = {}) {
    let data = null, tab = '', timer = null, ticker = null, stopped = false;
    const root = el('div', { class: 'ms' + (opts.compact ? ' compact' : '') });
    box.replaceChildren(root);
    // team colours, unless both teams share one (or have none): then two that tell them apart
    const colour = (k) => {
      const a = String((data.teams[0] || {}).color || '').toLowerCase(), b = String((data.teams[1] || {}).color || '').toLowerCase();
      if (!a || !b || a === b) return k === 'A' ? '#00a3ff' : '#ff8a00';
      return k === 'A' ? a : b;
    };

    function board() {
      const live = data.status === 'Live', [a, b] = [data.teams[0] || { name: 'Home' }, data.teams[1] || { name: 'Away' }];
      const team = (t, side) => el('div', { class: 'team ' + side }, side === 'b' ? el('span', {}, t.name) : null, t.logo ? el('img', { src: img(t.logo), alt: '' }) : el('span', { class: 'ph', style: { background: t.color || '#555' } }), side === 'a' ? el('span', {}, t.name) : null);
      const sc = data.score ? (data.kind === 'cricket' ? el('div', { class: 'sc ck' }, el('span', {}, data.score[0] || '-'), el('span', {}, data.score[1] || '-')) : el('div', { class: 'sc' }, `${data.score[0]} – ${data.score[1]}`)) : el('div', { class: 'sc', style: { fontSize: '20px' } }, data.time || 'v');
      const clock = data.clock && live ? el('span', { class: 'clock', 'data-clock': '' }, fmt(data.clock.ms)) : null;
      return el('div', { class: 'board' },
        el('div', { class: 'meta' }, el('span', {}, [data.competition, data.venue].filter(Boolean).join(' · ') || data.sport), live ? el('span', { class: 'live' }, '● LIVE') : el('span', {}, data.status === 'Completed' ? 'Full time' : [data.date, data.time].filter(Boolean).join(' '))),
        el('div', { class: 'teams' }, team(a, 'a'), sc, team(b, 'b')),
        el('div', { class: 'under' }, [clock, clock && (data.period || data.statusText) ? ' · ' : '', data.period || '', data.period && data.statusText && data.statusText !== data.period ? ' · ' : '', data.statusText && data.statusText !== data.period ? data.statusText : '']));
    }

    // ---- timed sports
    function timeline() {
      const list = data.timeline || [];
      if (!list.length) return el('div', { class: 'empty' }, data.status === 'Upcoming' ? 'The match has not started yet.' : 'Nothing has happened yet.');
      return el('div', { class: 'tl' }, list.map((e) => {
        const side = e.team === 'B' ? 'B' : e.team === 'A' ? 'A' : '';
        const dot = side ? el('span', { class: 'dot', style: { background: colour(side) } }) : null;
        return el('div', { class: 'ev ' + side + (side ? '' : ' status') }, el('span', { class: 't' }, e.ct || ''), el('span', { class: 'x' }, side === 'B' ? [e.text, dot] : [dot, e.text]));
      }));
    }
    function teamStats() {
      const some = (x) => /[1-9]/.test(String(x === undefined || x === null ? '' : x));
      const rows = (data.teamStats || []).filter((s) => some(s.a) || some(s.b));        // nothing counted yet: left out
      const leaders = data.leaders || [];
      if (!rows.length && !leaders.length) return el('div', { class: 'empty' }, 'No team statistics yet.');
      return el('div', {},
        el('div', { class: 'bars' }, rows.map((s) => {
          const a = num(s.a), b = num(s.b), tot = a + b;
          return el('div', { class: 'bar' }, el('div', { class: 'l' }, s.label), el('span', { class: 'v' }, String(s.a)),
            el('div', { class: 'track' }, el('i', { style: { width: (tot ? (a / tot) * 100 : 50) + '%', background: colour('A') } }), el('i', { style: { width: (tot ? (b / tot) * 100 : 50) + '%', background: colour('B') } })),
            el('span', { class: 'v b' }, String(s.b)));
        })),
        leaders.length ? [el('h4', {}, 'Leaders'), el('table', {}, el('tbody', {}, leaders.map((l) => el('tr', {}, el('td', {}, l.label), el('td', {}, el('span', { class: 'dot', style: { background: colour(l.team), display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', marginRight: '6px' } }), l.name), el('td', { class: 'n' }, l.value)))))] : null);
    }
    function players() {
      const side = (k, t) => {
        const list = (data.players && data.players[k]) || [];
        if (!list.length) return el('div', {}, el('h4', {}, t.name), el('div', { class: 'empty' }, 'No line-up.'));
        const starters = list.filter((p) => p.lineup !== 'bench'), bench = list.filter((p) => p.lineup === 'bench');
        const row = (p) => el('tr', {}, el('td', { class: 'n', style: { width: '34px' } }, p.number), el('td', {}, p.name, p.position ? el('div', { class: 'small' }, p.position) : null),
          el('td', { class: 'small' }, p.statsText || p.stats.map(([l, n]) => `${n} ${l.toLowerCase()}`).join(', ')));
        return el('div', {}, el('h4', {}, t.name), el('table', {}, el('tbody', {}, starters.map(row), bench.length ? [el('tr', {}, el('td', { colspan: '3', class: 'small' }, 'Replacements')), bench.map(row)] : null)));
      };
      return el('div', { class: 'two' }, side('A', data.teams[0] || { name: 'Home' }), side('B', data.teams[1] || { name: 'Away' }));
    }

    // ---- cricket
    function scorecard() {
      const inns = data.innings || [];
      if (!inns.length) return el('div', { class: 'empty' }, 'The match has not started yet.');
      return el('div', {}, inns.slice().reverse().map((i) => el('div', { class: 'inn' },
        el('div', { class: 'hd' }, el('span', {}, i.title), el('span', {}, `${i.score} (${i.overs} ov)`)),
        i.target && !i.complete ? el('div', { class: 'small' }, `Target ${i.target}${i.runsNeeded !== null && i.runsNeeded !== undefined ? ` · need ${i.runsNeeded}` : ''}${i.requiredRate ? ` · RRR ${i.requiredRate}` : ''} · RR ${i.runRate}`) : null,
        i.thisOver && i.thisOver.length && !i.complete ? el('div', { class: 'small' }, 'This over: ', i.thisOver.map((b) => el('span', { class: 'ball' }, b))) : null,
        el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Batter'), el('th', { class: 'hide-s' }, ''), el('th', { class: 'n' }, 'R'), el('th', { class: 'n' }, 'B'), el('th', { class: 'n' }, '4s'), el('th', { class: 'n' }, '6s'), el('th', { class: 'n hide-s' }, 'SR'))),
          el('tbody', {}, i.batting.map((b) => el('tr', { class: b.batting ? 'cur' : '' }, el('td', {}, b.name + (b.onStrike ? ' *' : ''), el('div', { class: 'small' }, b.howOut)), el('td', { class: 'hide-s' }), el('td', { class: 'n' }, b.runs), el('td', { class: 'n' }, b.balls), el('td', { class: 'n' }, b.fours), el('td', { class: 'n' }, b.sixes), el('td', { class: 'n hide-s' }, b.sr))),
            i.extras ? el('tr', {}, el('td', {}, 'Extras', el('div', { class: 'small' }, i.extras.detail || '')), el('td', { class: 'hide-s' }), el('td', { class: 'n' }, i.extras.total), el('td', { colspan: '4' })) : null)),
        i.yetToBat.length ? el('div', { class: 'small', style: { margin: '6px 0' } }, 'Yet to bat: ' + i.yetToBat.join(', ')) : null,
        i.fow.length ? el('div', { class: 'small', style: { margin: '6px 0' } }, 'Fall of wickets: ' + i.fow.map((w) => `${w.score}-${w.wicket} (${w.name}, ${w.over})`).join(', ')) : null,
        i.bowling.length ? el('table', { style: { marginTop: '8px' } }, el('thead', {}, el('tr', {}, el('th', {}, 'Bowler'), el('th', { class: 'n' }, 'O'), el('th', { class: 'n' }, 'M'), el('th', { class: 'n' }, 'R'), el('th', { class: 'n' }, 'W'), el('th', { class: 'n' }, 'Econ'))),
          el('tbody', {}, i.bowling.map((b) => el('tr', { class: b.current ? 'cur' : '' }, el('td', {}, b.name), el('td', { class: 'n' }, b.overs), el('td', { class: 'n' }, b.maidens), el('td', { class: 'n' }, b.runs), el('td', { class: 'n' }, b.wickets), el('td', { class: 'n' }, b.econ))))) : null)));
    }
    function info() {
      const rows = [['Competition', data.competition], ['Venue', data.venue], ['Date', [data.date, data.time].filter(Boolean).join(' ')], ['Commentators', (data.commentators || []).join(', ')], ...(data.officials || []).map((o) => { const i = o.indexOf(':'); return i > 0 ? [o.slice(0, i), o.slice(i + 1).trim()] : ['Official', o]; })].filter((r) => r[1]);
      return rows.length ? el('table', {}, el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('td', { class: 'small', style: { width: '36%' } }, k), el('td', {}, v))))) : el('div', { class: 'empty' }, 'No details.');
    }

    function paint() {
      if (!data) return;
      const tabs = data.kind === 'cricket' ? [['card', 'Scorecard'], ['info', 'Match info']]
        : data.timeline || data.teamStats ? [['tl', 'Match'], ['stats', 'Team stats'], ['players', 'Players'], ['info', 'Match info']] : [['info', 'Match info']];
      if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];
      const body = tab === 'card' ? scorecard() : tab === 'tl' ? timeline() : tab === 'stats' ? teamStats() : tab === 'players' ? players() : info();
      root.replaceChildren(board(), opts.noTabs ? null : el('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => el('button', { class: k === tab ? 'on' : '', role: 'tab', onclick: () => { tab = k; paint(); } }, l))), body);
    }
    // the game clock runs on between updates
    function tick() {
      if (!data || !data.clock || !data.clock.running) return;
      const c = root.querySelector('[data-clock]'); if (!c) return;
      const since = Date.now() - data.clock.seen;
      c.textContent = fmt(data.clock.ms + data.clock.dir * since);
    }
    async function load() {
      if (stopped) return;
      try {
        const r = await fetch('/api/public/match/' + encodeURIComponent(id), { credentials: 'same-origin' });
        if (r.status === 404) { root.replaceChildren(); if (opts.onMissing) opts.onMissing(); return; }
        if (r.ok) { data = await r.json(); if (data.clock) data.clock.seen = Date.now(); paint(); if (opts.onData) opts.onData(data); }
      } catch { /* try again on the next round */ }
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(load, data && data.status === 'Live' ? 5000 : 60000);
    }
    load();
    ticker = setInterval(tick, 1000);
    return { stop() { stopped = true; clearTimeout(timer); clearInterval(ticker); }, reload: load };
  }
  window.MatchStats = { mount };
})();
