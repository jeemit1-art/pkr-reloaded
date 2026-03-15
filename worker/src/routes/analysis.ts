import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, requireEventRole, generateId } from '../middleware';

const analysis = new Hono<{ Bindings: Env }>();

async function callClaude(apiKey: string, prompt: string, system: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})) as any; throw new Error(e?.error?.message || `Anthropic error ${res.status}`); }
  const data = await res.json() as any;
  return data.content?.[0]?.text || '';
}

function formatHand(hand: any): string {
  if (!hand) return '';
  const board = (hand.board || []).join(' ');
  let out = `Hand #${hand.hand_no} | Board: ${board||'none'} | Pot: ${hand.pot_chips} chips`;
  if (hand.winner_name) out += ` | Winner: ${hand.winner_name}`;
  const streets: Record<string,any[]> = {pre:[],flop:[],turn:[],river:[]};
  (hand.actions||[]).forEach((a:any)=>{ if(streets[a.street]) streets[a.street].push(a); });
  for (const [s,acts] of Object.entries(streets)) {
    if (!acts.length) continue;
    out += `\n  ${s.toUpperCase()}: ` + acts.map((a:any)=>`${a.display_name}:${a.action}${a.chips?`(${a.chips})`:''}` ).join(', ');
  }
  return out;
}

analysis.post('/games/:id/analysis/game', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'cohost')) return c.json({ error: 'Forbidden' }, 403);
  const apiKey = (c.env as any).ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ error: 'ANTHROPIC_API_KEY not set' }, 500);
  const hands = await c.env.DB.prepare('SELECT h.*,hr.winner_name,hr.pot_chips as result_pot,hr.hole_cards FROM hands h LEFT JOIN hand_results hr ON hr.hand_id=h.id WHERE h.game_id=? AND h.voided=0 ORDER BY h.hand_no ASC').bind(gameId).all<any>();
  const actions = await c.env.DB.prepare('SELECT * FROM hand_actions WHERE game_id=? ORDER BY hand_id,id').bind(gameId).all<any>();
  if (!hands.results.length) return c.json({ error: 'No hands recorded' }, 400);
  const byHand: Record<string,any[]> = {};
  actions.results.forEach((a:any)=>{ if(!byHand[a.hand_id]) byHand[a.hand_id]=[]; byHand[a.hand_id].push(a); });
  const summary = hands.results.slice(0,20).map((h:any)=>formatHand({...h,actions:byHand[h.id]||[]})).join('\n---\n');
  const players = await c.env.DB.prepare('SELECT DISTINCT display_name FROM game_players WHERE game_id=? AND buy_ins>0').bind(gameId).all<any>();
  const playerNames = players.results.map((p:any)=>p.display_name).join(', ');
  const analysisText = await callClaude(apiKey,
    `Hand history from a ${hands.results.length}-hand home poker session.\nPlayers: ${playerNames}\n\n${summary}\n\nProvide:\n1. **Session Overview** — key stats\n2. **Notable Hands** — 2-3 interesting spots\n3. **Player Tendencies** — brief notes per player\n4. **Key Takeaways** — 3 actionable tips\n\nKeep it friendly for a home game crowd.`,
    'You are a poker coach analysing a home game. Be specific, practical, encouraging. Focus on patterns not individual decisions. Keep it concise.');
  const id = generateId();
  await c.env.DB.prepare('INSERT INTO hand_analyses(id,game_id,analysis_type,prompt_summary,analysis,created_at) VALUES(?,?,?,?,?,unixepoch())')
    .bind(id,gameId,'game',`Full game — ${hands.results.length} hands`,analysisText).run();
  return c.json({ id, analysis: analysisText, hands_analysed: Math.min(hands.results.length,20) });
});

analysis.post('/games/:id/analysis/player', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT * FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'member')) return c.json({ error: 'Forbidden' }, 403);
  const { player_name } = await c.req.json() as any;
  if (!player_name) return c.json({ error: 'player_name required' }, 400);
  const apiKey = (c.env as any).ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ error: 'ANTHROPIC_API_KEY not set' }, 500);
  const acts = await c.env.DB.prepare('SELECT ha.*,h.hand_no FROM hand_actions ha JOIN hands h ON h.id=ha.hand_id WHERE ha.game_id=? AND ha.display_name=? AND h.voided=0 ORDER BY h.hand_no,ha.id').bind(gameId,player_name).all<any>();
  if (!acts.results.length) return c.json({ error: 'No actions found' }, 400);
  const handsPlayed = new Set(acts.results.map((a:any)=>a.hand_id)).size;
  const vpipHands = new Set(acts.results.filter((a:any)=>a.street==='pre'&&['call','raise','bet','allin'].includes(a.action)&&a.action!=='post').map((a:any)=>a.hand_id)).size;
  const vpip = handsPlayed>0?Math.round((vpipHands/handsPlayed)*100):0;
  const raises = acts.results.filter((a:any)=>['raise','bet'].includes(a.action)).length;
  const calls  = acts.results.filter((a:any)=>a.action==='call').length;
  const folds  = acts.results.filter((a:any)=>a.action==='fold').length;
  const allins = acts.results.filter((a:any)=>a.action==='allin').length;
  const byHand2: Record<string,string[]> = {};
  acts.results.forEach((a:any)=>{ if(!byHand2[a.hand_id]) byHand2[a.hand_id]=[]; byHand2[a.hand_id].push(`${a.street}:${a.action}${a.chips?`(${a.chips})`:''}`); });
  const handSummary = Object.values(byHand2).slice(0,15).map(a=>a.join(',')).join('\n');
  const analysisText = await callClaude(apiKey,
    `Player: ${player_name}\nHands: ${handsPlayed} | VPIP: ${vpip}% | Raises: ${raises} | Calls: ${calls} | Folds: ${folds} | All-ins: ${allins}\n\nActions per hand:\n${handSummary}\n\nProvide:\n1. **Playing Style** — tight/loose, aggressive/passive\n2. **Strengths** — what they do well\n3. **Leaks** — 2-3 areas to improve\n4. **One Key Tip** — most impactful change\n\nKeep to ~200 words. Be specific to their patterns.`,
    'You are a friendly poker coach giving personalised feedback to a home game player. Be encouraging but honest. Use simple language.');
  const id = generateId();
  await c.env.DB.prepare('INSERT INTO hand_analyses(id,game_id,player_name,analysis_type,prompt_summary,analysis,created_at) VALUES(?,?,?,?,?,?,unixepoch())')
    .bind(id,gameId,player_name,'player',`Player: ${player_name}`,analysisText).run();
  return c.json({ id, analysis: analysisText, stats: {hands_played:handsPlayed,vpip,raises,calls,folds,allins} });
});

analysis.get('/games/:id/analysis', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT event_id FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'member')) return c.json({ error: 'Forbidden' }, 403);
  const results = await c.env.DB.prepare('SELECT id,analysis_type,player_name,prompt_summary,analysis,created_at FROM hand_analyses WHERE game_id=? ORDER BY created_at DESC').bind(gameId).all<any>();
  return c.json(results.results);
});

export default analysis;
