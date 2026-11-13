// 앱 파일만 캐시한다(네트워크 먼저). 서랍 자료(Firebase·drawer.local.json)는 캐시하지 않는다.
const VERSION = 'geulgam-v1';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/fb.js', 'js/vendor/lucian-icons/runtime.js', 'js/vendor/lucian-icons/refresh.js', 'js/vendor/lucian-icons/copy.js', 'manifest.webmanifest', 'icons/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('geulgam-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || /\.local\.json$|demo\//.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
