import type {D1Database} from '@cloudflare/workers-types';

/**
 * Read-only, per-room player identity resolution using saved settled-game rows.
 *
 * Names can change. The same registered account ID can therefore legitimately
 * have several historical names. We join such rows by ID, and attach old
 * name-only/guest rows only where the name has no conflicting registered owners.
 *
 * Never update a game_player or payment record to make a leaderboard match.
 */
export type SettledPlayerRow={
  game_id:string;
  user_id:string;
  display_name:string;
  net:number;
  settled_at:number|null;
  scheduled_at:number;
};
export type SourcePlayerRef={game_id:string;user_id:string};
export type VerifiedNameLink={user_id:string;display_name:string};
export type PlayerLeaderboardRow={
  user_id:string;
  display_name:string;
  games_played:number;
  games_won:number;
  total_net:number;
  biggest_win:number;
  biggest_loss:number;
  last_played:number;
  source_game_players:SourcePlayerRef[];
  aliases:string[];
  identity_review_required?:boolean;
};
export type PlayerLeaderboardAudit={
  source_rows:number;
  source_net:number;
  ranked_rows:number;
  ranked_net:number;
  ranked_sessions:number;
  multi_name_players:number;
  ambiguous_name_groups:number;
};

const normalise=(s:string)=>s.trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
const stableSort=(a:string,b:string)=>a.localeCompare(b,'en');

export function resolvePlayerLeaderboard(
  rawRows:readonly SettledPlayerRow[],
  verifiedUserIds:ReadonlySet<string>,
  verifiedNameLinks:readonly VerifiedNameLink[]=[],
):{leaders:PlayerLeaderboardRow[];audit:PlayerLeaderboardAudit}{
  // Every saved settlement row must be represented. Reject corrupt rows
  // rather than silently dropping financial amounts from a public total.
  for(const row of rawRows){
    if(!row.game_id||!row.user_id||!Number.isSafeInteger(row.net))
      throw new Error('A saved settled-game result is invalid. No totals were inferred.');
  }
  const rows=rawRows.map(r=>({...r,display_name:r.display_name?.trim()||'Unnamed player'}));
  const reviewNames=new Set<string>();
  const verifiedNameOwners=new Map<string,Set<string>>();
  // Host-linked event-player identities and authenticated account/profile names
  // are the ONLY cross-name evidence used here. Names alone are never used to
  // connect two different verified accounts.
  for(const link of verifiedNameLinks){
    if(!verifiedUserIds.has(link.user_id)||!link.display_name?.trim())continue;
    const name=normalise(link.display_name),owners=verifiedNameOwners.get(name)||new Set<string>();
    owners.add(link.user_id);verifiedNameOwners.set(name,owners);
  }
  const anchoredAccount=rows.map(r=>{
    const name=normalise(r.display_name),owners=verifiedNameOwners.get(name);
    const direct=verifiedUserIds.has(r.user_id)?r.user_id:null;
    if(owners&&owners.size>1){reviewNames.add(name);return direct;}
    const linked=owners?.size===1?[...owners][0]:null;
    if(direct&&linked&&direct!==linked){reviewNames.add(name);return direct;}
    return direct||linked;
  });
  const parent=rows.map((_,i)=>i);
  const gameSets=rows.map(r=>new Set([r.game_id]));
  const verifiedSets=rows.map((_,i)=>new Set(anchoredAccount[i]?[anchoredAccount[i]!]:[]));
  const find=(i:number):number=>{
    if(parent[i]!==i)parent[i]=find(parent[i]);
    return parent[i];
  };
  const unite=(a:number,b:number,reason:'id'|'name'|'linked'):boolean=>{
    a=find(a);b=find(b);
    if(a===b)return true;
    // A single person cannot have two separately recorded seats in one game.
    // Do not collapse such records or silently discard their money.
    for(const gameId of gameSets[a])if(gameSets[b].has(gameId))return false;
    if(verifiedSets[a].size&&verifiedSets[b].size){
      const distinct=new Set([...verifiedSets[a],...verifiedSets[b]]);
      if(distinct.size>1)return false;
    }
    const keep=Math.min(a,b),other=Math.max(a,b);
    parent[other]=keep;
    for(const gameId of gameSets[other])gameSets[keep].add(gameId);
    for(const id of verifiedSets[other])verifiedSets[keep].add(id);
    return true;
  };

  // First connect actual reused player IDs across the room, even when the
  // player has changed their display name.
  const firstId=new Map<string,number>();
  rows.forEach((r,i)=>{
    const prev=firstId.get(r.user_id);
    if(prev===undefined)firstId.set(r.user_id,i);
    else if(!unite(i,prev,'id'))reviewNames.add(normalise(r.display_name));
  });
  // Two display names explicitly linked to the same registered account are
  // its verified aliases, even when old guest records used different IDs.
  const firstAccount=new Map<string,number>();
  rows.forEach((r,i)=>{
    const id=anchoredAccount[i];
    if(!id)return;
    const prev=firstAccount.get(id);
    if(prev===undefined)firstAccount.set(id,i);
    else if(!unite(i,prev,'linked'))reviewNames.add(normalise(r.display_name));
  });

  const byName=new Map<string,number[]>();
  rows.forEach((r,i)=>{
    const name=normalise(r.display_name);
    const matches=byName.get(name)||[];
    matches.push(i);byName.set(name,matches);
  });
  for(const [name,indices] of byName){
    const verified=new Set(indices.map(i=>anchoredAccount[i]).filter((v):v is string=>!!v));
    if(verified.size>1)reviewNames.add(name);
    // A name that belongs to two different registered people is ambiguous;
    // never use it to attach their historical guest rows to either person.
    const eligible=verified.size>1?indices.filter(i=>!anchoredAccount[i]):indices;
    if(eligible.length<2)continue;
    const first=eligible[0];
    for(let i=1;i<eligible.length;i++){
      if(!unite(first,eligible[i],'name'))reviewNames.add(name);
    }
  }

  const groups=new Map<number,number[]>();
  rows.forEach((_,i)=>{
    const root=find(i),group=groups.get(root)||[];
    group.push(i);groups.set(root,group);
  });
  const leaders:PlayerLeaderboardRow[]=[];
  for(const indices of groups.values()){
    const records=indices.map(i=>rows[i]);
    const idCounts=new Map<string,number>();
    const nameCounts=new Map<string,{display:string,count:number,latest:number}>();
    let total=0,wins=0,biggestWin=0,biggestLoss=0,last=0;
    for(const r of records){
      idCounts.set(r.user_id,(idCounts.get(r.user_id)||0)+1);
      const name=normalise(r.display_name),value=nameCounts.get(name);
      nameCounts.set(name,{
        display:r.display_name.trim(),
        count:(value?.count||0)+1,
        latest:Math.max(value?.latest||0,r.scheduled_at),
      });
      total+=r.net;
      if(r.net>0){wins++;biggestWin=Math.max(biggestWin,r.net);}
      if(r.net<0)biggestLoss=Math.max(biggestLoss,-r.net);
      last=Math.max(last,r.settled_at||r.scheduled_at);
    }
    const anchorIds=[...new Set(indices.map(i=>anchoredAccount[i]).filter((v):v is string=>!!v))];
    const ids=[...idCounts].sort((a,b)=>
      Number(verifiedUserIds.has(b[0]))-Number(verifiedUserIds.has(a[0]))||
      b[1]-a[1]||stableSort(a[0],b[0]));
    const canonicalId=anchorIds.length===1?anchorIds[0]:ids[0][0];
    const names=[...nameCounts.values()].sort((a,b)=>
      b.count-a.count||b.latest-a.latest||b.display.length-a.display.length||stableSort(a.display,b.display));
    const sources=records.map(r=>({game_id:r.game_id,user_id:r.user_id})).sort((a,b)=>
      stableSort(a.game_id,b.game_id)||stableSort(a.user_id,b.user_id));
    const reviewed=records.some(r=>reviewNames.has(normalise(r.display_name)));
    leaders.push({
      user_id:canonicalId,display_name:names[0].display,
      games_played:records.length,games_won:wins,total_net:total,
      biggest_win:biggestWin,biggest_loss:biggestLoss,last_played:last,
      source_game_players:sources,
      aliases:names.map(n=>n.display),
      ...(reviewed?{identity_review_required:true}:{}),
    });
  }
  leaders.sort((a,b)=>b.total_net-a.total_net||b.games_played-a.games_played||stableSort(a.display_name,b.display_name));
  const sourceNet=rows.reduce((sum,r)=>sum+r.net,0);
  const rankedNet=leaders.reduce((sum,r)=>sum+r.total_net,0);
  const sessions=leaders.reduce((sum,r)=>sum+r.games_played,0);
  // Fail closed if the resolver loses, duplicates or changes any money record.
  if(sessions!==rows.length||rankedNet!==sourceNet)
    throw new Error('Historical player results did not reconcile with their saved source.');
  return {leaders,audit:{
    source_rows:rows.length,source_net:sourceNet,
    ranked_rows:leaders.length,ranked_net:rankedNet,ranked_sessions:sessions,
    multi_name_players:leaders.filter(r=>r.aliases.length>1).length,
    ambiguous_name_groups:reviewNames.size,
  }};
}

export async function computeRoomLeaderboard(db:D1Database,eventId:string){
  const [saved,registered,eventLinks,memberNames,profileNames]=await Promise.all([
    db.prepare(
      "SELECT gp.game_id,gp.user_id,gp.display_name,gp.net,gp.settled_at,g.scheduled_at "+
      "FROM game_players gp JOIN games g ON g.id=gp.game_id "+
      "WHERE g.event_id=? AND g.status='settled' AND gp.net IS NOT NULL "+
      "ORDER BY g.scheduled_at,gp.game_id,gp.user_id"
    ).bind(eventId).all<SettledPlayerRow>(),
    db.prepare(
      "SELECT DISTINCT u.id FROM users u "+
      "JOIN game_players gp ON gp.user_id=u.id "+
      "JOIN games g ON g.id=gp.game_id "+
      "WHERE g.event_id=? AND g.status='settled'"
    ).bind(eventId).all<{id:string}>(),
    db.prepare(
      "SELECT ep.user_id,ep.display_name FROM event_players ep "+
      "JOIN users u ON u.id=ep.user_id "+
      "WHERE ep.event_id=? AND ep.user_id IS NOT NULL"
    ).bind(eventId).all<VerifiedNameLink>(),
    db.prepare(
      "SELECT u.id AS user_id,u.name AS display_name FROM users u "+
      "JOIN event_members em ON em.user_id=u.id WHERE em.event_id=?"
    ).bind(eventId).all<VerifiedNameLink>(),
    // Member profile display names are optional in older deployments.
    db.prepare(
      "SELECT u.id AS user_id,p.screen_name AS display_name "+
      "FROM room_player_profiles p JOIN users u ON u.id=substr(p.profile_key,8) "+
      "WHERE p.event_id=? AND p.profile_key LIKE 'member:%' AND "+
      "p.screen_name IS NOT NULL AND trim(p.screen_name)!=''"
    ).bind(eventId).all<VerifiedNameLink>().catch(()=>({results:[] as VerifiedNameLink[]})),
  ]);
  const verifiedIds=new Set([
    ...registered.results.map(u=>u.id),
    ...eventLinks.results.map(u=>u.user_id),
    ...memberNames.results.map(u=>u.user_id),
    ...profileNames.results.map(u=>u.user_id),
  ]);
  return resolvePlayerLeaderboard(saved.results,verifiedIds,[
    ...eventLinks.results,...memberNames.results,...profileNames.results
  ]);
}
