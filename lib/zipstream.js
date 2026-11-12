'use strict';
// A ZIP written straight to a stream, file by file, without holding anything in memory: for downloading whole shared
// folders of camera footage (many GB). Files are stored (video and photos do not compress); the CRC is worked out while
// each file is read and written after it (data descriptor). ZIP64 is used where sizes or offsets pass 4 GB.
//   await zipTo(out, [{ name: 'Day 1/A001.mov', file: '/srv/nas/…', size, mtime }])
const fs = require('node:fs');
const zlib = require('node:zlib');

const MAX32 = 0xffffffff;
function dos(d) {
  d = d instanceof Date && !isNaN(d) ? d : new Date();
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

// write a buffer, waiting when the receiver is full (and stopping if it went away)
function writer(out) {
  let closed = false;
  out.on('close', () => { closed = true; });
  return (buf) => new Promise((resolve, reject) => {
    if (closed || out.destroyed) return reject(new Error('The download was stopped'));
    if (out.write(buf)) resolve(); else out.once('drain', resolve);
  });
}

async function zipTo(out, entries, opts = {}) {
  const write = writer(out), LIM = opts.zip64At || MAX32;   // zip64At: only for tests (ZIP64 without 4 GB files)
  let offset = 0;
  const central = [];
  for (const e of entries) {
    const name = Buffer.from(String(e.name).replace(/\\/g, '/'), 'utf8');
    const { time, date } = dos(e.mtime ? new Date(e.mtime) : new Date());
    const big = e.size >= LIM || offset >= LIM;
    // local header: CRC follows in the data descriptor (flag 8); bit 11 = UTF-8 names
    const extra = big ? Buffer.concat([u16(0x0001), u16(16), u64(e.size), u64(e.size)]) : Buffer.alloc(0);
    const local = Buffer.concat([u32(0x04034b50), u16(big ? 45 : 20), u16(0x0808), u16(0), u16(time), u16(date), u32(0),
      u32(big ? MAX32 : e.size), u32(big ? MAX32 : e.size), u16(name.length), u16(extra.length), name, extra]);
    const at = offset;
    await write(local); offset += local.length;
    let crc = 0, n = 0;
    if (e.file) {
      for await (const chunk of fs.createReadStream(e.file, { highWaterMark: 1024 * 1024 })) {
        crc = zlib.crc32(chunk, crc); n += chunk.length;
        await write(chunk);
      }
    }
    if (n !== e.size) throw new Error(`${e.name} changed while it was being zipped`);
    offset += n;
    const desc = big ? Buffer.concat([u32(0x08074b50), u32(crc), u64(n), u64(n)]) : Buffer.concat([u32(0x08074b50), u32(crc), u32(n), u32(n)]);
    await write(desc); offset += desc.length;
    central.push({ name, time, date, crc, size: n, at });
  }
  // central directory
  const cdStart = offset;
  for (const c of central) {
    const need64 = c.size >= LIM || c.at >= LIM;
    const z = need64 ? Buffer.concat([u16(0x0001), u16(24), u64(c.size), u64(c.size), u64(c.at)]) : Buffer.alloc(0);
    const rec = Buffer.concat([u32(0x02014b50), u16(need64 ? 45 : 20), u16(need64 ? 45 : 20), u16(0x0808), u16(0), u16(c.time), u16(c.date), u32(c.crc),
      u32(need64 ? MAX32 : c.size), u32(need64 ? MAX32 : c.size), u16(c.name.length), u16(z.length), u16(0), u16(0), u16(0), u32(0), u32(need64 ? MAX32 : c.at), c.name, z]);
    await write(rec); offset += rec.length;
  }
  const cdSize = offset - cdStart, many = central.length >= 0xffff, z64 = cdStart >= MAX32 || cdSize >= MAX32 || many || central.some((c) => c.size >= MAX32 || c.at >= MAX32);
  if (z64) {
    const eocd64At = offset;
    const eocd64 = Buffer.concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(central.length), u64(central.length), u64(cdSize), u64(cdStart)]);
    const loc = Buffer.concat([u32(0x07064b50), u32(0), u64(eocd64At), u32(1)]);
    await write(Buffer.concat([eocd64, loc])); offset += eocd64.length + loc.length;
  }
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(z64 ? 0xffff : central.length), u16(z64 ? 0xffff : central.length),
    u32(z64 ? MAX32 : cdSize), u32(z64 ? MAX32 : cdStart), u16(0)]);
  await write(end);
  return { files: central.length, bytes: offset + end.length };
}
// the size the ZIP will be (for Content-Length, so browsers show a progress bar)
function zipSize(entries, opts = {}) {
  const MAX32x = opts.zip64At || MAX32;
  let off = 0, cd = 0;
  for (const e of entries) {
    const nl = Buffer.byteLength(String(e.name).replace(/\\/g, '/'), 'utf8'), big = e.size >= MAX32x || off >= MAX32x;
    const at = off;
    off += 30 + nl + (big ? 20 : 0) + e.size + (big ? 24 : 16);
    cd += 46 + nl + (e.size >= MAX32x || at >= MAX32x ? 28 : 0);
  }
  const z64 = off >= MAX32x || cd >= MAX32x || entries.length >= 0xffff || entries.some((e, i) => e.size >= MAX32x);
  // (a file starting past 4 GB also needs ZIP64 in its central record; worked out above with `at`)
  return off + cd + (z64 ? 56 + 20 : 0) + 22;
}

module.exports = { zipTo, zipSize };
