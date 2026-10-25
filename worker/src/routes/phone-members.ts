// Mobile-first private group directory; no phone directory is published globally.
// All pending contact numbers are encrypted. WhatsApp OTP uses the official
// Meta Cloud API; optional manual host approval is separately gated.
import {Hono} from 'hono';
import type {Env} from '../types';
import {authMiddleware,generateId,requireEventRole} from '../middleware';
import {signJWT} from '../jwt';
import {normalizeMobile,phoneLookup,encryptPhone,decryptPhone,randomToken,
  maskMobile,phoneMembersReady} from '../phone-security';
import {whatsappOtpReady,sendWhatsappOtp,checkWhatsappOtp} from '../whatsapp-otp';

const router=new Hono<{Bindings:Env}>();
type Contact={id:string;event_id:string;display_name:string;phone_cipher:string;phone_lookup:string;user_id:string|null};
type Invite={id:string;event_id:string;contact_id:string;display_name:string;phone_cipher:string;
  role:string;expires_at:number;consumed_at:number|null;sent_count:number;last_sent_at:number|null;verify_count:number; event_name:string};

function unavailable(c:any){return c.json({
  error:'Private mobile membership is not activated yet.',
  code:'PHONE_MEMBERS_NOT_READY'
},503);}
function failed(c:any){return c.json({error:'Private mobile membership service is temporarily unavailable.'},503);}
function hostApprovalReady(env:Env):boolean{
  return env.PKR_HOST_APPROVAL_FALLBACK==='1'&&!whatsappOtpReady(env);
}
async function getInvite(env:Env,token:string):Promise<Invite|null>{
  if(!/^[0-9a-f]{64}$/.test(token))return null;
  const hash=await phoneLookup(env,'invite',token);
  return env.DB.prepare(
    'SELECT i.*,c.display_name,c.phone_cipher,e.name AS event_name FROM group_phone_invites i JOIN group_phone_contacts c ON c.id=i.contact_id AND c.event_id=i.event_id JOIN events e ON e.id=i.event_id WHERE i.token_hash=? AND i.consumed_at IS NULL AND i.expires_at>unixepoch()'
  ).bind(hash).first<Invite>();
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
    const contacts=await Promise.all(result.results.map(async row=>({
      id:row.id,display_name:row.display_name,phone:await decryptPhone(c.env,row.phone_cipher),
      status:row.user_id?'joined':'invited',created_at:row.created_at
    })));
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
      'ON CONFLICT(event_id,phone_lookup) DO UPDATE SET display_name=excluded.display_name,updated_at=unixepoch()'
    ).bind(id,eventId,name,lookup,cipher).run();
    const contact=await c.env.DB.prepare('SELECT id,user_id FROM group_phone_contacts WHERE event_id=? AND phone_lookup=?')
      .bind(eventId,lookup).first<{id:string;user_id:string|null}>();
    if(!contact)return failed(c);
    if(contact.user_id)return c.json({error:'This number is already verified in this group.'},409);
    // Creating a fresh invitation revokes prior outstanding links for this contact.
    const token=randomToken(),tokenHash=await phoneLookup(c.env,'invite',token);
    const inviteId=generateId(),expires=Math.floor(Date.now()/1000)+48*3600;
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM group_phone_invites WHERE event_id=? AND contact_id=? AND consumed_at IS NULL')
        .bind(eventId,contact.id),
      c.env.DB.prepare('INSERT INTO group_phone_invites(id,event_id,contact_id,token_hash,role,expires_at) VALUES(?,?,?,?,?,?)')
        .bind(inviteId,eventId,contact.id,tokenHash,role,expires)
    ]);
    const url=c.env.FRONTEND_URL+'/phone-invite/'+token;
    const group=await c.env.DB.prepare('SELECT name FROM events WHERE id=?')
      .bind(eventId).first<{name:string}>();
    const message='You have a private PKR invitation to '+(group?.name||'a poker group')+
      '. Open this link and verify your mobile number to join: '+url;
    privateHeaders(c);
    return c.json({ok:true,contact:{id:contact.id,display_name:name,phone:mobile,status:'invited'},
      invite:{url,expires_at:expires,role},whatsapp_url:'https://wa.me/'+mobile.slice(1)+'?text='+encodeURIComponent(message)},201);
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
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM group_phone_invites WHERE event_id=? AND contact_id=?').bind(id,contactId),
      c.env.DB.prepare('DELETE FROM event_members WHERE event_id=? AND user_id=? AND role!=?')
        .bind(id,contact.user_id||'', 'host'),
      c.env.DB.prepare('DELETE FROM group_phone_contacts WHERE event_id=? AND id=?').bind(id,contactId)
    ]);
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
  const token=randomToken(),hash=await phoneLookup(c.env,'invite',token);
  const expiry=Math.floor(Date.now()/1000)+48*3600;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM group_phone_invites WHERE contact_id=? AND event_id=? AND consumed_at IS NULL').bind(contactId,eventId),
    c.env.DB.prepare('INSERT INTO group_phone_invites(id,event_id,contact_id,token_hash,role,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(generateId(),eventId,contactId,hash,'member',expiry)
  ]);
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
      role:invite.role,expires_at:invite.expires_at,verification_ready:whatsappOtpReady(c.env)});
  }catch{return failed(c);}
});
router.post('/phone-invites/:token/send-code',async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  if(!whatsappOtpReady(c.env))return c.json({error:'WhatsApp OTP sender must be configured by the administrator.'},503);
  try{
    const invite=await getInvite(c.env,c.req.param('token'));
    if(!invite)return c.json({error:'Invitation unavailable or expired.'},404);
    const limited=await c.env.DB.prepare(
      'UPDATE group_phone_invites SET sent_count=sent_count+1,last_sent_at=unixepoch() '+
      'WHERE id=? AND consumed_at IS NULL AND expires_at>unixepoch() AND sent_count<5 '+
      'AND (last_sent_at IS NULL OR last_sent_at<unixepoch()-60)'
    ).bind(invite.id).run();
    if(!limited.meta.changes)return c.json({error:'Please wait before requesting another code.'},429);
    const mobile=await decryptPhone(c.env,invite.phone_cipher);
    const sent=await sendWhatsappOtp(c.env,mobile,'invite:'+invite.id);
    if(!sent)return c.json({error:'Could not send a WhatsApp verification code. Try again later.'},503);
    return c.json({ok:true,message:'Verification code sent to your WhatsApp number.'});
  }catch{return failed(c);}
});
router.post('/phone-invites/:token/confirm',async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  if(!whatsappOtpReady(c.env))return c.json({error:'Phone verification unavailable'},503);
  const body=await c.req.json().catch(()=>null) as {code?:unknown}|null;
  const code=typeof body?.code==='string'?body.code.trim():'';
  if(!/^\d{6}$/.test(code))return c.json({error:'Enter your verification code.'},400);
  try{
    const invite=await getInvite(c.env,c.req.param('token'));
    if(!invite)return c.json({error:'Invitation unavailable or expired.'},404);
    const limited=await c.env.DB.prepare(
      'UPDATE group_phone_invites SET verify_count=verify_count+1 '+
      'WHERE id=? AND consumed_at IS NULL AND expires_at>unixepoch() AND verify_count<8 AND sent_count>0'
    ).bind(invite.id).run();
    if(!limited.meta.changes)return c.json({error:'Verification attempts exceeded or code not requested.'},429);
    const mobile=await decryptPhone(c.env,invite.phone_cipher);
    if(!await checkWhatsappOtp(c.env,mobile,code,'invite:'+invite.id))
      return c.json({error:'Incorrect or expired verification code.'},403);
    const globalLookup=await phoneLookup(c.env,'verified-phone',mobile);
    let identity=await c.env.DB.prepare('SELECT user_id FROM verified_phone_identities WHERE phone_lookup=?')
      .bind(globalLookup).first<{user_id:string}>();
    if(!identity){
      const userId=generateId();
      // Legacy users schema requires google_sub/email; phone accounts use an
      // opaque synthetic marker, NEVER the phone itself, and blank email.
      await c.env.DB.prepare(
        'INSERT INTO users(id,google_sub,email,name,plan,trial_started_at) VALUES(?,?,?,?,?,unixepoch())'
      ).bind(userId,'phone:'+generateId(),'',invite.display_name,'trial').run();
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO verified_phone_identities(phone_lookup,user_id) VALUES(?,?)'
      ).bind(globalLookup,userId).run();
      identity=await c.env.DB.prepare('SELECT user_id FROM verified_phone_identities WHERE phone_lookup=?')
        .bind(globalLookup).first<{user_id:string}>();
    }
    if(!identity)return failed(c);
    const consumed=await c.env.DB.prepare(
      'UPDATE group_phone_invites SET consumed_at=unixepoch() WHERE id=? AND consumed_at IS NULL AND expires_at>unixepoch()'
    ).bind(invite.id).run();
    if(!consumed.meta.changes)return c.json({error:'Invitation already used or expired.'},409);
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?) '+
        "ON CONFLICT(event_id,user_id) DO UPDATE SET role=CASE WHEN event_members.role='host' THEN 'host' "+
        "WHEN event_members.role='cohost' THEN 'cohost' ELSE excluded.role END"
      ).bind(invite.event_id,identity.user_id,invite.role),
      c.env.DB.prepare('UPDATE group_phone_contacts SET user_id=?,updated_at=unixepoch() WHERE id=? AND event_id=?')
        .bind(identity.user_id,invite.contact_id,invite.event_id)
    ]);
    const jwt=await signJWT({sub:identity.user_id,email:'',name:invite.display_name},c.env.JWT_SECRET);
    privateHeaders(c);
    return c.json({ok:true,token:jwt,event_id:invite.event_id,event_name:invite.event_name});
  }catch{return failed(c);}
});

// Optional manual host approval is disabled by default and does not verify ownership.
// The WhatsApp invite is a bearer link; it does NOT verify phone ownership.
// No membership is granted until the existing group host approves the claim.
router.post('/phone-invites/:token/request-approval',async c=>{
  if(!hostApprovalReady(c.env))return c.json({error:'WhatsApp OTP is required; manual approval is disabled.',code:'WHATSAPP_OTP_REQUIRED'},503);
  if(!phoneMembersReady(c.env))return unavailable(c);
  const invite=await getInvite(c.env,c.req.param('token')).catch(()=>null);
  if(!invite)return c.json({error:'Invitation expired or unavailable'},404);
  const body=await c.req.json().catch(()=>null) as {display_name?:unknown}|null;
  const name=typeof body?.display_name==='string'?body.display_name.trim():'';
  if(name.length<2||name.length>60||/[\u0000-\u001f<>]/.test(name))
    return c.json({error:'Enter the name the host will recognise'},400);
  // Limit one outstanding claim per invitation, including a newly approved claim.
  const rateKey='join-invite-rate:'+invite.id;
  if(await c.env.KV.get(rateKey))return c.json({error:'A join request is already pending for this invitation. Ask the host to review it.'},429);
  const claim=randomToken(),hash=await phoneLookup(c.env,'claim',claim);
  const existing=await c.env.KV.list({prefix:'join-request:'+invite.event_id+':'});
  if(existing.keys.length>=100)return c.json({error:'Too many pending requests'},429);
  await c.env.KV.put('join-request:'+invite.event_id+':'+hash,JSON.stringify({
    event_id:invite.event_id,invite_id:invite.id,contact_id:invite.contact_id,
    role:invite.role,display_name:name,claim_hash:hash,requested_at:Date.now()
  }),{expirationTtl:86400});
  await c.env.KV.put(rateKey,'1',{expirationTtl:300});
  privateHeaders(c);
  return c.json({ok:true,claim,status:'pending',message:'The host must approve your request before you can join.'},202);
});
router.get('/events/:id/join-requests',authMiddleware,async c=>{
  if(!hostApprovalReady(c.env))return c.json({error:'WhatsApp OTP is required; manual approval is disabled.',code:'WHATSAPP_OTP_REQUIRED'},503);
  if(!phoneMembersReady(c.env))return unavailable(c);
  const id=c.req.param('id');
  if(!await requireEventRole(c,id,'host'))return c.json({error:'Host only'},403);
  const listed=await c.env.KV.list({prefix:'join-request:'+id+':'});
  const requests=await Promise.all(listed.keys.slice(0,100).map(async k=>{
    const raw=await c.env.KV.get(k.name);if(!raw)return null;
    const r=JSON.parse(raw);
    const contact=await c.env.DB.prepare(
      'SELECT display_name,phone_cipher FROM group_phone_contacts WHERE id=? AND event_id=?'
    ).bind(r.contact_id,id).first<{display_name:string;phone_cipher:string}>();
    if(!contact)return null;
    return {id:k.name.slice(('join-request:'+id+':').length),name:r.display_name,
      expected_member:contact.display_name,phone:maskMobile(await decryptPhone(c.env,contact.phone_cipher)),
      requested_at:r.requested_at};
  }));
  privateHeaders(c);
  return c.json({requests:requests.filter(Boolean)});
});
router.post('/events/:id/join-requests/:requestId/decision',authMiddleware,async c=>{
  if(!hostApprovalReady(c.env))return c.json({error:'WhatsApp OTP is required; manual approval is disabled.',code:'WHATSAPP_OTP_REQUIRED'},503);
  if(!phoneMembersReady(c.env))return unavailable(c);
  const id=c.req.param('id'),key='join-request:'+id+':'+c.req.param('requestId');
  if(!await requireEventRole(c,id,'host'))return c.json({error:'Host only'},403);
  const body=await c.req.json().catch(()=>null) as {approve?:unknown}|null;
  const raw=await c.env.KV.get(key);
  if(!raw)return c.json({error:'Request expired'},404);
  const state=JSON.parse(raw);
  if(body?.approve===true){
    // Final membership is created only when the approved claimant redeems their
    // own secret; the request ID alone does not authenticate that claimant.
    const invite=await c.env.DB.prepare(
      'SELECT id FROM group_phone_invites WHERE id=? AND event_id=? AND consumed_at IS NULL AND expires_at>unixepoch()'
    ).bind(state.invite_id,id).first();
    if(!invite)return c.json({error:'Original invitation expired; resend it'},409);
    await c.env.KV.put('approved-join:'+state.claim_hash,JSON.stringify({...state,approved_at:Date.now()}),{expirationTtl:3600});
  }
  await c.env.KV.delete(key);
  return c.json({ok:true,approved:body?.approve===true});
});
router.post('/phone-invites/complete-approval',async c=>{
  if(!hostApprovalReady(c.env))return c.json({error:'WhatsApp OTP is required; manual approval is disabled.',code:'WHATSAPP_OTP_REQUIRED'},503);
  if(!phoneMembersReady(c.env))return unavailable(c);
  const body=await c.req.json().catch(()=>null) as {claim?:unknown}|null;
  const claim=typeof body?.claim==='string'?body.claim:'';
  if(!/^[a-f0-9]{64}$/.test(claim))return c.json({error:'Invalid request'},400);
  const hash=await phoneLookup(c.env,'claim',claim);
  const raw=await c.env.KV.get('approved-join:'+hash);
  if(!raw)return c.json({status:'pending'},202);
  const state=JSON.parse(raw);
  const invite=await c.env.DB.prepare(
    'SELECT id FROM group_phone_invites WHERE id=? AND event_id=? AND contact_id=? AND consumed_at IS NULL AND expires_at>unixepoch()'
  ).bind(state.invite_id,state.event_id,state.contact_id).first();
  if(!invite)return c.json({error:'Invitation no longer valid'},409);
  const contact=await c.env.DB.prepare(
    'SELECT user_id FROM group_phone_contacts WHERE id=? AND event_id=?'
  ).bind(state.contact_id,state.event_id).first<{user_id:string|null}>();
  if(!contact)return c.json({error:'Invitation no longer valid'},409);
  const userId=contact.user_id||generateId(),name=state.display_name;
  // D1 batch is transactional: all account, membership, contact and invite
  // changes commit together or roll back together. No orphan users on failure.
  const writes=[];
  if(!contact.user_id)writes.push(c.env.DB.prepare(
    'INSERT INTO users(id,google_sub,email,name,plan,trial_started_at) VALUES(?,?,?,?,?,unixepoch())'
  ).bind(userId,'approval:'+generateId(),'',name,'trial'));
  writes.push(c.env.DB.prepare(
    'UPDATE group_phone_invites SET consumed_at=unixepoch() WHERE id=? AND consumed_at IS NULL AND expires_at>unixepoch()'
  ).bind(state.invite_id));
  writes.push(c.env.DB.prepare(
    "INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?) ON CONFLICT(event_id,user_id) DO NOTHING"
  ).bind(state.event_id,userId,state.role));
  writes.push(c.env.DB.prepare(
    'UPDATE group_phone_contacts SET user_id=?,updated_at=unixepoch() WHERE id=? AND event_id=?'
  ).bind(userId,state.contact_id,state.event_id));
  const results=await c.env.DB.batch(writes);
  if(!results[contact.user_id?0:1]?.meta.changes)return c.json({error:'Invitation already redeemed'},409);
  await c.env.KV.delete('approved-join:'+hash);
  privateHeaders(c);
  return c.json({ok:true,token:await signJWT({sub:userId,email:'',name},c.env.JWT_SECRET),
    event_id:state.event_id});
});

// Existing verified members use a fresh WhatsApp Cloud API OTP to sign in.
// A challenge is opaque, short-lived and never exposes whether a phone is known.
async function rateLimit(env:Env,value:string,scope:string,max:number):Promise<boolean>{
  const key=await phoneLookup(env,'mobile-auth-rate:'+scope,value);
  await env.DB.prepare(
    'INSERT INTO phone_verification_limits(rate_key,window_start,attempts) VALUES(?,unixepoch(),1) '+
    'ON CONFLICT(rate_key) DO UPDATE SET attempts=CASE WHEN window_start<unixepoch()-3600 THEN 1 ELSE attempts+1 END, '+
    'window_start=CASE WHEN window_start<unixepoch()-3600 THEN unixepoch() ELSE window_start END'
  ).bind(key).run();
  const row=await env.DB.prepare('SELECT attempts FROM phone_verification_limits WHERE rate_key=?')
    .bind(key).first<{attempts:number}>();
  return !!row&&row.attempts<=max;
}
router.post('/auth/mobile/start',async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  if(!whatsappOtpReady(c.env))return c.json({error:'WhatsApp OTP sender is not configured.'},503);
  const body=await c.req.json().catch(()=>null) as {phone?:unknown}|null;
  const mobile=normalizeMobile(body?.phone);
  if(!mobile)return c.json({error:'Enter a valid mobile number, including country code if outside Australia.'},400);
  const challenge=randomToken();
  const generic={ok:true,challenge,message:'If this mobile is registered with PKR, a WhatsApp code will be sent.'};
  try{
    const allowedPhone=await rateLimit(c.env,mobile,'phone',4);
    const ip=c.req.header('CF-Connecting-IP')||'unknown';
    const allowedIP=await rateLimit(c.env,ip,'ip',25);
    if(!allowedPhone||!allowedIP)return c.json({error:'Too many verification requests. Try again later.'},429);
    const lookup=await phoneLookup(c.env,'verified-phone',mobile);
    const identity=await c.env.DB.prepare('SELECT user_id FROM verified_phone_identities WHERE phone_lookup=?')
      .bind(lookup).first<{user_id:string}>();
    if(identity){
      const cipher=await encryptPhone(c.env,mobile);
      await c.env.KV.put('phone-login:'+challenge,JSON.stringify({
        phone_lookup:lookup,phone_cipher:cipher,checks:0
      }),{expirationTtl:600});
      // Do not disclose provider response or whether number exists.
      await sendWhatsappOtp(c.env,mobile,'login:'+challenge);
    }
    return c.json(generic);
  }catch{return failed(c);}
});
router.post('/auth/mobile/confirm',async c=>{
  if(!phoneMembersReady(c.env))return unavailable(c);
  if(!whatsappOtpReady(c.env))return c.json({error:'WhatsApp OTP sender is not configured.'},503);
  const body=await c.req.json().catch(()=>null) as {challenge?:unknown;code?:unknown}|null;
  const challenge=typeof body?.challenge==='string'?body.challenge:'';
  const code=typeof body?.code==='string'?body.code.trim():'';
  if(!/^[a-f0-9]{64}$/.test(challenge)||!/^\d{6}$/.test(code))
    return c.json({error:'Invalid or expired verification.'},400);
  try{
    const raw=await c.env.KV.get('phone-login:'+challenge);
    if(!raw)return c.json({error:'Invalid or expired verification.'},403);
    const state=JSON.parse(raw) as {phone_lookup:string;phone_cipher:string;checks:number};
    if(!state.phone_lookup||!state.phone_cipher||state.checks>=8)
      return c.json({error:'Invalid or expired verification.'},403);
    const allowed=await rateLimit(c.env,challenge,'login-confirm',8);
    if(!allowed)return c.json({error:'Too many verification attempts. Request a new code.'},429);
    state.checks+=1;
    await c.env.KV.put('phone-login:'+challenge,JSON.stringify(state),{expirationTtl:600});
    const mobile=await decryptPhone(c.env,state.phone_cipher);
    if(!await checkWhatsappOtp(c.env,mobile,code,'login:'+challenge))
      return c.json({error:'Incorrect or expired verification code.'},403);
    const identity=await c.env.DB.prepare('SELECT user_id FROM verified_phone_identities WHERE phone_lookup=?')
      .bind(state.phone_lookup).first<{user_id:string}>();
    if(!identity)return c.json({error:'Number is no longer registered.'},403);
    const user=await c.env.DB.prepare('SELECT id,email,name FROM users WHERE id=?')
      .bind(identity.user_id).first<{id:string;email:string;name:string}>();
    if(!user)return c.json({error:'Account no longer available.'},403);
    await c.env.KV.delete('phone-login:'+challenge);
    privateHeaders(c);
    return c.json({ok:true,token:await signJWT({sub:user.id,email:user.email,name:user.name},c.env.JWT_SECRET)});
  }catch{return failed(c);}
});
export default router;
