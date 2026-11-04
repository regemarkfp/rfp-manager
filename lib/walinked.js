'use strict';
// WhatsApp through a linked phone (like WhatsApp Web), with Baileys (github.com/WhiskeySockets/Baileys).
// The site admin links the business's own WhatsApp from Settings → Server: a QR code to scan, or a code to type in
// WhatsApp → Linked devices → Link with phone number. Messages then go from that number, by themselves.
//
// NOT an official WhatsApp API: WhatsApp's terms do not allow it and it can ban a number that uses it. To keep the
// risk down this only ever writes to people who sent a booking request, one message at a time with a pause between
// them, and never more than a set number an hour.
//
// Baileys is not shipped with RFP Manager: it is installed on first use into <data>/whatsapp/lib (npm), and the
// linked session is kept in <data>/whatsapp/auth (delete the folder or press Unlink to log out).
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { log } = require('./util');

const STATUS = { 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' };

function makeLinked(app, { onMessage, onStatus }) {
  const dir = path.join(app.dataDir(), 'whatsapp');
  const libDir = path.join(dir, 'lib'), authDir = path.join(dir, 'auth');
  const opt = app.config.whatsapp || {};
  const st = { state: 'off', qr: '', code: '', me: '', error: '', since: 0 };
  let sock = null, lib = null, qrLib = null, starting = null, retry = null, stopped = false, retries = 0;

  // ---- installing Baileys (once, on this server)
  function npmBin() {
    const near = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
    return fs.existsSync(near) ? near : 'npm';
  }
  const installed = () => fs.existsSync(path.join(libDir, 'node_modules', '@whiskeysockets', 'baileys', 'package.json'));
  function install() {
    if (opt.loadLib) return Promise.resolve();
    if (installed()) return Promise.resolve();
    st.state = 'installing'; st.error = '';
    fs.mkdirSync(libDir, { recursive: true });
    if (!fs.existsSync(path.join(libDir, 'package.json'))) fs.writeFileSync(path.join(libDir, 'package.json'), JSON.stringify({ name: 'rfp-whatsapp-lib', private: true }));
    const pkgs = [`@whiskeysockets/baileys@${opt.baileys || 'latest'}`, 'qrcode@1'];
    log('WhatsApp: installing ' + pkgs.join(', ') + ' (once)…');
    return new Promise((resolve, reject) => execFile(npmBin(), ['install', '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error', ...pkgs],
      { cwd: libDir, env: { ...process.env, HOME: dir, npm_config_cache: path.join(dir, '.npm') }, timeout: 10 * 60e3, maxBuffer: 4 * 1024 * 1024, shell: process.platform === 'win32' },
      (err, out, errOut) => (err ? reject(new Error('Could not install the WhatsApp library: ' + String(errOut || err.message).trim().split('\n').slice(-3).join(' '))) : resolve())));
  }
  async function load() {
    if (lib) return lib;
    if (opt.loadLib) { lib = await opt.loadLib(); qrLib = lib.qrcode || null; return lib; }
    await install();
    const req = createRequire(path.join(libDir, 'package.json'));
    let entry;
    try { entry = req.resolve('@whiskeysockets/baileys'); } catch {
      const root = path.join(libDir, 'node_modules', '@whiskeysockets', 'baileys');
      entry = path.join(root, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).main || 'lib/index.js');
    }
    const mod = await import(pathToFileURL(entry).href);
    const pick = (k) => mod[k] || (mod.default && mod.default[k]);
    const make = typeof mod.default === 'function' ? mod.default : typeof (mod.default && mod.default.default) === 'function' ? mod.default.default : pick('makeWASocket');
    if (typeof make !== 'function') throw new Error('The WhatsApp library did not load (makeWASocket missing)');
    let logger = null;
    try { logger = req('pino')({ level: 'silent' }); } catch { logger = undefined; }
    try { qrLib = req('qrcode'); } catch { qrLib = null; }
    lib = { make, useMultiFileAuthState: pick('useMultiFileAuthState'), DisconnectReason: pick('DisconnectReason') || {}, Browsers: pick('Browsers'), fetchLatestBaileysVersion: pick('fetchLatestBaileysVersion'), logger };
    return lib;
  }

  // ---- the connection
  const hasSession = () => fs.existsSync(path.join(authDir, 'creds.json'));
  async function start({ fresh = false, phone = '' } = {}) {
    if (starting) return starting;
    starting = (async () => {
      stopped = false;
      clearTimeout(retry);
      if (sock) { try { sock.end(undefined); } catch { /* closed */ } sock = null; }
      if (fresh) fs.rmSync(authDir, { recursive: true, force: true });
      const L = await load();
      fs.mkdirSync(authDir, { recursive: true });
      const { state, saveCreds } = await L.useMultiFileAuthState(authDir);
      let version;
      try { if (L.fetchLatestBaileysVersion) version = (await L.fetchLatestBaileysVersion()).version; } catch { version = undefined; }
      Object.assign(st, { state: 'connecting', qr: '', code: '', error: '', since: Date.now() });
      const s = L.make({ auth: state, logger: L.logger, version, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false,
        browser: L.Browsers && L.Browsers.ubuntu ? L.Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '22.04.4'], getMessage: async () => undefined });
      sock = s;
      s.ev.on('creds.update', saveCreds);
      let asked = false;
      s.ev.on('connection.update', async (u) => {
        if (sock !== s) return;
        if (u.qr) {
          if (phone && !asked && !(state.creds && state.creds.registered)) {
            asked = true;
            try { st.code = await s.requestPairingCode(String(phone).replace(/\D/g, '')); st.state = 'waiting'; } catch (e) { st.error = 'Could not get a code: ' + e.message; }
          } else if (!phone) {
            st.state = 'waiting';
            try { st.qr = qrLib ? await qrLib.toDataURL(u.qr, { margin: 1, width: 280 }) : ''; } catch { st.qr = ''; }
            st.qrText = u.qr;
          }
        }
        if (u.connection === 'open') {
          retries = 0;
          const id = (s.user && s.user.id) || '';
          Object.assign(st, { state: 'open', qr: '', qrText: '', code: '', error: '', me: id.split(':')[0].split('@')[0], name: (s.user && s.user.name) || '', since: Date.now() });
          log(`WhatsApp: linked as +${st.me}`);
        }
        if (u.connection === 'close') {
          const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output ? u.lastDisconnect.error.output.statusCode : 0;
          sock = null;
          if (code === (L.DisconnectReason.loggedOut || 401)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            Object.assign(st, { state: 'off', me: '', qr: '', code: '', error: 'The phone unlinked this website (or WhatsApp logged it out). Link it again to send.' });
            log('WhatsApp: logged out');
            return;
          }
          if (stopped) return;
          if (st.state === 'waiting' && !hasSession() && Date.now() - st.since > 3 * 60e3) { Object.assign(st, { state: 'off', qr: '', code: '', error: 'Not linked in time. Try again.' }); return; }
          st.state = 'connecting';
          const wait = code === (L.DisconnectReason.restartRequired || 515) ? 500 : Math.min(60e3, 2000 * 2 ** Math.min(retries++, 5));
          retry = setTimeout(() => start({ phone: asked ? '' : phone }).catch((e) => { st.state = 'error'; st.error = e.message; }), wait);
          retry.unref && retry.unref();
        }
      });
      s.ev.on('messages.upsert', async (ev) => {
        if (!ev || ev.type !== 'notify') return;
        for (const m of ev.messages || []) {
          try {
            const k = m.key || {};
            if (k.fromMe || !k.remoteJid || /@(g\.us|broadcast|newsletter)$/.test(k.remoteJid)) continue;
            const from = await pnOf(s, k.remoteJid, k.remoteJidAlt || k.senderPn);
            if (!from) { log('WhatsApp: a message from an unknown number (' + k.remoteJid + ')'); continue; }
            const msg = m.message || {};
            const text = msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) || (msg.imageMessage && (msg.imageMessage.caption || '[photo]')) || (msg.videoMessage && (msg.videoMessage.caption || '[video]')) ||
              (msg.documentMessage && '[document: ' + (msg.documentMessage.fileName || '') + ']') || (msg.audioMessage && '[voice note]') || (msg.locationMessage && '[location]') || (msg.stickerMessage && '[sticker]') || '';
            if (!text) continue;
            await onMessage({ from, id: k.id, text: String(text).slice(0, 4000), name: m.pushName || '', at: Number(m.messageTimestamp) * 1000 || Date.now() });
          } catch (e) { log('WhatsApp reply:', e.message); }
        }
      });
      s.ev.on('messages.update', async (list) => {
        for (const { key, update } of list || []) {
          if (!key || !key.fromMe || !update || update.status === undefined || update.status === null) continue;
          const status = update.status === 0 ? 'failed' : STATUS[update.status];
          if (!status) continue;
          const to = await app.store.kvGet('wa:sent:' + key.id).catch(() => null);
          if (to) await onStatus({ id: key.id, status, to, error: status === 'failed' ? 'not delivered' : '' }).catch(() => {});
        }
      });
    })().finally(() => { starting = null; });
    return starting;
  }
  async function pnOf(s, jid, alt) {
    const pn = (j) => (j && /@s\.whatsapp\.net$/.test(j) ? j.split('@')[0].split(':')[0] : '');
    if (pn(jid)) return pn(jid);
    if (pn(alt)) return pn(alt);
    try { const m = s.signalRepository && s.signalRepository.lidMapping && await s.signalRepository.lidMapping.getPNForLID(jid); if (pn(m)) return pn(m); } catch { /* not known */ }
    return '';
  }

  // ---- sending: one at a time, a pause between messages, a ceiling an hour
  const gap = opt.gapMs !== undefined ? opt.gapMs : 4000, perHour = opt.perHour || 60;
  let chain = Promise.resolve(), last = 0;
  const recent = [];
  function send(to, text) {
    const run = async () => {
      if (!sock || st.state !== 'open') return { ok: false, error: 'The WhatsApp phone is not linked or not connected (Settings → Server → WhatsApp)' };
      const now = Date.now();
      while (recent.length && recent[0] < now - 3600e3) recent.shift();
      if (recent.length >= perHour) return { ok: false, error: `Paused: ${perHour} WhatsApp messages in the last hour (keeps the number safe). Email still went.` };
      const wait = last + gap + (gap ? Math.floor(Math.random() * 2000) : 0) - now;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        const found = await sock.onWhatsApp(to + '@s.whatsapp.net').catch(() => null);
        if (Array.isArray(found) && found.length && found[0].exists === false) return { ok: false, error: 'This number is not on WhatsApp' };
        if (Array.isArray(found) && !found.length) return { ok: false, error: 'This number is not on WhatsApp' };
        const jid = (Array.isArray(found) && found[0] && found[0].jid) || to + '@s.whatsapp.net';
        const r = await sock.sendMessage(jid, { text });
        last = Date.now(); recent.push(last);
        const id = r && r.key && r.key.id;
        if (id) await app.store.kvSet('wa:sent:' + id, to).catch(() => {});
        return { ok: true, id: id || '', kind: 'linked' };
      } catch (e) { last = Date.now(); return { ok: false, error: e.message }; }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  async function unlink() {
    stopped = true;
    clearTimeout(retry);
    if (sock) { try { await sock.logout(); } catch { /* already gone */ } try { sock.end(undefined); } catch { /* closed */ } sock = null; }
    fs.rmSync(authDir, { recursive: true, force: true });
    Object.assign(st, { state: 'off', qr: '', qrText: '', code: '', me: '', error: '' });
  }
  function stop() { stopped = true; clearTimeout(retry); if (sock) { try { sock.end(undefined); } catch { /* closed */ } sock = null; } }
  const status = () => ({ state: st.state, qr: st.qr, qrText: st.qrText || '', code: st.code, me: st.me, name: st.name || '', error: st.error, installed: !!opt.loadLib || installed() });
  // at start-up: back on with the session kept from before
  function resume() { if (hasSession() && !app.isLocal) start().catch((e) => { st.state = 'error'; st.error = e.message; log('WhatsApp:', e.message); }); }
  return { start, send, unlink, stop, status, resume, ready: () => st.state === 'open' };
}

module.exports = { makeLinked };
