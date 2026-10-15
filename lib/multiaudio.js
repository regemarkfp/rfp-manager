'use strict';
// Several audio tracks on one stream (languages, an FX mix, a director's feed): while a production with audio
// tracks set up (production.streamAudio) is live, the website runs ffmpeg on it. ffmpeg reads the stream from the
// streaming server over SRT (MPEG-TS keeps every audio track), copies the video and makes a stereo AAC rendition per
// row, as HLS with alternate audio. The pairs come in either as separate audio tracks (track 1 = 1+2, track 2 = 3+4 …,
// what OBS / vMix send over SRT) or as one track with all the channels (an 8-channel feed), split into pairs.
// The playlist each viewer gets lists only the tracks they may hear: Everyone, Production team, or Nobody.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { log } = require('./util');

const PAIRS = ['1+2', '3+4', '5+6', '7+8', '9+10', '11+12', '13+14', '15+16'];
const LANG = { English: 'en', Afrikaans: 'af', isiZulu: 'zu', isiXhosa: 'xh', Sesotho: 'st', Setswana: 'tn', Sepedi: 'nso', Xitsonga: 'ts', siSwati: 'ss', Tshivenda: 've', isiNdebele: 'nr', Portuguese: 'pt', French: 'fr', German: 'de', Spanish: 'es' };

// the rows that play: in order, with a pair index, name and audience
function tracksOf(prod) {
  return (prod.data.streamAudio || []).map((r, i) => ({ pair: Math.max(0, PAIRS.indexOf(r.channels || PAIRS[i] || '1+2')), name: String(r.name || '').trim().slice(0, 40) || `Track ${i + 1}`, lang: LANG[r.language] || '', audience: ['Everyone', 'Production team', 'Nobody'].includes(r.audience) ? r.audience : 'Everyone' }))
    .filter((t) => t.audience !== 'Nobody');
}

// the ffmpeg arguments. probe: { streams: audio stream count, channels: channels of the first audio stream }
function ffmpegArgs(input, outDir, tracks, probe, ids) {
  const args = ['-hide_banner', '-loglevel', 'warning', '-fflags', '+genpts', '-i', input, '-map', '0:v:0', '-c:v', 'copy'];
  const filters = [], maps = [], used = [];
  tracks.forEach((t, i) => {
    if (probe.streams > 1) {                               // separate tracks: pair n = audio track n
      if (t.pair >= probe.streams) return;
      maps.push(['-map', `0:a:${t.pair}`]);
    } else {                                                // one track with all the channels
      const a = t.pair * 2, b = a + 1;
      if (b >= Math.max(2, probe.channels)) { if (t.pair > 0) return; }
      if (probe.channels <= 2 && t.pair === 0) maps.push(['-map', '0:a:0']);
      else { filters.push(`[0:a:0]pan=stereo|c0=c${a}|c1=c${b}[a${i}]`); maps.push(['-map', `[a${i}]`]); }
    }
    used.push({ ...t, id: ids[i] });
  });
  if (filters.length) args.push('-filter_complex', filters.join(';'));
  for (const m of maps) args.push(...m);
  used.forEach((t, i) => args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, '128k', `-ac:a:${i}`, '2', `-ar:a:${i}`, '48000'));
  const vsm = ['v:0,agroup:aud,name:video', ...used.map((t, i) => `a:${i},agroup:aud,name:${t.id}${t.lang ? ',language:' + t.lang : ''}${i === 0 ? ',default:yes' : ''}`)].join(' ');
  args.push('-f', 'hls', '-hls_time', '2', '-hls_list_size', '8', '-hls_flags', 'delete_segments+independent_segments+omit_endlist', '-hls_segment_type', 'mpegts',
    '-master_pl_name', 'master.m3u8', '-hls_segment_filename', path.join(outDir, '%v', 's%05d.ts'), '-var_stream_map', vsm, path.join(outDir, '%v', 'index.m3u8'));
  return { args, used };
}

// the master playlist a viewer gets: real names, and only the tracks they may hear (the team: all)
function viewerPlaylist(text, used, team) {
  const byId = new Map(used.map((t) => [t.id, t]));
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (line.startsWith('#EXT-X-MEDIA:') && /TYPE=AUDIO/.test(line)) {
      const m = /URI="([^"/]+)\//.exec(line), t = m && byId.get(m[1]);
      if (!t) continue;
      if (t.audience !== 'Everyone' && !team) continue;
      out.push(line.replace(/NAME="[^"]+"/, `NAME="${t.name.replace(/"/g, "'")}"`));
      continue;
    }
    out.push(line);
  }
  // the first track a viewer may hear plays first
  let seen = false;
  return out.map((l) => {
    if (!l.startsWith('#EXT-X-MEDIA:') || !/TYPE=AUDIO/.test(l)) return l;
    const d = seen ? 'NO' : 'YES'; seen = true;
    return l.replace(/DEFAULT=(YES|NO)/, `DEFAULT=${d}`).replace(/,AUTOSELECT=(YES|NO)/, '').replace(/DEFAULT=(YES|NO)/, `$&,AUTOSELECT=${d}`);
  }).join('\n');
}

function makeMultiAudio(app) {
  const conf = () => app.config.streaming || {};
  const root = () => path.resolve(app.root || '.', app.config.dataDir || 'data', 'multiaudio');
  const runs = new Map();          // slug → { proc, dir, used, prodId, since, stopping, backoff }
  let ffmpeg = null;               // true / false once known

  const have = () => new Promise((resolve) => { if (ffmpeg !== null) return resolve(ffmpeg); execFile('ffmpeg', ['-version'], (e) => { ffmpeg = !e; if (e) log('Audio tracks: ffmpeg is not installed on this server (apt install ffmpeg)'); resolve(ffmpeg); }); });
  const srtIn = (slug) => {
    const port = Number(conf().srtPort) || 8890;
    return `srt://127.0.0.1:${port}?streamid=read:live/${slug}:rfp:${encodeURIComponent(conf().hookSecret || '')}&latency=200000&mode=caller`;
  };
  const probe = (input) => new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-rw_timeout', '15000000', '-analyzeduration', '5000000', '-show_entries', 'stream=codec_type,channels', '-of', 'json', input], { timeout: 25000 }, (e, out) => {
      if (e) return resolve(null);
      try { const a = (JSON.parse(out).streams || []).filter((x) => x.codec_type === 'audio'); resolve({ streams: a.length, channels: Number((a[0] || {}).channels) || 2 }); } catch { resolve(null); }
    });
  });

  async function startRun(slug, prod) {
    if (runs.has(slug) || !(await have())) return;
    const tracks = tracksOf(prod);
    if (tracks.length < 1) return;
    const run = { dir: path.join(root(), slug), used: [], prodId: prod.id, since: Date.now(), stopping: false, proc: null, sig: JSON.stringify(tracks) };
    runs.set(slug, run);
    const p = await probe(srtIn(slug));
    if (run.stopping) return;
    if (!p || !p.streams) { log(`Audio tracks for ${slug}: could not read the stream yet; trying again`); runs.delete(slug); return; }
    fs.rmSync(run.dir, { recursive: true, force: true });
    const ids = tracks.map(() => 'a' + crypto.randomBytes(6).toString('hex'));
    const { args, used } = ffmpegArgs(srtIn(slug), run.dir, tracks, p, ids);
    if (!used.length) { log(`Audio tracks for ${slug}: the stream has no audio for the pairs set up`); runs.delete(slug); return; }
    for (const v of ['video', ...used.map((t) => t.id)]) fs.mkdirSync(path.join(run.dir, v), { recursive: true });
    run.used = used;
    log(`Audio tracks for ${slug}: ${used.map((t) => `${PAIRS[t.pair]} ${t.name}`).join(', ')} (${p.streams > 1 ? p.streams + ' tracks in' : p.channels + ' channels in one track'})`);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    run.proc = proc;
    let err = '';
    proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    proc.on('exit', (code) => {
      if (runs.get(slug) === run) runs.delete(slug);
      if (!run.stopping) log(`Audio tracks for ${slug} stopped (${code})${err ? ': ' + err.trim().split('\n').pop() : ''}`);
      fs.rmSync(run.dir, { recursive: true, force: true });
    });
  }
  function stopRun(slug) {
    const run = runs.get(slug);
    if (!run) return;
    run.stopping = true;
    runs.delete(slug);
    if (run.proc) { try { run.proc.kill('SIGTERM'); } catch { /* gone */ } }
    else fs.rmSync(run.dir, { recursive: true, force: true });
  }

  // follow what is live: start for productions with audio tracks, stop when they end or the tracks are cleared
  async function check() {
    if (app.isLocal || !app.streaming.enabled()) return;
    for (const p of await app.store.listType('production')) {
      const slug = p.data.streamSlug;
      if (p.deleted || !slug) continue;
      const live = app.streaming.status(slug).live;
      const want = live && tracksOf(p).length > 0;
      const run = runs.get(slug);
      if (want && !run) startRun(slug, p).catch((e) => log('Audio tracks:', e.message));
      else if (!want && run) stopRun(slug);
      else if (want && run && run.proc && run.sig !== JSON.stringify(tracksOf(p))) stopRun(slug);      // tracks changed: starts again next round
    }
  }
  let timer = null;
  function start() { if (app.isLocal) return; timer = setInterval(() => check().catch(() => {}), 5000); timer.unref(); }
  function stop() { clearInterval(timer); for (const slug of [...runs.keys()]) stopRun(slug); }

  // for the watch page: what it can choose (the names viewers see) once the first segments are there
  function info(slug, team) {
    const run = runs.get(slug);
    if (!run || !run.used.length) return null;
    if (!fs.existsSync(path.join(run.dir, 'master.m3u8'))) return null;
    const tracks = run.used.filter((t) => team || t.audience === 'Everyone');
    if (!tracks.length) return null;
    return { hls: `/mhls/${slug}/master.m3u8`, tracks: tracks.map((t) => ({ name: t.name, lang: t.lang, team: t.audience !== 'Everyone' })) };
  }
  // the files: the master playlist per viewer, the rest as they are
  function file(slug, rel, team) {
    const run = runs.get(slug);
    if (!run) return null;
    const clean = String(rel || '').replace(/\\/g, '/');
    if (!/^(master\.m3u8|(video|a[0-9a-f]{12})\/(index\.m3u8|s\d{5}\.ts))$/.test(clean)) return null;
    const dir = clean.split('/')[0];
    if (dir !== 'master.m3u8' && dir !== 'video') { const t = run.used.find((x) => x.id === dir); if (!t || (t.audience !== 'Everyone' && !team)) return null; }
    const f = path.join(run.dir, clean);
    if (!fs.existsSync(f)) return null;
    if (clean === 'master.m3u8') return { type: 'application/vnd.apple.mpegurl', body: viewerPlaylist(fs.readFileSync(f, 'utf8'), run.used, team) };
    return { type: clean.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl', body: fs.readFileSync(f) };
  }
  return { start, stop, check, info, file, running: () => [...runs.keys()] };
}

module.exports = { makeMultiAudio, ffmpegArgs, viewerPlaylist, tracksOf, PAIRS };
