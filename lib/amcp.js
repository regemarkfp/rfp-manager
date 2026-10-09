'use strict';
// CasparCG AMCP client (TCP 5250) with auto-reconnect.
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { log } = require('./util');

const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';

const cmd = {
  cgAdd: (ch, layer, template, data) => `CG ${ch}-${layer} ADD 1 ${q(template)} 1 ${q(data)}`,
  cgUpdate: (ch, layer, data) => `CG ${ch}-${layer} UPDATE 1 ${q(data)}`,
  cgStop: (ch, layer) => `CG ${ch}-${layer} STOP 1`,
  cgNext: (ch, layer) => `CG ${ch}-${layer} NEXT 1`,
  play: (ch, layer, clip) => `PLAY ${ch}-${layer} ${q(clip)} MIX 12`,
  stop: (ch, layer) => `STOP ${ch}-${layer}`,
  clearLayer: (ch, layer) => `CLEAR ${ch}-${layer}`,
  clear: (ch) => `CLEAR ${ch}`,
};

class Amcp extends EventEmitter {
  constructor(getCfg) {
    super();
    this.getCfg = getCfg; this.connected = false; this.sock = null; this.pending = []; this.buf = ''; this.timer = null; this.version = ''; this.closed = false;
  }
  cfg() { return this.getCfg() || {}; }
  get enabled() { return this.cfg().enabled !== false; }

  start() { this.closed = false; this.connect(); }
  stop() { this.closed = true; clearTimeout(this.timer); if (this.sock) this.sock.destroy(); }
  reconnect() { clearTimeout(this.timer); if (this.sock) this.sock.destroy(); else this.connect(); }

  connect() {
    clearTimeout(this.timer);
    if (this.closed || !this.enabled) { this.setState(false); return; }
    const { host = '127.0.0.1', port = 5250 } = this.cfg();
    const sock = net.createConnection({ host, port: Number(port) });
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.setNoDelay(true);
    sock.on('connect', () => {
      this.setState(true);
      log(`CasparCG: connected to ${host}:${port}`);
      this.send('VERSION').then((r) => { this.version = r.data || ''; this.emit('state'); }).catch(() => {});
    });
    sock.on('data', (d) => this.onData(d));
    sock.on('error', () => { /* close follows */ });
    sock.on('close', () => {
      if (this.sock !== sock) return;
      const was = this.connected;
      this.sock = null; this.setState(false);
      for (const p of this.pending.splice(0)) { clearTimeout(p.timer); p.reject(new Error('CasparCG connection lost')); }
      if (was) log('CasparCG: disconnected');
      if (!this.closed && this.enabled) this.timer = setTimeout(() => this.connect(), 3000);
    });
  }

  setState(c) { if (this.connected !== c) { this.connected = c; if (!c) this.version = ''; this.emit('state'); } }

  onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\r\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const cur = this.pending[0];
      if (cur && cur.wantData) { cur.wantData = false; cur.res.data = line; this.finish(); continue; }
      const m = /^(\d{3}) (.*)$/.exec(line);
      if (!m || !cur) continue;
      cur.res = { code: Number(m[1]), text: m[2], data: '' };
      if (cur.res.code === 201) cur.wantData = true; else this.finish();
    }
  }

  finish() {
    const p = this.pending.shift();
    clearTimeout(p.timer);
    if (p.res.code >= 400) p.reject(new Error('CasparCG: ' + p.res.code + ' ' + p.res.text)); else p.resolve(p.res);
  }

  send(command) {
    return new Promise((resolve, reject) => {
      if (!this.enabled) return reject(new Error('CasparCG output is switched off'));
      if (!this.connected || !this.sock) return reject(new Error('CasparCG is not connected'));
      const p = { resolve, reject, res: null, wantData: false };
      p.timer = setTimeout(() => { const i = this.pending.indexOf(p); if (i >= 0) this.pending.splice(i, 1); reject(new Error('CasparCG did not answer')); }, 4000);
      this.pending.push(p);
      this.sock.write(command + '\r\n');
      this.emit('sent', command);
    });
  }

  status() { const c = this.cfg(); return { enabled: this.enabled, connected: this.connected, host: c.host || '127.0.0.1', port: c.port || 5250, channel: c.channel || 1, version: this.version }; }
}

module.exports = { Amcp, cmd, quote: q };
