// 巴别图书馆 Service Worker：构建指纹资源缓存优先（秒开），其余网络优先保更新
const CACHE = 'babel-v3';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// 网络优先并回写缓存；离线时回退缓存
function networkFirst(request) {
  return fetch(request)
    .then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
      return res;
    })
    .catch(() =>
      caches.match(request).then((hit) => hit || (request.mode === 'navigate' ? caches.match('./') : hit)),
    );
}

// 内容寻址的构建资源（hash 即内容指纹，永不变更）：缓存优先，未命中回源并写入
function cacheFirst(request) {
  return caches.match(request).then(
    (hit) =>
      hit ||
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      }),
  );
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  e.respondWith(url.pathname.includes('/assets/') ? cacheFirst(e.request) : networkFirst(e.request));
});

