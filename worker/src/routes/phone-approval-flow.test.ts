import {describe,it,expect} from 'vitest';
import router from './phone-members';
import {signJWT,verifyJWT} from '../jwt';
import {encryptPhone,phoneLookup} from '../phone-security';

// This is an in-memory D1/KV contract test with fictional identities only.
// It never opens a Cloudflare connection or reaches the live application.
const base='https://staging.test.invalid';
const fakeKey='synthetic-test-only-encryption-key-00000000000000';
const jwtSecret='synthetic-unit-test-jwt-secret-000000000000000';

function makeFixture(){
 const code='c'.repeat(64);
 const dbState={consumed:false,userId:null as string|null,users:0,members:[] as Array<{eventId:string,userId:string,role:string}>};
 const kvMap=new Map<string,string>();
 const statement=(sql:string,args:any[])=>({
  async first(){
   if(sql.includes('JOIN group_phone_contacts c')&&sql.includes('group_phone_invites i'))
    return dbState.consumed?null:{id:'invite-1',event_id:'room-1',contact_id:'contact-1',display_name:'Expected Player',phone_cipher:'fake-opaque-cipher-used-only-by-invite',role:'member',expires_at:Math.floor(Date.now()/1000)+3600,consumed_at:null,sent_count:0,last_sent_at:null,verify_count:0,event_name:'Friday Test Group'};
   if(sql.includes('SELECT role FROM event_members'))return args[0]==='room-1'&&args[1]==='host-1'?{role:'host'}:null;
   if(sql.includes('SELECT id FROM group_phone_invites'))return dbState.consumed?null:{id:'invite-1'};
   if(sql.includes('SELECT user_id FROM group_phone_contacts'))return {user_id:dbState.userId};
   if(sql.includes('SELECT display_name,phone_cipher FROM group_phone_contacts'))return {display_name:'Expected Player',phone_cipher:await encryptPhone({PKR_CONTACT_KEY:fakeKey} as any,'+61412345678')};
   return null;
  },
  async run(){
   if(sql.includes('INSERT INTO users')){dbState.users++;return {meta:{changes:1}};}
   if(sql.includes('UPDATE group_phone_invites SET consumed_at')){if(dbState.consumed)return {meta:{changes:0}};dbState.consumed=true;return {meta:{changes:1}};}
   if(sql.includes('INSERT INTO event_members')){dbState.members.push({eventId:args[0],userId:args[1],role:args[2]});return {meta:{changes:1}};}
   if(sql.includes('UPDATE group_phone_contacts SET user_id')){dbState.userId=args[0];return {meta:{changes:1}};}
   return {meta:{changes:0}};
  },
 });
 const env:any={
  PKR_PHONE_MEMBERS_V1:'1',PKR_CONTACT_KEY:fakeKey,PKR_HOST_APPROVAL_FALLBACK:'1',JWT_SECRET:jwtSecret,
  KV:{
   get:async(k:string)=>kvMap.get(k)||null,
   put:async(k:string,v:string)=>{kvMap.set(k,v)},
   delete:async(k:string)=>{kvMap.delete(k)},
   list:async({prefix}:{prefix:string})=>({keys:[...kvMap.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})
  },
  DB:{
   prepare:(sql:string)=>({bind:(...args:any[])=>statement(sql,args)}),
   batch:async(stmts:Array<{run:()=>Promise<any>}>)=>Promise.all(stmts.map(s=>s.run()))
  }
 };
 return {env,code,dbState,kvMap};
}
const jsonPost=(payload:unknown,token?:string)=>({method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)});

describe('free private WhatsApp membership host approval contract',()=>{
 it('requires a real host decision before issuing an account and consumes the invitation once',async()=>{
  const {env,code,dbState,kvMap}=makeFixture();
  const req=await router.request(base+'/phone-invites/'+code+'/request-approval',jsonPost({display_name:'New Player'}),env);
  expect(req.status,await req.clone().text()).toBe(202);
  const pending=await req.json() as any;
  expect(pending.status).toBe('pending');
  expect(pending.claim).toMatch(/^[0-9a-f]{64}$/);
  const notApproved=await router.request(base+'/phone-invites/complete-approval',jsonPost({claim:pending.claim}),env);
  expect(notApproved.status).toBe(202);
  expect(dbState.users).toBe(0);
  const hostToken=await signJWT({sub:'host-1',email:'host@invalid.test',name:'Host'},jwtSecret);
  const inbox=await router.request(base+'/events/room-1/join-requests',{headers:{Authorization:'Bearer '+hostToken}},env);
  expect(inbox.status).toBe(200);
  const inboxData=await inbox.json() as any;
  expect(inboxData.requests).toHaveLength(1);
  expect(inboxData.requests[0].phone).not.toContain('+61412345678');
  expect(inboxData.requests[0].phone).toContain('5678');
  const denyOther=await signJWT({sub:'unknown-1',email:'guest@invalid.test',name:'Other'},jwtSecret);
  const blocked=await router.request(base+'/events/room-1/join-requests/'+inboxData.requests[0].id+'/decision',jsonPost({approve:true},denyOther),env);
  expect(blocked.status).toBe(403);
  const approved=await router.request(base+'/events/room-1/join-requests/'+inboxData.requests[0].id+'/decision',jsonPost({approve:true},hostToken),env);
  expect(approved.status).toBe(200);
  const joined=await router.request(base+'/phone-invites/complete-approval',jsonPost({claim:pending.claim}),env);
  expect(joined.status).toBe(200);
  const joinedData=await joined.json() as any;
  expect(joinedData.event_id).toBe('room-1');
  expect((await verifyJWT(joinedData.token,jwtSecret))?.sub).toBe(dbState.userId);
  expect(dbState.users).toBe(1);
  expect(dbState.members).toEqual([{eventId:'room-1',userId:dbState.userId,role:'member'}]);
  expect(dbState.consumed).toBe(true);
  expect([...kvMap.keys()].some(k=>k.startsWith('approved-join:'))).toBe(false);
  const second=await router.request(base+'/phone-invites/complete-approval',jsonPost({claim:pending.claim}),env);
  expect(second.status).toBe(202);
  expect(dbState.users).toBe(1);
 });
 it('host rejection never creates a user or membership',async()=>{
  const {env,code,dbState}=makeFixture();
  const req=await router.request(base+'/phone-invites/'+code+'/request-approval',jsonPost({display_name:'Suspicious Request'}),env);
  const pending=await req.json() as any;
  const hostToken=await signJWT({sub:'host-1',email:'host@invalid.test',name:'Host'},jwtSecret);
  const inbox=await router.request(base+'/events/room-1/join-requests',{headers:{Authorization:'Bearer '+hostToken}},env);
  const pendingId=(await inbox.json() as any).requests[0].id;
  const rejected=await router.request(base+'/events/room-1/join-requests/'+pendingId+'/decision',jsonPost({approve:false},hostToken),env);
  expect(rejected.status).toBe(200);
  expect((await rejected.json() as any).approved).toBe(false);
  const complete=await router.request(base+'/phone-invites/complete-approval',jsonPost({claim:pending.claim}),env);
  expect(complete.status).toBe(202);
  expect(dbState.users).toBe(0);
  expect(dbState.members).toHaveLength(0);
 });
 it('does not accept guessed invite tokens or invalid claim values',async()=>{
  const {env}=makeFixture();
  const invalid=await router.request(base+'/phone-invites/invalid',{},env);
  expect(invalid.status).toBe(404);
  const claim=await router.request(base+'/phone-invites/complete-approval',jsonPost({claim:'bad-claim'}),env);
  expect(claim.status).toBe(400);
  const unauthenticated=await router.request(base+'/events/room-1/join-requests',{},env);
  expect(unauthenticated.status).toBe(401);
 });
});
