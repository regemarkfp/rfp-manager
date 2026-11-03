'use strict';
// MEDIA_DIR: the database keeps the images and a copy of each is written to a folder (a NAS share).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileBlobs, MirrorBlobs } = require('../lib/blobs');

test('images are kept in the database and copied to the folder', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-mirror-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mem = new Map();
  const primary = { kind: 'mongo', put: async (d, b) => { mem.set(d.id, b); }, get: async (d) => mem.get(d.id) || null, has: async (d) => mem.has(d.id) };
  const blobs = new MirrorBlobs(primary, new FileBlobs(() => dir));
  const img = (id, name) => ({ id, team: 't', data: { file: `${name}_${id.slice(-8)}.png` } });
  await blobs.put(img('image_aaaaaaaa', 'logo'), Buffer.from('one'));
  assert.equal(fs.readFileSync(path.join(dir, 'logo_aaaaaaaa.png'), 'utf8'), 'one');
  mem.set('image_bbbbbbbb', Buffer.from('two'));                      // already in the database before the copy existed
  assert.equal(await blobs.fill([img('image_aaaaaaaa', 'logo'), img('image_bbbbbbbb', 'crest')]), 1);
  assert.equal(fs.readFileSync(path.join(dir, 'crest_bbbbbbbb.png'), 'utf8'), 'two');
  assert.equal(String(await blobs.get(img('image_bbbbbbbb', 'crest'))), 'two');
  assert.equal(blobs.localPath(img('image_aaaaaaaa', 'logo')), path.join(dir, 'logo_aaaaaaaa.png'));
});
