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
    { k: 'publicMatches', l: 'Show our matches on the public website', t: 'bool', help: 'Fixtures, live scores and results of this team appear on the website\'s front page. Public channels and their streams always do.' },
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
        App.cfg.mode === 'local' || App.me.hasPassword ? h('label', { class: 'f' }, h('span', {}, 'New password (8+ characters)'), h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => { f.password = e.target.value; } })) : null),
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'primary', onclick: async () => { try { await api('POST', '/api/me', f); await App.loadMe(); toast('Account saved'); route(); } catch (e) { oops(e); } } }, 'Save'),
        App.cfg.mode === 'cloud' ? h('button', { onclick: async (e) => { const b = e.target; b.disabled = true; try { const r = await api('POST', '/api/mail/test'); if (r.ok) toast('Test email sent to ' + App.me.email + ' – check your inbox (and spam)'); else oops(new Error('Email did not go out: ' + r.error)); } catch (x) { oops(x); } b.disabled = false; } }, 'Send me a test email') : null)));
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
          s.linked ? h('p', { class: 'dim', style: { marginTop: 0 } }, 'Linked to ', h('b', {}, m.cloud.url), '. Records and images sync both ways; changes go straight away.') : App.linkFlow({ url: m.cloud.url || (App.cfg && App.cfg.cloudUrl) || '', onDone: () => setTimeout(() => route(), 2500) }),
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

  App.pages.settings = () => {
    const local = App.cfg.mode === 'local';
    const tabs = (App.cfg.bridge ? [] : [['team', 'Production team']]).concat([['members', 'Members'], ['account', 'My account']]);   // team settings are made on the website
    if ((local || App.machine.remote) && App.machine.admin) tabs.push(['connections', 'Connections'], ['machine', local ? 'This machine' : 'Production PC']);
    if (!App.cfg.bridge && App.teams.some((t) => t.role === 'Admin')) tabs.push(['keys', 'Machine keys']);   // keys are made on the website
    if (!local && App.machine.siteAdmin) tabs.push(['website', 'Website']);
    if (!local) tabs.push(['server', 'Server']);
    if (App.settingsTab) { tab = App.settingsTab; App.settingsTab = null; }
    if (!App.cfg.bridge) tabs.push(['file', 'Save file']);
    if (App.cfg.bridge) tabs.sort((a, b) => ['connections', 'machine', 'members', 'account'].indexOf(a[0]) - ['connections', 'machine', 'members', 'account'].indexOf(b[0]));   // the PC: CasparCG and devices first
    if (!tabs.some(([k]) => k === tab)) tab = tabs.some(([k]) => k === 'connections') && App.cfg.bridge ? 'connections' : tabs[0][0];
    const body = { team: teamTab, members: membersTab, account: accountTab, connections: App.connectionsTab, machine: machineTab, keys: keysTab, file: fileTab, server: App.serverTab, website: websiteTab }[tab]();
    return { el: h('div', {}, pageHead('Settings'), h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; route(); } }, l))), body) };
  };
})();
