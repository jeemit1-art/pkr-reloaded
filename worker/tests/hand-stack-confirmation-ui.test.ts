import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(
 new URL('../../frontend/public/hand-tracker.js',import.meta.url),'utf8'
);
const from=source.indexOf('function htConfirmOpeningStacks(');
const to=source.indexOf('function autoPost(',from);
if(from<0||to<=from)throw Error('Browser stack confirmation workflow is missing');
const shipped=source.slice(from,to);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(opts:{enabled?:boolean;confirmed?:boolean;responses?:Array<string|null>;accept?:boolean;fail?:boolean}={}){
 const messages:string[]=[];
 const calls:Array<{path:string;body:any}>=[];
 let posts=0;
 const hs:any={
  hand:{id:'h',straddle:0,bb_seat:3},actions:[],_stackConfirming:false,
  _autoPosting:false,_awaitingStackGate:true,straddleSeat:null,
 };
 const players=[
  {user_id:'a',display_name:'Alex',seat_number:1},
  {user_id:'b',display_name:'Ben',seat_number:3},
 ];
 const prompts=(opts.responses??['100','60']).slice();
 const sandbox:any={
  hs,
  window:{
   prompt:()=>prompts.shift()??null,
   confirm:()=>opts.accept!==false,
  },
  htApi:async(path:string,options?:any)=>{
   calls.push({path,body:options?.body?JSON.parse(options.body):null});
   if(opts.fail)throw new Error('Network unavailable');
   if(path.endsWith('/stack-baseline'))return {
    enabled:opts.enabled??true,confirmed:opts.confirmed??false,players,
   };
   if(path.endsWith('/confirm-stacks'))return {confirmed:true};
   throw Error('Unknown API path '+path);
  },
  getGameId:()=> 'g',
  getSeated:()=>[
   {name:'Alex',seat:1,p:{userId:'a'}},
   {name:'Ben',seat:3,p:{userId:'b'}},
  ],
  buildClockwiseOrder:()=>[1,4,3,2],
  gameInfo:()=>({seats:4}),
  autoPost:(_hand:any,_roster:any,_straddle:any,callback:()=>void)=>{
   posts++;callback();
  },
  toast:(message:string)=>{messages.push(message);},
  renderBody:()=>{},
  renderBoardOnFelt:()=>{},
 };
 runInNewContext(shipped,sandbox);
 return {hs,calls,messages,posts:()=>posts,sandbox};
}
describe('shipped opening-stack confirmation and interruption recovery',()=>{
 it('continues legacy staging without probing optional migration tables twice',async()=>{
  const f=fixture({enabled:false});
  f.sandbox.window.htResumeBlindPosts();
  await tick();
  expect(f.posts()).toBe(1);
  expect(f.calls.map(x=>x.path)).toEqual([
   '/games/g/hands/h/stack-baseline',
  ]);
  expect(f.hs._awaitingStackGate).toBe(false);
 });
 it('sends physically counted chips, never a buy-in dollar estimate',async()=>{
  const f=fixture({enabled:true,responses:['130','70']});
  f.sandbox.window.htResumeBlindPosts();
  await tick();await tick();
  expect(f.posts()).toBe(1);
  const write=f.calls.find(c=>c.path.endsWith('/confirm-stacks'));
  expect(write?.body).toMatchObject({
   verified:true,
   opening_stacks:[
    {user_id:'a',display_name:'Alex',seat_number:1,opening_chips:130},
    {user_id:'b',display_name:'Ben',seat_number:3,opening_chips:70},
   ],
  });
  expect(f.hs._awaitingStackGate).toBe(false);
 });
 it('does not post blinds when the physical count is cancelled',async()=>{
  const f=fixture({responses:[null]});
  f.sandbox.window.htResumeBlindPosts();
  await tick();
  expect(f.posts()).toBe(0);
  expect(f.calls.some(x=>x.path.endsWith('/confirm-stacks'))).toBe(false);
  expect(f.hs._awaitingStackGate).toBe(true);
 });
 it('resumes a previously confirmed baseline without asking for counts again',async()=>{
  const f=fixture({confirmed:true,responses:[null]});
  f.sandbox.window.htResumeBlindPosts();
  await tick();
  expect(f.posts()).toBe(1);
  expect(f.calls).toHaveLength(1);
 });
 it('never posts blindly when the stack status request fails',async()=>{
  const f=fixture({fail:true});
  f.sandbox.window.htResumeBlindPosts();
  await tick();
  expect(f.posts()).toBe(0);
  expect(f.hs._awaitingStackGate).toBe(true);
  expect(f.messages.some(x=>x.includes('Unable to confirm stacks'))).toBe(true);
 });
});
