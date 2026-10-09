'use strict';
const crypto = require('node:crypto');

const newId = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const detId = (prefix, ...parts) => prefix + sha(parts.join('|')).slice(0, 20);
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
const equal = (a, b) => stable(a) === stable(b);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const logLines = [];
const listeners = new Set();
function log(...args) {
  const line = `[${new Date().toLocaleTimeString('en-GB')}] ${args.join(' ')}`;
  logLines.push(line);
  if (logLines.length > 300) logLines.shift();
  console.log(line);
  for (const fn of listeners) { try { fn(line); } catch { /* ignore */ } }
}
log.lines = logLines;
log.onLine = (fn) => listeners.add(fn);

module.exports = { newId, sha, detId, slug, stable, equal, clone, HttpError, fail, log };
