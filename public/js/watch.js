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
  }
  const imgUrl = (id) => (!id ? '' : /^https?:/.test(id) ? id : '/media/' + encodeURIComponent(id));
  const dur = (sec) => { sec = Math.round(sec || 0); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  function header() {
    if (!info) return;
    const vod = vodStart && info.vod;
    document.title = info.title + (info.live && !vod ? ' · LIVE' : '') + (info.site ? ' · ' + info.site : '');
    if (info.site) $('site').textContent = info.site;
    $('title').textContent = vod && info.vod.title ? info.vod.title : info.title;
    if (vod && info.vod.title) document.title = info.vod.title + (info.site ? ' · ' + info.site : '');
    $('badge').textContent = vod ? 'VIDEO' : info.live ? 'LIVE' : 'OFFLINE';
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
      vids.map((v) => el('a', { href: '?v=' + encodeURIComponent(v.start), class: v.start === vodStart ? 'on' : '' }, el('b', {}, new Date(v.start).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), el('small', {}, dur(v.duration)))))] : []));
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
    const video = el('video', { controls: '', playsinline: '', autoplay: '', src: info.vod.url });
    video.addEventListener('dblclick', () => { (video.requestFullscreen || video.webkitEnterFullscreen || (() => {})).call(video); });
    $('stage').replaceChildren(video);
    playing = true;
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

  let hls = null, hlsOnly = false;
  function playHLS() {
    const video = el('video', { autoplay: '', playsinline: '', controls: '', muted: '' });
    video.muted = true;
    const tok = (u) => (info.token ? u + (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(info.token) : u);
    if (canHLS()) { video.src = tok(info.hls); video.onerror = () => again(4000); }       // Safari, iPhone, iPad
    else if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ enableWorker: false, lowLatencyMode: true, liveSyncDurationCount: 3, manifestLoadingMaxRetry: 20, manifestLoadingRetryDelay: 1500,
        xhrSetup: (xhr, url) => { if (info.token && !/[?&]token=/.test(url)) xhr.open('GET', tok(url), true); } });
      hls.on(window.Hls.Events.ERROR, (ev, d) => { if (d && d.fatal) again(4000); });
      hls.loadSource(tok(info.hls));
      hls.attachMedia(video);
    } else { message('This browser cannot play the stream', 'Try Chrome, Edge, Firefox or Safari.'); return; }
    show(video);
  }
  const canHLS = () => !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
  // WebRTC is quickest, but carries no AAC sound (what OBS and vMix send): then the stream plays as HLS
  const webrtcFits = () => !hlsOnly && typeof RTCPeerConnection === 'function' && !(info.tracks || []).some((t) => /MPEG-4 Audio|AAC/i.test(t));

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
    if (!info.live) { message('Not live yet', (info.videos || []).length ? 'Watch a recording below, or stay here: it starts playing by itself when the stream begins.' : 'This page starts playing by itself when the stream begins.'); return again(5000); }
    if (playing) return;
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
    } catch (e) { /* next time */ }
  }, 10000);

  load();
})();
