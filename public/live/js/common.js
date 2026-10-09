/* CricketCG – shared client runtime for the Stats and Control surfaces.
 * One WebSocket per browser tab; the server pushes the full state after every change,
 * so every operator always sees the same match. */
(function () {
  'use strict';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  // The production team's accent colour, as in the rest of RFP Manager.
  let accentNow = '';
  function applyAccent(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m || accentNow === hex) return;
    accentNow = hex;
    const st = document.documentElement.style, lum = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
    st.setProperty('--accent', hex); st.setProperty('--accent2', hex); st.setProperty('--on-accent', lum > 0.55 ? '#0b0b0b' : '#ffffff');
    store.set('rfp.accent', hex);
  }
  applyAccent(store.get('rfp.accent', ''));

  const listeners = {};
  const pending = new Map();
  let ws = null;
  let reqSeq = 1;
  let role = '';
  let reconnectDelay = 500;

  const CG = {
    state: null,
    catalog: [],
    log: [],
    lists: { matches: [], teams: [] },
    clientId: null,
    connected: false,
    store,

    on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    emit(type, data) { (listeners[type] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },

    // RFP Manager: the match comes from the page address (?fixture=<id>). Without one, the screen follows the match
    // that is on air. Screens opened with ?key=<output key> are view-only and need no sign-in.
    query: (() => { const q = new URLSearchParams(location.search), o = new URLSearchParams(); ['fixture', 'key', 'team'].forEach(k => { if (q.get(k)) o.set(k, q.get(k)); }); const s = o.toString(); return s ? '?' + s : ''; })(),
    rfp: { canScore: false, user: '', fixtureId: '' },
    async connect(r) {
      role = r;
      carryQuery();
      open();
    },

    /** Send a message; resolves on ack, rejects with the server's error message. */
    send(type, action, data) {
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== 1) { CG.toast('Not connected to server', 'err'); reject(new Error('offline')); return; }
        const requestId = String(reqSeq++);
        pending.set(requestId, { resolve, reject, t: setTimeout(() => { pending.delete(requestId); reject(new Error('timeout')); }, 10000) });
        ws.send(JSON.stringify({ type, action, data: data || {}, requestId }));
      });
    },
    score(action, data) {
      return CG.send('score', action, data).catch(async e => {
        // ICC playing conditions are enforced, but the scorer has the last word (the umpires may have allowed it).
        if (action === 'bowler' && e && /two in a row|maximum of/.test(e.message || '')) {
          const ok = await CG.modal('Bowling restriction', `<p>${CG.esc(e.message)}.</p><p class="muted small">Bowl this over anyway?</p>`, { ok: 'Bowl anyway', danger: true });
          if (ok) return CG.send('score', action, Object.assign({}, data, { force: true })).catch(showErr);
          throw e;
        }
        return showErr(e);
      });
    },
    gfx(action, data) { return CG.send('gfx', action, data).catch(showErr); },

    // ------------------------------------------------------------ lookups
    player(id) {
      if (!id || !CG.state) return null;
      const m = CG.state.match;
      return m.teamA.players.find(p => p.id === id) || m.teamB.players.find(p => p.id === id) || null;
    },
    pname(id) { const p = CG.player(id); return p ? (p.tvName || p.name) : ''; },
    team(key) { return CG.state ? (key === 'B' ? CG.state.match.teamB : CG.state.match.teamA) : null; },
    currentInnings() { const s = CG.state && CG.state.stats; return s && s.currentIndex >= 0 ? s.innings[s.currentIndex] : null; },
    rawInnings(i) { const m = CG.state && CG.state.match; return m && i >= 0 ? m.innings[i] : null; },

    // ------------------------------------------------------------ ui helpers
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },
    /** Web address of a team badge: an image from the library (img_…), or a full address. '' when there is none. */
    logo(v) { v = String(v || ''); return /^img_[\w-]{6,40}$/.test(v) ? '/media/' + v : /^(https?:)?\/\//.test(v) || v.charAt(0) === '/' ? v : ''; },
    /** <img> for a team's badge at a height in px ('' when the team has none). */
    badge(team, size) { const u = CG.logo(team && team.logo); return u ? `<img class="tbadge" src="${CG.esc(u)}" alt="" style="height:${size || 28}px;max-width:${Math.round((size || 28) * 1.6)}px">` : ''; },
    h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; },

    toast(msg, kind) {
      let box = document.getElementById('toasts');
      if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || '');
      el.textContent = msg;
      box.appendChild(el);
      setTimeout(() => el.classList.add('out'), 3200);
      setTimeout(() => el.remove(), 3700);
    },

    /** Simple promise-based modal. `body` is HTML; returns the form's values or null. */
    modal(title, body, opts) {
      opts = opts || {};
      return new Promise(resolve => {
        const wrap = CG.h(`<div class="modal-back"><form class="modal" autocomplete="off">
          <h3>${CG.esc(title)}</h3><div class="modal-body">${body}</div>
          <div class="modal-actions">
            ${opts.extraButtons || ''}
            <button type="button" class="btn ghost" data-act="cancel">Cancel</button>
            <button type="submit" class="btn ${opts.danger ? 'danger' : 'primary'}">${CG.esc(opts.ok || 'OK')}</button>
          </div></form></div>`);
        document.body.appendChild(wrap);
        const form = wrap.querySelector('form');
        const close = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
        const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); } };
        document.addEventListener('keydown', onKey, true);
        wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
        form.querySelector('[data-act=cancel]').onclick = () => close(null);
        form.addEventListener('click', e => {
          const b = e.target.closest('[data-value]');
          if (b && b.closest('.modal-actions')) { e.preventDefault(); close({ __button: b.dataset.value, ...values() }); }
        });
        function values() {
          const out = {};
          new FormData(form).forEach((v, k) => { out[k] = v; });
          CG.$$('input[type=checkbox]', form).forEach(cb => { out[cb.name] = cb.checked; });
          return out;
        }
        form.onsubmit = e => { e.preventDefault(); close(values()); };
        if (opts.onOpen) opts.onOpen(form);
        const first = form.querySelector('[autofocus]') || form.querySelector('input,select,textarea');
        if (first) setTimeout(() => first.focus(), 20);
      });
    },

    playerOptions(teamKey, selected, opts) {
      opts = opts || {};
      const t = CG.team(teamKey);
      if (!t) return '';
      const exclude = opts.exclude || [];
      let html = opts.blank !== false ? `<option value="">${CG.esc(opts.blankLabel || '— select —')}</option>` : '';
      t.players.forEach(p => {
        if (exclude.includes(p.id) && p.id !== selected) return;
        html += `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${CG.esc(p.name)}${p.captain ? ' (c)' : ''}${p.keeper ? ' †' : ''}</option>`;
      });
      return html;
    },

    /** Render the shared header status pills. */
    renderStatus() {
      const s = CG.state;
      if (s) {
        const sport = s.mode === 'sport';
        CG.$$('a[data-mode-link]').forEach(a => { a.href = sport ? a.dataset.sportHref : a.dataset.cricketHref; });
      }
      const srv = CG.$('#pill-server');
      if (srv) { srv.className = 'pill ' + (CG.connected ? 'ok' : 'bad'); srv.textContent = CG.connected ? 'SERVER' + (s && s.rfp && s.rfp.version ? ' ' + s.rfp.version : '') : 'SERVER OFFLINE'; }
      const cas = CG.$('#pill-caspar');
      if (cas && s) {
        if (s.caspar.enabled === false) {
          cas.className = 'pill warn';
          cas.textContent = 'STANDALONE (BROWSER OUTPUT)';
        } else {
          cas.className = 'pill ' + (s.caspar.connected ? 'ok' : 'bad');
          cas.textContent = s.caspar.connected ? `CASPAR ${s.caspar.endpoint}` : `CASPAR OFFLINE`;
        }
        cas.title = s.caspar.version ? 'CasparCG ' + s.caspar.version : 'Not connected to ' + s.caspar.endpoint;
      }
      const users = CG.$('#pill-users');
      if (users && s) {
        users.textContent = `${s.clients.length} ONLINE`;
        users.title = s.clients.map(c => `${c.name}${c.role ? ' – ' + c.role : ''} (${c.address})`).join('\n');
      }
    },

    // ------------------------------------------------------------ other sports
    serverOffset: 0,
    _sv: { version: -1, v: null, err: null },
    /** Computed view of the active sport event (cached per version). Needs js/sports.js on the page. */
    sportView() {
      const sm = CG.state && CG.state.sport;
      if (!sm || !sm.setup || !window.Sports) return null;
      if (CG._sv.version !== sm.version) {
        try { CG._sv = { version: sm.version, v: Sports.compute(sm.setup, sm.events || []), err: null }; }
        catch (e) { console.error(e); CG._sv = { version: sm.version, v: null, err: e.message }; }
      }
      return CG._sv.v;
    },
    /** Live value of a server clock ("game" / "shot"), in ms. */
    clockMs(name) {
      const sm = CG.state && CG.state.sport, c = sm && sm.clocks && sm.clocks[name || 'game'];
      if (!c) return 0;
      if (!c.running) return c.baseMs;
      let v = c.baseMs + c.direction * (Date.now() + CG.serverOffset - c.startedAt);
      if (c.direction < 0) v = Math.max(0, v); else if (c.stopAtLimit && c.limitMs > 0) v = Math.min(v, c.limitMs);
      return Math.max(0, v);
    },
    fmtClock(ms, tenthsUnder) {
      if (tenthsUnder && ms < tenthsUnder * 1000) return (Math.floor(ms / 100) / 10).toFixed(1);
      const t = Math.floor(ms / 1000);
      return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    },
    isSportMode() { return !!(CG.state && CG.state.mode === 'sport'); },

    askName() { return store.get('cgName', '') || 'Screen'; },      // signed-in people are named by the server
  };

  function showErr(e) { if (e && e.message && e.message !== 'offline') CG.toast(e.message, 'err'); throw e; }

  // Keep the match (and screen key) in the address when moving between the live screens.
  function carryQuery() {
    if (!CG.query) return;
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.getAttribute('href');
      if (/^(stats|sport|control|commentary|sport-commentary|output|preview)\.html/.test(h) && !/[?&](fixture|key)=/.test(h)) a.setAttribute('href', h + (h.includes('?') ? '&' : '?') + CG.query.slice(1));
      ['cricketHref', 'sportHref'].forEach(k => { if (a.dataset[k] && !/[?&](fixture|key)=/.test(a.dataset[k])) a.dataset[k] += (a.dataset[k].includes('?') ? '&' : '?') + CG.query.slice(1); });
    });
  }
  function authWall(message) {
    if (document.getElementById('rfp-wall')) return;
    const d = document.createElement('div');
    d.id = 'rfp-wall';
    d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#262626;color:#f2f2f2;display:flex;align-items:center;justify-content:center;font:16px system-ui,sans-serif;padding:24px;text-align:center';
    d.innerHTML = `<div><h2 style="margin:0 0 10px">RFP Manager</h2><p>${CG.esc(message)}</p><p><a href="/?next=${encodeURIComponent(location.pathname + location.search)}" style="color:#00ff82">Sign in to RFP Manager</a></p></div>`;
    document.body.appendChild(d);
  }
  let stopped = false;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/live/ws${CG.query}`);
    ws.onopen = () => {
      CG.connected = true;
      reconnectDelay = 500;
      ws.send(JSON.stringify({ type: 'hello', name: CG.askName(), role }));
      CG.renderStatus();
      CG.emit('connected');
    };
    ws.onclose = () => {
      CG.connected = false;
      CG.renderStatus();
      pending.forEach(p => { clearTimeout(p.t); p.reject(new Error('offline')); });
      pending.clear();
      if (!stopped) setTimeout(() => open(), reconnectDelay);
      reconnectDelay = Math.min(5000, reconnectDelay * 2);
    };
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      switch (msg.type) {
        case 'welcome':
          CG.clientId = msg.clientId; CG.catalog = msg.catalog || []; CG.log = msg.log || [];
          CG.emit('catalog', CG.catalog); CG.emit('logReset', CG.log);
          break;
        case 'state':
          CG.state = msg;
          if (msg.sport && msg.sport.serverNow) CG.serverOffset = msg.sport.serverNow - Date.now();
          applyAccent(msg.rfp && msg.rfp.accent);
          CG.renderStatus(); CG.emit('state', msg);
          followProduction();
          break;
        case 'catalog':
          CG.catalog = msg.catalog || []; CG.emit('catalog', CG.catalog);
          break;
        case 'lists':
          CG.lists = { matches: msg.matches || [], teams: msg.teams || [] }; CG.emit('lists', CG.lists);
          break;
        case 'log':
          CG.log.push(msg.entry); if (CG.log.length > 300) CG.log.shift(); CG.emit('log', msg.entry);
          break;
        case 'gfxData':
          CG.emit('gfxData', msg);
          resolvePending(msg.requestId, msg);
          break;
        case 'ack':
          resolvePending(msg.requestId, msg);
          break;
        case 'output':
        case 'outputs':
          CG.emit(msg.type, msg);
          break;
        case 'rfp':
          CG.rfp = msg; CG.emit('rfp', msg);
          document.body.classList.toggle('view-only', !msg.canScore);
          followProduction();
          break;
        case 'tl':
        case 'tlList':
        case 'bridgeOut':
        case 'bridgeDevices':
        case 'devInput':
        case 'dash':
        case 'dashList':
        case 'dashLists':
        case 'dashVars':
        case 'values':
        case 'varSet':
          CG.emit(msg.type, msg);
          break;
        case 'rfpFixtures':
          CG.emit('rfpFixtures', msg.fixtures || []);
          break;
        case 'error':
          if (msg.code === 'AUTH') { stopped = true; authWall(msg.message); break; }
          if (msg.requestId && pending.has(msg.requestId)) {
            const p = pending.get(msg.requestId); pending.delete(msg.requestId); clearTimeout(p.t);
            p.reject(new Error(msg.message));
          } else CG.toast(msg.message, 'err');
          break;
      }
    };
  }

  // A screen opened without a match in its address belongs to this device's live production:
  // it shows the right scorer for the sport, and asks for a match only when none is on air yet.
  let picker = null, pickerAsked = false;
  function followProduction() {
    const st = CG.state, following = !new URLSearchParams(location.search).get('fixture');
    if (!st || !st.rfp || !following) return;
    const page = location.pathname.split('/').pop();
    if (st.rfp.fixtureId && (page === 'stats.html' || page === 'sport.html')) {
      const want = st.mode === 'sport' ? 'sport.html' : 'stats.html';
      if (want !== page) { stopped = true; location.replace(want + location.search); return; }
    }
    if (st.rfp.fixtureId) { if (picker) { picker.remove(); picker = null; } pickerAsked = false; return; }
    if (picker || pickerAsked || !CG.rfp || !CG.rfp.canScore || !st.rfp.local || !['stats', 'sport', 'control'].includes(role)) return;
    pickerAsked = true;
    let used = false;
    const once = list => {
      if (used) return; used = true;
      if (picker || (CG.state && CG.state.rfp.fixtureId)) return;
      const today = new Date().toISOString().slice(0, 10);
      const rows = list.slice().sort((a, b) => (a.date === today ? 0 : 1) - (b.date === today ? 0 : 1) || Math.abs(new Date(a.date || 0) - new Date(today)) - Math.abs(new Date(b.date || 0) - new Date(today))).slice(0, 40);
      picker = CG.h(`<div class="modal-back"><div class="modal" style="width:min(720px,96vw)"><h3>Which match is this production?</h3>
        <p class="muted small">No match is on air on this PC yet. Choose one and every screen (scorer, graphics, commentary, rundown, outputs) follows it. Teams, squads and rules come from the match.</p>
        <div style="max-height:56vh;overflow:auto"><table class="t">${rows.map(f => `<tr class="click" data-fx="${CG.esc(f.id)}"><td class="mono muted">${CG.esc(f.date)} ${CG.esc(f.time)}</td><td><b>${CG.esc(f.name)}</b></td><td class="muted">${CG.esc(f.sport)}</td><td class="muted">${CG.esc(f.status || '')}</td></tr>`).join('') || '<tr><td class="muted">No matches yet. Add one under Fixtures in RFP Manager.</td></tr>'}</table></div>
        <div class="modal-actions"><a class="btn" href="/#/fixtures">Open Fixtures</a><button class="btn ghost" data-close>Not now</button></div></div></div>`);
      picker.addEventListener('click', e => {
        const r = e.target.closest('[data-fx]');
        if (r) CG.send('rfp', 'onAir', { fixtureId: r.dataset.fx }).catch(err => CG.toast(err.message, 'err'));
        else if (e.target.closest('[data-close]')) { picker.remove(); picker = null; }
      });
      document.body.appendChild(picker);
    };
    CG.on('rfpFixtures', once);
    CG.send('rfp', 'fixtures', {}).catch(() => { });
  }

  function resolvePending(id, msg) {
    if (!id || !pending.has(id)) return;
    const p = pending.get(id); pending.delete(id); clearTimeout(p.t); p.resolve(msg);
  }

  window.CG = CG;
})();
