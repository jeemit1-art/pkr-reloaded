#!/usr/bin/env python3
"""
Patches for hand tracker v5:
1. Worker: add live-cards toggle route
2. Worker: add D1 column for live_cards_enabled
3. Live page: add card submission UI when live cards enabled
"""

HANDS = '/workspaces/pkr-reloaded/worker/src/routes/hands.ts'
LIVE  = '/workspaces/pkr-reloaded/frontend/src/app/games/live/[token]/page.tsx'

def patch(path, old, new, label):
    with open(path, 'r') as f:
        c = f.read()
    if old in c:
        with open(path, 'w') as f:
            f.write(c.replace(old, new, 1))
        print('✅ ' + label)
        return True
    print('❌ ' + label)
    return False

# 1. Worker: live-cards toggle route
patch(HANDS,
    "// ── Get live hand state (for player view polling) ────────────────────────────",
    """// ── Toggle live card submission ──────────────────────────────────────────────
hands.post('/games/:id/tracking/live-cards', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await getGameAndVerify(c, gameId);
  if (!game) return c.json({ error: 'Forbidden' }, 403);
  const { enabled } = await c.req.json() as any;
  await c.env.DB.prepare('UPDATE games SET live_cards_enabled=? WHERE id=?').bind(enabled ? 1 : 0, gameId).run();
  return c.json({ live_cards_enabled: enabled ? 1 : 0 });
});

// ── Get live hand state (for player view polling) ────────────────────────────""",
    'worker: live-cards toggle route')

# 2. Live page: fetch live_cards_enabled and current hand, show card submission
# First check if already patched
with open(LIVE, 'r') as f:
    lv = f.read()

if 'live_cards_enabled' not in lv:
    # Add live_cards_enabled to the game data
    patch(LIVE,
        "  const chipValue  = (game.chip_value    || 0) as number;\n  const startChips = (game.starting_chips || 0) as number;\n  const hasChips   = chipValue > 0 && startChips > 0;",
        """  const chipValue       = (game.chip_value     || 0) as number;
  const startChips      = (game.starting_chips || 0) as number;
  const hasChips        = chipValue > 0 && startChips > 0;
  const liveCardsEnabled = !!(game.live_cards_enabled);""",
        'live: add live_cards_enabled var')

    # Add card submission section to the live view
    # Find a good place to add it - after the player list section
    patch(LIVE,
        "      {totalIn > 0 && (",
        """      {/* ── Live card submission ── */}
      {liveCardsEnabled && (data as any).handData && !(data as any).handData.result && (
        <LiveCardSubmit
          gameId={(data as any).gameId || ''}
          handId={(data as any).handData.id || ''}
          apiUrl={typeof window !== 'undefined' ? (localStorage.getItem('pkrCtx') ? JSON.parse(localStorage.getItem('pkrCtx')||'{}').apiUrl || '' : '') : ''}
        />
      )}

      {totalIn > 0 && (""",
        'live: add card submission section')

    # Add the LiveCardSubmit component before the export
    patch(LIVE,
        "\nexport default function LivePage()",
        """
function LiveCardSubmit({ gameId, handId, apiUrl }: { gameId: string; handId: string; apiUrl: string }) {
  const [cards, setCards] = (require('react') as any).useState<string[]>([]);
  const [submitted, setSubmitted] = (require('react') as any).useState(false);
  const [picking, setPicking] = (require('react') as any).useState(false);

  const suits = ['\u2660','\u2665','\u2666','\u2663'];
  const ranks = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

  async function submitCards() {
    if (cards.length !== 2) return;
    const ctx = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('pkrCtx')||'{}') : {};
    try {
      await fetch(`${ctx.apiUrl || apiUrl}/games/${gameId}/hands/${handId}/player-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(ctx.token ? {'Authorization': 'Bearer '+ctx.token} : {}) },
        body: JSON.stringify({ cards }),
        credentials: 'include',
      });
      setSubmitted(true);
    } catch(e) {}
  }

  if (submitted) return (
    <div style={{background:'rgba(46,204,113,0.08)',border:'1px solid rgba(46,204,113,0.2)',borderRadius:10,padding:'12px 16px',marginBottom:16}}>
      <div style={{fontSize:13,color:'var(--green)',fontWeight:700}}>✓ Cards submitted</div>
      <div style={{fontSize:11,color:'var(--muted)',marginTop:3}}>Your cards will be revealed after the hand</div>
    </div>
  );

  return (
    <div style={{background:'rgba(201,168,76,0.06)',border:'1px solid rgba(201,168,76,0.2)',borderRadius:10,padding:'12px 16px',marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--gold)',marginBottom:8}}>🃏 Submit your hole cards</div>
      <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:10}}>
        {[0,1].map(i => (
          <div key={i} onClick={() => setPicking(true)} style={{width:36,height:50,background:cards[i]?'#fff':'rgba(255,255,255,0.06)',border:'1px solid '+(cards[i]?'transparent':'rgba(201,168,76,0.3)'),borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontWeight:700,fontSize:14,color:cards[i]&&(cards[i].includes('\u2665')||cards[i].includes('\u2666'))?'#d63031':'#1a1a1a'}}>
            {cards[i] || '?'}
          </div>
        ))}
        {cards.length === 2 && (
          <button onClick={submitCards} style={{flex:1,padding:'10px 14px',background:'var(--gold)',color:'#000',border:'none',borderRadius:6,fontWeight:700,fontSize:13,cursor:'pointer'}}>
            Submit
          </button>
        )}
      </div>
      {picking && (
        <div style={{background:'rgba(0,0,0,0.5)',borderRadius:8,padding:'10px 12px'}}>
          {suits.map(suit => {
            const isRed = suit === '\u2665' || suit === '\u2666';
            return (
              <div key={suit} style={{display:'flex',gap:2,marginBottom:4,alignItems:'center'}}>
                <span style={{width:16,textAlign:'center',color:isRed?'#e74c3c':'#f0e6c8'}}>{suit}</span>
                {ranks.map(rank => {
                  const card = rank + suit;
                  const isSel = cards.includes(card);
                  return (
                    <button key={rank} onClick={() => {
                      if (isSel) { setCards(cards.filter(c => c !== card)); }
                      else if (cards.length < 2) { const nc = [...cards, card]; setCards(nc); if (nc.length === 2) setPicking(false); }
                    }} style={{flex:1,padding:'5px 1px',background:isSel?'var(--gold)':'rgba(255,255,255,0.05)',color:isSel?'#000':isRed?'#e74c3c':'#f0e6c8',border:'1px solid '+(isSel?'var(--gold)':'rgba(255,255,255,0.08)'),borderRadius:3,cursor:'pointer',fontSize:'clamp(0.6rem,2vw,0.75rem)',fontWeight:700}}>
                      {rank}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <button onClick={() => setPicking(false)} style={{width:'100%',marginTop:8,padding:8,background:'none',border:'1px solid var(--border)',color:'var(--muted)',borderRadius:6,cursor:'pointer',fontSize:12}}>Done</button>
        </div>
      )}
    </div>
  );
}

export default function LivePage()""",
        'live: add LiveCardSubmit component')

else:
    print('ℹ️  live: already has live_cards_enabled')

# 3. D1 migration note
print('\n⚠️  Run in D1 Console:')
print('ALTER TABLE games ADD COLUMN live_cards_enabled INTEGER DEFAULT 0;')
print('\nAnd create the player-cards storage table:')
print("CREATE TABLE IF NOT EXISTS hand_player_cards (id TEXT PRIMARY KEY, hand_id TEXT NOT NULL, user_id TEXT, display_name TEXT, cards TEXT DEFAULT '[]', submitted_at INTEGER DEFAULT (unixepoch()), revealed INTEGER DEFAULT 0);")

print('\n✅ All patches done.')
