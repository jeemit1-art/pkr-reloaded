import {describe,it,expect,vi} from 'vitest';
vi.mock('../middleware',()=>({
 authMiddleware:async(c:any,next:any)=>{
   if(c.req.header('x-auth')==='no')return c.json({error:'Unauthorized'},401);
   c.set('userId',c.req.header('x-user')||'member');
   await next();
 },
 requireEventRole:async(c:any,_event:string,required:string)=>{
   const role=c.req.header('x-role')||'member';
   return role==='host'||(role==='cohost'&&required!=='host')||
     (role==='member'&&required==='member');
 },
 generateId:()=> 'synthetic-uuid',
}));
import extras from './club-extras';
const base='https://example.invalid';
const body=(value:unknown,headers:Record<string,string>={}):RequestInit=>({
 method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)
});
function fixture(){
 const queries:string[]=[],writes:string[]=[];
 const DB={
  prepare(sql:string){
   queries.push(sql);
   return {bind(..._args:any[]){
    return {
     async first(){
       if(sql.includes('SELECT id FROM games WHERE id='))return {id:'game'};
       if(sql.includes('COUNT(*)'))return {count:0};
       return null;
     },
     async all(){
       if(sql.includes('SELECT user_id FROM event_members'))
         return {results:[{user_id:'host'},{user_id:'member'},{user_id:'other'}]};
       if(sql.includes('FROM event_members em JOIN users u'))
         return {results:[{user_id:'host',display_name:'Host'},{user_id:'member',display_name:'Member'},
           {user_id:'other',display_name:'Other'}]};
       return {results:[]};
     },
     async run(){writes.push(sql);return {meta:{changes:1}};},
    };
   }};
  },
  async batch(statements:any[]){
    const results=[];
    for(const st of statements)results.push(await st.run());
    return results;
  }
 };
 return {env:{PKR_ENV:'staging',PKR_CLUB_EXTRAS_V1:'1',DB} as any,queries,writes};
}
const proposal={
 title:'Pizza cost',notes:'Friday game',category:'food',amount_cents:1001,
 paid_by_user_id:'host',member_ids:['host','member','other']
};
describe('optional club expense/export routes',()=>{
 it('fails closed with zero reads before the optional D1 migration',async()=>{
   const f=fixture();delete f.env.PKR_CLUB_EXTRAS_V1;
   const r=await extras.request(base+'/events/room/shared-expenses',{},f.env);
   expect(r.status).toBe(503);
   expect(f.queries).toEqual([]);
 });
 it('requires an approved member even to read expense proposals',async()=>{
   const f=fixture();
   expect((await extras.request(base+'/events/room/shared-expenses',
     {headers:{'x-role':'none'}},f.env)).status).toBe(403);
   expect((await extras.request(base+'/events/room/shared-expenses',
     {headers:{'x-auth':'no'}},f.env)).status).toBe(401);
   expect(f.queries).toEqual([]);
 });
 it('never permits a player to create an expense or a full data export',async()=>{
   const f=fixture();
   const r=await extras.request(base+'/events/room/shared-expenses',body(proposal),f.env);
   expect(r.status).toBe(403);
   const exp=await extras.request(base+'/events/room/data-export?kind=transfers',{},f.env);
   expect(exp.status).toBe(403);
   expect(f.writes).toHaveLength(0);
 });
 it('allows consenting cost proposals without touching any poker money',async()=>{
   const f=fixture();
   const r=await extras.request(base+'/events/room/shared-expenses',
     body(proposal,{'x-role':'host'}),f.env);
   expect(r.status).toBe(201);
   const data=await r.json() as any;
   expect(data.shares.map((s:any)=>s.share_cents).reduce((a:number,b:number)=>a+b,0)).toBe(1001);
   expect(f.writes).toHaveLength(4);
   expect(f.writes.every(sql=>sql.includes('room_shared_expense'))).toBe(true);
 });
 it('rejects unsafe or unknown member sharing',async()=>{
   const f=fixture();
   const r=await extras.request(base+'/events/room/shared-expenses',
     body({...proposal,member_ids:['host','unverified']},{'x-role':'host'}),f.env);
   expect(r.status).toBe(403);
   expect(f.writes).toEqual([]);
 });
 it('blocks cohosts from exporting player balances or settlement transfers',async()=>{
   const f=fixture();
   const r=await extras.request(base+'/events/room/data-export?kind=transfers',
     {headers:{'x-role':'cohost'}},f.env);
   expect(r.status).toBe(403);
 });
 it('rejects invalid export categories and unsafe pagination',async()=>{
   const f=fixture();
   for(const path of ['/events/room/data-export?kind=phones',
     '/events/room/data-export?kind=members&offset=-1']){
     const r=await extras.request(base+path,{headers:{'x-role':'host'}},f.env);
     expect(r.status).toBe(400);
   }
 });
 it('rejects unvalidated tournament preset contents before writing',async()=>{
   const f=fixture();
   const r=await extras.request(base+'/events/room/tournament-presets',
     body({name:'Bad preset',config:{format:'cash'}},{'x-role':'host'}),f.env);
   expect(r.status).toBe(400);
   expect(f.writes).toEqual([]);
 });
});
