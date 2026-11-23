'use strict';
// Live meters for the Universe and Sharing dashboards (1.9.0, after Blackmagic's Cloud Store screen): every second the
// bytes each person moved through RFP Manager (in = uploads to the server, out = downloads), the speed of each network
// port (/proc/net/dev), the processor, memory and temperature, and the files touched in the last seconds (they light up
// on the storage map: cyan written, yellow read). Kept in memory only: a minute of history.
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const HIST = 60;                      // seconds of history
const IDLE = 90e3;                    // a person leaves the list after this long without traffic
const HOT = 6e3;                      // a touched file stays lit this long
const pad = (a) => { while (a.length < HIST) a.unshift([0, 0]); return a.slice(-HIST); };
const hashOf = (s) => crypto.createHash('sha1').update(String(s)).digest().readUInt32BE(0) / 4294967296;

function makeMeter(app) {
  const cfg = () => app.config || {};
  const people = new Map();           // key → { key, name, ip, area, shares:Set, acc:[in,out], hist:[[in,out]…], last, total:[in,out] }
  const ports = new Map();            // name → { name, speed, prev:[rx,tx], hist:[[rx,tx]…] }  (bits per second)
  let hot = [];                       // [{ h, kind, share, path, at }]
  const hw = { cpu: 0, temp: null, hist: [] };
  let prevCpu = null, timer = null, tick = 0;

  // ---- people
  function add(who, dir, n, meta = {}) {
    if (!(n > 0)) return;
    const ip = (who && who.ip) || meta.ip || '';
    const name = (who && who.name) || '';
    const key = name ? 'u:' + name + '|' + ip : 'ip:' + ip;
    let p = people.get(key);
    if (!p) {
      if (name && people.has('ip:' + ip)) { p = people.get('ip:' + ip); people.delete('ip:' + ip); p.key = key; }   // signed in during the request
      else p = { key, ip, area: '', shares: new Set(), acc: [0, 0], hist: [], total: [0, 0], since: Date.now() };
      people.set(key, p);
    }
    p.name = name; p.last = Date.now();
    if (meta.area) p.area = meta.area;
    if (who && who.share) p.shares.add(who.share);
    const i = dir === 'in' ? 0 : 1;
    p.acc[i] += n; p.total[i] += n;
    if (people.size > 2000) for (const [k, x] of people) if (Date.now() - x.last > IDLE) people.delete(k);
  }
  function touch(t) { hot.push({ h: hashOf((t.share || '') + '/' + (t.path || '')), kind: t.kind === 'write' ? 'write' : 'read', share: t.share || '', path: t.path || '', at: Date.now() }); if (hot.length > 400) hot = hot.slice(-200); }

  // ---- network ports: /proc/net/dev (bytes received and sent per interface)
  const skip = /^(lo|veth|docker|br-|virbr|vnet|tap|dummy|bond_slave)/;
  function readPorts() {
    let txt = '';
    try { txt = fs.readFileSync(cfg().procNetDev || '/proc/net/dev', 'utf8'); } catch { return; }
    const seen = new Set();
    for (const line of txt.split('\n').slice(2)) {
      const m = /^\s*([^:]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      const name = m[1].trim(), f = m[2].trim().split(/\s+/).map(Number);
      if (skip.test(name) || f.length < 9) continue;
      seen.add(name);
      let p = ports.get(name);
      if (!p) { p = { name, speed: 0, prev: null, hist: [] }; ports.set(name, p); try { p.speed = Number(fs.readFileSync(`/sys/class/net/${name}/speed`, 'utf8')) || 0; } catch { p.speed = 0; } }
      const now = [f[0], f[8]];
      if (p.prev) p.hist.push([Math.max(0, now[0] - p.prev[0]) * 8, Math.max(0, now[1] - p.prev[1]) * 8]);
      if (p.hist.length > HIST) p.hist.shift();
      p.prev = now;
    }
    for (const k of ports.keys()) if (!seen.has(k)) ports.delete(k);
  }
  // ---- processor, memory, temperature
  function readCpu() {
    const c = os.cpus(), t = c.reduce((a, x) => { const s = x.times; a.idle += s.idle; a.all += s.user + s.nice + s.sys + s.idle + s.irq; return a; }, { idle: 0, all: 0 });
    if (prevCpu && t.all > prevCpu.all) hw.cpu = Math.round(100 * (1 - (t.idle - prevCpu.idle) / (t.all - prevCpu.all)));
    prevCpu = t;
    hw.hist.push([hw.cpu, Math.round(100 * (1 - os.freemem() / os.totalmem()))]); if (hw.hist.length > HIST) hw.hist.shift();
  }
  function readTemp() {
    let best = null;
    const tryFile = (f) => { try { const v = Number(fs.readFileSync(f, 'utf8')) / 1000; if (v > 0 && v < 130 && (best === null || v > best)) best = v; } catch { /* none */ } };
    try { for (const d of fs.readdirSync('/sys/class/hwmon')) { let files = []; try { files = fs.readdirSync('/sys/class/hwmon/' + d); } catch { continue; } for (const f of files) if (/^temp\d+_input$/.test(f)) tryFile(`/sys/class/hwmon/${d}/${f}`); } } catch { /* not Linux */ }
    if (best === null) { try { for (const d of fs.readdirSync('/sys/class/thermal')) if (d.startsWith('thermal_zone')) tryFile(`/sys/class/thermal/${d}/temp`); } catch { /* not Linux */ } }
    hw.temp = best === null ? null : Math.round(best);
  }
  function second() {
    tick++;
    const now = Date.now();
    for (const [k, p] of people) {
      p.hist.push(p.acc); p.acc = [0, 0];
      if (p.hist.length > HIST) p.hist.shift();
      if (now - p.last > IDLE) people.delete(k);
    }
    hot = hot.filter((x) => now - x.at < HOT);
    readPorts(); readCpu();
    if (tick % 5 === 1) readTemp();
  }
  function start() { if (timer) return; second(); timer = setInterval(second, 1000); if (timer.unref) timer.unref(); }
  function stop() { clearInterval(timer); timer = null; }

  // ---- what the dashboards show
  const rate = (hist, n = 3) => { const last = hist.slice(-n); return last.length ? [0, 1].map((i) => Math.round(last.reduce((a, x) => a + x[i], 0) / last.length)) : [0, 0]; };
  function peopleView({ share, shares } = {}) {
    const out = [];
    for (const p of people.values()) {
      if (share && !p.shares.has(share)) continue;
      if (shares && ![...p.shares].some((x) => shares.has(x))) continue;
      const r = rate(p.hist);
      out.push({ name: p.name || '', ip: share || shares ? undefined : p.ip, area: p.area || '', in: r[0], out: r[1], hist: pad(p.hist.slice()), total: p.total.slice(), since: p.since, last: p.last });
    }
    return out.sort((a, b) => (b.in + b.out) - (a.in + a.out) || b.last - a.last).slice(0, 12);
  }
  function portsView() {
    return [...ports.values()].map((p) => { const r = rate(p.hist); return { name: p.name, label: /^tailscale/.test(p.name) ? 'Tailscale' : /^wl/.test(p.name) ? 'Wi-Fi' : p.name, speed: p.speed > 0 ? p.speed : 0, in: r[0], out: r[1], hist: pad(p.hist.slice()) }; })
      .sort((a, b) => (b.speed > 0) - (a.speed > 0) || a.name.localeCompare(b.name));
  }
  function hotView(share) { return hot.filter((x) => !share || x.share === share).map((x) => (share ? { path: x.path, kind: x.kind } : { h: x.h, kind: x.kind, share: x.share, path: x.path })); }
  function hardware() {
    return { cpu: hw.cpu, cpus: os.cpus().length, model: ((os.cpus()[0] || {}).model || '').replace(/\s+/g, ' ').trim(), mem: { total: os.totalmem(), free: os.freemem() }, temp: hw.temp, load: os.loadavg(),
      uptime: Math.round(os.uptime()), host: os.hostname(), hist: pad(hw.hist.slice()) };
  }
  return { add, touch, start, stop, second, people: peopleView, ports: portsView, hot: hotView, hardware, hashOf };
}

module.exports = { makeMeter, hashOf };
