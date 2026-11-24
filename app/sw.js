// 타점노트 서비스 워커: 휴대폰 푸시 알림을 받아서 보여 주고, 누르면 앱의 그 타점 화면을 열어요.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
