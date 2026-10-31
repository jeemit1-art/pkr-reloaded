self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { title:'PKR Reloaded', body: event.data?.text() }; }

  const kind = data.data?.type || 'general';
  const fallbacks = {
    game_scheduled:'♠ New poker game scheduled',
    game_reminder:'♠ Poker night reminder',
    rsvp_confirmed:'RSVP confirmed',
    join_request:'Approval needed: new player',
    member_joined:'New member joined',
    rsvp_changed:'Player RSVP updated',
    game_changed:'Poker night details changed',
    game_cancelled:'Poker night cancelled',
    member_approved:'Your group access is approved',
    buyin:'Buy-in recorded',
    rebuy:'Rebuy recorded',
    cashout:'Cash-out recorded',
    game_settled:'Game results are ready',
    settlement_request:'Settlement requires your attention',
    payment_status:'Payment status changed',
    payment_reminder:'Payment follow-up',
    test:'PKR test notification',
  };
  // The server supplies context such as group name, amount and next action.
  // Do not discard it in favour of a generic headline.
  const title=typeof data.title==='string'&&data.title.trim()
    ?data.title.trim().slice(0,140):(fallbacks[kind]||'PKR update');
  let body=typeof data.body==='string'?data.body.trim().slice(0,300):'';
  if(!body&&kind==='game_scheduled'&&data.data?.scheduled_at){
    const dt=new Date(data.data.scheduled_at*1000).toLocaleString(undefined,{
      weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'
    });
    body=dt+(data.data.location?' · '+data.data.location:'')+' — open PKR to RSVP.';
  }
  if(!body)body='Open PKR to see the update and what to do next.';
  const important=['join_request','game_reminder','game_changed','cashout',
    'game_settled','settlement_request','payment_reminder'].includes(kind);
  const urgent=['join_request','settlement_request','payment_reminder'].includes(kind);
  const route=kind==='game_scheduled'&&data.data?.gameId ?
    '/games/'+data.data.gameId+'/rsvp' : null;
  // Vibration is supported by some Android browsers; iOS controls alert
  // sound, volume and vibration through system settings and Focus.
  const pattern=urgent?[220,100,220,100,300]:important?[180,80,180,80,220]:[140,75,140];
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon:'/icon-192.png',
    badge:'/icon-192.png',
    tag:kind+':'+(data.data?.gameId||data.data?.eventId||'general')+':'+
      (data.data?.notificationId||'latest'),
    renotify:true,
    requireInteraction:urgent,
    vibrate:pattern,
    data:{...(data.data||{}),url:route||data.data?.url},
    actions:[{action:'view',title:'Open PKR'},{action:'dismiss',title:'Dismiss'}],
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
