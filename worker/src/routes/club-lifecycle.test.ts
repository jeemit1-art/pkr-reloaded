import {describe,it,expect} from 'vitest';
import {Hono} from 'hono';
import club from './club-planning';
import extras from './club-extras';
import games from './games';
import tournament from './tournament';
import {signJWT} from '../jwt';
const sqliteName='node:sqlite',fsName='node:fs';
const {DatabaseSync}=await import(/* @vite-ignore */ sqliteName);
const {readFileSync}=await import(/* @vite-ignore */ fsName);
const secret='fictional-local-club-test-secret-only-1234567890';
const stamp=Math.floor(Date.now()/1000);
const url='https://fixture.invalid';
const root=new URL('../../',(import.meta as ImportMeta & {url:string}).url);
async function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 for(const file of ['staging.schema.sql','migrations/20261025_staging_rsvp_board.sql','migrations/20261031_rsvp_custom_choice.sql','migrations/20261126_club_planning.sql','migrations/20261126_club_extras.sql'])
   db.exec(readFileSync(new URL(file,root),'utf8'));
 for(const id of ['host','member','other','former','outsider','newhost']){
   db.prepare('INSERT INTO users(id,google_sub,email,name,plan,trial_started_at) VALUES(?,?,?,?,?,?)').run(id,'google-'+id,id+'@fixture.invalid',id,id==='host'?'lifetime':'trial',stamp);
 }
 db.prepare('INSERT INTO events(id,name,host_id,buy_in) VALUES(?,?,?,?)').run('room','Fictional club','host',2000);
 db.prepare('INSERT INTO events(id,name,host_id,buy_in) VALUES(?,?,?,?)').run('newroom','New fictional club','newhost',2000);
 for(const id of ['host','member','other','former'])db.prepare('INSERT INTO event_members(event_id,user_id,role) VALUES(?,?,?)').run('room',id,id==='host'?'host':'member');
 db.prepare("INSERT INTO event_members(event_id,user_id,role) VALUES('newroom','newhost','host')").run();
 for(const [id,status,ts] of [['full','scheduled',stamp+86400],['live','active',stamp],['settled','settled',stamp-3600]] as const)
   db.prepare('INSERT INTO games(id,event_id,scheduled_at,seats,status) VALUES(?,?,?,?,?)').run(id,'room',ts,2,status);
 for(const id of ['host','other'])db.prepare('INSERT INTO game_players(game_id,user_id,display_name,seat_number) VALUES(?,?,?,?)').run('full',id,id,id==='host'?1:2);
 for(const [id,net] of [['host',500],['member',-500]] as const)
   db.prepare('INSERT INTO game_players(game_id,user_id,display_name,buy_in_total,cashout,net,settled_at) VALUES(?,?,?,?,?,?,?)').run('settled',id,id,2000,2000+net,net,stamp-3500);
 const statement=(sql:string,args:any[]=[]):any=>({
   bind:(...values:any[])=>statement(sql,values),
   first:async()=>db.prepare(sql).get(...args)||null,
   all:async()=>({results:db.prepare(sql).all(...args)}),
   execute:()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}}),
   run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})
 });
 const env:any={JWT_SECRET:secret,PKR_ENV:'staging',PKR_RSVP_V2:'1',PKR_SETTLEMENT_V2:'1',PKR_CLUB_PLANNING_V1:'1',PKR_CLUB_EXTRAS_V1:'1',PKR_FREE_FIRST_GAME_V1:'1',
   DB:{prepare:(sql:string)=>statement(sql),batch:async(commands:any[])=>{
     db.exec('BEGIN IMMEDIATE');
     try{const r=commands.map(c=>c.execute());db.exec('COMMIT');return r;}
     catch(e){db.exec('ROLLBACK');throw e;}
   }},
   KV:{get:async()=>null,put:async()=>{},delete:async()=>{}}
 };
 const app=new Hono();
 app.route('/',club);app.route('/',extras);app.route('/',games);app.route('/',tournament);
 const tokens=new Map<string,string>();
 for(const id of ['host','member','other','former','outsider','newhost'])tokens.set(id,await signJWT({sub:id,name:id,email:id+'@fixture.invalid'},secret));
 const call=async(id:string,path:string,method='GET',data?:unknown)=>{
   const headers:Record<string,string>={'content-type':'application/json'};
   if(id)headers.Authorization='Bearer '+tokens.get(id);
   return app.request(url+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})},env,{waitUntil:()=>{}} as any);
 };
 const ok=async(id:string,path:string,method='GET',data?:unknown,status=200)=>{
   const res=await call(id,path,method,data);
   expect(res.status,await res.clone().text()).toBe(status);
   return await res.json() as any;
 };
 const money=()=>JSON.stringify(db.prepare('SELECT COUNT(*) AS n,SUM(buy_in_total) AS buyins,SUM(cashout) AS cashouts,SUM(net) AS net FROM game_players').get())+'|'+JSON.stringify(db.prepare('SELECT COUNT(*) AS n,SUM(amount) AS total FROM settlement_transfers').get());
 return {db,call,ok,money};
}
describe('Club release: actual SQLite and signed synthetic accounts',()=>{
 it('creates a private poll, votes once per account, closes it and hides identities',async()=>{
   const f=await fixture();try{
     const path='/events/room/date-polls';
     expect((await f.call('',path)).status).toBe(401);
     expect((await f.call('outsider',path)).status).toBe(403);
     const payload={title:'Choose next night',options:[stamp+86400,stamp+172800],closes_at:stamp+3600};
     expect((await f.call('member',path,'POST',payload)).status).toBe(403);
     const p=await f.ok('host',path,'POST',payload,201);
     await f.ok('member',path+'/'+p.id+'/vote','PUT',{option_index:0});
     await f.ok('member',path+'/'+p.id+'/vote','PUT',{option_index:1});
     const state=await f.ok('host',path);
     expect(state.polls[0].counts).toEqual([0,1]);expect(state.polls[0].my_vote).toBeNull();
     expect(state.polls[0]).not.toHaveProperty('votes');
     const closed=await f.ok('host',path+'/'+p.id+'/close','POST',{selected_index:1});
     expect(closed.winning_date).toBe(payload.options[1]);
     expect((await f.call('member',path+'/'+p.id+'/vote','PUT',{option_index:0})).status).toBe(409);
   }finally{f.db.close();}
 });
 it('offers only one provisional seat to a current member, not a removed member',async()=>{
   const f=await fixture();try{
     const path='/games/full/waitlist';
     await f.ok('former',path,'POST',{},201);await f.ok('member',path,'POST',{},201);
     f.db.prepare("UPDATE game_waitlist SET created_at=1 WHERE user_id='former'").run();
     f.db.prepare("DELETE FROM event_members WHERE event_id='room' AND user_id='former'").run();
     f.db.prepare("DELETE FROM game_players WHERE game_id='full' AND user_id='other'").run();
     const offer=await f.ok('host',path+'/offer-next','POST',{});
     expect(offer.offered).toBe(true);
     expect((await f.ok('member',path)).my_status).toBe('offered');
     expect((await f.call('former',path)).status).toBe(403);
     expect((await f.ok('host',path+'/offer-next','POST',{})).offered).toBe(false);
     expect(f.db.prepare("SELECT COUNT(*) n FROM game_players WHERE game_id='full'").get().n).toBe(1);
   }finally{f.db.close();}
 });
 it('reviews member requests and calculates season points without ledger writes',async()=>{
   const f=await fixture();try{
     const before=f.money(),path='/games/live/member-requests';
     const r=await f.ok('member',path,'POST',{kind:'buyin',note:'Please review'},201);
     expect((await f.ok('other',path)).requests).toEqual([]);
     expect((await f.call('member',path+'/'+r.id,'PUT',{status:'approved'})).status).toBe(403);
     await f.ok('host',path+'/'+r.id,'PUT',{status:'approved'});await f.ok('host',path+'/'+r.id,'PUT',{status:'resolved'});
     const s=await f.ok('host','/events/room/seasons','POST',{name:'Test season',starts_at:stamp-86400,ends_at:stamp+86400,points:{first:10,second:7,third:5,other:1}},201);
     const standings=await f.ok('member','/events/room/seasons/'+s.id+'/standings');
     expect(standings.standings.map((x:any)=>x.points)).toEqual([10,7]);
     expect(standings.standings[0]).not.toHaveProperty('net');expect(f.money()).toBe(before);
   }finally{f.db.close();}
 });
 it('consents to exact cost splits, exports only for owner and reuses validated presets',async()=>{
   const f=await fixture();try{
     const before=f.money(),path='/events/room/shared-expenses';
     const r=await f.ok('host',path,'POST',{title:'Pizza cost',category:'food',amount_cents:1001,paid_by_user_id:'host',member_ids:['host','member','other']},201);
     expect(r.shares.reduce((sum:number,x:any)=>sum+x.share_cents,0)).toBe(1001);
     await f.ok('member',path+'/'+r.id+'/respond','PUT',{status:'accepted'});
     await f.ok('other',path+'/'+r.id+'/respond','PUT',{status:'declined'});
     expect((await f.call('member','/events/room/data-export?kind=members')).status).toBe(403);
     for(const kind of ['games','player_results','transfers','rsvps','rsvps_live','members','expense_splits','payment_events']){
       const rows=await f.ok('host','/events/room/data-export?kind='+kind);
       expect(rows.kind).toBe(kind);expect(Array.isArray(rows.rows)).toBe(true);
       expect(JSON.stringify(rows.rows)).not.toMatch(/fixture\.invalid|edit_token_hash|google_sub/);
     }
     const config={format:'tournament',starting_chips:10000,buy_in_amount:2000,rebuy_allowed:false,rebuy_levels:4,addon_allowed:false,addon_chips:0,payout_structure:[{place:1,pct:100}],levels:[{level_num:1,small_blind:25,big_blind:50,ante:0,duration_secs:900,is_break:false}]};
     const p=await f.ok('host','/events/room/tournament-presets','POST',{name:'Fictional template',config},201);
     const saved=await f.ok('host','/events/room/tournament-presets');
     expect(saved.presets[0].config).toEqual(config);
     await f.ok('host','/events/room/tournament-presets/'+p.id,'DELETE');
     expect(f.money()).toBe(before);
   }finally{f.db.close();}
 });
 it('limits a new host to one free cash game and preserves the durable claim',async()=>{
   const f=await fixture();try{
     const path='/events/newroom/games',payload={scheduled_at:stamp+86400,seats:9,format:'cash'};
     expect((await f.call('newhost',path,'POST',{...payload,seats:10})).status).toBe(402);
     expect((await f.call('newhost',path,'POST',{...payload,repeat:'weekly'})).status).toBe(402);
     expect((await f.call('newhost',path,'POST',{...payload,format:'tournament'})).status).toBe(402);
     const saved=await f.ok('newhost',path,'POST',payload,201);
     expect(f.db.prepare('SELECT game_id FROM host_free_first_games WHERE host_id=?').get('newhost').game_id).toBe(saved.id);
     expect((await f.call('newhost',path,'POST',payload)).status).toBe(402);
     f.db.prepare('DELETE FROM games WHERE id=?').run(saved.id);
     expect((await f.call('newhost',path,'POST',payload)).status).toBe(402);
   }finally{f.db.close();}
 });
});
