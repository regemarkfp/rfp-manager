/* Browser output: behaves like a CasparCG channel. One iframe per layer, same templates, same update/play/stop calls.
   Options: ?key=<output key>  &bg=transparent|checker|black|green|<hex>  &hud=1                                */
'use strict';
(() => {
  const q = new URLSearchParams(location.search);
  const stage = document.getElementById('stage'), hud = document.getElementById('hud');
  const layers = new Map();
  const bg = q.get('bg') || 'transparent';
  if (bg === 'checker') document.body.classList.add('checker'); else if (bg !== 'transparent') document.body.style.background = /^[0-9a-f]{6}$/i.test(bg) ? '#' + bg : bg;
  if (q.get('hud')) hud.style.display = 'block';
  const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`; };
  addEventListener('resize', fit); fit();
  const say = (t) => { hud.textContent = t; };

  function drop(layer, animate) {
    const L = layers.get(layer);
    if (!L) return;
    layers.delete(layer);
    try { if (animate) L.frame.contentWindow.stop(); } catch { /* frame not ready */ }
    setTimeout(() => L.frame.remove(), animate ? 700 : 0);
  }
  function add(m) {
    drop(m.layer, false);
    const frame = document.createElement('iframe');
    frame.style.zIndex = String(m.layer);
    const L = { frame, data: m.data, ready: false };
    layers.set(m.layer, L);
    frame.onload = () => { L.ready = true; try { frame.contentWindow.update(JSON.stringify(L.data)); frame.contentWindow.play(); } catch (e) { say('Template error: ' + e.message); } };
    frame.src = '/templates/' + m.template + '.html';
    stage.append(frame);
  }
  function update(m) {
    const L = layers.get(m.layer);
    if (!L) return;
    L.data = m.data;
    if (L.ready) { try { L.frame.contentWindow.update(JSON.stringify(m.data)); } catch { /* ignore */ } }
  }

  function connect() {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'output', key: q.get('key') || '' })); say('Connected'); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'error') { say(m.error); hud.style.display = 'block'; return; }
      if (m.type !== 'gfx') return;
      if (m.op === 'add') add(m); else if (m.op === 'update') update(m); else if (m.op === 'stop') drop(m.layer, true); else if (m.op === 'clear') for (const l of [...layers.keys()]) drop(l, false);
      say('Layers on air: ' + ([...layers.keys()].sort((a, b) => a - b).join(', ') || 'none'));
    };
    ws.onclose = () => { say('Reconnecting…'); setTimeout(connect, 2000); };
  }
  connect();
})();
