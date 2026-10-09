/* RFP Manager – advanced colour picker.
 * Every <input type="color"> on a page is upgraded automatically (also ones added later):
 * a swatch that opens a picker with a colour square, hue and transparency sliders, HEX, R G B A
 * and CSS (rgb()/rgba()/hsl()/names) fields, an eyedropper, recent colours and the match colours.
 * The input keeps working as before for the page's own code (its .value, 'input' and 'change'
 * events, data-* attributes); only its value can now carry transparency:
 *   fully opaque → "#rrggbb"   with transparency → "#rrggbbaa"   (CasparCG's Chromium understands both)
 * Add data-noalpha to an input that must stay opaque (e.g. the accent colour). */
(function (root) {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const h2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

  // ---------- parsing / formatting (also used on the server-free pages and in tests) ----------
  let ctx = null;
  function parse(v) {
    v = String(v == null ? '' : v).trim().toLowerCase();
    if (!v) return null;
    if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    let m = /^#?([0-9a-f]{3,4})$/.exec(v);
    if (m && v[0] === '#') { const s = m[1]; return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16), a: s[3] ? parseInt(s[3] + s[3], 16) / 255 : 1 }; }
    m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
    if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
    m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
    if (m) {
      const ch = (x) => (/%$/.test(x) ? parseFloat(x) * 2.55 : parseFloat(x));
      const a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return { r: clamp(ch(m[1]), 0, 255), g: clamp(ch(m[2]), 0, 255), b: clamp(ch(m[3]), 0, 255), a: clamp(a, 0, 1) };
    }
    // anything else the browser knows (names, hsl(), …)
    if (typeof document === 'undefined') return null;
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = '#010203'; ctx.fillStyle = v;
    const out = ctx.fillStyle;
    if (out === '#010203') return null;
    return out[0] === '#' ? parse(out) : parse(out.replace(/^rgba?/, 'rgba'));
  }
  function hex(c, noAlpha) {
    if (!c) return '';
    const base = '#' + h2(c.r) + h2(c.g) + h2(c.b);
    return noAlpha || c.a >= 0.999 ? base : base + h2(c.a * 255);
  }
  // any colour text → "#rrggbb" / "#rrggbbaa", or '' when it is not a colour
  const toHex = (v, noAlpha) => hex(parse(v), noAlpha);
  const rgba = (c) => (c.a >= 0.999 ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})` : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${+c.a.toFixed(2)})`);
  function toHsv({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (hh * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
  }
  function fromHsv(hh, s, v) {
    const f = (n) => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 };
  }

  const api = { parse, hex, toHex, rgba, toHsv, fromHsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;
  root.ColorPicker = api;

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const PRESETS = ['#ffffff', '#000000', '#808080', '#e53935', '#ff8a00', '#ffd600', '#00c853', '#00b8d4', '#2f6bff', '#7c4dff', '#ff4081', '#00000080', '#ffffff80', '#00000000'];
  let extra = []; // colours of the match etc. that a page can offer: ColorPicker.setSuggestions([{label, value}])
  api.setSuggestions = (list) => { extra = (list || []).filter((x) => x && parse(x.value)).slice(0, 24); };
  const remember = (v) => { if (!v) return; const r = store.get('rfp.cp.recent', []).filter((x) => x !== v); r.unshift(v); store.set('rfp.cp.recent', r.slice(0, 14)); };

  // ---------- styles ----------
  const CHECK = 'repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0 / 10px 10px';
  const css = `
  .cpx-sw{position:relative;display:inline-block;flex:none;width:44px;height:28px;min-width:28px;padding:0;border:1px solid var(--line2,#555);border-radius:6px;cursor:pointer;background:${CHECK};overflow:hidden;vertical-align:middle;box-sizing:border-box}
  .cpx-sw>i{position:absolute;inset:0;display:block}
  .cpx-sw:disabled{cursor:default;opacity:.5}
  .cpx-sw:focus-visible{outline:2px solid var(--accent,#2f6bff);outline-offset:1px}
  .cpx{position:fixed;z-index:100000;width:268px;padding:10px;border-radius:10px;background:var(--panel,#1d1f24);color:var(--text,#eee);border:1px solid var(--line2,#444);box-shadow:0 12px 40px rgba(0,0,0,.55);font:13px system-ui,sans-serif;box-sizing:border-box;user-select:none;-webkit-user-select:none}
  .cpx *{box-sizing:border-box}
  .cpx-sv{position:relative;height:150px;border-radius:6px;touch-action:none;cursor:crosshair}
  .cpx-sv::before{content:"";position:absolute;inset:0;border-radius:6px;background:linear-gradient(90deg,#fff,rgba(255,255,255,0))}
  .cpx-sv::after{content:"";position:absolute;inset:0;border-radius:6px;background:linear-gradient(0deg,#000,rgba(0,0,0,0))}
  .cpx-dot{position:absolute;z-index:2;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none}
  .cpx-row{display:flex;gap:8px;align-items:center;margin-top:8px}
  .cpx-bars{flex:1;display:flex;flex-direction:column;gap:8px}
  .cpx-bar{position:relative;height:14px;border-radius:7px;touch-action:none;cursor:ew-resize}
  .cpx-hue{background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
  .cpx-alpha{background:${CHECK}}
  .cpx-alpha>b{position:absolute;inset:0;border-radius:7px}
  .cpx-knob{position:absolute;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,.5);box-shadow:0 1px 4px rgba(0,0,0,.5);pointer-events:none}
  .cpx-prev{flex:none;width:40px;height:36px;border-radius:6px;background:${CHECK};overflow:hidden;display:flex;flex-direction:column;border:1px solid var(--line2,#444);cursor:pointer}
  .cpx-prev>i{flex:1}
  .cpx-f{display:grid;grid-template-columns:2.2fr 1fr 1fr 1fr 1fr;gap:4px;margin-top:8px}
  .cpx-f label{display:flex;flex-direction:column;gap:2px;font-size:10px;letter-spacing:.06em;color:var(--muted,#999);text-transform:uppercase;text-align:center}
  .cpx-f input,.cpx-css{width:100%;min-width:0;height:28px;padding:2px 4px;font:12px ui-monospace,Consolas,monospace;text-align:center;border-radius:5px;border:1px solid var(--line2,#444);background:var(--bg,#111);color:inherit}
  .cpx-css{margin-top:6px;text-align:left;padding:2px 6px}
  .cpx-sws{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
  .cpx-sws>button{width:20px;height:20px;padding:0;border-radius:4px;border:1px solid var(--line2,#444);background:${CHECK};position:relative;cursor:pointer;overflow:hidden}
  .cpx-sws>button>i{position:absolute;inset:0}
  .cpx-sws>span{width:100%;font-size:10px;color:var(--muted,#999);text-transform:uppercase;letter-spacing:.08em;margin-top:2px}
  .cpx-btns{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
  .cpx-btns button{flex:1;height:30px;border-radius:6px;border:1px solid var(--line2,#444);background:var(--panel2,#2a2d33);color:inherit;cursor:pointer;font-weight:600;font-size:12px;white-space:nowrap;padding:0 6px}
  .cpx-btns button.pri{background:var(--accent,#2f6bff);border-color:var(--accent,#2f6bff);color:var(--on-accent,#fff)}
  .cpx.noalpha .cpx-alpha,.cpx.noalpha .cpx-a,.cpx.noalpha .cpx-clear{display:none}
  .cpx.noalpha .cpx-f{grid-template-columns:2.2fr 1fr 1fr 1fr}
  @media (max-width:520px){.cpx{left:8px!important;right:8px!important;width:auto!important;top:auto!important;bottom:8px!important}.cpx-sv{height:170px}.cpx-bar{height:22px;border-radius:11px}.cpx-sws>button{width:26px;height:26px}}`;
  function addStyle() { if (document.getElementById('cpx-style')) return; const s = document.createElement('style'); s.id = 'cpx-style'; s.textContent = css; (document.head || document.documentElement).appendChild(s); }

  // ---------- upgrading the inputs ----------
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  function upgrade(input) {
    if (input.__cpx) { attach(input); return; }
    if (input.getAttribute('type') !== 'color') return;
    const pv = proto.get.call(input), start = pv && pv !== '#000000' ? pv : input.getAttribute('value') || pv || '#000000';
    input.__cpx = true; input.setAttribute('data-cpx', '');
    input.setAttribute('type', 'text'); // a real colour input can't hold transparency
    // the page's own code still sees a colour input
    Object.defineProperty(input, 'type', { configurable: true, get: () => 'color', set() {} });
    Object.defineProperty(input, 'value', { configurable: true, get() { return proto.get.call(this); }, set(v) { const t = toHex(v, input.hasAttribute('data-noalpha')); proto.set.call(this, t || (v === '' ? '' : proto.get.call(this))); paint(); } });
    proto.set.call(input, toHex(start, input.hasAttribute('data-noalpha')) || '#000000');
    const sw = document.createElement('button');
    sw.type = 'button'; sw.className = 'cpx-sw'; sw.innerHTML = '<i></i>';
    sw.title = input.title || input.getAttribute('aria-label') || 'Choose a colour';
    sw.setAttribute('aria-label', sw.title);
    // keep the size and the look the page gave the input
    const st = input.getAttribute('style') || '';
    if (st) sw.setAttribute('style', st.replace(/padding\s*:[^;]*;?/g, ''));
    if (!/width/.test(st)) sw.style.width = '44px';
    if (!/height/.test(st)) sw.style.height = '28px';
    input.style.display = 'none';
    input.__cpxSwatch = sw;
    function paint() { const c = parse(proto.get.call(input)); sw.firstChild.style.background = c ? rgba(c) : 'transparent'; sw.disabled = !!input.disabled; sw.title = (input.title || 'Choose a colour') + (c ? ' – ' + proto.get.call(input) : ''); }
    input.__cpxPaint = paint;
    paint();
    new MutationObserver(paint).observe(input, { attributes: true, attributeFilter: ['disabled', 'style'] });
    // a hidden input should hide its swatch too
    new MutationObserver(() => { sw.style.opacity = input.style.opacity; if (input.style.display !== 'none') { sw.style.display = input.style.display; input.style.display = 'none'; } }).observe(input, { attributes: true, attributeFilter: ['style'] });
    sw.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (!input.disabled && !input.readOnly) open(input, sw); });
    attach(input);
  }
  // the swatch sits right after its input (as soon as the input is in a page)
  function attach(input) { const sw = input.__cpxSwatch; if (sw && input.parentNode && input.nextSibling !== sw) input.insertAdjacentElement('afterend', sw); }
  // an input that becomes a colour input gets upgraded the moment code sets its value
  Object.defineProperty(HTMLInputElement.prototype, 'value', { configurable: true, enumerable: proto.enumerable, get: proto.get, set(v) { if (!this.__cpx && this.getAttribute('type') === 'color') { upgrade(this); this.value = v; return; } proto.set.call(this, v); } });
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'INPUT') { upgrade(node); return; }
    node.querySelectorAll && node.querySelectorAll('input[type="color"], input[data-cpx]').forEach(upgrade);
  }
  function cleanup(node) {
    if (!node || node.nodeType !== 1) return;
    const list = node.tagName === 'INPUT' ? [node] : node.querySelectorAll ? [...node.querySelectorAll('input')] : [];
    list.forEach((i) => { if (i.__cpxSwatch && !i.isConnected && i.__cpxSwatch.isConnected) i.__cpxSwatch.remove(); });
  }

  // ---------- the popover ----------
  let pop = null, cur = null; // cur: { input, sw, h, s, v, a, before }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function build() {
    pop = el('div', 'cpx');
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Colour picker');
    pop.innerHTML = `
      <div class="cpx-sv"><div class="cpx-dot"></div></div>
      <div class="cpx-row">
        <div class="cpx-bars"><div class="cpx-bar cpx-hue" title="Colour"><div class="cpx-knob"></div></div><div class="cpx-bar cpx-alpha" title="Transparency"><b></b><div class="cpx-knob"></div></div></div>
        <div class="cpx-prev" title="Top: new colour, bottom: before (click to go back)"><i class="n"></i><i class="o"></i></div>
      </div>
      <div class="cpx-f">
        <label>Hex<input data-f="hex" spellcheck="false" maxlength="9"></label>
        <label>R<input data-f="r" inputmode="numeric" maxlength="3"></label>
        <label>G<input data-f="g" inputmode="numeric" maxlength="3"></label>
        <label>B<input data-f="b" inputmode="numeric" maxlength="3"></label>
        <label class="cpx-a">A %<input data-f="a" inputmode="numeric" maxlength="3"></label>
      </div>
      <input class="cpx-css" data-f="css" spellcheck="false" title="Any CSS colour: rgb(), rgba(), hsl(), a name like orange…">
      <div class="cpx-sws"></div>
      <div class="cpx-btns"><button type="button" class="cpx-eye" title="Pick a colour from the screen">⌖ Pick</button><button type="button" class="cpx-clear" title="Fully transparent">Transparent</button><button type="button" class="cpx-cancel">Cancel</button><button type="button" class="pri cpx-ok">Done</button></div>`;
    document.body.appendChild(pop);
    const sv = pop.querySelector('.cpx-sv'), hue = pop.querySelector('.cpx-hue'), al = pop.querySelector('.cpx-alpha');
    drag(sv, (x, y) => { cur.s = x; cur.v = 1 - y; changed(); });
    drag(hue, (x) => { cur.h = x * 360; changed(); });
    drag(al, (x) => { cur.a = Math.round(x * 100) / 100; changed(); });
    pop.querySelectorAll('.cpx-f input, .cpx-css').forEach((i) => {
      i.addEventListener('input', () => typed(i));
      i.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { const f = i.dataset.f; if (/^[rgba]$/.test(f)) { e.preventDefault(); const max = f === 'a' ? 100 : 255; i.value = clamp((parseInt(i.value, 10) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, max); typed(i); } } });
      i.addEventListener('blur', () => sync(null));
    });
    pop.querySelector('.cpx-prev').addEventListener('click', () => setColor(parse(cur.before) || { r: 0, g: 0, b: 0, a: 1 }));
    pop.querySelector('.cpx-clear').addEventListener('click', () => { cur.a = 0; changed(); });
    pop.querySelector('.cpx-cancel').addEventListener('click', () => close(true));
    pop.querySelector('.cpx-ok').addEventListener('click', () => close(false));
    const eye = pop.querySelector('.cpx-eye');
    if (!('EyeDropper' in window)) eye.style.display = 'none';
    eye.addEventListener('click', async () => { try { const r = await new window.EyeDropper().open(); const c = parse(r.sRGBHex); if (c) { c.a = cur.a; setColor(c); } } catch (e) { /* cancelled */ } });
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } else if (e.key === 'Enter') { e.preventDefault(); close(false); } });
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.addEventListener('pointerdown', (e) => { if (cur && !pop.contains(e.target) && e.target !== cur.sw) close(false); }, true);
    window.addEventListener('resize', () => { if (cur) place(); });
  }
  function drag(area, fn) {
    const at = (e) => { const r = area.getBoundingClientRect(); fn(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)); };
    area.addEventListener('pointerdown', (e) => { e.preventDefault(); area.setPointerCapture(e.pointerId); at(e); const mv = (ev) => at(ev); const up = () => { area.removeEventListener('pointermove', mv); area.removeEventListener('pointerup', up); area.removeEventListener('pointercancel', up); }; area.addEventListener('pointermove', mv); area.addEventListener('pointerup', up); area.addEventListener('pointercancel', up); });
  }
  const color = () => Object.assign(fromHsv(cur.h, cur.s, cur.v), { a: cur.noAlpha ? 1 : cur.a });
  function setColor(c) { const hsv = toHsv(c); cur.h = hsv.s ? hsv.h : cur.h; cur.s = hsv.s; cur.v = hsv.v; cur.a = c.a; changed(); }
  function typed(i) {
    const f = i.dataset.f, c = color();
    if (f === 'hex') { const p = parse(i.value.trim()[0] === '#' ? i.value.trim() : '#' + i.value.trim()); if (p && /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(i.value.trim())) { setColor(p); sync(i); } return; }
    if (f === 'css') { const p = parse(i.value); if (p) { setColor(p); sync(i); } return; }
    const n = parseInt(i.value, 10); if (!Number.isFinite(n)) return;
    if (f === 'a') c.a = clamp(n, 0, 100) / 100; else c[f] = clamp(n, 0, 255);
    setColor(c); sync(i);
  }
  // paint the popover; `skip` is the field being typed in
  function sync(skip) {
    if (!cur) return;
    const c = color(), solid = rgba(Object.assign({}, c, { a: 1 }));
    pop.querySelector('.cpx-sv').style.background = `hsl(${cur.h}, 100%, 50%)`;
    Object.assign(pop.querySelector('.cpx-dot').style, { left: cur.s * 100 + '%', top: (1 - cur.v) * 100 + '%', background: solid });
    pop.querySelector('.cpx-hue .cpx-knob').style.left = (cur.h / 360) * 100 + '%';
    pop.querySelector('.cpx-alpha .cpx-knob').style.left = cur.a * 100 + '%';
    pop.querySelector('.cpx-alpha b').style.background = `linear-gradient(90deg, rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},0), ${solid})`;
    pop.querySelector('.cpx-prev .n').style.background = rgba(c);
    const set = (f, v) => { const i = pop.querySelector(`[data-f="${f}"]`); if (i !== skip) i.value = v; };
    set('hex', hex(c, cur.noAlpha)); set('r', Math.round(c.r)); set('g', Math.round(c.g)); set('b', Math.round(c.b)); set('a', Math.round(c.a * 100)); set('css', rgba(c));
  }
  function changed() {
    sync(document.activeElement && pop.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' ? document.activeElement : null);
    const v = hex(color(), cur.noAlpha);
    if (v !== proto.get.call(cur.input)) { proto.set.call(cur.input, v); cur.input.__cpxPaint(); cur.input.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  function swatches() {
    const box = pop.querySelector('.cpx-sws'); box.innerHTML = '';
    const add = (title, list) => {
      if (!list.length) return;
      box.appendChild(el('span', '', title));
      list.forEach((x) => { const v = typeof x === 'string' ? x : x.value, b = el('button', '', '<i></i>'); b.type = 'button'; b.title = (x.label ? x.label + ' – ' : '') + v; const c = parse(v); b.firstChild.style.background = c ? rgba(c) : ''; b.addEventListener('click', () => { const p = parse(v); if (p) { if (cur.noAlpha) p.a = 1; setColor(p); } }); box.appendChild(b); });
    };
    if (extra.length) add('This match', extra);
    add('Recent', store.get('rfp.cp.recent', []).filter((v) => parse(v)));
    add('Colours', PRESETS.filter((v) => !cur.noAlpha || v.length === 7));
  }
  function place() {
    if (window.innerWidth <= 520) return; // a sheet at the bottom of a phone (css)
    const r = cur.sw.getBoundingClientRect(), w = pop.offsetWidth, hh = pop.offsetHeight;
    let left = r.left, top = r.bottom + 6;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (top + hh > window.innerHeight - 8) top = Math.max(8, r.top - hh - 6);
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = top + 'px';
  }
  function open(input, sw) {
    if (cur) close(false);
    if (!pop) build();
    const before = proto.get.call(input), c = parse(before) || { r: 0, g: 0, b: 0, a: 1 }, hsv = toHsv(c);
    cur = { input, sw, h: hsv.h, s: hsv.s, v: hsv.v, a: c.a, before, noAlpha: input.hasAttribute('data-noalpha') };
    pop.classList.toggle('noalpha', cur.noAlpha);
    pop.querySelector('.cpx-prev .o').style.background = rgba(c);
    pop.style.display = 'block';
    swatches(); sync(null); place();
    const f = pop.querySelector('[data-f="hex"]'); if (window.matchMedia('(pointer: fine)').matches) { f.focus(); f.select(); }
  }
  function close(revert) {
    if (!cur) return;
    const { input, before } = cur;
    if (revert && proto.get.call(input) !== before) { proto.set.call(input, before); input.__cpxPaint(); input.dispatchEvent(new Event('input', { bubbles: true })); }
    const now = proto.get.call(input);
    cur = null; pop.style.display = 'none';
    if (now !== before) { remember(now); input.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  api.open = (input) => { if (input && input.__cpxSwatch) open(input, input.__cpxSwatch); };
  api.upgrade = scan;

  function boot() {
    addStyle(); scan(document.body);
    new MutationObserver((muts) => { for (const m of muts) { m.addedNodes.forEach(scan); m.removedNodes.forEach(cleanup); } }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})(typeof window !== 'undefined' ? window : globalThis);
