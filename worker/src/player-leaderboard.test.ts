import {describe,it,expect} from 'vitest';
import {resolvePlayerLeaderboard,computeRoomLeaderboard,type SettledPlayerRow} from './player-leaderboard';

const row=(game:string,id:string,name:string,net:number,scheduled_at=1000):SettledPlayerRow=>
  ({game_id:game,user_id:id,display_name:name,net,settled_at:scheduled_at,scheduled_at});

describe('authoritative D1 read path',()=>{
 it('filters both joins by room and excludes unsettled or missing-net results',async()=>{
  const observed:Array<{sql:string;bound:string}>=[];
  const db={
   prepare:(sql:string)=>({
    bind:(eventId:string)=>({
     all:async()=>{
      observed.push({sql,bound:eventId});
      return sql.includes('SELECT DISTINCT u.id')
       ?{results:[{id:'auth'}]}
       :{results:[row('game-1','auth','Alex',4500)]};
     },
    }),
   }),
  };
  const {leaders,audit}=await computeRoomLeaderboard(db as any,'room-1');
  expect(leaders).toHaveLength(1);
  expect(leaders[0].total_net).toBe(4500);
  expect(observed).toHaveLength(2);
  expect(observed.every(q=>q.bound==='room-1'&&q.sql.includes("g.status='settled'")&&q.sql.includes('g.event_id=?'))).toBe(true);
  expect(observed.some(q=>q.sql.includes('gp.net IS NOT NULL'))).toBe(true);
  expect(audit.source_net).toBe(audit.ranked_net);
 });
});

describe('per-room canonical settled-game ledger',()=>{
 it('reconciles 41 overlapping alias histories into ONE actual 41-game total',()=>{
   const sample=[
     ...Array.from({length:39},(_,i)=>row('game-'+i,'registered-jeemit','Jeemit Shah',
       i%2===0?20000:-17800,1700000+i)),
     row('game-39','manual-early','Jeemit',12000,1690000),
     row('game-40','registered-jeemit','Jeemit',16000,1701000),
     row('game-opponent','different-user','Prakash',-30000,1701000),
   ];
   const {leaders,audit}=resolvePlayerLeaderboard(sample,new Set(['registered-jeemit','different-user']));
   const jeemit=leaders.find(p=>p.user_id==='registered-jeemit');
   expect(jeemit).toBeDefined();
   expect(jeemit!.display_name).toBe('Jeemit Shah');
   expect(jeemit!.aliases).toEqual(['Jeemit Shah','Jeemit']);
   expect(jeemit!.games_played).toBe(41);
   expect(jeemit!.source_game_players).toHaveLength(41);
   expect(new Set(jeemit!.source_game_players.map(r=>r.game_id)).size).toBe(41);
   expect(jeemit!.total_net).toBe(sample.filter(x=>x.display_name.startsWith('Jeemit')).reduce((n,p)=>n+p.net,0));
   expect(audit.source_net).toBe(audit.ranked_net);
   expect(audit.source_rows).toBe(audit.ranked_sessions);
   expect(audit.multi_name_players).toBe(1);
   expect(leaders).toHaveLength(2);
 });
 it('preserves all other players and each source amount exactly once',()=>{
   const sample=[
     row('g1','a','Alex',1000),row('g2','a','Alexander',-3000),row('g3','ma1','Alex',1500),
     row('g1','b','Blair',-500),row('g2','mb1','Blair',1200),row('g3','b','Blair',-1500),
     row('g1','c','Casey',-500),row('g2','c','Casey',1800),row('g3','mc1','Casey',0),
   ];
   const {leaders,audit}=resolvePlayerLeaderboard(sample,new Set(['a','b','c']));
   expect(leaders).toHaveLength(3);
   for(const name of ['Alex','Blair','Casey']){
     const player=leaders.find(x=>x.aliases.includes(name));
     expect(player).toBeDefined();
     expect(player!.games_played).toBe(3);
   }
   expect(audit.source_net).toBe(audit.ranked_net);
   expect(audit.source_rows).toBe(audit.ranked_sessions);
   expect(leaders.flatMap(x=>x.source_game_players)).toHaveLength(9);
 });
 it('does not merge unrelated registered users just because the names match',()=>{
   const {leaders,audit}=resolvePlayerLeaderboard([
     row('g1','account-1','Alex',4000),
     row('g2','account-2','Alex',-2000),
     row('g3','manual-old','Alex',3000),
   ],new Set(['account-1','account-2']));
   expect(leaders).toHaveLength(3);
   expect(audit.ambiguous_name_groups).toBe(1);
   expect(leaders.some(p=>p.identity_review_required)).toBe(true);
   expect(leaders.reduce((sum,p)=>sum+p.total_net,0)).toBe(5000);
 });
 it('does not collapse two separate seats in one game even with the same name',()=>{
   const {leaders,audit}=resolvePlayerLeaderboard([
     row('g1','manual-1','Sam',4000),
     row('g1','manual-2','sam ',-4000),
     row('g2','manual-1','Sam',1000),
   ],new Set());
   expect(leaders).toHaveLength(2);
   expect(audit.ambiguous_name_groups).toBe(1);
   expect(audit.ranked_sessions).toBe(3);
   expect(audit.ranked_net).toBe(1000);
 });
 it('only counts games marked settled in the repository read query, not arbitrary UI labels',()=>{
   const {leaders}=resolvePlayerLeaderboard([
     row('g1','registered-x','X',0),
     row('g2','registered-x','X',0),
   ],new Set(['registered-x']));
   expect(leaders[0].games_played).toBe(2);
   expect(leaders[0].games_won).toBe(0);
   expect(leaders[0].total_net).toBe(0);
 });
 it('keeps case and whitespace variants together for guest-only history',()=>{
   const {leaders}=resolvePlayerLeaderboard([
     row('g1','manual-1','  Pintoo   Bhai ',500),
     row('g2','manual-2','pintoo bhai',-300),
   ],new Set());
   expect(leaders).toHaveLength(1);
   expect(leaders[0].games_played).toBe(2);
   expect(leaders[0].total_net).toBe(200);
 });
 it('does not combine two rooms when the resolver receives only one room rows',()=>{
   const g1=resolvePlayerLeaderboard([row('g1','shared','X',1000)],new Set(['shared']));
   const g2=resolvePlayerLeaderboard([row('g2','shared','X',-1000)],new Set(['shared']));
   expect(g1.leaders[0].total_net).toBe(1000);
   expect(g2.leaders[0].total_net).toBe(-1000);
 });
 it('rejects malformed amounts instead of silently losing a financial row',()=>{
   expect(()=>resolvePlayerLeaderboard([row('g1','id','Name',1.75)],new Set(['id']))).toThrow();
 });
});
