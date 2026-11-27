// Mobile-first private group directory; no phone directory is published globally.
// Private group contacts are encrypted. Hosts send individual personal links
// through WhatsApp manually; each request needs host approval (no messaging API).
import {Hono} from 'hono';
import type {Env} from '../types';
import {authMiddleware,generateId,requireEventRole} from '../middleware';
import {signJWT} from '../jwt';
import {sendPushToHosts} from '../push';
import {normalizeMobile,phoneLookup,encryptPhone,decryptPhone,randomToken,
  maskMobile,phoneMembersReady} from '../phone-security';

const router=new Hono<{Bindings:Env}>();
type Contact={id:string;event_id:string;display_name:string;phone_cipher:string;phone_lookup:string;user_id:string|null};
type Invite={id:string;event_id:string;contact_id:string;display_name:string;phone_cipher:string;
  role:string;expires_at:number;consumed_at:number|null;sent_count:number;last_sent_at:number|null;verify_count:number; event_name:string};

function unavailable(c:any){return c.json({
  error:'Private mobile membership is not activated yet.',
  code:'PHONE_MEMBERS_NOT_READY'
},503);}
function failed(c:any){return c.json({error:'Private mobile membership service is temporarily unavailable.'},503);}
async function getInvite(env:Env,token:string):Promise<Invite|null>{
  if(!/^[0-9a-f]{64}$/.test(token))return null;
  const hash=await phoneLookup(env,'invite',token);
  return env.DB.prepare(
    'SELECT i.*,c.display_name,c.phone_cipher,e.name AS event_name FROM group_phone_invites i JOIN group_phone_contacts c ON c.id=i.contact_id AND c.event_id=i.event_id JOIN events e ON e.id=i.event_id WHERE i.token_hash=? AND i.consumed_at IS NULL AND i.expires_at>unixepoch()'
  ).bind(hash).first<Invite>();
}
type JoinState={event_id:string;invite_id:string;contact_id:string;role:string;display_name:string;claim_hash:string;requested_at:number;approved_at?:number;purpose?:'join'|'recovery'|'rejoin'};
type CurrentInvite={id:string;contact_id:string;role:string;expires_at:number};
const requestPrefix=(eventId:string)=>'join-request:'+eventId+':';
function readState(raw:string|null):JoinState|null{
  if(!raw)return null;
  try{
    const r=JSON.parse(raw);
    return r&&typeof r.event_id==='string'&&typeof r.contact_id==='string'&&typeof r.invite_id==='string'&&typeof r.claim_hash==='string'?r:null;
  }catch{return null;}
}
async function listKeys(env:Env,prefix:string){
  const keys:Array<{name:string}>=[];
  let cursor:string|undefined;
  // Each room is capped at 100 pending requests. Support paginated KV
  // responses, including legacy approved-join entries.
  for(let page=0;page<20;page++){
    const result=await env.KV.list({prefix,...(cursor?{cursor}:{})});
    keys.push(...result.keys);
    if(result.list_complete||!('cursor' in result)||!result.cursor)break;
    cursor=result.cursor;
  }
  return keys;
}
async function currentInvites(env:Env,eventId:string){
  const rows=await env.DB.prepare(
    'SELECT id,contact_id,role,expires_at FROM group_phone_invites WHERE event_id=? AND consumed_at IS NULL AND expires_at>unixepoch()'
  ).bind(eventId).all<CurrentInvite>();
  return new Map(rows.results.map(r=>[r.id,r]));
}
function validState(state:JoinState|null,eventId:string,invites:Map<string,CurrentInvite>):state is JoinState{
  return !!state&&state.event_id===eventId&&invites.get(state.invite_id)?.contact_id===state.contact_id;
}
async function approvedRequests(env:Env,eventId:string,invites:Map<string,CurrentInvite>){
  const result=new Map<string,JoinState>();
  // An old contact index is not authority for a new invitation. Verify the
  // claim and its exact, still-live invite ID before using it.
  await Promise.all([...invites.values()].map(async i=>{
    const pointer=readState(await env.KV.get('approved-contact:'+eventId+':'+i.contact_id));
    if(validState(pointer,eventId,invites)&&pointer.invite_id===i.id){
      const approved=readState(await env.KV.get('approved-join:'+pointer.claim_hash));
      if(validState(approved,eventId,invites)&&approved.invite_id===i.id)result.set(i.id,approved);
    }
  }));
  // Compatibility for outstanding approvals made by the previous Worker.
  // No name or mobile matching is performed.
  if(result.size<invites.size&&invites.size){
    const keys=await listKeys(env,'approved-join:');
    await Promise.all(keys.map(async k=>{
      const state=readState(await env.KV.get(k.name));
      if(validState(state,eventId,invites))result.set(state.invite_id,state);
    }));
  }
  return result;
}
async function pendingRequests(env:Env,eventId:string,invites:Map<string,CurrentInvite>,approved:Map<string,JoinState>){
  const keys=await listKeys(env,requestPrefix(eventId));
  const rows=await Promise.all(keys.map(async k=>{
    const state=readState(await env.KV.get(k.name));
    if(!validState(state,eventId,invites)||approved.has(state.invite_id))return null;
    if(k.name!==requestPrefix(eventId)+state.claim_hash)return null;
    if(await env.KV.get('rejected-join:'+state.claim_hash))return null;
    return {key:k.name,state};
  }));
  return rows.filter((r):r is {key:string;state:JoinState}=>r!==null);
}
async function claimInvite(env:Env,state:JoinState){
  return env.DB.prepare(
    'SELECT id,expires_at FROM group_phone_invites WHERE id=? AND event_id=? AND contact_id=? AND consumed_at IS NULL AND expires_at>unixepoch()'
  ).bind(state.invite_id,state.event_id,state.contact_id).first<{id:string;expires_at:number}>();
}
async function rememberClaim(env:Env,state:JoinState,status:string){
  await env.KV.put('join-claim:'+state.claim_hash,JSON.stringify({...state,status}),{expirationTtl:172800});
}
async function clearContactRequests(env:Env,eventId:string,contactId:string){
  // D1 revocation is authoritative; KV clean-up is best effort and the
  // read/decision routes independently reject all superseded invitations.
  try{
    const keys=await listKeys(env,requestPrefix(eventId));
    await Promise.all(keys.map(async k=>{
      const state=readState(await env.KV.get(k.name));
      if(state?.event_id===eventId&&state.contact_id===contactId){
        await rememberClaim(env,state,'revoked');
        await env.KV.delete(k.name);
      }
    }));
    await env.KV.delete('approved-contact:'+eventId+':'+contactId);
  }catch{}
}
function privateHeaders(c:any){
  c.header('Cache-Control','no-store, private');
  c.header('Referrer-Policy','no-referrer');
}
router.get('/events/:id/phone-contacts',authMiddleware,async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'host'))return c.json({error:'Only the group host may view private contacts'},403);
  try{
    const result=await c.env.DB.prepare(
      'SELECT id,event_id,display_name,phone_cipher,user_id,created_at FROM group_phone_contacts WHERE event_id=? ORDER BY display_name'
    ).bind(eventId).all<Contact & {created_at:number}>();
    const roomMemberships=await c.env.DB.prepare(
      'SELECT user_id FROM event_members WHERE event_id=?'
    ).bind(eventId).all<{user_id:string}>();
    const activeMemberIds=new Set(roomMemberships.results.map(m=>m.user_id));
    // Actual membership is authoritative, even during a fresh recovery.
    // An expired, consumed or replaced link can never produce a pending row.
    const invites=await currentInvites(c.env,eventId);
    const approved=await approvedRequests(c.env,eventId,invites);
    const pending=await pendingRequests(c.env,eventId,invites,approved);
    const pendingContactIds=new Set(pending.map(r=>r.state.contact_id));
    const approvedContactIds=new Set([...approved.values()].map(r=>r.contact_id));
    const openContacts=new Set([...invites.values()].map(r=>r.contact_id));
    const contacts=await Promise.all(result.results.map(async row=>{
      const joined=!!row.user_id&&activeMemberIds.has(row.user_id);
      const status=joined?'joined'
        :approvedContactIds.has(row.id)?'approved_awaiting_member'
        :pendingContactIds.has(row.id)?'awaiting_host_approval'
        :openContacts.has(row.id)?'invited'
        :row.user_id?'removed':'expired';
      return {id:row.id,display_name:row.display_name,
        phone:await decryptPhone(c.env,row.phone_cipher),
        user_id:row.user_id,status,returning:!!row.user_id&&!joined,created_at:row.created_at};
    }));
    privateHeaders(c);
    return c.json({contacts});
  }catch{return failed(c);}
});
router.post('/events/:id/phone-contacts',authMiddleware,async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  const eventId=c.req.param('id');
  if(!await requireEventRole(c,eventId,'host'))return c.json({error:'Only a group host can invite members'},403);
  const body=await c.req.json().catch(()=>null) as {phone?:unknown;display_name?:unknown;role?:unknown}|null;
  const mobile=normalizeMobile(body?.phone);
  const name=typeof body?.display_name==='string'?body.display_name.trim():'';
  if(!mobile||name.length<2||name.length>60||/[\u0000-\u001f<>]/.test(name))
    return c.json({error:'Enter a valid mobile number and player name (2–60 characters).'},400);
  const role=body?.role==='cohost'?'cohost':'member';
  try{
    const [lookup,cipher]=await Promise.all([phoneLookup(c.env,'group:'+eventId,mobile),encryptPhone(c.env,mobile)]);
    const id=generateId();
    await c.env.DB.prepare(
      'INSERT INTO group_phone_contacts(id,event_id,display_name,phone_lookup,phone_cipher) VALUES(?,?,?,?,?) '+
      'ON CONFLICT(event_id,phone_lookup) DO NOTHING'
    ).bind(id,eventId,name,lookup,cipher).run();
    const contact=await c.env.DB.prepare('SELECT id,user_id FROM group_phone_contacts WHERE event_id=? AND phone_lookup=?')
      .bind(eventId,lookup).first<{id:string;user_id:string|null}>();
    if(!contact)return failed(c);
    if(contact.user_id){
      const member=await c.env.DB.prepare('SELECT role FROM event_members WHERE event_id=? AND user_id=?')
        .bind(eventId,contact.user_id).first<{role:string}>();
      if(member)return c.json({error:'This player is already a member. Use Recover access if they have lost their sign-in.'},409);
      // A new host-issued invitation for a former member preserves their
      // original user ID. It must still be approved and redeemed.
    }else{
      await c.env.DB.prepare('UPDATE group_phone_contacts SET display_name=?,updated_at=unixepoch() WHERE event_id=? AND id=? AND user_id IS NULL')
        .bind(name,eventId,contact.id).run();
    }
    // Creating a fresh invitation revokes prior outstanding links for this contact.
    const token=randomToken(),tokenHash=await phoneLookup(c.env,'invite',token);
    const inviteId=generateId(),expires=Math.floor(Date.now()/1000)+48*3600;
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM group_phone_invites WHERE event_id=? AND contact_id=? AND consumed_at IS NULL')
        .bind(eventId,contact.id),
      c.env.DB.prepare('INSERT INTO group_phone_invites(id,event_id,contact_id,token_hash,role,expires_at) VALUES(?,?,?,?,?,?)')
        .bind(inviteId,eventId,contact.id,tokenHash,role,expires)
    ]);
    await clearContactRequests(c.env,eventId,contact.id);
    const url=c.env.FRONTEND_URL+'/phone-invite/'+token;
    const group=await c.env.DB.prepare('SELECT name FROM events WHERE id=?')
      .bind(eventId).first<{name:string}>();
    const message='Hi '+name+', I am inviting you to '+(group?.name||'our poker group')+
      ' on PKR. Open this one-time link and request to join; I will approve your request: '+url+
      '\nThis link expires in 48 hours.';
    privateHeaders(c);
    return c.json({ok:true,contact:{id:contact.id,display_name:name,phone:mobile,status:'invited',user_id:contact.user_id,returning:!!contact.user_id},
      invite:{url,expires_at:expires,role},whatsapp_url:'https://wa.me/'+mobile.slice(1)+'?text='+encodeURIComponent(message)},201);
  }catch{return failed(c);}
});
// A member may have accepted a different legitimate invitation before their
// private WhatsApp contact was created. A host can reconcile that contact to an
// EXISTING authorised room member without creating a user, granting any access,
// or relying on an unverified match of names/phone numbers.
router.post('/events/:id/phone-contacts/:contactId/link-member',authMiddleware,async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  const eventId=c.req.param('id'),contactId=c.req.param('contactId');
  if(!await requireEventRole(c,eventId,'host'))return c.json({error:'Host only'},403);
  const body=await c.req.json().catch(()=>null) as {user_id?:unknown}|null;
  const userId=typeof body?.user_id==='string'?body.user_id.trim():'';
  if(!userId||userId.length>128)return c.json({error:'Select an existing room member'},400);
  try{
    const contact=await c.env.DB.prepare(
      'SELECT id,user_id FROM group_phone_contacts WHERE event_id=? AND id=?'
    ).bind(eventId,contactId).first<{id:string;user_id:string|null}>();
    if(!contact)return c.json({error:'Contact not found in this room'},404);
    const member=await c.env.DB.prepare(
      'SELECT role FROM event_members WHERE event_id=? AND user_id=?'
    ).bind(eventId,userId).first<{role:string}>();
    if(!member)return c.json({error:'Player has not completed joining this room'},409);
    if(member.role==='host')return c.json({error:'Cannot link the room host as an invited player'},403);
    if(contact.user_id&&contact.user_id!==userId)
      return c.json({error:'This contact is already linked to a different account'},409);
    const elsewhere=await c.env.DB.prepare(
      'SELECT id FROM group_phone_contacts WHERE event_id=? AND user_id=? AND id!=?'
    ).bind(eventId,userId,contactId).first<{id:string}>();
    if(elsewhere)return c.json({error:'This account is already linked to another contact'},409);
    // D1 batch is transactional. Link the confirmed existing member and
    // revoke unused invitation links together, never leaving an open invite
    // that could create a second account for the same contact.
    const updates=[];
    if(!contact.user_id)updates.push(c.env.DB.prepare(
      'UPDATE group_phone_contacts SET user_id=?,updated_at=unixepoch() WHERE event_id=? AND id=? AND user_id IS NULL'
    ).bind(userId,eventId,contactId));
    updates.push(c.env.DB.prepare(
      'UPDATE group_phone_invites SET consumed_at=unixepoch() WHERE event_id=? AND contact_id=? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM group_phone_contacts WHERE event_id=? AND id=? AND user_id=?)'
    ).bind(eventId,contactId,eventId,contactId,userId));
    const results=await c.env.DB.batch(updates);
    if(!contact.user_id&&results[0].meta.changes!==1)
      return c.json({error:'Contact changed. Refresh and retry.'},409);
    await clearContactRequests(c.env,eventId,contactId);
    privateHeaders(c);
    return c.json({ok:true,status:'joined',user_id:userId});
  }catch{return failed(c);}
});
router.delete('/events/:id/phone-contacts/:contactId',authMiddleware,async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  const id=c.req.param('id'),contactId=c.req.param('contactId');
  if(!await requireEventRole(c,id,'host'))return c.json({error:'Only the group host can remove members'},403);
  try{
    const contact=await c.env.DB.prepare(
      'SELECT id,user_id FROM group_phone_contacts WHERE event_id=? AND id=?'
    ).bind(id,contactId).first<{id:string;user_id:string|null}>();
    if(!contact)return c.json({error:'Contact not found'},404);
    if(contact.user_id){
      const member=await c.env.DB.prepare('SELECT role FROM event_members WHERE event_id=? AND user_id=?')
        .bind(id,contact.user_id).first<{role:string}>();
      if(member?.role==='host')return c.json({error:'Cannot remove the group host'},403);
    }
    // Revoke links and access in one transaction. Keep the account mapping
    // for a genuine former member; never create another identity on rejoin.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM group_phone_invites WHERE event_id=? AND contact_id=?').bind(id,contactId),
      c.env.DB.prepare('DELETE FROM event_members WHERE event_id=? AND user_id=? AND role!=?')
        .bind(id,contact.user_id||'', 'host'),
      ...(!contact.user_id?[c.env.DB.prepare('DELETE FROM group_phone_contacts WHERE event_id=? AND id=? AND user_id IS NULL').bind(id,contactId)]:[])
    ]);
    await clearContactRequests(c.env,id,contactId);
    return c.json({ok:true});
  }catch{return failed(c);}
});
// Host-assisted account recovery never trusts a phone number alone. It requires
// a fresh private invitation, a separate join request and explicit host approval.
router.post('/events/:id/phone-contacts/:contactId/recovery',authMiddleware,async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  const eventId=c.req.param('id'),contactId=c.req.param('contactId');
  if(!await requireEventRole(c,eventId,'host'))return c.json({error:'Host only'},403);
  const contact=await c.env.DB.prepare(
    'SELECT id,display_name,phone_cipher,user_id FROM group_phone_contacts WHERE id=? AND event_id=?'
  ).bind(contactId,eventId).first<Contact>();
  if(!contact?.user_id)return c.json({error:'Only existing members can recover access'},409);
  const membership=await c.env.DB.prepare('SELECT role FROM event_members WHERE event_id=? AND user_id=?')
    .bind(eventId,contact.user_id).first<{role:string}>();
  if(!membership||membership.role==='host')
    return c.json({error:'This player does not currently have recoverable membership. Send a fresh rejoin invitation instead.'},409);
  const token=randomToken(),hash=await phoneLookup(c.env,'invite',token);
  const expiry=Math.floor(Date.now()/1000)+48*3600;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM group_phone_invites WHERE contact_id=? AND event_id=? AND consumed_at IS NULL').bind(contactId,eventId),
    c.env.DB.prepare('INSERT INTO group_phone_invites(id,event_id,contact_id,token_hash,role,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(generateId(),eventId,contactId,hash,membership.role,expiry)
  ]);
  await clearContactRequests(c.env,eventId,contactId);
  const phone=await decryptPhone(c.env,contact.phone_cipher);
  const url=c.env.FRONTEND_URL+'/phone-invite/'+token;
  privateHeaders(c);
  return c.json({ok:true,url,whatsapp_url:'https://wa.me/'+phone.slice(1)+'?text='+encodeURIComponent(
    'Your private PKR access recovery link: '+url+' — request host approval to finish.'),expires_at:expiry});
});
// Invitation link possession is NOT proof of phone ownership.
router.get('/phone-invites/:token',async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  try{
    const invite=await getInvite(c.env,c.req.param('token'));
    if(!invite)return c.json({error:'Invitation unavailable or expired.'},404);
    const mobile=await decryptPhone(c.env,invite.phone_cipher);
    privateHeaders(c);
    return c.json({event_name:invite.event_name,masked_phone:maskMobile(mobile),
      role:invite.role,expires_at:invite.expires_at,approval_required:true,delivery:'manual_whatsapp'});
  }catch{return failed(c);}
});
// All members join by a host-sent, one-time private invitation link plus
// explicit host approval. A forwarded link is NOT proof of phone ownership.
router.post('/phone-invites/:token/request-approval',async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  const invite=await getInvite(c.env,c.req.param('token')).catch(()=>null);
  if(!invite)return c.json({error:'Invitation expired or unavailable'},404);
  const body=await c.req.json().catch(()=>null) as {display_name?:unknown}|null;
  const name=typeof body?.display_name==='string'?body.display_name.trim():'';
  if(name.length<2||name.length>60||/[\u0000-\u001f<>]/.test(name))
    return c.json({error:'Enter the name the host will recognise'},400);
  // A fresh link, not a repeated tap, is required for another request.
  const rateKey='join-invite-rate:'+invite.id;
  const invites=await currentInvites(c.env,invite.event_id);
  if(!invites.has(invite.id))return c.json({error:'Invitation expired or unavailable'},409);
  const approved=await approvedRequests(c.env,invite.event_id,invites);
  const existing=await pendingRequests(c.env,invite.event_id,invites,approved);
  if(await c.env.KV.get(rateKey)||approved.has(invite.id)||existing.some(r=>r.state.invite_id===invite.id))
    return c.json({error:'A join request is already pending or approved for this invitation. Return to your original browser or ask the host for a fresh link.'},429);
  if(existing.length>=100)return c.json({error:'Too many pending requests'},429);
  const claim=randomToken(),hash=await phoneLookup(c.env,'claim',claim);
  const state:JoinState={event_id:invite.event_id,invite_id:invite.id,contact_id:invite.contact_id,
    role:invite.role,display_name:name,claim_hash:hash,requested_at:Date.now()};
  const ttl=Math.max(60,Math.min(172800,invite.expires_at-Math.floor(Date.now()/1000)));
  await rememberClaim(c.env,state,'pending');
  await c.env.KV.put(requestPrefix(invite.event_id)+hash,JSON.stringify(state),{expirationTtl:ttl});
  await c.env.KV.put(rateKey,'1',{expirationTtl:ttl});
  // An invite is only a request, not a membership. Notify the authorised
  // room host after writing the pending approval, never a name-only recipient.
  try {
    c.executionCtx.waitUntil(sendPushToHosts(c.env,invite.event_id,{
      title:'🔔 Approve player: '+name,
      body:name+' requested to join '+invite.event_name+'. Open Members to review and approve or reject.',
      data:{type:'join_request',eventId:invite.event_id,
        url:'/events/'+encodeURIComponent(invite.event_id)+'?tab=members&view=requests',
        notificationId:invite.id}
    }));
  } catch { /* Unit test request contexts do not provide waitUntil. */ }
  privateHeaders(c);
  return c.json({ok:true,claim,status:'pending',message:'The host must approve your request before you can join.'},202);
});
router.get('/events/:id/join-requests',authMiddleware,async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  const id=c.req.param('id');
  if(!await requireEventRole(c,id,'host'))return c.json({error:'Host only'},403);
  const invites=await currentInvites(c.env,id);
  const approved=await approvedRequests(c.env,id,invites);
  const pending=await pendingRequests(c.env,id,invites,approved);
  const requests=await Promise.all(pending.slice(0,100).map(async ({state:r})=>{
    const contact=await c.env.DB.prepare(
      'SELECT display_name,phone_cipher,user_id FROM group_phone_contacts WHERE id=? AND event_id=?'
    ).bind(r.contact_id,id).first<{display_name:string;phone_cipher:string;user_id:string|null}>();
    if(!contact)return null;
    const membership=contact.user_id?await c.env.DB.prepare('SELECT role FROM event_members WHERE event_id=? AND user_id=?')
      .bind(id,contact.user_id).first<{role:string}>():null;
    return {id:r.claim_hash,name:r.display_name,contact_id:r.contact_id,
      expected_member:contact.display_name,phone:maskMobile(await decryptPhone(c.env,contact.phone_cipher)),
      requested_at:r.requested_at,recovery:!!membership,rejoin:!!contact.user_id&&!membership};
  }));
  privateHeaders(c);
  return c.json({requests:requests.filter(Boolean)});
});
router.post('/events/:id/join-requests/:requestId/decision',authMiddleware,async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  const id=c.req.param('id'),key='join-request:'+id+':'+c.req.param('requestId');
  if(!await requireEventRole(c,id,'host'))return c.json({error:'Host only'},403);
  const body=await c.req.json().catch(()=>null) as {approve?:unknown}|null;
  if(typeof body?.approve!=='boolean')return c.json({error:'Select approve or reject'},400);
  const state=readState(await c.env.KV.get(key));
  if(!state||state.event_id!==id||key!==requestPrefix(id)+state.claim_hash)
    return c.json({error:'Request expired or already reviewed. Refresh approvals.'},404);
  const invite=await claimInvite(c.env,state);
  if(!invite){
    await rememberClaim(c.env,state,'revoked');
    await c.env.KV.delete(key);
    return c.json({error:'Original invitation expired or was replaced. Refresh approvals.'},409);
  }
  const invites=await currentInvites(c.env,id);
  const approved=await approvedRequests(c.env,id,invites);
  if(approved.has(state.invite_id)){
    if(approved.get(state.invite_id)?.claim_hash!==state.claim_hash)
      return c.json({error:'Another request for this invitation was already approved.'},409);
    return c.json({ok:true,approved:true,contact_id:state.contact_id});
  }
  const ttl=Math.max(60,Math.min(172800,invite.expires_at-Math.floor(Date.now()/1000)));
  if(body.approve){
    const decision={...state,approved_at:Date.now()};
    await c.env.KV.put('approved-join:'+state.claim_hash,JSON.stringify(decision),{expirationTtl:ttl});
    await c.env.KV.put('approved-contact:'+id+':'+state.contact_id,JSON.stringify(decision),{expirationTtl:ttl});
    await rememberClaim(c.env,state,'approved');
  }else{
    // A rejected personal link is terminal. The host must issue a new link.
    await c.env.DB.prepare('UPDATE group_phone_invites SET consumed_at=unixepoch() WHERE id=? AND event_id=? AND contact_id=? AND consumed_at IS NULL')
      .bind(state.invite_id,id,state.contact_id).run();
    await c.env.KV.put('rejected-join:'+state.claim_hash,'1',{expirationTtl:172800});
    await rememberClaim(c.env,state,'rejected');
  }
  await c.env.KV.delete(key);
  privateHeaders(c);
  return c.json({ok:true,approved:body.approve,contact_id:state.contact_id});
});
router.post('/phone-invites/complete-approval',async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  const body=await c.req.json().catch(()=>null) as {claim?:unknown;invite_token?:unknown}|null;
  const claim=typeof body?.claim==='string'?body.claim:'';
  if(!/^[a-f0-9]{64}$/.test(claim))return c.json({error:'Invalid request'},400);
  const hash=await phoneLookup(c.env,'claim',claim);
  const state=readState(await c.env.KV.get('approved-join:'+hash));
  if(!state){
    if(await c.env.KV.get('rejected-join:'+hash))
      return c.json({status:'rejected',error:'The host declined this request. Ask for a new invitation.'},403);
    const raw=await c.env.KV.get('join-claim:'+hash);
    const meta=readState(raw);
    if(meta&&raw){
      const status=JSON.parse(raw).status;
      if(status==='rejected')return c.json({status:'rejected',error:'The host declined this request. Ask for a new invitation.'},403);
      if(status==='redeemed'||status==='revoked'||!await claimInvite(c.env,meta))
        return c.json({status:'closed',error:'Invitation no longer valid or already redeemed. Open your existing account or ask the host for recovery.'},409);
    }
    // Old claims did not have a reverse index. The original link lets the
    // browser distinguish an expired/consumed invitation from a pending one.
    if(typeof body?.invite_token==='string'&&!await getInvite(c.env,body.invite_token))
      return c.json({status:'closed',error:'Invitation expired or already redeemed. Open your existing account or ask the host for recovery.'},409);
    return c.json({status:'pending'},202);
  }
  if(state.claim_hash!==hash)return c.json({error:'Invalid request'},400);
  const invite=await claimInvite(c.env,state);
  if(!invite)return c.json({error:'Invitation no longer valid'},409);
  const contact=await c.env.DB.prepare(
    'SELECT user_id FROM group_phone_contacts WHERE id=? AND event_id=?'
  ).bind(state.contact_id,state.event_id).first<{user_id:string|null}>();
  if(!contact)return c.json({error:'Invitation no longer valid'},409);
  const userId=contact.user_id||generateId();
  const account=contact.user_id?await c.env.DB.prepare('SELECT name,email FROM users WHERE id=?').bind(userId).first<{name:string;email:string}>():null;
  const name=account?.name||state.display_name;
  // Every statement is guarded by the same still-live invitation AND exact
  // contact identity. D1 serialises the batch. A racing second claimant or
  // revoked/replaced invitation cannot insert a user or membership.
  const liveGuard='EXISTS (SELECT 1 FROM group_phone_invites i JOIN group_phone_contacts c ON c.id=i.contact_id AND c.event_id=i.event_id WHERE i.id=? AND i.event_id=? AND i.contact_id=? AND i.consumed_at IS NULL AND i.expires_at>unixepoch() AND c.user_id IS ?)';
  const guardArgs=[state.invite_id,state.event_id,state.contact_id,contact.user_id];
  const writes=[];
  if(!contact.user_id)writes.push(c.env.DB.prepare(
    'INSERT INTO users(id,google_sub,email,name,plan,trial_started_at) SELECT ?,?,?,?,?,unixepoch() WHERE '+liveGuard
  ).bind(userId,'approval:'+generateId(),'',name,'trial',...guardArgs));
  // The existing role wins for recovery. A former member can only rejoin
  // after the host creates and approves a new invitation with that role.
  writes.push(c.env.DB.prepare(
    "INSERT INTO event_members(event_id,user_id,role) SELECT ?,?,i.role FROM group_phone_invites i WHERE i.id=? AND "+liveGuard+" ON CONFLICT(event_id,user_id) DO NOTHING"
  ).bind(state.event_id,userId,state.invite_id,...guardArgs));
  writes.push(c.env.DB.prepare(
    'UPDATE group_phone_contacts SET user_id=?,updated_at=unixepoch() WHERE id=? AND event_id=? AND '+liveGuard
  ).bind(userId,state.contact_id,state.event_id,...guardArgs));
  writes.push(c.env.DB.prepare(
    'UPDATE group_phone_invites SET consumed_at=unixepoch() WHERE id=? AND event_id=? AND contact_id=? AND consumed_at IS NULL AND expires_at>unixepoch() AND EXISTS (SELECT 1 FROM group_phone_contacts WHERE id=? AND event_id=? AND user_id=?)'
  ).bind(state.invite_id,state.event_id,state.contact_id,state.contact_id,state.event_id,userId));
  const results=await c.env.DB.batch(writes);
  if(!results[results.length-1]?.meta.changes)return c.json({error:'Invitation already redeemed or revoked'},409);
  try{
    await rememberClaim(c.env,state,'redeemed');
    await c.env.KV.delete('approved-join:'+hash);
    await clearContactRequests(c.env,state.event_id,state.contact_id);
  }catch{}
  // Successful registration is useful for the host to know; never include
  // a phone number in a lock-screen notification.
  try {
    c.executionCtx.waitUntil(sendPushToHosts(c.env,state.event_id,{
      title:'✅ '+name+' joined your poker room',
      body:name+' completed approval and is now in your member list. Open PKR to view your group.',
      data:{type:'member_joined',eventId:state.event_id,
        url:'/events/'+encodeURIComponent(state.event_id)+'?tab=members&view=roster',
        notificationId:state.invite_id}
    }));
  } catch {}
  privateHeaders(c);
  return c.json({ok:true,token:await signJWT({sub:userId,email:account?.email||'',name},c.env.JWT_SECRET),
    event_id:state.event_id});
});

export default router;
