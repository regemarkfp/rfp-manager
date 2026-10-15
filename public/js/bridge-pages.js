/* The production PC as the CasparCG bridge: its home page (website link, CasparCG, what is on air, the live screens),
 * and the "link this PC" step a PC needs before it can be used. Records are managed on the website. */
'use strict';
(() => {
  const ago = (t) => { if (!t) return 'not yet'; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : new Date(t).toLocaleString('en-GB'); };
  const site = () => (App.cfg.cloudUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const tile = (led, title, line, extra) => h('div', { class: 'card', style: { margin: 0 } },
    h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, h('span', { class: 'led ' + led }), h('b', {}, title)),
    h('div', { class: 'dim small', style: { marginTop: '6px', minHeight: '20px' } }, line), extra || null);

  function bridgeHome() {
    const el = h('div', {});
    const paint = () => {
      const sync = App.sync || (App.machine && App.machine.sync) || {};
      const g = (App.gfx && App.gfx.state) || {};
      const cas = g.caspar || {};
      const onAir = (g.onAir || []).filter((x) => !x.leaving);
      const ra = App.machine.remoteAccess || {};
      const fx = g.fixtureId ? App.docs.get(g.fixtureId) : null;
      const today = UI.today();
      const matches = App.list('fixture').filter((d) => d.data.status === 'Live' || d.data.startDate === today)
        .sort((a, b) => String(a.data.startTime || '').localeCompare(String(b.data.startTime || '')));
      const offline = !!sync.lastError;
      const screens = [['Graphics control', '/live/control.html', 'Take graphics to CasparCG', true], ['Worship control', '/live/worship.html', 'Songs, scripture, slides'],
        ['Timeline', '/live/timeline.html', 'Cues that run the show'], ['Commentary monitor', '/live/comms.html', 'For the commentary box'], ['Rundown monitor', '/live/rundown.html', 'Run order on a screen'],
        ['Browser output', '/output', 'For OBS / vMix or a monitor']];
      el.replaceChildren(
        h('div', { class: 'hero' }, h('div', {}, h('h1', {}, App.machine.name || 'Production PC'), h('div', { class: 'dim' }, 'CasparCG bridge · ' + (App.org().name || ''))),
          h('div', { class: 'row', style: { marginLeft: 'auto' } }, App.cfg.cloudUrl ? h('a', { class: 'btn', href: App.onlineUrl(''), target: '_blank', rel: 'noopener', title: 'Assets, fixtures, crew, adverts … are managed on the website' }, 'Open the website ↗') : null,
            App.can('score') ? h('a', { class: 'btn primary', href: '/live/control.html' }, 'Graphics control ↗') : null)),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' } },
          tile(offline ? 'bad' : sync.linked ? 'ok' : 'warn', 'Website', offline ? `Offline (${sync.lastError}). This PC carries on with its own copy.` : sync.linked ? `${site()} · synced ${ago(sync.lastSync)}` : 'Not linked',
            sync.pending ? h('div', { class: 'small', style: { marginTop: '4px' } }, h('span', { class: 'pill warn' }, `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to go up`)) : null),
          tile(cas.enabled === false ? '' : cas.connected ? 'ok' : 'bad', 'CasparCG', cas.enabled === false ? 'Switched off (browser outputs only)' : cas.connected ? `${cas.endpoint || ''}${cas.version ? ' · ' + cas.version : ''}` : `Not connected${cas.endpoint ? ' (' + cas.endpoint + ')' : ''}`,
            App.machine.admin ? h('a', { class: 'small', href: '#/settings', onclick: () => { App.settingsTab = 'connections'; } }, 'Connections') : null),
          tile(onAir.length ? 'ok' : '', 'On air', onAir.length ? onAir.map((x) => x.name || x.graphicId).slice(0, 4).join(' · ') + (onAir.length > 4 ? ` +${onAir.length - 4}` : '') : 'Nothing', fx ? h('div', { class: 'small' }, 'Match: ', h('b', {}, App.title('fixture', fx.id))) : null),
          tile(!App.machine.remoteAccess ? '' : ra.connected ? 'ok' : 'warn', 'Remote access', ra.connected ? 'Team members can use the live screens through the website' : App.machine.remoteAccess ? 'Not connected to the website' : 'Off')),
        h('div', { class: 'two' },
          h('div', { class: 'card' }, h('h2', {}, 'Live screens'),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' } },
              screens.map(([t, href, sub, main]) => h('a', { class: 'btn' + (main ? ' primary' : ''), href, target: '_blank', rel: 'noopener', style: { flexDirection: 'column', alignItems: 'flex-start', whiteSpace: 'normal', textAlign: 'left' } }, h('b', {}, t + ' ↗'), h('span', { class: 'small', style: { opacity: 0.8 } }, sub)))),
            h('p', { class: 'dim small', style: { marginBottom: 0 } }, 'More: ', h('a', { href: '#/monitors' }, 'Monitors'), ' · ', h('a', { href: '#/list/dashboard' }, 'Dashboards'), ' · ', h('a', { href: '#/templates' }, 'Templates'), ' · ', h('a', { href: '#/adverts' }, 'Advert playout'), ' · ', h('a', { href: '#/playlog' }, 'Play log'))),
          h('div', { class: 'card' }, h('h2', {}, 'Matches live & today'),
            matches.length ? matches.map((d) => App.fixtureRow(d)) : h('div', { class: 'empty' }, 'No matches today. Fixtures are added on the website.'))),
        h('p', { class: 'dim small' }, `Clubs, teams, players, competitions, fixtures, productions, crew, adverts and the rest are managed on the website${site() ? ' (' + site() + ')' : ''} and come down to this PC. Scores, graphics and the play log are kept here; if the internet drops, this PC carries on with its own copy and sends everything up when it is back.`));
    };
    paint();
    const timer = setInterval(() => { if (!el.isConnected) return clearInterval(timer); paint(); }, 5000);
    return { el, keepScroll: true, onMessage: UI.debounce((m) => { if (['doc', 'gfx-state', 'sync'].includes(m.type)) paint(); }, 200) };
  }

  const before = App.pages.dashboard;
  App.pages.dashboard = () => (App.cfg.bridge ? bridgeHome() : before());

  // Signed in with an account of this PC only (from before), and not connected to the website: sign in with the website account instead.
  App.linkGate = (root) => {
    const site = (App.cfg.cloudUrl || 'the website').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const out = async () => { await api('POST', '/api/auth/logout'); location.reload(); };
    root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'box card' },
      h('h1', {}, 'Sign in with your website account'),
      h('p', { class: 'dim' }, `This PC is not connected to ${site} yet. Sign out, then sign in with the account you use on the website (an Admin of your production team). That connects this PC and brings your data down.`),
      h('button', { class: 'primary', style: { width: '100%' }, onclick: out }, 'Sign out and sign in again'),
      App.teams.some((t) => t.role === 'Admin') ? h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'dim small' }, 'Other ways to connect'), h('div', { style: { marginTop: '10px' } }, App.linkFlow({ onDone: () => setTimeout(() => location.reload(), 2500) }))) : null)));
  };
})();
