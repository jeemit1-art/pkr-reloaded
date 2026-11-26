import {RUNNING_APP_VERSION} from './app-update';

/** An explicit copy action only. No URL, account, club, storage or device ID. */
export function collectDisplayDetails(){
  const header=document.querySelector<HTMLElement>('.pkr-primary-mobile-utility');
  const headerStyle=header?window.getComputedStyle(header):null;
  const box=header?.getBoundingClientRect();
  const viewport=window.visualViewport;
  const rootStyle=window.getComputedStyle(document.documentElement);
  const bodyStyle=window.getComputedStyle(document.body);
  const bodyBox=document.body.getBoundingClientRect();
  const probe=document.createElement('div');
  probe.setAttribute('aria-hidden','true');
  probe.style.cssText='position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  let safeArea:{top:string;right:string;bottom:string;left:string};
  try{
    const style=window.getComputedStyle(probe);
    safeArea={top:style.paddingTop,right:style.paddingRight,bottom:style.paddingBottom,left:style.paddingLeft};
  }finally{probe.remove();}
  return {
    appVersion:RUNNING_APP_VERSION,
    standalone:window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone),
    screen:{width:window.screen.width,height:window.screen.height},
    innerViewport:{width:window.innerWidth,height:window.innerHeight},
    visualViewport:viewport?{width:viewport.width,height:viewport.height,offsetTop:viewport.offsetTop,offsetLeft:viewport.offsetLeft,scale:viewport.scale}:null,
    canvas:{rootBackground:rootStyle.backgroundColor,bodyBackground:bodyStyle.backgroundColor},
    header:box&&headerStyle?{rect:{top:box.top,right:box.right,bottom:box.bottom,left:box.left,width:box.width,height:box.height},
      position:headerStyle.position,paddingTop:headerStyle.paddingTop,opacity:headerStyle.opacity,background:headerStyle.backgroundColor,display:headerStyle.display}:null,
    safeArea,
    scrollSurface:{
      mode:document.documentElement.classList.contains('pkr-contained-scroll')?'contained-body':'document',
      windowTop:window.scrollY,documentTop:document.scrollingElement?.scrollTop??null,
      bodyTop:document.body.scrollTop,bodyHeight:document.body.clientHeight,bodyScrollHeight:document.body.scrollHeight,
      rootOverflowY:rootStyle.overflowY,bodyOverflowY:bodyStyle.overflowY,bodyPosition:bodyStyle.position,
      bodyBounds:{top:bodyBox.top,bottom:bodyBox.bottom,height:bodyBox.height},
    },
  };
}
