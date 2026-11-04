'use strict';
// Software on the website (regemarkfp.com/software): RegemarkFP's own apps, one place to get them. Each product names
// its GitHub repository; the website copies the installers of its GitHub releases to this server (the home server's
// NAS when there is one) and serves the downloads from there, so GitHub stays the place releases are made.
// Products are "product" records (team ''): slug, name, tagline, description, repo, logo, price, visible, access.
// Releases are kept in kv "sw:releases:<slug>": [{ tag, name, notes, publishedAt, prerelease, assets: [{ name, size,
// platform, arch, file }] }]. Downloads are counted per file (kv "sw:count:<slug>").
// A product with a price is not downloadable until it is paid for (later); a site admin can give people access now.
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
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
    const data = { slug, name, tagline: String(b.tagline || '').slice(0, 160), description: String(b.description || '').slice(0, 6000), repo: String(b.repo || ''), logo: /^(img_[\w-]+)?$/.test(String(b.logo || '')) ? String(b.logo || '') : '',
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
      // releases that dropped off the list: their files go (only five are kept)
      for (const k of kept) if (!out.some((o) => o.tag === k.tag)) { try { fs.rmSync(path.join(root(), safe(slug), k.tag), { recursive: true, force: true }); } catch { /* gone */ } }
      await app.store.kvSet('sw:releases:' + slug, out);
      await app.store.kvSet('sw:synced:' + slug, { at: Date.now(), copied });
      if (copied) log(`Software: ${p.name}: ${copied} file${copied === 1 ? '' : 's'} copied from GitHub`);
      return { releases: out.length, copied };
    })().finally(() => running.delete(slug));
    running.set(slug, job);
    return job;
  }
  async function syncAll() { for (const p of await products({ all: true })) if (p.repo) await sync(p.slug).catch((e) => log(`Software: ${p.name}: ${e.message}`)); }

  // ---- what the public sees
  const canGet = (p, user) => !p.price || (user && (p.access || []).includes(String(user.data.email || '').toLowerCase()));
  async function view(p, user) {
    const rels = await releasesOf(p.slug), counts = (await app.store.kvGet('sw:count:' + p.slug).catch(() => null)) || {};
    const synced = await app.store.kvGet('sw:synced:' + p.slug).catch(() => null);
    return { ...p, access: undefined, canDownload: canGet(p, user), downloads: Object.values(counts).reduce((a, b) => a + b, 0), synced: synced ? synced.at : 0,
      releases: rels.map((r) => ({ ...r, assets: r.assets.map((a) => ({ name: a.name, size: a.size, kind: a.kind, platform: a.platform, arch: a.arch, url: `/download/${p.slug}/${encodeURIComponent(r.tag)}/${encodeURIComponent(a.name)}` })) })) };
  }
  // a download: the file from this server (counted)
  async function file(slug, tag, name, user) {
    const p = await product(slug);
    if (!p || p.visible === false) fail(404, 'Not found');
    if (!canGet(p, user)) fail(402, `${p.name} is a paid app. Buying it on the website is coming soon.`);
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
  return { products, product, saveProduct, removeProduct, sync, syncAll, view, file, latest, releasesOf, root, start, stop, platformOf };
}

module.exports = { makeSoftware, platformOf };
