/* Application state, data cache, live connection, shell and form widgets. */
'use strict';
const { h, api, toast, oops, modal, confirmBox, promptBox } = UI;
const Schema = RFPSchema, Scoring = RFPScoring;

const App = {
  cfg: null, me: null, teams: [], machine: null, team: null, role: null,
  docs: new Map(), ws: null, wsReady: false, offset: 0, gfx: null, sync: null, page: null, pages: {}, rid: 0, waiting: new Map(), listeners: new Set(),

  now() { return Date.now() + this.offset; },
  org() { const d = this.docs.get(this.team); return d ? d.data : {}; },
  get(id) { const d = id && this.docs.get(id); return d ? d.data : null; },
  list(type) { return [...this.docs.values()].filter((d) => d.type === type); },
  can(what) { return Schema.CAN[what](this.role); },
  title(type, id) { const d = this.get(id); if (!d) { const sc = type === 'channel' && (this.sharedChannels || []).find((c) => c.id === id); return sc ? sc.name + (sc.teamName ? ' (' + sc.teamName + ')' : '') : ''; } const e = Schema.ENTITIES[type]; return e ? e.title(d, (x) => this.get(x)) : d.name || ''; },
  loadSharedChannels() {
    if (!this._shared || Date.now() - this._shared.at > 60000) this._shared = { at: Date.now(), p: api('GET', '/api/channels/shared').then((r) => (this.sharedChannels = r.list || [])) };
    return this._shared.p;
  },
  sorted(type) { return this.list(type).sort((a, b) => this.title(type, a.id).localeCompare(this.title(type, b.id), undefined, { numeric: true })); },
  sports() { return [...new Set([...Scoring.sportNames(), 'Rugby Sevens', ...this.list('squad').map((d) => d.data.sport).filter(Boolean)])]; },
  // Where a match is scored: the cricket scorer, the sports scorer, or nowhere if the sport has no rules engine yet.
  // scoring is done on the production PC (or a device on its network), not on the website
  // on the production PC (the CasparCG bridge) most records are managed on the website and only shown here
  editable(type) { return !(this.cfg && this.cfg.bridge) || (this.cfg.pcEdit || []).includes(type); },
  canEdit(type) { return this.editable(type) && (this.can('edit') || (this.role === 'Coach' && ['club', 'squad', 'player'].includes(type)) || (type === 'expense' && !Schema.ROLE_SEES[this.role])); },
  canCreate(type) { return this.canEdit(type) && !(this.role === 'Coach' && type === 'club'); },
  // coaches and officials: their member record, a coach's clubs, and whether a coach may change this record
  myMember() { return this.list('member').find((m) => m.data.email === (this.me && this.me.email)) || null; },
  coachClubs() { const m = this.myMember(); return new Set((m && m.data.role === 'Coach' && m.data.clubs) || []); },
  coachOwns(type, doc) {
    if (this.role !== 'Coach') return true;
    const clubs = this.coachClubs(), d = (doc && doc.data) || {};
    if (type === 'club') return clubs.has(doc.id);
    if (type === 'squad') return clubs.has(d.club);
    if (type === 'player') return d.addedBy === this.me.email || this.list('squad').some((s) => clubs.has(s.data.club) && (s.data.players || []).some((r) => r.player === doc.id));
    return false;
  },
  // a person's picture: their Google profile picture, else their initials
  avatar(img, name, size = 24) {
    const src = /^https:\/\//.test(img || '') ? img : /^img_/.test(img || '') && this.docs.has(img) ? '/media/' + img : '';
    const st = { width: size + 'px', height: size + 'px', borderRadius: '50%', flex: 'none', objectFit: 'cover', verticalAlign: 'middle' };
    if (src) return h('img', { src, alt: '', referrerpolicy: 'no-referrer', style: st });
    const ini = String(name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    return h('span', { style: { ...st, display: 'inline-grid', placeItems: 'center', background: 'var(--panel2)', color: 'var(--dim)', fontSize: Math.round(size * 0.42) + 'px', fontWeight: 700 } }, ini);
  },
  personByEmail(email) { const m = this.list('member').find((x) => x.data.email === email); return m ? m.data : null; },
  limited() { return !!Schema.ROLE_SEES[this.role]; },          // a coach or an official
  onlineUrl(hash) { return (this.cfg && this.cfg.cloudUrl ? this.cfg.cloudUrl.replace(/\/+$/, '') : '') + '/app' + (hash || ''); },
  // the Android app (TWA): it opens the website with ?android=<build>; remembered for this app session
  isApp() { if (window.RFPNative) return true; try { if (/[?&]android=\d+/.test(location.search)) sessionStorage.setItem('rfp-app', 'android'); return sessionStorage.getItem('rfp-app') === 'android'; } catch (e) { return false; } },
  // scoring: on the production PC (and its network), and in the Android app – not in a web browser on the website
  canScore() { return !!this.cfg && this.can('score') && (this.cfg.mode === 'local' || this.isApp()); },
  scorerUrl(id, f) { const s = Scoring.sportFor(f.sport); return `/live/${s && s.id === 'cricket' ? 'stats' : 'sport'}.html?fixture=${encodeURIComponent(id)}${this.cfg && this.cfg.mode === 'cloud' && this.isApp() ? '&app=android' : ''}`; },
  commsUrl(id, f) { const s = Scoring.sportFor(f.sport); return `/live/${s && s.id === 'cricket' ? 'commentary' : 'sport-commentary'}.html?fixture=${encodeURIComponent(id)}`; },
  img(id) { return id && this.docs.has(id) ? '/media/' + id : ''; },
  fixtureName(f) { return f.name || f.autoName || 'Match'; },
  newId(type) { const a = new Uint8Array(9); crypto.getRandomValues(a); return type.toLowerCase().slice(0, 8) + '_' + [...a].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''); },

  async save(type, id, data) {
    const r = type === 'expense' ? await api('POST', `/api/expenses?team=${this.team}`, { id, data }) : await api('PUT', `/api/docs/${type}/${id}?team=${this.team}`, { data });
    this.docs.set(r.doc.id, r.doc);
    return r.doc;
  },
  // (expenses go through their own address: crew add them too, Producers approve)
  async remove(type, id) { const r = await api('DELETE', `/api/docs/${type}/${id}?team=${this.team}`); this.docs.delete(id); for (const x of (r && r.removed) || []) this.docs.delete(x); return r; },

  async uploadImage(file, kind) {
    if (file.size > 8 * 1024 * 1024) throw new Error('Images can be up to 8 MB');
    const r = await api('POST', `/api/images?team=${this.team}&name=${encodeURIComponent(file.name)}&kind=${encodeURIComponent(kind || '')}`, file, { 'content-type': file.type || 'application/octet-stream' });
    this.docs.set(r.doc.id, r.doc);
    return r.doc.id;
  },

  // ---- live connection ----------------------------------------------------------------------
  connect() {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.wsReady = false;
    if (!this.team) return;
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', team: this.team }));
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    ws.onclose = () => { if (this.ws !== ws) return; this.wsReady = false; this.paintSync(); setTimeout(() => { if (this.ws === ws) this.reconnect(); }, 2000); };
  },
  async reconnect() {
    try { await this.loadDocs(); this.connect(); this.refresh(); } catch (e) { if (e.status === 401) return location.reload(); setTimeout(() => this.reconnect(), 3000); }
  },
  onMessage(m) {
    if (m.type === 'welcome') { this.wsReady = true; this.offset = m.now - Date.now(); this.role = m.role; if (m.gfx) this.gfx = m.gfx; if (m.sync) this.sync = m.sync; this.paintSync(); this.notify({ type: 'gfx-state' }); }
    else if (m.type === 'doc') {
      if (m.doc.deleted) this.docs.delete(m.doc.id); else this.docs.set(m.doc.id, m.doc);
      if (m.doc.id === this.team) applyTheme();
      this.notify(m);
    } else if (m.type === 'sync') { this.sync = m.status; this.paintSync(); this.notify(m); }
    else if (m.type === 'gfx-state') { if (this.gfx) this.gfx.state = m.state; this.notify(m); }
    else if (m.type === 'gfx-warn') toast(m.text, 'error');
    else if (m.type === 'pcs') { this.loadMe().then(() => { paintPcPicker(); this.notify(m); }).catch(() => {}); }
    else if (m.type === 'ack' || m.type === 'error') {
      const w = this.waiting.get(m.rid);
      if (w) { this.waiting.delete(m.rid); if (m.type === 'ack') w.resolve(m.result || {}); else w.reject(new Error(m.error)); }
      else if (m.type === 'error') toast(m.error, 'error');
    }
  },
  send(msg) {
    return new Promise((resolve, reject) => {
      if (!this.wsReady) return reject(new Error('Not connected to the server. Reconnecting…'));
      const rid = ++this.rid;
      this.waiting.set(rid, { resolve, reject });
      this.ws.send(JSON.stringify({ ...msg, rid }));
      setTimeout(() => { if (this.waiting.delete(rid)) reject(new Error('The server did not answer')); }, 8000);
    });
  },
  score(fixtureId, action, data) { return this.send({ type: 'score', fixtureId, action, data }).catch(oops); },
  gfxDo(action, extra) { return this.send({ type: 'gfx', action, ...(extra || {}) }); },
  notify(m) { if (this.page && this.page.onMessage) { try { this.page.onMessage(m); } catch (e) { console.error(e); } } },
  paintSync() {
    const el = document.getElementById('sync');
    if (!el) return;
    const s = this.sync, led = el.firstChild, txt = el.lastChild;
    if (!this.wsReady) { led.className = 'led bad'; txt.textContent = 'Reconnecting…'; return; }
    if (this.cfg.mode === 'cloud') { led.className = 'led ok'; txt.textContent = 'Online'; return; }
    if (!s || !s.linked) { led.className = 'led'; txt.textContent = 'Not linked to the website'; return; }
    if (s.lastError) { led.className = 'led warn'; txt.textContent = `Offline · ${s.pending || 0} to upload`; el.title = s.lastError; return; }
    led.className = 'led ok'; txt.textContent = s.pending ? `Syncing · ${s.pending} to upload` : 'Synced with the website'; el.title = s.url || '';
  },

  async loadDocs() {
    const r = await api('GET', '/api/docs?team=' + this.team);
    this.docs = new Map(r.docs.map((d) => [d.id, d]));
    this.offset = r.now - Date.now();
  },
  async loadMe() {
    const r = await api('GET', '/api/me');
    this.me = r.user; this.teams = r.teams; this.machine = r.machine; this.sync = r.machine.sync;
    this.pcs = r.pcs || null; this.pc = r.pc || '';         // the website: production PCs online for your teams, and the one this browser uses
  },
  async selectTeam(id) {
    this.team = id; this.role = (this.teams.find((t) => t.id === id) || {}).role || null;
    try { localStorage.setItem('rfp.team', id); } catch { /* private window */ }
    await this.loadDocs();
    applyTheme();
    this.connect();
  },
  refresh() { route(); },
};

// Admins (on the website) accept these once: their name and email are shared with RegemarkFP (the website's
// superuser) only, to contact them about their team, and for occasional marketing email they can switch off.
App.termsGate = (readOnly) => {
  let optOut = !!App.me.marketingOptOut;
  const body = h('div', { class: 'terms' },
    h('p', {}, 'You are an Admin of a production team on RegemarkFP. To keep the service running for you:'),
    h('ul', {},
      h('li', {}, 'Your name and email address are shared with RegemarkFP (the people who run this website) only. They are not shown to other teams or the public.'),
      h('li', {}, 'RegemarkFP uses them to contact you when needed: about your account, your team, payments, security or changes to the service.'),
      h('li', {}, 'RegemarkFP may also send you occasional news and offers. You can opt out here or any time under Settings → My account.'),
      h('li', {}, 'RegemarkFP sees numbers about your team (members per role, productions, matches, bookings, viewers), never the names of your crew, clients or anyone else.')),
    readOnly && App.me.superTerms ? null : h('label', { class: 'row', style: { gap: '8px' } }, h('input', { type: 'checkbox', checked: optOut, onchange: (e) => { optOut = e.target.checked; } }), 'No marketing emails, thanks'));
  UI.modal({ title: 'Admin terms', body, actions: readOnly && App.me.superTerms ? [{ label: 'Close', primary: true }] : [
    { label: 'Later' },
    { label: 'I accept', primary: true, onClick: async () => { await api('POST', '/api/me', { acceptTerms: true, marketingOptOut: optOut }); await App.loadMe(); toast('Thank you'); if (readOnly) route(); } }] });
};

// The website: which production PC the live screens (Graphics control, scorer, dashboards …) use. Chosen per browser.
function pcPicker() {
  const list = App.pcs || [], cur = list.find((p) => p.id === App.pc);
  return h('div', { class: 'pc-pick', title: 'The live screens on this website control this production PC' },
    h('span', { class: 'led ' + (cur ? 'ok' : list.length ? 'warn' : '') }),
    h('select', { 'aria-label': 'Production PC', onchange: async (e) => {
      const v = e.target.value;
      if (v === '+') { e.target.value = App.pc || 'none'; location.hash = '#/pcs'; return; }
      try { await api('POST', '/api/pcs/choose', { id: v }); location.reload(); } catch (err) { oops(err); }
    } },
      h('option', { value: 'none', selected: !cur }, list.length ? 'No PC (website only)' : 'No production PC online'),
      list.map((p) => h('option', { value: p.id, selected: p.id === App.pc }, 'PC: ' + p.name)),
      h('option', { value: '+' }, '+ Link a production PC…')));
}
function paintPcPicker() { const el = document.getElementById('pc-picker'); if (el) el.replaceChildren(pcPicker()); }

function applyTheme() {
  const accent = App.org().accentColor || '#00ff82';
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--on-accent', UI.contrast(accent));
}

// ---- routing + shell ------------------------------------------------------------------------
// The side menu. The website manages the records; a production PC (the CasparCG bridge) runs the live side and
// shows the records it gets from the website.
function navFor() {
  const c = App.cfg || {};
  if (App.role === 'Coach') return [['', [['#/', 'My teams'], ['#/fixtures', 'Fixtures & Results'], ['#/list/club', 'My clubs'], ['#/list/squad', 'Teams'], ['#/list/player', 'Players'], ['#/settings', 'Settings']]]];
  if (App.role === 'Crew' && !c.bridge) return [['', [['#/', 'My gigs'], ['#/calendar', 'Calendar'], ['#/list/expense', 'My expenses'], ['#/settings', 'Settings']]]];
  if (App.role === 'Official') return [['', [['#/', 'My matches'], ['#/fixtures', 'Fixtures & Results'], ['#/settings', 'Settings']]]];
  if (c.bridge) {
    return [
      ['', [['#/', 'Bridge']]],
      ['Live', [['#/monitors', 'Monitors'], ['#/templates', 'Templates'], ['#/list/theme', 'Themes'], ['#/adverts', 'Advert playout'], ['#/music', 'Music playout'], ['#/list/dashboard', 'Dashboards'], ['#/list/timeline', 'Timelines'], ['#/automation', 'Variables & triggers'], ['#/variables', 'Variables by sport'], ['/rl/control', 'Rocket League'], ['#/playlog', 'Play log']]],
      ['Worship', [['#/list/service', 'Services'], ['#/list/song', 'Songs'], ['#/bibles', 'Bibles'], ['#/ccli', 'CCLI report']]],
      ['From the website', [['#/fixtures', 'Fixtures & Results'], ['#/list/competition', 'Competitions'], ['#/list/production', 'Productions'], ['#/calendar', 'Calendar'], ['#/list/club', 'Clubs'], ['#/list/squad', 'Teams'], ['#/list/player', 'Players'], ['#/list/venue', 'Venues'], ['#/list/crewMember', 'Crew'], ['#/list/advert', 'Adverts'], ['#/list/playlist', 'Ad playlists'], ['#/images', 'Images']]],
      ['', [['#/settings', 'Settings']]],
    ];
  }
  const local = c.mode === 'local', pc = local || !!App.pc;          // live screens: on a PC, or on the website with a PC chosen
  const ed = App.can('edit'), web = !local, money = ed && web;
  const n = (k) => (k ? ` (${k})` : '');
  const ifs = (...links) => links.filter(Boolean);
  // grouped by what you are doing: selling, running a production, the sport, the live show, the stream, sponsors, media
  return [
    ['', ifs(['#/', 'Dashboard'], web && ['#/notifications', 'Notifications' + n(App.unread)])],
    money ? ['Clients & sales', [['#/list/booking', 'Booking requests' + n(App.waitingBookings && App.waitingBookings().length)], ['#/list/client', 'Clients'], ['#/money', 'Quotes & invoices'], ['#/list/service', 'Products & services'], ['#/ratings', 'Ratings']]] : null,
    ['Productions', ifs(['#/list/production', 'Productions'], ['#/calendar', 'Calendar'], ['#/list/crewMember', 'Crew'], ['#/list/crewRole', 'Crew roles'], ['#/list/equipment', 'Equipment'], money && ['#/list/releaseForm', 'Release forms'], ['#/list/expense', ed ? 'Expenses' : 'My expenses'], web && ['#/availability', 'My availability'])],
    ['Sport', [['#/fixtures', 'Fixtures & Results'], ['#/list/competition', 'Competitions'], ['#/list/club', 'Clubs'], ['#/list/squad', 'Teams'], ['#/list/player', 'Players'], ['#/list/venue', 'Venues']]],
    ['Live & graphics', ifs(App.pcs && ['#/pcs', 'Production PCs'], pc && ['#/monitors', 'Monitors'], pc && ['#/templates', 'Templates'], ['#/list/theme', 'Themes'], pc && ['#/adverts', 'Advert playout'], ['#/list/dashboard', 'Dashboards'], ['#/list/timeline', 'Timelines'], ['#/automation', 'Variables & triggers'], pc && ['#/variables', 'Variables by sport'], pc && ['/rl/control', 'Rocket League'])],
    web ? ['Streaming', ifs(['#/list/channel', 'Channels'], ed && ['#/content', 'Content'], ed && ['#/youtube', 'YouTube Live'], ed && ['#/analytics', 'Analytics'], ed && ['#/sales', 'Ticket sales'], ['#/streamads', 'Stream adverts'])] : null,
    ['Adverts & sponsors', ifs(['#/list/advert', 'Adverts'], money && ['#/list/adSlot', 'Ad spaces (clients)'], ['#/list/playlist', 'Ad playlists'], ['#/playlog', 'Play log'], money && ['#/sponsors', 'Sponsor reports'])],
    ['Media & music', ifs(['#/images', 'Images'], ['#/list/track', 'Music library'], pc && ['#/music', 'Music playout'], ed && ['#/musicrights', 'Music use report'])],
    ['Worship', [['#/list/service', 'Services'], ['#/list/song', 'Songs'], ['#/ccli', 'CCLI report']].concat(local ? [['#/bibles', 'Bibles']] : [])],
    ['', [['#/settings', 'Settings']]],
  ].filter(Boolean);
}

// The side menu: one part open at a time (the one you are in, or the one you opened last); the whole menu can be made narrow.
const navStore = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } } };
// is this menu link the page we are on?
function navOn(href) {
  const here = location.hash || '#/';
  if (href === '#/content' && /^#\/(streams|vod|playlists)(\/|$)/.test(here)) return true;           // Content holds live streams, VOD and playlists
  return href === '#/' ? here === '#/' : here === href || here.startsWith(href + '/') || (href.startsWith('#/list/') && here.startsWith('#/edit/' + href.slice(7) + '/')) || (href === '#/fixtures' && /^#\/(rundown\/fixture|edit\/fixture)\//.test(here));
}
function shell(content) {
  if (ANDROID) return androidShell(content);
  const on = navOn;
  const root = h('div', { class: 'shell' + (navStore.get('rfp-side-min') === '1' && window.innerWidth > 860 ? ' side-min' : '') },
    h('aside', { class: 'side' },
      h('div', { class: 'brand', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, h('img', { class: 'logo', src: '/brand/rfp-logo-sm.png', alt: 'RFP', style: { height: '28px', width: 'auto' } }), h('span', { class: 'brand-name', style: { flex: 1 } }, App.cfg.name), h('button', { class: 'ghost sm no-print side-toggle', title: 'Make the menu narrow or wide', onclick: () => { const n = !root.classList.contains('side-min'); root.classList.toggle('side-min', n); navStore.set('rfp-side-min', n ? '1' : '0'); } }, '«')),
      h('select', { 'aria-label': 'Production team', onchange: async (e) => {
        if (e.target.value === '+') { e.target.value = App.team; return newTeam(); }
        await App.selectTeam(e.target.value); location.hash = '#/'; route();
      } }, App.teams.map((t) => h('option', { value: t.id, selected: t.id === App.team }, t.name)), h('option', { value: '+' }, '+ New production team…')),
      App.pcs ? h('div', { id: 'pc-picker' }, pcPicker()) : null,
      (() => {
        const NAV = navFor();
        const groups = NAV.filter(([g]) => g).map(([g]) => g), here = (NAV.find(([g, links]) => g && links.some(([href]) => on(href))) || [])[0];
        let openG = here || navStore.get('rfp-nav-open') || '';
        if (!groups.includes(openG)) openG = '';
        const parts = [];
        const paint = () => parts.forEach((p) => { const o = p.g === openG; p.list.style.display = o ? '' : 'none'; p.head.textContent = (o ? '▾ ' : '▸ ') + p.g; });
        const nav = h('nav', { class: 'nav' }, NAV.map(([g, links]) => {
          const list = h('div', {}, links.map(([href, label]) => h('a', { href, class: on(href) ? 'on' : '', title: label, onclick: () => root.classList.remove('open') }, icon(window.RFPIcons.forLink(href, g), 20), h('span', { class: 'nl' }, label))));
          if (!g) return list;
          const head = h('div', { class: 'nav-group', role: 'button', tabindex: '0', title: 'Open this part of the menu (the others close)', style: { cursor: 'pointer', userSelect: 'none' },
            onclick: () => { openG = openG === g ? '' : g; navStore.set('rfp-nav-open', openG); paint(); }, onkeydown: (e) => { if (e.key === 'Enter') head.click(); } }, g);
          parts.push({ g, head, list });
          return [head, list];
        }));
        paint();
        return nav;
      })(),
      h('div', { class: 'foot' },
        h('div', { class: 'dim small', style: { padding: '2px 8px' }, title: 'The version of RFP Manager this PC is running' }, 'RFP Manager ' + (App.cfg.version || '')),
        App.cfg.copyright ? h('div', { class: 'dim small', style: { padding: '0 8px 4px', fontSize: '11px' } }, App.cfg.copyright) : null,
        h('div', { class: 'sync', id: 'sync' }, h('span', { class: 'led' }), h('span', {}, '')),
        h('div', { class: 'row', style: { padding: '4px 8px', justifyContent: 'space-between', gap: '8px' } }, h('span', { class: 'dim row', style: { gap: '8px', minWidth: 0 }, title: App.me.email }, App.avatar(App.me.image, App.me.name || App.me.email, 26), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, (App.me.name || App.me.email) + ' · ' + (App.role || ''))),
          h('button', { class: 'ghost sm', onclick: async () => { await api('POST', '/api/auth/logout'); location.hash = ''; location.reload(); } }, 'Sign out')))),
    h('main', { class: 'main' }, h('button', { class: 'menu-btn no-print', style: { marginBottom: '12px' }, onclick: () => root.classList.toggle('open') }, '☰ Menu'), content));
  return root;
}

// ---- PDFs and other files from the website (quotes, invoices, contracts, call sheets, reports). A phone's browser
// downloads them without the sign-in ("Sign in first"), so there they are fetched here, signed in, and handed over
// as a file. The computer opens them in a new tab; the Android app saves them with the person's session.
const PHONE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !/RFPManagerAndroid/.test(navigator.userAgent);
App.openDoc = async (url) => {
  if (!PHONE) { window.open(url, '_blank'); return; }
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) { let m = 'Could not open it'; try { m = (await r.json()).error || m; } catch (e) { /* not JSON */ } throw new Error(m); }
    const blob = await r.blob();
    const cd = r.headers.get('content-disposition') || '';
    const name = decodeURIComponent((/filename\*=UTF-8''([^;]+)/i.exec(cd) || [])[1] || '') || (/filename="([^"]+)"/i.exec(cd) || [])[1] || url.split('?')[0].split('/').pop() || 'file';
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  } catch (e) { oops(e); }
};
// links to files of the website (/api/…pdf, csv, xml) go the same way on a phone
document.addEventListener('click', (e) => {
  if (!PHONE || e.defaultPrevented) return;
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (!/^\/(api|media)\//.test(href) || !/(\.pdf|\.csv|\.xml|\/pdf)(\?|$)|^\/media\//.test(href)) return;
  e.preventDefault(); App.openDoc(href);
}, true);

// ---- the Android app (RFPManagerAndroid in its user agent): an app bar on top and tabs at the bottom, like an Android
// app, instead of the side menu. The website and the PC keep the side menu. ?android=1 shows it in a browser (to try).
const ANDROID = (() => {
  const ua = /RFPManagerAndroid/.test(navigator.userAgent);
  try { const q = new URLSearchParams(location.search).get('android'); if (q !== null) sessionStorage.setItem('rfp-android', q === '1' ? '1' : '0'); return ua || sessionStorage.getItem('rfp-android') === '1'; } catch (e) { return ua; }
})();
if (ANDROID) document.documentElement.classList.add('android-app');
// the icons (public/js/icons.js, shared with the public website)
const ICONS = window.RFPIcons.paths;
const icon = (name, size) => window.RFPIcons.svg(name, size);
// the bottom tabs: the main screens for this role, then More (everything else)
function androidTabs() {
  const flat = navFor().flatMap(([, links]) => links);
  const find = (href) => flat.find(([x]) => x === href);
  const want = { Coach: ['#/', '#/fixtures', '#/list/player'], Crew: ['#/', '#/calendar', '#/list/expense'], Official: ['#/', '#/fixtures'] }[App.role] || (App.cfg.bridge ? ['#/', '#/monitors', '#/templates'] : ['#/', '#/fixtures', '#/list/production', '#/calendar', '#/content']);
  let tabs = want.map(find).filter(Boolean);
  if (tabs.length < 2) tabs = flat.filter(([x]) => x !== '#/settings').slice(0, 4);
  const NAMES = { '#/': 'Home', '#/fixtures': 'Matches', '#/list/production': 'Productions', '#/list/expense': 'Expenses', '#/list/player': 'Players', '#/content': 'Content' };
  return tabs.map(([href, label]) => ({ href, label: NAMES[href] || label.replace(/\s*\(\d+\)$/, ''), icon: href === '#/' ? 'home' : window.RFPIcons.forLink(href) }));
}
function androidShell(content) {
  const tabs = androidTabs();
  const inTabs = tabs.some((t) => navOn(t.href));
  const team = App.teams.find((t) => t.id === App.team);
  const teamPick = App.teams.length > 1 ? h('select', { class: 'appbar-team', 'aria-label': 'Production team', onchange: async (e) => {
    if (e.target.value === '+') { e.target.value = App.team; return newTeam(); }
    await App.selectTeam(e.target.value); location.hash = '#/'; route();
  } }, App.teams.map((t) => h('option', { value: t.id, selected: t.id === App.team }, t.name)), h('option', { value: '+' }, '+ New production team…')) : h('span', { class: 'appbar-team' }, (team && team.name) || App.cfg.name);
  const local = App.cfg.mode === 'local';
  return h('div', { class: 'shell android' },
    h('header', { class: 'appbar no-print' },
      h('a', { href: '#/', class: 'appbar-logo', 'aria-label': 'Home' }, h('img', { src: '/brand/rfp-logo-sm.png', alt: 'RFP' })),
      h('div', { class: 'grow' }, teamPick),
      local ? null : h('a', { href: '#/notifications', class: 'appbar-icon' + (navOn('#/notifications') ? ' on' : ''), 'aria-label': 'Notifications' }, icon('bell'), App.unread ? h('span', { class: 'badge' }, App.unread > 99 ? '99+' : String(App.unread)) : null),
      h('a', { href: '#/settings', class: 'appbar-icon', 'aria-label': 'Settings and account' }, App.avatar(App.me.image, App.me.name || App.me.email, 30))),
    h('main', { class: 'main' }, content),
    h('nav', { class: 'tabbar no-print' + (tabs.length >= 5 ? ' many' : ''), 'aria-label': 'Main' },
      tabs.map((t) => h('a', { href: t.href, class: 'tab' + (navOn(t.href) ? ' on' : '') }, h('span', { class: 'ind' }, icon(t.icon)), h('span', { class: 'lbl' }, t.label))),
      h('a', { href: '#/more', class: 'tab' + (!inTabs && !navOn('#/notifications') ? ' on' : '') }, h('span', { class: 'ind' }, icon('menu')), h('span', { class: 'lbl' }, 'More'))));
}
// More: everything that is not a tab, as an Android list; the production PC, the team, your account
App.pages.more = () => {
  const tabs = new Set(androidTabs().map((t) => t.href).concat('#/notifications'));     // notifications: the bell on top
  const groups = navFor().map(([g, links]) => [g, links.filter(([href]) => !tabs.has(href))]).filter(([, links]) => links.length);
  return { el: h('div', { class: 'more' },
    h('a', { class: 'more-me', href: '#/settings' }, App.avatar(App.me.image, App.me.name || App.me.email, 44), h('div', { class: 'grow' }, h('b', {}, App.me.name || App.me.email), h('div', { class: 'dim small' }, [App.me.email, App.role].filter(Boolean).join(' · '))), icon('chevron')),
    App.pcs ? h('div', { class: 'more-pc', id: 'pc-picker' }, pcPicker()) : null,
    groups.map(([g, links]) => h('div', { class: 'more-group' }, g ? h('div', { class: 'more-head' }, g) : null,
      h('div', { class: 'more-list' }, links.map(([href, label]) => h('a', { href }, h('span', { class: 'more-ico' }, icon(window.RFPIcons.forLink(href, g), 22)), h('span', { class: 'grow' }, label), icon('chevron', 20)))))),
    h('div', { class: 'more-foot' },
      h('div', { class: 'sync', id: 'sync' }, h('span', { class: 'led' }), h('span', {}, '')),
      h('div', { class: 'dim small' }, 'RFP Manager ' + (App.cfg.version || '')),
      App.cfg.copyright ? h('div', { class: 'dim small' }, App.cfg.copyright) : null,
      h('button', { class: 'danger', onclick: async () => { await api('POST', '/api/auth/logout'); location.hash = ''; location.reload(); } }, 'Sign out'))) };
};

function pageHead(title, ...actions) { return h('div', { class: 'page-head' }, h('div', { class: 'grow' }, typeof title === 'string' ? h('h1', {}, title) : title), actions); }

async function newTeam() {
  const name = await promptBox('New production team', 'Name', '');
  if (!name) return;
  try { const r = await api('POST', '/api/orgs', { name }); await App.loadMe(); await App.selectTeam(r.id); location.hash = '#/settings'; route(); } catch (e) { oops(e); }
}

function route() {
  if (App.page && App.page.destroy) { try { App.page.destroy(); } catch { /* ignore */ } }
  App.page = null;
  const parts = (location.hash || '#/').slice(2).split('/').map(decodeURIComponent);
  const name = parts[0] || 'dashboard';
  const make = App.pages[name] || App.pages.notfound;
  let page;
  try { page = make(...parts.slice(1)); } catch (e) { console.error(e); page = { el: h('div', { class: 'card' }, 'This screen hit a problem: ' + e.message) }; }
  App.page = page;
  const app = document.getElementById('app');
  const y = window.scrollY;
  app.replaceChildren(shell(page.el));
  App.paintSync();
  // on a phone the tab rows scroll sideways: keep the chosen tab in view
  app.querySelectorAll('.tabs').forEach((t) => { const on = t.querySelector('.on'); if (on && t.scrollWidth > t.clientWidth) t.scrollLeft = on.offsetLeft - t.offsetLeft - 16; });
  if (page.keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  if (!offerApp.done) { offerApp.done = true; setTimeout(offerApp, 1200); }
}
// an Admin on an Android phone's browser (not in the app): offer the app once, again after 14 days if they said Not now
const APP_OFFER = { phone: () => /Android/i.test(navigator.userAgent) && /Mobile/i.test(navigator.userAgent) && !/; wv\)|RFPManager/.test(navigator.userAgent),
  due: () => { try { return Date.now() - Number(localStorage.getItem('rfp-app-offer') || 0) > 14 * 86400e3; } catch (e) { return true; } },
  later: () => { try { localStorage.setItem('rfp-app-offer', String(Date.now())); } catch (e) { /* asked again next time */ } } };
function offerApp() {
  if (ANDROID || !APP_OFFER.phone() || !App.cfg.androidApp || !(App.teams || []).some((t) => ['Admin', 'Producer', 'Scorer', 'Crew'].includes(t.role)) || !APP_OFFER.due()) return;
  modal({ title: 'Get the RFP Manager app', body: h('div', {},
    h('img', { src: '/brand/rfp-logo-sm.png', alt: '', style: { height: '40px', marginBottom: '10px' } }),
    h('p', { style: { marginTop: 0 } }, 'Run your productions from the Android app: tabs at the bottom, push notifications for bookings, crew and matches, and Google sign-in that stays signed in.'),
    h('p', { class: 'dim small' }, 'After downloading, open the file and allow installing from your browser if Android asks.')),
  actions: [{ label: 'Not now', onClick: APP_OFFER.later }, { label: '⬇ Download the app', primary: true, onClick: () => { APP_OFFER.later(); location.href = '/app/rfp-manager.apk'; } }] });
}
// ---- page sections as sub-tabs: a page that stacks 3+ titled cards gets a sticky row of chips (one card at a time,
// or All), so nothing is missed further down. Live tools (scorer, graphics control, rundown …) are left as they are.
const SECTION_SKIP = new Set(['dashboard', 'score', 'control', 'rundown', 'callsheet', 'monitors', 'calendar', 'doc', 'more', 'complete', 'report']);
const sectionMemo = {};
let sectionBusy = false, sectionTimer = null;
function sectionTitle(card) {
  // the card's own title: an h2/h3 near the top, or the h2 that starts a small header row
  let hd = null;
  for (const x of [...card.children].slice(0, 3)) {
    if (/^H[23]$/.test(x.tagName)) { hd = x; break; }
    if (x.tagName === 'DIV' && x.children.length <= 4 && x.firstElementChild && x.firstElementChild.tagName === 'H2') { hd = x.firstElementChild; break; }
  }
  const t = hd ? hd.textContent.trim() : '';
  return t.length > 34 ? t.slice(0, 32).trim() + '…' : t;
}
function applySections() {
  const page = ((location.hash || '#/').slice(2).split('/')[0]) || 'dashboard';
  const root = document.querySelector('#app main') || document.getElementById('app');
  if (!root || SECTION_SKIP.has(page)) return;
  sectionBusy = true;
  try {
    const parents = new Set([...root.querySelectorAll('.card')].map((c) => c.parentElement));
    let idx = 0;
    for (const box of parents) {
      if (!box || box.closest('.modal, .form, [data-nosubnav]') || box.classList.contains('two') || getComputedStyle(box).display === 'grid') continue;
      const cards = [...box.children].filter((c) => c.classList.contains('card') && !c.classList.contains('subnav-skip'));
      const titled = cards.map((c) => ({ c, t: sectionTitle(c) })).filter((x) => x.t);
      const old = [...box.children].find((x) => x.classList.contains('subnav'));
      if (titled.length < 3 || titled.length > 14 || new Set(titled.map((x) => x.t)).size !== titled.length) { if (old) old.remove(); cards.forEach((c) => c.classList.remove('shide')); continue; }
      const key = location.hash + '|' + (idx++);
      let on = sectionMemo[key];
      if (on !== '*' && !titled.some((x) => x.t === on)) on = titled[0].t;
      const bar = h('div', { class: 'subnav', role: 'tablist' }, [...titled.map((x) => x.t), '*'].map((t) => h('button', { type: 'button', class: t === on ? 'on' : '',
        onclick: () => { sectionMemo[key] = t; applySections(); const b = box.querySelector('.subnav'); if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ block: 'start' }); } }, t === '*' ? 'All' : t)));
      if (old) old.replaceWith(bar); else box.insertBefore(bar, titled[0].c);
      for (const x of titled) x.c.classList.toggle('shide', on !== '*' && x.t !== on);
    }
  } finally { setTimeout(() => { sectionBusy = false; }, 0); }
}
App.applySections = applySections;
new MutationObserver(() => { if (sectionBusy) return; clearTimeout(sectionTimer); sectionTimer = setTimeout(applySections, 120); })
  .observe(document.getElementById('app') || document.body, { childList: true, subtree: true });

window.addEventListener('hashchange', () => { if (App.me && App.team) route(); });
App.pages.notfound = () => ({ el: h('div', { class: 'card' }, 'That page does not exist. ', h('a', { href: '#/' }, 'Go to the dashboard')) });

// ---- form widgets ---------------------------------------------------------------------------
function optionsFor(f, form) {
  if (Array.isArray(f.opts)) return f.opts;
  // only the chosen sport's formats once a sport is set
  if (f.opts === 'formats' && form) { const sp = formSport(form.type || '', form); const list = Scoring.formats().filter((x) => !sp || x.sport === sp); return (list.length ? list : Scoring.formats()).map((x) => x.text); }
  if (f.opts === 'sports') return App.sports();
  if (f.opts === 'formats') return Scoring.formats().map((x) => x.text);
  if (f.opts === 'vodCategories') return [...new Set(['vodvideo', 'vodseries', 'vodplaylist'].flatMap((t) => App.list(t).map((d) => d.data.category)).filter(Boolean))].sort();
  if (f.opts === 'crewRoles') return App.sorted('crewRole').map((d) => d.data.name);
  return [];
}

function imagePicker(onPick) {
  const grid = h('div', { class: 'gallery' });
  const imgs = App.list('image').filter((d) => d.data.kind !== 'receipt').sort((a, b) => b.updatedAt - a.updatedAt);
  let close;
  for (const d of imgs) grid.append(h('div', { class: 'g', onclick: () => { onPick(d.id); close(); } }, h('img', { src: '/media/' + d.id, alt: '', loading: 'lazy' }), h('div', {}, d.data.name)));
  close = modal({ title: 'Image library', wide: true, body: imgs.length ? grid : h('div', { class: 'empty' }, 'No images yet. Upload one first.'), actions: [{ label: 'Close' }] });
}

function imageField(value, onChange, kind) {
  const pv = h('div', { class: 'pv' });
  const receipt = kind === 'receipt';
  const paint = () => {
    const d = value && App.docs.get(value);
    pv.replaceChildren(!d ? 'none' : d.data.mime === 'application/pdf' ? h('a', { href: '/media/' + value, target: '_blank', rel: 'noopener', style: { fontWeight: 700 } }, 'PDF') : h('a', { href: '/media/' + value, target: '_blank', rel: 'noopener' }, h('img', { src: '/media/' + value, alt: '' })));
  };
  const set = (v) => { value = v; paint(); onChange(v); pv.dispatchEvent(new Event('change', { bubbles: true })); };
  const file = h('input', { type: 'file', accept: receipt ? 'image/*,application/pdf' : 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', class: 'hide', onchange: async () => {
    if (!file.files[0]) return;
    try { set(await App.uploadImage(file.files[0], kind)); toast('Image saved'); } catch (e) { oops(e); }
    file.value = '';
  } });
  paint();
  if (receipt) {
    // on a phone: straight to the camera; a PDF or a photo from the gallery works too
    const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hide', onchange: async () => {
      if (!cam.files[0]) return;
      try { set(await App.uploadImage(cam.files[0], kind)); toast('Receipt saved'); } catch (e) { oops(e); }
      cam.value = '';
    } });
    paint();
    return h('div', { class: 'imgfield' }, pv, file, cam, h('div', { class: 'row' },
      h('button', { type: 'button', class: 'sm primary', onclick: () => cam.click() }, '📷 Photo'),
      h('button', { type: 'button', class: 'sm', onclick: () => file.click() }, 'File or PDF'),
      value ? h('button', { type: 'button', class: 'sm ghost', onclick: () => set('') }, 'Clear') : null));
  }
  return h('div', { class: 'imgfield' }, pv, file, h('div', { class: 'row' },
    h('button', { type: 'button', class: 'sm', onclick: () => file.click() }, 'Upload'),
    h('button', { type: 'button', class: 'sm', onclick: () => imagePicker(set) }, 'Library'),
    h('button', { type: 'button', class: 'sm', onclick: async () => {
      const url = await promptBox('Image from the web', 'Image address (https://…)', '');
      if (!url) return;
      try { const r = await api('POST', '/api/images/url', { team: App.team, url }); await App.loadDocs(); set(r.id); toast('Image downloaded'); } catch (e) { oops(e); }
    } }, 'From URL'),
    value ? h('button', { type: 'button', class: 'sm ghost', onclick: () => set('') }, 'Clear') : null));
}

// One input for one schema field. ctx.form is the record being edited (for filters and inherited values).
function fieldInput(f, value, onChange, ctx = {}) {
  const ph = ctx.placeholder || f.ph || '';
  switch (f.t) {
    case 'textarea': return h('textarea', { placeholder: ph, rows: f.rows || null, style: f.rows ? { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '13px' } : null, oninput: (e) => onChange(e.target.value) }, value || '');
    case 'number': case 'money': return h('input', { type: 'number', step: 'any', value: value === undefined || value === null ? '' : value, placeholder: ph, oninput: (e) => onChange(e.target.value === '' ? '' : Number(e.target.value)) });
    case 'date': return h('input', { type: 'date', value: value || '', oninput: (e) => onChange(e.target.value) });
    case 'time': return h('input', { type: 'time', value: value || '', oninput: (e) => onChange(e.target.value) });
    case 'duration': return h('input', { value: value || '', placeholder: 'mm:ss', oninput: (e) => onChange(e.target.value) });
    case 'linecolor': {
      const sel = h('select', { style: { background: value || '', color: value ? '#000' : '' }, onchange: (e) => { sel.style.background = e.target.value; sel.style.color = e.target.value ? '#000' : ''; onChange(e.target.value); } },
        Schema.LINE_COLORS.map(([hex, name]) => h('option', { value: hex, selected: (value || '') === hex, style: { background: hex || '#171717', color: hex ? '#000' : '#f2f2f2' } }, name)));
      return sel;
    }
    case 'bool': return h('input', { type: 'checkbox', checked: !!value, onchange: (e) => onChange(e.target.checked) });
    case 'color': {
      const solid = !!f.solid; // e.g. the accent colour can't be see-through
      const text = h('input', { value: value || '', placeholder: ph || (solid ? '#rrggbb' : '#rrggbb or #rrggbbaa'), onchange: () => { const hex = UI.toHex(text.value, solid); if (text.value && !hex) { toast('That is not a colour. Use a hex code like #ff8a00, #ff8a0080 or rgba(255, 138, 0, 0.5).', 'error'); text.value = value || ''; return; } text.value = hex; if (hex) pick.value = hex; value = hex; onChange(hex); } });
      const pick = h('input', { type: 'color', 'data-noalpha': solid ? '' : null, value: UI.toHex(value, solid) || UI.toHex(ph, solid) || '#000000', 'aria-label': f.l + ' picker', oninput: () => { text.value = pick.value; value = pick.value; onChange(pick.value); } });
      return h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, pick, text);
    }
    case 'select': return h('select', { onchange: (e) => onChange(e.target.value) }, optionsFor(f).map((o) => h('option', { value: o, selected: (value || f.def) === o }, o)));
    case 'combo': {
      const id = 'dl_' + Math.random().toString(36).slice(2);
      return h('div', {}, h('input', { list: id, value: value || '', placeholder: ph, oninput: (e) => onChange(e.target.value) }), h('datalist', { id }, optionsFor(f, ctx.form).map((o) => h('option', { value: o }))));
    }
    case 'multi': {
      let cur = Array.isArray(value) ? value.slice() : [];
      const box = h('div', { class: 'chips' });
      const paint = () => {
        const all = [...new Set([...optionsFor(f), ...cur])];
        box.replaceChildren(...all.map((o) => h('span', { class: 'chip' + (cur.includes(o) ? ' on' : ''), role: 'checkbox', tabindex: '0', 'aria-checked': cur.includes(o) ? 'true' : 'false',
          onclick: () => { cur = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]; onChange(cur); paint(); }, onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.target.click(); } } }, o)),
        h('span', { class: 'chip', onclick: async () => { const v = await promptBox('Add another', f.l, ''); if (v && !cur.includes(v)) { cur.push(v); onChange(cur); paint(); } } }, '+'));
      };
      paint();
      return box;
    }
    case 'ref': {
      let docs = App.sorted(f.ref).filter((d) => !d.data.archived || d.id === value);   // archived records stay out of the pickers
      if (f.sameSport && ctx.form && ctx.form.sport) { const k = Scoring.keyOf(ctx.form.sport); docs = docs.filter((d) => Scoring.keyOf(d.data.sport) === k || d.id === value); }
      const sel = h('select', { onchange: (e) => {
        if (e.target.value !== '+') return onChange(e.target.value);
        e.target.value = value || '';
        App.editModal(f.ref, (doc) => { value = doc.id; sel.insertBefore(h('option', { value: doc.id }, App.title(f.ref, doc.id)), sel.lastChild); sel.value = doc.id; onChange(doc.id); });
      } }, h('option', { value: '' }, '—'), docs.map((d) => h('option', { value: d.id, selected: d.id === value }, App.title(f.ref, d.id))),
      App.canEdit(f.ref) && Schema.ENTITIES[f.ref] ? h('option', { value: '+' }, '+ New ' + Schema.ENTITIES[f.ref].label.toLowerCase() + '…') : null);
      // channels: also the ones other production teams share with everyone
      if (f.ref === 'channel' && App.cfg && App.cfg.mode === 'cloud') App.loadSharedChannels().then((list) => {
        const mine = new Set(docs.map((d) => d.id));
        const others = list.filter((c) => !mine.has(c.id));
        if (!others.length) return;
        const g = h('optgroup', { label: 'Shared by other production teams' }, others.map((c) => h('option', { value: c.id, selected: c.id === value }, App.title('channel', c.id))));
        sel.insertBefore(g, sel.querySelector('option[value="+"]'));
        if (value) sel.value = value;
      }).catch(() => {});
      return sel;
    }
    case 'member': {       // a person in this production team (by email), e.g. the Producer of a booking
      const ms = App.list('member').filter((m) => !f.roles || f.roles.includes(m.data.role)).sort((a, b) => String(a.data.name || a.data.email).localeCompare(String(b.data.name || b.data.email)));
      const known = ms.some((m) => m.data.email === value);
      return h('select', { disabled: f.readonly || null, onchange: (e) => onChange(e.target.value) }, h('option', { value: '' }, '—'),
        !known && value ? h('option', { value, selected: true }, value) : null,
        ms.map((m) => h('option', { value: m.data.email, selected: m.data.email === value }, (m.data.name || m.data.email) + ' (' + m.data.role + ')')));
    }
    case 'phone': return Phone.input(value, onChange, { make: h, dial: App.cfg.dial, readonly: f.readonly });
    case 'image': return imageField(value, onChange, f.k);
    case 'list': return listField(f, value, onChange, ctx);
    default: return h('input', { value: value === undefined || value === null ? '' : value, placeholder: ph, readonly: f.readonly || null, oninput: (e) => onChange(e.target.value) });
  }
}

function listField(f, value, onChange, ctx) {
  let rows = Array.isArray(value) ? value.map((r) => ({ ...r })) : [];
  const wrap = h('div', {});
  const commit = () => { onChange(rows); wrap.dispatchEvent(new Event('change', { bubbles: true })); };
  const paint = () => {
    const body = rows.map((r, i) => h('tr', {},
      f.fields.map((sf) => h('td', { style: sf.w ? { width: sf.w + 'px' } : {} }, fieldInput(sf, r[sf.k], (v) => { r[sf.k] = v; commit(); }, { form: ctx.form }))),
      h('td', { class: 'nowrap', style: { width: '96px' } },
        h('button', { type: 'button', class: 'ghost sm', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; commit(); paint(); } }, '↑'),
        h('button', { type: 'button', class: 'ghost sm', title: 'Move down', 'aria-label': 'Move down', disabled: i === rows.length - 1, onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; commit(); paint(); } }, '↓'),
        h('button', { type: 'button', class: 'ghost sm danger', title: 'Remove', 'aria-label': 'Remove row', onclick: () => { rows.splice(i, 1); commit(); paint(); } }, '✕'))));
    wrap.replaceChildren(
      rows.length ? h('div', { style: { overflowX: 'auto' } }, h('table', { class: 't sub' }, h('thead', {}, h('tr', {}, f.fields.map((sf) => h('th', {}, sf.l)), h('th', {}))), h('tbody', {}, body))) : h('div', { class: 'dim small', style: { marginBottom: '6px' } }, 'Nothing added yet.'),
      h('button', { type: 'button', class: 'sm', onclick: () => { rows.push(Object.fromEntries(f.fields.filter((sf) => sf.def !== undefined).map((sf) => [sf.k, sf.def]))); commit(); paint(); const ins = wrap.querySelectorAll('tbody tr:last-child input, tbody tr:last-child select'); if (ins[0]) ins[0].focus(); } }, '+ Add row'));
  };
  paint();
  wrap.setRows = (next) => { rows = next.map((r) => ({ ...r })); paint(); };
  return wrap;
}

// Builds a form for a record type. Returns { el, data } where data is updated as the user types.
// The sport a form is about (scorer engine id: 'rugby', 'cricket' …): its own Sport field, else its competition's.
function formSport(type, data) {
  let name = data.sport;
  if (!name && data.competition) { const c = App.get(data.competition); name = c && c.sport; }
  const sp = name ? Scoring.sportFor(name) : null;
  return sp ? sp.id : '';
}
App.formSport = formSport;

// Forms with several groups show them as sub-tabs (all fields stay in the form, the other groups are just hidden),
// so nothing gets lost further down a long page. Fields limited to some sports (f.sports) only show for those.
const formTabMemo = {};
function buildForm(type, initial, { fields, onChange } = {}) {
  const data = JSON.parse(JSON.stringify(initial || {}));
  const all = fields || Schema.fieldsFor(type, App.org()).filter((f) => !f.hidden);
  for (const f of all) if (data[f.k] === undefined && f.def !== undefined) data[f.k] = f.def;
  const grid = h('div', { class: 'form' });
  const widgets = {};
  let active = formTabMemo[type] || '';
  const REPAINT = { squad: ['club'], fixture: ['sport', 'competition'], competition: ['sport'] };
  const groupOf = (f, i) => f.group || (all.slice(0, i).some((x) => x.group) ? 'More' : 'Details');
  const paint = () => {
    const sport = formSport(type, data);
    const shown = all.map((f, i) => ({ f, g: groupOf(f, i) })).filter(({ f }) => (!f.sports || (sport && f.sports.includes(sport))) && (!f.when || f.when(data)));
    const groups = [...new Set(shown.map((x) => x.g))];
    const tabbed = groups.length >= 3 || (groups.length === 2 && shown.length >= 10);
    if (tabbed && active !== '*' && !groups.includes(active)) active = groups[0];
    const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    const kids = [];
    if (tabbed) {
      kids.push(h('div', { class: 'wide ftabs', role: 'tablist' }, [...groups, '*'].map((g) => {
        const need = g !== '*' && shown.some((x) => x.g === g && x.f.req && empty(data[x.f.k]));
        const n = g === '*' ? 0 : shown.filter((x) => x.g === g).length;
        return h('button', { type: 'button', class: (g === active ? 'on' : '') + (need ? ' need' : ''), title: need ? 'Has a required field still empty' : '',
          onclick: () => { active = g; formTabMemo[type] = g; paint(); } }, g === '*' ? 'All' : g.replace(/ \(.*\)$/, ''), n ? h('small', {}, ' ' + n) : null);
      })));
      if (active !== '*') { const g = shown.find((x) => x.g === active); if (g && g.f.group && /\(/.test(g.f.group)) kids.push(h('p', { class: 'wide help', style: { margin: 0 } }, g.f.group.replace(/^.*\((.*)\)$/, '$1').replace(/^./, (c) => c.toUpperCase()) + '.')); }
    }
    let lastGroup;
    for (const { f, g } of shown) {
      const el = one(f);
      if (tabbed) { if (active !== '*' && g !== active) el.classList.add('fhide'); }
      else if (f.group && f.group !== lastGroup) kids.push(h('h4', { class: 'wide fgroup' }, f.group));
      if (tabbed && active === '*' && g !== lastGroup) kids.push(h('h4', { class: 'wide fgroup' }, g));
      lastGroup = g;
      kids.push(el);
    }
    grid.replaceChildren(...kids);
  };
  const one = (f) => {
    const club = type === 'squad' && data.club ? App.get(data.club) : null;
    {
      const inherited = f.inherit && club && club[f.inherit] && f.t !== 'image' ? `${club[f.inherit]} (from club)` : '';
      const input = fieldInput(f, data[f.k], (v) => { data[f.k] = v; if (onChange) onChange(f.k, v); if ((REPAINT[type] || []).includes(f.k) && f.t !== 'combo') paint(); }, { form: data, placeholder: inherited });
      // a typed field (combo) repaints when the typing stops, not on every key
      if ((REPAINT[type] || []).includes(f.k) && f.t === 'combo') input.addEventListener('change', () => paint());
      widgets[f.k] = input;
      const wide = ['textarea', 'list', 'multi'].includes(f.t);
      const lab = h('span', {}, f.l + (f.req ? ' *' : ''));
      const help = f.help || (f.inherit && club ? (f.t === 'image' ? 'Leave empty to use the club\'s.' : '') : '');
      return f.t === 'list' || f.t === 'multi' || f.t === 'image' || f.t === 'color'
        ? h('div', { class: wide ? 'wide' : '' }, h('div', { class: 'flabel' }, lab.textContent), input, help ? h('div', { class: 'help' }, help) : null)
        : h('label', { class: 'f' + (wide ? ' wide' : '') + (f.t === 'bool' ? ' row' : '') }, lab, input, help ? h('div', { class: 'help' }, help) : null);
    }
  };
  paint();
  return { el: grid, data, widgets, repaint: paint };
}

App.editModal = (type, onSaved, initial) => {
  const e = Schema.ENTITIES[type];
  const form = buildForm(type, initial || {});
  modal({ title: 'New ' + e.label.toLowerCase(), wide: true, body: form.el, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => { const doc = await App.save(type, App.newId(type), form.data); toast(e.label + ' saved'); if (onSaved) onSaved(doc); } }] });
};
