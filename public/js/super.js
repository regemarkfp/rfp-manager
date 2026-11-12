/* The superuser page (universe.<website> or /super): sign in, set the password from the emailed link, and see the
 * website's health and every production company. Only Admins who accepted the terms are named. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === null || v === undefined || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v); }
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  };
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  }
  const show = (...kids) => $('main').replaceChildren(...kids.flat(Infinity).filter(Boolean));
  const bytes = (n) => (n >= 1e12 ? (n / 1e12).toFixed(2) + ' TB' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(0) + ' MB' : Math.max(0, Math.round(n / 1e3)) + ' KB');
  const dur = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const yes = (b, on = 'On', off = 'Off') => el('span', { class: b ? 'ok' : 'bad' }, b ? on : off);

  const setToken = new URLSearchParams(location.search).get('set');
  // auto refresh: every 30 seconds while the page is open and showing (not while you are typing something)
  let filterQ = '', timer = null, auto = true;
  try { auto = localStorage.getItem('su-auto') !== '0'; } catch (e) { /* private window */ }
  const later = () => { clearTimeout(timer); if (auto) timer = setTimeout(() => { const typing = (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) || [...document.querySelectorAll('#main input:not([type=search]):not([type=checkbox]):not([type=file])')].some((x) => x.value); if (document.visibilityState === 'visible' && !typing) load(true); else later(); }, 30000); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && auto && timer) load(true); });

  function loginForm(note) {
    const email = el('input', { type: 'email', autocomplete: 'username', placeholder: 'info@…' });
    const pw = el('input', { type: 'password', autocomplete: 'current-password' });
    const msg = el('div', { class: 'msg small' }, note || '');
    const go = async (e) => {
      e.preventDefault(); msg.textContent = '';
      try { await api('POST', '/api/super/login', { email: email.value, password: pw.value }); load(); } catch (err) { msg.className = 'msg small bad'; msg.textContent = err.message; }
    };
    const reset = async () => {
      msg.className = 'msg small';
      if (!email.value) { msg.textContent = 'Type the superuser email first.'; return; }
      try { const r = await api('POST', '/api/super/reset', { email: email.value }); msg.className = 'msg small ok'; msg.textContent = r.message; } catch (err) { msg.className = 'msg small bad'; msg.textContent = err.message; }
    };
    show(el('div', { class: 'card login' }, el('h1', {}, 'Universe sign-in'),
      el('form', { onsubmit: go }, el('label', { class: 'small dim' }, 'Email'), email, el('label', { class: 'small dim' }, 'Password'), pw,
        el('div', { class: 'row' }, el('button', { type: 'submit' }, 'Sign in'), el('button', { type: 'button', class: 'ghost', onclick: reset }, 'Set or reset password'))),
      msg));
  }

  function setForm() {
    const pw = el('input', { type: 'password', autocomplete: 'new-password', minlength: '10' });
    const pw2 = el('input', { type: 'password', autocomplete: 'new-password' });
    const msg = el('div', { class: 'msg small' });
    const go = async (e) => {
      e.preventDefault();
      if (pw.value !== pw2.value) { msg.className = 'msg small bad'; msg.textContent = 'The two passwords are not the same.'; return; }
      try { await api('POST', '/api/super/password', { token: setToken, password: pw.value }); history.replaceState(null, '', location.pathname); load(); } catch (err) { msg.className = 'msg small bad'; msg.textContent = err.message; }
    };
    show(el('div', { class: 'card login' }, el('h1', {}, 'Set your password'), el('p', { class: 'small dim' }, 'At least 10 characters. Only you know it: it is stored scrambled.'),
      el('form', { onsubmit: go }, el('label', { class: 'small dim' }, 'New password'), pw, el('label', { class: 'small dim' }, 'Again'), pw2, el('button', { type: 'submit' }, 'Save and sign in')), msg));
  }

  function healthCard(hl) {
    const mem = hl.memory || {}, disk = hl.disk;
    const diskFree = disk ? disk.free / disk.total : 1;
    return el('div', { class: 'card' }, el('h2', {}, 'Website health'),
      el('div', { class: 'tiles' },
        el('div', { class: 'tile' }, el('b', {}, hl.version), el('span', {}, 'Version · ' + hl.node)),
        el('div', { class: 'tile' }, el('b', {}, dur(hl.uptime)), el('span', {}, 'Up since the last restart')),
        el('div', { class: 'tile' }, el('b', { class: hl.db && hl.db.ok ? 'ok' : 'bad' }, hl.db && hl.db.ok ? hl.db.ms + ' ms' : 'Down'), el('span', {}, 'Database')),
        el('div', { class: 'tile' }, el('b', {}, (hl.load || [0])[0].toFixed(2)), el('span', {}, `Load (1 min, ${hl.cpus} CPUs)`)),
        el('div', { class: 'tile' }, el('b', {}, bytes(mem.rss || 0)), el('span', {}, `App memory · ${bytes(mem.free || 0)} of ${bytes(mem.total || 0)} free`)),
        disk ? el('div', { class: 'tile' }, el('b', { class: diskFree < 0.1 ? 'bad' : diskFree < 0.2 ? 'warn' : '' }, bytes(disk.free)), el('span', {}, `Disk free of ${bytes(disk.total)}`)) : null,
        el('div', { class: 'tile' }, el('b', {}, String(hl.users)), el('span', {}, 'Accounts')),
        el('div', { class: 'tile' }, el('b', {}, String(hl.pcsOnline)), el('span', {}, 'Production PCs online')),
        el('div', { class: 'tile' }, el('b', {}, hl.streaming ? `${hl.streaming.live} live` : '–'), el('span', {}, hl.streaming && hl.streaming.on ? `${hl.streaming.watching} watching now` : 'Streaming off'))),
      el('p', { class: 'small', style: 'margin:12px 0 0' },
        'Email: ', yes(hl.mail), ' · Payments: ', hl.payments ? yes(hl.payments.on, hl.payments.sandbox ? 'Sandbox' : 'Live') : '–',
        ' · WhatsApp: ', hl.whatsapp ? yes(hl.whatsapp.on) : '–', ' · Push: ', hl.push ? yes(hl.push.on) : '–'));
  }

  function companiesCard(list) {
    const tot = list.reduce((o, c) => ({ users: o.users + c.users, productions: o.productions + c.productions, viewers: o.viewers + c.viewers30 }), { users: 0, productions: 0, viewers: 0 });
    const filter = el('input', { type: 'search', placeholder: 'Filter companies', style: 'max-width:280px;margin:0', value: filterQ });
    const body = el('tbody');
    const paint = () => {
      const q = filter.value.trim().toLowerCase();
      body.replaceChildren(...list.filter((c) => !q || c.name.toLowerCase().includes(q)).map((c) => el('tr', {},
        el('td', {}, el('div', { class: 'co' }, c.logo ? el('img', { class: 'logo', src: c.logo, alt: '', loading: 'lazy' }) : el('span', { class: 'logo ph' }, c.name.slice(0, 1).toUpperCase()), el('div', {}, el('b', {}, c.name), el('div', {}, Object.entries(c.roles).map(([r, n]) => el('span', { class: 'pill' }, `${n} ${r}`)))))),
        el('td', { class: 'n' }, String(c.users)),
        el('td', {}, c.admins.length ? c.admins.map((a) => el('div', { class: 'small' }, a.hidden ? el('span', { class: 'dim' }, 'Admin (has not accepted the terms yet)') : [a.name || '(no name)', ' · ', el('a', { href: 'mailto:' + a.email }, a.email), a.marketing ? '' : el('span', { class: 'dim' }, ' · no marketing')])) : el('span', { class: 'dim small' }, 'No Admin')),
        el('td', { class: 'n' }, `${c.productions}`, el('div', { class: 'dim small' }, `${c.productions30} in 30 days`)),
        el('td', { class: 'n' }, String(c.matches)),
        el('td', { class: 'n' }, String(c.bookings)),
        el('td', { class: 'n' }, `${c.clients} / ${c.invoices}`),
        el('td', { class: 'n' }, String(c.viewers30), el('div', { class: 'dim small' }, `${c.watchHours30} h watched`)))));
    };
    filter.addEventListener('input', () => { filterQ = filter.value; paint(); }); paint();
    return el('div', { class: 'card' },
      el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, el('h2', { style: 'margin:0' }, `Production companies (${list.length})`), filter,
        el('a', { class: 'btn ghost', href: '/api/super/contacts.csv' }, 'Admin emails (CSV)')),
      el('p', { class: 'small dim', style: 'margin-top:0' }, `${tot.users} users · ${tot.productions} productions · ${tot.viewers} viewers in the last 30 days. Only Admins who accepted the terms are named; nobody else is.`),
      el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Company'), el('th', { class: 'n' }, 'Users'), el('th', {}, 'Admins'), el('th', { class: 'n' }, 'Productions'), el('th', { class: 'n' }, 'Matches'), el('th', { class: 'n' }, 'Bookings'), el('th', { class: 'n' }, 'Clients / docs'), el('th', { class: 'n' }, 'Viewers 30d'))), body)));
  }

  // the NAS: space, the RAID 1 mirror (both disks working?), and what takes the room
  function nasCards(n) {
    if (!n.exists) return el('div', { class: 'card' }, el('p', {}, `No NAS folder at ${n.path}. Set NAS_DIR on the server if it is somewhere else.`));
    const usedPct = n.total ? Math.round((n.used / n.total) * 100) : 0;
    const r = n.raid;
    const bar = el('div', { class: 'meter' }, el('span', { style: `width:${usedPct}%;background:${usedPct > 90 ? 'var(--bad)' : usedPct > 80 ? 'var(--warn)' : 'var(--acc)'}` }));
    const max = Math.max(1, ...(n.folders || []).map((f) => f.bytes));
    return [
      el('div', { class: 'card' }, el('h2', {}, 'Space'),
        el('div', { class: 'tiles' },
          el('div', { class: 'tile' }, el('b', { class: usedPct > 90 ? 'bad' : usedPct > 80 ? 'warn' : '' }, bytes(n.free || 0)), el('span', {}, `free of ${bytes(n.total || 0)}`)),
          el('div', { class: 'tile' }, el('b', {}, usedPct + '%'), el('span', {}, `used (${bytes(n.used || 0)})`)),
          el('div', { class: 'tile' }, el('b', { style: 'font-size:15px;word-break:break-all' }, n.path), el('span', {}, [n.device, n.fs].filter(Boolean).join(' · ') || 'folder')),
          n.share ? el('div', { class: 'tile' }, el('b', {}, '\\\\' + n.share), el('span', {}, 'Shared on the network (Samba)')) : null),
        bar),
      el('div', { class: 'card' }, el('h2', {}, 'Mirror (RAID)'),
        r ? [el('div', { class: 'tiles' },
          el('div', { class: 'tile' }, el('b', { class: r.healthy ? 'ok' : 'bad' }, r.healthy ? 'Healthy' : 'Degraded'), el('span', {}, `${r.device} · ${r.level} · ${r.state}`)),
          el('div', { class: 'tile' }, el('b', { class: r.working < r.wanted ? 'bad' : '' }, `${r.working} of ${r.wanted}`), el('span', {}, 'disks working')),
          r.progress ? el('div', { class: 'tile' }, el('b', { class: 'warn' }, r.progress.percent + '%'), el('span', {}, `${r.progress.kind}${r.progress.finish ? ' · ' + r.progress.finish + ' left' : ''}`)) : null),
          el('p', { class: 'small', style: 'margin:12px 0 0' }, r.disks.map((d) => el('span', { class: 'pill', style: d.failed ? 'color:var(--bad)' : '' }, `${d.name}${d.failed ? ' failed' : d.spare ? ' spare' : ' ok'}`))),
          r.healthy ? null : el('p', { class: 'bad small' }, 'One disk is missing or failed: the files are still there on the other disk, but there is no copy. Replace the disk soon.')]
          : el('p', { class: 'dim small' }, 'No RAID mirror found for this folder (or /proc/mdstat is not readable).')),
      el('div', { class: 'card' }, el('h2', {}, 'What takes the room'),
        (n.folders || []).length ? el('table', {}, el('tbody', {}, n.folders.map((f) => el('tr', {}, el('td', {}, f.name), el('td', { style: 'width:45%' }, el('div', { class: 'meter thin' }, el('span', { style: `width:${Math.max(1, Math.round(f.bytes / max * 100))}%;background:var(--acc)` }))), el('td', { class: 'n' }, bytes(f.bytes))))))
          : el('p', { class: 'dim small' }, n.measuring ? 'Measuring the folders… (this page refreshes by itself)' : 'Nothing measured yet.'),
        n.measuredAt ? el('p', { class: 'dim small', style: 'margin:8px 0 0' }, `Measured ${new Date(n.measuredAt).toLocaleString('en-GB')} (every 15 minutes at most).`) : null),
    ];
  }

  // ---- NAS users (Samba): the same login on the house network and over Tailscale
  // access: the whole NAS (read and write / read only), only chosen folders (each read, or read and write), or nothing
  const MODE_OPTS = [['full', 'Whole NAS: read and write'], ['read', 'Whole NAS: read only'], ['folders', 'Only folders I choose'], ['none', 'No access']];
  let openAccess = '';
  const drafts = {};
  function accessText(x) {
    const a = x.access || { mode: 'full' };
    if (a.mode === 'full') return 'Whole NAS · read and write';
    if (a.mode === 'read') return 'Whole NAS · read only';
    if (a.mode === 'none') return el('span', { class: 'dim' }, 'No access');
    const f = Object.entries(a.folders || {});
    if (!f.length) return el('span', { class: 'warn' }, 'No folders chosen yet');
    return f.map(([rel, lv], i) => [i ? ', ' : '', el('b', {}, rel), lv === 'write' ? '' : ' (read)']);
  }
  function accessEditor(x, u, act) {
    const d = drafts[x.name] || (drafts[x.name] = { mode: (x.access || {}).mode || 'full', folders: { ...((x.access || {}).folders || {}) } });
    const all = [...new Set([...(u.folders || []), ...Object.keys(d.folders)])].sort((a, b) => a.localeCompare(b));
    const box = el('div', { class: 'access' });
    const paint = () => {
      const list = d.mode === 'folders' ? el('div', { class: 'acc-folders' },
        all.length ? all.map((rel) => el('div', { class: 'acc-row' + (rel.includes('/') ? ' sub' : '') },
          el('span', {}, rel.includes('/') ? '↳ ' + rel.split('/').pop() : rel),
          el('select', { class: 'sel', onchange: (e) => { if (e.target.value) d.folders[rel] = e.target.value; else delete d.folders[rel]; } },
            [['', 'No access'], ['read', 'Read only'], ['write', 'Read and write']].map(([v, l]) => el('option', { value: v, selected: (d.folders[rel] || '') === v ? '' : null }, l))))) : el('p', { class: 'dim small' }, 'No folders on the NAS yet (make them under Files).'),
        el('p', { class: 'dim small', style: 'margin:8px 0 0' }, 'Each chosen folder is its own share: they open \\\\server\\FolderName and only see the folders they may use. A folder deeper than two levels: make it under Files first.')) : null;
      box.replaceChildren(
        el('div', { class: 'row' }, el('b', {}, `Access for ${x.name}`),
          el('select', { class: 'sel', onchange: (e) => { d.mode = e.target.value; paint(); } }, MODE_OPTS.map(([v, l]) => el('option', { value: v, selected: v === d.mode ? '' : null }, l)))),
        list,
        el('div', { class: 'row', style: 'margin-top:10px' },
          el('button', { onclick: () => act('access', { name: x.name, access: { mode: d.mode, folders: d.mode === 'folders' ? d.folders : {} } }, `Access saved for ${x.name}`).then(() => { openAccess = ''; load(true); }).catch(() => {}) }, 'Save access'),
          el('button', { class: 'ghost', onclick: () => { delete drafts[x.name]; openAccess = ''; load(true); } }, 'Cancel')));
    };
    paint();
    return box;
  }

  function usersCard(u) {
    const box = el('div', { class: 'card' }, el('h2', {}, 'NAS users'));
    if (!u.ready) {
      box.append(el('p', { class: 'small' }, 'User management needs a small helper on the server. Run this once on rfp-server, then refresh:'),
        el('pre', { class: 'code' }, 'curl -fsSL https://raw.githubusercontent.com/regemarkfp/rfp-manager/main/tools/server/github-update.sh | sudo bash -s -- --install --force'),
        u.info && u.info.error ? el('p', { class: 'dim small' }, u.info.error) : '');
      return box;
    }
    const i = u.info, msg = el('div', { class: 'msg small' });
    const act = async (action, body, done) => { msg.className = 'msg small'; msg.textContent = 'Working…'; try { await api('POST', '/api/super/nas/users/' + action, body); msg.className = 'msg small ok'; msg.textContent = done; delete drafts[body.name]; load(true); } catch (e) { msg.className = 'msg small bad'; msg.textContent = e.message; throw e; } };
    const ask = (q) => { const v = prompt(q); return v === null ? null : v; };
    const nu = { name: '', password: '', mode: 'folders' };
    box.append(
      el('p', { class: 'small dim', style: 'margin-top:0' }, 'Connect from Windows File Explorer (\\\\name\\NAS), a Mac (smb://name/NAS) or a phone file app. The same user name and password work at home and over Tailscale.'),
      el('div', { class: 'tiles' },
        el('div', { class: 'tile' }, el('b', { style: 'font-size:15px' }, `\\\\${i.host}\\NAS`), el('span', {}, 'At home (house network)')),
        i.tailscale ? el('div', { class: 'tile' }, el('b', { style: 'font-size:15px;word-break:break-all' }, `\\\\${i.tailscale}\\NAS`), el('span', {}, 'Over Tailscale')) : null,
        i.tailscaleIp ? el('div', { class: 'tile' }, el('b', { style: 'font-size:15px' }, `\\\\${i.tailscaleIp}\\NAS`), el('span', {}, 'Over Tailscale (IP)')) : null),
      el('table', { style: 'margin-top:12px' }, el('tbody', {}, u.users.length ? u.users.map((x) => [el('tr', {},
        el('td', {}, el('b', {}, x.name), x.madeHere ? null : el('span', { class: 'dim small' }, ' · also a login on the server')),
        el('td', {}, el('span', { class: x.enabled ? 'ok' : 'bad' }, x.enabled ? 'Active' : 'Switched off')),
        el('td', { class: 'small' }, accessText(x)),
        el('td', { class: 'n' },
          el('button', { class: 'ghost sm' + (openAccess === x.name ? ' on' : ''), onclick: () => { openAccess = openAccess === x.name ? '' : x.name; load(true); } }, 'Access'), ' ',
          el('button', { class: 'ghost sm', onclick: () => { const pw = ask(`New password for ${x.name} (8+ characters)`); if (pw) act('passwd', { name: x.name, password: pw }, `Password changed for ${x.name}`); } }, 'Password'), ' ',
          el('button', { class: 'ghost sm', onclick: () => act(x.enabled ? 'disable' : 'enable', { name: x.name }, `${x.name} ${x.enabled ? 'switched off' : 'switched on'}`) }, x.enabled ? 'Switch off' : 'Switch on'), ' ',
          el('button', { class: 'ghost sm', onclick: () => { if (confirm(`Take ${x.name} off the NAS?${x.madeHere ? '' : ' Their login on the server itself stays.'}`)) act('remove', { name: x.name }, `${x.name} removed`); } }, 'Remove'))),
        openAccess === x.name ? el('tr', {}, el('td', { colspan: '4' }, accessEditor(x, u, act))) : null]) : el('tr', {}, el('td', { class: 'dim' }, 'No NAS users yet.')))),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('input', { placeholder: 'user name (e.g. ruan)', autocomplete: 'off', style: 'max-width:220px;margin:0', oninput: (e) => { nu.name = e.target.value; } }),
        el('input', { type: 'password', placeholder: 'password (8+ characters)', autocomplete: 'new-password', style: 'max-width:240px;margin:0', oninput: (e) => { nu.password = e.target.value; } }),
        el('select', { class: 'sel', onchange: (e) => { nu.mode = e.target.value; } }, MODE_OPTS.map(([v, l]) => el('option', { value: v, selected: v === nu.mode ? '' : null }, l))),
        el('button', { onclick: () => act('add', { name: nu.name, password: nu.password, access: { mode: nu.mode, folders: {} } }, nu.mode === 'folders' ? `${nu.name} added: choose their folders under Access` : `${nu.name} can now open the NAS`).then(() => { if (nu.mode === 'folders') { openAccess = nu.name.trim().toLowerCase(); load(true); } }).catch(() => {}) }, 'Add user')),
      u.managed ? '' : el('p', { class: 'dim small' }, 'Until you change someone\'s access, every NAS user can open the whole NAS (as it was set up).'),
      msg);
    return box;
  }

  // ---- the file browser: the NAS folder, open, download, upload (drag and drop too), new folder, rename, delete
  let filesPath = '', uploading = 0;
  const enc = encodeURIComponent;
  const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const PREVIEW = /\.(jpe?g|png|gif|webp|pdf|mp4|webm|mov|mp3|wav|m4a|txt|csv|json)$/i;
  function sendFile(file, dir, bar) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/super/files/upload?path=${enc(dir)}&name=${enc(file.name)}`);
      x.setRequestHeader('x-rfp', '1');
      x.upload.onprogress = (e) => { if (e.lengthComputable) bar(e.loaded / e.total); };
      x.onload = () => { if (x.status < 300) resolve(); else { let m = 'Upload failed'; try { m = JSON.parse(x.responseText).error || m; } catch (e) { /* not JSON */ } reject(new Error(m)); } };
      x.onerror = () => reject(new Error('Upload failed (connection)'));
      x.send(file);
    });
  }
  async function filesCard() {
    const r = await api('GET', '/api/super/files?path=' + enc(filesPath));
    const box = el('div', { class: 'card drop' });
    const msg = el('div', { class: 'msg small' });
    const go = (p) => { filesPath = p; history.replaceState(null, '', '#files' + (p ? '/' + p : '')); load(); };
    const post = async (url, body, ok) => { try { await api('POST', url, body); if (ok) { msg.className = 'msg small ok'; msg.textContent = ok; } load(true); } catch (e) { msg.className = 'msg small bad'; msg.textContent = e.message; } };
    const parts = r.path ? r.path.split('/') : [];
    const crumbs = el('div', { class: 'crumbs' }, el('a', { href: '#', onclick: (e) => { e.preventDefault(); go(''); } }, 'NAS'), parts.map((p, i) => [' / ', el('a', { href: '#', onclick: (e) => { e.preventDefault(); go(parts.slice(0, i + 1).join('/')); } }, p)]));
    const progress = el('div', { class: 'small' });
    const file = el('input', { type: 'file', multiple: '', style: 'display:none', onchange: () => { upload([...file.files]); file.value = ''; } });
    async function upload(list) {
      if (!list.length) return;
      uploading++;
      const dir = r.path;
      for (const f of list) {
        const meter = el('span', { style: 'width:0%;background:var(--acc)' });
        const row = el('div', { class: 'up' }, el('span', {}, f.name), el('div', { class: 'meter thin', style: 'flex:1' }, meter));
        progress.append(row);
        try { await sendFile(f, dir, (x) => { meter.style.width = Math.round(x * 100) + '%'; }); row.firstChild.textContent = '✓ ' + f.name; }
        catch (e) { row.firstChild.textContent = '✗ ' + f.name + ': ' + e.message; row.firstChild.className = 'bad'; }
      }
      uploading--;
      if (!uploading) setTimeout(() => load(true), 600);
    }
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('over'); });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('over'); upload([...(e.dataTransfer.files || [])]); });
    const href = (it, inline) => `/api/super/files/get?path=${enc((r.path ? r.path + '/' : '') + it.name)}${inline ? '&inline=1' : ''}`;
    const rel = (it) => (r.path ? r.path + '/' : '') + it.name;
    box.append(
      el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, crumbs,
        el('div', { class: 'row' }, el('button', { onclick: () => file.click() }, 'Upload'), el('button', { class: 'ghost', onclick: () => { const n = prompt('Name of the new folder'); if (n) post('/api/super/files/mkdir', { path: r.path, name: n }, 'Folder made'); } }, 'New folder'), file)),
      el('p', { class: 'dim small', style: 'margin-top:0' }, 'Drop files here to upload them to this folder. Over Cloudflare a single file can be up to 100 MB; at home or over Tailscale use the NAS share for bigger files.'),
      progress, msg,
      el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', { class: 'n' }, 'Size'), el('th', {}, 'Changed'), el('th', {}))),
        el('tbody', {}, r.path ? el('tr', {}, el('td', { colspan: '4' }, el('a', { href: '#', onclick: (e) => { e.preventDefault(); go(parts.slice(0, -1).join('/')); } }, '↑ Up'))) : null,
          r.items.length ? r.items.map((it) => el('tr', {},
            el('td', {}, it.dir ? el('a', { href: '#', onclick: (e) => { e.preventDefault(); go(rel(it)); } }, '📁 ' + it.name) : el('a', { href: href(it, PREVIEW.test(it.name)), target: '_blank', rel: 'noopener' }, it.name)),
            el('td', { class: 'n' }, it.dir ? '' : bytes(it.size)), el('td', { class: 'small dim' }, when(it.mtime)),
            el('td', { class: 'n' }, it.dir ? null : el('a', { class: 'btn ghost sm', href: href(it, false) }, 'Download'), ' ',
              el('button', { class: 'ghost sm', onclick: () => { const n = prompt('New name', it.name); if (n && n !== it.name) post('/api/super/files/rename', { path: rel(it), to: n }, 'Renamed'); } }, 'Rename'), ' ',
              el('button', { class: 'ghost sm', onclick: () => { if (confirm(it.dir ? `Delete the folder "${it.name}" and everything in it? This cannot be undone.` : `Delete "${it.name}"? This cannot be undone.`)) post('/api/super/files/delete', { path: rel(it) }, 'Deleted'); } }, 'Delete')))) : el('tr', {}, el('td', { colspan: '4', class: 'dim' }, 'This folder is empty.'))))));
    return box;
  }

  // ---- Updates: this server from GitHub – check, install now, at a set time, or on a schedule
  const at2 = (t) => (t ? new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
  const DAYN = { daily: 'Every day', weekdays: 'Weekdays (Mon–Fri)', mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' };
  function updatesCards(u, reload) {
    const sv = u.server || {};
    const act = (label, fn, cls) => el('button', { class: cls || '', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { alert(err.message); } b.disabled = false; reload(); } }, label);
    const sel = (opts, value, attrs = {}) => el('select', { class: 'sel', ...attrs }, opts.map(([v, t]) => el('option', { value: v, selected: v === value ? '' : null }, t)));
    // 1. this version and GitHub's
    const state = u.error ? el('b', { class: 'bad' }, 'Could not check') : !u.latest ? el('b', { class: 'dim' }, 'Not checked yet') : u.newer ? el('b', { class: 'warn' }, `${u.latest} is available`) : el('b', { class: 'ok' }, 'Up to date');
    const status = el('div', { class: 'card' }, el('h2', {}, 'Version'),
      el('div', { class: 'tiles' },
        el('div', { class: 'tile' }, el('b', {}, u.version), el('span', {}, 'Running now')),
        el('div', { class: 'tile' }, el('b', {}, u.latest || '–'), el('span', {}, 'On GitHub (' + u.repo + ')')),
        el('div', { class: 'tile' }, state, el('span', {}, 'Checked ' + (u.checkedAt ? at2(u.checkedAt) : 'never'))),
        sv.ready ? el('div', { class: 'tile' }, el('b', { class: sv.running ? 'warn' : sv.result === 'success' || !sv.result ? '' : 'bad' }, sv.running ? 'Updating…' : sv.result === 'success' ? 'OK' : sv.result || '–'), el('span', {}, 'Last run ' + at2(sv.lastEnd || sv.lastStart))) : null),
      u.error ? el('p', { class: 'bad small' }, u.error) : null,
      el('div', { class: 'row', style: 'margin-top:14px' },
        act('Check for updates', () => api('POST', '/api/super/updates/check'), 'ghost'),
        sv.ready ? act(u.newer ? `Install ${u.latest} now` : 'Install now', async () => {
          if (!confirm(`Install ${u.newer ? u.latest : 'the newest version'} now? The website restarts (about a minute); live streams keep running in MediaMTX. If the new version does not start, the old one is put back.`)) throw new Error('Not started');
          await api('POST', '/api/super/updates/install', {}); setTimeout(reload, 4000);
        }) : null,
        sv.ready && !u.newer ? act('Reinstall', async () => { if (!confirm('Download and install the same version again?')) throw new Error('Not started'); await api('POST', '/api/super/updates/install', { force: true }); }, 'ghost') : null,
        sv.running ? el('span', { class: 'warn small' }, 'An update is running: the page may be away for a minute.') : null),
      !sv.ready ? el('p', { class: 'small warn' }, sv.error ? `Installing from here is not set up yet (${sv.error}).` : 'Installing from here is not set up yet.', ' Run once on the server: ', el('code', {}, 'sudo rfp-autoupdate'), '.') : null);
    // 2. what is new
    const notes = u.newer && u.notes.length ? el('div', { class: 'card' }, el('h2', {}, `What is new (${u.notes.length} version${u.notes.length > 1 ? 's' : ''})`),
      u.notes.map((n) => el('div', { style: 'margin-bottom:12px' }, el('b', {}, n.version), el('ul', { class: 'small', style: 'margin:6px 0 0;padding-left:20px' },
        n.text.split('\n').filter((l) => /^- /.test(l)).map((l) => el('li', {}, l.slice(2).replace(/\*\*/g, '').replace(/`/g, '')))))) ) : null;
    // 3. install later / on a schedule (the server's timer)
    const oDate = el('input', { type: 'date', style: 'width:auto;margin:0', value: new Date(Date.now() + 864e5).toISOString().slice(0, 10) }), oTime = el('input', { type: 'time', style: 'width:auto;margin:0', value: '02:00' });
    const sDays = sel(Object.entries(DAYN), sv.days || 'daily'), sTime = el('input', { type: 'time', style: 'width:auto;margin:0', value: sv.time || '04:30' });
    const plan = sv.ready ? el('div', { class: 'card' }, el('h2', {}, 'Install later'),
      el('p', { class: 'small dim', style: 'margin-top:0' }, 'Times are the server\'s clock. Each run installs only when GitHub has a newer version.'),
      el('div', { class: 'row' }, el('b', { style: 'min-width:150px' }, 'Once'), oDate, oTime, act(sv.once ? 'Move it' : 'Plan it', () => api('POST', '/api/super/updates/once', { date: oDate.value, time: oTime.value })),
        sv.once ? [el('span', { class: 'ok small' }, 'Planned for ' + at2(sv.once)), act('Cancel', () => api('POST', '/api/super/updates/cancel'), 'ghost sm')] : null),
      el('div', { class: 'row', style: 'margin-top:12px' }, el('b', { style: 'min-width:150px' }, 'Automatically'), sDays, sTime,
        act(sv.auto ? 'Save' : 'Turn on', () => api('POST', '/api/super/updates/schedule', { days: sDays.value, time: sTime.value })),
        sv.auto ? act('Turn off', () => api('POST', '/api/super/updates/schedule', { off: true }), 'ghost') : null,
        el('span', { class: 'small ' + (sv.auto ? 'ok' : 'dim') }, sv.auto ? `${DAYN[sv.days] || sv.calendar} at ${sv.time} · next ${at2(sv.next)}` : 'Off: updates only when you install them'))) : null;
    // 4. checking (here): how often, and the email
    const st = u.settings;
    const check = el('div', { class: 'card' }, el('h2', {}, 'Checking for updates'),
      el('div', { class: 'row' }, el('b', { style: 'min-width:150px' }, 'Check GitHub'),
        sel([['hourly', 'Every hour'], ['6h', 'Every 6 hours'], ['daily', 'Once a day'], ['off', 'Never (only with the button)']], st.check, { onchange: async (e) => { await api('PUT', '/api/super/updates/settings', { check: e.target.value }).catch((err) => alert(err.message)); reload(); } }),
        el('label', { class: 'small', style: 'display:flex;gap:6px;align-items:center;cursor:pointer' }, el('input', { type: 'checkbox', style: 'width:auto;margin:0', checked: st.email ? '' : null, onchange: async (e) => { await api('PUT', '/api/super/updates/settings', { email: e.target.checked }).catch((err) => alert(err.message)); } }), 'Email the superusers when a new version is out')));
    // 5. the updater's own log
    const logBox = el('pre', { class: 'code', style: 'max-height:360px;overflow:auto;display:none' });
    const logCard = sv.ready ? el('div', { class: 'card' }, el('div', { class: 'row', style: 'justify-content:space-between' }, el('h2', { style: 'margin:0' }, 'Update log'),
      el('button', { class: 'ghost sm', onclick: async () => { const r = await api('GET', '/api/super/updates/log').catch((e) => ({ log: e.message })); logBox.textContent = r.log || r.error || 'Nothing yet.'; logBox.style.display = ''; logBox.classList.add('open'); logBox.scrollTop = logBox.scrollHeight; } }, 'Show')), logBox) : null;
    return [status, notes, plan, check, logCard];
  }

  async function load(quiet) {
    clearTimeout(timer); timer = null;
    const y = window.scrollY;
    if (setToken) return setForm();
    const me = await api('GET', '/api/super/me').catch(() => ({}));
    if (!me.email) { $('who').replaceChildren(); if (quiet) return; return loginForm(); }
    $('who').replaceChildren(me.email + ' · ', el('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/super/logout'); load(); } }, 'Sign out'));
    const tab = location.hash === '#nas' ? 'nas' : location.hash === '#updates' ? 'updates' : location.hash.startsWith('#files') ? 'files' : 'overview';
    if (tab === 'files' && !quiet) filesPath = decodeURIComponent(location.hash.slice(7).replace(/^\//, ''));
    const tabs = el('div', { class: 'tabs' }, [['overview', 'Overview'], ['nas', 'NAS'], ['files', 'Files'], ['updates', 'Updates']].map(([k, label]) => el('a', { href: k === 'overview' ? '#' : '#' + k, class: k === tab ? 'on' : '', onclick: (e) => { e.preventDefault(); history.replaceState(null, '', k === 'overview' ? location.pathname : '#' + k); load(); } }, label)));
    const stamp = el('span', { class: 'small dim' }, `Updated ${new Date().toLocaleTimeString('en-GB')}`);
    const autoBox = el('label', { class: 'small dim', style: 'display:flex;gap:6px;align-items:center;cursor:pointer' }, el('input', { type: 'checkbox', checked: auto ? '' : null, style: 'width:auto;margin:0', onchange: (e) => { auto = e.target.checked; try { localStorage.setItem('su-auto', auto ? '1' : '0'); } catch (x) { /* ignore */ } later(); } }), 'Auto refresh (30 s)');
    const head = (title) => el('div', { class: 'row', style: 'justify-content:space-between' }, el('h1', {}, title), el('div', { class: 'row' }, stamp, autoBox, el('button', { class: 'ghost', onclick: () => load() }, 'Refresh')));
    try {
      if (tab === 'updates') { const u = await api('GET', '/api/super/updates'); if (quiet && document.querySelector('#main pre.code.open')) return later(); show(tabs, head('Updates'), updatesCards(u, () => load(true))); if (u.server && u.server.running) setTimeout(() => { if (location.hash === '#updates') load(true); }, 5000); }
      else if (tab === 'files') { if (uploading && quiet) return later(); show(tabs, head('Files'), await filesCard()); }
      else if (tab === 'nas') { const [n, u] = await Promise.all([api('GET', '/api/super/nas'), api('GET', '/api/super/nas/users').catch((e) => ({ ready: false, users: [], info: { error: e.message } }))]); show(tabs, head('NAS'), nasCards(n), usersCard(u)); if (n.measuring) setTimeout(() => { if (location.hash === '#nas') load(true); }, 8000); }
      else { const o = await api('GET', '/api/super/overview'); show(tabs, head('RegemarkFP overview'), healthCard(o.health), companiesCard(o.companies)); }
    } catch (e) { if (!quiet) show(tabs, el('div', { class: 'card bad' }, e.message)); }
    if (quiet) window.scrollTo(0, y);
    later();
  }
  fetch('/api/config').then((r) => r.json()).then((c) => { if (c.copyright) $('foot').textContent = c.copyright; }).catch(() => {});
  load();
})();
