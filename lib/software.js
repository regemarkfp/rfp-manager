'use strict';
// Software on the website (regemarkfp.com/software): RegemarkFP's own apps, one place to get them. Each product names
// its GitHub repository; the website copies the installers of its GitHub releases to this server (the home server's
// NAS when there is one) and serves the downloads from there, so GitHub stays the place releases are made.
// Products are "product" records (team ''): slug, name, tagline, description, repo, logo, price, visible, access.
// Releases are kept in kv "sw:releases:<slug>": [{ tag, name, notes, publishedAt, prerelease, assets: [{ name, size,
// platform, arch, file }] }]. Downloads are counted per file (kv "sw:count:<slug>").
// A product with a price is not downloadable until it is paid for (later); a site admin can give people access now.
// 1.5.0: apps can also be loaded straight to the website (a version with its installers, uploaded in pieces: no GitHub
// needed; kept next to the GitHub ones, marked manual), and each app has media: screenshots and videos uploaded here
// (product.media) and, from GitHub, its icon and screenshots (repo icon file, screenshots folders, README pictures; kv
// "sw:gh:<slug>"). Media is served at /software-media/<slug>/<file>.
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { fail, log, slug: slugify } = require('./util');

// what an installer is for, from its file name
function platformOf(name) {
  const n = String(name).toLowerCase();
  const arch = /arm64|aarch64/.test(n) ? 'arm64' : /x64|amd64|x86_64|win64/.test(n) ? 'x64' : /universal/.test(n) ? 'universal' : '';
  if (/\.(exe|msi|msix|appx)$/.test(n) || (/\.zip$/.test(n) && /win/.test(n))) return { platform: 'windows', arch };
  if (/\.(dmg|pkg)$/.test(n) || (/\.(zip|tar\.gz)$/.test(n) && /mac|osx|darwin/.test(n))) return { platform: 'mac', arch };
  if (/\.(appimage|deb|rpm|flatpak|snap)$/.test(n) || (/\.(tar\.gz|tar\.xz|zip)$/.test(n) && /linux/.test(n))) return { platform: 'linux', arch };
  return { platform: 'other', arch };
}
const kindOf = (name) => { const m = /\.(exe|msi|msix|dmg|pkg|appimage|deb|rpm|flatpak|snap|zip|tar\.gz|tar\.xz)$/i.exec(name); return m ? m[1].toLowerCase() : ''; };

function makeSoftware(app) {
  const cfg = app.config;
  // where the installers live: SOFTWARE_DIR (the NAS on the home server), else next to the NAS images, else the data folder
  let rootDir = null;
  function root() {
    if (rootDir) return rootDir;
    for (const d of [cfg.softwareDir, process.env.SOFTWARE_DIR, cfg.mediaMirror && path.join(path.dirname(path.resolve(cfg.mediaMirror)), 'software'), path.join(app.dataDir(), 'software')].filter(Boolean)) {
      try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); rootDir = d; return d; } catch { /* not writable: the next one */ }
    }
    rootDir = path.join(app.dataDir(), 'software');
    return rootDir;
  }
  const ghApi = () => ((cfg.software && cfg.software.api) || 'https://api.github.com').replace(/\/+$/, '');
  const ghHeaders = () => ({ accept: 'application/vnd.github+json', 'user-agent': 'RFP-Manager', ...(cfg.software && cfg.software.token ? { authorization: 'Bearer ' + cfg.software.token } : {}) });
  const safe = (s) => String(s || '').replace(/[^\w.+-]/g, '_').slice(0, 160);

  async function products({ all } = {}) {
    const list = (await app.store.listType('product')).filter((d) => !d.deleted && (all || d.data.visible !== false)).map((d) => ({ id: d.id, ...d.data }));
    return list.sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
  }
  async function product(slug) { return (await products({ all: true })).find((p) => p.slug === slug) || null; }
  async function saveProduct(b, id) {
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) fail(400, 'Give the product a name');
    const slug = slugify(b.slug || name).slice(0, 40);
    const others = (await products({ all: true })).filter((p) => p.id !== id);
    if (others.some((p) => p.slug === slug)) fail(409, 'Another product already uses that web address');
    if (b.repo && !/^[\w.-]+\/[\w.-]+$/.test(String(b.repo))) fail(400, 'The GitHub repository is owner/name, e.g. regemarkfp/regemark-replay');
    const cur = id ? await app.store.get(id).catch(() => null) : null, curMedia = (cur && !cur.deleted && cur.data.media) || [];
    const media = Array.isArray(b.media) ? b.media.map((m) => { const was = curMedia.find((x) => x.file === m.file); return was ? { ...was, caption: String(m.caption || '').slice(0, 200) } : null; }).filter(Boolean) : curMedia;
    const data = { media, hiddenMedia: (cur && !cur.deleted && cur.data.hiddenMedia) || [], iconPath: String(b.iconPath || '').replace(/^\/+/, '').slice(0, 200), slug, name, tagline: String(b.tagline || '').slice(0, 160), description: String(b.description || '').slice(0, 6000), repo: String(b.repo || ''), logo: /^(img_[\w-]+)?$/.test(String(b.logo || '')) ? String(b.logo || '') : '',
      price: Math.max(0, Number(b.price) || 0), visible: b.visible !== false, prerelease: !!b.prerelease, order: Number(b.order) || 0, access: Array.isArray(b.access) ? b.access.map((e) => String(e).trim().toLowerCase()).filter((e) => /@/.test(e)).slice(0, 500) : [] };
    const doc = await app.save('', 'product', id || 'product_' + slug, data, '');
    return { id: doc.id, ...doc.data };
  }
  async function removeProduct(id) { const d = await app.store.get(id); if (!d || d.deleted || d.type !== 'product') fail(404, 'No such product'); await app.put({ ...d, deleted: true, updatedAt: Math.max(Date.now(), d.updatedAt + 1) }); }
  const releasesOf = async (slug) => (await app.store.kvGet('sw:releases:' + slug).catch(() => null)) || [];

  // ---- copying GitHub releases to this server
  const running = new Map();
  async function sync(slug) {
    if (running.has(slug)) return running.get(slug);
    const job = (async () => {
      const p = await product(slug);
      if (!p || !p.repo) fail(400, 'Set the GitHub repository first');
      const r = await fetch(`${ghApi()}/repos/${p.repo}/releases?per_page=10`, { headers: ghHeaders(), signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (!r || !r.ok) fail(502, r && r.status === 404 ? `GitHub has no repository ${p.repo} (or it is private: add a token in the config)` : 'Could not reach GitHub just now');
      const rels = (await r.json()).filter((x) => !x.draft && (p.prerelease || !x.prerelease)).slice(0, 5);
      const kept = await releasesOf(slug), out = [];
      let copied = 0;
      for (const x of rels) {
        const tag = safe(x.tag_name), dir = path.join(root(), safe(slug), tag), was = kept.find((k) => k.tag === tag);
        const assets = [];
        for (const a of x.assets || []) {
          if (!kindOf(a.name)) continue;                    // installers and archives only (not checksums, logs …)
          const file = path.join(dir, safe(a.name));
          let ok = false;
          try { ok = fs.statSync(file).size === a.size; } catch { ok = false; }
          if (!ok) {
            fs.mkdirSync(dir, { recursive: true });
            const d = await fetch(a.browser_download_url, { headers: { 'user-agent': 'RFP-Manager', ...(cfg.software && cfg.software.token ? { authorization: 'Bearer ' + cfg.software.token, accept: 'application/octet-stream' } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(30 * 60e3) }).catch(() => null);
            if (!d || !d.ok || !d.body) { log(`Software: could not download ${a.name} (${slug} ${tag})`); continue; }
            const tmp = file + '.part';
            await pipeline(Readable.fromWeb(d.body), fs.createWriteStream(tmp));
            fs.renameSync(tmp, file);
            copied++;
          }
          assets.push({ name: a.name, size: a.size, kind: kindOf(a.name), ...platformOf(a.name), file: path.relative(root(), file), sha: (was && (was.assets.find((y) => y.name === a.name) || {}).sha) || '' });
        }
        out.push({ tag, version: String(x.tag_name).replace(/^v/i, ''), name: x.name || x.tag_name, notes: String(x.body || '').slice(0, 20000), publishedAt: x.published_at || x.created_at, prerelease: !!x.prerelease, url: x.html_url, assets });
      }
      // releases that dropped off the list: their files go (only five are kept); versions loaded straight here stay
      for (const k of kept) if (!k.manual && !out.some((o) => o.tag === k.tag)) { try { fs.rmSync(path.join(root(), safe(slug), k.tag), { recursive: true, force: true }); } catch { /* gone */ } }
      const all = [...out, ...kept.filter((k) => k.manual && !out.some((o) => o.tag === k.tag))].sort((a, b2) => String(b2.publishedAt).localeCompare(String(a.publishedAt)));
      await app.store.kvSet('sw:releases:' + slug, all);
      await ghMedia(p).catch((e) => log(`Software: ${p.name}: media from GitHub: ${e.message}`));
      await app.store.kvSet('sw:synced:' + slug, { at: Date.now(), copied });
      if (copied) log(`Software: ${p.name}: ${copied} file${copied === 1 ? '' : 's'} copied from GitHub`);
      return { releases: out.length, copied };
    })().finally(() => running.delete(slug));
    running.set(slug, job);
    return job;
  }
  // ---- the icon and screenshots from GitHub
  const IMG = /\.(png|jpe?g|webp|gif|svg)$/i, VID = /\.(mp4|webm|mov)$/i;
  const rawBase = () => ((cfg.software && cfg.software.raw) || 'https://raw.githubusercontent.com').replace(/\/+$/, '');
  async function grab(url, dir, max) {
    const ext = ((/\.(png|jpe?g|webp|gif|svg|mp4|webm|mov)(?:$|\?)/i.exec(url) || [])[1] || 'png').toLowerCase();
    const name = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.' + ext, file = path.join(dir, name);
    if (fs.existsSync(file)) return name;
    const r = await fetch(url, { headers: { 'user-agent': 'RFP-Manager', ...(cfg.software && cfg.software.token && /github/.test(url) ? { authorization: 'Bearer ' + cfg.software.token } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (!r || !r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > max) return null;
    if (ext !== 'svg' && /^\s*</.test(buf.subarray(0, 64).toString('utf8'))) return null;        // an HTML error page, not a picture
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
    return name;
  }
  async function ghMedia(p) {
    if (!p.repo) return;
    const info = await (await fetch(`${ghApi()}/repos/${p.repo}`, { headers: ghHeaders(), signal: AbortSignal.timeout(20000) })).json().catch(() => ({}));
    const branch = info.default_branch || 'main', raw = (f) => `${rawBase()}/${p.repo}/${branch}/${f.split('/').map(encodeURIComponent).join('/')}`;
    const dir = path.join(root(), safe(p.slug), 'gh'), out = { icon: '', media: [], at: Date.now(), description: info.description || '' };
    // the icon: the product's own path, else the usual places; else the owner's picture
    const tries = [p.iconPath, 'icon.png', 'logo.png', 'icon.svg', 'logo.svg', 'assets/icon.png', 'assets/logo.png', 'build/icon.png', 'resources/icon.png', 'public/icon.png', 'docs/icon.png', '.github/icon.png', 'src-tauri/icons/icon.png', 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 'brand/icon.png', 'public/brand/rfp-logo.png'].filter(Boolean);
    for (const f of tries) { const n = await grab(raw(f), dir, 3 * 1024 * 1024); if (n) { out.icon = n; break; } }
    if (!out.icon && info.owner && info.owner.avatar_url) out.icon = (await grab(info.owner.avatar_url + (info.owner.avatar_url.includes('?') ? '&' : '?') + 's=256&.png', dir, 3 * 1024 * 1024)) || '';
    // screenshots: the usual folders, then the pictures in the README (not badges)
    const urls = [];
    for (const d of ['screenshots', 'docs/screenshots', '.github/screenshots', 'assets/screenshots', 'media', 'docs/images', 'images']) {
      const r = await fetch(`${ghApi()}/repos/${p.repo}/contents/${d}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(), signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (!r || !r.ok) continue;
      const list = await r.json().catch(() => []);
      if (Array.isArray(list)) for (const x of list) if (x.type === 'file' && (IMG.test(x.name) || VID.test(x.name))) urls.push({ url: x.download_url || raw(x.path), caption: x.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') });
      if (urls.length) break;
    }
    const rm = await fetch(`${ghApi()}/repos/${p.repo}/readme`, { headers: { ...ghHeaders(), accept: 'application/vnd.github.raw' }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (rm && rm.ok) {
      const md = await rm.text();
      const found = [...md.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => ({ url: m[2], caption: m[1] })).concat([...md.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?/gi)].map((m) => ({ url: m[1], caption: m[2] || '' })));
      for (const x of found) {
        if (/shields\.io|badge|badgen|travis-ci|github\.com\/[^/]+\/[^/]+\/(actions|workflows)/i.test(x.url)) continue;
        const url = /^https?:/i.test(x.url) ? x.url.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\//, `${rawBase()}/$1/$2/`) : raw(x.url.replace(/^\.?\//, ''));
        if (!urls.some((u) => u.url === url)) urls.push({ url, caption: x.caption });
      }
    }
    for (const u of urls.slice(0, 12)) { const n = await grab(u.url, dir, VID.test(u.url) ? 60 * 1024 * 1024 : 15 * 1024 * 1024); if (n && n !== out.icon) out.media.push({ file: 'gh/' + n, kind: VID.test(n) ? 'video' : 'image', caption: u.caption || '', source: 'github' }); }
    await app.store.kvSet('sw:gh:' + p.slug, out);
  }

  // ---- loading apps (and media) straight to the website: uploads in pieces (32 MB, under Cloudflare's 100 MB limit)
  const CHUNK = 32 * 1024 * 1024;
  const upDir = () => path.join(root(), '.uploads');
  async function startUpload(slug, b, user) {
    if (!(await product(slug))) fail(404, 'No such app');
    const name = String(b.name || '').replace(/[\\/]/g, '_').trim().slice(0, 160), size = Math.round(Number(b.size));
    if (!name || !(size >= 0) || size > 8 * 1024 ** 3) fail(400, 'Give the file name and size (up to 8 GB)');
    const up = 'swu_' + crypto.createHash('sha1').update([slug, name, size, user.id].join('|')).digest('hex').slice(0, 24);
    await app.store.kvSet('sw:up:' + up, { slug, name, size, user: user.id, at: Date.now() });
    fs.mkdirSync(upDir(), { recursive: true });
    let have = 0; try { have = fs.statSync(path.join(upDir(), up)).size; } catch { have = 0; }
    return { upload: up, received: have, chunk: CHUNK };
  }
  async function upRec(slug, up, user) {
    if (!/^swu_[0-9a-f]{24}$/.test(String(up))) fail(404, 'No such upload');
    const rec = await app.store.kvGet('sw:up:' + up).catch(() => null);
    if (!rec || rec.slug !== slug || rec.user !== user.id) fail(404, 'This upload has expired: start it again');
    return rec;
  }
  async function chunk(slug, up, offset, buf, user) {
    const rec = await upRec(slug, up, user), file = path.join(upDir(), up);
    let have = 0; try { have = fs.statSync(file).size; } catch { have = 0; }
    offset = Math.round(Number(offset));
    if (!(offset >= 0) || offset > have) fail(409, `Send from byte ${have}`);
    if (offset + buf.length > rec.size) fail(400, 'More bytes than the file has');
    if (offset < have) fs.truncateSync(file, offset);
    fs.appendFileSync(file, buf);
    return { received: offset + buf.length, size: rec.size };
  }
  // a finished upload, moved into place
  async function takeUpload(slug, up, user, destDir) {
    const rec = await upRec(slug, up, user), file = path.join(upDir(), up);
    let have = -1; try { have = fs.statSync(file).size; } catch { have = -1; }
    if (rec.size === 0 && have < 0) { fs.writeFileSync(file, ''); have = 0; }
    if (have !== rec.size) fail(409, `${rec.name} is not complete (${Math.max(0, have)} of ${rec.size} bytes)`);
    fs.mkdirSync(destDir, { recursive: true });
    let name = safe(rec.name), i = 2; while (fs.existsSync(path.join(destDir, name))) name = safe(rec.name).replace(/(\.[^.]+)?$/, `-${i++}$1`);
    fs.renameSync(file, path.join(destDir, name));
    await app.store.kvSet('sw:up:' + up, null).catch(() => {});
    return { file: path.join(destDir, name), name: rec.name, stored: name, size: rec.size };
  }
  // a version loaded straight here: its installers, notes, beta or not
  async function addRelease(slug, b, user) {
    const p = await product(slug); if (!p) fail(404, 'No such app');
    const version = String(b.version || '').trim().replace(/^v/i, '').slice(0, 40);
    if (!/^[\w.+-]+$/.test(version)) fail(400, 'Give the version, e.g. 1.2.0');
    const tag = safe('v' + version), list = await releasesOf(slug);
    if (list.some((x) => x.tag === tag)) fail(409, `Version ${version} is already there: remove it first, or use another number`);
    const ups = Array.isArray(b.uploads) ? b.uploads : [];
    if (!ups.length) fail(400, 'Add the installer file(s)');
    const dir = path.join(root(), safe(slug), tag), assets = [];
    for (const up of ups) { const f = await takeUpload(slug, up, user, dir); assets.push({ name: f.stored, size: f.size, kind: kindOf(f.stored) || (f.stored.split('.').pop() || '').toLowerCase(), ...platformOf(f.stored), file: path.relative(root(), f.file), sha: '' }); }
    const rel = { tag, version, name: String(b.name || 'Version ' + version).slice(0, 80), notes: String(b.notes || '').slice(0, 20000), publishedAt: new Date().toISOString(), prerelease: !!b.prerelease, url: '', manual: true, assets };
    await app.store.kvSet('sw:releases:' + slug, [rel, ...list].sort((a, c) => String(c.publishedAt).localeCompare(String(a.publishedAt))));
    log(`Software: ${p.name} ${version} loaded on the website (${assets.length} file${assets.length === 1 ? '' : 's'})`);
    return rel;
  }
  async function removeRelease(slug, tag) {
    const list = await releasesOf(slug), r = list.find((x) => x.tag === tag);
    if (!r) fail(404, 'No such version');
    if (!r.manual) fail(400, 'This version comes from GitHub: remove it there (it goes with the next Sync)');
    try { fs.rmSync(path.join(root(), safe(slug), safe(tag)), { recursive: true, force: true }); } catch { /* gone */ }
    await app.store.kvSet('sw:releases:' + slug, list.filter((x) => x.tag !== tag));
    return { ok: true };
  }
  // screenshots and videos uploaded here
  async function addMedia(slug, b, user) {
    const p = await product(slug); if (!p) fail(404, 'No such app');
    const added = [];
    for (const up of Array.isArray(b.uploads) ? b.uploads : []) {
      const f = await takeUpload(slug, up, user, path.join(root(), safe(slug), 'media'));
      if (!IMG.test(f.stored) && !VID.test(f.stored)) { fs.rmSync(f.file, { force: true }); fail(400, `${f.name}: pictures (PNG, JPG, WebP, GIF) and videos (MP4, WebM) only`); }
      added.push({ file: 'media/' + f.stored, kind: VID.test(f.stored) ? 'video' : 'image', caption: String(b.caption || '').slice(0, 200), source: 'upload', at: Date.now() });
    }
    const d = await app.store.get(p.id);
    await app.save('', 'product', p.id, { ...d.data, media: [...(d.data.media || []), ...added] }, user.id);
    return { media: added };
  }
  async function removeMedia(slug, file, user) {
    const p = await product(slug); if (!p) fail(404, 'No such app');
    const d = await app.store.get(p.id), media = d.data.media || [];
    if (!media.some((m) => m.file === file)) fail(404, 'No such picture or video');
    try { fs.rmSync(path.join(root(), safe(slug), file), { force: true }); } catch { /* gone */ }
    await app.save('', 'product', p.id, { ...d.data, media: media.filter((m) => m.file !== file) }, user.id);
    return { ok: true };
  }
  // GitHub pictures can be hidden (they would come back with the next sync otherwise)
  async function hideMedia(slug, file, hide, user) {
    const p = await product(slug); if (!p) fail(404, 'No such app');
    const d = await app.store.get(p.id), hidden = new Set(d.data.hiddenMedia || []);
    if (hide) hidden.add(file); else hidden.delete(file);
    await app.save('', 'product', p.id, { ...d.data, hiddenMedia: [...hidden].slice(0, 200) }, user.id);
    return { ok: true };
  }
  // a media file for the public pages
  async function mediaFile(slug, rel) {
    const p = await product(slug);
    if (!p || p.visible === false) fail(404, 'Not found');
    if (!/^(gh|media)\/[\w.+-]+$/.test(String(rel))) fail(404, 'Not found');
    const full = path.join(root(), safe(slug), rel);
    if (!fs.existsSync(full)) fail(404, 'Not found');
    return full;
  }

  async function syncAll() { for (const p of await products({ all: true })) if (p.repo) await sync(p.slug).catch((e) => log(`Software: ${p.name}: ${e.message}`)); }

  // ---- what the public sees
  const canGet = (p, user) => !p.price || !!(user && (p.access || []).includes(String(user.data.email || '').toLowerCase()));
  async function view(p, user, { admin } = {}) {
    const rels = await releasesOf(p.slug), counts = (await app.store.kvGet('sw:count:' + p.slug).catch(() => null)) || {};
    const synced = await app.store.kvGet('sw:synced:' + p.slug).catch(() => null);
    const gh = (await app.store.kvGet('sw:gh:' + p.slug).catch(() => null)) || {}, hidden = new Set(p.hiddenMedia || []);
    const mUrl = (f) => `/software-media/${p.slug}/${f}`;
    const media = [...(p.media || []), ...(gh.media || [])].map((m) => ({ ...m, url: mUrl(m.file), hidden: hidden.has(m.file) }));
    return { ...p, access: undefined, icon: p.logo ? '/media/' + encodeURIComponent(p.logo) : gh.icon ? mUrl('gh/' + gh.icon) : '', iconFrom: p.logo ? 'upload' : gh.icon ? 'github' : '', ghDescription: gh.description || '',
      media: admin ? media : media.filter((m) => !m.hidden), canDownload: canGet(p, user), payments: !!(app.pay && app.pay.enabled()), downloads: Object.values(counts).reduce((a, b) => a + b, 0), synced: synced ? synced.at : 0,
      releases: rels.map((r) => ({ ...r, assets: r.assets.map((a) => ({ name: a.name, size: a.size, kind: a.kind, platform: a.platform, arch: a.arch, url: `/download/${p.slug}/${encodeURIComponent(r.tag)}/${encodeURIComponent(a.name)}` })) })) };
  }
  // a download: the file from this server (counted)
  async function file(slug, tag, name, user) {
    const p = await product(slug);
    if (!p || p.visible === false) fail(404, 'Not found');
    if (!canGet(p, user)) fail(402, `${p.name} is a paid app: buy it on its page first.`);
    const r = (await releasesOf(slug)).find((x) => x.tag === tag);
    const a = r && r.assets.find((x) => x.name === name);
    if (!a) fail(404, 'That file is not here (any more)');
    const full = path.join(root(), a.file);
    if (!full.startsWith(path.resolve(root())) || !fs.existsSync(full)) fail(404, 'That file is not on this server yet. Try again later.');
    const counts = (await app.store.kvGet('sw:count:' + slug).catch(() => null)) || {};
    counts[`${tag}/${name}`] = (counts[`${tag}/${name}`] || 0) + 1;
    await app.store.kvSet('sw:count:' + slug, counts).catch(() => {});
    return { path: full, name: a.name, size: fs.statSync(full).size };
  }
  // for the apps' own update check: the newest release, with absolute download addresses
  async function latest(slug, base) {
    const p = await product(slug);
    if (!p || p.visible === false) fail(404, 'Not found');
    const r = (await releasesOf(slug))[0];
    if (!r) return { name: p.name, version: '', assets: [] };
    return { name: p.name, version: r.version, tag: r.tag, publishedAt: r.publishedAt, notes: r.notes.slice(0, 4000), page: `${base}/software/${p.slug}`,
      assets: r.assets.map((a) => ({ name: a.name, platform: a.platform, arch: a.arch, size: a.size, url: `${base}/download/${p.slug}/${encodeURIComponent(r.tag)}/${encodeURIComponent(a.name)}` })) };
  }

  let timer = null;
  function start() { if (app.isLocal) return; timer = setInterval(() => syncAll().catch(() => {}), 6 * 3600e3); timer.unref(); setTimeout(() => syncAll().catch(() => {}), 30000).unref(); }
  function stop() { clearInterval(timer); }
  return { products, product, saveProduct, removeProduct, sync, syncAll, view, file, latest, releasesOf, root, start, stop, platformOf, ghMedia, startUpload, chunk, addRelease, removeRelease, addMedia, removeMedia, hideMedia, mediaFile, CHUNK };
}

module.exports = { makeSoftware, platformOf };
