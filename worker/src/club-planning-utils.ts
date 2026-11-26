// Pure, deterministic helpers: no database, secrets, financial side effects.
export type LeaguePoints={first:number;second:number;third:number;other:number};
export type SeasonGameRow={
  game_id:string;user_id:string;net:number;
};
export type SeasonStanding={
  user_id:string;points:number;games_played:number;first_places:number;podiums:number;
};
export function validDateOptions(raw:unknown,now:number):number[]|null{
  if(!Array.isArray(raw)||raw.length<2||raw.length>5)return null;
  if(raw.some(v=>typeof v!=='number'||!Number.isSafeInteger(v)||
      v<=now+1800||v>=now+366*86400))return null;
  const values=[...raw].sort((a,b)=>a-b);
  return new Set(values).size===values.length?values:null;
}
export function validLeaguePoints(raw:unknown):LeaguePoints|null{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const x=raw as Record<string,unknown>;
  if(['first','second','third','other'].some(k=>typeof x[k]!=='number'||
    !Number.isSafeInteger(x[k])||Number(x[k])<0||Number(x[k])>100))return null;
  if(Number(x.first)<Number(x.second)||Number(x.second)<Number(x.third)||
     Number(x.third)<Number(x.other))return null;
  return {first:Number(x.first),second:Number(x.second),
    third:Number(x.third),other:Number(x.other)};
}
/** Competition ranking: tied nets receive the same place; next place skips.
 * All points are derived from settled source rows, never cached balances.
 */
export function scoreSeasonRows(rows:readonly SeasonGameRow[],points:LeaguePoints){
  const byGame=new Map<string,SeasonGameRow[]>();
  for(const row of rows){
    if(!row.game_id||!row.user_id||!Number.isSafeInteger(row.net))
      throw new Error('Invalid saved game result; standings are unavailable');
    const arr=byGame.get(row.game_id)||[];
    if(arr.some(r=>r.user_id===row.user_id))
      throw new Error('Duplicate result in a saved game; standings are unavailable');
    arr.push(row);byGame.set(row.game_id,arr);
  }
  const perSource=new Map<string,{score:number;place:number}>();
  const key=(g:string,u:string)=>JSON.stringify([g,u]);
  for(const [gameId,all] of byGame){
    const sorted=[...all].sort((a,b)=>b.net-a.net||a.user_id.localeCompare(b.user_id));
    sorted.forEach((r,i)=>{
      const place=1+sorted.filter(other=>other.net>r.net).length;
      const score=place===1?points.first:place===2?points.second:
        place===3?points.third:points.other;
      perSource.set(key(gameId,r.user_id),{score,place});
    });
  }
  return {
    scoreOf:(gameId:string,userId:string)=>perSource.get(key(gameId,userId))||null,
    countedGames:byGame.size,
  };
}
