import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Test the actual inline game-sync implementation executed in the browser.
// No application credentials, live HTTP endpoints, or real users are involved.
const source = readFileSync(new URL('../../frontend/src/app/games/[id]/play/page.tsx', import.meta.url),'utf8');
const start = source.indexOf("var OFFLINE_Q_KEY = 'pkr_pending_v2_'");
const end = source.indexOf('async function loadGameFromPkr()',start);
if (start < 0 || end <= start) throw new Error('Could not locate shipped offline queue implementation');
const queueCode = source.slice(start,end);
const storage = new Map<string,string>();
const key='pkr_pending_v2_synthetic-game_synthetic-host';
const user = {
  name:'Alex',phone:'',buyins:2,biTotal:40,hadCashout:true,cashout:35,
};

function harness(
  online:boolean,
  request: (path:string,options?:any)=>Promise<any>,
  snapshot: Record<string,any> = {},
  storageWritable:boolean = true,
) {
  let canPersist = storageWritable;
  const elements = new Map<string,any>();
  const listeners:Record<string,Function[]>={};
  const localStorage={
    getItem:(name:string)=>storage.get(name)||null,
    setItem:(name:string,value:string)=>{
      if(!canPersist)throw new Error('QuotaExceededError: synthetic storage unavailable');
      storage.set(name,value);
    },
    removeItem:(name:string)=>{
      if(!canPersist)throw new Error('QuotaExceededError: synthetic storage unavailable');
      storage.delete(name);
    },
  };
  const frame:any={
    _ctx:{gameId:'synthetic-game',userId:'synthetic-host'},
    _pkrSeatedPlayers:{},
    _pkrSnapshotPlayers:()=>snapshot,
    pkrApi:request,
    loadGameFromPkr:()=>Promise.resolve(),
    navigator:{onLine:online},
    localStorage,
    window:{
      addEventListener:(name:string,callback:Function)=>{
        (listeners[name]||=([])).push(callback);
      },
    },
    document:{
      getElementById:(id:string)=>elements.get(id)||null,
      createElement:()=>({style:{},textContent:'',id:''}),
      body:{appendChild:(element:any)=>{
        elements.set(element.id,element);
        element.remove=()=>elements.delete(element.id);
      }},
    },
    console:{warn:()=>{}},
    setTimeout:()=>0,
  };
  runInNewContext(queueCode,frame);
  return {frame,listeners,elements,setStorageWritable:(writable:boolean)=>{canPersist=writable;}};
}

describe('durable staging game sync journal',()=>{
  it('persists and deduplicates absolute buy-in updates per player',()=>{
    storage.clear();
    const {frame}=harness(false,async()=>({}));
    const path='/games/synthetic-game/buyin/test_player';
    frame.queueAction(path,{method:'PUT',body:JSON.stringify({count:1,total:2000,expected_count:0,expected_total:0})});
    frame.queueAction(path,{method:'PUT',body:JSON.stringify({count:2,total:4000,expected_count:1,expected_total:2000})});
    const journal=JSON.parse(storage.get(key)||'[]');
    expect(journal).toHaveLength(1);
    expect(JSON.parse(journal[0].options.body)).toEqual({count:2,total:4000,expected_count:0,expected_total:0});
    expect(journal[0].options.method).toBe('PUT');
    expect(journal[0].options).not.toHaveProperty('headers');
  });

  it('restores queued money after refresh and deletes the journal only after server acknowledgement',async()=>{
    const sent:any[]=[];
    const {frame}=harness(true,async(path,options)=>{
      sent.push({path,options});
      if(path==='/games/synthetic-game')return {status:'active'};
      return {ok:true};
    });
    expect(frame._offlineQueue).toHaveLength(1);
    await frame.flushOfflineQueue();
    expect(sent.filter(x=>x.options?.method==='PUT')).toHaveLength(1);
    expect(JSON.parse(sent.find(x=>x.options?.method==='PUT').options.body))
      .toEqual({count:2,total:4000,expected_count:0,expected_total:0});
    expect(frame._offlineQueue).toHaveLength(0);
    expect(storage.has(key)).toBe(false);
  });

  it('never applies a pending edit to a settled game',async()=>{
    storage.clear();
    const {frame}=harness(false,async()=>({}));
    frame.queueAction('/games/synthetic-game/buyin/id',{method:'PUT',body:'{"count":1,"total":2000}'});
    let mutations=0;
    const resumed=harness(true,async(path)=>{
      if(path==='/games/synthetic-game')return {status:'settled'};
      mutations++;
      return {ok:true};
    });
    await resumed.frame.flushOfflineQueue();
    expect(mutations).toBe(0);
    expect(resumed.frame._offlineQueue).toHaveLength(1);
    expect(storage.has(key)).toBe(true);
    expect(resumed.frame._syncError).toMatch(/closed/);
  });

  it('replays an offline new seat and then the latest locally stored amounts',async()=>{
    storage.clear();
    const first=harness(false,async()=>({}),{seat1:user});
    first.frame.queueAction('/games/synthetic-game/seat',{
      method:'POST',
      body:JSON.stringify({display_name:'Alex',seat_number:1,buy_ins:0}),
    },'seat1','Alex');

    const sent:any[]=[];
    const replay=harness(true,async(path,options)=>{
      sent.push({path,options});
      if(path==='/games/synthetic-game')return {status:'active'};
      if(path.endsWith('/seat'))return {players:[{display_name:'Alex',user_id:'alex_remote'}]};
      return {ok:true};
    },{seat1:user});
    await replay.frame.flushOfflineQueue();

    const mut=sent.filter(x=>x.options?.method==='PUT');
    expect(mut).toHaveLength(2);
    expect(mut.map(x=>x.path)).toEqual([
      '/games/synthetic-game/buyin/alex_remote',
      '/games/synthetic-game/cashout/alex_remote',
    ]);
    expect(JSON.parse(mut[0].options.body)).toEqual({count:2,total:4000,expected_count:0,expected_total:0});
    expect(JSON.parse(mut[1].options.body)).toEqual({cashout:3500,expected_cashout:null});
    expect(replay.frame._offlineQueue).toHaveLength(0);
    expect(storage.has(key)).toBe(false);
  });

  it('retains journal entries if the server rejects a replay',async()=>{
    storage.clear();
    const first=harness(false,async()=>({}));
    first.frame.queueAction('/games/synthetic-game/cashout/alex_remote',{
      method:'PUT',body:JSON.stringify({cashout:3500,expected_cashout:null}),
    });
    const replay=harness(true,async(path)=>{
      if(path==='/games/synthetic-game')return {status:'active'};
      throw new Error('synthetic sync failure');
    });
    await replay.frame.flushOfflineQueue();
    expect(replay.frame._offlineQueue).toHaveLength(1);
    expect(JSON.parse(storage.get(key)||'[]')).toHaveLength(1);
    expect(replay.frame._syncError).toMatch(/paused/);
  });

  it('retains a conflicting edit and blocks automatic repeat attempts',async()=>{
    storage.clear();
    const first=harness(false,async()=>({}));
    first.frame.queueAction('/games/synthetic-game/cashout/alex_remote',{
      method:'PUT',body:JSON.stringify({cashout:3500,expected_cashout:null}),
    });
    let attempted=0;
    const replay=harness(true,async(path)=>{
      if(path==='/games/synthetic-game')return {status:'active'};
      attempted++;
      const err:any=new Error('Another host changed the cash-out');
      err.code='EDIT_CONFLICT';err.status=409;
      throw err;
    });
    await replay.frame.flushOfflineQueue();
    expect(attempted).toBe(1);
    expect(replay.frame._offlineQueue).toHaveLength(1);
    expect(replay.frame._syncError).toMatch(/CONFLICT/);
    await replay.frame.flushOfflineQueue();
    expect(attempted).toBe(1);
    expect(storage.has(key)).toBe(true);
  });

  it('retains a rejected player removal and does not retry until reviewed',async()=>{
    storage.clear();
    const first=harness(false,async()=>({}));
    first.frame.queueAction('/games/synthetic-game/seat/alex_remote',{
      method:'DELETE',body:JSON.stringify({expected_seat_number:1}),
    });
    let writes=0;
    const replay=harness(true,async(path)=>{
      if(path==='/games/synthetic-game')return {status:'active'};
      writes++;
      const err:any=new Error('Player has recorded money or hands');
      err.code='PLAYER_HAS_HISTORY';err.status=409;
      throw err;
    });
    await replay.frame.flushOfflineQueue();
    expect(writes).toBe(1);
    expect(replay.frame._offlineQueue).toHaveLength(1);
    expect(replay.frame._syncError).toMatch(/CONFLICT/);
    await replay.frame.flushOfflineQueue();
    expect(writes).toBe(1);
  });

  it('keeps a persisted conflict paused after a page refresh',async()=>{
    storage.clear();
    const initial=harness(false,async()=>({}));
    initial.frame.queueAction('/games/synthetic-game/buyin/alex_remote',{
      method:'PUT',body:JSON.stringify({count:2,total:4000,expected_count:1,expected_total:2000}),
    });
    const err:any=new Error('Stale buy-in');err.code='EDIT_CONFLICT';
    const attempted=harness(true,async(path)=>{
      if(path==='/games/synthetic-game')return {status:'active'};
      throw err;
    });
    await attempted.frame.flushOfflineQueue();
    const keyConflict='pkr_pending_conflict_v1_synthetic-game_synthetic-host';
    expect(storage.has(keyConflict)).toBe(true);
    const restored=harness(true,async()=>{throw Error('must not auto-retry');});
    expect(restored.frame._syncConflict).toBe(true);
    await restored.frame.flushOfflineQueue();
    expect(restored.frame._offlineQueue).toHaveLength(1);
  });

  it('prepares a manual financial retry using fresh server values, not a blind overwrite',()=>{
    storage.clear();
    const {frame}=harness(false,async()=>({}));
    const action=frame.queueAction('/games/synthetic-game/cashout/alex',{
      method:'PUT',body:JSON.stringify({cashout:5000,expected_cashout:null}),
    });
    const review=frame.prepareConflictRetry(action,{
      status:'active',players:[{user_id:'alex',display_name:'Alex',cashout:3500}],
    });
    expect(review.canApply).toBe(true);
    expect(review.server).toBe('$35.00');
    expect(review.pending).toBe('$50.00');
    expect(review.nextBody).toEqual({cashout:5000,expected_cashout:3500});
    expect(JSON.parse(action.options.body)).toEqual({cashout:5000,expected_cashout:null});
  });

  it('never offers a manual retry that steals an occupied seat or deletes recorded money',()=>{
    storage.clear();
    const {frame}=harness(false,async()=>({}));
    const seat=frame.queueAction('/games/synthetic-game/seat',{
      method:'POST',body:JSON.stringify({display_name:'Alex',seat_number:2,expected_seat_number:1}),
    });
    const game={status:'active',players:[
      {user_id:'alex',display_name:'Alex',seat_number:1,buy_ins:0,buy_in_total:0,cashout:null},
      {user_id:'ben',display_name:'Ben',seat_number:2,buy_ins:0,buy_in_total:0,cashout:null},
    ]};
    expect(frame.prepareConflictRetry(seat,game).canApply).toBe(false);
    const deleting=frame.queueAction('/games/synthetic-game/seat/alex',{
      method:'DELETE',body:JSON.stringify({expected_seat_number:1}),
    });
    game.players[0].buy_in_total=2000;
    expect(frame.prepareConflictRetry(deleting,game).canApply).toBe(false);
  });

  it('does not dispatch a financial edit when its recovery journal cannot be written',async()=>{
    storage.clear();
    let moneyRequests=0;
    const h=harness(true,async(path)=>{
      if(path==='/games/synthetic-game')return {status:'active'};
      moneyRequests++;return {ok:true};
    },{},false);
    await expect(h.frame.pkrApiQueued('/games/synthetic-game/buyin/alex',{
      method:'PUT',body:JSON.stringify({count:2,total:4000,expected_count:1,expected_total:2000}),
    })).rejects.toThrow(/browser storage/i);
    expect(moneyRequests).toBe(0);
    expect(h.frame._offlineQueue).toHaveLength(1);
    expect(storage.has(key)).toBe(false);
    await h.frame.flushOfflineQueue();
    expect(moneyRequests).toBe(0);
    expect(h.frame._syncError).toMatch(/storage/i);
    h.setStorageWritable(true);
    await h.frame.flushOfflineQueue();
    expect(moneyRequests).toBe(1);
    expect(h.frame._offlineQueue).toHaveLength(0);
  });

  it('will not journal incremental money POSTs that can double-charge after a timeout',()=>{
    storage.clear();
    const {frame}=harness(false,async()=>({}));
    expect(()=>frame.queueAction('/games/synthetic-game/buyin/alex',{method:'POST'}))
      .toThrow(/retry-safe/);
    expect(()=>frame.queueAction('/games/synthetic-game/cashout/alex',{
      method:'POST',body:JSON.stringify({cashout:2000}),
    })).toThrow(/retry-safe/);
    expect(storage.has(key)).toBe(false);
  });

  it('never queues settlement requests or cross-game mutations',()=>{
    storage.clear();
    const {frame}=harness(false,async()=>({}));
    expect(()=>frame.queueAction('/games/synthetic-game/settle',{method:'POST'}))
      .toThrow(/Only game-specific/);
    expect(()=>frame.queueAction('/games/some-other-game/buyin/id',{method:'PUT'}))
      .toThrow(/Only game-specific/);
    expect(storage.has(key)).toBe(false);
  });
});
