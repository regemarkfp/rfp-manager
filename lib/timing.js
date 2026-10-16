'use strict';
// Timing systems on the production PC: photo-finish (FinishLynx, …), timers (ALGE, …), scoreboard ports and result
// files. Everything they send goes into the athletics meet that is the live event: start lists, results, reaction
// times, wind and the race clock. The parsing lives in lib/timing-core.js; this file listens.
//
// Inputs (Settings are on the scorer's Timing tab, kept in kv 'timing:config'):
//   tcp     listen on a port (the timing system connects: FinishLynx "Network (Connect)"), or connect to it
//   udp     receive packets on a port (FinishLynx "Network (UDP)", most running-time scripts)
//   serial  a COM port (RS-232 / USB): ALGE Timy, scoreboard outputs; on Windows through PowerShell, no drivers needed
//   folder  a shared folder: lynx.evt / lynx.ppl (start lists), *.lif (results), or any CSV/text with your own layout
const net = require('node:net');
const dgram = require('node:dgram');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const Core = require('./timing-core');
const { log } = require('./util');

const KINDS = ['tcp', 'udp', 'serial', 'folder'];
const FORMATS = ['auto', 'lynx', 'alge', 'running', 'custom'];
const KEY = 'timing:config';
const uid = () => Math.random().toString(36).slice(2, 10);

// records arrive in pieces over TCP and serial: keep the unfinished end until it is finished or goes quiet
function lineBuffer(onRecord) {
  let buf = '', t = null;
  const flush = () => { t = null; if (buf.replace(/[\x00-\x1f\s]/g, '')) onRecord(buf); buf = ''; };
  return (chunk) => {
    buf += chunk;
    const parts = buf.split(/([\r\n\x03\x04\x17]+)/);
    buf = parts.length % 2 === 1 ? parts.pop() : '';
    for (let i = 0; i < parts.length; i += 2) if (parts[i].replace(/[\x00-\x1f\s]/g, '')) onRecord(parts[i]);
    clearTimeout(t);
    if (buf) t = setTimeout(flush, 150);
    if (buf.length > 8192) flush();
  };
}
const decode = (b) => { const s = b.toString('utf8'); return s.includes('�') ? b.toString('latin1') : s; };

function sanitizeInput(x) {
  const kind = KINDS.includes(x.kind) ? x.kind : 'udp';
  const rules = (Array.isArray(x.rules) ? x.rules : []).slice(0, 40).map((r) => ({
    when: ['any', 'contains', 'starts', 'regex'].includes(r.when) ? r.when : 'any', match: String(r.match || '').slice(0, 200),
    type: ['result', 'clock', 'wind', 'event', 'entry', 'start', 'stop', 'ignore'].includes(r.type) ? r.type : 'result',
    split: ['controls', 'comma', 'semicolon', 'tab', 'pipe', 'spaces', 'space'].includes(r.split) ? r.split : 'controls',
    fields: Object.fromEntries(Object.entries(r.fields || {}).filter(([k, v]) => /^(place|lane|bib|name|first|last|team|time|reaction|wind|event|clock|heat|key)$/.test(k) && Number(v) > 0 && Number(v) < 100).map(([k, v]) => [k, Number(v)])),
  }));
  return {
    id: String(x.id || uid()).replace(/[^\w-]/g, '').slice(0, 20) || uid(), name: String(x.name || '').slice(0, 60), on: x.on !== false, kind,
    format: FORMATS.includes(x.format) ? x.format : (kind === 'folder' ? 'lynx' : 'auto'),
    mode: x.mode === 'connect' ? 'connect' : 'listen', host: String(x.host || '').trim().slice(0, 100), port: Math.min(65535, Math.max(0, Number(x.port) || 0)),
    com: String(x.com || '').trim().slice(0, 40), baud: [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(Number(x.baud)) ? Number(x.baud) : 9600,
    parity: ['none', 'even', 'odd'].includes(x.parity) ? x.parity : 'none', bits: Number(x.bits) === 7 ? 7 : 8,
    folder: String(x.folder || '').trim().slice(0, 400), rules,
  };
}

function makeTiming(app) {
  const local = app.isLocal;
  let cfg = { inputs: [], follow: true, followStartLists: false, autoCreate: true, clock: true };
  const runs = new Map();
  const recent = [];
  let queue = [], timer = null, quietTimer = null, lastError = '', lastNote = '', stopped = false, applied = 0;

  // ---------------------------------------------------------------- settings
  async function load() {
    if (!local) return;
    const saved = await app.store.kvGet(KEY).catch(() => null);
    if (saved && typeof saved === 'object') cfg = Object.assign(cfg, saved, { inputs: (saved.inputs || []).map(sanitizeInput) });
    restart();
    quietTimer = setInterval(checkQuiet, 1000); quietTimer.unref();
  }
  async function save(next) {
    if (!local) throw new Error('Timing runs on the production PC');
    cfg = {
      inputs: (Array.isArray(next.inputs) ? next.inputs : cfg.inputs).slice(0, 12).map(sanitizeInput),
      follow: next.follow !== undefined ? !!next.follow : cfg.follow, followStartLists: next.followStartLists !== undefined ? !!next.followStartLists : cfg.followStartLists,
      autoCreate: next.autoCreate !== undefined ? !!next.autoCreate : cfg.autoCreate, clock: next.clock !== undefined ? !!next.clock : cfg.clock,
    };
    await app.store.kvSet(KEY, cfg);
    restart();
    return status();
  }

  // ---------------------------------------------------------------- inputs
  function restart() {
    for (const r of runs.values()) { try { r.stop(); } catch { /* gone */ } }
    runs.clear();
    if (stopped) return;
    for (const inp of cfg.inputs) {
      const run = { input: inp, ctx: {}, st: { state: 'off', detail: '', lines: 0, parsed: 0, lastAt: 0, error: '' }, stop() {} };
      runs.set(inp.id, run);
      if (!inp.on) continue;
      try { starters[inp.kind](run); } catch (e) { run.st.state = 'error'; run.st.error = e.message; }
    }
  }
  const starters = {
    udp(run) {
      const { port } = run.input;
      if (!port) { run.st.state = 'error'; run.st.error = 'Choose a port'; return; }
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (m) => { for (const rec of Core.splitRecords(decode(m))) record(run, rec); });
      sock.on('error', (e) => { run.st.state = 'error'; run.st.error = e.code === 'EADDRINUSE' ? `Port ${port} is used by another program` : e.message; });
      sock.bind(port, () => { run.st.state = 'listening'; run.st.detail = `UDP port ${port}`; });
      run.stop = () => sock.close();
    },
    tcp(run) {
      const { port, host, mode } = run.input;
      if (!port) { run.st.state = 'error'; run.st.error = 'Choose a port'; return; }
      if (mode === 'connect') {
        let sock = null, t = null, wait = 1000, done = false;
        const go = () => {
          if (done) return;
          run.st.state = 'waiting'; run.st.detail = `connecting to ${host || '127.0.0.1'}:${port}`;
          sock = net.connect(port, host || '127.0.0.1');
          const feed = lineBuffer((rec) => record(run, rec));
          sock.on('connect', () => { wait = 1000; run.st.state = 'connected'; run.st.detail = `connected to ${host || '127.0.0.1'}:${port}`; run.st.error = ''; });
          sock.on('data', (d) => feed(decode(d)));
          sock.on('error', (e) => { run.st.error = e.code === 'ECONNREFUSED' ? 'Nothing answers there yet' : e.message; });
          sock.on('close', () => { if (done) return; run.st.state = 'waiting'; t = setTimeout(go, wait); wait = Math.min(wait * 2, 15000); });
        };
        go();
        run.stop = () => { done = true; clearTimeout(t); if (sock) sock.destroy(); };
        return;
      }
      const conns = new Set();
      const srv = net.createServer((sock) => {
        conns.add(sock);
        const feed = lineBuffer((rec) => record(run, rec));
        run.st.state = 'connected'; run.st.detail = `${sock.remoteAddress.replace(/^::ffff:/, '')} is connected on port ${port}`;
        sock.on('data', (d) => feed(decode(d)));
        sock.on('error', () => {});
        sock.on('close', () => { conns.delete(sock); if (!conns.size && run.st.state === 'connected') { run.st.state = 'listening'; run.st.detail = `TCP port ${port}, waiting for the timing system`; } });
      });
      srv.on('error', (e) => { run.st.state = 'error'; run.st.error = e.code === 'EADDRINUSE' ? `Port ${port} is used by another program` : e.message; });
      srv.listen(port, () => { run.st.state = 'listening'; run.st.detail = `TCP port ${port}, waiting for the timing system`; });
      run.stop = () => { for (const c of conns) c.destroy(); srv.close(); };
    },
    serial(run) {
      const { com, baud, parity, bits } = run.input;
      if (!com) { run.st.state = 'error'; run.st.error = 'Choose a COM port'; return; }
      let child = null, t = null, done = false;
      const feed = lineBuffer((rec) => record(run, rec));
      const go = () => {
        if (done) return;
        if (process.platform === 'win32') {
          const par = { none: 'None', even: 'Even', odd: 'Odd' }[parity];
          const ps = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$p=New-Object System.IO.Ports.SerialPort '${com.replace(/'/g, '')}',${baud},'${par}',${bits},'One';$p.Encoding=[Text.Encoding]::GetEncoding(28591);$p.ReadTimeout=500;$p.Open();[Console]::Out.WriteLine('@@OPEN');while($true){$b=$p.ReadExisting();if($b){[Console]::Out.Write($b);[Console]::Out.Flush()};Start-Sleep -Milliseconds 15}`;
          child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
        } else {
          const dev = com.startsWith('/') ? com : '/dev/' + com;
          const par = parity === 'even' ? 'parenb -parodd' : parity === 'odd' ? 'parenb parodd' : '-parenb';
          child = spawn('sh', ['-c', `stty -F '${dev.replace(/'/g, '')}' ${baud} cs${bits} ${par} -cstopb raw -echo && echo @@OPEN && exec cat '${dev.replace(/'/g, '')}'`]);
        }
        run.st.state = 'waiting'; run.st.detail = `opening ${com}`;
        child.stdout.on('data', (d) => {
          let s = d.toString('utf8');
          if (s.includes('@@OPEN')) { run.st.state = 'connected'; run.st.detail = `${com} at ${baud} baud`; run.st.error = ''; s = s.replace(/@@OPEN\r?\n?/, ''); }
          if (s) feed(s);
        });
        child.stderr.on('data', (d) => { const m = String(d).trim().split(/\r?\n/).find((l) => /exception|error|denied|not exist|No such/i.test(l)); if (m) run.st.error = m.replace(/^.*?:\s*"?/, '').slice(0, 200); });
        child.on('close', () => { if (done) return; run.st.state = 'waiting'; run.st.detail = `${com} closed, trying again`; t = setTimeout(go, 3000); });
        child.on('error', (e) => { run.st.state = 'error'; run.st.error = e.message; });
      };
      go();
      run.stop = () => { done = true; clearTimeout(t); if (child) child.kill(); };
    },
    folder(run) {
      const dir = run.input.folder;
      if (!dir) { run.st.state = 'error'; run.st.error = 'Choose the folder'; return; }
      const seen = new Map();
      let people = new Map(), t = null, done = false, w = null;
      const scan = () => {
        if (done) return;
        let names;
        try { names = fs.readdirSync(dir); run.st.state = 'listening'; run.st.detail = `watching ${dir}`; run.st.error = ''; } catch (e) { run.st.state = 'error'; run.st.error = e.code === 'ENOENT' ? 'That folder was not found' : e.message; t = setTimeout(scan, 5000); return; }
        const want = run.input.format === 'lynx' || run.input.format === 'auto'
          ? names.filter((n) => /\.(evt|ppl|lif)$/i.test(n)) : names.filter((n) => /\.(csv|txt|res|lif|evt)$/i.test(n));
        // people first, so start lists can use them
        want.sort((a, b) => (/\.ppl$/i.test(b) ? 1 : 0) - (/\.ppl$/i.test(a) ? 1 : 0));
        for (const n of want) {
          const f = path.join(dir, n);
          let s; try { s = fs.statSync(f); } catch { continue; }
          const sig = s.mtimeMs + ':' + s.size;
          if (seen.get(n) === sig || !s.isFile() || s.size > 4e6) continue;
          if (Date.now() - s.mtimeMs < 300) continue;                    // still being written
          seen.set(n, sig);
          let text; try { text = decode(fs.readFileSync(f)); } catch { continue; }
          fileIn(run, n, text, people, (p) => { people = p; });
        }
        t = setTimeout(scan, 1500);
      };
      try { w = fs.watch(dir, () => { clearTimeout(t); t = setTimeout(scan, 400); }); w.on('error', () => {}); } catch { /* polling only */ }
      scan();
      run.stop = () => { done = true; clearTimeout(t); if (w) w.close(); };
    },
  };

  function fileIn(run, name, text, people, setPeople) {
    run.st.lines++; run.st.lastAt = Date.now();
    const note = (msgs) => { pushRecent(run, `[file] ${name}`, msgs[0] || null, msgs.length); };
    if (run.input.format === 'lynx' || run.input.format === 'auto') {
      if (/\.ppl$/i.test(name)) { setPeople(Core.parsePpl(text)); note([]); return; }
      if (/\.evt$/i.test(name)) { const list = Core.parseEvt(text, people); note(list); run.st.parsed += list.length; enqueue(run, list); return; }
      if (/\.lif$/i.test(name)) { const r = Core.parseLif(text); note(r ? [r] : []); if (r) { run.st.parsed++; enqueue(run, [r]); } return; }
      return;
    }
    // your own layout: every line through the rules; the file name says which event unless a rule does
    const msgs = [];
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const hasEvent = (run.input.rules || []).some((r) => r.type === 'event');
    if (!hasEvent) msgs.push({ t: 'event', name: name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ') });
    for (const l of lines) { const m = Core.parseRecord(l, run.input); if (m) msgs.push(m); }
    note(msgs); run.st.parsed += msgs.length;
    enqueue(run, msgs);
  }

  // ---------------------------------------------------------------- records → meet
  function pushRecent(run, raw, msg, count) {
    recent.push({ at: Date.now(), input: run.input.id, text: Core.visible(raw).slice(0, 300), type: msg ? msg.t : '', count: count || (msg ? 1 : 0), msg: msg && msg.t !== 'startlist' && msg.t !== 'results' ? msg : msg ? { t: msg.t, name: msg.name, entries: (msg.entries || msg.rows || []).length } : null });
    if (recent.length > 300) recent.splice(0, recent.length - 300);
  }
  function record(run, raw) {
    run.st.lines++; run.st.lastAt = Date.now();
    let msg = null;
    try { msg = Core.parseRecord(raw, run.input); } catch (e) { run.st.error = e.message; }
    // the running clock arrives many times a second: keep only every 10th line in the monitor
    if (!(msg && msg.t === 'clock') || run.st.lines % 10 === 0) pushRecent(run, raw, msg);
    if (msg) { run.st.parsed++; enqueue(run, [msg]); }
  }
  function enqueue(run, msgs) {
    queue.push({ run, msgs });
    if (!timer) { timer = setTimeout(flush, 100); timer.unref && timer.unref(); }
  }
  async function flush() {
    timer = null;
    const batch = queue; queue = [];
    if (!batch.length || !app.live || !app.live.athleticsTiming) return;
    try {
      const r = await app.live.athleticsTiming((state) => {
        const all = { data: false, clock: false, notes: [] };
        for (const { run, msgs } of batch) {
          // only the newest clock reading of a burst matters
          const lastClock = msgs.map((m, i) => (m && m.t === 'clock' ? i : -1)).filter((i) => i >= 0).pop();
          const use = msgs.filter((m, i) => !(m && m.t === 'clock') || i === lastClock);
          const o = Core.applyMessages(state, use, run.ctx, cfg);
          all.data = all.data || o.data; all.clock = all.clock || o.clock; all.notes.push(...o.notes);
        }
        return all;
      });
      if (r && !r.ok) lastError = r.why || 'Not applied'; else { lastError = ''; if (r && r.changed) applied++; }
      if (r && r.notes && r.notes.length) lastNote = r.notes.join(' · ');
    } catch (e) { lastError = e.message; log('Timing:', e.message); }
    if (queue.length && !timer) { timer = setTimeout(flush, 100); timer.unref && timer.unref(); }
  }
  async function checkQuiet() {
    for (const run of runs.values()) {
      if (run.ctx.clockAt == null || Date.now() - run.ctx.clockAt < 2500) continue;
      try { await app.live.athleticsTiming((state) => ({ clock: Core.quietClock(state, run.ctx) })); } catch { /* next time */ }
      run.ctx.clockAt = null;
    }
  }

  // ---------------------------------------------------------------- for the Timing tab
  function status() {
    return {
      local, settings: cfg, error: lastError, note: lastNote, applied,
      inputs: cfg.inputs.map((i) => ({ id: i.id, ...(runs.get(i.id) || { st: { state: 'off' } }).st })),
      recent: recent.slice(-120),
    };
  }
  /** What a sample would give with these settings (nothing is changed) */
  function preview(input, text) {
    const inp = sanitizeInput(input || {});
    if (inp.kind === 'folder' && (inp.format === 'lynx' || inp.format === 'auto')) {
      const evt = Core.parseEvt(text); if (evt.length) return evt.map((m) => ({ text: m.name, msg: m }));
      const lif = Core.parseLif(text); if (lif) return [{ text: lif.name, msg: lif }];
    }
    return String(text || '').split(/\r?\n/).slice(0, 200).flatMap((l) => Core.splitRecords(l)).map((l) => ({ text: Core.visible(l), clean: Core.cleanText(l), msg: Core.parseRecord(l, inp) }));
  }
  /** Type or paste lines as if the timing system sent them (testing, or a manual feed) */
  function inject(inputId, text) {
    const run = runs.get(inputId) || { input: sanitizeInput({ id: 'manual', kind: 'udp', format: 'auto' }), ctx: {}, st: { lines: 0, parsed: 0 } };
    let n = 0;
    for (const l of String(text || '').split(/\r?\n/)) for (const rec of Core.splitRecords(l)) { record(run, rec); n++; }
    return { lines: n };
  }
  function ports() {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.IO.Ports.SerialPort]::GetPortNames() -join ","'], { windowsHide: true, timeout: 8000 }, (e, out) => resolve(e ? [] : String(out).trim().split(',').filter(Boolean).sort()));
      } else {
        fs.readdir('/dev', (e, names) => resolve(e ? [] : names.filter((n) => /^tty(USB|ACM|S\d|AMA)/.test(n)).map((n) => '/dev/' + n).slice(0, 30)));
      }
    });
  }
  function stop() { stopped = true; clearInterval(quietTimer); clearTimeout(timer); for (const r of runs.values()) { try { r.stop(); } catch { /* gone */ } } runs.clear(); }

  return { load, save, status, preview, inject, ports, stop, flush, get settings() { return cfg; } };
}

module.exports = { makeTiming, sanitizeInput };
