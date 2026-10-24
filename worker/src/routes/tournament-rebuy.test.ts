import {describe,expect,it,vi} from 'vitest';
vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','synthetic-host');await next();},
    requireEventRole:async()=>true};
});
import tournament from './tournament';
type Receipt={id:string;game_id:string;player_name:string;type:string;chips:number;amount_paid:number};
function fixture(opts?:{status?:string;rebuy?:number;addon?:number;level?:number;player?:boolean}){
  const game={id:'g',event_id:'e',status:opts?.status??'active'};
  const state={game_id:'g',status:'running',current_level:opts?.level??1,
    starting_chips:1000,buy_in_amount:2000,rebuy_allowed:opts?.rebuy??1,
    rebuy_levels:4,addon_allowed:opts?.addon??0,addon_chips:500,
    total_chips_in_play:5000};
  const receipts=new Map<string,Receipt>();
  let batches=0;
  const db={prepare(sql:string){return {bind(...args:any[]){
    return {sql,args,
      async first():Promise<any>{
        if(sql.includes('FROM games WHERE id=?'))return {...game};
        if(sql.includes('FROM tournament_state WHERE game_id=?'))return {...state};
        if(sql.includes('FROM tournament_rebuys WHERE id=?'))return receipts.get(args[0])??null;
        if(sql.includes('FROM game_players WHERE game_id=?'))return opts?.player===false?null:{user_id:'alice'};
        return null;
      },
    };
  }};},
    async batch(stmts:any[]):Promise<any[]>{
      batches++;
      const [credit,receipt]=stmts;
      if(!credit.sql.includes('NOT EXISTS (SELECT 1 FROM tournament_rebuys')||
         !receipt.sql.includes('changes()=1'))
        throw Error('Idempotent SQL guards were not applied');
      const [chips,gameId,type,otherType,maxAmount,key]=credit.args;
      const can=state.status==='running'&&gameId==='g'&&
        game.status!=='settled'&&game.status!=='cancelled'&&
        !receipts.has(key)&&
        ((type==='rebuy'&&state.rebuy_allowed===1&&state.current_level<=state.rebuy_levels)||
          (otherType==='addon'&&state.addon_allowed===1))&&
        state.total_chips_in_play<=maxAmount;
      let changed=0;
      if(can){state.total_chips_in_play+=chips;changed=1;}
      const [id,gameId2,name,kind,amount,cost]=receipt.args;
      if(changed)receipts.set(id,{id,game_id:gameId2,player_name:name,type:kind,
        chips:amount,amount_paid:cost});
      return [{meta:{changes:changed}},{meta:{changes:changed}}];
    },
  };
  return {env:{DB:db,PKR_ENV:'staging',JWT_SECRET:'fixture'} as any,
    game,state,receipts,batches:()=>batches};
}
const url='https://fixture.invalid/games/g/tournament/rebuy';
const payload={idempotency_key:'synthetic-request-00001',player_name:'Alice',
  type:'rebuy',chips:1000,amount_paid:2000};
const post=(body:unknown):RequestInit=>({
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
});
const exec:any={waitUntil:(_:Promise<unknown>)=>{}};
describe('idempotent rebuy and add-on accounting',()=>{
  it('credits chips once even when the same request is retried twice',async()=>{
    const f=fixture();
    const first=await tournament.request(url,post(payload),f.env,exec);
    expect(first.status).toBe(200);
    const second=await tournament.request(url,post(payload),f.env,exec);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ok:true,already_applied:true});
    expect(f.receipts.size).toBe(1);
    expect(f.state.total_chips_in_play).toBe(6000);
    expect(f.batches()).toBe(1);
  });
  it('rejects concurrent identical requests without doubling the chip pool',async()=>{
    const f=fixture();
    const [a,b]=await Promise.all([
      tournament.request(url,post(payload),f.env,exec),
      tournament.request(url,post(payload),f.env,exec),
    ]);
    expect(a.status).toBe(200);expect(b.status).toBe(200);
    expect(f.state.total_chips_in_play).toBe(6000);
    expect(f.receipts.size).toBe(1);
  });
  it('refuses an absent key or the same key used for another player or amount',async()=>{
    const f=fixture();
    const missing=await tournament.request(url,post({...payload,idempotency_key:''}),f.env,exec);
    expect(missing.status).toBe(428);
    await tournament.request(url,post(payload),f.env,exec);
    const duplicate=await tournament.request(url,post({...payload,player_name:'Bob'}),f.env,exec);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({code:'REBUY_CONFLICT'});
    expect(f.state.total_chips_in_play).toBe(6000);
  });
  it('refuses rebuy after the allowed levels or when not enabled',async()=>{
    for(const options of [{level:5},{rebuy:0}]){
      const f=fixture(options);
      const response=await tournament.request(url,post(payload),f.env,exec);
      expect(response.status).toBe(409);
      expect(f.batches()).toBe(0);
      expect(f.state.total_chips_in_play).toBe(5000);
    }
  });
  it('rejects incorrect chips, missing players and already closed games',async()=>{
    const f=fixture();
    expect((await tournament.request(url,post({...payload,chips:10000}),f.env,exec)).status).toBe(400);
    const noPlayer=fixture({player:false});
    expect((await tournament.request(url,post(payload),noPlayer.env,exec)).status).toBe(409);
    const closed=fixture({status:'settled'});
    expect((await tournament.request(url,post(payload),closed.env,exec)).status).toBe(409);
    expect(f.batches()).toBe(0);
  });
  it('accepts an enabled add-on with its configured number of chips',async()=>{
    const f=fixture({addon:1});
    const add={...payload,idempotency_key:'synthetic-addon-00001',
      type:'addon',chips:500};
    const r=await tournament.request(url,post(add),f.env,exec);
    expect(r.status).toBe(200);
    expect(f.state.total_chips_in_play).toBe(5500);
  });
});
