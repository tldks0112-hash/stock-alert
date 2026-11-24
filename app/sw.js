// 타점노트 서비스 워커: 휴대폰 푸시 알림을 받아서 보여 주고, 누르면 앱의 그 타점 화면을 열어요.
// 인터넷이 끊겨도 앱 화면이 열리도록 기본 파일을 저장해 둬요. 인터넷이 되면 항상 새 파일을 먼저 받아요.
const CACHE = 'tajeom-v2';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'privacy.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;   // 서버 요청·글꼴은 그대로
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    d = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(self.registration.showNotification(d.title || '타점노트', {
    body: d.body || '새 타점이 있어요',
    tag: d.tag || undefined,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        return c.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : w));
      }
    }
    return self.clients.openWindow(url);
  }));
});
