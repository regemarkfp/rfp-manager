/* RFP Manager – Live → Variables: every value a template can use, for every sport, ready to copy.
 * Sections: every sport, all sports except cricket, each sport on its own, production and devices, graphic fields.
 * Numbered series (sl1_name … sl16_name) are one row with a number to choose. The data comes from the production PC
 * (/live/api/varref), with an example from a sample match and the value now when a match is on air. */
'use strict';
(() => {
  const FORMATS = [['brace', '{key}', 'For text fields and actions: {teamA_name}'], ['plain', 'key', 'The name only: teamA_name'], ['field', 'data-f="key"', 'For your own HTML templates: data-f="teamA_name"']];
  const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not kept */ } } };
  const css = `.vr{display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:start}.vr-side{position:sticky;top:12px;display:flex;flex-direction:column;gap:2px}
.vr-side button{all:unset;cursor:pointer;padding:8px 12px;border-radius:8px;display:flex;justify-content:space-between;gap:8px;font-size:14px}.vr-side button:hover{background:var(--panel2)}
.vr-side button.on{background:var(--accent);color:var(--on-accent);font-weight:600}.vr-side .n{opacity:.6;font-size:12px}.vr-side hr{border:0;border-top:1px solid var(--line);margin:6px 0}
.vr-grp{margin-bottom:16px}.vr-grp h3{display:flex;align-items:center;gap:10px;margin:0 0 8px;font-size:15px}.vr-grp h3 .grow{flex:1}
.vr-row{display:grid;grid-template-columns:minmax(220px,1.2fr) minmax(160px,1fr) minmax(120px,.8fr) auto;gap:10px;align-items:center;padding:7px 10px;border-top:1px solid var(--line)}
.vr-row:hover{background:var(--panel2)}.vr-key{font-family:ui-monospace,Consolas,monospace;font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;word-break:break-all}
.vr-key select{width:auto;padding:1px 4px;font-size:12px}.vr-desc{font-size:13px}.vr-desc .note{display:block;font-size:12px;color:var(--dim)}.vr-ex{font-size:12px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vr-ex b{color:var(--accent);font-weight:600}.vr-copy{white-space:nowrap}.vr-top{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.vr-top input[type=search]{flex:1;min-width:220px}
.vr-hit{font-size:12px;color:var(--dim);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.05em}
@media (max-width:900px){.vr{grid-template-columns:1fr}.vr-side{position:static;flex-direction:row;flex-wrap:wrap}.vr-row{grid-template-columns:1fr auto}.vr-desc,.vr-ex{grid-column:1}}`;
  let styled = false;

  // what a name means, in words (good enough to find the right one; the example shows the rest)
  const WORDS = { teamA: 'Team A', teamB: 'Team B', A: 'team A', B: 'team B', ms: 'milliseconds', pb: 'personal best', sb: 'season best', rs: 'result', sl: 'start list', ath: 'athletics', num: 'number',
    tv: 'TV', lt: 'lower third', fs: 'full frame', sr: 'strike rate', crr: 'current run rate', rrr: 'required run rate', dls: 'DLS', pp: 'powerplay', id: 'id', up: 'up now', bat: 'batter', bowl: 'bowler', comm: 'commentator', ev: 'timeline event', col: 'column', stat: 'stat', leader: 'leader', sinbin: 'sin-bin', fs: 'full frame', p: 'player' };
  const SPECIAL = { title: 'Match title', competition: 'Competition name', venue: 'Venue', sport: 'Sport (id)', sport_name: 'Sport name', commentators: 'All commentators', clock_text: 'Game / race clock as text', clock_ms: 'Game clock in milliseconds',
    clock_running: '1 while the clock runs', clock_digits: 'Decimals on the race clock', match_line: 'One line: teams and score', period: 'Period / half / set label', status: 'Status line', date_text: 'Today’s date', time_text: 'Time now (hh:mm)', org_name: 'Production team name',
    org_logo: 'Production team logo', accent: 'Accent colour', ath_event: 'Current event name', ath_event_num: 'Event number', ath_round: 'Round (heat, final …)', ath_wind: 'Wind', ath_up_name: 'Field: athlete up now', ath_up_attempts: 'Field: their attempts',
    ath_up_best: 'Field: their best mark', ath_bar: 'High jump / pole vault: bar height', ath_attempt_round: 'Field: round', line1: 'Lower third line 1', line2: 'Lower third line 2' };
  function describe(key) {
    const k = key.replace('{n}', 'N');
    if (SPECIAL[k]) return SPECIAL[k];
    const parts = k.split('_').map((p) => {
      const m = /^([a-z]+)(N|\d+)?([AB])?$/.exec(p);
      if (m && WORDS[m[1]] !== undefined) return [WORDS[m[1]], m[2] === 'N' ? 'N' : m[2] || '', m[3] ? WORDS[m[3]] : ''].filter(Boolean).join(' ');
      if (WORDS[p]) return WORDS[p];
      return p.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').replace(/N$/, ' N').toLowerCase();
    });
    const s = parts.join(' ').replace(/\s+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  App.pages.variables = () => {
    if (!styled) { styled = true; document.head.append(h('style', {}, css)); }
    let data = null, section = store.get('rfp-vars-section', 'all'), fmt = store.get('rfp-vars-fmt', 'brace'), q = '';
    const body = h('div', {}, h('p', { class: 'dim' }, 'Loading the variables from the production PC…'));
    const out = (key) => (fmt === 'plain' ? key : fmt === 'field' ? `data-f="${key}"` : `{${key}}`);
    const copy = async (text, label) => {
      try { await navigator.clipboard.writeText(text); toast(`Copied ${label || text}`); }
      catch { const t = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text); document.body.append(t); t.select(); try { document.execCommand('copy'); toast(`Copied ${label || text}`); } catch { toast('Copy did not work: select it and press Ctrl+C', 'error'); } t.remove(); }
    };
    const keyOf = (v, n) => (v.pattern ? v.pattern.replace('{n}', n) : v.key);
    function row(v) {
      let n = v.min || 1;
      const name = h('span', {}, keyOf(v, n));
      const pick = v.pattern ? h('select', { title: `${v.min}–${v.max}`, onchange: (e) => { n = e.target.value; name.textContent = keyOf(v, n); } },
        Array.from({ length: v.max - v.min + 1 }, (_, i) => h('option', { value: v.min + i }, String(v.min + i)))) : null;
      return h('div', { class: 'vr-row' },
        h('div', { class: 'vr-key' }, name, pick ? h('span', { class: 'dim small' }, 'N =') : null, pick),
        h('div', { class: 'vr-desc' }, describe(v.pattern || v.key), v.pattern ? h('span', { class: 'note' }, `numbered ${v.min}–${v.max}`) : null, v.note ? h('span', { class: 'note' }, v.note) : null),
        h('div', { class: 'vr-ex', title: v.now !== undefined && v.now !== '' ? 'Now: ' + v.now : v.ex || '' }, v.now !== undefined && v.now !== '' ? h('b', {}, v.now) : (v.ex || h('span', { class: 'dim' }, '–'))),
        h('div', { class: 'vr-copy' }, h('button', { class: 'sm', onclick: () => copy(out(keyOf(v, n))) }, 'Copy')));
    }
    function group(g, where) {
      return h('div', { class: 'card vr-grp' },
        h('h3', {}, h('span', { class: 'grow' }, g.name, where ? h('span', { class: 'dim small', style: { marginLeft: '8px', fontWeight: 400 } }, where) : null), h('span', { class: 'dim small' }, String(g.vars.length)),
          h('button', { class: 'sm', title: 'Every name in this group, one per line', onclick: () => copy(g.vars.map((v) => out(keyOf(v, v.min || 1))).join('\n'), `${g.vars.length} variables`) }, 'Copy all')),
        g.vars.map(row));
    }
    const count = (s) => s.groups.reduce((a, g) => a + g.vars.length, 0);
    function paint() {
      if (!data) return;
      if (!data.sections.some((s) => s.id === section)) section = data.sections[0].id;
      const side = h('div', { class: 'vr-side' }, data.sections.map((s, i) => [
        i === 2 || i === data.sections.length - 2 ? h('hr') : null,
        h('button', { class: s.id === section && !q ? 'on' : '', onclick: () => { section = s.id; q = ''; search.value = ''; store.set('rfp-vars-section', section); paint(); } }, h('span', {}, s.name), h('span', { class: 'n' }, String(count(s))))]));
      let main;
      if (q) {
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        const hit = (v) => { const t = `${v.pattern || v.key} ${describe(v.pattern || v.key)} ${v.note || ''} ${v.ex || ''}`.toLowerCase(); return words.every((w) => t.includes(w)); };
        const found = data.sections.map((s) => ({ s, groups: s.groups.map((g) => ({ name: g.name, vars: g.vars.filter(hit) })).filter((g) => g.vars.length) })).filter((x) => x.groups.length);
        main = h('div', {}, found.length ? found.map((x) => [h('div', { class: 'vr-hit' }, x.s.name), x.groups.map((g) => group(g))]) : h('p', { class: 'dim' }, 'Nothing matches. Try part of the name (score, clock, player) or a sport.'));
      } else {
        const s = data.sections.find((x) => x.id === section);
        main = h('div', {}, s.note ? h('p', { class: 'dim', style: { marginTop: 0 } }, s.note) : null, s.groups.map((g) => group(g)));
      }
      body.replaceChildren(h('div', { class: 'vr' }, side, main));
    }
    const search = h('input', { type: 'search', placeholder: 'Search every variable (name, meaning or sport)…', oninput: (e) => { q = e.target.value.trim(); paint(); } });
    const fmtSel = h('select', { style: { width: 'auto' }, title: 'What Copy puts on the clipboard', onchange: (e) => { fmt = e.target.value; store.set('rfp-vars-fmt', fmt); } },
      FORMATS.map(([v, l, t]) => h('option', { value: v, selected: v === fmt, title: t }, 'Copy as ' + l)));
    const load = () => api('GET', '/live/api/varref').then((r) => { data = r; paint(); }).catch((e) => { body.replaceChildren(h('div', { class: 'card' }, h('p', {}, e.message || 'Could not load the variables'), h('p', { class: 'dim small' }, 'The variables come from RFP Manager on the production PC. On the website, choose a production PC first.'))); });
    load();
    return { el: h('div', {}, pageHead('Variables', h('button', { class: 'sm', onclick: load, title: 'Load the values again (a match on air shows its values now)' }, 'Refresh')),
      h('p', { class: 'dim', style: { marginTop: 0 } }, 'Every value RFP Manager can put in a template, sport by sport. Copy one and paste it in a template field ({…} in text) or your own HTML template. The example comes from a sample match; with a match on air, its value now is shown in green.'),
      h('div', { class: 'vr-top' }, search, fmtSel), body) };
  };
})();
