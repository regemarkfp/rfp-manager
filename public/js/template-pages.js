'use strict';
/* Templates: the HTML graphic templates in this PC's template folder, and the graphics made from them. */
(function () {
  const { h, api, toast, oops } = UI;
  const head = (title, ...right) => h('div', { class: 'page-head' }, h('div', { class: 'grow' }, typeof title === 'string' ? h('h1', {}, title) : title), ...right);
  const local = () => !!(App.gfx || App.machine.outputKey);
  const KINDS = [['lt', 'Lower third'], ['fs', 'Full screen'], ['bug', 'Bug / corner'], ['wipe', 'Wipe / sting']];
  const loaded = () => App.list('graphic').sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));

  // Keep what the operator typed, add what the template has gained, and flag what it no longer has.
  // ---- linking template variables to RFP Manager's live values --------------------------------
  let liveVars = null;
  async function loadVars(graphic) { graphic = [].concat(graphic || []).join(','); try { liveVars = await api('GET', '/live/api/variables' + (graphic ? '?graphic=' + encodeURIComponent(graphic) : '')); } catch (e) { liveVars = { vars: [], builtIn: [], onAir: false }; } return liveVars; }
  const nk = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // other names designers commonly give the same thing
  const SAME = { teamA_name: ['home', 'hometeam', 'homename', 'team1', 'team1name', 'teama', 'hometeamname'], teamB_name: ['away', 'awayteam', 'awayname', 'team2', 'team2name', 'teamb', 'awayteamname'],
    teamA_short: ['homeshort', 'homeabbr', 'team1short', 'homecode'], teamB_short: ['awayshort', 'awayabbr', 'team2short', 'awaycode'], teamA_logo: ['homelogo', 'homebadge', 'team1logo', 'logo1', 'logoa'], teamB_logo: ['awaylogo', 'awaybadge', 'team2logo', 'logo2', 'logob'],
    teamA_color1: ['homecolor', 'homecolour', 'team1color', 'team1colour'], teamB_color1: ['awaycolor', 'awaycolour', 'team2color', 'team2colour'], scoreA: ['homescore', 'score1', 'team1score', 'scorehome'], scoreB: ['awayscore', 'score2', 'team2score', 'scoreaway'],
    competition: ['tournament', 'league', 'event', 'series', 'competitionname'], competition_logo: ['tournamentlogo', 'leaguelogo', 'eventlogo', 'serieslogo', 'complogo'], card_color: ['cardcolor', 'cardcolour'], venue: ['stadium', 'ground', 'location'], period: ['half', 'quarter', 'periodtext'], clock_text: ['clock', 'matchclock', 'gameclock', 'time'], status_text: ['status', 'matchstatus'], org_name: ['company', 'broadcaster'] };
  function linkFor(key, vars) {
    const k = nk(key), have = new Map(vars.map((v) => [nk(v.key), v.key]));
    if (have.has(k)) return have.get(k);
    // card slots on a bug: _t1card1 … _t2card4, homecard2, team1card3 …
    const cs = /^(t1|home|team1|teama|t2|away|team2|teamb)(?:card|c)([1-4])(?:colou?r)?$/.exec(k);
    if (cs) { const t = `team${/^(t1|home|team1|teama)$/.test(cs[1]) ? 'A' : 'B'}_card${cs[2]}_color`; if (have.has(nk(t))) return t; }
    for (const [target, names] of Object.entries(SAME)) if (names.includes(k) && have.has(nk(target))) return target;
    return '';
  }
  // Fills empty fields whose name matches a live value. Returns how many were linked.
  function autoLink(fields, vars) {
    let n = 0;
    for (const f of fields) {
      const hit = linkFor(f.key, vars);
      if (!hit || /\{\w+\}/.test(f.value || '')) continue;
      if (f.type === 'image' ? !f.value : true) { f.value = `{${hit}}`; n++; if (/_card\d_color$|^card_color$/.test(hit)) { f.type = 'color'; f.emptyTransparent = true; } }
    }
    return n;
  }
  const fillTokens = (v, vars) => String(v == null ? '' : v).replace(/\{([A-Za-z_]\w*)\}/g, (m, k) => { const x = vars.find((y) => y.key === k); return x ? x.value : k === 'nl' ? '\n' : ''; });

  // `also` = layers the template has but that are normally fixed labels: kept if already chosen, never added by themselves.
  function mergeFields(cur, found, also) {
    const out = [], seen = new Set(), extra = new Map((also || []).map((f) => [f.key, f]));
    const fresh = (f) => ({ key: f.key, label: f.label, type: f.type, value: f.type === 'image' ? '' : f.value || '', sample: f.type === 'image' ? f.sample || '' : f.sample || f.value || '' });
    for (const f of found) { const mine = (cur || []).find((x) => x.key === f.key); out.push(mine ? { ...mine, missing: undefined, sample: f.sample || mine.sample || '' } : fresh(f)); seen.add(f.key); }
    for (const f of cur || []) {
      if (seen.has(f.key)) continue;
      if (extra.has(f.key) || f.manual) { out.push({ ...f, missing: undefined }); continue; }
      if (!String(f.value || '').trim()) continue;                       // not in the template and never filled in: dropped
      out.push({ ...f, missing: true });
    }
    return out.map(({ missing, ...f }) => (missing ? { ...f, missing: true } : f));
  }

  // ---- list: the folder, what is in it, what has been loaded ------------------------------------
  App.pages.templates = (id) => {
    if (id) return editor(id);
    const body = h('div', {});
    if (!local()) return { el: h('div', {}, head('Templates'), h('div', { class: 'card' }, h('h2', {}, 'Templates are read from the production PC'), h('p', { class: 'dim', style: { marginBottom: 0 } }, 'Open RFP Manager on the PC that runs CasparCG. Graphics you load there appear here and can be edited from anywhere.')), loadedCard()) };
    let q = '';
    const load = async () => {
      let r;
      try { r = await api('GET', '/api/templates'); } catch (e) { body.replaceChildren(h('div', { class: 'card' }, e.message)); return; }
      const folderIn = h('input', { type: 'text', value: r.builtIn ? '' : r.folder, placeholder: 'C:\\CasparCG\\template   (empty = the templates that come with RFP Manager)' });
      const table = h('div', {});
      const paint = () => {
        const mine = loaded();
        const rows = r.templates.filter((t) => !q || t.path.toLowerCase().includes(q.toLowerCase()));
        table.replaceChildren(rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Template'), h('th', {}, 'Variable fields'), h('th', {}, 'Loaded as'), h('th', {}, ''))),
          h('tbody', {}, rows.map((t) => {
            const uses = mine.filter((g) => g.data.template === t.path);
            return h('tr', {}, h('td', {}, h('b', {}, t.name), t.folder ? h('div', { class: 'dim small' }, t.folder + '/') : null), h('td', { class: 'dim' }, (t.fields ? t.fields + ' found' : 'none found') + (t.lottie ? ' · Lottie' : '')),
              h('td', {}, uses.length ? uses.map((g) => h('a', { class: 'pill', href: '#/templates/' + g.id, style: { marginRight: '4px' } }, g.data.name)) : h('span', { class: 'dim' }, '–')),
              h('td', { class: 'right nowrap' }, h('a', { class: 'btn sm', href: '/live/templates/' + t.path.split('/').map(encodeURIComponent).join('/') + '.html?demo', target: '_blank', rel: 'noopener' }, 'Open ↗'), ' ',
                App.can('edit') ? h('button', { class: 'sm primary', onclick: () => add(t) }, uses.length ? 'Load again' : 'Load') : null));
          })))) : h('div', { class: 'empty' }, r.exists ? (q ? 'No template matches that search.' : 'No HTML templates in this folder.') : 'That folder does not exist on this PC.'));
      };
      const make = async (t, themeId) => {
        const f = await api('GET', '/api/templates/fields?path=' + encodeURIComponent(t.path));
        const n = loaded().filter((g) => g.data.template === t.path).length;
        const kind = /full|fs|frame|table/i.test(t.name) ? 'fs' : /bug|clock|score/i.test(t.name) ? 'bug' : /wipe|sting|trans/i.test(t.name) ? 'wipe' : 'lt';
        const fields = mergeFields([], f.fields, f.more);
        const linked = autoLink(fields, (liveVars || await loadVars()).vars);
        const doc = await App.save('graphic', App.newId('graphic'), { name: t.name.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) + (n ? ' ' + (n + 1) : ''), template: t.path, theme: themeId || '', kind, channel: 0, layer: kind === 'fs' ? 40 : kind === 'bug' ? 22 : kind === 'wipe' ? 60 : 35, fields });
        return { doc, linked };
      };
      const add = async (t) => { try { const r2 = await make(t); if (r2.linked) toast(`${r2.linked} variable${r2.linked === 1 ? '' : 's'} linked to live values automatically`); location.hash = '#/templates/' + r2.doc.id; } catch (e) { oops(e); } };
      // A folder in the template folder is a theme: one click makes the Theme record and loads every template in it.
      const folders = [...new Set(r.templates.filter((t) => t.path.includes('/')).map((t) => t.path.split('/')[0]))].sort();
      const themeOf = (folder) => App.list('theme').find((d) => String(d.data.templateFolder || '') === folder);
      const loadTheme = async (folder) => {
        try {
          let th = themeOf(folder);
          if (!th) th = await App.save('theme', App.newId('theme'), { name: folder, templateFolder: folder, description: 'Read from the template folder' });
          let made = 0, linked = 0;
          for (const t of r.templates.filter((x) => x.path.split('/')[0] === folder && x.path.includes('/'))) {
            if (loaded().some((g) => g.data.template === t.path && g.data.theme === th.id)) continue;
            const loose = loaded().find((g) => g.data.template === t.path && !g.data.theme);            // already loaded on its own: it joins the theme
            if (loose) { await App.save('graphic', loose.id, { ...loose.data, theme: th.id }); made++; continue; }
            const r2 = await make(t, th.id); made++; linked += r2.linked;
          }
          toast(made ? `Theme "${folder}": ${made} graphic${made === 1 ? '' : 's'} loaded` + (linked ? `, ${linked} variables linked to live values` : '') : `Theme "${folder}" is up to date`);
          load();
        } catch (e) { oops(e); }
      };
      const themesCard = () => h('div', { class: 'card' }, h('h2', {}, 'Themes'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, 'Each folder inside the template folder is a theme. Loading one makes a Theme and a graphic for every template in it. Set the theme on a competition (Competitions → Theme) and its matches use it: its graphics come first in Graphics control, and a file named like a built-in template (scorebug, lowerthird, fullframe, sport_bug …) replaces that built-in graphic.'),
        folders.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, folders.map((f) => {
          const th = themeOf(f), inFolder = r.templates.filter((x) => x.path.split('/')[0] === f && x.path.includes('/')), mine = th ? loaded().filter((g) => g.data.theme === th.id) : [];
          const comps = th ? App.list('competition').filter((c) => c.data.theme === th.id) : [];
          return h('tr', {}, h('td', {}, h('b', {}, f), h('div', { class: 'dim small' }, `${inFolder.length} template${inFolder.length === 1 ? '' : 's'}`)),
            h('td', {}, th ? [h('a', { class: 'pill ok', href: '#/edit/theme/' + th.id }, 'Theme'), ' ', h('span', { class: 'dim small' }, `${mine.length} of ${inFolder.length} loaded` + (comps.length ? ' · used by ' + comps.map((c) => App.title('competition', c.id)).join(', ') : ' · not set on a competition yet'))] : h('span', { class: 'dim' }, 'Not a theme yet')),
            h('td', { class: 'right nowrap' }, App.can('edit') ? h('button', { class: th && mine.length >= inFolder.length ? 'sm' : 'sm primary', onclick: () => loadTheme(f) }, th ? (mine.length >= inFolder.length ? 'Read folder again' : 'Load the rest') : 'Load as theme') : null));
        })))) : h('p', { class: 'dim', style: { marginBottom: 0 } }, 'No sub-folders with templates in this folder.'));
      body.replaceChildren(
        h('div', { class: 'card' }, h('h2', {}, 'Template folder on this PC'),
          h('p', { class: 'dim', style: { marginTop: 0 } }, 'Point this at CasparCG\'s template folder (template-path in casparcg.config). RFP Manager reads the HTML templates in it and in its sub-folders; it never changes them.'),
          h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('div', { class: 'grow' }, folderIn),
            h('button', { class: 'primary', disabled: !App.machine.admin, title: App.machine.admin ? '' : 'Only an Admin can change this machine', onclick: async () => { try { await api('PUT', '/api/templates/folder', { folder: folderIn.value }); toast('Template folder saved'); load(); } catch (e) { oops(e); } } }, 'Save'),
            h('button', { onclick: load }, 'Read again')),
          h('div', { class: 'dim small', style: { marginTop: '8px' } }, r.exists ? `${r.templates.length} templates in ${r.folder}` : `Not found: ${r.folder}`)),
        themesCard(),
        loadedCard(),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'In the folder'), h('input', { type: 'search', placeholder: 'Search…', style: { width: '220px' }, oninput: (e) => { q = e.target.value; paint(); } })), table));
      paint();
    };
    load();
    return { el: h('div', {}, head('Templates', h('a', { class: 'btn', href: '/live/control.html' }, 'Graphics control ↗')), body), keepScroll: true, onMessage: UI.debounce((m) => { if (m.type === 'doc' && ['graphic', 'theme', 'competition'].includes(m.doc.type)) load(); }, 600) };
  };

  let lq = '', lshow = 'all';
  function loadedCard() {
    const card = h('div', { class: 'card' });
    const paint = () => card.replaceChildren(...[].concat(loadedBody(paint)).filter(Boolean));
    paint();
    return card;
  }
  function loadedBody(repaint) {
    const everything = loaded();
    const text = (g) => [g.data.name, g.data.template, g.data.theme && App.get(g.data.theme) ? App.get(g.data.theme).name : ''].join(' ').toLowerCase();
    const mine = everything.filter((g) => (!lq || text(g).includes(lq.toLowerCase())) && (lshow === 'all' || (lshow === 'hidden') === !!g.data.hidden));
    const setAll = async (hidden) => {
      const todo = mine.filter((g) => !!g.data.hidden !== hidden);
      if (!todo.length) return;
      try { for (const g of todo) await App.save('graphic', g.id, { ...g.data, hidden }); toast(`${todo.length} graphic${todo.length === 1 ? '' : 's'} ${hidden ? 'hidden' : 'shown'}`); } catch (err) { oops(err); }
    };
    const nHidden = everything.filter((g) => g.data.hidden).length;
    return [h('div', { class: 'spread' }, h('h2', {}, 'Loaded graphics'), everything.length ? h('div', { class: 'row' },
        h('select', { style: { width: 'auto' }, onchange: (e) => { lshow = e.target.value; repaint(); } }, [['all', `All (${everything.length})`], ['shown', `Shown (${everything.length - nHidden})`], ['hidden', `Hidden (${nHidden})`]].map(([v, l]) => h('option', { value: v, selected: lshow === v }, l))),
        h('input', { type: 'search', value: lq, placeholder: 'Search name or folder, e.g. OLD/', style: { width: '240px' }, oninput: UI.debounce((e) => { lq = e.target.value; repaint(); const i = document.querySelector('#lg-q'); if (i) { i.focus(); i.setSelectionRange(lq.length, lq.length); } }, 250), id: 'lg-q' }),
        App.can('edit') ? h('button', { class: 'sm', onclick: () => setAll(true) }, `Hide these ${mine.length}`) : null,
        App.can('edit') ? h('button', { class: 'sm', onclick: () => setAll(false) }, `Show these ${mine.length}`) : null) : null),
      !everything.length ? null : mine.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Name', 'Theme', 'Template', 'Kind', 'Channel-layer', 'Fields', 'Linked', 'In Graphics control'].map((x) => h('th', {}, x)))),
        h('tbody', {}, mine.map((g) => h('tr', { class: 'click', tabindex: '0', onclick: () => { location.hash = '#/templates/' + g.id; } }, h('td', {}, h('b', {}, g.data.name)), h('td', {}, g.data.theme && App.get(g.data.theme) ? h('span', { class: 'pill' }, App.get(g.data.theme).name) : h('span', { class: 'dim' }, '–')), h('td', { class: 'dim' }, g.data.template),
          h('td', {}, (KINDS.find((k) => k[0] === g.data.kind) || ['', g.data.kind])[1]), h('td', { class: 'num' }, `${Number(g.data.channel) || 'PGM'}-${g.data.layer || 35}`), h('td', { class: 'dim' }, (g.data.fields || []).length), h('td', { class: 'dim' }, (g.data.fields || []).filter((f) => /\{\w+\}/.test(f.value || '')).length || ''),
          h('td', { class: 'nowrap' }, [].concat(g.data.replaces || []).length ? h('span', { class: 'pill ok', title: 'Plays instead of a built-in graphic' }, 'linked') : null, ' ',
            App.can('edit') ? h('button', { class: 'sm' + (g.data.hidden ? '' : ' ghost'), title: g.data.hidden ? 'Hidden from the operator. Click to show it.' : 'Click to hide it from the operator', onclick: async (e) => { e.stopPropagation(); try { await App.save('graphic', g.id, { ...g.data, hidden: !g.data.hidden }); } catch (err) { oops(err); } } }, g.data.hidden ? 'Hidden' : 'Shown') : (g.data.hidden ? 'Hidden' : 'Shown')))))))
        : h('div', { class: 'empty' }, 'Nothing matches.'),
      everything.length ? h('p', { class: 'help' }, '"Shown / Hidden" decides whether the graphic has its own button in Graphics control. Search for a sub-folder (OLD/, STATIC/) and use "Hide these" to hide many at once. A hidden graphic still works when it is linked to a built-in button.')
        : h('p', { class: 'dim', style: { marginBottom: 0 } }, 'None yet. Load a template from the folder below; it then appears in Graphics control under "My templates".')];
  }

  // ---- one loaded graphic: settings, field values, preview ------------------------------------
  function editor(id) {
    const doc = App.docs.get(id);
    if (!doc || doc.type !== 'graphic') return { el: h('div', { class: 'card' }, 'That graphic no longer exists. ', h('a', { href: '#/templates' }, 'Back to Templates')) };
    const d = JSON.parse(JSON.stringify(doc.data)); d.fields = d.fields || [];
    const can = App.can('edit');
    const frame = h('iframe', { title: 'Preview', src: '/live/templates/' + String(d.template).split('/').map(encodeURIComponent).join('/') + '.html', style: { position: 'absolute', left: 0, top: 0, width: '1920px', height: '1080px', border: 0, transformOrigin: '0 0' } });
    const stage = h('div', { style: { position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', borderRadius: '6px', border: '1px solid var(--line)', background: 'repeating-conic-gradient(#222 0 25%, #1a1a1a 0 50%) 0 0 / 24px 24px' } }, frame);
    const fit = () => { frame.style.transform = `scale(${stage.clientWidth / 1920})`; };
    let ready = false, played = false;
    const push = UI.debounce(() => {
      if (!ready) return;
      const data = {};
      const vars = liveVars ? liveVars.vars : [];
      for (const f of d.fields) { if (f.type === 'image' && !f.value) continue; let v = fillTokens(f.value, vars); if (f.type === 'image' && !v) continue; if (f.type === 'color' && (/^transparent$/i.test(v) || (!v && f.emptyTransparent))) v = d.transparentAs || 'transparent'; data[f.key] = f.type === 'image' && /^img_/.test(v) ? '/media/' + v : v; }
      for (const r of d.triggers || []) {              // IF … THEN set a field: shown in the preview as it would be right now
        if (r.then !== 'set' || r.off || !r.field || !r.when) continue;
        const a = String((vars.find((x) => x.key === r.when) || {}).value || '').trim(), b = fillTokens(r.value, vars).trim(), na = parseFloat(a), nb = parseFloat(b), num = isFinite(na) && isFinite(nb), lo = (x) => x.toLowerCase();
        const yes = { '=': num ? na === nb : lo(a) === lo(b), '!=': num ? na !== nb : lo(a) !== lo(b), '>': num && na > nb, '<': num && na < nb, '>=': num && na >= nb, '<=': num && na <= nb, contains: b !== '' && lo(a).includes(lo(b)), empty: a === '', notempty: a !== '' }[r.op];
        if (yes) { const v = fillTokens(r.to, vars); data[r.field] = /^transparent$/i.test(v) ? d.transparentAs || 'transparent' : v; }
      }
      try { const w = frame.contentWindow; if (typeof w.update === 'function') w.update(JSON.stringify(data)); if (!played && typeof w.play === 'function') { w.play(); played = true; } } catch (e) { /* template without update() */ }
    }, 150);
    frame.addEventListener('load', () => { ready = true; played = false; fit(); setTimeout(push, 100); });
    window.addEventListener('resize', fit);
    // ---- link to built-in graphics: one template can stand in for several (the cricket bug and the bug for the other sports, say)
    d.replaces = [].concat(d.replaces || []).filter(Boolean);
    const linkBox = h('div', {});
    const WHICH = { cricket: 'cricket', sport: 'rugby, football, hockey, netball, tennis …', any: 'every match' };
    const fillReplaces = () => {
      const list = (liveVars && liveVars.builtIn) || [], th = liveVars && liveVars.theme, mode = liveVars ? liveVars.mode : '';
      const nameOf = (id) => { const g = list.find((x) => x.id === id); return g ? `${g.name} (${WHICH[g.mode] || g.mode})` : id; };
      const groups = [...new Set(list.map((g) => g.group))];
      const change = async () => { await loadVars(d.replaces); fillReplaces(); paintFields(); push(); };
      const add = h('select', { disabled: !can, onchange: (e) => { if (e.target.value && !d.replaces.includes(e.target.value)) { d.replaces.push(e.target.value); change(); } } }, h('option', { value: '' }, d.replaces.length ? '+ Link to another built-in graphic…' : 'None: it is an extra graphic. Choose a built-in graphic to replace…'),
        ...groups.map((gr) => h('optgroup', { label: gr + ' – ' + (WHICH[(list.find((g) => g.group === gr) || {}).mode] || '') }, list.filter((g) => g.group === gr && !d.replaces.includes(g.id)).map((g) => h('option', { value: g.id }, `${g.name} (${WHICH[g.mode] || g.mode})`)))));
      // what would stop it from working right now, said plainly
      const notes = [];
      const linked = d.replaces.map((id) => list.find((x) => x.id === id)).filter(Boolean);
      if (linked.length && liveVars && liveVars.onAir && !linked.some((g) => g.mode === 'any' || g.mode === mode)) {
        const twin = list.find((g) => g.mode === mode && linked.some((x) => x.name === g.name));
        notes.push(h('div', { class: 'pill warn', style: { whiteSpace: 'normal', marginTop: '8px' } }, `The match on air is ${mode === 'sport' ? 'not cricket' : 'cricket'}, and ${linked.map((g) => g.name).join(', ')} here is the ${WHICH[linked[0].mode]} one, so this link does nothing for it. `,
          twin && can ? h('button', { type: 'button', class: 'sm', onclick: () => { d.replaces.push(twin.id); change(); } }, `Also link "${twin.name}" for ${WHICH[twin.mode]}`) : null));
      }
      if (linked.length && !d.theme) notes.push(h('div', { class: 'pill warn', style: { whiteSpace: 'normal', marginTop: '8px' } }, 'Give this graphic a theme (above): a link only works while its theme is in use.'));
      else if (linked.length && th && !(th.active && th.active.id === d.theme)) {
        const name = (App.get(d.theme) || {}).name || 'this theme';
        notes.push(h('div', { class: 'pill warn', style: { whiteSpace: 'normal', marginTop: '8px' } }, `"${name}" is not the theme in use on this PC right now${th.active ? ` ("${th.active.name}" is)` : ' (the standard graphics are)'}, so the built-in buttons still play the standard templates. `,
          can ? h('button', { type: 'button', class: 'sm primary', onclick: async () => { try { await api('POST', '/live/api/theme', { theme: d.theme }); toast(`"${name}" is now the theme in use on this PC`); await change(); } catch (e) { oops(e); } } }, 'Use this theme now') : null));
      } else if (linked.length && th && th.active && th.active.id === d.theme) notes.push(h('div', { class: 'pill ok', style: { whiteSpace: 'normal', marginTop: '8px' } }, `In use now: "${th.active.name}" is the theme on this PC. Save, and the built-in button plays this template.`));
      linkBox.replaceChildren(d.replaces.length ? h('div', { class: 'row', style: { marginBottom: '6px' } }, d.replaces.map((id) => h('span', { class: 'pill ok' }, nameOf(id), can ? h('button', { type: 'button', class: 'ghost sm', title: 'Remove this link', style: { marginLeft: '4px', padding: '0 4px' }, onclick: () => { d.replaces = d.replaces.filter((x) => x !== id); change(); } }, '✕') : null))) : '', add, ...notes);
    };
    const fieldsBox = h('div', {});
    let scanned = null;                                                   // what the template file itself holds: { key -> { sample, preview, color } } and the layers not offered by default
    const info = (f) => (scanned && scanned.by.get(f.key)) || {};
    const preview = (f) => {
      const x = info(f), sample = x.sample !== undefined ? x.sample : f.sample || '', color = x.color || (f.type === 'color' ? sample : '');
      if (f.type === 'image') return x.preview ? h('img', { src: x.preview, alt: '', title: sample, style: { height: '44px', maxWidth: '110px', objectFit: 'contain', background: 'repeating-conic-gradient(#333 0 25%, #222 0 50%) 0 0 / 12px 12px', borderRadius: '4px' } }) : h('span', { class: 'dim small' }, sample || 'no picture');
      const sw = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? h('span', { title: color, style: { display: 'inline-block', width: '16px', height: '16px', borderRadius: '4px', background: color, border: '1px solid var(--line)', flex: 'none' } }) : null;
      if (f.type === 'color') return h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, sw, h('code', { class: 'small' }, color || '–'));
      return h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, sw, h('span', { class: 'small', style: { whiteSpace: 'pre-line', maxHeight: '54px', overflow: 'hidden' } }, sample || h('span', { class: 'dim' }, 'empty')));
    };
    // Choose one of RFP Manager's live values for this variable. Text can mix several with words; a picture or colour takes one.
    const pickLink = async (f) => {
      const all = (liveVars || await loadVars(d.replaces)).vars;
      let q = f.type === 'image' ? 'logo' : f.type === 'color' ? 'color' : '';
      const listEl = h('div', { style: { maxHeight: '52vh', overflow: 'auto' } });
      let close = () => {};
      const choose = (v) => { f.value = f.type === 'multiline' && f.value ? f.value + '\n{' + v.key + '}' : f.type === 'text' && f.value && !/^\{\w+\}$/.test(f.value) ? f.value + ' {' + v.key + '}' : '{' + v.key + '}'; close(); paintFields(); push(); };
      const paint = () => {
        const words = q.toLowerCase().split(/\s+/).filter(Boolean), rows = all.filter((v) => words.every((w) => (v.key + ' ' + v.group + ' ' + v.value + ' ' + (v.note || '')).toLowerCase().includes(w)));
        const groups = [...new Set(rows.map((v) => v.group))];
        listEl.replaceChildren(rows.length ? h('table', { class: 't' }, h('tbody', {}, groups.flatMap((g) => [h('tr', {}, h('td', { colspan: '2', class: 'dim small', style: { textTransform: 'uppercase', letterSpacing: '.06em' } }, g)),
          ...rows.filter((v) => v.group === g).map((v) => h('tr', { class: 'click', tabindex: '0', onclick: () => choose(v), onkeydown: (e) => { if (e.key === 'Enter') choose(v); } }, h('td', {}, h('code', {}, v.key)),
            h('td', { class: 'dim' }, /^\/media\//.test(v.value) ? h('img', { src: v.value, alt: '', style: { height: '26px' } }) : /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.value) ? [h('span', { style: { display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: v.value, verticalAlign: 'middle', marginRight: '6px' } }), v.value] : String(v.value).slice(0, 60) || h('span', { class: 'dim' }, v.away ? 'not in the match on air' + (v.note ? ' · ' + v.note : '') : 'empty right now'))))])))
          : h('div', { class: 'empty' }, 'Nothing matches.'));
      };
      paint();
      close = UI.modal({ title: `Link "${f.label || f.key}" to a live value`, wide: true, body: h('div', {},
        h('p', { class: 'dim', style: { marginTop: 0 } }, (liveVars.onAir ? 'Values shown are from the match on air now. The graphic follows them while it is on air.' : 'No match is on air, so most values are empty examples. The links still work once a match is on air.') + ` Every variable is listed (${all.length}): those of other sports are further down and fill in when that sport is on air.`),
        h('input', { type: 'search', placeholder: 'Search: team, score, logo, clock, stat…', value: q, autofocus: true, oninput: (e) => { q = e.target.value; paint(); } }), h('div', { style: { height: '8px' } }), listEl), actions: [{ label: 'Cancel' }] });
    };
    const linkOf = (f) => (/\{\w+\}/.test(f.value || '') ? f.value : '');
    const valueInput = (f) => {
      const inner = valueInput0(f);
      if (!can) return inner;
      const linked = linkOf(f);
      return h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, h('div', { style: { flex: '1 1 150px', minWidth: 0 } }, linked && f.type !== 'text' ? h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } }, h('code', { class: 'pill ok', title: 'Follows this live value' }, linked), h('button', { type: 'button', class: 'ghost sm', title: 'Remove the link', onclick: () => { f.value = ''; paintFields(); push(); } }, 'Unlink')) : inner),
        h('div', { class: 'row', style: { gap: '6px' } }, h('button', { type: 'button', class: 'sm', title: linked ? 'Change which live value this follows' : 'Link to a live value: team names, scores, clock, logos…', onclick: () => pickLink(f) }, linked ? 'Change…' : 'Link…'),
          linked && liveVars ? (() => {
            const now = fillTokens(f.value, liveVars.vars);
            if (f.type === 'image') return now ? h('img', { src: /^img_/.test(now) ? '/media/' + now : now, alt: '', title: 'What it shows right now', style: { height: '28px', maxWidth: '70px', objectFit: 'contain' } }) : h('span', { class: 'dim small' }, '→ no picture right now');
            if (f.type === 'color') return /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(now) ? h('span', { class: 'dim small', title: 'What it shows right now' }, '→ ', h('span', { style: { display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: now, verticalAlign: 'middle', border: '1px solid var(--line)' } }), ' ' + now) : h('span', { class: 'dim small' }, '→ no colour right now');
            return h('span', { class: 'dim small', title: 'What it shows right now' }, '→ ' + (now || 'empty right now'));
          })() : null),
        linked && f.type === 'color' ? h('label', { class: 'row small', style: { marginTop: '4px', gap: '6px' } }, h('input', { type: 'checkbox', checked: !!f.emptyTransparent, onchange: (e) => { f.emptyTransparent = e.target.checked; push(); } }), 'Transparent when there is no value') : null);
    };
    const valueInput0 = (f) => {
      const set = (v) => { f.value = v; push(); };
      if (f.type === 'image') return fieldInput({ k: f.key, l: f.label, t: 'image' }, f.value, set, {});
      if (f.type === 'color') {
        const clear = /^transparent$/i.test(f.value || '');
        return h('div', {}, clear ? h('div', { class: 'row', style: { gap: '6px' } }, h('span', { title: 'Transparent', style: { display: 'inline-block', width: '42px', height: '36px', borderRadius: '6px', border: '1px solid var(--line)', background: 'repeating-conic-gradient(#555 0 25%, #333 0 50%) 0 0 / 12px 12px' } }), h('span', { class: 'dim' }, 'Transparent'))
          : fieldInput({ k: f.key, l: f.label, t: 'color' }, f.value, set, {}),
          h('label', { class: 'row small', style: { marginTop: '4px', gap: '6px' } }, h('input', { type: 'checkbox', checked: clear, onchange: (e) => { f.value = e.target.checked ? 'transparent' : ''; paintFields(); push(); } }), 'Transparent'));
      }
      const sample = info(f).sample !== undefined ? info(f).sample : f.sample || '';
      if (f.type === 'multiline') return h('textarea', { rows: Math.min(8, Math.max(3, String(f.value || '').split('\n').length)), value: f.value || '', placeholder: 'Several lines of text – press Enter for a new line. {teamA_name} follows the match.', oninput: (e) => set(e.target.value) });
      return h('input', { type: 'text', value: f.value || '', placeholder: sample && !/^in "/.test(sample) ? sample : 'Text, or {teamA_name} to follow the match', oninput: (e) => set(e.target.value) });
    };
    const paintFields = () => {
      fieldsBox.replaceChildren(d.fields.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Variable'), h('th', {}, 'Label'), h('th', {}, 'Type'), h('th', {}, 'In the template'), h('th', { style: { width: '34%' } }, 'Your value'), h('th', {}, ''))),
        h('tbody', {}, d.fields.map((f, i) => h('tr', {},
          h('td', {}, h('code', {}, f.key), f.missing ? h('div', { class: 'pill warn', title: 'The template no longer has this variable' }, 'not in template') : null),
          h('td', {}, h('input', { type: 'text', value: f.label || '', style: { minWidth: '120px' }, oninput: (e) => { f.label = e.target.value; } })),
          h('td', {}, h('select', { style: { minWidth: '92px' }, onchange: (e) => { f.type = e.target.value; paintFields(); } }, [['text', 'Text'], ['multiline', 'Text, several lines'], ['image', 'Image'], ['color', 'Colour']].map(([v, l]) => h('option', { value: v, selected: (f.type || 'text') === v }, l)))),
          h('td', {}, preview(f)),
          h('td', {}, valueInput(f)),
          h('td', { class: 'right nowrap' }, h('button', { type: 'button', class: 'ghost sm', disabled: i === 0, title: 'Move up', onclick: () => { [d.fields[i - 1], d.fields[i]] = [d.fields[i], d.fields[i - 1]]; paintFields(); } }, '↑'),
            h('button', { type: 'button', class: 'ghost sm', title: 'Remove this field', onclick: () => { d.fields.splice(i, 1); paintFields(); push(); } }, '✕')))))))
        : h('p', { class: 'dim' }, 'No variable fields yet. Read them from the template, or add them by hand.'),
        (() => {
          const rest = scanned ? scanned.more.filter((m) => !d.fields.some((f) => f.key === m.key)) : [];
          if (!rest.length || !can) return '';
          return h('div', { class: 'help', style: { marginTop: '10px' } }, `${rest.length} more layer${rest.length === 1 ? '' : 's'} in the template look like fixed labels or artwork and are left out. Add one if it should change: `,
            rest.slice(0, 40).map((m) => h('button', { type: 'button', class: 'sm', style: { margin: '2px 4px 2px 0' }, title: m.sample || '', onclick: () => { d.fields.push({ key: m.key, label: m.label, type: m.type, value: m.type === 'image' ? '' : m.value || '', sample: m.sample || '' }); paintFields(); push(); } }, '+ ' + m.key)));
        })());
      if (!can) fieldsBox.querySelectorAll('input, select, button').forEach((x) => { x.disabled = true; });
    };
    // ---- variables in bulk: a spreadsheet-friendly file out, and the same file (or JSON) back in
    const csvCell = (x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`;
    const exportFields = () => {
      const rows = [['variable', 'label', 'type', 'value'], ...d.fields.map((f) => [f.key, f.label || '', f.type || 'text', f.value || ''])];
      const a = h('a', { href: URL.createObjectURL(new Blob(['\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' })), download: (d.name || 'graphic').replace(/[^\w.-]+/g, '_') + '-variables.csv' });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const parseCsv = (text) => {
      const rows = []; let row = [], cell = '', q = false;
      const t = text.replace(/^\ufeff/, ''), sep = (t.split(/\r?\n/)[0].match(/;/g) || []).length > (t.split(/\r?\n/)[0].match(/,/g) || []).length ? ';' : ',';
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
        if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
      }
      if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
      return rows.filter((r) => r.some((x) => String(x).trim()));
    };
    const importFields = () => {
      const inp = h('input', { type: 'file', accept: '.csv,.json,.txt,text/csv,application/json', style: { display: 'none' } });
      inp.onchange = async () => {
        try {
          const text = await inp.files[0].text();
          let list = [];
          if (/^\s*[\[{]/.test(text)) { const j = JSON.parse(text); list = Array.isArray(j) ? j : Array.isArray(j.fields) ? j.fields : Object.entries(j).map(([key, value]) => ({ key, value })); list = list.map((x) => ({ key: x.key || x.variable, label: x.label, type: x.type, value: x.value })); }
          else {
            const rows = parseCsv(text), head = rows[0].map((x) => String(x).trim().toLowerCase());
            const col = (names) => head.findIndex((x) => names.includes(x)), ik = col(['variable', 'key', 'name', 'field']), il = col(['label']), it = col(['type']), iv = col(['value', 'your value']);
            const body = ik >= 0 ? rows.slice(1) : rows;                     // no heading row: variable, value
            list = body.map((r) => (ik >= 0 ? { key: r[ik], label: il >= 0 ? r[il] : undefined, type: it >= 0 ? r[it] : undefined, value: iv >= 0 ? r[iv] : r[1] } : { key: r[0], value: r[1] }));
          }
          let changed = 0, added = 0;
          for (const x of list) {
            const key = String(x.key || '').trim(); if (!key) continue;
            const type = ['text', 'multiline', 'image', 'color'].includes(String(x.type || '').toLowerCase().replace('colour', 'color')) ? String(x.type).toLowerCase().replace('colour', 'color') : null;
            let f = d.fields.find((y) => y.key === key);
            if (!f) { f = { key, label: x.label || key, type: type || 'text', value: '', manual: true }; d.fields.push(f); added++; } else changed++;
            if (x.label !== undefined && String(x.label).trim()) f.label = String(x.label);
            if (type) f.type = type;
            if (x.value !== undefined) f.value = String(x.value == null ? '' : x.value);
          }
          paintFields(); push();
          toast(`${changed} variable${changed === 1 ? '' : 's'} updated` + (added ? `, ${added} added` : '') + '. Save to keep them.');
        } catch (e) { toast('That file could not be read: ' + e.message, 'error'); }
      };
      document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
    };
    const take = (f) => { scanned = { by: new Map([...f.fields, ...(f.more || [])].map((x) => [x.key, x])), more: f.more || [] }; tplFunctions = f.functions || []; paintInvokes(); };
    const reread = async (quiet) => {
      try {
        const f = await api('GET', '/api/templates/fields?path=' + encodeURIComponent(d.template));
        take(f);
        const known = (k) => scanned.by.has(k);
        // First look, or asked for: bring the list in line with the file. Names the file does not have and that were never filled in go.
        const stale = d.fields.some((x) => !known(x.key) && !x.manual && !String(x.value || '').trim());
        if (quiet !== true || stale) { const before = d.fields.map((x) => x.key).join('|'); d.fields = mergeFields(d.fields, f.fields, f.more); if (quiet !== true || d.fields.map((x) => x.key).join('|') !== before) toast(quiet === true ? 'The field list was brought in line with the template. Save to keep it.' : `${f.fields.length} editable variable${f.fields.length === 1 ? '' : 's'} in the template`); }
        paintFields(); push();
      } catch (e) { if (quiet !== true) oops(e); }
    };
    const addField = async () => { const key = await UI.promptBox('Add a field', 'Variable name, exactly as the template expects it (for example f0 or title)'); if (!key || !key.trim() || key.trim().length > 60) return; if (d.fields.some((f) => f.key === key.trim())) return; d.fields.push({ key: key.trim(), label: key.trim(), type: 'text', value: '', manual: true }); paintFields(); };
    const inp = (k, attrs) => h('input', Object.assign({ value: d[k] === undefined || d[k] === null ? '' : d[k], oninput: (e) => { d[k] = attrs && attrs.type === 'number' ? Number(e.target.value) : e.target.value; } }, attrs || { type: 'text' }));
    const lab = (text, el, help) => h('label', { class: 'f' }, h('span', {}, text), el, help ? h('div', { class: 'help' }, help) : null);
    const save = async () => { try { if (!String(d.name || '').trim()) return toast('Give the graphic a name', 'error'); await App.save('graphic', id, { ...d, fields: d.fields.map(({ missing, ...f }) => ({ ...f, sample: String(f.sample || '').slice(0, 200) })) }); toast('Saved. It is in Graphics control under "My templates".'); } catch (e) { oops(e); } };
    // ================================================================ triggers: IF a live value … THEN do something with this graphic
    let btnH = null, trigH = null;
    const counts = () => { if (btnH) btnH.textContent = 'Buttons' + (d.invokes && d.invokes.length ? ` (${d.invokes.length})` : ''); if (trigH) trigH.textContent = 'Triggers' + (d.triggers.length ? ` (${d.triggers.length})` : ''); };
    d.triggers = Array.isArray(d.triggers) ? d.triggers : [];
    const trigBox = h('div', {});
    const OPS = [['=', 'is'], ['!=', 'is not'], ['>', 'is more than'], ['<', 'is less than'], ['>=', 'is at least'], ['<=', 'is at most'], ['contains', 'contains'], ['notempty', 'has a value'], ['empty', 'is empty'], ['changes', 'changes']];
    const THEN = [['show', 'show this graphic'], ['hide', 'take this graphic off'], ['update', 'update this graphic'], ['set', 'set a field to']];
    const EXAMPLES = [['A card is shown', { when: 'card_key', op: 'changes', value: '', then: 'show', seconds: 8 }], ['A score happens', { when: 'last_key', op: 'changes', value: '', then: 'show', seconds: 8 }], ['The clock stops', { when: 'clock_running', op: 'empty', value: '', then: 'show', seconds: 0 }], ['The clock runs', { when: 'clock_running', op: '=', value: '1', then: 'hide', seconds: 0 }], ['A method is invoked', { when: 'invoke', op: '=', value: '', then: 'update', seconds: 0 }], ['Red card = red field', { when: 'card_key', op: 'contains', value: 'red', then: 'set', field: '', to: '#e5484d' }]];
    const paintTriggers = () => {
      counts();
      const vars = liveVars ? liveVars.vars : [];
      let dl = document.getElementById('dl-livevars');
      if (!dl) { dl = h('datalist', { id: 'dl-livevars' }); document.body.appendChild(dl); }
      dl.replaceChildren(h('option', { value: 'invoke' }, 'a method is invoked on this graphic'), ...vars.slice(0, 1500).map((v) => h('option', { value: v.key }, String(v.value || v.group).slice(0, 40))));
      const sel = (list, val, on, w) => h('select', { style: { width: w || 'auto' }, disabled: !can, onchange: (e) => { on(e.target.value); paintTriggers(); push(); } }, list.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
      const txt = (val, on, ph, w, list) => h('input', Object.assign({ type: 'text', value: val || '', placeholder: ph, disabled: !can, style: { width: w }, oninput: (e) => { on(e.target.value); push(); } }, list ? { list } : {}));
      const now = (r) => { const v = vars.find((x) => x.key === r.when); return v ? (v.value === '' ? 'empty now' : 'now: ' + String(v.value).slice(0, 24)) : r.when ? 'not a live value' : ''; };
      trigBox.replaceChildren(
        d.triggers.length ? h('div', {}, d.triggers.map((r, i) => h('div', { class: 'row', style: { gap: '6px', padding: '8px 0', borderBottom: '1px solid var(--line)', alignItems: 'center', opacity: r.off ? .5 : 1 } },
          h('input', { type: 'checkbox', checked: !r.off, title: 'Rule on / off', disabled: !can, onchange: (e) => { r.off = !e.target.checked; paintTriggers(); push(); } }),
          h('b', {}, 'IF'), txt(r.when, (v) => { r.when = v.trim(); }, 'live value, e.g. card_key', '190px', 'dl-livevars'),
          sel(OPS, r.op, (v) => { r.op = v; }),
          ['empty', 'notempty', 'changes'].includes(r.op) ? null : txt(r.value, (v) => { r.value = v; }, 'value', '120px'),
          h('b', {}, 'THEN'), sel(THEN, r.then, (v) => { r.then = v; }),
          r.then === 'show' ? [h('span', { class: 'dim' }, 'for'), h('input', { type: 'number', min: 0, value: r.seconds || 0, disabled: !can, style: { width: '70px' }, oninput: (e) => { r.seconds = Number(e.target.value) || 0; } }), h('span', { class: 'dim' }, 'seconds (0 = stays)')] : null,
          r.then === 'set' ? [sel([['', 'choose a field…'], ...d.fields.map((f) => [f.key, f.label || f.key])], r.field || '', (v) => { r.field = v; }, '160px'), h('span', { class: 'dim' }, 'to'), txt(r.to, (v) => { r.to = v; }, 'text, #colour, transparent or {live_value}', '210px')] : null,
          r.then === 'set' ? null : [h('span', { class: 'dim' }, 'after'), h('input', { type: 'number', min: 0, step: 0.1, value: r.delay || 0, disabled: !can, title: 'Seconds to wait before it happens. 0 = straight away.', style: { width: '66px' }, oninput: (e) => { r.delay = Number(e.target.value) || 0; } }), h('span', { class: 'dim' }, 's')],
          h('span', { class: 'dim small', style: { marginLeft: 'auto' } }, r.when === 'invoke' ? 'when a method is invoked' : now(r)),
          can ? h('button', { type: 'button', class: 'ghost sm', title: 'Remove this rule', onclick: () => { d.triggers.splice(i, 1); paintTriggers(); push(); } }, '✕') : null)))
          : h('p', { class: 'dim', style: { marginTop: 0 } }, 'No triggers. This graphic is only taken by the operator.'),
        can ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { type: 'button', onclick: () => { d.triggers.push({ when: '', op: '=', value: '', then: 'show', seconds: 0 }); paintTriggers(); } }, '+ Trigger'),
          h('span', { class: 'dim small' }, 'Start from: '), EXAMPLES.map(([l, r]) => h('button', { type: 'button', class: 'sm', onclick: () => { d.triggers.push(JSON.parse(JSON.stringify(r))); paintTriggers(); push(); } }, l))) : null);
    };
    // ================================================================ invoke buttons: extra steps the template offers while it is on air
    d.invokes = Array.isArray(d.invokes) ? d.invokes : [];
    const invBox = h('div', {});
    let tplFunctions = [];
    const ACTS = [['invoke', 'invoke a method on'], ['show', 'take'], ['hide', 'take off'], ['update', 'update'], ['set', 'set a field of this graphic'], ['amcp', 'send an AMCP command'], ['device', 'send a device command'], ['timeline', 'Timeline'], ['hideall', 'take everything off']];
    const actionsOf = (v) => { if (!Array.isArray(v.actions)) { v.actions = String(v.method || '').trim() ? [{ do: 'invoke', target: '', method: v.method }] : [{ do: 'invoke', target: '', method: '' }]; delete v.method; } return v.actions; };
    const paintInvokes = () => {
      counts();
      const others = [...((liveVars && liveVars.builtIn) || []).map((g) => [g.id, g.name + ' (' + g.group + ')']), ...App.list('graphic').filter((g) => g.id !== id).map((g) => ['tpl_' + g.id, g.data.name + ' (template)'])];
      const have = new Set(d.invokes.flatMap((v) => actionsOf(v).map((a) => String(a.method || '').replace(/\(.*$/, '').trim())));
      const rest = tplFunctions.filter((n) => !have.has(n));
      const txt = (a, k, ph, w) => h('input', { type: 'text', value: a[k] || '', placeholder: ph, disabled: !can, style: { width: w }, oninput: (e) => { a[k] = e.target.value; } });
      const target = (a, self) => h('select', { style: { width: '200px' }, disabled: !can, onchange: (e) => { a.target = e.target.value; } }, [self ? h('option', { value: '' }, 'this graphic') : h('option', { value: '' }, 'choose a graphic…'), ...others.map(([v, l]) => h('option', { value: v, selected: a.target === v }, l))]);
      invBox.replaceChildren(...[
        d.invokes.length ? h('div', {}, d.invokes.map((v, i) => h('div', { style: { padding: '10px 0', borderBottom: '1px solid var(--line)' } },
          h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, h('b', { class: 'small' }, 'Button'), h('input', { type: 'text', value: v.label || '', placeholder: 'Button text', disabled: !can, style: { width: '200px' }, oninput: (e) => { v.label = e.target.value; } }),
            h('span', { class: 'dim small', style: { flex: 1 } }, 'does all of this when pressed:'),
            can ? h('button', { type: 'button', class: 'ghost sm', title: 'Remove this button', onclick: () => { d.invokes.splice(i, 1); paintInvokes(); } }, '✕ button') : null),
          actionsOf(v).map((a, n) => h('div', { class: 'row', style: { gap: '6px', marginTop: '6px', paddingLeft: '18px', alignItems: 'center' } },
            h('select', { style: { width: 'auto' }, disabled: !can, onchange: (e) => { a.do = e.target.value; paintInvokes(); } }, ACTS.map(([k, l]) => h('option', { value: k, selected: a.do === k }, l))),
            a.do === 'invoke' ? [target(a, true), txt(a, 'method', 'method, e.g. showStats or page(2)', '230px')] : null,
            a.do === 'show' ? target(a, false) : null,
            a.do === 'hide' || a.do === 'update' ? target(a, true) : null,
            a.do === 'set' ? [h('select', { style: { width: '170px' }, disabled: !can, onchange: (e) => { a.field = e.target.value; } }, [h('option', { value: '' }, 'choose a field…'), ...d.fields.map((f) => h('option', { value: f.key, selected: a.field === f.key }, f.label || f.key))]), h('span', { class: 'dim' }, 'to'), txt(a, 'value', 'text, #colour or {live_value}', '210px')] : null,
            a.do === 'amcp' ? txt(a, 'value', 'e.g. PLAY {channel}-10 "STING"   ({channel} {layer} = this graphic)', '360px') : null,
            a.do === 'timeline' ? h('select', { style: { width: 'auto' }, disabled: !can, onchange: (e) => { a.method = e.target.value; } }, ['go', 'play', 'pause', 'stop', 'prev'].map((m) => { if (!a.method) a.method = 'go'; return h('option', { value: m, selected: a.method === m }, m.toUpperCase()); })) : null,
            a.do === 'device' ? (() => {
              const devs = (liveVars && liveVars.devices) || [], dv = devs.find((x) => x.id === a.target), dl = 'tp-dc-' + i + '-' + n;
              if (!devs.length) return h('span', { class: 'dim small' }, 'No devices yet: add them in Graphics control → Settings → Devices.');
              return [h('select', { style: { width: '170px' }, disabled: !can, onchange: (e) => { a.target = e.target.value; paintInvokes(); } }, [h('option', { value: '' }, 'choose a device…'), ...devs.map((x) => h('option', { value: x.id, selected: a.target === x.id }, x.name))]),
                h('input', { type: 'text', list: dl, value: a.method || '', placeholder: dv && dv.type === 'atem' ? 'cut, dsk-on, key-on …' : dv && dv.type === 'pigpio' ? 'pulse, on, off, toggle' : 'Cut, OverlayInput1In …', disabled: !can, style: { width: '170px' }, oninput: (e) => { a.method = e.target.value; } }),
                h('datalist', { id: dl }, ((dv && dv.commands) || []).map((c) => h('option', { value: c }))),
                txt(a, 'value', dv && dv.type === 'atem' ? 'input=2 me=1 key=1 dsk=1' : dv && dv.type === 'pigpio' ? 'gpo=1 ms=200' : 'Input=2&Duration=500', '170px')];
            })() : null,
            h('span', { class: 'dim small' }, 'after'), h('input', { type: 'number', min: 0, step: 0.1, value: a.delay || 0, disabled: !can, title: 'Seconds after the button is pressed. 0 = straight away.', style: { width: '70px' }, oninput: (e) => { a.delay = Number(e.target.value) || 0; } }), h('span', { class: 'dim small' }, 's'),
            can && v.actions.length > 1 ? h('button', { type: 'button', class: 'ghost sm', title: 'Remove this action', onclick: () => { v.actions.splice(n, 1); paintInvokes(); } }, '✕') : null)),
          can ? h('div', { style: { paddingLeft: '18px', marginTop: '6px' } }, h('button', { type: 'button', class: 'sm', onclick: () => { v.actions.push({ do: 'update', target: '' }); paintInvokes(); } }, '+ action'), ' ',
            h('button', { type: 'button', class: 'sm', title: 'Adds: update this graphic with the values in the Data panel, a moment after the invoke', onclick: () => { v.actions.push({ do: 'update', target: '', delay: 0.5 }); paintInvokes(); } }, '+ then update'), ' ',
            h('button', { type: 'button', class: 'sm', title: 'Adds: invoke another method some seconds later (out, new values, back in)', onclick: () => { v.actions.push({ do: 'invoke', target: '', method: '', delay: 1 }); paintInvokes(); } }, '+ then invoke')) : null)))
          : h('p', { class: 'dim', style: { marginTop: 0 } }, 'No buttons yet. NEXT and a box to type any method are always there while the graphic is in Program.'),
        can ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { type: 'button', onclick: () => { d.invokes.push({ label: '', actions: [{ do: 'invoke', target: '', method: '' }] }); paintInvokes(); } }, '+ Button'),
          rest.length ? [h('span', { class: 'dim small' }, 'Found in the template: '), rest.slice(0, 16).map((n) => h('button', { type: 'button', class: 'sm', onclick: () => { d.invokes.push({ label: n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()), actions: [{ do: 'invoke', target: '', method: n }] }); paintInvokes(); } }, '+ ' + n))] : null) : null].filter(Boolean));
    };
    // ================================================================ visual editor
    // The preview with a box on every variable the template draws: click a box (or a name in the list), then type a value
    // or pick a live value for it. Live values can also be dragged onto a box.
    let mode = 'visual', vsel = null, spots = [], vq = '', vgroup = '', locating = false;
    try { mode = localStorage.getItem('rfp-tpl-mode') === 'table' ? 'table' : 'visual'; } catch (e) { /* default */ }
    const overlay = h('div', { style: { position: 'absolute', inset: 0, display: 'none' } });
    stage.appendChild(overlay);
    const inspector = h('div', {});
    const PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
    const stateOf = (f) => (linkOf(f) ? 'linked' : String(f.value || '').trim() ? 'fixed' : 'empty');
    const COL = { linked: '#00ff82', fixed: '#ffb020', empty: '#8b93a1' };
    const nowOf = (f) => (liveVars ? fillTokens(f.value, liveVars.vars) : f.value || '');
    // Where each variable sits: send the template a marker per variable, see where the markers land, then put the real values back.
    const locate = async () => {
      if (!ready || locating) return;
      locating = true;
      try {
        const w = frame.contentWindow, doc = frame.contentDocument;
        if (!w || !doc || typeof w.update !== 'function') { spots = []; return; }
        const data = {}, vars = liveVars ? liveVars.vars : [];
        d.fields.forEach((f, i) => {
          if (f.type === 'color') { const v = fillTokens(f.value, vars); if (v) data[f.key] = v; }
          else if (f.type === 'image') data[f.key] = PX + '#rfp' + i + '_';
          else data[f.key] = 'ZQ' + i + 'QZ';
        });
        try { w.update(JSON.stringify(data)); if (typeof w.play === 'function') { w.play(); played = true; } } catch (e) { /* the template refused */ }
        await new Promise((r) => setTimeout(r, 700));
        const found = [];
        const all = [...doc.querySelectorAll('body *')];
        d.fields.forEach((f, i) => {
          let el = null;
          if (f.type === 'image') el = all.find((x) => /^(img|image)$/i.test(x.tagName) && String(x.getAttribute('src') || x.getAttribute('href') || x.getAttribute('xlink:href') || '').includes('#rfp' + i + '_'))
            || all.find((x) => String(x.style && x.style.backgroundImage || '').includes('#rfp' + i + '_'));
          else if (f.type !== 'color') {
            const mark = 'ZQ' + i + 'QZ';
            el = all.filter((x) => [...x.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.toUpperCase().includes(mark))).pop() || null;
          }
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || r.right < 0 || r.bottom < 0 || r.left > 1920 || r.top > 1080) return;
          found.push({ key: f.key, x: Math.max(0, r.left - 4), y: Math.max(0, r.top - 3), w: Math.min(1920, r.width + 8), h: Math.min(1080, r.height + 6) });
        });
        spots = found;
      } finally { locating = false; push(); paintVisual(); }
    };
    const linkTo = (f, key, add) => {
      f.value = add && (f.type === 'text' || f.type === 'multiline') && String(f.value || '').trim() ? String(f.value).replace(/\s+$/, '') + (f.type === 'multiline' ? '\n{' : ' {') + key + '}' : '{' + key + '}';
      if (/_color\d?$|colou?r/.test(key) && f.type === 'text' && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(((liveVars && liveVars.vars.find((v) => v.key === key)) || {}).value || '')) f.type = 'color';
      push(); paintVisual(); paintFields();
    };
    const suggest = (f) => {
      const vars = liveVars ? liveVars.vars : [], out = [];
      const best = linkFor(f.key, vars); if (best) out.push(best);
      const words = String(f.key + ' ' + (f.label || '')).toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').split(/[^a-z0-9]+/).filter((x) => x.length > 2 && !/^(text|field|layer|img|image|var)$/.test(x));
      const want = f.type === 'image' ? /logo|photo|image|badge/ : f.type === 'color' ? /colou?r/ : null;
      vars.map((v) => ({ v, n: words.filter((x) => v.key.toLowerCase().includes(x)).length + (want && want.test(v.key) ? 0.5 : 0) + (v.away ? -0.4 : 0) })).filter((x) => x.n >= 1 && (!want || want.test(x.v.key)))
        .sort((a, b) => b.n - a.n || a.v.key.length - b.v.key.length).slice(0, 8).forEach((x) => { if (!out.includes(x.v.key)) out.push(x.v.key); });
      return out.slice(0, 6);
    };
    const valueCell = (v) => (/^\/media\//.test(v.value) ? h('img', { src: v.value, alt: '', style: { height: '22px' } }) : /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.value) ? [h('span', { style: { display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: v.value, verticalAlign: 'middle', marginRight: '5px' } }), v.value] : String(v.value).slice(0, 34) || h('span', { class: 'dim' }, v.away ? 'not in this match' : 'empty now'));
    function paintVisual() {
      overlay.style.display = mode === 'visual' ? '' : 'none';
      if (mode !== 'visual') return;
      const sel = d.fields.find((f) => f.key === vsel) || null;
      // ---- boxes on the preview
      overlay.replaceChildren(...spots.map((sp) => {
        const f = d.fields.find((x) => x.key === sp.key); if (!f) return '';
        const c = COL[stateOf(f)], on = sp.key === vsel;
        return h('div', { title: `${f.label || f.key}${linkOf(f) ? '  →  ' + f.value : ''}`, onclick: () => { vsel = sp.key; vq = ''; paintVisual(); },
          ondragover: (e) => { e.preventDefault(); e.currentTarget.style.background = 'rgba(0,255,130,.28)'; }, ondragleave: (e) => { e.currentTarget.style.background = on ? 'rgba(255,255,255,.14)' : 'transparent'; },
          ondrop: (e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/plain'); if (k && can) { vsel = sp.key; linkTo(f, k, e.shiftKey); } },
          style: { position: 'absolute', left: (sp.x / 19.2) + '%', top: (sp.y / 10.8) + '%', width: (sp.w / 19.2) + '%', height: (sp.h / 10.8) + '%', border: `${on ? 2 : 1}px ${on ? 'solid' : 'dashed'} ${c}`, borderRadius: '3px', cursor: 'pointer', background: on ? 'rgba(255,255,255,.14)' : 'transparent', boxSizing: 'border-box' } },
          on ? h('span', { style: { position: 'absolute', left: '-1px', bottom: '100%', background: c, color: '#000', font: '600 11px/1.5 system-ui', padding: '0 6px', borderRadius: '3px 3px 0 0', whiteSpace: 'nowrap' } }, f.label || f.key) : null);
      }));
      // ---- the list of variables
      const placed = new Set(spots.map((x) => x.key));
      const list = h('div', { style: { maxHeight: sel ? '210px' : '60vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '6px' } }, d.fields.map((f) => h('div', { class: 'click', tabindex: '0', onclick: () => { vsel = f.key; vq = ''; paintVisual(); }, onkeydown: (e) => { if (e.key === 'Enter') { vsel = f.key; paintVisual(); } },
        style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '5px 8px', cursor: 'pointer', borderBottom: '1px solid var(--line)', background: f.key === vsel ? 'var(--accent-bg, rgba(0,255,130,.12))' : '' } },
        h('span', { title: { linked: 'Follows a live value', fixed: 'Fixed value', empty: 'Empty: the template shows its own' }[stateOf(f)], style: { width: '9px', height: '9px', borderRadius: '50%', background: COL[stateOf(f)], flex: 'none' } }),
        h('span', { style: { flex: '1', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, h('b', {}, f.label || f.key), placed.has(f.key) ? '' : h('span', { class: 'dim small', title: f.type === 'color' ? 'Colours have no box on the preview' : 'Not visible in the preview right now' }, f.type === 'color' ? '  colour' : '  not shown')),
        h('span', { class: 'dim small', style: { maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, linkOf(f) ? h('code', {}, f.value) : String(f.value || '').slice(0, 30)))));
      const linkedN = d.fields.filter((f) => linkOf(f)).length;
      const top = h('div', { class: 'spread', style: { marginBottom: '8px' } }, h('div', { class: 'dim small' }, `${d.fields.length} variable${d.fields.length === 1 ? '' : 's'} · ${linkedN} linked · ${spots.length} found on the preview`),
        can ? h('div', { class: 'row' }, h('button', { class: 'sm', title: 'Link every unlinked variable whose name matches a live value', onclick: () => { const n = autoLink(d.fields, liveVars ? liveVars.vars : []); toast(n ? `${n} variable${n === 1 ? '' : 's'} linked` : 'Nothing more could be matched by name'); push(); paintVisual(); paintFields(); } }, 'Auto-link all'),
          h('button', { class: 'sm', title: 'Look again for where each variable sits', onclick: locate }, 'Find on preview')) : null);
      if (!sel) { inspector.replaceChildren(top, list, h('p', { class: 'help' }, 'Click a box on the preview or a name here. Green follows a live value, amber is a fixed value, grey is empty.')); return; }
      // ---- the selected variable
      const f = sel, vars = liveVars ? liveVars.vars : [];
      const words = vq.toLowerCase().split(/\s+/).filter(Boolean);
      const typed = (v) => (f.type === 'image' ? /^\/media\//.test(v.value) || /logo|photo|image|badge/.test(v.key) : f.type === 'color' ? /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.value) || /colou?r/.test(v.key) : true);
      const pool = vars.filter((v) => (words.length ? true : typed(v)) && (!vgroup || v.group === vgroup) && words.every((x) => (v.key + ' ' + v.group + ' ' + v.value + ' ' + (v.note || '')).toLowerCase().includes(x)));
      const groups = [...new Set(vars.filter(typed).map((v) => v.group))];
      const sug = can ? suggest(f).filter((k) => '{' + k + '}' !== f.value) : [];
      const row = (v) => h('div', { class: 'click', draggable: 'true', tabindex: '0', title: 'Click to link. Shift-click adds it to the text. Or drag it onto a box.', ondragstart: (e) => { e.dataTransfer.setData('text/plain', v.key); },
        onclick: (e) => linkTo(f, v.key, e.shiftKey), onkeydown: (e) => { if (e.key === 'Enter') linkTo(f, v.key, e.shiftKey); },
        style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 8px', cursor: 'pointer', borderBottom: '1px solid var(--line)', background: f.value === '{' + v.key + '}' ? 'var(--accent-bg, rgba(0,255,130,.12))' : '' } },
        h('code', { style: { flex: '1', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, v.key), h('span', { class: 'dim small', style: { maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, valueCell(v)));
      const now = nowOf(f);
      inspector.replaceChildren(top, list,
        h('div', { style: { marginTop: '12px', borderTop: '1px solid var(--line)', paddingTop: '10px' } },
          h('div', { class: 'spread' }, h('div', {}, h('b', {}, f.label || f.key), ' ', h('code', { class: 'dim small' }, f.key)),
            h('select', { style: { width: 'auto' }, disabled: !can, onchange: (e) => { f.type = e.target.value; paintVisual(); paintFields(); push(); } }, [['text', 'Text'], ['multiline', 'Text, several lines'], ['image', 'Image'], ['color', 'Colour']].map(([v, l]) => h('option', { value: v, selected: (f.type || 'text') === v }, l)))),
          h('div', { style: { marginTop: '8px' } }, linkOf(f) && f.type !== 'text' && f.type !== 'multiline'
            ? h('div', { class: 'row', style: { gap: '6px' } }, h('code', { class: 'pill ok' }, f.value), can ? h('button', { class: 'ghost sm', onclick: () => { f.value = ''; push(); paintVisual(); paintFields(); } }, 'Unlink') : null)
            : (() => { const x = valueInput0(f); const i = x.matches && x.matches('input[type=text],textarea') ? x : null; if (i) { i.addEventListener('input', () => { clearTimeout(i._t); i._t = setTimeout(() => { const at = i.selectionStart; paintVisual(); const again = inspector.querySelector('[data-vval]'); if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) { /* not a text box */ } } }, 500); }); i.dataset.vval = '1'; } if (!can) x.querySelectorAll && x.querySelectorAll('input,select,button').forEach((y) => { y.disabled = true; }); return x; })()),
          linkOf(f) ? h('div', { class: 'dim small', style: { marginTop: '4px' } }, 'Shows right now: ', f.type === 'image' && now ? h('img', { src: /^img_/.test(now) ? '/media/' + now : now, alt: '', style: { height: '24px', verticalAlign: 'middle' } }) : (now || 'nothing (empty in the match on air)'),
            (f.type === 'text' || f.type === 'multiline') && can ? h('button', { class: 'ghost sm', style: { marginLeft: '8px' }, onclick: () => { f.value = ''; push(); paintVisual(); paintFields(); } }, 'Clear') : null) : null,
          can ? [sug.length ? h('div', { style: { marginTop: '10px' } }, h('span', { class: 'dim small' }, 'Suggested: '), sug.map((k) => h('button', { class: 'sm', style: { margin: '2px 4px 2px 0' }, title: (vars.find((v) => v.key === k) || {}).value || '', onclick: (e) => linkTo(f, k, e.shiftKey) }, k))) : null,
            h('div', { class: 'row', style: { marginTop: '10px', flexWrap: 'nowrap', gap: '6px' } }, h('input', { type: 'search', id: 'v-q', placeholder: 'Search live values: team, score, logo, clock…', value: vq, oninput: UI.debounce((e) => { vq = e.target.value; paintVisual(); const i = document.getElementById('v-q'); if (i) { i.focus(); i.setSelectionRange(vq.length, vq.length); } }, 250) }),
              h('select', { style: { width: '150px', flex: 'none' }, onchange: (e) => { vgroup = e.target.value; paintVisual(); } }, h('option', { value: '' }, 'All groups'), groups.map((g) => h('option', { value: g, selected: g === vgroup }, g)))),
            h('div', { style: { maxHeight: '34vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '6px', marginTop: '6px' } }, pool.length ? pool.slice(0, 120).map(row) : h('div', { class: 'empty' }, 'Nothing matches.')),
            h('div', { class: 'help' }, pool.length > 120 ? `Showing 120 of ${pool.length}. Type to narrow it down. ` : '', 'Click a value to link it', f.type === 'text' ? ', Shift-click to add it to the text (TEAM {teamA_name})' : '', ', or drag it onto a box on the preview.')] : null));
    }
    const setMode = (m) => { mode = m; try { localStorage.setItem('rfp-tpl-mode', m); } catch (e) { /* not kept */ } layout(); };
    let layout = () => {};
    paintFields();
    if (local()) loadVars(d.replaces).then(() => { fillReplaces(); paintFields(); push(); }).then(() => reread(true)).then(() => { paintTriggers(); if (mode === 'visual') setTimeout(locate, 600); });
    frame.addEventListener('load', () => { if (mode === 'visual') setTimeout(locate, 900); });
    let tabsEl, visualView, tableView, vSlot, tSlot;
    const el = h('div', {}, head(h('div', {}, h('a', { class: 'small', href: '#/templates' }, '← Templates'), h('h1', {}, d.name || 'Graphic')),
      can ? h('button', { class: 'danger', onclick: async () => { if (await UI.confirmBox('Remove this graphic? The template file stays in the folder.', 'Remove')) { try { await App.remove('graphic', id); location.hash = '#/templates'; } catch (e) { oops(e); } } } }, 'Remove') : null,
      h('a', { class: 'btn', href: '/live/control.html' }, 'Graphics control ↗'), can ? h('button', { class: 'primary', onclick: save }, 'Save') : null),
      (() => { tabsEl = h('div', { class: 'tabs' }); return tabsEl; })(),
      (() => { visualView = h('div', { style: { display: 'none', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(360px, 1fr)', gap: '16px', alignItems: 'start' } },
        h('div', { class: 'card', style: { position: 'sticky', top: '16px' } }, (() => { vSlot = h('div', {}); return vSlot; })(),
          h('p', { class: 'help' }, 'Each box is a variable the template draws. Click one to edit or link it. The preview shows the values of the match on air.')),
        h('div', { class: 'card' }, h('h2', {}, 'Variables'), inspector)); return visualView; })(),
      (() => { tableView = h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: '16px', alignItems: 'start' } },
        h('div', {},
          h('div', { class: 'card' }, h('h2', {}, 'Graphic'), h('div', { class: 'form' },
            lab('Name in Graphics control', inp('name')),
            lab('Template', inp('template', { type: 'text', readonly: true }), 'In the template folder on the production PC'),
            lab('Theme', h('select', { onchange: (e) => { d.theme = e.target.value; fillReplaces(); } }, [h('option', { value: '' }, 'None (My templates)'), ...App.sorted('theme').map((t) => h('option', { value: t.id, selected: d.theme === t.id }, t.data.name))]), 'Groups it in Graphics control'),
            lab('Kind', h('select', { onchange: (e) => { d.kind = e.target.value; } }, KINDS.map(([v, l]) => h('option', { value: v, selected: d.kind === v }, l)))),
            h('div', { class: 'wide' }, h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: !d.hidden, onchange: (e) => { d.hidden = !e.target.checked; } }), h('b', {}, 'Show in Graphics control')),
              h('div', { class: 'help' }, 'Untick to keep old or unused templates out of the operator\'s way. A hidden graphic still plays when it is linked to a built-in button below.')),
            h('div', { class: 'wide' }, h('div', { class: 'flabel' }, 'Link to graphic (plays instead of these built-in buttons)'), linkBox,
              h('div', { class: 'help' }, 'While this graphic\'s theme is in use, the built-in button (TAKE BUG, Score lower third, wipes and so on) plays this template instead, on this channel and layer. Links can then also use what that built-in graphic sends.')))),
          h('div', { class: 'card' }, h('h2', {}, 'Playout settings'), h('div', { class: 'form' },
            lab('Channel', inp('channel', { type: 'number', min: 0 }), '0 = the program channel'),
            lab('Layer', inp('layer', { type: 'number', min: 1 }), 'Two graphics on the same layer replace each other'),
            lab('Take off after (seconds)', inp('autoClear', { type: 'number', min: 0 }), '0 = stays until you take it out'),
            lab('Data format', h('select', { onchange: (e) => { d.format = e.target.value; } }, [['', 'As set for CasparCG'], ['json', 'JSON'], ['xml', 'XML templateData']].map(([v, l]) => h('option', { value: v, selected: (d.format || '') === v }, l)))),
            lab('Transparent colours are sent as', h('select', { onchange: (e) => { d.transparentAs = e.target.value; push(); } }, ['transparent', '#00000000', 'rgba(0,0,0,0)'].map((v) => h('option', { value: v, selected: (d.transparentAs || 'transparent') === v }, v))), 'Whichever your template understands'),
            h('div', { class: 'wide' }, h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: d.autoUpdate !== false, onchange: (e) => { d.autoUpdate = e.target.checked; } }), h('b', {}, 'Update automatically while on air')),
              h('div', { class: 'help' }, 'Linked values (scores, names, statistics, cards) are sent to the template the moment they change, and a linked clock every half second. Off: it only changes when the operator presses UPDATE.')))),
          h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Variable fields'), can ? h('div', { class: 'row' }, h('button', { onclick: importFields, title: 'Load values from a CSV (variable, label, type, value) or JSON file' }, 'Import'), h('button', { onclick: exportFields, title: 'Save every variable and its value as a CSV file for Excel' }, 'Export'), h('button', { onclick: () => reread(false), disabled: !local(), title: local() ? '' : 'Only on the production PC' }, 'Read from template'), h('button', { onclick: addField }, '+ Field')) : null),
            fieldsBox,
            h('p', { class: 'help' }, '"In the template" is what the template shows by itself. An empty picture keeps the template\'s own. These are the starting values. The operator can still change any field in Graphics control before taking the graphic. "Link to live value" ties a variable to something RFP Manager knows (team names and badges, scores, clock, statistics, competition, venue); it shows as a name in braces, and text can mix links and words: {teamA_name} v {teamB_name}.')),
          h('div', { class: 'card' }, (() => { btnH = h('h2', {}, 'Buttons'); return btnH; })(),
            h('p', { class: 'dim', style: { marginTop: 0 } }, 'Buttons that show in Graphics control while this graphic is in Program. One press can do several things at once: call a function inside the template (CasparCG "CG INVOKE"), take, take off or update this or another graphic, set a field, or send an AMCP command. Give an action a delay to have it follow some seconds later. An update sends what is in the Data panel at the moment the button is pressed, so "invoke UpdateOut, then update after 0.5 s, then invoke UpdateIn after 1 s" swaps the content between the two animations.'),
            invBox),
          h('div', { class: 'card' }, (() => { trigH = h('h2', {}, 'Triggers'); return trigH; })(),
            h('p', { class: 'dim', style: { marginTop: 0 } }, 'Simple rules that run while a match is on air: IF a live value is something THEN show, hide or update this graphic, or set one of its fields.'),
            trigBox,
            h('p', { class: 'help' }, 'IF invoke … runs each time a method is invoked on this graphic: leave the value empty for any method, or type the method name. A show / hide / update rule fires at the moment its IF becomes true (or, with "changes", each time the value changes to something). It never fires for what was already true when the match went on air. "Set a field" applies for as long as its IF is true; when several are true the last one wins. The operator can switch all triggers off in Graphics control → Production.'))),
        h('div', { class: 'card', style: { position: 'sticky', top: '16px' } }, h('h2', {}, 'Preview'), (() => { tSlot = h('div', {}); return tSlot; })(), h('p', { class: 'help' }, 'The template itself, filled with the values on the left. Linked values show what the match on air has right now.'))); return tableView; })());
    layout = () => {
      tabsEl.replaceChildren(h('button', { class: mode === 'visual' ? 'on' : '', onclick: () => setMode('visual') }, 'Visual editor'), h('button', { class: mode === 'table' ? 'on' : '', onclick: () => setMode('table') }, 'Settings and table'));
      visualView.style.display = mode === 'visual' ? 'grid' : 'none'; tableView.style.display = mode === 'table' ? 'grid' : 'none';
      const slot = mode === 'visual' ? vSlot : tSlot;
      if (stage.parentNode !== slot) { ready = false; slot.appendChild(stage); }        // the preview reloads when it moves
      setTimeout(fit, 0);
      if (mode === 'table') { paintFields(); paintTriggers(); paintInvokes(); }
      paintVisual();
    };
    layout();
    return { el, destroy: () => window.removeEventListener('resize', fit) };
  }
})();
