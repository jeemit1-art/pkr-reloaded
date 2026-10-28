import type {Env} from './types';

/**
 * Advance due levels using Cloudflare's scheduled clock, independent of
 * anyone keeping a tournament dialog (or an entire phone) open.
 *
 * Each update compares both the level and its start time, so concurrent
 * host actions and browser advance-due requests cannot double-advance.
 * Retain the planned level boundary to avoid losing minutes to cron drift.
 */
export function nextTournamentBoundary(
  state:{status:string;start:number|null;duration:number;gameStatus:string},
  now:number,
):number|null{
  if(state.status!=='running'||state.gameStatus==='settled'||state.gameStatus==='cancelled'||
     !Number.isSafeInteger(state.start)||!Number.isSafeInteger(state.duration)||
     (state.start as number)<0||state.duration<30||now<(state.start as number)+state.duration) return null;
  return (state.start as number)+state.duration;
}

export async function advanceExpiredTournamentLevels(
  db:Env['DB'],now=Math.floor(Date.now()/1000),
):Promise<{checked:number;advanced:number;conflicts:number}>{
  // Bounded batch; a future scheduled invocation can catch up a long-running
  // tournament without exhausting a Worker request's D1 query budget.
  const due=await db.prepare(`
    SELECT ts.game_id,ts.current_level,ts.level_started_at,lv.duration_secs,
           g.status AS game_status
      FROM tournament_state ts
      JOIN games g ON g.id=ts.game_id
      JOIN tournament_levels lv ON lv.game_id=ts.game_id AND lv.level_num=ts.current_level
     WHERE ts.status='running' AND g.status NOT IN ('settled','cancelled')
       AND ts.level_started_at IS NOT NULL
       AND ts.level_started_at+lv.duration_secs<=?
       AND EXISTS (
         SELECT 1 FROM tournament_levels following
          WHERE following.game_id=ts.game_id
            AND following.level_num=ts.current_level+1
       )
     ORDER BY ts.level_started_at
     LIMIT 25
  `).bind(now).all<{
    game_id:string;current_level:number;level_started_at:number;
    duration_secs:number;game_status:string;
  }>();
  let advanced=0,conflicts=0;
  for(const entry of due.results){
    let current=entry;
    for(let stage=0;stage<10;stage++){
      const newStart=nextTournamentBoundary({
        status:'running',start:current.level_started_at,duration:current.duration_secs,
        gameStatus:current.game_status,
      },now);
      if(newStart===null)break;
      const next=await db.prepare(
        'SELECT level_num,duration_secs FROM tournament_levels WHERE game_id=? AND level_num=?'
      ).bind(current.game_id,current.current_level+1).first<{level_num:number;duration_secs:number}>();
      if(!next)break; // Never invent stages beyond the configured schedule.
      const result=await db.prepare(
        "UPDATE tournament_state SET current_level=?,level_started_at=? "+
        "WHERE game_id=? AND status='running' AND current_level=? AND level_started_at=? "+
        "AND EXISTS (SELECT 1 FROM games WHERE id=? AND status NOT IN ('settled','cancelled'))"
      ).bind(next.level_num,newStart,current.game_id,current.current_level,
        current.level_started_at,current.game_id).run();
      if(!result.meta.changes){conflicts++;break;}
      advanced++;
      current={...current,current_level:next.level_num,
        level_started_at:newStart,duration_secs:next.duration_secs};
    }
  }
  return {checked:due.results.length,advanced,conflicts};
}
