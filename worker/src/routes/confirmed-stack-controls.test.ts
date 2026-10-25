import {describe,expect,it,vi} from 'vitest';

vi.mock('../middleware',async(importOriginal)=>{
  const original=await importOriginal<typeof import('../middleware')>();
  return {...original,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','fixture-host');await next();},
    requireEventRole:async()=>true};
});
import hands from './hands';

const roster=[
  {user_id:'dealer',display_name:'Dealer',seat_number:1,buy_ins:1},
  {user_id:'small',display_name:'Small',seat_number:4,buy_ins:1},
  {user_id:'big',display_name:'Big',seat_number:3,buy_ins:1},
  {user_id:'utg',display_name:'UTG',seat_number:2,buy_ins:1},
];
const opening=roster.map(p=>({...p,opening_chips:100}));
const base='https://fixture.invalid/games/g/hands/h';
const post=(value:unknown):RequestInit=>({
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),
});
const context:any={waitUntil:(_:Promise<unknown>)=>{}};

function fixture({enabled=true,started=true,hasActions=false}={}){
  const game={id:'g',event_id:'e',seats:4,status:'active'};
  const hand={id:'h',game_id:'g',mode:'full',voided:0,
    dealer_seat:1,sb_seat:4,bb_seat:3,straddle:0,pot_chips:0,
    created_at:1794000000};
  const confirmed:any[]=[];
  const history:any[]=hasActions?[{
    id:'existing',display_name:'Small',street:'pre',action:'post',chips:1,
  }]:[];
  let confirms=0;
  const db={
    prepare(sql:string){
      return {bind(...args:any[]){
        return {
          sql,args,
          async first():Promise<any>{
            if(sql.includes('FROM games WHERE id=?'))return {...game};
            if(sql.includes('SELECT id FROM hands WHERE id=? AND game_id=?'))return {id:'h'};
            if(sql.includes('SELECT id,mode,voided,created_at FROM hands WHERE id=?'))return {...hand};
            if(sql.includes('SELECT dealer_seat,sb_seat,bb_seat,straddle,mode'))return {...hand};
            if(sql.includes('SELECT pot_chips FROM hands WHERE id=?'))return {...hand};
            if(sql.includes('FROM hand_results WHERE hand_id=?'))return null;
            if(sql.includes('FROM hand_actions WHERE hand_id=? LIMIT 1'))return history[0]||null;
            return null;
          },
          async all():Promise<any>{
            if(sql.includes('FROM game_players'))return {results:roster.map(x=>({...x}))};
            if(sql.includes('FROM hand_stack_baselines'))
              return {results:confirmed.map(x=>({...x}))};
            if(sql.includes('FROM hand_actions'))
              return {results:history.map(x=>({...x}))};
            return {results:[]};
          },
          async run():Promise<any>{
            if(!sql.trimStart().startsWith('INSERT INTO hand_stack_baselines'))
              throw Error('Unexpected standalone write in confirmed stack fixture');
            if(!sql.includes('json_each(?)')||
               !sql.includes('NOT EXISTS(SELECT 1 FROM hand_actions')||
               !sql.includes('NOT EXISTS(SELECT 1 FROM hand_stack_baselines')||
               !sql.includes("status='active'"))
              throw Error('Missing conditional stack snapshot guards');
            const [handId,gameId,verifiedBy,json,rosterGame,count,again,checkGame]=args;
            const supplied=JSON.parse(json);
            if(!started||handId!=='h'||gameId!=='g'||rosterGame!=='g'||
               checkGame!=='g'||verifiedBy!=='fixture-host'||
               confirmed.length||history.length||count!==roster.length||
               JSON.stringify(supplied)!==again||
               !supplied.every((x:any)=>roster.some(p=>p.user_id===x.user_id&&
                 p.display_name===x.display_name&&p.seat_number===x.seat_number)))
              return {meta:{changes:0}};
            confirmed.push(...supplied);
            confirms++;
            return {meta:{changes:supplied.length}};
          },
        };
      }};
    },
    async batch(statements:any[]):Promise<any[]>{
      const results:any[]=[];
      for(const stmt of statements){
        if(stmt.sql.trimStart().startsWith('INSERT INTO hand_actions')){
          const expectedLast=stmt.args[stmt.args.length-1];
          const actualLast=history.length?history[history.length-1].id:null;
          if(expectedLast!==actualLast)return [{meta:{changes:0}},{meta:{changes:0}}];
          history.push({id:stmt.args[0],display_name:stmt.args[4],
            street:stmt.args[5],action:stmt.args[6],chips:stmt.args[7]});
          results.push({meta:{changes:1}});
        }else if(stmt.sql.includes('UPDATE hands SET pot_chips')){
          hand.pot_chips=history.reduce((n,a)=>n+a.chips,0);
          results.push({meta:{changes:1}});
        }else throw Error('Unknown D1 batch mutation');
      }
      return results;
    },
  };
  return {
    env:{DB:db,JWT_SECRET:'fixture',PKR_ENV:'staging',
      ...(enabled?{PKR_INTEGRITY_STACKS:'1'}:{})} as any,
    confirmed,history,game,hand,getConfirms:()=>confirms,
  };
}
async function confirm(f:ReturnType<typeof fixture>,body:unknown){
  return hands.request(base+'/confirm-stacks',post(body),f.env,context);
}
async function action(f:ReturnType<typeof fixture>,name:string,kind:string,chips:number){
  return hands.request(base+'/actions',
    post({display_name:name,street:'pre',action:kind,chips}),
    f.env,context);
}

describe('immutable host-verified opening stacks',()=>{
  it('stays disabled by default, without touching optional migration tables',async()=>{
    const f=fixture({enabled:false});
    const res=await confirm(f,{verified:true,opening_stacks:opening});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({code:'STACK_BASELINE_UNAVAILABLE'});
    expect(f.getConfirms()).toBe(0);
  });
  it('requires explicit verification and the entire exact unique seated roster',async()=>{
    const f=fixture();
    expect((await confirm(f,{verified:false,opening_stacks:opening})).status).toBe(400);
    expect((await confirm(f,{verified:true,opening_stacks:opening.slice(1)})).status).toBe(400);
    expect((await confirm(f,{verified:true,opening_stacks:[
      opening[0],opening[1],opening[2],opening[2],
    ]})).status).toBe(400);
    expect((await confirm(f,{verified:true,opening_stacks:[
      {...opening[0],opening_chips:0},...opening.slice(1),
    ]})).status).toBe(400);
    expect(f.getConfirms()).toBe(0);
  });
  it('accepts one fully verified snapshot and blocks concurrent re-confirmation',async()=>{
    const f=fixture();
    const [a,b]=await Promise.all([
      confirm(f,{verified:true,opening_stacks:opening}),
      confirm(f,{verified:true,opening_stacks:opening}),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,409]);
    expect(f.confirmed).toHaveLength(4);
    expect(f.getConfirms()).toBe(1);
    expect(await (a.status===409?a:b).json()).toMatchObject({
      code:'STACK_BASELINE_CONFLICT',
    });
  });
  it('cannot retrospectively confirm opening chips after recorded actions',async()=>{
    const f=fixture({hasActions:true});
    expect((await confirm(f,{verified:true,opening_stacks:opening})).status).toBe(409);
    expect(f.confirmed).toHaveLength(0);
  });
  it('grandfathers pre-October unfinished hands with real action history only',async()=>{
    const f=fixture({hasActions:true});f.hand.created_at=1775400000;
    const read=await hands.request(base+'/stack-baseline',{},f.env,context);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({enabled:false,confirmed:false,legacy_unverified:true});
    const next=await action(f,'Big','post',2);
    expect(next.status).toBe(200);
    expect(f.history).toHaveLength(2);
    expect(f.confirmed).toHaveLength(0);
  });
  it('does not grandfather a new hand merely because it already has actions',async()=>{
    const f=fixture({hasActions:true});
    const next=await action(f,'Big','post',2);
    expect(next.status).toBe(428);
    expect(await next.json()).toMatchObject({code:'STACK_BASELINE_REQUIRED'});
    expect(f.history).toHaveLength(1);
  });
  it('requires a confirmed baseline before recording even the first blind',async()=>{
    const f=fixture();
    const res=await action(f,'Small','post',1);
    expect(res.status).toBe(428);
    expect(await res.json()).toMatchObject({code:'STACK_BASELINE_REQUIRED'});
    expect(f.history).toHaveLength(0);
  });
  it('rejects over-stack wagers and false all-ins, but accepts a genuine all-in',async()=>{
    const f=fixture();
    expect((await confirm(f,{verified:true,opening_stacks:opening})).status).toBe(200);
    expect((await action(f,'Small','post',1)).status).toBe(200);
    expect((await action(f,'Big','post',2)).status).toBe(200);
    const excessive=await action(f,'UTG','allin',101);
    expect(excessive.status).toBe(409);
    expect(await excessive.json()).toMatchObject({code:'STACK_LIMIT_CONFLICT'});
    const falseAllin=await action(f,'UTG','allin',5);
    expect(falseAllin.status).toBe(409);
    expect(await falseAllin.json()).toMatchObject({code:'STACK_LIMIT_CONFLICT'});
    expect(f.history).toHaveLength(2);
    const accepted=await action(f,'UTG','allin',100);
    expect(accepted.status).toBe(200);
    expect(f.history).toHaveLength(3);
    expect(f.hand.pot_chips).toBe(103);
  });
});
