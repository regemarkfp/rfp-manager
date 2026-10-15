'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { ffmpegArgs, viewerPlaylist, tracksOf } = require('../lib/multiaudio');

const rows = [{ channels: '1+2', name: 'ENGLISH', language: 'English' }, { channels: '3+4', name: 'FX' }, { channels: '5+6', name: 'AFRIKAANS', language: 'Afrikaans' },
  { channels: '7+8', name: 'DIRECTOR', audience: 'Production team' }, { channels: '9+10', name: 'SPARE', audience: 'Nobody' }];
const ids = ['a000000000001', 'a000000000002', 'a000000000003', 'a000000000004'];

test('audio tracks: rows, ffmpeg arguments for separate tracks and for one 8-channel track', () => {
  const t = tracksOf({ data: { streamAudio: rows } });
  assert.deepEqual(t.map((x) => [x.pair, x.name, x.lang, x.audience]), [[0, 'ENGLISH', 'en', 'Everyone'], [1, 'FX', '', 'Everyone'], [2, 'AFRIKAANS', 'af', 'Everyone'], [3, 'DIRECTOR', '', 'Production team']], 'Nobody is not streamed');
  const sep = ffmpegArgs('in.ts', '/out', t, { streams: 4, channels: 2 }, ids);
  assert.equal(sep.used.length, 4);
  assert.ok(sep.args.join(' ').includes('-map 0:a:2'));
  assert.ok(!sep.args.includes('-filter_complex'));
  const one = ffmpegArgs('in.ts', '/out', t, { streams: 1, channels: 8 }, ids);
  assert.match(one.args[one.args.indexOf('-filter_complex') + 1], /\[0:a:0\]pan=stereo\|c0=c4\|c1=c5\[a2\]/);
  assert.match(one.args[one.args.indexOf('-var_stream_map') + 1], /^v:0,agroup:aud,name:video a:0,agroup:aud,name:a000000000001,language:en,default:yes/);
  // a stereo-only stream: just the first pair
  assert.equal(ffmpegArgs('in.ts', '/out', t, { streams: 1, channels: 2 }, ids).used.length, 1);
  assert.equal(ffmpegArgs('in.ts', '/out', t, { streams: 2, channels: 2 }, ids).used.length, 2);
});

test('audio tracks: the playlist a viewer gets has the real names, and team-only tracks only for the team', () => {
  const master = ['#EXTM3U', '#EXT-X-VERSION:6',
    ...ids.map((id, i) => `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_aud",NAME="audio_${i + 1}",DEFAULT=${i ? 'NO' : 'YES'},URI="${id}/index.m3u8"`),
    '#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.64001f,mp4a.40.2",AUDIO="group_aud"', 'video/index.m3u8'].join('\n');
  const used = tracksOf({ data: { streamAudio: rows } }).map((x, i) => ({ ...x, id: ids[i] }));
  const pub = viewerPlaylist(master, used, false);
  assert.deepEqual([...pub.matchAll(/NAME="([^"]+)"/g)].map((m) => m[1]), ['ENGLISH', 'FX', 'AFRIKAANS']);
  assert.ok(!pub.includes(ids[3]), 'the director is not there for viewers');
  assert.match(pub, /NAME="ENGLISH",DEFAULT=YES,AUTOSELECT=YES/);
  const team = viewerPlaylist(master, used, true);
  assert.ok(team.includes('NAME="DIRECTOR"'));
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('audio tracks: ffmpeg turns an 8-channel stream into 4 stereo HLS tracks', { skip: !hasFfmpeg && 'no ffmpeg here' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-ma-'));
  const input = path.join(dir, 'in.ts');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=f=440:d=5', '-filter_complex', '[1:a]asplit=8[a][b][c][d][e][f][g][h];[a][b][c][d][e][f][g][h]amerge=inputs=8[m]',
    '-map', '0:v', '-map', '[m]', '-t', '5', '-c:v', 'libx264', '-g', '50', '-c:a', 'aac', '-ac', '8', input]);
  const t = tracksOf({ data: { streamAudio: rows } });
  const out = path.join(dir, 'out');
  const { args, used } = ffmpegArgs(input, out, t, { streams: 1, channels: 8 }, ids);
  for (const v of ['video', ...used.map((x) => x.id)]) fs.mkdirSync(path.join(out, v), { recursive: true });
  execFileSync('ffmpeg', args);
  const master = fs.readFileSync(path.join(out, 'master.m3u8'), 'utf8');
  assert.equal((master.match(/TYPE=AUDIO/g) || []).length, 4);
  const seg = fs.readdirSync(path.join(out, ids[2])).find((f) => f.endsWith('.ts'));
  assert.equal(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=channels', '-of', 'csv=p=0', path.join(out, ids[2], seg)]).toString().split(/\s+/).filter(Boolean)[0], '2');
  fs.rmSync(dir, { recursive: true, force: true });
});
