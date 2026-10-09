'use strict';
// Other production devices on the network: vMix (HTTP API), Blackmagic ATEM switchers (UDP 9910) and HyperDeck recorders
// (TCP 9993). Each one gives live values (streaming time, keyers on air, what is on program …) that templates, triggers
// and buttons can use like any other live value, and takes commands from buttons, macros and triggers.
// Set them up in Graphics control → Settings → Devices (kept in config.json → "devices").
const dgram = require('node:dgram');
const net = require('node:net');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { log, HttpError } = require('./util');
const { makeHw, xkeysKeys } = require('./hw');

const clockText = (ms) => { if (!(ms >= 0)) return ''; const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const flag = (v) => (v ? '1' : '');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'device';

// ------------------------------------------------------------------------------------------------ vMix
class VMix extends EventEmitter {
  constructor(cfg) { super(); this.cfg = cfg; this.state = null; this.connected = false; this.error = ''; this.since = {}; this.timer = null; }
  start() { this.poll(); this.timer = setInterval(() => this.poll(), 1000); this.timer.unref(); }
  stop() { clearInterval(this.timer); }
  get(path) {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: this.cfg.host || '127.0.0.1', port: Number(this.cfg.port) || 8088, path, timeout: 2500 }, (res) => {
        let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { if (body.length < 4e6) body += c; }); res.on('end', () => (res.statusCode < 400 ? resolve(body) : reject(new Error('vMix answered ' + res.statusCode))));
      });
      req.on('timeout', () => req.destroy(new Error('vMix did not answer')));
      req.on('error', reject);
    });
  }
  async poll() {
    try {
      const xml = await this.get('/api');
      const tag = (n) => { const m = new RegExp(`<${n}(?:\\s[^>]*)?>([^<]*)</${n}>`, 'i').exec(xml); return m ? m[1].trim() : ''; };
      const attrTag = (n) => { const m = new RegExp(`<${n}(\\s[^>]*)?>([^<]*)</${n}>`, 'i').exec(xml); return m ? { attrs: m[1] || '', text: m[2].trim() } : null; };
      const inputs = {};
      for (const m of xml.matchAll(/<input\s([^>]*?)(?:\/>|>([\s\S]*?)<\/input>)/gi)) {
        const a = m[1], at = (k) => { const x = new RegExp(`\\b${k}="([^"]*)"`, 'i').exec(a); return x ? x[1] : ''; };
        inputs[at('number')] = { title: at('title') || (m[2] || '').replace(/<[^>]+>/g, '').trim(), type: at('type'), state: at('state') };
      }
      const ovl = {};
      for (const m of xml.matchAll(/<overlay number="(\d+)"[^>]*>([^<]*)<\/overlay>/gi)) ovl[m[1]] = m[2].trim();
      const s = { version: tag('version'), active: tag('active'), preview: tag('preview'), ftb: /true/i.test(tag('fadeToBlack')), streaming: /true/i.test(tag('streaming')), recording: /true/i.test(tag('recording')), external: /true/i.test(tag('external')), inputs, overlays: ovl };
      const rec = attrTag('recording'); if (rec) { const d = /duration="(\d+)"/i.exec(rec.attrs); if (d) s.recordingSecs = Number(d[1]); }
      for (const k of ['streaming', 'recording', 'external']) { if (s[k] && !this.since[k]) this.since[k] = Date.now(); if (!s[k]) this.since[k] = 0; }
      const before = JSON.stringify(this.vars());
      this.state = s; this.error = '';
      if (!this.connected) { this.connected = true; this.emit('status'); }
      if (JSON.stringify(this.vars()) !== before) this.emit('change');
    } catch (e) { if (this.connected || this.error !== e.message) { this.connected = false; this.error = e.message; this.emit('status'); } }
  }
  vars() {
    const s = this.state; if (!s) return {};
    const title = (n) => (s.inputs[n] ? s.inputs[n].title : '');
    const v = { active: s.active, active_title: title(s.active), preview: s.preview, preview_title: title(s.preview), fadetoblack: flag(s.ftb),
      streaming: flag(s.streaming), streaming_time: s.streaming && this.since.streaming ? clockText(Date.now() - this.since.streaming) : '',
      recording: flag(s.recording), recording_time: s.recording ? (s.recordingSecs !== undefined ? clockText(s.recordingSecs * 1000) : this.since.recording ? clockText(Date.now() - this.since.recording) : '') : '',
      external: flag(s.external), version: s.version };
    for (let i = 1; i <= 4; i++) { const n = s.overlays[i] || ''; v[`overlay${i}`] = n; v[`overlay${i}_title`] = title(n); v[`overlay${i}_onair`] = flag(!!n); }
    return v;
  }
  // command: a vMix function name (Cut, Fade, OverlayInput1In, StartStreaming, SetText …); value: the rest, e.g. Input=3&Duration=500
  async command(fn, value) {
    const q = new URLSearchParams(String(value || '').replace(/^\?/, ''));
    q.set('Function', String(fn || '').trim());
    await this.get('/api/?' + q.toString());
    setTimeout(() => this.poll(), 150);
  }
  status() { return { connected: this.connected, error: this.error, summary: this.state ? `on air: ${this.vars().active_title || this.state.active}${this.state.streaming ? ' · streaming' : ''}${this.state.recording ? ' · recording' : ''}` : '' }; }
}
VMix.COMMANDS = ['Cut', 'Fade', 'CutDirect', 'PreviewInput', 'ActiveInput', 'OverlayInput1In', 'OverlayInput1Out', 'OverlayInput1', 'OverlayInput2In', 'OverlayInput2Out', 'OverlayInput3In', 'OverlayInput3Out', 'OverlayInput4In', 'OverlayInput4Out',
  'FadeToBlack', 'StartStreaming', 'StopStreaming', 'StartRecording', 'StopRecording', 'SetText', 'SetImage', 'Play', 'Pause', 'Restart', 'ScriptStart'];

// ------------------------------------------------------------------------------------------------ ATEM
// The switcher's own UDP protocol (port 9910): a handshake, then the switcher sends its state as commands of
// [length u16][0 u16][name 4 chars][data], and every packet that asks for one is acknowledged.
class Atem extends EventEmitter {
  constructor(cfg) {
    super(); this.cfg = cfg; this.sock = null; this.session = 0; this.localId = 0; this.connected = false; this.error = ''; this.last = 0; this.timer = null;
    this.st = { program: {}, preview: {}, keyers: {}, dsk: {}, names: {}, streaming: 0, streamTime: '', recording: 0, recordTime: '', ftb: {} };
  }
  start() { this.open(); this.timer = setInterval(() => { if (Date.now() - this.last > 5000) { if (this.connected) { this.connected = false; this.error = 'No answer from the switcher'; this.emit('status'); } this.open(); } }, 2000); this.timer.unref(); }
  stop() { clearInterval(this.timer); try { this.sock && this.sock.close(); } catch { /* closed */ } }
  open() {
    try { this.sock && this.sock.close(); } catch { /* closed */ }
    this.sock = dgram.createSocket('udp4');
    this.sock.on('error', (e) => { this.error = e.message; });
    this.sock.on('message', (m) => this.receive(m));
    this.session = 0x53ab; this.localId = 0; this.last = Date.now();
    const hello = Buffer.from([0x10, 0x14, 0x53, 0xab, 0, 0, 0, 0, 0, 0x3a, 0, 0, 0x01, 0, 0, 0, 0, 0, 0, 0]);
    this.sock.send(hello, Number(this.cfg.port) || 9910, this.cfg.host || '127.0.0.1');
  }
  send(buf) { if (this.sock) this.sock.send(buf, Number(this.cfg.port) || 9910, this.cfg.host || '127.0.0.1'); }
  ack(remoteId) { const b = Buffer.alloc(12); b.writeUInt16BE((0x10 << 11) | 12, 0); b.writeUInt16BE(this.session, 2); b.writeUInt16BE(remoteId, 4); this.send(b); }
  receive(m) {
    if (m.length < 12) return;
    this.last = Date.now();
    const word = m.readUInt16BE(0), flags = word >> 11, len = word & 0x7ff, remoteId = m.readUInt16BE(10);
    this.session = m.readUInt16BE(2);
    if (flags & 0x02) { this.ack(0); return; }                       // hello back: acknowledge, the state dump follows
    if (flags & 0x01) this.ack(remoteId);
    if (!this.connected) { this.connected = true; this.error = ''; this.emit('status'); }
    let o = 12, changed = false;
    while (o + 8 <= Math.min(len, m.length)) {
      const clen = m.readUInt16BE(o); if (clen < 8) break;
      const name = m.toString('ascii', o + 4, o + 8), d = m.subarray(o + 8, o + clen);
      changed = this.parse(name, d) || changed;
      o += clen;
    }
    if (changed) this.emit('change');
  }
  parse(name, d) {
    const s = this.st;
    try {
      switch (name) {
        case 'PrgI': s.program[d[0]] = d.readUInt16BE(2); return true;
        case 'PrvI': s.preview[d[0]] = d.readUInt16BE(2); return true;
        case 'KeOn': s.keyers[`${d[0]}_${d[1]}`] = !!d[2]; return true;
        case 'DskS': s.dsk[d[0]] = { onAir: !!d[1], inTransition: !!d[2] }; return true;
        case 'FtbS': s.ftb[d[0]] = !!d[1]; return true;
        case 'InPr': s.names[d.readUInt16BE(0)] = d.toString('utf8', 2, 22).replace(/\0.*$/, ''); return true;
        case 'StRS': s.streaming = d.readUInt16BE(0); return true;                      // 1 idle, 2 connecting, 4 streaming, 32 stopping
        case 'SRST': s.streamTime = `${d[0]}:${String(d[1]).padStart(2, '0')}:${String(d[2]).padStart(2, '0')}`; return true;
        case 'RTMS': s.recording = d.readUInt16BE(0); return true;
        case 'RTMD': s.recordTime = `${d[0]}:${String(d[1]).padStart(2, '0')}:${String(d[2]).padStart(2, '0')}`; return true;
        case '_pin': s.model = d.toString('utf8', 0, 44).replace(/\0.*$/, ''); return true;
        default: return false;
      }
    } catch { return false; }
  }
  vars() {
    const s = this.st, v = {};
    const nm = (src) => (src === undefined ? '' : s.names[src] || String(src));
    for (const me of Object.keys(s.program)) { const k = me === '0' ? '' : `me${Number(me) + 1}_`; v[`${k}program`] = String(s.program[me]); v[`${k}program_name`] = nm(s.program[me]); v[`${k}preview`] = String(s.preview[me] === undefined ? '' : s.preview[me]); v[`${k}preview_name`] = nm(s.preview[me]); v[`${k}ftb`] = flag(s.ftb[me]); }
    for (const [k, on] of Object.entries(s.keyers)) { const [me, key] = k.split('_').map(Number); v[`${me ? `me${me + 1}_` : ''}key${key + 1}_onair`] = flag(on); }
    for (const [i, x] of Object.entries(s.dsk)) { v[`dsk${Number(i) + 1}_onair`] = flag(x.onAir); v[`dsk${Number(i) + 1}_transition`] = flag(x.inTransition); }
    v.streaming = flag(s.streaming & 4); v.streaming_state = ({ 1: 'idle', 2: 'connecting', 4: 'streaming', 32: 'stopping' })[s.streaming] || (s.streaming ? String(s.streaming) : '');
    v.streaming_time = s.streaming & 4 ? s.streamTime : '';
    v.recording = flag(s.recording & 1); v.recording_time = s.recording & 1 ? s.recordTime : '';
    v.model = s.model || '';
    return v;
  }
  cmd(name, data) {
    this.localId = (this.localId + 1) & 0x7fff;
    const body = Buffer.alloc(8 + data.length); body.writeUInt16BE(8 + data.length, 0); body.write(name, 4, 'ascii'); data.copy(body, 8);
    const head = Buffer.alloc(12); head.writeUInt16BE((0x01 << 11) | (12 + body.length), 0); head.writeUInt16BE(this.session, 2); head.writeUInt16BE(this.localId, 10);
    this.send(Buffer.concat([head, body]));
  }
  // command: cut, auto, program, preview, key-on, key-off, dsk-on, dsk-off, dsk-auto, ftb, stream-start, stream-stop, record-start, record-stop
  // value: "input=2 me=1 key=1 dsk=1" (numbers as on the switcher: ME 1, key 1, DSK 1)
  async command(what, value) {
    if (!this.connected) throw new Error('The ATEM is not connected');
    const a = {}; String(value || '').split(/[\s,;&]+/).forEach((p) => { const m = /^(\w+)\s*[=:]\s*(\d+)$/.exec(p); if (m) a[m[1].toLowerCase()] = Number(m[2]); });
    const me = Math.max(0, (a.me || 1) - 1), b = (...x) => Buffer.from(x), u16 = (n) => [(n >> 8) & 255, n & 255];
    switch (String(what).toLowerCase()) {
      case 'cut': return this.cmd('DCut', b(me, 0, 0, 0));
      case 'auto': return this.cmd('DAut', b(me, 0, 0, 0));
      case 'program': return this.cmd('CPgI', b(me, 0, ...u16(a.input || 0)));
      case 'preview': return this.cmd('CPvI', b(me, 0, ...u16(a.input || 0)));
      case 'key-on': case 'key-off': return this.cmd('CKOn', b(me, Math.max(0, (a.key || 1) - 1), what === 'key-on' ? 1 : 0, 0));
      case 'dsk-on': case 'dsk-off': return this.cmd('CDsL', b(Math.max(0, (a.dsk || 1) - 1), what === 'dsk-on' ? 1 : 0, 0, 0));
      case 'dsk-auto': return this.cmd('DDsA', b(Math.max(0, (a.dsk || 1) - 1), 0, 0, 0));
      case 'ftb': return this.cmd('FtbA', b(me, 0, 0, 0));
      case 'stream-start': case 'stream-stop': return this.cmd('StrR', b(what === 'stream-start' ? 1 : 0, 0, 0, 0));
      case 'record-start': case 'record-stop': return this.cmd('RcTM', b(what === 'record-start' ? 1 : 0, 0, 0, 0));
      default: throw new Error('Unknown ATEM command ' + what);
    }
  }
  status() { const v = this.vars(); return { connected: this.connected, error: this.error, summary: this.connected ? `${v.model ? v.model + ' · ' : ''}program ${v.program_name || v.program || '–'}${v.streaming ? ' · streaming ' + v.streaming_time : ''}${v.recording ? ' · recording' : ''}` : '' }; }
}
Atem.COMMANDS = ['cut', 'auto', 'program', 'preview', 'key-on', 'key-off', 'dsk-on', 'dsk-off', 'dsk-auto', 'ftb', 'stream-start', 'stream-stop', 'record-start', 'record-stop'];

// ------------------------------------------------------------------------------------------------ HyperDeck
class HyperDeck extends EventEmitter {
  constructor(cfg) { super(); this.cfg = cfg; this.sock = null; this.connected = false; this.error = ''; this.buf = ''; this.t = {}; this.timer = null; this.poller = null; }
  start() { this.open(); this.timer = setInterval(() => { if (!this.connected) this.open(); }, 5000); this.timer.unref(); }
  stop() { clearInterval(this.timer); clearInterval(this.poller); try { this.sock && this.sock.destroy(); } catch { /* closed */ } }
  open() {
    try { this.sock && this.sock.destroy(); } catch { /* closed */ }
    const s = net.connect({ host: this.cfg.host || '127.0.0.1', port: Number(this.cfg.port) || 9993 });
    this.sock = s; s.setEncoding('utf8');
    s.on('connect', () => { this.connected = true; this.error = ''; this.emit('status'); this.write('notify: transport: true'); this.write('transport info'); clearInterval(this.poller); this.poller = setInterval(() => this.write('transport info'), 1000); this.poller.unref(); });
    s.on('data', (d) => { this.buf += d; let i; while ((i = this.buf.indexOf('\r\n\r\n')) >= 0 || (i = this.buf.indexOf('\n\n')) >= 0) { const block = this.buf.slice(0, i); this.buf = this.buf.slice(i + (this.buf[i] === '\r' ? 4 : 2)); this.block(block); } });
    s.on('error', (e) => { this.error = e.message; });
    s.on('close', () => { clearInterval(this.poller); if (this.connected) { this.connected = false; this.emit('status'); } });
  }
  write(t) { if (this.sock && this.connected) this.sock.write(t + '\r\n'); }
  block(b) {
    if (!/transport info/i.test(b)) return;
    const before = JSON.stringify(this.t);
    for (const line of b.split(/\r?\n/).slice(1)) { const m = /^([^:]+):\s*(.*)$/.exec(line); if (m) this.t[m[1].trim().toLowerCase()] = m[2].trim(); }
    if (JSON.stringify(this.t) !== before) this.emit('change');
  }
  vars() { const t = this.t; return { status: t.status || '', recording: flag(t.status === 'record'), playing: flag(t.status === 'play'), timecode: t['display timecode'] || t.timecode || '', clip: t['clip id'] || '', slot: t['slot id'] || '' }; }
  async command(what, value) { if (!this.connected) throw new Error('The HyperDeck is not connected'); this.write([what, value].filter((x) => String(x || '').trim()).join(' ').trim()); }
  status() { return { connected: this.connected, error: this.error, summary: this.connected ? `${this.t.status || 'connected'}${this.t['display timecode'] ? ' · ' + this.t['display timecode'] : ''}` : '' }; }
}
HyperDeck.COMMANDS = ['play', 'stop', 'record', 'goto: clip id:', 'goto: timeline: start', 'play: loop: true', 'preview: enable: true'];

// ------------------------------------------------------------------------------------------------ Raspberry Pi GPIO
// tools/pi-gpio.py on a Pi with a relay board: outputs (GPO) as contact closures, inputs (GPI) as live values.
class PiGpio extends EventEmitter {
  constructor(cfg) { super(); this.cfg = cfg; this.st = { outputs: {}, inputs: {} }; this.connected = false; this.error = ''; this.req = null; this.timer = null; this.stopped = false; }
  start() { this.stopped = false; this.open(); }
  stop() { this.stopped = true; clearTimeout(this.timer); try { this.req && this.req.destroy(); } catch { /* closed */ } }
  later() { if (this.stopped) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.open(), 3000); this.timer.unref(); }
  open() {
    if (this.stopped) return;
    try { this.req && this.req.destroy(); } catch { /* closed */ }
    let buf = '';
    const req = http.get({ host: this.cfg.host || '127.0.0.1', port: Number(this.cfg.port) || 8095, path: '/events' }, (res) => {
      if (res.statusCode !== 200) { this.fail('The Pi answered ' + res.statusCode); res.resume(); return; }
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c; let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          try { this.take(JSON.parse(line.slice(5))); } catch { /* not JSON */ }
        }
      });
      res.on('end', () => this.fail('The Pi closed the connection'));
    });
    req.on('error', (e) => this.fail(e.message));
    req.setTimeout(15000, () => req.destroy(new Error('No answer from the Pi')));   // the Pi sends a ping every 5 s
    this.req = req;
  }
  take(s) {
    const before = JSON.stringify(this.vars());
    this.st = { outputs: s.outputs || {}, inputs: s.inputs || {}, name: s.name || '', mock: !!s.mock };
    if (!this.connected) { this.connected = true; this.error = ''; this.emit('status'); }
    if (JSON.stringify(this.vars()) !== before) this.emit('change');
  }
  fail(msg) { if (this.connected || this.error !== msg) { this.connected = false; this.error = msg; this.emit('status'); } this.later(); }
  vars() { const v = {}; for (const [n, x] of Object.entries(this.st.outputs || {})) v['gpo' + n] = flag(x); for (const [n, x] of Object.entries(this.st.inputs || {})) v['gpi' + n] = flag(x); v.name = this.st.name || ''; return v; }
  // command: pulse, on, off, toggle; value: "gpo=1 ms=200"
  async command(what, value) {
    if (!this.connected) throw new Error('The Pi is not connected');
    const a = {}; String(value || '').split(/[\s,;&]+/).forEach((p) => { const m = /^(\w+)\s*[=:]\s*(\d+)$/.exec(p); if (m) a[m[1].toLowerCase()] = Number(m[2]); });
    const q = new URLSearchParams({ do: String(what || 'pulse').toLowerCase(), gpo: String(a.gpo || a.out || 1), ms: String(a.ms || 200) });
    const body = await new Promise((resolve, reject) => {
      const r = http.get({ host: this.cfg.host || '127.0.0.1', port: Number(this.cfg.port) || 8095, path: '/cmd?' + q, timeout: 2500 }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, b })); });
      r.on('timeout', () => r.destroy(new Error('The Pi did not answer'))); r.on('error', reject);
    });
    if (body.status >= 400) { let m = 'The Pi answered ' + body.status; try { m = JSON.parse(body.b).error || m; } catch { /* plain */ } throw new Error(m); }
  }
  status() { const o = Object.values(this.st.outputs || {}).filter(Boolean).length, i = Object.values(this.st.inputs || {}).filter(Boolean).length; return { connected: this.connected, error: this.error, summary: this.connected ? `${this.st.name || 'Pi'}${this.st.mock ? ' (mock)' : ''} · ${Object.keys(this.st.outputs || {}).length} GPO, ${o} on · ${Object.keys(this.st.inputs || {}).length} GPI, ${i} on` : '' }; }
}
PiGpio.COMMANDS = ['pulse', 'on', 'off', 'toggle'];
PiGpio.KEYS = [...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `gpo${i}`), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `gpi${i}`), 'name'];


// ------------------------------------------------------------------------------------------------ OBS Studio
// obs-websocket 5 (built into OBS 28+, Tools → WebSocket Server Settings, port 4455).
class Obs extends EventEmitter {
  constructor(cfg) { super(); this.cfg = cfg; this.ws = null; this.connected = false; this.error = ''; this.st = {}; this.pending = new Map(); this.n = 0; this.timer = null; this.poll = null; this.stopped = false; }
  start() { this.stopped = false; this.open(); }
  stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.poll); try { this.ws && this.ws.close(); } catch { /* closed */ } }
  later() { if (this.stopped) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.open(), 3000); this.timer.unref(); }
  open() {
    if (this.stopped) return;
    if (typeof WebSocket !== 'function') { this.fail('This Node.js has no WebSocket client (needs Node 22)'); return; }
    let ws;
    try { ws = new WebSocket(`ws://${this.cfg.host || '127.0.0.1'}:${Number(this.cfg.port) || 4455}`); } catch (e) { this.fail(e.message); return; }
    this.ws = ws;
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(String(ev.data)); } catch { return; } this.receive(m); };
    ws.onerror = () => {};
    ws.onclose = (ev) => { clearInterval(this.poll); for (const p of this.pending.values()) p.reject(new Error('OBS closed the connection')); this.pending.clear(); this.fail(ev && ev.code === 4009 ? 'Wrong OBS WebSocket password' : ev && ev.reason ? ev.reason : 'Not connected'); };
  }
  fail(msg) { if (this.connected || this.error !== msg) { this.connected = false; this.error = msg; this.emit('status'); } this.later(); }
  receive(m) {
    const d = m.d || {};
    if (m.op === 0) {                                  // Hello: identify, with the password when OBS asks for one
      const id = { rpcVersion: 1, eventSubscriptions: 1 | 4 | 8 | 64 | 1023 };
      if (d.authentication) {
        const sha = (x) => crypto.createHash('sha256').update(x).digest('base64');
        id.authentication = sha(sha(String(this.cfg.password || '') + d.authentication.salt) + d.authentication.challenge);
      }
      this.ws.send(JSON.stringify({ op: 1, d: id }));
    } else if (m.op === 2) {                           // Identified
      this.connected = true; this.error = ''; this.emit('status');
      this.refresh().catch(() => {});
      clearInterval(this.poll); this.poll = setInterval(() => this.outputs().catch(() => {}), 1000); this.poll.unref();
    } else if (m.op === 7) {
      const p = this.pending.get(d.requestId); if (!p) return; this.pending.delete(d.requestId);
      if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {}); else p.reject(new Error((d.requestStatus && d.requestStatus.comment) || 'OBS refused ' + d.requestType));
    } else if (m.op === 5) this.event(d.eventType, d.eventData || {});
  }
  req(type, data) {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) { reject(new Error('OBS is not connected')); return; }
      const requestId = 'r' + (++this.n);
      this.pending.set(requestId, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(requestId)) reject(new Error('OBS did not answer')); }, 4000).unref();
      this.ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData: data || {} } }));
    });
  }
  set(patch) { const before = JSON.stringify(this.vars()); Object.assign(this.st, patch); if (JSON.stringify(this.vars()) !== before) this.emit('change'); }
  async refresh() {
    const pg = await this.req('GetCurrentProgramScene').catch(() => ({}));
    const sm = await this.req('GetStudioModeEnabled').catch(() => ({}));
    const pv = sm.studioModeEnabled ? await this.req('GetCurrentPreviewScene').catch(() => ({})) : {};
    const sl = await this.req('GetSceneList').catch(() => ({ scenes: [] }));
    this.set({ program: pg.currentProgramSceneName || pg.sceneName || '', preview: pv.currentPreviewSceneName || '', studio: !!sm.studioModeEnabled, scenes: (sl.scenes || []).map((x) => x.sceneName) });
    await this.outputs();
  }
  async outputs() {
    const s = await this.req('GetStreamStatus').catch(() => ({})), r = await this.req('GetRecordStatus').catch(() => ({}));
    const tc = (t) => String(t || '').replace(/\.\d+$/, '');
    this.set({ streaming: !!s.outputActive, streamTime: s.outputActive ? tc(s.outputTimecode) : '', recording: !!r.outputActive, recordTime: r.outputActive ? tc(r.outputTimecode) : '', paused: !!r.outputPaused });
  }
  event(type, d) {
    if (type === 'CurrentProgramSceneChanged') this.set({ program: d.sceneName || '' });
    else if (type === 'CurrentPreviewSceneChanged') this.set({ preview: d.sceneName || '' });
    else if (type === 'StudioModeStateChanged') this.set({ studio: !!d.studioModeEnabled });
    else if (type === 'StreamStateChanged' || type === 'RecordStateChanged') this.outputs().catch(() => {});
    else if (type === 'SceneListChanged' || type === 'SceneNameChanged') this.refresh().catch(() => {});
  }
  vars() { const s = this.st; return { program_scene: s.program || '', preview_scene: s.preview || '', studio_mode: flag(s.studio), streaming: flag(s.streaming), streaming_time: s.streamTime || '', recording: flag(s.recording), recording_time: s.recordTime || '', recording_paused: flag(s.paused), scenes: (s.scenes || []).join(', ') }; }
  // command: scene / preview (value: scene name), transition, stream-start/-stop/-toggle, record-start/-stop/-toggle, record-pause/-resume,
  // mute / unmute / toggle-mute (value: source name), source-show / source-hide / source-toggle (value: "Scene | Source"),
  // or any obs-websocket request with JSON data, e.g. SetInputVolume  {"inputName":"Mic","inputVolumeDb":-6}
  async command(what, value) {
    const v = String(value || '').trim(), w = String(what || '').trim();
    const scenePart = () => { const [sc, src] = v.split('|').map((x) => x.trim()); if (!sc || !src) throw new Error('Give "Scene | Source"'); return { sc, src }; };
    switch (w.toLowerCase()) {
      case 'scene': case 'program': return this.req('SetCurrentProgramScene', { sceneName: v });
      case 'preview': return this.req('SetCurrentPreviewScene', { sceneName: v });
      case 'transition': return this.req('TriggerStudioModeTransition');
      case 'stream-start': return this.req('StartStream'); case 'stream-stop': return this.req('StopStream'); case 'stream-toggle': return this.req('ToggleStream');
      case 'record-start': return this.req('StartRecord'); case 'record-stop': return this.req('StopRecord'); case 'record-toggle': return this.req('ToggleRecord');
      case 'record-pause': return this.req('PauseRecord'); case 'record-resume': return this.req('ResumeRecord');
      case 'mute': return this.req('SetInputMute', { inputName: v, inputMuted: true });
      case 'unmute': return this.req('SetInputMute', { inputName: v, inputMuted: false });
      case 'toggle-mute': return this.req('ToggleInputMute', { inputName: v });
      case 'source-show': case 'source-hide': case 'source-toggle': {
        const { sc, src } = scenePart();
        const it = await this.req('GetSceneItemId', { sceneName: sc, sourceName: src });
        let on = w.toLowerCase() === 'source-show';
        if (w.toLowerCase() === 'source-toggle') on = !(await this.req('GetSceneItemEnabled', { sceneName: sc, sceneItemId: it.sceneItemId })).sceneItemEnabled;
        return this.req('SetSceneItemEnabled', { sceneName: sc, sceneItemId: it.sceneItemId, sceneItemEnabled: on });
      }
      default: { let data = {}; if (v) { try { data = JSON.parse(v); } catch { throw new Error('The value for ' + w + ' must be JSON, e.g. {"inputName":"Mic"}'); } } return this.req(w, data); }
    }
  }
  status() { const v = this.vars(); return { connected: this.connected, error: this.error, summary: this.connected ? `program ${v.program_scene || '–'}${v.studio_mode ? ' · preview ' + (v.preview_scene || '–') : ''}${v.streaming ? ' · streaming ' + v.streaming_time : ''}${v.recording ? ' · recording ' + v.recording_time : ''}` : '' }; }
}
Obs.COMMANDS = ['scene', 'preview', 'transition', 'stream-start', 'stream-stop', 'stream-toggle', 'record-start', 'record-stop', 'record-toggle', 'record-pause', 'record-resume', 'mute', 'unmute', 'toggle-mute', 'source-show', 'source-hide', 'source-toggle'];
Obs.KEYS = ['program_scene', 'preview_scene', 'studio_mode', 'streaming', 'streaming_time', 'recording', 'recording_time', 'recording_paused', 'scenes'];

// ------------------------------------------------------------------------------------------------ Bitfocus Companion
// Companion's HTTP API (Settings → Protocols → HTTP, port 8000): press buttons, set custom variables.
// Companion can also drive RFP Manager: see /live/api/companion in the README.
class Companion extends EventEmitter {
  constructor(cfg) { super(); this.cfg = cfg; this.connected = false; this.error = ''; this.timer = null; this.last = {}; }
  start() { this.check(); this.timer = setInterval(() => this.check(), 5000); this.timer.unref(); }
  stop() { clearInterval(this.timer); }
  call(method, path) {
    return new Promise((resolve, reject) => {
      const r = http.request({ host: this.cfg.host || '127.0.0.1', port: Number(this.cfg.port) || 8000, path, method, timeout: 2500 }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { if (b.length < 1e5) b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
      r.on('timeout', () => r.destroy(new Error('Companion did not answer'))); r.on('error', reject); r.end();
    });
  }
  async check() {
    try { await this.call('GET', '/'); if (!this.connected) { this.connected = true; this.error = ''; this.emit('status'); } }
    catch (e) { if (this.connected || this.error !== e.message) { this.connected = false; this.error = e.message; this.emit('status'); } }
  }
  vars() { return { last_press: this.last.press || '' }; }
  // command: press / down / up / rotate-left / rotate-right  (value "1/0/2" = page 1, row 0, column 2, or "page=1 row=0 col=2"),
  // set-variable (value "name=value": a custom variable in Companion)
  async command(what, value) {
    const w = String(what || '').toLowerCase().trim(), v = String(value || '').trim();
    if (w === 'set-variable' || w === 'variable') {
      const m = /^([\w-]+)\s*=\s*([\s\S]*)$/.exec(v); if (!m) throw new Error('Give "name=value"');
      const r = await this.call('POST', `/api/custom-variable/${encodeURIComponent(m[1])}/value?value=${encodeURIComponent(m[2])}`);
      if (r.status >= 400) throw new Error('Companion answered ' + r.status + (r.body ? ': ' + r.body.slice(0, 80) : ''));
      return;
    }
    if (!['press', 'down', 'up', 'rotate-left', 'rotate-right'].includes(w)) throw new Error('Unknown Companion command ' + w);
    const a = {}; v.split(/[\s,;&]+/).forEach((p) => { const m = /^(\w+)\s*[=:]\s*(\d+)$/.exec(p); if (m) a[m[1].toLowerCase()] = Number(m[2]); });
    const sl = /^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/.exec(v);
    const page = sl ? Number(sl[1]) : a.page || 1, row = sl ? Number(sl[2]) : a.row || 0, col = sl ? Number(sl[3]) : a.col !== undefined ? a.col : a.column || 0;
    const r = await this.call('POST', `/api/location/${page}/${row}/${col}/${w}`);
    if (r.status >= 400) throw new Error('Companion answered ' + r.status + (r.body ? ': ' + r.body.slice(0, 80) : ''));
    this.last.press = `${page}/${row}/${col}`; this.emit('change');
  }
  status() { return { connected: this.connected, error: this.error, summary: this.connected ? 'HTTP API reachable' : '' }; }
}
Companion.COMMANDS = ['press', 'down', 'up', 'rotate-left', 'rotate-right', 'set-variable'];
Companion.KEYS = ['last_press'];

// ------------------------------------------------------------------------------------------------ OSC
// Sends OSC messages over UDP (lighting desks, QLab, Reaper, TouchOSC …) and, with a listen port, takes them in as live values.
function oscString(s) { const b = Buffer.from(String(s) + '\0'); return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]); }
function oscArgs(text) {
  const out = [], re = /"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(String(text || '')))) {
    if (m[1] !== undefined) { out.push(['s', m[1]]); continue; }
    const t = m[2];
    if (/^-?\d+$/.test(t)) out.push(['i', Number(t)]); else if (/^-?\d*\.\d+$/.test(t)) out.push(['f', Number(t)]);
    else if (t === 'true' || t === 'T') out.push(['T']); else if (t === 'false' || t === 'F') out.push(['F']); else out.push(['s', t]);
  }
  return out;
}
function oscEncode(address, args) {
  const parts = [oscString(address), oscString(',' + args.map((a) => a[0]).join(''))];
  for (const a of args) {
    if (a[0] === 'i') { const b = Buffer.alloc(4); b.writeInt32BE(a[1] | 0); parts.push(b); }
    else if (a[0] === 'f') { const b = Buffer.alloc(4); b.writeFloatBE(a[1]); parts.push(b); }
    else if (a[0] === 's') parts.push(oscString(a[1]));
  }
  return Buffer.concat(parts);
}
function oscDecode(buf, out) {
  const str = (o) => { let e = o; while (e < buf.length && buf[e] !== 0) e++; return [buf.toString('utf8', o, e), (e + 4) & ~3]; };
  if (buf.toString('ascii', 0, 8) === '#bundle\0') {
    let o = 16;
    while (o + 4 <= buf.length) { const n = buf.readInt32BE(o); o += 4; oscDecode(buf.subarray(o, o + n), out); o += n; }
    return out;
  }
  let [addr, o] = str(0), tags; [tags, o] = str(o);
  const args = [];
  for (const t of String(tags).slice(1)) {
    if (t === 'i') { args.push(buf.readInt32BE(o)); o += 4; } else if (t === 'f') { args.push(Math.round(buf.readFloatBE(o) * 1000) / 1000); o += 4; }
    else if (t === 's') { let s; [s, o] = str(o); args.push(s); } else if (t === 'T') args.push(1); else if (t === 'F') args.push(0); else if (t === 'd') { args.push(buf.readDoubleBE(o)); o += 8; } else if (t === 'h') { args.push(Number(buf.readBigInt64BE(o))); o += 8; }
  }
  out.push({ address: addr, args });
  return out;
}
class Osc extends EventEmitter {
  constructor(cfg) { super(); this.cfg = cfg; this.sock = null; this.connected = false; this.error = ''; this.vals = {}; this.lastIn = ''; }
  start() {
    this.sock = dgram.createSocket('udp4');
    this.sock.on('error', (e) => { this.error = e.message; this.connected = false; this.emit('status'); });
    this.sock.on('message', (m) => { try { for (const x of oscDecode(m, [])) this.take(x); } catch { /* not OSC */ } });
    const done = () => { try { this.sock.setBroadcast(true); } catch { /* fine */ } this.connected = true; this.error = ''; this.emit('status'); };
    if (Number(this.cfg.listen) > 0) this.sock.bind(Number(this.cfg.listen), done); else this.sock.bind(0, done);
  }
  stop() { try { this.sock && this.sock.close(); } catch { /* closed */ } }
  take(x) {
    const k = x.address.replace(/^\//, '').replace(/[^\w]+/g, '_').toLowerCase().slice(0, 60);
    if (!k) return;
    if (Object.keys(this.vals).length > 300 && this.vals[k] === undefined) return;
    this.vals[k] = x.args.length ? String(x.args[0]) : '1'; this.lastIn = x.address + (x.args.length ? ' ' + x.args.join(' ') : '');
    this.emit('change');
  }
  vars() { return Object.assign({ last_in: this.lastIn }, this.vals); }
  // command: the OSC address (/eos/key/go, /cue/1/start …); value: the arguments, e.g.  1 0.5 "some text"
  async command(what, value) {
    let addr = String(what || '').trim(); if (addr === 'send') { const sp = String(value || '').trim().split(/\s+/); addr = sp.shift(); value = sp.join(' '); }
    if (!addr.startsWith('/')) throw new Error('An OSC address starts with /');
    const buf = oscEncode(addr, oscArgs(value));
    await new Promise((resolve, reject) => this.sock.send(buf, Number(this.cfg.port) || 8000, this.cfg.host || '127.0.0.1', (e) => (e ? reject(e) : resolve())));
  }
  status() { return { connected: this.connected, error: this.error, summary: this.connected ? `sends to ${this.cfg.host}:${this.cfg.port}${Number(this.cfg.listen) > 0 ? ' · listens on ' + this.cfg.listen : ''}${this.lastIn ? ' · last in: ' + this.lastIn.slice(0, 40) : ''}` : '' }; }
}
Osc.COMMANDS = ['/eos/key/go_0', '/cue/selected/start', '/go', 'send'];
Osc.KEYS = ['last_in'];

// ------------------------------------------------------------------------------------------------ Art-Net
// DMX over the network (UDP 6454) to a lighting node or desk: set channels, fade, blackout. Sent again every second.
class ArtNet extends EventEmitter {
  constructor(cfg) { super(); this.cfg = cfg; this.sock = null; this.connected = false; this.error = ''; this.dmx = Buffer.alloc(512); this.seq = 0; this.timer = null; this.fades = null; this.touched = new Set(); }
  start() {
    this.sock = dgram.createSocket('udp4');
    this.sock.on('error', (e) => { this.error = e.message; this.connected = false; this.emit('status'); });
    this.sock.bind(0, () => { try { this.sock.setBroadcast(true); } catch { /* fine */ } this.connected = true; this.error = ''; this.emit('status'); this.send(); });
    this.timer = setInterval(() => this.send(), 1000); this.timer.unref();
  }
  stop() { clearInterval(this.timer); clearInterval(this.fades); try { this.sock && this.sock.close(); } catch { /* closed */ } }
  packet() {
    const u = Number(this.cfg.universe) || 0, h = Buffer.alloc(18);
    h.write('Art-Net\0', 0, 'ascii'); h.writeUInt16LE(0x5000, 8); h.writeUInt16BE(14, 10);
    this.seq = (this.seq % 255) + 1; h[12] = this.seq; h[13] = 0; h[14] = u & 0xff; h[15] = (u >> 8) & 0x7f; h.writeUInt16BE(512, 16);
    return Buffer.concat([h, this.dmx]);
  }
  send() { if (this.sock && this.connected) this.sock.send(this.packet(), Number(this.cfg.port) || 6454, this.cfg.host || '255.255.255.255', () => {}); }
  parse(v) {
    const out = []; let time = 0;
    String(v || '').split(/[\s,;]+/).forEach((p) => {
      const t = /^(?:time|t|fade)\s*=\s*([\d.]+)$/i.exec(p); if (t) { time = Number(t[1]); return; }
      const m = /^(\d+)(?:-(\d+))?\s*[=:@]\s*(\d+)(%?)$/.exec(p); if (!m) return;
      const a = Number(m[1]), b = Number(m[2] || m[1]), val = m[4] ? Math.round(Number(m[3]) * 255 / 100) : Number(m[3]);
      for (let c = Math.max(1, a); c <= Math.min(512, b); c++) out.push([c, Math.max(0, Math.min(255, val))]);
    });
    return { list: out, time };
  }
  // command: set ("1=255 2=128 10-12=50%"), fade ("1=255 2=0 time=2"), blackout
  async command(what, value) {
    const w = String(what || '').toLowerCase().trim();
    if (w === 'blackout') { clearInterval(this.fades); this.dmx.fill(0); this.send(); this.emit('change'); return; }
    const { list, time } = this.parse(value);
    if (!list.length) throw new Error('Give channels, e.g. 1=255 2=128 (or 10-12=50%)');
    list.forEach(([c]) => this.touched.add(c));
    if (w === 'set' || !(time > 0)) { for (const [c, v] of list) this.dmx[c - 1] = v; this.send(); this.emit('change'); return; }
    if (w !== 'fade') throw new Error('Unknown Art-Net command ' + w);
    clearInterval(this.fades);
    const from = list.map(([c]) => this.dmx[c - 1]), t0 = Date.now(), ms = time * 1000;
    this.fades = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      list.forEach(([c, v], i) => { this.dmx[c - 1] = Math.round(from[i] + (v - from[i]) * k); });
      this.send();
      if (k >= 1) { clearInterval(this.fades); this.emit('change'); }
    }, 33);
  }
  vars() { const v = {}; for (const c of [...this.touched].sort((a, b) => a - b).slice(0, 64)) v['ch' + c] = String(this.dmx[c - 1]); return v; }
  status() { return { connected: this.connected, error: this.error, summary: this.connected ? `universe ${Number(this.cfg.universe) || 0} → ${this.cfg.host || '255.255.255.255'}` : '' }; }
}
ArtNet.COMMANDS = ['set', 'fade', 'blackout'];
ArtNet.KEYS = [];

// ------------------------------------------------------------------------------------------------ MIDI and X-keys
// Straight on this PC (lib/hw.js: PowerShell helper on Windows, raw devices on Linux), like vMix: add the device in
// Settings → Connections and it connects by itself. The hardware bridge page (/live/bridge.html) still works too, for
// MIDI gear or X-keys plugged into another computer.
class Bridged extends EventEmitter {
  constructor(cfg, kind) { super(); this.cfg = cfg; this.kind = kind; this.vals = {}; this.last = ''; this.out = null; this.bridges = 0; this.connected = false; this.error = 'Starting…'; this.hw = null; this.down = new Map(); this.h = {}; }
  matches(name) { const f = String(this.cfg.host || '').trim().toLowerCase(); return !f || String(name || '').toLowerCase().includes(f); }
  mine() { const st = this.hw ? this.hw.state() : null; if (!st) return []; return this.kind === 'midi' ? st.midiIn.filter((n) => this.matches(n)) : st.hid.filter((x) => this.matches(x.name)); }
  refresh() {
    const st = this.hw ? this.hw.state() : null, mine = this.mine();
    const on = mine.length > 0 || this.bridges > 0;
    const err = on ? '' : st && !st.ok ? (st.error || 'Starting…') : this.kind === 'midi' ? (this.cfg.host ? `No MIDI input with "${this.cfg.host}" in its name` : 'No MIDI input found on this PC') : (this.cfg.host ? `No X-keys with "${this.cfg.host}" in its name` : 'No X-keys found on this PC (plug it in; it is picked up within a few seconds)');
    if (on !== this.connected || err !== this.error) { this.connected = on; this.error = err; this.emit('status'); }
  }
  start() {
    if (!this.hw) { this.refresh(); return; }
    this.h.status = () => this.refresh();
    this.h.midi = (m) => { if (this.kind === 'midi' && this.matches(m.port)) this.midiIn(m.port, m.bytes); };
    this.h.hid = (m) => { if (this.kind === 'xkeys' && this.matches(m.name)) this.hidIn(m.id, m.bytes); };
    for (const [e, f] of Object.entries(this.h)) this.hw.on(e, f);
    this.hw.start();
    this.refresh();
  }
  stop() { if (this.hw) for (const [e, f] of Object.entries(this.h)) this.hw.off(e, f); this.h = {}; }
  setBridges(n) { this.bridges = n; this.refresh(); }
  midiIn(port, b) {
    const t = b[0] & 0xf0, channel = (b[0] & 0x0f) + 1;
    if (t === 0x90) this.input({ kind: 'note', note: b[1], velocity: b[2] || 0, channel, port });
    else if (t === 0x80) this.input({ kind: 'note', note: b[1], velocity: 0, channel, port });
    else if (t === 0xb0) this.input({ kind: 'cc', cc: b[1], value: b[2] || 0, channel, port });
    else if (t === 0xc0) this.input({ kind: 'pc', program: b[1], channel, port });
  }
  hidIn(id, bytes) {
    const now = xkeysKeys(bytes), was = this.down.get(id) || new Set();
    for (const k of now) if (!was.has(k)) this.input({ kind: 'xkeys', key: k, down: true });
    for (const k of was) if (!now.has(k)) this.input({ kind: 'xkeys', key: k, down: false });
    this.down.set(id, now);
  }
  input(d) {
    if (this.kind === 'xkeys') { const k = 'key' + (Number(d.key) || 0); this.vals[k] = d.down ? '1' : ''; if (d.down) this.last = String(d.key); }
    else {
      const ch = Number(d.channel) || 1;
      if (Number(this.cfg.channel) > 0 && ch !== Number(this.cfg.channel)) return;
      if (d.kind === 'note') { this.vals['note' + d.note] = d.velocity > 0 ? String(d.velocity) : ''; if (d.velocity > 0) this.last = `note ${d.note} ch ${ch}`; }
      else if (d.kind === 'cc') { this.vals['cc' + d.cc] = String(d.value); this.last = `cc ${d.cc} = ${d.value} ch ${ch}`; }
      else if (d.kind === 'pc') { this.vals.program = String(d.program); this.last = `program ${d.program} ch ${ch}`; }
    }
    if (Object.keys(this.vals).length > 400) this.vals = {};
    this.emit('change');
  }
  vars() { return Object.assign({ last: this.last }, this.vals); }
  async command(what, value) {
    const w = String(what || '').toLowerCase().trim(), a = {};
    String(value || '').split(/[\s,;&]+/).forEach((p) => { const m = /^(\w+)\s*[=:]\s*(\d+)$/.exec(p); if (m) a[m[1].toLowerCase()] = Number(m[2]); });
    const st = this.hw ? this.hw.state() : null;
    if (this.kind === 'xkeys') {
      if (!['light-on', 'light-off', 'light-flash', 'lights-off'].includes(w)) throw new Error('Unknown X-keys command ' + w);
      const units = st ? st.hid.filter((x) => this.matches(x.name)) : [];
      if (units.length) {
        const idx = Math.max(0, (a.key || 1) - 1) + (a.red ? 80 : 0);
        for (const u of units) {
          if (w === 'lights-off') { this.hw.hidOut(u.id, [0, 182, 0, 0]); this.hw.hidOut(u.id, [0, 182, 1, 0]); }
          else this.hw.hidOut(u.id, [0, 181, idx, w === 'light-on' ? 1 : w === 'light-flash' ? 2 : 0]);
        }
        return;
      }
      if (this.out && this.bridges) { this.out({ kind: 'xkeys', device: this.cfg.id, what: w, key: a.key || 0, color: a.red ? 'red' : 'blue' }); return; }
      throw new Error(this.error || 'No X-keys connected');
    }
    const ch = Math.max(1, Math.min(16, a.ch || a.channel || Number(this.cfg.channel) || 1)) - 1;
    let bytes;
    if (w === 'note-on' || w === 'note') bytes = [0x90 | ch, (a.note === undefined ? 60 : a.note) & 127, (a.vel === undefined ? (a.velocity === undefined ? 127 : a.velocity) : a.vel) & 127];
    else if (w === 'note-off') bytes = [0x80 | ch, (a.note === undefined ? 60 : a.note) & 127, 0];
    else if (w === 'cc') bytes = [0xb0 | ch, (a.cc || 0) & 127, (a.value === undefined ? a.v || 0 : a.value) & 127];
    else if (w === 'pc' || w === 'program') bytes = [0xc0 | ch, (a.program === undefined ? a.pc || 0 : a.program) & 127];
    else throw new Error('Unknown MIDI command ' + w);
    const pulse = w === 'note' ? (a.ms || 100) : 0;
    if (st && st.midiOut.some((n) => this.matches(n))) {
      this.hw.midiOut(this.cfg.host || '', bytes);
      if (pulse) setTimeout(() => { try { this.hw.midiOut(this.cfg.host || '', [0x80 | ch, bytes[1], 0]); } catch { /* gone */ } }, pulse).unref();
      return;
    }
    if (this.out && this.bridges) { this.out({ kind: 'midi', device: this.cfg.id, port: this.cfg.host || '', bytes, pulse }); return; }
    throw new Error(st && st.midiOut.length ? `No MIDI output with "${this.cfg.host}" in its name (outputs: ${st.midiOut.join(', ')})` : 'No MIDI output on this PC');
  }
  status() {
    const mine = this.mine(), names = this.kind === 'midi' ? mine : mine.map((x) => x.name);
    return { connected: this.connected, error: this.error, summary: this.connected ? `${names.length ? names.join(', ') : ''}${this.bridges ? (names.length ? ' · ' : '') + this.bridges + ' bridge page' + (this.bridges === 1 ? '' : 's') : ''}${this.last ? ' · last: ' + (this.kind === 'xkeys' ? 'key ' : '') + this.last : ''}` : '' };
  }
}
class Midi extends Bridged { constructor(cfg) { super(cfg, 'midi'); } }
Midi.COMMANDS = ['note', 'note-on', 'note-off', 'cc', 'pc'];
Midi.KEYS = ['last'];
class XKeys extends Bridged { constructor(cfg) { super(cfg, 'xkeys'); } }
XKeys.COMMANDS = ['light-on', 'light-off', 'light-flash', 'lights-off'];
XKeys.KEYS = ['last', ...Array.from({ length: 24 }, (_, i) => 'key' + (i + 1))];

VMix.KEYS = ['active', 'active_title', 'preview', 'preview_title', 'fadetoblack', 'streaming', 'streaming_time', 'recording', 'recording_time', 'external', 'version', ...[1, 2, 3, 4].flatMap((i) => [`overlay${i}`, `overlay${i}_title`, `overlay${i}_onair`])];
Atem.KEYS = ['program', 'program_name', 'preview', 'preview_name', 'ftb', ...[1, 2, 3, 4].map((i) => `key${i}_onair`), ...[1, 2].flatMap((i) => [`dsk${i}_onair`, `dsk${i}_transition`]), 'streaming', 'streaming_state', 'streaming_time', 'recording', 'recording_time', 'model'];
HyperDeck.KEYS = ['status', 'recording', 'playing', 'timecode', 'clip', 'slot'];
const KINDS = { vmix: { cls: VMix, port: 8088, name: 'vMix' }, atem: { cls: Atem, port: 9910, name: 'ATEM switcher' }, hyperdeck: { cls: HyperDeck, port: 9993, name: 'HyperDeck' }, pigpio: { cls: PiGpio, port: 8095, name: 'Raspberry Pi GPIO' },
  obs: { cls: Obs, port: 4455, name: 'OBS Studio' }, companion: { cls: Companion, port: 8000, name: 'Bitfocus Companion' }, osc: { cls: Osc, port: 8000, name: 'OSC' },
  artnet: { cls: ArtNet, port: 6454, name: 'Art-Net (DMX)', host: '255.255.255.255' }, midi: { cls: Midi, port: 0, name: 'MIDI', bridged: true }, xkeys: { cls: XKeys, port: 0, name: 'X-keys', bridged: true } };

function makeDevices(app) {
  const ev = new EventEmitter();
  const hw = makeHw(app);                    // MIDI and X-keys on this PC, shared by every MIDI / X-keys device
  let list = [];
  const conf = () => (Array.isArray(app.config.devices) ? app.config.devices : []);
  function clean(d, i) {
    const kind = KINDS[d && d.type] ? d.type : 'vmix', K = KINDS[kind];
    const prev = conf().find((x) => x && x.id === d.id && x.type === kind);
    const out = { id: slug(d.id || d.name || kind + (i + 1)), type: kind, name: String(d.name || K.name).slice(0, 40), host: String(d.host == null || d.host === '' ? (K.bridged ? '' : K.host || '127.0.0.1') : d.host).trim().slice(0, 100), port: Number(d.port) > 0 ? Number(d.port) : K.port, enabled: d.enabled !== false };
    if (kind === 'obs') out.password = typeof d.password === 'string' && d.password !== '********' ? d.password.slice(0, 200) : (prev && prev.password) || '';
    if (kind === 'osc') out.listen = Math.max(0, Math.min(65535, Number(d.listen) || 0));
    if (kind === 'artnet') out.universe = Math.max(0, Math.min(32767, Number(d.universe) || 0));
    if (kind === 'midi') out.channel = Math.max(0, Math.min(16, Number(d.channel) || 0));
    return out;
  }
  let bridgeOut = null, bridges = 0, last = {};
  const mappings = () => (Array.isArray(app.config.deviceMappings) ? app.config.deviceMappings : []);
  // a device value changed: input mappings fire on press (empty → something), release (→ empty) or any change
  // inputs a person can press: MIDI, X-keys, the Pi's GPIs, OSC, Companion (not clocks, scenes or tallies that change by themselves)
  const INPUT_KINDS = ['midi', 'xkeys', 'pigpio', 'osc', 'companion'];
  const inputKey = (k) => { const x = list.find((y) => k.startsWith(y.cfg.id + '_')); if (!x || !INPUT_KINDS.includes(x.cfg.type)) return null; const rest = k.slice(x.cfg.id.length + 1); if (/^(connected|last|last_in|last_press|name|gpo\d+)$/.test(rest)) return null; return x; };
  const learners = new Set();
  function learn(ms) {
    return new Promise((resolve) => {
      const l = (x) => { learners.delete(l); clearTimeout(t); resolve(x); };
      const t = setTimeout(() => { learners.delete(l); resolve(null); }, Math.max(1000, Math.min(60000, ms || 15000)));
      learners.add(l);
    });
  }
  function fireMappings() {
    const now = vars(), maps = mappings();
    for (const [k, b] of Object.entries(now)) {
      const a = last[k] || ''; if (a === b) continue;
      const x = inputKey(k); if (!x) continue;
      const ev2 = { key: k, value: b, pressed: !a && !!b, released: !!a && !b, device: x.cfg.name, kind: x.cfg.type };
      ev.emit('input', ev2);
      if (ev2.pressed || (b && !ev2.released && (x.cfg.type === 'osc' || /^cc\d+$/.test(k.slice(x.cfg.id.length + 1))))) for (const l of [...learners]) l(ev2);
    }
    if (maps.length) for (const m of maps) {
      if (!m || m.off || !m.when) continue;
      const a = last[m.when] || '', b = now[m.when] || '';
      if (a === b) continue;
      if ((m.on === 'press' && !a && b) || (m.on === 'release' && a && !b) || m.on === 'change' || (m.on === 'equals' && b === String(m.value || '') && a !== b)) ev.emit('mapping', m, b);
    }
    last = now;
  }
  function start() {
    for (const x of list) try { x.dev.stop(); } catch { /* stopped */ }
    const seen = new Set();
    list = conf().map(clean).filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; }).map((c) => {
      const dev = new KINDS[c.type].cls(c);
      dev.on('change', () => { fireMappings(); ev.emit('change'); });
      if (dev instanceof Bridged) { dev.hw = hw; dev.out = (m) => { if (bridgeOut) bridgeOut(m); }; dev.bridges = bridges; }
      dev.on('status', () => { log(`${c.name}: ${dev.connected ? 'connected' : 'not connected' + (dev.error ? ' (' + dev.error + ')' : '')}`); ev.emit('status'); });
      if (c.enabled) dev.start();
      return { cfg: c, dev };
    });
    if (!list.some((x) => x.cfg.enabled && x.dev instanceof Bridged)) hw.stop();     // nothing needs MIDI / X-keys any more
    ev.emit('status');
  }
  // live values: <id>_<value>, e.g. vmix_streaming_time, atem_dsk1_onair, atem_program_name
  function vars() { const out = {}; for (const x of list) { if (!x.cfg.enabled) continue; for (const [k, v] of Object.entries(x.dev.vars())) out[`${x.cfg.id}_${k}`] = v == null ? '' : String(v); out[`${x.cfg.id}_connected`] = flag(x.dev.connected); } return out; }
  async function command(id, what, value) {
    const x = list.find((y) => y.cfg.id === id);
    if (!x) throw new HttpError(400, `No device "${id}"`);
    if (!x.cfg.enabled) throw new HttpError(400, `${x.cfg.name} is switched off`);
    if (!String(what || '').trim()) throw new HttpError(400, 'Give a command');
    try { await x.dev.command(what, value); } catch (e) { throw new HttpError(400, `${x.cfg.name}: ${e.message}`); }
  }
  // every value name a configured device gives, also while it is not connected (for linking template fields and triggers)
  const keys = () => list.flatMap((x) => [...new Set([...KINDS[x.cfg.type].cls.KEYS, ...Object.keys(x.dev.vars())])].map((k) => ({ key: `${x.cfg.id}_${k}`, device: x.cfg.name })).concat([{ key: `${x.cfg.id}_connected`, device: x.cfg.name }]));
  const ids = () => list.map((x) => x.cfg.id);
  const state = () => list.map((x) => Object.assign({}, x.cfg, x.cfg.password ? { password: '********' } : {}, x.dev.status(), { commands: KINDS[x.cfg.type].cls.COMMANDS, bridged: !!KINDS[x.cfg.type].bridged }));
  function save(next) { app.config.devices = (Array.isArray(next) ? next : []).slice(0, 40).map(clean); app.saveConfig(); start(); }
  function saveMappings(list2, clean2) {
    app.config.deviceMappings = (Array.isArray(list2) ? list2 : []).slice(0, 200).filter((m) => m && String(m.when || '').trim()).map((m) => ({
      id: String(m.id || 'map_' + Math.random().toString(36).slice(2, 10)).slice(0, 40), label: String(m.label || '').slice(0, 60), when: String(m.when).trim().replace(/^\{|\}$/g, '').slice(0, 120),
      on: ['press', 'release', 'change', 'equals'].includes(m.on) ? m.on : 'press', value: String(m.value == null ? '' : m.value).slice(0, 200), off: !!m.off, actions: clean2 ? clean2(m.actions) : [] }));
    app.saveConfig();
  }
  // the bridge page (MIDI / X-keys in the browser)
  function bridgeIn(d) {
    const kind = d && d.kind === 'xkeys' ? 'xkeys' : 'midi';
    for (const x of list) if (x.cfg.enabled && x.cfg.type === kind && (!x.cfg.host || kind !== 'midi' || String(d.port || '').toLowerCase().includes(x.cfg.host.toLowerCase()))) x.dev.input(d);
  }
  function setBridges(n, out) { bridges = n; bridgeOut = out || bridgeOut; for (const x of list) if (x.dev instanceof Bridged) x.dev.setBridges(n); }
  function close() { for (const x of list) try { x.dev.stop(); } catch { /* stopped */ } list = []; hw.stop(); }
  return { start, vars, keys, ids, command, state, save, close, mappings, saveMappings, learn, hw: () => hw.state(), hwRaw: (l) => hw.raw(l), bridgeIn, setBridges, bridged: () => list.filter((x) => KINDS[x.cfg.type].bridged).map((x) => ({ id: x.cfg.id, type: x.cfg.type, name: x.cfg.name, port: x.cfg.host })), on: (e, f) => ev.on(e, f), kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { name: v.name, port: v.port, host: v.host || '', bridged: !!v.bridged, commands: v.cls.COMMANDS }])) };
}

module.exports = { makeDevices, VMix, Atem, HyperDeck, PiGpio, Obs, Companion, Osc, ArtNet, Midi, XKeys, oscEncode, oscDecode, oscArgs };
