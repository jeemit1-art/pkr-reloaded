import {describe,it,expect,vi} from 'vitest';

vi.mock('../middleware',async(importOriginal)=>{
  const base=await importOriginal<typeof import('../middleware')>();
  return {...base,
    authMiddleware:async(c:any,next:any)=>{c.set('userId','fake-host');await next();},
    requireEventRole:async()=>true};
});
vi.mock('../push',()=>({sendPushToEvent:vi.fn(async()=>{})}));
import board from './rsvp-board';

function fixture(status='scheduled',settings:unknown=['19:00','20:00']){
 const queries:string[]=[];
 const privateNumber='04-PRIVATE-DO-NOT-DISCLOSE';
 const editHash='sensitive-stored-hash';
 const env:any={
  PKR_ENV:'staging',PKR_RSVP_V2:'1',
  DB:{
   prepare(sql:string){
    queries.push(sql);
    return {
     bind(...values:any[]){
      return {
       async first(){
        if(sql.includes('FROM games g JOIN events e'))return {
          id:'demo',event_id:'group',scheduled_at:1700000000,location:'Demo place',
          seats:6,status,event_name:'Test club'};
        if(sql.includes('SELECT options_json FROM game_rsvp_arrivals'))return {options_json:JSON.stringify(settings)};
        if(sql.includes('SELECT COUNT(*)'))return {total:1};
        if(sql.includes('edit_token_hash=?'))return {id:'r1'};
        return null;
       },
       async all(){
        if(sql.includes('FROM game_rsvp_guests'))return {results:[{
          id:'r1',display_name:'Fictional Jane',status:'yes',
          arrival_option:'19:00',seat_number:3,
          edit_token_hash:editHash,whatsapp:privateNumber,created_at:1,updated_at:20
        }]};
        if(sql.includes('FROM game_rsvps'))return {results:[{
          id:'legacy',display_name:'Fictional Robin',status:'maybe',
          whatsapp:privateNumber,created_at:10
        }]};
        if(sql.includes('FROM game_players'))return {results:[{display_name:'Host',seat_number:1}]};
        return {results:[]};
       },
       async run(){return {meta:{changes:1}};}
      };
     },
    };
   },
  },
 };
 return {env,queries,privateNumber,editHash};
}
const base='https://example.invalid/games/demo';
const json=(value:any):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});

describe('public live RSVP board v2',()=>{
 it('does not respond as though enabled before migration approval',async()=>{
  const f=fixture();delete f.env.PKR_RSVP_V2;
  const r=await board.request(base+'/rsvp-board',{},f.env);
  expect(r.status).toBe(503);
  expect((await r.json() as any).code).toBe('RSVP_BOARD_NOT_READY');
  expect(f.queries).toHaveLength(0);
 });
 it('returns public names, arrival and seat but not secrets or phone numbers',async()=>{
  const f=fixture();
  const r=await board.request(base+'/rsvp-board',{},f.env);
  expect(r.status).toBe(200);
  const body:any=await r.json();
  expect(body.guests).toHaveLength(2);
  expect(body.guests[0]).toMatchObject({display_name:'Fictional Jane',arrival_option:'19:00',seat_number:3});
  expect(body.guests[1]).toMatchObject({display_name:'Fictional Robin',status:'maybe'});
  expect(body.players).toEqual([{display_name:'Host',seat_number:1}]);
  expect(JSON.stringify(body)).not.toContain(f.privateNumber);
  expect(JSON.stringify(body)).not.toContain(f.editHash);
  expect(body.guests[0]).not.toHaveProperty('edit_token_hash');
  expect(r.headers.get('Cache-Control')).toContain('no-store');
 });
 it('does not accept invalid names, arrival times or seats',async()=>{
  const f=fixture();
  for(const bad of [
    {display_name:'',arrival_option:'19:00'},
    {display_name:'Alice',arrival_option:'27:00'},
    {display_name:'Alice',arrival_option:'19:00',seat_number:7},
    {display_name:'Alice',arrival_option:'19:00',edit_token:'not-a-key'}
  ]){
    const r=await board.request(base+'/rsvp-board',json(bad),f.env);
    expect([400,401]).toContain(r.status);
  }
 });
 it('issues an edit key only on registration and uses token hash on edits',async()=>{
  const f=fixture();
  const a=await board.request(base+'/rsvp-board',json({
    display_name:'Fictional Alice',arrival_option:'19:00',seat_number:4
  }),f.env,{waitUntil:()=>{}} as any);
  expect(a.status).toBe(201);
  const one:any=await a.json();
  expect(one.edit_token).toMatch(/^[a-f0-9]{64}$/);
  expect(one.status).toBe('yes');
  const b=await board.request(base+'/rsvp-board',json({
    display_name:'Fictional Alice',arrival_option:'late',seat_number:4,edit_token:one.edit_token
  }),f.env,{waitUntil:()=>{}} as any);
  expect(b.status).toBe(200);
  const two:any=await b.json();
  expect(two.edit_token).toBeUndefined();
  expect(f.queries.some(s=>s.includes('UPDATE game_rsvp_guests')&&s.includes('edit_token_hash=?'))).toBe(true);
  expect(f.queries.some(s=>s.includes('NOT EXISTS')&&s.includes('game_players'))).toBe(true);
 });
 it('does not permit RSVP changes after game start',async()=>{
  const f=fixture('active');
  const r=await board.request(base+'/rsvp-board',json({
    display_name:'Fictional Alice',arrival_option:'late'
  }),f.env);
  expect(r.status).toBe(409);
 });
 it('refuses invalid host-configured times',async()=>{
  const f=fixture();
  const r=await board.request(base+'/rsvp-arrivals',{
    method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({options:['19:00','19:00']})
  },f.env);
  expect(r.status).toBe(400);
 });
 it('uses backwards-compatible reply defaults for older time-only games',async()=>{
  const f=fixture();
  const r=await board.request(base+'/rsvp-board',{},f.env);
  const data:any=await r.json();
  expect(data.options).toEqual(['19:00','20:00']);
  expect(data.responses).toEqual([
    {value:'late',label:'Running late',status:'yes'},
    {value:'maybe',label:'Maybe',status:'maybe'},
    {value:'not-coming',label:'Not coming',status:'no'},
  ]);
 });
 it('accepts custom Maybe and Out responses without falsely reserving seats',async()=>{
  const settings={
   times:['19:00','20:00'],
   answers:[
    {value:'late',label:'Coming late',status:'yes'},
    {value:'maybe',label:'Might be there',status:'maybe'},
    {value:'not-coming',label:'Out tonight',status:'no'},
    {value:'custom-abc12345',label:'Will decide later',status:'maybe'}
   ]
  };
  const f=fixture('scheduled',settings);
  for(const [key,expected] of [
    ['maybe','maybe'],['not-coming','no'],['custom-abc12345','maybe']
  ] as const){
   const r=await board.request(base+'/rsvp-board',json({
     display_name:'Fictional Alice',arrival_option:key,seat_number:4
   }),f.env,{waitUntil:()=>{}} as any);
   expect(r.status).toBe(201);
   const data:any=await r.json();
   expect(data.status).toBe(expected);
   expect(data.seat_number).toBeNull();
  }
  const response=await board.request(base+'/rsvp-board',json({
   display_name:'Fictional Alice',arrival_option:'late',seat_number:4
  }),f.env,{waitUntil:()=>{}} as any);
  expect((await response.json() as any).status).toBe('yes');
 });
 it('allows host free-text labels with explicit attendance type',async()=>{
  const f=fixture();
  const responses=[
    {value:'late',label:'Running behind',status:'yes'},
    {value:'maybe',label:'May not come',status:'maybe'},
    {value:'not-coming',label:'Out',status:'no'},
    {value:'custom-aabbccdd',label:'Coming after work',status:'yes'}
  ];
  const r=await board.request(base+'/rsvp-arrivals',{method:'PUT',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({options:['19:00','20:00'],responses})
  },f.env);
  expect(r.status).toBe(200);
  expect((await r.json() as any).responses).toEqual(responses);
 });
 it('rejects duplicate, unsafe or misleading custom answers',async()=>{
  for(const answers of [
    [{value:'late',label:'Late',status:'no'},...[
      {value:'maybe',label:'Maybe',status:'maybe'},
      {value:'not-coming',label:'Out',status:'no'}
    ]],
    [{value:'late',label:'Late',status:'yes'},
      {value:'maybe',label:'Late',status:'maybe'},
      {value:'not-coming',label:'Out',status:'no'}],
    [{value:'late',label:'Late',status:'yes'},
      {value:'maybe',label:'Maybe',status:'maybe'},
      {value:'not-coming',label:'Out',status:'no'},
      {value:'custom-12345678',label:'<script>',status:'yes'}]
  ]){
   const f=fixture();
   const r=await board.request(base+'/rsvp-arrivals',{method:'PUT',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({options:['19:00'],responses:answers})
   },f.env);
   expect(r.status).toBe(400);
  }
 });

});
