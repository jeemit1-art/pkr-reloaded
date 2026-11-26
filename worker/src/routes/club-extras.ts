// Opt-in club extras. Consent-based shared costs and reusable tournament
// structures are separate from poker transactions and Stripe subscriptions.
import {Hono} from 'hono';
import type {Env} from '../types';
import {authMiddleware,requireEventRole,generateId} from '../middleware';
import {splitCents,validatedTournamentPreset,type ClubExpenseCategory} from '../club-extras-utils';

const extras=new Hono<{Bindings:Env}>();
const ready=(env:Env)=>env.PKR_CLUB_EXTRAS_V1==='1';
const disabled=(c:any)=>c.json({error:'Club extras need the verified isolated migration.',code:'CLUB_EXTRAS_NOT_READY'},503);
const failure=(c:any,e:unknown)=>{
  console.error('PKR club extras unavailable',e);
  return c.json({error:'Could not load club extras; existing balances are unchanged.'},503);
};
const safeName=(name:unknown,min=3,max=100)=>typeof name==='string'&&
  name.trim().length>=min&&name.trim().length<=max&&
  !/[\u0000-\u001f<>]/.test(name);
type ExpenseRow={id:string;event_id:string;game_id:string|null;category:string;
 title:string;notes:string|null;amount_cents:number;paid_by_user_id:string;
 created_by:string;status:string;created_at:number};
async function authorised(c:any,eventId:string,role:'member'|'cohost'|'host'='member'){
  return await requireEventRole(c,eventId,role);
}

extras.get('/events/:id/shared-expenses',authMiddleware,async c=>{
  if(!ready(c.env))return disabled(c);
  const eventId=c.req.param('id');
  if(!await authorised(c,eventId))return c.json({error:'Forbidden'},403);
  try{
    const [items,members]=await Promise.all([
      c.env.DB.prepare(
        'SELECT id,event_id,game_id,category,title,notes,amount_cents,paid_by_user_id,created_by,status,created_at '+
        'FROM room_shared_expenses WHERE event_id=? ORDER BY created_at DESC,id DESC LIMIT 100'
      ).bind(eventId).all<ExpenseRow>(),
      c.env.DB.prepare(
        'SELECT em.user_id,u.name AS display_name FROM event_members em JOIN users u ON u.id=em.user_id '+
        'WHERE em.event_id=? ORDER BY u.name,em.user_id'
      ).bind(eventId).all<{user_id:string;display_name:string}>(),
    ]);
    const expenses=await Promise.all(items.results.map(async item=>{
      const result=await c.env.DB.prepare(
        'SELECT user_id,share_cents,status,responded_at FROM room_shared_expense_splits WHERE expense_id=? ORDER BY user_id'
      ).bind(item.id).all<{user_id:string;share_cents:number;status:string;responded_at:number|null}>();
      return {...item,shares:result.results};
    }));
    c.header('Cache-Control','private, no-store');
    return c.json({expenses,members:members.results,
      note:'Shared expense proposals are separate from poker balances, settlements and transfers.'});
  }catch(e){return failure(c,e);}
});

extras.post('/events/:id/shared-expenses',authMiddleware,async c=>{
  if(!ready(c.env))return disabled(c);
  const eventId=c.req.param('id');
  if(!await authorised(c,eventId,'cohost'))
    return c.json({error:'Only hosts or co-hosts can propose expenses'},403);
  const data=await c.req.json().catch(()=>null) as {
    game_id?:unknown;title?:unknown;notes?:unknown;category?:unknown;
    amount_cents?:unknown;paid_by_user_id?:unknown;member_ids?:unknown
  }|null;
  if(!safeName(data?.title)||!['food','venue','supplies','other'].includes(String(data?.category))||
    !Number.isSafeInteger(data?.amount_cents)||Number(data?.amount_cents)<1||
    Number(data?.amount_cents)>5000000||!Array.isArray(data?.member_ids)||
    !safeName(data?.notes||'optional',3,240)||
    typeof data?.paid_by_user_id!=='string')return c.json({error:'Enter a description, valid amount and participants'},400);
  const ids=data.member_ids as string[];
  let shares:ReturnType<typeof splitCents>;
  try{shares=splitCents(Number(data.amount_cents),ids);}
  catch(e){return c.json({error:'Select 2–15 different approved members'},400);}
  try{
    const members=await c.env.DB.prepare(
      'SELECT user_id FROM event_members WHERE event_id=?'
    ).bind(eventId).all<{user_id:string}>();
    const allowed=new Set(members.results.map(x=>x.user_id));
    if(!allowed.has(data.paid_by_user_id)||shares.some(s=>!allowed.has(s.user_id)))
      return c.json({error:'All participants and the payer must be approved group members'},403);
    const gameId=data.game_id===null||data.game_id===undefined||data.game_id===''?null:String(data.game_id);
    if(gameId){
      const game=await c.env.DB.prepare(
        'SELECT id FROM games WHERE id=? AND event_id=?'
      ).bind(gameId,eventId).first<{id:string}>();
      if(!game)return c.json({error:'Game does not belong to this club'},400);
    }
    const id=generateId();
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO room_shared_expenses(id,event_id,game_id,category,title,notes,amount_cents,paid_by_user_id,created_by) '+
        'VALUES(?,?,?,?,?,?,?,?,?)'
      ).bind(id,eventId,gameId,data.category,
        (data.title as string).trim(),(data.notes as string||'').trim()||null,
        Number(data.amount_cents),data.paid_by_user_id,c.get('userId')),
      ...shares.map(share=>c.env.DB.prepare(
        'INSERT INTO room_shared_expense_splits(expense_id,user_id,share_cents) VALUES(?,?,?)'
      ).bind(id,share.user_id,share.share_cents)),
    ]);
    return c.json({ok:true,id,shares,disclaimer:'Proposed shares only; no transfers or poker transactions were created.'},201);
  }catch(e){return failure(c,e);}
});

extras.put('/events/:id/shared-expenses/:expenseId/respond',authMiddleware,async c=>{
  if(!ready(c.env))return disabled(c);
  const eventId=c.req.param('id');
  if(!await authorised(c,eventId))return c.json({error:'Forbidden'},403);
  const body=await c.req.json().catch(()=>null) as {status?:unknown}|null;
  const status=String(body?.status||'');
  if(status!=='accepted'&&status!=='declined')
    return c.json({error:'Choose accept or decline'},400);
  try{
    const changed=await c.env.DB.prepare(
      'UPDATE room_shared_expense_splits SET status=?,responded_at=unixepoch() '+
      'WHERE expense_id=? AND user_id=? AND status=? AND EXISTS '+
      "(SELECT 1 FROM room_shared_expenses WHERE id=? AND event_id=? AND status='proposed')"
    ).bind(status,c.req.param('expenseId'),c.get('userId'),'proposed',c.req.param('expenseId'),eventId).run();
    if(!changed.meta.changes)return c.json({error:'This proposal is not awaiting your response'},409);
    return c.json({ok:true,status,note:'This is consent only; no funds or poker balances have moved.'});
  }catch(e){return failure(c,e);}
});

extras.post('/events/:id/shared-expenses/:expenseId/cancel',authMiddleware,async c=>{
  if(!ready(c.env))return disabled(c);
  const eventId=c.req.param('id');
  if(!await authorised(c,eventId,'cohost'))return c.json({error:'Host permission required'},403);
  try{
    const res=await c.env.DB.prepare(
      "UPDATE room_shared_expenses SET status='cancelled',updated_at=unixepoch() "+
      "WHERE id=? AND event_id=? AND status='proposed'"
    ).bind(c.req.param('expenseId'),eventId).run();
    if(!res.meta.changes)return c.json({error:'Proposal was already closed'},409);
    return c.json({ok:true,note:'Cancelled proposal; no poker financial records were altered.'});
  }catch(e){return failure(c,e);}
});

// Read-only, host-only export in bounded pages. No emails, mobile numbers,
// password hashes, RSVP tokens, device keys or Stripe identifiers are exported.
type ExportKind='games'|'player_results'|'transfers'|'rsvps'|'rsvps_live'|'members'|'expense_splits'|'payment_events';
extras.get('/events/:id/data-export',authMiddleware,async c=>{
  if(!ready(c.env))return disabled(c);
  const eventId=c.req.param('id');
  if(!await authorised(c,eventId,'host'))return c.json({error:'Only the club owner can export complete history'},403);
  const kind=c.req.query('kind');
  const offset=Number(c.req.query('offset')||'0');
  if(!['games','player_results','transfers','rsvps','rsvps_live','members','expense_splits','payment_events'].includes(kind||'')||
    !Number.isSafeInteger(offset)||offset<0||offset>1000000)
    return c.json({error:'Select an export category and a valid page offset'},400);
  const pageSize=200;
  const lookups:Record<ExportKind,string>={
    games:'SELECT g.id AS game_id,g.scheduled_at,g.location,g.seats,g.status,g.created_at '+
      'FROM games g WHERE g.event_id=? ORDER BY g.scheduled_at,g.id LIMIT ? OFFSET ?',
    player_results:'SELECT gp.game_id,g.scheduled_at,gp.user_id,gp.display_name,gp.seat_number,'+
      'gp.buy_ins,gp.buy_in_total,gp.cashout,gp.net,gp.settled_at '+
      'FROM game_players gp JOIN games g ON g.id=gp.game_id WHERE g.event_id=? '+
      'ORDER BY g.scheduled_at,g.id,gp.user_id LIMIT ? OFFSET ?',
    transfers:'SELECT st.game_id,g.scheduled_at,st.from_user,st.to_user,st.from_name,st.to_name,'+
      'st.amount,st.status,st.paid_at,st.created_at '+
      'FROM settlement_transfers st JOIN games g ON g.id=st.game_id WHERE g.event_id=? '+
      'ORDER BY g.scheduled_at,g.id,st.id LIMIT ? OFFSET ?',
    rsvps:'SELECT r.game_id,g.scheduled_at,r.display_name,r.status,r.created_at '+
      'FROM game_rsvps r JOIN games g ON g.id=r.game_id WHERE g.event_id=? '+
      'ORDER BY g.scheduled_at,g.id,r.display_name LIMIT ? OFFSET ?',
    members:'SELECT em.user_id,u.name AS display_name,em.role,em.joined_at '+
      'FROM event_members em JOIN users u ON u.id=em.user_id WHERE em.event_id=? '+
      'ORDER BY em.joined_at,em.user_id LIMIT ? OFFSET ?',
    rsvps_live:'SELECT r.game_id,g.scheduled_at,r.display_name,r.status,r.arrival_option,'+
      'r.choice_value,r.seat_number,r.created_at,r.updated_at '+
      'FROM game_rsvp_guests r JOIN games g ON g.id=r.game_id WHERE g.event_id=? '+
      'ORDER BY g.scheduled_at,g.id,r.created_at,r.id LIMIT ? OFFSET ?',
    expense_splits:'SELECT e.id AS expense_id,e.created_at,e.title,e.category,e.amount_cents,'+
      'e.paid_by_user_id,s.user_id,s.share_cents,s.status AS consent_status,s.responded_at '+
      'FROM room_shared_expense_splits s JOIN room_shared_expenses e ON e.id=s.expense_id '+
      'WHERE e.event_id=? ORDER BY e.created_at,e.id,s.user_id LIMIT ? OFFSET ?',
    payment_events:'SELECT ev.game_id,g.scheduled_at,ev.transfer_id,ev.actor_id,ev.action,'+
      'ev.previous_status,ev.new_status,ev.created_at '+
      'FROM settlement_confirmation_events ev JOIN games g ON g.id=ev.game_id '+
      'WHERE g.event_id=? ORDER BY ev.created_at,ev.id LIMIT ? OFFSET ?',
  };
  try{
    const selected=kind as ExportKind;
    if(selected==='rsvps_live'&&c.env.PKR_RSVP_V2!=='1')return disabled(c);
    if(selected==='payment_events'&&c.env.PKR_SETTLEMENT_V2!=='1')return disabled(c);
    const rows=await c.env.DB.prepare(lookups[selected])
      .bind(eventId,pageSize+1,offset).all<Record<string,unknown>>();
    const hasMore=rows.results.length>pageSize;
    const visible=hasMore?rows.results.slice(0,pageSize):rows.results;
    c.header('Cache-Control','private, no-store');
    return c.json({kind:selected,rows:visible,has_more:hasMore,
      next_offset:hasMore?offset+pageSize:null,exported_at:Math.floor(Date.now()/1000),
      note:'Only current authorised club owner can view this paginated historic data.'});
  }catch(e){return failure(c,e);}
});

type PresetRow={id:string;event_id:string;name:string;config_json:string;created_at:number;updated_at:number};
extras.get('/events/:id/tournament-presets',authMiddleware,async c=>{
  if(!ready(c.env))return disabled(c);
  const eventId=c.req.param('id');
  if(!await authorised(c,eventId,'cohost'))return c.json({error:'Host or co-host permission required'},403);
  try{
    const rows=await c.env.DB.prepare(
      'SELECT id,event_id,name,config_json,created_at,updated_at FROM room_tournament_presets '+
      'WHERE event_id=? ORDER BY updated_at DESC LIMIT 30'
    ).bind(eventId).all<PresetRow>();
    const presets=rows.results.map(row=>({
      id:row.id,event_id:row.event_id,name:row.name,
      config:validatedTournamentPreset(JSON.parse(row.config_json)),
      created_at:row.created_at,updated_at:row.updated_at,
    })).filter(p=>!!p.config);
    c.header('Cache-Control','private, no-store');
    return c.json({presets});
  }catch(e){return failure(c,e);}
});

extras.post('/events/:id/tournament-presets',authMiddleware,async c=>{
  if(!ready(c.env))return disabled(c);
  const eventId=c.req.param('id');
  if(!await authorised(c,eventId,'cohost'))return c.json({error:'Host or co-host permission required'},403);
  const data=await c.req.json().catch(()=>null) as {name?:unknown;config?:unknown}|null;
  if(!safeName(data?.name,3,80))return c.json({error:'Name your tournament preset'},400);
  const config=validatedTournamentPreset(data?.config);
  if(!config)return c.json({error:'Tournament structure, blinds or payout distribution is invalid'},400);
  try{
    const existing=await c.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM room_tournament_presets WHERE event_id=?'
    ).bind(eventId).first<{count:number}>();
    if((existing?.count||0)>=30)return c.json({error:'This room already has 30 presets'},409);
    const id=generateId();
    await c.env.DB.prepare(
      'INSERT INTO room_tournament_presets(id,event_id,name,config_json,created_by) VALUES(?,?,?,?,?)'
    ).bind(id,eventId,(data!.name as string).trim(),JSON.stringify(config),c.get('userId')).run();
    return c.json({ok:true,id},201);
  }catch(e){return c.json({error:'A preset with that name already exists or could not be saved'},409);}
});

extras.delete('/events/:id/tournament-presets/:presetId',authMiddleware,async c=>{
  if(!ready(c.env))return disabled(c);
  const eventId=c.req.param('id');
  if(!await authorised(c,eventId,'cohost'))return c.json({error:'Host or co-host permission required'},403);
  try{
    const result=await c.env.DB.prepare(
      'DELETE FROM room_tournament_presets WHERE event_id=? AND id=?'
    ).bind(eventId,c.req.param('presetId')).run();
    if(!result.meta.changes)return c.json({error:'Preset not found'},404);
    return c.json({ok:true,note:'No existing tournament or settlement was changed.'});
  }catch(e){return failure(c,e);}
});

export default extras;
