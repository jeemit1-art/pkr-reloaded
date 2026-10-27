// One-time, design-only fixes from reviewing the actual full-page capture.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function edit(name,fn){const p=path.join(root,name);const old=fs.readFileSync(p,'utf8');const next=fn(old);if(next===old)throw Error('Expected source change in '+name);fs.writeFileSync(p,next);}
edit('src/components/ProductShowcase.tsx',s=>s.replace('height={selected.id===\'table\'?900:845} loading="lazy" decoding="async"','height={selected.id===\'table\'?900:845} loading="eager" decoding="sync"'));
edit('src/app/pkr-theme-a-overlays.css',s=>s+`
/* The selected product screenshot is real UI, not a decorative layer. */
.pkr-landing-v2 .pkr-tour-visual picture {
 display:block!important;position:relative!important;z-index:1;
 visibility:visible!important;opacity:1!important;content-visibility:visible!important;
}
.pkr-landing-v2 .pkr-tour-visual picture img {
 display:block!important;visibility:visible!important;opacity:1!important;
 width:100%;height:auto;position:relative!important;z-index:1;
 content-visibility:visible!important;filter:none!important;transform:none!important;
}
.pkr-landing-v2 .pkr-tour-overline>span {color:var(--pkr-a-primary)!important;}
/* Full photographic backdrop with a text-safe left area, not a small image
   accidentally anchored to the old inset:0 underneath centred copy. */
.pkr-landing-v2 .pkr-l2-last-call {
 display:block!important;text-align:left!important;min-height:365px;
 padding:64px max(24px,calc((100vw - 1300px)/2))!important;
}
.pkr-landing-v2 .pkr-l2-last-call>img.pkr-l2-closing-art {
 inset:0!important;right:0!important;left:0!important;
 width:100%!important;height:100%!important;
 object-fit:cover!important;object-position:right center!important;
 opacity:.8!important;z-index:0!important;
}
.pkr-landing-v2 .pkr-l2-last-call::after {
 content:"";inset:0;position:absolute;z-index:1!important;
 background:linear-gradient(90deg,#131A1F 0%,rgba(19,26,31,.96) 38%,rgba(19,26,31,.1) 78%)!important;
}
.pkr-landing-v2 .pkr-l2-last-call>div {max-width:560px!important;position:relative;z-index:2;}
@media(max-width:700px) {
 .pkr-landing-v2 .pkr-l2-last-call {padding:44px 24px!important;}
 .pkr-landing-v2 .pkr-l2-last-call>img.pkr-l2-closing-art {opacity:.35!important;object-position:75% center!important;}
 .pkr-landing-v2 .pkr-l2-last-call::after {background:rgba(19,26,31,.68)!important;}
 .pkr-landing-v2 .pkr-tour-visual picture img {width:auto;max-width:100%;margin-inline:auto;}
}
`);
edit('scripts/capture-theme-a.cjs',s=>s.replace("await page.screenshot({path:path.join(output,size.name+'-'+id+'.png'),fullPage:id==='home'});",`if(id==='home'){
      const tour=page.locator('#pkr-tour-panel picture img');
      await tour.scrollIntoViewIfNeeded();await settle(page);
      const imageState=await tour.evaluate(img=>{
       const css=getComputedStyle(img),rect=img.getBoundingClientRect();
       return {ready:img.complete&&img.naturalWidth>100,width:rect.width,height:rect.height,opacity:css.opacity,visibility:css.visibility,display:css.display,src:img.currentSrc};
      });
      checks.push({page:'visible-product-tour',viewport:size.name,...imageState});
      if(!imageState.ready||imageState.width<100||imageState.height<100||Number(imageState.opacity)<.9||imageState.visibility!=='visible'||imageState.display==='none')errors.push('Product tour screenshot not visibly rendered: '+JSON.stringify(imageState));
      await page.locator('#pkr-tour-panel').screenshot({path:path.join(output,size.name+'-product-tour.png')});
      await page.locator('.pkr-l2-last-call').scrollIntoViewIfNeeded();await settle(page);
      await page.locator('.pkr-l2-last-call').screenshot({path:path.join(output,size.name+'-closing.png')});
      await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(200);
     }
     await page.screenshot({path:path.join(output,size.name+'-'+id+'.png'),fullPage:id==='home'});`));
console.log('Product-tour visibility and text-safe poker imagery corrected.');
