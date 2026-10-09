/* cgx-lottie.js – drive a LottieFiles / Bodymovin animation as a CasparCG template.
 *
 * Text:   name a text layer exactly like a data key (e.g. "striker_name") and it is replaced live.
 *         A layer name containing {placeholders} is formatted, e.g. "{runs}-{wickets}" or "{bowler_figures} ({bowler_overs})".
 *         Layers whose name starts with "#" are ignored.
 * Markers (optional, add them in After Effects / LottieFiles):
 *         "in"   played on play()          "loop"  looped after "in" finishes
 *         "out"  played on stop()          "next"  played on next()
 *         No markers: play() plays the whole animation, stop() plays it backwards.
 * Config: set window.LOTTIE_CONFIG before this script (see lottie-template.html).
 */
(function () {
  'use strict';
  var cfg = window.LOTTIE_CONFIG || {};
  var anim = null, ready = false, markers = {}, pending = [];
  var textLayers = [];   // { el, name }
  var container = document.getElementById(cfg.container || 'lottie');

  function fail(msg) {
    console.error('cgx-lottie:', msg);
    var d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:40px;top:40px;background:#8e1f24;color:#fff;font:28px Arial;padding:12px 18px;border-radius:6px';
    d.textContent = 'Lottie template error: ' + msg;
    document.body.appendChild(d);
  }

  function loadData(cb) {
    if (window.LOTTIE_DATA) return cb(window.LOTTIE_DATA);
    var src = cfg.animation || '';
    if (!src) return fail('LOTTIE_CONFIG.animation is not set');
    if (/\.js(\?|$)/i.test(src)) {
      // .js wrapper (window.LOTTIE_DATA = {...}) works from file:// inside CasparCG
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { window.LOTTIE_DATA ? cb(window.LOTTIE_DATA) : fail(src + ' did not set window.LOTTIE_DATA'); };
      s.onerror = function () { fail('could not load ' + src); };
      document.head.appendChild(s);
    } else {
      fetch(src).then(function (r) { return r.json(); }).then(cb).catch(function (e) {
        fail('could not fetch ' + src + ' (' + e.message + '). From file:// use the .js wrapper instead.');
      });
    }
  }

  function readMarkers(data) {
    (data.markers || []).forEach(function (m) {
      var name = m.cm;
      try { var j = JSON.parse(m.cm); if (j && j.name) name = j.name; } catch (e) { /* plain string */ }
      markers[String(name).toLowerCase()] = [m.tm, m.tm + (m.dr || 0)];
    });
  }

  function collectText(elements) {
    (elements || []).forEach(function (el) {
      if (!el || !el.data) return;
      if (el.data.ty === 5 && el.data.nm && el.data.nm.charAt(0) !== '#') textLayers.push({ el: el, name: el.data.nm });
      if (el.elements) collectText(el.elements);
    });
  }

  function applyText(d) {
    textLayers.forEach(function (t) {
      var name = t.name, val;
      if (cfg.map && cfg.map[name]) name = cfg.map[name];
      if (name.indexOf('{') >= 0) val = CGX.fmt(name, d);
      else if (Object.prototype.hasOwnProperty.call(d, name)) val = d[name];
      else return;
      val = String(val == null ? '' : val);
      if (t.last === val) return;
      t.last = val;
      try { t.el.updateDocumentData({ t: val }, 0); } catch (e) { console.warn('text update failed for', t.name, e); }
    });
  }

  function whenReady(fn) { if (ready) fn(); else pending.push(fn); }

  if (!window.lottie) { fail('lottie.min.js not found – copy it into templates/cricketcg/lib/'); return; }
  if (!container) { fail('no #lottie container'); return; }

  loadData(function (data) {
    readMarkers(data);
    anim = lottie.loadAnimation({
      container: container,
      renderer: cfg.renderer || 'svg',
      loop: false,
      autoplay: false,
      animationData: data,
      assetsPath: cfg.assetsPath || 'lottie/images/',
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false },
    });
    anim.addEventListener('DOMLoaded', function () {
      collectText(anim.renderer.elements);
      anim.goToAndStop(0, true);
      ready = true;
      pending.splice(0).forEach(function (fn) { fn(); });
    });
  });

  function playIn() {
    anim.setDirection(1);
    if (markers['in']) {
      anim.playSegments(markers['in'], true);
      if (markers['loop']) {
        var onDone = function () {
          anim.removeEventListener('complete', onDone);
          anim.loop = true;
          anim.playSegments(markers['loop'], true);
        };
        anim.addEventListener('complete', onDone);
      }
    } else {
      var end = markers['out'] ? markers['out'][0] : anim.totalFrames;
      anim.playSegments([0, end], true);
    }
  }

  function playOut() {
    anim.loop = false;
    if (markers['out']) { anim.setDirection(1); anim.playSegments(markers['out'], true); }
    else { anim.setDirection(-1); anim.play(); }
  }

  CGX.on('update', function (d) { whenReady(function () { applyText(d); }); });
  CGX.on('play', function () { whenReady(function () { applyText(CGX.data); playIn(); }); });
  CGX.on('stop', function () { whenReady(playOut); });
  CGX.on('next', function () { whenReady(function () { if (markers['next']) { anim.loop = false; anim.playSegments(markers['next'], true); } }); });
})();
