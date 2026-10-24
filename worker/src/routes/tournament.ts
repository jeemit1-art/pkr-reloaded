import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';
import {calculateTournamentPayouts,TournamentPayoutError} from '../tournament-payouts';

const tournament = new Hono<{ Bindings: Env }>();

async function getGameAndVerify(c: any, gameId: string) {
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first();
  if (!game) return null;
  if (!await requireEventRole(c, game.event_id, 'cohost')) return null;
  return game;
}

tournament.get('/games/:id/tournament', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'member')) return c.json({ error: 'Forbidden' }, 403);
  const state   = await c.env.DB.prepare('SELECT * FROM tournament_state WHERE game_id=?').bind(gameId).first<any>();
  const levels  = await c.env.DB.prepare('SELECT * FROM tournament_levels WHERE game_id=? ORDER BY level_num ASC').bind(gameId).all<any>();
  const rebuys  = await c.env.DB.prepare('SELECT * FROM tournament_rebuys WHERE game_id=? ORDER BY created_at DESC').bind(gameId).all<any>();
  const eliminations=await c.env.DB.prepare('SELECT * FROM tournament_eliminations WHERE game_id=? ORDER BY finishing_position DESC').bind(gameId).all<any>();
  let pool:number|null=null,payouts:any[]=[];
  let errorMessage:string|null=null;
  if(state){
    const registered=await c.env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM game_players WHERE game_id=? AND buy_ins>0'
    ).bind(gameId).first<{cnt:number}>();
    try{
      const prize=calculateTournamentPayouts(
        registered?.cnt||0,state.buy_in_amount||0,
        rebuys.results.map((r:any)=>r.amount_paid),
        JSON.parse(state.payout_structure||'[]'),
      );
      pool=prize.prize_pool_cents;
      payouts=prize.payouts;
    }catch(error){
      errorMessage=error instanceof TournamentPayoutError?
        error.message:'Payout configuration needs review.';
    }
  }
  return c.json({
    state:state||null,levels:levels.results,rebuys:rebuys.results,
    eliminations:eliminations.results,
    prize_pool_cents:pool,payouts,payout_error:errorMessage,
  });
});

tournament.post('/games/:id/tournament/setup', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden'},403);
  if(game.status==='settled'||game.status==='cancelled')
    return c.json({error:'Game is closed'},409);
  const current=await c.env.DB.prepare(
    'SELECT status FROM tournament_state WHERE game_id=?'
  ).bind(gameId).first<{status:string}>();
  if(current&&current.status!=='setup')
    return c.json({error:'Cannot reconfigure a tournament already in progress.',
      code:'TOURNAMENT_STATE_CONFLICT'},409);
  const input=await c.req.json().catch(()=>null) as any;
  const starting=input?.starting_chips??10000;
  const fee=input?.buy_in_amount??0;
  const rebuyLevels=input?.rebuy_levels??4;
  const addonChips=input?.addon_chips??0;
  const levels=input?.levels;
  const payouts=input?.payout_structure??[
    {place:1,pct:50},{place:2,pct:30},{place:3,pct:20},
  ];
  if(!Number.isSafeInteger(starting)||starting<=0||
     !Number.isSafeInteger(fee)||fee<0||
     !Number.isSafeInteger(rebuyLevels)||rebuyLevels<1||
     !Number.isSafeInteger(addonChips)||addonChips<0||
     !Array.isArray(levels)||levels.length<1||levels.length>100||
     !Array.isArray(payouts)||payouts.length<1||payouts.length>20)
    return c.json({error:'Invalid tournament setup values'},400);
  if(input?.addon_allowed&&addonChips<=0)
    return c.json({error:'Configured add-ons require a positive chip amount'},400);
  if(payouts.some((row:any,i:number)=>
       !row||row.place!==i+1||typeof row.pct!=='number'||
       !Number.isFinite(row.pct)||row.pct<=0||row.pct>100||
       Math.abs(row.pct*100-Math.round(row.pct*100))>1e-7)||
     payouts.reduce((a:number,b:any)=>a+Math.round(b.pct*100),0)!==10000)
    return c.json({error:'Payout places must be ordered and total exactly 100%'},400);
  for(let i=0;i<levels.length;i++){
    const lv=levels[i],breakLevel=!!lv?.is_break;
    if(!lv||lv.level_num!==i+1||
       !Number.isSafeInteger(lv.duration_secs)||lv.duration_secs<30||lv.duration_secs>7200||
       !Number.isSafeInteger(lv.small_blind)||lv.small_blind<0||
       !Number.isSafeInteger(lv.big_blind)||lv.big_blind<0||
       !Number.isSafeInteger(lv.ante??0)||lv.ante<0||
       (!breakLevel&&(lv.small_blind<1||lv.big_blind<=lv.small_blind)))
      return c.json({error:'Blind levels must be consecutive with valid stacks and durations'},400);
  }
  const statements=[
    c.env.DB.prepare(`
      INSERT INTO tournament_state
      (game_id,status,current_level,starting_chips,buy_in_amount,rebuy_allowed,
       rebuy_levels,addon_allowed,addon_chips,payout_structure,total_chips_in_play)
      VALUES (?,?,?,?,?,?,?,?,?,?,0)
      ON CONFLICT(game_id) DO UPDATE SET
        status='setup',current_level=1,starting_chips=excluded.starting_chips,
        buy_in_amount=excluded.buy_in_amount,rebuy_allowed=excluded.rebuy_allowed,
        rebuy_levels=excluded.rebuy_levels,addon_allowed=excluded.addon_allowed,
        addon_chips=excluded.addon_chips,payout_structure=excluded.payout_structure
      WHERE tournament_state.status='setup'
    `).bind(gameId,'setup',1,starting,fee,input?.rebuy_allowed?1:0,
       rebuyLevels,input?.addon_allowed?1:0,addonChips,JSON.stringify(payouts)),
    c.env.DB.prepare(`
      DELETE FROM tournament_levels WHERE game_id=?
      AND EXISTS (SELECT 1 FROM tournament_state WHERE game_id=? AND status='setup')
    `).bind(gameId,gameId),
  ];
  for(const lv of levels){
    statements.push(c.env.DB.prepare(`
      INSERT INTO tournament_levels
      (id,game_id,level_num,small_blind,big_blind,ante,duration_secs,is_break)
      SELECT ?,?,?,?,?,?,?,?
      WHERE EXISTS (SELECT 1 FROM tournament_state WHERE game_id=? AND status='setup')
    `).bind(generateId(),gameId,lv.level_num,lv.small_blind,lv.big_blind,
      lv.ante??0,lv.duration_secs,lv.is_break?1:0,gameId));
  }
  const result=await c.env.DB.batch(statements);
  if(!result[0]?.meta?.changes)return c.json({
    error:'Another host changed the tournament while it was being configured.',
    code:'TOURNAMENT_STATE_CONFLICT',
  },409);
  return c.json({ok:true,levels:levels.length});
});

tournament.post('/games/:id/tournament/start', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden'},403);
  if(game.status==='settled'||game.status==='cancelled')
    return c.json({error:'Game is closed'},409);
  const state=await c.env.DB.prepare(
    'SELECT * FROM tournament_state WHERE game_id=?'
  ).bind(gameId).first<any>();
  if(!state)return c.json({error:'Tournament not set up'},400);
  if(state.status!=='setup')return c.json({
    error:'Tournament has already started or is no longer in setup.',
    code:'TOURNAMENT_STATE_CONFLICT',
  },409);
  const level=await c.env.DB.prepare(
    'SELECT * FROM tournament_levels WHERE game_id=? AND level_num=1'
  ).bind(gameId).first<any>();
  if(!level)return c.json({error:'Configure at least one initial level'},400);
  const playerCount=await c.env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM game_players WHERE game_id=? AND buy_ins>0'
  ).bind(gameId).first<{cnt:number}>();
  const count=playerCount?.cnt||0;
  const chips=count*state.starting_chips;
  if(!Number.isSafeInteger(count)||count<2||
     !Number.isSafeInteger(chips)||chips<=0)
    return c.json({error:'At least two registered players and valid chip totals are required.'},400);
  const now=Math.floor(Date.now()/1000);
  const result=await c.env.DB.prepare(
    "UPDATE tournament_state SET status='running',started_at=?,level_started_at=?,current_level=1,total_chips_in_play=? WHERE game_id=? AND status='setup'"
  ).bind(now,now,chips,gameId).run();
  if(!result.meta.changes)return c.json({
    error:'Another host started the tournament first.',code:'TOURNAMENT_STATE_CONFLICT',
  },409);
  return c.json({ok:true,level,total_chips_in_play:chips,level_started_at:now});
});

tournament.post('/games/:id/tournament/next-level', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden'},403);
  if(game.status==='settled'||game.status==='cancelled')
    return c.json({error:'Game is closed'},409);
  const state=await c.env.DB.prepare(
    'SELECT * FROM tournament_state WHERE game_id=?'
  ).bind(gameId).first<any>();
  if(!state||state.status!=='running')
    return c.json({error:'Tournament is not running'},409);
  const nextLevel=state.current_level+1;
  const level=await c.env.DB.prepare(
    'SELECT * FROM tournament_levels WHERE game_id=? AND level_num=?'
  ).bind(gameId,nextLevel).first<any>();
  if(!level)return c.json({error:'No more levels'},400);
  const now=Math.floor(Date.now()/1000);
  const result=await c.env.DB.prepare(
    "UPDATE tournament_state SET current_level=?,level_started_at=? "+
    "WHERE game_id=? AND status='running' AND current_level=?"
  ).bind(nextLevel,now,gameId,state.current_level).run();
  if(!result.meta.changes)return c.json({
    error:'Another host has already changed the tournament level.',
    code:'TOURNAMENT_STATE_CONFLICT',
  },409);
  return c.json({ok:true,level,current_level:nextLevel,level_started_at:now});
});

tournament.post('/games/:id/tournament/pause', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden'},403);
  if(game.status==='settled'||game.status==='cancelled')
    return c.json({error:'Game is closed'},409);
  const state=await c.env.DB.prepare(
    'SELECT * FROM tournament_state WHERE game_id=?'
  ).bind(gameId).first<any>();
  if(!state)return c.json({error:'Tournament not found'},404);
  const now=Math.floor(Date.now()/1000);
  if(state.status==='running'){
    // Never trust client-supplied elapsed time: use the Worker clock.
    const elapsed=Math.max(0,Math.min(86400,now-(state.level_started_at||now)));
    const result=await c.env.DB.prepare(
      "UPDATE tournament_state SET status='paused',paused_elapsed=? "+
      "WHERE game_id=? AND status='running' AND current_level=? AND level_started_at IS ?"
    ).bind(elapsed,gameId,state.current_level,state.level_started_at).run();
    if(!result.meta.changes)return c.json({
      error:'Tournament clock changed on another device.',code:'TOURNAMENT_STATE_CONFLICT',
    },409);
    return c.json({ok:true,status:'paused',paused_elapsed:elapsed});
  }
  if(state.status==='paused'){
    const newStart=now-Math.max(0,state.paused_elapsed||0);
    const result=await c.env.DB.prepare(
      "UPDATE tournament_state SET status='running',level_started_at=?,paused_elapsed=0 "+
      "WHERE game_id=? AND status='paused' AND current_level=?"
    ).bind(newStart,gameId,state.current_level).run();
    if(!result.meta.changes)return c.json({
      error:'Tournament clock changed on another device.',code:'TOURNAMENT_STATE_CONFLICT',
    },409);
    return c.json({ok:true,status:'running',level_started_at:newStart});
  }
  return c.json({error:'Tournament has not started'},409);
});

// The client's durable idempotency key prevents charging a player twice
// after an HTTP timeout or a simultaneous double-click. A D1 transaction
// credits chips only once, and inserts the receipt only if the credit occurred.
tournament.post('/games/:id/tournament/rebuy', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden'},403);
  if(game.status==='settled'||game.status==='cancelled')
    return c.json({error:'Game is closed',code:'TOURNAMENT_CLOSED'},409);
  const body=await c.req.json().catch(()=>null) as {
    idempotency_key?:unknown;player_name?:unknown;type?:unknown;
    chips?:unknown;amount_paid?:unknown
  }|null;
  const key=typeof body?.idempotency_key==='string'?body.idempotency_key.trim():'';
  if(!/^[A-Za-z0-9_-]{12,128}$/.test(key))
    return c.json({error:'A persistent rebuy request ID is required.',
      code:'PRECONDITION_REQUIRED'},428);
  const name=typeof body?.player_name==='string'?body.player_name.trim():'';
  const kind=body?.type==='addon'?'addon':body?.type==='rebuy'?'rebuy':'';
  const state=await c.env.DB.prepare(
    'SELECT * FROM tournament_state WHERE game_id=?'
  ).bind(gameId).first<any>();
  if(!state)return c.json({error:'Tournament not set up'},400);
  const expected=kind==='addon'?state.addon_chips:state.starting_chips;
  const chips=body?.chips===undefined?expected:body.chips;
  const cost=body?.amount_paid===undefined?state.buy_in_amount:body.amount_paid;
  if(!name||name.length>120||!kind||!Number.isSafeInteger(chips)||
     Number(chips)<=0||chips!==expected||
     !Number.isSafeInteger(cost)||Number(cost)<0)
    return c.json({error:'Invalid player, chips or payment.'},400);
  const existing=await c.env.DB.prepare(
    'SELECT * FROM tournament_rebuys WHERE id=?'
  ).bind(key).first<any>();
  const matches=(row:any)=>row&&row.game_id===gameId&&
    row.player_name===name&&row.type===kind&&
    row.chips===chips&&row.amount_paid===cost;
  if(existing){
    if(matches(existing))return c.json({ok:true,already_applied:true});
    return c.json({error:'Request ID belongs to a different transaction.',
      code:'REBUY_CONFLICT'},409);
  }
  const player=await c.env.DB.prepare(
    'SELECT user_id FROM game_players WHERE game_id=? AND display_name=? AND buy_ins>0'
  ).bind(gameId,name).first<{user_id:string}>();
  if(!player)return c.json({error:'Player has no recorded tournament buy-in.'},409);
  if(state.status!=='running'||
     (kind==='rebuy'&&(!state.rebuy_allowed||state.current_level>state.rebuy_levels))||
     (kind==='addon'&&!state.addon_allowed))
    return c.json({error:'Rebuy or add-on is not allowed at this level.',
      code:'REBUY_NOT_ALLOWED'},409);
  const now=Math.floor(Date.now()/1000);
  const result=await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE tournament_state SET total_chips_in_play=total_chips_in_play+?
      WHERE game_id=? AND status='running'
      AND ((?='rebuy' AND rebuy_allowed=1 AND current_level<=rebuy_levels)
        OR (?='addon' AND addon_allowed=1))
      AND total_chips_in_play<=?
      AND NOT EXISTS (SELECT 1 FROM tournament_rebuys WHERE id=?)
    `).bind(chips,gameId,kind,kind,Number.MAX_SAFE_INTEGER-Number(chips),key),
    c.env.DB.prepare(`
      INSERT INTO tournament_rebuys(id,game_id,player_name,type,chips,amount_paid,created_at)
      SELECT ?,?,?,?,?,?,? WHERE changes()=1
    `).bind(key,gameId,name,kind,chips,cost,now),
  ]);
  if(!result[0]?.meta?.changes||!result[1]?.meta?.changes){
    const latest=await c.env.DB.prepare(
      'SELECT * FROM tournament_rebuys WHERE id=?'
    ).bind(key).first<any>();
    if(matches(latest))return c.json({ok:true,already_applied:true});
    return c.json({error:'Rebuy changed before recording. Reload the tournament.',
      code:'REBUY_CONFLICT'},409);
  }
  return c.json({ok:true,request_id:key,chips});
});

tournament.post('/games/:id/tournament/eliminate', authMiddleware, async (c) => {
  const gameId=c.req.param('id');
  const game=await getGameAndVerify(c,gameId);
  if(!game)return c.json({error:'Forbidden'},403);
  if(game.status==='settled'||game.status==='cancelled')
    return c.json({error:'Game is closed'},409);
  const input=await c.req.json().catch(()=>null) as {player_name?:unknown}|null;
  const playerName=typeof input?.player_name==='string'?input.player_name.trim():'';
  if(!playerName||playerName.length>120)
    return c.json({error:'Valid player name required'},400);
  const state=await c.env.DB.prepare(
    'SELECT status FROM tournament_state WHERE game_id=?'
  ).bind(gameId).first<{status:string}>();
  if(!state||!['running','paused'].includes(state.status))
    return c.json({error:'Tournament must be in progress to eliminate a player.'},409);
  const player=await c.env.DB.prepare(
    'SELECT user_id FROM game_players WHERE game_id=? AND display_name=? AND buy_ins>0'
  ).bind(gameId,playerName).first<{user_id:string}>();
  if(!player)return c.json({error:'Registered player not found'},404);
  const previous=await c.env.DB.prepare(
    'SELECT finishing_position FROM tournament_eliminations WHERE game_id=? AND player_name=?'
  ).bind(gameId,playerName).first<{finishing_position:number}>();
  if(previous)return c.json({ok:true,already_applied:true,finishing_position:previous.finishing_position});
  const now=Math.floor(Date.now()/1000);
  // All position counts live IN THIS INSERT; two hosts cannot assign the same
  // place based on a stale browser count. The unique player constraint prevents
  // duplicate eliminations even if the browser retries.
  const written=await c.env.DB.prepare(`
    INSERT INTO tournament_eliminations
      (id,game_id,player_name,finishing_position,eliminated_at)
    SELECT ?,?,?,(
      (SELECT COUNT(*) FROM game_players WHERE game_id=? AND buy_ins>0)
      -(SELECT COUNT(*) FROM tournament_eliminations WHERE game_id=?)
    ),?
    WHERE (SELECT COUNT(*) FROM game_players WHERE game_id=? AND buy_ins>0)
       -(SELECT COUNT(*) FROM tournament_eliminations WHERE game_id=?)>1
    AND NOT EXISTS (SELECT 1 FROM tournament_eliminations
      WHERE game_id=? AND player_name=?)
    AND EXISTS (SELECT 1 FROM tournament_state
      WHERE game_id=? AND status IN ('running','paused'))
    ON CONFLICT(game_id,player_name) DO NOTHING
  `).bind(generateId(),gameId,playerName,gameId,gameId,now,
    gameId,gameId,gameId,playerName,gameId).run();
  const recorded=await c.env.DB.prepare(
    'SELECT finishing_position FROM tournament_eliminations WHERE game_id=? AND player_name=?'
  ).bind(gameId,playerName).first<{finishing_position:number}>();
  if(!written.meta.changes){
    if(recorded)return c.json({ok:true,already_applied:true,
      finishing_position:recorded.finishing_position});
    return c.json({error:'No more players can be eliminated, or the tournament changed.',
      code:'TOURNAMENT_STATE_CONFLICT'},409);
  }
  return c.json({ok:true,finishing_position:recorded?.finishing_position});
});

tournament.get('/games/live/:token/tournament', async (c) => {
  const token = c.req.param('token');
  const game = await c.env.DB.prepare('SELECT id FROM games WHERE live_token=?').bind(token).first<any>();
  if (!game) return c.json({ error: 'Not found' }, 404);
  const state = await c.env.DB.prepare('SELECT * FROM tournament_state WHERE game_id=?').bind(game.id).first<any>();
  const levels = await c.env.DB.prepare('SELECT * FROM tournament_levels WHERE game_id=? ORDER BY level_num ASC').bind(game.id).all<any>();
  const elims  = await c.env.DB.prepare('SELECT * FROM tournament_eliminations WHERE game_id=? ORDER BY finishing_position DESC').bind(game.id).all<any>();
  return c.json({ state: state||null, levels: levels.results, eliminations: elims.results, server_time: Math.floor(Date.now()/1000) });
});

export default tournament;
