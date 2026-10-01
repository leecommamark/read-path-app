// sw.js — read-path-app's last service worker (patch plan 7B, Phase 5).
//
// songpath, installed on a phone, is served by its own worker from its
// cache. A worker at this URL with new bytes replaces it on the next
// launch: it takes over at once, deletes songpath's caches and its
// database, unregisters itself, and reloads every open window, which then
// fetches the "moved" page from the network.
//
// songpath's caches are named readpath-<build> (its PREFIX), its database
// is `songpath`. The new app lives on the same origin with caches rp-*, and
// databases readpath and readpath-cache: none of those is touched.

const SONGPATH_CACHES = 'readpath-';
const SONGPATH_DB = 'songpath';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(SONGPATH_CACHES)) await caches.delete(key);
    }
    await new Promise(done => {
      const r = indexedDB.deleteDatabase(SONGPATH_DB);
      r.onsuccess = r.onerror = r.onblocked = () => done();
    });
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({type: 'window'})) {
      client.navigate(client.url);
    }
  })());
});
