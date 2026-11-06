/* The superuser page (analytics.<website> or /super): sign in, set the password from the emailed link, and see the
 * website's health and every production company. Only Admins who accepted the terms are named. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === null || v === undefined || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  };
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  }
  const show = (...kids) => $('main').replaceChildren(...kids);
  const bytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(0) + ' MB');
  const dur = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const yes = (b, on = 'On', off = 'Off') => el('span', { class: b ? 'ok' : 'bad' }, b ? on : off);

  const setToken = new URLSearchParams(location.search).get('set');

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
    const filter = el('input', { type: 'search', placeholder: 'Filter companies', style: 'max-width:280px;margin:0' });
    const body = el('tbody');
    const paint = () => {
      const q = filter.value.trim().toLowerCase();
      body.replaceChildren(...list.filter((c) => !q || c.name.toLowerCase().includes(q)).map((c) => el('tr', {},
        el('td', {}, el('b', {}, c.name), el('div', {}, Object.entries(c.roles).map(([r, n]) => el('span', { class: 'pill' }, `${n} ${r}`)))),
        el('td', { class: 'n' }, String(c.users)),
        el('td', {}, c.admins.length ? c.admins.map((a) => el('div', { class: 'small' }, a.hidden ? el('span', { class: 'dim' }, 'Admin (has not accepted the terms yet)') : [a.name || '(no name)', ' · ', el('a', { href: 'mailto:' + a.email }, a.email), a.marketing ? '' : el('span', { class: 'dim' }, ' · no marketing')])) : el('span', { class: 'dim small' }, 'No Admin')),
        el('td', { class: 'n' }, `${c.productions}`, el('div', { class: 'dim small' }, `${c.productions30} in 30 days`)),
        el('td', { class: 'n' }, String(c.matches)),
        el('td', { class: 'n' }, String(c.bookings)),
        el('td', { class: 'n' }, `${c.clients} / ${c.invoices}`),
        el('td', { class: 'n' }, String(c.viewers30), el('div', { class: 'dim small' }, `${c.watchHours30} h watched`)))));
    };
    filter.addEventListener('input', paint); paint();
    return el('div', { class: 'card' },
      el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, el('h2', { style: 'margin:0' }, `Production companies (${list.length})`), filter,
        el('a', { class: 'btn ghost', href: '/api/super/contacts.csv' }, 'Admin emails (CSV)')),
      el('p', { class: 'small dim', style: 'margin-top:0' }, `${tot.users} users · ${tot.productions} productions · ${tot.viewers} viewers in the last 30 days. Only Admins who accepted the terms are named; nobody else is.`),
      el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Company'), el('th', { class: 'n' }, 'Users'), el('th', {}, 'Admins'), el('th', { class: 'n' }, 'Productions'), el('th', { class: 'n' }, 'Matches'), el('th', { class: 'n' }, 'Bookings'), el('th', { class: 'n' }, 'Clients / docs'), el('th', { class: 'n' }, 'Viewers 30d'))), body)));
  }

  async function load() {
    if (setToken) return setForm();
    const me = await api('GET', '/api/super/me').catch(() => ({}));
    if (!me.email) { $('who').replaceChildren(); return loginForm(); }
    $('who').replaceChildren(me.email + ' · ', el('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/super/logout'); load(); } }, 'Sign out'));
    try {
      const o = await api('GET', '/api/super/overview');
      show(el('div', { class: 'row', style: 'justify-content:space-between' }, el('h1', {}, 'RegemarkFP overview'), el('button', { class: 'ghost', onclick: load }, 'Refresh')), healthCard(o.health), companiesCard(o.companies));
    } catch (e) { show(el('div', { class: 'card bad' }, e.message)); }
  }
  load();
})();
