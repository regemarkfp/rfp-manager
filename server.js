#!/usr/bin/env node
'use strict';
// MIDI and X-keys on Linux read device files, each with a waiting read: give them threads of their own.
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '16';
// RFP Manager – all-in-one live production tool.
//   node server.js                 production PC  (SQLite, CasparCG, image folder, syncs with the website)
//   MODE=cloud node server.js      online site    (MongoDB Atlas, Google sign-in)
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`RFP Manager needs Node.js 22.13 or newer (you have ${process.versions.node}). Install the current LTS from https://nodejs.org`);
  process.exit(1);
}

const { App, loadConfig, ROOT } = require('./lib/app');
const { makeApi } = require('./lib/api');
const { makeHub } = require('./lib/hub');
const { log } = require('./lib/util');

async function start(overrides = {}, { configPath = process.env.CONFIG || path.join(ROOT, 'config.json'), quiet = false, mongoDriver = null } = {}) {
  const config = loadConfig(configPath, overrides);
  const app = new App(config, configPath);
  if (mongoDriver) app.mongoDriver = mongoDriver;
  await app.init();
  const api = makeApi(app);
  const hub = makeHub(app);
  const server = http.createServer((req, res) => { api.handle(req, res); });
  server.requestTimeout = 60 * 60 * 1000;          // video adverts (up to 500 MB) can take a while to upload
  server.on('upgrade', (req, sock) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/relay' && app.relayServer) return app.relayServer.upgrade(req, sock).catch(() => sock.destroy());
    if (p === '/live/ws' && app.relayServer) {
      // the website: a live page for a production PC goes through that PC's relay link; otherwise the website's own
      return (async () => {
        const user = await app.auth.userFromReq(req).catch(() => null);
        const m = await app.relayServer.choose(req, user);
        if (m) return app.relayServer.socket(req, sock, m, user);
        return app.live.upgrade(req, sock);
      })().catch(() => sock.destroy());
    }
    if (p === '/live/ws') return app.live.upgrade(req, sock).catch(() => sock.destroy());
    if (p !== '/ws') return sock.destroy();
    hub.upgrade(req, sock).catch(() => sock.destroy());
  });
  const listen = () => new Promise((resolve, reject) => { const bad = (e) => reject(e); server.once('error', bad); server.listen(config.port, app.isLocal ? '0.0.0.0' : undefined, () => { server.off('error', bad); resolve(); }); });
  try { await listen(); } catch (e) {
    if (e.code !== 'EADDRINUSE' || quiet || !app.isLocal) throw e;
    // The port is taken. If it is an older RFP Manager that was left running, stop it and take over; otherwise say who has it.
    const r = await require('./lib/port').freePort(config.port).catch(() => ({ freed: false, who: '' }));
    if (!r.freed) { e.portInfo = r; throw e; }
    log(`An RFP Manager (${r.version}) was still running on port ${config.port}. It was stopped; this one takes over.`);
    await listen();
  }
  config.port = server.address().port;
  app.server = server; app.hub = hub;
  if (app.relay) app.relay.start();
  app.stop = async () => { if (app.relay) app.relay.close(); if (app.relayServer) app.relayServer.close(); hub.close(); app.live.close(); app.worship.close(); await new Promise((r) => { server.close(r); server.closeAllConnections(); }); await app.close(); };
  if (!quiet) banner(app);
  return app;
}

function banner(app) {
  const c = app.config;
  const line = '─'.repeat(64);
  console.log('\n' + line);
  console.log(`  ${c.name} ${app.version}   ·   ${app.isLocal ? 'PRODUCTION PC' : 'ONLINE SITE'}`);
  console.log(line);
  if (app.isLocal) {
    console.log(`  This PC        http://localhost:${c.port}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family !== 'IPv4' || a.internal) continue;
        const p = a.address.split('.').map(Number);
        console.log(`  ${p[0] === 100 && p[1] >= 64 && p[1] <= 127 ? 'Tailscale ' : 'Network   '}     http://${a.address}:${c.port}`);
      }
    }
    console.log(`  Image folder   ${app.mediaFolder()}`);
    console.log(`  CasparCG       ${c.caspar.enabled === false ? 'switched off' : c.caspar.host + ':' + c.caspar.port + '  (channel ' + c.caspar.channel + ')'}`);
    console.log(`  Website        ${c.cloud.url ? c.cloud.url + '  (sync every ' + c.syncSeconds + ' s' + (c.remote !== false ? ', screens usable through the website' : '') + ')' : 'not linked – works offline'}`);
    const host = require('node:os').hostname().toLowerCase() + (Number(c.port) === 80 ? '' : ':' + c.port);
    console.log(`  Screen links   http://${host}/scorer  /graphics-control  /confidence  /rundown  /output  /preview`);
    console.log(`                 http://${host}/worship  /stage  /fill-key  /key  /fill`);
    console.log(line);
    console.log('  Keys:  S status   Y sync now   R reconnect CasparCG   P reset a password   Q quit');
  } else {
    console.log(`  Listening on port ${c.port}${c.publicUrl ? '   ' + c.publicUrl : ''}`);
    console.log(`  Google sign-in ${c.google.clientId ? 'ready' : 'NOT SET (add GOOGLE_CLIENT_ID)'}`);
    console.log(`  Database       ${c.mongo.uri ? 'MongoDB' : 'local file (add MONGODB_URI)'}`);
  }
  console.log(line + '\n');
}

// Started by "RFP Manager.exe" (tools/launcher): no console window, so the console's keys come in as lines from the app.
function launcherCommands(app) {
  const rl = require('node:readline').createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    const [cmd, ...rest] = String(line).trim().split(/\s+/);
    try {
      if (cmd === 's') status(app);
      else if (cmd === 'y') { log('Syncing…'); await app.sync.run(); const m = await app.sync.ensureMedia(); log(`Sync done${m.missing ? ` (${m.missing} images still missing)` : ''}`); }
      else if (cmd === 'r') { log('Reconnecting to CasparCG…'); app.gfx.amcp.reconnect(); }
      else if (cmd === 'accounts') { for (const u of [...app.cache.values()].filter((d) => d.type === 'user' && !d.deleted && d.data.email)) console.log(`ACCOUNT ${u.data.email}${u.data.name ? ' (' + u.data.name + ')' : ''}`); console.log('ACCOUNTS-END'); }
      else if (cmd === 'password') {
        const [email, ...pw] = rest, pass = pw.join(' '), { hashPassword } = require('./lib/auth');
        const u = [...app.cache.values()].find((d) => d.type === 'user' && !d.deleted && String(d.data.email || '').toLowerCase() === String(email || '').toLowerCase());
        if (!u) log('No account', email, 'on this PC');
        else if (pass.length < 8) log('That password is too short (8 characters or more). Nothing changed.');
        else { await app.save('', 'user', u.id, { ...u.data, passwordHash: hashPassword(pass) }, u.id); log(`New password set for ${u.data.email} (this PC only).`); }
      } else if (cmd === 'q') { log('Shutting down…'); await app.stop().catch(() => {}); process.exit(0); }
    } catch (e) { log('Could not do that:', e.message); }
  });
  rl.on('close', async () => { await app.stop().catch(() => {}); process.exit(0); });      // the app window was closed
}
function status(app) {
  const s = app.sync.status(), a = app.gfx.amcp.status();
  log(`CasparCG ${a.enabled ? (a.connected ? 'connected ' + a.version : 'NOT connected') : 'off'} · on air: ${app.gfx.onAirList().map((e) => e.name).join(', ') || 'nothing'}`);
  if (app.relay) { const r = app.relay.status(); log(`Remote access ${!r.enabled ? 'switched off' : !s.linked ? 'needs the PC linked to the website' : r.connected ? 'online through ' + r.url : 'connecting' + (r.lastError ? ' (' + r.lastError + ')' : '')}`); }
  log(`Sync ${s.linked ? (s.lastError ? 'ERROR ' + s.lastError : 'ok, last ' + (s.lastSync ? new Date(s.lastSync).toLocaleTimeString('en-GB') : 'never')) + `, ${s.pending} waiting to upload` : 'not linked'} · screens connected: ${[...app.hub.clients].filter((c) => c.kind === 'ui').length + app.live.clients.size}`);
}

function consoleKeys(app) {
  if (!process.stdin.isTTY) { if (process.env.RFP_LAUNCHER) launcherCommands(app); return; }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let asking = false;
  // P: someone at this PC forgot their password. Lists the accounts kept on this PC and sets a new password for one of them.
  const resetPassword = async () => {
    const { hashPassword } = require('./lib/auth');
    const users = [...app.cache.values()].filter((d) => d.type === 'user' && !d.deleted && d.data.email).sort((a, b) => a.data.email.localeCompare(b.data.email));
    if (!users.length) { log('There are no accounts on this PC yet. Open it in a browser to create the first one.'); return; }
    asking = true;
    process.stdin.setRawMode(false);
    const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((r) => rl.question(q, (a) => r(String(a).trim())));
    try {
      console.log('\n  Accounts on this PC (' + path.join(app.dataDir(), 'rfpmanager.db') + '):');
      users.forEach((u, i) => console.log(`   ${i + 1}. ${u.data.email}${u.data.name ? '  (' + u.data.name + ')' : ''}${u.data.passwordHash ? '' : '  – no password yet'}`));
      const n = Number(await ask('  Number of the account to give a new password (Enter = cancel): '));
      const u = users[n - 1];
      if (!u) { console.log('  Nothing changed.\n'); return; }
      const pw = await ask(`  New password for ${u.data.email} (8+ characters, it is shown as you type): `);
      if (pw.length < 8) { console.log('  Too short. Nothing changed.\n'); return; }
      await app.save('', 'user', u.id, { ...u.data, passwordHash: hashPassword(pw) }, u.id);
      console.log(`  Done. Sign in as ${u.data.email} with the new password.` + ' The password is for this PC only; the website signs in with Google.' + '\n');
    } catch (e) { console.log('  Could not change it: ' + e.message + '\n'); }
    finally { rl.close(); process.stdin.setRawMode(true); process.stdin.resume(); asking = false; }
  };
  process.stdin.on('data', async (k) => {
    if (asking) return;
    const key = k.toLowerCase();
    if (key === 'p') { await resetPassword(); return; }
    if (key === 'q' || k === '\u0003') { log('Shutting down…'); await app.stop().catch(() => {}); process.exit(0); }
    if (key === 's') status(app);
    if (key === 'y') { log('Syncing…'); await app.sync.run(); const m = await app.sync.ensureMedia(); log(`Sync done${m.missing ? ` (${m.missing} images still missing)` : ''}`); }
    if (key === 'r') { log('Reconnecting to CasparCG…'); app.gfx.amcp.reconnect(); }
  });
}

if (require.main === module) {
  start().then((app) => {
    if (app.isLocal) consoleKeys(app);
    const bye = async () => { await app.stop().catch(() => {}); process.exit(0); };
    process.on('SIGTERM', bye);
    process.on('SIGINT', bye);
  }).catch((e) => {
    if (e.code === 'EADDRINUSE') {
      const i = e.portInfo || {}, port = e.port || '';
      console.error(`\nRFP Manager could not start: port ${port} is in use` + (i.rfp ? ` by another RFP Manager (${i.version}) that could not be stopped` : i.who ? ` by ${i.who}` : '') + '.');
      console.error(i.rfp || /node/i.test(i.who || '') ? '  Close the other RFP Manager window, or end "Node.js JavaScript Runtime" in Task Manager (Ctrl+Shift+Esc → Details → node.exe → End task), then start again.'
        : `  Close that program, or give RFP Manager another port: open config.json in this folder and change "port" (for example 8091), then start again.`);
      console.error('');
    } else console.error('\nRFP Manager could not start: ' + e.message + '\n');
    process.exit(1);
  });
  process.on('unhandledRejection', (e) => log('Unhandled error:', (e && e.stack) || e));
}

module.exports = { start };
