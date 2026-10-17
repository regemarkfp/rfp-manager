/* Update check when the app starts.
 *  - Production PC (Windows): asks this PC whether the website it is linked to has a newer RFP Manager; if so,
 *    offers to install it (downloaded from the website, then RFP Manager restarts by itself).
 *  - Android app: the app opens the website with ?android=<build>; when a newer APK is on the website, offers it.
 * "Later" hides the offer for that version until the next start of the app. */
'use strict';
(() => {
  const ANDROID_KEY = 'rfp-android-build';
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } } };
  const skipped = new Set();
  try { for (const v of JSON.parse(sessionStorage.getItem('rfp-update-later') || '[]')) skipped.add(v); } catch (e) { /* none */ }
  const later = (v) => { skipped.add(v); try { sessionStorage.setItem('rfp-update-later', JSON.stringify([...skipped])); } catch (e) { /* ignore */ } };

  // the Android app's build: from the address it opened (?android=12), kept for later pages
  const q = new URLSearchParams(location.search).get('android');
  if (q && /^\d+$/.test(q)) store.set(ANDROID_KEY, q);
  // this tab is the Android app (scoring is allowed in the app, not in a browser)
  const fromApp0 = /^android-app:\/\/com\.regemarkfp\.rfpmanager/.test(document.referrer || '');
  if ((q && /^\d+$/.test(q)) || fromApp0) { try { sessionStorage.setItem('rfp-app', 'android'); } catch (e) { /* ignore */ } }
  const fromApp = /^android-app:\/\/com\.regemarkfp\.rfpmanager/.test(document.referrer || '');
  if (fromApp && !store.get(ANDROID_KEY)) store.set(ANDROID_KEY, '0');         // an early app that did not say its build

  const getJson = async (url, opts) => { const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...opts }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; };

  function box(title, text, buttons) {
    const old = document.getElementById('rfp-update'); if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'rfp-update';
    wrap.setAttribute('role', 'dialog');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(0,0,0,.55);padding:16px;font:14px/1.45 "Segoe UI",system-ui,sans-serif';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:420px;width:100%;background:#1e1e1e;color:#f1f1f1;border:1px solid #333;border-radius:12px;padding:20px 22px;box-shadow:0 10px 40px rgba(0,0,0,.6)';
    const h = document.createElement('h3'); h.textContent = title; h.style.cssText = 'margin:0 0 8px;font-size:18px';
    const p = document.createElement('p'); p.textContent = text; p.style.cssText = 'margin:0 0 16px;color:#bbb';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
    for (const b of buttons) {
      const el = document.createElement(b.href ? 'a' : 'button');
      el.textContent = b.label;
      if (b.href) el.href = b.href;
      el.style.cssText = 'font:inherit;border:0;border-radius:8px;padding:9px 16px;cursor:pointer;text-decoration:none;' + (b.primary ? 'background:#00ff82;color:#0f0f0f;font-weight:600' : 'background:#333;color:#f1f1f1');
      el.addEventListener('click', (e) => { if (b.onClick) { if (!b.href) e.preventDefault(); b.onClick(e); } if (b.close !== false) wrap.remove(); });
      row.append(el);
    }
    card.append(h, p, row); wrap.append(card); document.body.append(wrap);
    return { wrap, p, row };
  }

  // ---- the production PC
  async function pc(cfg) {
    let st;
    try { st = await getJson('/api/update'); } catch (e) { return; }                       // not signed in yet: next start
    if (!st.available && st.canUpdate && !st.checkedAt) { await new Promise((r) => setTimeout(r, 9000)); try { st = await getJson('/api/update'); } catch (e) { return; } }
    if (!st.available || skipped.has('pc-' + st.latest)) return;
    box('Update available', `RFP Manager ${st.latest} is available. This PC has ${st.current}. Install it now? RFP Manager restarts by itself (about 15 seconds). Your settings, data and images stay as they are.`, [
      { label: 'Later', onClick: () => later('pc-' + st.latest) },
      { label: 'Install now', primary: true, close: false, onClick: () => install(st.latest, cfg.version) }]);
  }
  async function install(latest, was) {
    const b = box('Updating…', `Downloading RFP Manager ${latest} from the website.`, []);
    try { await getJson('/api/update/install', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rfp': '1' }, body: '{}' }); }
    catch (e) { b.p.textContent = 'The update did not work: ' + e.message; addClose(b); return; }
    b.p.textContent = 'Installed. Restarting RFP Manager…';
    const t0 = Date.now();
    const tick = async () => {
      try { const c = await getJson('/api/config'); if (c.version && c.version !== was) { location.reload(); return; } } catch (e) { /* restarting */ }
      if (Date.now() - t0 > 90000) { b.p.textContent = 'RFP Manager has not come back yet. If it does not, start it again from the tray icon or run.bat.'; addClose(b); return; }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 3000);
  }
  function addClose(b) { const c = document.createElement('button'); c.textContent = 'Close'; c.style.cssText = 'font:inherit;border:0;border-radius:8px;padding:9px 16px;background:#333;color:#f1f1f1;cursor:pointer'; c.onclick = () => b.wrap.remove(); b.row.append(c); }

  // ---- the Android app
  async function android() {
    if (window.RFPNative) return;                                               // the app checks for its own updates
    const have = store.get(ANDROID_KEY);
    if (have === null) return;
    let info;
    try { info = await getJson('/api/update/info'); } catch (e) { return; }
    const a = info.android;
    if (!a || !(Number(a.versionCode) > Number(have))) return;
    if (skipped.has('android-' + a.versionCode)) return;
    box('New version of the app', `A new version of the RFP Manager app (${a.versionName || 'build ' + a.versionCode}) is ready. Install it? Android asks to update the app; your sign-in stays.`, [
      { label: 'Later', onClick: () => later('android-' + a.versionCode) },
      { label: 'Install', primary: true, href: '/app/rfp-manager.apk', onClick: () => later('android-' + a.versionCode) }]);
  }

  async function run() {
    let cfg;
    try { cfg = await getJson('/api/config'); } catch (e) { return; }
    if (cfg.mode === 'local') pc(cfg); else android();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(run, 1500)); else setTimeout(run, 1500);
})();
