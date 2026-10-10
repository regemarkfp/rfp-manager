'use strict';
// A small in-memory stand-in for the parts of the MongoDB driver that RFP Manager uses, so the
// MongoDB store can be exercised without a database server.
const getPath = (o, p) => p.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), o);
const matches = (d, q) => Object.entries(q).every(([k, v]) => {
  const x = getPath(d, k);
  if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
    if ('$gt' in v) return x > v.$gt;
    if ('$in' in v) return v.$in.includes(x);
  }
  return x === v;
});
const copy = (d) => (d === null || d === undefined ? d : { ...structuredClone({ ...d, data: undefined }), data: Buffer.isBuffer(d.data) ? Buffer.from(d.data) : structuredClone(d.data) });

class Collection {
  constructor() { this.rows = new Map(); }
  async createIndex() { return 'ok'; }
  async findOne(q) { for (const d of this.rows.values()) if (matches(d, q)) return copy(d); return null; }
  find(q) {
    let list = [...this.rows.values()].filter((d) => matches(d, q));
    const cur = { sort: (s) => { const [k, dir] = Object.entries(s)[0]; list.sort((a, b) => (a[k] - b[k]) * dir); return cur; }, limit: (n) => { list = list.slice(0, n); return cur; }, toArray: async () => list.map(copy) };
    return cur;
  }
  async updateOne(q, u, o = {}) {
    let d = [...this.rows.values()].find((x) => matches(x, q));
    if (!d) { if (!o.upsert) return { matchedCount: 0 }; d = { _id: q._id }; this.rows.set(d._id, d); }
    Object.assign(d, copy({ ...u.$set, data: u.$set.data }));
    if (u.$set.data === undefined) delete d.data, Object.assign(d, structuredClone(u.$set));
    return { matchedCount: 1 };
  }
  async findOneAndUpdate(q, u, o = {}) {
    let d = this.rows.get(q._id);
    if (!d) { if (!o.upsert) return null; d = { _id: q._id }; this.rows.set(d._id, d); }
    for (const [k, v] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + v;
    return { ...d };                                  // driver v6 shape: the document itself
  }
  async deleteOne(q) { for (const [k, d] of this.rows) if (matches(d, q)) { this.rows.delete(k); return { deletedCount: 1 }; } return { deletedCount: 0 }; }
}

const databases = new Map();
class MongoClient {
  constructor(uri) { this.uri = uri; }
  async connect() { return this; }
  db(name) {
    const key = this.uri + '/' + name;
    if (!databases.has(key)) databases.set(key, new Map());
    const cols = databases.get(key);
    return { collection: (n) => { if (!cols.has(n)) cols.set(n, new Collection()); return cols.get(n); } };
  }
  async close() { /* nothing to close */ }
}

module.exports = { MongoClient };
