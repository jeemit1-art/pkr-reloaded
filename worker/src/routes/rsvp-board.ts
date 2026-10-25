// Shareable poker-night RSVP board. This is NOT a WhatsApp bot: WhatsApp
// transports the link; RSVP choices and live status are hosted by PKR.
// v2 is feature-gated until the additive migration is verified on staging.
import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';
import { sendPushToEvent } from '../push';

const board = new Hono<{Bindings:Env}>();
const DEFAULT_TIMES = ['19:00','20:00','21:00'];

interface RsvpGame {
  id:string; event_id:string; scheduled_at:number;
  location:string|null; seats:number; status:string;
  event_name?:string|null;
}
interface Guest {
  id:string;display_name:string;status:'yes'|'no';arrival_option:string;
  seat_number:number|null;created_at:number;updated_at:number;
}
function flagOn(env:Env) { return env.PKR_RSVP_V2 === '1'; }
function notReady(c:any) {
  return c.json({error:'The live RSVP board is not enabled on this database yet.',
    code:'RSVP_BOARD_NOT_READY'},503);
}
function normaliseTimes(value:unknown):string[]|null {
  if(!Array.isArray(value)||value.length<1||value.length>8)return null;
  const times = value.map(v=>typeof v==='string'?v.trim():'');
  if(times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))return null;
  if(new Set(times).size!==times.length)return null;
  return [...times].sort();
}
function decodeTimes(value:unknown):string[] {
  try {const parsed=JSON.parse(String(value));return normaliseTimes(parsed)||DEFAULT_TIMES;}
  catch {return DEFAULT_TIMES;}
}
async function digest(value:string):Promise<string> {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('');
}
function secret():string {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(n=>n.toString(16).padStart(2,'0')).join('');
}
function publicGuest(r:Guest) {
  return {id:r.id,display_name:r.display_name,status:r.status,
    arrival_option:r.arrival_option,seat_number:r.seat_number,updated_at:r.updated_at};
}
async function gameFor(env:Env,id:string):Promise<RsvpGame|null> {
  return env.DB.prepare(
    'SELECT g.id,g.event_id,g.scheduled_at,g.location,g.seats,g.status,e.name AS event_name FROM games g JOIN events e ON e.id=g.event_id WHERE g.id=?'
  ).bind(id).first<RsvpGame>();
}
function closed(game:RsvpGame) {
  return game.status !== 'scheduled' && game.status !== 'lobby';
}
function conflict(c:any,msg='That seat or player name has just been taken. Refresh and choose again.') {
  return c.json({error:msg,code:'RSVP_CONFLICT'},409);
}
function failed(c:any,e:unknown) {
  console.error('RSVP board database operation failed',e);
  return c.json({error:'The RSVP board could not complete this request.',code:'RSVP_BOARD_UNAVAILABLE'},503);
}

/** Safe public projection: never reveal edit token hashes or contact data. */
board.get('/games/:id/rsvp-board',async(c)=>{
  if(!flagOn(c.env))return notReady(c);
  const game=await gameFor(c.env,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  try {
    const [settings,guests,legacy,players]=await Promise.all([
      c.env.DB.prepare('SELECT options_json FROM game_rsvp_arrivals WHERE game_id=?')
        .bind(game.id).first<{options_json:string}>(),
      c.env.DB.prepare(
        'SELECT id,display_name,status,arrival_option,seat_number,updated_at,created_at FROM game_rsvp_guests WHERE game_id=? ORDER BY created_at ASC'
      ).bind(game.id).all<Guest>(),
      c.env.DB.prepare('SELECT id,display_name,status,created_at FROM game_rsvps WHERE game_id=? ORDER BY created_at ASC')
        .bind(game.id).all<{id:string;display_name:string;status:string;created_at:number}>(),
      c.env.DB.prepare(
        'SELECT display_name,seat_number FROM game_players WHERE game_id=? AND seat_number IS NOT NULL ORDER BY seat_number ASC'
      ).bind(game.id).all<{display_name:string;seat_number:number}>(),
    ]);
    const list=guests.results.map(publicGuest);
    const names=new Set(list.map(x=>x.display_name.toLocaleLowerCase()));
    for(const row of legacy.results){
      if(!names.has(row.display_name.toLocaleLowerCase()))
        list.push({id:row.id,display_name:row.display_name,status:row.status as any,
          arrival_option:'',seat_number:null,updated_at:row.created_at});
    }
    c.header('Cache-Control','no-store, private');
    return c.json({
      game:{id:game.id,scheduled_at:game.scheduled_at,location:game.location,
        seats:game.seats,status:game.status},
      event:{id:game.event_id,name:game.event_name||'Poker night'},
      options:decodeTimes(settings?.options_json||''),
      guests:list,players:players.results,
      version:Math.max(0,...list.map(x=>Number(x.updated_at)||0)),
    });
  }catch(e){return failed(c,e);}
});

/** Host-managed arrival choices: 24-hour HH:MM strings, up to eight. */
board.put('/games/:id/rsvp-arrivals',authMiddleware,async(c)=>{
  if(!flagOn(c.env))return notReady(c);
  const game=await gameFor(c.env,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'cohost'))
    return c.json({error:'Only a host or co-host can change arrival choices'},403);
  if(closed(game))return c.json({error:'Arrival choices are locked after game start'},409);
  const body=await c.req.json().catch(()=>null) as {options?:unknown}|null;
  const options=normaliseTimes(body?.options);
  if(!options)return c.json({error:'Set 1–8 unique arrival times in HH:MM format'},400);
  try {
    // Do not silently remove an option already selected by a guest.
    const used=await c.env.DB.prepare(
      "SELECT arrival_option FROM game_rsvp_guests WHERE game_id=? AND status='yes' AND arrival_option NOT IN ('late')"
    ).bind(game.id).all<{arrival_option:string}>();
    if(used.results.some(r=>!options.includes(r.arrival_option)))
      return conflict(c,'Someone has already selected one of those times. Keep it available or ask them to change their RSVP.');
    await c.env.DB.prepare(
      'INSERT INTO game_rsvp_arrivals(game_id,options_json,updated_at) VALUES(?,?,unixepoch()) '+
      'ON CONFLICT(game_id) DO UPDATE SET options_json=excluded.options_json,updated_at=unixepoch()'
    ).bind(game.id,JSON.stringify(options)).run();
    return c.json({ok:true,options});
  }catch(e){return failed(c,e);}
});

/** A guest can create a response once and then edit ONLY with their edit token. */
board.post('/games/:id/rsvp-board',async(c)=>{
  if(!flagOn(c.env))return notReady(c);
  const game=await gameFor(c.env,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(closed(game))return c.json({error:'RSVPs are closed for this game'},409);
  const body=await c.req.json().catch(()=>null) as {
    display_name?:unknown; arrival_option?:unknown; seat_number?:unknown;
    edit_token?:unknown;
  }|null;
  const name=typeof body?.display_name==='string'?body.display_name.trim():'';
  if(name.length<2||name.length>60||/[\u0000-\u001f<>]/.test(name))
    return c.json({error:'Enter a player name between 2 and 60 characters'},400);
  const arrival=typeof body?.arrival_option==='string'?body.arrival_option:'';
  let seat:number|null=body?.seat_number===null||body?.seat_number===undefined?null:Number(body?.seat_number);
  if(seat!==null&&(!Number.isSafeInteger(seat)||seat<1||seat>game.seats))
    return c.json({error:'Choose a valid seat or leave it unassigned'},400);
  const status=arrival==='not-coming'?'no':'yes';
  if(status==='no')seat=null;
  const token=typeof body?.edit_token==='string'?body.edit_token:'';
  if(token&&!/^[a-f0-9]{64}$/.test(token))
    return c.json({error:'This RSVP edit key is invalid'},401);
  try {
    const settings=await c.env.DB.prepare('SELECT options_json FROM game_rsvp_arrivals WHERE game_id=?')
      .bind(game.id).first<{options_json:string}>();
    const options=decodeTimes(settings?.options_json||'');
    if(!options.includes(arrival)&&arrival!=='late'&&arrival!=='not-coming')
      return c.json({error:'Choose an arrival option provided by the host'},400);

    if(token){
      const hash=await digest(token);
      const current=await c.env.DB.prepare(
        'SELECT id FROM game_rsvp_guests WHERE game_id=? AND edit_token_hash=?'
      ).bind(game.id,hash).first<{id:string}>();
      if(!current)return c.json({error:'Only the person who created this RSVP can edit it on this device'},403);
      try {
        const updated=await c.env.DB.prepare(
          "UPDATE game_rsvp_guests SET display_name=?,status=?,arrival_option=?,seat_number=?,updated_at=unixepoch() WHERE id=? AND game_id=? AND edit_token_hash=? AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM game_players WHERE game_id=? AND seat_number=?)) AND EXISTS(SELECT 1 FROM games WHERE id=? AND status IN ('scheduled','lobby'))"
        ).bind(name,status,arrival,seat,current.id,game.id,hash,seat,game.id,seat,game.id).run();
        if(!updated.meta.changes)return conflict(c);
      }catch{return conflict(c);}
    }else{
      const count=await c.env.DB.prepare('SELECT COUNT(*) AS total FROM game_rsvp_guests WHERE game_id=?')
        .bind(game.id).first<{total:number}>();
      if((count?.total||0)>=80)return c.json({error:'RSVP capacity reached; contact the host'},429);
      const key=secret(),hash=await digest(key),id=generateId();
      try {
        const inserted=await c.env.DB.prepare(
          "INSERT INTO game_rsvp_guests(id,game_id,display_name,status,arrival_option,seat_number,edit_token_hash) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM game_players WHERE game_id=? AND seat_number=? AND ? IS NOT NULL) AND EXISTS(SELECT 1 FROM games WHERE id=? AND status IN ('scheduled','lobby')) AND NOT EXISTS(SELECT 1 FROM game_rsvps WHERE game_id=? AND display_name=? COLLATE NOCASE)"
        ).bind(id,game.id,name,status,arrival,seat,hash,game.id,seat,seat,game.id,game.id,name).run();
        if(!inserted.meta.changes)return conflict(c);
      }catch{return conflict(c);}
      c.header('Cache-Control','no-store');
      // Push is opt-in, event-scoped and already disabled by the push module in staging.
      try{c.executionCtx.waitUntil(sendPushToEvent(c.env,game.event_id,{
        title:'Poker night RSVP updated',body:name+' · '+(status==='no'?'Not coming':arrival==='late'?'Late':arrival),
        data:{url:'/games/'+game.id+'/rsvp'},
      }));}catch{/* Locally mocked request contexts need not supply waitUntil. */}
      return c.json({ok:true,id,edit_token:key,status,arrival_option:arrival,seat_number:seat},201);
    }
    try{c.executionCtx.waitUntil(sendPushToEvent(c.env,game.event_id,{
      title:'Poker night RSVP updated',body:name+' updated their arrival',
      data:{url:'/games/'+game.id+'/rsvp'},
    }));}catch{}
    c.header('Cache-Control','no-store');
    return c.json({ok:true,status,arrival_option:arrival,seat_number:seat});
  }catch(e){return failed(c,e);}
});
export default board;
