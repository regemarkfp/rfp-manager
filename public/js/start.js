/* Boot: sign-in screens, first-run setup, then the app. */
'use strict';
(() => {
  const root = document.getElementById('app');
  const fail = (box, e) => { box.textContent = e.message || String(e); box.classList.remove('hide'); };

  // Google only accepts sign-ins on addresses it was told about: on a production PC that is http://localhost:<port>.
  const localOnly = () => App.cfg.mode === 'local' && location.hostname !== 'localhost';
  function googleButton(holder, errBox, busyText) {
    if (!App.cfg.googleClientId) return false;
    if (localOnly()) {
      holder.replaceChildren(h('p', { class: 'dim small', style: { margin: 0, textAlign: 'center' } }, 'Google sign-in works on the production PC itself (', ['127.0.0.1', '::1', '[::1]'].includes(location.hostname) ? h('a', { href: `http://localhost:${location.port}${location.pathname}${location.search}` }, 'open it as localhost') : 'the RFP Manager app, or http://localhost:' + (location.port || 80), '). Here, use your email and password.'));
      return true;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => {
      try {
        google.accounts.id.initialize({ client_id: App.cfg.googleClientId, callback: async (resp) => {
          errBox.classList.add('hide');
          const was = [...holder.childNodes];
          holder.replaceChildren(h('p', { class: 'dim', style: { margin: 0, textAlign: 'center' } }, busyText || 'Signing in…'));
          try { await api('POST', '/api/auth/google', { credential: resp.credential }); start(); } catch (e) { holder.replaceChildren(...was); fail(errBox, e); }
        } });
        google.accounts.id.renderButton(holder, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 320 });
        // the website: if the Google window is blocked (in-app browsers), sign in on this page instead
        if (App.cfg.mode === 'cloud') {
          const wrap = holder.parentNode;
          const alt = h('p', { class: 'dim small', style: { textAlign: 'center', margin: '8px 0 0' } }, h('a', { href: '#', onclick: (e) => {
            e.preventDefault();
            try { const nx = new URLSearchParams(location.search).get('next'); if (nx) sessionStorage.setItem('rfp-next', nx); } catch (er) { /* ignore */ }
            google.accounts.id.initialize({ client_id: App.cfg.googleClientId, ux_mode: 'redirect', login_uri: location.origin + '/api/auth/google/redirect' });
            holder.replaceChildren();
            google.accounts.id.renderButton(holder, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 320 });
            alt.textContent = 'Now press the Google button: you sign in on Google\'s page and come back here.';
          } }, 'Sign-in window blocked? Sign in on this page instead'));
          if (wrap) wrap.insertBefore(alt, holder.nextSibling);
          const er = new URLSearchParams(location.search).get('signin_error');
          if (er) fail(errBox, new Error(er));
        }
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
    const hasGoogle = googleButton(gHolder, err, local && !c.linked ? 'Signing in and linking this PC to the website… A free website can take up to a minute to wake up.' : 'Signing in…');
    const f = { email: '', password: '', name: '' };
    let mode = c.needsSetup ? 'create' : 'signin';
    const box = h('div', {});
    const paint = () => {
      const create = mode === 'create';
      const submit = async (ev) => { ev.preventDefault(); err.classList.add('hide'); try { await api('POST', create ? '/api/auth/signup' : '/api/auth/login', f); start(); } catch (e) { fail(err, e); } };
      if (c.needsSetup) {
        // first run: link to the website (sign in there) is the usual way; an account for this PC only is the other
        const localForm = h('form', { class: 'stack', onsubmit: submit },
          h('label', { class: 'f' }, h('span', {}, 'Your name'), h('input', { autocomplete: 'name', oninput: (e) => { f.name = e.target.value; } })),
          h('label', { class: 'f' }, h('span', {}, 'Email'), h('input', { type: 'email', required: true, autocomplete: 'username', value: f.email, oninput: (e) => { f.email = e.target.value; } })),
          h('label', { class: 'f' }, h('span', {}, 'Password (8+ characters)'), h('input', { type: 'password', required: true, autocomplete: 'new-password', oninput: (e) => { f.password = e.target.value; } })),
          h('button', { class: 'primary', type: 'submit', style: { width: '100%' } }, 'Create account'));
        const site = (c.cloudUrl || '').replace(/^https?:\/\//, '');
        box.replaceChildren(...[
          hasGoogle ? h('p', { class: 'dim', style: { marginTop: 0 } }, `First run on this machine. Sign in with Google: this PC links itself to ${site || 'your website'} and your account, teams and data come down to it. You need to be an Admin of a production team on the website.`) : null,
          hasGoogle ? gHolder : null,
          hasGoogle ? h('div', { class: 'or' }, 'or') : h('p', { class: 'dim' }, 'First run on this machine. Link it to your website: you sign in there with Google, and your account, teams and data come down to this PC.'),
          hasGoogle ? h('details', {}, h('summary', { class: 'dim small' }, 'Link by signing in on the website instead'), h('div', { style: { marginTop: '10px' } }, linkBox(err))) : linkBox(err),
          c.bridge ? null : h('details', { style: { marginTop: '14px' } }, h('summary', { class: 'dim small' }, 'Use this PC on its own (no website)'), h('div', { style: { marginTop: '10px' } }, localForm))].filter(Boolean));
        return;
      }
      box.replaceChildren(...[
        local && hasGoogle ? h('p', { class: 'dim', style: { marginTop: 0 } }, c.linked ? 'Sign in with the same Google account you use on the website.' : 'Sign in with Google to link this PC to the website and bring your teams down, or with an account on this PC.') : null,
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
    root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box card' }, h('div', { style: { textAlign: 'center', margin: '4px 0 14px' } }, h('img', { src: '/brand/rfp-logo.png', alt: c.name, style: { width: '170px', height: 'auto' } })), h('h1', {}, c.needsSetup ? 'Set up this machine' : 'Sign in'),
      h('p', { class: 'dim', style: { marginTop: '4px' } }, local ? 'Production PC' : 'Live production management'), err, box,
      c.androidApp && !/; wv\)|RFPManager/.test(navigator.userAgent) ? h('p', { class: 'small', style: { textAlign: 'center', marginTop: '16px', marginBottom: 0 } }, h('a', { href: '/app/rfp-manager.apk', download: 'rfp-manager.apk' }, '⬇ Get the Android app')) : null)));
  }

  function linkBox(err) {
    // link by signing in on the website (the PC then gets its own key); a machine key still works for those who have one
    const f = { url: App.cfg.cloudUrl || '', key: '' };
    const keyForm = h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'dim small' }, 'Link with a machine key instead'), h('form', { class: 'stack', style: { marginTop: '8px' }, onsubmit: async (ev) => {
      ev.preventDefault(); err.classList.add('hide');
      try {
        const r = await api('POST', '/api/setup/link', f);
        if (r.error) throw new Error('Could not sync: ' + r.error);
        if (!r.users) throw new Error('Linked, but no accounts came down. Check that the key belongs to an Admin.');
        location.reload();
      } catch (e) { fail(err, e); }
    } },
    h('label', { class: 'f' }, h('span', {}, 'Website address'), h('input', { value: f.url, placeholder: 'https://your-site.onrender.com', required: true, oninput: (e) => { f.url = e.target.value; } })),
    h('label', { class: 'f' }, h('span', {}, 'Machine key (website → Settings → Machine keys)'), h('input', { placeholder: 'mk_…', required: true, autocomplete: 'off', oninput: (e) => { f.key = e.target.value; } })),
    h('button', { type: 'submit', style: { width: '100%' } }, 'Link with the key')));
    return h('div', {}, App.linkFlow({ url: f.url, onDone: () => setTimeout(() => location.reload(), 2500) }), keyForm);
  }

  function noTeam() {
    // the website: someone who is not in a production team is a viewer — back to the front page, signed in
    // (only a site admin may start a new production team there)
    if (App.cfg.mode === 'cloud' && !(App.machine && App.machine.siteAdmin)) { location.replace('/'); return; }
    const f = { name: '' };
    root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box card' }, h('h1', {}, 'Create your production team'),
      h('p', { class: 'dim' }, `Signed in as ${App.me.email}. A production team holds your clubs, fixtures, productions and crew. If a colleague already has one, ask them to add your email under Settings → Members instead.`),
      h('form', { class: 'stack', onsubmit: async (ev) => { ev.preventDefault(); try { await api('POST', '/api/orgs', f); start(); } catch (e) { oops(e); } } },
        h('label', { class: 'f' }, h('span', {}, 'Production team name'), h('input', { required: true, placeholder: 'RegemarkFP', oninput: (e) => { f.name = e.target.value; } })),
        h('button', { class: 'primary', type: 'submit', style: { width: '100%' } }, 'Create'),
        App.cfg.mode === 'cloud' ? h('a', { class: 'btn', style: { width: '100%' }, href: '/' }, 'Just watching? Back to the website') : null,
        h('button', { type: 'button', class: 'ghost', style: { width: '100%' }, onclick: async () => { await api('POST', '/api/auth/logout'); location.reload(); } }, 'Sign out')))));
  }

  async function start() {
    try {
      App.cfg = await api('GET', '/api/config');
      if (App.cfg.mode === 'cloud' && location.protocol === 'https:' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
      document.title = App.cfg.name;
      try { await App.loadMe(); } catch (e) { if (e.status === 401) return login(); throw e; }
      if (App.cfg.bridge && !App.machine.linked) return App.linkGate(root);
      // Signed in after following a screen link (pc-name/scorer …) or from the website: go back there.
      let next = new URLSearchParams(location.search).get('next');
      if (!next) { try { next = sessionStorage.getItem('rfp-next'); sessionStorage.removeItem('rfp-next'); } catch (e) { /* ignore */ } }
      if (next && /^\/(?!\/)[\w\-./?=&%]*$/.test(next)) { location.replace(next); return; }
      if (!App.teams.length) return noTeam();
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
