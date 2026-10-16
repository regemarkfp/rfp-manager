'use strict';
// Restreaming: while a stream is live, the website sends a copy of it to other platforms (YouTube, Facebook, Twitch,
// any RTMP / RTMPS server). One ffmpeg per destination copies the picture and sound as they are (no re-encoding).
// The destinations are set per production (production.streamRestream rows { name, url, key, on, fixture, graphics }):
// an empty "fixture" restreams the production's own stream, a match restreams that match's stream (One stream per match).
// "graphics" (With): Clean copies the stream as it comes in; any other choice (logos, slates, ad breaks …) restreams
// the program that lib/compositor.js makes for that choice, at live/<slug>--<variant> on the streaming server.
const { spawn, execFile } = require('node:child_process');
const { log } = require('./util');
const { makeCompositor, variantOf, VARIANT_NAMES } = require('./compositor');

// where ffmpeg sends it: the server address and the stream key joined
function target(url, key) {
  const u = String(url || '').trim(), k = String(key || '').trim();
  if (!/^rtmps?:\/\/[^\s/]+/i.test(u)) return '';
  if (!k) return u;
  return u.replace(/\/+$/, '') + '/' + k.replace(/^\/+/, '');
}
// the rows that apply to one stream (a production's own, or one of its matches)
function destinationsOf(stream) {
  const fx = stream.fixtureId || '';
  return (stream.data.streamRestream || []).map((r, i) => ({ i, name: String(r.name || '').trim().slice(0, 60) || `Destination ${i + 1}`, url: target(r.url, r.key), on: r.on !== false, fixture: String(r.fixture || ''), variant: variantOf(r.graphics) }))
    .filter((r) => r.fixture === fx && r.url);
}
const hideKey = (u) => String(u).replace(/^(rtmps?:\/\/[^/]+\/.*?)([^/]{4,})$/i, (m, a, b) => a + b.slice(0, 2) + '…');

function makeRestream(app) {
  const conf = () => app.config.streaming || {};
  const runs = new Map();        // `${slug}|${i}` → { proc, name, url, since, state, error, tries, next, stopping, slug }
  let ffmpeg = null, timer = null;
  const have = () => new Promise((resolve) => { if (ffmpeg !== null) return resolve(ffmpeg); execFile('ffmpeg', ['-version'], (e) => { ffmpeg = !e; resolve(ffmpeg); }); });
  const input = (slug) => {
    const port = Number(conf().rtmpPort) || 1935;
    return `rtmp://127.0.0.1:${port}/live/${slug}?user=rfp&pass=${encodeURIComponent(conf().hookSecret || '')}`;
  };
  // ---- the programs with master control burnt in: one per stream and choice that a destination wants
  const progs = new Map();       // `${slug}--${variant}` → { comp, slug, variant, state, error, since }
  const probe = (url) => new Promise((resolve) => execFile('ffprobe', ['-v', 'error', '-rw_timeout', '15000000', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,r_frame_rate', '-of', 'json', url], { timeout: 25000 }, (e, out) => {
    if (e) return resolve(null);
    try {
      const st = JSON.parse(out).streams || [], v = st.find((x) => x.codec_type === 'video');
      if (!v || !v.width) return resolve(null);
      const rate = (r) => { const [a, b] = String(r || '').split('/').map(Number); return a && b ? a / b : 0; };
      resolve({ width: v.width, height: v.height, fps: rate(v.avg_frame_rate) || rate(v.r_frame_rate) || 25, hasAudio: st.some((x) => x.codec_type === 'audio') });
    } catch { resolve(null); }
  }));
  async function mcrState(stream) {
    const x = await app.mcr.state({ prod: stream }).catch(() => ({}));
    const ch = stream.data.streamChannel ? await app.store.get(stream.data.streamChannel) : null;
    const brand = ch && !ch.deleted ? await app.streaming.branding(ch).catch(() => null) : null;
    return { ...x, channel: { logo: brand && /^img_/.test(brand.logo || '') ? brand.logo : '' } };
  }
  async function startProg(id, stream, variant) {
    const slug = stream.data.streamSlug;
    const pr = { slug, variant, state: 'starting', error: '', since: Date.now(), comp: null };
    progs.set(id, pr);
    // the streaming server: no recording of the copy, and a new program takes the path over from the one before
    await app.streaming.pathConfig(`live/${slug}--${variant}`, { record: false, overridePublisher: true }).catch(() => {});
    const info = await probe(input(slug));
    if (progs.get(id) !== pr) return;
    if (!info) { pr.state = 'retrying'; pr.error = 'could not read the stream'; pr.next = Date.now() + 10000; return; }
    const port = Number(conf().rtmpPort) || 1935;
    pr.comp = makeCompositor(app, { slug, variant, input: input(slug), output: `rtmp://127.0.0.1:${port}/live/${slug}--${variant}?user=rfp&pass=${encodeURIComponent(conf().hookSecret || '')}`,
      ...info, state: await mcrState(stream), onLog: (m) => log(m), onEnd: () => { if (progs.get(id) === pr) { pr.state = 'retrying'; pr.comp = null; pr.next = Date.now() + 5000; } } });
    pr.state = 'live';
    log(`Restream ${slug}: making "${VARIANT_NAMES[variant]}" (${info.width}x${info.height} ${Math.round(info.fps)} fps)`);
  }
  function endProg(id) { const pr = progs.get(id); progs.delete(id); if (pr && pr.comp) pr.comp.stop(); }
  // master control changed: the programs of that stream follow
  app.on('doc', (doc) => {
    if (doc.type !== 'mcr' || !doc.data) return;
    for (const pr of progs.values()) if (pr.slug === doc.data.slug && pr.comp) app.streaming.prodById(doc.data.production).then((p) => p && mcrState(p)).then((x) => x && pr.comp && pr.comp.update(x)).catch(() => {});
  });

  function launch(run) {
    const args = ['-hide_banner', '-loglevel', 'error', '-rw_timeout', '15000000', '-i', input(run.variant ? `${run.slug}--${run.variant}` : run.slug), '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-f', 'flv', '-flvflags', 'no_duration_filesize', run.url];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    run.proc = proc; run.state = 'starting'; run.since = Date.now();
    let err = '';
    proc.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
    const ok = setTimeout(() => { if (run.proc === proc) { run.state = 'live'; run.tries = 0; run.error = ''; } }, 8000);
    proc.on('exit', (code) => {
      clearTimeout(ok);
      if (run.proc !== proc) return;
      run.proc = null;
      if (run.stopping) return;
      run.tries = (run.tries || 0) + 1;
      run.error = (err.trim().split('\n').pop() || `stopped (${code})`).replace(run.url, hideKey(run.url)).slice(0, 200);
      run.state = 'retrying';
      run.next = Date.now() + Math.min(60, 5 * 2 ** Math.min(4, run.tries - 1)) * 1000;
      log(`Restream ${run.slug} → ${run.name}: ${run.error}`);
    });
  }
  function end(id) {
    const run = runs.get(id);
    if (!run) return;
    run.stopping = true;
    runs.delete(id);
    if (run.proc) { try { run.proc.kill('SIGTERM'); } catch { /* gone */ } }
  }

  // follow what is live: start, retry (with a growing wait) and stop the copies
  async function check() {
    if (app.isLocal || !app.streaming.enabled() || !(await have())) return;
    const want = new Map(), wantProg = new Map();
    for (const s of await app.streaming.allStreams()) {
      const slug = s.data.streamSlug;
      if (!slug || !app.streaming.status(slug).live) continue;
      for (const d of destinationsOf(s)) if (d.on) { want.set(`${slug}|${d.i}`, { ...d, slug }); if (d.variant) wantProg.set(`${slug}--${d.variant}`, { stream: s, variant: d.variant }); }
    }
    const now = Date.now();
    for (const id of [...progs.keys()]) if (!wantProg.has(id)) endProg(id);
    for (const [id, w] of wantProg) {
      const pr = progs.get(id);
      if (!pr || (pr.state === 'retrying' && !pr.comp && (pr.next || 0) <= now)) startProg(id, w.stream, w.variant).catch((e) => log('Restream graphics:', e.message));
    }
    for (const [id, run] of runs) { const w = want.get(id); if (!w || w.url !== run.url || w.variant !== run.variant) end(id); }
    for (const [id, w] of want) {
      let run = runs.get(id);
      if (!run) { run = { slug: w.slug, name: w.name, url: w.url, variant: w.variant, tries: 0, next: 0, state: 'starting', error: '' }; runs.set(id, run); }
      run.name = w.name;
      // a destination with graphics waits for its program to be on the streaming server
      if (w.variant && !app.streaming.status(`${w.slug}--${w.variant}`).live) { if (!run.proc) run.state = 'preparing'; continue; }
      if (!run.proc && run.next <= now) launch(run);
    }
  }
  function start() { if (app.isLocal) return; timer = setInterval(() => check().catch((e) => log('Restream:', e.message)), 5000); timer.unref(); }
  function stop() { clearInterval(timer); for (const id of [...runs.keys()]) end(id); for (const id of [...progs.keys()]) endProg(id); }

  // for the Studio: each destination of a stream and how it is doing (keys never shown)
  function status(stream) {
    const slug = stream.data.streamSlug;
    return destinationsOf(stream).map((d) => {
      const run = runs.get(`${slug}|${d.i}`);
      const pr = d.variant ? progs.get(`${slug}--${d.variant}`) : null;
      return { name: d.name, on: d.on, server: hideKey(d.url), with: VARIANT_NAMES[d.variant] || VARIANT_NAMES[''], state: !d.on ? 'off' : run ? run.state : 'waiting',
        error: (run && run.error) || (pr && pr.error) || '', since: run && run.state === 'live' ? run.since : 0 };
    });
  }
  return { start, stop, check, status, running: () => [...runs.keys()], programs: () => [...progs.keys()] };
}

module.exports = { makeRestream, target, destinationsOf, hideKey };
