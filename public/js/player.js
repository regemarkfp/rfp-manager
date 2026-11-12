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
    cc: 'M3 6h18v12H3zM10.5 10.2a2.2 2.2 0 1 0 0 3.6M17.5 10.2a2.2 2.2 0 1 0 0 3.6',
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
  .pb-btn.lit { color: var(--pb-accent, #00ff82); }
  .pb-subs { position: absolute; left: 4%; right: 4%; bottom: 7%; z-index: 3; display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; text-align: center; font: 600 clamp(14px, 3.4cqw, 34px)/1.3 'Segoe UI', system-ui, sans-serif; container-type: normal; }
  .stage { container-type: inline-size; touch-action: manipulation; }
  .pb-subs span { padding: 2px 10px; border-radius: 4px; background: rgba(0,0,0,.6); color: #fff; }
  .pb-subs[data-size=s] { font-size: clamp(12px, 2.6cqw, 26px); } .pb-subs[data-size=l] { font-size: clamp(17px, 4.3cqw, 44px); } .pb-subs[data-size=xl] { font-size: clamp(20px, 5.4cqw, 56px); }
  .pb-subs[data-color=yellow] span { color: #ffe600; } .pb-subs[data-color=green] span { color: #00ff82; } .pb-subs[data-color=cyan] span { color: #5ff3ff; }
  .pb-subs[data-bg=solid] span { background: #000; } .pb-subs[data-bg=none] span { background: none; text-shadow: 0 0 3px #000, 0 0 3px #000, 1px 1px 2px #000, -1px -1px 2px #000; }
  .pb-subs[data-pos=top] { bottom: auto; top: 6%; }
  .player:fullscreen .pb-subs { bottom: 10%; }
  .player:fullscreen { background: #000; display: flex; flex-direction: column; }
  .player:fullscreen .stage { flex: 1; aspect-ratio: auto; border-radius: 0; }
  .player:fullscreen .pbar { position: absolute; left: 0; right: 0; bottom: 0; z-index: 4; border-radius: 0; background: rgba(22,22,24,.92); opacity: 0; transition: opacity .2s; }
  .player:fullscreen .pbar:hover, .player:fullscreen .pbar.menu, .player:fullscreen .pbar.touch { opacity: 1; }
  .player:fullscreen .pb-menu { bottom: 58px; }
  .pb-fx { position: absolute; top: 0; bottom: 0; width: 38%; z-index: 3; display: flex; align-items: center; justify-content: center; pointer-events: none; opacity: 0; transition: opacity .25s; }
  .pb-fx.l { left: 0; border-radius: 0 50% 50% 0 / 0 100% 100% 0; } .pb-fx.r { right: 0; border-radius: 50% 0 0 50% / 100% 0 0 100%; }
  .pb-fx.on { opacity: 1; background: rgba(255,255,255,.12); }
  .pb-fx span { display: flex; flex-direction: column; align-items: center; gap: 4px; color: #fff; font: 700 14px system-ui, sans-serif; text-shadow: 0 1px 3px #000; }
  .pb-fx b { font-size: 22px; letter-spacing: -2px; }
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
      menu = el('div', 'pb-menu', el('b', '', title), items.map((it) => { const x = el('button', it.on ? 'on' : '', it.label, it.note ? el('small', '', it.note) : null); x.type = 'button'; x.addEventListener('click', (e) => { e.stopPropagation(); if (it.pick() !== 'keep') closeMenu(); }); return x; }));
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
    // the sound the bar controls: the video, or what plays instead of it for a while (an advert in master control)
    let aud = null;
    const A = () => aud || video;
    const keep = () => saveSound(A());
    const volBtn = btn('vol', 'Mute', () => { const a = A(); a.muted = !a.muted; if (!a.muted && a.volume === 0) a.volume = 0.8; if (!a.muted && a.paused && a !== video) a.play().catch(() => {}); keep(); paint(); if (opts.onUnmute && !a.muted) opts.onUnmute(); });
    const vol = el('div', 'pb-vol', el('div', 'lvl'));
    const setVol = (x) => { const r = vol.getBoundingClientRect(), a = A(); a.volume = Math.min(1, Math.max(0, (x - r.left) / r.width)); a.muted = a.volume === 0; if (!a.muted && opts.onUnmute) opts.onUnmute(); keep(); paint(); };
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
    // subtitles: our own tracks (WebVTT, drawn over the picture so they look the same for files, YouTube and live),
    // YouTube's own captions, and how they look (size, colour, background), kept in this browser
    let subs = opts.subtitles || [], subOn = -1, cues = [], ytCc = false;
    const subBox = el('div', 'pb-subs');
    const stageEl = opts.stage || (player && player.querySelector('.stage'));
    if (stageEl) stageEl.append(subBox);
    const styleSubs = () => { const st = subStyle(); subBox.dataset.size = st.size; subBox.dataset.bg = st.bg; subBox.dataset.color = st.color; subBox.dataset.pos = st.pos; };
    styleSubs();
    const pickSub = async (i) => {
      subOn = i; cues = []; subBox.replaceChildren();
      try { localStorage.setItem(SUBLANG, i >= 0 ? subs[i].lang || subs[i].label : 'off'); } catch (e) { /* private window */ }
      if (i < 0) return;
      try { const r = await fetch(subs[i].url); cues = parseVtt(await r.text()); } catch (e) { cues = []; }
      paintSubs();
    };
    let lastCue = '';
    function paintSubs() {
      if (subOn < 0 || !cues.length) { if (lastCue) { subBox.replaceChildren(); lastCue = ''; } return; }
      const t = video.currentTime;
      const now = cues.filter((c) => t >= c.start && t < c.end).map((c) => c.text);
      const key = now.join('\n');
      if (key === lastCue) return;
      lastCue = key;
      subBox.replaceChildren(...now.map((tx) => el('span', '', ...tx.split('\n').flatMap((ln, j) => (j ? [document.createElement('br'), ln] : [ln])))));
    }
    video.addEventListener('timeupdate', paintSubs);
    video.addEventListener('seeked', paintSubs);
    const ccBtn = btn('cc', 'Subtitles', () => {
      const items = [{ label: 'Off', on: subOn < 0 && !ytCc, pick: () => { pickSub(-1); if (ytCc && video.captions) { video.captions(false); ytCc = false; } paint(); } }];
      subs.forEach((s, i) => items.push({ label: s.label || s.lang || 'Subtitles', note: s.lang && s.label !== s.lang ? s.lang : '', on: subOn === i, pick: () => { if (ytCc && video.captions) { video.captions(false); ytCc = false; } pickSub(i); paint(); } }));
      if (video.captions) items.push({ label: 'YouTube\'s captions', note: 'auto', on: ytCc, pick: () => { pickSub(-1); ytCc = true; video.captions(true); paint(); } });
      const st = subStyle();
      const sub = (title, key, choices) => ({ label: title, note: choices.find((c) => c[0] === st[key])[1] + ' ›', pick: () => { closeMenu(); openMenu(ccBtn, title, choices.map(([v, l]) => ({ label: l, on: subStyle()[key] === v, pick: () => { saveSubStyle({ [key]: v }); styleSubs(); } }))); return 'keep'; } });
      items.push(sub('Text size', 'size', [['s', 'Small'], ['m', 'Normal'], ['l', 'Large'], ['xl', 'Very large']]),
        sub('Text colour', 'color', [['white', 'White'], ['yellow', 'Yellow'], ['green', 'Green'], ['cyan', 'Cyan']]),
        sub('Background', 'bg', [['dark', 'Dark box'], ['solid', 'Black box'], ['none', 'None (outline)']]),
        sub('Position', 'pos', [['bottom', 'Bottom'], ['top', 'Top']]));
      openMenu(ccBtn, 'Subtitles', items);
    });
    // the viewer's language from last time, else the track marked as the default
    const pref = (() => { try { return localStorage.getItem(SUBLANG) || ''; } catch (e) { return ''; } })();
    const startSub = () => { if (pref === 'off') return; const i = subs.findIndex((s) => pref && (s.lang === pref || s.label === pref)); const d = subs.findIndex((s) => s.default); if (i >= 0 || d >= 0) pickSub(i >= 0 ? i : d); };
    startSub();
    const list = btn('list', opts.listLabel || 'Videos', () => opts.onList && opts.onList());
    list.disabled = !opts.onList;
    const fullBtn = btn('full', 'Full screen', () => toggleFull());
    // full screen turns a phone sideways for a wide picture (16:9, YouTube too); upright videos stay upright.
    // The Android app turns the screen itself (RFPNative.videoPortrait); browsers through screen.orientation.
    const wide = () => { const w = Number(video.videoWidth), hh = Number(video.videoHeight); return !(w > 0 && hh > 0) || w >= hh; };
    const native = window.RFPNative;
    const toggleFull = () => {
      const t = player || video;
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      if (native && native.videoPortrait) { try { native.videoPortrait(!wide()); } catch (e) { /* older app */ } }
      if (t.requestFullscreen) t.requestFullscreen().then(() => { if (wide() && screen.orientation && screen.orientation.lock && !(native && native.videoPortrait)) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {});
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    };
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && screen.orientation && screen.orientation.unlock) { try { screen.orientation.unlock(); } catch (e) { /* not locked */ } } });
    bar.append(prev, play, next, cur, seek, len, volBtn, vol, trackBtn, ccBtn, gear, list, fullBtn);

    function paint() {
      play.replaceChildren(icon(video.paused ? 'play' : 'pause'));
      play.title = video.paused ? 'Play' : 'Pause';
      const a = A();
      volBtn.replaceChildren(icon(a.muted || a.volume === 0 ? 'mute' : 'vol'));
      vol.firstChild.style.width = a.volume * 100 + '%'; vol.classList.toggle('muted', a.muted);
      fullBtn.replaceChildren(icon(document.fullscreenElement ? 'exitfull' : 'full'));
      trackBtn.style.display = tracks && tracks.list().length > 1 ? '' : 'none';
      ccBtn.style.display = subs.length || video.captions ? '' : 'none'; ccBtn.classList.toggle('lit', subOn >= 0 || ytCc);
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
    // mouse: click plays / pauses, double-click is full screen. Touch: a tap plays / pauses (in full screen the first tap
    // shows the bar), a double tap on the left or right half goes 10 seconds back or forward, and each tap more
    // straight after adds 10 seconds (as on YouTube)
    let touchAt = 0;
    video.addEventListener('click', () => { if (Date.now() - touchAt < 800) return; if (video.paused) video.play().catch(() => {}); else video.pause(); });
    video.addEventListener('dblclick', () => { if (Date.now() - touchAt < 800) return; toggleFull(); });
    const tapEl = stageEl || video.parentNode || player;
    const fx = { l: el('div', 'pb-fx l', el('span', '', el('b', '', '\u25C0\u25C0'), el('i', '', ''))), r: el('div', 'pb-fx r', el('span', '', el('b', '', '\u25B6\u25B6'), el('i', '', ''))) };
    if (tapEl && tapEl.append) tapEl.append(fx.l, fx.r);
    let lastTap = null, single = null, streak = null;
    const seekBy = (sec) => {
      const d = video.duration, end = opts.live ? edge() : d;
      let t = (video.currentTime || 0) + sec;
      if (Number.isFinite(end) && end > 0) t = Math.min(end - (opts.live ? 2 : 0.2), t);
      video.currentTime = Math.max(0, t);
      paint();
    };
    const showFx = (side, total) => {
      const f = fx[side];
      f.querySelector('i').textContent = Math.abs(total) + ' seconds';
      f.classList.add('on'); clearTimeout(f._t); f._t = setTimeout(() => f.classList.remove('on'), 650);
    };
    if (tapEl && tapEl.addEventListener) tapEl.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch' || e.target.closest('.pbar, .pb-menu, button, a, input')) return;
      touchAt = Date.now();
      const r = tapEl.getBoundingClientRect(), side = e.clientX - r.left < r.width / 2 ? 'l' : 'r', now = Date.now();
      if (streak && streak.side === side && now - streak.at < 700) {            // more taps straight after: 10 s more each
        streak.at = now; streak.total += 10; seekBy(side === 'l' ? -10 : 10); showFx(side, streak.total); return;
      }
      if (lastTap && now - lastTap.at < 300 && Math.abs(e.clientX - lastTap.x) < 90) {
        clearTimeout(single); single = null; lastTap = null;
        if (side === 'r' && opts.live && !behind()) return;                         // nothing ahead of live
        streak = { side, at: now, total: 10 }; seekBy(side === 'l' ? -10 : 10); showFx(side, 10); return;
      }
      streak = null;
      lastTap = { at: now, x: e.clientX };
      const barShown = bar.classList.contains('touch');
      clearTimeout(single);
      single = setTimeout(() => { single = null; lastTap = null; if (document.fullscreenElement && !barShown) return; if (video.paused) video.play().catch(() => {}); else video.pause(); }, 300);
    });
    const onKey = (e) => {
      if (!bar.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (video.paused) video.play().catch(() => {}); else video.pause(); }
      else if (e.key === 'f') toggleFull();
      else if (e.key === 'm') { const a = A(); a.muted = !a.muted; if (!a.muted && opts.onUnmute) opts.onUnmute(); keep(); paint(); }
      else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 10);
      else if (e.key === 'ArrowRight' && !opts.live) video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    };
    document.addEventListener('keydown', onKey);
    paint();
    const setAudio = (el2) => { if (aud) aud.removeEventListener('volumechange', paint); aud = el2 || null; if (aud) aud.addEventListener('volumechange', paint); paint(); };
    return { el: bar, setTracks: (t) => { tracks = t; paint(); }, setSubtitles: (l) => { subs = l || []; subOn = -1; cues = []; subBox.replaceChildren(); startSub(); paint(); }, paint, setAudio };
  }
  // subtitles: a small WebVTT (and SRT) reader → [{ start, end, text }]
  function parseVtt(text) {
    const t = (s) => { const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s); return m ? (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : NaN; };
    const out = [];
    for (const block of String(text || '').replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const i = lines.findIndex((l) => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->');
      const start = t(a), end = t(b);
      const txt = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
      if (Number.isFinite(start) && Number.isFinite(end) && txt) out.push({ start, end, text: txt });
    }
    return out;
  }
  const SUBSTYLE = 'rfp.subs', SUBLANG = 'rfp.subs.lang';
  function subStyle() { try { return { size: 'm', color: 'white', bg: 'dark', pos: 'bottom', ...JSON.parse(localStorage.getItem(SUBSTYLE) || '{}') }; } catch (e) { return { size: 'm', color: 'white', bg: 'dark', pos: 'bottom' }; } }
  function saveSubStyle(x) { try { localStorage.setItem(SUBSTYLE, JSON.stringify({ ...subStyle(), ...x })); } catch (e) { /* private window */ } }
  // the viewer's own sound settings (mute, volume), kept in this browser: every video starts with them
  const SOUND = 'rfp.sound';
  function sound() {
    try { const x = JSON.parse(localStorage.getItem(SOUND) || '{}'); return { muted: x.muted === true, volume: Number.isFinite(x.volume) ? Math.min(1, Math.max(0, x.volume)) : 1 }; } catch (e) { return { muted: false, volume: 1 }; }
  }
  function saveSound(v) { try { localStorage.setItem(SOUND, JSON.stringify({ muted: !!v.muted, volume: v.volume })); } catch (e) { /* private window */ } }
  // plays with the viewer's settings; only when the browser refuses sound without a tap does it start muted (onBlocked
  // shows "Tap for sound"): that is not the viewer's choice, so it is not kept
  function playWithSound(video, onBlocked) {
    const p = sound();
    video.volume = p.volume; video.muted = p.muted;
    return video.play().catch((e) => {
      if (e && e.name === 'NotAllowedError' && !video.muted) { video.muted = true; if (onBlocked) onBlocked(); return video.play().catch(() => {}); }
      return undefined;
    });
  }
  window.RFPPlayer = { mount, sound, saveSound, playWithSound, parseVtt };
})();
