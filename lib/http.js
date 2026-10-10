'use strict';
// Tiny HTTP helpers: router, JSON bodies, static files. No external packages.
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./util');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.webmanifest': 'application/manifest+json', '.apk': 'application/vnd.android.package-archive', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml',
};

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:[A-Za-z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
    this.routes.push({ method, rx, keys, handler });
  }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Too large (limit ' + Math.round(limit / 1048576) + ' MB)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 4 * 1024 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
  } else {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body === undefined ? {} : body));
  }
}

async function serveStatic(res, root, rel, headers = {}) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(path.normalize(root + path.sep)) && file !== path.normalize(root)) return false;
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) return false;
    const data = await fs.promises.readFile(file);
    send(res, 200, data, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...headers });
    return true;
  } catch { return false; }
}

function parseCookies(req) {
  const o = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) o[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return o;
}

function clientIp(req, trustProxy) {
  if (trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

module.exports = { Router, readBody, readJson, send, serveStatic, parseCookies, clientIp, TYPES };
