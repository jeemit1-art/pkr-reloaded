import { Env } from './types';
import { sendPushToEvent,sendPushToPlayer } from './push';

const GRACE   = 6 * 3600;   // don't nag within 6h of settling
const MIN_GAP = 20 * 3600;  // at most one reminder per ~day

const money = (c: number) => '$' + (c % 100 === 0 ? (c / 100).toFixed(0) : (c / 100).toFixed(2));

export async function sendPaymentReminders(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare(`
    SELECT t.id, t.amount, t.from_name, t.to_name, g.id AS game_id, g.event_id, g.results_token, e.name AS event_name
    FROM settlement_transfers t
    JOIN games g  ON g.id = t.game_id
    JOIN events e ON e.id = g.event_id
    WHERE g.status = 'settled'
      AND t.status IN ('owed','not_received')
      AND t.created_at <= ?
      AND (t.last_reminded_at IS NULL OR t.last_reminded_at <= ?)
  `).bind(now - GRACE, now - MIN_GAP).all<any>();

  for (const r of rows.results) {
    if (!r.from_name) continue;
    const accepted=await sendPushToPlayer(env, r.event_id, r.from_name, {
      title: `You still owe ${money(r.amount)} — ${r.event_name}`,
      body: `Once paid, tell the host or co-host so they can confirm receipt in PKR.`,
      data: { gameId: r.game_id, eventId: r.event_id, type: 'payment_reminder', results_token: r.results_token },
    });
    // Count only push service acceptance, not attempted or failed sends.
    // This does NOT mean the device displayed or the payer read the reminder.
    if(accepted>0){
      await env.DB.prepare('UPDATE settlement_transfers SET last_reminded_at=?, reminder_count=reminder_count+1 WHERE id=?')
        .bind(now, r.id).run();
    }
  }
}


/**
 * One-day and two-hour reminders for scheduled poker nights.
 * Called hourly; KV records successful sends so cron retries do not spam.
 * A notification means the push service accepted it, not that a device read it.
 */
export async function sendGameReminders(env:Env):Promise<void> {
  if(env.PKR_ENV==='staging')return;
  const now=Math.floor(Date.now()/1000);
  const slots=[
    {key:'day',seconds:24*3600,text:'about a day'},
    {key:'soon',seconds:2*3600,text:'about 2 hours'},
  ];
  for(const slot of slots){
    const games=await env.DB.prepare(`
      SELECT g.id,g.event_id,g.scheduled_at,g.location,e.name AS event_name
      FROM games g JOIN events e ON e.id=g.event_id
      WHERE g.status IN ('scheduled','lobby') AND e.status!='ended'
        AND g.scheduled_at>=? AND g.scheduled_at<?
      ORDER BY g.scheduled_at LIMIT 100
    `).bind(now+slot.seconds,now+slot.seconds+3600).all<{
      id:string;event_id:string;scheduled_at:number;location:string|null;event_name:string
    }>();
    for(const g of games.results){
      const key='game-reminder:'+g.id+':'+slot.key+':'+g.scheduled_at;
      if(await env.KV.get(key))continue;
      const datetime=new Date(g.scheduled_at*1000).toLocaleString('en-AU',{
        weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',
        timeZone:'Australia/Brisbane'
      });
      const accepted=await sendPushToEvent(env,g.event_id,{
        title:slot.key==='soon'?'Poker starts soon — '+g.event_name:'Poker night tomorrow — '+g.event_name,
        body:datetime+(g.location?' · '+g.location:'')+'. Check your RSVP.',
        data:{eventId:g.event_id,gameId:g.id,type:'game_reminder',
          url:'/games/'+encodeURIComponent(g.id)+'/rsvp',notificationId:key}
      });
      if(accepted>0)await env.KV.put(key,'1',{expirationTtl:48*3600});
    }
  }
}
