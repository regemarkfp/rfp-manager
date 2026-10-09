'use strict';
// Worship control: one live "deck" (the item on screen and its slides) driving any number of outputs:
// the audience screen, lower thirds for the stream, a speaker name super, the stage display, and your own CasparCG macros.
const W = require('../shared/worship');
const Schema = require('../shared/schema');
const { makeBibles } = require('./bible');
const { readBody, send } = require('./http');
const { fail, log, detId } = require('./util');

const DEFAULT_OUTPUTS = [
  { id: 'audience', name: 'Audience screen', enabled: true, channel: 0, layer: 60, template: 'worship', layout: 'full' },
  { id: 'stream', name: 'Stream lower third', enabled: false, channel: 0, layer: 61, template: 'worship', layout: 'lower' },
];
const DEFAULT_LT = { channel: 0, layer: 62, template: 'worship' };
const DEFAULT_LOOK = { font: 'Segoe UI', textColor: '#ffffff', background: '#000000', backgroundImage: '', align: 'center', uppercase: false, linesPerSlide: 4, size: 100, shadow: true,
  lowerColor: '#000000', lowerOpacity: 70, lowerLines: 2, showCopyright: true, showLabel: false };

function makeWorship(app) {
  const gfx = app.gfx || null;
  const bibles = makeBibles(app);
  const listeners = new Set();
  let playing = '';
  const st = { team: '', service: '', item: '', song: '', title: '', kind: '', slides: [], index: -1, blank: false, logo: false, message: '', lt: null,
    timer: { label: '', endsAt: 0, leftMs: 0, running: false }, rev: 0 };

  const cfg = () => (app.config.worship = app.config.worship || {});
  const outputs = () => (Array.isArray(cfg().outputs) && cfg().outputs.length ? cfg().outputs : DEFAULT_OUTPUTS);
  const ltOut = () => Object.assign({}, DEFAULT_LT, cfg().lowerThird || {});
  const macros = () => (Array.isArray(cfg().macros) ? cfg().macros : []);
  const doc = (id) => { const d = id ? app.cache.get(id) : null; return d && !d.deleted ? d : null; };
  const org = () => (st.team && doc(st.team) ? doc(st.team).data : {});
  const look = () => Object.assign({}, DEFAULT_LOOK, (org().worship || {}).look || {});
  const ctx = () => ({ song: (id) => (doc(id) && doc(id).type === 'song' ? doc(id).data : null), licence: (org().worship || {}).ccliLicence || '', showCopyright: look().showCopyright !== false, look: look() });

  // ---------------------------------------------------------------------------------- what is on screen
  const current = () => (st.index >= 0 && st.slides[st.index]) || null;
  function slideData(layout) {
    const s = current(), L = look(), o = org();
    const base = { accent: o.accentColor || '#00ff82', font: L.font, text_color: L.textColor, bg_color: L.background, bg_image: L.backgroundImage || '', align: L.align, upper: L.uppercase ? '1' : '', size: String(L.size || 100),
      shadow: L.shadow === false ? '' : '1', lower_color: L.lowerColor, lower_opacity: String(L.lowerOpacity), logo: o.image || '', org_name: o.name || '' };
    if (st.logo) return Object.assign(base, { layout: layout === 'full' ? 'logo' : 'none', text: '', lines_count: '0' });
    if (st.blank) return Object.assign(base, { layout: layout === 'full' ? 'blank' : 'none', text: '', lines_count: '0' });
    if (!s) return Object.assign(base, { layout: 'none' });                                       // nothing chosen: the layer is empty, not black
    let lines = s.lines || [];
    if (layout === 'lower' && lines.length > (Number(L.lowerLines) || 2)) {
      // The stream shows two lines at a time: long slides are cut to what fits.
      lines = lines.slice(0, Number(L.lowerLines) || 2);
    }
    const d = Object.assign(base, { layout: s.kind === 'media' && layout === 'full' ? 'media' : layout, kind: s.kind || '', text: lines.join('\n'), lines_count: String(lines.length),
      label: L.showLabel ? s.label || '' : '', caption: s.caption || '', footer: s.footer || '', title: st.title || '', image: s.image || '' });
    lines.forEach((l, i) => { d['line' + (i + 1)] = l; });
    if (s.kind === 'media' && layout !== 'full') d.layout = 'none';
    return d;
  }
  async function pushOutputs() {
    if (!gfx) return;
    for (const o of outputs()) {
      if (!o.enabled) { await gfx.customStop(o.channel, o.layer); continue; }
      const data = slideData(o.layout === 'lower' ? 'lower' : 'full');
      if (data.layout === 'none') { await gfx.customStop(o.channel, o.layer); continue; }
      await gfx.custom({ id: 'worship:' + o.id, name: 'Worship: ' + o.name, team: st.team, channel: o.channel, layer: o.layer, template: o.template || 'worship', data });
    }
    // A video clip plays on the layer under the first output, and stops when the deck moves on.
    const s = current(), first = outputs()[0], at = `${Number(first.channel) || Number((app.config.caspar || {}).channel) || 1}-${Math.max(1, Number(first.layer) - 1)}`;
    const clip = s && s.kind === 'media' && s.clip && !st.blank && !st.logo ? String(s.clip).replace(/["\r\n]/g, '') : '';
    if (clip !== playing) {
      if (clip) await gfx.raw(`PLAY ${at} "${clip}" MIX 12 LOOP`).catch(() => {});
      else await gfx.raw(`STOP ${at}`).catch(() => {});
      playing = clip;
    }
  }
  async function pushLt() {
    if (!gfx) return;
    const o = ltOut();
    if (!st.lt) return gfx.customStop(o.channel, o.layer);
    const L = look(), g = org();
    await gfx.custom({ id: 'worship:lt', name: 'Worship: name super', team: st.team, channel: o.channel, layer: o.layer, template: o.template || 'worship',
      data: { layout: 'name', line1: st.lt.line1 || '', line2: st.lt.line2 || '', accent: g.accentColor || '#00ff82', font: L.font, text_color: L.textColor, lower_color: L.lowerColor, lower_opacity: String(L.lowerOpacity), logo: g.image || '' } });
  }

  const pub = () => {
    const s = current(), n = st.slides[st.index + 1] || null;
    return { rev: st.rev, now: Date.now(), team: st.team, service: st.service, item: st.item, song: st.song, title: st.title, kind: st.kind, index: st.index, count: st.slides.length,
      slide: st.blank || st.logo ? null : s, next: n, blank: st.blank, logo: st.logo, message: st.message, lt: st.lt, timer: st.timer,
      look: look(), outputs: outputs(), lowerThird: ltOut(), macros: macros().map((m) => ({ id: m.id, name: m.name, color: m.color || '' })), caspar: gfx ? gfx.casparState() : null, local: !!gfx };
  };
  function changed() {
    st.rev++;
    const msg = 'data: ' + JSON.stringify(pub()) + '\n\n';
    for (const res of listeners) { try { res.write(msg); } catch { listeners.delete(res); } }
  }

  // ---------------------------------------------------------------------------------- loading a deck
  function loadDeck(target) {
    let item = null, team = '', title = '', service = '';
    if (target.service) {
      const sv = doc(target.service);
      if (!sv || sv.type !== 'service') fail(404, 'Service not found');
      item = (sv.data.items || []).find((x) => x.id === target.item);
      if (!item) fail(404, 'That item is no longer in the service');
      team = sv.team; service = sv.id;
    } else if (target.song) {
      const sg = doc(target.song);
      if (!sg || sg.type !== 'song') fail(404, 'Song not found');
      item = { id: '', kind: 'song', song: sg.id }; team = sg.team;
    } else if (target.adhoc && target.team) {
      item = Object.assign({ id: '' }, target.adhoc); team = target.team;                              // scripture or text shown without adding it to a service
    } else fail(400, 'Nothing to show');
    const was = st.team; st.team = team;
    const slides = W.itemSlides(item, ctx());
    if (!slides.length) { st.team = was; fail(400, 'That item has no slides'); }
    const sg = item.kind === 'song' ? doc(item.song) : null;
    title = sg ? sg.data.title : item.title || item.ref || '';
    return { team, service, item: item.id || '', song: sg ? sg.id : '', kind: item.kind, title, slides };
  }
  async function logSong(songId, userId) {
    const sg = doc(songId);
    if (!sg) return;
    const date = new Date().toLocaleDateString('en-CA'), id = detId('songuse_', sg.team, date, songId), cur = doc(id);
    const sv = doc(st.service), streamed = outputs().some((o) => o.enabled && o.layout === 'lower');
    if (cur && cur.data.service === st.service && (cur.data.streamed || !streamed)) return;          // already logged for this service today
    await app.save(sg.team, 'songuse', id, { song: songId, title: sg.data.title || '', author: sg.data.author || '', ccliNumber: sg.data.ccliNumber || '', copyright: sg.data.copyright || '',
      date, service: st.service, serviceName: sv ? sv.data.name || '' : '', projected: true, streamed: !!(streamed || (cur && cur.data.streamed)), machine: app.config.machineName || '' }, userId || '');
  }
  function neighbour(dir) {
    const sv = doc(st.service);
    if (!sv) return null;
    const items = sv.data.items || [];
    let i = items.findIndex((x) => x.id === st.item);
    for (i += dir; i >= 0 && i < items.length; i += dir) if (W.itemSlides(items[i], ctx()).length) return items[i];
    return null;
  }

  // ---------------------------------------------------------------------------------- actions
  async function act(user, b) {
    const need = async (team, test) => { const role = await app.auth.roleIn(user, team); if (!role || !(test || Schema.CAN.score)(role)) fail(403, 'You need the Scorer role or higher in this production team'); };
    if (!gfx) fail(400, 'Worship control runs on the production PC, where the outputs are');
    switch (b.action) {
      case 'go': {
        const deck = loadDeck(b);
        await need(deck.team);
        Object.assign(st, deck, { index: Math.max(0, Math.min(deck.slides.length - 1, Number(b.index) || 0)), blank: false, logo: false });
        if (st.song) await logSong(st.song, user.id);
        break;
      }
      case 'next': case 'prev': {
        if (!st.team) fail(400, 'Nothing is live yet');
        await need(st.team);
        const dir = b.action === 'next' ? 1 : -1;
        if (st.blank || st.logo) { st.blank = false; st.logo = false; break; }
        if (st.slides[st.index + dir]) st.index += dir;
        else {
          const it = neighbour(dir);
          if (!it) break;
          const deck = loadDeck({ service: st.service, item: it.id });
          Object.assign(st, deck, { index: dir > 0 ? 0 : deck.slides.length - 1 });
          if (st.song) await logSong(st.song, user.id);
        }
        break;
      }
      case 'clear': {
        if (st.team) await need(st.team);
        const what = b.what || 'slide';
        if (what === 'slide' || what === 'all') { st.index = -1; st.blank = false; st.logo = false; }
        if (what === 'lt' || what === 'all') st.lt = null;
        if (what === 'message' || what === 'all') st.message = '';
        if (what === 'all' && gfx) { for (const o of outputs()) await gfx.customStop(o.channel, o.layer); }
        break;
      }
      case 'blank': if (st.team) await need(st.team); st.blank = b.on === undefined ? !st.blank : !!b.on; st.logo = false; break;
      case 'logo': if (st.team) await need(st.team); st.logo = b.on === undefined ? !st.logo : !!b.on; st.blank = false; if (b.team && !st.team) st.team = b.team; break;
      case 'message': await need(b.team || st.team); st.message = String(b.text || '').slice(0, 300); break;
      case 'lt': {
        await need(b.team || st.team);
        if (!st.team) st.team = b.team;
        st.lt = b.on === false ? null : { line1: String(b.line1 || '').slice(0, 120), line2: String(b.line2 || '').slice(0, 160) };
        break;
      }
      case 'timer': {
        await need(b.team || st.team);
        const t = st.timer, now = Date.now();
        if (b.label !== undefined) t.label = String(b.label).slice(0, 60);
        if (b.op === 'start') {
          if (b.to) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(b.to)); if (!m) fail(400, 'Give the time as HH:MM'); const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); t.endsAt = d.getTime(); }
          else t.endsAt = now + (b.seconds !== undefined ? Math.max(0, Number(b.seconds) || 0) * 1000 : t.leftMs || 0);
          t.running = true; t.leftMs = 0;
        } else if (b.op === 'pause') { if (t.running) { t.leftMs = Math.max(0, t.endsAt - now); t.running = false; } }
        else if (b.op === 'reset') { t.running = false; t.endsAt = 0; t.leftMs = 0; }
        break;
      }
      case 'macro': {
        if (!gfx) fail(400, 'CasparCG is driven from the production PC');
        await need(b.team || st.team);
        const m = macros().find((x) => x.id === b.id);
        if (!m) fail(404, 'That button no longer exists');
        for (const line of String(m.commands || '').split('\n').map((l) => l.trim()).filter(Boolean)) await gfx.raw(line);
        return pub();
      }
      default: fail(400, 'Unknown worship action');
    }
    if (['go', 'next', 'prev', 'clear', 'blank', 'logo'].includes(b.action)) await pushOutputs();
    if (['lt', 'clear'].includes(b.action)) await pushLt();
    changed();
    return pub();
  }

  // A song or service edited while it is live: rebuild the deck so the screen follows the edit.
  let rebuild = null;
  app.on('doc', (d) => {
    if (!st.team || d.team !== st.team || !['song', 'service', 'org'].includes(d.type)) return;
    if (d.type === 'song' && d.id !== st.song) return;
    clearTimeout(rebuild);
    rebuild = setTimeout(async () => {
      try {
        if (st.service || st.song) { const deck = loadDeck(st.service ? { service: st.service, item: st.item } : { song: st.song }); st.slides = deck.slides; st.title = deck.title; if (st.index >= st.slides.length) st.index = st.slides.length - 1; }
        await pushOutputs(); await pushLt(); changed();
      } catch { /* the item was removed: keep what is on screen */ }
    }, 120);
  });

  // ---------------------------------------------------------------------------------- HTTP
  async function http(req, res, pathname) {
    const q = new URL(req.url, 'http://x').searchParams, name = pathname.slice('/worship/api/'.length);
    const user = await app.auth.userFromReq(req);
    const viaKey = !user && !!gfx && !!app.config.outputKey && q.get('key') === app.config.outputKey;
    if (!user && !viaKey) fail(401, 'Sign in first');
    const json = async (max) => { try { return JSON.parse((await readBody(req, max || 65536)).toString('utf8') || '{}'); } catch { fail(400, 'Bad request'); } };
    const anyRole = async (test, msg) => { if (!user) fail(403, 'Sign in to do this'); const ok = (await app.auth.teamsFor(user)).some((t) => test(t.role)); if (!ok) fail(403, msg); };

    if (name === 'state' && req.method === 'GET') return send(res, 200, pub());
    if (name === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 1500\n\ndata: ' + JSON.stringify(pub()) + '\n\n');
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }
    if (req.method !== 'GET' && req.headers['x-rfp'] !== '1') fail(403, 'Missing request header');
    if (name === 'act' && req.method === 'POST') { if (!user) fail(403, 'This screen is view-only'); return send(res, 200, await act(user, await json())); }
    if (name === 'settings' && req.method === 'POST') {
      if (!gfx) fail(400, 'Outputs are set on the production PC');
      await anyRole(Schema.CAN.edit, 'Only a Producer or Admin can change the outputs');
      const b = await json();
      if (gfx) { for (const o of outputs()) await gfx.customStop(o.channel, o.layer); const l = ltOut(); await gfx.customStop(l.channel, l.layer); }   // old layers are cleared before they move
      const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : d);
      if (Array.isArray(b.outputs)) cfg().outputs = b.outputs.slice(0, 8).map((o, i) => ({ id: String(o.id || 'out' + (i + 1)).replace(/[^\w-]/g, '').slice(0, 24) || 'out' + (i + 1), name: String(o.name || 'Output ' + (i + 1)).slice(0, 40), enabled: !!o.enabled,
        channel: num(o.channel, 0), layer: num(o.layer, 60 + i), template: String(o.template || 'worship').replace(/["\r\n]/g, '').slice(0, 120), layout: o.layout === 'lower' ? 'lower' : 'full' }));
      if (b.lowerThird) cfg().lowerThird = { channel: num(b.lowerThird.channel, 0), layer: num(b.lowerThird.layer, 62), template: String(b.lowerThird.template || 'worship').replace(/["\r\n]/g, '').slice(0, 120) };
      if (Array.isArray(b.macros)) cfg().macros = b.macros.slice(0, 40).map((m, i) => ({ id: String(m.id || 'm' + Date.now() + i).replace(/[^\w-]/g, '').slice(0, 24), name: String(m.name || 'Button').slice(0, 30), color: /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(m.color || '') ? m.color : '',
        commands: String(m.commands || '').slice(0, 2000) }));
      app.saveConfig();
      if (gfx) { await pushOutputs(); await pushLt(); }
      changed();
      return send(res, 200, Object.assign(pub(), { macrosFull: cfg().macros || [] }));
    }
    if (name === 'macros' && req.method === 'GET') { await anyRole(Schema.CAN.edit, 'Only a Producer or Admin can see the commands'); return send(res, 200, { macros: macros() }); }
    // ---- Bibles (kept on this machine)
    if (name === 'bibles' && req.method === 'GET') return send(res, 200, { bibles: bibles.list(), folder: require('node:path').join(app.dataDir(), 'bibles') });
    if (name === 'passage' && req.method === 'GET') return send(res, 200, bibles.passage(q.get('bible') || '', q.get('ref') || '', { maxChars: Number(q.get('max')) || 260, verseNumbers: q.get('numbers') !== '0' }));
    if (name === 'search' && req.method === 'GET') return send(res, 200, { results: bibles.search(q.get('bible') || '', q.get('q') || '', 40) });
    if (name === 'bibles/import' && req.method === 'POST') {
      await anyRole(Schema.CAN.edit, 'Only a Producer or Admin can add Bibles');
      const buf = await readBody(req, 40 * 1024 * 1024);
      return send(res, 200, bibles.importText(q.get('name') || '', buf.toString('utf8'), q.get('lang') ? { lang: q.get('lang') } : null));
    }
    if (name === 'bibles/kjv' && req.method === 'POST') { await anyRole(Schema.CAN.edit, 'Only a Producer or Admin can add Bibles'); return send(res, 200, await bibles.downloadKjv()); }
    if (name.startsWith('bibles/') && req.method === 'DELETE') { await anyRole(Schema.CAN.edit, 'Only a Producer or Admin can remove Bibles'); bibles.remove(decodeURIComponent(name.slice(7))); return send(res, 200, { ok: true }); }
    fail(404, 'Not found');
  }

  const close = () => { for (const res of listeners) { try { res.end(); } catch { /* gone */ } } listeners.clear(); clearTimeout(rebuild); };
  return { http, act, state: pub, bibles, close, DEFAULT_OUTPUTS };
}

module.exports = { makeWorship, DEFAULT_LOOK };
