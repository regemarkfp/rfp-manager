/* cgx.js – tiny CasparCG HTML template runtime used by the CricketCG reference templates.
 *
 * CasparCG calls the global functions update(data), play(), next(), stop().
 * `data` may be JSON  {"key":"value"}  or classic XML
 *   <templateData><componentData id="key"><data id="text" value="value"/></componentData></templateData>
 * Both are normalised into a flat object: CGX.data.key === "value".
 *
 * Declarative bindings (re-applied after every update):
 *   <span data-f="striker_name"></span>          text content
 *   <img data-src="logos/{bat_logo}.png">          src built from a pattern (hidden if a key is empty)
 *   <div data-show="free_hit"></div>               visible only when the key is non-empty
 *   <div data-hide="target"></div>                 hidden when the key is non-empty
 *   <div data-bg="bat_color1"></div>               background colour from a key
 *   <div data-color="bat_color2"></div>            text colour from a key
 *   <div data-css="--team:{bat_color1}"></div>     arbitrary CSS custom properties
 *
 * Animation: <body> gets class "cg-in" on play() and "cg-out" on stop().
 * Custom logic: CGX.on('update'|'play'|'stop'|'next', fn)
 *
 * Testing in a normal browser: open  template.html?demo  (uses window.CGX_DEMO data if the template defines it)
 * or pass data in the hash:  template.html#{"line1":"HELLO"}
 */
(function () {
  'use strict';
  var handlers = { update: [], play: [], stop: [], next: [] };

  var CGX = {
    data: {},
    playing: false,
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    fire: function (ev, arg) { (handlers[ev] || []).forEach(function (fn) { try { fn(arg, CGX.data); } catch (e) { console.error(e); } }); },

    parse: function (raw) {
      if (raw == null) return {};
      if (typeof raw === 'object') return raw;
      var s = String(raw).trim();
      if (!s) return {};
      if (s.charAt(0) === '{') {
        try { return JSON.parse(s); } catch (e) { console.error('cgx: bad JSON', e); return {}; }
      }
      if (s.charAt(0) === '<') {
        var out = {};
        try {
          var doc = new DOMParser().parseFromString(s, 'text/xml');
          var comps = doc.getElementsByTagName('componentData');
          for (var i = 0; i < comps.length; i++) {
            var id = comps[i].getAttribute('id');
            var d = comps[i].getElementsByTagName('data');
            var val = '';
            for (var j = 0; j < d.length; j++) if (d[j].getAttribute('id') === 'text' || j === 0) val = d[j].getAttribute('value') || '';
            out[id] = val;
          }
        } catch (e) { console.error('cgx: bad XML', e); }
        return out;
      }
      return {};
    },

    /** Replace {key} tokens with data values. */
    /** Logo / photo address: a full address is used as it is, a plain key means logos/KEY.png next to the template. */
    logo: function (k) { k = k == null ? '' : String(k); if (!k) return ''; return /[:\/]/.test(k) ? k : 'logos/' + encodeURIComponent(k) + '.png'; },

    fmt: function (pattern, data) {
      data = data || CGX.data;
      return String(pattern).replace(/\{([\w.-]+)\}/g, function (_, k) { return data[k] == null ? '' : data[k]; });
    },

    /** True if every {key} in the pattern has a value. */
    complete: function (pattern, data) {
      data = data || CGX.data;
      var ok = true;
      String(pattern).replace(/\{([\w.-]+)\}/g, function (_, k) { if (data[k] == null || data[k] === '') ok = false; return ''; });
      return ok;
    },

    v: function (k, def) { var x = CGX.data[k]; return x == null || x === '' ? (def == null ? '' : def) : x; },

    bind: function (root) {
      root = root || document;
      var d = CGX.data, i, el, k;
      var q = function (sel) { return root.querySelectorAll(sel); };
      var els = q('[data-f]');
      for (i = 0; i < els.length; i++) { el = els[i]; k = el.getAttribute('data-f'); var nv = d[k] == null ? '' : String(d[k]); if (el.textContent !== nv) el.textContent = nv; el.classList.toggle('cg-ml', nv.indexOf('\n') >= 0); }
      els = q('[data-src]');
      for (i = 0; i < els.length; i++) {
        el = els[i]; var p = el.getAttribute('data-src');
        if (CGX.complete(p)) {
          // RFP Manager sends logos and photos as full addresses (file:///… from this machine's image folder, or /media/…).
          var lm = /^logos\/\{([\w.-]+)\}\.png$/.exec(p);
          var src = lm ? CGX.logo(d[lm[1]]) : CGX.fmt(p);
          if (el.getAttribute('src') !== src) el.setAttribute('src', src); el.style.visibility = '';
        }
        else el.style.visibility = 'hidden';
      }
      els = q('[data-show]');
      for (i = 0; i < els.length; i++) { el = els[i]; k = el.getAttribute('data-show'); el.style.display = d[k] ? '' : 'none'; }
      els = q('[data-hide]');
      for (i = 0; i < els.length; i++) { el = els[i]; k = el.getAttribute('data-hide'); el.style.display = d[k] ? 'none' : ''; }
      els = q('[data-bg]');
      for (i = 0; i < els.length; i++) { el = els[i]; k = el.getAttribute('data-bg'); if (d[k]) el.style.background = d[k]; }
      els = q('[data-color]');
      for (i = 0; i < els.length; i++) { el = els[i]; k = el.getAttribute('data-color'); if (d[k]) el.style.color = d[k]; }
      els = q('[data-css]');
      for (i = 0; i < els.length; i++) {
        el = els[i];
        el.getAttribute('data-css').split(';').forEach(function (pair) {
          var ix = pair.indexOf(':'); if (ix < 0) return;
          var name = pair.slice(0, ix).trim(), val = CGX.fmt(pair.slice(ix + 1).trim());
          if (val) el.style.setProperty(name, val);
        });
      }
    },

    /** Shrink text to fit its box (call after update for long names). */
    fit: function (el, minPx) {
      if (!el) return;
      el.style.fontSize = '';
      var size = parseFloat(getComputedStyle(el).fontSize), min = minPx || 12;
      while (el.scrollWidth > el.clientWidth && size > min) { size -= 1; el.style.fontSize = size + 'px'; }
    },
  };

  // ------------------------------------------------------------ CasparCG entry points
  window.update = function (raw) {
    var d = CGX.parse(raw);
    CGX.data = d;
    CGX.bind();
    CGX.fire('update', d);
  };
  window.play = function () {
    CGX.playing = true;
    document.body.classList.remove('cg-out');
    // force reflow so the "in" transition always runs
    void document.body.offsetWidth;
    document.body.classList.add('cg-in');
    CGX.fire('play');
  };
  window.stop = function () {
    CGX.playing = false;
    document.body.classList.remove('cg-in');
    document.body.classList.add('cg-out');
    CGX.fire('stop');
  };
  window.next = function () { CGX.fire('next'); };
  window.remove = function () { };

  window.CGX = CGX;

  // ------------------------------------------------------------ browser testing
  window.addEventListener('load', function () {
    var h = decodeURIComponent((location.hash || '').slice(1));
    if (h && h.charAt(0) === '{') { window.update(h); window.play(); return; }
    if (/[?&]demo\b/.test(location.search) && window.CGX_DEMO) { window.update(window.CGX_DEMO); window.play(); }
  });
})();
