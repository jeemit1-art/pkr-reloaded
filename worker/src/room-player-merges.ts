import type {KVNamespace} from '@cloudflare/workers-types';
import type {PlayerLeaderboardRow} from './player-leaderboard';

/**
 * Host-reviewed room leaderboard aliases. Financial source rows, authenticated
 * users, room membership and actual game records are NEVER rewritten.
 *
 * A link points from one existing leaderboard identity to the identity the
 * host has verified should display both histories. Links are room-scoped and
 * reversible; each decision has a separate append-only KV audit entry.
 */
export type RoomPlayerMerge={
  from_user_id:string;
  to_user_id:string;
  from_name:string;
  to_name:string;
  created_at:number;
  created_by:string;
};
const PREFIX='room-player-merge:v1:';
const AUDIT='room-player-merge-audit:v1:';
const MAX_LINKS=80;
const validId=(value:unknown):value is string=>
  typeof value==='string'&&value.length>0&&value.length<=128&&/^[A-Za-z0-9_.:-]+$/.test(value);
const validName=(value:unknown):value is string=>
  typeof value==='string'&&value.trim().length>0&&value.length<=100&&
  !/[\x00-\x1f\x7f<>]/.test(value);
const key=(roomId:string,fromId:string)=>PREFIX+roomId+':'+fromId;
function validLink(value:unknown):value is RoomPlayerMerge{
  if(!value||typeof value!=='object')return false;
  const link=value as Record<string,unknown>;
  return validId(link.from_user_id)&&validId(link.to_user_id)&&
    link.from_user_id!==link.to_user_id&&
    validName(link.from_name)&&validName(link.to_name)&&
    validId(link.created_by)&&typeof link.created_at==='number'&&Number.isSafeInteger(link.created_at)&&link.created_at>0;
}
export async function listRoomPlayerMerges(kv:KVNamespace,roomId:string):Promise<RoomPlayerMerge[]>{
  const prefix=PREFIX+roomId+':';
  const listing=await kv.list({prefix,limit:100});
  if(!listing.list_complete||listing.keys.length>MAX_LINKS)
    throw new Error('Too many player history links in this room. No automatic merge was applied.');
  const values=await Promise.all(listing.keys.map(async item=>{
    const raw=await kv.get(item.name);
    if(!raw)throw new Error('Player history link temporarily unavailable. Refresh and try again.');
    let value:unknown;
    try{value=JSON.parse(raw);}catch{throw new Error('An existing player history link is invalid.');}
    if(!validLink(value)||item.name!==key(roomId,value.from_user_id))
      throw new Error('An existing player history link is invalid.');
    return value;
  }));
  return values.sort((a,b)=>a.created_at-b.created_at||a.from_user_id.localeCompare(b.from_user_id));
}
export async function saveRoomPlayerMerge(
  kv:KVNamespace,roomId:string,link:RoomPlayerMerge
):Promise<void>{
  if(!validLink(link)||!validId(roomId))
    throw new Error('Invalid player history link.');
  const recordKey=key(roomId,link.from_user_id);
  // Every change is separately auditable. A failed audit write aborts the
  // merge. Financial D1 tables are not opened by either operation.
  await kv.put(AUDIT+roomId+':'+crypto.randomUUID(),JSON.stringify({
    action:'merge',...link,
  }));
  await kv.put(recordKey,JSON.stringify(link));
}
export async function removeRoomPlayerMerge(
  kv:KVNamespace,roomId:string,link:RoomPlayerMerge,actorId:string
):Promise<void>{
  if(!validLink(link)||!validId(roomId)||!validId(actorId))throw new Error('Invalid player history link.');
  await kv.put(AUDIT+roomId+':'+crypto.randomUUID(),JSON.stringify({
    action:'undo',...link,undone_by:actorId,undone_at:Date.now(),
  }));
  await kv.delete(key(roomId,link.from_user_id));
}
const refKey=(ref:{game_id:string;user_id:string})=>ref.game_id+'\u0000'+ref.user_id;
export function mergePairIsSafe(from:PlayerLeaderboardRow,to:PlayerLeaderboardRow):string|null{
  if(from.user_id===to.user_id)return 'Choose two different player histories.';
  if(from.identity_review_required||to.identity_review_required)
    return 'One player has an unresolved identity conflict. Review the source records before combining histories.';
  const games=new Set(from.source_game_players.map(ref=>ref.game_id));
  if(to.source_game_players.some(ref=>games.has(ref.game_id)))
    return 'These histories contain two separate player seats in the same game. They cannot be safely combined.';
  const refs=new Set(from.source_game_players.map(refKey));
  if(to.source_game_players.some(ref=>refs.has(refKey(ref))))
    return 'A settled game record is present in both histories. No changes made.';
  return null;
}
export function combineRoomPlayerLeaders(
  original:readonly PlayerLeaderboardRow[],
  links:readonly RoomPlayerMerge[]
):{leaders:PlayerLeaderboardRow[];applied:number;warnings:string[]}{
  let leaders=original.map(p=>({...p,
    aliases:[...p.aliases],source_game_players:p.source_game_players.map(r=>({...r})),
  }));
  const startingGames=leaders.reduce((n,p)=>n+p.games_played,0);
  const startingNet=leaders.reduce((n,p)=>n+p.total_net,0);
  const originalRefs=new Set(leaders.flatMap(p=>p.source_game_players.map(refKey)));
  if(originalRefs.size!==startingGames)throw new Error('Player source records did not reconcile before combining histories.');
  const warnings:string[]=[];
  let applied=0;
  for(const link of links){
    const from=leaders.find(p=>p.user_id===link.from_user_id);
    const to=leaders.find(p=>p.user_id===link.to_user_id);
    if(!from||!to){
      warnings.push('A saved player history link no longer matches the current leaderboard.');
      continue;
    }
    const unsafe=mergePairIsSafe(from,to);
    if(unsafe){warnings.push(unsafe);continue;}
    const replacement:PlayerLeaderboardRow={
      ...to,
      display_name:link.to_name,
      games_played:from.games_played+to.games_played,
      games_won:from.games_won+to.games_won,
      total_net:from.total_net+to.total_net,
      biggest_win:Math.max(from.biggest_win,to.biggest_win),
      biggest_loss:Math.max(from.biggest_loss,to.biggest_loss),
      last_played:Math.max(from.last_played,to.last_played),
      source_game_players:[...to.source_game_players,...from.source_game_players].sort((a,b)=>
        a.game_id.localeCompare(b.game_id)||a.user_id.localeCompare(b.user_id)),
      aliases:[...new Set([link.to_name,...to.aliases,...from.aliases])],
    };
    leaders=leaders.filter(p=>p!==from).map(p=>p===to?replacement:p);
    applied++;
  }
  const resultingGames=leaders.reduce((n,p)=>n+p.games_played,0);
  const resultingNet=leaders.reduce((n,p)=>n+p.total_net,0);
  const refs=leaders.flatMap(p=>p.source_game_players.map(refKey));
  if(resultingGames!==startingGames||resultingNet!==startingNet||
     refs.length!==startingGames||new Set(refs).size!==originalRefs.size||
     refs.some(ref=>!originalRefs.has(ref)))
    throw new Error('Historical player merge did not reconcile. Saved results remain unchanged.');
  leaders.sort((a,b)=>b.total_net-a.total_net||b.games_played-a.games_played||
    a.display_name.localeCompare(b.display_name));
  return {leaders,applied,warnings};
}
