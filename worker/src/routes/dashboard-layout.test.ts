import {describe,it,expect,vi} from 'vitest';
vi.mock('../middleware',()=>({
  authMiddleware:async(c:any,next:any)=>{c.set('userId',c.env.TEST_USER||'member');await next();},
  optionalAuth:async(_c:any,next:any)=>next(),
  requireEventRole:async(c:any,eventId:string,required:string)=>{
    if(!['room-one','room-two'].includes(eventId))return false;
    const levels:Record<string,number>={host:3,cohost:2,member:1,outsider:0};
    const current=levels[c.get('userId')]||0;
    return current>=(levels[required]||99);
  },
  generateId:()=> 'synthetic-id',
  getPlanStatus:async()=>({is_active:true,max_groups:10}),
}));
import events from './events';

function fixture(){
  const store=new Map<string,string>(),writes:string[]=[];
  let d1Writes=0;
  const call=(user:string,room:string,method='GET',data?:unknown)=>{
    const env:any={TEST_USER:user,KV:{
      async get(key:string){return store.get(key)||null;},
      async put(key:string,value:string){
        if(!key.startsWith('room-dashboard-layout:v1:'))throw Error('Unexpected KV key');
        writes.push(key);store.set(key,value);
      },
    },DB:{prepare(){d1Writes++;throw Error('The preference API must not touch D1');}}};
    return events.request('https://synthetic.invalid/'+room+'/dashboard-layout',
      {method,headers:{'Content-Type':'application/json'},
        body:data===undefined?undefined:JSON.stringify(data)},env);
  };
  return {call,writes,store,d1Writes:()=>d1Writes};
}
describe('host-controlled room dashboard variants',()=>{
  it('defaults to Command Centre for approved members without any writes',async()=>{
    const f=fixture(),r=await f.call('member','room-one');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({event_id:'room-one',layout:'command',updated_at:null});
    expect(f.writes).toHaveLength(0);expect(f.d1Writes()).toBe(0);
  });
  it('lets only host save Live Poker and sees that choice on other devices',async()=>{
    const f=fixture();
    const updated=await f.call('host','room-one','PUT',{layout:'live'});
    expect(updated.status).toBe(200);
    const first=await updated.json() as {layout:string;updated_at:number};
    expect(first.layout).toBe('live');
    expect(first.updated_at).toBeGreaterThan(0);
    const secondDevice=await f.call('member','room-one');
    expect((await secondDevice.json()).layout).toBe('live');
    const separateRoom=await f.call('member','room-two');
    expect((await separateRoom.json()).layout).toBe('command');
    const switchedBack=await f.call('host','room-one','PUT',{layout:'command'});
    expect(switchedBack.status).toBe(200);
    expect((await (await f.call('cohost','room-one')).json()).layout).toBe('command');
    expect(f.writes).toEqual(['room-dashboard-layout:v1:room-one','room-dashboard-layout:v1:room-one']);
    expect(f.d1Writes()).toBe(0);
  });
  it('rejects members and cohosts who try to write',async()=>{
    const f=fixture();
    for(const user of ['member','cohost','outsider']){
      const r=await f.call(user,'room-one','PUT',{layout:'live'});
      expect(r.status).toBe(403);
    }
    const unreadable=await f.call('outsider','room-one');
    expect(unreadable.status).toBe(403);
    expect((await (await f.call('member','room-one')).json()).layout).toBe('command');
    expect(f.writes).toHaveLength(0);
  });
  it('rejects unexpected values and body fields without changing choice',async()=>{
    const f=fixture();
    for(const body of [{layout:'mockup'},{layout:'LIVE'},{layout:2},{layout:'live',role:'host'},{}]){
      const response=await f.call('host','room-one','PUT',body);
      expect(response.status).toBe(400);
    }
    expect(f.writes).toHaveLength(0);expect(f.d1Writes()).toBe(0);
  });
  it('requires approved room membership, never exposes other room selection',async()=>{
    const f=fixture();
    expect((await f.call('host','no-such-room')).status).toBe(403);
    expect((await f.call('member','no-such-room')).status).toBe(403);
  });
});