/* Remote access: production PCs on the website (#/pcs), approving a PC that asks to link (#/link/<code>),
 * and, on a production PC, linking it to the website by signing in there (App.linkFlow). */
'use strict';
(() => {
  // ---- on the production PC: "Link to the website" with a sign-in instead of a key to copy
  // opts: { url, onDone, compact }   Shows: website address → "Sign in on the website" → a code to compare → done.
  App.linkFlow = (opts = {}) => {
    const f = { url: opts.url || (App.cfg && App.cfg.cloudUrl) || '' };
    const box = h('div', { class: 'stack' });
    let poll = null;
    const stop = () => { clearInterval(poll); poll = null; };
    const err = (msg) => h('p', { class: 'toast error', style: { margin: 0 } }, msg);
    const paintStart = (problem) => {
      stop();
      box.replaceChildren(...[
        h('label', { class: 'f' }, h('span', {}, 'Website address'), h('input', { value: f.url, placeholder: 'https://your-site.onrender.com', oninput: (e) => { f.url = e.target.value.trim(); } })),
        problem ? err(problem) : null,
        h('button', { class: 'primary', style: { width: '100%' }, onclick: go }, 'Sign in on the website to link this PC'),
        h('p', { class: 'dim small', style: { margin: 0 } }, 'Opens the website. Sign in with Google there (as an Admin of your production team) and press Link. This PC then gets its own key by itself and starts syncing.')].filter(Boolean));
    };
    async function go() {
      if (!/^https?:\/\//.test(f.url)) return paintStart('Enter the website address, starting with https://');
      box.replaceChildren(h('p', { class: 'dim' }, 'Contacting ' + f.url + '… (a free website can take up to a minute to wake up)'));
      let r;
      try { r = await api('POST', '/api/link/start', { url: f.url }); } catch (e) { return paintStart(e.message); }
      if (!r.pending) return paintStart(r.error || 'Could not start linking');
      const open = () => window.open(r.pending.approveUrl, '_blank', 'noopener');
      open();
      box.replaceChildren(
        h('p', { style: { margin: 0 } }, 'On the website, sign in and check that it shows this code:'),
        h('div', { style: { font: '700 30px/1.2 ui-monospace,monospace', letterSpacing: '.12em', textAlign: 'center', padding: '10px', border: '1px solid var(--line)', borderRadius: '8px' } }, r.pending.code),
        h('p', { class: 'dim small', style: { margin: 0 } }, 'Then press "Link this PC" there. This page carries on by itself.'),
        h('div', { class: 'row' }, h('button', { onclick: open }, 'Open the website again'), h('button', { class: 'ghost', onclick: async () => { await api('POST', '/api/link/cancel').catch(() => {}); paintStart(); } }, 'Cancel')),
        h('p', { class: 'dim small', id: 'link-wait', style: { margin: 0 } }, 'Waiting for the website…'));
      poll = setInterval(async () => {
        let s;
        try { s = await api('GET', '/api/link/status'); } catch (e) { return; }
        if (s.done || (s.linked && !s.pending && !s.error)) {
          stop();
          box.replaceChildren(h('p', { class: 'toast', style: { margin: 0 } }, `Linked${s.by ? ' by ' + s.by : ''}. Bringing your data down…`));
          if (opts.onDone) opts.onDone(s); else setTimeout(() => location.reload(), 1500);
        } else if (s.error) paintStart(s.error);
      }, 2000);
    }
    paintStart();
    return box;
  };

  // ---- the website: production PCs
  App.pages.pcs = () => {
    const el = h('div', {}, pageHead('Production PCs'), h('div', { class: 'card dim' }, 'Loading…'));
    const paint = async () => {
      let r;
      try { r = await api('GET', '/api/pcs'); } catch (e) { el.replaceChildren(pageHead('Production PCs'), h('div', { class: 'card' }, e.message)); return; }
      const choose = async (id) => { try { await api('POST', '/api/pcs/choose', { id }); location.reload(); } catch (e) { oops(e); } };
      const live = [['Graphics control', '/live/control.html'], ['Scorer', '/scorer'], ['Dashboards', '/live/dash.html'], ['Timeline', '/live/timeline.html'], ['Worship', '/live/worship.html'], ['Rundown', '/rundown'], ['Confidence monitor', '/confidence']];
      el.replaceChildren(pageHead('Production PCs'),
        h('div', { class: 'card' }, h('h2', {}, 'Online now'),
          r.pcs.length ? h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('tbody', {}, r.pcs.map((p) => h('tr', {},
            h('td', {}, h('span', { class: 'led ok' }), ' ', h('b', {}, p.name), h('div', { class: 'dim small' }, `RFP Manager ${p.version} · online since ${new Date(p.since).toLocaleTimeString('en-GB')}`)),
            h('td', { class: 'right nowrap' }, p.id === r.pc ? h('span', { class: 'pill ok' }, 'In use here') : h('button', { class: 'primary sm', onclick: () => choose(p.id) }, 'Use this PC'))))))) :
            h('p', { class: 'dim' }, 'No production PC of your teams is online. Start RFP Manager on the PC and link it to this website (below).'),
          r.pcs.length && r.pc ? h('div', {}, h('h3', { style: { marginTop: '16px' } }, 'Open on this device'), h('div', { class: 'row' }, live.map(([t, href]) => h('a', { class: 'btn sm', href, target: '_blank', rel: 'noopener' }, t + ' ↗'))),
            h('p', { class: 'dim small' }, 'These screens work exactly as on the PC, from anywhere: they talk to the PC through this website. Graphics still play out from the PC (CasparCG, vMix, ATEM …).')) : null,
          r.pc ? h('button', { class: 'ghost sm', style: { marginTop: '8px' }, onclick: () => choose('none') }, 'Use the website without a PC') : null),
        h('div', { class: 'card' }, h('h2', {}, 'Link a production PC'),
          h('ol', { style: { margin: '0 0 0 18px', padding: 0, lineHeight: 1.7 } },
            h('li', {}, 'On the PC, open RFP Manager: Settings → This machine → Website link (or the first-run screen).'),
            h('li', {}, 'Enter ', h('code', {}, location.origin), ' and press "Sign in on the website to link this PC".'),
            h('li', {}, 'This website opens with a code. Check it matches the PC and press Link this PC.')),
          h('p', { class: 'dim small' }, 'Screen links for an OBS or vMix browser source, without signing in: ', h('code', {}, location.origin + '/output?pc=<PC>&key=<screen key>'), ' (the PC and screen key are under Monitors when the PC is in use).')));
    };
    paint();
    return { el, onMessage: (m) => { if (m.type === 'pcs') paint(); } };
  };

  // ---- the website: a PC asks to be linked
  App.pages.link = (code) => {
    const el = h('div', {}, pageHead('Link a production PC'), h('div', { class: 'card dim' }, 'Loading…'));
    api('GET', '/api/pair/' + encodeURIComponent(code || '')).then((p) => {
      const admin = App.teams.some((t) => t.role === 'Admin');
      const body = h('div', { class: 'card' },
        h('p', {}, 'The production PC ', h('b', {}, p.name), ' wants to link to this website as you (', App.me.email, ').'),
        h('div', { style: { font: '700 30px/1.2 ui-monospace,monospace', letterSpacing: '.12em', textAlign: 'center', padding: '10px', border: '1px solid var(--line)', borderRadius: '8px', margin: '8px 0 12px' } }, code),
        h('p', { class: 'dim' }, 'Only continue if the PC shows this same code. Once linked, the PC syncs every production team you are an Admin of, and team members can use its live screens from here.'),
        p.approved ? h('p', { class: 'toast' }, 'Already linked. You can close this page.') :
          admin ? h('button', { class: 'primary', onclick: async (e) => { e.target.disabled = true; try { await api('POST', `/api/pair/${encodeURIComponent(code)}/approve`); body.replaceChildren(h('h2', {}, 'Linked'), h('p', {}, `${p.name} is linking now. Go back to the PC: it carries on by itself. Its live screens will show up under PC at the top of the menu.`)); } catch (er) { e.target.disabled = false; oops(er); } } }, 'Link this PC')
            : h('p', { class: 'toast error' }, 'Only an Admin of a production team can link a PC. Ask your Admin to do it.'));
      el.replaceChildren(pageHead('Link a production PC'), body);
    }).catch((e) => el.replaceChildren(pageHead('Link a production PC'), h('div', { class: 'card' }, e.message)));
    return { el };
  };
})();
