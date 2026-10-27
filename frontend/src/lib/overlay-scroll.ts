let count=0;
let original='';
/** Reference-counted because a record sheet can be opened from another dialog. */
export function lockPageScroll(){
  if(typeof document==='undefined')return()=>{};
  if(count++===0){original=document.body.style.overflow;document.body.style.overflow='hidden';}
  let released=false;
  return()=>{if(released)return;released=true;if(--count===0)document.body.style.overflow=original;};
}
