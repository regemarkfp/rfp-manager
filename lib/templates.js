'use strict';
// Graphic templates in a folder on this PC (normally CasparCG's template folder): find them and read which variable
// fields each one has, so they can be filled in and played from RFP Manager.
const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./util');

const SKIP_DIRS = new Set(['lib', 'js', 'css', 'fonts', 'img', 'images', 'assets', 'node_modules', '.git']);
const NOT_FIELDS = new Set(['length', 'style', 'innerHTML', 'textContent', 'className', 'classList', 'value', 'data', 'forEach', 'map', 'filter', 'keys', 'push', 'join', 'split', 'replace', 'toString', 'hasOwnProperty',
  'play', 'stop', 'next', 'update', 'window', 'document', 'body', 'prototype', 'constructor', 'undefined', 'null', 'true', 'false', 'trim', 'indexOf', 'slice', 'src', 'id', 'name', 'type', 'key', 'parse', 'stringify',
  // the insides of an animation file are never fields
  'layers', 'assets', 'shapes', 'render', 'markers', 'meta', 'fonts', 'chars', 'comps', 'ip', 'op', 'st', 'sr', 'ks', 'fr', 'nm', 'ty', 'ind', 'ddd', 'ao', 'bm', 'refId', 'tt', 'td', 'hd', 'cl', 'ln', 'parent', 'masksProperties', 'ef', 'tm',
  'renderer', 'animationData', 'container', 'loop', 'autoplay', 'rendererSettings', 'currentFrame', 'totalFrames', 'frameRate', 'width', 'height', 'duration', 'time', 'target', 'detail', 'error', 'message', 'status']);
const typeOf = (key, def) => (/(_|^)(logo|image|img|photo|picture|badge|background|bg_image|flag)(_|$|\d)/i.test(key) || /\.(png|jpe?g|webp|svg|gif)$/i.test(def || '') ? 'image'
  : /colou?r/i.test(key) || /^#[0-9a-f]{3,8}$/i.test(def || '') ? 'color' : 'text');
const labelOf = (key) => String(key).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^f(\d+)$/i, 'Field $1').replace(/^\w/, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------------------------- Lottie / Bodymovin
const isLottie = (o) => !!o && typeof o === 'object' && Array.isArray(o.layers) && (o.fr !== undefined || o.op !== undefined) && (o.w !== undefined || o.v !== undefined);
/** Finds animation data written into a page or a .js wrapper: the first JSON object in the text that is a Lottie animation. */
function findLottie(text) {
  const start = /\{\s*"(?:v|nm|fr|ip|op|w|h|ddd|assets|layers|markers|meta|fonts|chars)"\s*:/g;
  for (let m, tries = 0; (m = start.exec(text)) && tries < 40; tries++) {
    let depth = 0, inStr = false, i = m.index;
    for (; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (inStr) { if (ch === 92) i++; else if (ch === 34) inStr = false; continue; }
      if (ch === 34) inStr = true; else if (ch === 123) depth++; else if (ch === 125 && --depth === 0) break;
    }
    if (depth !== 0) return null;
    try { const o = JSON.parse(text.slice(m.index, i + 1)); if (isLottie(o)) return o; } catch { /* not this one */ }
    start.lastIndex = i + 1;                                  // nested objects of a rejected candidate are skipped with it
  }
  return null;
}
const hex = (c) => (Array.isArray(c) && c.length >= 3 ? '#' + c.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round((x <= 1 ? x * 255 : x)))).toString(16).padStart(2, '0')).join('') : '');
const tidyText = (t) => String(t == null ? '' : t).replace(/[\r\u0003]/g, '\n').trim();
/** What an operator can change in a Lottie animation: its text layers, its pictures, and layers named as colours.
    Returns { fields, more }: `more` holds text layers that still carry the name After Effects gave them (the text itself), which are normally fixed labels. */
function lottieFields(anim, urlOf) {
  const fields = [], more = [], seen = new Set();
  const assets = new Map((anim.assets || []).map((a) => [a.id, a]));
  const put = (list, f) => { if (!f.key || seen.has(f.key)) return; seen.add(f.key); list.push(f); };
  const walk = (layers) => {
    for (const L of layers || []) {
      const name = String(L.nm || '').trim();
      if (!name || name.charAt(0) === '#' || L.hd === true) { if (L.ty === 0 && assets.get(L.refId)) walk(assets.get(L.refId).layers); continue; }
      if (L.ty === 5) {                                       // text
        const doc = L.t && L.t.d && Array.isArray(L.t.d.k) && L.t.d.k[0] && L.t.d.k[0].s ? L.t.d.k[0].s : {};
        const sample = tidyText(doc.t), color = hex(doc.fc);
        const tokens = [...name.matchAll(/\{([A-Za-z_]\w*)\}/g)].map((x) => x[1]);
        if (tokens.length) { for (const k of tokens) put(fields, { key: k, label: labelOf(k), type: 'text', value: '', sample: `in "${name}"`, color, source: 'lottie' }); continue; }
        // A layer still named after its own words was never renamed by the designer: a fixed label rather than a variable.
        const untouched = name.replace(/\s+/g, ' ').toLowerCase() === sample.replace(/\s+/g, ' ').toLowerCase() || /^(text layer|<empty text layer>)\s*\d*$/i.test(name);
        put(untouched ? more : fields, { key: name, label: labelOf(name), type: 'text', value: sample, sample, color, source: 'lottie' });
      } else if (L.ty === 2) {                                // picture
        const a = assets.get(L.refId) || {};
        const src = a.p ? (/^data:/.test(a.p) ? (a.p.length < 400000 ? a.p : '') : urlOf(String(a.u || '') + a.p)) : '';
        const generic = /^(image|img|layer)[ _-]?\d*(\.(png|jpe?g|webp))?$/i.test(name) || /\.(png|jpe?g|webp|svg)$/i.test(name);
        put(generic ? more : fields, { key: name, label: labelOf(name), type: 'image', value: '', sample: a.p && !/^data:/.test(a.p) ? a.p : '', preview: src, source: 'lottie' });
      } else if ((L.ty === 1 || L.ty === 4) && /colou?r/i.test(name)) {   // a solid or shape the designer named as a colour
        let c = L.ty === 1 ? String(L.sc || '') : '';
        if (!c) { const find = (o) => { if (!o || typeof o !== 'object' || c) return; if (o.ty === 'fl' && o.c && Array.isArray(o.c.k)) { c = hex(o.c.k); return; } (Array.isArray(o) ? o : Object.values(o)).forEach(find); }; find(L.shapes); }
        put(fields, { key: name, label: labelOf(name), type: 'color', value: c, sample: c, color: c, source: 'lottie' });
      } else if (L.ty === 0 && assets.get(L.refId)) walk(assets.get(L.refId).layers);   // pre-composition
    }
  };
  walk(anim.layers);
  return { fields, more };
}

/** Variable fields of one HTML template: { fields: [{ key, label, type, value, sample, preview, color, source }], more: [...], lottie } */
function readTemplate(html, opts) {
  opts = opts || {};
  const text = String(html);
  let anim = findLottie(text);
  if (!anim && opts.readFile) {
    // the animation sits in a file next to the page: animation: 'lottie/x.js', path: "data.json", fetch('x.json'), <script src="data.js">
    const refs = [...new Set([...text.matchAll(/["']([^"'<>]+\.(?:json|js))(?:\?[^"']*)?["']/gi)].map((m) => m[1]))].filter((r) => !/^(https?:)?\/\//.test(r) && !/lottie(\.min)?\.js$|bodymovin|cgx|rfx|jquery|gsap/i.test(r));
    for (const r of refs.slice(0, 12)) { const t = opts.readFile(r); if (t) { anim = findLottie(t); if (anim) break; } }
  }
  const base = readFields(text, !!anim);
  if (!anim) return { fields: base, more: [], lottie: false };
  const lot = lottieFields(anim, opts.urlOf || ((x) => x));
  // No layer was given a name of its own: every text layer is offered, since any of them may be meant to change.
  if (!base.length && !lot.fields.length) { lot.fields = lot.more; lot.more = []; }
  const keys = new Set(base.map((f) => f.key));
  return { fields: base.concat(lot.fields.filter((f) => !keys.has(f.key))), more: lot.more.filter((f) => !keys.has(f.key)), lottie: true };
}

/** Fields a page shows through its markup and script. With `strict` (a Lottie page) only what the page declares or binds counts,
    because the script of such a page mostly reads the animation, not the data. */
function readFields(html, strict) {
  const found = new Map();
  const add = (key, source, def) => {
    key = String(key || '').trim();
    if (strict && (source === 'script' || source === 'id')) return;
    if (!/^[A-Za-z_][\w-]{0,59}$/.test(key) || key.length < 2 || NOT_FIELDS.has(key)) return;
    const cur = found.get(key);
    if (cur) { if (!cur.value && def) { cur.value = String(def); cur.sample = cur.value; } return; }
    const value = def === undefined || def === null ? '' : String(def), type = typeOf(key, def);
    found.set(key, { key, label: labelOf(key), type, value, sample: value, color: type === 'color' ? value : '', source });
  };
  const text = String(html);
  // 1. Declared by the template: <meta name="rfp-fields" content="title, name:Speaker name, logo:image">  or  window.CG_FIELDS = [...]
  for (const m of text.matchAll(/<meta\s+name=["'](?:rfp|cg|caspar)-fields["']\s+content=["']([^"']*)["']/gi)) {
    for (const part of m[1].split(',')) { const [k, extra] = part.split(':').map((x) => x.trim()); add(k, 'declared'); const f = found.get(k); if (f && extra) { if (['image', 'color', 'text', 'multiline'].includes(extra.toLowerCase())) f.type = extra.toLowerCase(); else f.label = extra; } }
  }
  const fieldsDecl = /(?:window\.)?CG_FIELDS\s*=\s*(\[[\s\S]*?\])\s*;/.exec(text);
  if (fieldsDecl) { try { for (const f of Function('"use strict";return (' + fieldsDecl[1] + ')')()) { if (typeof f === 'string') add(f, 'declared'); else if (f && f.key) { add(f.key, 'declared', f.value); Object.assign(found.get(f.key) || {}, f.label ? { label: f.label } : {}, f.type ? { type: f.type } : {}); } } } catch { /* not plain data */ } }
  // 2. Sample data the template ships with: window.CG_DEMO = { key: 'value', … }  (also DEMO / demoData / defaults / sampleData)
  for (const m of text.matchAll(/(?:window\.)?(?:CG_DEMO|CGX_DEMO|DEMO_DATA|demoData|sampleData|defaultData|defaults)\s*=\s*\{([\s\S]*?)\}\s*;/g)) {
    for (const kv of m[1].matchAll(/(?:^|[,{\s])["']?([A-Za-z_][\w-]*)["']?\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([\d.]+|true|false))/g)) add(kv[1], 'sample', kv[2] !== undefined ? kv[2] : kv[3] !== undefined ? kv[3] : kv[4]);
  }
  // 3. Bound in the markup: data-f / data-src / data-show / data-bg / data-color (RFP and CricketCG templates), data-field, data-key, data-bind
  for (const m of text.matchAll(/\bdata-(f|src|show|bg|color|field|key|bind|text|html|image)\s*=\s*["']!?([^"']+)["']/gi)) { add(m[2], 'markup'); const f = found.get(m[2]); if (f && /^(src|image)$/i.test(m[1])) f.type = 'image'; if (f && /^(bg|color)$/i.test(m[1]) && f.type === 'text') f.type = 'color'; }
  // 4. The classic CasparCG convention: elements with id="f0", "f1" … filled from templateData
  for (const m of text.matchAll(/\bid\s*=\s*["'](f\d{1,2})["']/gi)) add(m[1], 'id');
  // 5. Placeholders in the page: {{name}}, ${data.name} is covered below
  for (const m of text.matchAll(/\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g)) add(m[1], 'placeholder');
  // 6. What the script reads from the data it is given: data.title, d['name'], json.subtitle, templateData.x
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const arg = /function\s+update\s*\(\s*(\w+)/.exec(scripts) || /update\s*[=:]\s*(?:function\s*)?\(?\s*(\w+)/.exec(scripts);
  const names = new Set(['data', 'templateData', 'json', 'payload', 'fields']);
  if (arg) names.add(arg[1]);
  for (const m of scripts.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:JSON\.parse|parse)\s*\(/g)) names.add(m[1]);
  for (const n of names) {
    if (NOT_FIELDS.has(n) && n !== 'data') continue;
    for (const m of scripts.matchAll(new RegExp('\\b' + n + '\\.([A-Za-z_]\\w*)\\b(?!\\s*\\()', 'g'))) add(m[1], 'script');
    for (const m of scripts.matchAll(new RegExp('\\b' + n + '\\[\\s*["\']([\\w-]+)["\']\\s*\\]', 'g'))) add(m[1], 'script');
  }
  // 7. Element ids named in the page are used by many simple templates (update loops over the data and fills the element with that id)
  if (!found.size || /getElementById\s*\(\s*\w+\s*\)|\[\s*id\s*=|for\s*\(\s*(?:const|let|var)\s+\w+\s+in\s+/.test(scripts)) {
    for (const m of text.matchAll(/<(?:div|span|p|h[1-6]|td|img|text|tspan)\b[^>]*\bid\s*=\s*["']([A-Za-z_][\w-]*)["']/gi)) add(m[1], 'id');
  }
  const order = { declared: 0, sample: 1, markup: 2, id: 3, placeholder: 4, script: 5 };
  return [...found.values()].sort((a, b) => order[a.source] - order[b.source]).slice(0, 120);
}

function makeTemplates(app) {
  // '' = the templates that come with RFP Manager
  const folder = () => (app.config.templatesPath ? path.resolve(app.config.templatesPath) : path.join(app.root, 'templates'));
  const safe = (rel) => {
    const clean = String(rel || '').replace(/\\/g, '/').replace(/\.html?$/i, '');
    if (!clean || clean.split('/').some((p) => !p || p === '.' || p === '..' || /[<>:"|?*]/.test(p))) fail(400, 'Bad template name');
    return clean;
  };
  const fileOf = (rel) => { const base = path.join(folder(), safe(rel)); return fs.existsSync(base + '.html') ? base + '.html' : fs.existsSync(base + '.htm') ? base + '.htm' : null; };

  function list() {
    const root = folder(), out = [];
    if (!fs.existsSync(root)) return { folder: root, exists: false, templates: [] };
    const walk = (dir, rel, depth) => {
      if (depth > 5 || out.length >= 600) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) walk(p, r, depth + 1); continue; }
        if (!/\.html?$/i.test(e.name)) continue;
        let n = 0, lottie = false, size = 0, mtime = 0;
        try { const st = fs.statSync(p); size = st.size; mtime = st.mtimeMs; const t = scan(p, r.replace(/\.html?$/i, ''), st); n = t.fields.length; lottie = t.lottie; } catch { /* unreadable: listed with no fields */ }
        out.push({ path: r.replace(/\.html?$/i, ''), name: e.name.replace(/\.html?$/i, ''), folder: rel, fields: n, lottie, size, mtime });
      }
    };
    walk(root, '', 0);
    return { folder: root, exists: true, builtIn: !app.config.templatesPath, templates: out };
  }
  // Reading a template can mean parsing a large animation file, so the result is kept until the file changes.
  const cache = new Map();
  function scan(file, rel, st) {
    const key = file + '|' + st.mtimeMs + '|' + st.size, hit = cache.get(file);
    if (hit && hit.key === key) return hit.value;
    let value = { fields: [], more: [], lottie: false };
    if (st.size < 40 * 1024 * 1024) {
      const dir = path.dirname(file), relDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
      value = readTemplate(fs.readFileSync(file, 'utf8'), {
        readFile: (ref) => { try { const p = path.resolve(dir, ref.replace(/^\.\//, '')); if (!p.startsWith(folder())) return null; const s2 = fs.statSync(p); return s2.isFile() && s2.size < 60 * 1024 * 1024 ? fs.readFileSync(p, 'utf8') : null; } catch { return null; } },
        urlOf: (ref) => '/live/templates/' + (relDir + ref).split('/').filter((x) => x && x !== '.').map(encodeURIComponent).join('/'),
      });
    }
    cache.set(file, { key, value });
    return value;
  }
  function fields(rel) {
    const f = fileOf(rel);
    if (!f) fail(404, 'That template is not in the folder');
    const t = scan(f, safe(rel), fs.statSync(f));
    return { path: safe(rel), fields: t.fields, more: t.more, lottie: t.lottie, functions: functions(rel) };
  }
  function setFolder(next) {
    next = String(next || '').trim();
    if (next) { const abs = path.resolve(next); if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) fail(400, 'That folder does not exist on this PC'); }
    app.config.templatesPath = next;
    app.saveConfig();
    return list();
  }
  // The layouts a template can draw (R.batting_card = …, .layout-double { … }, d.layout === 'x'), for a drop-down instead of typing.
  const layoutCache = new Map();
  function layouts(rel) {
    const f = fileOf(rel);
    if (!f) return [];
    let st; try { st = fs.statSync(f); } catch { return []; }
    const hit = layoutCache.get(f);
    if (hit && hit.m === st.mtimeMs) return hit.list;
    let html = ''; try { html = fs.readFileSync(f, 'utf8'); } catch { /* unreadable */ }
    const out = new Set();
    for (const re of [/\bR\.([a-z][\w]*)\s*=/g, /\.layout-([a-z][\w-]*)/g, /\blayout\s*===?\s*['"]([\w-]+)['"]/g, /\blayout:\s*['"]([\w-]+)['"]/g]) { let m; while ((m = re.exec(html))) out.add(m[1]); }
    out.delete('error');
    const list = [...out].sort();
    layoutCache.set(f, { m: st.mtimeMs, list });
    return list;
  }
  // Functions a template offers besides play / stop / update / next: candidates for invoke buttons.
  function functions(rel) {
    const f = fileOf(rel);
    if (!f) return [];
    let html = ''; try { html = fs.readFileSync(f, 'utf8'); } catch { return []; }
    const out = new Set();
    for (const re of [/\bwindow\.([A-Za-z_]\w*)\s*=\s*(?:async\s+)?function/g, /\bwindow\.([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(?[\w\s,]*\)?\s*=>/g, /(?:^|[\n;{}>])\s*(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(/g]) { let m; while ((m = re.exec(html))) out.add(m[1]); }
    for (const k of ['play', 'stop', 'update', 'next', 'remove', 'onload', 'onerror', 'onresize']) out.delete(k);
    return [...out].filter((k) => !/^_/.test(k)).sort().slice(0, 40);
  }
  return { folder, list, fields, setFolder, fileOf, readFields, layouts, functions };
}

module.exports = { makeTemplates, readFields, readTemplate, findLottie, lottieFields };
