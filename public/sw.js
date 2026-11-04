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

// ---- browser push: match updates for the teams people follow, streams going live … (lib/webpush.js)
self.addEventListener('push', (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { n = { title: e.data ? e.data.text() : 'RegemarkFP' }; }
  e.waitUntil(self.registration.showNotification(n.title || 'RegemarkFP', { body: n.body || '', icon: '/icons/icon-192.png', badge: '/icons/favicon-64.png',
    tag: n.tag || undefined, renotify: !!n.tag, data: { url: n.url || '/', id: n.id || '' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const same = list.find((c) => c.url === url);
    if (same) return same.focus();
    return self.clients.openWindow(url);
  }));
});
