/** Touch dismissal for read-only sheets. It never owns document scrolling. */
export function installSwipeDismiss(surface:HTMLElement,onDismiss:()=>void,options:{isEnabled?:()=>boolean}={}){
  const owner=surface.ownerDocument,view=owner.defaultView;
  if(!view)return()=>{};
  const previous=surface.getAttribute('data-pkr-swipe-surface');
  surface.setAttribute('data-pkr-swipe-surface','');
  type Gesture={id:number;x:number;y:number;lastX:number;lastY:number;distance:number;dragging:boolean;scrollers:HTMLElement[]};
  let gesture:Gesture|null=null,closing=false,disposed=false,timer:number|undefined;
  const enabled=()=>!disposed&&!closing&&(options.isEnabled?.()??true);
  const reset=()=>{
    gesture=null;
    surface.style.removeProperty('--pkr-swipe-y');
    surface.removeAttribute('data-pkr-swipe-state');
  };
  const controlSelector='input,textarea,select,option,a[href],button,[role="button"],[contenteditable]:not([contenteditable="false"]),label,summary,[data-pkr-swipe-ignore]';
  function start(event:TouchEvent){
    if(!enabled())return;
    reset();
    if(event.touches.length!==1)return;
    const target=event.target;
    if(!(target instanceof Element)||!surface.contains(target))return;
    // Record rows can be tapped or swiped. Actual inputs/actions retain native gestures.
    const control=target.closest(controlSelector);
    if(control&&!control.matches('[data-pkr-swipe-row]'))return;
    // A nested top-layer dialog must own its own touch sequence.
    if(target.closest('dialog')!==surface.closest('dialog'))return;
    const scrollers:HTMLElement[]=[];
    for(let element=target as HTMLElement;element; element=element.parentElement as HTMLElement){
      if(element.scrollHeight>element.clientHeight+1&&/auto|scroll/.test(view!.getComputedStyle(element).overflowY))scrollers.push(element);
      if(element===surface)break;
    }
    // A downward gesture that begins part-way down a list is always list scrolling,
    // even if that same gesture later reaches the top.
    if(scrollers.some(element=>element.scrollTop>1))return;
    const touch=event.touches[0];
    gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,lastX:touch.clientX,lastY:touch.clientY,distance:0,dragging:false,scrollers};
  }
  function move(event:TouchEvent){
    if(!gesture)return;
    if(!enabled()||event.touches.length!==1){reset();return;}
    const touch=Array.from(event.touches).find(item=>item.identifier===gesture!.id);
    if(!touch){reset();return;}
    const dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
    if(!gesture.dragging){
      if(Math.max(Math.abs(dx),Math.abs(dy))<8)return;
      if(dy<=0||Math.abs(dx)>dy||gesture.scrollers.some(element=>element.scrollTop>1)){reset();return;}
      // If the browser already owns scrolling, do not move the sheet as well.
      if(!event.cancelable){reset();return;}
      gesture.dragging=true;
      surface.setAttribute('data-pkr-swipe-state','dragging');
    }
    if(event.cancelable)event.preventDefault();
    gesture.lastX=touch.clientX;gesture.lastY=touch.clientY;
    gesture.distance=Math.max(0,dy);
    surface.style.setProperty('--pkr-swipe-y',Math.min(gesture.distance,view!.innerHeight)+'px');
  }
  function suppressCompatibilityClick(x:number,y:number){
    // touchmove.preventDefault normally suppresses this. Also guard the ending
    // position after unmount so a compatibility click cannot hit the page below.
    const block=(event:MouseEvent)=>{
      if(event.detail===0||Math.abs(event.clientX-x)>24||Math.abs(event.clientY-y)>24)return;
      event.preventDefault();event.stopImmediatePropagation();remove();
    };
    const remove=()=>owner.removeEventListener('click',block,{capture:true});
    owner.addEventListener('click',block,{capture:true});
    view!.setTimeout(remove,400);
  }
  function finish(event:TouchEvent){
    if(!gesture)return;
    const finished=gesture;gesture=null;
    if(finished.dragging)suppressCompatibilityClick(finished.lastX,finished.lastY);
    // Cancellation (including an interrupted multi-touch gesture) never dismisses.
    if(event.type==='touchcancel'||event.touches.length||!enabled()||!finished.dragging||finished.distance<80
      ||Math.abs(finished.lastX-finished.x)>finished.distance){reset();return;}
    closing=true;
    surface.setAttribute('data-pkr-swipe-state','closing');
    surface.style.setProperty('--pkr-swipe-y',Math.max(view!.innerHeight,surface.getBoundingClientRect().height)+'px');
    const delay=view!.matchMedia('(prefers-reduced-motion: reduce)').matches?0:160;
    timer=view!.setTimeout(()=>{
      if(disposed)return;
      onDismiss();closing=false;reset();
    },delay);
  }
  surface.addEventListener('touchstart',start,{passive:true});
  surface.addEventListener('touchmove',move,{passive:false});
  surface.addEventListener('touchend',finish,{passive:true});
  surface.addEventListener('touchcancel',finish,{passive:true});
  return()=>{
    disposed=true;
    if(timer!==undefined)view.clearTimeout(timer);
    surface.removeEventListener('touchstart',start);
    surface.removeEventListener('touchmove',move);
    surface.removeEventListener('touchend',finish);
    surface.removeEventListener('touchcancel',finish);
    reset();
    if(previous===null)surface.removeAttribute('data-pkr-swipe-surface');
    else surface.setAttribute('data-pkr-swipe-surface',previous);
  };
}
