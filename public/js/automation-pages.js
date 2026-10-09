/* Live → Variables & triggers.
   Variables: your own values ({var_attendance}, {var_man_of_the_match} …) kept for everyone, per sport, per competition
   or per match, set from dashboards, buttons, macros and here; usable in every template, trigger and action.
   Game triggers: WHEN something happens in a game (a try, a six, a wicket, a red card …) THEN run actions (an advert,
   a playlist, a graphic, a macro, set a variable), with every-Nth, cool-down and most-per-match. */
'use strict';
(() => {
  const EVENTS = {
    'Cricket': [['ball', 'Any ball'], ['four', 'Four'], ['six', 'Six'], ['boundary', 'Four or six'], ['wicket', 'Wicket'], ['dot', 'Dot ball'], ['wide', 'Wide'], ['noball', 'No ball'], ['extra', 'Any extra'], ['over', 'End of an over'], ['maiden', 'Maiden over'], ['fifty', 'Batter reaches 50'], ['hundred', 'Batter reaches 100'], ['innings', 'End of an innings']],
    'Other sports': [['score', 'Any score'], ['try', 'Try'], ['conversion', 'Conversion'], ['penalty', 'Penalty goal'], ['dropgoal', 'Drop goal'], ['goal', 'Goal'], ['point', 'Point'], ['card', 'Any card'], ['yellow', 'Yellow card'], ['red', 'Red card'], ['sub', 'Substitution'], ['timeout', 'Time-out'], ['period', 'New period / half'], ['end', 'End of the match'], ['event', 'Anything the scorer adds']],
  };
  const SCOPES = [['all', 'One value'], ['sport', 'One per sport'], ['competition', 'One per competition'], ['match', 'One per match']];
  const keyOf = (s) => String(s || '').trim().toLowerCase().replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  const sports = () => [...new Set([...(App.sports ? App.sports() : []), ...App.list('competition').map((c) => c.data.sport), ...App.list('fixture').map((f) => f.data.sport)].filter(Boolean))].sort();

  function varForm(doc0) {
    const d = Object.assign({ name: '', key: '', type: 'text', scope: 'match', sport: '', competition: '', default: '', options: '', min: '', max: '', notes: '' }, doc0 ? doc0.data : {});
    let keyTouched = !!d.key;
    const inp = (k, attrs = {}) => h('input', { value: d[k] == null ? '' : d[k], ...attrs, oninput: (e) => { d[k] = e.target.value; if (k === 'name' && !keyTouched) { d.key = keyOf(d.name); keyEl.value = d.key; hint.textContent = '{var_' + d.key + '}'; } if (k === 'key') { keyTouched = true; hint.textContent = '{var_' + keyOf(d.key) + '}'; } } });
    const keyEl = inp('key', { placeholder: 'attendance' }), hint = h('code', {}, '{var_' + keyOf(d.key || d.name) + '}');
    const pick = (k, opts, onch) => h('select', { onchange: (e) => { d[k] = e.target.value; if (onch) onch(); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(d[k]) === v }, l)));
    const lab = (t, el, help) => h('label', { class: 'f' }, h('span', {}, t), el, help ? h('div', { class: 'help' }, help) : null);
    const sportList = h('datalist', { id: 'av-sports' }, sports().map((s) => h('option', { value: s })));
    const extra = h('div', { class: 'form' });
    const paintExtra = () => extra.replaceChildren(
      d.type === 'list' ? lab('Choices (one per line)', h('textarea', { rows: 4, oninput: (e) => { d.options = e.target.value; } }, d.options || '')) : null,
      d.type === 'number' ? lab('Lowest', inp('min', { type: 'number' })) : null, d.type === 'number' ? lab('Highest', inp('max', { type: 'number' })) : null);
    paintExtra();
    const el = h('div', {}, h('div', { class: 'form' },
      lab('Name', inp('name', { placeholder: 'Attendance' })), lab('Key', keyEl, h('span', {}, 'In templates and actions: ', hint)),
      lab('Kind', pick('type', [['text', 'Text'], ['number', 'Number'], ['toggle', 'On / off'], ['list', 'One of a list']], paintExtra)),
      lab('Kept', pick('scope', SCOPES), 'Per match: each match has its own value (attendance, man of the match). Per competition: shared by its matches.'),
      lab('Only for the sport', h('span', {}, inp('sport', { list: 'av-sports', placeholder: 'every sport' }), sportList)),
      lab('Only for the competition', pick('competition', [['', 'every competition'], ...App.list('competition').map((c) => [c.id, App.title('competition', c.id)])])),
      lab('Starts as', inp('default'))), extra, lab('Notes', h('textarea', { rows: 2, oninput: (e) => { d.notes = e.target.value; } }, d.notes || '')));
    return { el, data: () => Object.assign(d, { key: keyOf(d.key || d.name) }) };
  }
  async function editVar(doc0, after) {
    const f = varForm(doc0);
    const box = h('div', { class: 'modal-back' }, h('div', { class: 'modal', style: { width: 'min(860px, 96vw)' } }, h('h2', {}, doc0 ? 'Variable' : 'New variable'), f.el,
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '12px' } }, h('button', { onclick: () => box.remove() }, 'Cancel'),
        h('button', { class: 'primary', onclick: async () => { const d = f.data(); if (!String(d.name).trim()) { toast('Give it a name', 'error'); return; } if (App.list('variable').some((v) => v.id !== (doc0 && doc0.id) && keyOf(v.data.key || v.data.name) === d.key)) { toast('Another variable already has the key ' + d.key, 'error'); return; } try { await App.save('variable', doc0 ? doc0.id : App.newId('variable'), d); box.remove(); after(); } catch (e) { oops(e); } } }, 'Save'))));
    document.body.appendChild(box);
  }

  App.pages.automation = () => {
    const can = App.can('edit'), canSet = App.can('score');
    const varsBox = h('div', {}), trigBox = h('div', {});
    let now = { list: [], onAir: '' };
    const valueEditor = (v) => {
      const set = (val) => api('POST', '/api/vars/value', { key: v.key, value: val }).then((r) => { toast(`${v.name} = ${r.value === '' ? '(empty)' : r.value}`); loadVals(); }).catch(oops);
      if (!canSet) return h('b', {}, v.value);
      if (v.type === 'toggle') return h('button', { class: 'sm' + (v.value ? ' primary' : ''), onclick: () => set('toggle') }, v.value ? 'ON' : 'OFF');
      if (v.type === 'list') return h('select', { style: { width: 'auto' }, onchange: (e) => set(e.target.value) }, [h('option', { value: '' }, '—'), ...v.options.map((o) => h('option', { value: o, selected: o === v.value }, o))]);
      const inp = h('input', { value: v.value, style: { width: v.type === 'number' ? '110px' : '200px' }, type: v.type === 'number' ? 'number' : 'text', onkeydown: (e) => { if (e.key === 'Enter') set(inp.value); } });
      return h('span', { class: 'row', style: { gap: '4px', display: 'inline-flex' } }, v.type === 'number' ? h('button', { class: 'sm', onclick: () => set('-1') }, '−') : null, inp, v.type === 'number' ? h('button', { class: 'sm', onclick: () => set('+1') }, '+') : null, h('button', { class: 'sm', onclick: () => set(inp.value) }, 'Set'));
    };
    const loadVals = () => api('GET', '/api/vars').then((r) => { now = r; paintVars(); }).catch(() => paintVars());
    function paintVars() {
      const list = App.list('variable').sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
      const onAir = App.get(now.onAir);
      varsBox.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Variables'), can ? h('button', { class: 'primary', onclick: () => editVar(null, loadVals) }, '+ Variable') : null),
        h('p', { class: 'dim' }, 'Your own values for templates, triggers, dashboards and actions. "Now" is the value for the match on air', onAir ? ` (${App.fixtureName(onAir)})` : ' (no match on air: per-match values can be set once one is)', '. Dashboards set them with faders, buttons, lists and boxes; actions with "Set a variable" (12, +1, -1, toggle).'),
        list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Name', 'In templates', 'Kind', 'Kept', 'Now', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, list.map((d) => {
            const x = d.data, key = keyOf(x.key || x.name), live = now.list.find((v) => v.id === d.id);
            return h('tr', {}, h('td', {}, h('b', {}, x.name)), h('td', {}, h('code', {}, '{var_' + key + '}')), h('td', { class: 'dim' }, ({ text: 'Text', number: 'Number', toggle: 'On / off', list: 'List' })[x.type || 'text']),
              h('td', { class: 'dim small' }, (SCOPES.find((s) => s[0] === (x.scope || 'all')) || SCOPES[0])[1], x.sport ? ' · ' + x.sport : '', x.competition ? ' · ' + App.title('competition', x.competition) : ''),
              h('td', {}, live ? valueEditor(live) : h('span', { class: 'dim small' }, 'not for the match on air')),
              h('td', { class: 'r nowrap' }, can ? h('button', { class: 'sm', onclick: () => editVar(d, loadVals) }, 'Edit') : null, can ? h('button', { class: 'sm ghost danger', onclick: async () => { if (await confirmBox(`Delete the variable "${x.name}"?`, 'Delete')) { await App.remove('variable', d.id).catch(oops); loadVals(); } } }, '✕') : null));
          })))) : h('p', { class: 'dim' }, 'No variables yet.')));
    }
    // ---------------- game triggers
    const drafts = new Map();
    function paintTrig() {
      const list = App.list('gametrigger').sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
      const sportDl = h('datalist', { id: 'gt-sports' }, sports().map((s) => h('option', { value: s })));
      const card = (doc) => {
        const id = doc ? doc.id : '__new', d = drafts.get(id) || JSON.parse(JSON.stringify(Object.assign({ name: '', when: 'try', team: 'any', sport: '', competition: '', every: 1, cooldown: 0, maxPerMatch: 0, delay: 0, off: false, actions: [{ do: 'advert', target: '', delay: 0 }] }, doc ? doc.data : {})));
        drafts.set(id, d);
        const inp = (k, attrs = {}) => h('input', { value: d[k] == null ? '' : d[k], ...attrs, oninput: (e) => { d[k] = attrs.type === 'number' ? Number(e.target.value) || 0 : e.target.value; } });
        const lab = (t, el, w) => h('label', { class: 'f', style: { flex: `1 1 ${w || 140}px` } }, h('span', {}, t), el);
        const whenSel = h('select', { onchange: (e) => { d.when = e.target.value; } }, Object.entries(EVENTS).map(([g, L]) => h('optgroup', { label: g }, L.map(([v, l]) => h('option', { value: v, selected: d.when === v }, l)))));
        return h('div', { class: 'conn-dev' },
          h('div', { class: 'row', style: { alignItems: 'flex-end' } },
            lab('Name', inp('name', { placeholder: 'Try sponsor' }), 180), lab('When', whenSel, 170),
            lab('By', h('select', { onchange: (e) => { d.team = e.target.value; } }, [['any', 'either team'], ['A', 'team A (home / first)'], ['B', 'team B (away / second)']].map(([v, l]) => h('option', { value: v, selected: d.team === v }, l))), 150),
            lab('Sport', h('span', {}, inp('sport', { list: 'gt-sports', placeholder: 'every sport' })), 130),
            lab('Competition', h('select', { onchange: (e) => { d.competition = e.target.value; } }, [['', 'every competition'], ...App.list('competition').map((c) => [c.id, App.title('competition', c.id)])].map(([v, l]) => h('option', { value: v, selected: d.competition === v }, l))), 170)),
          h('div', { class: 'row', style: { alignItems: 'flex-end', marginTop: '6px' } },
            lab('Every', inp('every', { type: 'number', min: 1, title: '1 = every time, 2 = every second one, …' }), 70), lab('Wait (s) before', inp('delay', { type: 'number', min: 0, step: 0.5 }), 90),
            lab('Not again within (s)', inp('cooldown', { type: 'number', min: 0 }), 110), lab('Most per match (0 = no limit)', inp('maxPerMatch', { type: 'number', min: 0 }), 150),
            h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !d.off, onchange: (e) => { d.off = !e.target.checked; } }), ' On')),
          h('div', { class: 'flabel', style: { marginTop: '8px' } }, 'Then'), App.actionsMini(d.actions = d.actions || [], { first: 'advert' }),
          h('div', { class: 'help' }, 'Values can use {team} (A or B), {event}, {event_text}, {player} and every live value.'),
          can ? h('div', { class: 'row', style: { marginTop: '8px' } },
            h('button', { class: 'primary', onclick: async () => { if (!String(d.name).trim()) { toast('Give the trigger a name', 'error'); return; } try { await App.save('gametrigger', doc ? doc.id : App.newId('gametrigger'), d); drafts.delete(id); toast('Trigger saved'); paintTrig(); } catch (e) { oops(e); } } }, 'Save'),
            doc ? h('button', { class: 'ghost danger', onclick: async () => { if (await confirmBox(`Delete "${d.name}"?`, 'Delete')) { await App.remove('gametrigger', doc.id).catch(oops); drafts.delete(id); paintTrig(); } } }, 'Delete') : h('button', { class: 'ghost', onclick: () => { drafts.delete(id); adding = false; paintTrig(); } }, 'Cancel')) : null);
      };
      trigBox.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, 'Game triggers'), can && !adding ? h('button', { class: 'primary', onclick: () => { adding = true; paintTrig(); } }, '+ Trigger') : null),
        h('p', { class: 'dim' }, 'When something happens in a game, run actions: the sponsor\'s advert after a try, a graphic on a six, a variable +1 on a wicket. They run on the production PC for the match on air.'),
        sportDl, adding ? card(null) : null, list.length ? list.map(card) : (adding ? null : h('p', { class: 'dim' }, 'No game triggers yet.'))));
    }
    let adding = false;
    loadVals(); paintTrig();
    return { el: h('div', {}, pageHead('Variables & triggers'), varsBox, trigBox), keepScroll: true,
      onMessage: UI.debounce((m) => { if (m.type === 'doc' && m.doc.type === 'variable') loadVals(); if (m.type === 'doc' && m.doc.type === 'gametrigger' && !drafts.size) paintTrig(); }, 300) };
  };
})();
