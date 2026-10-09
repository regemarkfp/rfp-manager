/* RFP Manager production templates runtime (advert, table, countdown). The match templates use lib/cgx.js.
   CasparCG calls update(data) / play() / stop() / next(); data arrives as JSON or as XML templateData.
   Bind data to the page with attributes:
     data-f="key"            text
     data-src="key"          image address (element is hidden while empty)
     data-show="key"         shown only when the value is not empty   (data-show="!key" for the opposite)
     data-bg="key"           background colour (add data-contrast to pick black or white text automatically)
     data-color="key"        text colour
     data-clock              running match clock        data-countdown   countdown timer
   <body> gets data-layout / data-kind from the data and the classes cg-in / cg-out for animation.
   Test in a browser:  template.html?demo   or   template.html#{"line1":"TEST"}                          */
(function () {
  'use strict';
  var state = {}, clock = null, count = null;

  function parse(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    raw = String(raw).trim();
    if (raw.charAt(0) === '{') { try { return JSON.parse(raw); } catch (e) { return {}; } }
    if (raw.charAt(0) === '<') {
      var out = {}, doc = new DOMParser().parseFromString(raw, 'text/xml');
      var nodes = doc.getElementsByTagName('componentData');
      for (var i = 0; i < nodes.length; i++) {
        var d = nodes[i].getElementsByTagName('data')[0];
        out[nodes[i].getAttribute('id')] = d ? d.getAttribute('value') || '' : '';
      }
      return out;
    }
    return {};
  }

  function contrast(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
    if (!m) return '#ffffff';
    var l = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
    return l > 0.6 ? '#111111' : '#ffffff';
  }
  var fmt = function (ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + two(m) + ':' + two(x) : two(Math.floor(s / 60)) + ':' + two(x);
  };
  var val = function (k) { return state[k] === undefined || state[k] === null ? '' : String(state[k]); };
  var each = function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };

  function bind() {
    var b = document.body, root = document.documentElement.style;
    b.setAttribute('data-layout', val('layout'));
    b.setAttribute('data-kind', val('kind'));
    [['--accent', 'accent'], ['--c1', 'color1'], ['--c2', 'color2'], ['--a1', 'teamA_color1'], ['--a2', 'teamA_color2'], ['--b1', 'teamB_color1'], ['--b2', 'teamB_color2']].forEach(function (p) {
      if (val(p[1])) root.setProperty(p[0], val(p[1]));
    });
    if (val('accent')) root.setProperty('--on-accent', contrast(val('accent')));
    each('[data-f]', function (el) { var v = val(el.getAttribute('data-f')); if (el.textContent !== v) el.textContent = v; el.classList.toggle('cg-ml', String(v).indexOf('\n') >= 0); });
    each('[data-src]', function (el) {
      var v = val(el.getAttribute('data-src'));
      if (v) { if (el.getAttribute('src') !== v) el.setAttribute('src', v); el.style.display = ''; } else { el.removeAttribute('src'); el.style.display = 'none'; }
    });
    each('[data-show]', function (el) {
      var k = el.getAttribute('data-show'), neg = k.charAt(0) === '!';
      var on = !!val(neg ? k.slice(1) : k);
      el.style.display = (neg ? !on : on) ? '' : 'none';
    });
    each('[data-bg]', function (el) { var v = val(el.getAttribute('data-bg')); if (v) { el.style.background = v; if (el.hasAttribute('data-contrast')) el.style.color = contrast(v); } });
    each('[data-color]', function (el) { var v = val(el.getAttribute('data-color')); if (v) el.style.color = v; });
    if (typeof window.onCgData === 'function') window.onCgData(state, { contrast: contrast, fmt: fmt });
  }

  function tick() {
    var now = Date.now();
    if (clock) {
      var e = clock.running ? now - clock.at : 0;
      var ms = clock.dir === 'down' ? Math.max(0, clock.ms - e) : clock.ms + e;
      each('[data-clock]', function (el) { var t = fmt(ms); if (el.textContent !== t) el.textContent = t; });
    }
    if (count) each('[data-countdown]', function (el) { var t = fmt(Math.max(0, count.ms - (now - count.at)) + 999); if (el.textContent !== t) el.textContent = t; });
  }

  window.update = function (raw) {
    var d = parse(raw);
    for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) state[k] = d[k];
    if (d.clock_ms !== undefined) clock = { ms: Number(d.clock_ms) || 0, at: Date.now(), running: !!val('clock_running'), dir: val('clock_dir') || 'up' };
    if (d.countdown_ms !== undefined) count = { ms: Number(d.countdown_ms) || 0, at: Date.now() };
    bind(); tick();
  };
  window.play = function () { document.body.classList.remove('cg-out'); void document.body.offsetWidth; document.body.classList.add('cg-in'); };
  window.stop = function () { document.body.classList.remove('cg-in'); document.body.classList.add('cg-out'); };
  window.next = function () { if (typeof window.onCgNext === 'function') window.onCgNext(state); };
  window.cgState = state;
  setInterval(tick, 200);

  function fromAddress() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (h.charAt(0) === '{' || h.charAt(0) === '<') { window.update(h); window.play(); }
    else if (/[?&]demo/.test(location.search) && window.CG_DEMO) { window.update(window.CG_DEMO); window.play(); }
  }
  document.addEventListener('DOMContentLoaded', fromAddress);
  window.addEventListener('hashchange', fromAddress);
})();
