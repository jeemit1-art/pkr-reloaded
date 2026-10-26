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
  const headings = {
    game_scheduled:'♠ NEW GAME — RSVP NOW',
    game_reminder:'♠ POKER NIGHT REMINDER',
    rsvp_confirmed:'✓ RSVP CONFIRMED',
    join_request:'♟ NEW PLAYER JOIN REQUEST',
    member_joined:'✓ NEW MEMBER READY',
    rsvp_changed:'♟ RSVP UPDATED',
    game_changed:'♠ GAME DETAILS CHANGED',
    game_cancelled:'♠ POKER NIGHT CANCELLED',
    member_approved:'✓ YOU CAN JOIN YOUR ROOM',
    buyin:'🪙 BUY-IN RECORDED',
    rebuy:'🪙 REBUY RECORDED',
    cashout:'💵 CASH-OUT RECORDED',
    game_settled:'📋 GAME SETTLED — REVIEW PAYMENT',
    payment_status:'📋 PAYMENT STATUS UPDATED',
    payment_reminder:'💳 PAYMENT FOLLOW-UP',
    test:'✓ PKR ALERT TEST',
  };
  const heading=headings[kind] || data.title || 'PKR Reloaded';
  const route=kind==='game_scheduled'&&data.data?.gameId ? '/games/'+data.data.gameId+'/rsvp' : null;
  event.waitUntil(self.registration.showNotification(heading, {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: kind + ':' + (data.data?.gameId || data.data?.eventId || 'general') + ':' + (data.data?.notificationId || 'latest'),
    renotify:true,
    requireInteraction: kind === 'cashout' || kind === 'game_settled' || kind === 'join_request',
    vibrate:kind==='join_request'?[180,80,180,80,250]:kind==='buyin'?[90,55,90,55,160]:kind==='cashout'||kind==='game_settled'?[260,100,260,100,260]:[200,100,200],
    data: {...(data.data || {}),url:route || data.data?.url},
    actions: [{ action:'view', title:'View' }, { action:'dismiss', title:'Dismiss' }],
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const { gameId, eventId, results_token, url: linked } = event.notification.data || {};
  const target = linked || (results_token ? '/games/results/'+results_token : gameId ? '/games/'+gameId : eventId ? '/events/'+eventId : '/dashboard');
  // Notification payloads may contain user-controlled values. Never navigate
  // outside the PKR origin or to unsupported protocols on a notification tap.
  let url='/dashboard';
  try{
    const candidate=new URL(target,self.location.origin);
    if(candidate.origin===self.location.origin && /^\/(dashboard|events|games|schedule|insights|install)(\/|$)/.test(candidate.pathname))
      url=candidate.pathname+candidate.search;
  }catch{ /* safe fallback */ }
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(cs => {
      for (const c of cs) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
      return clients.openWindow(url);
    })
  );
});
