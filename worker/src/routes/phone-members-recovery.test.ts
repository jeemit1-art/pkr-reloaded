import {describe,it,expect,vi} from 'vitest';

vi.mock('../middleware',async importOriginal=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,authMiddleware:async(c:any,next:any)=>{
    c.set('userId','synthetic-host');await next();
  },requireEventRole:async()=>true};
});
vi.mock('../phone-security',async importOriginal=>{
  const original=await importOriginal<typeof import('../phone-security')>();
  return {...original,phoneMembersReady:()=>true,
    decryptPhone:async()=>'+61400123456',maskMobile:()=>'+61••••3456',
    phoneLookup:async(_env:any,kind:string,input:string)=>kind+':'+input};
});
vi.mock('../push',()=>({sendPushToHosts:vi.fn(async()=>0)}));

import routes from './phone-members';

function fixture(){
  const values=new Map<string,string>();
  const request='join-request:room:claim-hash';
  const state={
    event_id:'room',invite_id:'inv-1',contact_id:'contact-1',
    role:'member',display_name:'Returning Player',claim_hash:'claim-hash',
    requested_at:Date.now(),
  };
  values.set(request,JSON.stringify(state));
  const queries:string[]=[];
  const db={
    prepare(sql:string){
      queries.push(sql);
      return {bind(..._args:any[]){
        return {
          async all(){return {results:sql.includes('SELECT id,contact_id,role,expires_at FROM group_phone_invites')?[{id:'inv-1',contact_id:'contact-1',role:'member',expires_at:Math.floor(Date.now()/1000)+7200}]:[]};},
          async run(){return {meta:{changes:1}};},
          async first():Promise<any>{
            if(sql.includes('SELECT role FROM event_members'))return {role:'member'};
            if(sql.includes('SELECT name,email FROM users'))return {name:'Original Member',email:''};
            if(sql.includes('FROM group_phone_contacts WHERE id=? AND event_id=?'))
              return {display_name:'Returning Player',phone_cipher:'synthetic',user_id:'existing-member'};
            if(sql.includes('FROM group_phone_invites WHERE id=? AND event_id=?'))
              return {id:'inv-1',expires_at:Math.floor(Date.now()/1000)+7200};
            if(sql.includes('FROM group_phone_invites WHERE id=? AND event_id=? AND contact_id=?'))
              return {id:'inv-1'};
            if(sql.includes('SELECT user_id FROM group_phone_contacts WHERE id=? AND event_id=?'))
              return {user_id:'existing-member'};
            return null;
          }
        };
      }};
    },
    async batch(items:any[]):Promise<any[]>{
      return items.map((item:any)=>({meta:{changes:1}}));
    }
  };
  const kv={
    async get(key:string){return values.get(key)||null;},
    async put(key:string,value:string){values.set(key,value);},
    async delete(key:string){values.delete(key);},
    async list({prefix}:{prefix:string}){return {
      keys:[...values.keys()].filter(key=>key.startsWith(prefix)).map(name=>({name})),
      list_complete:true,
    };},
  };
  const env:any={PKR_ENV:'staging',PKR_PHONE_MEMBERS_V1:'1',DB:db,KV:kv,
    JWT_SECRET:'fictional-only-test-secret'};
  const post=(path:string,body:any)=>routes.request('https://fixture.invalid'+path,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  },env);
  return {env,values,queries,state,post,request};
}

describe('member approval and same-account recovery',()=>{
  it('shows existing-member recovery requests to the host',async()=>{
    const f=fixture();
    const response=await routes.request('https://fixture.invalid/events/room/join-requests',{},f.env);
    expect(response.status).toBe(200);
    const body=await response.json() as any;
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({
      id:'claim-hash',name:'Returning Player',recovery:true,
    });
  });
  it('approves recovery and reuses the exact existing user ID',async()=>{
    const f=fixture();
    const approval=await f.post('/events/room/join-requests/claim-hash/decision',{approve:true});
    expect(approval.status).toBe(200);
    const secret='a'.repeat(64);
    // The public claim hash is derived from the claimant's secret, never the
    // original phone number. This synthetic fixture uses a predictable hash.
    f.values.set('approved-join:claim:'+secret,JSON.stringify({...f.state,claim_hash:'claim:'+secret}));
    const claim=await f.post('/phone-invites/complete-approval',{claim:secret});
    expect(claim.status).toBe(200);
    const body=await claim.json() as any;
    expect(body.ok).toBe(true);
    expect(body.event_id).toBe('room');
    const payload=JSON.parse(atob(body.token.split('.')[1]));
    expect(payload.sub).toBe('existing-member');
    expect(f.queries.some(q=>q.includes('INSERT INTO users'))).toBe(false);
    expect(f.queries.some(q=>q.includes('INSERT INTO event_members'))).toBe(true);
  });
  it('tells rejected applicants that they were declined rather than waiting indefinitely',async()=>{
    const f=fixture();
    expect((await f.post('/events/room/join-requests/claim-hash/decision',{approve:false})).status).toBe(200);
    const secret='b'.repeat(64);
    f.values.set('rejected-join:claim:'+secret,'1');
    const result=await f.post('/phone-invites/complete-approval',{claim:secret});
    expect(result.status).toBe(403);
    expect((await result.json() as any).status).toBe('rejected');
  });
});
