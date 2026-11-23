/* The live look of the Universe and File Sharing (1.9.0), after Blackmagic's Cloud Store screen, in RFP colours:
 *   RFPCS.hexMap(box)      a grid of RFP slants for storage: used cells green (a shade per folder), free cells dark,
 *                          cells of files being written light cyan and read light yellow; hover names the folder/file
 *   RFPCS.graph(box, opts) a small area graph of two lines (in cyan, out yellow) over the last minute
 *   RFPCS.spark(hist)      a tiny inline version for lists
 *   RFPCS.rate(n), bytes(n), bits(n)
 * Plain browser JavaScript, no libraries; used by /js/super.js and /sharing/sharing.js. */
'use strict';
(() => {
  const C = { used: ['#00ff82', '#00d96f', '#2bffa0', '#00b85e', '#5cffb6', '#00a053'], free: '#232323', freeEdge: '#2e2e2e', in: '#33d6ff', out: '#ffc83d', grid: '#2a2a2a', dim: '#7c7c7c' };
  const bytes = (n) => { n = Number(n) || 0; return n >= 1e12 ? (n / 1e12).toFixed(n >= 1e13 ? 1 : 2) + ' TB' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B'; };
  // a speed in bytes per second, shown the network way (Mb/s, Gb/s) or as MB/s
  const bits = (bps) => { bps = Number(bps) || 0; return bps >= 1e9 ? (bps / 1e9).toFixed(2) + ' Gb/s' : bps >= 1e6 ? (bps / 1e6).toFixed(bps >= 1e8 ? 0 : 1) + ' Mb/s' : bps >= 1e3 ? Math.round(bps / 1e3) + ' kb/s' : Math.round(bps) + ' b/s'; };
  const rate = (Bps) => { Bps = Number(Bps) || 0; return Bps >= 1e9 ? (Bps / 1e9).toFixed(2) + ' GB/s' : Bps >= 1e6 ? (Bps / 1e6).toFixed(1) + ' MB/s' : Bps >= 1e3 ? Math.round(Bps / 1e3) + ' KB/s' : Math.round(Bps) + ' B/s'; };
  const num = (Bps, unit = 'MB') => { const d = unit === 'Mb' ? 1e6 / 8 : 1e6; const v = (Number(Bps) || 0) / d; return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2); };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

  // ---------------------------------------------------------------- the storage map: a grid of RFP slants
  // set({ total, segments: [{ key, name, size, sub }], hot: [{ h, kind } | { key, kind }], cell }) – segments fill the used
  // cells column by column from the left (as the Cloud Store does), the free space stays dark on the right
  function hexMap(box, opts = {}) {
    const wrap = document.createElement('div'); wrap.className = 'cs-map';
    const cv = document.createElement('canvas'), tip = document.createElement('div'); tip.className = 'cs-tip'; tip.hidden = true;
    wrap.append(cv, tip); box.append(wrap);
    let data = { total: 0, segments: [], hot: [] }, cells = [], geo = null, lit = new Map(), raf = 0;
    // a cell: a slanted slab like the RFP buttons, taller than wide; r sets the size
    const R = () => opts.r || (innerWidth < 700 ? 5.5 : 7);
    function layout() {
      const w = wrap.clientWidth, h = wrap.clientHeight || 200, r = R();
      const cw = r * 1.5, ch = r * 1.9, gap = Math.max(2, r * 0.32), dx = cw + gap, dy = ch + Math.max(3, r * 0.6);
      const cols = Math.max(4, Math.floor((w - ch * 0.3 - 4) / dx)), rows = Math.max(2, Math.floor((h - 4) / dy));
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
      geo = { r, cw, ch, dx, dy, cols, rows, dpr, w, h, ox: (w - (cols * dx - gap)) / 2 + cw / 2 + ch * 0.11, oy: (h - (rows * dy - gap)) / 2 + ch / 2 };
      assign();
    }
    // which cell is what: column-major, left to right
    function assign() {
      if (!geo) return;
      const n = geo.cols * geo.rows, total = Math.max(1, data.total || 0);
      const segs = data.segments.filter((s) => s.size > 0);
      const usedBytes = segs.reduce((a, s) => a + s.size, 0);
      let used = Math.min(n, Math.round((n * Math.max(usedBytes, data.used || 0)) / total));
      if (usedBytes > 0 && used < segs.length) used = Math.min(n, segs.length);
      cells = new Array(n).fill(null);
      let at = 0;
      const scale = usedBytes ? used / Math.max(usedBytes, data.used || 0) : 0;
      segs.forEach((s, i) => {
        let k = Math.max(1, Math.round(s.size * scale));
        if (i === segs.length - 1 && !(data.used > usedBytes)) k = Math.max(1, used - at);
        for (let j = 0; j < k && at < n; j++) cells[at++] = { seg: i, s };
      });
      while (at < used) cells[at++] = { seg: -1, s: { name: 'Other files', size: (data.used || 0) - usedBytes } };
      data.usedCells = at;
      draw();
    }
    const pos = (i) => { const c = Math.floor(i / geo.rows), row = i % geo.rows; return [geo.ox + c * geo.dx, geo.oy + row * geo.dy]; };
    // the RFP slant: top edge shifted right, bottom edge left (as on the buttons and the logo)
    function hex(ctx, x, y) { const hw = geo.cw / 2, hh = geo.ch / 2, k = geo.ch * 0.22; ctx.beginPath(); ctx.moveTo(x - hw + k, y - hh); ctx.lineTo(x + hw + k, y - hh); ctx.lineTo(x + hw - k, y + hh); ctx.lineTo(x - hw - k, y + hh); ctx.closePath(); }
    function draw() {
      if (!geo) return;
      const ctx = cv.getContext('2d'); ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0); ctx.clearRect(0, 0, geo.w, geo.h);
      const now = performance.now(), r = geo.r;
      let busy = false;
      for (let i = 0; i < cells.length; i++) {
        const [x, y] = pos(i), c = cells[i];
        hex(ctx, x, y, r);
        const l = lit.get(i);
        if (l) {
          const age = (now - l.at) / 2600, a = Math.max(0, 1 - age);
          if (a > 0) { busy = true; ctx.fillStyle = l.kind === 'write' ? C.in : C.out; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10 * a; ctx.globalAlpha = 0.45 + 0.55 * a; ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1; continue; }
          lit.delete(i);
        }
        if (c) { ctx.fillStyle = c.seg < 0 ? '#0d7a43' : C.used[c.seg % C.used.length]; ctx.globalAlpha = c === hover ? 1 : 0.82; ctx.fill(); ctx.globalAlpha = 1; }
        else { ctx.fillStyle = C.free; ctx.fill(); ctx.strokeStyle = C.freeEdge; ctx.lineWidth = 1; ctx.stroke(); }
      }
      if (busy) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
    }
    // files being read / written: light a cell inside their folder's cells (the same cell each time for a file)
    function light(hot) {
      const used = data.usedCells || 0;
      if (!used) return;
      for (const x of hot || []) {
        let idx = -1;
        if (x.key !== undefined) {
          const seg = data.segments.findIndex((s) => s.key === x.key || (x.key && String(x.key).startsWith(s.key + '/')));
          const mine = []; for (let i = 0; i < used; i++) if (cells[i] && cells[i].seg === seg) mine.push(i);
          if (mine.length) idx = mine[Math.floor(hash(String(x.path || x.key)) * mine.length)];
          // something new arriving (not on the map yet): it lands in the free cells next to the used ones
          else if (x.kind === 'write' && cells.length > used) idx = used + Math.floor(hash(String(x.path || x.key)) * Math.min(cells.length - used, geo.rows * 2));
        } else idx = Math.floor(x.h * used);
        if (idx >= 0) lit.set(idx, { kind: x.kind, at: performance.now() });
      }
      draw();
    }
    let hover = null;
    const cellAt = (ev) => {
      if (!geo) return -1;
      const b = cv.getBoundingClientRect(), x = ev.clientX - b.left, y = ev.clientY - b.top;
      const row = Math.round((y - geo.oy) / geo.dy), c = Math.round((x - geo.ox) / geo.dx);
      if (row < 0 || row >= geo.rows || c < 0 || c >= geo.cols) return -1;
      return c * geo.rows + row;
    };
    cv.addEventListener('mousemove', (ev) => {
      const i = cellAt(ev), c = i >= 0 ? cells[i] : null;
      if (c !== hover) { hover = c; draw(); }
      if (!c && i >= 0 && i < cells.length) { tip.hidden = false; tip.textContent = 'Free · ' + bytes(Math.max(0, (data.total || 0) - (data.used || 0))); }
      else if (c) { tip.hidden = false; tip.textContent = c.s.name + ' · ' + bytes(c.s.size) + (c.s.sub ? ' · ' + c.s.sub : ''); }
      else tip.hidden = true;
      const b = wrap.getBoundingClientRect(); tip.style.left = Math.min(b.width - 10, ev.clientX - b.left + 12) + 'px'; tip.style.top = (ev.clientY - b.top + 14) + 'px';
      cv.style.cursor = c && opts.onPick && c.seg >= 0 ? 'pointer' : 'default';
    });
    cv.addEventListener('mouseleave', () => { tip.hidden = true; hover = null; draw(); });
    cv.addEventListener('click', (ev) => { const i = cellAt(ev), c = i >= 0 ? cells[i] : null; if (c && c.seg >= 0 && opts.onPick) opts.onPick(c.s); });
    const ro = new ResizeObserver(() => layout()); ro.observe(wrap);
    return {
      el: wrap,
      set(d) {
        const same = data.total === d.total && data.used === d.used && JSON.stringify(data.segments.map((s) => [s.key, s.size])) === JSON.stringify((d.segments || []).map((s) => [s.key, s.size]));
        data = { total: d.total || 0, used: d.used || 0, segments: d.segments || [], hot: d.hot || [], usedCells: data.usedCells };
        if (!same || !geo) { if (!geo) layout(); else assign(); }
        light(d.hot);
      },
      destroy() { ro.disconnect(); cancelAnimationFrame(raf); wrap.remove(); },
    };
  }

  // ---------------------------------------------------------------- graphs
  // hist: [[in, out], …] per second (bytes or bits per second); the scale grows to fit, like the Cloud Store's
  function graph(box, opts = {}) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'cs-graph'); svg.setAttribute('preserveAspectRatio', 'none');
    box.append(svg);
    return {
      el: svg,
      set(hist) {
        const w = 300, h = 100, n = hist.length || 1;
        const peak = Math.max(opts.min || 1, ...hist.map((x) => Math.max(x[0], x[1])));
        const top = niceTop(peak * 1.15);
        const y = (v) => h - (v / top) * (h - 4);
        const path = (i) => hist.map((x, k) => `${k ? 'L' : 'M'}${((k / Math.max(1, n - 1)) * w).toFixed(1)},${y(x[i]).toFixed(1)}`).join('');
        const area = (i) => path(i) + `L${w},${h}L0,${h}Z`;
        const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" stroke="${C.grid}" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('');
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.innerHTML = grid + [0, 1].map((i) => `<path d="${area(i)}" fill="${i ? C.out : C.in}" fill-opacity=".16"/><path d="${path(i)}" fill="none" stroke="${i ? C.out : C.in}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`).join('');
        if (opts.scale) opts.scale.textContent = opts.fmt ? opts.fmt(top) : '';
      },
    };
  }
  function niceTop(v) { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function spark(hist) {
    const box = document.createElement('span'); box.className = 'cs-spark';
    graph(box).set(hist && hist.length ? hist.slice(-30) : [[0, 0], [0, 0]]);
    return box;
  }
  window.RFPCS = { hexMap, graph, spark, bytes, bits, rate, num, hash, colors: C };
})();
