// sw.js — the service worker. What makes a shipped build work with the
// network off, which is the whole deliverable of patch plan 9.
//
// Phase 6. Cache-first over everything the build produced, versioned by the
// build hash, old caches reclaimed when a new version takes over.
//
// THE PRECACHE LIST IS THE BUILD'S OWN MANIFEST. tables/manifest.json lists
// every file build_dist.py wrote, with its length and hash, so nothing here
// has to be kept in step by hand — a file added to the build is precached
// without this file changing. `build` in that manifest is the cache name, so
// a new build is a new cache and the old one is deleted on activate.
//
// EVERYTHING IS PRECACHED, INCLUDING THE ONE-SHOT IMPORT FILES. words.*,
// cards.* and examples.* are read once, at the first run, and then live in
// IndexedDB; caching them again looks wasteful. They are cached anyway, and
// deliberately: a deploy invalidates the import marker, so the next launch
// re-imports — and "the next launch" is exactly when a phone might be in a
// tunnel. 26 MB against a 10 GB quota is not a cost worth reasoning about
// network availability for.
//
// SCOPE IS RELATIVE. Registered from index.html with './sw.js', so the worker
// scopes to wherever the app is served rather than to the origin root. Plan
// 10 wraps this same folder in a native shell and plan 9 Phase 8 serves it
// from a project page, so neither may assume it owns '/'.
const MANIFEST = 'tables/manifest.json';
const PREFIX = 'readpath-';

// STAMPED BY THE BUILD, like mode.js. The worker has to know its own version
// without looking it up, and the obvious lookup is a trap: caches.match()
// searches every cache in creation order, so a new worker asking "which
// manifest is mine?" gets the OLD cache's answer and then deletes the cache
// it just filled. tools/build_dist.py substitutes this line and refuses to
// build if it cannot find it. 'dev' is the source-tree value: a server build
// gets one cache and keeps reusing it, which is what you want while editing.
const BUILD = '589265ae7c2a8ae6';
const CACHE = PREFIX + BUILD;

// A request whose response should never be cached: nothing in a shipped build
// talks to the network, but a server build shares this file and its /api/*
// calls must not be served stale from a cache.
const isApi = url => new URL(url).pathname.includes('/api/');

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const manifest = await (await fetch(MANIFEST, {cache: 'reload'})).json();
    const cache = await caches.open(CACHE);
    // './' as well as the file list: a launch from the home screen asks for
    // the directory, not for index.html by name.
    const urls = ['./', MANIFEST, ...manifest.files.map(f => f.path)];
    // one at a time rather than cache.addAll: 79 requests at once is a lot to
    // ask of a phone, and addAll rejects the whole batch if any one fails,
    // which would leave the app with no cache at all rather than most of one.
    for (const u of urls) {
      try {
        const r = await fetch(u, {cache: 'reload'});
        if (r.ok) await cache.put(u, r);
      } catch (e) {
        // A missing file is worth knowing about but is not worth refusing to
        // install over: the alternative is no offline support whatsoever.
        console.warn('sw: could not precache', u, e);
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys())
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || isApi(req.url)) return;   // let it go to the network

  event.respondWith((async () => {
    const hit = await caches.match(req, {ignoreSearch: true});
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // cache what the build did not list but the app asked for anyway, so a
      // second offline launch has it. Opaque and error responses are not
      // cached: a 404 that got cached would outlive the mistake.
      if (res.ok && res.type === 'basic')
        (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch (e) {
      // Offline and not cached. A navigation falls back to the app shell,
      // which is the one response that makes the app open at all.
      if (req.mode === 'navigate') {
        const shell = await caches.match('./');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
