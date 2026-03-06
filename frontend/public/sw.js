// public/sw.js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { title:'PKR Reloaded', body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'PKR Reloaded', {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [200,100,200],
    data: data.data || {},
    actions: [{ action:'view', title:'View' }, { action:'dismiss', title:'Dismiss' }],
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const { gameId, eventId } = event.notification.data || {};
  const url = gameId ? `/games/${gameId}` : eventId ? `/events/${eventId}` : '/dashboard';
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(cs => {
      for (const c of cs) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
      return clients.openWindow(url);
    })
  );
});

// PKR: reformat game_scheduled push notifications in receiver's local time
self.addEventListener('push', function(pkrPushEvt) {
  try {
    const d = pkrPushEvt.data ? pkrPushEvt.data.json() : {};
    if (d.data && d.data.type === 'game_scheduled' && d.data.scheduled_at) {
      const dt = new Date(d.data.scheduled_at * 1000).toLocaleString(undefined, {
        weekday:'short', month:'short', day:'numeric',
        hour:'numeric', minute:'2-digit'
      });
      d.body = dt + (d.data.location ? ' · ' + d.data.location : '');
      pkrPushEvt.waitUntil(
        self.registration.showNotification(d.title || 'PKR', {
          body: d.body,
          icon: '/icon-192.png',
          data: d.data,
        })
      );
      return;
    }
  } catch(e) {}
});
