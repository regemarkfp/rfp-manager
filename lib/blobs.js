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

// The database keeps the images (so every machine syncs them); a copy of each is also kept as a file in a folder,
// e.g. a NAS share, so all the assets sit in one place where people and CasparCG can open them.
class MirrorBlobs {
  constructor(primary, mirror) { this.primary = primary; this.mirror = mirror; this.kind = primary.kind; }
  async put(imageDoc, buf) {
    await this.primary.put(imageDoc, buf);
    try { await this.mirror.put(imageDoc, buf); } catch { /* the copy is a convenience: never fail a save for it */ }
  }
  async get(imageDoc) { return (await this.primary.get(imageDoc)) || this.mirror.get(imageDoc); }
  async has(imageDoc) { return this.primary.has(imageDoc); }
  localPath(imageDoc) { return this.mirror.localPath(imageDoc); }
  // writes the files the folder does not have yet (all images on the first start)
  async fill(images, log) {
    let n = 0;
    for (const d of images) {
      try { if (!(await this.mirror.has(d))) { const b = await this.primary.get(d); if (b) { await this.mirror.put(d, b); n++; } } } catch { /* next */ }
    }
    if (n && log) log(`Images: ${n} copied to ${this.mirror.dir()}`);
    return n;
  }
}

module.exports = { FileBlobs, MirrorBlobs, MIME, EXT_MIME, safeFile, fileNameFor };
