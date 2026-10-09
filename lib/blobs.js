'use strict';
// Per-machine image folder. Every image this machine knows about is kept as a real file in the folder
// chosen in Settings > This machine, so CasparCG templates (and anything else) can load it from disk.
const fs = require('node:fs');
const path = require('node:path');
const { slug } = require('./util');

const MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
};
const EXT_MIME = Object.fromEntries(Object.entries(MIME).map(([m, e]) => [e, m]));

const safeFile = (f) => (typeof f === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(f) && !f.includes('..') ? f : null);
const fileNameFor = (id, name, mime) => `${slug(name) || 'image'}_${id.slice(-8)}.${MIME[mime] || 'bin'}`;

class FileBlobs {
  constructor(getDir) { this.getDir = getDir; this.kind = 'folder'; }
  dir() { const d = this.getDir(); fs.mkdirSync(d, { recursive: true }); return d; }
  localPath(imageDoc) {
    const f = safeFile(imageDoc && imageDoc.data && imageDoc.data.file);
    return f ? path.join(this.dir(), f) : null;
  }
  async put(imageDoc, buf) {
    const p = this.localPath(imageDoc);
    if (!p) throw new Error('Invalid image file name');
    const tmp = p + '.part';
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, p);
  }
  async get(imageDoc) {
    const p = this.localPath(imageDoc);
    if (!p) return null;
    try { return await fs.promises.readFile(p); } catch { return null; }
  }
  async has(imageDoc) {
    const p = this.localPath(imageDoc);
    if (!p) return false;
    try { return (await fs.promises.stat(p)).size > 0; } catch { return false; }
  }
}

module.exports = { FileBlobs, MIME, EXT_MIME, safeFile, fileNameFor };
