/* Boot: sign-in screens, first-run setup, then the app. */
'use strict';
(() => {
  const root = document.getElementById('app');
  const fail = (box, e) => { box.textContent = e.message || String(e); box.classList.remove('hide'); };

  function googleButton(holder, errBox) {
    if (!App.cfg.googleClientId) return false;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => {
      try {
        google.accounts.id.initialize({ client_id: App.cfg.googleClientId, callback: async (resp) => { try { await api('POST', '/api/auth/google', { credential: resp.credential }); start(); } catch (e) { fail(errBox, e); } } });
        google.accounts.id.renderButton(holder, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 320 });
      } catch (e) { holder.textContent = 'Google sign-in could not load.'; }
    };
    s.onerror = () => { holder.replaceChildren(h('span', { class: 'dim small' }, 'Google sign-in needs an internet connection. Use your email and password instead.')); };
    document.head.append(s);
    return true;
  }

  function login() {
    const c = App.cfg, local = c.mode === 'local';
    const err = h('div', { class: 'toast error hide', role: 'alert', style: { marginBottom: '12px' } });
    const gHolder = h('div', { style: { display: 'flex', justifyContent: 'center', minHeight: '44px' } });
    const hasGoogle = googleButton(gHolder, err);
    const f = { email: '', password: '', name: '' };
    let mode = c.needsSetup ? 'create' : 'signin';
    const box = h('div', {});
    const paint = () => {
      const create = mode === 'create';
      const submit = async (ev) => { ev.preventDefault(); err.classList.add('hide'); try { await api('POST', create ? '/api/auth/signup' : '/api/auth/login', f); start(); } catch (e) { fail(err, e); } };
      box.replaceChildren(...[
        c.needsSetup ? h('p', { class: 'dim' }, 'First run on this machine. Create the first account here, or link this machine to your website to bring your account and data down.') : null,
        hasGoogle && !c.needsSetup ? h('div', {}, gHolder, (local || c.allowSignup) ? h('div', { class: 'or' }, 'or') : null) : null,
        !hasGoogle && !local && !c.allowSignup ? h('p', { class: 'toast error' }, 'Google sign-in is not set up yet. Add GOOGLE_CLIENT_ID to the server (see the README).') : null,
        (local || c.allowSignup || !hasGoogle) ? h('form', { class: 'stack', onsubmit: submit },
          create ? h('label', { class: 'f' }, h('span', {}, 'Your name'), h('input', { autocomplete: 'name', oninput: (e) => { f.name = e.target.value; } })) : null,
          h('label', { class: 'f' }, h('span', {}, 'Email'), h('input', { type: 'email', required: true, autocomplete: 'username', value: f.email, oninput: (e) => { f.email = e.target.value; } })),
          h('label', { class: 'f' }, h('span', {}, create ? 'Password (8+ characters)' : 'Password'), h('input', { type: 'password', required: true, autocomplete: create ? 'new-password' : 'current-password', oninput: (e) => { f.password = e.target.value; } })),
          h('button', { class: 'primary', type: 'submit', style: { width: '100%' } }, create ? 'Create account' : 'Sign in'),
          c.allowSignup && !c.needsSetup ? h('button', { type: 'button', class: 'ghost', style: { width: '100%' }, onclick: () => { mode = create ? 'signin' : 'create'; paint(); } }, create ? 'I already have an account' : 'Create an account') : null) : null,
        c.needsSetup ? linkBox(err) : null,
        local && !c.needsSetup ? h('p', { class: 'dim small', style: { marginTop: '12px', marginBottom: 0 } }, 'Accounts for this PC are kept on this PC. Forgot the password? Click in the black RFP Manager window and press P to set a new one.') : null].filter(Boolean));
    };
    paint();
    root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box card' }, h('div', { class: 'brand', style: { padding: 0 } }, h('span', { class: 'dot' }), c.name), h('h1', {}, c.needsSetup ? 'Set up this machine' : 'Sign in'),
      h('p', { class: 'dim', style: { marginTop: '4px' } }, local ? 'Production PC' : 'Live production management'), err, box)));
  }

  function linkBox(err) {
    const f = { url: '', key: '' };
    return h('div', {}, h('div', { class: 'or' }, 'or link to your website'), h('form', { class: 'stack', onsubmit: async (ev) => {
      ev.preventDefault(); err.classList.add('hide');
      try {
        const r = await api('POST', '/api/setup/link', f);
        if (r.error) throw new Error('Could not sync: ' + r.error);
        if (!r.users) throw new Error('Linked, but no accounts came down. Check that the key belongs to an Admin.');
        location.reload();
      } catch (e) { fail(err, e); }
    } },
    h('label', { class: 'f' }, h('span', {}, 'Website address'), h('input', { placeholder: 'https://your-site.onrender.com', required: true, oninput: (e) => { f.url = e.target.value; } })),
    h('label', { class: 'f' }, h('span', {}, 'Machine key (website → Settings → Machine keys)'), h('input', { placeholder: 'mk_…', required: true, autocomplete: 'off', oninput: (e) => { f.key = e.target.value; } })),
    h('button', { type: 'submit', style: { width: '100%' } }, 'Link this machine')));
  }

  function noTeam() {
    const f = { name: '' };
    root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box card' }, h('h1', {}, 'Create your production team'),
      h('p', { class: 'dim' }, `Signed in as ${App.me.email}. A production team holds your clubs, fixtures, productions and crew. If a colleague already has one, ask them to add your email under Settings → Members instead.`),
      h('form', { class: 'stack', onsubmit: async (ev) => { ev.preventDefault(); try { await api('POST', '/api/orgs', f); start(); } catch (e) { oops(e); } } },
        h('label', { class: 'f' }, h('span', {}, 'Production team name'), h('input', { required: true, placeholder: 'RegemarkFP', oninput: (e) => { f.name = e.target.value; } })),
        h('button', { class: 'primary', type: 'submit', style: { width: '100%' } }, 'Create'),
        h('button', { type: 'button', class: 'ghost', style: { width: '100%' }, onclick: async () => { await api('POST', '/api/auth/logout'); location.reload(); } }, 'Sign out')))));
  }

  async function start() {
    try {
      App.cfg = await api('GET', '/api/config');
      document.title = App.cfg.name;
      try { await App.loadMe(); } catch (e) { if (e.status === 401) return login(); throw e; }
      if (!App.teams.length) return noTeam();
      // Signed in after following a screen link (pc-name/scorer …): go back to that screen.
      const next = new URLSearchParams(location.search).get('next');
      if (next && /^\/(?!\/)[\w\-./?=&%]*$/.test(next)) { location.replace(next); return; }
      let want = null;
      try { want = localStorage.getItem('rfp.team'); } catch { /* private window */ }
      await App.selectTeam((App.teams.find((t) => t.id === want) || App.teams[0]).id);
      route();
    } catch (e) {
      root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box card' }, h('h1', {}, 'Cannot start'), h('p', {}, e.message), h('button', { class: 'primary', onclick: () => location.reload() }, 'Try again'))));
    }
  }
  start();
})();
