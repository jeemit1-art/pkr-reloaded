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

function fixture({installed=true,mobile=true,header=true,blockedStorage=false,storedScroll}={}){
  const frames=new Map(),timers=new Map(),observers=[];
  let counter=0,entryCounter=0,replaceCount=0,queryUpdates=0,storageWrites=0,headerVisible=header;
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
  const storage=new Map();
  if(storedScroll!==undefined)storage.set(scrolling.PAGE_SCROLL_SESSION_KEY,storedScroll);
  Object.defineProperty(win,'sessionStorage',{get(){
    if(blockedStorage)throw new Error('Synthetic storage blocked');
    return {getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storageWrites++;storage.set(key,value);}};
  }});
  const firstTree={synthetic:'Next router tree'};
  const entries=[{state:{__NA:true,__PRIVATE_NEXTJS_INTERNALS_TREE:firstTree},url:win.location.href}];
  let index=0;
  win.history={scrollRestoration:'auto',
    get state(){return entries[index].state;},get length(){return entries.length;},
    replaceState(state,_unused,url){
      replaceCount++;
      // Match Next's installed wrapper: marker flags bypass external query-hook
      // updates; otherwise it copies its current internals into the caller state.
      if(!state?.__NA&&!state?._N){
        if(url)queryUpdates++;
        state={...state,__NA:entries[index].state.__NA,
          __PRIVATE_NEXTJS_INTERNALS_TREE:entries[index].state.__PRIVATE_NEXTJS_INTERNALS_TREE};
      }
      entries[index]={state,url:url?new URL(url,win.location.href).href:win.location.href};win.location=new URL(entries[index].url);
    },
    pushState(state,_unused,url){entries.splice(index+1);entries.push({state,url:new URL(url,win.location.href).href});index++;win.location=new URL(entries[index].url);},
  };
  const headerElement={getBoundingClientRect:()=>({width:media.matches?430:0,height:headerVisible?64:0})};
  const anchors=new Map();
  global.document=Object.assign(new EventTarget(),{documentElement:root,body,visibilityState:'visible',
    querySelector:selector=>selector==='.pkr-primary-mobile-utility'&&headerVisible?headerElement:null,
    getElementById:id=>anchors.get(id)||null,getElementsByName:()=>[]});
  global.window=win;
  global.MutationObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}};
  global.ResizeObserver=class{observe(){}disconnect(){}};
  let controller=installPageScrollController('/dashboard');
  const flush=()=>{for(let round=0;frames.size&&round<20;round++){const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());}assert.equal(frames.size,0,'Controller must not loop through animation frames');};
  const settle=()=>{for(const [id,timer]of [...timers])if(timer.delay===350){timers.delete(id);timer.fn();}flush();};
  const mutate=()=>{observers.filter(observer=>!observer.disconnected).forEach(observer=>observer.fn([]));flush();};
  const inputScroll=top=>{win.dispatchEvent(new Event('wheel'));if(scrolling.isContainedPageScroll())body.scrollTo({top});else win.scrollTo({top});flush();};
  const push=url=>{win.history.pushState({__NA:true,__PRIVATE_NEXTJS_INTERNALS_TREE:{synthetic:url}},'',url);controller.routeCommitted(win.location.pathname);flush();};
  const traverse=delta=>{index+=delta;win.location=new URL(entries[index].url);win.dispatchEvent(new Event('popstate'));controller.routeCommitted(win.location.pathname);flush();};
  return {win,root,body,media,get controller(){return controller;},firstTree,flush,settle,mutate,inputScroll,push,traverse,storage,
    setHeader(value){headerVisible=value;mutate();},
    setMobile(value){media.matches=value;if(!value)body.scrollTop=0;media.dispatchEvent(new Event('change'));flush();},
    anchor(id,top){let calls=0;anchors.set(id,{scrollIntoView:options=>{assert.equal(options.block,'start');calls++;body.scrollTo({top});}});return()=>calls;},
    hide(){document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));},
    reload(){
      win.dispatchEvent(new Event('pagehide'));controller.dispose();body.scrollTop=0;body.scrollLeft=0;win.scrollTo({left:0,top:0});
      document.visibilityState='visible';controller=installPageScrollController(win.location.pathname);flush();
    },
    get replaceCount(){return replaceCount;},get queryUpdates(){return queryUpdates;},
    get storageWrites(){return storageWrites;},get timers(){return timers.size;},
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
const queryState=scrolling.historyStateForQueryUpdate({...extended,_N:true});
assert.equal(queryState.__NA,undefined);assert.equal(queryState._N,undefined);
assert.equal(queryState.existing,'preserved');assert.deepEqual(queryState[scrolling.PAGE_SCROLL_HISTORY_KEY],entry);
assert.equal(queryState.__PRIVATE_NEXTJS_INTERNALS_TREE,nextState.__PRIVATE_NEXTJS_INTERNALS_TREE);
assert.equal(extended.__NA,true,'Preparing an external query update must not mutate current Next state');

// Main routing contract: body owns scroll, native root stays stationary, and
// history positions remain distinct even when revisiting the same URL.
{
  const f=fixture();f.settle();
  assert.equal(scrolling.isContainedPageScroll(),true);assert.equal(f.win.history.scrollRestoration,'manual');
  assert.equal(f.win.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE,f.firstTree);
  const writes=f.replaceCount;
  for(let y=20;y<=480;y+=20)f.inputScroll(y);
  assert.equal(f.replaceCount,writes,'Scrolling must not exhaust WebKit history-write limits');
  assert.equal(f.storageWrites,0,'Scroll events must not write to session storage');
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

// Payments native query replacement must update Next query hooks without losing
// the current entry or forcing a jump over its focused, filtered record list.
{
  const f=fixture();f.settle();f.push('/payments?room=synthetic');f.settle();f.inputScroll(380);
  const before=f.win.history.state;
  const id=scrolling.readPageScrollEntry(before).id;
  f.win.history.replaceState(scrolling.historyStateForQueryUpdate(before),'','/payments?room=synthetic&paymentSearch=fictional');
  f.controller.routeCommitted('/payments');f.flush();
  assert.equal(f.queryUpdates,1);assert.equal(f.win.history.state.__NA,true);
  assert.equal(f.win.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE,before.__PRIVATE_NEXTJS_INTERNALS_TREE);
  assert.equal(scrolling.readPageScrollEntry(f.win.history.state).id,id);assert.equal(f.body.scrollTop,380);
  f.body.scrollTo({top:620});f.mutate();assert.equal(f.body.scrollTop,620,'Summary record focus must not be undone by an accidental top reset');
  f.controller.dispose();
}

// Explicit scroll={false} intent is exact-target and single-use. Normal room
// navigation still opens at the top, including a new entry on the same pathname.
{
  const f=fixture();f.settle();f.push('/payments?paymentsView=overview');f.settle();f.inputScroll(260);
  scrolling.preservePageScrollForNavigation('/payments?paymentsView=ledger');
  f.push('/payments?paymentsView=ledger');assert.equal(f.body.scrollTop,260);f.settle();f.inputScroll(350);
  scrolling.preservePageScrollForNavigation('/payments?paymentsView=overview');
  f.push('/payments?paymentsView=overview');assert.equal(f.body.scrollTop,350);f.settle();
  f.push('/payments?paymentsView=ledger');assert.equal(f.body.scrollTop,0,'A consumed intent cannot affect a later navigation');f.settle();
  f.inputScroll(240);scrolling.preservePageScrollForNavigation('/payments?paymentsView=overview');
  f.push('/events/synthetic?tab=games');assert.equal(f.body.scrollTop,0,'A different target must discard the intent');f.settle();
  f.inputScroll(410);f.push('/events/synthetic?tab=members');assert.equal(f.body.scrollTop,0,'Ordinary same-path room navigation must still reset');f.settle();
  f.inputScroll(200);
  const now=Date.now;
  try{
    Date.now=()=>10000;scrolling.preservePageScrollForNavigation('/payments?paymentsView=overview');
    Date.now=()=>15001;
    assert.equal(scrolling.consumePreservedPageScroll(f.win.location.href,'https://pkr.example/payments?paymentsView=overview'),null,'Abandoned navigation intent expires');
  }finally{Date.now=now;}
  f.controller.dispose();
}

// A reload destroys the controller's in-memory Map. Departed history entries
// still restore from this tab's bounded, coordinate-only snapshot afterwards.
{
  const f=fixture();f.settle();f.inputScroll(480);
  const dashboardId=scrolling.readPageScrollEntry(f.win.history.state).id;
  f.push('/account');f.settle();f.inputScroll(180);
  const accountTree=f.win.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE;
  assert.equal(f.storageWrites,0);
  f.hide();assert.equal(f.storageWrites,1);
  let stored=JSON.parse(f.storage.get(scrolling.PAGE_SCROLL_SESSION_KEY));
  assert.equal(stored.positions.find(row=>row.id===dashboardId).top,480);
  for(const row of stored.positions)assert.deepEqual(Object.keys(row).sort(),['id','left','top']);
  assert.equal(JSON.stringify(stored).includes('https://'),false);assert.equal(JSON.stringify(stored).includes('/dashboard'),false);
  f.reload();assert.equal(f.body.scrollTop,180);assert.equal(f.win.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE,accountTree);
  f.settle();f.traverse(-1);assert.equal(f.body.scrollTop,480,'Back after reloading Account must retain departed Dashboard scroll');
  f.settle();f.traverse(1);assert.equal(f.body.scrollTop,180);f.controller.dispose();
}

// Corrupt or unavailable per-tab storage cannot block navigation. Stored input
// is validated and reduced to bounded opaque IDs and finite non-negative offsets.
{
  const f=fixture({storedScroll:'{broken json'});f.settle();f.inputScroll(300);f.push('/account');f.settle();
  f.traverse(-1);assert.equal(f.body.scrollTop,300);f.hide();
  assert.equal(JSON.parse(f.storage.get(scrolling.PAGE_SCROLL_SESSION_KEY)).version,1);f.controller.dispose();
  const blocked=fixture({blockedStorage:true});blocked.settle();blocked.inputScroll(340);blocked.push('/account');blocked.settle();
  blocked.hide();blocked.traverse(-1);assert.equal(blocked.body.scrollTop,340);blocked.controller.dispose();
  const invalids=[{version:0,positions:[]},{version:1,positions:null},{version:1,positions:[
    {id:'https://private.example/path',left:0,top:10},{id:'invalid-top',left:0,top:-1},{id:'invalid-left',left:'0',top:1},
  ]}];
  for(const invalid of invalids){
    const checked=fixture({installed:false,storedScroll:JSON.stringify(invalid)});
    assert.equal(scrolling.loadPageScrollPositions().size,0);checked.controller.dispose();
  }
  const bounded=fixture({installed:false});
  const positions=new Map(Array.from({length:200},(_,index)=>[`synthetic-${index}`,{left:0,top:index}]));
  scrolling.savePageScrollPositions(positions);
  const rows=JSON.parse(bounded.storage.get(scrolling.PAGE_SCROLL_SESSION_KEY)).positions;
  assert.equal(rows.length,scrolling.PAGE_SCROLL_POSITION_LIMIT);assert.equal(rows.at(-1).top,199);
  assert.equal(scrolling.loadPageScrollPositions().size,scrolling.PAGE_SCROLL_POSITION_LIMIT);bounded.controller.dispose();
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
console.log('Page scroll: mode migration, route/history/hash restoration, reload/Back persistence, user cancellation and nested locks passed.');
