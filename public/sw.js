/* RFP Manager service worker: lets the app open as an app (Android, "Add to home screen") and shows a friendly
 * page when there is no connection. Data always comes live from the website; nothing private is cached. */
'use strict';
const CACHE = 'rfp-shell-v1';
const OFFLINE = '/offline.html';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/icons/icon-192.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;          // only page loads; API calls, media and sockets go straight through
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
