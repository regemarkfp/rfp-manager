/* The viewer page: /watch/<channel>. WebRTC (WHEP) from the streaming server, HLS where WebRTC cannot play. */
'use strict';
(() => {
  const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined) e.setAttribute(k, v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k);
    return e;
  };
  let info = null, pc = null, playing = false, password = null, retry = null;

  const api = async (method, body) => {
    const r = await fetch('/api/watch/' + encodeURIComponent(slug), { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json', 'x-rfp': '1' } : {}, body: body ? JSON.stringify(body) : undefined });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(out.error || 'Something went wrong'), { status: r.status });
    return out;
  };

  function message(title, text, ...extra) {
    stop();
    const poster = info && info.poster ? el('img', { class: 'poster', src: '/media/' + encodeURIComponent(info.poster), alt: '' }) : null;
    $('stage').replaceChildren(...[poster, el('div', { class: 'msg' }, el('b', {}, title), text ? el('p', {}, text) : null, ...extra)].filter(Boolean));
  }
  function header() {
    if (!info) return;
    document.title = info.name + (info.live ? ' · LIVE' : '');
    $('title').textContent = info.name;
    $('badge').textContent = info.live ? 'LIVE' : 'OFFLINE';
    $('badge').className = 'badge' + (info.live ? ' on' : '');
    $('viewers').textContent = info.live && info.viewers ? `${info.viewers} watching` : '';
    $('desc').textContent = info.description || '';
  }

  function stop() { if (pc) { try { pc.close(); } catch (e) { /* closed */ } } pc = null; playing = false; }

  async function playWebRTC() {
    const video = el('video', { autoplay: '', playsinline: '', muted: '' });
    video.muted = true;
    pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const stream = new MediaStream();
    pc.ontrack = (e) => { stream.addTrack(e.track); video.srcObject = stream; };
    const mine = pc;
    pc.onconnectionstatechange = () => { if (mine === pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) again(3000); };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((resolve) => {                      // the whole offer in one go (no trickle ICE)
      if (pc.iceGatheringState === 'complete') return resolve();
      const t = setTimeout(resolve, 2500);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); } };
    });
    const headers = { 'content-type': 'application/sdp' };
    if (info.token) headers.authorization = 'Basic ' + btoa('viewer:' + info.token);
    const r = await fetch(info.whep, { method: 'POST', headers, body: pc.localDescription.sdp });
    if (r.status !== 201 && r.status !== 200) throw new Error('WebRTC ' + r.status);
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    show(video);
  }

  function playHLS() {
    const video = el('video', { autoplay: '', playsinline: '', controls: '', muted: '' });
    video.muted = true;
    video.src = info.hls + (info.token ? '?token=' + encodeURIComponent(info.token) : '');
    video.onerror = () => again(4000);
    show(video);
  }
  const canHLS = () => !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');

  function show(video) {
    playing = true;
    const unmute = el('button', { class: 'unmute', onclick: () => { video.muted = false; video.play().catch(() => {}); unmute.remove(); } }, '🔊 Tap for sound');
    video.addEventListener('dblclick', () => { (video.requestFullscreen || video.webkitEnterFullscreen || (() => {})).call(video); });
    $('stage').replaceChildren(video, unmute);
    video.play().catch(() => {});
  }

  function again(ms) { stop(); clearTimeout(retry); retry = setTimeout(load, ms); }

  async function load() {
    clearTimeout(retry);
    try { info = await api(password === null ? 'GET' : 'POST', password === null ? null : { password }); }
    catch (e) {
      if (e.status === 404) { document.title = 'Not found'; return message('There is no channel at this address.', 'Check the link you were given.'); }
      if (e.status === 403 && password !== null) { password = null; return askPassword(e.message); }
      return message('Cannot reach the website', e.message, el('p', {}, el('button', { onclick: load }, 'Try again')));
    }
    header();
    if (info.needs === 'password') return askPassword();
    if (info.needs === 'signin') return message('Sign in to watch', 'This channel is for members of the production team.', el('p', {}, el('a', { class: 'btn primary', href: '/?next=' + encodeURIComponent(location.pathname) }, 'Sign in')));
    if (info.needs === 'team') return message('This channel is for its production team', 'Ask the team to add you, or for a link you can use.');
    if (!info.streaming) return message('Streaming is not set up on this website yet', '');
    if (!info.live) { message('Not live yet', 'This page starts playing by itself when the stream begins.'); return again(5000); }
    if (playing) return;
    try { await playWebRTC(); }
    catch (e) {
      stop();
      if (canHLS()) playHLS();
      else { message('Could not start the video', 'Retrying…'); again(5000); }
    }
  }

  function askPassword(problem) {
    const input = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    const go = () => { password = input.value; load(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    message('This channel needs a password', '', problem ? el('p', { class: 'err' }, problem) : null, input, el('button', { class: 'primary', onclick: go }, 'Watch'));
    setTimeout(() => input.focus(), 50);
  }

  // live badge and viewer count, and noticing when the stream stops or starts
  setInterval(async () => {
    if (!info || info.needs) return;
    try {
      const now = await api(password === null ? 'GET' : 'POST', password === null ? null : { password });
      const was = info.live; info = { ...info, ...now }; header();
      if (!was && info.live && !playing) load();
    } catch (e) { /* next time */ }
  }, 10000);

  load();
})();
