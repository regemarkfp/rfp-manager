'use strict';
// Local database: one SQLite file per machine (uses Node's built-in node:sqlite, nothing to install).
const path = require('node:path');
const fs = require('node:fs');

const row2doc = (r) => r && {
  id: r.id, team: r.team, type: r.type, data: JSON.parse(r.data), updatedAt: r.updatedAt,
  updatedBy: r.updatedBy || '', deleted: !!r.deleted, seq: r.seq,
};

class SqliteStore {
  constructor(file) { this.file = file; this.kind = 'sqlite'; }

  async init() {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY, team TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL,
        updatedAt INTEGER NOT NULL, updatedBy TEXT, deleted INTEGER NOT NULL DEFAULT 0,
        seq INTEGER NOT NULL, dirty INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS docs_team_type ON docs(team, type);
      CREATE INDEX IF NOT EXISTS docs_seq ON docs(seq);
      CREATE INDEX IF NOT EXISTS docs_type ON docs(type);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
    this.seq = this.db.prepare('SELECT COALESCE(MAX(seq),0) AS s FROM docs').get().s;
    this.q = {
      get: this.db.prepare('SELECT * FROM docs WHERE id = ?'),
      list: this.db.prepare('SELECT * FROM docs WHERE team = ? AND type = ? AND deleted = 0'),
      team: this.db.prepare('SELECT * FROM docs WHERE team = ? AND deleted = 0'),
      type: this.db.prepare('SELECT * FROM docs WHERE type = ? AND deleted = 0'),
      all: this.db.prepare('SELECT * FROM docs WHERE deleted = 0'),
      put: this.db.prepare(`INSERT INTO docs (id, team, type, data, updatedAt, updatedBy, deleted, seq, dirty)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET team=excluded.team, type=excluded.type, data=excluded.data,
        updatedAt=excluded.updatedAt, updatedBy=excluded.updatedBy, deleted=excluded.deleted,
        seq=excluded.seq, dirty=excluded.dirty`),
      dirty: this.db.prepare('SELECT * FROM docs WHERE dirty = 1 ORDER BY seq LIMIT ?'),
      dirtyCount: this.db.prepare('SELECT COUNT(*) AS n FROM docs WHERE dirty = 1'),
      clear: this.db.prepare('UPDATE docs SET dirty = 0 WHERE id = ? AND updatedAt = ?'),
      any: this.db.prepare('SELECT 1 AS x FROM docs WHERE team = ? LIMIT 1'),
      kvGet: this.db.prepare('SELECT v FROM kv WHERE k = ?'),
      kvSet: this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
      kvDel: this.db.prepare('DELETE FROM kv WHERE k = ?'),
    };
  }

  async get(id) { return row2doc(this.q.get.get(id)) || null; }
  async list(team, type) { return this.q.list.all(team, type).map(row2doc); }
  async listTeam(team) { return this.q.team.all(team).map(row2doc); }
  async listType(type) { return this.q.type.all(type).map(row2doc); }
  async listAll() { return this.q.all.all().map(row2doc); }

  async find(type, field, value) {
    if (!/^\w+$/.test(field)) throw new Error('bad field');
    return this.db.prepare(`SELECT * FROM docs WHERE type = ? AND deleted = 0 AND json_extract(data, '$.${field}') = ?`)
      .all(type, value).map(row2doc);
  }

  async put(doc, { dirty = true } = {}) {
    const seq = ++this.seq;
    this.q.put.run(doc.id, doc.team || '', doc.type, JSON.stringify(doc.data || {}), doc.updatedAt, doc.updatedBy || '',
      doc.deleted ? 1 : 0, seq, dirty ? 1 : 0);
    return { ...doc, team: doc.team || '', deleted: !!doc.deleted, seq };
  }

  async changes(since, teams, limit = 500) {
    if (!teams.length) return [];
    const marks = teams.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM docs WHERE seq > ? AND team IN (${marks}) ORDER BY seq LIMIT ?`)
      .all(since, ...teams, limit).map(row2doc);
  }

  async dirty(limit = 200) { return this.q.dirty.all(limit).map(row2doc); }
  async dirtyCount() { return this.q.dirtyCount.get().n; }
  async clearDirty(id, updatedAt) { this.q.clear.run(id, updatedAt); }
  async markAllDirty() { this.db.exec("UPDATE docs SET dirty = 1 WHERE type NOT IN ('machinekey')"); }
  async teamExists(team) { return !!this.q.any.get(team); }
  async currentSeq() { return this.seq; }

  async kvGet(k) { const r = this.q.kvGet.get(k); return r ? JSON.parse(r.v) : null; }
  async kvSet(k, v) { this.q.kvSet.run(k, JSON.stringify(v)); }
  async kvDel(k) { this.q.kvDel.run(k); }

  async close() { try { this.db.close(); } catch { /* ignore */ } }
}

module.exports = { SqliteStore };
