/* RFP Scopes: is everything in order before going live? A big monitor with the scopes below.
 * Sources: the incoming stream (what the encoder sends to the server, as viewers will get it), a capture input on this
 * computer (capture card, camera, audio interface), and – in the RFP Scopes app – NDI sources on the network.
 *   - Picture: as big as it fits, with safe areas, a centre cross, 4:3 lines, the source name and format, a tally border
 *     (by hand, or from RFP Manager: the ATEM's program / preview); double-click for the picture alone
 *   - Audio meters beside it: sample peaks with hold; loudness (ITU BS.1770 K-weighting) momentary, short-term,
 *     integrated (gated), loudness range against a target
 *   - Waveform: luma 0–100 % or RGB parade, clipped whites / crushed blacks counted
 *   - Vectorscope: BT.709, 75 % targets, skin-tone line, ×2
 *   - Phase: goniometer and correlation (−1 out of phase … +1 mono), balance
 *   - A verdict: READY TO GO LIVE / ALMOST / NOT READY, from the checks
 * Everything runs here (Web Audio + a canvas); nothing is sent anywhere. The app (tools/scopes) hands over NDI frames
 * through WebView2 shared buffers and the sound as messages. Plain browser JavaScript. */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const video = $('v'), ndiC = $('ndiC');
  const WV = window.chrome && window.chrome.webview ? window.chrome.webview : null;      // inside the RFP Scopes app
  const post = (o) => { if (WV) WV.postMessage(o); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const fmt = (v, d = 1) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(d) : '–');
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('rfp-scopes-' + k) || 'null'); localStorage.setItem('rfp-scopes-' + k, JSON.stringify(v)); } catch (e) { /* private window */ } return null; };
  async function api(url) {
    const r = await fetch(url, { credentials: 'same-origin', headers: { 'x-rfp': '1' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status });
    return j;
  }
  // a GET to another address (RFP Manager's values for the tally): the app fetches it (no CORS), a browser itself
  let reqN = 0; const waiting = new Map();
  function httpGet(url) {
    if (!WV) return fetch(url, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    return new Promise((resolve, reject) => { const id = ++reqN; waiting.set(id, { resolve, reject }); post({ app: 'get', id, url }); setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); reject(new Error('No answer')); } }, 4000); });
  }

  // ---------------------------------------------------------------- sources
  let hls = null, ctx = null, srcNode = null, stream = null, elemSource = null, started = false, current = '', pic = 'video';
  const ndi = { list: [], buf: null, w: 0, h: 0, at: 0, fps: '', name: '', channels: 0, node: null, ready: false };
  async function sources() {
    const sel = $('src'), keep = sel.value;
    const opts = [new Option('Capture input on this computer', 'cap')];
    for (const n of ndi.list) opts.push(new Option('NDI · ' + n, 'ndi:' + n));
    if (!WV) {
      try {
        const me = await api('/api/me');
        for (const t of (me.teams || [])) {
          const r = await api('/api/streams?team=' + encodeURIComponent(t.id)).catch(() => ({ list: [] }));
          for (const s of r.list || []) opts.push(new Option(`Stream · ${s.live ? '● ' : ''}${s.title}${s.live ? '' : ' (not receiving)'}`, 's:' + s.slug));
        }
      } catch (e) { /* not signed in: capture only */ }
    }
    if (current.startsWith('ndi:') && !opts.some((o) => o.value === current)) opts.push(new Option('NDI · ' + current.slice(4) + ' (not seen now)', current));
    sel.replaceChildren(...opts);
    const want = keep || (q.get('slug') ? 's:' + q.get('slug') : q.get('src') === 'capture' ? 'cap' : store('src') || (opts.find((o) => o.text.includes('●')) || opts[WV && opts[1] ? 1 : 0]).value);
    if (opts.some((o) => o.value === want)) sel.value = want;
    else if (q.get('slug') && want === 's:' + q.get('slug')) { sel.append(new Option(q.get('slug'), want)); sel.value = want; }
    showOpts();
  }
  const showOpts = () => { const v = $('src').value; $('devs').hidden = v !== 'cap'; $('ndiopt').hidden = !v.startsWith('ndi:'); };
  function stop() {
    if (hls) { try { hls.destroy(); } catch (e) { /* gone */ } hls = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (srcNode) { try { srcNode.disconnect(); } catch (e) { /* gone */ } srcNode = null; }
    if (ndi.node) { try { ndi.node.disconnect(); } catch (e) { /* gone */ } }
    if (current.startsWith('ndi:')) post({ ndi: 'close' });
    video.srcObject = null; video.removeAttribute('src');
    $('trk').hidden = true;
  }
  function usePic(kind) { pic = kind; video.hidden = kind !== 'video'; ndiC.hidden = kind !== 'ndi'; }
  async function play(val) {
    stop(); current = val; store('src', val); resetMeters(); showOpts(); $('idle').hidden = true;
    if (val === 'cap') { usePic('video'); return capture(); }
    if (val.startsWith('ndi:')) { usePic('ndi'); return openNdi(val.slice(4)); }
    usePic('video');
    const slug = val.slice(2);
    let info;
    try { info = await api('/api/watch/' + encodeURIComponent(slug)); } catch (e) { return say('Cannot open the stream: ' + e.message, 'bad'); }
    setName(info.title || slug, '');
    if (!info.live) say('Nothing is arriving on this stream yet: start the encoder. The scopes start by themselves.', 'warn');
    const tok = (u) => (info.token ? u + (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(info.token) : u);
    const url = info.audio ? info.audio.hls : info.hls;
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ enableWorker: false, lowLatencyMode: true, liveSyncDurationCount: 2, manifestLoadingMaxRetry: 1000, manifestLoadingRetryDelay: 2000,
        xhrSetup: (xhr, u) => { if (info.token && !/[?&]token=/.test(u)) xhr.open('GET', tok(u), true); } });
      hls.on(window.Hls.Events.ERROR, (ev, d) => { if (d && d.fatal) setTimeout(() => { if (current === val) play(val); }, 4000); });
      hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        const t = $('trk'), list = hls.audioTracks || [];
        t.hidden = list.length < 2;
        t.replaceChildren(...list.map((x, i) => new Option(x.name || 'Track ' + (i + 1), i)));
        t.value = hls.audioTrack; t.onchange = () => { hls.audioTrack = Number(t.value); resetMeters(); };
      });
      hls.loadSource(tok(url)); hls.attachMedia(video);
    } else video.src = tok(url);              // Safari plays HLS itself
    attachElement();
    video.play().catch(() => {});
  }
  async function capture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return say(location.protocol === 'http:' && location.hostname !== 'localhost' ? 'A capture input needs https or http://localhost: open this page as http://localhost/scopes on the production PC.' : 'This browser cannot open capture inputs.', 'bad');
    const vd = $('vdev').value, ad = $('adev').value;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: vd === 'none' ? false : { deviceId: vd ? { exact: vd } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 50 } },
        audio: ad === 'none' ? false : { deviceId: ad ? { exact: ad } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: 48000 } });
    } catch (e) { if (current === 'cap') say('The capture input did not open: ' + e.message, 'bad'); return; }
    if (current !== 'cap') { stream.getTracks().forEach((t) => t.stop()); stream = null; return; }   // another source was chosen meanwhile
    await devices();
    video.srcObject = stream; video.muted = true; video.play().catch(() => {});
    const vt = stream.getVideoTracks()[0], st = vt && vt.getSettings ? vt.getSettings() : {};
    setName(vt ? vt.label : 'Capture input', st.frameRate ? Math.round(st.frameRate) + 'p' : '');
    if (stream.getAudioTracks().length) { audio(); srcNode = ctx.createMediaStreamSource(stream); srcNode.connect(chain.inp); }
  }
  async function devices() {
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const fill = (sel, kind, none) => { const v = sel.value; sel.replaceChildren(new Option(none, 'none'), ...list.filter((d) => d.kind === kind).map((d, i) => new Option(d.label || `${kind === 'videoinput' ? 'Video' : 'Audio'} input ${i + 1}`, d.deviceId))); if (v && [...sel.options].some((o) => o.value === v)) sel.value = v; else if (sel.options.length > 1) sel.selectedIndex = 1; };
    fill($('vdev'), 'videoinput', 'No picture'); fill($('adev'), 'audioinput', 'No sound');
  }
  // the stream's sound goes through Web Audio (scopes); you hear it only with Listen on
  function attachElement() {
    audio();
    if (!elemSource) elemSource = ctx.createMediaElementSource(video);
    srcNode = elemSource; srcNode.connect(chain.inp);
    video.muted = false; video.volume = 1;
  }

  // ---------------------------------------------------------------- NDI (the RFP Scopes app)
  // the app sends: { ndi: 'sources', list } · a shared buffer { ndi: 'buffer', w, h } · { ndi: 'frame', w, h, fpsN, fpsD, progressive }
  // (answered with { ndi: 'ack' }) · { ndi: 'audio', sr, ch, n, d: base64 of interleaved Float32 stereo } · { ndi: 'error', text }
  async function openNdi(name) {
    audio();
    if (!ndi.ready) { try { await ctx.audioWorklet.addModule('/js/scopes-worklet.js'); ndi.ready = true; } catch (e) { say('The NDI sound could not start: ' + e.message, 'warn'); } }
    if (ndi.ready && !ndi.node) ndi.node = new AudioWorkletNode(ctx, 'rfp-feed', { numberOfInputs: 0, outputChannelCount: [2] });
    if (ndi.node) ndi.node.connect(chain.inp);
    ndi.name = name; ndi.at = 0; ndi.channels = 0; ndi.frames = 0; ndi.audioMsgs = 0;
    setName(name, '');
    ndiWait('Connecting to ' + name + ' …');
    post({ ndi: 'open', name, bandwidth: Number($('ndibw').value), pair: Number($('ndipair').value) || 0 });
  }
  if (WV) {
    WV.addEventListener('sharedbufferreceived', (e) => {
      const d = e.additionalData || {};
      if (ndi.buf) { try { WV.releaseBuffer(ndi.buf); } catch (x) { /* gone */ } }
      ndi.buf = e.getBuffer(); ndi.w = d.w; ndi.h = d.h;
    });
    WV.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.app === 'got') { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); if (m.status >= 200 && m.status < 300) { try { w.resolve(JSON.parse(m.body)); } catch (x) { w.reject(x); } } else w.reject(new Error(m.error || 'HTTP ' + m.status)); } return; }
      if (m.ndi === 'sources') { const before = ndi.list.join('|'); ndi.list = m.list || []; if (before !== ndi.list.join('|')) sources(); return; }
      if (m.ndi === 'error') { if (!current) ndi.problem = m.text; say(m.text, 'bad'); return; }
      if (m.ndi === 'status') { ndi.status = m.text; if (current.startsWith('ndi:') && !ndi.at) ndiWait(m.text); return; }
      if (!current.startsWith('ndi:')) return;
      if (m.ndi === 'frame') { drawNdi(m); return; }
      if (m.ndi === 'audio') {
        if (m.ch !== ndi.channels) { ndi.channels = m.ch; const p = $('ndipair'), keep = p.value; p.replaceChildren(...Array.from({ length: Math.max(1, Math.ceil(m.ch / 2)) }, (_, i) => new Option(m.ch < 2 ? 'Mono' : `Ch ${i * 2 + 1}+${i * 2 + 2}`, i * 2))); if ([...p.options].some((o) => o.value === keep)) p.value = keep; }
        ndi.audioMsgs++;
        if (!ndi.node) { if (ndi.audioMsgs === 1) say('NDI sound is arriving, but the sound engine did not start (the meters stay empty). Restart RFP Scopes.', 'warn'); return; }
        const bin = atob(m.d), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const f = new Float32Array(u8.buffer), g = Math.pow(10, -(Number($('ndiref').value) || 0) / 20);
        if (g !== 1) for (let i = 0; i < f.length; i++) f[i] *= g;
        ndi.node.port.postMessage(f, [f.buffer]);
      }
    });
    post({ ndi: 'list' });
    setInterval(() => post({ ndi: 'list' }), 3000);
    $('newwin').hidden = false; $('newwin').onclick = () => post({ app: 'newWindow' });
  }
  const nctx = ndiC.getContext('2d');
  function drawNdi(m) {
    if (!ndi.buf || m.w !== ndi.w || m.h !== ndi.h) { post({ ndi: 'ack' }); return; }
    if (ndiC.width !== m.w || ndiC.height !== m.h) { ndiC.width = m.w; ndiC.height = m.h; aspect(m.w, m.h); }
    nctx.putImageData(new ImageData(new Uint8ClampedArray(ndi.buf, 0, m.w * m.h * 4), m.w, m.h), 0, 0);
    if (!ndi.at) $('idle').hidden = true;
    ndi.at = performance.now(); ndi.frames++;
    const fps = m.fpsD ? m.fpsN / m.fpsD : 0;
    ndi.fps = `${m.w}×${m.h} ${fps ? (Math.round(fps * 100) / 100) + (m.progressive === false ? 'i' : 'p') : ''}`;
    $('nameF').textContent = ndi.fps;
    post({ ndi: 'ack' });
  }
  $('ndibw').onchange = $('ndipair').onchange = () => { if (current.startsWith('ndi:')) { resetMeters(); post({ ndi: 'open', name: current.slice(4), bandwidth: Number($('ndibw').value), pair: Number($('ndipair').value) || 0 }); } };
  $('ndiref').value = String(store('ndiref') || 0); $('ndiref').onchange = () => { store('ndiref', $('ndiref').value); resetMeters(); };

  // ---------------------------------------------------------------- audio: phase, peaks, K-weighted loudness
  let chain = null;
  function audio() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 48000 });
    const inp = ctx.createGain(); inp.channelCount = 2; inp.channelCountMode = 'explicit'; inp.channelInterpretation = 'speakers';   // mono → both sides
    const split = ctx.createChannelSplitter(2); inp.connect(split);
    const an = [0, 1].map((i) => { const a = ctx.createAnalyser(); a.fftSize = 2048; split.connect(a, i); return a; });
    // K-weighting (BS.1770): a high shelf (+4 dB above ~1.7 kHz) and a high pass (~38 Hz), then the mean square
    const kan = [0, 1].map((i) => {
      const g = ctx.createGain(); split.connect(g, i);
      const hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1681.97; hs.gain.value = 4.0;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38.13; hp.Q.value = 0.5;
      const a = ctx.createAnalyser(); a.fftSize = 16384;
      g.connect(hs); hs.connect(hp); hp.connect(a);
      return a;
    });
    const out = ctx.createGain(); out.gain.value = listening ? 1 : 0; inp.connect(out); out.connect(ctx.destination);
    chain = { inp, an, kan, out, bufs: an.map((a) => new Float32Array(a.fftSize)), kbufs: kan.map((a) => new Float32Array(a.fftSize)) };
  }
  let listening = false;
  $('listen').onclick = () => { listening = !listening; if (chain) chain.out.gain.value = listening ? 1 : 0; $('listen').classList.toggle('on', listening); $('listen').textContent = listening ? '🔊 Listening' : '🔈 Listen'; if (ctx) ctx.resume(); };

  const A = { corr: NaN, peaks: [-Infinity, -Infinity], hold: [[-Infinity, 0], [-Infinity, 0]], blocks: [], shorts: [], lastBlock: 0, lastShort: 0, M: -Infinity, S: -Infinity, I: -Infinity, LRA: NaN, silentSince: 0, phaseBadSince: 0, clipAt: 0, nearAt: 0, wide: [] };
  function resetMeters() { Object.assign(A, { corr: NaN, blocks: [], shorts: [], I: -Infinity, LRA: NaN, M: -Infinity, S: -Infinity, hold: [[-Infinity, 0], [-Infinity, 0]], silentSince: 0, phaseBadSince: 0, clipAt: 0, nearAt: 0, wide: [] }); }
  $('reset').onclick = () => { A.blocks = []; A.shorts = []; A.I = -Infinity; A.LRA = NaN; };
  const lufs = (p) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);
  function gated(powers, rel) {
    const abs = powers.filter((p) => lufs(p) > -70);
    if (!abs.length) return [];
    const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
    return abs.filter((p) => lufs(p) > lufs(mean) + rel);
  }
  const gon = { c: $('gonC'), g: null };
  function audioFrame(now) {
    if (!chain) return;
    const [L, R] = chain.bufs;
    chain.an[0].getFloatTimeDomainData(L); chain.an[1].getFloatTimeDomainData(R);
    let sLR = 0, sLL = 0, sRR = 0; const pk = [0, 0];
    for (let i = 0; i < L.length; i++) { const l = L[i], r = R[i]; sLR += l * r; sLL += l * l; sRR += r * r; const al = Math.abs(l), ar = Math.abs(r); if (al > pk[0]) pk[0] = al; if (ar > pk[1]) pk[1] = ar; }
    const loud = Math.sqrt((sLL + sRR) / (2 * L.length));
    const c = sLL > 1e-9 && sRR > 1e-9 ? sLR / Math.sqrt(sLL * sRR) : (sLL > 1e-9 || sRR > 1e-9 ? 0 : NaN);
    if (Number.isFinite(c)) A.corr = Number.isFinite(A.corr) ? A.corr * 0.85 + c * 0.15 : c; else A.corr = NaN;
    A.balance = sLL > 1e-9 && sRR > 1e-9 ? 10 * Math.log10(sLL / sRR) : NaN;
    for (let i = 0; i < 2; i++) { const d = db(pk[i]); A.peaks[i] = d; if (d >= A.hold[i][0] || now - A.hold[i][1] > 2000) A.hold[i] = [d, now]; if (d >= TP) A.clipAt = now; else if (d >= STD[std].max) A.nearAt = now; }
    // loudness every 100 ms: the last ~0.34 s, K-weighted (momentary); 3 s of those (short-term); gated (integrated)
    if (now - A.lastBlock >= 100) {
      A.lastBlock = now;
      const [kL, kR] = chain.kbufs; chain.kan[0].getFloatTimeDomainData(kL); chain.kan[1].getFloatTimeDomainData(kR);
      let mL = 0, mR = 0; for (let i = 0; i < kL.length; i++) { mL += kL[i] * kL[i]; mR += kR[i] * kR[i]; }
      const p = (mL + mR) / kL.length;
      A.M = lufs(p);
      A.blocks.push([now, p]); if (A.blocks.length > 36000) A.blocks.splice(0, 6000);
      const last3 = A.blocks.filter((b) => now - b[0] <= 3000).map((b) => b[1]);
      const sp = last3.reduce((a, b) => a + b, 0) / Math.max(1, last3.length); A.S = lufs(sp);
      if (now - A.lastShort >= 1000) { A.lastShort = now; A.shorts.push(sp); if (A.shorts.length > 7200) A.shorts.shift(); }
      const g = gated(A.blocks.map((b) => b[1]), -10);
      A.I = g.length ? lufs(g.reduce((a, b) => a + b, 0) / g.length) : -Infinity;
      const gs = gated(A.shorts, -20).map(lufs).sort((a, b) => a - b);
      A.LRA = gs.length > 5 ? gs[Math.floor(gs.length * 0.95) - 1] - gs[Math.floor(gs.length * 0.10)] : NaN;
      if (A.M < -60) { if (!A.silentSince) A.silentSince = now; } else A.silentSince = 0;
    }
    if (Number.isFinite(A.corr) && A.corr < -0.2 && loud > 0.003) { if (!A.phaseBadSince) A.phaseBadSince = now; } else A.phaseBadSince = 0;
    if (Number.isFinite(A.corr) && loud > 0.003) { A.wide.push([now, A.corr]); while (A.wide.length && now - A.wide[0][0] > 3000) A.wide.shift(); }
    // the goniometer: M (L+R) up, S (L−R) across, scaled to the level, a short trail
    const cv = gon.c, w = cv.width, h = cv.height;
    if (!gon.g) gon.g = cv.getContext('2d');
    const g = gon.g;
    g.fillStyle = 'rgba(5,5,5,0.32)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1e1e1e'; g.lineWidth = 1; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.moveTo(0, h); g.lineTo(w, 0); g.moveTo(0, 0); g.lineTo(w, h); g.stroke();
    const k = (w * 0.42) / Math.max(0.05, Math.max(pk[0], pk[1]) * 1.05);
    g.fillStyle = A.corr < -0.2 ? 'rgba(255,90,90,.8)' : 'rgba(0,255,130,.75)';
    for (let i = 0; i < L.length; i += 2) { const m = (L[i] + R[i]) * 0.7071, s = (L[i] - R[i]) * 0.7071; g.fillRect(w / 2 + s * k, h / 2 - m * k, 1.4, 1.4); }
    g.fillStyle = '#666'; g.font = `${Math.round(w / 20)}px sans-serif`; g.fillText('L', 6, 16); g.fillText('R', w - 14, 16); g.fillText('M', w / 2 + 4, 14); g.fillText('S', w - 14, h / 2 - 4);
  }

  // ---------------------------------------------------------------- video: waveform and vectorscope
  const SW = 256, SH = 144;
  const grab = document.createElement('canvas'); grab.width = SW; grab.height = SH;
  const gctx = grab.getContext('2d', { willReadFrequently: true });
  let parade = false, zoom = 1;
  const V = { blackSince: 0, sig: '', sameSince: 0, clip: 0, crush: 0, mean: 0 };
  $('wl').onclick = () => { parade = false; $('wl').classList.add('on'); $('wp').classList.remove('on'); grat(); };
  $('wp').onclick = () => { parade = true; $('wp').classList.add('on'); $('wl').classList.remove('on'); grat(); };
  $('vz').onclick = () => { zoom = zoom === 1 ? 2 : 1; $('vz').classList.toggle('on', zoom === 2); grat(); };
  const waveImg = { l: new ImageData(SW, 256), p: new ImageData(SW * 3, 256) }, vecImg = new ImageData(256, 256);
  const tmp = document.createElement('canvas');
  function blit(target, img) { tmp.width = img.width; tmp.height = img.height; tmp.getContext('2d').putImageData(img, 0, 0); const g = target.getContext('2d'); g.imageSmoothingEnabled = true; g.clearRect(0, 0, target.width, target.height); g.drawImage(tmp, 0, 0, target.width, target.height); }
  const picOk = (now) => (pic === 'ndi' ? ndi.at && now - ndi.at < 2000 : video.videoWidth > 0 && video.readyState >= 2);
  const picSize = () => (pic === 'ndi' ? [ndiC.width, ndiC.height] : [video.videoWidth, video.videoHeight]);
  function videoFrame(now) {
    if (!picOk(now)) return;
    gctx.drawImage(pic === 'ndi' ? ndiC : video, 0, 0, SW, SH);
    let px; try { px = gctx.getImageData(0, 0, SW, SH).data; } catch (e) { return; }
    const wl = new Uint16Array(SW * 256), wr = new Uint16Array(SW * 256), wg = new Uint16Array(SW * 256), wb = new Uint16Array(SW * 256), vc = new Uint16Array(256 * 256);
    let sum = 0, clip = 0, crush = 0, sig = 0;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const yl = Math.round(Y);
      wl[x * 256 + yl]++; wr[x * 256 + r]++; wg[x * 256 + g]++; wb[x * 256 + b]++;
      sum += Y; if (Y >= 252) clip++; if (Y <= 3) crush++;
      if ((x & 15) === 0 && (y & 15) === 0) sig = (sig * 31 + yl) >>> 0;
      const cb = (b - Y) / 1.8556 / 255, cr = (r - Y) / 1.5748 / 255;
      const vx = Math.round(128 + cb * 240 * zoom), vy = Math.round(128 - cr * 240 * zoom);
      if (vx >= 0 && vx < 256 && vy >= 0 && vy < 256) vc[vy * 256 + vx]++;
    }
    const n = SW * SH;
    V.mean = sum / n / 255; V.clip = clip / n; V.crush = crush / n;
    if (V.mean < 0.03) { if (!V.blackSince) V.blackSince = now; } else V.blackSince = 0;
    if (String(sig) === V.sig) { if (!V.sameSince) V.sameSince = now; } else { V.sig = String(sig); V.sameSince = 0; }
    // waveform: brightness from how many pixels sit at that level in that column
    const put = (img, ox, arr, col) => { const d = img.data, w = img.width; for (let x = 0; x < SW; x++) for (let lv = 0; lv < 256; lv++) { const c = arr[x * 256 + lv]; const o = ((255 - lv) * w + ox + x) * 4; if (!c) { d[o + 3] = 0; continue; } const a = Math.min(255, 60 + Math.sqrt(c) * 70); d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = a; } };
    if (parade) { put(waveImg.p, 0, wr, [255, 80, 80]); put(waveImg.p, SW, wg, [80, 255, 120]); put(waveImg.p, SW * 2, wb, [90, 150, 255]); blit($('waveC'), waveImg.p); }
    else { put(waveImg.l, 0, wl, [140, 255, 190]); blit($('waveC'), waveImg.l); }
    const vd = vecImg.data;
    for (let i = 0; i < 256 * 256; i++) { const c = vc[i], o = i * 4; if (!c) { vd[o + 3] = 0; continue; } vd[o] = 170; vd[o + 1] = 255; vd[o + 2] = 200; vd[o + 3] = Math.min(255, 70 + Math.sqrt(c) * 60); }
    blit($('vecC'), vecImg);
    const [w, h] = picSize();
    if (w && h && (w !== V.w || h !== V.h)) { V.w = w; V.h = h; aspect(w, h); if (pic === 'video') $('nameF').textContent = `${w}×${h}`; }
  }
  // graticules: % lines on the waveform; targets and the skin-tone line on the vectorscope
  function sizeCanvas(c) { const r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); c.width = Math.max(10, Math.round(r.width * d)); c.height = Math.max(10, Math.round(r.height * d)); return d; }
  function grat() {
    for (const id of ['waveC', 'vecC', 'gonC']) sizeCanvas($(id));
    gon.g = null;
    const wg = $('waveG'), d = sizeCanvas(wg), g = wg.getContext('2d'), w = wg.width, h = wg.height;
    g.clearRect(0, 0, w, h); g.font = `${10 * d}px sans-serif`;
    for (const p of [0, 25, 50, 75, 100]) { const y = h - (p / 100) * (h - 1); g.strokeStyle = p === 0 || p === 100 ? 'rgba(255,90,90,.55)' : 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.fillStyle = '#777'; g.fillText(p + '', 4, Math.max(10 * d, y - 3)); }
    if (parade) { g.strokeStyle = 'rgba(255,255,255,.25)'; for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.moveTo(w * f, 0); g.lineTo(w * f, h); g.stroke(); } }
    const vg = $('vecG'), vd = sizeCanvas(vg), v = vg.getContext('2d'), W = vg.width, H = vg.height, cx = W / 2, cy = H / 2, s = Math.min(W, H) / 256;
    v.clearRect(0, 0, W, H); v.font = `${10 * vd}px sans-serif`;
    v.strokeStyle = 'rgba(255,255,255,.18)'; v.beginPath(); v.arc(cx, cy, 120 * s, 0, Math.PI * 2); v.moveTo(cx - 124 * s, cy); v.lineTo(cx + 124 * s, cy); v.moveTo(cx, cy - 124 * s); v.lineTo(cx, cy + 124 * s); v.stroke();
    const at = (r, g2, b) => { const Y = 0.2126 * r + 0.7152 * g2 + 0.0722 * b; return [cx + ((b - Y) / 1.8556) * 240 * zoom * s, cy - ((r - Y) / 1.5748) * 240 * zoom * s]; };
    for (const [nm, c] of [['R', [0.75, 0, 0]], ['Mg', [0.75, 0, 0.75]], ['B', [0, 0, 0.75]], ['Cy', [0, 0.75, 0.75]], ['G', [0, 0.75, 0]], ['Yl', [0.75, 0.75, 0]]]) {
      const [x, y] = at(...c), b = 7 * s;
      v.strokeStyle = 'rgba(255,200,61,.8)'; v.strokeRect(x - b, y - b, b * 2, b * 2); v.fillStyle = '#c9a23a'; v.fillText(nm, x + b + 2, y + 4);
    }
    const a = (123 * Math.PI) / 180; v.strokeStyle = 'rgba(255,170,120,.55)'; v.setLineDash([4 * s, 4 * s]); v.beginPath(); v.moveTo(cx, cy); v.lineTo(cx + Math.cos(a) * 124 * s, cy - Math.sin(a) * 124 * s); v.stroke(); v.setLineDash([]);
    overlay();
  }

  // ---------------------------------------------------------------- the monitor: overlays, name, tally, full screen
  const OV = Object.assign({ safe: false, cross: false, four3: false, name: true, tally: true, scopes: true }, store('ov') || {});
  const OVL = [['safe', 'Safe areas'], ['cross', 'Centre'], ['four3', '4:3'], ['name', 'Name'], ['tally', 'Tally'], ['scopes', 'Scopes']];
  function ovButtons() {
    $('ovbtns').replaceChildren(...OVL.map(([k, label]) => { const b = document.createElement('button'); b.className = 'sm' + (OV[k] ? ' on' : ''); b.textContent = label; b.title = 'Show / hide: ' + label; b.onclick = () => { OV[k] = !OV[k]; store('ov', OV); ovButtons(); applyOv(); }; return b; }));
  }
  function applyOv() { document.body.classList.toggle('no-scopes', !OV.scopes); $('name').hidden = !OV.name || !$('nameT').textContent; paintTally(); setTimeout(grat, 30); }
  // the picture frame: as big as fits in the monitor area, at the picture's own shape (overlays and tally follow it)
  let ratio = 16 / 9;
  function fit() {
    const b = $('picbox'), bw = b.clientWidth, bh = b.clientHeight;
    if (!bw || !bh) return;
    const w = Math.min(bw, bh * ratio), h = w / ratio;
    $('frame').style.width = Math.floor(w) + 'px'; $('frame').style.height = Math.floor(h) + 'px';
  }
  function aspect(w, h) { ratio = w / h || 16 / 9; fit(); setTimeout(overlay, 30); }
  function setName(t, f) { $('nameT').textContent = t || ''; $('nameF').textContent = f || ''; $('name').hidden = !OV.name || !t; }
  function overlay() {
    const c = $('ovl'), d = sizeCanvas(c), g = c.getContext('2d'), w = c.width, h = c.height;
    g.clearRect(0, 0, w, h); g.lineWidth = Math.max(1, d);
    const box = (f, col, dash) => { const bw = w * f, bh = h * f; g.strokeStyle = col; g.setLineDash(dash ? [6 * d, 5 * d] : []); g.strokeRect((w - bw) / 2, (h - bh) / 2, bw, bh); g.setLineDash([]); };
    if (OV.safe) { box(0.93, 'rgba(255,255,255,.55)', false); box(0.9, 'rgba(255,200,61,.7)', true); g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `${10 * d}px sans-serif`; g.fillText('action 93 %', w * 0.035 + 4, h * 0.035 + 12 * d); g.fillText('graphics 90 %', w * 0.05 + 4, h * 0.05 + 24 * d); }
    if (OV.four3) { const x = (w - h * (4 / 3)) / 2; if (x > 0) { g.strokeStyle = 'rgba(51,214,255,.6)'; g.setLineDash([3 * d, 4 * d]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.moveTo(w - x, 0); g.lineTo(w - x, h); g.stroke(); g.setLineDash([]); } }
    if (OV.cross) { const s = Math.min(w, h) * 0.04; g.strokeStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.moveTo(w / 2 - s, h / 2); g.lineTo(w / 2 + s, h / 2); g.moveTo(w / 2, h / 2 - s); g.lineTo(w / 2, h / 2 + s); g.stroke(); }
  }
  // tally: by hand, or from RFP Manager's live values (the ATEM's program / preview input); the NDI source hears it too
  const TY = Object.assign({ mode: 'off', state: '', url: WV ? 'http://localhost:8090' : location.origin, key: '', pgmVar: 'program', pvwVar: 'preview', value: '' }, store('tally') || {});
  let tally = '';
  function paintTally() {
    const t = OV.tally ? tally : '';
    $('frame').classList.toggle('tally-pgm', t === 'pgm'); $('frame').classList.toggle('tally-pvw', t === 'pvw');
    $('tallyTag').hidden = !t; $('tallyTag').className = t; $('tallyTag').textContent = t === 'pgm' ? 'ON AIR' : t === 'pvw' ? 'PREVIEW' : '';
    $('tallyBtn').classList.toggle('on', TY.mode !== 'off');
  }
  function setTally(t) { if (t === tally) return; tally = t; paintTally(); if (current.startsWith('ndi:')) post({ ndi: 'tally', program: t === 'pgm', preview: t === 'pvw' }); }
  let tallyKeys = [];
  async function pollTally() {
    if (TY.mode === 'manual') setTally(TY.state || '');
    else if (TY.mode === 'rfp' && TY.value !== '') {
      try {
        const v = await httpGet(TY.url.replace(/\/+$/, '') + '/live/api/companion/values' + (TY.key ? '?key=' + encodeURIComponent(TY.key) : ''));
        tallyKeys = Object.keys(v).filter((k) => /program|preview/i.test(k));
        const is = (k) => k && v[k] !== undefined && String(v[k]).trim().toLowerCase() === String(TY.value).trim().toLowerCase();
        setTally(is(TY.pgmVar) ? 'pgm' : is(TY.pvwVar) ? 'pvw' : '');
        TY.err = '';
      } catch (e) { TY.err = e.message; setTally(''); }
    } else setTally('');
    setTimeout(pollTally, TY.mode === 'rfp' ? 500 : 1000);
  }
  $('tallyBtn').onclick = () => {
    const old = document.querySelector('.pop'); if (old) { old.remove(); return; }
    const mk = (tag, attrs, ...kids) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); e.append(...kids); return e; };
    const mode = mk('select', {}, ...[['off', 'Off'], ['manual', 'By hand'], ['rfp', 'From RFP Manager (ATEM)']].map(([v, l]) => new Option(l, v))); mode.value = TY.mode;
    const url = mk('input', { value: TY.url, placeholder: 'http://localhost:8090' }), key = mk('input', { value: TY.key, placeholder: 'Screen key (not needed on this PC)' });
    const list = mk('datalist', { id: 'tkeys' }, ...tallyKeys.map((k) => new Option(k, k)));
    const pv = mk('input', { value: TY.pgmVar }), pw = mk('input', { value: TY.pvwVar }), val = mk('input', { value: TY.value, placeholder: 'e.g. 3 or Camera 3' });
    pv.setAttribute('list', 'tkeys'); pw.setAttribute('list', 'tkeys');
    const man = mk('div', { className: 'tools' }, ...[['pgm', 'On air'], ['pvw', 'Preview'], ['', 'Clear']].map(([s, l]) => mk('button', { className: 'sm' + (TY.state === s && TY.mode === 'manual' ? ' on' : ''), textContent: l, onclick: () => { TY.mode = 'manual'; TY.state = s; mode.value = 'manual'; save(); pop.remove(); } })));
    const lab = (t, el) => mk('label', {}, t, el);
    const rfp = mk('div', {}, lab('RFP Manager address', url), lab('Screen key', key), lab('Program variable', pv), lab('Preview variable', pw), lab('This source is input (value)', val), mk('div', { className: 'tools' }, TY.err ? 'Last try: ' + TY.err : 'Settings → Connections lists the ATEM; its values are program / preview (input numbers).'), list);
    const show = () => { rfp.hidden = mode.value !== 'rfp'; man.hidden = mode.value !== 'manual'; };
    const save = () => { Object.assign(TY, { mode: mode.value, url: url.value.trim(), key: key.value.trim(), pgmVar: pv.value.trim(), pvwVar: pw.value.trim(), value: val.value.trim() }); store('tally', TY); paintTally(); };
    mode.onchange = () => { show(); save(); };
    for (const e of [url, key, pv, pw, val]) e.onchange = save;
    const pop = mk('div', { className: 'pop' }, mk('b', { textContent: 'Tally' }), lab('Where the tally comes from', mode), man, rfp, mk('div', { className: 'tools', style: 'justify-content:flex-end' }, mk('button', { className: 'sm', textContent: 'Done', onclick: () => { save(); pop.remove(); } })));
    document.body.append(pop); show();
  };
  // the picture alone: double-click (again, or Esc, to come back)
  const full = (on) => { document.body.classList.toggle('pic-full', on); if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {}); setTimeout(grat, 60); };
  $('picbox').addEventListener('dblclick', () => full(!document.body.classList.contains('pic-full')));
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('pic-full')) { document.body.classList.remove('pic-full'); setTimeout(grat, 60); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('pic-full')) full(false); });
  new ResizeObserver(() => { fit(); grat(); }).observe(document.querySelector('main'));
  new ResizeObserver(() => { fit(); overlay(); }).observe($('picbox'));
  // the meter scale beside the peak bars
  // the meter standard: where green ends (alignment / reference level) and red starts (highest permitted peak); the
  // delivery limit for true peaks is −1 dBFS (EBU R128, streaming platforms)
  const STD = { ebu: { ref: -18, max: -9 }, smpte: { ref: -20, max: -10 }, stream: { ref: -18, max: -6 } };
  const TP = -1;
  let std = STD[store('meterStd')] ? store('meterStd') : 'stream';
  function meterScale() {
    const z = STD[std], pos = (d) => ((d + 60) / 60) * 100;
    for (const m of document.querySelectorAll('.mtr')) {
      m.style.setProperty('--g', pos(z.ref) + '%'); m.style.setProperty('--y', pos(z.max) + '%');
      m.querySelectorAll('i').forEach((x) => x.remove());
      for (const d of [z.ref, z.max, TP]) { const l = document.createElement('i'); l.style.bottom = pos(d) + '%'; m.append(l); }
    }
    const marks = [...new Set([TP, z.max, -12, z.ref, -24, -36, -48, -60])].sort((a, b) => b - a).filter((d, i, a) => i === 0 || Math.abs(d - a[i - 1]) >= 3 || [TP, z.max, z.ref].includes(d));
    $('scale').replaceChildren(...marks.map((d) => { const s = document.createElement('span'); s.textContent = d; s.className = d === z.ref ? 'ref' : d === z.max ? 'max' : d === TP ? 'tp' : ''; s.title = d === z.ref ? 'Alignment level (reference)' : d === z.max ? 'Highest permitted peak' : d === TP ? 'True-peak limit for delivery' : ''; s.style.bottom = pos(d) + '%'; return s; }));
  }
  $('meterStd').value = std;
  $('meterStd').onchange = () => { std = $('meterStd').value; store('meterStd', std); meterScale(); };
  meterScale();
  const zone = (d) => (!Number.isFinite(d) ? '' : d >= STD[std].max ? 'lvl-bad' : d >= STD[std].ref ? 'lvl-warn' : 'lvl-ok');
  // loudness against the target: within ±1 LU green, up to ±3 LU (or quieter by up to 5) yellow, beyond red
  const lzone = (v, t) => { if (!Number.isFinite(v)) return ''; const d = v - t; return Math.abs(d) <= 1 ? 'lvl-ok' : (d > 0 ? d <= 3 : d >= -5) ? 'lvl-warn' : 'lvl-bad'; };
  const setZone = (el, z) => { el.classList.remove('lvl-ok', 'lvl-warn', 'lvl-bad'); if (z) el.classList.add(z); };

  // ---------------------------------------------------------------- meters and the verdict
  const meterPos = (d) => clamp((d + 60) / 60, 0, 1);       // −60 … 0 dBFS
  function paint(now) {
    const t = Number($('target').value);
    for (const [i, s] of [[0, 'L'], [1, 'R']]) { $('p' + s).style.height = (1 - meterPos(A.peaks[i])) * 100 + '%'; setZone($('d' + s), zone(A.hold[i][0])); $('h' + s).style.bottom = meterPos(A.hold[i][0]) * 100 + '%'; $('d' + s).textContent = Number.isFinite(A.hold[i][0]) ? A.hold[i][0].toFixed(1) : '–'; }
    $('lM').textContent = Number.isFinite(A.M) ? A.M.toFixed(1) : '–';
    $('lS').textContent = Number.isFinite(A.S) ? A.S.toFixed(1) : '–'; $('lSv').textContent = Number.isFinite(A.S) ? fmt(A.S - t) + ' LU from target' : '';
    setZone($('lS'), lzone(A.S, t)); setZone($('lI'), lzone(A.I, t));
    $('lI').textContent = Number.isFinite(A.I) ? A.I.toFixed(1) : '–'; $('lIv').textContent = Number.isFinite(A.I) ? fmt(A.I - t) + ' LU from target' : '';
    $('lra').textContent = Number.isFinite(A.LRA) ? A.LRA.toFixed(1) + ' LU' : '–';
    $('corrN').textContent = Number.isFinite(A.corr) ? (A.corr >= 0 ? '+' : '') + A.corr.toFixed(2) : '–';
    $('corrB').style.left = (Number.isFinite(A.corr) ? (A.corr + 1) * 50 : 50) + '%';
    const mono = Number.isFinite(A.corr) && A.corr > 0.97;
    $('chs').textContent = !Number.isFinite(A.corr) ? '' : mono ? 'mono / dual mono' : 'stereo' + (Number.isFinite(A.balance) && Math.abs(A.balance) > 3 ? ` · ${A.balance > 0 ? 'left' : 'right'} +${Math.abs(A.balance).toFixed(1)} dB` : '');
    const avgCorr = A.wide.length ? A.wide.reduce((a, x) => a + x[1], 0) / A.wide.length : NaN;
    $('phaseNote').textContent = A.phaseBadSince ? 'Out of phase: one side is upside down (a cable or a phase-invert button).' : Number.isFinite(avgCorr) && avgCorr < 0.15 ? 'Very wide: may lose sound in mono (phones, TV speakers).' : '';
    // the checks
    const C = [];
    const hasV = picOk(now), hasA = !!chain && Number.isFinite(A.M);
    const [pw, ph] = picSize();
    C.push(['Signal', hasV || hasA ? 'ok' : 'bad', hasV ? `${pw}×${ph}` : 'nothing arriving']);
    C.push(['Picture', !hasV ? 'bad' : V.blackSince && now - V.blackSince > 2000 ? 'bad' : V.sameSince && now - V.sameSince > 5000 ? 'warn' : 'ok', !hasV ? 'no picture' : V.blackSince && now - V.blackSince > 2000 ? 'black' : V.sameSince && now - V.sameSince > 5000 ? 'frozen?' : 'moving']);
    C.push(['Video levels', !hasV ? 'warn' : V.clip > 0.02 ? 'warn' : V.crush > 0.25 ? 'warn' : 'ok', !hasV ? '–' : V.clip > 0.02 ? `whites clipping (${Math.round(V.clip * 100)} %)` : V.crush > 0.25 ? `blacks crushed (${Math.round(V.crush * 100)} %)` : 'in range']);
    const silent = !hasA || (A.silentSince && now - A.silentSince > 3000);
    C.push(['Sound', silent ? 'bad' : 'ok', silent ? 'no sound' : 'present']);
    C.push(['Peaks', now - A.clipAt < 3000 ? 'bad' : now - A.nearAt < 3000 ? 'warn' : 'ok', now - A.clipAt < 3000 ? `over ${TP} dBFS (limit)` : now - A.nearAt < 3000 ? `above ${STD[std].max} dBFS` : 'headroom']);
    const lv = Number.isFinite(A.S) && !silent ? A.S - t : NaN;
    C.push(['Loudness', !Number.isFinite(lv) ? 'warn' : lv > 2 ? 'warn' : lv < -5 ? 'warn' : 'ok', !Number.isFinite(lv) ? '–' : lv > 2 ? `too loud (${fmt(lv)} LU)` : lv < -5 ? `too quiet (${fmt(lv)} LU)` : `on target (${fmt(lv)} LU)`]);
    C.push(['Phase', A.phaseBadSince && now - A.phaseBadSince > 1000 ? 'bad' : Number.isFinite(avgCorr) && avgCorr < 0.15 ? 'warn' : 'ok', A.phaseBadSince && now - A.phaseBadSince > 1000 ? 'out of phase' : Number.isFinite(avgCorr) && avgCorr < 0.15 ? 'very wide' : mono ? 'mono' : Number.isFinite(A.corr) ? 'fine' : '–']);
    $('checks').replaceChildren(...C.map(([n, s, d]) => { const e = document.createElement('span'); e.className = 'chk ' + s; e.append(document.createElement('i'), n + ' ', Object.assign(document.createElement('small'), { textContent: d })); return e; }));
    const worst = C.some((x) => x[1] === 'bad') ? 'bad' : C.some((x) => x[1] === 'warn') ? 'warn' : 'ok';
    const vEl = $('verdict'); vEl.className = started ? worst : ''; vEl.textContent = !started ? 'PRESS START' : worst === 'ok' ? 'READY TO GO LIVE' : worst === 'warn' ? 'ALMOST: CHECK THE AMBER' : 'NOT READY';
  }
  // while an NDI source has not shown a picture yet: what the app says it is doing (stays on screen)
  function ndiWait(text) { const el = $('idle'); clearTimeout(msgT); el.hidden = false; el.style.color = ''; el.textContent = text; }
  let msgT = null;
  function say(text, kind) { const el = $('idle'); el.hidden = false; el.textContent = text; el.style.color = kind === 'bad' ? '#ff7a7a' : kind === 'warn' ? '#ffb648' : ''; clearTimeout(msgT); msgT = setTimeout(() => { el.hidden = true; }, kind === 'bad' ? 20000 : 8000); }

  let lastV = 0;
  function loop(now) {
    try { audioFrame(now); if (now - lastV > 80) { lastV = now; videoFrame(now); } paint(now); } catch (e) { console.error(e); }
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- start (browsers want a click before sound and inputs)
  async function start() {
    started = true;
    audio(); await ctx.resume().catch(() => {});
    await play($('src').value);
  }
  (async () => {
    ovButtons(); applyOv(); paintTally(); pollTally();
    await sources();
    $('src').onchange = () => { if (started) play($('src').value); showOpts(); };
    $('vdev').onchange = $('adev').onchange = () => { if (started && current === 'cap') play('cap'); };
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) devices();
    const go = document.createElement('button'); go.className = 'on'; go.textContent = '▶ Start'; go.onclick = () => { go.remove(); start(); };
    $('status').insertBefore(go, $('checks'));
    if (WV && q.get('autostart') === '1') {
      for (let i = 0; i < 40 && !ndi.list.length; i++) await new Promise((r) => setTimeout(r, 100));     // the first NDI list (≤ 4 s)
      await sources();
      if (!$('src').value.startsWith('ndi:') && ndi.list.length) $('src').value = 'ndi:' + ndi.list[0];
      showOpts();
      if ($('src').value.startsWith('ndi:')) { go.remove(); start(); }
      else say(ndi.problem || 'No NDI sources found yet. They appear in "Watch" as they are found; pick one (or a capture input) and press Start.', ndi.problem ? 'bad' : 'warn');
    }
    grat(); requestAnimationFrame(loop);
  })();
})();
