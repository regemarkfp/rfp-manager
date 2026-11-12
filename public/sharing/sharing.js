/* Sharing (sharing.regemarkfp.com, or /sharing on the website): shared folders of a production or event.
 * Pages: / (my folders) · /f/<id>/<path…> (a folder) · /invite/<token> (an email invite).
 * Uploads go in 32 MB pieces and carry on after a dropped connection (drop the same file again after a refresh). */
'use strict';
(() => {
  const BASE = location.pathname.startsWith('/sharing') ? '/sharing' : '';
  const $ = (id) => document.getElementById(id);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
  async function api(method, url, body, opts = {}) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'x-rfp': '1', ...(body !== undefined && !(body instanceof Blob) ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body), signal: opts.signal });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 202) throw Object.assign(new Error(j.error || 'Something went wrong (' + r.status + ')'), { status: r.status });
    return Object.assign(j, { _status: r.status });
  }
  function toast(text, kind) { const t = h('div', { class: 'toast' + (kind === 'error' ? ' error' : '') }, text); $('toasts').append(t); setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000); }
  const oops = (e) => toast(e.message || String(e), 'error');
  const size = (n) => (n < 1024 ? n + ' B' : n < 1024 ** 2 ? (n / 1024).toFixed(0) + ' KB' : n < 1024 ** 3 ? (n / 1024 ** 2).toFixed(1) + ' MB' : (n / 1024 ** 3).toFixed(2) + ' GB');
  const when = (t) => { const d = new Date(t), now = Date.now(); return now - t < 60e3 ? 'just now' : now - t < 3600e3 ? Math.floor((now - t) / 60e3) + ' min ago' : d.toDateString() === new Date().toDateString() ? d.toTimeString().slice(0, 5) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: now - t > 300 * 864e5 ? 'numeric' : undefined }); };
  const tcText = (s) => { s = Math.max(0, Number(s) || 0); const m = Math.floor(s / 60), x = Math.floor(s % 60); return `${Math.floor(m / 60) ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : m}:${String(x).padStart(2, '0')}`; };
  const enc = encodeURIComponent;
  const go = (url) => { history.pushState(null, '', BASE + url); route(); };
  addEventListener('popstate', () => route());
  $('home').href = BASE + '/'; $('home').onclick = (e) => { e.preventDefault(); go('/'); };

  let ME = null, CFG = {};
  async function whoami() { try { ME = (await api('GET', '/api/me')).user || null; } catch { ME = null; } paintMe(); return ME; }
  function paintMe() {
    fill($('me'), ME ? h('span', { class: 'dim' }, ME.name || ME.email) : null,
      ME ? h('button', { class: 'sm ghost', onclick: async () => { await api('POST', '/api/auth/logout', {}).catch(() => {}); ME = null; paintMe(); go('/'); } }, 'Sign out') : null);
  }

  // ---------------------------------------------------------------- signing in (Google or password)
  let gsi = null;
  const loadGsi = () => gsi || (gsi = new Promise((ok, no) => { const s = h('script', { src: 'https://accounts.google.com/gsi/client', async: true }); s.onload = ok; s.onerror = () => no(new Error('Google sign-in could not load')); document.head.append(s); }));
  function signInBox({ email = '', title = 'Sign in', note = '', done }) {
    const err = h('p', { class: 'err small' }), gbox = h('div', { style: { minHeight: '44px', display: 'flex', justifyContent: 'center' } });
    const em = h('input', { type: 'email', value: email, placeholder: 'Email', autocomplete: 'email', readonly: email ? true : null }), pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    const login = async () => { err.textContent = ''; try { await api('POST', '/api/auth/login', { email: em.value.trim(), password: pw.value }); await whoami(); done(); } catch (e) { err.textContent = e.message; } };
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    if (CFG.googleClientId) loadGsi().then(() => {
      google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: async (r) => { try { await api('POST', '/api/auth/google', { credential: r.credential }); await whoami(); done(); } catch (e) { err.textContent = e.message; } } });
      google.accounts.id.renderButton(gbox, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 300 });
    }).catch((e) => { gbox.textContent = e.message; });
    return h('div', { class: 'card narrow' }, h('h1', {}, title), note ? h('p', { class: 'dim' }, note) : null,
      CFG.googleClientId ? [gbox, h('div', { class: 'or' }, 'or with a password')] : null,
      h('label', { class: 'f' }, h('span', {}, 'Email'), em), h('label', { class: 'f' }, h('span', {}, 'Password'), pw), err,
      h('button', { class: 'primary', onclick: login }, 'Sign in'));
  }

  // ---------------------------------------------------------------- pages
  async function route() {
    const p = location.pathname.slice(BASE.length) || '/';
    stopPolls();
    $('prod').textContent = ''; document.title = 'File Sharing · RegemarkFP';
    let m;
    if ((m = /^\/invite\/([\w-]+)\/?$/.exec(p))) return invitePage(m[1]);
    if (!ME) await whoami();
    if (!ME) { fill($('main'), signInBox({ note: 'Shared folders of RegemarkFP productions. Sign in with the email you were invited with.', done: () => route() })); return; }
    if ((m = /^\/p\/([\w-]+)\/([\w-]+)\/?$/.exec(p))) {   // a production's folder (from the Studio on a production PC)
      try { const r = await api('POST', `/api/share/production/${enc(m[2])}?team=${enc(m[1])}`, {}); history.replaceState(null, '', BASE + '/f/' + r.id + '/'); return route(); } catch (e) { fill($('main'), h('div', { class: 'card narrow' }, h('h1', {}, 'Shared folder'), h('p', {}, e.message))); return; }
    }
    if ((m = /^\/f\/([\w-]+)\/?(.*)$/.exec(p))) return folderPage(m[1], m[2].split('/').filter(Boolean).map(decodeURIComponent).join('/'));
    return homePage();
  }

  async function invitePage(token) {
    const main = $('main');
    fill(main, h('p', { class: 'dim' }, 'Opening your invite…'));
    let v; try { v = await api('GET', '/api/sharing/invite/' + enc(token)); } catch (e) { fill(main, h('div', { class: 'card narrow' }, h('h1', {}, 'Invite'), h('p', {}, e.message))); return; }
    if (!ME) await whoami();
    const open = () => go('/f/' + v.id + '/');
    if (ME && ME.email.toLowerCase() === v.email) return open();
    const intro = `${v.invitedBy} invited ${v.email} to “${v.name}” as ${v.role === 'editor' ? 'an editor (see, download and upload)' : 'a viewer (see and download)'}.`;
    if (ME) { fill(main, h('div', { class: 'card narrow' }, h('h1', {}, v.name), h('p', {}, intro), h('p', { class: 'err' }, `You are signed in as ${ME.email}. Sign out and sign in as ${v.email}.`), h('button', { onclick: async () => { await api('POST', '/api/auth/logout', {}); ME = null; paintMe(); invitePage(token); } }, 'Sign out'))); return; }
    if (v.account) { fill(main, signInBox({ email: v.email, title: v.name, note: intro + (v.account.google && !v.account.password ? ' Use Sign in with Google.' : ''), done: open })); return; }
    // no account yet: Google, or a new password for that email
    const nm = h('input', { placeholder: 'Your name', autocomplete: 'name' }), pw = h('input', { type: 'password', placeholder: 'At least 8 characters', autocomplete: 'new-password' }), err = h('p', { class: 'err small' });
    const make = async () => { err.textContent = ''; try { await api('POST', '/api/sharing/invite/' + enc(token) + '/password', { name: nm.value, password: pw.value }); await whoami(); open(); } catch (e) { err.textContent = e.message; } };
    const box = signInBox({ email: v.email, title: v.name, note: intro, done: open });
    box.querySelectorAll('label.f, button.primary').forEach((x) => x.remove());
    const orEl = box.querySelector('.or'); if (orEl) orEl.textContent = 'or make a password';
    box.append(h('label', { class: 'f' }, h('span', {}, 'Email'), h('input', { value: v.email, readonly: true })), h('label', { class: 'f' }, h('span', {}, 'Your name'), nm), h('label', { class: 'f' }, h('span', {}, 'Choose a password'), pw), err, h('button', { class: 'primary', onclick: make }, 'Open the folder'));
    fill(main, box);
  }

  // ---------------------------------------------------------------- the upload panel (left, like WeTransfer)
  // A big + for files or a folder (or drop them anywhere on the page), where they go, people to tag, a message, Upload.
  // When it is done the tagged people get an email and a notification, and you get a receipt (POST …/transfer).
  //   targets: the folders you can upload to [{ id, name }]; fixed: { id, dir } on a folder's own page
  let PANEL = null;
  function xferPanel({ targets, fixed, after }) {
    const st = { files: [], target: fixed ? fixed.id : (targets[0] || {}).id || '', sub: '', tags: new Set(), message: '', phase: 'pick', batch: null, people: [], peopleFor: '' };
    const box = h('div', { class: 'xfer card' });
    const pickFiles = (dir) => { const i = h('input', { type: 'file', multiple: true, webkitdirectory: dir ? true : null, style: { display: 'none' } }); i.onchange = () => { add([...i.files].map((f) => ({ file: f, rel: dir ? (f.webkitRelativePath || f.name).split('/').slice(0, -1).join('/') : '' }))); i.remove(); }; document.body.append(i); i.click(); };
    const add = (list) => { if (st.phase !== 'pick') { if (st.phase === 'done') reset(); else return; } const have = new Set(st.files.map((x) => x.rel + '/' + x.file.name + ':' + x.file.size)); for (const x of list) { const k = x.rel + '/' + x.file.name + ':' + x.file.size; if (!have.has(k)) { st.files.push(x); have.add(k); } } paint(); };
    const reset = () => { st.files = []; st.tags.clear(); st.message = ''; st.sub = ''; st.phase = 'pick'; st.batch = null; paint(); };
    async function loadPeople() {
      if (!st.target || st.peopleFor === st.target) return;
      st.peopleFor = st.target;
      try { st.people = (await api('GET', `/api/share/${enc(st.target)}/taggable`)).people; } catch { st.people = []; }
      if (st.phase === 'pick') paint();
    }
    const plus = () => {
      const menu = h('div', { class: 'plus-menu', hidden: true }, h('button', { onclick: (e) => { e.stopPropagation(); menu.hidden = true; pickFiles(false); } }, 'Files'), h('button', { onclick: (e) => { e.stopPropagation(); menu.hidden = true; pickFiles(true); } }, 'A folder'));
      document.addEventListener('click', () => { menu.hidden = true; });
      return h('div', { class: 'plus-wrap' }, h('button', { class: 'plus', title: 'Add files or a folder', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, '+'), menu);
    };
    function paint() {
      const total = st.files.reduce((n, x) => n + x.file.size, 0);
      if (st.phase === 'sending' || st.phase === 'done') {
        const b = st.batch, all = b.jobs.reduce((n, j) => n + j.file.size, 0), sent = b.jobs.reduce((n, j) => n + (j.state === 'done' ? j.file.size : j.sent), 0);
        const ok = b.jobs.filter((j) => j.state === 'done').length, bad = b.jobs.filter((j) => j.state === 'error');
        const f = all ? sent / all : ok / (b.jobs.length || 1);
        const t = targets.find((x) => x.id === b.target) || fixed || {};
        const pct = st.phase === 'done' ? 100 : Math.floor(f * 100);
        fill(box, h('div', { class: 'prog' + (st.phase === 'done' ? (bad.length ? ' bad' : ' done') : '') }, h('div', { class: 'prog-num' }, st.phase === 'done' ? (bad.length ? '!' : '✓') : pct + '%'),
          h('div', { class: 'prog-bar' }, h('i', { style: { width: pct + '%' } }))),
          st.phase === 'sending' ? [h('h2', { class: 'ctr' }, 'Uploading…'), h('p', { class: 'dim ctr' }, `${ok} of ${b.jobs.length} files · ${size(sent)} of ${size(all)}`), h('p', { class: 'dim small ctr' }, 'Keep this page open. A dropped connection carries on by itself.')]
            : [h('h2', { class: 'ctr' }, bad.length ? 'Uploaded, with problems' : 'Upload complete'), h('p', { class: 'ctr' }, `${ok} file${ok === 1 ? '' : 's'} in ${t.name || 'the folder'}${b.dir ? ' / ' + b.dir : ''}.`),
              b.tagged ? h('p', { class: 'dim small ctr' }, b.tagged) : null, bad.length ? h('div', { class: 'err small' }, bad.slice(0, 5).map((j) => h('div', {}, `${j.file.name}: ${j.err}`))) : null,
              h('div', { class: 'col' }, h('button', { class: 'primary', onclick: reset }, 'Send more'), h('a', { class: 'btn', href: BASE + '/f/' + b.target + '/' + (b.dir ? b.dir.split('/').map(enc).join('/') : ''), onclick: (e) => { e.preventDefault(); go('/f/' + b.target + '/' + (b.dir ? b.dir.split('/').map(enc).join('/') : '')); } }, 'Open the folder'))]);
        return;
      }
      loadPeople();
      const tagIn = h('input', { placeholder: st.people.length ? 'Type a name or email' : 'Nobody to tag in this folder yet', list: 'xfer-people', disabled: !st.people.length || null,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); takeTag(e.target.value); } }, onchange: (e) => takeTag(e.target.value) });
      const takeTag = (v) => { v = String(v || '').trim().toLowerCase(); const p = st.people.find((x) => x.email === v || (x.name && x.name.toLowerCase() === v) || ((x.name ? x.name + ' <' + x.email + '>' : x.email).toLowerCase() === v)); if (p) { st.tags.add(p.email); paint(); setTimeout(() => { const i = box.querySelector('.tags input'); if (i) i.focus(); }, 0); } else if (v) toast('Only people invited to this folder (or its producers) can be tagged', 'error'); };
      const nameOf = (e) => { const p = st.people.find((x) => x.email === e); return p && p.name ? p.name : e; };
      fill(box,
        st.files.length ? null : [h('div', { class: 'plus-big' }, plus()), h('h2', { class: 'ctr' }, 'Add files'), h('p', { class: 'dim small ctr' }, 'or a whole folder · or drop them anywhere on this page')],
        st.files.length ? [h('div', { class: 'xf-head' }, plus(), h('div', {}, h('b', {}, `${st.files.length} file${st.files.length === 1 ? '' : 's'}`), h('div', { class: 'dim small' }, size(total))), h('span', { class: 'grow' }), h('button', { class: 'sm ghost', onclick: () => { st.files = []; paint(); } }, 'Clear')),
          h('div', { class: 'xf-list' }, st.files.slice(0, 300).map((x, i) => h('div', { class: 'xf' }, h('span', { class: 'nm', title: (x.rel ? x.rel + '/' : '') + x.file.name }, (x.rel ? x.rel + '/' : '') + x.file.name), h('span', { class: 'dim small nowrap' }, size(x.file.size)), h('button', { class: 'x', title: 'Take it out', onclick: () => { st.files.splice(i, 1); paint(); } }, '✕'))),
            st.files.length > 300 ? h('div', { class: 'dim small' }, `… and ${st.files.length - 300} more`) : null)] : null,
        fixed ? h('div', { class: 'f' }, h('span', {}, 'To'), h('div', { class: 'to-fixed' }, fixed.name + (fixed.dir ? ' / ' + fixed.dir : '')))
          : h('label', { class: 'f' }, h('span', {}, 'To'), targets.length ? h('select', { onchange: (e) => { st.target = e.target.value; st.tags.clear(); paint(); } }, targets.map((t) => h('option', { value: t.id, selected: t.id === st.target }, t.name + (t.productionName && t.productionName !== t.name ? ' · ' + t.productionName : ''))))
            : h('div', { class: 'dim small' }, 'You cannot upload to any folder yet.')),
        h('label', { class: 'f' }, h('span', {}, 'Into a new folder (optional)'), h('input', { value: st.sub, placeholder: 'Day 1, Camera A, Photos …', oninput: (e) => { st.sub = e.target.value; } })),
        h('div', { class: 'f tags' }, h('span', {}, 'Tag people (they get an email and a notification)'),
          h('div', { class: 'chips' }, [...st.tags].map((e) => h('span', { class: 'chip' }, nameOf(e), h('button', { title: 'Untag', onclick: () => { st.tags.delete(e); paint(); } }, '✕'))), tagIn),
          h('datalist', { id: 'xfer-people' }, st.people.filter((p) => !st.tags.has(p.email)).map((p) => h('option', { value: p.email }, p.name ? `${p.name} (${p.role === 'manager' ? 'producer' : p.role})` : p.role)))),
        h('label', { class: 'f' }, h('span', {}, 'Message (optional)'), h('textarea', { rows: 2, placeholder: 'The interviews from Saturday …', oninput: (e) => { st.message = e.target.value; } }, st.message)),
        h('button', { class: 'primary big', disabled: !st.files.length || !st.target || null, onclick: start }, st.files.length ? `Upload ${st.files.length} file${st.files.length === 1 ? '' : 's'}` : 'Upload'));
    }
    function start() {
      if (!st.files.length || !st.target) return;
      let sub; try { sub = st.sub.split('/').map((x) => x.trim()).filter(Boolean).join('/'); } catch { sub = ''; }
      const dir = [fixed ? fixed.dir : '', sub].filter(Boolean).join('/');
      const b = { jobs: [], target: st.target, dir, tagged: '', onProgress: () => { clearTimeout(b.t); b.t = setTimeout(paint, 150); }, onEnd: async () => {
        const done = b.jobs.filter((j) => j.state === 'done');
        if (done.length) {
          try {
            const r = await api('POST', `/api/share/${enc(b.target)}/transfer`, { dir, files: done.map((j) => ({ path: j.path, size: j.file.size })), tags: [...st.tags], message: st.message });
            b.tagged = st.tags.size ? `${st.tags.size} tagged ${st.tags.size === 1 ? 'person was' : 'people were'} told${r.mailed ? ' by email' : ''}. A receipt is on its way to you.` : 'A receipt is on its way to you.';
          } catch (e) { b.tagged = 'The files are in, but telling people failed: ' + e.message; }
        }
        st.phase = 'done'; paint(); if (after) after();
      } };
      st.batch = b; st.phase = 'sending'; paint();
      upload(st.target, dir, st.files.slice(), null, b);
    }
    paint();
    PANEL = { el: box, add, pick: pickFiles };
    return PANEL;
  }
  // drop files anywhere: they go into the panel
  addEventListener('dragover', (e) => { if (PANEL && PANEL.el.isConnected && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  addEventListener('drop', async (e) => { document.body.classList.remove('dropping'); if (!PANEL || !PANEL.el.isConnected) return; e.preventDefault(); const got = await dropped(e.dataTransfer); if (got.length) PANEL.add(got); });

  // previous transfers: what you sent, and what was sent to you
  function transferList(list, { compact } = {}) {
    if (!list.length) return h('div', { class: 'empty' }, 'No transfers yet. Files sent with the upload panel show here.');
    return h('div', { class: 'txs' }, list.map((t) => {
      const path = '/f/' + t.share + '/' + (t.dir ? t.dir.split('/').map(enc).join('/') : '');
      return h('a', { class: 'tx' + (t.forMe ? ' for-me' : ''), href: BASE + path, onclick: (e) => { e.preventDefault(); go(path); } },
        h('div', { class: 'tx-ico' }, t.count > 99 ? '99+' : t.count),
        h('div', { class: 'tx-main' }, h('div', {}, h('b', {}, t.mine ? 'You' : t.name), t.mine ? ' sent ' : t.forMe ? ' sent you ' : ' uploaded ', h('b', {}, `${t.count} file${t.count === 1 ? '' : 's'}`), ` (${size(t.size)})`),
          compact ? null : h('div', { class: 'dim small' }, 'to ', h('span', { class: 'ok' }, t.shareName + (t.dir ? ' / ' + t.dir : ''))),
          t.message ? h('div', { class: 'small msg' }, '“' + t.message + '”') : null,
          t.tags && t.tags.length ? h('div', { class: 'dim small' }, 'Tagged: ' + t.tags.join(', ')) : null,
          h('div', { class: 'dim small' }, t.files.slice(0, 3).map((f) => f.path.split('/').pop()).join(', ') + (t.count > 3 ? ` … +${t.count - 3}` : ''))),
        h('div', { class: 'dim small nowrap' }, when(t.at)));
    }));
  }

  async function homePage() {
    const main = $('main');
    let r, tx; try { [r, tx] = await Promise.all([api('GET', '/api/share'), api('GET', '/api/share-transfers').catch(() => ({ transfers: [] }))]); } catch (e) { fill(main, h('div', { class: 'card' }, e.message)); return; }
    const byTeam = new Map();
    for (const s of r.shares) { if (!byTeam.has(s.teamName)) byTeam.set(s.teamName, []); byTeam.get(s.teamName).push(s); }
    const newBtn = r.canCreate.length ? h('button', { class: 'sm primary', onclick: () => {
      const team = h('select', {}, r.teams.map((t) => h('option', { value: t.id }, t.name))), name = h('input', { placeholder: 'Cup final 2026, Wedding Smith …' }), err = h('p', { class: 'err small' });
      const box = sidePanel('New shared folder', h('div', {}, r.teams.length > 1 ? h('label', { class: 'f' }, h('span', {}, 'Production team'), team) : null, h('label', { class: 'f' }, h('span', {}, 'Name'), name), err,
        h('p', { class: 'dim small' }, 'A production\'s own folder: open the production in the Studio and press Shared folder.'),
        h('button', { class: 'primary', onclick: async () => { try { const s = await api('POST', '/api/share', { team: team.value || r.teams[0].id, name: name.value }); box.remove(); go('/f/' + s.id + '/'); } catch (e) { err.textContent = e.message; } } }, 'Make the folder')));
      setTimeout(() => name.focus(), 50);
    } }, '+ New folder') : null;
    const targets = r.shares.filter((s) => s.role !== 'viewer');
    let tab = (() => { try { return sessionStorage.getItem('rfp-share-tab') || 'folders'; } catch { return 'folders'; } })();
    let txWho = '';
    const right = h('div', { class: 'right' });
    const folders = () => (r.shares.length ? [...byTeam].map(([team, list]) => [byTeam.size > 1 ? h('h3', { class: 'team' }, team || 'Folders') : null, h('div', { class: 'grid-shares' }, list.map((s) => h('a', { class: 'share', href: BASE + '/f/' + s.id + '/', onclick: (e) => { e.preventDefault(); go('/f/' + s.id + '/'); } },
        h('b', {}, s.name), h('span', { class: 'pill ' + s.role }, s.role === 'manager' ? 'Manage' : s.role === 'editor' ? 'Can upload' : 'Can view'), s.members ? h('span', { class: 'dim', style: { marginLeft: '8px' } }, `${s.members.length} invited`) : null, s.productionName && s.productionName !== s.name ? h('div', { class: 'dim small', style: { marginTop: '6px' } }, s.productionName) : null, s.expires ? h('div', { class: 'small', style: { marginTop: '6px', color: 'var(--warn)' } }, 'Removed on ' + s.expires) : null)))])
      : h('div', { class: 'card empty' }, r.canCreate.length ? 'No shared folders yet. Make one, or open a production in the Studio and press Shared folder.' : 'Nothing has been shared with you yet. When the production team invites you, the folder shows here.'));
    const paintRight = () => {
      try { sessionStorage.setItem('rfp-share-tab', tab); } catch { /* fine */ }
      const list = tx.transfers.filter((t) => !txWho || (txWho === 'me' ? t.mine : t.forMe));
      fill(right, h('div', { class: 'spread', style: { marginBottom: '12px' } }, h('div', { class: 'tabs2' }, h('button', { class: tab === 'folders' ? 'on' : '', onclick: () => { tab = 'folders'; paintRight(); } }, `Folders (${r.shares.length})`),
        h('button', { class: tab === 'transfers' ? 'on' : '', onclick: () => { tab = 'transfers'; paintRight(); } }, `Previous transfers (${tx.transfers.length})`)),
        tab === 'folders' ? newBtn : h('select', { class: 'sm-sel', onchange: (e) => { txWho = e.target.value; paintRight(); } }, [['', 'Everything'], ['me', 'Sent by me'], ['to', 'Sent to me']].map(([v, t]) => h('option', { value: v, selected: v === txWho }, t)))),
        tab === 'folders' ? folders() : transferList(list));
    };
    paintRight();
    fill(main, h('div', { class: targets.length ? 'two' : '' }, targets.length ? xferPanel({ targets, after: async () => { try { tx = await api('GET', '/api/share-transfers'); paintRight(); } catch { /* later */ } } }).el : null, right));
  }

  // ---------------------------------------------------------------- a folder
  let polls = [];
  const stopPolls = () => { polls.forEach(clearTimeout); polls = []; };
  let viewMode = (() => { try { return localStorage.getItem('rfp-share-view') || 'list'; } catch { return 'list'; } })();
  async function folderPage(id, rel, opts = {}) {
    const main = $('main');
    let r; try { r = await api('GET', `/api/share/${enc(id)}/list?path=${enc(rel)}`); } catch (e) { fill(main, h('div', { class: 'card narrow' }, h('h1', {}, 'Shared folder'), h('p', {}, e.message), h('a', { href: BASE + '/' }, '← My folders'))); return; }
    const s = r.share, canEdit = s.role !== 'viewer', sel = new Set();
    $('prod').textContent = s.productionName || ''; $('prod').title = s.productionName ? 'Production: ' + s.productionName : '';
    document.title = s.name + ' · File Sharing';
    const url = (p) => '/f/' + id + '/' + (p ? p.split('/').map(enc).join('/') : '');
    const parts = rel ? rel.split('/') : [];
    const crumbs = h('div', { class: 'crumbs' }, h('a', { href: BASE + '/', onclick: (e) => { e.preventDefault(); go('/'); } }, 'My folders'), h('i', {}, '›'),
      h('a', { href: BASE + url(''), onclick: (e) => { e.preventDefault(); go(url('')); } }, s.name),
      parts.map((x, i) => { const p = parts.slice(0, i + 1).join('/'); return [h('i', {}, '›'), h('a', { href: BASE + url(p), onclick: (e) => { e.preventDefault(); go(url(p)); } }, x)]; }));
    const reload = () => folderPage(id, rel, { keepPanel: true });
    const selBar = h('span', { class: 'dim small' });
    const files = r.items.filter((x) => !x.dir);
    const paintSel = () => { selBar.textContent = sel.size ? `${sel.size} selected` : ''; dlSel.hidden = !sel.size; delSel.hidden = !sel.size || !canEdit; body.querySelectorAll('[data-p]').forEach((el) => el.classList.toggle('sel', sel.has(el.dataset.p))); };
    const zipUrl = (paths) => `/api/share/${enc(id)}/zip?` + paths.map((p) => 'p=' + enc(p)).join('&');
    const dlSel = h('a', { class: 'btn sm', hidden: true, onclick: (e) => { e.currentTarget.href = zipUrl([...sel]); } }, '⬇ Download selected');
    const delSel = h('button', { class: 'sm danger', hidden: true, onclick: async () => { if (!confirm(`Delete ${sel.size} item${sel.size > 1 ? 's' : ''}? Deleted files are kept on the server for 30 days.`)) return; try { await api('POST', `/api/share/${enc(id)}/delete`, { paths: [...sel] }); toast('Deleted'); reload(); } catch (e) { oops(e); } } }, 'Delete');
    const pick = (multiple, dir) => { const i = h('input', { type: 'file', multiple: true, webkitdirectory: dir ? true : null, style: { display: 'none' } }); i.onchange = () => { upload(id, rel, [...i.files].map((f) => ({ file: f, rel: dir ? (f.webkitRelativePath || f.name).split('/').slice(0, -1).join('/') : '' })), reload); i.remove(); }; document.body.append(i); i.click(); };
    const toolbar = h('div', { class: 'toolbar' },
      canEdit ? [h('button', { class: 'sm', onclick: () => (PANEL ? PANEL.pick(false) : pick(true, false)) }, '⬆ Files'), h('button', { class: 'sm', onclick: () => (PANEL ? PANEL.pick(true) : pick(true, true)) }, '⬆ Folder'),
        h('button', { class: 'sm', onclick: async () => { const n = prompt('Name of the new folder'); if (!n) return; try { await api('POST', `/api/share/${enc(id)}/folder`, { path: (rel ? rel + '/' : '') + n }); reload(); } catch (e) { oops(e); } } }, '+ Folder')] : null,
      h('a', { class: 'btn sm', href: zipUrl([rel]), title: 'Everything in this folder as one ZIP' }, '⬇ Download all'), dlSel, delSel, selBar, h('span', { class: 'grow' }),
      h('button', { class: 'sm ghost', title: 'List or tiles', onclick: () => { viewMode = viewMode === 'list' ? 'tiles' : 'list'; try { localStorage.setItem('rfp-share-view', viewMode); } catch { /* fine */ } reload(); } }, viewMode === 'list' ? '▦ Tiles' : '☰ List'),
      h('button', { class: 'sm', onclick: () => transfersPanel(id) }, 'Transfers'),
      h('button', { class: 'sm', onclick: () => activityPanel(id) }, 'Activity'),
      h('button', { class: 'sm', onclick: () => peoplePanel(id, s, reload) }, s.role === 'manager' ? `People (${(s.members || []).length})` : 'Emails'));
    // previews in the list and the tiles: photos and video stills (ffmpeg on the server, or the browser itself for
    // mp4 / webm / mov), the first lines of text files, a page icon for PDFs; the file type when there is nothing to show
    const WEBV = /\.(mp4|m4v|webm|mov)$/i;
    const thumbOf = (x) => {
      const ext = (x.name.split('.').pop() || '').toUpperCase().slice(0, 5);
      const t = h('div', { class: 'thumb' + (x.dir ? ' folder' : '') + ' k-' + x.kind }, h('span', { class: 'tlabel' }, x.dir ? 'FOLDER' : ext));
      if (x.dir) return t;
      const fileUrl = `/api/share/${enc(id)}/file?path=${enc(x.path)}&download=0`;
      const asVideo = () => { if (!WEBV.test(x.name)) return; const v = h('video', { src: fileUrl + '#t=1', muted: true, preload: 'metadata', playsinline: true }); v.muted = true; v.addEventListener('loadeddata', () => t.classList.add('has'), { once: true }); v.addEventListener('error', () => v.remove(), { once: true }); t.prepend(v); };
      if (x.kind === 'image' || (x.kind === 'video' && r.ffmpeg)) {
        const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src: `/api/share/${enc(id)}/thumb?path=${enc(x.path)}` });
        img.addEventListener('load', () => t.classList.add('has'), { once: true });
        img.addEventListener('error', () => { img.remove(); if (x.kind === 'video') asVideo(); }, { once: true });
        t.prepend(img);
      } else if (x.kind === 'video') asVideo();
      else if (x.kind === 'text' && x.size > 0 && viewMode === 'tiles') {
        fetch(fileUrl, { credentials: 'same-origin', headers: { range: 'bytes=0-599' } }).then((res) => (res.ok ? res.text() : '')).then((txt) => { if (txt) { t.prepend(h('pre', { class: 'tsnip' }, txt.slice(0, 600))); t.classList.add('has', 'text'); } }).catch(() => {});
      }
      return t;
    };
    const openItem = (x) => (x.dir ? go(url(x.path)) : preview(id, files, files.indexOf(x), s, reload));
    const tick = (x) => h('input', { type: 'checkbox', checked: sel.has(x.path), onclick: (e) => e.stopPropagation(), onchange: (e) => { if (e.target.checked) sel.add(x.path); else sel.delete(x.path); paintSel(); } });
    const rowMenu = (x) => canEdit ? h('button', { class: 'menu-btn', title: 'Rename or move', onclick: async (e) => {
      e.stopPropagation();
      const to = prompt('New name, or a path to move it (Day 2/' + x.name + ')', x.name);
      if (!to || to === x.name) return;
      try { await api('POST', `/api/share/${enc(id)}/move`, to.includes('/') ? { from: x.path, to } : { from: x.path, name: to }); reload(); } catch (err) { oops(err); }
    } }, '⋯') : null;
    let list;
    if (!r.items.length) list = h('div', { class: 'empty' }, canEdit ? 'This folder is empty. Drag files or whole folders here, or press Upload.' : 'This folder is empty.');
    else if (viewMode === 'tiles') list = h('div', { class: 'tiles' }, r.items.map((x) => h('div', { class: 'tile', 'data-p': x.path, onclick: () => openItem(x) }, thumbOf(x), tick(x), h('div', { class: 'nm', title: x.name }, x.name, x.comments ? h('span', { class: 'cm' }, ` 💬${x.comments}`) : null))));
    else list = h('table', { class: 'files' }, h('thead', {}, h('tr', {}, h('th', { style: { width: '28px' } }, h('input', { type: 'checkbox', title: 'Select all', onchange: (e) => { r.items.forEach((x) => (e.target.checked ? sel.add(x.path) : sel.delete(x.path))); body.querySelectorAll('td input[type=checkbox]').forEach((c) => { c.checked = e.target.checked; }); paintSel(); } })), h('th', {}, 'Name'), h('th', { class: 'r' }, 'Size'), h('th', { class: 'hide-sm' }, 'Added by'), h('th', { class: 'hide-sm' }, 'Changed'), h('th', {}))),
      h('tbody', {}, r.items.map((x) => h('tr', { 'data-p': x.path }, h('td', {}, tick(x)), h('td', {}, h('div', { class: 'fname', onclick: () => openItem(x) }, thumbOf(x), h('span', {}, x.name), x.comments ? h('span', { class: 'cm' }, '💬 ' + x.comments) : null)),
        h('td', { class: 'r nowrap dim' }, x.dir ? '' : size(x.size)), h('td', { class: 'hide-sm dim small' }, x.by || ''), h('td', { class: 'hide-sm dim small nowrap' }, when(x.mtime)), h('td', { class: 'r' }, rowMenu(x))))));
    const body = h('div', { class: 'drop' }, list);
    const key = id + '|' + rel;
    const panel = !canEdit ? null : opts.keepPanel && PANEL && PANEL.key === key ? PANEL : Object.assign(xferPanel({ targets: [], fixed: { id, name: s.name, dir: rel }, after: reload }), { key });
    if (!panel) PANEL = null;
    const right = h('div', { class: 'right' });
    fill(main, h('div', { class: panel ? 'two' : '' }, panel ? panel.el : null, right));
    fill(right, h('div', { class: 'spread' }, h('div', {}, crumbs), h('span', { class: 'pill ' + s.role }, s.role === 'manager' ? 'You manage this folder' : s.role === 'editor' ? 'You can upload' : 'You can view and download')),
      s.expires ? h('div', { class: 'expiry' + ((Date.parse(s.expires) - Date.now()) < 4 * 864e5 ? ' soon' : '') }, `This folder and its files are removed from the server on ${new Date(s.expires + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Download what you want to keep before then.`) : null,
      toolbar, body, r.free != null && canEdit ? h('p', { class: 'dim small', style: { marginTop: '14px' } }, `${size(r.free)} free on the server.`) : null);
    paintSel();
  }
  // files and folders dropped on the page (folders are walked)
  async function dropped(dt) {
    const out = [], items = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!items.length) return [...(dt.files || [])].map((f) => ({ file: f, rel: '' }));
    const walk = async (entry, dir) => {
      if (entry.isFile) { const f = await new Promise((ok, no) => entry.file(ok, no)); out.push({ file: f, rel: dir }); return; }
      const reader = entry.createReader(); let batch;
      do { batch = await new Promise((ok, no) => reader.readEntries(ok, no)); for (const e of batch) await walk(e, dir ? dir + '/' + entry.name : entry.name); } while (batch.length);
    };
    for (const e of items) await walk(e, '');
    return out.filter((x) => !x.file.name.startsWith('.'));
  }

  // ---------------------------------------------------------------- uploads: pieces, two files at a time, retries
  const Q = [];
  let running = 0, onDone = null;
  // batch: a transfer from the upload panel ({ jobs, onProgress, onEnd }); its files tell nobody one by one (?quiet=1)
  function upload(id, rel, list, after, batch) {
    for (const x of list) { const j = { id, dir: [rel, x.rel].filter(Boolean).join('/'), file: x.file, sent: 0, state: 'waiting', err: '', batch }; Q.push(j); if (batch) batch.jobs.push(j); }
    if (after) onDone = after; paintQueue(); pump();
  }
  const batchTick = (b) => { if (!b) return; if (b.onProgress) b.onProgress(); if (!b.ended && b.jobs.every((x) => x.state === 'done' || x.state === 'error')) { b.ended = true; b.onEnd(); } };
  function pump() { while (running < 2) { const j = Q.find((x) => x.state === 'waiting'); if (!j) break; running++; j.state = 'sending'; send(j).finally(() => { running--; paintQueue(); batchTick(j.batch); pump(); if (!Q.some((x) => x.state === 'waiting' || x.state === 'sending') && onDone && !j.batch) onDone(); }); } }
  async function send(j) {
    let tries = 0;
    for (;;) {
      try {
        const st = await api('POST', `/api/share/${enc(j.id)}/upload`, { dir: j.dir, name: j.file.name, size: j.file.size });
        j.sent = st.received; paintQueue(); if (j.batch && j.batch.onProgress) j.batch.onProgress();
        while (j.sent < j.file.size) {
          const piece = j.file.slice(j.sent, Math.min(j.file.size, j.sent + st.chunk));
          const r = await fetch(`/api/share/${enc(j.id)}/upload/${st.upload}?offset=${j.sent}`, { method: 'PUT', credentials: 'same-origin', headers: { 'x-rfp': '1', 'content-type': 'application/octet-stream' }, body: piece });
          const k = await r.json().catch(() => ({}));
          if (r.status === 409 && /Send from byte (\d+)/.test(k.error || '')) { j.sent = Number(/Send from byte (\d+)/.exec(k.error)[1]); continue; }
          if (!r.ok) throw Object.assign(new Error(k.error || 'Upload failed (' + r.status + ')'), { status: r.status });
          j.sent = k.received; tries = 0; paintQueue(); if (j.batch && j.batch.onProgress) j.batch.onProgress();
        }
        const fin = await api('POST', `/api/share/${enc(j.id)}/upload/${st.upload}/done${j.batch ? '?quiet=1' : ''}`, {});
        j.path = fin.path; j.state = 'done'; return;
      } catch (e) {
        if ([400, 401, 403, 404, 507].includes(e.status) || ++tries > 30) { j.state = 'error'; j.err = e.message; return; }
        j.err = 'Connection lost, trying again…'; paintQueue();
        await new Promise((ok) => setTimeout(ok, Math.min(30000, 1000 * 2 ** Math.min(tries, 5))));
        j.err = '';
      }
    }
  }
  let qPaint = 0;
  const QQ = Q;
  function paintQueue() {
    if (Date.now() - qPaint < 200 && QQ.some((x) => x.state === 'sending')) { clearTimeout(paintQueue.t); paintQueue.t = setTimeout(paintQueue, 220); return; }
    qPaint = Date.now();
    const box = $('queue');
    const Q = QQ.filter((x) => !x.batch);
    if (!Q.length) { box.hidden = true; return; }
    const total = Q.reduce((n, x) => n + x.file.size, 0), sent = Q.reduce((n, x) => n + (x.state === 'done' ? x.file.size : x.sent), 0), busy = Q.some((x) => x.state === 'waiting' || x.state === 'sending');
    box.hidden = false;
    fill(box, h('div', { class: 'qh' }, h('span', { class: 'grow' }, busy ? `Uploading ${Q.filter((x) => x.state !== 'done').length} file(s) · ${Math.floor((sent / (total || 1)) * 100)}%` : `${Q.filter((x) => x.state === 'done').length} uploaded`),
      busy ? null : h('button', { class: 'sm ghost', onclick: () => { for (let i = QQ.length - 1; i >= 0; i--) if (!QQ[i].batch) QQ.splice(i, 1); paintQueue(); } }, 'Close')),
      Q.slice(-200).map((j) => h('div', { class: 'qi' + (j.state === 'error' ? ' err' : '') }, h('div', { class: 'nm' }, h('span', { title: (j.dir ? j.dir + '/' : '') + j.file.name }, (j.dir ? j.dir + '/' : '') + j.file.name),
        h('span', { class: 'dim nowrap' }, j.state === 'done' ? '✓' : j.state === 'error' ? 'failed' : size(j.file.size))), j.err ? h('div', { class: j.state === 'error' ? 'err' : 'dim' }, j.err) : null,
        h('div', { class: 'bar' }, h('i', { style: { width: (j.state === 'done' ? 100 : (j.sent / (j.file.size || 1)) * 100) + '%' } })))));
  }
  addEventListener('beforeunload', (e) => { if (Q.some((x) => x.state === 'sending' || x.state === 'waiting')) { e.preventDefault(); e.returnValue = ''; } });

  // ---------------------------------------------------------------- preview with comments
  function preview(id, files, i, s, reload) {
    const x = files[i]; if (!x) return;
    const fileUrl = (dl) => `/api/share/${enc(id)}/file?path=${enc(x.path)}${dl ? '' : '&download=0'}`;
    const pv = `/api/share/${enc(id)}/preview?path=${enc(x.path)}`;
    const stage = h('div', { class: 'pv-body' }, h('p', { class: 'dim' }, 'Loading…'));
    let media = null;
    const close = () => { modal.remove(); document.removeEventListener('keydown', key); stopPolls(); if (dirty) reload(); };
    let dirty = false;
    const key = (e) => { if (e.target.closest && e.target.closest('textarea,input')) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowRight' && files[i + 1]) { close(); preview(id, files, i + 1, s, reload); } if (e.key === 'ArrowLeft' && i > 0) { close(); preview(id, files, i - 1, s, reload); } };
    document.addEventListener('keydown', key);
    async function show() {
      if (x.kind === 'pdf') { fill(stage, h('iframe', { src: fileUrl(false) })); return; }
      if (x.kind === 'text') { try { const t = await (await fetch(fileUrl(false), { credentials: 'same-origin' })).text(); fill(stage, h('pre', {}, t.slice(0, 500000))); } catch (e) { fill(stage, h('p', {}, e.message)); } return; }
      if (!['image', 'video', 'audio'].includes(x.kind)) { fill(stage, h('div', { class: 'empty' }, h('p', {}, 'This kind of file cannot be shown in the browser.'), h('a', { class: 'btn primary', href: fileUrl(true) }, '⬇ Download ' + size(x.size)))); return; }
      const j = await api('GET', pv + '&check=1').catch((e) => ({ error: e.message }));
      if (j.error) { fill(stage, h('div', { class: 'empty' }, h('p', {}, j.error), h('a', { class: 'btn primary', href: fileUrl(true) }, '⬇ Download'))); return; }
      if (j._status === 202) { fill(stage, h('div', { class: 'empty' }, h('p', {}, `Making a preview of this ${x.kind} for the browser… ${j.progress || 0}%`), h('p', { class: 'dim small' }, 'Large camera files take a while the first time. You can close this and come back.'))); polls.push(setTimeout(show, 3000)); return; }
      if (x.kind === 'image') media = h('img', { src: pv, alt: x.name });
      else media = h(x.kind, { src: pv, controls: true, autoplay: true, preload: 'metadata' });
      fill(stage, media);
      if (i > 0) stage.append(h('button', { class: 'pv-nav', style: { left: '8px' }, onclick: () => { close(); preview(id, files, i - 1, s, reload); } }, '‹'));
      if (files[i + 1]) stage.append(h('button', { class: 'pv-nav', style: { right: '8px' }, onclick: () => { close(); preview(id, files, i + 1, s, reload); } }, '›'));
    }
    // comments
    const list = h('div', { class: 'comments' }), txt = h('textarea', { rows: 3, placeholder: 'Comment…' }), atTc = h('input', { type: 'checkbox', checked: true });
    async function loadC() {
      let r; try { r = await api('GET', `/api/share/${enc(id)}/comments?path=${enc(x.path)}`); } catch (e) { fill(list, h('p', { class: 'err' }, e.message)); return; }
      fill(list, ...(r.comments.length ? r.comments.map((c) => h('div', { class: 'c' }, h('div', { class: 'w' }, h('b', {}, c.name), h('span', {}, when(c.at)), c.tc != null ? h('span', { class: 'tc', title: 'Go there', onclick: () => { if (media && media.currentTime !== undefined) { media.currentTime = c.tc; media.play && media.play().catch(() => {}); } } }, '@' + tcText(c.tc)) : null,
        h('span', { class: 'grow' }), c.canRemove ? h('button', { class: 'sm ghost', title: 'Remove', onclick: async () => { await api('DELETE', `/api/share/${enc(id)}/comments/${enc(c.id)}`).catch(oops); dirty = true; loadC(); } }, '✕') : null), h('p', {}, c.text)))
        : [h('p', { class: 'dim small' }, 'No comments yet.')]));
    }
    const addC = async () => {
      if (!txt.value.trim()) return;
      const tc = (x.kind === 'video' || x.kind === 'audio') && atTc.checked && media && Number.isFinite(media.currentTime) ? media.currentTime : null;
      try { await api('POST', `/api/share/${enc(id)}/comments?path=${enc(x.path)}`, { text: txt.value, tc }); txt.value = ''; dirty = true; loadC(); } catch (e) { oops(e); }
    };
    txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addC(); });
    const modal = h('div', { class: 'modal' }, h('div', { class: 'pv' },
      h('div', { class: 'pv-main' }, h('div', { class: 'pv-head' }, h('b', { class: 'grow', title: x.path }, x.name), h('span', { class: 'dim small nowrap' }, size(x.size) + (x.by ? ' · ' + x.by : '')),
        h('a', { class: 'btn sm primary', href: fileUrl(true) }, '⬇ Download'), h('button', { class: 'sm', onclick: close }, '✕')), stage),
      h('div', { class: 'pv-side' }, h('h3', {}, 'Comments'), list, h('div', { class: 'cform' }, txt,
        x.kind === 'video' || x.kind === 'audio' ? h('label', { class: 'small dim', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, atTc, 'At the current time') : null,
        h('button', { class: 'primary sm', onclick: addC }, 'Comment')))));
    document.body.append(modal);
    show(); loadC();
  }

  // ---------------------------------------------------------------- side panels: people, activity
  function sidePanel(title, body) {
    document.querySelectorAll('.side-panel').forEach((p) => p.remove());
    const p = h('div', { class: 'side-panel' }, h('div', { class: 'spread' }, h('h2', { style: { margin: 0 } }, title), h('button', { class: 'sm', onclick: () => p.remove() }, '✕')), h('div', { style: { marginTop: '14px' } }, body));
    document.body.append(p);
    return p;
  }
  async function peoplePanel(id, s, reload) {
    if (s.role !== 'manager') {
      const cb = h('input', { type: 'checkbox', checked: s.notify !== false, onchange: async (e) => { try { await api('PUT', `/api/share/${enc(id)}/people/${enc(ME.email)}`, { notify: e.target.checked }); toast('Saved'); } catch (err) { oops(err); } } });
      sidePanel('Emails', h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, cb, 'Email me when new files or comments are added (at most every 10 minutes)'));
      return;
    }
    const info = await api('GET', `/api/share/${enc(id)}`).catch((e) => { oops(e); return null; });
    if (!info) return;
    const emails = h('textarea', { rows: 3, placeholder: 'one@example.com, two@example.com' }), role = h('select', {}, h('option', { value: 'viewer' }, 'Viewer: see and download'), h('option', { value: 'editor' }, 'Editor: also upload, rename, delete')), note = h('textarea', { rows: 2, placeholder: 'A message in the invite (optional)' });
    const out = h('div', {});
    const members = h('div', {}, (info.members || []).length ? info.members.map((m) => h('div', { class: 'mem' }, h('div', {}, h('div', {}, m.email), h('div', { class: 'dim small' }, (m.accepted ? 'Joined' : 'Invited') + ' ' + when(m.at) + ' by ' + m.invitedBy)),
      h('select', { onchange: async (e) => { try { await api('PUT', `/api/share/${enc(id)}/people/${enc(m.email)}`, { role: e.target.value }); toast('Saved'); } catch (err) { oops(err); } } }, ['viewer', 'editor'].map((v) => h('option', { value: v, selected: m.role === v }, v === 'viewer' ? 'Viewer' : 'Editor'))),
      h('button', { class: 'sm ghost danger', title: 'Remove', onclick: async () => { if (!confirm(`Remove ${m.email} from this folder?`)) return; try { await api('DELETE', `/api/share/${enc(id)}/people/${enc(m.email)}`); peoplePanel(id, s, reload); } catch (err) { oops(err); } } }, '✕')))
      : h('p', { class: 'dim' }, 'Nobody invited yet. Producers and Admins of the team always have access.'));
    sidePanel('People', h('div', {},
      h('label', { class: 'f' }, h('span', {}, 'Invite by email'), emails), h('label', { class: 'f' }, h('span', {}, 'As'), role), h('label', { class: 'f' }, h('span', {}, 'Message'), note),
      h('button', { class: 'primary', onclick: async () => {
        try {
          const r = await api('POST', `/api/share/${enc(id)}/people`, { emails: emails.value, role: role.value, note: note.value });
          emails.value = ''; note.value = '';
          fill(out, r.added.length ? h('p', { class: 'ok' }, `Invited ${r.added.length}${r.mailed ? `, ${r.mailed} emailed` : ''}.`) : h('p', { class: 'dim' }, 'Already invited (their role was updated).'),
            r.links.length && r.mailed < r.links.length ? [h('p', { class: 'dim small' }, 'Email is not set up (or did not go out): send them their link yourself:'), r.links.map((l) => h('div', { class: 'small' }, l.email + ': ', h('a', { href: l.url }, l.url)))] : null);
          setTimeout(() => peoplePanel(id, s, reload).then(() => document.querySelector('.side-panel').append(out)), 300);
        } catch (e) { oops(e); }
      } }, 'Invite'), out,
      h('h2', { style: { marginTop: '22px' } }, 'Invited'), members,
      h('h2', { style: { marginTop: '22px' } }, 'This folder'),
      (() => {
        const nm = h('input', { value: s.name }), ex = h('input', { type: 'date', value: s.expires || '', min: new Date(Date.now() + 864e5).toISOString().slice(0, 10) });
        return [h('label', { class: 'f' }, h('span', {}, 'Name'), nm), h('label', { class: 'f' }, h('span', {}, 'Remove from the server on (empty = never)'), ex),
          h('p', { class: 'dim small' }, 'On that day the folder and its files are removed for everyone. Three days before, the invited people get an email to download what they need.'),
          h('div', { class: 'row', style: { marginBottom: '10px' } }, h('button', { class: 'sm primary', onclick: async () => { try { await api('PUT', `/api/share/${enc(id)}`, { name: nm.value, expires: ex.value }); toast('Saved'); document.querySelector('.side-panel').remove(); reload(); } catch (e) { oops(e); } } }, 'Save'))];
      })(),
      h('div', { class: 'row' },
        h('button', { class: 'sm danger', onclick: async () => { if (!confirm(`Delete the shared folder “${s.name}” for everyone? Its files are kept on the NAS for 30 days.`)) return; try { await api('DELETE', `/api/share/${enc(id)}`); document.querySelector('.side-panel').remove(); go('/'); } catch (e) { oops(e); } } }, 'Delete folder'))));
  }
  async function transfersPanel(id) {
    const r = await api('GET', '/api/share-transfers?share=' + enc(id)).catch((e) => { oops(e); return null; });
    if (r) sidePanel('Transfers', transferList(r.transfers, { compact: true }));
  }
  async function activityPanel(id) {
    const r = await api('GET', `/api/share/${enc(id)}/activity`).catch((e) => { oops(e); return null; });
    if (!r) return;
    const W = { transfer: 'sent files to', edit: 'changed the folder:', create: 'made the folder', upload: 'uploaded', folder: 'made the folder', delete: 'deleted', move: 'moved / renamed', comment: 'commented on', download: 'downloaded', invite: 'invited', uninvite: 'removed' };
    sidePanel('Activity', r.activity.length ? r.activity.map((a) => h('div', { class: 'act' }, h('b', {}, a.name || a.email || 'Someone'), ' ', W[a.what] || a.what, ' ', a.target ? h('b', {}, a.target + (a.role ? ` (${a.role})` : '')) : null, a.path ? h('span', { class: 'ok' }, ' ' + a.path) : null,
      a.text ? h('div', { class: 'dim small' }, '“' + a.text + '”' + (a.tc != null ? ' @' + tcText(a.tc) : '')) : null, h('div', { class: 'dim' }, new Date(a.at).toLocaleString('en-GB')))) : h('p', { class: 'dim' }, 'Nothing yet.'));
  }

  (async () => { try { CFG = await api('GET', '/api/config'); } catch { CFG = {}; } route(); })();
})();
