/* Media for our player (player.js) besides a plain <video>:
 *   RFPMedia.youtube(host, id, { start }) → a stand-in for a <video> element that drives YouTube's player inside host
 *     (YouTube's own controls off; our bar on top). It has what player.js uses: paused, currentTime, duration, volume,
 *     muted, playbackRate, buffered, play(), pause(), and the events play / pause / timeupdate / volumechange /
 *     durationchange / loadedmetadata / progress / ended / waiting / playing / click / dblclick.
 *   RFPMedia.hls(video, url, token) → plays an HLS stream (live) in a <video>: Safari itself, elsewhere hls.js.
 * YouTube still decides about its adverts and may show its logo for a moment; that is YouTube's rule for embedding. */
'use strict';
(() => {
  let apiReady = null;
  function loadApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (apiReady) return apiReady;
    apiReady = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) { /* theirs */ } resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { apiReady = null; reject(new Error('YouTube could not be reached')); };
      document.head.append(s);
    });
    return apiReady;
  }

  function youtube(host, id, opts = {}) {
    const media = new EventTarget();
    const fire = (t) => media.dispatchEvent(new Event(t));
    const box = document.createElement('div');
    box.className = 'yt-box';
    const slot = document.createElement('div');
    // a clear sheet over YouTube's picture: clicks reach our player (play / pause, double-click for full screen), not YouTube's
    const sheet = document.createElement('div');
    sheet.className = 'yt-sheet';
    sheet.addEventListener('click', () => fire('click'));
    sheet.addEventListener('dblclick', () => fire('dblclick'));
    box.append(slot, sheet);
    host.append(box);
    let p = null, state = -1, tick = null, vol = 1, mute = false, rate = 1, wantPlay = false, ready = false, lastDur = 0, err = '', cc = false;
    const waiters = [];
    // YouTube's player did not come (a blocked network or an ad blocker, or the owner forbids it): say so, with a way out
    const failed = (msg) => {
      if (box.querySelector('.yt-fail')) return;
      const f = document.createElement('div'); f.className = 'yt-fail';
      const b = document.createElement('b'); b.textContent = msg || 'YouTube did not load here';
      const t = document.createElement('p'); t.textContent = 'Something on this network or in this browser (an ad blocker, a VPN or filtering DNS) may be blocking YouTube.';
      const a = document.createElement('a'); a.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(id); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Watch it on YouTube ↗';
      f.append(b, t, a); box.append(f);
    };
    const giveUp = setTimeout(() => { if (!ready) failed(); }, 12000);
    const ST = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
    const startTick = () => { if (!tick) tick = setInterval(() => { if (!box.isConnected) { destroy(); return; } fire('timeupdate'); fire('progress'); const d = p && p.getDuration ? p.getDuration() : 0; if (d && d !== lastDur) { lastDur = d; fire('durationchange'); } }, 250); };
    loadApi().then(() => {
      p = new window.YT.Player(slot, {
        host: 'https://www.youtube.com', videoId: id, width: '100%', height: '100%',
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, cc_load_policy: 0, start: Math.floor(opts.start || 0), origin: location.origin },
        events: {
          onReady: () => {
            ready = true; clearTimeout(giveUp);
            p.setVolume(Math.round(vol * 100)); if (mute) p.mute(); else p.unMute();
            if (rate !== 1) p.setPlaybackRate(rate);
            lastDur = p.getDuration() || 0;
            fire('loadedmetadata'); fire('durationchange'); fire('volumechange'); startTick();
            if (wantPlay) p.playVideo();
            applyCc(); setTimeout(applyCc, 1500);
          },
          // YouTube loads its captions module by itself (the viewer's YouTube setting, or the owner's): keep our choice
          onApiChange: () => applyCc(),
          onStateChange: (e) => {
            state = e.data;
            if (state === ST.PLAYING) { fire('play'); fire('playing'); waiters.splice(0).forEach((w) => w.ok()); if (!ccApplied) { ccApplied = true; applyCc(); setTimeout(applyCc, 1200); } }
            else if (state === ST.PAUSED) fire('pause');
            else if (state === ST.BUFFERING) fire('waiting');
            else if (state === ST.ENDED) { fire('pause'); fire('ended'); }
          },
          onError: (e) => { err = ({ 2: 'Bad video id', 5: 'This video cannot play here', 100: 'This video was removed or is private', 101: 'Its owner does not allow it on other websites', 150: 'Its owner does not allow it on other websites' })[e.data] || 'YouTube could not play it'; failed(err); fire('error'); },
        },
      });
    }).catch((e) => { err = e.message; clearTimeout(giveUp); failed(err); fire('error'); });
    function destroy() { clearTimeout(giveUp); clearInterval(tick); tick = null; try { if (p && p.destroy) p.destroy(); } catch (e) { /* gone */ } }
    Object.defineProperties(media, {
      paused: { get: () => state !== ST.PLAYING && state !== ST.BUFFERING },
      ended: { get: () => state === ST.ENDED },
      currentTime: { get: () => (p && ready ? p.getCurrentTime() : opts.start || 0), set: (t) => { if (p && ready) { p.seekTo(Math.max(0, t), true); fire('timeupdate'); } } },
      duration: { get: () => { const d = p && ready ? p.getDuration() : 0; return d > 0 ? d : NaN; } },
      volume: { get: () => vol, set: (v) => { vol = Math.min(1, Math.max(0, Number(v) || 0)); if (p && ready) p.setVolume(Math.round(vol * 100)); fire('volumechange'); } },
      muted: { get: () => mute, set: (m) => { mute = !!m; if (p && ready) { if (mute) p.mute(); else p.unMute(); } fire('volumechange'); } },
      playbackRate: { get: () => rate, set: (r) => { rate = Number(r) || 1; if (p && ready) p.setPlaybackRate(rate); fire('ratechange'); } },
      buffered: { get: () => { const d = p && ready ? p.getDuration() : 0, f = p && ready && p.getVideoLoadedFraction ? p.getVideoLoadedFraction() : 0; return { length: d ? 1 : 0, start: () => 0, end: () => f * d }; } },
      readyState: { get: () => (ready ? 4 : 0) },
      isConnected: { get: () => box.isConnected },
      error: { get: () => err },
      videoWidth: { get: () => (ready ? 1920 : 0) },
    });
    // play(): resolves once it plays; a browser that will not start with sound gets NotAllowedError (then: muted, as with <video>)
    media.play = () => new Promise((ok, no) => {
      wantPlay = true;
      if (p && ready) p.playVideo();
      const w = { ok };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0 && !(state === ST.PLAYING || state === ST.BUFFERING)) { waiters.splice(i, 1); const e = new Error('Autoplay with sound was refused'); e.name = mute ? 'AbortError' : 'NotAllowedError'; no(e); } }, ready ? 2500 : 6000);
    });
    // YouTube's own captions (the video's, or YouTube's automatic ones) on or off
    // off means off: the track is cleared and the module unloaded, again whenever YouTube brings it back
    let ccApplied = false;
    function applyCc() {
      if (!p || !ready) return;
      try {
        if (cc) { p.loadModule('captions'); p.setOption('captions', 'track', { languageCode: (navigator.language || 'en').slice(0, 2) }); }
        else { try { p.setOption('captions', 'track', {}); } catch (e) { /* no captions */ } try { p.unloadModule('captions'); } catch (e) { /* not loaded */ } try { p.unloadModule('cc'); } catch (e) { /* older name */ } }
      } catch (e) { /* not for this video */ }
    }
    media.captions = (on) => { cc = !!on; applyCc(); };
    media.pause = () => { wantPlay = false; if (p && ready) p.pauseVideo(); };
    media.destroy = () => { destroy(); box.remove(); };
    media.el = box;
    return media;
  }

  function hls(video, url, token) {
    const tok = (u) => (token ? u + (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : u);
    const canNative = !!video.canPlayType('application/vnd.apple.mpegurl');
    const apple = /Apple/.test(navigator.vendor || '') && canNative;
    if (apple || (canNative && !(window.Hls && window.Hls.isSupported()))) { video.src = tok(url); return { destroy: () => { video.removeAttribute('src'); video.load(); } }; }
    if (window.Hls && window.Hls.isSupported()) {
      const h = new window.Hls({ enableWorker: false, lowLatencyMode: true, liveSyncDurationCount: 3, manifestLoadingMaxRetry: 20, manifestLoadingRetryDelay: 1500,
        xhrSetup: (xhr, u) => { if (token && !/[?&]token=/.test(u)) xhr.open('GET', tok(u), true); } });
      h.loadSource(tok(url)); h.attachMedia(video);
      return { destroy: () => { try { h.destroy(); } catch (e) { /* gone */ } } };
    }
    return null;
  }
  window.RFPMedia = { youtube, hls };
})();
