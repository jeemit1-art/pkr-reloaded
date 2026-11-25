import {describe,it,expect} from 'vitest';
import {
  combineRoomPlayerLeaders,mergePairIsSafe,listRoomPlayerMerges,
  saveRoomPlayerMerge,removeRoomPlayerMerge,type RoomPlayerMerge,
} from './room-player-merges';
import type {PlayerLeaderboardRow} from './player-leaderboard';

function player(id:string,name:string,games:number,net:number):PlayerLeaderboardRow{
  const total=Array.from({length:games},(_,i)=>({game_id:id+'-game-'+i,user_id:id}));
  return {user_id:id,display_name:name,games_played:games,
    games_won:0,total_net:net,biggest_win:0,biggest_loss:Math.abs(net),last_played:100,
    source_game_players:total,aliases:[name]};
}
const link=(from:string,to:string,fromName:string,toName:string):RoomPlayerMerge=>({
  from_user_id:from,to_user_id:to,from_name:fromName,to_name:toName,
  created_at:1700000000000,created_by:'fictional-host',
});
function fakeKv(){
  const records=new Map<string,string>();
  const kv:any={
    get:async(k:string)=>records.get(k)??null,
    put:async(k:string,v:string)=>{records.set(k,v);},
    delete:async(k:string)=>{records.delete(k);},
    list:async({prefix}:{prefix:string})=>({
      keys:[...records.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),
      list_complete:true,
    }),
  };
  return {kv,records};
}
describe('non-destructive host-reviewed player history merges',()=>{
  it('combines five and four distinct game histories and reconciles every cent without mutating the originals',()=>{
    const source=player('synthetic-old','Sam',5,-25500);
    const target=player('synthetic-main','Sam Patel',4,-111000);
    const unrelated=player('other','Unrelated player',2,136500);
    const before=[source,target,unrelated];
    const snapshot=JSON.stringify(before);
    const result=combineRoomPlayerLeaders(before,[link(source.user_id,target.user_id,source.display_name,target.display_name)]);
    expect(result.applied).toBe(1);
    expect(result.warnings).toHaveLength(0);
    expect(result.leaders).toHaveLength(2);
    const combined=result.leaders.find(p=>p.user_id===target.user_id)!;
    expect(combined.display_name).toBe('Sam Patel');
    expect(combined.games_played).toBe(9);
    expect(combined.total_net).toBe(-136500);
    expect(combined.source_game_players).toHaveLength(9);
    expect(new Set(combined.source_game_players.map(x=>x.game_id)).size).toBe(9);
    expect(result.leaders.find(x=>x.user_id==='other')).toEqual(unrelated);
    expect(result.leaders.reduce((n,p)=>n+p.total_net,0)).toBe(0);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
  it('blocks two separately recorded seats in the same settled game',()=>{
    const from=player('old','Sam',1,-1000);
    const to=player('main','Sam Patel',1,1000);
    to.source_game_players=[{game_id:from.source_game_players[0].game_id,user_id:'main'}];
    expect(mergePairIsSafe(from,to)).toMatch(/same game/i);
    const result=combineRoomPlayerLeaders([from,to],[link('old','main','Sam','Sam Patel')]);
    expect(result.applied).toBe(0);
    expect(result.leaders).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
  });
  it('blocks entries with unresolved verified identity conflicts',()=>{
    const from={...player('old','Sam',1,100),identity_review_required:true};
    const to=player('main','Sam Patel',1,200);
    expect(mergePairIsSafe(from,to)).toMatch(/identity conflict/);
  });
  it('cannot duplicate a settled row or discard money via chained links',()=>{
    const a=player('a','A',1,-500);
    const b=player('b','B',1,100);
    const c=player('c','C',1,400);
    const result=combineRoomPlayerLeaders([a,b,c],[
      link('a','b','A','B'),{...link('b','c','B','C'),created_at:1700000000001}
    ]);
    expect(result.applied).toBe(2);
    expect(result.leaders).toHaveLength(1);
    expect(result.leaders[0].games_played).toBe(3);
    expect(result.leaders[0].total_net).toBe(0);
  });
  it('preserves any link whose target is unavailable as an unmerged, auditable warning',()=>{
    const a=player('a','A',1,-500);
    const result=combineRoomPlayerLeaders([a],[link('a','missing','A','Missing')]);
    expect(result.applied).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.leaders[0]).toEqual(a);
  });
  it('persists separate room-scoped links with audit events and supports undo',async()=>{
    const f=fakeKv();
    const first=link('old','main','Sam','Sam Patel');
    await saveRoomPlayerMerge(f.kv,'room-1',first);
    expect(await listRoomPlayerMerges(f.kv,'room-1')).toEqual([first]);
    expect(await listRoomPlayerMerges(f.kv,'room-2')).toEqual([]);
    expect([...f.records.keys()].filter(k=>k.startsWith('room-player-merge-audit:')).length).toBe(1);
    await removeRoomPlayerMerge(f.kv,'room-1',first,'fictional-host');
    expect(await listRoomPlayerMerges(f.kv,'room-1')).toEqual([]);
    expect([...f.records.keys()].filter(k=>k.startsWith('room-player-merge-audit:')).length).toBe(2);
  });
  it('rejects tampered stored identity links rather than applying an ambiguous projection',async()=>{
    const f=fakeKv();
    f.records.set('room-player-merge:v1:room-1:source','{"wrong":true}');
    await expect(listRoomPlayerMerges(f.kv,'room-1')).rejects.toThrow(/invalid/);
  });
});
