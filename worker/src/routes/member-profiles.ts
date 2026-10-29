import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole } from '../middleware';
import {normalizeMobile,encryptPhone,decryptPhone} from '../phone-security';

// These profiles belong to one room only. Names/avatars never rewrite a
// recorded game, leaderboard identity or settlement amount.
const profiles = new Hono<{Bindings:Env}>();
const PRESETS=['♠️','♥️','♣️','♦️','🃏','😎','👑','🎲','🐯','🦊','🐻','🦁','🐼','🔥','⭐','🎯'];
type SavedProfile={
  profile_key:string;screen_name:string|null;avatar_data:string|null;
  avatar_emoji:string|null;phone_cipher:string|null;preferred_contact:string;
  private_notes:string|null;updated_at:number;
};
const safeString=(value:unknown)=>typeof value==='string'?value.trim():'';
const validText=(value:string,max:number)=>value.length<=max&&!/[\x00-\x1F\x7F]/.test(value);

function normalisePhone(value:unknown):string|null{
  const input=safeString(value);
  if(!input)return null;
  // Reuse PKR's E.164 and Australian-mobile validation for invitations.
  const phone=normalizeMobile(input);
  if(!phone)throw new Error('Enter a valid mobile number (e.g. 0412 345 678 or +61412345678).');
  return phone;
}
function photoFrom(value:unknown):string|null{
  if(value==null||value==='')return null;
  if(typeof value!=='string'||value.length>48000||
    !/^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw new Error('Avatar must be a small JPEG or WebP image selected in PKR (up to 35 KB).');
  return value;
}
function keyType(key:string):'member'|'history'|null{
  if(key.startsWith('member:')&&/^member:[A-Za-z0-9_-]{1,100}$/.test(key))return 'member';
  if(key.startsWith('history:')&&validText(key,130)&&key.length>9&&
    !key.includes('/')&&!key.includes('\\')&&!key.includes('<')&&!key.includes('>')&&key.slice(8)===key.slice(8).trim().toLocaleLowerCase())return 'history';
  return null;
}
async function existingProfile(db:D1Database,eventId:string,key:string){
  return db.prepare('SELECT * FROM room_player_profiles WHERE event_id=? AND profile_key=?')
    .bind(eventId,key).first<SavedProfile>();
}

profiles.get('/:id/profiles',authMiddleware,async c=>{
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Forbidden'},403);
  const manager=await requireEventRole(c,eventId,'cohost');
  const userId=c.get('userId');
  try{
    const result=await c.env.DB.prepare(
      'SELECT profile_key,screen_name,avatar_data,avatar_emoji,phone_cipher,preferred_contact,private_notes,updated_at FROM room_player_profiles WHERE event_id=?'
    ).bind(eventId).all<SavedProfile>();
    const visible=await Promise.all(result.results.map(async p=>{
      const allowed=manager||p.profile_key==='member:'+userId;
      return {
        profile_key:p.profile_key,
        screen_name:p.screen_name,avatar_data:p.avatar_data,avatar_emoji:p.avatar_emoji,
        preferred_contact:allowed?p.preferred_contact:'none',
        phone:allowed&&p.phone_cipher?await decryptPhone(c.env,p.phone_cipher):null,
        private_notes:manager?p.private_notes:null,updated_at:p.updated_at,
      };
    }));
    return c.json({profiles:visible});
  }catch{
    return c.json({error:'Room player profiles are not enabled yet. The database migration must be applied first.'},503);
  }
});

profiles.put('/:id/profiles',authMiddleware,async c=>{
  const eventId=c.req.param('id'),userId=c.get('userId');
  if(!await requireEventRole(c,eventId,'member'))return c.json({error:'Forbidden'},403);
  const manager=await requireEventRole(c,eventId,'cohost');
  const headerLength=Number(c.req.header('content-length')||0);
  if(headerLength>80000)return c.json({error:'Profile photo is too large'},413);
  const body=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body||typeof body!=='object')return c.json({error:'Valid profile details required'},400);
  const key=safeString(body.profile_key),kind=keyType(key);
  if(!kind)return c.json({error:'Invalid room player identity'},400);
  if(!manager&&key!=='member:'+userId)return c.json({error:'Only room hosts can edit another player profile'},403);
  if(kind==='member'){
    const m=await c.env.DB.prepare('SELECT 1 AS ok FROM event_members WHERE event_id=? AND user_id=?')
      .bind(eventId,key.slice(7)).first();
    if(!m)return c.json({error:'This person is not a member of the room'},404);
  }else{
    if(!manager)return c.json({error:'Only hosts can edit historical player profiles'},403);
    const historic=await c.env.DB.prepare(
      'SELECT 1 AS ok FROM game_players gp JOIN games g ON g.id=gp.game_id WHERE g.event_id=? AND LOWER(TRIM(gp.display_name))=? LIMIT 1'
    ).bind(eventId,key.slice(8)).first();
    if(!historic)return c.json({error:'This historical player was not found in this room'},404);
  }
  const screenName=safeString(body.screen_name);
  if(screenName&&(!validText(screenName,40)||screenName.length<2))
    return c.json({error:'Screen name must be 2–40 characters'},400);
  const notes=safeString(body.private_notes);
  if(manager&&!validText(notes,500))return c.json({error:'Private notes must be 500 characters or less'},400);
  const contact=safeString(body.preferred_contact)||'none';
  if(!['none','whatsapp','sms','email'].includes(contact))return c.json({error:'Invalid contact preference'},400);
  const emoji=safeString(body.avatar_emoji);
  if(emoji&&!PRESETS.includes(emoji))return c.json({error:'Select a PKR preset avatar'},400);
  let phone:string|null,avatar:string|null;
  try{phone=normalisePhone(body.phone);avatar=photoFrom(body.avatar_data);}
  catch(error){return c.json({error:(error as Error).message},400);}
  try{
    const existing=await existingProfile(c.env.DB,eventId,key);
    const finalNotes=manager?notes||null:existing?.private_notes||null;
    // Encrypt under the existing dedicated PKR_CONTACT_KEY before storage.
    // Never persist, index or log a raw mobile number in profile metadata.
    const phoneCipher=phone?await encryptPhone(c.env,phone):null;
    await c.env.DB.prepare(
      `INSERT INTO room_player_profiles(event_id,profile_key,screen_name,avatar_data,avatar_emoji,phone_cipher,preferred_contact,private_notes,updated_by)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(event_id,profile_key) DO UPDATE SET
        screen_name=excluded.screen_name,avatar_data=excluded.avatar_data,
        avatar_emoji=excluded.avatar_emoji,phone_cipher=excluded.phone_cipher,
        preferred_contact=excluded.preferred_contact,private_notes=excluded.private_notes,
        updated_by=excluded.updated_by,updated_at=unixepoch()`
    ).bind(eventId,key,screenName||null,avatar,emoji||null,phoneCipher,contact,finalNotes,userId).run();
    return c.json({ok:true,profile:{
      profile_key:key,screen_name:screenName||null,avatar_data:avatar,avatar_emoji:emoji||null,
      phone,preferred_contact:contact,private_notes:manager?finalNotes:null,updated_at:Math.floor(Date.now()/1000),
    }});
  }catch{
    return c.json({error:'Unable to save this profile. Check that the room profile migration has been applied.'},503);
  }
});
export default profiles;
