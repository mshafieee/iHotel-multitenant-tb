/**
 * iHotel Service Worker — Web Push Notifications
 * Handles background push events for housekeeping assignments.
 */

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}

  const title = data.title || 'iHotel';
  const options = {
    body:  data.body  || '',
    icon:  '/favicon.svg',
    badge: '/favicon.svg',
    tag:   data.tag   || 'ihotel',
    renotify: true,
    data:  { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
