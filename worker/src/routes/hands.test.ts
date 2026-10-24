import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware')>();
  return {
    ...original,
    authMiddleware: async (c:any, next:any) => {
      c.set('userId','test-host');
      await next();
    },
    requireEventRole: async () => true,
  };
});

import hands from './hands';

type RecordedAction = {
  id:string;hand_id:string;game_id:string;user_id:string|null;
  display_name:string;street:string;action:string;chips:number;created_at:number;
};

function fixture(status = 'active', hasWinner = false) {
  const game = {
    id:'g',event_id:'e',status,hand_tracking:1,current_hand_no:2,
    current_dealer_seat:1,
  };
  const hand = {
    id:'h',game_id:'g',hand_no:2,board:'[]',pot_chips:0,mode:'full',
  };
  let actions:RecordedAction[] = [];
  let batchCalls = 0;
  const statements:string[] = [];

  function prepare(sql:string) {
    return {
      bind(...params:any[]) {
        return {
          sql,params,
          async first():Promise<any> {
            if (sql.includes('FROM games WHERE id=?')) return game;
            if (sql.includes('FROM hands WHERE id=? AND game_id=?')) return hand;
            if (sql.includes('SELECT id FROM hands WHERE id=? AND game_id=?')) return hand;
            if (sql.includes('FROM hand_results WHERE hand_id=?')) return hasWinner ? {id:'winner'} : null;
            if (sql.includes('FROM hand_actions WHERE hand_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1')) {
              return actions.length ? actions[actions.length-1] : null;
            }
            if (sql.includes('SELECT pot_chips FROM hands')) return {pot_chips:hand.pot_chips};
            return null;
          },
          async all():Promise<any> {
            if (sql.includes('FROM hand_actions WHERE hand_id=?')) return {results:actions.slice()};
            return {results:[]};
          },
          async run():Promise<any> {
            statements.push(sql);
            if (sql.startsWith('INSERT INTO hand_actions')) {
              const [id, hand_id, game_id, user_id, display_name, street, action, chips] = params;
              actions.push({id,hand_id,game_id,user_id,display_name,street,action,chips,created_at:123});
            }
            if (sql.startsWith('DELETE FROM hand_actions')) {
              actions = actions.filter(a=>a.id !== params[0]);
            }
            if (sql.includes('UPDATE hands SET pot_chips=(')) {
              hand.pot_chips = actions.filter(a=>a.action!=='fold')
                .reduce((sum,a)=>sum+a.chips,0);
            }
            return {meta:{changes:1}};
          },
        };
      },
    };
  }

  const db = {
    prepare,
    async batch(requests:Array<{run:()=>Promise<unknown>}>) {
      const oldActions = actions.slice();
      const oldPot = hand.pot_chips;
      batchCalls++;
      try {
        for (const stmt of requests) await stmt.run();
      } catch (error) {
        actions=oldActions;hand.pot_chips=oldPot;throw error;
      }
      return [];
    },
  };
  const env:any = { DB: db, PKR_ENV:'staging',JWT_SECRET:'test-only' };
  return {
    env,game,hand,statements,
    get actions(){return actions;},
    get batchCalls(){return batchCalls;},
  };
}

function action(name:string, chips:number, type = 'call') {
  return {display_name:name,street:'pre',action:type,chips};
}

function request(method:string,path:string,body?:unknown):RequestInit {
  return {
    method,
    ...(body===undefined ? {} : {
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),
    }),
  };
}

describe('hand-tracking record integrity',()=>{
  it('records actions and recalculates pot in a single database transaction',async()=>{
    const f=fixture();
    const res=await hands.request('https://test.invalid/games/g/hands/h/actions',
      request('POST','',action('Alice',40)),f.env);
    expect(res.status).toBe(200);
    expect(f.actions).toHaveLength(1);
    expect(f.hand.pot_chips).toBe(40);
    expect(f.batchCalls).toBe(1);
    expect(f.statements).toHaveLength(2);
  });

  it('undoes the last inserted action even if all actions have the same timestamp',async()=>{
    const f=fixture();
    for(const [name,amount] of [['Alice',20],['Bob',30],['Charlie',50]] as const){
      const res=await hands.request('https://test.invalid/games/g/hands/h/actions',
        request('POST','',action(name,amount)),f.env);
      expect(res.status).toBe(200);
    }
    expect(f.hand.pot_chips).toBe(100);
    const undo=await hands.request('https://test.invalid/games/g/hands/h/actions/last',
      request('DELETE',''),f.env);
    expect(undo.status).toBe(200);
    expect(f.actions.map(a=>a.display_name)).toEqual(['Alice','Bob']);
    expect(f.hand.pot_chips).toBe(50);
    expect(f.batchCalls).toBe(4);
  });

  it('does not add chips on check and fold',async()=>{
    const f=fixture();
    for(const type of ['check','fold']){
      const res=await hands.request('https://test.invalid/games/g/hands/h/actions',
        request('POST','',action('Alice',0,type)),f.env);
      expect(res.status).toBe(200);
    }
    expect(f.hand.pot_chips).toBe(0);
  });

  it('rejects invalid action chips, streets and identifiers without writing to D1',async()=>{
    const f=fixture();
    const invalid=[
      action('Alice',-5),
      action('Alice',2.1),
      action('Alice',Infinity),
      action('Alice',Number.MAX_SAFE_INTEGER+1),
      action('Alice',5,'fold'),
      action('Alice',5,'check'),
      action('Alice',0,'bet'),
      action('Alice',5,'unknown'),
      {...action('Alice',5),street:'invalid'},
      {...action('Alice',5),display_name:''},
    ];
    for(const bad of invalid) {
      const res=await hands.request('https://test.invalid/games/g/hands/h/actions',
        request('POST','',bad),f.env);
      expect(res.status).toBe(400);
    }
    expect(f.batchCalls).toBe(0);
    expect(f.actions).toHaveLength(0);
  });

  it('locks settled and cancelled games against new hand actions',async()=>{
    for(const status of ['settled','cancelled']){
      const f=fixture(status);
      const res=await hands.request('https://test.invalid/games/g/hands/h/actions',
        request('POST','',action('Alice',10)),f.env);
      expect(res.status).toBe(409);
      expect(f.batchCalls).toBe(0);
    }
  });

  it('requires winner undo before editing completed-hand actions',async()=>{
    const f=fixture('active',true);
    const res=await hands.request('https://test.invalid/games/g/hands/h/actions',
      request('POST','',action('Alice',10)),f.env);
    expect(res.status).toBe(409);
    expect(f.batchCalls).toBe(0);
  });
});
