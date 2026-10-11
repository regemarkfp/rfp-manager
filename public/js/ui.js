/* Small DOM helpers and form widgets shared by every screen. */
'use strict';
// replaceChildren / append skip empty parts (null, undefined, false) instead of printing "null" on the page
for (const P of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ['replaceChildren', 'append']) {
    const orig = P[name];
    P[name] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); };
  }
}
const UI = (() => {
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => { if (c === undefined || c === null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
    kids.forEach(add);
    return el;
  }

  async function api(method, url, body, headers) {
    const opt = { method, headers: { 'x-rfp': '1', ...(headers || {}) } };
    if (body instanceof Blob || typeof body === 'string') opt.body = body;
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; }
    let res;
    try { res = await fetch(url, opt); } catch { throw new Error('Cannot reach the server'); }
    const isJson = (res.headers.get('content-type') || '').includes('json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) { const e = new Error((data && data.error) || `Request failed (${res.status})`); e.status = res.status; throw e; }
    return data;
  }

  function toast(text, kind) {
    const t = h('div', { class: 'toast' + (kind === 'error' ? ' error' : ''), role: 'status' }, text);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
  }
  const oops = (e) => toast(e.message || String(e), 'error');

  function modal({ title, body, actions = [], wide }) {
    const close = () => { veil.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' }, title ? h('h2', {}, title) : null, body,
      actions.length ? h('div', { class: 'actions' }, actions.map((a) => h('button', { class: a.primary ? 'primary' : a.danger ? 'danger' : '', onclick: async (ev) => {
        ev.target.disabled = true;
        try { if ((await (a.onClick ? a.onClick() : undefined)) !== false) close(); } catch (e) { oops(e); }
        ev.target.disabled = false;
      } }, a.label))) : null);
    const veil = h('div', { class: 'veil', onmousedown: (e) => { if (e.target === veil) close(); } }, box);
    document.body.append(veil);
    document.addEventListener('keydown', onKey);
    const first = box.querySelector('input, select, textarea, button');
    if (first) first.focus();
    return close;
  }
  const confirmBox = (text, label = 'Delete') => new Promise((resolve) => {
    let done = false;
    modal({ title: 'Are you sure?', body: h('p', {}, text), actions: [{ label: 'Cancel', onClick: () => { done = true; resolve(false); } }, { label, danger: true, onClick: () => { done = true; resolve(true); } }] });
    const iv = setInterval(() => { if (!document.querySelector('.veil')) { clearInterval(iv); if (!done) resolve(false); } }, 200);
  });
  const promptBox = (title, label, value = '') => new Promise((resolve) => {
    const input = h('input', { value });
    let done = false;
    const ok = () => { done = true; resolve(input.value.trim()); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { ok(); document.querySelector('.veil').remove(); } });
    modal({ title, body: h('label', { class: 'f' }, h('span', {}, label), input), actions: [{ label: 'Cancel', onClick: () => { done = true; resolve(''); } }, { label: 'OK', primary: true, onClick: ok }] });
    const iv = setInterval(() => { if (!document.querySelector('.veil')) { clearInterval(iv); if (!done) resolve(''); } }, 200);
  });

  // "orange" -> "#ffa500": colours are always stored as hex codes.
  function toHex(v, noAlpha) {
    if (window.ColorPicker) return window.ColorPicker.toHex(v, noAlpha); // "#rrggbb", or "#rrggbbaa" with transparency
    v = String(v || '').trim();
    if (!v) return '';
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = '#010203'; c.fillStyle = v;
    const out = c.fillStyle;
    if (out === '#010203' && v.toLowerCase() !== '#010203') return '';
    return /^#[0-9a-f]{6}$/i.test(out) ? out.toLowerCase() : '';
  }
  function contrast(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return '#0b0b0b';
    return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255 > 0.55 ? '#0b0b0b' : '#ffffff';
  }
  const esc = (s) => String(s === undefined || s === null ? '' : s);
  const fmtDate = (iso, opts) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || ''; return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opts || { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
  const today = () => new Date().toLocaleDateString('en-CA');
  const money = (n, cur) => { const v = Number(n) || 0; try { return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: cur || 'ZAR', maximumFractionDigits: v % 1 ? 2 : 0 }).format(v); } catch { return (cur || '') + ' ' + v.toLocaleString(); } };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  return { h, api, toast, oops, modal, confirmBox, promptBox, toHex, contrast, esc, fmtDate, today, money, debounce };
})();
