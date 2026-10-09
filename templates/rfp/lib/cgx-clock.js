/* cgx-clock.js – makes clocks tick inside a template between data updates.
 * The server sends <prefix>_ms, <prefix>_running, <prefix>_dir, <prefix>_limit_ms (prefix "clock" or "shot")
 * and sinbinN_ms. Elements:
 *   <span data-clock="clock"></span>          mm:ss
 *   <span data-clock="shot" data-tenths></span> shows s.t under 10 s (shot clock) / under 60 s with data-tenths="60"
 *   <span data-sinbin="1"></span>             remaining sin-bin time for sin-bin #1 (ticks with the game clock)
 */
(function () {
  'use strict';
  let snap = { at: 0, d: {} };
  const num = v => (v === undefined || v === '' ? 0 : +v);

  function value(prefix) {
    const d = snap.d, base = num(d[prefix + '_ms']);
    if (!d[prefix + '_running']) return base;
    const dir = num(d[prefix + '_dir']) || 1, lim = num(d[prefix + '_limit_ms']);
    let v = base + dir * (performance.now() - snap.at);
    if (dir < 0) v = Math.max(0, v);
    else if (lim > 0 && d[prefix + '_stop_at_limit']) v = Math.min(v, lim);
    return Math.max(0, v);
  }
  function fmt(ms, tenthsUnder) {
    if (tenthsUnder && ms < tenthsUnder * 1000) return (Math.floor(ms / 100) / 10).toFixed(1);
    const t = Math.floor(ms / 1000);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }
  function sinbin(i) {
    const d = snap.d, left = num(d['sinbin' + i + '_ms']);
    if (!d.clock_running) return left;
    // sin-bins run with the game clock (same speed either direction)
    return Math.max(0, left - (performance.now() - snap.at));
  }
  function tick() {
    document.querySelectorAll('[data-clock]').forEach(el => {
      const p = el.getAttribute('data-clock');
      const t = el.hasAttribute('data-tenths') ? (+el.getAttribute('data-tenths') || 10) : 0;
      const s = fmt(value(p), t);
      if (el.textContent !== s) el.textContent = s;
    });
    document.querySelectorAll('[data-sinbin]').forEach(el => {
      const ms = sinbin(el.getAttribute('data-sinbin'));
      const s = fmt(ms);
      if (el.textContent !== s) el.textContent = s;
      const box = el.closest('[data-sinbin-box]');
      if (box) box.style.display = ms > 0 ? '' : 'none';
    });
  }
  if (window.CGX) CGX.on('update', d => { snap = { at: performance.now(), d }; tick(); });
  setInterval(tick, 100);
  window.CGXClock = { value, fmt, tick };
})();
