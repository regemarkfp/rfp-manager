/* Sharing (sharing.regemarkfp.com, or /sharing on the website): shared folders of a production or event.
 * Pages: / (my folders) · /f/<id>/<path…> (a folder) · /invite/<token> (an email invite) · /l/<key>/<path…> (anyone with the link, no sign-in).
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
  // ---- friendly dialogs (instead of the browser's own confirm / prompt) and small menus
  function dialog({ title, text, body, ok = 'OK', danger = false, cancel = 'Cancel', onOk }) {
    return new Promise((resolve) => {
      const err = h('p', { class: 'err small' });
      const done = (v) => { bg.remove(); document.removeEventListener('keydown', key); resolve(v); };
      const okB = h('button', { class: danger ? 'danger-solid' : 'primary', onclick: async () => { if (onOk) { try { const v = await onOk(); if (v === false) return; done(v === undefined ? true : v); } catch (e) { err.textContent = e.message; } } else done(true); } }, ok);
      const key = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) { e.preventDefault(); okB.click(); } };
      const bg = h('div', { class: 'dlg-bg', onclick: (e) => { if (e.target === bg) done(false); } }, h('div', { class: 'dlg', role: 'dialog' }, h('h2', {}, title), text ? h('p', { class: 'dim' }, text) : null, body || null, err,
        h('div', { class: 'dlg-actions' }, cancel ? h('button', { class: 'ghost', onclick: () => done(false) }, cancel) : null, okB)));
      document.body.append(bg); document.addEventListener('keydown', key);
      setTimeout(() => { const f = bg.querySelector('input, textarea, select'); (f || okB).focus(); if (f && f.select) f.select(); }, 30);
    });
  }
  const askText = (title, label, value = '', ok = 'OK', placeholder = '') => { const i = h('input', { value, placeholder }); return dialog({ title, body: h('label', { class: 'f' }, h('span', {}, label), i), ok, onOk: () => { const v = i.value.trim(); if (!v) throw new Error('Type a name first'); return v; } }); };
  const sure = (title, text, ok = 'Delete') => dialog({ title, text, ok, danger: true });
  // a small menu under a button: [[label, fn, { danger }], …]
  function menuAt(btn, items) {
    document.querySelectorAll('.pop').forEach((m) => m.remove());
    const r = btn.getBoundingClientRect();
    const m = h('div', { class: 'pop', style: { top: Math.min(r.bottom + 4, innerHeight - 40 * items.length - 10) + 'px', left: Math.max(8, Math.min(r.right - 190, innerWidth - 200)) + 'px' } },
      items.filter(Boolean).map(([label, fn, o = {}]) => h('button', { class: o.danger ? 'danger' : '', onclick: (e) => { e.stopPropagation(); m.remove(); fn(); } }, label)));
    document.body.append(m);
    setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
  }
  // the ? in the header: how it works, in plain words
  function helpBox() {
    const step = (n, t, d) => h('div', { class: 'help-step' }, h('span', { class: 'n' }, n), h('div', {}, h('b', {}, t), h('div', { class: 'dim small' }, d)));
    dialog({ title: 'How File Sharing works', cancel: null, ok: 'Got it', body: h('div', {},
      step('1', 'Send files', 'Press the big green + (or drag files onto the page), choose the folder they go to, and press Send. Big video files are fine: if your internet drops, it carries on by itself.'),
      step('2', 'Tell people', 'Tick the people who should know. They get an email and a notification with a link straight to the files.'),
      step('3', 'Find and open files', 'Open a folder on the right. Click a file to see it; use the arrows (or swipe) to go to the next one. Full screen is at the top.'),
      step('4', 'Download', 'Use ⬇ next to a file, tick a few files and press Download, or Download all to get everything as one ZIP.'),
      h('p', { class: 'dim small', style: { marginTop: '14px' } }, 'What you can do depends on how you were invited: viewers can look and download; editors can also add, rename, move and delete. Questions? Reply to the invitation email.')) });
  }
  const size = (n) => (n < 1024 ? n + ' B' : n < 1024 ** 2 ? (n / 1024).toFixed(0) + ' KB' : n < 1024 ** 3 ? (n / 1024 ** 2).toFixed(1) + ' MB' : (n / 1024 ** 3).toFixed(2) + ' GB');
  const when = (t) => { const d = new Date(t), now = Date.now(); return now - t < 60e3 ? 'just now' : now - t < 3600e3 ? Math.floor((now - t) / 60e3) + ' min ago' : d.toDateString() === new Date().toDateString() ? d.toTimeString().slice(0, 5) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: now - t > 300 * 864e5 ? 'numeric' : undefined }); };
  const tcText = (s) => { s = Math.max(0, Number(s) || 0); const m = Math.floor(s / 60), x = Math.floor(s % 60); return `${Math.floor(m / 60) ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : m}:${String(x).padStart(2, '0')}`; };
  const enc = encodeURIComponent;
  const go = (url) => { history.pushState(null, '', BASE + url); route(); };
  addEventListener('popstate', () => route());
  $('home').href = BASE + '/'; $('home').onclick = (e) => { e.preventDefault(); go('/'); };
  if ($('help')) $('help').onclick = () => helpBox();

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
    if ((m = /^\/l\/([\w-]+)\/?(.*)$/.exec(p))) return linkPage(m[1], m[2].split('/').filter(Boolean).map(decodeURIComponent).join('/'));
    if (!ME) await whoami();
    if (!ME) { fill($('main'), signInBox({ title: 'Welcome to File Sharing', note: 'Send and receive photos, videos and other files with RegemarkFP. Sign in with the email address your invitation was sent to.', done: () => route() })); return; }
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
    const intro = `${v.invitedBy} shared the folder “${v.name}” with ${v.email}. You can ${v.role === 'editor' ? 'look at, download and add files' : 'look at and download the files'}.`;
    if (ME) { fill(main, h('div', { class: 'card narrow' }, h('h1', {}, v.name), h('p', {}, intro), h('p', { class: 'err' }, `You are signed in as ${ME.email}. Sign out and sign in as ${v.email}.`), h('button', { onclick: async () => { await api('POST', '/api/auth/logout', {}); ME = null; paintMe(); invitePage(token); } }, 'Sign out'))); return; }
    if (v.account) { fill(main, signInBox({ email: v.email, title: v.name, note: intro + (v.account.google && !v.account.password ? ' Use Sign in with Google.' : ''), done: open })); return; }
    // no account yet: Google, or a new password for that email
    const nm = h('input', { placeholder: 'Your name', autocomplete: 'name' }), pw = h('input', { type: 'password', placeholder: 'At least 8 characters', autocomplete: 'new-password' }), err = h('p', { class: 'err small' });
    const make = async () => { err.textContent = ''; try { await api('POST', '/api/sharing/invite/' + enc(token) + '/password', { name: nm.value, password: pw.value }); await whoami(); open(); } catch (e) { err.textContent = e.message; } };
    const box = signInBox({ email: v.email, title: v.name, note: intro, done: open });
    box.querySelectorAll('label.f, button.primary').forEach((x) => x.remove());
    const orEl = box.querySelector('.or'); if (orEl) orEl.textContent = 'or make a password (first time only)';
    box.append(h('label', { class: 'f' }, h('span', {}, 'Email'), h('input', { value: v.email, readonly: true })), h('label', { class: 'f' }, h('span', {}, 'Your name'), nm), h('label', { class: 'f' }, h('span', {}, 'Choose a password'), pw), err, h('button', { class: 'primary', onclick: make }, 'Open the folder'), h('p', { class: 'dim small' }, 'Next time, sign in with this email and password.'));
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
    const reset = () => { st.files = []; st.tags.clear(); st.message = ''; st.sub = ''; st.subOpen = false; st.find = ''; st.phase = 'pick'; st.batch = null; paint(); };
    async function loadPeople() {
      if (!st.target || st.peopleFor === st.target) return;
      st.peopleFor = st.target;
      try { st.people = (await api('GET', `/api/share/${enc(st.target)}/taggable`)).people; } catch { st.people = []; }
      if (st.phase === 'pick') paint();
    }
    async function loadSubs() {
      const where = st.target + '|' + (fixed ? fixed.dir : '');
      if (!st.target || st.subsFor === where) return;
      st.subsFor = where;
      try { const r = await api('GET', `/api/share/${enc(st.target)}/list?path=${enc(fixed ? fixed.dir : '')}`); st.subs = r.items.filter((x) => x.dir).map((x) => x.name); } catch { st.subs = []; }
      if (st.phase === 'pick') paint();
    }
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
          st.phase === 'sending' ? [h('h2', { class: 'ctr' }, 'Sending…'), h('p', { class: 'dim ctr' }, `${ok} of ${b.jobs.length} files · ${size(sent)} of ${size(all)}`), h('p', { class: 'dim small ctr' }, 'Please keep this page open until it is done. If your internet drops, it carries on by itself.')]
            : [h('h2', { class: 'ctr' }, bad.length ? 'Some files did not go through' : 'Done! Your files are in'), h('p', { class: 'ctr' }, `${ok} file${ok === 1 ? '' : 's'} in ${t.name || 'the folder'}${b.dir ? ' / ' + b.dir : ''}.`),
              b.tagged ? h('p', { class: 'dim small ctr' }, b.tagged) : null, bad.length ? h('div', { class: 'err small' }, bad.slice(0, 5).map((j) => h('div', {}, `${j.file.name}: ${j.err}`))) : null,
              h('div', { class: 'col' }, h('button', { class: 'primary', onclick: reset }, 'Send more files'), h('a', { class: 'btn', href: BASE + '/f/' + b.target + '/' + (b.dir ? b.dir.split('/').map(enc).join('/') : ''), onclick: (e) => { e.preventDefault(); go('/f/' + b.target + '/' + (b.dir ? b.dir.split('/').map(enc).join('/') : '')); } }, 'Open the folder'))]);
        return;
      }
      loadPeople(); loadSubs();
      const nameOf = (e) => { const p = st.people.find((x) => x.email === e); return p && p.name ? p.name : e; };
      const step = (n, title, hint, ...kids) => h('div', { class: 'xstep' }, h('div', { class: 'xs-head' }, h('span', { class: 'n' }, n), h('b', {}, title), hint ? h('span', { class: 'dim small' }, ' ' + hint) : null), kids);
      const addLinks = h('div', { class: 'add-links' }, h('button', { class: 'linkish', onclick: () => pickFiles(false) }, '+ Add more files'), h('button', { class: 'linkish', onclick: () => pickFiles(true) }, '+ Add a folder'));
      // 1. the files
      const one = !st.files.length
        ? [h('div', { class: 'plus-big' }, h('button', { class: 'plus', title: 'Choose files to send', onclick: () => pickFiles(false) }, '+')),
          h('h2', { class: 'ctr' }, 'Send files'), h('p', { class: 'dim small ctr' }, matchMedia('(pointer: coarse)').matches ? 'Press + to choose photos, videos or other files.' : 'Press + to choose files, or drag them onto this page.'),
          h('p', { class: 'ctr' }, h('button', { class: 'linkish', onclick: () => pickFiles(true) }, 'or choose a whole folder'))]
        : step('1', `${st.files.length} file${st.files.length === 1 ? '' : 's'} chosen`, '· ' + size(total),
          h('div', { class: 'xf-list' }, st.files.slice(0, 300).map((x, i) => h('div', { class: 'xf' }, h('span', { class: 'nm', title: (x.rel ? x.rel + '/' : '') + x.file.name }, (x.rel ? x.rel + '/' : '') + x.file.name), h('span', { class: 'dim small nowrap' }, size(x.file.size)), h('button', { class: 'x', title: 'Take this file out', onclick: () => { st.files.splice(i, 1); paint(); } }, '✕'))),
            st.files.length > 300 ? h('div', { class: 'dim small' }, `… and ${st.files.length - 300} more`) : null),
          h('div', { class: 'spread' }, addLinks, h('button', { class: 'linkish dim', onclick: () => { st.files = []; paint(); } }, 'Start again')));
      if (!st.files.length) { fill(box, one); return; }
      // 2. where to
      const two = step('2', 'Where should they go?', null,
        fixed ? h('div', { class: 'to-fixed' }, '📁 ' + fixed.name + (fixed.dir ? ' / ' + fixed.dir : ''))
          : targets.length ? h('select', { 'aria-label': 'Folder', onchange: (e) => { st.target = e.target.value; st.tags.clear(); st.sub = ''; st.subOpen = false; paint(); } }, targets.map((t) => h('option', { value: t.id, selected: t.id === st.target }, t.name + (t.productionName && t.productionName !== t.name ? ' · ' + t.productionName : ''))))
            : h('div', { class: 'dim small' }, 'You cannot add files to any folder yet.'),
        // inside it: straight in, a folder that is already there, or a new one
        h('label', { class: 'f' }, h('span', {}, 'Inside it'), h('select', { onchange: (e) => { const v = e.target.value; if (v === '\u0000new') { st.subOpen = true; st.sub = ''; } else { st.subOpen = false; st.sub = v; } paint(); if (st.subOpen) setTimeout(() => { const i = box.querySelector('.newsub'); if (i) i.focus(); }, 0); } },
          h('option', { value: '', selected: !st.sub && !st.subOpen }, 'Straight in (not in a folder inside it)'),
          (st.subs || []).map((d) => h('option', { value: d, selected: !st.subOpen && st.sub === d }, '📁 ' + d)),
          h('option', { value: '\u0000new', selected: st.subOpen }, '+ A new folder…'))),
        st.subOpen ? h('input', { class: 'newsub', value: st.sub, placeholder: 'Name of the new folder: Day 1, Camera A …', oninput: (e) => { st.sub = e.target.value; } }) : null);
      // 3. who should know: tap people to tick them
      const many = st.people.length > 8;
      const shown = st.people.filter((p) => !st.find || (p.name + ' ' + p.email).toLowerCase().includes(st.find.toLowerCase()));
      const three = step('3', 'Who should know?', '(optional)',
        st.people.length ? [h('p', { class: 'dim small', style: { margin: '0 0 8px' } }, 'Tick the people to tell. They get an email and a notification once the files are in.'),
          many ? h('input', { class: 'find', placeholder: 'Find a person…', value: st.find || '', oninput: (e) => { st.find = e.target.value; paint(); setTimeout(() => { const i = box.querySelector('input.find'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); } }) : null,
          h('div', { class: 'people' }, shown.map((p) => h('button', { class: 'person' + (st.tags.has(p.email) ? ' on' : ''), title: p.email, onclick: () => { if (st.tags.has(p.email)) st.tags.delete(p.email); else st.tags.add(p.email); paint(); } },
            h('span', { class: 'tick' }, st.tags.has(p.email) ? '✓' : ''), h('span', { class: 'pn' }, p.name || p.email), p.name ? h('span', { class: 'dim small pe' }, p.email) : null)))]
          : h('p', { class: 'dim small', style: { margin: 0 } }, 'Nobody else is invited to this folder yet, so there is nobody to tell.'));
      // 4. a note
      const four = step('4', 'Add a message', '(optional)', h('textarea', { rows: 2, placeholder: 'e.g. The interviews from Saturday', oninput: (e) => { st.message = e.target.value; } }, st.message));
      fill(box, one, two, three, four,
        h('button', { class: 'primary big', disabled: !st.target || null, onclick: start }, `Send ${st.files.length} file${st.files.length === 1 ? '' : 's'}`),
        st.tags.size ? h('p', { class: 'dim small ctr' }, `${[...st.tags].map(nameOf).join(', ')} will be told.`) : null);
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
        h('b', {}, s.name), h('span', { class: 'pill ' + s.role }, s.role === 'manager' ? 'You manage it' : s.role === 'editor' ? 'You can add files' : 'You can look'), s.members ? h('span', { class: 'dim', style: { marginLeft: '8px' } }, `${s.members.length} ${s.members.length === 1 ? 'person' : 'people'} invited`) : null, s.productionName && s.productionName !== s.name ? h('div', { class: 'dim small', style: { marginTop: '6px' } }, s.productionName) : null, s.expires ? h('div', { class: 'small', style: { marginTop: '6px', color: 'var(--warn)' } }, '⏳ Deleted on ' + s.expires) : null)))])
      : h('div', { class: 'card empty big-empty' }, h('div', { class: 'em-ico' }, '📂'), h('h2', {}, 'No shared folders yet'), h('p', { class: 'dim' }, r.canCreate.length ? 'Press + New folder to make one. A production\'s own folder is made when you press Shared folder on the production in the Studio.' : 'When someone shares a folder with you, you get an email and the folder shows up here.')));
    const paintRight = () => {
      try { sessionStorage.setItem('rfp-share-tab', tab); } catch { /* fine */ }
      const list = tx.transfers.filter((t) => !txWho || (txWho === 'me' ? t.mine : t.forMe));
      fill(right, h('div', { class: 'spread', style: { marginBottom: '12px' } }, h('div', { class: 'tabs2' }, h('button', { class: tab === 'folders' ? 'on' : '', onclick: () => { tab = 'folders'; paintRight(); } }, `Your folders (${r.shares.length})`),
        h('button', { class: tab === 'transfers' ? 'on' : '', onclick: () => { tab = 'transfers'; paintRight(); } }, `Sent & received (${tx.transfers.length})`)),
        tab === 'folders' ? newBtn : h('select', { class: 'sm-sel', onchange: (e) => { txWho = e.target.value; paintRight(); } }, [['', 'All'], ['me', 'Sent by me'], ['to', 'Sent to me']].map(([v, t]) => h('option', { value: v, selected: v === txWho }, t)))),
        tab === 'folders' ? folders() : transferList(list));
    };
    // the first time: three steps, in plain words (closed for good with ✕)
    const seenIntro = (() => { try { return localStorage.getItem('rfp-share-intro') === '1'; } catch { return false; } })();
    const intro = seenIntro ? null : h('div', { class: 'intro' }, h('div', { class: 'intro-steps' },
      [['1', 'Add files', 'Press the green + or drag files here'], ['2', 'Choose a folder', 'and tick who should know'], ['3', 'Send', 'They get an email with a link']].map(([n, t, d]) => h('div', { class: 'help-step' }, h('span', { class: 'n' }, n), h('div', {}, h('b', {}, t), h('div', { class: 'dim small' }, d))))),
      h('button', { class: 'sm ghost', title: 'Hide this', onclick: (e) => { try { localStorage.setItem('rfp-share-intro', '1'); } catch { /* fine */ } e.currentTarget.parentNode.remove(); } }, '✕'));
    paintRight();
    // Admins: the storage of all their shared folders, live (others get nothing: the server says no)
    const isAdmin = await api('GET', '/api/share-live').then(() => true).catch(() => false);
    const store = isAdmin ? liveBox((it) => go('/f/' + it.key + '/')) : null;
    fill(main, intro, store, h('div', { class: targets.length ? 'two' : '' }, targets.length ? xferPanel({ targets, after: async () => { try { tx = await api('GET', '/api/share-transfers'); paintRight(); } catch { /* later */ } } }).el : null, right));
  }

  // ---------------------------------------------------------------- a folder
  let polls = [];
  const stopPolls = () => { polls.forEach(clearTimeout); polls = []; };
  let viewMode = (() => { try { return localStorage.getItem('rfp-share-view') || 'list'; } catch { return 'list'; } })();
  async function folderPage(id, rel, opts = {}) {
    const main = $('main');
    let r; try { r = await api('GET', `/api/share/${enc(id)}/list?path=${enc(rel)}`); } catch (e) { fill(main, h('div', { class: 'card narrow' }, h('h1', {}, 'This folder cannot be opened'), h('p', {}, e.message), h('a', { class: 'btn', href: BASE + '/', onclick: (ev) => { ev.preventDefault(); go('/'); } }, '← Your folders'))); return; }
    const s = r.share, canEdit = s.role !== 'viewer', sel = new Set();
    $('prod').textContent = s.productionName || ''; $('prod').title = s.productionName ? 'Production: ' + s.productionName : '';
    document.title = s.name + ' · File Sharing';
    const url = (p) => '/f/' + id + '/' + (p ? p.split('/').map(enc).join('/') : '');
    const parts = rel ? rel.split('/') : [];
    const crumbs = h('div', { class: 'crumbs' }, h('a', { href: BASE + '/', onclick: (e) => { e.preventDefault(); go('/'); } }, '← Your folders'), h('i', {}, '/'),
      h('a', { href: BASE + url(''), onclick: (e) => { e.preventDefault(); go(url('')); } }, s.name),
      parts.map((x, i) => { const p = parts.slice(0, i + 1).join('/'); return [h('i', {}, '/'), h('a', { href: BASE + url(p), onclick: (e) => { e.preventDefault(); go(url(p)); } }, x)]; }));
    const reload = () => folderPage(id, rel, { keepPanel: true });
    const files = r.items.filter((x) => !x.dir);
    const zipUrl = (paths) => `/api/share/${enc(id)}/zip?` + paths.map((p) => 'p=' + enc(p)).join('&');
    const dlUrl = (x) => (x.dir ? zipUrl([x.path]) : `/api/share/${enc(id)}/file?path=${enc(x.path)}`);
    const download = (href) => { const a = h('a', { href, style: { display: 'none' } }); document.body.append(a); a.click(); setTimeout(() => a.remove(), 500); };
    // actions on files and folders
    const newFolder = async () => { const n = await askText('New folder', 'Name of the folder', '', 'Make the folder', 'Day 1, Camera A, Photos …'); if (!n) return; try { await api('POST', `/api/share/${enc(id)}/folder`, { path: (rel ? rel + '/' : '') + n }); toast('Folder made'); reload(); } catch (e) { oops(e); } };
    const rename = async (x) => { const n = await askText(x.dir ? 'Rename folder' : 'Rename file', 'New name', x.name, 'Rename'); if (!n || n === x.name) return; try { await api('POST', `/api/share/${enc(id)}/move`, { from: x.path, name: n }); toast('Renamed'); reload(); } catch (e) { oops(e); } };
    const remove = async (paths) => {
      const one = paths.length === 1 ? r.items.find((x) => x.path === paths[0]) : null;
      if (!(await sure(one ? `Delete “${one.name}”?` : `Delete ${paths.length} items?`, `${one && one.dir ? 'The folder and everything in it disappears' : 'They disappear'} for everyone in this shared folder. The production team can still get ${paths.length === 1 ? 'it' : 'them'} back for 30 days.`))) return;
      try { await api('POST', `/api/share/${enc(id)}/delete`, { paths }); toast(paths.length === 1 ? 'Deleted' : `${paths.length} deleted`); sel.clear(); reload(); } catch (e) { oops(e); }
    };
    const moveTo = async (paths) => {
      const dest = await folderPicker(id, s.name, rel, paths);
      if (dest === false || dest === null) return;
      let n = 0;
      for (const p of paths) { const name = p.split('/').pop(); try { await api('POST', `/api/share/${enc(id)}/move`, { from: p, to: (dest ? dest + '/' : '') + name }); n++; } catch (e) { oops(e); } }
      if (n) toast(`Moved ${n === 1 ? '' : n + ' items '}to ${dest || s.name}`); sel.clear(); reload();
    };
    const itemMenu = (x, btn) => menuAt(btn, [
      [x.dir ? 'Open' : 'Open / view', () => openItem(x)],
      [x.dir ? 'Download as ZIP' : 'Download', () => download(dlUrl(x))],
      canEdit && [x.dir ? 'Get a link to this folder…' : 'Get a link to this file…', () => linksPanel(id, s, x.path)],
      canEdit && ['Rename…', () => rename(x)],
      canEdit && ['Move to…', () => moveTo([x.path])],
      canEdit && ['Delete', () => remove([x.path]), { danger: true }],
    ]);
    // the bar: normal, or what to do with the ticked items
    const bar = h('div', { class: 'toolbar' });
    const paintBar = () => {
      body.querySelectorAll('[data-p]').forEach((el) => { el.classList.toggle('sel', sel.has(el.dataset.p)); const c = el.querySelector('input[type=checkbox]'); if (c) c.checked = sel.has(el.dataset.p); });
      const all = body.querySelector('.all-box'); if (all) all.checked = r.items.length > 0 && r.items.every((x) => sel.has(x.path));
      if (sel.size) {
        fill(bar, h('b', { class: 'selcount' }, `${sel.size} selected`),
          h('button', { class: 'sm primary', onclick: () => download(zipUrl([...sel])) }, '⬇ Download'),
          canEdit ? h('button', { class: 'sm', onclick: () => moveTo([...sel]) }, 'Move to…') : null,
          canEdit ? h('button', { class: 'sm danger', onclick: () => remove([...sel]) }, 'Delete') : null,
          h('span', { class: 'grow' }), h('button', { class: 'sm ghost', onclick: () => { sel.clear(); paintBar(); } }, '✕ Cancel'));
        bar.classList.add('selecting'); return;
      }
      bar.classList.remove('selecting');
      fill(bar,
        canEdit ? h('button', { class: 'sm', title: 'Make a folder inside this one', onclick: newFolder }, '+ New folder') : null,
        r.items.length ? h('button', { class: 'sm', title: 'Everything in this folder as one ZIP file', onclick: () => download(zipUrl([rel])) }, '⬇ Download all') : null,
        h('span', { class: 'grow' }),
        h('div', { class: 'seg', title: 'How to show the files' }, h('button', { class: viewMode === 'list' ? 'on' : '', onclick: () => setView('list') }, '☰ List'), h('button', { class: viewMode === 'tiles' ? 'on' : '', onclick: () => setView('tiles') }, '▦ Grid')),
        canEdit ? h('button', { class: 'sm', title: 'A link anyone can open without signing in: look and download only', onclick: () => linksPanel(id, s, rel) }, '🔗 Share a link') : null,
        h('button', { class: 'sm', title: 'Who uploaded, changed or commented, and when', onclick: () => historyPanel(id) }, 'History'),
        h('button', { class: 'sm', title: s.role === 'manager' ? 'Invite people, change who can do what' : 'Your email settings for this folder', onclick: () => peoplePanel(id, s, reload) }, s.role === 'manager' ? `👥 Who has access (${(s.members || []).length})` : 'Email me…'));
    };
    const setView = (v) => { viewMode = v; try { localStorage.setItem('rfp-share-view', viewMode); } catch { /* fine */ } reload(); };
    const toggle = (x, on) => { if (on) sel.add(x.path); else sel.delete(x.path); paintBar(); };
    // previews in the list and the grid: photos and video stills (ffmpeg on the server, or the browser itself for
    // mp4 / webm / mov), the first lines of text files; the file type when there is nothing to show
    const WEBV = /\.(mp4|m4v|webm|mov)$/i;
    const thumbOf = (x) => {
      const ext = (x.name.split('.').pop() || '').toUpperCase().slice(0, 5);
      const t = h('div', { class: 'thumb' + (x.dir ? ' folder' : '') + ' k-' + x.kind }, h('span', { class: 'tlabel' }, x.dir ? '📁' : ext));
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
    const tick = (x) => h('input', { type: 'checkbox', title: 'Select', 'aria-label': 'Select ' + x.name, checked: sel.has(x.path), onclick: (e) => e.stopPropagation(), onchange: (e) => toggle(x, e.target.checked) });
    const acts = (x) => h('div', { class: 'acts' },
      h('a', { class: 'ico', title: x.dir ? 'Download the folder as a ZIP' : 'Download', href: dlUrl(x), onclick: (e) => e.stopPropagation() }, '⬇'),
      h('button', { class: 'ico', title: 'More: rename, move, delete …', onclick: (e) => { e.stopPropagation(); itemMenu(x, e.currentTarget); } }, '⋯'));
    const what = (x) => (x.dir ? 'Folder' : { image: 'Photo', video: 'Video', audio: 'Audio', pdf: 'PDF', text: 'Text', doc: 'Document', archive: 'ZIP / archive' }[x.kind] || 'File');
    let list;
    if (!r.items.length) list = h('div', { class: 'empty big-empty' }, h('div', { class: 'em-ico' }, '📂'), h('h2', {}, 'This folder is empty'),
      h('p', { class: 'dim' }, canEdit ? (innerWidth > 900 ? 'Add files with the green + on the left, or drag them onto this page.' : 'Add files with the green + above.') : 'Nothing has been added yet. You get an email when files arrive.'));
    else if (viewMode === 'tiles') list = h('div', { class: 'tiles' }, r.items.map((x) => h('div', { class: 'tile', 'data-p': x.path, tabindex: 0, title: x.dir ? 'Open the folder' : 'Open ' + x.name, onclick: () => openItem(x), onkeydown: (e) => { if (e.key === 'Enter') openItem(x); } },
      thumbOf(x), tick(x), acts(x), h('div', { class: 'nm', title: x.name }, x.name, h('div', { class: 'dim small' }, x.dir ? 'Folder' : size(x.size), x.comments ? h('span', { class: 'cm' }, `  💬 ${x.comments}`) : null)))));
    else list = h('table', { class: 'files' }, h('thead', {}, h('tr', {}, h('th', { style: { width: '28px' } }, h('input', { type: 'checkbox', class: 'all-box', title: 'Select everything', onchange: (e) => { r.items.forEach((x) => (e.target.checked ? sel.add(x.path) : sel.delete(x.path))); paintBar(); } })),
      h('th', {}, 'Name'), h('th', { class: 'r' }, 'Size'), h('th', { class: 'hide-sm' }, 'Added by'), h('th', { class: 'hide-sm' }, 'When'), h('th', {}))),
      h('tbody', {}, r.items.map((x) => h('tr', { 'data-p': x.path, class: 'click', tabindex: 0, title: x.dir ? 'Open the folder' : 'Open ' + x.name, onclick: () => openItem(x), onkeydown: (e) => { if (e.key === 'Enter') openItem(x); } },
        h('td', { onclick: (e) => e.stopPropagation() }, tick(x)),
        h('td', {}, h('div', { class: 'fname' }, thumbOf(x), h('div', { style: { minWidth: 0 } }, h('span', { class: 'fn' }, x.name), h('div', { class: 'dim small show-sm' }, what(x) + (x.dir ? '' : ' · ' + size(x.size)))), x.comments ? h('span', { class: 'cm', title: 'Comments' }, '💬 ' + x.comments) : null)),
        h('td', { class: 'r nowrap dim hide-xs' }, x.dir ? '' : size(x.size)), h('td', { class: 'hide-sm dim small' }, x.by || ''), h('td', { class: 'hide-sm dim small nowrap' }, when(x.mtime)), h('td', { class: 'r' }, acts(x))))));
    const body = h('div', { class: 'drop' }, list);
    const key = id + '|' + rel;
    const panel = !canEdit ? null : opts.keepPanel && PANEL && PANEL.key === key ? PANEL : Object.assign(xferPanel({ targets: [], fixed: { id, name: s.name, dir: rel }, after: reload }), { key });
    if (!panel) PANEL = null;
    const right = h('div', { class: 'right' });
    fill(main, h('div', { class: panel ? 'two' : '' }, panel ? panel.el : null, right));
    const roleText = s.role === 'manager' ? 'You manage this folder' : s.role === 'editor' ? 'You can add and change files' : 'You can look and download';
    fill(right, h('div', { class: 'spread' }, crumbs, h('span', { class: 'pill ' + s.role, title: roleText }, roleText)),
      parts.length ? null : h('h1', { class: 'ftitle' }, s.name),
      parts.length ? h('h1', { class: 'ftitle' }, parts[parts.length - 1]) : null,
      s.expires ? h('div', { class: 'expiry' + ((Date.parse(s.expires) - Date.now()) < 4 * 864e5 ? ' soon' : '') }, `⏳ This folder is removed on ${new Date(s.expires + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Download what you want to keep before then.`) : null,
      bar, body, r.free != null && canEdit ? h('p', { class: 'dim small', style: { marginTop: '14px' } }, `${size(r.free)} of space left.`) : null);
    paintBar();
  }
  // ---------------------------------------------------------------- the storage panel (1.9.0, Cloud Store look)
  // On the home page, for Admins only: every shared folder of their teams on one map (a shade per folder; hover names
  // it, click opens it; new files arrive in the free cells), the space they take next to the free space, and who is
  // sending or getting files right now (MB per second, the last minute). Not shown inside the folders.
  function liveBox(onPick) {
    const CS = window.RFPCS;
    if (!CS) return null;
    const big = h('div', { class: 'cs-big' }), sub = h('div', { class: 'dim small' }), ppl = h('div', { class: 'cs-well' }), mapBox = h('div', { class: 'sh-mapbox' }), legend = h('div', { class: 'cs-legend' });
    const map = CS.hexMap(mapBox, { r: innerWidth < 700 ? 5 : 6, onPick });
    const box = h('div', { class: 'sh-live' },
      h('div', { class: 'cs-panel sh-map' }, h('div', { class: 'spread', style: { alignItems: 'flex-end', marginBottom: '8px' } }, h('div', {}, big, sub), legend), mapBox),
      h('div', { class: 'cs-panel sh-people' }, h('h4', {}, 'Live now', h('span', { class: 'grow' }), h('small', {}, h('span', { class: 'cs-in' }, '▼ up'), ' ', h('span', { class: 'cs-out' }, '▲ down'), ' MB/s')), ppl));
    const paint = (d) => {
      const tot = d.folder.size, free = d.disk ? d.disk.free : 0;
      const one = (n) => { const t = CS.bytes(n).split(' '); return [h('b', {}, t[0]), h('sup', {}, t[1])]; };
      fill(big, one(tot), free ? [h('i', {}, '/'), CS.bytes(free).split(' ')[0], h('sup', {}, CS.bytes(free).split(' ')[1] + ' free')] : null);
      sub.textContent = `${d.folder.files} file${d.folder.files === 1 ? '' : 's'} in ${d.folder.folders} shared folder${d.folder.folders === 1 ? '' : 's'} · only Admins see this`;
      const items = d.items.filter((x) => x.size > 0);
      const here = items.reduce((a, x) => a + x.size, 0);
      // the map: the shared folders by size; free cells only as a thin edge (the whole disk is on the Universe)
      map.set({ total: here ? here * 1.08 : 1, used: here, segments: items.map((x) => ({ key: x.path, name: x.name, size: x.size, sub: `${x.files} file${x.files === 1 ? '' : 's'}` })),
        hot: d.hot.map((x) => ({ key: x.path, path: x.path, kind: x.kind })) });
      fill(legend, h('span', {}, h('i', { style: { background: CS.colors.used[0] } }), 'Files'), h('span', {}, h('i', { style: { background: CS.colors.in } }), 'Arriving'), h('span', {}, h('i', { style: { background: CS.colors.out } }), 'Downloading'));
      fill(ppl, d.people.length ? d.people.map((x) => h('div', { class: 'cs-row' }, h('span', { class: 'ico' }, /^Link:/.test(x.name) ? '🔗' : '👤'),
        h('div', { class: 'who' }, h('b', { title: x.name }, x.name || 'Someone'), h('small', {}, `${CS.bytes(x.total[0])} up · ${CS.bytes(x.total[1])} down`)),
        h('span', { class: 'sp' }, h('span', { class: 'cs-in' }, CS.num(x.in)), ' ', h('span', { class: 'cs-out' }, CS.num(x.out))), CS.spark(x.hist)))
        : h('div', { class: 'cs-empty' }, 'Nobody is sending or downloading right now.'));
    };
    const poll = async () => {
      if (!box.isConnected && polled) return;
      polled = true;
      if (document.visibilityState === 'visible') { try { paint(await api('GET', '/api/share-live')); } catch (e) { if (e.status === 403 || e.status === 401) { box.remove(); return; } } }
      setTimeout(poll, 2000);            // its own timer: it stops when the folder page is gone (not with a preview's polls)
    };
    let polled = false;
    setTimeout(poll, 0);
    return box;
  }

  // choose a folder inside a shared folder (for Move to…): walk in, go back, "Move here"
  function folderPicker(id, rootName, start, moving) {
    let at = start;
    const box = h('div', { class: 'picker' });
    const paint = async () => {
      fill(box, h('p', { class: 'dim' }, 'Loading…'));
      let r; try { r = await api('GET', `/api/share/${enc(id)}/list?path=${enc(at)}`); } catch (e) { fill(box, h('p', { class: 'err' }, e.message)); return; }
      const dirs = r.items.filter((x) => x.dir && !moving.includes(x.path));
      const parts = at ? at.split('/') : [];
      fill(box, h('div', { class: 'crumbs small' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); at = ''; paint(); } }, rootName), parts.map((x, i) => [h('i', {}, '/'), h('a', { href: '#', onclick: (e) => { e.preventDefault(); at = parts.slice(0, i + 1).join('/'); paint(); } }, x)])),
        h('div', { class: 'pick-list' }, at ? h('button', { class: 'pick', onclick: () => { at = parts.slice(0, -1).join('/'); paint(); } }, '↑ Up one level') : null,
          dirs.length ? dirs.map((d) => h('button', { class: 'pick', onclick: () => { at = d.path; paint(); } }, '📁 ' + d.name, h('span', { class: 'dim' }, ' ›'))) : h('p', { class: 'dim small' }, 'No folders in here.')),
        h('p', { class: 'small' }, 'Moving to: ', h('b', {}, at ? rootName + ' / ' + at : rootName)));
    };
    paint();
    return dialog({ title: `Move ${moving.length === 1 ? '“' + moving[0].split('/').pop() + '”' : moving.length + ' items'}`, text: 'Open the folder they should go to, then press Move here.', body: box, ok: 'Move here', onOk: () => (at === start ? Promise.reject(new Error('They are already here: open another folder first')) : at) });
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
  // One viewer for the whole folder: ‹ › (or ← →), a swipe on phones, a scroll or trackpad swipe on computers go to the
  // next or previous file, in the same window; in full screen it stays full screen.
  // lk (a visitor with a link): { base: '/api/sharing/link/<key>', q: '&t=<pass>' } – no comments, the link's files
  function preview(id, files, start, s, reload, lk = null) {
    if (!files[start]) return;
    let i = start, x = files[i], media = null, dirty = false, seq = 0;
    const B = lk ? lk.base : `/api/share/${enc(id)}`, Q = lk ? lk.q : '';
    const fileUrl = (dl) => `${B}/file?path=${enc(x.path)}${dl ? '' : '&download=0'}${Q}`;
    const pvUrl = () => `${B}/preview?path=${enc(x.path)}${Q}`;
    const slot = h('div', { class: 'pv-slot' }, h('p', { class: 'dim' }, 'Loading…'));
    const prevB = h('button', { class: 'pv-nav', style: { left: '8px' }, title: 'Previous (←)', onclick: (e) => { e.stopPropagation(); step(-1); } }, '‹');
    const nextB = h('button', { class: 'pv-nav', style: { right: '8px' }, title: 'Next (→)', onclick: (e) => { e.stopPropagation(); step(1); } }, '›');
    const count = h('span', { class: 'pv-count' });
    const stage = h('div', { class: 'pv-body' }, slot, prevB, nextB, count);
    const nameEl = h('b', { class: 'grow' }), infoEl = h('span', { class: 'dim small nowrap' }), dlA = h('a', { class: 'btn sm primary' }, '⬇ Download');
    const close = () => { stopMedia(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); modal.remove(); document.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', fsPaint); stopPolls(); if (dirty) reload(); };
    // full screen: the file alone on the whole screen; going to the next one keeps it (the same element stays full screen)
    const fsBtn = h('button', { class: 'sm', title: 'Full screen (F)' }, '⛶ Full screen');
    const toggleFs = () => {
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
      else if (media && media.webkitEnterFullscreen) media.webkitEnterFullscreen();          // iPhone: the video itself
    };
    const fsPaint = () => { fsBtn.textContent = document.fullscreenElement ? '⛶ Exit full screen' : '⛶ Full screen'; };
    fsBtn.onclick = toggleFs;
    document.addEventListener('fullscreenchange', fsPaint);
    const stopMedia = () => { if (media && media.pause) { try { media.pause(); media.removeAttribute('src'); media.load && media.load(); } catch { /* gone */ } } media = null; };
    function step(d) {
      const n = i + d;
      if (n < 0 || n >= files.length) { stage.classList.remove('bump'); void stage.offsetWidth; stage.classList.add('bump'); return; }
      i = n; x = files[i]; stopMedia(); stopPolls();
      slot.classList.remove('in-l', 'in-r'); void slot.offsetWidth; slot.classList.add(d > 0 ? 'in-r' : 'in-l');
      paintHead(); show(); loadC();
    }
    const key = (e) => { if (e.target.closest && e.target.closest('textarea,input')) return; if (e.key === 'Escape') { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else close(); } if (e.key === 'f' || e.key === 'F') toggleFs(); if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); };
    document.addEventListener('keydown', key);
    // swipe (touch / pen) left or right; not when it starts on a video's controls at the bottom
    let sw = null;
    stage.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; const r = stage.getBoundingClientRect(); if (e.target.tagName === 'VIDEO' && e.clientY > r.bottom - 70) return; sw = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    stage.addEventListener('pointerup', (e) => { if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y, dt = Date.now() - sw.t; sw = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 800) step(dx < 0 ? 1 : -1); });
    stage.addEventListener('pointercancel', () => { sw = null; });
    // scroll wheel / trackpad: sideways always; up and down too on photos and videos (PDFs and text scroll themselves)
    let wheelAt = 0, wheelSum = 0;
    stage.addEventListener('wheel', (e) => {
      const flat = ['image', 'video', 'audio'].includes(x.kind) || !['pdf', 'text'].includes(x.kind);
      const side = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!side && !flat) return;
      e.preventDefault();
      if (Date.now() - wheelAt < 450) return;
      wheelSum += side ? e.deltaX : e.deltaY;
      if (Math.abs(wheelSum) > 40) { wheelAt = Date.now(); const d = wheelSum > 0 ? 1 : -1; wheelSum = 0; step(d); }
    }, { passive: false });
    function paintHead() {
      nameEl.textContent = x.name; nameEl.title = x.path;
      infoEl.textContent = size(x.size) + (x.by ? ' · ' + x.by : '');
      dlA.href = fileUrl(true);
      count.textContent = files.length > 1 ? `${i + 1} / ${files.length}` : '';
      prevB.hidden = i === 0; nextB.hidden = i >= files.length - 1;
      atBox.style.display = x.kind === 'video' || x.kind === 'audio' ? 'flex' : 'none';
    }
    async function show() {
      const my = ++seq, still = () => my === seq;
      fill(slot, h('p', { class: 'dim' }, 'Loading…'));
      if (x.kind === 'pdf') { fill(slot, h('iframe', { src: fileUrl(false) })); return; }
      if (x.kind === 'text') { try { const t = await (await fetch(fileUrl(false), { credentials: 'same-origin' })).text(); if (still()) fill(slot, h('pre', {}, t.slice(0, 500000))); } catch (e) { if (still()) fill(slot, h('p', {}, e.message)); } return; }
      if (!['image', 'video', 'audio'].includes(x.kind)) { fill(slot, h('div', { class: 'empty' }, h('p', {}, 'This kind of file cannot be shown in the browser.'), h('a', { class: 'btn primary', href: fileUrl(true) }, '⬇ Download ' + size(x.size)))); return; }
      const j = await api('GET', pvUrl() + '&check=1').catch((e) => ({ error: e.message }));
      if (!still()) return;
      if (j.error) { fill(slot, h('div', { class: 'empty' }, h('p', {}, j.error), h('a', { class: 'btn primary', href: fileUrl(true) }, '⬇ Download'))); return; }
      if (j._status === 202) { fill(slot, h('div', { class: 'empty' }, h('p', {}, `Making a preview of this ${x.kind} for the browser… ${j.progress || 0}%`), h('p', { class: 'dim small' }, 'Large camera files take a while the first time. Go to another file and come back later.'))); polls.push(setTimeout(() => { if (still()) show(); }, 3000)); return; }
      if (x.kind === 'image') { media = h('img', { src: pvUrl(), alt: x.name, draggable: 'false' }); media.addEventListener('dblclick', toggleFs); }
      else media = h(x.kind, { src: pvUrl(), controls: true, autoplay: true, preload: 'metadata', playsinline: true });
      fill(slot, media);
      // the next photo loads in the background, so swiping on is quick
      const nx = files[i + 1]; if (nx && nx.kind === 'image') { const im = new Image(); im.src = `${B}/preview?path=${enc(nx.path)}${Q}`; }
    }
    // comments
    const list = h('div', { class: 'comments' }), txt = h('textarea', { rows: 3, placeholder: 'Comment…' }), atTc = h('input', { type: 'checkbox', checked: true });
    const atBox = h('label', { class: 'small dim', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, atTc, 'At the current time');
    async function loadC() {
      if (lk) return;
      const forPath = x.path;
      let r; try { r = await api('GET', `/api/share/${enc(id)}/comments?path=${enc(forPath)}`); } catch (e) { fill(list, h('p', { class: 'err' }, e.message)); return; }
      if (forPath !== x.path) return;
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
    const modal = h('div', { class: 'modal' }, h('div', { class: 'pv' + (lk ? ' no-side' : '') },
      h('div', { class: 'pv-main' }, h('div', { class: 'pv-head' }, nameEl, infoEl, fsBtn, dlA, h('button', { class: 'sm', onclick: close }, '✕')), stage),
      lk ? null : h('div', { class: 'pv-side' }, h('h3', {}, 'Comments'), list, h('div', { class: 'cform' }, txt, atBox, h('button', { class: 'primary sm', onclick: addC }, 'Comment')))));
    document.body.append(modal);
    paintHead(); show(); loadC();
    // the first time: how to go to the next file
    let hinted = false; try { hinted = localStorage.getItem('rfp-share-swipe') === '1'; localStorage.setItem('rfp-share-swipe', '1'); } catch { hinted = true; }
    if (!hinted && files.length > 1) { const tip = h('div', { class: 'pv-tip' }, matchMedia('(pointer: coarse)').matches ? 'Swipe left or right for the next file' : 'Use ← → (or scroll) for the next file · F for full screen'); stage.append(tip); setTimeout(() => tip.remove(), 3500); }
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
      sidePanel('Emails', h('label', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, cb, 'Send me an email when files or comments are added to this folder (at most one every 10 minutes). You always get an email when someone sends files to you.'));
      return;
    }
    const info = await api('GET', `/api/share/${enc(id)}`).catch((e) => { oops(e); return null; });
    if (!info) return;
    const emails = h('textarea', { rows: 3, placeholder: 'one@example.com, two@example.com' }), role = h('select', {}, h('option', { value: 'viewer' }, 'Can look and download'), h('option', { value: 'editor' }, 'Can also add, rename, move and delete files')), note = h('textarea', { rows: 2, placeholder: 'A message in the invite (optional)' });
    const out = h('div', {});
    const members = h('div', {}, (info.members || []).length ? info.members.map((m) => h('div', { class: 'mem' }, h('div', {}, h('div', {}, m.email), h('div', { class: 'dim small' }, (m.accepted ? '✓ Has opened the folder' : 'Has not opened the invitation yet') + ' · invited ' + when(m.at))),
      h('select', { onchange: async (e) => { try { await api('PUT', `/api/share/${enc(id)}/people/${enc(m.email)}`, { role: e.target.value }); toast('Saved'); } catch (err) { oops(err); } } }, ['viewer', 'editor'].map((v) => h('option', { value: v, selected: m.role === v }, v === 'viewer' ? 'Can look' : 'Can add files'))),
      h('button', { class: 'sm ghost danger', title: 'Remove', onclick: async () => { if (!(await sure(`Take away ${m.email}'s access?`, 'They can no longer open this folder, and their invitation link stops working.', 'Take away access'))) return; try { await api('DELETE', `/api/share/${enc(id)}/people/${enc(m.email)}`); peoplePanel(id, s, reload); } catch (err) { oops(err); } } }, '✕')))
      : h('p', { class: 'dim' }, 'Nobody invited yet. The production team (Producers and Admins) always has access.'));
    sidePanel('Who has access', h('div', {},
      h('p', { class: 'dim small', style: { marginTop: 0 } }, 'Invite someone by email. They get a link, and sign in with Google or make a password the first time.'),
      h('label', { class: 'f' }, h('span', {}, 'Their email addresses'), emails), h('label', { class: 'f' }, h('span', {}, 'What they can do'), role), h('label', { class: 'f' }, h('span', {}, 'A message in the email (optional)'), note),
      h('button', { class: 'primary', onclick: async () => {
        try {
          const r = await api('POST', `/api/share/${enc(id)}/people`, { emails: emails.value, role: role.value, note: note.value });
          emails.value = ''; note.value = '';
          fill(out, r.added.length ? h('p', { class: 'ok' }, `Invited ${r.added.length}${r.mailed ? `, ${r.mailed} emailed` : ''}.`) : h('p', { class: 'dim' }, 'Already invited (their role was updated).'),
            r.links.length && r.mailed < r.links.length ? [h('p', { class: 'dim small' }, 'Email is not set up (or did not go out): send them their link yourself:'), r.links.map((l) => h('div', { class: 'small' }, l.email + ': ', h('a', { href: l.url }, l.url)))] : null);
          setTimeout(() => peoplePanel(id, s, reload).then(() => document.querySelector('.side-panel').append(out)), 300);
        } catch (e) { oops(e); }
      } }, 'Send the invitation'), out,
      h('h2', { style: { marginTop: '22px' } }, 'People invited'), members,
      h('h2', { style: { marginTop: '22px' } }, 'Folder settings'),
      (() => {
        const nm = h('input', { value: s.name }), ex = h('input', { type: 'date', value: s.expires || '', min: new Date(Date.now() + 864e5).toISOString().slice(0, 10) });
        return [h('label', { class: 'f' }, h('span', {}, 'Name'), nm), h('label', { class: 'f' }, h('span', {}, 'Delete it automatically on (leave empty to keep it)'), ex),
          h('p', { class: 'dim small' }, 'On that day the folder and its files are removed for everyone. Three days before, the invited people get an email to download what they need.'),
          h('div', { class: 'row', style: { marginBottom: '10px' } }, h('button', { class: 'sm primary', onclick: async () => { try { await api('PUT', `/api/share/${enc(id)}`, { name: nm.value, expires: ex.value }); toast('Saved'); document.querySelector('.side-panel').remove(); reload(); } catch (e) { oops(e); } } }, 'Save'))];
      })(),
      h('div', { class: 'row' },
        h('button', { class: 'sm danger', onclick: async () => { if (!(await sure(`Delete “${s.name}” for everyone?`, 'Nobody can open it any more. The production team can still get the files back for 30 days.', 'Delete the folder'))) return; try { await api('DELETE', `/api/share/${enc(id)}`); document.querySelector('.side-panel').remove(); go('/'); } catch (e) { oops(e); } } }, 'Delete this folder'))));
  }
  // ---------------------------------------------------------------- "anyone with the link" (1.8.3)
  // The links of a folder: make one to this folder (or the file / sub-folder picked), copy it, see views and downloads,
  // and change its password, end date, switch it off, give it a new address or delete it.
  const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  // (a browser may refuse to copy straight after making the link: then the new link is at the top with its Copy button)
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Link copied: paste it in WhatsApp, an email …'); return true; } catch { return false; } };
  const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  function endPicker(value = '') {
    const sel = h('select', {}, [['', 'Never'], ['1', 'In 1 day'], ['7', 'In 7 days'], ['30', 'In 30 days'], ['date', 'On a date…']].map(([v, l]) => h('option', { value: v }, l)));
    const date = h('input', { type: 'date', min: new Date().toISOString().slice(0, 10), value: value || '', style: { display: value ? '' : 'none' } });
    if (value) sel.value = 'date';
    sel.onchange = () => { date.style.display = sel.value === 'date' ? '' : 'none'; };
    return { el: h('div', { class: 'row', style: { gap: '8px' } }, sel, date), value: () => (sel.value === 'date' ? date.value : sel.value ? plusDays(Number(sel.value)) : '') };
  }
  async function linksPanel(id, s, target) {
    const r = await api('GET', `/api/share/${enc(id)}/links`).catch((e) => { oops(e); return null; });
    if (!r) return;
    target = target || '';
    const again = () => linksPanel(id, s, target);
    const pw = h('input', { type: 'text', placeholder: 'Leave empty for no password', autocomplete: 'off' }), ends = endPicker();
    const what = target ? target.split('/').pop() : s.name;
    const make = h('button', { class: 'primary', onclick: async () => {
      make.disabled = true;
      try { const x = await api('POST', `/api/share/${enc(id)}/links`, { path: target, password: pw.value, expires: ends.value() }); if (!(await copy(x.link.url))) toast('Link made: press Copy next to it'); again(); } catch (e) { oops(e); make.disabled = false; }
    } }, '🔗 Make the link and copy it');
    const put = async (l, body, msg) => { try { await api('PUT', `/api/share/${enc(id)}/links/${enc(l.id)}`, body); if (msg) toast(msg); again(); } catch (e) { oops(e); } };
    const card = (l) => {
      const state = !l.on ? 'Switched off' : l.expired ? 'Ended ' + day(l.expires) : 'Working';
      return h('div', { class: 'lnk' + (!l.on || l.expired ? ' off' : '') + (l.path === target ? ' here' : '') },
        h('div', { class: 'spread' }, h('b', {}, (l.kind === 'file' ? '📄 ' : '📁 ') + (l.name || s.name)), h('span', { class: 'pill' + (l.on && !l.expired ? ' editor' : '') }, state)),
        l.path ? h('div', { class: 'dim small' }, 'in ' + s.name + ' / ' + l.path) : h('div', { class: 'dim small' }, 'the whole shared folder'),
        h('div', { class: 'row', style: { gap: '6px', margin: '8px 0' } }, h('input', { value: l.url, readonly: true, onclick: (e) => e.target.select(), style: { flex: 1, minWidth: 0 } }), h('button', { class: 'sm primary', onclick: async (e) => { if (!(await copy(l.url))) { const i = e.currentTarget.previousSibling; i.select(); toast('Press Ctrl+C (or hold and Copy) to copy it'); } } }, 'Copy')),
        h('div', { class: 'dim small' }, `👁 ${l.views} view${l.views === 1 ? '' : 's'} · ⬇ ${l.downloads} download${l.downloads === 1 ? '' : 's'}` + (l.lastAt ? ' · last ' + when(l.lastAt) : ''),
          l.password ? ' · 🔒 password' : '', l.expires && !l.expired ? ' · ends ' + day(l.expires) : ''),
        h('div', { class: 'row', style: { gap: '6px', marginTop: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'sm', onclick: () => put(l, { on: !l.on }, l.on ? 'Switched off: the link no longer opens' : 'Switched on') }, l.on ? 'Switch off' : 'Switch on'),
          h('button', { class: 'sm', onclick: async () => { const i = h('input', { type: 'text', autocomplete: 'off', placeholder: 'At least 4 characters' }); const v = await dialog({ title: l.password ? 'Change the password' : 'Add a password', text: 'Give the password to the people with the link. Leave it empty to take the password away.', body: h('label', { class: 'f' }, h('span', {}, 'Password'), i), ok: 'Save', onOk: () => i.value.trim() }); if (v === false) return; put(l, { password: v }, v ? 'Password set: give it to them with the link' : 'Password removed'); } }, l.password ? 'Password…' : 'Add a password…'),
          h('button', { class: 'sm', onclick: async () => { const e = endPicker(l.expired ? '' : l.expires); const ok = await dialog({ title: 'When should the link stop working?', body: e.el, ok: 'Save' }); if (ok) put(l, { expires: e.value() }, 'Saved'); } }, 'End date…'),
          h('button', { class: 'sm', title: 'The old link stops working; share the new one', onclick: async () => { if (!(await sure('Give it a new address?', 'The link you shared stops working. Anyone who should still have it needs the new one.', 'New address'))) return; put(l, { newKey: true }, 'New address made: copy it below'); } }, 'New address'),
          h('button', { class: 'sm ghost danger', onclick: async () => { if (!(await sure('Delete this link?', 'It stops working for everyone who has it. The files stay in the folder.'))) return; try { await api('DELETE', `/api/share/${enc(id)}/links/${enc(l.id)}`); toast('Link deleted'); again(); } catch (e) { oops(e); } } }, 'Delete')));
    };
    const mineFirst = r.links.slice().sort((a, b) => (b.path === target) - (a.path === target) || b.at - a.at);
    sidePanel('Share a link', h('div', {},
      h('p', { class: 'dim small', style: { marginTop: 0 } }, 'Anyone with the link can look, play and download – no account, no signing in. They cannot upload, change or delete anything, or see who has access.'),
      h('div', { class: 'card', style: { padding: '14px', marginBottom: '16px' } },
        h('div', { class: 'small dim' }, 'A link to'), h('h3', { style: { margin: '2px 0 10px' } }, (target && !/\/$/.test(target) && /\.[^/]+$/.test(target) ? '📄 ' : '📁 ') + what),
        h('label', { class: 'f' }, h('span', {}, 'Password (optional)'), pw), h('label', { class: 'f' }, h('span', {}, 'Stops working'), ends.el), make),
      h('h2', { style: { marginTop: '6px' } }, `Links in this folder (${r.links.length})`),
      r.links.length ? mineFirst.map(card) : h('p', { class: 'dim' }, 'No links yet.')));
  }

  // what someone with a link sees: one file (to play or look at, and download) or a folder (browse, preview, download)
  async function linkPage(key, rel) {
    const main = $('main'), KEY = 'rfp-link:' + key;
    let t = ''; try { t = sessionStorage.getItem(KEY) || ''; } catch { t = ''; }
    const base = '/api/sharing/link/' + enc(key), q = t ? '&t=' + enc(t) : '';
    let r;
    try { r = await api('GET', `${base}?path=${enc(rel)}${q}`); } catch (e) {
      if (e.status === 401 && t) { try { sessionStorage.removeItem(KEY); } catch { /* fine */ } return linkPage(key, rel); }
      fill(main, h('div', { class: 'card narrow' }, h('h1', {}, e.status === 410 ? 'This link has stopped working' : 'This link does not open'), h('p', {}, e.message))); return;
    }
    $('prod').textContent = r.from || '';
    document.title = r.name + ' · File Sharing';
    const head = (sub) => [h('div', { class: 'dim small' }, (r.from ? r.from + ' shared ' : 'Shared ') + (r.kind === 'file' ? 'a file' : 'a folder') + ' with you'), h('h1', { class: 'ftitle' }, sub || r.name)];
    if (r.needsPassword) {
      const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'off' }), err = h('p', { class: 'err' });
      const go2 = async () => { err.textContent = ''; try { const x = await api('POST', `${base}/unlock`, { password: pw.value }); try { sessionStorage.setItem(KEY, x.t); } catch { /* fine */ } linkPage(key, rel); } catch (e) { err.textContent = e.message; } };
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go2(); });
      fill(main, h('div', { class: 'card narrow' }, head(), h('p', {}, '🔒 This link needs a password. Ask whoever sent it to you.'), h('label', { class: 'f' }, h('span', {}, 'Password'), pw), err, h('button', { class: 'primary', onclick: go2 }, 'Open')));
      setTimeout(() => pw.focus(), 50);
      return;
    }
    const lk = { base, q };
    const fileUrl = (x, dl) => `${base}/file?path=${enc(x.path)}${dl ? '' : '&download=0'}${q}`;
    const note = h('p', { class: 'dim small' }, 'You can look and download. ', r.expires ? 'This link works until ' + day(r.expires) + '. ' : '', r.folderExpires ? 'The files are removed on ' + day(r.folderExpires) + ': download what you want to keep.' : '');
    if (r.file) {
      const x = r.file, slot = h('div', { class: 'lk-media' }, h('p', { class: 'dim' }, 'Loading…'));
      fill(main, h('div', { class: 'lk-file' }, head(x.name), h('div', { class: 'row', style: { gap: '10px', margin: '6px 0 14px' } }, h('a', { class: 'btn primary', href: fileUrl(x, true) }, '⬇ Download ' + size(x.size))), slot, note));
      const show = async () => {
        if (x.kind === 'pdf') return fill(slot, h('iframe', { src: fileUrl(x, false) }));
        if (!['image', 'video', 'audio'].includes(x.kind)) return fill(slot, h('div', { class: 'empty' }, h('p', {}, 'This kind of file cannot be shown in the browser: download it.')));
        const pv = `${base}/preview?path=${enc(x.path)}${q}`;
        const j = await api('GET', pv + '&check=1').catch((e) => ({ error: e.message }));
        if (j.error) return fill(slot, h('div', { class: 'empty' }, h('p', {}, j.error)));
        if (j._status === 202) { fill(slot, h('div', { class: 'empty' }, h('p', {}, `Getting the ${x.kind} ready for the browser… ${j.progress || 0}%`))); polls.push(setTimeout(show, 3000)); return; }
        fill(slot, x.kind === 'image' ? h('img', { src: pv, alt: x.name }) : h(x.kind, { src: pv, controls: true, preload: 'metadata', playsinline: true }));
      };
      show();
      return;
    }
    const url = (p) => '/l/' + key + '/' + (p ? p.split('/').map(enc).join('/') : '');
    const parts = r.path ? r.path.split('/') : [];
    const crumbs = h('div', { class: 'crumbs' }, h('a', { href: BASE + url(''), onclick: (e) => { e.preventDefault(); go(url('')); } }, r.name),
      parts.map((x, i) => { const p = parts.slice(0, i + 1).join('/'); return [h('i', {}, '/'), h('a', { href: BASE + url(p), onclick: (e) => { e.preventDefault(); go(url(p)); } }, x)]; }));
    const files = r.items.filter((x) => !x.dir);
    const zipUrl = (paths) => `${base}/zip?` + paths.map((p) => 'p=' + enc(p)).join('&') + q;
    const open = (x) => (x.dir ? go(url(x.path)) : preview(null, files, files.indexOf(x), null, () => {}, lk));
    const thumb = (x) => {
      const t2 = h('div', { class: 'thumb' + (x.dir ? ' folder' : '') + ' k-' + x.kind }, h('span', { class: 'tlabel' }, x.dir ? '📁' : (x.name.split('.').pop() || '').toUpperCase().slice(0, 5)));
      if (!x.dir && (x.kind === 'image' || (x.kind === 'video' && r.ffmpeg))) { const im = h('img', { alt: '', loading: 'lazy', src: `${base}/thumb?path=${enc(x.path)}${q}` }); im.onload = () => t2.classList.add('has'); im.onerror = () => im.remove(); t2.prepend(im); }
      return t2;
    };
    const list = !r.items.length ? h('div', { class: 'empty big-empty' }, h('div', { class: 'em-ico' }, '📂'), h('h2', {}, 'This folder is empty'))
      : h('table', { class: 'files' }, h('tbody', {}, r.items.map((x) => h('tr', { class: 'click', tabindex: 0, onclick: () => open(x), onkeydown: (e) => { if (e.key === 'Enter') open(x); } },
        h('td', {}, h('div', { class: 'fname' }, thumb(x), h('div', { style: { minWidth: 0 } }, h('span', { class: 'fn' }, x.name), h('div', { class: 'dim small show-sm' }, x.dir ? 'Folder' : size(x.size))))),
        h('td', { class: 'r nowrap dim hide-xs' }, x.dir ? '' : size(x.size)),
        h('td', { class: 'r' }, h('a', { class: 'ico', title: x.dir ? 'Download the folder as a ZIP' : 'Download', href: x.dir ? zipUrl([x.path]) : fileUrl(x, true), onclick: (e) => e.stopPropagation() }, '⬇'))))));
    fill(main, h('div', {}, parts.length ? crumbs : null, head(parts.length ? parts[parts.length - 1] : r.name), note,
      h('div', { class: 'toolbar' }, r.items.length ? h('a', { class: 'btn sm primary', href: zipUrl([r.path]) }, '⬇ Download everything (ZIP)') : null), list));
  }

  // History: the uploads (who sent what, to whom) and everything else that happened, in plain sentences
  async function historyPanel(id) {
    const [tx, ac] = await Promise.all([api('GET', '/api/share-transfers?share=' + enc(id)).catch(() => ({ transfers: [] })), api('GET', `/api/share/${enc(id)}/activity`).catch((e) => { oops(e); return null; })]);
    if (!ac) return;
    const W = { transfer: 'sent files to', edit: 'changed the folder:', create: 'made this shared folder', upload: 'added', folder: 'made the folder', delete: 'deleted', move: 'moved or renamed', comment: 'commented on', download: 'downloaded', invite: 'invited', uninvite: 'took away access for',
      link: 'made or switched on a link to', unlink: 'removed or switched off the link to', 'link-open': 'opened the link to', 'link-download': 'downloaded through a link:' };
    const body = h('div', {});
    let tab = 'uploads';
    const paint = () => fill(body, h('div', { class: 'tabs2', style: { marginBottom: '12px' } }, h('button', { class: tab === 'uploads' ? 'on' : '', onclick: () => { tab = 'uploads'; paint(); } }, `Uploads (${tx.transfers.length})`), h('button', { class: tab === 'all' ? 'on' : '', onclick: () => { tab = 'all'; paint(); } }, 'Everything')),
      tab === 'uploads' ? transferList(tx.transfers, { compact: true })
        : ac.activity.length ? ac.activity.filter((a) => a.what !== 'upload' || !a.quiet).map((a) => h('div', { class: 'act' }, h('b', {}, a.name || a.email || 'Someone'), ' ', W[a.what] || a.what, ' ', a.target ? h('b', {}, a.target + (a.role ? ` (${a.role === 'editor' ? 'can add files' : 'can view'})` : '')) : null, a.path ? h('span', { class: 'ok' }, ' ' + a.path) : null,
          a.count ? h('span', { class: 'dim' }, ` (${a.count} file${a.count === 1 ? '' : 's'})`) : null,
          a.text ? h('div', { class: 'dim small' }, '“' + a.text + '”' + (a.tc != null ? ' at ' + tcText(a.tc) : '')) : null, h('div', { class: 'dim' }, when(a.at)))) : h('p', { class: 'dim' }, 'Nothing has happened yet.'));
    paint();
    sidePanel('History', body);
  }

  (async () => { try { CFG = await api('GET', '/api/config'); } catch { CFG = {}; } route(); })();
})();
