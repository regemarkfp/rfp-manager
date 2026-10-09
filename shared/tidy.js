/* RFP Manager – a calmer screen. Loaded by every page.
   1. Cards and panels fold: click a heading to close or open it. What you fold stays folded on this browser.
   2. Long explanations show as one line; click one to read all of it. */
(function () {
  'use strict';
  if (typeof document === 'undefined' || window.__rfpTidy) return;
  window.__rfpTidy = true;
  var page = (location.pathname.split('/').pop() || 'app').replace(/\.html$/, '') || 'app';
  // closed until opened the first time: reference lists and set-once settings
  var CLOSED = [/^tips$/, /^template triggers$/, /^graphics catalog/, /^in the folder$/, /^template folder on this pc$/, /^playout settings$/, /^names \(edit/, /^keyboard/, /^caspar ?cg connection/];
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not kept */ } } };
  var css = document.createElement('style');
  css.textContent = [
    '.fold-h{cursor:pointer;user-select:none}',
    '.fold-h::before{content:"\\25BE";display:inline-block;width:1.1em;opacity:.55;font-size:.85em}',
    '.is-folded>.fold-h::before,.is-folded>.spread>.fold-h::before{content:"\\25B8"}',
    '.is-folded>*:not(:first-child){display:none!important}',
    '.is-folded>.spread:first-child>*:not(.fold-h){display:none!important}',
    '.card.is-folded{padding-top:12px;padding-bottom:12px}.is-folded>.fold-h,.is-folded>.spread:first-child{margin-bottom:0!important}',
    '.clip-t{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;cursor:pointer}',
    '.clip-t.open{display:block}',
    '.clip-t:not(.open):hover{color:inherit;opacity:.95}'
  ].join('');
  (document.head || document.documentElement).appendChild(css);

  function titleOf(h) {
    var t = '';
    for (var i = 0; i < h.childNodes.length; i++) { var n = h.childNodes[i]; if (n.nodeType === 3) t += n.nodeValue; else if (n.nodeType === 1 && !/^(BUTTON|A|SELECT|INPUT|LABEL)$/.test(n.tagName) && !n.classList.contains('sp') && !n.classList.contains('badge')) t += n.textContent; }
    return t.replace(/\(\d+\)/g, '').replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
  }
  function boxOf(h) {
    var p = h.parentNode;
    if (!p) return null;
    if (p.classList && p.classList.contains('spread')) p = p.parentNode;
    if (!p || !p.classList || !(p.classList.contains('card') || p.classList.contains('panel'))) return null;
    var first = p.firstElementChild;
    return first === h || (first && first.classList.contains('spread') && first.contains(h)) ? p : null;
  }
  function apply() {
    var hs = document.querySelectorAll('.card > h2, .card > .spread > h2, .panel > h4');
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i], box = boxOf(h);
      if (!box || box.dataset.nofold !== undefined || box.closest('.modal, aside.right')) continue;
      var t = titleOf(h); if (!t) continue;
      h.classList.add('fold-h');
      var saved = store.get('rfp-fold:' + page + ':' + t);
      var want = saved === null ? CLOSED.some(function (re) { return re.test(t); }) : saved === '1';
      if (box.classList.contains('is-folded') !== want) box.classList.toggle('is-folded', want);
    }
    var ps = document.querySelectorAll('.help, .panel p.small.muted, .card > p.dim, .card p.help');
    for (var j = 0; j < ps.length; j++) {
      var p = ps[j];
      if (p.classList.contains('clip-t') || p.dataset.noclip !== undefined) continue;
      if ((p.textContent || '').length > 120 && !p.querySelector('input,select,button,textarea')) { p.classList.add('clip-t'); p.title = 'Click to read all of it'; }
    }
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var clip = t.closest('.clip-t');
    if (clip && !t.closest('a,button')) { clip.classList.toggle('open'); clip.title = clip.classList.contains('open') ? '' : 'Click to read all of it'; return; }
    var h = t.closest('.fold-h');
    if (!h || t.closest('button,a,input,select,textarea,label,details')) return;
    var box = boxOf(h); if (!box) return;
    var now = !box.classList.contains('is-folded');
    box.classList.toggle('is-folded', now);
    store.set('rfp-fold:' + page + ':' + titleOf(h), now ? '1' : '0');
  });
  var timer = null;
  function later() { clearTimeout(timer); timer = setTimeout(apply, 60); }
  function start() { apply(); new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
