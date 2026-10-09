'use strict';
// Online database: MongoDB (Atlas free tier). Same interface as the SQLite store.
// Needs the official driver:  npm install mongodb

const out = (d) => d && {
  id: d._id, team: d.team, type: d.type, data: d.data || {}, updatedAt: d.updatedAt,
  updatedBy: d.updatedBy || '', deleted: !!d.deleted, seq: d.seq,
};

class MongoStore {
  constructor(uri, dbName, driver) { this.uri = uri; this.dbName = dbName; this.driver = driver; this.kind = 'mongo'; this.chain = Promise.resolve(); }

  async init() {
    const { MongoClient } = this.driver || require('mongodb');
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db(this.dbName || undefined);
    this.docs = this.db.collection('docs');
    this.kv = this.db.collection('kv');
    this.blobs = this.db.collection('blobs');
    await this.docs.createIndex({ team: 1, type: 1 });
    await this.docs.createIndex({ team: 1, seq: 1 });
    await this.docs.createIndex({ type: 1, 'data.email': 1 });
  }

  async nextSeq() {
    const r = await this.kv.findOneAndUpdate({ _id: 'seq' }, { $inc: { value: 1 } }, { upsert: true, returnDocument: 'after' });
    const v = r && r.value;                       // driver v6 returns the document, v5 wraps it in { value }
    return typeof v === 'object' && v !== null ? v.value : v;
  }

  async get(id) { return out(await this.docs.findOne({ _id: id })) || null; }
  async list(team, type) { return (await this.docs.find({ team, type, deleted: false }).toArray()).map(out); }
  async listTeam(team) { return (await this.docs.find({ team, deleted: false }).toArray()).map(out); }
  async listType(type) { return (await this.docs.find({ type, deleted: false }).toArray()).map(out); }
  async listAll() { return (await this.docs.find({ deleted: false }).toArray()).map(out); }

  async find(type, field, value) {
    if (!/^\w+$/.test(field)) throw new Error('bad field');
    return (await this.docs.find({ type, deleted: false, ['data.' + field]: value }).toArray()).map(out);
  }

  // Writes are queued so sequence numbers are stored in the order they are handed out.
  put(doc) {
    const run = async () => {
      const seq = await this.nextSeq();
      const row = { team: doc.team || '', type: doc.type, data: doc.data || {}, updatedAt: doc.updatedAt,
        updatedBy: doc.updatedBy || '', deleted: !!doc.deleted, seq };
      await this.docs.updateOne({ _id: doc.id }, { $set: row }, { upsert: true });
      return { id: doc.id, ...row };
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async changes(since, teams, limit = 500) {
    if (!teams.length) return [];
    return (await this.docs.find({ seq: { $gt: since }, team: { $in: teams } }).sort({ seq: 1 }).limit(limit).toArray()).map(out);
  }

  async dirty() { return []; }
  async dirtyCount() { return 0; }
  async clearDirty() { /* the online database is never "dirty" */ }
  async teamExists(team) { return !!(await this.docs.findOne({ team })); }
  async currentSeq() { const d = await this.kv.findOne({ _id: 'seq' }); return d ? d.value : 0; }

  async kvGet(k) { const d = await this.kv.findOne({ _id: 'kv:' + k }); return d ? d.value : null; }
  async kvSet(k, v) { await this.kv.updateOne({ _id: 'kv:' + k }, { $set: { value: v } }, { upsert: true }); }
  async kvDel(k) { await this.kv.deleteOne({ _id: 'kv:' + k }); }

  async close() { try { await this.client.close(); } catch { /* ignore */ } }
}

// Image storage inside MongoDB (free hosts have no permanent disk).
class MongoBlobs {
  constructor(store) { this.store = store; this.kind = 'mongo'; }
  async put(imageDoc, buf) {
    await this.store.blobs.updateOne({ _id: imageDoc.id }, { $set: { team: imageDoc.team, data: buf, size: buf.length } }, { upsert: true });
  }
  async get(imageDoc) {
    const d = await this.store.blobs.findOne({ _id: imageDoc.id });
    if (!d) return null;
    const b = d.data;
    return Buffer.isBuffer(b) ? b : Buffer.from(b.buffer || b.value?.(true) || b);
  }
  async has(imageDoc) { return !!(await this.store.blobs.findOne({ _id: imageDoc.id }, { projection: { _id: 1 } })); }
  localPath() { return null; }
}

module.exports = { MongoStore, MongoBlobs };
