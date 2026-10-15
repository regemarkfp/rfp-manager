'use strict';
// A small PDF writer with no dependencies, enough for printed sheets (the call sheet): A4 pages, Helvetica and
// Helvetica-Bold (built into every PDF reader), wrapped text, tables with filled rows, lines, and JPEG / PNG logos.
// Text is WinAnsi (Latin-1 plus the usual dashes and quotes); other characters lose their accents or become "?".
const zlib = require('node:zlib');

// character widths (1/1000 em) for codes 32..126
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const WIN = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f,
  0x25cf: 0x95, 0x2212: 0x2d, 0x2010: 0x2d, 0x2011: 0x2d, 0xa0: 0x20, 0x2009: 0x20, 0x202f: 0x20 };

// a string as WinAnsi bytes
function winAnsi(str) {
  const out = [];
  for (const ch of String(str === undefined || str === null ? '' : str).replace(/[\r\t]/g, ' ')) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) out.push(c);
    else if (WIN[c] !== undefined) out.push(WIN[c]);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (c === 10) out.push(32);
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const b = base.codePointAt(0);
      out.push(base && b < 256 && b >= 32 && b !== c ? b : 63);
    }
  }
  return out;
}
function widthOf(str, bold, size) {
  const w = bold ? W_BOLD : W_REG;
  let n = 0;
  for (const b of winAnsi(str)) n += b >= 32 && b <= 126 ? w[b - 32] : 556;
  return (n * size) / 1000;
}
const hex = (bytes) => '<' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>';
const num = (n) => (Math.round(n * 100) / 100).toString();
function rgb(c) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return null;
  let h = m[1]; if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
const fill = (c) => { const v = rgb(c) || [0, 0, 0]; return `${num(v[0])} ${num(v[1])} ${num(v[2])} rg`; };
const stroke = (c) => { const v = rgb(c) || [0, 0, 0]; return `${num(v[0])} ${num(v[1])} ${num(v[2])} RG`; };

// ---- images: JPEG as it is, PNG (8-bit, not interlaced) unpacked into colour + transparency
function loadImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      for (let i = 2; i + 9 < buf.length;) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
        if ([0xc0, 0xc1, 0xc2].includes(m)) {
          const h = buf.readUInt16BE(i + 5), w = buf.readUInt16BE(i + 7), comps = buf[i + 9];
          if (comps !== 1 && comps !== 3) return null;
          return { w, h, kind: 'jpeg', data: buf, colors: comps };
        }
        i += 2 + len;
      }
      return null;
    }
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8, w = 0, h = 0, depth = 0, ct = 0, inter = 0, plte = null, trns = null;
    const idat = [];
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; inter = d[12]; }
      else if (type === 'PLTE') plte = d;
      else if (type === 'tRNS') trns = d;
      else if (type === 'IDAT') idat.push(d);
      else if (type === 'IEND') break;
      off += 12 + len;
    }
    if (depth !== 8 || inter !== 0 || !w || !h || w * h > 4e6) return null;
    const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
    if (!bpp || (ct === 3 && !plte)) return null;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * bpp, px = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
        let v = raw[src + x];
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        px[dst + x] = v & 255;
      }
    }
    const colors = ct === 0 || ct === 4 ? 1 : 3, n = w * h;
    const col = Buffer.alloc(n * colors);
    let alpha = null;
    if (ct === 4 || ct === 6 || (ct === 3 && trns)) alpha = Buffer.alloc(n, 255);
    for (let i = 0; i < n; i++) {
      if (ct === 0) col[i] = px[i];
      else if (ct === 4) { col[i] = px[i * 2]; alpha[i] = px[i * 2 + 1]; }
      else if (ct === 2) px.copy(col, i * 3, i * 3, i * 3 + 3);
      else if (ct === 6) { px.copy(col, i * 3, i * 4, i * 4 + 3); alpha[i] = px[i * 4 + 3]; }
      else { const k = px[i]; plte.copy(col, i * 3, k * 3, k * 3 + 3); if (alpha && k < trns.length) alpha[i] = trns[k]; }
    }
    return { w, h, kind: 'raw', colors, data: zlib.deflateSync(col), alpha: alpha ? zlib.deflateSync(alpha) : null };
  } catch { return null; }
}

// makePdf(): draw on A4 pages from the top down, then finish() → Buffer
function makePdf({ title = '', margin = 36, footer = '' } = {}) {
  const PW = 595.28, PH = 841.89, M = margin, CW = PW - 2 * M;
  const BOTTOM = M + 22;                                   // room for the footer line
  const pages = [], images = [];
  let ops = null, y = 0;

  function newPage() { ops = []; pages.push(ops); y = PH - M; }
  newPage();
  const ensure = (h) => { if (y - h < BOTTOM && y < PH - M - 1) newPage(); };
  const text = (x, base, str, { size = 10, bold = false, color = '#1d1d1d' } = {}) => {
    const b = winAnsi(str); if (!b.length) return;
    ops.push(`BT ${fill(color)} /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(base)} Td ${hex(b)} Tj ET`);
  };
  const rect = (x, top, w, h, color) => ops.push(`${fill(color)} ${num(x)} ${num(top - h)} ${num(w)} ${num(h)} re f`);
  const hline = (x1, x2, at, color = '#cccccc', lw = 0.5) => ops.push(`${stroke(color)} ${num(lw)} w ${num(x1)} ${num(at)} m ${num(x2)} ${num(at)} l S`);

  // runs: [{ text, bold, italic, color }] (or a string) → lines of runs that fit width
  function wrap(runs, width, size) {
    if (!Array.isArray(runs)) runs = [{ text: String(runs === undefined || runs === null ? '' : runs) }];
    const lines = [[]];
    let w = 0;
    const words = [];
    for (const r of runs) {
      const parts = String(r.text === undefined || r.text === null ? '' : r.text).split(/(\n)/);
      for (const part of parts) {
        if (part === '\n') { words.push({ br: true }); continue; }
        for (const tok of part.split(/(?<= )/)) if (tok) words.push({ ...r, text: tok });
      }
    }
    for (const wd of words) {
      if (wd.br) { lines.push([]); w = 0; continue; }
      let ww = widthOf(wd.text, wd.bold, size);
      if (w + widthOf(wd.text.trimEnd(), wd.bold, size) > width && lines[lines.length - 1].length) { lines.push([]); w = 0; if (!wd.text.trim()) continue; }
      // one word wider than the column: break it by characters
      if (ww > width) {
        let chunk = '';
        for (const ch of wd.text) {
          if (widthOf(chunk + ch, wd.bold, size) > width - w && chunk) { lines[lines.length - 1].push({ ...wd, text: chunk }); lines.push([]); w = 0; chunk = ''; }
          chunk += ch;
        }
        wd.text = chunk; ww = widthOf(chunk, wd.bold, size);
      }
      lines[lines.length - 1].push(wd); w += ww;
    }
    return lines;
  }
  function drawLine(line, x, base, size, color) {
    let cx = x;
    for (const r of line) { text(cx, base, r.text, { size, bold: r.bold, color: r.color || color }); cx += widthOf(r.text, r.bold, size); }
  }

  const api = {
    width: CW, left: M,
    get y() { return y; }, set y(v) { y = v; },
    newPage, ensure,
    space(n) { y -= n; if (y < BOTTOM) newPage(); },
    // a paragraph of runs; keeps whole lines together
    para(runs, { size = 10, x = M, width = CW, color = '#1d1d1d', lead = 1.3, after = 3 } = {}) {
      const lh = size * lead;
      for (const line of wrap(runs, width, size)) { ensure(lh); drawLine(line, x, y - size, size, color); y -= lh; }
      y -= after;
    },
    heading(str, { size = 11, color = '#00a95a', before = 10, after = 4, rule = true } = {}) {
      ensure(before + size * 1.4 + 30);
      y -= before;
      text(M, y - size, String(str).toUpperCase(), { size, bold: true, color });
      y -= size * 1.35;
      if (rule) { hline(M, M + CW, y, color, 0.8); y -= 4; }
      y -= after;
    },
    rule(color = '#cccccc') { ensure(6); y -= 3; hline(M, M + CW, y, color); y -= 3; },
    // cols: [{ label, w (share of the width), align }]; rows: [{ cells: [runs|string], fill, bold, span (one cell across) }]
    table(cols, rows, { size = 9, headFill = '#262626', headColor = '#ffffff', pad = 3.5, lines = '#dddddd', zebra = '' } = {}) {
      const total = cols.reduce((s, c) => s + (c.w || 1), 0);
      const widths = cols.map((c) => ((c.w || 1) / total) * CW);
      const lh = size * 1.25;
      const head = () => {
        const cells = cols.map((c, i) => wrap([{ text: c.label, bold: true }], widths[i] - 2 * pad, size));
        const h = Math.max(...cells.map((l) => l.length)) * lh + 2 * pad;
        ensure(h + lh + 2 * pad);
        rect(M, y, CW, h, headFill);
        let x = M;
        cells.forEach((ls, i) => { ls.forEach((ln, k) => { const lw = ln.reduce((s2, r) => s2 + widthOf(r.text, r.bold, size), 0); const tx = cols[i].align === 'center' ? x + (widths[i] - lw) / 2 : cols[i].align === 'right' ? x + widths[i] - pad - lw : x + pad; drawLine(ln, tx, y - pad - size * 0.85 - k * lh, size, headColor); }); x += widths[i]; });
        y -= h;
      };
      head();
      rows.forEach((row, ri) => {
        const span = !!row.span;
        const cellRuns = span ? [row.cells[0]] : row.cells;
        const ws = span ? [CW] : widths;
        const cells = cellRuns.map((c, i) => wrap(Array.isArray(c) ? c : [{ text: c === undefined || c === null ? '' : String(c), bold: !!row.bold }], ws[i] - 2 * pad, size));
        const h = Math.max(1, ...cells.map((l) => l.length)) * lh + 2 * pad;
        if (y - h < BOTTOM) { newPage(); head(); }
        const bg = row.fill || (zebra && ri % 2 ? zebra : '');
        if (bg) rect(M, y, CW, h, bg);
        let x = M;
        cells.forEach((ls, i) => {
          const al = !span && cols[i].align;
          ls.forEach((ln, k) => {
            const lw = ln.reduce((s, r) => s + widthOf(r.text, r.bold, size), 0);
            const tx = al === 'center' ? x + (ws[i] - lw) / 2 : al === 'right' ? x + ws[i] - pad - lw : x + pad;
            drawLine(ln, tx, y - pad - size * 0.85 - k * lh, size, row.color || '#1d1d1d');
          });
          x += ws[i];
        });
        y -= h;
        hline(M, M + CW, y, lines);
      });
    },
    // an image (from loadImage) inside a box; returns the size drawn
    image(img, x, top, maxW, maxH) {
      if (!img) return null;
      const s = Math.min(maxW / img.w, maxH / img.h, 1.5);
      const w = img.w * s, h = img.h * s;
      let i = images.indexOf(img); if (i < 0) { images.push(img); i = images.length - 1; }
      ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x + maxW - w)} ${num(top - h)} cm /Im${i + 1} Do Q`);
      return { w, h };
    },
    text, rect, hline, wrap, widthOf,

    finish() {
      // footer on every page: the line and "page n of N"
      pages.forEach((p, i) => {
        ops = p;
        hline(M, M + CW, M + 12, '#bbbbbb');
        const right = `Page ${i + 1} of ${pages.length}`;
        const fw = CW - widthOf(right, false, 7.5) - 12;
        let f = String(footer || '');
        while (f && widthOf(f, false, 7.5) > fw) f = f.slice(0, -2);
        if (f !== String(footer || '')) f += '…';
        text(M, M + 2, f, { size: 7.5, color: '#666666' });
        text(M + CW - widthOf(right, false, 7.5), M + 2, right, { size: 7.5, color: '#666666' });
      });
      const objs = [];                                         // index + 1 = object number
      const add = (o) => { objs.push(o); return objs.length; };
      const catalog = add(null), pagesObj = add(null);
      const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const imgRefs = images.map((img) => {
        if (img.kind === 'jpeg') return add({ dict: `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /${img.colors === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>`, data: img.data });
        const smask = img.alpha ? add({ dict: `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.alpha.length} >>`, data: img.alpha }) : 0;
        return add({ dict: `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /${img.colors === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /FlateDecode${smask ? ` /SMask ${smask} 0 R` : ''} /Length ${img.data.length} >>`, data: img.data });
      });
      const xo = imgRefs.length ? ` /XObject << ${imgRefs.map((r, i) => `/Im${i + 1} ${r} 0 R`).join(' ')} >>` : '';
      const kids = pages.map((p) => {
        const content = zlib.deflateSync(Buffer.from(p.join('\n'), 'latin1'));
        const c = add({ dict: `<< /Length ${content.length} /Filter /FlateDecode >>`, data: content });
        return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(PW)} ${num(PH)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo} >> /Contents ${c} 0 R >>`);
      });
      objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
      objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
      const info = add(`<< /Title ${hex(winAnsi(title))} /Producer (RFP Manager) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
      const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
      let len = chunks[0].length;
      const offsets = [];
      objs.forEach((o, i) => {
        offsets.push(len);
        const parts = typeof o === 'string' ? [Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')]
          : [Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')];
        for (const b of parts) { chunks.push(b); len += b.length; }
      });
      const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
        `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${len}\n%%EOF\n`].join('');
      chunks.push(Buffer.from(xref, 'latin1'));
      return Buffer.concat(chunks);
    },
  };
  return api;
}

module.exports = { makePdf, loadImage, winAnsi, widthOf };
