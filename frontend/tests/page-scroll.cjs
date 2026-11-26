// Deterministic DOM/history fixtures only; no browser or network requests.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');

function load(relative,dependencies={}){
  const source=fs.readFileSync(path.join(__dirname,'..',relative),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exposed={};
  new Function('exports','require',output)(exposed,name=>dependencies[name]||require(name));
  return exposed;
}
const scrolling=load('src/lib/page-scroll.ts');
const {installPageScrollController}=load('src/components/InstalledPageScroll.tsx',{
  '@/lib/page-scroll':scrolling,'next/navigation':{},
});

function fixture({installed=true,mobile=true,header=true}={}){
  const frames=new Map(),timers=new Map(),observers=[];
  let counter=0,entryCounter=0,replaceCount=0,headerVisible=header;
  const win=new EventTarget(),body=new EventTarget(),media=new EventTarget();
  const classes=new Set(installed?['pkr-installed']:[]);
  const root={classList:{contains:value=>classes.has(value),add:value=>classes.add(value),remove:value=>classes.delete(value)},scrollTop:0,scrollLeft:0};
  body.scrollTop=0;body.scrollLeft=0;body.maximum=2000;body.style={overflow:''};
  body.scrollTo=options=>{
    body.scrollTop=Math.max(0,Math.min(body.maximum,options.top??body.scrollTop));
    body.scrollLeft=Math.max(0,options.left??body.scrollLeft);body.dispatchEvent(new Event('scroll'));
  };
  win.location=new URL('https://pkr.example/dashboard');win.scrollY=0;win.scrollX=0;
  win.scrollTo=options=>{
    win.scrollY=Math.max(0,options.top??win.scrollY);win.scrollX=Math.max(0,options.left??win.scrollX);
    root.scrollTop=win.scrollY;root.scrollLeft=win.scrollX;win.dispatchEvent(new Event('scroll'));
  };
  media.matches=mobile;win.matchMedia=()=>media;win.crypto={randomUUID:()=>`synthetic-entry-${++entryCounter}`};
  win.getComputedStyle=()=>({visibility:'visible'});
  win.requestAnimationFrame=fn=>{const id=++counter;frames.set(id,fn);return id;};
  win.cancelAnimationFrame=id=>frames.delete(id);
  win.setTimeout=(fn,delay)=>{const id=++counter;timers.set(id,{fn,delay});return id;};
  win.clearTimeout=id=>timers.delete(id);
  const firstTree={synthetic:'Next router tree'};
  const entries=[{state:{__NA:true,__PRIVATE_NEXTJS_INTERNALS_TREE:firstTree},url:win.location.href}];
  let index=0;
  win.history={scrollRestoration:'auto',
    get state(){return entries[index].state;},get length(){return entries.length;},
    replaceState(state,_unused,url){replaceCount++;entries[index]={state,url:url?new URL(url,win.location.href).href:win.location.href};win.location=new URL(entries[index].url);},
    pushState(state,_unused,url){entries.splice(index+1);entries.push({state,url:new URL(url,win.location.href).href});index++;win.location=new URL(entries[index].url);},
  };
  const headerElement={getBoundingClientRect:()=>({width:media.matches?430:0,height:headerVisible?64:0})};
  const anchors=new Map();
  global.document={documentElement:root,body,querySelector:selector=>selector==='.pkr-primary-mobile-utility'&&headerVisible?headerElement:null,
    getElementById:id=>anchors.get(id)||null,getElementsByName:()=>[]};
  global.window=win;
  global.MutationObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  global.ResizeObserver=class{observe(){}disconnect(){}};
  const controller=installPageScrollController('/dashboard');
  const flush=()=>{for(let round=0;frames.size&&round<20;round++){const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());}assert.equal(frames.size,0,'Controller must not loop through animation frames');};
  const settle=()=>{for(const [id,timer]of [...timers])if(timer.delay===350){timers.delete(id);timer.fn();}flush();};
  const mutate=()=>{observers.filter(observer=>!observer.disconnected).forEach(observer=>observer.fn([]));flush();};
  const inputScroll=top=>{win.dispatchEvent(new Event('wheel'));if(scrolling.isContainedPageScroll())body.scrollTo({top});else win.scrollTo({top});flush();};
  const push=url=>{win.history.pushState({__NA:true,__PRIVATE_NEXTJS_INTERNALS_TREE:{synthetic:url}},'',url);controller.routeCommitted(win.location.pathname);flush();};
  const traverse=delta=>{index+=delta;win.location=new URL(entries[index].url);win.dispatchEvent(new Event('popstate'));controller.routeCommitted(win.location.pathname);flush();};
  return {win,root,body,media,controller,firstTree,flush,settle,mutate,inputScroll,push,traverse,
    setHeader(value){headerVisible=value;mutate();},
    setMobile(value){media.matches=value;if(!value)body.scrollTop=0;media.dispatchEvent(new Event('change'));flush();},
    anchor(id,top){let calls=0;anchors.set(id,{scrollIntoView:options=>{assert.equal(options.block,'start');calls++;body.scrollTo({top});}});return()=>calls;},
    get replaceCount(){return replaceCount;},get timers(){return timers.size;},
  };
}

// State validation and extension cannot replace Next state or accept bad offsets.
const nextState={__NA:true,__PRIVATE_NEXTJS_INTERNALS_TREE:{tree:'synthetic'},existing:'preserved'};
const entry={version:1,id:'synthetic',href:'https://pkr.example/dashboard',left:0,top:140};
const extended=scrolling.withPageScrollEntry(nextState,entry);
assert.equal(extended.__PRIVATE_NEXTJS_INTERNALS_TREE,nextState.__PRIVATE_NEXTJS_INTERNALS_TREE);
assert.equal(extended.existing,'preserved');assert.equal(nextState[scrolling.PAGE_SCROLL_HISTORY_KEY],undefined);
assert.deepEqual(scrolling.readPageScrollEntry(extended),entry);
for(const invalid of [null,{},scrolling.withPageScrollEntry({}, {...entry,version:2}),scrolling.withPageScrollEntry({}, {...entry,top:NaN})])
  assert.equal(scrolling.readPageScrollEntry(invalid),null);

// Main routing contract: body owns scroll, native root stays stationary, and
// history positions remain distinct even when revisiting the same URL.
{
  const f=fixture();f.settle();
  assert.equal(scrolling.isContainedPageScroll(),true);assert.equal(f.win.history.scrollRestoration,'manual');
  assert.equal(f.win.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE,f.firstTree);
  const writes=f.replaceCount;
  for(let y=20;y<=480;y+=20)f.inputScroll(y);
  assert.equal(f.replaceCount,writes,'Scrolling must not exhaust WebKit history-write limits');
  assert.equal(f.body.scrollTop,480);assert.equal(f.win.scrollY,0);assert.equal(f.root.scrollTop,0);
  f.push('/account');assert.equal(f.body.scrollTop,0);f.settle();f.inputScroll(180);
  f.traverse(-1);assert.equal(f.body.scrollTop,480);assert.equal(scrolling.isRestoringPageScroll(),true);f.settle();
  f.traverse(1);assert.equal(f.body.scrollTop,180);f.settle();
  const currentId=scrolling.readPageScrollEntry(f.win.history.state).id;
  f.controller.routeCommitted('/account');
  assert.equal(scrolling.readPageScrollEntry(f.win.history.state).id,currentId);assert.equal(f.win.history.length,2);
  f.push('/dashboard');assert.equal(f.body.scrollTop,0,'A new visit is not a Back restoration');
  f.controller.dispose();assert.equal(scrolling.isContainedPageScroll(),false);assert.equal(f.win.history.scrollRestoration,'auto');
  assert.equal(f.timers,0);
}

// Deferred data rendering must neither clamp away a saved position nor override
// deliberate user scrolling while the destination loads.
{
  const f=fixture();f.settle();f.inputScroll(640);f.push('/account');f.settle();
  f.body.maximum=100;f.traverse(-1);assert.equal(f.body.scrollTop,100);
  f.body.maximum=2000;f.mutate();assert.equal(f.body.scrollTop,640);f.settle();
  f.push('/account');f.settle();f.body.maximum=100;f.traverse(-1);
  f.inputScroll(60);f.body.maximum=2000;f.mutate();
  assert.equal(f.body.scrollTop,60,'Later data must not undo an intentional scroll');
  assert.equal(scrolling.isRestoringPageScroll(),false);f.controller.dispose();
}

// Hash content may mount after navigation. Resolve the actual anchor and retain
// the stationary root rather than using a device-specific offset.
{
  const f=fixture();f.settle();f.push('/account');f.settle();
  f.push('/dashboard#pkr-rooms');
  const calls=f.anchor('pkr-rooms',720);f.mutate();
  assert.equal(calls()>0,true);assert.equal(f.body.scrollTop,720);assert.equal(f.win.scrollY,0);
  f.settle();f.controller.dispose();
}

// The media query has already changed CSS before its listener runs. Use the last
// body offset for desktop migration and the native offset when re-entering.
{
  const f=fixture();f.settle();f.inputScroll(240);f.setMobile(false);
  assert.equal(scrolling.isContainedPageScroll(),false);assert.equal(f.win.scrollY,240);
  assert.equal(f.win.history.scrollRestoration,'auto');
  scrolling.scrollPageTo({top:300,behavior:'instant'});assert.equal(f.win.scrollY,300);
  f.setMobile(true);assert.equal(scrolling.isContainedPageScroll(),true);
  assert.equal(f.body.scrollTop,300);assert.equal(f.win.scrollY,0);
  scrolling.scrollPageTo({top:240,behavior:'instant'});assert.equal(f.body.scrollTop,240);
  f.setHeader(false);assert.equal(scrolling.isContainedPageScroll(),false);assert.equal(f.win.scrollY,240);
  f.setHeader(true);assert.equal(f.body.scrollTop,240);assert.equal(f.win.scrollY,0);f.controller.dispose();
}

// Browser tabs, desktop, public/auth and live/TV (no primary header) stay native.
for(const config of [{installed:false},{mobile:false},{header:false}]){
  const f=fixture(config);assert.equal(scrolling.isContainedPageScroll(),false);assert.equal(f.replaceCount,0);
  scrolling.scrollPageTo({top:120,behavior:'instant'});assert.equal(f.win.scrollY,120);assert.equal(f.body.scrollTop,0);
  f.controller.dispose();
}

// Existing overlays remain reference-counted and retain exact inline overflow
// state; their normal CSS body-scroller rule cannot override this lock.
{
  const f=fixture();f.settle();f.inputScroll(420);
  const {lockPageScroll}=load('src/lib/overlay-scroll.ts');
  const first=lockPageScroll(),second=lockPageScroll();
  assert.equal(f.body.style.overflow,'hidden');first();first();assert.equal(f.body.style.overflow,'hidden');
  second();assert.equal(f.body.style.overflow,'');assert.equal(f.body.scrollTop,420);f.controller.dispose();
}
console.log('Page scroll: mode migration, route/history/hash restoration, user cancellation and nested locks passed.');
