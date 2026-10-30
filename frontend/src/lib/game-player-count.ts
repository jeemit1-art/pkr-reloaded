/** Format recorded participant counts without inventing zero when the API omits it. */
export function playerCountLabel(count:number|null|undefined):string {
  if(typeof count!=='number'||!Number.isSafeInteger(count)||count<0)
    return 'Player count unavailable';
  if(count===0)return 'No players recorded';
  return count===1?'1 player':count+' players';
}
