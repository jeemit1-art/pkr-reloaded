self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { title:'PKR Reloaded', body: event.data?.text() }; }

  if (data.data && data.data.type === 'game_scheduled' && data.data.scheduled_at) {
    const dt = new Date(data.data.scheduled_at * 1000).toLocaleString(undefined, {
      weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'
    });
    data.body = dt + (data.data.location ? ' · ' + data.data.location : '');
  }

  const kind = data.data?.type || 'general';
  const headings = { game_scheduled:'♠ NEW GAME — RSVP NOW', buyin:'🪙 BUY-IN RECORDED', cashout:'💵 CASH-OUT RECORDED', game_settled:'📋 GAME SETTLED — REVIEW PAYMENT' };
  const heading=headings[kind] || data.title || 'PKR Reloaded';
  const route=kind==='game_scheduled'&&data.data?.gameId ? '/games/'+data.data.gameId+'/rsvp' : null;
  event.waitUntil(self.registration.showNotification(heading, {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: kind + ':' + (data.data?.gameId || '') + ':' + Date.now(),
    renotify:true,
    requireInteraction: kind === 'cashout' || kind === 'game_settled',
    vibrate:kind==='buyin'?[90,55,90,55,160]:kind==='cashout'||kind==='game_settled'?[260,100,260,100,260]:[200,100,200],
    data: {...(data.data || {}),url:route || data.data?.url},
    actions: [{ action:'view', title:'View' }, { action:'dismiss', title:'Dismiss' }],
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const { gameId, eventId, results_token, url: linked } = event.notification.data || {};
  const url = linked || (results_token ? `/games/results/${results_token}` : gameId ? `/games/${gameId}` : eventId ? `/events/${eventId}` : '/dashboard');
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(cs => {
      for (const c of cs) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
      return clients.openWindow(url);
    })
  );
});
