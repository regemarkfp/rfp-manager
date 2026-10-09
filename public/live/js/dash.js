/* RFP Manager – dashboards. A canvas of controls you design by dragging (buttons, take/out buttons, toggles, faders,
   lists, text boxes, number steppers, live text, clocks, images, frames), linked to graphics, actions, macros, adverts,
   devices and your own variables. Design on a PC, use on a PC, tablet or phone (it scales to the screen). */
(function () {
  'use strict';
  const { $, $$, esc, h } = CG;
  const Q = new URLSearchParams(location.search);
  const TYPES = {
    button: { icon: '▣', name: 'Button', w: 150, h: 70 }, graphic: { icon: '◉', name: 'Take / out', w: 170, h: 70 }, toggle: { icon: '⏻', name: 'Toggle', w: 150, h: 70 },
    fader: { icon: '▥', name: 'Fader', w: 80, h: 260 }, dropdown: { icon: '▾', name: 'List', w: 240, h: 70 }, input: { icon: '✎', name: 'Text box', w: 260, h: 70 },
    stepper: { icon: '±', name: 'Number − / +', w: 220, h: 70 }, label: { icon: 'T', name: 'Text / live value', w: 320, h: 60 }, clock: { icon: '◷', name: 'Clock', w: 200, h: 60 },
    image: { icon: '▨', name: 'Image / logo', w: 160, h: 120 }, frame: { icon: '▢', name: 'Frame', w: 420, h: 280 },
  };
  const SOURCES = [['static', 'Choices I type'], ['var', 'The choices of a list variable'], ['players', 'Players of both teams'], ['playersA', 'Players of team A'], ['playersB', 'Players of team B'], ['teams', 'The two teams'], ['adverts', 'Adverts'], ['playlists', 'Ad playlists'], ['graphics', 'Graphics'], ['macros', 'Macros']];
  let id = Q.get('id') || '', doc = null, can = {}, lists = {}, values = {}, onAir = new Set(), design = Q.get('edit') === '1';
  let page = 0, sel = null, dirty = false, lastEdit = 0, saveT = null, undoL = [], redoL = [], clip = null, zoom = 0, k = 1, dashList = [];
  const rid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);

  // ---------------------------------------------------------------- data
  const pages = () => (doc.pages && doc.pages.length ? doc.pages : (doc.pages = [{ id: rid('pg'), name: 'Main', controls: [] }]));
  const ctrls = () => pages()[Math.min(page, pages().length - 1)].controls;
  const W = () => Number(doc.width) || 1280, H = () => Number(doc.height) || 720, G = () => Number(doc.grid) || 10;
  const snap = (v, raw) => (raw ? Math.round(v) : Math.round(v / G()) * G());
  const findSel = () => (sel ? ctrls().find((c) => c.id === sel) : null);
  const plain = () => JSON.parse(JSON.stringify(doc));
  const fillTok = (s) => String(s == null ? '' : s).replace(/\{([A-Za-z_]\w*)\}/g, (m, key) => (values[key] === undefined ? (key === 'nl' ? '\n' : '') : String(values[key])));
  const varVal = (key) => (key ? values['var_' + key] : undefined);
  const varDef = (key) => (lists.variables || []).find((v) => v.key === key);
  function pushUndo() { undoL.push(JSON.stringify(plain())); if (undoL.length > 60) undoL.shift(); redoL = []; }
  function undo(back) { const from = back ? redoL : undoL, to = back ? undoL : redoL; if (!from.length) return; to.push(JSON.stringify(plain())); doc = JSON.parse(from.pop()); if (!findSel()) sel = null; edited(); draw(); }
  function edited() { if (!can.edit) return; dirty = true; lastEdit = Date.now(); pill('UNSAVED', 'warn'); clearTimeout(saveT); saveT = setTimeout(save, 800); }
  function save() { if (!dirty) return; dirty = false; pill('SAVING…', ''); CG.send('dash', 'save', { id, data: plain() }).then(() => { if (!dirty) pill('SAVED', 'ok'); }).catch((e) => { dirty = true; pill('NOT SAVED', 'bad'); if (e.message !== 'offline') CG.toast(e.message, 'err'); }); }
  function pill(t, cls) { const p = $('#d-saved'); p.style.display = design ? '' : 'none'; p.textContent = t; p.className = 'pill ' + (cls || ''); }

  // ---------------------------------------------------------------- server
  CG.on('connected', () => { CG.send('dash', 'list', {}).catch(() => { }); if (id) CG.send('dash', 'open', { id }).catch((e) => { $('#d-main').innerHTML = `<div class="d-empty">${esc(e.message)}</div>`; }); });
  CG.on('dashList', (m) => {
    dashList = m.list || [];
    const p = $('#d-pick');
    p.innerHTML = (id ? '' : '<option value="">Choose a dashboard…</option>') + dashList.map((x) => `<option value="${esc(x.id)}" ${x.id === id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    if (!id && dashList.length) { id = dashList[0].id; history.replaceState(null, '', '?id=' + encodeURIComponent(id) + (design ? '&edit=1' : '')); CG.send('dash', 'open', { id }).catch(() => { }); }
    else if (!id) $('#d-main').innerHTML = '<div class="d-empty">No dashboards yet. Make one in RFP Manager → Live → Dashboards, then open it here.</div>';
  });
  CG.on('dash', (m) => {
    if (m.id !== id) return;
    if (m.can) can = m.can;
    if (m.lists) lists = m.lists;
    const busy = dirty || Date.now() - lastEdit < 1500 || (document.activeElement && document.activeElement.closest && document.activeElement.closest('.d-insp') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
    if (!doc || !m.update || !busy) { doc = m.doc; if (!findSel()) sel = null; document.title = (doc.name || 'Dashboard') + ' – RFP Manager'; draw(); }
  });
  CG.on('dashVars', (m) => { lists.variables = m.variables || []; if (design) drawInsp(); });
  CG.on('values', (m) => {
    values = m.values || {};
    try { onAir = new Set(JSON.parse(values.__onair || '[]')); } catch (e) { onAir = new Set(); }
    (lists.variables || []).forEach((v) => { if (values['var_' + v.key] !== undefined) v.value = values['var_' + v.key]; });
    refreshLive();
  });
  const send = (actions, label, vars) => { if (!can.use) { CG.toast('This screen is view-only. Sign in as a Scorer (or higher) to use it.', 'err'); return; } if (!actions || !actions.length) return; CG.send('gfx', 'run', { actions, label: label || '', from: 'dash', vars: vars || {} }).catch((e) => CG.toast(e.message, 'err')); };
  const setVar = (key, value) => { if (!can.use) { CG.toast('This screen is view-only.', 'err'); return Promise.resolve(); } if (!key) return Promise.resolve(); return CG.send('gfx', 'setvar', { key, value }).catch((e) => CG.toast(e.message, 'err')); };

  // ---------------------------------------------------------------- top bar
  $('#d-pick').onchange = (e) => { id = e.target.value; doc = null; sel = null; undoL = []; redoL = []; history.replaceState(null, '', '?id=' + encodeURIComponent(id) + (design ? '&edit=1' : '')); CG.send('dash', 'open', { id }).catch(() => { }); };
  $('#d-mode').onclick = () => { if (!design && !can.edit) { CG.toast('You need the Producer role to design dashboards', 'err'); return; } design = !design; if (!design) save(); history.replaceState(null, '', '?id=' + encodeURIComponent(id) + (design ? '&edit=1' : '')); draw(); };
  $('#d-full').onclick = (e) => { e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => { }); };
  function drawPages() {
    const box = $('#d-pages');
    box.innerHTML = pages().map((p, i) => `<button class="tab ${i === page ? 'active' : ''}" data-pg="${i}">${esc(p.name)}</button>`).join('') + (design ? '<button class="tab" data-pg-add title="Add a page">+</button>' : '');
    box.onclick = (e) => {
      const b = e.target.closest('[data-pg]'); if (b) { page = Number(b.dataset.pg); sel = null; draw(); return; }
      if (e.target.closest('[data-pg-add]')) { pushUndo(); pages().push({ id: rid('pg'), name: 'Page ' + (pages().length + 1), controls: [] }); page = pages().length - 1; sel = null; edited(); draw(); }
    };
    box.style.display = pages().length > 1 || design ? '' : 'none';
  }

  // ---------------------------------------------------------------- draw
  function draw() {
    const main = $('#d-main');
    $('#d-mode').textContent = design ? '▶ USE' : '✎ DESIGN';
    $('#d-mode').style.display = can.edit ? '' : 'none';
    pill(dirty ? 'UNSAVED' : 'SAVED', dirty ? 'warn' : 'ok');
    if (!doc) return;
    if (page >= pages().length) page = 0;
    drawPages();
    $('#d-line').textContent = doc.name || '';
    main.className = 'd-main' + (design ? ' design' : '');
    main.innerHTML = '';
    if (design) main.appendChild(palette());
    const wrap = h('<div class="d-stagewrap" id="d-wrap"><div id="d-sizer" style="position:relative"><div class="d-stage" id="d-stage"></div></div></div>');
    main.appendChild(wrap);
    if (design) { main.appendChild(h('<aside class="d-insp" id="d-insp"></aside>')); wrap.appendChild(h('<div class="d-zoom"><button class="btn sm" data-z="-">−</button><button class="btn sm" data-z="fit">Fit</button><button class="btn sm" data-z="+">+</button></div>')); }
    const st = $('#d-stage');
    st.style.width = W() + 'px'; st.style.height = H() + 'px';
    st.classList.toggle('light', doc.theme === 'light');
    st.classList.toggle('grid', design);
    if (design) st.style.backgroundSize = `${G() * 2}px ${G() * 2}px`;
    for (const c of ctrls()) st.appendChild(render(c));
    fit();
    if (design) drawInsp();
    refreshLive();
    $$('[data-z]', wrap).forEach((b) => b.onclick = () => { const z = b.dataset.z; zoom = z === 'fit' ? 0 : Math.max(0.2, Math.min(3, (zoom || k) * (z === '+' ? 1.2 : 1 / 1.2))); fit(); });
  }
  function fit() {
    const wrap = $('#d-wrap'), st = $('#d-stage'), sz = $('#d-sizer'); if (!wrap || !st) return;
    const cw = wrap.clientWidth - (design ? 48 : 0), ch = wrap.clientHeight - (design ? 48 : 0);
    k = design && zoom ? zoom : Math.min(cw / W(), ch / H());
    if (!design && (cw / W()) / k > 1.5) k = cw / W();            // a phone held upright: fit the width and scroll down
    if (!design) wrap.style.overflowY = H() * k > wrap.clientHeight + 2 ? 'auto' : 'hidden';
    k = Math.max(0.1, k);
    st.style.transform = `scale(${k})`;
    sz.style.width = W() * k + (design ? 48 : 0) + 'px'; sz.style.height = H() * k + (design ? 48 : 0) + 'px';
  }
  window.addEventListener('resize', () => { if (doc) fit(); });

  // one control; in use mode it does what it is set up to do
  function render(c) {
    const el = h(`<div class="d-c ${c.type === 'frame' ? 'frame' : ''} ${sel === c.id && design ? 'sel' : ''}" data-id="${esc(c.id)}"></div>`);
    Object.assign(el.style, { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px', color: c.fg || '', fontSize: (c.font || (c.type === 'label' || c.type === 'clock' ? 26 : 16)) + 'px', zIndex: c.type === 'frame' ? 0 : 1 });
    const bg = c.bg ? `background:${esc(c.bg)};border-color:${esc(c.bg)};` : '';
    const label = esc(c.label || (TYPES[c.type] || {}).name || '');
    switch (c.type) {
      case 'button': el.innerHTML = `<button class="d-btn" style="${bg}">${label}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</button>`; break;
      case 'graphic': el.innerHTML = `<button class="d-btn" style="${bg}">${esc(c.label || gname(c.graphic) || 'Choose a graphic')}<small data-gs>TAKE</small></button>`; break;
      case 'toggle': el.innerHTML = `<button class="d-btn" style="${bg}">${label}<small data-ts>OFF</small></button>`; break;
      case 'fader': el.innerHTML = `<div class="d-fader ${c.horizontal ? 'h' : ''}" style="${bg}"><div class="lbl">${label}</div><div class="track"><div class="rail"></div><div class="fill"></div><div class="knob"></div></div><div class="val" data-fv>–</div></div>`; break;
      case 'dropdown': el.innerHTML = `<div class="d-box" style="${bg}"><span>${label}</span><select data-dd></select></div>`; break;
      case 'input': el.innerHTML = c.multiline
        ? `<div class="d-box ml" style="${bg}"><span>${label}</span><div class="row" style="gap:6px;flex-wrap:nowrap;align-items:stretch;flex:1;min-height:0"><textarea data-in placeholder="${esc(c.placeholder || 'Several lines – Ctrl+Enter sends')}" style="flex:1;resize:none"></textarea><button class="btn sm" data-in-go title="Send (Ctrl+Enter)">Set</button></div></div>`
        : `<div class="d-box" style="${bg}"><span>${label}</span><div class="row" style="gap:6px;flex-wrap:nowrap"><input type="text" data-in placeholder="${esc(c.placeholder || '')}" style="flex:1"><button class="btn sm" data-in-go>Set</button></div></div>`; break;
      case 'stepper': el.innerHTML = `<div class="d-box" style="${bg}"><span>${label}</span><div class="d-step"><button class="btn" data-st="-">−</button><b data-sv>–</b><button class="btn" data-st="+">+</button></div></div>`; break;
      case 'label': el.innerHTML = `<div class="d-label" data-lb style="justify-content:${c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start'};text-align:${esc(c.align || 'left')};font-weight:${c.bold === false ? 400 : 800};${c.bg ? 'background:' + esc(c.bg) + ';border-radius:8px;' : ''}"></div>`; break;
      case 'clock': el.innerHTML = `<div class="d-label" data-ck style="justify-content:center;font-family:var(--mono);font-weight:800;${c.bg ? 'background:' + esc(c.bg) + ';border-radius:8px;' : ''}"></div>`; break;
      case 'image': el.innerHTML = `<img class="d-img" data-im alt="" style="object-fit:${c.fit === 'cover' ? 'cover' : 'contain'}">`; break;
      case 'frame': el.innerHTML = `<div class="d-frame" style="${c.bg ? 'background:' + esc(c.bg) + ';' : ''}">${c.label ? `<b>${label}</b>` : ''}</div>`; break;
      default: el.innerHTML = `<div class="d-label">${esc(c.type)}</div>`;
    }
    if (design) { el.appendChild(h('<span class="d-rz"></span>')); return el; }
    wire(el, c);
    return el;
  }
  const gname = (gid) => { const g = (CG.catalog || []).find((x) => x.id === gid); return g ? g.name : ''; };
  function optionsOf(c) {
    const st = CG.state, pl = (t) => { if (!st) return []; const team = st.mode === 'cricket' ? (t === 'A' ? st.match.teamA : st.match.teamB) : st.sport && st.sport.setup && st.sport.setup.teams ? st.sport.setup.teams[t] : null; return team && team.players ? team.players.map((p) => [p.id || p.name, (p.number ? p.number + ' ' : '') + (p.tvName || p.name || '')]) : []; };
    switch (c.source || 'static') {
      case 'var': { const v = varDef(c.bind); return v ? v.options.map((o) => [o, o]) : []; }
      case 'players': return [...pl('A'), ...pl('B')];
      case 'playersA': return pl('A'); case 'playersB': return pl('B');
      case 'teams': return [['A', values.teamA_name || 'Team A'], ['B', values.teamB_name || 'Team B']];
      case 'adverts': return (lists.adverts || []).map((x) => [x.id, x.name]);
      case 'playlists': return (lists.playlists || []).map((x) => [x.id, x.name]);
      case 'graphics': return (CG.catalog || []).filter((g) => !g.hidden).map((g) => [g.id, g.name]);
      case 'macros': return (lists.macros || []).map((x) => [x.id, x.name]);
      default: return String(c.options || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(.*?)\s*=\s*(.*)$/.exec(l); return m ? [m[1], m[2]] : [l, l]; });
    }
  }
  function defaultActions(c, value) {
    if (c.actions && c.actions.length) return c.actions;
    switch (c.source) {
      case 'adverts': return [{ do: 'advert', target: value }];
      case 'playlists': return [{ do: 'playlist', target: value }];
      case 'graphics': return [{ do: 'show', target: value }];
      case 'macros': return [{ do: 'macro', target: value }];
      default: return [];
    }
  }
  function wire(el, c) {
    const flash = () => { const b = $('.d-btn', el); if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); } };
    if (c.type === 'button') $('.d-btn', el).onclick = async () => { if (c.confirm && !(await CG.modal(c.label || 'Are you sure?', `<p>${esc(c.confirmText || 'Run this?')}</p>`, { ok: c.label || 'Go' }))) return; flash(); send(c.actions, c.label); };
    if (c.type === 'graphic') $('.d-btn', el).onclick = () => { if (!c.graphic) return; if (!can.use) { CG.toast('This screen is view-only.', 'err'); return; } flash(); CG.send('gfx', onAir.has(c.graphic) ? 'hide' : 'show', { id: c.graphic }).catch((e) => CG.toast(e.message, 'err')); };
    if (c.type === 'toggle') $('.d-btn', el).onclick = () => {
      const on = !isOn(c);
      if (c.bind) setVar(c.bind, on ? '1' : ''); else { localOn[c.id] = on; refreshLive(); }
      flash(); send(on ? c.onActions : c.offActions, c.label + (on ? ' on' : ' off'));
    };
    if (c.type === 'fader') {
      const tr = $('.track', el); let dragging = false, lastSent = 0, tSend = null;
      const valAt = (e) => { const r = tr.getBoundingClientRect(), min = num(c.min, 0), max = num(c.max, 100), step = num(c.step, 1) || 1; let f = c.horizontal ? (e.clientX - r.left - 6) / (r.width - 12) : 1 - (e.clientY - r.top - 6) / (r.height - 12); f = Math.max(0, Math.min(1, f)); return Math.round((min + f * (max - min)) / step) * step; };
      const out = (v, final) => { el._fv = v; paintFader(el, c, v); const now = Date.now(); clearTimeout(tSend); const go = () => { lastSent = Date.now(); if (c.bind) setVar(c.bind, String(v)); if (c.actions && c.actions.length && (final || c.live)) send(c.actions, c.label, { value: String(v) }); }; if (final || now - lastSent > 90) go(); else tSend = setTimeout(go, 90); };
      tr.addEventListener('pointerdown', (e) => { if (!can.use) { CG.toast('This screen is view-only.', 'err'); return; } dragging = true; el._drag = true; tr.setPointerCapture(e.pointerId); out(valAt(e)); e.preventDefault(); });
      tr.addEventListener('pointermove', (e) => { if (dragging) out(valAt(e)); });
      const end = (e) => { if (!dragging) return; dragging = false; el._drag = false; out(valAt(e), true); };
      tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
    }
    if (c.type === 'dropdown') {
      const s = $('[data-dd]', el);
      s.onfocus = () => fillSelect(s, c);
      s.onchange = () => { const v = s.value, lbl = s.options[s.selectedIndex] ? s.options[s.selectedIndex].text : v; if (!v) return; if (c.bind) setVar(c.bind, c.useLabel === false ? v : lbl); send(defaultActions(c, v), c.label, { value: v, label: lbl }); if (!c.bind && c.reset !== false) setTimeout(() => { s.value = ''; }, 400); };
      fillSelect(s, c);
    }
    if (c.type === 'input') {
      const i = $('[data-in]', el), go = () => { if (c.bind) setVar(c.bind, i.value); send(c.actions, c.label, { value: i.value }); i.blur(); };
      i.onkeydown = (e) => { if (e.key === 'Enter' && (i.tagName !== 'TEXTAREA' || e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } }; $('[data-in-go]', el).onclick = go;
    }
    if (c.type === 'stepper') $$('[data-st]', el).forEach((b) => b.onclick = () => { const st = num(c.step, 1) || 1; if (c.bind) setVar(c.bind, (b.dataset.st === '+' ? '+' : '-') + st); send(b.dataset.st === '+' ? c.actions : c.downActions, c.label); });
  }
  const num = (v, d) => { const x = Number(v); return Number.isFinite(x) && v !== '' && v !== null && v !== undefined ? x : d; };
  const localOn = {};
  const isOn = (c) => (c.bind ? (() => { const v = varVal(c.bind); return !!v && v !== '0'; })() : !!localOn[c.id]);
  function fillSelect(s, c) {
    const opts = optionsOf(c), cur = c.bind ? varVal(c.bind) : '';
    const sig = JSON.stringify(opts) + cur;
    if (s._sig === sig) return; s._sig = sig;
    s.innerHTML = `<option value="">${esc(c.placeholder || 'choose…')}</option>` + opts.map(([v, l]) => `<option value="${esc(v)}" ${cur !== undefined && cur !== '' && (cur === l || cur === v) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  }
  function paintFader(el, c, v) {
    const min = num(c.min, 0), max = num(c.max, 100), f = max > min ? Math.max(0, Math.min(1, (num(v, min) - min) / (max - min))) : 0;
    const knob = $('.knob', el), fill = $('.fill', el);
    if (c.horizontal) { knob.style.left = `calc(6px + ${f} * (100% - 12px))`; fill.style.width = `calc(${f} * (100% - 12px))`; }
    else { knob.style.top = `calc(100% - 6px - ${f} * (100% - 12px))`; fill.style.height = `calc(${f} * (100% - 12px))`; }
    $('[data-fv]', el).textContent = v === undefined || v === '' ? '–' : String(v) + (c.unit || '');
  }
  // what changes while the dashboard is open: live text, lit buttons, fader positions, list choices
  function refreshLive() {
    if (!doc) return;
    for (const c of ctrls()) {
      const el = $(`.d-c[data-id="${CSS.escape(c.id)}"]`); if (!el) continue;
      if (c.type === 'label') { const t = fillTok(c.text || c.label || ''); const lb = $('[data-lb]', el); if (lb.textContent !== t) lb.textContent = t || (design ? '(live text)' : ''); }
      else if (c.type === 'image') { const src = fillTok(c.src || ''); const im = $('[data-im]', el); if (im.getAttribute('src') !== src) { if (src) im.setAttribute('src', src); else im.removeAttribute('src'); } }
      else if (c.type === 'graphic') { const on = onAir.has(c.graphic); $('.d-btn', el).classList.toggle('lit', on); $('[data-gs]', el).textContent = on ? 'ON AIR · OUT' : 'TAKE'; }
      else if (c.type === 'button') { const lit = c.lit ? (c.lit.startsWith('onair:') ? onAir.has(c.lit.slice(6)) : (() => { const v = values[c.lit.replace(/^\{|\}$/g, '')]; return !!v && v !== '0'; })()) : (c.actions || []).some((a) => a.do === 'show' && a.target && onAir.has(a.target)); $('.d-btn', el).classList.toggle('lit', lit); }
      else if (c.type === 'toggle') { const on = isOn(c); $('.d-btn', el).classList.toggle('on', on); $('[data-ts]', el).textContent = on ? 'ON' : 'OFF'; }
      else if (c.type === 'fader') { if (!el._drag) paintFader(el, c, c.bind ? varVal(c.bind) : el._fv); }
      else if (c.type === 'stepper') { const v = varVal(c.bind); $('[data-sv]', el).textContent = v === undefined || v === '' ? '0' : v; }
      else if (c.type === 'dropdown') { const s = $('[data-dd]', el); if (s && document.activeElement !== s) fillSelect(s, c); }
      else if (c.type === 'input') { const i = $('[data-in]', el); if (i && document.activeElement !== i && c.bind) { const v = varVal(c.bind); if (v !== undefined) i.value = v; } }
    }
  }
  setInterval(() => {
    if (!doc) return;
    const d = new Date();
    for (const c of ctrls()) if (c.type === 'clock') { const el = $(`.d-c[data-id="${CSS.escape(c.id)}"] [data-ck]`); if (!el) continue; const t = c.source && c.source !== 'local' ? fillTok('{' + c.source + '}') : d.toTimeString().slice(0, c.seconds === false ? 5 : 8); el.textContent = t; }
  }, 250);

  // ---------------------------------------------------------------- design: palette, inspector, mouse
  function palette() {
    const p = h('<aside class="d-palette"><h4>Drag onto the dashboard</h4></aside>');
    for (const [t, x] of Object.entries(TYPES)) p.appendChild(h(`<div class="d-tool" data-tool="${t}"><i>${x.icon}</i>${esc(x.name)}</div>`));
    p.appendChild(h('<p class="small muted" style="margin-top:10px">Drag a control onto the page, or click it to add it in the middle. Drag to move, the corner to resize. Delete · Ctrl+D duplicate · Ctrl+C / Ctrl+V · arrows nudge · Ctrl+Z undo.</p>'));
    return p;
  }
  function addControl(type, x, y) {
    const t = TYPES[type]; pushUndo();
    const c = { id: rid('ctl'), type, x: snap(Math.max(0, Math.min(W() - t.w, x - t.w / 2))), y: snap(Math.max(0, Math.min(H() - t.h, y - t.h / 2))), w: t.w, h: t.h, label: ['label', 'clock', 'image', 'graphic'].includes(type) ? '' : t.name };
    if (type === 'button') c.actions = [{ do: 'show', target: '', values: {}, delay: 0 }];
    if (type === 'label') c.text = '{teamA_name} {scoreA} – {scoreB} {teamB_name}';
    if (type === 'fader') { c.min = 0; c.max = 100; c.step = 1; }
    if (type === 'stepper') c.step = 1;
    if (type === 'toggle') { c.onActions = []; c.offActions = []; }
    ctrls().push(c); sel = c.id; edited(); draw();
    return c;
  }
  let drag = null;
  const stagePt = (e) => { const r = $('#d-stage').getBoundingClientRect(); return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };
  document.addEventListener('pointerdown', (e) => {
    if (!design || !doc || e.button > 0) return;
    const tool = e.target.closest && e.target.closest('[data-tool]');
    if (tool) { drag = { kind: 'new', type: tool.dataset.tool, x0: e.clientX, y0: e.clientY, moved: false }; e.preventDefault(); return; }
    const st = $('#d-stage'); if (!st || !st.contains(e.target)) return;
    const el = e.target.closest('.d-c');
    if (!el) { if (sel) { sel = null; $$('.d-c.sel').forEach((x) => x.classList.remove('sel')); drawInsp(); } return; }
    const c = ctrls().find((x) => x.id === el.dataset.id); if (!c) return;
    if (sel !== c.id) { sel = c.id; $$('.d-c.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); drawInsp(); }
    if (c.locked) return;
    const p = stagePt(e);
    drag = { kind: e.target.closest('.d-rz') ? 'resize' : 'move', c, el, p0: p, x0: c.x, y0: c.y, w0: c.w, h0: c.h, moved: false, before: JSON.stringify(plain()) };
    el.setPointerCapture(e.pointerId); e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.kind === 'new') { if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) { drag.moved = true; document.body.style.cursor = 'copy'; } return; }
    const p = stagePt(e), dx = p.x - drag.p0.x, dy = p.y - drag.p0.y, raw = e.altKey;
    if (!drag.moved && Math.hypot(dx * k, dy * k) < 3) return;
    drag.moved = true;
    const c = drag.c;
    if (drag.kind === 'move') { c.x = Math.max(0, Math.min(W() - c.w, snap(drag.x0 + dx, raw))); c.y = Math.max(0, Math.min(H() - c.h, snap(drag.y0 + dy, raw))); drag.el.style.left = c.x + 'px'; drag.el.style.top = c.y + 'px'; }
    else { c.w = Math.max(G() * 2, Math.min(W() - c.x, snap(drag.w0 + dx, raw))); c.h = Math.max(G() * 2, Math.min(H() - c.y, snap(drag.h0 + dy, raw))); drag.el.style.width = c.w + 'px'; drag.el.style.height = c.h + 'px'; }
    const pos = $('#di-pos'); if (pos) pos.textContent = `${c.x}, ${c.y} · ${c.w} × ${c.h}`;
  });
  document.addEventListener('pointerup', (e) => {
    const d = drag; drag = null; document.body.style.cursor = '';
    if (!d) return;
    if (d.kind === 'new') {
      const st = $('#d-stage'), r = st.getBoundingClientRect();
      if (!d.moved) { addControl(d.type, W() / 2, H() / 2); return; }
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { const p = stagePt(e); addControl(d.type, p.x, p.y); }
      return;
    }
    if (!d.moved) return;
    undoL.push(d.before); redoL = []; edited(); drawInsp();
  });
  document.addEventListener('keydown', (e) => {
    if (!design || !doc) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const c = findSel(), mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); undo(e.shiftKey); return; }
    if (mod && key === 'y') { e.preventDefault(); undo(true); return; }
    if (mod && key === 'v' && clip) { e.preventDefault(); pushUndo(); const n = Object.assign(JSON.parse(clip), { id: rid('ctl') }); n.x = Math.min(W() - n.w, n.x + G() * 2); n.y = Math.min(H() - n.h, n.y + G() * 2); ctrls().push(n); sel = n.id; edited(); draw(); return; }
    if (!c) return;
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); pushUndo(); pages()[page].controls = ctrls().filter((x) => x !== c); sel = null; edited(); draw(); return; }
    if (mod && key === 'd') { e.preventDefault(); pushUndo(); const n = Object.assign(JSON.parse(JSON.stringify(c)), { id: rid('ctl'), x: Math.min(W() - c.w, c.x + G() * 2), y: Math.min(H() - c.h, c.y + G() * 2) }); ctrls().push(n); sel = n.id; edited(); draw(); return; }
    if (mod && key === 'c') { clip = JSON.stringify(c); CG.toast('Copied', 'ok'); return; }
    if (key === 'escape') { sel = null; draw(); return; }
    const st = e.shiftKey ? G() * 5 : e.altKey ? 1 : G();
    const mv = { arrowleft: [-st, 0], arrowright: [st, 0], arrowup: [0, -st], arrowdown: [0, st] }[key];
    if (mv) { e.preventDefault(); pushUndo(); c.x = Math.max(0, Math.min(W() - c.w, c.x + mv[0])); c.y = Math.max(0, Math.min(H() - c.h, c.y + mv[1])); edited(); const el = $(`.d-c[data-id="${CSS.escape(c.id)}"]`); if (el) { el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; } }
  });

  // the inspector: the selected control's settings, or the dashboard's
  function drawInsp() {
    const old = $('#d-insp'); if (!old) return;
    const box = old.cloneNode(false); old.replaceWith(box);
    const c = findSel();
    const varOpts = (cur) => `<option value="">— none —</option>` + (lists.variables || []).map((v) => `<option value="${esc(v.key)}" ${v.key === cur ? 'selected' : ''}>${esc(v.name)} {var_${esc(v.key)}}</option>`).join('');
    const f = (k, label, type, extra) => `<label class="f ${extra && extra.full ? 'full' : ''}"><span>${label}</span>${type === 'textarea' ? `<textarea data-k="${k}" rows="${(extra && extra.rows) || 3}">${esc(c ? c[k] || '' : '')}</textarea>` : type === 'check' ? `<input type="checkbox" data-k="${k}" ${c && c[k] ? 'checked' : ''}>` : `<input type="${type || 'text'}" data-k="${k}" value="${esc(c && c[k] != null ? c[k] : '')}" ${extra && extra.ph ? `placeholder="${esc(extra.ph)}"` : ''}>`}</label>`;
    const colour = (k, label) => `<label class="f"><span>${label}</span><div class="row" style="gap:6px;flex-wrap:nowrap"><input type="checkbox" data-use="${k}" ${c[k] ? 'checked' : ''}><input type="color" data-col="${k}" value="${esc(c[k] || (k === 'fg' ? '#ffffff' : '#2f6bff'))}" style="width:48px;height:30px;padding:0"></div></label>`;
    if (!c) {
      box.innerHTML = `<h4>Dashboard</h4><div class="form-grid">
        <label class="f full"><span>Name</span><input type="text" data-d="name" value="${esc(doc.name || '')}"></label>
        <label class="f"><span>Width (px)</span><input type="number" data-d="width" value="${W()}"></label><label class="f"><span>Height (px)</span><input type="number" data-d="height" value="${H()}"></label>
        <label class="f"><span>Grid (px)</span><input type="number" data-d="grid" value="${G()}"></label>
        <label class="f"><span>Look</span><select data-d="theme"><option value="dark">Dark</option><option value="light" ${doc.theme === 'light' ? 'selected' : ''}>Light</option></select></label>
        <div class="row full" style="grid-column:1/-1;gap:4px">${[['1280×720', 1280, 720], ['1920×1080', 1920, 1080], ['iPad 1024×768', 1024, 768], ['iPad upright', 768, 1024], ['Phone', 390, 760]].map(([l, w, hh]) => `<button class="btn sm" data-size="${w}x${hh}">${l}</button>`).join('')}</div>
      </div>
      <h4 style="margin-top:14px">This page</h4><div class="form-grid"><label class="f full"><span>Page name</span><input type="text" data-p="name" value="${esc(pages()[page].name)}"></label></div>
      <div class="row" style="margin-top:6px">${pages().length > 1 ? '<button class="btn sm danger" data-p-del>Delete this page</button>' : ''}<button class="btn sm" data-p-dup>Duplicate page</button></div>
      <p class="small muted" style="margin-top:12px">Click a control to change it. Live text uses live values in braces: {teamA_name}, {scoreA}, {clock_text}, {var_attendance} … Your own variables are made in RFP Manager → Live → Variables &amp; triggers.</p>`;
      box.addEventListener('input', (e) => { const k2 = e.target.dataset.d, kp = e.target.dataset.p; if (!k2 && !kp) return; if (k2) doc[k2] = e.target.type === 'number' ? Number(e.target.value) : e.target.value; if (kp) { pages()[page].name = e.target.value; drawPages(); } edited(); if (k2 && k2 !== 'name') { clearTimeout(box._t); box._t = setTimeout(() => draw(), 400); } });
      box.addEventListener('change', (e) => { if (e.target.dataset.d === 'theme') { doc.theme = e.target.value; edited(); draw(); } });
      box.addEventListener('click', (e) => {
        const sz = e.target.closest('[data-size]'); if (sz) { pushUndo(); const [w, hh] = sz.dataset.size.split('x').map(Number); doc.width = w; doc.height = hh; edited(); draw(); return; }
        if (e.target.closest('[data-p-del]')) { pushUndo(); pages().splice(page, 1); page = 0; edited(); draw(); return; }
        if (e.target.closest('[data-p-dup]')) { pushUndo(); const p = JSON.parse(JSON.stringify(pages()[page])); p.id = rid('pg'); p.name += ' copy'; p.controls.forEach((x) => { x.id = rid('ctl'); }); pages().push(p); page = pages().length - 1; edited(); draw(); }
      });
      return;
    }
    const t = c.type, gopts = `<option value="">choose a graphic…</option>` + (CG.catalog || []).filter((g) => !g.hidden).map((g) => `<option value="${esc(g.id)}" ${g.id === c.graphic ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
    box.innerHTML = `<h4>${esc((TYPES[t] || {}).name || t)}<span class="sp" style="flex:1"></span><span class="small muted" id="di-pos">${c.x}, ${c.y} · ${c.w} × ${c.h}</span></h4>
      <div class="d-ctx"><button class="btn sm" data-z-up title="In front">▲</button><button class="btn sm" data-z-dn title="Behind">▼</button><button class="btn sm" data-dup>Duplicate</button><button class="btn sm" data-lock>${c.locked ? 'Unlock' : 'Lock'}</button><button class="btn sm danger" data-del>Delete</button></div>
      <div class="form-grid">
        ${t === 'label' ? f('text', 'Text (live values in braces)', 'textarea', { full: true, rows: 3 }) : t === 'image' ? f('src', 'Picture address (or {teamA_logo})', 'text', { full: true, ph: '{teamA_logo}' }) : f('label', t === 'frame' ? 'Title' : 'Label', 'text', { full: true })}
        ${t === 'button' ? f('sub', 'Small line under it') + f('lit', 'Lit while (live value or onair:graphic)', 'text', { ph: 'var_ready  or  onair:scorebug' }) : ''}
        ${t === 'graphic' ? `<label class="f full"><span>Graphic</span><select data-k="graphic">${gopts}</select></label>` : ''}
        ${['toggle', 'fader', 'dropdown', 'input', 'stepper'].includes(t) ? `<label class="f full"><span>${t === 'dropdown' ? 'Put the choice in the variable' : 'Variable'}</span><select data-k="bind">${varOpts(c.bind)}</select></label>` : ''}
        ${t === 'fader' ? f('min', 'Lowest', 'number') + f('max', 'Highest', 'number') + f('step', 'Step', 'number') + f('unit', 'Unit', 'text', { ph: '%' }) + f('horizontal', 'Sideways', 'check') + f('live', 'Actions while moving (not only on release)', 'check') : ''}
        ${t === 'stepper' ? f('step', 'Step', 'number') : ''}
        ${t === 'dropdown' ? `<label class="f full"><span>Choices</span><select data-k="source">${SOURCES.map(([v, l]) => `<option value="${v}" ${(c.source || 'static') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${(c.source || 'static') === 'static' ? f('options', 'One per line (value = label, or just a label)', 'textarea', { full: true, rows: 4 }) : ''}${f('placeholder', 'Shows when nothing is chosen')}` : ''}
        ${t === 'input' ? f('placeholder', 'Hint in the box') + f('multiline', 'Several lines (Enter = new line, Ctrl+Enter = Set)', 'check', { full: true }) : ''}
        ${t === 'label' ? `<label class="f"><span>Align</span><select data-k="align">${['left', 'center', 'right'].map((a) => `<option ${(c.align || 'left') === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>` : ''}
        ${t === 'clock' ? `<label class="f full"><span>Shows</span><select data-k="source"><option value="local">Time of day</option>${['clock_text', 'shot_text', 'timeline_time', 'timeline_next_in', 'timeline_remaining', 'countdown_text'].map((x) => `<option value="${x}" ${c.source === x ? 'selected' : ''}>{${x}}</option>`).join('')}</select></label>${f('seconds', 'With seconds', 'check')}` : ''}
        ${t === 'image' ? `<label class="f"><span>Fit</span><select data-k="fit"><option value="contain">Fit inside</option><option value="cover" ${c.fit === 'cover' ? 'selected' : ''}>Fill</option></select></label>` : ''}
        ${t === 'button' ? f('confirm', 'Ask before it runs', 'check') : ''}
        ${f('font', 'Text size (px)', 'number')}
        ${colour('bg', 'Colour')}${colour('fg', 'Text colour')}
      </div>
      ${t === 'button' || t === 'input' || t === 'fader' || t === 'dropdown' ? `<h4 style="margin-top:12px">${t === 'button' ? 'When pressed' : t === 'fader' ? 'When moved' : t === 'dropdown' ? 'When a choice is made' : 'When set'}</h4><div id="di-a1"></div>` : ''}
      ${t === 'stepper' ? '<h4 style="margin-top:12px">Also on +</h4><div id="di-a1"></div><h4>Also on −</h4><div id="di-a3"></div>' : ''}
      ${t === 'toggle' ? '<h4 style="margin-top:12px">When turned on</h4><div id="di-a1"></div><h4>When turned off</h4><div id="di-a2"></div>' : ''}
      ${t === 'dropdown' && ['adverts', 'playlists', 'graphics', 'macros'].includes(c.source) ? '<p class="small muted">With no actions the choice plays that advert / starts that playlist / takes that graphic / runs that macro.</p>' : ''}`;
    const hint = t === 'fader' ? '{value} is where the fader is.' : t === 'dropdown' ? '{value} is the choice (an id for adverts, players, graphics), {label} its name.' : t === 'input' ? '{value} is what was typed.' : 'Values can use every live value in braces.';
    if (t === 'toggle') { c.onActions = c.onActions || []; c.offActions = c.offActions || []; $('#di-a1', box).appendChild(CG.actionsEditor(c.onActions, { hint })); $('#di-a2', box).appendChild(CG.actionsEditor(c.offActions, { hint })); }
    else if (t === 'stepper') { c.actions = c.actions || []; c.downActions = c.downActions || []; $('#di-a1', box).appendChild(CG.actionsEditor(c.actions, { hint })); $('#di-a3', box).appendChild(CG.actionsEditor(c.downActions, { hint })); }
    else if ($('#di-a1', box)) { c.actions = c.actions || []; $('#di-a1', box).appendChild(CG.actionsEditor(c.actions, { hint })); }
    let pushed = false;
    box.addEventListener('focusin', () => { if (!pushed) { pushUndo(); pushed = true; } });
    box.addEventListener('focusout', () => { pushed = false; });
    const apply = (e) => {
      const k2 = e.target.dataset.k, use = e.target.dataset.use, col = e.target.dataset.col;
      if (k2) c[k2] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
      else if (use) c[use] = e.target.checked ? $(`[data-col="${use}"]`, box).value : '';
      else if (col) { if ($(`[data-use="${col}"]`, box).checked) c[col] = e.target.value; else return; }
      else { setTimeout(() => { edited(); redrawOne(c); }, 0); return; }          // the actions editor changed its list
      edited(); redrawOne(c);
      if (k2 === 'source' || k2 === 'bind') drawInsp();
    };
    box.addEventListener('input', apply); box.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'color') apply(e); });
    box.addEventListener('click', (e) => {
      if (e.target.closest('#di-a1, #di-a2, #di-a3')) { setTimeout(edited, 0); return; }
      const L = ctrls(), i = L.indexOf(c);
      if (e.target.closest('[data-del]')) { pushUndo(); L.splice(i, 1); sel = null; edited(); draw(); }
      else if (e.target.closest('[data-dup]')) { pushUndo(); const n = Object.assign(JSON.parse(JSON.stringify(c)), { id: rid('ctl'), x: Math.min(W() - c.w, c.x + G() * 2), y: Math.min(H() - c.h, c.y + G() * 2) }); L.push(n); sel = n.id; edited(); draw(); }
      else if (e.target.closest('[data-lock]')) { c.locked = !c.locked; edited(); drawInsp(); }
      else if (e.target.closest('[data-z-up]')) { pushUndo(); L.splice(i, 1); L.push(c); edited(); draw(); }
      else if (e.target.closest('[data-z-dn]')) { pushUndo(); L.splice(i, 1); L.unshift(c); edited(); draw(); }
    });
  }
  function redrawOne(c) { const old = $(`.d-c[data-id="${CSS.escape(c.id)}"]`); if (!old) return; const n = render(c); old.replaceWith(n); refreshLive(); }

  CG.connect('dash');
})();
