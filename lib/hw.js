'use strict';
// MIDI and X-keys on the production PC itself, with nothing to install (like vMix, set up in Settings → Connections).
//   Windows: tools/rfp-hw.ps1 (PowerShell, which every Windows has) talks to winmm.dll and hid.dll and passes
//            MIDI messages and X-keys reports over stdin / stdout.
//   Linux:   the raw devices: /dev/snd/midiC*D* for MIDI, /dev/hidraw* for X-keys (the user needs read/write access).
// Events: 'midi' { port, bytes }   'hid' { id, name, bytes }   'ports'   'status'
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { log } = require('./util');

const XKEYS_VENDOR = 0x05f3;

function makeHw(app) {
  const ev = new EventEmitter();
  let ports = { midiIn: [], midiOut: [], hid: [] }, ok = false, error = '', running = false, child = null, restartT = null, scanT = null, backoff = 2000;
  const linux = { midi: new Map(), hid: new Map() };
  const setStatus = (o, e) => { if (o !== ok || e !== error) { ok = o; error = e; ev.emit('status'); } };
  const setPorts = (p) => { ports = { midiIn: p.midiIn || [], midiOut: p.midiOut || [], hid: p.hid || [] }; ev.emit('ports'); ev.emit('status'); };

  // ---------------------------------------------------------------- Windows: the PowerShell helper
  function helperCommand() {
    const c = app.config.hwHelper;                 // for tests (and anyone who wants their own helper): ["node", "my-helper.js"]
    if (Array.isArray(c) && c.length) return c;
    return ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(app.root || path.join(__dirname, '..'), 'tools', 'rfp-hw.ps1')];
  }
  function startHelper() {
    const [cmd, ...args] = helperCommand();
    let buf = '', errText = '';
    try { child = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { setStatus(false, 'Could not start the MIDI / X-keys helper: ' + e.message); later(); return; }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/^﻿/, '').trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.t === 'midi') ev.emit('midi', { port: m.port || '', bytes: m.d || [] });
        else if (m.t === 'hid') { const x = ports.hid.find((y) => y.id === m.id); ev.emit('hid', { id: m.id, name: x ? x.name : 'X-keys', bytes: m.d || [] }); }
        else if (m.t === 'ports') { backoff = 2000; setStatus(true, ''); setPorts(m); }
        else if (m.t === 'log') log('MIDI / X-keys:', m.m);
        else if (m.t === 'fatal') { errText = m.m || ''; setStatus(false, 'The MIDI / X-keys helper could not start: ' + errText); }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { errText = (errText + d).slice(-600); });
    child.on('error', (e) => { setStatus(false, (e.code === 'ENOENT' ? 'PowerShell was not found' : e.message)); });
    child.on('exit', (code) => {
      child = null;
      if (!running) return;
      setStatus(false, 'The MIDI / X-keys helper stopped' + (errText ? ': ' + errText.replace(/\s+/g, ' ').trim().slice(0, 300) : code ? ' (code ' + code + ')' : ''));
      setPorts({});
      later();
    });
  }
  function later() { clearTimeout(restartT); if (!running) return; restartT = setTimeout(() => { if (running && !child) startHelper(); }, backoff); restartT.unref(); backoff = Math.min(30000, backoff * 2); }
  const toHelper = (line) => { if (child && child.stdin.writable) child.stdin.write(line + '\n'); else throw new Error('The MIDI / X-keys helper is not running' + (error ? ' (' + error + ')' : '')); };

  // ---------------------------------------------------------------- Linux: raw MIDI and hidraw device files
  const devDir = () => app.config.hwDevDir || '/dev';      // tests point this at a folder of FIFOs
  const sysDir = () => app.config.hwSysDir || '/sys/class';
  function midiName(file) {
    const m = /^midiC(\d+)D(\d+)$/.exec(file); if (!m) return file;
    try { const id = fs.readFileSync(`/proc/asound/card${m[1]}/id`, 'utf8').trim(); return m[2] === '0' ? id : `${id} ${Number(m[2]) + 1}`; } catch { return file; }
  }
  function hidInfo(file) {
    try {
      const u = fs.readFileSync(path.join(sysDir(), 'hidraw', file, 'device', 'uevent'), 'utf8');
      const id = /HID_ID=\w+:(\w+):(\w+)/.exec(u), name = /HID_NAME=(.*)/.exec(u);
      return { vendor: id ? parseInt(id[1], 16) : 0, pid: id ? parseInt(id[2], 16) : 0, name: name ? name[1].trim() : file };
    } catch { return null; }
  }
  function openStream(file, onData, onEnd) {
    const st = fs.createReadStream(path.join(devDir(), file), { highWaterMark: 64 });
    st.on('data', onData); st.on('error', onEnd); st.on('close', onEnd);
    return st;
  }
  function scanLinux() {
    let files = [];
    try { files = fs.readdirSync(path.join(devDir(), 'snd')).filter((f) => /^midiC\d+D\d+$/.test(f)).map((f) => 'snd/' + f); } catch { /* no sound devices */ }
    let changed = false;
    for (const f of files) {
      if (linux.midi.has(f)) continue;
      const name = midiName(path.basename(f));
      const parser = midiParser((bytes) => ev.emit('midi', { port: name, bytes }));
      const x = { name, file: f, st: null, out: null };
      try { x.out = fs.openSync(path.join(devDir(), f), fs.constants.O_WRONLY | fs.constants.O_NONBLOCK); } catch { x.out = null; }
      x.st = openStream(f, (d) => parser(d), () => { if (linux.midi.get(f) === x) { linux.midi.delete(f); try { if (x.out !== null) fs.closeSync(x.out); } catch { /* closed */ } publishLinux(); } });
      linux.midi.set(f, x); changed = true;
    }
    let hids = [];
    try { hids = fs.readdirSync(devDir()).filter((f) => /^hidraw\d+$/.test(f)); } catch { /* none */ }
    for (const f of hids) {
      if (linux.hid.has(f)) continue;
      const info = hidInfo(f);
      if (!info || info.vendor !== XKEYS_VENDOR) continue;
      const x = { id: 'h-' + f, file: f, name: info.name, pid: info.pid, st: null, out: null };
      try { x.out = fs.openSync(path.join(devDir(), f), fs.constants.O_WRONLY | fs.constants.O_NONBLOCK); } catch { x.out = null; }
      try { x.st = openStream(f, (d) => ev.emit('hid', { id: x.id, name: x.name, bytes: [...d] }), () => { if (linux.hid.get(f) === x) { linux.hid.delete(f); try { if (x.out !== null) fs.closeSync(x.out); } catch { /* closed */ } publishLinux(); } }); }
      catch (e) { log('X-keys', f, e.message); continue; }
      linux.hid.set(f, x); changed = true;
    }
    if (changed || !ok) { setStatus(true, ''); publishLinux(); }
  }
  function publishLinux() { setPorts({ midiIn: [...linux.midi.values()].map((x) => x.name), midiOut: [...linux.midi.values()].filter((x) => x.out !== null).map((x) => x.name), hid: [...linux.hid.values()].map((x) => ({ id: x.id, name: x.name, pid: x.pid })) }); }

  // ---------------------------------------------------------------- both
  function start() {
    if (running) return;
    running = true;
    if (process.platform === 'win32' || Array.isArray(app.config.hwHelper)) startHelper();
    else if (process.platform === 'linux') { scanLinux(); scanT = setInterval(scanLinux, 3000); scanT.unref(); }
    else setStatus(false, 'MIDI and X-keys straight on the PC work on Windows and Linux. On this computer use the hardware bridge page (/live/bridge.html) in Chrome.');
  }
  function stop() {
    running = false; clearTimeout(restartT); clearInterval(scanT);
    if (child) { try { child.stdin.end(); child.kill(); } catch { /* gone */ } child = null; }
    for (const x of [...linux.midi.values(), ...linux.hid.values()]) { try { x.st.destroy(); } catch { /* closed */ } try { if (x.out !== null) fs.closeSync(x.out); } catch { /* closed */ } }
    linux.midi.clear(); linux.hid.clear();
    ok = false; ports = { midiIn: [], midiOut: [], hid: [] };
  }
  function midiOut(filter, bytes) {
    const f = String(filter || '').toLowerCase();
    if (linux.midi.size) {
      const outs = [...linux.midi.values()].filter((x) => x.out !== null && (!f || x.name.toLowerCase().includes(f)));
      if (!outs.length) throw new Error(f ? `No MIDI output matches "${filter}"` : 'No MIDI output');
      for (const x of outs) fs.writeSync(x.out, Buffer.from(bytes));
      return outs.length;
    }
    if (!ports.midiOut.some((n) => !f || n.toLowerCase().includes(f))) throw new Error(ports.midiOut.length ? `No MIDI output matches "${filter}" (outputs: ${ports.midiOut.join(', ')})` : 'No MIDI output on this PC');
    toHelper(`midi\t${String(filter || '').replace(/[\t\n]/g, ' ')}\t${bytes.join(' ')}`);
    return 1;
  }
  function hidOut(id, report) {
    const lx = [...linux.hid.values()].find((x) => x.id === id);
    if (lx) { if (lx.out === null) throw new Error('No write access to ' + lx.file); const b = Buffer.alloc(Math.max(36, report.length)); Buffer.from(report).copy(b); fs.writeSync(lx.out, b); return; }
    toHelper(`hid\t${id}\t${report.join(' ')}`);
  }
  const state = () => ({ ok, error, platform: process.platform, midiIn: ports.midiIn, midiOut: ports.midiOut, hid: ports.hid });
  return { start, stop, midiOut, hidOut, state, raw: (l) => toHelper(l), on: (e, f) => ev.on(e, f), off: (e, f) => ev.off(e, f), running: () => running };
}

// MIDI byte stream (raw MIDI on Linux) → whole messages, with running status
function midiParser(emit) {
  let status = 0, need = 0, data = [];
  const len = (s) => { const t = s & 0xf0; return t === 0xc0 || t === 0xd0 ? 1 : t >= 0x80 && t < 0xf0 ? 2 : s === 0xf1 || s === 0xf3 ? 1 : s === 0xf2 ? 2 : 0; };
  return (buf) => {
    for (const b of buf) {
      if (b >= 0xf8) continue;                       // clock and other real-time bytes
      if (b & 0x80) { if (b === 0xf0 || b === 0xf7) { status = 0; continue; } status = b; need = len(b); data = []; if (!need) emit([b]); continue; }
      if (!status) continue;                         // inside SysEx, or nothing to go on
      data.push(b);
      if (data.length === need) { emit([status, ...data]); data = []; }
    }
  };
}

// An X-keys data report (without its report number) → which keys are down. Key number = column × 8 + row + 1,
// counted from byte 2 (byte 0 is the unit id, byte 1 the program switch).
function xkeysKeys(bytes) {
  const down = new Set();
  for (let i = 2; i < Math.min(bytes.length, 14); i++) for (let bit = 0; bit < 8; bit++) if (bytes[i] & (1 << bit)) down.add((i - 2) * 8 + bit + 1);
  return down;
}

module.exports = { makeHw, midiParser, xkeysKeys, XKEYS_VENDOR };
