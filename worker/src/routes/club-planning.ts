// Private club planning features. Entire surface is gated by an additive
// staging-first D1 migration; no existing membership, game or money mutations.
import {Hono} from 'hono';
import type {Env} from '../types';
import {authMiddleware,requireEventRole,generateId} from '../middleware';
import {sendPushToAccount,sendPushToModerators} from '../push';
import {resolvePlayerLeaderboard,type SettledPlayerRow} from '../player-leaderboard';
import {scoreSeasonRows,validDateOptions,validLeaguePoints,type LeaguePoints} from '../club-planning-utils';

const club=new Hono<{Bindings:Env}>();
const on=(env:Env)=>env.PKR_CLUB_PLANNING_V1==='1';
const now=()=>Math.floor(Date.now()/1000);
const unavailable=(c:any)=>c.json({
  error:'Club planning awaits the isolated D1 migration and staging acceptance.',
  code:'CLUB_PLANNING_NOT_READY',
},503);
const fail=(c:any,e:unknown)=>{
  console.error('PKR club planning operation failed',e);
  return c.json({error:'Club planning is temporarily unavailable.',code:'CLUB_PLANNING_UNAVAILABLE'},503);
};
type PollRow={
  id:string;event_id:string;title:string;options_json:string;status:string;
  closes_at:number;selected_index:number|null;created_at:number;updated_at:number;
};
type WaitStatus='waiting'|'offered'|'claimed'|'expired'|'withdrawn';
type WaitRow={user_id:string;display_name:string;status:WaitStatus;created_at:number;expires_at:number|null};
type GameRow={id:string;event_id:string;seats:number;status:string};
async function gameFor(env:Env,gameId:string){
  return env.DB.prepare('SELECT id,event_id,seats,status FROM games WHERE id=?')
    .bind(gameId).first<GameRow>();
}
const isOpen=(game:GameRow)=>game.status==='scheduled'||game.status==='lobby';
async function gameMember(c:any,gameId:string,minRole:'member'|'cohost'|'host'='member'){
  const game=await gameFor(c.env,gameId);
  if(!game)return null;
  return await requireEventRole(c,game.event_id,minRole)?game:null;
}
async function capacity(env:Env,gameId:string,seats:number):Promise<{filled:number;available:number}>{
  // A manually seated player and that player's RSVP count once. A confirmed
  // unassigned RSVP still occupies a place, so offers cannot overbook them.
  const result=await env.DB.prepare(
    "SELECT ((SELECT COUNT(*) FROM game_players WHERE game_id=?) + "+
    "(SELECT COUNT(*) FROM game_rsvp_guests g WHERE g.game_id=? AND g.status='yes' "+
    "AND NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id=g.game_id "+
    "AND LOWER(TRIM(gp.display_name))=LOWER(TRIM(g.display_name))))) AS filled"
  ).bind(gameId,gameId).first<{filled:number}>();
  const filled=Math.max(0,Number(result?.filled||0));
  return {filled,available:Math.max(0,seats-filled)};
}
function safePoll(row:PollRow,counts:Array<{option_index:number;total:number}>,mine?:number){
  let options:number[]=[];
  try{options=JSON.parse(row.options_json);}catch{/* Invalid saved poll won't reveal private data. */}
  return {id:row.id,event_id:row.event_id,title:row.title,options,
    status:row.status,closes_at:row.closes_at,
    selected_index:row.selected_index,created_at:row.created_at,
    counts:options.map((_,index)=>Number(counts.find(x=>x.option_index===index)?.total||0)),
    my_vote:mine??null};
}

// Authenticated members see aggregated date votes, but never see who selected
// each option. Hosts cannot use a poll result to change attendance or balances.
club.get('/events/:id/date-polls',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Forbidden'},403);
  try{
    const polls=await c.env.DB.prepare(
      'SELECT * FROM room_date_polls WHERE event_id=? ORDER BY created_at DESC LIMIT 15'
    ).bind(eventId).all<PollRow>();
    const result=await Promise.all(polls.results.map(async row=>{
      const [votes,mine]=await Promise.all([
        c.env.DB.prepare(
          'SELECT option_index,COUNT(*) AS total FROM room_date_poll_votes WHERE poll_id=? GROUP BY option_index'
        ).bind(row.id).all<{option_index:number;total:number}>(),
        c.env.DB.prepare(
          'SELECT option_index FROM room_date_poll_votes WHERE poll_id=? AND user_id=?'
        ).bind(row.id,c.get('userId')).first<{option_index:number}>(),
      ]);
      return safePoll(row,votes.results,mine?.option_index);
    }));
    c.header('Cache-Control','private, no-store');
    return c.json({polls:result});
  }catch(e){return fail(c,e);}
});
club.post('/events/:id/date-polls',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'cohost'))return c.json({error:'Only a host or co-host can create a date poll'},403);
  const body=await c.req.json().catch(()=>null) as {title?:unknown;options?:unknown;closes_at?:unknown}|null;
  const title=typeof body?.title==='string'?body.title.trim().replace(/\s+/g,' '):'';
  const options=validDateOptions(body?.options,now());
  const closes=body?.closes_at;
  if(title.length<3||title.length>100||/[<>\u0000-\u001f]/.test(title)||!options||
     !Number.isSafeInteger(closes)||Number(closes)<now()+900||Number(closes)>=options[0])
    return c.json({error:'Provide a 3–100 character title, 2–5 future dates, and a vote deadline before the first date'},400);
  const id=generateId();
  try{
    const res=await c.env.DB.prepare(
      "INSERT INTO room_date_polls(id,event_id,title,options_json,closes_at,created_by) "+
      "VALUES(?,?,?,?,?,?)"
    ).bind(id,eventId,title,JSON.stringify(options),Number(closes),c.get('userId')).run();
    if(!res.meta.changes)return c.json({error:'Poll was not created'},409);
    c.header('Cache-Control','private, no-store');
    return c.json({ok:true,id},201);
  }catch{
    return c.json({error:'Only one open poll is allowed at a time. Close the previous poll first.'},409);
  }
});
club.put('/events/:id/date-polls/:pollId/vote',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const eventId=c.req.param('id'),pollId=c.req.param('pollId');
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Forbidden'},403);
  const body=await c.req.json().catch(()=>null) as {option_index?:unknown}|null;
  const choice=body?.option_index;
  if(!Number.isSafeInteger(choice)||Number(choice)<0||Number(choice)>4)
    return c.json({error:'Choose a valid date'},400);
  try{
    const poll=await c.env.DB.prepare(
      "SELECT options_json FROM room_date_polls WHERE id=? AND event_id=? AND status='open' AND closes_at>unixepoch()"
    ).bind(pollId,eventId).first<{options_json:string}>();
    if(!poll)return c.json({error:'This date poll is closed'},409);
    let options:number[];
    try{options=JSON.parse(poll.options_json);}catch{return unavailable(c);}
    if(Number(choice)>=options.length)return c.json({error:'Choose a listed date'},400);
    const updated=await c.env.DB.prepare(
      "INSERT INTO room_date_poll_votes(poll_id,user_id,option_index) "+
      "SELECT id,?,? FROM room_date_polls WHERE id=? AND event_id=? AND status='open' AND closes_at>unixepoch() "+
      "ON CONFLICT(poll_id,user_id) DO UPDATE SET option_index=excluded.option_index,updated_at=unixepoch()"
    ).bind(c.get('userId'),Number(choice),pollId,eventId).run();
    if(!updated.meta.changes)return c.json({error:'Voting has closed'},409);
    return c.json({ok:true,option_index:choice});
  }catch(e){return fail(c,e);}
});
club.post('/events/:id/date-polls/:pollId/close',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const eventId=c.req.param('id'),pollId=c.req.param('pollId');
  if(!await requireEventRole(c,eventId,'cohost'))return c.json({error:'Only a host or co-host can close a poll'},403);
  const body=await c.req.json().catch(()=>null) as {selected_index?:unknown}|null;
  const choice=body?.selected_index;
  try{
    const poll=await c.env.DB.prepare('SELECT options_json FROM room_date_polls WHERE event_id=? AND id=?')
      .bind(eventId,pollId).first<{options_json:string}>();
    if(!poll)return c.json({error:'Poll not found'},404);
    let options:number[];
    try{options=JSON.parse(poll.options_json);}catch{return unavailable(c);}
    if(choice!==null&&(!Number.isSafeInteger(choice)||Number(choice)<0||Number(choice)>=options.length))
      return c.json({error:'Choose a listed winning date or close without selecting one'},400);
    const changed=await c.env.DB.prepare(
      "UPDATE room_date_polls SET status='closed',selected_index=?,updated_at=unixepoch() "+
      "WHERE id=? AND event_id=? AND status='open'"
    ).bind(choice===null?null:Number(choice),pollId,eventId).run();
    if(!changed.meta.changes)return c.json({error:'Poll was already closed'},409);
    // Scheduling is deliberately separate: the existing paid-host and game
    // creation controls are never bypassed by closing a date poll.
    return c.json({ok:true,winning_date:choice===null?null:options[Number(choice)],
      note:'Date selected. Use the existing game scheduler to confirm and notify players.'});
  }catch(e){return fail(c,e);}
});

// Waitlist is member-ID based, so two identical screen names cannot claim
// another person's place. An offer is first-come availability, not a seat
// reservation; the real RSVP board owns the exclusive seat guarantee.
export async function offerNextWaitlisted(env:Env,gameId:string){
  if(!on(env)||env.PKR_RSVP_V2!=='1')return null;
  const game=await gameFor(env,gameId);
  if(!game||!isOpen(game))return null;
  try{
    // Removing room membership revokes outstanding availability offers.
    await env.DB.prepare(
      "UPDATE game_waitlist SET status='withdrawn',updated_at=unixepoch() "+
      "WHERE game_id=? AND status IN ('waiting','offered') AND NOT EXISTS "+
      "(SELECT 1 FROM event_members em WHERE em.event_id=? AND em.user_id=game_waitlist.user_id)"
    ).bind(gameId,game.event_id).run();
    await env.DB.prepare(
      "UPDATE game_waitlist SET status='expired',updated_at=unixepoch() "+
      "WHERE game_id=? AND status='offered' AND expires_at<=unixepoch()"
    ).bind(gameId).run();
    const changed=await env.DB.prepare(
      "UPDATE game_waitlist SET status='offered',offered_at=unixepoch(),"+
      "expires_at=unixepoch()+1800,updated_at=unixepoch() "+
      "WHERE game_id=? AND status='waiting' AND user_id=("+
      "SELECT user_id FROM game_waitlist w WHERE game_id=? AND status='waiting' "+
      "AND EXISTS(SELECT 1 FROM event_members em WHERE em.event_id=? AND em.user_id=w.user_id) "+
      "ORDER BY created_at,user_id LIMIT 1) "+
      "AND NOT EXISTS(SELECT 1 FROM game_waitlist WHERE game_id=? AND status='offered') "+
      "AND ((SELECT COUNT(*) FROM game_players WHERE game_id=?) + "+
      "(SELECT COUNT(*) FROM game_rsvp_guests g WHERE g.game_id=? AND g.status='yes' "+
      "AND NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id=g.game_id "+
      "AND LOWER(TRIM(gp.display_name))=LOWER(TRIM(g.display_name))))) "+
      "<(SELECT seats FROM games WHERE id=? AND status IN ('scheduled','lobby'))"
    ).bind(gameId,gameId,game.event_id,gameId,gameId,gameId,gameId).run();
    if(!changed.meta.changes)return null;
    const offered=await env.DB.prepare(
      "SELECT user_id FROM game_waitlist WHERE game_id=? AND status='offered'"
    ).bind(gameId).first<{user_id:string}>();
    if(offered){
      // Opt-in account-bound notification. Provider acceptance is not proof
      // the recipient saw it. The dashboard also displays the offer.
      await sendPushToAccount(env,game.event_id,offered.user_id,{
        title:'PKR seat available',
        body:'A place has opened for your poker night. Open the RSVP board to confirm; availability is not held.',
        data:{type:'waitlist_offer',eventId:game.event_id,gameId,url:'/games/'+gameId+'/rsvp'},
      }).catch(()=>0);
    }
    return offered?.user_id||null;
  }catch(e){
    console.error('Waitlist offer could not be advanced',e);
    return null;
  }
}
export async function syncWaitlistAfterRsvp(
  env:Env,gameId:string,userId:string,status:'yes'|'no'|'maybe'
){
  if(!on(env))return;
  try{
    if(status==='yes'){
      await env.DB.prepare(
        "UPDATE game_waitlist SET status='claimed',updated_at=unixepoch() "+
        "WHERE game_id=? AND user_id=? AND status IN ('offered','waiting')"
      ).bind(gameId,userId).run();
    }else await offerNextWaitlisted(env,gameId);
  }catch(e){console.error('Waitlist sync deferred',e);}
}
club.get('/games/:id/waitlist',authMiddleware,async c=>{
  if(!on(c.env)||c.env.PKR_RSVP_V2!=='1')return unavailable(c);
  const game=await gameMember(c,c.req.param('id'));
  if(!game)return c.json({error:'Room membership required'},403);
  try{
    const [availability,mine,count,isManager]=await Promise.all([
      capacity(c.env,game.id,game.seats),
      c.env.DB.prepare('SELECT status,expires_at FROM game_waitlist WHERE game_id=? AND user_id=?')
        .bind(game.id,c.get('userId')).first<{status:WaitStatus;expires_at:number|null}>(),
      c.env.DB.prepare("SELECT COUNT(*) AS count FROM game_waitlist w WHERE game_id=? AND status='waiting' AND EXISTS (SELECT 1 FROM event_members em WHERE em.event_id=? AND em.user_id=w.user_id)")
        .bind(game.id,game.event_id).first<{count:number}>(),
      requireEventRole(c,game.event_id,'cohost'),
    ]);
    const list=isManager?await c.env.DB.prepare(
      "SELECT w.user_id,u.name AS display_name,w.status,w.created_at,w.expires_at "+
      "FROM game_waitlist w JOIN users u ON u.id=w.user_id JOIN event_members em ON em.event_id=? AND em.user_id=w.user_id WHERE w.game_id=? AND "+
      "w.status IN ('waiting','offered') ORDER BY CASE w.status WHEN 'offered' THEN 0 ELSE 1 END,w.created_at LIMIT 40"
    ).bind(game.event_id,game.id).all<WaitRow>():{results:[] as WaitRow[]};
    c.header('Cache-Control','private, no-store');
    return c.json({game_id:game.id,open:isOpen(game),
      seats:game.seats,filled:availability.filled,available:availability.available,
      waiting:Number(count?.count||0),my_status:mine?.status==='offered'&&Number(mine.expires_at||0)<=now()?'expired':mine?.status||null,
      my_offer_expires_at:mine?.expires_at||null,
      queue:isManager?list.results:undefined,
      note:'An offer alerts you that a place may be available; the RSVP board confirms seats.'});
  }catch(e){return fail(c,e);}
});
club.post('/games/:id/waitlist',authMiddleware,async c=>{
  if(!on(c.env)||c.env.PKR_RSVP_V2!=='1')return unavailable(c);
  const game=await gameMember(c,c.req.param('id'));
  if(!game)return c.json({error:'Room membership required'},403);
  if(!isOpen(game))return c.json({error:'Waitlist is closed for this game'},409);
  try{
    const free=await capacity(c.env,game.id,game.seats);
    if(free.available>0)return c.json({error:'There is an available place. Please RSVP directly.'},409);
    const user=await c.env.DB.prepare('SELECT name FROM users WHERE id=?')
      .bind(c.get('userId')).first<{name:string}>();
    if(!user)return c.json({error:'Member account not found'},403);
    const already=await c.env.DB.prepare(
      "SELECT id FROM game_rsvp_guests WHERE game_id=? AND status='yes' AND display_name=? COLLATE NOCASE"
    ).bind(game.id,user.name).first();
    const seated=await c.env.DB.prepare(
      'SELECT user_id FROM game_players WHERE game_id=? AND user_id=?'
    ).bind(game.id,c.get('userId')).first();
    if(already||seated)return c.json({error:'You are already listed for this game'},409);
    const prior=await c.env.DB.prepare(
      'SELECT status FROM game_waitlist WHERE game_id=? AND user_id=?'
    ).bind(game.id,c.get('userId')).first<{status:WaitStatus}>();
    if(prior?.status==='waiting'||prior?.status==='offered')
      return c.json({ok:true,status:prior.status,existing:true});
    await c.env.DB.prepare(
      "INSERT INTO game_waitlist(game_id,user_id,status) VALUES(?,?,'waiting') "+
      "ON CONFLICT(game_id,user_id) DO UPDATE SET status='waiting',"+
      "created_at=unixepoch(),offered_at=NULL,expires_at=NULL,updated_at=unixepoch() "+
      "WHERE game_waitlist.status IN ('claimed','expired','withdrawn')"
    ).bind(game.id,c.get('userId')).run();
    return c.json({ok:true,status:'waiting'},201);
  }catch(e){return fail(c,e);}
});
club.delete('/games/:id/waitlist',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const game=await gameMember(c,c.req.param('id'));
  if(!game)return c.json({error:'Room membership required'},403);
  try{
    const change=await c.env.DB.prepare(
      "UPDATE game_waitlist SET status='withdrawn',updated_at=unixepoch() "+
      "WHERE game_id=? AND user_id=? AND status IN ('waiting','offered')"
    ).bind(game.id,c.get('userId')).run();
    if(change.meta.changes)await offerNextWaitlisted(c.env,game.id);
    return c.json({ok:true,changed:!!change.meta.changes});
  }catch(e){return fail(c,e);}
});
club.post('/games/:id/waitlist/offer-next',authMiddleware,async c=>{
  if(!on(c.env)||c.env.PKR_RSVP_V2!=='1')return unavailable(c);
  const game=await gameMember(c,c.req.param('id'),'cohost');
  if(!game)return c.json({error:'Host or co-host permission required'},403);
  const offered=await offerNextWaitlisted(c.env,game.id);
  return c.json({ok:true,offered:!!offered,
    note:offered?'The next waiting member has been offered a place; no seat is reserved.':
      'There is no currently available place or eligible waiting member.'});
});

// A request is only a message to the host, never a ledger entry. The existing
// protected host buy-in/cash-out actions remain the sole source of truth.
club.get('/games/:id/member-requests',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const game=await gameMember(c,c.req.param('id'));
  if(!game)return c.json({error:'Room membership required'},403);
  try{
    const manager=await requireEventRole(c,game.event_id,'cohost');
    const rows=await c.env.DB.prepare(
      'SELECT r.id,r.game_id,r.user_id,u.name AS member_name,r.kind,r.note,r.status,'+
      'r.created_at,r.updated_at FROM game_member_requests r JOIN users u ON u.id=r.user_id '+
      'WHERE r.game_id=? '+(manager?'':'AND r.user_id=? ')+
      'ORDER BY r.created_at DESC LIMIT 80'
    ).bind(...(manager?[game.id]:[game.id,c.get('userId')]))
      .all<{id:string;game_id:string;user_id:string;member_name:string;
        kind:string;note:string|null;status:string;created_at:number;updated_at:number}>();
    c.header('Cache-Control','private, no-store');
    return c.json({requests:rows.results,can_manage:manager,game_status:game.status,
      note:'Host approvals are not financial transactions. Record funds using existing guarded controls.'});
  }catch(e){return fail(c,e);}
});
club.post('/games/:id/member-requests',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const game=await gameMember(c,c.req.param('id'));
  if(!game)return c.json({error:'Room membership required'},403);
  if(game.status!=='active')return c.json({error:'Requests open only while a game is live'},409);
  const raw=await c.req.json().catch(()=>null) as {kind?:unknown;note?:unknown}|null;
  const kind=String(raw?.kind||'');
  const note=typeof raw?.note==='string'?raw.note.trim():'';
  if(!['buyin','cashout','tournament_rebuy','addon'].includes(String(kind))||
    note.length>180||/[\u0000-\u001f<>]/.test(note))
    return c.json({error:'Choose a valid request and optional short note'},400);
  const id=generateId();
  try{
    const result=await c.env.DB.prepare(
      "INSERT INTO game_member_requests(id,game_id,user_id,kind,note) "+
      "SELECT ?,id_game,?,?,? FROM (SELECT id AS id_game FROM games WHERE id=? AND status='active')"
    ).bind(id,c.get('userId'),kind,note||null,game.id).run();
    if(!result.meta.changes)return c.json({error:'The game is no longer active'},409);
    try{c.executionCtx.waitUntil(sendPushToModerators(c.env,game.event_id,{
      title:'New PKR player request',
      body:'An approved member has requested host attention during the live game.',
      data:{type:'player_request',gameId:game.id,eventId:game.event_id,
        url:'/events/'+encodeURIComponent(game.event_id)+'?tab=night&game='+encodeURIComponent(game.id)},
    }));}catch{}
    return c.json({ok:true,id,status:'pending'},201);
  }catch{
    return c.json({error:'You already have a pending request of this type. Ask the host to review it.'},409);
  }
});
club.put('/games/:id/member-requests/:requestId',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const game=await gameMember(c,c.req.param('id'),'cohost');
  if(!game)return c.json({error:'Host or co-host permission required'},403);
  const raw=await c.req.json().catch(()=>null) as {status?:unknown}|null;
  const next=String(raw?.status||'');
  if(!['approved','declined','resolved'].includes(String(next)))
    return c.json({error:'Choose approve, decline or resolve'},400);
  try{
    const changed=await c.env.DB.prepare(
      'UPDATE game_member_requests SET status=?,reviewed_by=?,updated_at=unixepoch() '+
      'WHERE id=? AND game_id=? AND ((status=? AND ? IN (?,?)) OR (status=? AND ?=?))'
    ).bind(next,c.get('userId'),c.req.param('requestId'),game.id,
      'pending',next,'approved','declined','approved',next,'resolved').run();
    if(!changed.meta.changes)return c.json({error:'Request status changed; reload before deciding again'},409);
    return c.json({ok:true,status:next,
      note:'This changes request status only. Confirm any money in the existing guarded game ledger.'});
  }catch(e){return fail(c,e);}
});

// Seasons are strictly a derived read of immutable settled games. They never
// update historical net, player identity, settlement or cash-out records.
type SeasonRow={
  id:string;event_id:string;name:string;starts_at:number;ends_at:number;
  points_first:number;points_second:number;points_third:number;points_other:number;
};
club.get('/events/:id/seasons',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Forbidden'},403);
  try{
    const rows=await c.env.DB.prepare(
      'SELECT id,event_id,name,starts_at,ends_at,points_first,points_second,points_third,points_other '+
      'FROM room_league_seasons WHERE event_id=? ORDER BY starts_at DESC LIMIT 25'
    ).bind(eventId).all<SeasonRow>();
    c.header('Cache-Control','private, no-store');
    return c.json({seasons:rows.results});
  }catch(e){return fail(c,e);}
});
club.post('/events/:id/seasons',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'cohost'))return c.json({error:'Host or co-host permission required'},403);
  const raw=await c.req.json().catch(()=>null) as {
    name?:unknown;starts_at?:unknown;ends_at?:unknown;points?:unknown;
  }|null;
  const name=typeof raw?.name==='string'?raw.name.trim().replace(/\s+/g,' '):'';
  const start=raw?.starts_at,end=raw?.ends_at;
  const points=validLeaguePoints(raw?.points||{first:10,second:7,third:5,other:1});
  if(name.length<3||name.length>80||/[\u0000-\u001f<>]/.test(name)||
    !Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
    Number(start)<=0||Number(end)<=Number(start)||Number(end)-Number(start)>370*86400||
    !points)return c.json({error:'Set a season name, valid start/end dates (maximum 370 days) and descending points'},400);
  const id=generateId();
  try{
    await c.env.DB.prepare(
      'INSERT INTO room_league_seasons(id,event_id,name,starts_at,ends_at,'+
      'points_first,points_second,points_third,points_other,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).bind(id,eventId,name,Number(start),Number(end),points.first,points.second,points.third,
      points.other,c.get('userId')).run();
    return c.json({ok:true,id},201);
  }catch(e){return fail(c,e);}
});
club.get('/events/:id/seasons/:seasonId/standings',authMiddleware,async c=>{
  if(!on(c.env))return unavailable(c);
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Forbidden'},403);
  try{
    const season=await c.env.DB.prepare(
      'SELECT * FROM room_league_seasons WHERE id=? AND event_id=?'
    ).bind(c.req.param('seasonId'),eventId).first<SeasonRow>();
    if(!season)return c.json({error:'Season not found'},404);
    const [settled,members]=await Promise.all([
      c.env.DB.prepare(
        'SELECT gp.game_id,gp.user_id,gp.display_name,gp.net,gp.settled_at,g.scheduled_at '+
        'FROM game_players gp JOIN games g ON g.id=gp.game_id '+
        "WHERE g.event_id=? AND g.status='settled' AND gp.net IS NOT NULL "+
        'AND g.scheduled_at>=? AND g.scheduled_at<? '+
        'ORDER BY g.scheduled_at,g.id,gp.user_id'
      ).bind(eventId,season.starts_at,season.ends_at).all<SettledPlayerRow>(),
      c.env.DB.prepare(
        'SELECT em.user_id,u.name AS display_name FROM event_members em JOIN users u ON u.id=em.user_id '+
        'WHERE em.event_id=?'
      ).bind(eventId).all<{user_id:string;display_name:string}>(),
    ]);
    const recognised=new Set(members.results.map(x=>x.user_id));
    const resolved=resolvePlayerLeaderboard(settled.results,recognised,members.results);
    const points:LeaguePoints={
      first:season.points_first,second:season.points_second,
      third:season.points_third,other:season.points_other,
    };
    const scoring=scoreSeasonRows(settled.results,points);
    const standings=resolved.leaders.map(player=>{
      const scores=player.source_game_players.map(ref=>scoring.scoreOf(ref.game_id,ref.user_id));
      if(scores.some(x=>!x))throw new Error('Incomplete season scoring');
      return {user_id:player.user_id,display_name:player.display_name,
        points:scores.reduce((sum,x)=>sum+(x?.score||0),0),
        games_played:player.games_played,first_places:scores.filter(x=>x?.place===1).length,
        podiums:scores.filter(x=>x&&x.place<=3).length,
        identity_review_required:!!player.identity_review_required,
      };
    }).sort((a,b)=>b.points-a.points||b.first_places-a.first_places||
      b.games_played-a.games_played||a.display_name.localeCompare(b.display_name));
    c.header('Cache-Control','private, no-store');
    return c.json({season,standings,settled_games:scoring.countedGames,
      basis:'Saved settled game net results, competition ranking for ties; one points award per game.'});
  }catch(e){return fail(c,e);}
});
export default club;
