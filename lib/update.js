'use strict';
// Updates for the production PC. The website it is linked to runs the newest RFP Manager (it is updated from
// GitHub), so the PC asks the website which version it has, and when it is newer, downloads the program from
// there (GET /api/update/bundle.tgz with the PC's machine key) and puts it over this folder. config.json, data/
// and the image folder are never touched; the files it replaces are kept in .update-backup/<old version>/.
// Then RFP Manager restarts (exit code 75: RFP Manager.exe and run.bat start it again).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { log } = require('./util');

const RESTART_CODE = 75;
const KEEP = /^(config\.json|data|node_modules|\.git|\.update-backup|\.update-tmp|RFP Manager\.exe)(\/|$)/;

// "0.21.0" < "0.22.0" < "0.22.1"; anything after a "-" is ignored
function newer(a, b) {
  const p = (v) => String(v || '0').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

// the files in a .tar.gz (ustar, as lib/tarball.js writes it): [{ name, data }]
function untar(gz) {
  const buf = zlib.gunzipSync(gz);
  const out = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, n) => h.subarray(a, a + n).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = str(156, 1) || '0';
    const prefix = str(345, 155);
    const name = (prefix ? prefix + '/' : '') + str(0, 100);
    off += 512;
    if (type === '0') out.push({ name, data: buf.subarray(off, off + size) });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

// "rfp-manager/lib/app.js" → "lib/app.js"; refuses anything that would land outside the folder
function safeRel(name) {
  const rel = name.replace(/\\/g, '/').split('/').slice(1).join('/');
  if (!rel || rel.startsWith('/') || rel.split('/').some((p) => p === '..' || p === '' || p.includes(':'))) return null;
  if (KEEP.test(rel)) return null;
  return rel;
}

function makeUpdater(app) {
  const st = { current: app.version, latest: '', available: false, checkedAt: 0, error: '', installing: false, installed: '' };
  let timer = null;
  const cloud = () => app.config.cloud || {};
  const base = () => String(cloud().url || '').replace(/\/+$/, '');
  const can = () => app.isLocal && app.config.updates !== false && !!base();

  async function check() {
    if (!can()) { st.error = ''; st.available = false; return status(); }
    try {
      const r = await fetch(base() + '/api/update/info', { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('the website answered ' + r.status);
      const j = await r.json();
      st.latest = String(j.version || '');
      // a newer numbering series (release) always counts as newer: 0.1.0 (release 2) follows 0.29.0 (release 1)
      const rel = Number(j.release) || 1, mine = Number(app.release) || 1;
      st.available = !!(j.pc && (rel !== mine ? rel > mine : newer(st.latest, st.current)));
      st.error = '';
      if (st.available) log(`RFP Manager ${st.latest} is available (this PC has ${st.current}). Install it from the app.`);
    } catch (e) { st.error = e.message; }
    st.checkedAt = Date.now();
    return status();
  }

  async function install({ restart = true } = {}) {
    if (!can()) throw Object.assign(new Error('Link this PC to the website first: updates come from there'), { status: 400 });
    if (!cloud().key) throw Object.assign(new Error('This PC has no machine key for the website'), { status: 400 });
    if (st.installing) throw Object.assign(new Error('Already updating'), { status: 409 });
    st.installing = true;
    try {
      const r = await fetch(base() + '/api/update/bundle.tgz', { headers: { Authorization: 'Bearer ' + cloud().key }, signal: AbortSignal.timeout(180000) });
      if (!r.ok) { let m = r.status + ''; try { m = (await r.json()).error || m; } catch { /* not json */ } throw new Error('Download failed: ' + m); }
      const files = untar(Buffer.from(await r.arrayBuffer()));
      const pkg = files.find((f) => safeRel(f.name) === 'package.json');
      if (!pkg || !files.some((f) => safeRel(f.name) === 'server.js')) throw new Error('The download is not a complete RFP Manager');
      const version = JSON.parse(pkg.data.toString('utf8')).version;
      const root = app.root;
      // write everything to a side folder first, so a broken download changes nothing
      const tmp = path.join(root, '.update-tmp');
      fs.rmSync(tmp, { recursive: true, force: true });
      const todo = [];
      for (const f of files) {
        const rel = safeRel(f.name);
        if (!rel) continue;
        const dest = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.data);
        todo.push(rel);
      }
      // keep the files that get replaced, then move the new ones in
      const backup = path.join(root, '.update-backup', st.current);
      for (const rel of todo) {
        const dest = path.join(root, rel);
        if (fs.existsSync(dest)) { const b = path.join(backup, rel); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(dest, b); }
      }
      for (const rel of todo) { const dest = path.join(root, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(tmp, rel), dest); }
      fs.rmSync(tmp, { recursive: true, force: true });
      st.installed = version;
      log(`Updated to RFP Manager ${version} (${todo.length} files; the old ones are in .update-backup/${st.current}).${restart ? ' Restarting…' : ''}`);
      if (restart) setTimeout(async () => { await Promise.race([Promise.resolve(app.stop ? app.stop() : app.close()).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]); process.exit(RESTART_CODE); }, 800);
      return { version, files: todo.length, restarting: !!restart };
    } finally { st.installing = false; }
  }

  function status() { return { ...st, canUpdate: can() }; }
  function start() { if (!app.isLocal) return; setTimeout(check, 8000).unref(); timer = setInterval(check, 6 * 3600e3); timer.unref(); }
  function stop() { clearInterval(timer); }
  return { check, install, status, start, stop };
}

module.exports = { makeUpdater, newer, untar, safeRel, RESTART_CODE };
