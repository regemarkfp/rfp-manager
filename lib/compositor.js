'use strict';
// Master control burnt into a restream: a copy of a live stream with some of what the app's viewers see on top of it
// (logos, lower thirds, slates, ad breaks), for a platform with its own player (YouTube, Facebook …).
//
// One "program" ffmpeg per stream and choice of graphics makes that copy and publishes it to the streaming server at
// live/<slug>--<variant>, where the restreams pick it up. When what is on changes (a slate, the next advert, new
// graphics) a new program ffmpeg is started with the new picture; the streaming server lets the new one take over the
// path (overridePublisher) and keeps the restreams connected meanwhile (alwaysAvailable), so the platforms see one
// steady stream. Logos that rotate, the ticker and countdowns move inside one program, without a change.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile, execFileSync } = require('node:child_process');
const { log } = require('./util');

// what a destination may show, beside the clean feed
const VARIANTS = {
  logos: { logos: true },
  graphics: { logos: true, lower: true },
  slates: { slates: true },
  'logos-slates': { logos: true, slates: true },
  'graphics-slates': { logos: true, lower: true, slates: true },
  ads: { ads: true },
  'ads-slates': { ads: true, slates: true },
  all: { logos: true, lower: true, slates: true, ads: true },
};
const VARIANT_NAMES = { '': 'Clean (as it comes in)', logos: 'Logos only', graphics: 'Logos + lower thirds', slates: 'Slates only', 'logos-slates': 'Logos + slates',
  'graphics-slates': 'Logos, lower thirds + slates', ads: 'Ads only', 'ads-slates': 'Ads + slates', all: 'Everything (graphics, slates, ads)' };
const FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'];
const font = () => FONTS.find((f) => fs.existsSync(f)) || '';
// ffmpeg 5.1 and later say -fps_mode, older ones -vsync
let fpsMode = null;
function cfr() {
  if (!fpsMode) { try { const m = /ffmpeg version n?(\d+)\.(\d+)/.exec(execFileSync('ffmpeg', ['-version'], { timeout: 5000 }).toString()); fpsMode = m && (+m[1] > 5 || (+m[1] === 5 && +m[2] >= 1)) ? ['-fps_mode', 'cfr'] : ['-vsync', '1']; } catch { fpsMode = ['-vsync', '1']; } }
  return fpsMode;
}

// what the program has to show now, for this variant: { kind: none | graphics | slate | ad, key, … }
function layerOf(x, v, now) {
  const ad = x && x.ad && Date.parse(x.ad.endsAt) > now ? x.ad : null;
  if (v.ads && ad) {
    let t = Date.parse(ad.startedAt);
    for (const it of ad.items) { const d = it.duration * 1000; if (now < t + d) return { kind: 'ad', id: it.id, off: Math.max(0, (now - t) / 1000), key: `ad|${ad.startedAt}|${it.id}|${t}` }; t += d; }
  }
  const sl = x && x.slate && (!x.slate.until || Date.parse(x.slate.until) > now) ? x.slate : null;
  if (v.slates && sl) return { kind: 'slate', slate: sl, key: 'slate|' + JSON.stringify([sl.kind, sl.title, sl.text, sl.music, sl.mute, sl.countTo, sl.since]) };
  const sq = x && x.squeeze && Date.parse(x.squeeze.endsAt) > now;
  const ovs = ((x && x.overlays) || []).filter((o) => o.on && ((v.logos && (o.kind === 'bug' || o.kind === 'image')) || (v.lower && (o.kind === 'lower' || o.kind === 'ticker'))));
  if (ovs.length && !sq) return { kind: 'graphics', overlays: ovs, key: 'gfx|' + JSON.stringify(ovs) };
  return { kind: 'none', key: 'none' };
}

// wraps text into lines of about n characters (drawtext does not wrap)
const wrap = (s, n) => { const out = []; let line = ''; for (const w of String(s || '').split(/\s+/)) { if ((line + ' ' + w).trim().length > n && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); } if (line) out.push(line); return out.join('\n'); };
const esc = (p) => String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

function makeCompositor(app, { slug, variant, input, output, width, height, fps, hasAudio, state, onLog, onEnd }) {
  const v = VARIANTS[variant] || {};
  const W = width & ~1, H = height & ~1, R = Math.max(10, Math.min(60, Math.round(fps) || 25));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-prog-'));
  let cur = state || {}, layer = null, proc = null, procInfo = null, ahead = null, older = [], stopping = false, seq = 0, aheadSeq = 0, restartT = null;
  const say = (m) => (onLog ? onLog(m) : log(m));

  // ---- the pieces
  async function imageFile(id) {
    if (!/^img_[\w-]+$/.test(String(id || ''))) return '';
    const f = path.join(tmp, id + '.img');
    if (fs.existsSync(f)) return f;
    const d = await app.store.get(id);
    if (!d || d.deleted || d.data.mime === 'image/svg+xml') return '';
    const buf = await app.blobs.get(d).catch(() => null);
    if (!buf) return '';
    fs.writeFileSync(f, buf);
    return f;
  }
  let tn = 0;
  const txt = (s) => { const f = path.join(tmp, `t${++tn}.txt`); fs.writeFileSync(f, String(s || '')); return f; };
  const dt = (text, o) => `drawtext=fontfile='${esc(font())}':textfile='${esc(txt(text))}':expansion=${o.exp ? 'normal' : 'none'}:fontcolor=${o.color || 'white'}:fontsize=${Math.round(o.size)}:x=${o.x}:y=${o.y}`
    + (o.box ? `:box=1:boxcolor=${o.box}:boxborderw=${Math.round(o.pad || 8)}` : '') + (o.shadow ? ':shadowcolor=black@0.7:shadowx=2:shadowy=2' : '');
  const soundCache = new Map();
  const hasSound = (file) => (soundCache.has(file) ? Promise.resolve(soundCache.get(file)) : new Promise((resolve) => execFile('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { timeout: 15000 }, (e, out) => { const yes = !e && /\d/.test(String(out)); soundCache.set(file, yes); resolve(yes); })));
  // the live stream (a new program starts sending at its next keyframe: OBS / vMix every 2 seconds)
  const liveIn = () => (/^(rtmp|srt|udp)/.test(input) ? ['-rw_timeout', '15000000', '-i', input] : ['-re', '-i', input]);

  // ffmpeg arguments for a layer: { ins, filter, v, a }
  async function build(L) {
    const ins = [], f = [];
    let n = 0, k = 0, last = '', audio = null;
    const add = (filter) => { const out = `[p${k++}]`; f.push(`${last}${filter}${out}`); last = out; };
    const input = (args) => { ins.push(...args); return n++; };
    const silence = () => `${input(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'])}:a`;

    if (L.kind === 'none' || L.kind === 'graphics') {
      const live = input(liveIn());
      last = `[${live}:v]`; add(`scale=${W}:${H},setsar=1,fps=${R}`);
      audio = hasAudio ? `${live}:a` : silence();
      for (const o of L.kind === 'graphics' ? L.overlays : []) {
        const corner = (ow, oh) => ({ tl: [`${W * 0.03}`, `${H * 0.04}`], tr: [`${W * 0.97}-${ow}`, `${H * 0.04}`], bl: [`${W * 0.03}`, `${H * 0.88}-${oh}`], br: [`${W * 0.97}-${ow}`, `${H * 0.88}-${oh}`] }[o.pos] || [`${W * 0.97}-${ow}`, `${H * 0.04}`]);
        let below = 0;
        if (o.kind === 'bug' || o.kind === 'image') {
          const hgt = Math.round(o.kind === 'bug' ? H * 0.07 : H * 0.25);
          const logos = [];
          for (const id of [o.image, ...(o.kind === 'bug' ? o.images || [] : [])].filter(Boolean)) { const file = await imageFile(id); if (file) logos.push(file); }
          // several logos take turns: each for `every` seconds, faded (or cut) in step with the clock
          const T = Math.max(3, o.every || 10), C = T * logos.length, s = Math.min(T / 3, o.transition === 'cut' ? 0.001 : o.speed || 0.8);
          const off = logos.length > 1 ? ((Date.now() / 1000) % C).toFixed(3) : 0;
          logos.forEach((file, i) => {
            const li = input(['-loop', '1', '-framerate', String(R), '-i', file]);
            let chain = `[${li}:v]scale=-2:${hgt},format=rgba`;
            if (logos.length > 1) {
              const m = `mod(T+${off}\\,${C})`, a0 = i * T, a1 = (i + 1) * T;
              chain += `,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='alpha(X\\,Y)*clip(min((${m}-${a0})/${s}\\,(${a1}-${m})/${s})\\,0\\,1)'`;
            }
            f.push(`${chain}[l${li}]`);
            const [x, y] = corner('overlay_w', 'overlay_h');
            const out = `[p${k++}]`; f.push(`${last}[l${li}]overlay=x=${x}:y=${y}:format=auto${out}`); last = out;
          });
          if (logos.length) below = hgt + Math.round(H * 0.008);
        }
        if (!font()) continue;
        if (o.kind === 'bug' && o.text) {
          const [x, y] = corner('tw', 'th');
          const top = (o.pos || 'tr')[0] === 't';
          add(dt(o.text, { size: H * 0.03, x, y: below ? (top ? `${H * 0.04 + below}` : `${y}-${below}`) : y, box: 'black@0.45', pad: H * 0.008, shadow: true }));
        }
        if (o.kind === 'lower' && o.text) {
          const right = o.pos === 'br' || o.pos === 'tr', x = right ? `${W * 0.96}-tw` : `${W * 0.04}`;
          add(dt(o.text, { size: H * 0.046, x, y: `${H * 0.88}-${o.sub ? H * 0.05 : 0}-th`, box: '0x0a0a0a@0.82', pad: H * 0.015 }));
          if (o.sub) add(dt(o.sub, { size: H * 0.032, color: '0xcfcfcf', x, y: `${H * 0.88}-th`, box: '0x0a0a0a@0.82', pad: H * 0.012 }));
        }
        if (o.kind === 'ticker' && o.text) {
          add(`drawbox=x=0:y=${Math.round(H * 0.935)}:w=${W}:h=${Math.round(H * 0.065)}:color=0x080808@0.85:t=fill`);
          add(dt(o.text + (o.sub ? '   •   ' + o.sub : ''), { size: H * 0.034, x: `w-mod(t*${Math.round(W / 8)}\\,w+tw)`, y: `${H * 0.9675}-th/2` }));
        }
      }
      return { ins, filter: f.join(';'), v: last, a: audio };
    }
    if (L.kind === 'slate') {
      const s = L.slate, ch = cur.channel || {};
      const bg = input(['-re', '-f', 'lavfi', '-i', `color=c=0x0d1016:s=${W}x${H}:r=${R}`]);
      last = `[${bg}:v]`;
      // a hint of colour bars across the top, a thin strip along the bottom
      ['0xc0c0c0', '0xc0c000', '0x00c0c0', '0x00c000', '0xc000c0', '0xc00000', '0x0000c0'].forEach((c, i) => {
        add(`drawbox=x=${Math.round((W * i) / 7)}:y=0:w=${Math.ceil(W / 7)}:h=${Math.round(H * 0.66)}:color=${c}@0.05:t=fill`);
        add(`drawbox=x=${Math.round((W * i) / 7)}:y=${H - Math.max(2, Math.round(H * 0.007))}:w=${Math.ceil(W / 7)}:h=${Math.max(2, Math.round(H * 0.007))}:color=${c}@0.55:t=fill`);
      });
      const titleY = H * (s.countTo ? 0.42 : 0.5);
      const brand = path.join(app.root || '.', 'public', 'brand', 'rfp-logo.png');
      const logo = (await imageFile(ch.logo)) || (fs.existsSync(brand) ? brand : '');
      if (logo) {
        const li = input(['-loop', '1', '-framerate', String(R), '-i', logo]);
        f.push(`[${li}:v]scale=-2:${Math.round(H * 0.18)},format=rgba[lg]`);
        const out = `[p${k++}]`; f.push(`${last}[lg]overlay=x=(main_w-overlay_w)/2:y=${Math.round(titleY - H * 0.24)}${out}`); last = out;
      }
      if (font()) {
        add(dt(s.title || 'Please stand by', { size: H * 0.07, x: '(w-tw)/2', y: `${titleY}`, shadow: true }));
        if (s.countTo) {
          const left = Math.max(0, Math.round((Date.parse(s.countTo) - Date.now()) / 1000));
          const hh = left >= 3600 ? `%{eif:max(0,floor((${left}-t)/3600)):d}:` : '';
          add(dt(`${hh}%{eif:max(0,floor(mod(${left}-t,3600)/60)):d:2}:%{eif:max(0,mod(floor(${left}-t),60)):d:2}`, { exp: true, size: H * 0.17, x: '(w-tw)/2', y: `${titleY + H * 0.1}`, shadow: true }));
        } else if (s.text) add(dt(wrap(s.text, 56), { size: H * 0.036, color: '0xcfcfcf', x: '(w-tw)/2', y: `${titleY + H * 0.1}` }));
      }
      // the sound under it: the slate music, else the live sound (unless muted), else silence
      const music = s.music ? app.mcr.adFile(String(s.music).replace(/^\/ads\/|\.mp4$/g, '')) : null;
      if (music && fs.existsSync(music)) audio = `${input(['-stream_loop', '-1', '-re', '-i', music])}:a`;
      else if (hasAudio && !s.mute) audio = `${input(liveIn())}:a`;
      else audio = silence();
      return { ins, filter: f.join(';'), v: last, a: audio };
    }
    if (L.kind === 'ad') {
      const file = app.mcr.adFile(L.id);
      if (!file || !fs.existsSync(file)) return null;
      const ai = input(['-ss', L.off.toFixed(2), '-re', '-i', file]);
      last = `[${ai}:v]`;
      // the last picture stays (and the sound goes quiet) after the advert's end, until what comes next has taken over
      add(`scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${R},tpad=stop_mode=clone:stop_duration=8,realtime`);
      if (await hasSound(file)) { f.push(`[${ai}:a]apad=pad_dur=8,arealtime[adpad]`); audio = 'adpad'; } else audio = silence();
      return { ins, filter: f.join(';'), v: last, a: audio };
    }
    return null;
  }

  // ---- the output: one steady FLV stream to the streaming server. Each program writes FLV to Node; Node passes on
  // the program on the air, switches to a new one at its first keyframe and rewrites the timestamps so they run on.
  const pub = spawn('ffmpeg', ['-hide_banner', '-loglevel', process.env.RFP_COMP_DEBUG ? 'info' : 'error', '-f', 'flv', '-i', 'pipe:0', '-c', 'copy', '-f', 'flv', output], { stdio: ['pipe', 'ignore', 'pipe'] });
  let pubErr = '';
  pub.stderr.on('data', (d) => { pubErr = (pubErr + d).slice(-1000); if (process.env.RFP_COMP_DEBUG) process.stderr.write('[pub] ' + String(d).replace(/\r/g, '\n')); });
  pub.stdin.on('error', () => {});
  pub.on('exit', (code) => { if (!stopping) { say(`Restream graphics ${slug} (${variant}): the output stopped (${code}) ${pubErr.trim().split('\n').pop() || ''}`); stop(); if (onEnd) onEnd(); } });
  const sw = { started: false, active: null, lastTs: 0, sentMeta: false };
  const tagHead = (type, size, ts) => { const h = Buffer.alloc(11); h[0] = type; h.writeUIntBE(size, 1, 3); h.writeUIntBE(ts & 0xffffff, 4, 3); h[7] = (ts >>> 24) & 0xff; return h; };
  function emit(type, body, ts) {
    if (pub.stdin.destroyed) return;
    if (!sw.started) { const hd = Buffer.from([0x46, 0x4c, 0x56, 1, 5, 0, 0, 0, 9, 0, 0, 0, 0]); if (process.env.RFP_COMP_DUMP) fs.writeFileSync(process.env.RFP_COMP_DUMP, hd); pub.stdin.write(hd); sw.started = true; }
    const t = Math.max(0, Math.round(ts));
    const tail = Buffer.alloc(4); tail.writeUInt32BE(11 + body.length);
    const out = Buffer.concat([tagHead(type, body.length, t), body, tail]);
    if (process.env.RFP_COMP_DUMP) fs.appendFileSync(process.env.RFP_COMP_DUMP, out);
    pub.stdin.write(out);
    if (t > sw.lastTs) sw.lastTs = t;
  }
  // a program's FLV, tag by tag: { buf, header, seqV, seqA, base, first }
  function feed(me, chunk) {
    me.buf = me.buf.length ? Buffer.concat([me.buf, chunk]) : chunk;
    let o = 0;
    if (!me.header) { if (me.buf.length < 13) return; me.header = true; o = 13; }
    while (me.buf.length - o >= 15) {
      const type = me.buf[o], size = me.buf.readUIntBE(o + 1, 3), ts = me.buf.readUIntBE(o + 4, 3) | (me.buf[o + 7] << 24);
      if (me.buf.length - o < 11 + size + 4) break;
      const body = me.buf.subarray(o + 11, o + 11 + size);
      o += 11 + size + 4;
      tag(me, type, body, ts);
    }
    me.buf = me.buf.subarray(o);
  }
  function tag(me, type, body, ts) {
    if (me.dead) return;
    const seqV = type === 9 && body[1] === 0, seqA = type === 8 && (body[0] >> 4) === 10 && body[1] === 0;
    if (type === 18) { if (!sw.sentMeta) { sw.sentMeta = true; emit(18, Buffer.from(body), 0); } return; }
    if (seqV) { me.seqV = Buffer.from(body); return; }
    if (seqA) { me.seqA = Buffer.from(body); return; }
    if (sw.active !== me) {
      // not on the air yet: it goes on at its first keyframe (with its own decoder settings sent first) — one started
      // ahead of an advert's or a slate's end waits for that moment
      const key = type === 9 && (body[0] >> 4) === 1 && body[1] === 1;
      if (!key || !me.seqV || Date.now() < (me.notBefore || 0)) return;
      me.base = sw.started ? sw.lastTs + Math.round(1000 / R) : 0;
      me.first = ts;
      const prev = sw.active; sw.active = me;
      if (me.seqV) emit(9, me.seqV, me.base);
      if (me.seqA) emit(8, me.seqA, me.base);
      onAir(me, prev);
    }
    if (type === 8 && ts < me.first) return;
    emit(type, Buffer.from(body), me.base + ts - me.first);
  }

  // ---- the programs: one for every change; the newest goes on the air when it is ready
  const kbps = H >= 1000 ? 6000 : H >= 700 ? 4500 : 2500;
  const dbg = (m) => { if (process.env.RFP_COMP_DEBUG) process.stderr.write(`[prog ${((Date.now() % 100000) / 1000).toFixed(1)}] ${m}\n`); };
  function onAir(me, prev) {
    dbg('on air: ' + me.key.slice(0, 40));
    // on the air: the ones before it stop
    const gone = older; older = [];
    for (const o of gone) { o.dead = true; try { o.p.kill('SIGKILL'); } catch { /* gone */ } }
    if (prev && prev !== me) { prev.dead = true; try { prev.p.kill('SIGKILL'); } catch { /* gone */ } }
  }
  async function show(L, notBefore = 0) {
    if (!notBefore) layer = L;
    const my = notBefore ? ++aheadSeq : ++seq, mine = () => (notBefore ? my === aheadSeq : my === seq);
    let b = await build(L).catch((e) => { say(`Restream graphics ${slug}: ${e.message}`); return null; });
    if (!mine() || stopping) return;
    if (!b) b = await build({ kind: 'none', key: 'none' });
    if (!mine() || stopping) return;
    const args = ['-hide_banner', '-loglevel', 'error', ...b.ins,
      '-filter_complex', `${b.filter};${b.v}format=yuv420p[vout];[${b.a}]aresample=48000:async=1000,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`,
      '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', ...cfr(), '-r', String(R), '-g', String(R * 2),
      '-b:v', kbps + 'k', '-maxrate', kbps + 'k', '-bufsize', kbps * 2 + 'k', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-flvflags', 'no_duration_filesize', '-f', 'flv', 'pipe:1'];
    const kill = (o) => { if (o && o !== sw.active) { o.dead = true; try { o.p.kill('SIGKILL'); } catch { /* gone */ } } };
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    dbg(`start ${notBefore ? 'ahead ' : ''}${L.key.slice(0, 40)}`);
    const me = { p, buf: Buffer.alloc(0), header: false, dead: false, key: L.key, notBefore };
    if (notBefore) { kill(ahead); ahead = me; }                     // started ahead of a change; the current one stays
    else {
      // the one on the air keeps going until this one has its first picture; one still starting is no longer wanted
      for (const o of older) kill(o);
      older = older.filter((o) => o === sw.active);
      kill(ahead); ahead = null;
      if (procInfo && procInfo !== sw.active) kill(procInfo); else if (procInfo) older.push(procInfo);
      proc = p; procInfo = me;
    }
    p.stdout.on('data', (c) => feed(me, c));
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
    p.on('exit', (code) => {
      dbg(`exit ${code} ${L.key.slice(0, 30)} ${me.dead ? '(stopped)' : ''} ${err.trim().split('\n').pop() || ''}`);
      if (ahead === me) { ahead = null; return; }
      if (procInfo !== me || stopping || me.dead) return;
      proc = null;
      say(`Restream graphics ${slug} (${variant}) stopped (${code})${err ? ': ' + err.trim().split('\n').pop() : ''}`);
      clearTimeout(restartT);
      restartT = setTimeout(() => { if (!stopping) { layer = null; check(); } }, 2000);       // started again (an advert that ended, a hiccup)
    });
  }

  // what should be on now; and what comes next within a few seconds (an advert's or a slate's end, the next advert):
  // that program is started ahead, so it is ready (and waiting) at that moment
  const AHEAD = 5000;
  const check = () => {
    if (stopping) return;
    const now = Date.now(), L = layerOf(cur, v, now);
    if (!layer || L.key !== layer.key) {
      if (ahead && !ahead.dead && ahead.key === L.key) {                 // started ahead: it goes on now
        layer = L; ahead.notBefore = now;
        if (procInfo && procInfo !== sw.active) { procInfo.dead = true; try { procInfo.p.kill('SIGKILL'); } catch { /* gone */ } } else if (procInfo) older.push(procInfo);
        procInfo = ahead; proc = ahead.p; ahead = null;
        return;
      }
      show(L); return;
    }
    if ((L.kind === 'ad' || L.kind === 'slate') && procInfo && procInfo.key === L.key && sw.active === procInfo) {
      let t = now + 250;
      while (t <= now + AHEAD && layerOf(cur, v, t).key === L.key) t += 250;
      if (t <= now + AHEAD) {
        const N = layerOf(cur, v, t + 300);
        if (!(ahead && ahead.key === N.key)) show(N, t);
      }
    }
  };
  const timer = setInterval(check, 500);
  check();

  function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer); clearTimeout(restartT);
    for (const p of [proc, ahead && ahead.p, ...older.map((o) => o.p)].filter(Boolean)) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
    try { pub.stdin.end(); } catch { /* closed */ }
    setTimeout(() => { try { pub.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref();
    setTimeout(() => fs.rmSync(tmp, { recursive: true, force: true }), 5000).unref();
  }
  return { update: (s) => { cur = s || {}; check(); }, stop, layer: () => layer, running: () => !!proc && !stopping };
}

// the choice on a destination (the label in the form, or the key) → the variant key ('' = clean)
const variantOf = (x) => { const s = String(x || '').trim(); if (VARIANTS[s]) return s; const k = Object.keys(VARIANT_NAMES).find((n) => VARIANT_NAMES[n] === s); return k || ''; };

module.exports = { makeCompositor, layerOf, variantOf, VARIANTS, VARIANT_NAMES };
