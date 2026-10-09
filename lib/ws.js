'use strict';
// Minimal WebSocket server (RFC 6455) on top of Node's http "upgrade" event. Text frames only.
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX = 2 * 1024 * 1024;

class Socket extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock; this.buf = Buffer.alloc(0); this.parts = []; this.open = true; this.alive = true;
    sock.on('data', (d) => this.onData(d));
    sock.on('close', () => this.end());
    sock.on('error', () => this.end());
  }

  end() { if (!this.open) return; this.open = false; this.emit('close'); try { this.sock.destroy(); } catch { /* ignore */ } }

  frame(op, payload) {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.sock.write(Buffer.concat([head, payload])); } catch { this.end(); }
  }

  send(obj) { if (this.open) this.frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))); }
  ping() { if (this.open) this.frame(9, Buffer.alloc(0)); }
  close() { if (this.open) { this.frame(8, Buffer.alloc(0)); this.end(); } }

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const fin = (this.buf[0] & 0x80) !== 0;
      const op = this.buf[0] & 0x0f;
      const masked = (this.buf[1] & 0x80) !== 0;
      let len = this.buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > BigInt(MAX)) return this.close(); len = Number(big); off = 10; }
      if (len > MAX) return this.close();
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(need);
      if (op === 8) return this.close();
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 10) { this.alive = true; continue; }
      if (op === 1 || op === 2 || op === 0) {
        this.parts.push(payload);
        if (this.parts.reduce((n, p) => n + p.length, 0) > MAX) return this.close();
        if (fin) {
          const text = Buffer.concat(this.parts).toString('utf8');
          this.parts = [];
          this.alive = true;
          this.emit('message', text);
        }
      }
    }
  }
}

function accept(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return null; }
  const hash = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${hash}\r\n\r\n`);
  sock.setNoDelay(true);
  return new Socket(sock);
}

module.exports = { accept };
