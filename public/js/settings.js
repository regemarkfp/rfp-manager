/* Settings: production team, members, account, this machine, machine keys, save file. */
'use strict';
(() => {
  let tab = 'team';
  const CUSTOM_FIELDS = { k: 'customFields', l: 'Custom fields', t: 'list', fields: [
    { k: 'entity', l: 'Add to', t: 'select', opts: Object.keys(Schema.ENTITIES) }, { k: 'label', l: 'Field name', t: 'text' }, { k: 'type', l: 'Kind', t: 'select', opts: ['text', 'number', 'date', 'textarea', 'bool', 'color', 'image'] }] };
  const TEAM_FIELDS = [
    { k: 'name', l: 'Production company / team name', t: 'text', req: true, help: 'Printed on call sheets, e.g. "REGEMARKFP CALL SHEET".' }, { k: 'accentColor', l: 'Accent colour', t: 'color', ph: '#00ff82', solid: true }, { k: 'currency', l: 'Currency', t: 'combo', opts: ['ZAR', 'USD', 'EUR', 'GBP', 'AUD', 'NZD', 'BWP', 'NAD', 'KES', 'NGN'] },
    { k: 'image', l: 'Logo (dashboard and call sheets)', t: 'image' }, { k: 'address', l: 'Company address', t: 'text' }, { k: 'phone', l: 'Company phone', t: 'text' }, { k: 'email', l: 'Company email', t: 'text' }, { k: 'website', l: 'Website', t: 'text' },
    { k: 'defaultTheme', l: 'Default theme', t: 'ref', ref: 'theme', help: 'Used for every match unless its competition has its own theme, or another is chosen in Graphics control.' },
    { k: 'templateFolder', l: 'Default CasparCG template folder', t: 'text', ph: 'rfp', help: 'Used when a competition has no theme. Themes can point at their own folder.' },
    { k: 'publicMatches', l: 'Show our matches on the public website', t: 'bool', help: 'Fixtures, live scores and results of this team appear on the website\'s front page. Public channels and their streams always do.' }, { k: 'publicPlayers', l: 'Show player profiles on the public website', t: 'bool', help: 'A page per player with their teams and season numbers from completed matches. Off for school sport unless the school agrees.' },
    CUSTOM_FIELDS];

  function teamTab() {
    const admin = App.can('admin') && App.editable('org');
    const form = buildForm('org', App.org(), { fields: TEAM_FIELDS });
    const el = h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h2', {}, 'Production team'), form.el,
      h('p', { class: 'help' }, 'Custom fields appear on that record\'s form. Sports rules are built in and follow each federation; choose the format or variant in the scorer\'s Setup tab.'),
      admin ? h('div', { style: { marginTop: '14px' } }, h('button', { class: 'primary', onclick: async () => { try { await App.save('org', App.team, { ...App.org(), ...form.data }); applyTheme(); await App.loadMe(); toast('Team settings saved'); route(); } catch (e) { oops(e); } } }, 'Save team settings')) : h('p', { class: 'dim' }, 'Only an Admin can change team settings.')));
    if (!admin) el.querySelectorAll('input, select, textarea, button').forEach((x) => { x.disabled = true; });
    const others = App.teams.filter((t) => t.id !== App.team && t.role === 'Admin');
    if (admin && others.length && !App.cfg.bridge) el.append(mergeCard(others));
    return el;
  }

  // two teams that should be one: move everything of another team (you are Admin of both) into this one
  function mergeCard(others) {
    const info = h('div', { class: 'dim small', style: { margin: '8px 0' } });
    const sel = h('select', { style: { maxWidth: '360px' }, onchange: () => describe() }, h('option', { value: '' }, 'Choose a team…'), others.map((t) => h('option', { value: t.id }, t.name)));
    const describe = async () => {
      info.replaceChildren();
      if (!sel.value) return;
      try {
        const docs = (await api('GET', '/api/docs?team=' + sel.value)).docs;
        const n = (type) => docs.filter((d) => d.type === type).length;
        const comps = docs.filter((d) => d.type === 'competition').map((d) => d.data.name).slice(0, 5).join(', ');
        info.textContent = `It holds ${docs.length} records: ${n('fixture')} matches, ${n('competition')} competitions${comps ? ' (' + comps + ')' : ''}, ${n('club')} clubs, ${n('production')} productions, ${n('member')} members.`;
      } catch (e) { info.textContent = e.message; }
    };
    return h('div', { class: 'card' }, h('h2', {}, 'Merge another production team into this one'),
      h('p', { class: 'dim', style: { marginTop: 0 } }, `Everything in the other team (clubs, matches, productions, graphics, members …) moves into ${App.org().name || 'this team'}, and the other team is removed. Linked production PCs follow by themselves.`),
      sel, info,
      h('button', { class: 'danger', onclick: async () => {
        const t = others.find((x) => x.id === sel.value);
        if (!t) return toast('Choose the team to merge in', 'error');
        if (!(await confirmBox(`Move everything from "${t.name}" into "${App.org().name}" and remove "${t.name}"? This cannot be undone.`, 'Merge'))) return;
        try { const r = await api('POST', `/api/orgs/${encodeURIComponent(App.team)}/merge`, { from: t.id }); toast(`Merged: ${r.moved} records moved`); await App.loadMe(); await App.loadDocs(); route(); } catch (e) { oops(e); }
      } }, 'Merge into this team'));
  }

  function membersTab() {
    if (App.cfg.bridge) return bridgeMembers();
    const admin = App.can('admin'), local = App.cfg.mode === 'local';
    const list = h('div', {});
    const paint = () => {
      const ms = App.list('member').sort((a, b) => String(a.data.email).localeCompare(String(b.data.email)));
      list.replaceChildren(h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Name'), h('th', {}, 'Role'), h('th', {}, ''), h('th', {}))),
        h('tbody', {}, ms.map((m) => h('tr', {}, h('td', {}, App.avatar(m.data.image, m.data.name || m.data.email, 24), ' ', m.data.email, m.data.email === App.me.email ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'you') : null), h('td', {}, m.data.name || ''),
          h('td', {}, admin ? h('select', { style: { width: '140px' }, onchange: async (e) => { if (['Coach', 'Official'].includes(e.target.value)) return roleDetails({ ...m, data: { ...m.data, role: e.target.value } }, paint); try { await api('POST', '/api/members?team=' + App.team, { email: m.data.email, name: m.data.name, role: e.target.value }); toast('Role changed'); } catch (err) { oops(err); paint(); } } }, Schema.ROLES.map((r) => h('option', { selected: r === m.data.role }, r))) : m.data.role),
          h('td', { class: 'nowrap small' }, m.data.role === 'Coach' ? (m.data.clubs || []).map((c) => App.title('club', c)).join(', ') || h('span', { class: 'pill warn' }, 'no club yet') : m.data.role === 'Official' ? 'Named as: ' + (m.data.officialName || m.data.name || '—') : '',
            admin && ['Coach', 'Official'].includes(m.data.role) ? h('button', { class: 'sm ghost', style: { marginLeft: '6px' }, onclick: () => roleDetails(m, paint) }, 'Change') : null),
          h('td', { class: 'r' }, admin ? h('button', { class: 'sm ghost danger', onclick: async () => { if (await confirmBox(`Remove ${m.data.email} from this production team?`, 'Remove')) { try { await api('DELETE', `/api/members/${m.id}?team=${App.team}`); App.docs.delete(m.id); paint(); } catch (err) { oops(err); } } } }, 'Remove') : null)))))));
    };
    paint();
    const f = { email: '', name: '', role: 'Scorer', password: '' };
    return h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h2', {}, 'Members'), list,
      h('p', { class: 'help' }, 'Admin: everything, including members and settings. Producer: productions, crew, bookings, costing and every record. Scorer: score matches and control graphics. Crew: view, and add their expenses with receipts. Coach: their own clubs, teams, players and team sheets. Official: the matches they are named on, and confirming results.')),
    admin ? h('div', { class: 'card' }, h('h2', {}, 'Add someone'), h('div', { class: 'form' },
      h('label', { class: 'f' }, h('span', {}, 'Email (their Google account)'), h('input', { type: 'email', oninput: (e) => { f.email = e.target.value; } })),
      h('label', { class: 'f' }, h('span', {}, 'Name'), h('input', { oninput: (e) => { f.name = e.target.value; } })),
      h('label', { class: 'f' }, h('span', {}, 'Role'), h('select', { onchange: (e) => { f.role = e.target.value; } }, Schema.ROLES.map((r) => h('option', { selected: r === f.role }, r)))),
      local ? h('label', { class: 'f' }, h('span', {}, 'Password (optional, for signing in without internet)'), h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => { f.password = e.target.value; } })) : null),
    h('p', { class: 'help' }, local ? 'They can sign in with Google using this email, or with the password you set here.' : 'They sign in with Google using this email and will see this production team straight away.'),
    h('button', { class: 'primary', style: { marginTop: '10px' }, onclick: async () => {
      if (['Coach', 'Official'].includes(f.role)) return roleDetails({ data: { email: f.email, name: f.name, role: f.role } }, () => route());
      try { const r = await api('POST', '/api/members?team=' + App.team, f); App.docs.set(r.doc.id, r.doc); toast('Member added'); route(); } catch (e) { oops(e); }
    } }, 'Add member')) : null);
  }

  // the production PC: members and roles come from the website; an Admin can give someone a password for this PC
  function bridgeMembers() {
    const ms = App.list('member').sort((a, b) => String(a.data.email).localeCompare(String(b.data.email)));
    const f = { email: (ms[0] && ms[0].data.email) || '', password: '' };
    return h('div', { class: 'stack' }, h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Members'), App.can('admin') ? h('a', { class: 'btn sm', href: App.onlineUrl('#/settings'), target: '_blank', rel: 'noopener' }, 'Manage on the website ↗') : null),
      h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Name'), h('th', {}, 'Role'))),
        h('tbody', {}, ms.map((m) => h('tr', {}, h('td', {}, m.data.email), h('td', {}, m.data.name || ''), h('td', {}, m.data.role)))))),
      h('p', { class: 'help' }, 'Members and roles are managed on the website and come down to this PC. Everyone signs in here with the same Google account.')),
    App.can('admin') ? h('div', { class: 'card' }, h('h2', {}, 'Password for this PC (no internet at the venue)'),
      h('p', { class: 'dim', style: { marginTop: 0 } }, 'Google sign-in needs the internet. Give a member a password that works on this PC only, for venues without it.'),
      h('div', { class: 'form' },
        h('label', { class: 'f' }, h('span', {}, 'Member'), h('select', { onchange: (e) => { f.email = e.target.value; } }, ms.map((m) => h('option', { value: m.data.email }, `${m.data.name || m.data.email} (${m.data.role})`)))),
        h('label', { class: 'f' }, h('span', {}, 'Password (8+ characters)'), h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => { f.password = e.target.value; } }))),
      h('button', { class: 'primary', style: { marginTop: '10px' }, onclick: async () => {
        const m = ms.find((x) => x.data.email === f.email);
        try { await api('POST', '/api/members?team=' + App.team, { email: f.email, role: m && m.data.role, password: f.password }); toast('Password set for this PC'); } catch (e) { oops(e); }
      } }, 'Set password')) : null);
  }

  // a coach's clubs, an official's name as written on match sheets
  function roleDetails(m, done) {
    const d = m.data, v = { clubs: new Set(d.clubs || []), officialName: d.officialName || d.name || '' };
    const clubs = App.list('club').sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
    const body = d.role === 'Coach'
      ? h('div', {}, h('p', { class: 'dim', style: { marginTop: 0 } }, `${d.email} can change these clubs, their teams and players, and pick team sheets for their matches.`),
        clubs.length ? h('div', { class: 'stack', style: { maxHeight: '50vh', overflow: 'auto' } }, clubs.map((c) => h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: v.clubs.has(c.id), onchange: (e) => { if (e.target.checked) v.clubs.add(c.id); else v.clubs.delete(c.id); } }), c.data.name)))
          : h('p', {}, 'Add the club first (Assets → Clubs).'))
      : h('div', {}, h('p', { class: 'dim', style: { marginTop: 0 } }, `${d.email} sees the matches where this name is listed under Match officials (as "Role: Name"), and can confirm their results.`),
        h('label', { class: 'f' }, h('span', {}, 'Name as written on the match sheets'), h('input', { value: v.officialName, oninput: (e) => { v.officialName = e.target.value; } })));
    modal({ title: `${d.role}: ${d.name || d.email}`, body, actions: [{ label: 'Cancel', onClick: () => { done(); } }, { label: 'Save', primary: true, onClick: async () => {
      try {
        const r = await api('POST', '/api/members?team=' + App.team, { email: d.email, name: d.name, role: d.role, clubs: [...v.clubs], officialName: v.officialName });
        App.docs.set(r.doc.id, r.doc); toast('Saved'); done(); return true;
      } catch (e) { oops(e); return false; }
    } }] });
  }

  function accountTab() {
    const linked = App.machine.linked;
    const f = { name: App.me.name, phone: App.me.phone || '', emailOff: !!App.me.emailOff, emailNoNew: !!App.me.emailNoNew, password: '', currentPassword: '' };
    return h('div', { class: 'card' }, h('h2', {}, 'My account'), h('p', {}, h('b', {}, App.me.email), App.me.google ? h('span', { class: 'pill ok', style: { marginLeft: '8px' } }, 'Google') : null, App.me.hasPassword ? h('span', { class: 'pill', style: { marginLeft: '8px' } }, 'Password set') : null),
      linked ? h('p', { class: 'dim' }, 'This machine is linked to the website, so your name and sign-in are managed there and synced down.') : h('div', {}, h('div', { class: 'form' },
        h('label', { class: 'f' }, h('span', {}, 'Name'), h('input', { value: f.name, oninput: (e) => { f.name = e.target.value; } })),
        h('label', { class: 'f' }, h('span', {}, 'Phone'), h('input', { type: 'tel', value: f.phone, oninput: (e) => { f.phone = e.target.value; } })),
        App.cfg.mail ? h('label', { class: 'row', style: { gap: '8px', gridColumn: '1 / -1' } }, h('input', { type: 'checkbox', checked: !f.emailOff, onchange: (e) => { f.emailOff = !e.target.checked; } }), 'Email me: when I am hired (with the call sheet), matches I officiate, results of my teams, expenses') : null,
        App.cfg.mail ? h('label', { class: 'row', style: { gap: '8px', gridColumn: '1 / -1' } }, h('input', { type: 'checkbox', checked: !f.emailNoNew, onchange: (e) => { f.emailNoNew = !e.target.checked; } }), 'Email me when a new production is added to my team\'s calendar') : null,
        h('div', { class: 'f' }, h('span', { class: 'flabel' }, 'Picture'), h('div', { class: 'row', style: { gap: '10px' } }, App.avatar(App.me.image, App.me.name || App.me.email, 48), h('span', { class: 'dim small' }, App.me.google ? 'Your Google profile picture. Change it in your Google account; it updates here the next time you sign in.' : 'Sign in with Google to use your Google profile picture.'))),
        App.me.hasPassword ? h('label', { class: 'f' }, h('span', {}, 'Current password'), h('input', { type: 'password', autocomplete: 'current-password', oninput: (e) => { f.currentPassword = e.target.value; } })) : null,
        h('label', { class: 'f' }, h('span', {}, App.me.hasPassword ? 'New password (8+ characters)' : 'Set a password (8+ characters)'), h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => { f.password = e.target.value; } }),
          App.cfg.mode === 'cloud' ? h('div', { class: 'help' }, 'Your email and this password sign you in to the RFP Manager app on a production PC (Google works there too).') : null)),
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'primary', onclick: async () => { try { await api('POST', '/api/me', f); await App.loadMe(); toast('Account saved'); route(); } catch (e) { oops(e); } } }, 'Save'),
        App.cfg.mode === 'cloud' ? h('button', { onclick: async (e) => { const b = e.target; b.disabled = true; try { const r = await api('POST', '/api/mail/test'); if (r.ok) toast('Test email sent to ' + App.me.email + ' – check your inbox (and spam)'); else oops(new Error('Email did not go out: ' + r.error)); } catch (x) { oops(x); } b.disabled = false; } }, 'Send me a test email') : null)));
  }

  // verse of the day: on or off, the translation (language), and when the day turns over on this computer
  function verseCard() {
    const p = { on: true, translation: '', time: '00:00', ...(App.me.versePrefs || {}) };
    const sel = h('select', { disabled: !p.on || null }, h('option', { value: '' }, 'Default (a Bible on this machine, else the King James Version)'));
    const time = h('input', { type: 'time', value: p.time, disabled: !p.on || null });
    const save = async () => {
      try { await api('POST', '/api/me', { versePrefs: p }); App.me.versePrefs = { ...p }; if (App.verseClear) App.verseClear(); toast('Verse of the day saved'); } catch (e) { oops(e); }
    };
    api('GET', '/api/verse/translations').then((r) => {
      const langs = [...new Set(r.list.map((t) => t.language || 'Other'))];
      for (const l of langs) sel.append(h('optgroup', { label: l }, r.list.filter((t) => (t.language || 'Other') === l).map((t) => h('option', { value: t.id, selected: t.id === p.translation }, `${t.name}${t.where === 'this machine' ? ' (on this machine)' : t.where === 'online' ? ' (bible-api.com)' : ''}`))));
    }).catch(() => {});
    sel.onchange = () => { p.translation = sel.value; save(); };
    time.onchange = () => { if (/^\d\d:\d\d$/.test(time.value)) { p.time = time.value; save(); } };
    return h('div', { class: 'card' }, h('h2', {}, 'Verse of the day'),
      App.machine.linked ? h('p', { class: 'dim' }, 'This machine is linked to the website: change this there and it syncs down.') : null,
      h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: p.on, disabled: App.machine.linked || null, onchange: (e) => { p.on = e.target.checked; sel.disabled = time.disabled = !p.on; save(); } }), h('span', {}, 'Show the verse of the day on my home page')),
      h('div', { class: 'form', style: { marginTop: '10px' } },
        h('label', { class: 'f' }, h('span', {}, 'Translation / language'), sel, h('div', { class: 'help' }, 'The website\'s Bibles first (a site admin adds them under Settings → Website), then Bibles imported on this machine, then free ones from bible-api.com.')),
        h('label', { class: 'f' }, h('span', {}, 'New verse at'), time, h('div', { class: 'help' }, 'Your computer\'s time. Midnight (00:00) unless you choose another time, for example 05:00 for your morning.'))));
  }

  function machineTab() {
    const el = h('div', { class: 'stack' }, h('div', { class: 'card dim' }, 'Loading…'));
    api('GET', '/api/machine').then((m) => {
      const f = { mediaFolder: m.mediaFolderSetting, caspar: { ...m.caspar }, cloud: { url: m.cloud.url, key: '' }, syncSeconds: m.syncSeconds, access: m.access, googleClientId: m.googleClientId, machineName: m.machineName };
      const inp = (obj, k, attrs = {}) => h('input', { value: obj[k] === undefined || obj[k] === null ? '' : obj[k], ...attrs, oninput: (e) => { obj[k] = attrs.type === 'number' ? Number(e.target.value) : e.target.value; } });
      const pick = (obj, k, opts) => h('select', { onchange: (e) => { obj[k] = e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: String(obj[k]) === v }, l)));
      const lab = (t, input, help) => h('label', { class: 'f' }, h('span', {}, t), input, help ? h('div', { class: 'help' }, help) : null);
      const save = async (patch, msg) => { try { const r = await api('PUT', '/api/machine', patch); toast(msg + (r.media && r.media.downloaded ? ` · ${r.media.downloaded} images downloaded` : '') + (r.media && r.media.missing ? ` · ${r.media.missing} images still missing` : '')); await App.loadMe(); App.cfg = await api('GET', '/api/config'); route(); } catch (e) { oops(e); } };
      const s = m.sync, c = m.casparStatus;
      const out = `${location.origin}/live/output.html?key=${m.outputKey}`;
      el.replaceChildren(
        h('div', { class: 'card' }, h('h2', {}, 'Image folder on this machine'),
          h('p', { class: 'dim', style: { marginTop: 0 } }, 'Every image (logos, photos, sponsor boards) is downloaded into this folder as a normal file. It is set per machine, so each production PC can use its own drive. Putting it inside your CasparCG folder keeps everything together.'),
          lab('Folder', inp(f, 'mediaFolder', { placeholder: m.mediaFolder }), `Currently: ${m.mediaFolder} · ${m.images} image${m.images === 1 ? '' : 's'} known. Leave empty for the default.`),
          h('button', { class: 'primary', style: { marginTop: '12px' }, onclick: () => save({ mediaFolder: f.mediaFolder }, 'Image folder saved') }, 'Save folder')),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'CasparCG and other devices'), h('div', { class: 'row' }, h('span', { class: 'led ' + (!c.enabled ? '' : c.connected ? 'ok' : 'bad') }), h('span', { class: 'dim' }, !c.enabled ? 'Off' : c.connected ? 'Connected ' + (c.version || '') : 'Not connected'))),
          h('p', { class: 'dim', style: { margin: 0 } }, 'CasparCG, vMix, ATEM, HyperDeck, OBS, Companion, OSC, Art-Net, MIDI, X-keys and the Pi GPIO box are set up under ', h('a', { href: '#/settings', onclick: (e) => { e.preventDefault(); tab = 'connections'; route(); } }, 'Settings → Connections'), '.')),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Website link (online sync)'), h('div', { class: 'row' }, h('span', { class: 'led ' + (!s.linked ? '' : s.lastError ? 'warn' : 'ok') }), h('span', { class: 'dim' }, !s.linked ? 'Not linked' : s.lastError ? 'Offline: ' + s.lastError : `Synced ${s.lastSync ? new Date(s.lastSync).toLocaleTimeString('en-GB') : ''} · ${s.pending} to upload`))),
          s.linked ? h('p', { class: 'dim', style: { marginTop: 0 } }, 'Linked to ', h('b', {}, m.cloud.url), '. Records and images sync both ways; changes go straight away.')
            : (App.googleLink({ url: m.cloud.url || (App.cfg && App.cfg.cloudUrl) || '', onDone: () => setTimeout(() => route(), 2500) })
              || App.linkFlow({ url: m.cloud.url || (App.cfg && App.cfg.cloudUrl) || '', onDone: () => setTimeout(() => route(), 2500) })),
          s.linked && App.cfg.mode === 'local' && s.lastError ? h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'small' }, 'Not syncing? Link again with Google'),
            h('div', { style: { marginTop: '8px' } }, App.googleLink({ url: m.cloud.url, relink: true, onDone: () => setTimeout(() => route(), 2500) }) || h('p', { class: 'dim small' }, 'Open RFP Manager on this PC itself (http://localhost) to use Google here.'))) : null,
          !s.linked && App.cfg.mode === 'local' && App.canGoogleLink() ? h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'dim small' }, 'Link with a code on the website instead'),
            h('div', { style: { marginTop: '8px' } }, App.linkFlow({ url: m.cloud.url || (App.cfg && App.cfg.cloudUrl) || '', onDone: () => setTimeout(() => route(), 2500) }))) : null,
          s.linked ? h('div', { class: 'form' }, lab('Sync every (seconds)', inp(f, 'syncSeconds', { type: 'number' }), 'Changes also go straight away; this is the catch-up interval.')) : null,
          h('div', { class: 'row', style: { marginTop: '12px' } },
            s.linked ? h('button', { class: 'primary', onclick: () => save({ syncSeconds: f.syncSeconds }, 'Saved') }, 'Save') : null,
            s.linked ? h('button', { onclick: async () => { try { const r = await api('POST', '/api/machine/sync'); toast(r.sync.lastError ? 'Sync failed: ' + r.sync.lastError : `Synced${r.media.downloaded ? ' · ' + r.media.downloaded + ' images downloaded' : ''}`, r.sync.lastError ? 'error' : ''); route(); } catch (e) { oops(e); } } }, 'Sync now') : null,
            s.linked && App.cfg.mode === 'local' ? h('button', { class: 'ghost danger', onclick: async () => { if (await confirmBox('Unlink this machine from the website? Data stays on both sides, and its screens are no longer reachable through the website.', 'Unlink')) save({ cloud: { url: '', key: '' } }, 'Unlinked'); } }, 'Unlink') : null),
          App.cfg.mode === 'local' ? h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'dim small' }, 'Link with a machine key instead'),
            h('div', { class: 'form', style: { marginTop: '8px' } }, lab('Website address', inp(f.cloud, 'url', { placeholder: 'https://your-site.onrender.com' })), lab('Machine key', inp(f.cloud, 'key', { type: 'password', autocomplete: 'off', placeholder: m.cloud.hasKey ? 'saved – leave empty to keep' : 'mk_…' }), 'Create one on the website: Settings → Machine keys.')),
            h('button', { style: { marginTop: '8px' }, onclick: () => save({ cloud: f.cloud }, 'Link saved') }, 'Save link')) : null),
        h('div', { class: 'card' }, h('div', { class: 'spread' }, h('h2', {}, 'Remote access through the website'), (() => { const ra = m.remoteAccess || {}; return h('div', { class: 'row' }, h('span', { class: 'led ' + (!m.remote || !s.linked ? '' : ra.connected ? 'ok' : 'warn') }), h('span', { class: 'dim' }, !m.remote ? 'Off' : !s.linked ? 'Needs the website link' : ra.connected ? 'Online' : 'Connecting' + (ra.lastError ? ': ' + ra.lastError : ''))); })()),
          h('p', { class: 'dim', style: { marginTop: 0 } }, 'Team members signed in on the website can use this PC\'s live screens from anywhere: Graphics control, dashboards, Timeline, Worship, monitors, Connections and Templates. Scoring stays on this PC and devices on its network. Nothing needs to be opened on your router: the PC keeps one outgoing link to the website. Graphics still play out from this PC.'),
          h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: m.remote !== false, onchange: (e) => save({ remote: e.target.checked }, e.target.checked ? 'Remote access on' : 'Remote access off') }), 'Allow use through the website'),
          s.linked && m.remote !== false ? h('p', { class: 'dim small' }, 'On the website choose this PC (', h('b', {}, m.machineName || 'this PC'), ') under PC at the top of the menu. Browser output for OBS / vMix from anywhere: ', h('code', {}, (m.cloud.url || '') + '/output?key=' + m.outputKey + '&pc=…'), ' (the website shows the full link under Monitors).') : null),
        h('div', { class: 'card' }, h('h2', {}, 'Access & sign-in'), h('div', { class: 'form' },
          lab('Who can reach this app', pick(f, 'access', [['tailnet', 'This PC and Tailscale only'], ['lan', 'This PC, Tailscale and the local network'], ['any', 'Any address']])),
          lab('Google client ID', inp(f, 'googleClientId', { placeholder: '….apps.googleusercontent.com' }), 'Filled in automatically when linked. Google sign-in on this machine works at http://localhost:' + m.port + '.'),
          lab('Machine name', inp(f, 'machineName'))),
        h('button', { class: 'primary', style: { marginTop: '12px' }, onclick: () => save({ access: f.access, googleClientId: f.googleClientId, machineName: f.machineName }, 'Saved') }, 'Save'),
        h('div', { class: 'flabel', style: { marginTop: '16px' } }, 'Browser output address (OBS / vMix browser source)'), h('input', { readonly: true, value: out, onfocus: (e) => e.target.select() }),
        h('div', { class: 'help' }, 'Commentary and rundown monitor links are under ', h('a', { href: '#/monitors' }, 'Monitors'), '.'),
        h('div', { class: 'help' }, 'Database file: ' + m.database)));
    }).catch((e) => el.replaceChildren(h('div', { class: 'card' }, e.message)));
    return el;
  }

  function keysTab() {
    const el = h('div', { class: 'stack' });
    const load = async (fresh) => {
      const r = await api('GET', '/api/keys');
      el.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Machine keys'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, 'A machine key links a production PC to this site so it can sync every production team you are an Admin of. On the PC: Settings → This machine → Website link.'),
        fresh ? h('div', { class: 'card', style: { borderColor: 'var(--accent)', marginBottom: '14px' } }, h('b', {}, 'Copy this key now. It is shown only once.'), h('input', { readonly: true, value: fresh, style: { marginTop: '8px', fontFamily: 'monospace' }, onfocus: (e) => e.target.select() }),
          h('div', { class: 'help' }, 'Website address to enter on the PC: ' + location.origin)) : null,
        r.keys.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, r.keys.map((k) => h('tr', {}, h('td', {}, h('b', {}, k.name)), h('td', { class: 'dim' }, 'Created ' + new Date(k.createdAt).toLocaleDateString('en-GB')),
          h('td', { class: 'r' }, h('button', { class: 'sm ghost danger', onclick: async () => { if (await confirmBox(`Revoke "${k.name}"? That machine stops syncing.`, 'Revoke')) { await api('DELETE', '/api/keys/' + k.id).catch(oops); load(); } } }, 'Revoke'))))))) : h('div', { class: 'dim' }, 'No keys yet.'),
        h('button', { class: 'primary', style: { marginTop: '12px' }, onclick: async () => { const name = await promptBox('New machine key', 'Which machine is it for?', 'OB truck graphics PC'); if (!name) return; try { const k = await api('POST', '/api/keys', { name }); load(k.key); } catch (e) { oops(e); } } }, 'Create machine key')));
    };
    load().catch((e) => el.replaceChildren(h('div', { class: 'card' }, e.message)));
    return el;
  }

  function fileTab() {
    const file = h('input', { type: 'file', accept: '.xml,.txt,text/xml,application/xml,text/plain', class: 'hide', onchange: async () => {
      if (!file.files[0]) return;
      try {
        const r = await api('POST', '/api/import.xml?team=' + App.team, await file.files[0].text(), { 'content-type': 'application/xml' });
        await App.loadDocs(); applyTheme();
        const n = Object.entries(r.counts).map(([k, v]) => `${v} ${(Schema.ENTITIES[k] || { plural: k }).plural.toLowerCase()}`).join(', ');
        toast(n ? 'Imported ' + n : 'Nothing to import in that file'); route();
      } catch (e) { oops(e); }
      file.value = '';
    } });
    return h('div', { class: 'card' }, h('h2', {}, 'Save file (XML)'), h('p', { class: 'dim', style: { marginTop: 0 } }, 'Export this production team in the RFP Manager save file layout, or load a save file into it. Importing adds and updates records; it never deletes anything.'), file,
      h('div', { class: 'row' }, App.can('edit') ? h('a', { class: 'btn', href: '/api/export.xml?team=' + App.team }, 'Export save file') : null, App.can('admin') && !App.cfg.bridge ? h('button', { onclick: () => file.click() }, 'Import save file…') : null));
  }

  // ---- the public website's home page (site admins): about us, services, contact, who gets booking requests
  // the website's Bibles: from the Beblia collection (1000+ translations, 200+ languages) or a file; for everyone's verse
  function siteBiblesCard() {
    const box = h('div', { class: 'card' }, h('h2', {}, 'Bibles on the website'), h('p', { class: 'dim' }, 'Loading…'));
    let q = '', cat = null, picked = null, ok = false;
    const sizeMb = (n) => (n / 1048576).toFixed(1) + ' MB';
    async function paint() {
      let mine = [];
      try { mine = (await api('GET', '/api/bibles/site')).list; } catch (e) { box.replaceChildren(h('h2', {}, 'Bibles on the website'), h('p', { class: 'dim' }, e.message)); return; }
      const have = new Set(mine.map((b) => b.source));
      const results = h('div', { class: 'bible-results' });
      const showResults = () => {
        if (!cat) { results.replaceChildren(h('p', { class: 'dim small' }, 'Search a language, e.g. Afrikaans, Zulu, Xhosa, Sesotho, English.')); return; }
        const w = q.trim().toLowerCase();
        const list = w.length < 2 ? [] : cat.filter((c) => `${c.language} ${c.version} ${c.file}`.toLowerCase().includes(w)).slice(0, 60);
        results.replaceChildren(w.length < 2 ? h('p', { class: 'dim small' }, `${cat.length} Bibles in the collection. Type at least two letters.`) : !list.length ? h('p', { class: 'dim small' }, 'Nothing found.')
          : h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, list.map((c) => h('tr', { class: picked === c.file ? 'sel' : '' },
            h('td', {}, h('b', {}, c.language), c.version ? ' ' + c.version : '', h('div', { class: 'dim small' }, c.file)), h('td', { class: 'dim small nowrap' }, sizeMb(c.size)),
            h('td', { class: 'right' }, [...have].some((x) => x.includes(`(${c.file})`)) ? h('span', { class: 'pill ok' }, 'Added') : h('button', { class: 'sm' + (picked === c.file ? ' primary' : ''), onclick: () => { picked = c.file; ok = false; showResults(); paintAdd(); } }, picked === c.file ? 'Picked' : 'Pick'))))))));
      };
      const add = h('div', {});
      const paintAdd = () => add.replaceChildren(!picked ? null : h('div', { class: 'card', style: { background: 'var(--panel2)', margin: '10px 0 0' } },
        h('p', { style: { marginTop: 0 } }, 'Add ', h('b', {}, picked), ' to the website?'),
        h('label', { class: 'row', style: { gap: '8px', alignItems: 'flex-start' } }, h('input', { type: 'checkbox', checked: ok, onchange: (e) => { ok = e.target.checked; btn.disabled = !ok; } }),
          h('span', {}, 'This translation is in the public domain, or we have permission to use it. Most modern translations are under copyright (for example by the Bible Society); its copyright line is shown with every verse.')),
        h('div', { class: 'row', style: { marginTop: '8px' } }, btn, h('button', { onclick: () => { picked = null; paintAdd(); showResults(); } }, 'Cancel'))));
      const btn = h('button', { class: 'primary', disabled: true, onclick: async () => {
        btn.disabled = true; btn.textContent = 'Downloading…';
        try { const r = await api('POST', '/api/bibles/site', { file: picked, confirm: true }); toast(`${r.bible.name} added (${r.bible.verses} verses)`); picked = null; paint(); } catch (e) { oops(e); btn.disabled = false; btn.textContent = 'Add to the website'; }
      } }, 'Add to the website');
      const search = h('input', { type: 'search', placeholder: 'Search the collection: language or version', value: q, oninput: async (e) => {
        q = e.target.value;
        if (!cat) { try { cat = (await api('GET', '/api/bibles/catalog')).list; } catch (err) { oops(err); return; } }
        showResults();
      } });
      box.replaceChildren(h('h2', {}, 'Bibles on the website'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, 'Kept by the website (database and NAS), so everyone can pick them for their verse of the day, on the website and on production PCs.'),
        mine.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, mine.map((b) => h('tr', {},
          h('td', {}, h('b', {}, b.name), h('div', { class: 'dim small' }, [b.language, `${b.books} books`, `${b.verses} verses`].filter(Boolean).join(' · ')), b.copyright ? h('div', { class: 'dim small' }, b.copyright) : null),
          h('td', { class: 'dim small' }, b.source), h('td', { class: 'right' }, h('button', { class: 'sm ghost danger', onclick: async () => { if (await confirmBox(`Remove ${b.name} from the website? People who picked it get the default verse.`, 'Remove')) { try { await api('DELETE', '/api/bibles/site/' + b.id); paint(); } catch (e) { oops(e); } } } }, 'Remove')))))))
          : h('p', { class: 'dim' }, 'None yet.'),
        h('h3', {}, 'Add from the Beblia collection'), h('p', { class: 'dim small', style: { marginTop: 0 } }, 'github.com/Beblia/Holy-Bible-XML-Format: 1000+ translations in 200+ languages.'),
        search, results, add);
      showResults(); paintAdd();
    }
    paint();
    return box;
  }

  // RegemarkFP's apps on the website: each names its GitHub repository; releases are copied to this server
  function softwareCard() {
    const box = h('div', { class: 'card' }, h('h2', {}, 'Software on the website'), h('p', { class: 'dim' }, 'Loading…'));
    const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
    function edit(p) {
      const f = { name: '', slug: '', tagline: '', repo: '', description: '', price: 0, visible: true, prerelease: false, access: [], ...(p || {}) };
      const form = h('div', { class: 'form' },
        ...[['name', 'Name', 'Regemark Replay'], ['slug', 'Web address (/software/…)', 'regemark-replay'], ['tagline', 'One line', 'Replay and ISO recording for live sport'], ['repo', 'GitHub repository (owner/name)', 'regemarkfp/regemark-replay']]
          .map(([k, l, ph]) => h('label', { class: 'f' }, h('span', {}, l), h('input', { value: f[k] || '', placeholder: ph, oninput: (e) => { f[k] = e.target.value; } }))),
        h('label', { class: 'f wide' }, h('span', {}, 'Description'), h('textarea', { rows: 5, oninput: (e) => { f.description = e.target.value; } }, f.description || '')),
        h('label', { class: 'f' }, h('span', {}, 'Price (ZAR, 0 = free)'), h('input', { type: 'number', min: 0, value: f.price || 0, oninput: (e) => { f.price = Number(e.target.value) || 0; } }), h('div', { class: 'help' }, 'Paid apps cannot be downloaded until buying is switched on, except by the emails below.')),
        h('label', { class: 'f' }, h('span', {}, 'Who may download a paid app now (emails)'), h('textarea', { rows: 2, oninput: (e) => { f.access = e.target.value.split(/[\s,;]+/).filter(Boolean); } }, (f.access || []).join('\n'))),
        h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: f.visible !== false, onchange: (e) => { f.visible = e.target.checked; } }), 'Show on the website'),
        h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: !!f.prerelease, onchange: (e) => { f.prerelease = e.target.checked; } }), 'Include pre-releases (betas)'));
      UI.modal({ title: p ? 'Edit ' + p.name : 'Add an app', wide: true, body: form, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => { await api('POST', '/api/software', f); toast('Saved: its GitHub releases are being copied'); paint(); } }] });
    }
    async function paint() {
      let r; try { r = await api('GET', '/api/software'); } catch (e) { box.replaceChildren(h('h2', {}, 'Software on the website'), h('p', { class: 'dim' }, e.message)); return; }
      box.replaceChildren(h('div', { class: 'spread' }, h('h2', {}, 'Software on the website'), h('button', { class: 'primary', onclick: () => edit(null) }, '+ Add an app')),
        h('p', { class: 'dim', style: { marginTop: 0 } }, `Publish a release on GitHub as usual: the website copies its installers (.exe, .msi, .dmg, .pkg, .AppImage, .deb, .rpm …) to ${r.folder} every 6 hours (or now, with Sync) and serves them at /software.`),
        r.list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, r.list.map((p) => { const rel = p.releases[0]; return h('tr', {},
          h('td', {}, h('b', {}, p.name), p.visible === false ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'hidden') : null, h('div', { class: 'dim small' }, p.repo || 'no repository'), h('div', { class: 'dim small' }, `/software/${p.slug}`)),
          h('td', { class: 'small' }, rel ? `v${rel.version} · ${rel.assets.length} file${rel.assets.length === 1 ? '' : 's'}` : 'no release yet', h('div', { class: 'dim small' }, `synced ${when(p.synced)} · ${p.downloads} download${p.downloads === 1 ? '' : 's'}`)),
          h('td', { class: 'small' }, p.price ? 'R ' + p.price : 'Free'),
          h('td', { class: 'right nowrap' }, h('button', { class: 'sm', onclick: async (e) => { e.target.disabled = true; try { const x = await api('POST', `/api/software/${p.slug}/sync`); toast(`${x.releases} release${x.releases === 1 ? '' : 's'}, ${x.copied} new file${x.copied === 1 ? '' : 's'}`); paint(); } catch (err) { oops(err); e.target.disabled = false; } } }, 'Sync'),
            ' ', h('button', { class: 'sm', onclick: () => edit(p) }, 'Edit'), ' ', h('a', { class: 'btn sm', href: (App.cfg.siteUrl || '') + '/software/' + p.slug, target: '_blank', rel: 'noopener' }, 'View ↗'),
            ' ', h('button', { class: 'sm ghost danger', onclick: async () => { if (await confirmBox(`Take ${p.name} off the website? The copied files stay until the next clean-up.`, 'Remove')) { await api('DELETE', '/api/software/' + p.id).catch(oops); paint(); } } }, '✕'))); })))) : h('p', { class: 'dim' }, 'No apps yet.'));
    }
    paint();
    return box;
  }

  function websiteTab() {
    const box = h('div', { class: 'card dim' }, 'Loading…');
    api('GET', '/api/site/landing').then((l) => {
      const f = { ...l, services: (l.services || []).map((x) => ({ ...x })) };
      const text = (k, label, ph) => h('label', { class: 'f' }, h('span', {}, label), h('input', { value: f[k] || '', placeholder: ph || '', oninput: (e) => { f[k] = e.target.value; } }));
      box.className = 'card';
      box.replaceChildren(h('h2', {}, 'Home page'),
        h('p', { class: 'dim', style: { marginTop: 0 } }, 'What everyone sees first on the website: about us, the Browse content and Book services buttons, and "Sign in as production team".'),
        h('div', { class: 'form' },
          h('label', { class: 'f', style: { gridColumn: '1 / -1' } }, h('span', {}, 'Heading'), h('input', { value: f.title || '', oninput: (e) => { f.title = e.target.value; } })),
          h('label', { class: 'f', style: { gridColumn: '1 / -1' } }, h('span', {}, 'About us'), h('textarea', { rows: 5, oninput: (e) => { f.about = e.target.value; } }, f.about || '')),
          h('div', { class: 'f' }, h('span', { class: 'flabel' }, 'Background picture'), fieldInput({ k: 'image', t: 'image' }, f.image, (v) => { f.image = v; })),
          text('email', 'Contact email', 'info@…'), text('phone', 'Contact phone'),
          h('label', { class: 'f' }, h('span', {}, 'Booking requests go to'), h('select', { onchange: (e) => { f.bookingTeam = e.target.value; } }, l.teams.map((t) => h('option', { value: t.id, selected: t.id === f.bookingTeam }, t.name))))),
        h('h3', { style: { marginTop: '16px' } }, 'Services'),
        fieldInput({ k: 'services', t: 'list', fields: [{ k: 'title', l: 'Service', t: 'text' }, { k: 'text', l: 'Short description', t: 'text' }] }, f.services, (v) => { f.services = v; }),
        h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'primary', onclick: async () => { try { await api('PUT', '/api/site/landing', f); toast('Home page saved'); } catch (e) { oops(e); } } }, 'Save'),
          h('a', { class: 'btn', href: (App.cfg.siteUrl || '') + '/', target: '_blank', rel: 'noopener' }, 'View the home page ↗')));
    }).catch((e) => { box.textContent = e.message; });
    return box;
  }

  // ---- the inbox (on the website); the number of unread ones in the menu
  App.pages.notifications = () => {
    const box = h('div', { class: 'card' });
    if (window.RFPNotifyUI) window.RFPNotifyUI.inbox(box);
    return { el: h('div', {}, pageHead('Notifications', h('button', { class: 'sm', onclick: () => { App.settingsTab = 'notifications'; location.hash = '#/settings'; } }, 'Choose what you get')), box) };
  };
  window.rfpUnread = (n) => {
    App.unread = n;
    const a = document.querySelector('.nav a[href="#/notifications"]');
    if (a) a.textContent = 'Notifications' + (n ? ` (${n})` : '');
  };
  setInterval(() => { if (App.cfg && App.cfg.mode === 'cloud' && App.me && !document.hidden && window.RFPNotifyUI) window.RFPNotifyUI.unread().then(window.rfpUnread); }, 60000);
  setTimeout(() => { if (App.cfg && App.cfg.mode === 'cloud' && App.me && window.RFPNotifyUI) window.RFPNotifyUI.unread().then(window.rfpUnread); }, 3000);

  App.pages.settings = () => {
    const local = App.cfg.mode === 'local';
    const tabs = (App.cfg.bridge ? [] : [['team', 'Production team']]).concat([['members', 'Members'], ['account', 'My account'], ['notifications', 'Notifications']]);   // team settings are made on the website
    if ((local || App.machine.remote) && App.machine.admin) tabs.push(['connections', 'Connections'], ['machine', local ? 'This machine' : 'Production PC']);
    if (!App.cfg.bridge && App.teams.some((t) => t.role === 'Admin')) tabs.push(['keys', 'Machine keys']);   // keys are made on the website
    if (!local && App.machine.siteAdmin) tabs.push(['website', 'Website']);
    if (!local) tabs.push(['server', 'Server']);
    if (App.settingsTab) { tab = App.settingsTab; App.settingsTab = null; }
    if (!App.cfg.bridge) tabs.push(['file', 'Save file']);
    if (App.cfg.bridge) tabs.sort((a, b) => ['connections', 'machine', 'members', 'account'].indexOf(a[0]) - ['connections', 'machine', 'members', 'account'].indexOf(b[0]));   // the PC: CasparCG and devices first
    if (!tabs.some(([k]) => k === tab)) tab = tabs.some(([k]) => k === 'connections') && App.cfg.bridge ? 'connections' : tabs[0][0];
    // notifications are chosen on the website (on a production PC: a link there)
    const notificationsTab = () => {
      const box = h('div', { class: 'card' });
      if (local) { const site = String(App.cfg.cloudUrl || '').replace(/\/+$/, ''); box.append(h('h2', {}, 'Notifications'), h('p', { class: 'dim' }, 'Notifications on this PC come from the website: choose them there. People who sign in on this PC get theirs as Windows notifications while RFP Manager runs.'), site ? h('a', { class: 'btn primary', href: site + '/app/#/settings', target: '_blank', rel: 'noopener', onclick: () => { App.settingsTab = 'notifications'; } }, 'Open the website') : null); return box; }
      box.append(h('h2', {}, 'Notifications'));
      const inner = h('div', {}); box.append(inner);
      if (window.RFPNotifyUI) window.RFPNotifyUI.settings(inner);
      return box;
    };
    const body = { notifications: notificationsTab, team: teamTab, members: membersTab, account: () => [accountTab(), verseCard()], connections: App.connectionsTab, machine: machineTab, keys: keysTab, file: fileTab, server: App.serverTab, website: () => [websiteTab(), softwareCard(), siteBiblesCard()] }[tab]();
    return { el: h('div', {}, pageHead('Settings'), h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; route(); } }, l))), body) };
  };
})();
