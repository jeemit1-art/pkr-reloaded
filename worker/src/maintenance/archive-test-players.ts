import type {Env} from '../types';
import {archivedHistoricalNames,HIDDEN_PLAYER_KEY_PREFIX} from '../routes/historical-visibility';

// One-off, owner-approved roster cleanup on the existing production Worker cron.
// There are NO game, member, transaction, settlement or D1 writes here.
// Repeated cron runs are idempotent and a completed marker prevents re-archiving
// names which the host subsequently restores from the interface.
export const TEST_HISTORY_ARCHIVE_DONE='maintenance:historical-player-cleanup:20261031:v1';
export type ArchiveOutcome='not_production'|'already'|'unmatched_room'|'unmatched_players'|'approved_member'|'archived';

export async function archiveAccidentalHistoricalPlayersOnce(
  env:Pick<Env,'PKR_ENV'|'DB'|'KV'>
):Promise<ArchiveOutcome>{
  if(env.PKR_ENV!=='production')return 'not_production';
  if((await env.KV.get(TEST_HISTORY_ARCHIVE_DONE))==='done')return 'already';

  // A unique existing private room must contain BOTH exact mistaken names.
  const rooms=await env.DB.prepare(
    "SELECT e.id FROM events e WHERE LOWER(TRIM(e.name))='friday night poker'"+
    " AND EXISTS(SELECT 1 FROM games g JOIN game_players gp ON gp.game_id=g.id"+
    " WHERE g.event_id=e.id AND LOWER(TRIM(gp.display_name))='test')"+
    " AND EXISTS(SELECT 1 FROM games g JOIN game_players gp ON gp.game_id=g.id"+
    " WHERE g.event_id=e.id AND LOWER(TRIM(gp.display_name))='test1')"
  ).all<{id:string}>();
  if(rooms.results.length!==1)return 'unmatched_room';
  const eventId=rooms.results[0].id;

  const source=await env.DB.prepare(
    "SELECT LOWER(TRIM(gp.display_name)) AS name,COUNT(*) AS n,"+
    " COUNT(DISTINCT gp.game_id) AS games FROM game_players gp"+
    " JOIN games g ON g.id=gp.game_id WHERE g.event_id=?"+
    " AND LOWER(TRIM(gp.display_name)) IN ('test','test1')"+
    " GROUP BY LOWER(TRIM(gp.display_name))"
  ).bind(eventId).all<{name:string;n:number;games:number}>();
  if(source.results.length!==2||
     !['test','test1'].every(name=>source.results.some(row=>
       row.name===name&&Number(row.n)===1&&Number(row.games)===1)))
    return 'unmatched_players';

  const members=await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM event_members em JOIN users u ON u.id=em.user_id"+
    " WHERE em.event_id=? AND LOWER(TRIM(u.name)) IN ('test','test1')"
  ).bind(eventId).first<{n:number}>();
  if(!members||Number(members.n)!==0)return 'approved_member';

  const previous=await archivedHistoricalNames(env.KV,eventId);
  const next=[...new Set([...previous,'test','test1'])].sort();
  if(next.length>250)throw new Error('Historical player archive capacity exceeded.');
  await env.KV.put(HIDDEN_PLAYER_KEY_PREFIX+eventId,JSON.stringify({names:next}));
  await env.KV.put(TEST_HISTORY_ARCHIVE_DONE,'done');
  return 'archived';
}

