/** The installed mobile shell scrolls its body; other views keep native page scrolling. */
export const CONTAINED_SCROLL_CLASS='pkr-contained-scroll';
export const PAGE_SCROLL_HISTORY_KEY='__pkrPageScroll';
export const PAGE_SCROLL_SESSION_KEY='pkr_page_scroll_v1';
export const PAGE_SCROLL_POSITION_LIMIT=80;
export type PageScrollPosition={left:number;top:number};
export type PageScrollEntry=PageScrollPosition&{version:1;id:string;href:string};

let restoringHref:string|null=null;
let preservedNavigation:{from:string;to:string;position:PageScrollPosition;expires:number}|null=null;

export function isContainedPageScroll(){
  return typeof document!=='undefined'&&document.documentElement.classList.contains(CONTAINED_SCROLL_CLASS);
}

export function getPageScroll():PageScrollPosition{
  if(typeof window==='undefined')return {left:0,top:0};
  return isContainedPageScroll()?{left:document.body.scrollLeft,top:document.body.scrollTop}:
    {left:window.scrollX,top:window.scrollY};
}

export function scrollPageTo(options:ScrollToOptions){
  if(typeof window==='undefined')return;
  if(isContainedPageScroll())document.body.scrollTo(options);
  else window.scrollTo(options);
}

/** Initial page resets must not overwrite a Back/Forward restoration. */
export function isRestoringPageScroll(){
  return typeof window!=='undefined'&&restoringHref===window.location.href;
}

export function markPageScrollRestoration(href:string|null){restoringHref=href;}

/** Explicit companion for a Next Link using scroll={false}. It applies once,
 * only to the intended destination from this page, and cannot affect a later tap. */
export function preservePageScrollForNavigation(target:string){
  preservedNavigation=null;
  if(typeof window==='undefined')return;
  const to=new URL(target,window.location.href);
  if(to.origin!==window.location.origin||to.href===window.location.href)return;
  preservedNavigation={from:window.location.href,to:to.href,position:getPageScroll(),expires:Date.now()+5000};
}

export function consumePreservedPageScroll(from:string|null,to:string):PageScrollPosition|null{
  const intent=preservedNavigation;preservedNavigation=null;
  return intent&&intent.from===from&&intent.to===to&&Date.now()<=intent.expires?intent.position:null;
}

export function clearPreservedPageScroll(){preservedNavigation=null;}

export function readPageScrollEntry(state:unknown):PageScrollEntry|null{
  if(!state||typeof state!=='object')return null;
  const entry=(state as Record<string,unknown>)[PAGE_SCROLL_HISTORY_KEY] as Partial<PageScrollEntry>|undefined;
  if(!entry||entry.version!==1||typeof entry.id!=='string'||typeof entry.href!=='string'||
    typeof entry.left!=='number'||typeof entry.top!=='number'||!Number.isFinite(entry.left)||!Number.isFinite(entry.top))return null;
  return {version:1,id:entry.id,href:entry.href,left:Math.max(0,entry.left),top:Math.max(0,entry.top)};
}

/** Preserve every Next/router field; the app owns only its namespaced scroll entry. */
export function withPageScrollEntry(state:unknown,entry:PageScrollEntry){
  return {...(state&&typeof state==='object'?state:{}),[PAGE_SCROLL_HISTORY_KEY]:entry};
}

/** Next's native history wrapper must see this as an external query update.
 * It copies its current router internals back and updates useSearchParams.
 * Retain all other custom state, including the current scroll entry identity. */
export function historyStateForQueryUpdate(state:unknown){
  const next:Record<string,unknown>={...(state&&typeof state==='object'?state:{})};
  delete next.__NA;delete next._N;
  return next;
}

function validStoredPosition(value:unknown):value is PageScrollPosition&{id:string}{
  if(!value||typeof value!=='object')return false;
  const row=value as Record<string,unknown>;
  return typeof row.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(row.id)&&
    typeof row.left==='number'&&Number.isFinite(row.left)&&row.left>=0&&
    typeof row.top==='number'&&Number.isFinite(row.top)&&row.top>=0;
}

/** Keep departed SPA entries restorable after a reload in this tab. Only opaque
 * history-entry IDs and offsets are persisted, never URLs or application data. */
export function loadPageScrollPositions():Map<string,PageScrollPosition>{
  const positions=new Map<string,PageScrollPosition>();
  if(typeof window==='undefined')return positions;
  try{
    const raw=window.sessionStorage.getItem(PAGE_SCROLL_SESSION_KEY);
    if(!raw||raw.length>32000)return positions;
    const saved=JSON.parse(raw) as {version?:unknown;positions?:unknown};
    if(!saved||saved.version!==1||!Array.isArray(saved.positions))return positions;
    for(const row of saved.positions.slice(-PAGE_SCROLL_POSITION_LIMIT)){
      if(validStoredPosition(row))positions.set(row.id,{left:row.left,top:row.top});
    }
  }catch{}
  return positions;
}

export function savePageScrollPositions(positions:ReadonlyMap<string,PageScrollPosition>){
  if(typeof window==='undefined')return;
  const rows=Array.from(positions,([id,position])=>({id,left:position.left,top:position.top}))
    .filter(validStoredPosition).slice(-PAGE_SCROLL_POSITION_LIMIT);
  try{window.sessionStorage.setItem(PAGE_SCROLL_SESSION_KEY,JSON.stringify({version:1,positions:rows}));}catch{}
}
