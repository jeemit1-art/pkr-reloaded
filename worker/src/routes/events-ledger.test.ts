import {describe,it,expect,vi} from 'vitest';
vi.mock('../middleware',()=>({
  authMiddleware:async(c:any,next:any)=>{c.set('userId',c.env.TEST_USER||'member');await next();},
  optionalAuth:async(_c:any,next:any)=>next(),
  requireEventRole:async(c:any,eventId:string)=>eventId==='room-one'&&c.get('userId')!=='outsider',
  generateId:()=> 'synthetic-id',
  getPlanStatus:async()=>({is_active:true,max_groups:10}),
}));
import events from './events';

const games=[
  {id:'historic',event_id:'room-one',status:'settled',scheduled_at:111,
    results_token:null,location:'Old venue',notes:null,seats:8,live_token:null,created_at:10},
  {id:'new',event_id:'room-one',status:'settled',scheduled_at:222,
    results_token:'link-new',location:'New venue',notes:null,seats:9,live_token:null,created_at:11},
  {id:'running',event_id:'room-one',status:'active',scheduled_at:333,
    results_token:null,location:null,notes:null,seats:9,live_token:null,created_at:12},
  {id:'another-room',event_id:'room-two',status:'settled',scheduled_at:333,
    results_token:'hidden',location:null,notes:null,seats:9,live_token:null,created_at:13},
];
const transfers=[
  {id:'historic-paid',game_id:'historic',from:'member',to:'host',
    from_name:'Synthetic member',to_name:'Synthetic host',amount:7523500,
    status:'paid',paid_at:321},
  {id:'current-owed',game_id:'new',from:'member',to:'host',
    from_name:'Synthetic member',to_name:'Synthetic host',amount:7500,
    status:'owed',paid_at:null},
  {id:'other-room-transfer',game_id:'another-room',from:'outsider',to:'host',
    from_name:'Other',to_name:'Synthetic host',amount:4000,status:'owed',paid_at:null},
];
function fixture(user:string){
  const queried:string[]=[];
  let written=0;
  const env:any={TEST_USER:user,DB:{
    prepare(sql:string){
      queried.push(sql);
      if(!/^\s*SELECT\b/i.test(sql))written++;
      return {bind(eventId:string){return {async all(){
        if(sql.includes('FROM games WHERE event_id=?')){
          return {results:games.filter(g=>g.event_id===eventId&&g.status==='settled')};
        }
        if(sql.includes('FROM settlement_transfers t')){
          expect(sql).toContain('t.from_user AS "from"');
          expect(sql).toContain('t.to_user AS "to"');
          return {results:transfers.filter(t=>games.some(g=>
            g.id===t.game_id&&g.event_id===eventId&&g.status==='settled'))};
        }
        throw new Error('Unexpected read statement');
      }}}};
    },
    async batch(statements:any[]){return Promise.all(statements.map(s=>s.all()));},
  }};
  return {env,queried,written:()=>written,call:()=>events.request(
    'https://synthetic.invalid/room-one/settlement-ledger',{method:'GET'},env)};
}
describe('authenticated read-only room settlement ledger',()=>{
  it('reads verified old payments without loading unrelated game-detail or RSVP tables',async()=>{
    const f=fixture('member'),response=await f.call();
    expect(response.status).toBe(200);
    const result=await response.json() as {games:any[];transfers:any[]};
    expect(result.games.map(g=>g.id)).toEqual(['historic','new']);
    expect(result.transfers.map(t=>t.id)).toEqual(['historic-paid','current-owed']);
    expect(result.transfers.map(t=>t.status)).toEqual(['paid','owed']);
    expect(result.transfers[0].amount).toBe(7523500);
    expect(result.transfers[0].from).toBe('member');
    expect(result.games[0].results_token).toBeNull();
    expect(f.written()).toBe(0);
    expect(f.queried).toHaveLength(2);
    expect(f.queried.some(sql=>/game_rsvp|game_players|game_player_revisions/.test(sql))).toBe(false);
  });
  it('rejects nonmembers without touching the room ledger',async()=>{
    const f=fixture('outsider'),response=await f.call();
    expect(response.status).toBe(403);
    expect(f.queried).toHaveLength(0);
  });
});