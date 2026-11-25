import {describe,it,expect,vi} from 'vitest';
vi.mock('../middleware',()=>({
  authMiddleware:async(c:any,next:any)=>{c.set('userId',c.env.TEST_USER||'member');await next();},
  optionalAuth:async(_c:any,next:any)=>next(),
  requireEventRole:async(c:any,roomId:string,needed:string)=>{
    if(roomId!=='room-one')return false;
    const roles:Record<string,number>={host:3,cohost:2,member:1,outsider:0};
    return (roles[c.get('userId')]||0)>=(roles[needed]||99);
  },
  generateId:()=> 'fictional-record-id',
  getPlanStatus:async()=>({is_active:true,max_groups:10}),
}));
import events from './events';

function fixture(overlapping=false){
  // This in-memory DB deliberately permits SELECT only. Every historical
  // game result remains immutable, even after a confirmed host alias link.
  const rows=[
    ...Array.from({length:5},(_,i)=>({
      game_id:'early-'+i,user_id:'guest-a',display_name:'Sam',
      net:i===0?-25500:0,settled_at:100+i,scheduled_at:100+i,
    })),
    ...Array.from({length:4},(_,i)=>({
      game_id:overlapping&&i===0?'early-0':'recent-'+i,user_id:'member-b',
      display_name:'Sam Patel',net:i===0?-111000:0,
      settled_at:200+i,scheduled_at:200+i,
    })),
  ];
  const saved=JSON.stringify(rows);
  const kvStore=new Map<string,string>();
  const queries:string[]=[],dbWrites:string[]=[];
  const DB:any={prepare(sql:string){
    queries.push(sql);
    if(!/^\s*SELECT\b/i.test(sql))dbWrites.push(sql);
    return {bind(...args:any[]){
      return {async all(){
        if(sql.includes('FROM game_players gp JOIN games g'))return {
          results:rows.filter(x=>args[0]==='room-one')
        };
        if(sql.includes('SELECT DISTINCT u.id'))return {results:[]};
        if(sql.includes('FROM event_players')||sql.includes('FROM event_members')||sql.includes('JOIN event_members')||
           sql.includes('FROM room_player_profiles'))return {results:[]};
        throw Error('Unexpected query '+sql);
      }};
    }};
  }};
  const KV:any={
    get:async(key:string)=>kvStore.get(key)||null,
    put:async(key:string,value:string)=>{kvStore.set(key,value);},
    delete:async(key:string)=>{kvStore.delete(key);},
    list:async({prefix}:{prefix:string})=>({
      keys:[...kvStore.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),
      list_complete:true,
    }),
  };
  const call=(user:string,method:string,resource:string,body?:unknown)=>
    events.request('https://fake.example.invalid/room-one/'+resource,{
      method,headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),
    },{TEST_USER:user,DB,KV} as any);
  const merge=(user='host',changes:Record<string,unknown>={})=>call(user,'POST','players/merge',{
    from_user_id:'guest-a',to_user_id:'member-b',from_games:5,to_games:4,
    from_net:-25500,to_net:-111000,confirm_same_person:true,...changes,
  });
  return {rows,saved,kvStore,queries,dbWrites,call,merge};
}
describe('host-controlled player history merging without financial writes',()=>{
  it('fixes the old 404, combines nine recorded games and allows undo',async()=>{
    const f=fixture();
    const result=await f.merge();
    expect(result.status).toBe(200);
    const body=await result.json() as any;
    expect(body.ok).toBe(true);
    expect(body.leaders).toHaveLength(1);
    expect(body.leaders[0]).toMatchObject({
      user_id:'member-b',display_name:'Sam Patel',games_played:9,total_net:-136500,
    });
    expect(body.leaders[0].source_game_players).toHaveLength(9);
    expect(JSON.stringify(f.rows)).toBe(f.saved);
    expect(f.dbWrites).toHaveLength(0);
    const loaded=await f.call('member','GET','leaderboard');
    expect(loaded.status).toBe(200);
    const leaders=await loaded.json() as any[];
    expect(leaders).toHaveLength(1);
    expect(leaders[0].total_net).toBe(-136500);
    const history=await f.call('host','GET','players/merges');
    expect((await history.json() as any).merges).toHaveLength(1);
    const undo=await f.call('host','DELETE','players/merge/guest-a');
    expect(undo.status).toBe(200);
    expect((await undo.json() as any).leaders).toHaveLength(2);
    expect(f.dbWrites).toHaveLength(0);
    expect(JSON.stringify(f.rows)).toBe(f.saved);
    expect([...f.kvStore.keys()].filter(k=>k.startsWith('room-player-merge-audit:')).length).toBe(2);
  });
  it('never allows cohosts, members or outsiders to combine histories',async()=>{
    const f=fixture();
    for(const role of ['member','cohost','outsider'])
      expect((await f.merge(role)).status).toBe(403);
    expect(f.dbWrites).toHaveLength(0);
    expect(f.kvStore.size).toBe(0);
  });
  it('fails closed when the game counts or money have changed since the preview',async()=>{
    const f=fixture();
    expect((await f.merge('host',{from_net:-1})).status).toBe(409);
    expect((await f.merge('host',{to_games:99})).status).toBe(409);
    expect((await f.merge('host',{confirm_same_person:false})).status).toBe(400);
    expect(f.kvStore.size).toBe(0);
  });
  it('does not combine two recorded seats in one game',async()=>{
    const f=fixture(true);
    const result=await f.merge();
    expect(result.status).toBe(409);
    expect((await result.json() as any).error).toMatch(/same game/);
    expect(f.kvStore.size).toBe(0);
    expect(f.dbWrites).toHaveLength(0);
  });
  it('does not expose another room or apply the same merge twice',async()=>{
    const f=fixture();
    expect((await f.call('host','POST','players/merge',{from_user_id:'unknown'})).status).toBe(400);
    expect((await f.merge()).status).toBe(200);
    expect((await f.merge()).status).toBe(409);
    expect(f.dbWrites).toHaveLength(0);
  });
});
