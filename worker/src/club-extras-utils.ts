/** Pure helpers for optional club extras. Never settles poker accounts. */
export type ClubExpenseCategory='food'|'venue'|'supplies'|'other';
export function splitCents(total:number,members:readonly string[]):Array<{user_id:string;share_cents:number}>{
  if(!Number.isSafeInteger(total)||total<1||total>5000000||
    members.length<2||members.length>15||
    members.some(x=>typeof x!=='string'||!x||x.length>128)||
    new Set(members).size!==members.length)
    throw new Error('Invalid shared-expense amount or participants');
  const ids=[...members].sort((a,b)=>a.localeCompare(b,'en'));
  const base=Math.floor(total/ids.length),rem=total%ids.length;
  return ids.map((user_id,i)=>({user_id,share_cents:base+(i<rem?1:0)}));
}
export type LevelPreset={
  level_num:number;small_blind:number;big_blind:number;ante:number;
  duration_secs:number;is_break:boolean;
};
export type TournamentPresetConfig={
  format:'tournament'|'rebuy'|'freezeout';starting_chips:number;
  buy_in_amount:number;rebuy_allowed:boolean;rebuy_levels:number;
  addon_allowed:boolean;addon_chips:number;
  payout_structure:Array<{place:number;pct:number}>;
  levels:LevelPreset[];
};
const integer=(n:unknown,min:number,max:number)=>Number.isSafeInteger(n)&&
  Number(n)>=min&&Number(n)<=max;
export function validatedTournamentPreset(value:unknown):TournamentPresetConfig|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const p=value as Record<string,unknown>;
  if(!['tournament','rebuy','freezeout'].includes(String(p.format))||
     !integer(p.starting_chips,100,1000000000)||
     !integer(p.buy_in_amount,0,10000000)||
     !integer(p.rebuy_levels,1,100)||
     !integer(p.addon_chips,0,1000000000)||
     typeof p.rebuy_allowed!=='boolean'||typeof p.addon_allowed!=='boolean'||
     (p.addon_allowed&&Number(p.addon_chips)===0))return null;
  const levels=p.levels,payouts=p.payout_structure;
  if(!Array.isArray(levels)||levels.length<1||levels.length>100||
     !Array.isArray(payouts)||payouts.length<1||payouts.length>20)return null;
  for(let i=0;i<levels.length;i++){
    const l=levels[i];
    if(!l||typeof l!=='object'||!integer(l.level_num,i+1,i+1)||
       !integer(l.duration_secs,30,7200)||
       !integer(l.small_blind,0,1000000000)||!integer(l.big_blind,0,1000000000)||
       !integer(l.ante,0,1000000000)||typeof l.is_break!=='boolean'||
       (!l.is_break&&(l.small_blind<1||l.big_blind<=l.small_blind)))return null;
  }
  if(payouts.some((r,i)=>!r||r.place!==i+1||
    typeof r.pct!=='number'||!Number.isFinite(r.pct)||r.pct<=0||r.pct>100||
    Math.abs(r.pct*100-Math.round(r.pct*100))>1e-7)||
    payouts.reduce((n,r)=>n+Math.round(r.pct*100),0)!==10000)return null;
  return value as TournamentPresetConfig;
}
/** Excel/CSV injection protection. Do not interpret financial amounts. */
export function csvCell(value:unknown):string{
  const raw=String(value??'').replace(/[\r\n]+/g,' ');
  const safe=/^\s*[=+\-@\t]/.test(raw)?"'"+raw:raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}
export function csvRows(rows:ReadonlyArray<Record<string,unknown>>,fields:readonly string[]):string{
  return '\uFEFF'+[fields.map(csvCell).join(','),
    ...rows.map(row=>fields.map(k=>csvCell(row[k])).join(','))].join('\r\n')+'\r\n';
}
