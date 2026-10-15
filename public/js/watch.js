/* The viewer page: /watch/<stream> (a production's live stream on a channel), and its recordings with ?v=<start>.
 * Live: WebRTC (WHEP) from the streaming server, HLS where WebRTC cannot play. Videos: MP4 from the recordings. */
'use strict';
(() => {
  // replaceChildren / append skip empty parts (null, undefined, false)
  for (const P of [Element.prototype, DocumentFragment.prototype]) for (const name of ['replaceChildren', 'append']) { const orig = P[name]; P[name] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); }; }
  const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
  const matchId = new URLSearchParams(location.search).get('m') || '';
  const vodStart = new URLSearchParams(location.search).get('v') || (matchId ? 'match' : '');
  let pub = null;
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined) e.setAttribute(k, v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k);
    return e;
  };
  let info = null, pc = null, playing = false, password = null, retry = null;

  // tickets bought without signing in: kept in this browser (and in the ticket email)
  const TKEY = 'rfp-tickets';
  const tickets = () => { try { return JSON.parse(localStorage.getItem(TKEY) || '[]').filter((t) => /^tk_/.test(t)); } catch (e) { return []; } };
  const keepTicket = (t) => { if (!/^tk_/.test(t || '')) return; try { localStorage.setItem(TKEY, JSON.stringify([t, ...tickets().filter((x) => x !== t)].slice(0, 30))); } catch (e) { /* private window */ } };
  const params = new URLSearchParams(location.search);
  if (params.get('ticket')) { keepTicket(params.get('ticket')); params.delete('ticket'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '')); }
  let paidId = params.get('paid') || '';

  const api = async (method, body) => {
    const hd = body ? { 'content-type': 'application/json', 'x-rfp': '1' } : {};
    if (tickets().length) hd['x-rfp-tickets'] = tickets().join(',');
    const r = await fetch('/api/watch/' + encodeURIComponent(slug) + (matchId ? '?m=' + encodeURIComponent(matchId) : vodStart ? '?v=' + encodeURIComponent(vodStart) : ''), { method, credentials: 'same-origin', headers: hd, body: body ? JSON.stringify(body) : undefined });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(out.error || 'Something went wrong'), { status: r.status });
    return out;
  };

  function message(title, text, ...extra) {
    stop();
    const poster = info && info.poster ? el('img', { class: 'poster', src: '/media/' + encodeURIComponent(info.poster), alt: '' }) : null;
    $('stage').replaceChildren(...[poster, el('div', { class: 'msg' }, el('b', {}, title), text ? el('p', {}, text) : null, ...extra)].filter(Boolean));
    $('ctrl').replaceChildren(); $('player').classList.remove('has-bar');
  }
  // the slate: "Technical difficulties" when the signal goes away, "This stream has ended" when it was ended
  let slateKind = '';
  function slateEl(kind) {
    const ch = (info && info.channel) || {}, ended = kind === 'ended';
    return el('div', { class: 'slate' + (ended ? ' ended' : '') },
      ch.logo ? el('img', { class: 'slogo', src: imgUrl(ch.logo), alt: ch.name || '' }) : el('img', { class: 'slogo brand', src: '/brand/rfp-logo.png', alt: (info && info.site) || '' }),
      el('b', {}, ended ? 'This stream has ended' : 'Technical difficulties'),
      el('p', {}, ended ? 'Thank you for watching.' + ((info && (info.videos || []).length) ? ' The recording is below.' : '') : 'We are currently experiencing technical issues. Our technicians are working to resolve the problem – please stay with us, the stream continues here by itself.'),
      ended ? null : el('div', { class: 'sbars' }, el('i'), el('i'), el('i')));
  }
  function showSlate(kind) {
    stop();
    slateKind = kind;
    $('ctrl').replaceChildren(); $('player').classList.remove('has-bar');
    $('stage').replaceChildren(slateEl(kind));
  }

  // the control bar under the picture (player.js); prev / next walk the matches and recordings
  function bar(video, opts) {
    const items = [...(info.matches || []).map((m) => '?m=' + encodeURIComponent(m.fixture)), ...(info.videos || []).map((v) => '?v=' + encodeURIComponent(v.start))];
    const here = matchId ? '?m=' + encodeURIComponent(matchId) : vodStart ? '?v=' + encodeURIComponent(vodStart) : '';
    const i = items.indexOf(here);
    const go = (q) => () => { location.search = q; };
    const live = !!opts.live;
    const b = window.RFPPlayer.mount(video, { player: $('player'), live, color: (info.channel || {}).color || '', since: live ? info.since : 0, tracks: opts.tracks || null, onUnmute: opts.onUnmute,
      prev: live ? null : i > 0 ? go(items[i - 1]) : null, next: live ? (items.length ? go(items[0]) : null) : i >= 0 && i < items.length - 1 ? go(items[i + 1]) : null,
      prevLabel: 'Previous video', nextLabel: live ? 'Recordings' : 'Next video',
      onList: (items.length || (info.matches || []).length) ? () => $('vids').scrollIntoView({ behavior: 'smooth' }) : null });
    $('ctrl').replaceChildren(b.el); $('player').classList.add('has-bar');
    return b;
  }
  const imgUrl = (id) => (!id ? '' : /^https?:/.test(id) ? id : '/media/' + encodeURIComponent(id));
  const dur = (sec) => { sec = Math.round(sec || 0); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  function header() {
    if (!info) return;
    const vod = vodStart && info.vod;
    document.title = info.title + (info.live && !vod ? ' · LIVE' : '') + (info.site ? ' · ' + info.site : '');
    if (info.site) $('site').textContent = info.site;
    const cc = String((info.channel || {}).color || '');
    if (/^#[0-9a-f]{6}$/i.test(cc)) document.documentElement.style.setProperty('--accent', cc);         // the channel's colour across the page
    $('title').textContent = vod && info.vod.title ? info.vod.title : info.title;
    if (vod && info.vod.title) document.title = info.vod.title + (info.site ? ' · ' + info.site : '');
    $('badge').textContent = vod ? 'VIDEO' : info.live ? 'LIVE' : info.ended ? 'ENDED' : 'OFFLINE';
    $('badge').className = 'badge' + (info.live && !vod ? ' on' : '');
    $('viewers').textContent = vod ? new Date(info.vod.start).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : info.live && info.viewers ? `${info.viewers} watching` : '';
    $('desc').textContent = info.description || '';
    const ch = info.channel || {};
    const subOn = pub && pub.subscribed;
    $('chrow').replaceChildren(el('a', { href: '/c/' + ch.slug }, ch.logo ? el('img', { class: 'logo', src: imgUrl(ch.logo), alt: '' }) : null, el('div', {}, el('b', {}, ch.name || ''), el('div', { class: 'dim small' }, pub ? `${pub.subscribers} subscriber${pub.subscribers === 1 ? '' : 's'}` : ''))),
      el('span', { class: 'sp' }), pub ? el('button', { class: 'sub' + (subOn ? ' on' : ''), onclick: subscribe }, subOn ? 'Subscribed ✓' : 'Subscribe') : null);
    const vids = info.videos || [], mts = info.matches || [];
    const mList = mts.length ? [el('h3', {}, 'Matches'), el('div', { class: 'vids' }, mts.map((m) => el('a', { href: '?m=' + encodeURIComponent(m.fixture), class: m.fixture === matchId ? 'on' : '' }, el('b', {}, m.title), el('small', {}, (m.live ? 'so far · ' : '') + dur(m.duration)))))] : [];
    $('vids').replaceChildren(...mList, ...(vids.length ? [el('h3', {}, mts.length ? 'Full stream' : 'Recordings'), el('div', { class: 'vids' }, info.live ? el('a', { href: location.pathname, class: vodStart ? '' : 'on' }, el('b', {}, '● Live now'), el('small', {}, `${info.viewers || 0} watching`)) : null,
      vids.map((v) => el('a', { href: '?v=' + encodeURIComponent(v.start), class: v.start === vodStart ? 'on' : '' }, el('b', {}, v.title || new Date(v.start).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), el('small', {}, (v.title ? new Date(v.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' · ' : '') + dur(v.duration)))))] : []));
  }
  async function loadPublic() {
    if (!info || !info.channel || info.access !== 'Public') return;
    try { const r = await fetch('/api/public/c/' + encodeURIComponent(info.channel.slug)); if (r.ok) { pub = await r.json(); header(); } } catch (e) { /* no channel page */ }
  }
  async function subscribe() {
    if (!pub.signedIn) { location.href = '/?signin=1&next=' + encodeURIComponent(location.pathname + location.search); return; }
    const r = await fetch('/api/public/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify({ channel: info.channel.id, on: !pub.subscribed }) });
    if (r.ok) { pub.subscribed = (await r.json()).subscribed; pub.subscribers += pub.subscribed ? 1 : -1; header(); }
  }
  function playVod() {
    stop();
    const video = el('video', { playsinline: '', preload: 'auto', src: info.vod.url, poster: info.poster ? '/media/' + encodeURIComponent(info.poster) : null });
    const unmute = el('button', { class: 'unmute', onclick: (e) => { e.stopPropagation(); video.muted = false; video.play().catch(() => {}); unmute.remove(); } }, '🔊 Tap for sound');
    $('stage').replaceChildren(video);
    bar(video, { live: false, onUnmute: () => unmute.remove() });
    playing = true;
    // with sound if the browser lets us; phones only start muted videos by themselves
    video.play().catch(() => { video.muted = true; video.play().then(() => $('stage').append(unmute)).catch(() => {}); });
    beats(video, matchId ? { kind: 'match', match: matchId, title: info.vod.title || '' } : { kind: 'vod', start: info.vod.start });
  }

  // video analytics: every 30 s while the video plays, the website hears that someone is watching (no personal data)
  const SID = (() => { try { let x = sessionStorage.getItem('rfp-sid'); if (!x) { x = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, ''); sessionStorage.setItem('rfp-sid', x); } return x; } catch (e) { return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36); } })();
  let beatTimer = null;
  function beats(video, what) {
    clearInterval(beatTimer);
    const send = () => {
      if (!video.isConnected) { clearInterval(beatTimer); return; }
      if (video.paused || video.readyState < 2) return;
      fetch('/api/watch/' + encodeURIComponent(slug) + '/beat', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify({ sid: SID, ...what }) }).catch(() => {});
    };
    setTimeout(send, 4000);
    beatTimer = setInterval(send, 30000);
  }

  function stop() { if (pc) { try { pc.close(); } catch (e) { /* closed */ } } pc = null; if (hls) { try { hls.destroy(); } catch (e) { /* gone */ } hls = null; } playing = false; }

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
    // no picture after a few seconds (a blocked network, or video WebRTC cannot show): play HLS instead
    setTimeout(() => { if (mine === pc && !video.videoWidth) { stop(); hlsOnly = true; playHLS(); } }, 7000);
  }

  let hls = null, hlsOnly = false, withTracks = false, tracksBroken = false;
  function playHLS() {
    const video = el('video', { autoplay: '', playsinline: '', muted: '' });
    video.muted = true;
    const useTracks = !!info.audio && !tracksBroken;
    const src = useTracks ? info.audio.hls : info.hls;
    withTracks = useTracks;
    if (info.poster) video.poster = '/media/' + encodeURIComponent(info.poster);
    // the audio tracks do not play (yet): carry on with the plain stream
    const giveUp = () => { if (!useTracks || tracksBroken) return false; tracksBroken = true; stop(); playHLS(); return true; };
    if (useTracks) setTimeout(() => { if (withTracks && video.isConnected && !video.videoWidth) giveUp(); }, 15000);
    const tok = (u) => (info.token ? u + (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(info.token) : u);
    let tracks = null;
    // Safari (Mac, iPhone, iPad) plays HLS itself; everything else through hls.js (Android Chrome's own HLS is unreliable)
    const apple = /Apple/.test(navigator.vendor || '') && canHLS();
    if (apple || (canHLS() && !(window.Hls && window.Hls.isSupported()))) {
      video.src = tok(src); video.onerror = () => { if (!giveUp()) again(4000); };
      if (info.audio && video.audioTracks) tracks = { list: () => [...video.audioTracks].map((t, i) => ({ name: t.label || (info.audio.tracks[i] || {}).name || 'Track ' + (i + 1) })), current: () => [...video.audioTracks].findIndex((t) => t.enabled), pick: (i) => { [...video.audioTracks].forEach((t, j) => { t.enabled = j === i; }); } };
    }
    else if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ enableWorker: false, lowLatencyMode: true, liveSyncDurationCount: 3, manifestLoadingMaxRetry: 20, manifestLoadingRetryDelay: 1500,
        xhrSetup: (xhr, url) => { if (info.token && !/[?&]token=/.test(url)) xhr.open('GET', tok(url), true); } });
      hls.on(window.Hls.Events.ERROR, (ev, d) => { if (d && d.fatal && !giveUp()) again(4000); });
      hls.loadSource(tok(src));
      hls.attachMedia(video);
      const h0 = hls;
      if (info.audio) tracks = { list: () => (h0.audioTracks || []).map((t) => ({ name: t.name, note: (info.audio.tracks.find((x) => x.name === t.name) || {}).team ? 'team' : '' })), current: () => h0.audioTrack, pick: (i) => { h0.audioTrack = i; } };
    } else { message('This browser cannot play the stream', 'Try Chrome, Edge, Firefox or Safari.'); return; }
    show(video, tracks);
    if (tracks && hls) hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, () => current && current.paint());
    if (tracks && video.audioTracks) video.audioTracks.addEventListener && video.audioTracks.addEventListener('addtrack', () => current && current.paint());
  }
  const canHLS = () => !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
  // WebRTC is quickest, but carries no AAC sound (what OBS and vMix send): then the stream plays as HLS
  const webrtcFits = () => !hlsOnly && !info.audio && typeof RTCPeerConnection === 'function' && !(info.tracks || []).some((t) => /MPEG-4 Audio|AAC/i.test(t));

  let current = null;
  function show(video, tracks) {
    playing = true;
    const unmute = el('button', { class: 'unmute', onclick: (e) => { e.stopPropagation(); video.muted = false; video.play().catch(() => {}); unmute.remove(); } }, '🔊 Tap for sound');
    $('stage').replaceChildren(video, unmute);
    current = bar(video, { live: true, tracks, onUnmute: () => unmute.remove() });
    video.play().catch(() => {});
    slateKind = '';
    // the picture stops coming for a while: the slate over it, gone again as soon as it plays
    let stallT = null, over = null;
    const stalled = () => { clearTimeout(stallT); stallT = setTimeout(() => { if (video.isConnected && !over) { over = slateEl('difficulties'); $('stage').append(over); } }, 8000); };
    const fine = () => { clearTimeout(stallT); if (over) { over.remove(); over = null; } };
    for (const ev of ['waiting', 'stalled']) video.addEventListener(ev, stalled);
    for (const ev of ['playing', 'timeupdate']) video.addEventListener(ev, () => { if (!video.paused && video.readyState >= 3) fine(); });
    beats(video, { kind: 'live' });
  }

  function again(ms) { stop(); clearTimeout(retry); retry = setTimeout(load, ms); }

  async function load() {
    clearTimeout(retry);
    try { info = await api(password === null ? 'GET' : 'POST', password === null ? null : { password }); }
    catch (e) {
      if (e.status === 404) { document.title = 'Not found'; return message('There is no stream at this address.', 'Check the link you were given.'); }
      if (e.status === 403 && password !== null) { password = null; return askPassword(e.message); }
      return message('Cannot reach the website', e.message, el('p', {}, el('button', { onclick: load }, 'Try again')));
    }
    header();
    if (!pub) loadPublic();
    if (chatKey !== chatQuery() + ':' + !!info.needs) { chatKey = chatQuery() + ':' + !!info.needs; loadChat(); }
    if (info.needs === 'password') return askPassword();
    if (info.needs === 'signin') return message('Sign in to watch', 'This channel is for members of the production team.', el('p', {}, el('a', { class: 'btn primary', href: '/?signin=1&next=' + encodeURIComponent(location.pathname + location.search) }, 'Sign in')));
    if (info.needs === 'team') return message('This channel is for its production team', 'Ask the team to add you, or for a link you can use.');
    if (info.needs === 'ticket') { if (paidId) return waitForPayment(); return buy(); }
    if (vodStart) { if (info.vod) { if (!playing) playVod(); return; } return message(matchId ? 'This match video is not ready yet' : 'This recording is no longer here', '', el('p', {}, el('a', { class: 'btn', href: location.pathname }, 'Back to the stream'))); }
    if (!info.streaming) return message('Streaming is not set up on this website yet', '');
    if (!info.live && info.ended) { showSlate('ended'); return; }
    if (!info.live && (info.dropped || slateKind === 'difficulties')) { showSlate('difficulties'); return again(5000); }
    if (!info.live) { message('Not live yet', (info.videos || []).length ? 'Watch a recording below, or stay here: it starts playing by itself when the stream begins.' : 'This page starts playing by itself when the stream begins.'); return again(5000); }
    if (playing) { if (!vodStart && info.audio && !withTracks && !tracksBroken) { stop(); playHLS(); } return; }   // the audio tracks became ready: switch to them
    if (!webrtcFits()) return playHLS();
    try { await playWebRTC(); }
    catch (e) { stop(); playHLS(); }
  }

  // ---- paid streams
  const zar = (n) => 'R ' + Number(n || 0).toFixed(2).replace(/\.00$/, '');
  function buy(problem) {
    const pr = info.price || {};
    if (!info.payments) return message('This stream needs a ticket', 'Tickets are not on sale yet. Try again later.');
    const email = el('input', { type: 'email', placeholder: 'Your email address (the ticket is sent there)', autocomplete: 'email', value: info.email || '' });
    const name = el('input', { type: 'text', placeholder: 'Your name', autocomplete: 'name' });
    const go = async (kind, btn) => {
      btn.disabled = true;
      try {
        const r = await fetch('/api/pay/start', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify({ slug, kind, email: email.value, name: name.value }) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || 'Could not start the payment');
        const f = el('form', { method: 'POST', action: out.url, style: 'display:none' });
        for (const [k, v] of out.fields) f.append(el('input', { type: 'hidden', name: k, value: v }));
        document.body.append(f); f.submit();
      } catch (e) { btn.disabled = false; buy(e.message); }
    };
    const tBtn = el('button', { class: 'primary', onclick: () => go('ticket', tBtn) }, `Buy a ticket · ${zar(pr.ticket)}`);
    const pBtn = pr.pass ? el('button', { onclick: () => go('pass', pBtn) }, `${(info.channel || {}).name || 'Channel'} pass · ${zar(pr.pass.amount)} for ${pr.pass.days} days`) : null;
    message('This stream needs a ticket', pr.pass ? 'A ticket is for this stream, live and its recordings. A pass covers every paid stream on this channel.' : 'Your ticket is for this stream, live and its recordings afterwards.',
      problem ? el('p', { class: 'err' }, problem) : null,
      info.signedIn ? el('p', { class: 'dim small' }, 'Signed in as ' + info.email + ': the ticket is kept on your account.') : el('div', { class: 'col' }, name, email, el('p', { class: 'dim small' }, el('a', { href: '/?signin=1&next=' + encodeURIComponent(location.pathname) }, 'Sign in'), ' to keep it on your account instead.')),
      el('div', { class: 'row' }, tBtn, pBtn), el('p', { class: 'dim small' }, 'Paid safely with PayFast (card, Instant EFT, SnapScan and more).'));
  }
  async function waitForPayment(tries = 0) {
    message('Checking your payment…', 'This takes a few seconds after PayFast.');
    try {
      const r = await fetch('/api/pay/status/' + encodeURIComponent(paidId));
      const s = await r.json();
      if (s.status === 'Paid') { keepTicket(s.ticket); paidId = ''; history.replaceState(null, '', location.pathname); return load(); }
      if (s.status === 'Failed' || s.status === 'Cancelled') { paidId = ''; return buy('The payment did not go through (' + s.status.toLowerCase() + ').'); }
    } catch (e) { /* try again */ }
    if (tries > 40) { paidId = ''; return message('Your payment is still being processed', 'You get an email with your ticket as soon as PayFast confirms it. You can close this page.'); }
    setTimeout(() => waitForPayment(tries + 1), 3000);
  }

  // ---- comments: a live chat while live, comments on each video. Reading is open; writing needs a sign-in.
  let chatTimer = null, chatKey = '', chatForm = null;
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + ' min' : s < 86400 ? Math.floor(s / 3600) + ' h' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  const chatQuery = () => (matchId ? '?m=' + encodeURIComponent(matchId) : vodStart && vodStart !== 'match' ? '?v=' + encodeURIComponent(vodStart) : '');
  async function loadChat() {
    if (!info || info.needs) { $('chat').replaceChildren(); chatForm = null; return; }
    const key = chatQuery(), liveChat = !vodStart;
    let r;
    try { const x = await fetch('/api/watch/' + encodeURIComponent(slug) + '/comments' + key, { credentials: 'same-origin' }); r = await x.json(); if (!x.ok) throw new Error(r.error); } catch (e) { return; }
    const list = el('div', { class: 'clist' }, r.comments.length ? r.comments.map((c) => el('div', { class: 'cm' },
      c.image ? el('img', { class: 'av', src: c.image, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'av' }, (c.name || '?').slice(0, 1).toUpperCase()),
      el('div', {}, el('b', {}, c.name), el('span', { class: 'when' }, ago(c.at)), (c.mine || r.canModerate) ? el('button', { class: 'rm', title: 'Remove', onclick: async () => { await fetch('/api/comments/' + c.id, { method: 'DELETE', credentials: 'same-origin', headers: { 'x-rfp': '1' } }); loadChat(); } }, '✕') : null,
        el('div', { class: 't' }, c.text)))) : el('p', { class: 'dim small' }, liveChat ? 'No messages yet. Say hello!' : 'No comments yet.'));
    // the form is made once per thread, so typing is not disturbed while the chat refreshes
    if (!chatForm || chatForm.key !== key + ':' + r.signedIn) {
      const input = el('input', { type: 'text', maxlength: 500, placeholder: liveChat ? 'Say something…' : 'Add a comment…' });
      const err = el('p', { class: 'err small' });
      const send = async () => {
        const text = input.value.trim(); if (!text) return;
        const x = await fetch('/api/watch/' + encodeURIComponent(slug) + '/comments' + key, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: JSON.stringify({ text }) });
        const o = await x.json().catch(() => ({}));
        if (!x.ok) { err.textContent = o.error || 'Could not send'; return; }
        err.textContent = ''; input.value = ''; loadChat();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      chatForm = { key: key + ':' + r.signedIn, el: [r.signedIn ? el('div', { class: 'cform' }, input, el('button', { class: 'primary', onclick: send }, 'Send')) : el('p', { class: 'dim small' }, el('a', { href: '/?signin=1&next=' + encodeURIComponent(location.pathname + location.search) }, 'Sign in'), liveChat ? ' to chat.' : ' to comment.'), err] };
    }
    const prev = $('chat').querySelector('.clist');
    const atEnd = !prev || prev.scrollHeight - prev.scrollTop - prev.clientHeight < 40, top = prev ? prev.scrollTop : 0;
    const title = liveChat ? (info.live ? 'Live chat' : 'Chat') : 'Comments' + (r.comments.length ? ' (' + r.comments.length + ')' : '');
    if (!chatForm.shown || !prev) { chatForm.shown = true; $('chat').replaceChildren(el('h3', {}, title), list, ...chatForm.el); }
    else { $('chat').querySelector('h3').textContent = title; prev.replaceWith(list); }      // the form stays put while typing
    list.scrollTop = atEnd ? list.scrollHeight : top;
    clearTimeout(chatTimer);
    if (liveChat) chatTimer = setTimeout(loadChat, 4000);
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
    if (!info || info.needs || vodStart) return;
    try {
      const now = await api(password === null ? 'GET' : 'POST', password === null ? null : { password });
      const was = info.live; info = { ...info, ...now }; header();
      if (!was && info.live && !playing) load();
      else if (info.live && playing && info.audio && !withTracks && !tracksBroken) { stop(); playHLS(); }                  // audio tracks ready: switch to them
      else if (!info.live && was) showSlate(info.ended ? 'ended' : 'difficulties');
    } catch (e) { /* next time */ }
  }, 5000);

  // ---- master control (the production's MCR): slates, ad breaks and graphics over the live picture, in this player only.
  // The stream itself (and its recording) stays clean. Times come from the website's clock.
  const M = { state: null, skew: 0, layer: null, slate: null, ad: null, adKey: '', ov: null, ovKey: '', muted: null, timer: null, sq: null, sqKey: '' };
  const srvNow = () => Date.now() + M.skew;
  const liveVideo = () => $('stage').querySelector('video:not(.advid)');
  function muteLive(on) {
    const v = liveVideo();
    if (!v) return;
    if (on && M.muted === null) { M.muted = v.muted; v.muted = true; }
    else if (!on && M.muted !== null) { v.muted = M.muted; M.muted = null; }
  }
  function mcrLayer() {
    if (!M.layer) M.layer = el('div', { class: 'mcr' });
    if (!M.layer.isConnected) $('stage').append(M.layer);
    return M.layer;
  }
  function mcrSlate(sl) {
    const key = sl ? [sl.kind, sl.title, sl.text, sl.mute].join('|') : '';
    if (M.slate && M.slate.dataset.key === key) return;
    if (M.slate) { M.slate.remove(); M.slate = null; }
    if (!sl) return;
    const ch = (info && info.channel) || {};
    M.slate = el('div', { class: 'slate mslate k-' + sl.kind, 'data-key': key },
      ch.logo ? el('img', { class: 'slogo', src: imgUrl(ch.logo), alt: ch.name || '' }) : el('img', { class: 'slogo brand', src: '/brand/rfp-logo.png', alt: (info && info.site) || '' }),
      el('b', {}, sl.title || 'Please stand by'), sl.text ? el('p', {}, sl.text) : null,
      el('div', { class: 'sbars' }, el('i'), el('i'), el('i')),
      sl.until ? el('small', { class: 'suntil' }) : null);
    M.slate.until = sl.until ? Date.parse(sl.until) : 0;
    mcrLayer().append(M.slate);
  }
  function mcrAd(ad) {
    const key = ad ? ad.startedAt + '|' + ad.items.map((i) => i.url).join(',') : '';
    if (key === M.adKey) return;
    M.adKey = key;
    if (M.ad) { try { M.ad.video.pause(); } catch (e) { /* gone */ } M.ad.box.remove(); M.ad = null; }
    if (!ad) return;
    const video = el('video', { class: 'advid', playsinline: '', preload: 'auto' });
    const badge = el('div', { class: 'adbadge' }), snd = el('button', { class: 'unmute adsnd', onclick: (e) => { e.stopPropagation(); video.muted = false; video.play().catch(() => {}); snd.remove(); } }, '🔊 Tap for sound');
    const box = el('div', { class: 'adbox' }, video, badge);
    M.ad = { box, video, badge, ad, idx: -1, snd };
    mcrLayer().append(box);
    // which advert, and how far into it, by the clock
    const place = () => {
      const t = srvNow() - Date.parse(ad.startedAt);
      let acc = 0;
      for (let i = 0; i < ad.items.length; i++) { const d = ad.items[i].duration * 1000; if (t < acc + d) return { i, off: Math.max(0, (t - acc) / 1000) }; acc += d; }
      return null;
    };
    const playAt = () => {
      const p = place();
      if (!p || !M.ad || M.ad.box !== box) return;
      if (p.i !== M.ad.idx) {
        M.ad.idx = p.i;
        video.src = ad.items[p.i].url;
        const seek = () => { if (p.off > 0.5) { try { video.currentTime = p.off; } catch (e) { /* not seekable yet */ } } };
        video.addEventListener('loadedmetadata', seek, { once: true });
        video.muted = M.muted === null ? true : !!M.muted;
        video.play().catch(() => { video.muted = true; video.play().catch(() => {}); if (!snd.isConnected) box.append(snd); });
        if (video.muted && !snd.isConnected) box.append(snd);
      }
    };
    video.addEventListener('ended', playAt);
    playAt();
  }
  // squeeze-back: the live picture shrinks into a corner; adverts (or a sponsor board) fill the frame behind it
  function mcrSqueeze(sq) {
    const key = sq ? [sq.startedAt, sq.image, sq.pos, sq.size, sq.items.map((i) => i.url).join(',')].join('|') : '';
    const stage = $('stage');
    if (key === M.sqKey && (!M.sq || M.sq.bg.isConnected)) return;
    M.sqKey = key;
    if (M.sq) { try { M.sq.video && M.sq.video.pause(); } catch (e) { /* gone */ } M.sq.bg.remove(); M.sq.badge.remove(); M.sq = null; }
    stage.classList.remove('squeeze', 'sq-tl', 'sq-tr', 'sq-bl', 'sq-br');
    if (!sq) return;
    stage.style.setProperty('--sq', (sq.size || 62) + '%');
    stage.classList.add('squeeze', 'sq-' + (sq.pos || 'tr'));
    const bg = el('div', { class: 'sqbg' }), badge = el('div', { class: 'adbadge sqbadge' });
    if (sq.image) bg.append(el('img', { src: imgUrl(sq.image), alt: '' }));
    let video = null;
    if (sq.items.length) {
      video = el('video', { class: 'advid', playsinline: '', preload: 'auto' });
      bg.append(video);
      let idx = -1;
      const playAt = () => {
        const t = srvNow() - Date.parse(sq.startedAt);
        let acc = 0, p = null;
        for (let i = 0; i < sq.items.length; i++) { const d = sq.items[i].duration * 1000; if (t < acc + d) { p = { i, off: Math.max(0, (t - acc) / 1000) }; break; } acc += d; }
        if (!p || !M.sq || M.sq.bg !== bg || p.i === idx) return;
        idx = p.i;
        video.src = sq.items[p.i].url;
        video.addEventListener('loadedmetadata', () => { if (p.off > 0.5) { try { video.currentTime = p.off; } catch (e) { /* not yet */ } } }, { once: true });
        video.muted = sq.sound === 'live' || M.muted === null ? true : !!M.muted;
        video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
      };
      video.addEventListener('ended', playAt);
      M.sq = { bg, badge, video, sq };
      stage.prepend(bg);
      playAt();
    } else { M.sq = { bg, badge, video: null, sq }; stage.prepend(bg); }
    if (sq.text) bg.append(el('div', { class: 'sqtext' }, sq.text));
    mcrLayer().append(badge);
  }
  function mcrOverlays(list) {
    const key = JSON.stringify(list || []);
    if (key === M.ovKey) return;
    M.ovKey = key;
    if (M.ov) M.ov.remove();
    M.ov = el('div', { class: 'ovl' });
    for (const o of list || []) {
      if (o.kind === 'bug') M.ov.append(el('div', { class: 'ov bug ' + o.pos }, o.image ? el('img', { src: imgUrl(o.image), alt: '' }) : null, o.text ? el('span', {}, o.text) : null));
      else if (o.kind === 'lower') M.ov.append(el('div', { class: 'ov lower ' + (o.pos === 'br' || o.pos === 'tr' ? 'right' : '') }, el('b', {}, o.text), o.sub ? el('span', {}, o.sub) : null));
      else if (o.kind === 'ticker') M.ov.append(el('div', { class: 'ov ticker' }, el('div', { class: 'tk' }, el('span', {}, o.text + (o.sub ? '   •   ' + o.sub : '')))));
      else if (o.kind === 'image' && o.image) M.ov.append(el('img', { class: 'ov image ' + o.pos, src: imgUrl(o.image), alt: o.text || '' }));
    }
    mcrLayer().append(M.ov);
  }
  // every half second: the countdowns, the end of an ad break, the sound
  function mcrTick() {
    const st = M.state, now = srvNow();
    const ad = st && st.ad && Date.parse(st.ad.endsAt) > now ? st.ad : null;
    const sl = st && st.slate && (!st.slate.until || Date.parse(st.slate.until) > now) ? st.slate : null;
    const sq = st && st.squeeze && Date.parse(st.squeeze.endsAt) > now ? st.squeeze : null;
    const on = !!(info && info.live && !info.needs) && !vodStart && !!liveVideo();
    if (on && M.layer && !M.layer.isConnected) $('stage').append(M.layer);        // the picture was started again
    mcrAd(on ? ad : null);
    mcrSlate(on && !ad ? sl : null);
    mcrSqueeze(on && !ad && !sl ? sq : null);
    mcrOverlays(on && !ad && !(sq && !sl) ? (st && st.overlays) || [] : []);
    muteLive(on && (!!ad || !!(sl && sl.mute) || !!(sq && !sl && sq.sound !== 'live' && sq.items.length)));
    if (M.sq) M.sq.badge.textContent = 'Back to full screen in ' + dur(Math.max(0, Math.ceil((Date.parse(M.sq.sq.endsAt) - now) / 1000)));
    if (M.ad) {
      const left = Math.max(0, Math.ceil((Date.parse(ad.endsAt) - now) / 1000));
      M.ad.badge.textContent = (ad.items.length > 1 ? `Ad ${Math.max(1, M.ad.idx + 1)} of ${ad.items.length} · ` : 'Ad · ') + 'back in ' + dur(left);
    }
    if (M.slate && M.slate.until) { const u = M.slate.querySelector('.suntil'); if (u) u.textContent = 'Back in about ' + dur(Math.max(0, Math.ceil((M.slate.until - now) / 1000))); }
  }
  async function mcrPoll() {
    if (!info || info.needs || vodStart || !info.live) { M.state = null; return; }
    try {
      const t0 = Date.now();
      const r = await fetch('/api/watch/' + encodeURIComponent(slug) + '/mcr', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const x = await r.json();
      M.skew = x.now - Math.round((t0 + Date.now()) / 2);
      M.state = x;
    } catch (e) { /* next time */ }
  }
  if (!vodStart) { setInterval(mcrPoll, 3000); setInterval(mcrTick, 500); setTimeout(mcrPoll, 800); }

  load();
})();
