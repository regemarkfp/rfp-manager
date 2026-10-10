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
    CUSTOM_FIELDS];

  function teamTab() {
    const admin = App.can('admin');
    const form = buildForm('org', App.org(), { fields: TEAM_FIELDS });
    const el = h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h2', {}, 'Production team'), form.el,
      h('p', { class: 'help' }, 'Custom fields appear on that record\'s form. Sports rules are built in and follow each federation; choose the format or variant in the scorer\'s Setup tab.'),
      admin ? h('div', { style: { marginTop: '14px' } }, h('button', { class: 'primary', onclick: async () => { try { await App.save('org', App.team, { ...App.org(), ...form.data }); applyTheme(); await App.loadMe(); toast('Team settings saved'); route(); } catch (e) { oops(e); } } }, 'Save team settings')) : h('p', { class: 'dim' }, 'Only an Admin can change team settings.')));
    if (!admin) el.querySelectorAll('input, select, textarea, button').forEach((x) => { x.disabled = true; });
    return el;
  }

  function membersTab() {
    const admin = App.can('admin'), local = App.cfg.mode === 'local';
    const list = h('div', {});
    const paint = () => {
      const ms = App.list('member').sort((a, b) => String(a.data.email).localeCompare(String(b.data.email)));
      list.replaceChildren(h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Name'), h('th', {}, 'Role'), h('th', {}))),
        h('tbody', {}, ms.map((m) => h('tr', {}, h('td', {}, m.data.email, m.data.email === App.me.email ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'you') : null), h('td', {}, m.data.name || ''),
          h('td', {}, admin ? h('select', { style: { width: '140px' }, onchange: async (e) => { try { await api('POST', '/api/members?team=' + App.team, { email: m.data.email, name: m.data.name, role: e.target.value }); toast('Role changed'); } catch (err) { oops(err); paint(); } } }, Schema.ROLES.map((r) => h('option', { selected: r === m.data.role }, r))) : m.data.role),
          h('td', { class: 'r' }, admin ? h('button', { class: 'sm ghost danger', onclick: async () => { if (await confirmBox(`Remove ${m.data.email} from this production team?`, 'Remove')) { try { await api('DELETE', `/api/members/${m.id}?team=${App.team}`); App.docs.delete(m.id); paint(); } catch (err) { oops(err); } } } }, 'Remove') : null)))))));
    };
    paint();
    const f = { email: '', name: '', role: 'Scorer', password: '' };
    return h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h2', {}, 'Members'), list,
      h('p', { class: 'help' }, 'Admin: everything, including members and settings. Producer: edit all records. Scorer: score matches and control graphics. Crew: view only (no ID numbers).')),
    admin ? h('div', { class: 'card' }, h('h2', {}, 'Add someone'), h('div', { class: 'form' },
      h('label', { class: 'f' }, h('span', {}, 'Email (their Google account)'), h('input', { type: 'email', oninput: (e) => { f.email = e.target.value; } })),
      h('label', { class: 'f' }, h('span', {}, 'Name'), h('input', { oninput: (e) => { f.name = e.target.value; } })),
      h('label', { class: 'f' }, h('span', {}, 'Role'), h('select', { onchange: (e) => { f.role = e.target.value; } }, Schema.ROLES.map((r) => h('option', { selected: r === f.role }, r)))),
      local ? h('label', { class: 'f' }, h('span', {}, 'Password (optional, for signing in without internet)'), h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => { f.password = e.target.value; } })) : null),
    h('p', { class: 'help' }, local ? 'They can sign in with Google using this email, or with the password you set here.' : 'They sign in with Google using this email and will see this production team straight away.'),
    h('button', { class: 'primary', style: { marginTop: '10px' }, onclick: async () => { try { const r = await api('POST', '/api/members?team=' + App.team, f); App.docs.set(r.doc.id, r.doc); toast('Member added'); route(); } catch (e) { oops(e); } } }, 'Add member')) : null);
  }

  function accountTab() {
    const linked = App.machine.linked;
    const f = { name: App.me.name, password: '', currentPassword: '' };
    return h('div', { class: 'card' }, h('h2', {}, 'My account'), h('p', {}, h('b', {}, App.me.email), App.me.google ? h('span', { class: 'pill ok', style: { marginLeft: '8px' } }, 'Google') : null, App.me.hasPassword ? h('span', { class: 'pill', style: { marginLeft: '8px' } }, 'Password set') : null),
      linked ? h('p', { class: 'dim' }, 'This machine is linked to the website, so your name and sign-in are managed there and synced down.') : h('div', {}, h('div', { class: 'form' },
        h('label', { class: 'f' }, h('span', {}, 'Name'), h('input', { value: f.name, oninput: (e) => { f.name = e.target.value; } })),
        App.me.hasPassword ? h('label', { class: 'f' }, h('span', {}, 'Current password'), h('input', { type: 'password', autocomplete: 'current-password', oninput: (e) => { f.currentPassword = e.target.value; } })) : null,
        App.cfg.mode === 'local' || App.me.hasPassword ? h('label', { class: 'f' }, h('span', {}, 'New password (8+ characters)'), h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => { f.password = e.target.value; } })) : null),
      h('button', { class: 'primary', style: { marginTop: '12px' }, onclick: async () => { try { await api('POST', '/api/me', f); await App.loadMe(); toast('Account saved'); route(); } catch (e) { oops(e); } } }, 'Save')));
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
          h('p', { class: 'dim', style: { marginTop: 0 } }, 'Team members signed in on the website can use this PC\'s live screens from anywhere: Graphics control, scorers, dashboards, Timeline, Worship, monitors, Connections and Templates. Nothing needs to be opened on your router: the PC keeps one outgoing link to the website. Graphics still play out from this PC.'),
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
      h('div', { class: 'row' }, App.can('edit') ? h('a', { class: 'btn', href: '/api/export.xml?team=' + App.team }, 'Export save file') : null, App.can('admin') ? h('button', { onclick: () => file.click() }, 'Import save file…') : null));
  }

  App.pages.settings = () => {
    const local = App.cfg.mode === 'local';
    const tabs = [['team', 'Production team'], ['members', 'Members'], ['account', 'My account']];
    if ((local || App.machine.remote) && App.machine.admin) tabs.push(['connections', 'Connections'], ['machine', local ? 'This machine' : 'Production PC']);
    if (App.teams.some((t) => t.role === 'Admin')) tabs.push(['keys', 'Machine keys']);
    if (!local && App.machine.siteAdmin) tabs.push(['server', 'Server']);
    if (App.settingsTab) { tab = App.settingsTab; App.settingsTab = null; }
    tabs.push(['file', 'Save file']);
    if (!tabs.some(([k]) => k === tab)) tab = 'team';
    const body = { team: teamTab, members: membersTab, account: accountTab, connections: App.connectionsTab, machine: machineTab, keys: keysTab, file: fileTab, server: App.serverTab }[tab]();
    return { el: h('div', {}, pageHead('Settings'), h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; route(); } }, l))), body) };
  };
})();
