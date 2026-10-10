'use strict';
// The program itself as a .tar.gz, for setting up a server from this website (tools/server/install.sh).
// Only the program: no data, no config.json, no keys.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PARTS = ['server.js', 'package.json', 'README.md', 'config.example.json', 'lib', 'public', 'shared', 'templates', 'tools/server'];
const SKIP = /(^|\/)(node_modules|data|\.git|\.DS_Store)(\/|$)|(^|\/)config\.json$/;

function header(name, size, mtime) {
  const h = Buffer.alloc(512);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {                      // ustar: a long name is split at a "/" into prefix (155) + name (100)
    let cut = -1;
    for (let i = name.indexOf('/'); i > 0; i = name.indexOf('/', i + 1)) if (i <= 155 && Buffer.byteLength(name.slice(i + 1)) <= 100) { cut = i; break; }
    if (cut < 0) throw new Error('File name too long for the bundle: ' + name);
    prefix = name.slice(0, cut); name = name.slice(cut + 1);
  }
  const put = (s, off, len) => h.write(s, off, len, 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name, 0, 100);
  put(oct(0o644, 8), 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12); put(oct(Math.floor(mtime / 1000), 12), 136, 12);
  put('        ', 148, 8);                                 // checksum is worked out with spaces here
  put('0', 156, 1);
  put('ustar\0', 257, 6); put('00', 263, 2);
  put('rfp', 265, 32); put('rfp', 297, 32);
  put(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

function walk(root, rel, out) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full) || SKIP.test(rel)) return;
  const st = fs.statSync(full);
  if (st.isDirectory()) { for (const f of fs.readdirSync(full).sort()) walk(root, rel + '/' + f, out); return; }
  if (st.isFile()) out.push({ rel, full, st });
}

async function bundle(root, top = 'rfp-manager') {
  const files = [];
  for (const p of PARTS) walk(root, p, files);
  const chunks = [];
  for (const f of files) {
    const data = fs.readFileSync(f.full);
    chunks.push(header(top + '/' + f.rel, data.length, f.st.mtimeMs), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 6 });
}

module.exports = { bundle };
