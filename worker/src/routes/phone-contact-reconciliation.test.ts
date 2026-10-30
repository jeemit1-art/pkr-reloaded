import {describe,it,expect} from 'vitest';
import router from './phone-members';
import {signJWT} from '../jwt';
import {encryptPhone} from '../phone-security';

const base='https://example.invalid';
const jwtSecret='pkr-testing-signing-secret-not-production-000000';
const contactKey='pkr-testing-contact-encryption-key-not-live';
function fixture(){
  const state={
    contactUserId:null as string|null,
    revoked:0,linked:0,secondContactUserId:null as string|null,
    pending:1,
    members:new Map([['host-1','host'],['member-1','member'],['cohost-1','cohost']]),
  };
  const kv=new Map<string,string>([
    ['join-request:room-1:claim1',JSON.stringify({event_id:'room-1',contact_id:'contact-1',display_name:'Test Player'})],
    ['approved-contact:room-1:contact-1','1'],
  ]);
  const statement=(sql:string,args:any[])=>({
    async first(){
      if(sql.includes('SELECT role FROM event_members WHERE event_id=? AND user_id=?')){
        const role=args[0]==='room-1'?state.members.get(args[1]):undefined;
        return role?{role}:null;
      }
      if(sql.includes('SELECT id,user_id FROM group_phone_contacts WHERE event_id=? AND id=?')){
        return args[0]==='room-1'&&args[1]==='contact-1'?{id:'contact-1',user_id:state.contactUserId}:null;
      }
      if(sql.includes('SELECT id FROM group_phone_contacts WHERE event_id=? AND user_id=? AND id!=?')){
        return state.secondContactUserId===args[1]?{id:'contact-2'}:null;
      }
      return null;
    },
    async all(){
      if(sql.includes('SELECT id,event_id,display_name,phone_cipher,user_id,created_at FROM group_phone_contacts')){
        return {results:[{id:'contact-1',event_id:'room-1',display_name:'Test Player',
          phone_cipher:await encryptPhone({PKR_CONTACT_KEY:contactKey} as any,'+61400000000'),
          user_id:state.contactUserId,created_at:1}]};
      }
      if(sql.includes('SELECT user_id FROM event_members WHERE event_id=?')){
        return {results:[...state.members.keys()].map(user_id=>({user_id}))};
      }
      return {results:[]};
    },
    async run(){
      if(sql.startsWith('UPDATE group_phone_contacts SET user_id=')){
        if(state.contactUserId!==null)return {meta:{changes:0}};
        state.contactUserId=args[0];state.linked++;return {meta:{changes:1}};
      }
      if(sql.startsWith('UPDATE group_phone_invites SET consumed_at=')){
        state.revoked++;return {meta:{changes:1}};
      }
      return {meta:{changes:0}};
    }
  });
  const env:any={
    PKR_PHONE_MEMBERS_V1:'1',PKR_CONTACT_KEY:contactKey,JWT_SECRET:jwtSecret,
    KV:{
      get:async(key:string)=>kv.get(key)||null,
      put:async(key:string,val:string)=>{kv.set(key,val);},
      delete:async(key:string)=>{kv.delete(key);},
      list:async({prefix}:{prefix:string})=>({keys:[...kv.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})
    },
    DB:{
      prepare:(sql:string)=>({bind:(...args:any[])=>statement(sql,args)}),
      batch:async(stmts:Array<{run:()=>Promise<any>}>)=>Promise.all(stmts.map(stmt=>stmt.run()))
    },
  };
  return {env,state,kv};
}
async function token(userId:string){
 return signJWT({sub:userId,name:'Synthetic Test',email:''},jwtSecret);
}
const json=(userToken:string,user_id:string)=>({method:'POST',headers:{Authorization:'Bearer '+userToken,'Content-Type':'application/json'},body:JSON.stringify({user_id})});

describe('Private contact reconciliation with existing members',()=>{
 it('links only an already joined room member and updates contact status without creating membership',async()=>{
  const f=fixture();const auth=await token('host-1');
  const before=await router.request(base+'/events/room-1/phone-contacts',{headers:{Authorization:'Bearer '+auth}},f.env);
  expect(before.status).toBe(200);
  expect((await before.json() as any).contacts[0].status).toBe('approved_awaiting_member');
  const r=await router.request(base+'/events/room-1/phone-contacts/contact-1/link-member',json(auth,'member-1'),f.env);
  expect(r.status,await r.clone().text()).toBe(200);
  expect((await r.json() as any).status).toBe('joined');
  expect(f.state.contactUserId).toBe('member-1');
  expect(f.state.revoked).toBe(1);
  expect(f.state.linked).toBe(1);
  expect(f.kv.has('join-request:room-1:claim1')).toBe(false);
  expect(f.kv.has('approved-contact:room-1:contact-1')).toBe(false);
  const after=await router.request(base+'/events/room-1/phone-contacts',{headers:{Authorization:'Bearer '+auth}},f.env);
  expect((await after.json() as any).contacts[0].status).toBe('joined');
  const again=await router.request(base+'/events/room-1/phone-contacts/contact-1/link-member',json(auth,'member-1'),f.env);
  expect(again.status).toBe(200);
  expect(f.state.linked).toBe(1);
 });
 it('rejects member impersonation without a host role',async()=>{
  const f=fixture();const auth=await token('member-1');
  const r=await router.request(base+'/events/room-1/phone-contacts/contact-1/link-member',json(auth,'cohost-1'),f.env);
  expect(r.status).toBe(403);expect(f.state.linked).toBe(0);
 });
 it('rejects accounts not approved for this room',async()=>{
  const f=fixture();const auth=await token('host-1');
  const r=await router.request(base+'/events/room-1/phone-contacts/contact-1/link-member',json(auth,'stranger-1'),f.env);
  expect(r.status).toBe(409);expect(f.state.linked).toBe(0);
 });
 it('cannot link a contact from a different room',async()=>{
  const f=fixture();const auth=await token('host-1');
  const r=await router.request(base+'/events/room-1/phone-contacts/contact-cross-room/link-member',json(auth,'member-1'),f.env);
  expect(r.status).toBe(404);
 });
 it('cannot link host account or duplicate an account already attached to another contact',async()=>{
  const f=fixture();const auth=await token('host-1');
  const asHost=await router.request(base+'/events/room-1/phone-contacts/contact-1/link-member',json(auth,'host-1'),f.env);
  expect(asHost.status).toBe(403);
  f.state.secondContactUserId='member-1';
  const duplicate=await router.request(base+'/events/room-1/phone-contacts/contact-1/link-member',json(auth,'member-1'),f.env);
  expect(duplicate.status).toBe(409);expect(f.state.linked).toBe(0);
 });
 it('does not mark an orphaned link joined after room membership is revoked',async()=>{
  const f=fixture();f.state.contactUserId='member-1';f.state.members.delete('member-1');
  const auth=await token('host-1');
  const r=await router.request(base+'/events/room-1/phone-contacts',{headers:{Authorization:'Bearer '+auth}},f.env);
  expect(r.status).toBe(200);
  expect((await r.json() as any).contacts[0].status).not.toBe('joined');
 });
});

