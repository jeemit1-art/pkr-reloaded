import {describe,it,expect,vi} from 'vitest';

vi.mock('../middleware',()=>({
  authMiddleware:async(c:any,next:any)=>{
    if(c.req.header('x-test-auth')==='no')return c.json({error:'Unauthorized'},401);
    c.set('userId',c.req.header('x-test-user')||'member');await next();
  },
  requireEventRole:async(c:any,_eventId:string,role:string)=>{
    const membership=c.req.header('x-test-role')||'member';
    if(membership==='none')return false;
    return role==='member'||membership==='host';
  },
  generateId:()=> 'synthetic-new-id',
}));
vi.mock('../push',()=>({
  sendPushToAccount:vi.fn(async()=>0),
  sendPushToModerators:vi.fn(async()=>0),
}));
import club from './club-planning';
const base='https://example.invalid';
const json=(body:unknown,method='POST',headers:Record<string,string>={}):RequestInit=>({
  method,headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),
});
function fixture(gameStatus='active'){
  const queries:string[]=[],writes:string[]=[];
  const season={id:'season',event_id:'room',name:'Fictional Season',
    starts_at:1700000000,ends_at:1900000000,
    points_first:10,points_second:7,points_third:5,points_other:1};
  const DB={
    prepare(sql:string){
      queries.push(sql);
      return {
        bind(..._values:unknown[]){
          return {
            async first(){
              if(sql.includes('SELECT id,event_id,seats,status FROM games'))
                return {id:'game',event_id:'room',seats:9,status:gameStatus};
              if(sql.includes('SELECT * FROM room_league_seasons'))
                return season;
              if(sql.includes('COUNT(*) AS filled'))return {filled:9};
              if(sql.includes('COUNT(*) AS count FROM game_waitlist'))return {count:0};
              if(sql.includes('SELECT name FROM users'))return {name:'Fictional Player'};
              return null;
            },
            async all(){
              if(sql.includes('FROM game_players gp JOIN games g'))
                return {results:[
                  {game_id:'game',user_id:'member',display_name:'Fictional Player',
                    net:500,settled_at:1800000000,scheduled_at:1800000000},
                  {game_id:'game',user_id:'other',display_name:'Fictional Other',
                    net:-500,settled_at:1800000000,scheduled_at:1800000000},
                ]};
              if(sql.includes('FROM event_members em JOIN users u'))
                return {results:[
                  {user_id:'member',display_name:'Fictional Player'},
                  {user_id:'other',display_name:'Fictional Other'},
                ]};
              return {results:[]};
            },
            async run(){writes.push(sql);return {meta:{changes:1}};}
          };
        }
      };
    },
  };
  return {env:{DB,PKR_ENV:'staging',PKR_RSVP_V2:'1',
    PKR_CLUB_PLANNING_V1:'1'},queries,writes};
}
describe('private club planning route security',()=>{
 it('does not touch database unless the additive migration is feature-enabled',async()=>{
   const f=fixture();delete (f.env as any).PKR_CLUB_PLANNING_V1;
   const res=await club.request(base+'/events/room/date-polls',{},f.env as any);
   expect(res.status).toBe(503);expect(f.queries).toEqual([]);
 });
 it('denies unauthenticated requests and unapproved group members',async()=>{
   const f=fixture();
   const a=await club.request(base+'/events/room/date-polls',
     {headers:{'x-test-auth':'no'}},f.env as any);
   expect(a.status).toBe(401);
   const b=await club.request(base+'/events/room/date-polls',
     {headers:{'x-test-role':'none'}},f.env as any);
   expect(b.status).toBe(403);
   expect(f.queries).toEqual([]);
 });
 it('does not permit ordinary members to create or close a date poll',async()=>{
   const f=fixture(),time=Math.floor(Date.now()/1000);
   const a=await club.request(base+'/events/room/date-polls',
     json({title:'Which Friday?',options:[time+86400,time+172800],closes_at:time+3600}),
     f.env as any);
   expect(a.status).toBe(403);
   const b=await club.request(base+'/events/room/date-polls/poll/close',
     json({selected_index:0}),f.env as any);
   expect(b.status).toBe(403);
   expect(f.writes).toHaveLength(0);
 });
 it('validates future date polls before any D1 change',async()=>{
   const f=fixture(),time=Math.floor(Date.now()/1000);
   const bad=await club.request(base+'/events/room/date-polls',
     json({title:'Friday poll',options:[time+172800,time+172800],closes_at:time+3600},
       'POST',{'x-test-role':'host'}),f.env as any);
   expect(bad.status).toBe(400);
   expect(f.writes).toHaveLength(0);
   const valid=await club.request(base+'/events/room/date-polls',
     json({title:'Friday poll',options:[time+172800,time+86400],closes_at:time+3600},
       'POST',{'x-test-role':'host'}),f.env as any);
   expect(valid.status).toBe(201);
   expect(f.writes).toHaveLength(1);
   expect(f.writes[0]).toContain('INSERT INTO room_date_polls');
 });
 it('does not allow ordinary members to approve their own requests',async()=>{
   const f=fixture();
   const response=await club.request(base+'/games/game/member-requests/req',
     json({status:'approved'},'PUT'),f.env as any);
   expect(response.status).toBe(403);
   expect(f.writes).toHaveLength(0);
 });
 it('records requests independently of buy-ins, cash-outs or settled transfers',async()=>{
   const f=fixture();
   const response=await club.request(base+'/games/game/member-requests',
     json({kind:'buyin',note:'Please review'}),f.env as any,{waitUntil:()=>{}} as any);
   expect(response.status).toBe(201);
   expect(f.writes).toHaveLength(1);
   expect(f.writes.every(query=>query.includes('game_member_requests'))).toBe(true);
 });
 it('a host can review a request without writing any financial transaction',async()=>{
   const f=fixture();
   const response=await club.request(base+'/games/game/member-requests/req',
     json({status:'approved'},'PUT',{'x-test-role':'host'}),f.env as any);
   expect(response.status).toBe(200);
   expect(f.writes).toHaveLength(1);
   expect(f.writes[0]).toContain('UPDATE game_member_requests');
 });
 it('league projection hides underlying financial amounts and preserves source rows',async()=>{
   const f=fixture();
   const response=await club.request(base+'/events/room/seasons/season/standings',{},f.env as any);
   expect(response.status).toBe(200);
   const x=await response.json() as any;
   expect(x.standings.map((row:any)=>row.points)).toEqual([10,7]);
   expect(x.standings[0].first_places).toBe(1);
   expect(x.standings[0]).not.toHaveProperty('total_net');
   expect(x.standings[0]).not.toHaveProperty('net');
   expect(f.writes).toHaveLength(0);
 });
});
