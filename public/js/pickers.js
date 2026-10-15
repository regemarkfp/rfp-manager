/* Date and time pickers for phones and tablets.
 * The phone's own date/time pop-up does not always open from a web page (it can take several taps, or not open at
 * all inside the app), so on touch screens every <input type="date|time|datetime-local"> opens this sheet instead:
 * a month calendar for dates, big hour and minute buttons for times. The field keeps its normal value format
 * (2026-10-17, 15:30, 2026-10-17T15:30) and fires input + change like a typed value. Mouse / desktop: unchanged. */
'use strict';
(() => {
  const coarse = () => window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (!coarse()) return;
  const TYPES = ['date', 'time', 'datetime-local'];
  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const css = document.createElement('style');
  css.textContent = `
  .rfp-pk-back { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.55); display: flex; align-items: flex-end; justify-content: center; }
  .rfp-pk { width: 100%; max-width: 440px; background: #1e1e1e; color: #f1f1f1; border-radius: 16px 16px 0 0; padding: 14px 14px calc(14px + env(safe-area-inset-bottom)); font: 15px/1.4 "Segoe UI", system-ui, sans-serif; box-shadow: 0 -8px 30px rgba(0,0,0,.5); }
  .rfp-pk .hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .rfp-pk .hd b { font-size: 17px; }
  .rfp-pk button { font: inherit; color: inherit; background: #2c2c2c; border: 0; border-radius: 10px; min-height: 44px; min-width: 44px; cursor: pointer; }
  .rfp-pk button.on { background: #00ff82; color: #0b0b0b; font-weight: 700; }
  .rfp-pk button.today { outline: 1px solid #00ff82; }
  .rfp-pk button.muted { background: transparent; color: #777; }
  .rfp-pk .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .rfp-pk .dow { text-align: center; color: #888; font-size: 12px; padding: 4px 0; }
  .rfp-pk .hours { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; }
  .rfp-pk .mins { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-top: 10px; }
  .rfp-pk .lbl { color: #999; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin: 10px 2px 6px; }
  .rfp-pk .ft { display: flex; gap: 8px; margin-top: 12px; } .rfp-pk .ft button { flex: 1; } .rfp-pk .ft .ok { background: #00ff82; color: #0b0b0b; font-weight: 700; }
  .rfp-pk .val { text-align: center; font-size: 26px; font-weight: 700; margin: 2px 0 4px; letter-spacing: .03em; }`;
  document.head.append(css);

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const btn = (text, cls, on) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', (e) => { e.preventDefault(); on(); }); return b; };

  function set(input, value) {
    const was = input.value;
    input.value = value;
    if (was !== value) { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  function open(input) {
    if (input.disabled || input.dataset.pkRo) return;
    const type = input.type === 'text' ? input.dataset.pk : input.type;
    const now = new Date();
    let v = String(input.value || '');
    let date = '', time = '';
    if (type === 'date') date = v;
    else if (type === 'time') time = v;
    else { [date, time] = v.split('T'); time = (time || '').slice(0, 5); }
    const d0 = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00') : now;
    let y = d0.getFullYear(), m = d0.getMonth();
    let hh = /^\d{2}:\d{2}/.test(time) ? Number(time.slice(0, 2)) : null, mm = /^\d{2}:\d{2}/.test(time) ? Number(time.slice(3, 5)) : null;
    let step = type === 'time' ? 'time' : 'date';

    const back = el('div', 'rfp-pk-back'), sheet = el('div', 'rfp-pk');
    back.append(sheet); document.body.append(back);
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const finish = () => {
      const t = hh === null ? '' : `${pad(hh)}:${pad(mm || 0)}`;
      if (type === 'date') set(input, date);
      else if (type === 'time') set(input, t);
      else set(input, date ? `${date}T${t || '00:00'}${input.step === '1' ? ':00' : ''}` : '');
      close();
    };

    function paintDate() {
      sheet.replaceChildren();
      const hd = el('div', 'hd');
      hd.append(btn('‹', '', () => { m--; if (m < 0) { m = 11; y--; } paintDate(); }), el('b', '', `${MONTHS[m]} ${y}`), btn('›', '', () => { m++; if (m > 11) { m = 0; y++; } paintDate(); }));
      const grid = el('div', 'grid');
      for (const w of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) grid.append(el('div', 'dow', w));
      const first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
      for (let i = 0; i < lead; i++) grid.append(el('div'));
      for (let d = 1; d <= days; d++) {
        const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
        grid.append(btn(String(d), (iso === date ? 'on' : '') + (iso === today ? ' today' : ''), () => { date = iso; if (type === 'date') finish(); else { step = 'time'; paint(); } }));
      }
      const ft = el('div', 'ft');
      ft.append(btn('Clear', '', () => { date = ''; hh = null; finish(); }), btn('Today', '', () => { date = today; if (type === 'date') finish(); else { step = 'time'; paint(); } }), btn('Cancel', '', close));
      sheet.append(hd, grid, ft);
    }
    function paintTime() {
      sheet.replaceChildren();
      const hd = el('div', 'hd');
      hd.append(type === 'datetime-local' ? btn('‹ Date', '', () => { step = 'date'; paint(); }) : el('span'), el('b', '', type === 'datetime-local' && date ? new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Time'), el('span'));
      const val = el('div', 'val', `${hh === null ? '--' : pad(hh)}:${mm === null ? '--' : pad(mm)}`);
      const hours = el('div', 'hours');
      for (let h = 0; h < 24; h++) hours.append(btn(pad(h), h === hh ? 'on' : '', () => { hh = h; if (mm === null) mm = 0; paintTime(); }));
      const mins = el('div', 'mins');
      for (let x = 0; x < 60; x += 5) mins.append(btn(':' + pad(x), x === mm ? 'on' : '', () => { mm = x; if (hh === null) hh = now.getHours(); paintTime(); }));
      const ft = el('div', 'ft');
      ft.append(btn('Clear', '', () => { hh = null; mm = null; if (type === 'time') finish(); else paintTime(); }), btn('Now', '', () => { hh = now.getHours(); mm = now.getMinutes(); if (type === 'datetime-local' && !date) date = today; finish(); }), btn('Done', 'ok', finish));
      sheet.append(hd, val, el('div', 'lbl', 'Hour'), hours, el('div', 'lbl', 'Minutes'), mins, ft);
    }
    const paint = () => (step === 'date' ? paintDate() : paintTime());
    paint();
  }

  // every date / time field: no keyboard, no phone pop-up; a tap opens the sheet
  function prep(input) {
    if (!input || input.dataset.pk !== undefined || !TYPES.includes(input.type)) return;
    if (input.readOnly) input.dataset.pkRo = '1';      // read-only on purpose: leave it closed
    input.dataset.pk = input.type;
    input.readOnly = true;
    input.setAttribute('inputmode', 'none');
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'INPUT') prep(node);
    else node.querySelectorAll && node.querySelectorAll('input[type=date],input[type=time],input[type="datetime-local"]').forEach(prep);
  }
  document.addEventListener('click', (e) => {
    const input = e.target && e.target.closest && e.target.closest('input[data-pk]');
    if (!input) return;
    e.preventDefault();
    open(input);
  }, true);
  const start = () => { scan(document.body); new MutationObserver((muts) => { for (const mu of muts) mu.addedNodes.forEach(scan); }).observe(document.body, { childList: true, subtree: true }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
