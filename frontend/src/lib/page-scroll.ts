/** The installed mobile shell scrolls its body; other views keep native page scrolling. */
export const CONTAINED_SCROLL_CLASS='pkr-contained-scroll';
export const PAGE_SCROLL_HISTORY_KEY='__pkrPageScroll';
export type PageScrollPosition={left:number;top:number};
export type PageScrollEntry=PageScrollPosition&{version:1;id:string;href:string};

let restoringHref:string|null=null;

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
