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
  async remove(type, id) { await api('DELETE', `/api/docs/${type}/${id}?team=${this.team}`); this.docs.delete(id); },

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
      ['Live', [['#/monitors', 'Monitors'], ['#/templates', 'Templates'], ['#/list/theme', 'Themes'], ['#/adverts', 'Advert playout'], ['#/list/dashboard', 'Dashboards'], ['#/list/timeline', 'Timelines'], ['#/automation', 'Variables & triggers'], ['#/playlog', 'Play log']]],
      ['Worship', [['#/list/service', 'Services'], ['#/list/song', 'Songs'], ['#/bibles', 'Bibles'], ['#/ccli', 'CCLI report']]],
      ['From the website', [['#/fixtures', 'Fixtures & Results'], ['#/list/competition', 'Competitions'], ['#/list/production', 'Productions'], ['#/calendar', 'Calendar'], ['#/list/club', 'Clubs'], ['#/list/squad', 'Teams'], ['#/list/player', 'Players'], ['#/list/venue', 'Venues'], ['#/list/crewMember', 'Crew'], ['#/list/advert', 'Adverts'], ['#/list/playlist', 'Ad playlists'], ['#/images', 'Images']]],
      ['', [['#/settings', 'Settings']]],
    ];
  }
  const local = c.mode === 'local', pc = local || !!App.pc;          // live screens: on a PC, or on the website with a PC chosen
  return [
    ['', [['#/', 'Dashboard'], local ? null : ['#/notifications', 'Notifications' + (App.unread ? ` (${App.unread})` : '')]].filter(Boolean)],
    ['Matches', [['#/fixtures', 'Fixtures & Results'], ['#/list/competition', 'Competitions']]],
    ['Productions', [['#/list/production', 'Productions'], ['#/calendar', 'Calendar'], App.can('edit') && !local ? ['#/list/booking', 'Booking requests' + (App.waitingBookings && App.waitingBookings().length ? ` (${App.waitingBookings().length})` : '')] : null, ['#/list/expense', App.can('edit') ? 'Expenses' : 'My expenses'], ['#/list/crewMember', 'Crew'], ['#/list/crewRole', 'Crew roles'], ['#/list/equipment', 'Equipment']].filter(Boolean)],
    ['Assets', [['#/list/club', 'Clubs'], ['#/list/squad', 'Teams'], ['#/list/player', 'Players'], ['#/list/venue', 'Venues'], ['#/list/theme', 'Themes'], ['#/images', 'Images']]],
    ['Advertising', [['#/list/advert', 'Adverts'], ['#/list/playlist', 'Ad playlists'], ['#/playlog', 'Play log'], local ? null : ['#/streamads', 'Stream adverts']].filter(Boolean)],
    ['Worship', [['#/list/service', 'Services'], ['#/list/song', 'Songs'], ['#/ccli', 'CCLI report']].concat(local ? [['#/bibles', 'Bibles']] : [])],
    local ? null : ['Streaming', [['#/list/channel', 'Channels'], App.can('edit') ? ['#/streams', 'Live streams'] : null, App.can('edit') ? ['#/analytics', 'Analytics'] : null, App.can('edit') ? ['#/sales', 'Ticket sales'] : null].filter(Boolean)],
    ['Live', [App.pcs ? ['#/pcs', 'Production PCs'] : null, pc ? ['#/monitors', 'Monitors'] : null, pc ? ['#/templates', 'Templates'] : null, pc ? ['#/adverts', 'Advert playout'] : null,
      ['#/list/dashboard', 'Dashboards'], ['#/list/timeline', 'Timelines'], ['#/automation', 'Variables & triggers']].filter(Boolean)],
    ['', [['#/settings', 'Settings']]],
  ].filter(Boolean);
}

// The side menu: one part open at a time (the one you are in, or the one you opened last); the whole menu can be made narrow.
const navStore = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } } };
function shell(content) {
  const here = location.hash || '#/';
  const on = (href) => (href === '#/' ? here === '#/' : here === href || here.startsWith(href + '/') || (href.startsWith('#/list/') && here.startsWith('#/edit/' + href.slice(7) + '/')) || (href === '#/fixtures' && /^#\/(rundown\/fixture|edit\/fixture)\//.test(here)));
  const root = h('div', { class: 'shell' + (navStore.get('rfp-side-min') === '1' ? ' side-min' : '') },
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
          const list = h('div', {}, links.map(([href, label]) => h('a', { href, class: on(href) ? 'on' : '', onclick: () => root.classList.remove('open') }, label)));
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
        h('div', { class: 'sync', id: 'sync' }, h('span', { class: 'led' }), h('span', {}, '')),
        h('div', { class: 'row', style: { padding: '4px 8px', justifyContent: 'space-between', gap: '8px' } }, h('span', { class: 'dim row', style: { gap: '8px', minWidth: 0 }, title: App.me.email }, App.avatar(App.me.image, App.me.name || App.me.email, 26), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, (App.me.name || App.me.email) + ' · ' + (App.role || ''))),
          h('button', { class: 'ghost sm', onclick: async () => { await api('POST', '/api/auth/logout'); location.hash = ''; location.reload(); } }, 'Sign out')))),
    h('main', { class: 'main' }, h('button', { class: 'menu-btn no-print', style: { marginBottom: '12px' }, onclick: () => root.classList.toggle('open') }, '☰ Menu'), content));
  return root;
}

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
}
window.addEventListener('hashchange', () => { if (App.me && App.team) route(); });
App.pages.notfound = () => ({ el: h('div', { class: 'card' }, 'That page does not exist. ', h('a', { href: '#/' }, 'Go to the dashboard')) });

// ---- form widgets ---------------------------------------------------------------------------
function optionsFor(f) {
  if (Array.isArray(f.opts)) return f.opts;
  if (f.opts === 'sports') return App.sports();
  if (f.opts === 'formats') return Scoring.formats().map((x) => x.text);
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
  const set = (v) => { value = v; paint(); onChange(v); };
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
      return h('div', {}, h('input', { list: id, value: value || '', placeholder: ph, oninput: (e) => onChange(e.target.value) }), h('datalist', { id }, optionsFor(f).map((o) => h('option', { value: o }))));
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
      let docs = App.sorted(f.ref);
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
    case 'image': return imageField(value, onChange, f.k);
    case 'list': return listField(f, value, onChange, ctx);
    default: return h('input', { value: value === undefined || value === null ? '' : value, placeholder: ph, oninput: (e) => onChange(e.target.value) });
  }
}

function listField(f, value, onChange, ctx) {
  let rows = Array.isArray(value) ? value.map((r) => ({ ...r })) : [];
  const wrap = h('div', {});
  const commit = () => onChange(rows);
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
function buildForm(type, initial, { fields, onChange } = {}) {
  const data = JSON.parse(JSON.stringify(initial || {}));
  const all = fields || Schema.fieldsFor(type, App.org()).filter((f) => !f.hidden);
  for (const f of all) if (data[f.k] === undefined && f.def !== undefined) data[f.k] = f.def;
  const grid = h('div', { class: 'form' });
  const widgets = {};
  const paint = () => {
    const club = type === 'squad' && data.club ? App.get(data.club) : null;
    grid.replaceChildren(...all.map((f) => {
      const inherited = f.inherit && club && club[f.inherit] && f.t !== 'image' ? `${club[f.inherit]} (from club)` : '';
      const input = fieldInput(f, data[f.k], (v) => { data[f.k] = v; if (onChange) onChange(f.k, v); if ((f.k === 'club' && type === 'squad') || (f.k === 'sport' && type === 'fixture')) paint(); }, { form: data, placeholder: inherited });
      widgets[f.k] = input;
      const wide = ['textarea', 'list', 'multi'].includes(f.t);
      const lab = h('span', {}, f.l + (f.req ? ' *' : ''));
      const help = f.help || (f.inherit && club ? (f.t === 'image' ? 'Leave empty to use the club\'s.' : '') : '');
      return f.t === 'list' || f.t === 'multi' || f.t === 'image' || f.t === 'color'
        ? h('div', { class: wide ? 'wide' : '' }, h('div', { class: 'flabel' }, lab.textContent), input, help ? h('div', { class: 'help' }, help) : null)
        : h('label', { class: 'f' + (wide ? ' wide' : '') + (f.t === 'bool' ? ' row' : '') }, lab, input, help ? h('div', { class: 'help' }, help) : null);
    }));
  };
  paint();
  return { el: grid, data, widgets, repaint: paint };
}

App.editModal = (type, onSaved, initial) => {
  const e = Schema.ENTITIES[type];
  const form = buildForm(type, initial || {});
  modal({ title: 'New ' + e.label.toLowerCase(), wide: true, body: form.el, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => { const doc = await App.save(type, App.newId(type), form.data); toast(e.label + ' saved'); if (onSaved) onSaved(doc); } }] });
};
