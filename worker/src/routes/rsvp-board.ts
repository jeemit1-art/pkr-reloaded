// Shareable poker-night RSVP board. This is NOT a WhatsApp bot: WhatsApp
// transports the link; RSVP choices and live status are hosted by PKR.
// v2 is feature-gated until the additive migration is verified on staging.
import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';
import { sendPushToModerators } from '../push';

const board = new Hono<{Bindings:Env}>();
const DEFAULT_TIMES = ['19:00','20:00','21:00'];

interface RsvpGame {
  id:string; event_id:string; scheduled_at:number;
  location:string|null; seats:number; status:string;
  event_name?:string|null;
}
interface Guest {
  id:string;display_name:string;status:'yes'|'maybe'|'no';arrival_option:string;
  seat_number:number|null;created_at:number;updated_at:number;choice_value?:string|null;
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
type RsvpAnswerStatus='yes'|'maybe'|'no';
type RsvpAnswerChoice={value:string;label:string;status:RsvpAnswerStatus};
const BASE_ANSWERS:ReadonlyArray<RsvpAnswerChoice>=[
  {value:'late',label:'Running late',status:'yes'},
  {value:'maybe',label:'Maybe',status:'maybe'},
  {value:'not-coming',label:'Not coming',status:'no'},
];
function normaliseAnswers(value:unknown):RsvpAnswerChoice[]|null{
  if(!Array.isArray(value)||value.length<3||value.length>8)return null;
  const choices:RsvpAnswerChoice[]=[];
  const values=new Set<string>(),labels=new Set<string>();
  for(const item of value){
    if(!item||typeof item!=='object'||Array.isArray(item))return null;
    const raw=item as Record<string,unknown>;
    const key=typeof raw.value==='string'?raw.value:'';
    const label=typeof raw.label==='string'?raw.label.trim().replace(/\s+/g,' '):'';
    const status=raw.status;
    if(!/^(late|maybe|not-coming|custom-[a-z0-9]{8,32})$/.test(key)||
       !['yes','maybe','no'].includes(String(status))||
       label.length<2||label.length>40||/[<>\u0000-\u001f\u007f]/.test(label))return null;
    const preset=BASE_ANSWERS.find(reply=>reply.value===key);
    if(preset&&preset.status!==status)return null;
    if(values.has(key)||labels.has(label.toLocaleLowerCase()))return null;
    values.add(key);labels.add(label.toLocaleLowerCase());
    choices.push({value:key,label,status:status as RsvpAnswerStatus});
  }
  if(BASE_ANSWERS.some(reply=>!values.has(reply.value)))return null;
  return choices;
}
function decodeSettings(value:unknown):{times:string[];answers:RsvpAnswerChoice[]}{
  let parsed:unknown;
  try{parsed=JSON.parse(String(value));}catch{return {times:DEFAULT_TIMES,answers:[...BASE_ANSWERS]};}
  if(Array.isArray(parsed))return {
    times:normaliseTimes(parsed)||DEFAULT_TIMES,answers:[...BASE_ANSWERS],
  };
  const object=parsed&&typeof parsed==='object'?parsed as Record<string,unknown>:{};
  return {
    times:normaliseTimes(object.times)||DEFAULT_TIMES,
    answers:normaliseAnswers(object.answers)||[...BASE_ANSWERS],
  };
}
function rsvpMessage(name:string,status:RsvpAnswerStatus,label:string,seat:number|null):string{
  const action=status==='no'?' is not coming':status==='maybe'?' might attend':' is coming';
  return name+action+' · '+label+(seat?' · Seat '+seat:'')+'.';
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
board.get('/games/:id/rsvp-board',authMiddleware,async(c)=>{
  if(!flagOn(c.env))return notReady(c);
  const game=await gameFor(c.env,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'member'))return c.json({error:'Group membership required'},403);
  try {
    const [settings,guests,legacy,players]=await Promise.all([
      c.env.DB.prepare('SELECT options_json FROM game_rsvp_arrivals WHERE game_id=?')
        .bind(game.id).first<{options_json:string}>(),
      c.env.DB.prepare(
        'SELECT id,display_name,status,arrival_option,choice_value,seat_number,updated_at,created_at FROM game_rsvp_guests WHERE game_id=? ORDER BY created_at ASC'
      ).bind(game.id).all<Guest>(),
      c.env.DB.prepare('SELECT id,display_name,status,created_at FROM game_rsvps WHERE game_id=? ORDER BY created_at ASC')
        .bind(game.id).all<{id:string;display_name:string;status:string;created_at:number}>(),
      c.env.DB.prepare(
        'SELECT display_name,seat_number FROM game_players WHERE game_id=? AND seat_number IS NOT NULL ORDER BY seat_number ASC'
      ).bind(game.id).all<{display_name:string;seat_number:number}>(),
    ]);
    const config=decodeSettings(settings?.options_json||'');
    const list=guests.results.map(row=>{
      const choice=row.choice_value||row.arrival_option;
      const reply=config.answers.find(x=>x.value===choice);
      const status=reply?.status||row.status;
      return {...publicGuest(row),arrival_option:choice,status,
        seat_number:status==='yes'?row.seat_number:null};
    });
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
      options:config.times,
      responses:config.answers,
      guests:list,players:players.results,
      version:Math.max(0,...list.map(x=>Number(x.updated_at)||0)),
    });
  }catch(e){return failed(c,e);}
});

/** Host-managed choices: 1-8 arrival times plus editable, typed replies.
 * The same JSON column supports old time-only arrays without a DB migration.
 * The three legacy keys stay stable so existing iPhone installs still work.
 */
board.put('/games/:id/rsvp-arrivals',authMiddleware,async(c)=>{
  if(!flagOn(c.env))return notReady(c);
  const game=await gameFor(c.env,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'cohost'))
    return c.json({error:'Only a host or co-host can change RSVP choices'},403);
  if(closed(game))return c.json({error:'RSVP choices are locked after game start'},409);
  const body=await c.req.json().catch(()=>null) as {options?:unknown;responses?:unknown}|null;
  const options=normaliseTimes(body?.options);
  if(!options)return c.json({error:'Set 1–8 unique arrival times in HH:MM format'},400);
  try{
    const existing=await c.env.DB.prepare('SELECT options_json FROM game_rsvp_arrivals WHERE game_id=?')
      .bind(game.id).first<{options_json:string}>();
    const previous=decodeSettings(existing?.options_json||'');
    // The old frontend only sends "options". Do not erase custom replies
    // when a player or host is running a cached, older PWA build.
    const responses=body?.responses===undefined?previous.answers:normaliseAnswers(body.responses);
    if(!responses)return c.json({error:'Set 3–8 unique replies (2–40 characters) with valid attendance types'},400);
    const used=await c.env.DB.prepare(
      'SELECT arrival_option,choice_value,status FROM game_rsvp_guests WHERE game_id=?'
    ).bind(game.id).all<{arrival_option:string;choice_value:string|null;status:string}>();
    for(const row of used.results){
      const chosen=row.choice_value||row.arrival_option;
      const previousResponse=previous.answers.find(answer=>answer.value===chosen);
      const beforeStatus=previousResponse?.status||row.status;
      if(options.includes(chosen)&&beforeStatus==='yes')continue;
      const candidate=responses.find(answer=>answer.value===chosen);
      if(!candidate||candidate.status!==beforeStatus)
        return conflict(c,'A player has already selected that option. Keep its attendance meaning or ask them to change their RSVP first.');
    }
    await c.env.DB.prepare(
      'INSERT INTO game_rsvp_arrivals(game_id,options_json,updated_at) VALUES(?,?,unixepoch()) '+
      'ON CONFLICT(game_id) DO UPDATE SET options_json=excluded.options_json,updated_at=unixepoch()'
    ).bind(game.id,JSON.stringify({times:options,answers:responses})).run();
    return c.json({ok:true,options,responses});
  }catch(e){return failed(c,e);}
});

/** A guest can create a response once and then edit ONLY with their edit token. */
board.post('/games/:id/rsvp-board',authMiddleware,async(c)=>{
  if(!flagOn(c.env))return notReady(c);
  const game=await gameFor(c.env,c.req.param('id'));
  if(!game)return c.json({error:'Game not found'},404);
  if(!await requireEventRole(c,game.event_id,'member'))return c.json({error:'Group membership required'},403);
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
  const token=typeof body?.edit_token==='string'?body.edit_token:'';
  if(token&&!/^[a-f0-9]{64}$/.test(token))
    return c.json({error:'This RSVP edit key is invalid'},401);
  try {
    const settings=await c.env.DB.prepare('SELECT options_json FROM game_rsvp_arrivals WHERE game_id=?')
      .bind(game.id).first<{options_json:string}>();
    const config=decodeSettings(settings?.options_json||'');
    const response=config.answers.find(answer=>answer.value===arrival);
    if(!config.times.includes(arrival)&&!response)
      return c.json({error:'Choose an RSVP option provided by the host'},400);
    const status:RsvpAnswerStatus=response?.status||'yes';
    if(status!=='yes')seat=null;
    // The original D1 table enforces yes/no and requires "not-coming" for no.
    // Keep those financial/seating-safe constraints and store the actual
    // custom choice in an additive column for accurate Maybe/Out projection.
    const storedStatus=status==='yes'?'yes':'no';
    const storedArrival=status==='yes'?arrival:'not-coming';
    const selectionLabel=response?.label||arrival;

    if(token){
      const hash=await digest(token);
      const current=await c.env.DB.prepare(
        'SELECT id FROM game_rsvp_guests WHERE game_id=? AND edit_token_hash=?'
      ).bind(game.id,hash).first<{id:string}>();
      if(!current)return c.json({error:'Only the person who created this RSVP can edit it on this device'},403);
      try {
        const updated=await c.env.DB.prepare(
          "UPDATE game_rsvp_guests SET display_name=?,status=?,arrival_option=?,choice_value=?,seat_number=?,updated_at=unixepoch() WHERE id=? AND game_id=? AND edit_token_hash=? AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM game_players WHERE game_id=? AND seat_number=?)) AND EXISTS(SELECT 1 FROM games WHERE id=? AND status IN ('scheduled','lobby'))"
        ).bind(name,storedStatus,storedArrival,arrival,seat,current.id,game.id,hash,seat,game.id,seat,game.id).run();
        if(!updated.meta.changes)return conflict(c);
      }catch{return conflict(c);}
    }else{
      const count=await c.env.DB.prepare('SELECT COUNT(*) AS total FROM game_rsvp_guests WHERE game_id=?')
        .bind(game.id).first<{total:number}>();
      if((count?.total||0)>=80)return c.json({error:'RSVP capacity reached; contact the host'},429);
      const key=secret(),hash=await digest(key),id=generateId();
      try {
        const inserted=await c.env.DB.prepare(
          "INSERT INTO game_rsvp_guests(id,game_id,display_name,status,arrival_option,choice_value,seat_number,edit_token_hash) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM game_players WHERE game_id=? AND seat_number=? AND ? IS NOT NULL) AND EXISTS(SELECT 1 FROM games WHERE id=? AND status IN ('scheduled','lobby')) AND NOT EXISTS(SELECT 1 FROM game_rsvps WHERE game_id=? AND display_name=? COLLATE NOCASE)"
        ).bind(id,game.id,name,storedStatus,storedArrival,arrival,seat,hash,game.id,seat,seat,game.id,game.id,name).run();
        if(!inserted.meta.changes)return conflict(c);
      }catch{return conflict(c);}
      c.header('Cache-Control','no-store');
      // Push is opt-in, event-scoped and already disabled by the push module in staging.
      try{c.executionCtx.waitUntil(sendPushToModerators(c.env,game.event_id,{
        title:'RSVP: '+name+' — '+(game.event_name||'Poker night'),
        body:rsvpMessage(name,status,selectionLabel,seat)+' Open the RSVP board.',
        data:{type:'rsvp_changed',eventId:game.event_id,gameId:game.id,url:'/games/'+game.id+'/rsvp'},
      }));}catch{/* Locally mocked request contexts need not supply waitUntil. */}
      return c.json({ok:true,id,edit_token:key,status,arrival_option:arrival,seat_number:seat},201);
    }
    try{c.executionCtx.waitUntil(sendPushToModerators(c.env,game.event_id,{
      title:'RSVP changed: '+name,
      body:rsvpMessage(name,status,selectionLabel,seat)+' Check '+(game.event_name||'your game')+' RSVP board.',
      data:{type:'rsvp_changed',eventId:game.event_id,gameId:game.id,url:'/games/'+game.id+'/rsvp'},
    }));}catch{}
    c.header('Cache-Control','no-store');
    return c.json({ok:true,status,arrival_option:arrival,seat_number:seat});
  }catch(e){return failed(c,e);}
});
export default board;
