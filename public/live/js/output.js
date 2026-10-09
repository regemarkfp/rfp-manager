/* CricketCG – browser output channel (mimics a CasparCG channel with HTML producers per layer). */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const D = window.OUTPUT_DEFAULTS || {};
  const opt = k => q.has(k) ? q.get(k) : D[k];

  const chSpec = (opt('ch') || 'pgm').toLowerCase();
  const stage = document.getElementById('stage');
  const layers = new Map(); // layer -> { views: [{ frame, ready, queue }], template, playing }
  // What this screen sends out: fill (the picture), key (white where the picture is, black elsewhere, grey for see-through
  // parts) or fillkey (both side by side, 3840x1080, for a device with two HDMI outputs such as a Raspberry Pi).
  const mode = ({ key: 'key', fillkey: 'fillkey', 'fill-key': 'fillkey', both: 'fillkey' })[String(opt('mode') || '').toLowerCase()] || 'fill';
  const kinds = mode === 'fillkey' ? (opt('swap') === '1' ? ['key', 'fill'] : ['fill', 'key']) : [mode];
  const W = 1920 * kinds.length;
  stage.style.width = W + 'px';
  const views = kinds.map((kind, i) => {
    const v = document.createElement('div');
    v.className = 'view ' + kind + (kind === 'key' && opt('invert') === '1' ? ' inv' : '');
    v.style.left = (i * 1920) + 'px';
    const inner = document.createElement('div'); inner.className = 'inner'; v.appendChild(inner);
    stage.insertBefore(v, stage.firstChild);
    return inner;
  });
  if (mode !== 'fill') document.body.classList.add('keyed');
  const BGS = ['transparent', 'checker', 'black', 'green', 'blue'];
  let bg = (opt('bg') || (mode === 'fill' ? 'transparent' : 'black')).toLowerCase();

  if (opt('hud') === '1') document.body.classList.add('hud');
  if (opt('safe') === '1') document.body.classList.add('safe');
  if (D.title) document.title = D.title;

  // Output pages never prompt for a name
  const label = (chSpec === 'pvw' ? 'Preview output' : chSpec === 'pgm' ? 'Program output' : `Output ch ${chSpec}`) + (mode === 'key' ? ' (key)' : mode === 'fillkey' ? ' (fill + key)' : '');
  CG.store.set('cgName', CG.store.get('cgName', '') || label);

  function applyBg() {
    BGS.forEach(b => document.body.classList.remove('bg-' + b));
    document.body.style.background = '';
    if (BGS.includes(bg)) document.body.classList.add('bg-' + bg);
    else if (/^[0-9a-f]{3,8}$/i.test(bg)) document.body.style.background = '#' + bg;
  }
  applyBg();

  // ------------------------------------------------------------ scale 1920x1080 to the window
  function fit() {
    const k = Math.min(window.innerWidth / W, window.innerHeight / 1080);
    stage.style.transform = `scale(${k})`;
    stage.style.left = ((window.innerWidth - W * k) / 2) + 'px';
    stage.style.top = ((window.innerHeight - 1080 * k) / 2) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  function channel() {
    const c = CG.state && CG.state.caspar && CG.state.caspar.settings;
    if (chSpec === 'pgm') return c ? c.programChannel : 1;
    if (chSpec === 'pvw') return c ? c.previewChannel : 2;
    return parseInt(chSpec, 10) || 1;
  }

  // ------------------------------------------------------------ layer management (CG ADD / UPDATE / STOP / CLEAR)
  function callView(V, fn, arg) {
    if (!V.ready) { V.queue.push(() => callView(V, fn, arg)); return; }
    try {
      const w = V.frame.contentWindow;
      if (w && typeof w[fn] === 'function') arg === undefined ? w[fn]() : w[fn](arg);
    } catch (e) { console.warn('template call failed', fn, e); }
  }
  const call = (L, fn, arg) => L.views.forEach(V => callView(V, fn, arg));     // fill and key get every call in the same tick
  const drop = L => L.views.forEach(V => V.frame.remove());

  function add(layer, template, data) {
    let L = layers.get(layer);
    if (L && L.template === template) {
      // same template already loaded on this layer: update + play (no reload flash)
      call(L, 'update', data);
      call(L, 'play');
      L.playing = true;
      hud();
      return;
    }
    if (L) drop(L);
    L = { views: [], template, playing: true };
    layers.set(layer, L);
    // With fill and key together, both copies start on the same frame: nothing plays until every copy has loaded.
    let waiting = views.length;
    views.forEach(box => {
      const f = document.createElement('iframe');
      f.setAttribute('allowtransparency', 'true');
      f.style.zIndex = String(layer);
      f.src = `templates/${template}.html`;
      const V = { frame: f, ready: false, queue: [] };
      L.views.push(V);
      f.onload = () => {
        if (--waiting > 0) return;
        L.views.forEach(X => { X.ready = true; });
        call(L, 'update', data);
        call(L, 'play');
        const n = Math.max(...L.views.map(X => X.queue.length));
        for (let q = 0; q < n; q++) L.views.forEach(X => { const fn = X.queue[q]; if (fn) fn(); });
        L.views.forEach(X => { X.queue = []; });
      };
      box.appendChild(f);
    });
    hud();
  }

  function update(layer, template, data) {
    const L = layers.get(layer);
    if (!L) { add(layer, template, data); return; }
    call(L, 'update', data);
  }

  function stop(layer) {
    const L = layers.get(layer);
    if (!L) return;
    call(L, 'stop');
    L.playing = false;
    hud();
  }

  function clear(layer) {
    const L = layers.get(layer);
    if (!L) return;
    drop(L);
    layers.delete(layer);
    hud();
  }

  CG.on('output', m => {
    if (m.channel !== channel()) return;
    switch (m.action) {
      case 'add': add(m.layer, m.template, m.data); break;
      case 'update': update(m.layer, m.template, m.data); break;
      case 'stop': stop(m.layer); break;
      case 'clear': clear(m.layer); break;
      case 'next': { const L = layers.get(m.layer); if (L) call(L, 'next'); break; }
      case 'invoke': {                                 // like CasparCG: "showStats" calls showStats(), "page(2)" is run as written
        const L = layers.get(m.layer); if (!L || !m.method) break;
        const js = String(m.method).trim().replace(/^[ _]+|[ _]+$/g, '');
        if (/^[A-Za-z_$][\w$]*$/.test(js)) call(L, js);
        else L.views.forEach(V => { try { if (V.ready) V.frame.contentWindow.eval(/\)$/.test(js) ? js : js + '()'); } catch (e) { console.warn('invoke failed', js, e); } });
        break;
      }
    }
  });

  // Full resync when (re)connecting: rebuild exactly what is on air
  let pendingSnapshot = null;
  CG.on('state', () => { if (pendingSnapshot) { const m = pendingSnapshot; pendingSnapshot = null; applySnapshot(m); } });
  CG.on('outputs', m => { if (!CG.state) { pendingSnapshot = m; return; } applySnapshot(m); });
  function applySnapshot(m) {
    const ch = channel();
    const want = (m.layers || []).filter(l => l.channel === ch);
    Array.from(layers.keys()).forEach(k => { if (!want.some(w => w.layer === k)) clear(k); });
    want.forEach(l => add(l.layer, l.template, l.data));
  }
  CG.on('connected', () => CG.send('gfx', 'outputs', {}).catch(() => { }));

  // ------------------------------------------------------------ HUD / tally
  function hud() {
    const ch = channel();
    const tag = document.getElementById('tag');
    const kind = chSpec === 'pvw' ? 'pvw' : 'pgm';
    tag.className = 'tag ' + (CG.connected ? kind : 'off');
    tag.textContent = CG.connected ? `${kind === 'pvw' ? 'PREVIEW' : 'PROGRAM'} · CH ${ch}` : 'SERVER OFFLINE';
    const on = Array.from(layers.values()).some(L => L.playing);
    const t = document.getElementById('tally');
    t.className = on ? 'on' + (kind === 'pvw' ? ' pv' : '') : '';
    const names = new Map();
    ((CG.state && CG.state.gfx.onAir) || []).forEach(e => { if (e.channel === ch) names.set(e.layer, e.name); });
    document.getElementById('layers').innerHTML = Array.from(layers.entries()).sort((a, b) => a[0] - b[0])
      .map(([k, L]) => `${String(k).padStart(3, ' ')}  ${CG.esc(names.get(k) || L.template)}${L.playing ? '' : '  (out)'}`).join('<br>');
  }
  CG.on('state', hud);
  setInterval(hud, 1000);

  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
    if (k === 'h') document.body.classList.toggle('hud');
    if (k === 'g') document.body.classList.toggle('safe');
    if (k === 'b') { bg = BGS[(BGS.indexOf(bg) + 1) % BGS.length]; applyBg(); }
  });

  CG.connect('output');
})();
