#!/usr/bin/env python3
"""
PKR Reloaded — Complete New Features Patch
- Tournament mode buttons + sheets in play page
- Rabbit hunt + seat randomiser buttons + sheets
- AI analysis button
- Script tags for tournament.js + extras.js
- Landing page: updated features for Starter + Pro (no free tier)
- UpgradeModal: updated feature descriptions
- Billing worker: updated plan descriptions
- Overlay close listeners for new sheets
"""

import os, sys

ROOT  = '/workspaces/pkr-reloaded'
PLAY  = f'{ROOT}/frontend/src/app/games/[id]/play/page.tsx'
LAND  = f'{ROOT}/frontend/src/app/page.tsx'
UM    = f'{ROOT}/frontend/src/components/UpgradeModal.tsx'
BILL  = f'{ROOT}/worker/src/routes/billing.ts'
INDEX = f'{ROOT}/worker/src/index.ts'
HANDS = f'{ROOT}/worker/src/routes/hands.ts'

errors = []

def read(p):
    with open(p, 'r', encoding='utf-8') as f: return f.read()

def write(p, c):
    with open(p, 'w', encoding='utf-8') as f: f.write(c)

def patch(path, old, new, label):
    c = read(path)
    if old in c:
        write(path, c.replace(old, new, 1))
        print(f'  ✅ {label}')
        return True
    print(f'  ❌ {label} — not found')
    errors.append(label)
    return False

def copy_file(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(src, 'r', encoding='utf-8') as f: c = f.read()
    with open(dst, 'w', encoding='utf-8') as f: f.write(c)
    print(f'  ✅ Copied {os.path.basename(src)} → {dst}')

# ═══════════════════════════════════════════════════════════════
# 1. PLAY PAGE — script tags
# ═══════════════════════════════════════════════════════════════
print('\n[1] Play page — script tags')
patch(PLAY,
    "        htScript.src = '/hand-tracker.js';",
    """        htScript.src = '/hand-tracker.js';
      }
      // Load tournament.js
      if (!document.getElementById('pkr-tournament')) {
        const tScript = document.createElement('script');
        tScript.id  = 'pkr-tournament';
        tScript.src = '/tournament.js';
        document.head.appendChild(tScript);
      }
      // Load extras.js (rabbit hunt + seat randomiser)
      if (!document.getElementById('pkr-extras')) {
        const eScript = document.createElement('script');
        eScript.id  = 'pkr-extras';
        eScript.src = '/extras.js';
        document.head.appendChild(eScript);""",
    'add tournament.js and extras.js script tags')

# ═══════════════════════════════════════════════════════════════
# 2. PLAY PAGE — topbar buttons (Tournament, Seats, Rabbit, Analyse)
# ═══════════════════════════════════════════════════════════════
print('\n[2] Play page — topbar buttons')
patch(PLAY,
    """          <button id="trackHandsBtn" onClick={() => (window as any).toggleHandTracking?.()} style={{background:'none',border:'1px solid var(--border)',color:'var(--muted)',padding:'4px 10px',borderRadius:4,cursor:'pointer',fontSize:'0.8rem',marginRight:4}} title="Toggle hand tracking">🃏</button>""",
    """          <button id="trackHandsBtn" onClick={() => (window as any).toggleHandTracking?.()} style={{background:'none',border:'1px solid var(--border)',color:'var(--muted)',padding:'4px 10px',borderRadius:4,cursor:'pointer',fontSize:'0.8rem',marginRight:4}} title="Toggle hand tracking">🃏</button>
          <button onClick={() => (window as any).openTournament?.()} style={{background:'none',border:'1px solid rgba(201,168,76,0.3)',color:'var(--gold)',padding:'4px 8px',borderRadius:4,cursor:'pointer',fontSize:'0.78rem',marginRight:4}} title="Tournament Mode">🏆</button>
          <button onClick={() => (window as any).openSeatRandomiser?.()} style={{background:'none',border:'1px solid var(--border)',color:'var(--muted)',padding:'4px 8px',borderRadius:4,cursor:'pointer',fontSize:'0.78rem',marginRight:4}} title="Seat Draw">🎲</button>
          <button onClick={() => (window as any).openRabbitHunt?.()} style={{background:'none',border:'1px solid var(--border)',color:'var(--muted)',padding:'4px 8px',borderRadius:4,cursor:'pointer',fontSize:'0.78rem',marginRight:4}} title="Rabbit Hunt">🐰</button>""",
    'add Tournament/Seats/Rabbit buttons to topbar')

# ═══════════════════════════════════════════════════════════════
# 3. PLAY PAGE — bottom tab bar: add Analyse button
# ═══════════════════════════════════════════════════════════════
print('\n[3] Play page — bottom tab: Analyse button')
patch(PLAY,
    """          <button className="game-tab" id="handTrackerBtn" onClick={() => (window as any).openHandTracker?.()} style={{display:'none'}}><span className="game-tab-icon">🃏</span>Hands</button>""",
    """          <button className="game-tab" id="handTrackerBtn" onClick={() => (window as any).openHandTracker?.()} style={{display:'none'}}><span className="game-tab-icon">🃏</span>Hands</button>
          <button className="game-tab" id="analyseBtn" onClick={() => { const ctx = (window as any).getPkrCtx?.(); if(ctx?.gameId) window.location.href=`/games/${ctx.gameId}/analysis`; }} style={{display:'none'}}><span className="game-tab-icon">🤖</span>Analyse</button>""",
    'add Analyse tab button')

# Show the analyse button when hand tracking is on
# Find where handTrackerBtn is shown/hidden
patch(PLAY,
    """    var htBtn2  = document.getElementById('handTrackerBtn');
    var trkBtn2 = document.getElementById('trackHandsBtn');""",
    """    var htBtn2  = document.getElementById('handTrackerBtn');
    var anlBtn  = document.getElementById('analyseBtn');
    var trkBtn2 = document.getElementById('trackHandsBtn');""",
    'declare analyseBtn variable')

patch(PLAY,
    "    if (htBtn2) htBtn2.style.display = on ? '' : 'none';",
    "    if (htBtn2) htBtn2.style.display = on ? '' : 'none';\n    if (anlBtn) anlBtn.style.display = on ? '' : 'none';",
    'show/hide analyseBtn with hand tracker')

# ═══════════════════════════════════════════════════════════════
# 4. PLAY PAGE — new sheets (Tournament, Rabbit, Seat)
# ═══════════════════════════════════════════════════════════════
print('\n[4] Play page — new sheets')
NEW_SHEETS = """
      {/* ── TOURNAMENT SHEET ── */}
      <div className="sheet" id="tournamentSheet">
        <div className="sheet-box">
          <div className="sheet-hdr"><h2>🏆 Tournament</h2><button className="panel-close" onClick={() => (window as any).closeTournament?.()}>✕</button></div>
          <div className="sheet-body" id="tournamentBody" style={{padding:'16px'}}></div>
        </div>
      </div>

      {/* ── RABBIT HUNT SHEET ── */}
      <div className="sheet" id="rabbitSheet">
        <div className="sheet-box">
          <div className="sheet-hdr"><h2>🐰 Rabbit Hunt</h2><button className="panel-close" onClick={() => (window as any).closeRabbitHunt?.()}>✕</button></div>
          <div className="sheet-body" id="rabbitBody" style={{padding:'16px'}}></div>
        </div>
      </div>

      {/* ── SEAT RANDOMISER SHEET ── */}
      <div className="sheet" id="seatSheet">
        <div className="sheet-box">
          <div className="sheet-hdr"><h2>🎲 Seat Draw</h2><button className="panel-close" onClick={() => (window as any).closeSeatRandomiser?.()}>✕</button></div>
          <div className="sheet-body" id="seatBody" style={{padding:'16px'}}></div>
        </div>
      </div>
"""

patch(PLAY,
    """      <div className="sheet" id="publishSheet">""",
    NEW_SHEETS + """      <div className="sheet" id="publishSheet">""",
    'add tournament/rabbit/seat sheets to JSX')

# ═══════════════════════════════════════════════════════════════
# 5. PLAY PAGE — overlay close listeners for new sheets
# ═══════════════════════════════════════════════════════════════
print('\n[5] Play page — overlay close listeners')
patch(PLAY,
    """  var publishSheet = document.getElementById('publishSheet');
  if (e.target === publishSheet) window.closePublish();""",
    """  var publishSheet = document.getElementById('publishSheet');
  if (e.target === publishSheet) window.closePublish();
  var tournamentSheet = document.getElementById('tournamentSheet');
  if (e.target === tournamentSheet) { (window as any).closeTournament?.(); }
  var rabbitSheet = document.getElementById('rabbitSheet');
  if (e.target === rabbitSheet) { (window as any).closeRabbitHunt?.(); }
  var seatSheet = document.getElementById('seatSheet');
  if (e.target === seatSheet) { (window as any).closeSeatRandomiser?.(); }""",
    'add overlay close listeners for new sheets')

# ═══════════════════════════════════════════════════════════════
# 6. LANDING PAGE — update Starter feature list
# ═══════════════════════════════════════════════════════════════
print('\n[6] Landing page — Starter features')
patch(LAND,
    """                {['1 active group', 'Up to 9 seats per game', 'Full leaderboard & history', 'Push notifications', 'Spectator view & QR invites', 'WhatsApp share & offline mode'].map(f => <li key={f}><span className="ck">✓</span>{f}</li>)}
                <li className="dim"><span className="ck">○</span>Multiple groups</li>
                <li className="dim"><span className="ck">○</span>10–15 seat games</li>""",
    """                {['Buy-in & cashout tracking', 'Real-time live view for players', 'Full leaderboard & history', 'Hand tracking (basic)', 'Push notifications', 'WhatsApp settlement sharing', 'Seat randomiser', '🎲 1 active group · Up to 9 seats'].map(f => <li key={f}><span className="ck">✓</span>{f}</li>)}
                <li className="dim"><span className="ck">○</span>AI hand analysis</li>
                <li className="dim"><span className="ck">○</span>Tournament mode & blind timer</li>
                <li className="dim"><span className="ck">○</span>Multiple groups</li>""",
    'update Starter feature list')

# ═══════════════════════════════════════════════════════════════
# 7. LANDING PAGE — update Starter tagline
# ═══════════════════════════════════════════════════════════════
print('\n[7] Landing page — Starter tagline')
patch(LAND,
    'For casual groups who play occasionally. Every core feature included.',
    'Track buy-ins, run live games, settle up instantly. Everything you need for a great home game.',
    'update Starter tagline')

# ═══════════════════════════════════════════════════════════════
# 8. LANDING PAGE — update Pro feature list
# ═══════════════════════════════════════════════════════════════
print('\n[8] Landing page — Pro features')
patch(LAND,
    """                {['Unlimited groups', 'Up to 15 seats per game', 'Full leaderboard & history', 'Push notifications', 'Spectator view & QR invites', 'WhatsApp share & offline mode', 'Priority support', 'Early access to new features'].map(f => <li key={f}><span className="ck">✓</span>{f}</li>)}""",
    """                {['Everything in Starter', 'Unlimited groups · Up to 15 seats', '🤖 AI hand analysis (Claude)', '⏱ Tournament mode + blind timer', '📊 Player stats dashboard (VPIP, win rate)', '🐰 Rabbit hunt', '👁 Live hole card submission', '🃏 Side pot calculator', '📤 Hand history export', 'Priority support'].map(f => <li key={f}><span className="ck">✓</span>{f}</li>)}""",
    'update Pro feature list')

# ═══════════════════════════════════════════════════════════════
# 9. LANDING PAGE — update Pro tagline
# ═══════════════════════════════════════════════════════════════
print('\n[9] Landing page — Pro tagline')
patch(LAND,
    'For groups who play weekly or run multiple tables. Bigger games, unlimited groups.',
    'Unlock AI coaching, tournament mode, and advanced stats. The complete poker night platform.',
    'update Pro tagline')

# ═══════════════════════════════════════════════════════════════
# 10. LANDING PAGE — remove "free trial" hero button text, replace with sign in
# ═══════════════════════════════════════════════════════════════
print('\n[10] Landing page — hero button')
patch(LAND,
    'Start Free — 5 Days',
    'Start Free Trial',
    'update hero button text')

# ═══════════════════════════════════════════════════════════════
# 11. UPGRADE MODAL — update Starter plan description
# ═══════════════════════════════════════════════════════════════
print('\n[11] UpgradeModal — Starter description')
patch(UM,
    "                    <div style={s.planFeature}>1 group · Up to 9 seats · All features</div>",
    "                    <div style={s.planFeature}>1 group · Up to 9 seats · Buy-ins, live view, leaderboard</div>",
    'update Starter plan description in modal')

# ═══════════════════════════════════════════════════════════════
# 12. UPGRADE MODAL — update Pro plan description
# ═══════════════════════════════════════════════════════════════
print('\n[12] UpgradeModal — Pro description')
patch(UM,
    "                    <div style={s.planFeature}>Unlimited groups · Up to 15 seats · All features</div>",
    "                    <div style={s.planFeature}>Unlimited groups · 15 seats · AI analysis · Tournament mode · Stats</div>",
    'update Pro plan description in modal')

# ═══════════════════════════════════════════════════════════════
# 13. BILLING WORKER — update plan features
# ═══════════════════════════════════════════════════════════════
print('\n[13] Billing worker — plan features')
patch(BILL,
    "  starter: { label: 'Starter', price_usd: 999,  features: ['1 group', 'Up to 9 seats', 'All core features'] },\n  pro:     { label: 'Pro',     price_usd: 1999, features: ['Unlimited groups', 'Up to 15 seats', 'All features'] },",
    "  starter: { label: 'Starter', price_usd: 999,  features: ['1 group', 'Up to 9 seats', 'Buy-ins, live view, leaderboard, hand tracking'] },\n  pro:     { label: 'Pro',     price_usd: 1999, features: ['Unlimited groups', 'Up to 15 seats', 'AI analysis', 'Tournament mode', 'Player stats', 'Rabbit hunt'] },",
    'update billing plan features')

# ═══════════════════════════════════════════════════════════════
# 14. WORKER INDEX — add tournament + analysis imports + routes
# ═══════════════════════════════════════════════════════════════
print('\n[14] Worker index — tournament + analysis routes')

c = read(INDEX)
if "import tournament from './routes/tournament'" not in c:
    patch(INDEX,
        "import hands from './routes/hands';",
        "import hands      from './routes/hands';\nimport tournament from './routes/tournament';\nimport analysis   from './routes/analysis';",
        'worker index: imports')
else:
    print('  ℹ️  imports already present')

c = read(INDEX)
if "app.route('/', tournament)" not in c:
    patch(INDEX,
        "app.route('/', hands);",
        "app.route('/', hands);\napp.route('/', tournament);\napp.route('/', analysis);",
        'worker index: mount routes')
else:
    print('  ℹ️  routes already mounted')

# ═══════════════════════════════════════════════════════════════
# 15. HANDS ROUTE — add seat draw route
# ═══════════════════════════════════════════════════════════════
print('\n[15] Hands route — seat draw endpoint')

SEAT_DRAW = """
// ── Seat draw ────────────────────────────────────────────────────────────────
hands.post('/games/:id/seat-draw', authMiddleware, async (c) => {
  const gameId = c.req.param('id');
  const game = await c.env.DB.prepare('SELECT event_id FROM games WHERE id=?').bind(gameId).first<any>();
  if (!game) return c.json({ error: 'Not found' }, 404);
  if (!await requireEventRole(c, game.event_id, 'cohost')) return c.json({ error: 'Forbidden' }, 403);
  const { result } = await c.req.json() as any;
  await c.env.DB.prepare('UPDATE games SET seat_draw_result=? WHERE id=?')
    .bind(JSON.stringify(result || []), gameId).run();
  return c.json({ ok: true });
});

"""

c = read(HANDS)
if 'seat-draw' not in c:
    patch(HANDS,
        "// ── Get live hand state (for player view polling) ────────────────────────────",
        SEAT_DRAW + "// ── Get live hand state (for player view polling) ────────────────────────────",
        'hands.ts: seat draw route')
else:
    print('  ℹ️  seat-draw route already present')

# ═══════════════════════════════════════════════════════════════
# 16. COPY NEW ROUTE FILES
# ═══════════════════════════════════════════════════════════════
print('\n[16] Copy worker route files')

OUTPUTS = '/mnt/user-data/outputs'

routes_to_copy = [
    (f'{OUTPUTS}/worker_tournament.ts', f'{ROOT}/worker/src/routes/tournament.ts'),
    (f'{OUTPUTS}/worker_analysis.ts',   f'{ROOT}/worker/src/routes/analysis.ts'),
]
for src, dst in routes_to_copy:
    if os.path.exists(src):
        copy_file(src, dst)
    else:
        print(f'  ❌ Source not found: {src}')
        errors.append(f'copy {os.path.basename(src)}')

# ═══════════════════════════════════════════════════════════════
# 17. COPY PUBLIC JS FILES
# ═══════════════════════════════════════════════════════════════
print('\n[17] Copy public JS files')

js_to_copy = [
    (f'{OUTPUTS}/tournament.js', f'{ROOT}/frontend/public/tournament.js'),
    (f'{OUTPUTS}/extras.js',     f'{ROOT}/frontend/public/extras.js'),
]
for src, dst in js_to_copy:
    if os.path.exists(src):
        copy_file(src, dst)
    else:
        print(f'  ❌ Source not found: {src}')
        errors.append(f'copy {os.path.basename(src)}')

# ═══════════════════════════════════════════════════════════════
# 18. COPY ANALYSIS PAGE
# ═══════════════════════════════════════════════════════════════
print('\n[18] Copy analysis page')

analysis_dst = f'{ROOT}/frontend/src/app/games/[id]/analysis/page.tsx'
analysis_src = f'{OUTPUTS}/analysis_page.tsx'
if os.path.exists(analysis_src):
    copy_file(analysis_src, analysis_dst)
else:
    print(f'  ❌ analysis_page.tsx not found in outputs')
    errors.append('copy analysis_page.tsx')

# ═══════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════
print('\n' + '='*60)
if errors:
    print(f'⚠️  Completed with {len(errors)} error(s):')
    for e in errors: print(f'   - {e}')
else:
    print('✅ All patches applied successfully!')

print('\nNext steps:')
print('1. Run D1 migration (migration_v2.sql) in Cloudflare Console')
print('2. Set ANTHROPIC_API_KEY:')
print('   cd /workspaces/pkr-reloaded/worker')
print('   CLOUDFLARE_API_TOKEN=JNiBKlFxZZ_C_chFXXtvEoK0Hhm5bvYnlPumM5WI npx wrangler@3.114.17 secret put ANTHROPIC_API_KEY')
print('3. Deploy + push:')
print('   CLOUDFLARE_API_TOKEN=JNiBKlFxZZ_C_chFXXtvEoK0Hhm5bvYnlPumM5WI npx wrangler@3.114.17 deploy')
print('   cd .. && git add -A && git commit -m "feat: tournament, AI analysis, rabbit hunt, seat draw, updated pricing" && git push')
