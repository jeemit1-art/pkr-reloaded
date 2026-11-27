import {describe,it,expect} from 'vitest';
import phone from './phone-members';
import events from './events';
import {signJWT,verifyJWT} from '../jwt';
import {phoneLookup} from '../phone-security';

// A real disposable SQLite database implements the D1 prepare/bind/batch
// contract. All identities, links and game records are fictional. No remote
// API or real membership is used by these tests.
const sqliteName='node:sqlite',fsName='node:fs';
const {DatabaseSync}=await import(/* @vite-ignore */ sqliteName);
const {readFileSync}=await import(/* @vite-ignore */ fsName);
const origin='https://fixture.invalid';
const jwtSecret='fixture-only-membership-signing-secret-0000000000';
const contactKey='fixture-only-membership-encryption-key-0000000000';
const mobile='+61400000001';
const eventId='room-test';
const hostId='host-test';
const existingId='returning-test';
const now=()=>Math.floor(Date.now()/1000);
const json=(body:unknown,token?:string)=>({method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});

async function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(readFileSync(new URL('../../staging.schema.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../../migrations/20261025_staging_phone_members.sql',import.meta.url),'utf8'));
 sqlite.prepare("INSERT INTO users(id,google_sub,email,name,plan) VALUES(?,?,?,?,?)").run(hostId,'host-google','host@fixture.invalid','Host','lifetime');
 sqlite.prepare("INSERT INTO events(id,name,host_id) VALUES(?,?,?)").run(eventId,'Fictional Room',hostId);
 sqlite.prepare("INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?)").run(eventId,hostId,'host');
 const kv=new Map<string,string>();
 const statement=(sql:string,args:any[]=[]):any=>({
  bind:(...values:any[])=>statement(sql,values),
  first:async()=>sqlite.prepare(sql).get(...args)||null,
  all:async()=>({results:sqlite.prepare(sql).all(...args)}),
  execute:()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}),
  run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}})
 });
 const env:any={
  PKR_PHONE_MEMBERS_V1:'1',PKR_CONTACT_KEY:contactKey,JWT_SECRET:jwtSecret,FRONTEND_URL:origin,PKR_ENV:'staging',
  DB:{prepare:(sql:string)=>statement(sql),batch:async(stmts:any[])=>{
   sqlite.exec('BEGIN IMMEDIATE');
   try{const result=stmts.map(s=>s.execute());sqlite.exec('COMMIT');return result;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
  }},
  KV:{get:async(k:string)=>kv.get(k)||null,put:async(k:string,v:string)=>{kv.set(k,v);},
      delete:async(k:string)=>{kv.delete(k);},list:async({prefix}:{prefix:string})=>({keys:[...kv.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})}
 };
 const host=await signJWT({sub:hostId,name:'Host',email:'host@fixture.invalid'},jwtSecret);
 const headers={Authorization:'Bearer '+host};
 const get=async(path:string)=>phone.request(origin+path,{headers},env);
 const post=async(path:string,body:unknown,auth=false)=>phone.request(origin+path,json(body,auth?host:undefined),env);
 const contacts=async()=>(await (await get('/events/'+eventId+'/phone-contacts')).json() as any).contacts;
 const inbox=async()=>(await (await get('/events/'+eventId+'/join-requests')).json() as any).requests;
 const issue=async(role='member')=>{
  const response=await post('/events/'+eventId+'/phone-contacts',{phone:mobile,display_name:'Expected Player',role},true);
  expect(response.status,await response.clone().text()).toBe(201);
  const value=await response.json() as any;
  return {id:value.contact.id,token:value.invite.url.split('/').pop(),...value};
 };
 const request=async(token:string,name='Expected Player')=>{
  const response=await post('/phone-invites/'+token+'/request-approval',{display_name:name});
  expect(response.status,await response.clone().text()).toBe(202);
  return (await response.json() as any).claim as string;
 };
 const decide=async(requestId:string,approve=true)=>post('/events/'+eventId+'/join-requests/'+requestId+'/decision',{approve},true);
 const complete=(claim:string,token?:string)=>post('/phone-invites/complete-approval',{claim,invite_token:token});
 const approve=async(claim:string)=>{
  const hash=await phoneLookup(env,'claim',claim);
  const response=await decide(hash);expect(response.status,await response.clone().text()).toBe(200);
 };
 const member=()=>sqlite.prepare("SELECT u.id,u.name,em.role FROM users u JOIN event_members em ON em.user_id=u.id WHERE em.event_id=? AND u.id!=?").get(eventId,hostId) as any;
 const users=()=>Number(sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n);
 const join=async(role='member')=>{
  const link=await issue(role),claim=await request(link.token);
  await approve(claim);
  const response=await complete(claim,link.token);
  expect(response.status,await response.clone().text()).toBe(200);
  const payload=await response.json() as any;
  const account=await verifyJWT(payload.token,jwtSecret);
  return {link,claim,userId:account!.sub};
 };
 return {sqlite,env,kv,host,headers,get,post,contacts,inbox,issue,request,decide,approve,complete,member,users,join};
}

describe('Membership lifecycle with real SQLite transactions',()=>{
 it('shows authoritative joined status even if consumed invitations retain stale approval keys',async()=>{
  const f=await fixture();
  try{
   const link=await f.issue();
   const claim=await f.request(link.token);
   const hash=await phoneLookup(f.env,'claim',claim);
   const legacy=f.kv.get('join-request:'+eventId+':'+hash)!;
   expect((await f.contacts())[0].status).toBe('awaiting_host_approval');
   expect((await f.inbox()).length).toBe(1);
   await f.approve(claim);
   expect((await f.contacts())[0].status).toBe('approved_awaiting_member');
   expect((await f.inbox()).length).toBe(0);
   expect(f.users()).toBe(1);
   const completed=await f.complete(claim,link.token);
   expect(completed.status,await completed.clone().text()).toBe(200);
   const userId=(await verifyJWT((await completed.json() as any).token,jwtSecret))!.sub;
   // Reproduce a cached KV request and the legacy approval index.
   f.kv.set('join-request:'+eventId+':'+hash,legacy);
   f.kv.set('approved-contact:'+eventId+':'+link.id,'1');
   f.kv.set('approved-join:'+hash,legacy);
   expect((await f.contacts())[0]).toMatchObject({status:'joined',user_id:userId,returning:false});
   expect(await f.inbox()).toEqual([]);
   expect((await f.complete(claim,link.token)).status).toBe(409);
   expect(f.users()).toBe(2);
   expect(f.member().id).toBe(userId);
  }finally{f.sqlite.close();}
 });
 it('rejects duplicate requests, invalidates replaced/expired links, and closes declined claims',async()=>{
  const f=await fixture();
  try{
   const first=await f.issue(),claim=await f.request(first.token);
   const hash=await phoneLookup(f.env,'claim',claim);
   const duplicate=await f.post('/phone-invites/'+first.token+'/request-approval',{display_name:'Repeat'});
   expect(duplicate.status).toBe(429);
   const oldRequest=f.kv.get('join-request:'+eventId+':'+hash)!;
   const second=await f.issue();
   expect(second.token).not.toBe(first.token);
   f.kv.set('join-request:'+eventId+':'+hash,oldRequest);
   expect(await f.inbox()).toEqual([]);
   expect((await f.decide(hash)).status).toBe(409);
   expect((await f.complete(claim,first.token)).status).toBe(409);
   expect((await f.contacts())[0].status).toBe('invited');
   const claim2=await f.request(second.token);
   const hash2=await phoneLookup(f.env,'claim',claim2);
   expect((await f.decide(hash2,false)).status).toBe(200);
   expect((await f.complete(claim2,second.token)).status).toBe(403);
   expect(await f.inbox()).toEqual([]);
   expect(f.users()).toBe(1);
   const third=await f.issue(),claim3=await f.request(third.token);
   f.sqlite.prepare('UPDATE group_phone_invites SET expires_at=? WHERE contact_id=? AND consumed_at IS NULL').run(now()-1,third.id);
   expect((await f.contacts())[0].status).toBe('expired');
   expect(await f.inbox()).toEqual([]);
   expect((await f.complete(claim3,third.token)).status).toBe(409);
  }finally{f.sqlite.close();}
 });
 it('recovers the same account and role, removes access, revokes recovery, and rejoins with the original identity',async()=>{
  const f=await fixture();
  try{
   const joined=await f.join('cohost');
   expect(f.member()).toMatchObject({id:joined.userId,role:'cohost'});
   const duplicate=await f.post('/events/'+eventId+'/phone-contacts',{phone:mobile,display_name:'Different Name',role:'member'},true);
   expect(duplicate.status).toBe(409);
   expect((await f.contacts())[0].display_name).toBe('Expected Player');
   const recovery=await f.post('/events/'+eventId+'/phone-contacts/'+joined.link.id+'/recovery',{},true);
   expect(recovery.status,await recovery.clone().text()).toBe(200);
   const recoveryToken=(await recovery.json() as any).url.split('/').pop();
   const claim=await f.request(recoveryToken,'Do not rename account');
   expect((await f.inbox())[0]).toMatchObject({recovery:true,rejoin:false});
   expect((await f.contacts())[0].status).toBe('joined');
   await f.approve(claim);
   const recovered=await f.complete(claim,recoveryToken);
   expect(recovered.status,await recovered.clone().text()).toBe(200);
   const payload=await verifyJWT((await recovered.json() as any).token,jwtSecret);
   expect(payload?.sub).toBe(joined.userId);
   expect(payload?.name).toBe('Expected Player');
   expect(f.member().role).toBe('cohost');expect(f.users()).toBe(2);
   const another=await f.post('/events/'+eventId+'/phone-contacts/'+joined.link.id+'/recovery',{},true);
   const oldToken=(await another.json() as any).url.split('/').pop();
   const oldClaim=await f.request(oldToken);await f.approve(oldClaim);
   const removed=await events.request(origin+'/'+eventId+'/members/'+joined.userId,{method:'DELETE',headers:f.headers},f.env);
   expect(removed.status,await removed.clone().text()).toBe(200);
   expect(f.member()).toBeUndefined();
   expect((await f.contacts())[0]).toMatchObject({status:'removed',returning:true,user_id:joined.userId});
   expect((await f.complete(oldClaim,oldToken)).status).toBe(409);
   const wrongRecovery=await f.post('/events/'+eventId+'/phone-contacts/'+joined.link.id+'/recovery',{},true);
   expect(wrongRecovery.status).toBe(409);
   const rejoin=await f.issue('member'),rejoinClaim=await f.request(rejoin.token);
   expect(rejoin.id).toBe(joined.link.id);
   expect((await f.inbox())[0]).toMatchObject({recovery:false,rejoin:true});
   await f.approve(rejoinClaim);
   const final=await f.complete(rejoinClaim,rejoin.token);
   expect(final.status,await final.clone().text()).toBe(200);
   expect((await verifyJWT((await final.json() as any).token,jwtSecret))?.sub).toBe(joined.userId);
   expect(f.member()).toMatchObject({id:joined.userId,role:'member'});
   expect(f.users()).toBe(2);
   const removedViaContact=await phone.request(origin+'/events/'+eventId+'/phone-contacts/'+joined.link.id,{method:'DELETE',headers:f.headers},f.env);
   expect(removedViaContact.status).toBe(200);
   expect((await f.contacts())[0]).toMatchObject({status:'removed',user_id:joined.userId});
   expect(f.users()).toBe(2);
  }finally{f.sqlite.close();}
 });
 it('cannot create an orphan or second account when two approved claims race on the same link',async()=>{
  const f=await fixture();
  try{
   const link=await f.issue(),first=await f.request(link.token);
   const firstHash=await phoneLookup(f.env,'claim',first);
   const state=JSON.parse(f.kv.get('join-request:'+eventId+':'+firstHash)!);
   await f.approve(first);
   const second='a'.repeat(64),secondHash=await phoneLookup(f.env,'claim',second);
   // Simulate two approved KV records due to concurrent legacy requests.
   f.kv.set('approved-join:'+secondHash,JSON.stringify({...state,claim_hash:secondHash,display_name:'Second Claim'}));
   const results=await Promise.all([f.complete(first,link.token),f.complete(second,link.token)]);
   expect(results.map(r=>r.status).sort()).toEqual([200,409]);
   expect(f.users()).toBe(2);
   expect(Number(f.sqlite.prepare('SELECT COUNT(*) AS n FROM event_members WHERE event_id=?').get(eventId).n)).toBe(2);
   expect((await f.contacts())[0].status).toBe('joined');
   expect(await f.inbox()).toEqual([]);
  }finally{f.sqlite.close();}
 });
});
