'use strict';
// The application object: configuration, database, image store and the services built on them.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { SqliteStore } = require('./store-sqlite');
const { FileBlobs } = require('./blobs');
const { makeAuth } = require('./auth');
const { makeDomain } = require('./domain');
const { makeSyncServer, makeSyncClient } = require('./sync');
const { makeGfx } = require('./gfx');
const { makeWorship } = require('./worship');
const { makeTemplates } = require('./templates');
const { makeLive } = require('./live');
const { makeDevices } = require('./devices');
const { makeAutomation } = require('./automation');
const { clone, log } = require('./util');

const ROOT = path.resolve(__dirname, '..');
const DEFAULTS = {
  mode: 'local',            // "local" = production PC (SQLite + CasparCG)   "cloud" = online site (MongoDB)
  name: 'RFP Manager',          // the production teams' app (Studio)
  publicName: 'RegemarkFP',      // the public website (front page, watch pages, viewer emails)
  port: 8090,
  access: 'lan',            // local mode only: "tailnet" | "lan" | "any"
  dataDir: 'data',
  mediaFolder: '',          // per-machine image folder; empty = <dataDir>/media
  publicUrl: '',
  adminUrl: '',              // the production teams' address (admin.example.com), when it differs from publicUrl
  allowSignup: false,
  syncSeconds: 5,
  google: { clientId: '' },
  mongo: { uri: '', db: 'rfpmanager' },
  cloud: { url: '', key: '' },
  defaultCloudUrl: 'https://admin.regemarkfp.com',   // the website a production PC connects to when someone signs in on it
  fallbackCloudUrls: ['https://rfp-manager-f3r7.onrender.com'],   // tried when that one cannot be reached
  caspar: { enabled: true, host: '127.0.0.1', port: 5250, channel: 1, previewChannel: 2, clearAfterOutMs: 0, format: 'json', images: 'file', templateFolder: 'rfp' },
  devices: [],            // vMix / ATEM / HyperDeck: [{ id, type: 'vmix'|'atem'|'hyperdeck', name, host, port, enabled }]
  graphics: {},           // per-graphic overrides: { "scorebug": { "template": "mygfx/bug_lottie", "layer": 20, "format": "json" } }
  outputKey: '',
  machineId: '',
  machineName: '',
  streaming: { host: '', rtmpPort: 1935, srtPort: 8890, api: '', playback: '', hookSecret: '' },   // the online site with a MediaMTX server next to it (see tools/server)
  siteAdmins: [],
  payfast: { merchantId: '', merchantKey: '', passphrase: '', sandbox: false },   // paid streams (lib/pay.js); one PayFast account for the website
  mail: { provider: '', from: '', apiKey: '', smtp: '' },   // email notifications: provider brevo | resend | smtp (see lib/mail.js)
  android: { package: 'com.regemarkfp.rfpmanager', sha256: '36:B9:3B:82:0C:3B:C1:4A:7C:63:88:6C:E0:59:17:30:7C:48:C0:E9:B5:6D:D0:23:F3:D9:26:84:F5:E4:5B:A9' },   // the Android app (android/): its signing key, for /.well-known/assetlinks.json           // the online site: who may set up a server for it (emails)
  standalone: false,        // local mode: false = the PC is the CasparCG bridge (linked to the website, records managed there); true = edit everything on the PC (tests / development)
  remote: true,             // local mode: let team members use this PC's live screens through the website (needs the PC linked)
};

function loadConfig(file, overrides = {}) {
  let user = {};
  if (file && fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`config.json is not valid JSON: ${e.message}`); }
  }
  const env = process.env, e = {};
  if (env.MODE) e.mode = env.MODE;
  if (env.PORT) e.port = Number(env.PORT);
  if (env.PUBLIC_URL) e.publicUrl = env.PUBLIC_URL;
  if (env.ADMIN_URL) e.adminUrl = env.ADMIN_URL;
  if (env.DATA_DIR) e.dataDir = env.DATA_DIR;
  if (env.ALLOW_SIGNUP) e.allowSignup = env.ALLOW_SIGNUP === 'true';
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v; return o; };
  let cfg = merge(merge(merge(DEFAULTS, user), e), overrides);
  if (env.GOOGLE_CLIENT_ID) cfg.google.clientId = env.GOOGLE_CLIENT_ID;
  if (env.MONGODB_URI) cfg.mongo.uri = env.MONGODB_URI;
  if (env.MONGODB_DB) cfg.mongo.db = env.MONGODB_DB;
  cfg.streaming = { ...cfg.streaming };
  if (env.STREAM_HOST) cfg.streaming.host = env.STREAM_HOST;
  if (env.STREAM_API) cfg.streaming.api = env.STREAM_API;
  if (env.STREAM_PLAYBACK) cfg.streaming.playback = env.STREAM_PLAYBACK;
  if (env.STREAM_HOOK_SECRET) cfg.streaming.hookSecret = env.STREAM_HOOK_SECRET;
  if (env.STREAM_RTMP_PORT) cfg.streaming.rtmpPort = Number(env.STREAM_RTMP_PORT);
  if (env.STREAM_SRT_PORT) cfg.streaming.srtPort = Number(env.STREAM_SRT_PORT);
  if (env.RFP_STANDALONE) cfg.standalone = env.RFP_STANDALONE === 'true';
  cfg.mail = { ...cfg.mail };
  if (env.MAIL_PROVIDER) cfg.mail.provider = env.MAIL_PROVIDER;
  if (env.MAIL_FROM) cfg.mail.from = env.MAIL_FROM;
  if (env.MAIL_API_KEY) cfg.mail.apiKey = env.MAIL_API_KEY;
  if (env.SMTP_URL) { cfg.mail.smtp = env.SMTP_URL; if (!cfg.mail.provider) cfg.mail.provider = 'smtp'; }
  if (env.ANDROID_SHA256) cfg.android = { ...cfg.android, sha256: env.ANDROID_SHA256 };
  cfg.payfast = { ...cfg.payfast };
  if (env.PAYFAST_MERCHANT_ID) cfg.payfast.merchantId = env.PAYFAST_MERCHANT_ID;
  if (env.PAYFAST_MERCHANT_KEY) cfg.payfast.merchantKey = env.PAYFAST_MERCHANT_KEY;
  if (env.PAYFAST_PASSPHRASE) cfg.payfast.passphrase = env.PAYFAST_PASSPHRASE;
  if (env.PAYFAST_SANDBOX) cfg.payfast.sandbox = env.PAYFAST_SANDBOX === 'true';
  if (env.SITE_NAME) cfg.name = env.SITE_NAME;
  if (env.PUBLIC_NAME) cfg.publicName = env.PUBLIC_NAME;
  if (env.SITE_ADMINS) cfg.siteAdmins = env.SITE_ADMINS.split(/[,\s]+/).filter(Boolean);
  if (env.RENDER_EXTERNAL_URL && !cfg.publicUrl) cfg.publicUrl = env.RENDER_EXTERNAL_URL;
  cfg.mode = cfg.mode === 'cloud' ? 'cloud' : 'local';
  return cfg;
}

class App extends EventEmitter {
  constructor(config, configPath) {
    super();
    this.setMaxListeners(50);
    this.config = config; this.configPath = configPath || null; this.root = ROOT; this.cache = new Map();
    this.version = require('../package.json').version;
    this.release = Number(require('../package.json').rfpRelease) || 1;     // numbering series: 1 = the 0.2x builds, 2 = from 0.1.0 on
  }

  get isLocal() { return this.config.mode === 'local'; }
  dataDir() { return path.resolve(this.root, this.config.dataDir || 'data'); }
  mediaFolder() { return this.config.mediaFolder ? path.resolve(this.config.mediaFolder) : path.join(this.dataDir(), 'media'); }

  saveConfig() {
    if (!this.configPath) return;
    const { google, ...rest } = this.config;
    const out = { ...rest, google: { clientId: google.clientId || '' } };
    try { fs.writeFileSync(this.configPath, JSON.stringify(out, null, 2)); }
    catch (e) { if (this.isLocal) throw e; log('Could not save ' + this.configPath + ' (' + e.code + '); settings stay in memory until a restart. Set CONFIG to a writable file.'); }
  }

  async init() {
    const c = this.config;
    if (!c.machineId) { c.machineId = crypto.randomBytes(6).toString('hex'); c.machineName = c.machineName || os.hostname(); this.dirtyConfig = true; }
    if (this.isLocal && !c.outputKey) { c.outputKey = crypto.randomBytes(9).toString('base64url'); this.dirtyConfig = true; }
    if (this.dirtyConfig) this.saveConfig();

    if (c.mongo.uri) {
      const { MongoStore, MongoBlobs } = require('./store-mongo');
      let driver;
      try { driver = this.mongoDriver || require('mongodb'); }
      catch { throw new Error('MongoDB is configured but the driver is missing. Run:  npm install'); }
      this.store = new MongoStore(c.mongo.uri, c.mongo.db, driver);
      await this.store.init();
      this.blobs = new MongoBlobs(this.store);
      log('Database: MongoDB (' + (c.mongo.db || 'default') + ')');
    } else {
      this.store = new SqliteStore(path.join(this.dataDir(), 'rfpmanager.db'));
      await this.store.init();
      this.blobs = new FileBlobs(() => this.mediaFolder());
      log('Database: SQLite ' + this.store.file);
      if (!this.isLocal) log('WARNING: cloud mode without MONGODB_URI. Data is kept in a local file, which free hosts wipe on every restart.');
    }
    if (this.isLocal) for (const d of await this.store.listAll()) this.cache.set(d.id, d);

    this.auth = makeAuth(this);
    this.domain = makeDomain(this);
    this.syncServer = makeSyncServer(this);
    if (this.isLocal) {
      this.sync = makeSyncClient(this);
      this.devices = makeDevices(this);
      this.devices.start();
      this.gfx = makeGfx(this);
      await this.gfx.start();
    }
    this.automation = makeAutomation(this);
    await this.automation.load();
    this.verse = require('./verse').makeVerse(this);
    this.mail = require('./mail').makeMailer(this);
    this.notify = require('./notify').makeNotify(this);
    this.pay = require('./pay').makePay(this);
    this.streaming = require('./stream').makeStreaming(this);
    this.clips = require('./clips').makeClips(this);
    this.comments = require('./comments').makeComments(this);
    this.callsheet = require('./callsheet').makeCallsheet(this);
    this.streaming.start();
    this.live = makeLive(this);
    this.worship = makeWorship(this);
    this.templates = makeTemplates(this);
    await this.live.start();
    const { makeRelayServer, makeRelayClient } = require('./relay');
    this.updates = require('./update').makeUpdater(this);
    if (this.isLocal) { this.sync.start(); this.relay = makeRelayClient(this); this.updates.start(); }
    else this.relayServer = makeRelayServer(this);
    return this;
  }

  // Lowest level write: stores exactly what it is given and tells everyone.
  async put(doc, { dirty = true } = {}) {
    const isDirty = this.isLocal && dirty;
    const saved = await this.store.put(doc, { dirty: isDirty });
    if (this.isLocal) this.cache.set(saved.id, saved);
    this.emit('doc', saved, { dirty: isDirty });
    return saved;
  }

  async save(team, type, id, data, userId) {
    const cur = await this.store.get(id);
    return this.put({ id, team: team || '', type, data, updatedAt: Math.max(Date.now(), cur ? cur.updatedAt + 1 : 0), updatedBy: userId || '', deleted: false });
  }

  // A user edit: applies the record rules (match names, automatic productions…) around the save.
  async write(team, type, id, data, userId) {
    const cur = await this.store.get(id);
    const clean = await this.domain.beforeSave(team, type, id, clone(data), cur && !cur.deleted ? cur : null, userId);
    const doc = await this.save(team, type, id, clean, userId);
    await this.domain.afterSave(doc, userId);
    return doc;
  }

  async remove(id, userId) {
    const cur = await this.store.get(id);
    if (!cur || cur.deleted) return null;
    const doc = await this.put({ ...cur, data: {}, deleted: true, updatedAt: Math.max(Date.now(), cur.updatedAt + 1), updatedBy: userId || '' });
    await this.domain.afterSave(doc, userId);
    return doc;
  }

  async close() {
    if (this.streaming) this.streaming.stop();
    if (this.live) this.live.close();
    if (this.sync) this.sync.stop();
    if (this.updates) this.updates.stop();
    if (this.gfx) this.gfx.stop();
    if (this.devices) this.devices.close();
    if (this.store) await this.store.close();
  }
}

module.exports = { App, loadConfig, ROOT, DEFAULTS };
