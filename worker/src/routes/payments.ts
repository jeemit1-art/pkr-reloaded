import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole } from '../middleware';
import { sendPushToAccount } from '../push';

const payments = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// Public result links are read-only. Only the host or co-host may confirm payments.
// A secure payer-confirmation workflow requires verified player identity.
// Host / co-host sets status (received, not received, back to owed)
payments.put('/games/:id/transfers/:tid/status', authMiddleware, async (c) => {
  const { id: gameId, tid } = c.req.param();
  const { status } = await c.req.json<{ status: string }>();
  if (!['owed', 'paid', 'not_received'].includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const game = await c.env.DB.prepare('SELECT event_id,status FROM games WHERE id=?')
    .bind(gameId).first<{ event_id: string; status: string }>();
  if (!game) return c.json({ error: 'Game not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'cohost')) {
    return c.json({ error: 'Only host or co-host can change payment status' }, 403);
  }
  if (game.status !== 'settled') {
    return c.json({ error: 'Payment status can only be changed on a settled game' }, 409);
  }
  const prior = c.env.PKR_SETTLEMENT_V2==='1'
    ? await c.env.DB.prepare('SELECT status FROM settlement_transfers WHERE id=? AND game_id=?')
        .bind(tid,gameId).first<{status:string}>()
    : null;
  const now = Math.floor(Date.now() / 1000);
  const result = await c.env.DB.prepare(
    // Legacy migration status means unknown payment history. Refuse to overwrite
    // it via routine payment controls; an audited reconciliation is separate.
    "UPDATE settlement_transfers SET status=?, paid_at=?, last_reminded_at=NULL WHERE id=? AND game_id=? AND status!='legacy'"
  ).bind(status, status === 'paid' ? now : null, tid, gameId).run();
  if (result.meta.changes === 0) {
    const existing = await c.env.DB.prepare(
      'SELECT status FROM settlement_transfers WHERE id=? AND game_id=?'
    ).bind(tid,gameId).first<{status:string}>();
    if(existing?.status==='legacy') return c.json({
      error:'Historical transfer is unverified and cannot be marked paid by routine payment controls. Review original records first.',
      code:'HISTORICAL_PAYMENT_REVIEW_REQUIRED',
    },409);
    return c.json({ error: 'Settlement transfer not found in this game' }, 404);
  }
  if(c.env.PKR_SETTLEMENT_V2==='1'&&prior?.status!==status)
    await writeAudit(c,gameId,tid,'host_override',prior?.status||null,status);
  return c.json({ ok: true, status });
});


// V2 routes are explicitly unavailable until the additive D1 migration is
// verified and PKR_SETTLEMENT_V2 is enabled. No legacy records are rewritten.
interface PayGame {id:string;event_id:string;status:string;results_token:string|null}
interface PayTransfer {
  id:string;game_id:string;from_user:string;to_user:string;from_name:string;
  to_name:string;amount:number;status:string;paid_at:number|null;
  last_reminded_at:number|null;
}
const safeMoney=(cents:number)=>String.fromCharCode(36)+(cents/100).toFixed(2);
const v2=(c:any)=>c.env.PKR_SETTLEMENT_V2==='1';
async function settledGame(c:any,gameId:string):Promise<PayGame|null>{
  return c.env.DB.prepare(
    'SELECT id,event_id,status,results_token FROM games WHERE id=?'
  ).bind(gameId).first() as Promise<PayGame|null>;
}
async function writeAudit(
  c:any,gameId:string,tid:string|null,action:string,
  before:string|null,after:string|null
):Promise<void>{
  await c.env.DB.prepare(
    'INSERT INTO settlement_confirmation_events(id,game_id,transfer_id,actor_id,action,previous_status,new_status) VALUES(?,?,?,?,?,?,?)'
  ).bind(crypto.randomUUID(),gameId,tid,c.get('userId'),action,before,after).run();
}
const privateData=(game:PayGame,kind:string,tid?:string)=>({
  gameId:game.id,eventId:game.event_id,results_token:game.results_token,
  type:kind,notificationId:tid?kind+':'+tid+':'+Date.now():kind+':'+Date.now(),
  url:game.results_token?'/games/results/'+encodeURIComponent(game.results_token):'/games/'+encodeURIComponent(game.id),
});

// Logged-in members can check if their own transfers require action. This
// returns no subscription secrets or guessed identity assignments.
payments.get('/games/:id/settlement-control',authMiddleware,async(c)=>{
  if(!v2(c))return c.json({error:'Settlement acknowledgements are not activated',code:'SETTLEMENT_V2_NOT_READY'},503);
  const game=await settledGame(c,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'member'))return c.json({error:'Room membership required'},403);
  if(game.status!=='settled')return c.json({error:'Save the final results before sending settlements'},409);
  const settings=await c.env.DB.prepare('SELECT * FROM settlement_notification_settings WHERE game_id=?')
    .bind(game.id).first<any>();
  const outstanding=await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM settlement_transfers WHERE game_id=? AND status IN ('owed','not_received','payer_claimed')"
  ).bind(game.id).first<{count:number}>();
  return c.json({
    game_id:game.id,enabled:!!settings?.enabled,
    reminders_enabled:!!settings?.reminders_enabled,
    last_broadcast_at:settings?.last_broadcast_at??null,
    outstanding_count:outstanding?.count||0,
    can_manage:await requireEventRole(c,game.event_id,'cohost'),
    verified_push_required:true,
  });
});

// Host starts payment collection only after the saved, settled game is closed.
// Recipients and payers receive separate, individually addressed notifications.
// A push acceptance count is NOT proof of end-user delivery or receipt.
payments.post('/games/:id/settlement-control/broadcast',authMiddleware,async(c)=>{
  if(!v2(c))return c.json({error:'Settlement v2 not activated'},503);
  const game=await settledGame(c,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'cohost'))return c.json({error:'Host or co-host only'},403);
  if(game.status!=='settled')return c.json({error:'Settle and save game results first'},409);
  const body=await c.req.json().catch(()=>({})) as {reminders_enabled?:unknown};
  if(body.reminders_enabled!==undefined&&typeof body.reminders_enabled!=='boolean')
    return c.json({error:'reminders_enabled must be true or false'},400);
  const settings=await c.env.DB.prepare('SELECT last_broadcast_at,reminders_enabled FROM settlement_notification_settings WHERE game_id=?')
    .bind(game.id).first<{last_broadcast_at:number|null;reminders_enabled:number}>();
  const now=Math.floor(Date.now()/1000);
  if(settings?.last_broadcast_at&&now-settings.last_broadcast_at<600)
    return c.json({error:'Settlement notifications were recently sent. Try again later to avoid duplicates.',code:'BROADCAST_COOLDOWN'},429);
  const transfers=await c.env.DB.prepare(
    "SELECT id,game_id,from_user,to_user,from_name,to_name,amount,status,paid_at,last_reminded_at FROM settlement_transfers WHERE game_id=? AND status IN ('owed','not_received','payer_claimed') AND amount>0 ORDER BY created_at"
  ).bind(game.id).all<PayTransfer>();
  const reminders=body.reminders_enabled===undefined?!!settings?.reminders_enabled:body.reminders_enabled;
  // State saved before sending: a retry cannot cause a duplicate broadcast.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO settlement_notification_settings(game_id,enabled,reminders_enabled,last_broadcast_at,started_at,updated_by,updated_at) VALUES(?,1,?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET enabled=1,reminders_enabled=excluded.reminders_enabled,last_broadcast_at=excluded.last_broadcast_at,started_at=COALESCE(started_at,excluded.started_at),updated_by=excluded.updated_by,updated_at=excluded.updated_at'
    ).bind(game.id,reminders?1:0,now,now,c.get('userId'),now),
    c.env.DB.prepare(
      "UPDATE settlement_transfers SET last_reminded_at=? WHERE game_id=? AND status IN ('owed','not_received')"
    ).bind(now,game.id),
  ]);
  await writeAudit(c,game.id,null,'host_broadcast',null,null);
  let accepted=0,unlinked=0;
  for(const t of transfers.results){
    const amount=safeMoney(t.amount);
    const people=[
      {id:t.from_user,title:'PKR - Payment to make',body:'Pay '+t.to_name+' '+amount+'. Review the settlement in PKR.'},
      {id:t.to_user,title:'PKR - Payment to receive',body:t.from_name+' is due to pay you '+amount+'. Review the settlement in PKR.'},
    ];
    for(const person of people){
      const delivered=await sendPushToAccount(c.env,game.event_id,person.id,{
        title:person.title,body:person.body,
        data:privateData(game,'settlement_request',t.id),
      }).catch(()=>0);
      accepted+=delivered;
      if(!delivered)unlinked++;
    }
  }
  return c.json({
    ok:true,transfers:transfers.results.length,push_accepted:accepted,
    recipients_without_accepted_push:unlinked,reminders_enabled:reminders,
    note:'Push accepted does not confirm device delivery. Unlinked players need a verified room account.',
  });
});

// Host can pause or resume daily reminders without changing any payment.
payments.put('/games/:id/settlement-control/reminders',authMiddleware,async(c)=>{
  if(!v2(c))return c.json({error:'Settlement v2 not activated'},503);
  const game=await settledGame(c,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'cohost'))return c.json({error:'Host or co-host only'},403);
  if(game.status!=='settled')return c.json({error:'Game not settled'},409);
  const body=await c.req.json().catch(()=>({})) as {enabled?:unknown};
  if(typeof body.enabled!=='boolean')return c.json({error:'enabled must be a boolean'},400);
  const row=await c.env.DB.prepare('SELECT enabled FROM settlement_notification_settings WHERE game_id=?')
    .bind(game.id).first<{enabled:number}>();
  if(!row?.enabled)return c.json({error:'Send the initial settlement notifications first'},409);
  await c.env.DB.prepare(
    'UPDATE settlement_notification_settings SET reminders_enabled=?,updated_by=?,updated_at=? WHERE game_id=? AND enabled=1'
  ).bind(body.enabled?1:0,c.get('userId'),Math.floor(Date.now()/1000),game.id).run();
  await writeAudit(c,game.id,null,body.enabled?'reminders_on':'reminders_off',null,null);
  return c.json({ok:true,reminders_enabled:body.enabled});
});

// Only an authenticated participant may attest to having paid or received.
// Guests represented by "manual_x" IDs cannot claim another person's transfer.
payments.post('/games/:id/transfers/:tid/respond',authMiddleware,async(c)=>{
  if(!v2(c))return c.json({error:'Settlement v2 not activated'},503);
  const game=await settledGame(c,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'member'))return c.json({error:'Room membership required'},403);
  if(game.status!=='settled')return c.json({error:'Game not settled'},409);
  const collection=await c.env.DB.prepare(
    'SELECT enabled FROM settlement_notification_settings WHERE game_id=?'
  ).bind(game.id).first<{enabled:number}>();
  if(!collection?.enabled)return c.json({
    error:'The host has not started settlement notifications for this game.',
    code:'SETTLEMENT_NOT_STARTED',
  },409);
  const body=await c.req.json().catch(()=>({})) as {action?:unknown};
  const action=body.action;
  if(action!=='sent'&&action!=='received'&&action!=='not_received')
    return c.json({error:'Choose sent, received or not_received'},400);
  const tid=c.req.param('tid');
  const transfer=await c.env.DB.prepare(
    'SELECT * FROM settlement_transfers WHERE id=? AND game_id=?'
  ).bind(tid,game.id).first<PayTransfer>();
  if(!transfer)return c.json({error:'Transfer not found'},404);
  if(transfer.status==='legacy')return c.json({error:'Historical transfers require separate reconciliation'},409);
  const actor=c.get('userId'),payer=action==='sent';
  if(actor!==(payer?transfer.from_user:transfer.to_user))
    return c.json({error:'Only the verified '+(payer?'payer':'recipient')+' may perform this action'},403);
  const prev=transfer.status;
  if(payer&&!['owed','not_received'].includes(prev))
    return c.json({error:'This transfer has already been reported as sent or settled'},409);
  if(!payer&&prev!=='payer_claimed')
    return c.json({error:'The payer must first mark the payment as sent'},409);
  const next=payer?'payer_claimed':action==='received'?'paid':'not_received';
  const now=Math.floor(Date.now()/1000);
  const result=await c.env.DB.prepare(
    'UPDATE settlement_transfers SET status=?,paid_at=?,last_reminded_at=? WHERE id=? AND game_id=? AND status=?'
  ).bind(next,next==='paid'?now:null,action==='not_received'?now:null,tid,game.id,prev).run();
  if(!result.meta.changes)return c.json({error:'Payment changed on another device; refresh and review'},409);
  await writeAudit(c,game.id,tid,action,prev,next);
  const notifyId=payer?transfer.to_user:transfer.from_user;
  const notice=payer
    ?{title:'PKR - Payment marked sent',body:transfer.from_name+' marked '+safeMoney(transfer.amount)+' sent. Please confirm receipt.'}
    :action==='received'
      ?{title:'PKR - Payment confirmed',body:transfer.to_name+' confirmed receiving '+safeMoney(transfer.amount)+'.'}
      :{title:'PKR - Payment not received',body:transfer.to_name+' has not received '+safeMoney(transfer.amount)+'. Please check the transfer.'};
  const pushAccepted=await sendPushToAccount(c.env,game.event_id,notifyId,{
    ...notice,data:privateData(game,'payment_status',tid),
  }).catch(()=>0);
  return c.json({ok:true,status:next,push_accepted:pushAccepted});
});

// Bulk host actions are limited to specifically selected, settled, non-legacy
// transfers. No "all historical games" side effects; requires explicit IDs.
payments.post('/games/:id/transfers/bulk-status',authMiddleware,async(c)=>{
  if(!v2(c))return c.json({error:'Settlement v2 not activated'},503);
  const game=await settledGame(c,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'cohost'))return c.json({error:'Host or co-host only'},403);
  if(game.status!=='settled')return c.json({error:'Game not settled'},409);
  const body=await c.req.json().catch(()=>({})) as {ids?:unknown;status?:unknown};
  const ids=Array.isArray(body.ids)?body.ids:[];
  if(!ids.length||ids.length>100||!ids.every(x=>typeof x==='string'&&x.length>0&&x.length<=100)||
     new Set(ids).size!==ids.length||!['paid','owed'].includes(String(body.status)))
    return c.json({error:'Select 1-100 unique transfers and a paid/unpaid status'},400);
  const placeholders=ids.map(()=>'?').join(',');
  const rows=await c.env.DB.prepare(
    `SELECT id,status,amount FROM settlement_transfers WHERE game_id=? AND id IN (${placeholders})`
  ).bind(game.id,...ids).all<{id:string;status:string;amount:number}>();
  if(rows.results.length!==ids.length||rows.results.some(r=>r.status==='legacy'))
    return c.json({error:'Selection includes an unknown or unverified historical transfer. Nothing changed.'},409);
  const next=body.status as 'paid'|'owed';
  const changes=rows.results.filter(r=>r.status!==next);
  if(!changes.length)return c.json({ok:true,updated:0,status:next});
  const now=Math.floor(Date.now()/1000);
  const statements=changes.map(r=>c.env.DB.prepare(
    'UPDATE settlement_transfers SET status=?,paid_at=?,last_reminded_at=NULL WHERE game_id=? AND id=? AND status=?'
  ).bind(next,next==='paid'?now:null,game.id,r.id,r.status));
  const affected=await c.env.DB.batch(statements);
  const updated=affected.filter(x=>x.meta?.changes===1).length;
  for(let i=0;i<changes.length;i++){
    if(affected[i]?.meta?.changes===1)
      await writeAudit(c,game.id,changes[i].id,'host_bulk_'+next,changes[i].status,next);
  }
  if(updated!==changes.length)return c.json({
    error:'Some transfers changed concurrently. Refresh payment statuses.',updated,expected:changes.length,
  },409);
  return c.json({ok:true,updated,status:next});
});

export default payments;
