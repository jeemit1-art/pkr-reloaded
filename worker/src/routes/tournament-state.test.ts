import {describe,expect,it,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true,
    getPlanStatus:async()=>({is_active:true,plan:'pro',trial_active:false,max_groups:null,max_seats:15})};
});
import tournament from './tournament';
const config={
  starting_chips:1000,buy_in_amount:2000,rebuy_allowed:true,rebuy_levels:3,
  addon_allowed:true,addon_chips:500,
  payout_structure:[{place:1,pct:50},{place:2,pct:30},{place:3,pct:20}],
  levels:[
    {level_num:1,small_blind:25,big_blind:50,ante:0,duration_secs:900,is_break:false},
    {level_num:2,small_blind:50,big_blind:100,ante:0,duration_secs:900,is_break:false},
  ],
};
const url='https://fixture.invalid/games/g/tournament';
const post=(body?:any):RequestInit=>({
  method:'POST',headers:{'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
});
const execution:any={waitUntil:(_:Promise<unknown>)=>{}};
function fixture(){
  const game={id:'g',event_id:'e',status:'active'};
  const state:any={game_id:'g',status:'setup',current_level:1,starting_chips:1000,
    buy_in_amount:2000,rebuy_allowed:1,rebuy_levels:3,addon_allowed:1,addon_chips:500,
    payout_structure:JSON.stringify(config.payout_structure),
    total_chips_in_play:0,level_started_at:null,started_at:null,paused_elapsed:0};
  const levels:any[]=config.levels.map(x=>({...x}));
  const receipts=[
    {id:'r1',game_id:'g',type:'rebuy',amount_paid:2000},
    {id:'r2',game_id:'g',type:'addon',amount_paid:500},
  ];
  const eliminations:any[]=[{game_id:'g',player_name:'Alice',finishing_position:3}];
  let batches=0;
  const db={prepare(sql:string){return {bind(...args:any[]){
    return {sql,args,
      async first():Promise<any>{
        if(sql.includes('FROM games WHERE id=?'))return {...game};
        if(sql.includes('SELECT host_id FROM events WHERE id=?'))return {host_id:'synthetic-host'};
        if(sql.includes('SELECT status FROM tournament_state WHERE game_id=?'))
          return {status:state.status};
        if(sql.includes('FROM tournament_state WHERE game_id=?'))return {...state};
        if(sql.includes('COUNT(*) AS cnt FROM game_players'))return {cnt:3};
        if(sql.includes('FROM tournament_levels WHERE game_id=? AND level_num=1'))
          return levels[0]??null;
        if(sql.includes('FROM tournament_levels WHERE game_id=? AND level_num=?'))
          return levels.find(l=>l.level_num===args[1])??null;
        return null;
      },
      async all():Promise<any>{
        if(sql.includes('FROM tournament_levels'))return {results:levels.map(x=>({...x}))};
        if(sql.includes('FROM tournament_rebuys'))return {results:receipts.map(x=>({...x}))};
        if(sql.includes('FROM tournament_eliminations'))
          return {results:eliminations.map(x=>({...x}))};
        return {results:[]};
      },
      async run():Promise<any>{
        if(sql.includes('SET status=\'running\',started_at=')){
          if(state.status!=='setup')return {meta:{changes:0}};
          state.status='running';state.level_started_at=args[1];
          state.current_level=1;state.total_chips_in_play=args[2];
          return {meta:{changes:1}};
        }
        if(sql.includes('SET current_level=?,level_started_at=?')){
          if(state.status!=='running'||state.current_level!==args[3]||
             (sql.includes('AND level_started_at=?')&&state.level_started_at!==args[4]))
            return {meta:{changes:0}};
          state.current_level=args[0];state.level_started_at=args[1];
          return {meta:{changes:1}};
        }
        if(sql.includes("SET status='paused'")){
          if(state.status!=='running'||state.current_level!==args[2])
            return {meta:{changes:0}};
          state.status='paused';state.paused_elapsed=args[0];
          return {meta:{changes:1}};
        }
        if(sql.includes("SET status='running',level_started_at=?")){
          if(state.status!=='paused'||state.current_level!==args[2])
            return {meta:{changes:0}};
          state.status='running';state.level_started_at=args[0];
          state.paused_elapsed=0;return {meta:{changes:1}};
        }
        throw Error('Unexpected state mutation');
      },
    };
  }};},
    async batch(stmts:any[]):Promise<any[]>{
      batches++;
      const first=stmts[0];
      if(!first.sql.includes("WHERE tournament_state.status='setup'")||
         !stmts[1].sql.includes("status='setup'"))
        throw Error('Tournament setup transaction missing safety guards');
      if(state.status!=='setup')return stmts.map(()=>({meta:{changes:0}}));
      state.starting_chips=first.args[3];
      state.buy_in_amount=first.args[4];
      state.payout_structure=first.args[9];
      levels.splice(0,levels.length,...stmts.slice(2).map((x:any)=>({
        level_num:x.args[2],small_blind:x.args[3],big_blind:x.args[4],
        ante:x.args[5],duration_secs:x.args[6],is_break:x.args[7],
      })));
      return stmts.map(()=>({meta:{changes:1}}));
    },
  };
  return {env:{DB:db,PKR_ENV:'staging',JWT_SECRET:'fixture'} as any,
    game,state,levels,receipts,eliminations,batches:()=>batches};
}
describe('tournament start, setup and server prize calculations',()=>{
  it('reports receipt-based pool and every elimination after reload',async()=>{
    const f=fixture();
    const res=await tournament.request(url,{},f.env,execution);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      prize_pool_cents:8500,
      payouts:[{place:1,amount:4250},{place:2,amount:2550},{place:3,amount:1700}],
      eliminations:[{player_name:'Alice',finishing_position:3}],
    });
  });
  it('validates all blind levels before any configuration is modified',async()=>{
    const f=fixture();
    const invalid=await tournament.request(url+'/setup',post({
      ...config,levels:[{...config.levels[0],duration_secs:-1}],
    }),f.env,execution);
    expect(invalid.status).toBe(400);
    expect(f.batches()).toBe(0);
    const okay=await tournament.request(url+'/setup',post(config),f.env,execution);
    expect(okay.status).toBe(200);
    expect(f.batches()).toBe(1);
    expect(f.levels).toHaveLength(2);
    expect(f.state.buy_in_amount).toBe(2000);
  });
  it('does not allow configuration to reset a tournament already running',async()=>{
    const f=fixture();f.state.status='running';
    const response=await tournament.request(url+'/setup',post(config),f.env,execution);
    expect(response.status).toBe(409);
    expect(f.batches()).toBe(0);
  });
  it('rejects a repeated start and prevents duplicate tournament chip allocations',async()=>{
    const f=fixture();
    expect((await tournament.request(url+'/start',post(),f.env,execution)).status).toBe(200);
    const chips=f.state.total_chips_in_play;
    expect((await tournament.request(url+'/start',post(),f.env,execution)).status).toBe(409);
    expect(chips).toBe(3000);
    expect(f.state.total_chips_in_play).toBe(chips);
  });
  it('only advances one level when two hosts press next simultaneously',async()=>{
    const f=fixture();f.state.status='running';
    const [a,b]=await Promise.all([
      tournament.request(url+'/next-level',post(),f.env,execution),
      tournament.request(url+'/next-level',post(),f.env,execution),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,409]);
    expect(f.state.current_level).toBe(2);
  });
  it('advances only when the server clock says a stage has expired',async()=>{
    const f=fixture();f.state.status='running';
    f.state.level_started_at=Math.floor(Date.now()/1000)-899;
    const premature=await tournament.request(url+'/advance-due',post(),f.env,execution);
    expect(premature.status).toBe(200);
    expect((await premature.json() as any).advanced).toBe(false);
    expect(f.state.current_level).toBe(1);
    f.state.level_started_at=Math.floor(Date.now()/1000)-905;
    const next=await tournament.request(url+'/advance-due',post(),f.env,execution);
    expect(next.status).toBe(200);
    expect((await next.json() as any).advanced).toBe(true);
    expect(f.state.current_level).toBe(2);
    const duplicate=await tournament.request(url+'/advance-due',post(),f.env,execution);
    expect((await duplicate.json() as any).advanced).toBe(false);
    expect(f.state.current_level).toBe(2);
  });
  it('derives paused time from the Worker rather than a client-supplied value',async()=>{
    const f=fixture();f.state.status='running';
    f.state.level_started_at=Math.floor(Date.now()/1000)-42;
    const result=await tournament.request(url+'/pause',post({paused_elapsed:999999}),f.env,execution);
    expect(result.status).toBe(200);
    expect(f.state.paused_elapsed).toBeGreaterThanOrEqual(42);
    expect(f.state.paused_elapsed).toBeLessThan(45);
    const resume=await tournament.request(url+'/pause',post({paused_elapsed:999999}),f.env,execution);
    expect(resume.status).toBe(200);
    expect(f.state.status).toBe('running');
  });
});
