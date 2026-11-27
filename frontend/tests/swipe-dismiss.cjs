'use strict';
// Deterministic touch-controller safety checks; no browser, network or user records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/lib/swipe-dismiss.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const exportsForTest={};new Function('exports',compiled)(exportsForTest);
const {installSwipeDismiss}=exportsForTest;

class NodeElement extends EventTarget{
 constructor(parent=null,kind='div'){super();this.parentElement=parent;this.kind=kind;this.attrs=new Map();this.scrollHeight=400;this.clientHeight=400;this.scrollTop=0;this.overflowY='visible';this.control=['input','button','textarea','select','label','summary'].includes(kind);const props=new Map();this.style={setProperty:(k,v)=>props.set(k,v),removeProperty:k=>props.delete(k),getPropertyValue:k=>props.get(k)||''};this.ownerDocument=parent?.ownerDocument;}
 setAttribute(k,v){this.attrs.set(k,v);}getAttribute(k){return this.attrs.get(k)??null;}removeAttribute(k){this.attrs.delete(k);}
 matches(selector){return selector==='dialog'?this.kind==='dialog':selector==='[data-pkr-swipe-row]'&&this.attrs.has('data-pkr-swipe-row');}
 contains(target){for(let n=target;n;n=n.parentElement)if(n===this)return true;return false;}
 closest(selector){for(let n=this;n;n=n.parentElement){if(selector==='dialog'?n.kind==='dialog':n.control)return n;}return null;}
 getBoundingClientRect(){return {height:400};}
}
global.Element=NodeElement;
function fixture(){
 const timers=new Map();let seq=0,dismissed=0,reduced=false,enabled=true;
 const owner=new EventTarget(),view={innerHeight:873,getComputedStyle:el=>({overflowY:el.overflowY}),matchMedia:()=>({matches:reduced}),setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};owner.defaultView=view;
 const surface=new NodeElement(null,'dialog');surface.ownerDocument=owner;
 const list=new NodeElement(surface);list.scrollHeight=1200;list.clientHeight=250;list.overflowY='auto';
 const row=new NodeElement(list,'button');row.setAttribute('data-pkr-swipe-row','');
 const input=new NodeElement(list,'input'),header=new NodeElement(surface);
 const cleanup=installSwipeDismiss(surface,()=>dismissed++,{isEnabled:()=>enabled});
 const touch=(type,target,x=100,y=100,count=1,cancelable=true)=>{
  const event=new Event(type,{cancelable});Object.defineProperty(event,'target',{value:target});
  Object.defineProperty(event,'touches',{value:type==='touchend'||type==='touchcancel'?[]:Array.from({length:count},(_,i)=>({identifier:i+1,clientX:x+i*10,clientY:y}))});surface.dispatchEvent(event);return event;
 };
 const start=target=>touch('touchstart',target),move=(target,x,y,count,cancelable)=>touch('touchmove',target,x,y,count,cancelable),end=target=>touch('touchend',target);
 const flush=ms=>{for(const [id,t]of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}};
 const swipe=(target,x=100,y=210)=>{start(target);move(target,x,y);end(target);};
 return {surface,list,row,input,header,owner,cleanup,start,move,end,touch,flush,swipe,setEnabled:v=>enabled=v,setReduced:v=>reduced=v,get dismissed(){return dismissed;}};
}

{
 const f=fixture();f.start(f.header);assert(f.move(f.header,100,210).defaultPrevented);assert.equal(f.dismissed,0);f.end(f.header);assert.equal(f.dismissed,0);f.flush(160);assert.equal(f.dismissed,1);assert.equal(f.surface.style.getPropertyValue('--pkr-swipe-y'),'');f.cleanup();
}
for(const [description,x,y]of [['short',100,140],['upward',100,20],['horizontal',250,112],['diagonal',240,210]]){
 const f=fixture();f.swipe(f.header,x,y);f.flush(160);assert.equal(f.dismissed,0,description+' movement must not dismiss');assert.equal(f.surface.style.getPropertyValue('--pkr-swipe-y'),'');f.cleanup();
}
{
 const f=fixture();f.start(f.header);f.move(f.header,100,112);f.move(f.header,310,210);f.end(f.header);f.flush(160);assert.equal(f.dismissed,0,'A small initial downward movement must not convert a sideways gesture to dismissal');f.cleanup();
}
{
 const f=fixture();f.list.scrollTop=200;f.start(f.row);f.list.scrollTop=0;assert.equal(f.move(f.row,100,230).defaultPrevented,false);f.end(f.row);f.flush(160);assert.equal(f.dismissed,0,'A native list-scroll gesture must remain native after reaching the top');f.cleanup();
}
{
 const f=fixture();f.list.scrollTop=0;f.swipe(f.row);f.flush(160);assert.equal(f.dismissed,1,'Read-only rows support dismissal at the list top');f.cleanup();
}
{
 const f=fixture();f.list.scrollTop=200;f.swipe(f.header);f.flush(160);assert.equal(f.dismissed,1,'Header gesture can close even when the separate records list is scrolled');f.cleanup();
}
for(const ending of ['touchcancel','multitouch','uncancelable']){
 const f=fixture();f.start(f.header);f.move(f.header,100,210);
 if(ending==='touchcancel')f.touch('touchcancel',f.header);
 else if(ending==='multitouch')f.move(f.header,100,230,2);
 else{f.touch('touchcancel',f.header);f.start(f.header);assert.equal(f.move(f.header,100,230,1,false).defaultPrevented,false);}
 f.end(f.header);f.flush(160);assert.equal(f.dismissed,0,ending+' must cancel safely');assert.equal(f.surface.style.getPropertyValue('--pkr-swipe-y'),'');f.cleanup();
}
{
 const f=fixture();f.start(f.input);assert.equal(f.move(f.input,100,230).defaultPrevented,false);f.end(f.input);f.flush(160);assert.equal(f.dismissed,0,'Editing and selection gestures cannot dismiss');f.cleanup();
}
{
 const f=fixture();f.swipe(f.header);f.cleanup();f.flush(160);assert.equal(f.dismissed,0,'Unmount cancels deferred dismissal');assert.equal(f.surface.getAttribute('data-pkr-swipe-surface'),null);
}
{
 const f=fixture();f.setReduced(true);f.swipe(f.header);f.flush(0);assert.equal(f.dismissed,1);f.swipe(f.header);f.flush(0);assert.equal(f.dismissed,2,'An imperative sheet can reopen and dismiss again');f.cleanup();
}
{
 const f=fixture();f.setEnabled(false);f.swipe(f.header);f.flush(160);assert.equal(f.dismissed,0);f.setEnabled(true);f.start(f.header);f.move(f.header,100,210);f.setEnabled(false);f.end(f.header);f.flush(160);assert.equal(f.dismissed,0,'An editing transition cannot be dismissed');f.cleanup();
}
{
 const f=fixture();f.swipe(f.row);f.flush(160);f.cleanup();
 const click=detail=>{const event=new Event('click',{cancelable:true});Object.assign(event,{detail,clientX:100,clientY:210});f.owner.dispatchEvent(event);return event;};
 assert.equal(click(0).defaultPrevented,false,'Keyboard activation is preserved');assert.equal(click(1).defaultPrevented,true,'A compatibility click cannot reach the page under the dismissed sheet');assert.equal(click(1).defaultPrevented,false,'The compatibility guard is one-shot');
}
console.log('Swipe dismissal safety: passed (directions, scroll ownership, controls, cancellation, reduced motion, cleanup and click-through).');
