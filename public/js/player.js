/* The watch page's player controls: a slim bar under the picture.
 *   ⏮ ▶ ⏭   time   [ progress ]   length   🔈 [volume]   audio tracks   settings   list   full screen
 * Live: a LIVE marker instead of the progress, and "Back to live" when behind. Keys: space / k play, ← → 10 s,
 * m mute, f full screen. RFPPlayer.mount(video, { live, prev, next, tracks, onList }) → { el, setTracks, destroy } */
'use strict';
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    play: 'M8 5v14l11-7z',
    pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
    prev: 'M6 5h2v14H6zM20 5v14L9 12z',
    next: 'M16 5h2v14h-2zM4 5v14l11-7z',
    vol: 'M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12',
    mute: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
    tracks: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2',
    gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7 7 0 0 1-1.7 1l-.3 2H10.7l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-1.8-3.1 1.6-1.2a7 7 0 0 1 0-2L5 10.3l1.8-3.1 1.9.7a7 7 0 0 1 1.7-1l.3-2h3.6l.3 2a7 7 0 0 1 1.7 1l1.9-.7 1.8 3.1-1.6 1.2a7 7 0 0 1 0 2z',
    list: 'M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11',
    full: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    exitfull: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  };
  const FILLED = new Set(['play', 'pause', 'prev', 'next']);
  function icon(name) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ICONS[name]);
    if (FILLED.has(name)) p.setAttribute('fill', 'currentColor');
    else { p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); }
    s.append(p);
    return s;
  }
  const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k); return e; };
  const btn = (name, label, on) => { const b = el('button', 'pb-btn'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.append(icon(name)); b.addEventListener('click', (e) => { e.stopPropagation(); on(e); }); return b; };
  const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':'); };

  const css = document.createElement('style');
  css.textContent = `
  .player { position: relative; }
  .pbar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: #1d1d1f; border-radius: 0 0 10px 10px; color: #d6d6d6; user-select: none; font: 13px/1 'Segoe UI', system-ui, sans-serif; }
  .pb-btn { background: none; border: 0; color: inherit; width: 34px; height: 30px; padding: 0; display: grid; place-items: center; border-radius: 6px; cursor: pointer; flex: none; }
  .pb-btn:hover, .pb-btn.on { color: #fff; background: #2c2c2e; }
  .pb-btn svg { width: 20px; height: 20px; }
  .pb-btn:disabled { opacity: .35; cursor: default; background: none; }
  .pb-play { width: 54px; background: var(--pb-accent, #00ff82); color: var(--pb-on, #0b0b0b); border-radius: 7px; }
  .pb-play:hover { filter: brightness(1.12); }
  .pb-time { font-variant-numeric: tabular-nums; color: #bdbdbd; padding: 0 6px; flex: none; }
  .pb-seek { flex: 1; position: relative; height: 22px; background: #050505; border: 1px solid #333; border-radius: 6px; cursor: pointer; min-width: 60px; overflow: hidden; }
  .pb-seek .fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, var(--pb-deep, #063d22), var(--pb-mid, #0a5c33)); }
  .pb-seek .buf { position: absolute; inset: 0 auto 0 0; background: #151515; }
  .pb-seek .knob { position: absolute; top: 2px; bottom: 2px; width: 6px; margin-left: -3px; background: var(--pb-accent, #00ff82); border-radius: 3px; }
  .pb-seek .live { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 6px; color: #f2f2f2; font-weight: 700; letter-spacing: .1em; font-size: 11px; white-space: nowrap; overflow: hidden; }
  .pb-seek .live i { width: 8px; height: 8px; border-radius: 50%; background: #ff3b3b; box-shadow: 0 0 8px #ff3b3b; }
  .pb-seek .live.behind { color: var(--pb-accent, #00ff82); cursor: pointer; }
  .pb-seek .live.behind i { background: #777; box-shadow: none; }
  .pb-vol { width: 86px; height: 14px; position: relative; cursor: pointer; flex: none; background: #0a0a0a; border-radius: 3px; overflow: hidden; clip-path: polygon(0 75%, 100% 0, 100% 100%, 0 100%); }
  .pb-vol .lvl { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, var(--pb-mid, #0a5c33), var(--pb-accent, #00ff82)); }
  .pb-vol.muted .lvl { opacity: .3; filter: grayscale(1); }
  .pb-menu { position: absolute; right: 12px; bottom: 50px; z-index: 5; background: #232325; border: 1px solid #3a3a3c; border-radius: 10px; padding: 6px; min-width: 190px; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
  .pb-menu b { display: block; padding: 6px 10px 4px; color: #8e8e93; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
  .pb-menu button { display: flex; width: 100%; gap: 8px; align-items: center; text-align: left; background: none; border: 0; color: #eee; padding: 8px 10px; border-radius: 6px; cursor: pointer; font: inherit; }
  .pb-menu button:hover { background: #2f2f31; }
  .pb-menu button.on::before { content: '\\25CF'; color: var(--pb-accent, #00ff82); }
  .pb-menu button:not(.on)::before { content: '\\25CF'; color: transparent; }
  .pb-menu small { color: #8e8e93; margin-left: auto; }
  .player:fullscreen { background: #000; display: flex; flex-direction: column; }
  .player:fullscreen .stage { flex: 1; aspect-ratio: auto; border-radius: 0; }
  .player:fullscreen .pbar { position: absolute; left: 0; right: 0; bottom: 0; z-index: 4; border-radius: 0; background: rgba(22,22,24,.92); opacity: 0; transition: opacity .2s; }
  .player:fullscreen .pbar:hover, .player:fullscreen .pbar.menu, .player:fullscreen .pbar.touch { opacity: 1; }
  .player:fullscreen .pb-menu { bottom: 58px; }
  @media (max-width: 600px) { .pbar { gap: 2px; padding: 6px; border-radius: 0; } .pb-vol, .pb-hide-s { display: none; } .pb-play { width: 44px; } .pb-time { padding: 0 3px; font-size: 12px; } }`;
  document.head.append(css);

  function mount(video, opts = {}) {
    const player = opts.player;                       // the element that goes full screen (stage + bar)
    const bar = el('div', 'pbar');
    // the channel's colour: buttons, progress and volume (text on it dark or light, whichever reads)
    const hex = /^#?([0-9a-f]{6})$/i.exec(String(opts.color || '').trim());
    if (hex) {
      const n = parseInt(hex[1], 16), rgb = [n >> 16, (n >> 8) & 255, n & 255];
      const mix = (f) => '#' + rgb.map((c) => Math.round(c * f).toString(16).padStart(2, '0')).join('');
      const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      for (const t of [bar, opts.player].filter(Boolean)) { t.style.setProperty('--pb-accent', '#' + hex[1]); t.style.setProperty('--pb-on', lum > 0.55 ? '#0b0b0b' : '#ffffff'); t.style.setProperty('--pb-deep', mix(0.22)); t.style.setProperty('--pb-mid', mix(0.38)); }
    }
    let menu = null, tracks = opts.tracks || null;
    const closeMenu = () => { if (menu) { menu.remove(); menu = null; bar.classList.remove('menu'); bar.querySelectorAll('.pb-btn.on').forEach((b) => b.classList.remove('on')); } };
    const openMenu = (b, title, items) => {
      if (menu && menu.dataset.for === title) return closeMenu();
      closeMenu();
      menu = el('div', 'pb-menu', el('b', '', title), items.map((it) => { const x = el('button', it.on ? 'on' : '', it.label, it.note ? el('small', '', it.note) : null); x.type = 'button'; x.addEventListener('click', (e) => { e.stopPropagation(); it.pick(); closeMenu(); }); return x; }));
      menu.dataset.for = title;
      b.classList.add('on'); bar.classList.add('menu');
      (player || bar.parentNode).append(menu);
    };
    document.addEventListener('click', closeMenu);

    const play = btn('play', 'Play', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
    play.classList.add('pb-play');
    const prev = btn('prev', opts.prevLabel || 'Previous', () => opts.prev && opts.prev());
    const next = btn('next', opts.nextLabel || 'Next', () => opts.next && opts.next());
    prev.disabled = !opts.prev; next.disabled = !opts.next;
    prev.classList.add('pb-hide-s'); next.classList.add('pb-hide-s');
    const cur = el('span', 'pb-time', '00:00:00'), len = el('span', 'pb-time pb-hide-s', opts.live ? '' : '00:00:00');
    const seek = el('div', 'pb-seek'), buf = el('div', 'buf'), fill = el('div', 'fill'), knob = el('div', 'knob');
    const liveTag = el('div', 'live', el('i'), 'LIVE');
    if (opts.live) seek.append(liveTag); else seek.append(buf, fill, knob);
    const edge = () => { const s = video.seekable; return s && s.length ? s.end(s.length - 1) : video.duration; };
    const behind = () => opts.live && Number.isFinite(edge()) && edge() - video.currentTime > 12;
    liveTag.addEventListener('click', () => { if (behind()) video.currentTime = Math.max(0, edge() - 3); });
    let dragging = false;
    const seekTo = (x) => { const r = seek.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (x - r.left) / r.width)); if (Number.isFinite(video.duration)) video.currentTime = f * video.duration; };
    if (!opts.live) {
      seek.addEventListener('pointerdown', (e) => { dragging = true; seek.setPointerCapture(e.pointerId); seekTo(e.clientX); });
      seek.addEventListener('pointermove', (e) => { if (dragging) seekTo(e.clientX); });
      seek.addEventListener('pointerup', () => { dragging = false; });
    }
    const volBtn = btn('vol', 'Mute', () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 0.8; paint(); if (opts.onUnmute && !video.muted) opts.onUnmute(); });
    const vol = el('div', 'pb-vol', el('div', 'lvl'));
    const setVol = (x) => { const r = vol.getBoundingClientRect(); video.volume = Math.min(1, Math.max(0, (x - r.left) / r.width)); video.muted = video.volume === 0; if (!video.muted && opts.onUnmute) opts.onUnmute(); paint(); };
    let volDrag = false;
    vol.addEventListener('pointerdown', (e) => { volDrag = true; vol.setPointerCapture(e.pointerId); setVol(e.clientX); });
    vol.addEventListener('pointermove', (e) => { if (volDrag) setVol(e.clientX); });
    vol.addEventListener('pointerup', () => { volDrag = false; });
    const trackBtn = btn('tracks', 'Audio track', (e) => {
      if (!tracks || !tracks.list().length) return;
      openMenu(trackBtn, 'Audio', tracks.list().map((t, i) => ({ label: t.name, note: t.note, on: i === tracks.current(), pick: () => { tracks.pick(i); paint(); } })));
    });
    const gear = btn('gear', 'Settings', () => {
      const items = [];
      if (!opts.live) for (const r of [0.5, 1, 1.25, 1.5, 2]) items.push({ label: r === 1 ? 'Normal speed' : r + '×', on: video.playbackRate === r, pick: () => { video.playbackRate = r; } });
      if (opts.live) items.push({ label: 'Back to live', on: !behind(), pick: () => { if (Number.isFinite(edge())) video.currentTime = Math.max(0, edge() - 3); } });
      if (document.pictureInPictureEnabled && video.requestPictureInPicture) items.push({ label: 'Picture in picture', pick: () => { video.requestPictureInPicture().catch(() => {}); } });
      openMenu(gear, 'Settings', items);
    });
    const list = btn('list', opts.listLabel || 'Videos', () => opts.onList && opts.onList());
    list.disabled = !opts.onList;
    const fullBtn = btn('full', 'Full screen', () => toggleFull());
    const toggleFull = () => {
      const t = player || video;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (t.requestFullscreen) t.requestFullscreen().catch(() => {});
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    };
    bar.append(prev, play, next, cur, seek, len, volBtn, vol, trackBtn, gear, list, fullBtn);

    function paint() {
      play.replaceChildren(icon(video.paused ? 'play' : 'pause'));
      play.title = video.paused ? 'Play' : 'Pause';
      volBtn.replaceChildren(icon(video.muted || video.volume === 0 ? 'mute' : 'vol'));
      vol.firstChild.style.width = video.volume * 100 + '%'; vol.classList.toggle('muted', video.muted);
      fullBtn.replaceChildren(icon(document.fullscreenElement ? 'exitfull' : 'full'));
      trackBtn.style.display = tracks && tracks.list().length > 1 ? '' : 'none';
      if (opts.live) {
        const b = behind();
        liveTag.classList.toggle('behind', b);
        liveTag.lastChild.textContent = b ? (bar.offsetWidth < 520 ? 'GO LIVE' : 'BACK TO LIVE') : 'LIVE';
        cur.textContent = opts.since ? clock((Date.now() - opts.since) / 1000) : clock(video.currentTime);
      } else {
        const d = video.duration;
        cur.textContent = clock(video.currentTime);
        len.textContent = Number.isFinite(d) ? clock(d) : '';
        const f = Number.isFinite(d) && d > 0 ? video.currentTime / d : 0;
        fill.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%';
        try { const bf = video.buffered; if (bf.length && Number.isFinite(d) && d > 0) buf.style.width = (bf.end(bf.length - 1) / d) * 100 + '%'; } catch (e) { /* none */ }
      }
    }
    for (const ev of ['play', 'pause', 'timeupdate', 'volumechange', 'durationchange', 'progress', 'loadedmetadata']) video.addEventListener(ev, paint);
    document.addEventListener('fullscreenchange', paint);
    // full screen on a phone or tablet (no hover): a tap shows the bar for a few seconds
    let touchT = null;
    (player || video).addEventListener('touchstart', () => { if (!document.fullscreenElement) return; bar.classList.add('touch'); clearTimeout(touchT); touchT = setTimeout(() => bar.classList.remove('touch'), 3500); }, { passive: true });
    const tick = setInterval(() => { if (!bar.isConnected) { clearInterval(tick); return; } paint(); }, 1000);
    video.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
    video.addEventListener('dblclick', toggleFull);
    const onKey = (e) => {
      if (!bar.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (video.paused) video.play().catch(() => {}); else video.pause(); }
      else if (e.key === 'f') toggleFull();
      else if (e.key === 'm') { video.muted = !video.muted; if (!video.muted && opts.onUnmute) opts.onUnmute(); }
      else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 10);
      else if (e.key === 'ArrowRight' && !opts.live) video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    };
    document.addEventListener('keydown', onKey);
    paint();
    return { el: bar, setTracks: (t) => { tracks = t; paint(); }, paint };
  }
  window.RFPPlayer = { mount };
})();
