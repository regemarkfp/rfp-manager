'use strict';
// Updates of the website's own server, from the Universe page: see if GitHub has a newer version (and what is new in
// it, from the README), install it now, at a set time, or on a schedule. Checking happens here (every hour, 6 hours,
// day or never) and emails the superusers once per new version. Installing is always the server's updater
// (rfp-autoupdate.service, tools/server/github-update.sh), started through the root helper rfp-update-ctl
// (tools/server/update-ctl.sh, sudo for the website's account), so it carries on while the website restarts.
// kv super:updates = { check: off|hourly|6h|daily, email: true }, super:updates:last = { latest, notes, checkedAt, error, mailed }
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { fail, log } = require('./util');
const { newer } = require('./update');

const EVERY = { hourly: 3600e3, '6h': 6 * 3600e3, daily: 24 * 3600e3 };
const DAYS = ['daily', 'weekdays', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function makeServerUpdates(app) {
  const cfg = () => app.config;
  const repo = () => {
    if (cfg().updateRepo) return String(cfg().updateRepo);
    try { const r = fs.readFileSync('/etc/rfp-manager/update-repo', 'utf8').trim(); if (/^[\w.-]+\/[\w.-]+$/.test(r)) return r; } catch { /* default */ }
    return 'regemarkfp/rfp-manager';
  };
  const source = () => String(cfg().updateSource || `https://raw.githubusercontent.com/${repo()}/main`).replace(/\/+$/, '');
  const settings = async () => ({ check: '6h', email: true, ...((await app.store.kvGet('super:updates').catch(() => null)) || {}) });
  const last = async () => (await app.store.kvGet('super:updates:last').catch(() => null)) || {};

  // the README's "### 1.2.3" sections between this version and the newest
  function notesBetween(readme, from, to) {
    const out = [];
    const re = /^### (\d+\.\d+\.\d+)\s*$/gm;
    const marks = [];
    let m;
    while ((m = re.exec(readme))) marks.push({ v: m[1], at: m.index, body: m.index + m[0].length });
    for (let i = 0; i < marks.length; i++) {
      const { v } = marks[i];
      if (!newer(v, from) || newer(v, to)) continue;
      const end = i + 1 < marks.length ? marks[i + 1].at : readme.indexOf('\n## ', marks[i].body) > 0 ? readme.indexOf('\n## ', marks[i].body) : readme.length;
      out.push({ version: v, text: readme.slice(marks[i].body, end).trim().slice(0, 6000) });
    }
    return out.slice(0, 12);
  }

  let checking = null;
  function check(why = 'manual') {
    if (checking) return checking;
    checking = (async () => {
      const prev = await last();
      const rec = { ...prev, checkedAt: Date.now(), error: '' };
      try {
        const t = Date.now();
        const pkg = await (await fetch(`${source()}/package.json?t=${t}`, { signal: AbortSignal.timeout(20000) })).json();
        if (!pkg || !/^\d+\.\d+\.\d+/.test(String(pkg.version || ''))) throw new Error('No version in package.json on GitHub');
        rec.latest = String(pkg.version);
        rec.notes = [];
        if (newer(rec.latest, app.version)) {
          const r = await fetch(`${source()}/README.md?t=${t}`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
          if (r && r.ok) rec.notes = notesBetween(await r.text(), app.version, rec.latest);
        }
      } catch (e) { rec.error = 'Could not check GitHub: ' + e.message; }
      // a new version: tell the superusers once
      const s = await settings();
      if (!rec.error && newer(rec.latest, app.version) && rec.mailed !== rec.latest && s.email && why !== 'manual' && app.mail && app.mail.enabled() && app.superUser) {
        const url = app.superUser.host() ? 'https://' + app.superUser.host() + '/#updates' : '';
        const r = await app.mail.send(app.superUser.users(), { subject: `RFP Manager ${rec.latest} is available`, title: `Version ${rec.latest} is ready`,
          lines: [`The website runs ${app.version}. ${rec.latest} is on GitHub.`, ...rec.notes.slice(0, 3).map((n) => `${n.version}: ${n.text.split('\n').filter((l) => /^- /.test(l)).slice(0, 4).map((l) => l.replace(/\*\*/g, '').slice(2, 160)).join(' · ')}`), 'Install it now or choose a time on the Universe page.'],
          button: url ? { url, label: 'Open Updates' } : undefined }).catch(() => null);
        if (r && r.sent) rec.mailed = rec.latest;
      }
      await app.store.kvSet('super:updates:last', rec).catch(() => {});
      return rec;
    })().finally(() => { checking = null; });
    return checking;
  }

  // the root helper
  function ctl(args) {
    return new Promise((resolve, reject) => {
      const own = cfg().updateCtl;
      execFile(own || 'sudo', own ? args : ['-n', '/usr/local/sbin/rfp-update-ctl', ...args], { timeout: 30e3, maxBuffer: 1024 * 1024 }, (err, out, errOut) => {
        if (err) return reject(Object.assign(new Error(String(errOut || '').trim().split('\n').pop() || 'The update helper is not installed yet: run once on the server: sudo rfp-autoupdate'), { status: 400 }));
        resolve(String(out || ''));
      });
    });
  }
  // systemd's "Fri 2030-01-04 02:00:00 SAST" (the server's own clock, which is this program's clock too)
  const parseWhen = (v) => { const m = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)/.exec(String(v || '')); const t = m ? Date.parse(`${m[1]}T${m[2]}`) : NaN; return Number.isFinite(t) && t > 0 ? t : null; };
  async function server() {
    let out;
    try { out = await ctl(['status']); } catch (e) { return { ready: false, error: e.message }; }
    const kv = Object.fromEntries(out.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
    // OnCalendar back into days + time: "*-*-* 04:30", "Mon..Fri *-*-* 04:30", "Sun *-*-* 02:00"
    const m = /^(?:(Mon\.\.Fri|Mon|Tue|Wed|Thu|Fri|Sat|Sun) )?\*-\*-\* (\d{2}:\d{2})/.exec(kv.calendar || '');
    const days = !m ? '' : !m[1] ? 'daily' : m[1] === 'Mon..Fri' ? 'weekdays' : m[1].toLowerCase();
    return { ready: kv.installed === 'yes', auto: kv.enabled === 'enabled', days, time: m ? m[2] : '', calendar: kv.calendar || '', next: kv.enabled === 'enabled' ? parseWhen(kv.next) : null,
      running: kv.running === 'activating' || kv.running === 'active', result: kv.result || '', lastStart: parseWhen(kv.lastStart), lastEnd: parseWhen(kv.lastEnd), lastCode: kv.lastCode || '',
      once: kv.onceActive === 'active' ? parseWhen(kv.once) : null, repo: kv.repo || repo() };
  }
  async function view() {
    const [s, l, srv] = await Promise.all([settings(), last(), server()]);
    return { version: app.version, repo: repo(), latest: l.latest || '', newer: !!(l.latest && newer(l.latest, app.version)), notes: l.notes || [], checkedAt: l.checkedAt || 0, error: l.error || '', settings: s, server: srv };
  }
  async function install({ force } = {}) { await ctl(force ? ['now', 'force'] : ['now']); return { started: true }; }
  async function schedule(b) {
    if (b.off) { await ctl(['schedule', 'off']); return server(); }
    const days = String(b.days || ''), time = String(b.time || '');
    if (!DAYS.includes(days)) fail(400, 'Every day, weekdays or one day of the week');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'Give the time as HH:MM');
    await ctl(['schedule', days, time]);
    return server();
  }
  async function once(b) {
    const date = String(b.date || ''), time = String(b.time || '');
    if (!/^20\d\d-\d\d-\d\d$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail(400, 'Choose a date and a time');
    if (Date.parse(`${date}T${time}`) < Date.now() - 60e3) fail(400, 'That time has passed');
    await ctl(['once', date, time]);
    return server();
  }
  async function cancel() { await ctl(['cancel']); return server(); }
  async function logText() { try { return { log: await ctl(['log']) }; } catch (e) { return { log: '', error: e.message }; } }
  async function setSettings(b) {
    const s = await settings();
    if (b.check !== undefined) { if (!['off', ...Object.keys(EVERY)].includes(b.check)) fail(400, 'Hourly, every 6 hours, daily or off'); s.check = b.check; }
    if (b.email !== undefined) s.email = !!b.email;
    await app.store.kvSet('super:updates', s);
    return s;
  }

  // the automatic check
  let timer = null, first = null;
  async function tick() {
    try {
      const s = await settings();
      if (!EVERY[s.check]) return;
      const l = await last();
      if (!l.checkedAt || Date.now() - l.checkedAt >= EVERY[s.check] - 60e3) await check('auto');
    } catch (e) { log('Update check:', e.message); }
  }
  function start() { if (timer) return; timer = setInterval(tick, Number(cfg().updateTickMs) || 5 * 60e3); if (timer.unref) timer.unref(); first = setTimeout(tick, 30e3); if (first.unref) first.unref(); }
  function stop() { clearInterval(timer); clearTimeout(first); timer = null; }

  return { check, view, install, schedule, once, cancel, logText, setSettings, settings, start, stop, tick, notesBetween };
}

module.exports = { makeServerUpdates };
