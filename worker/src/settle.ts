import type { Transfer } from './types';

// Scale balances down pro-rata so they sum to `target` (integer cents, largest-remainder rounding)
export function scaleDown(list: Array<{bal:number}>, target: number) {
  const total = list.reduce((s,p)=>s+p.bal,0);
  if (total <= 0 || target >= total) return;
  const raw = list.map(p => p.bal * target / total);
  const floors = raw.map(Math.floor);
  const rem = target - floors.reduce((s,n)=>s+n,0);
  raw.map((r,i)=>({i,f:r-Math.floor(r)})).sort((a,b)=>b.f-a.f).slice(0,rem).forEach(x=>{ floors[x.i]++; });
  list.forEach((p,i)=>{ p.bal = floors[i]; });
}

export function minimumTransfers(
  positions: Array<{user_id:string; display_name:string; net:number}>
): Transfer[] {
  // Round to cents to avoid float drift
  const creds = positions.filter(p=>p.net>0).map(p=>({...p,bal:Math.round(p.net)}));
  const debts = positions.filter(p=>p.net<0).map(p=>({...p,bal:Math.round(-p.net)}));
  creds.sort((a,b)=>b.bal-a.bal);
  debts.sort((a,b)=>b.bal-a.bal);
  // Correct any rounding drift so totals match exactly
  const totalDebt = debts.reduce((s,p)=>s+p.bal,0);
  const totalCred = creds.reduce((s,p)=>s+p.bal,0);
  const drift = totalCred - totalDebt;
  if (drift > 0) scaleDown(creds, totalCred - drift);   // winners owed more than losers can pay: shrink winners pro-rata
  else if (drift < 0) scaleDown(debts, totalCred);      // losers owe more than winners are owed: shrink losers pro-rata
  const out: Transfer[] = [];
  let i=0,j=0;
  while (i<debts.length && j<creds.length) {
    const amt = Math.min(debts[i].bal, creds[j].bal);
    if (amt>0) out.push({from:debts[i].user_id,from_name:debts[i].display_name,to:creds[j].user_id,to_name:creds[j].display_name,amount:amt});
    debts[i].bal-=amt; creds[j].bal-=amt;
    if (debts[i].bal<=0) i++;
    if (creds[j].bal<=0) j++;
  }
  return out;
}
