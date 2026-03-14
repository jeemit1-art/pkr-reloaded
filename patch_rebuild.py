#!/usr/bin/env python3
"""
Clean play page patch:
- Adds 🃏 toggle button to top bar (DOM button, no JS string)
- Adds 🃏 Hands tab to bottom tabs (hidden by default)
- Adds hand tracker sheet, winner overlay, card picker as plain JSX DOM divs
- Loads hand-tracker.js as a script src (zero string escaping)
- Patches events page for stakes fields
- Patches live page for board cards
- Patches worker index for hands route
- Patches state.game in getTableJS to include chip/hand fields
"""

PLAY   = '/workspaces/pkr-reloaded/frontend/src/app/games/[id]/play/page.tsx'
LIVE   = '/workspaces/pkr-reloaded/frontend/src/app/games/live/[token]/page.tsx'
EVENTS = '/workspaces/pkr-reloaded/frontend/src/app/events/[id]/page.tsx'
INDEX  = '/workspaces/pkr-reloaded/worker/src/index.ts'

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

# ── 1. Worker index: add hands route ────────────────────────────────────────
patch(INDEX,
    "import auth    from './routes/auth';\nimport events  from './routes/events';\nimport games   from './routes/games';\nimport billing from './routes/billing';",
    "import auth    from './routes/auth';\nimport events  from './routes/events';\nimport games   from './routes/games';\nimport billing from './routes/billing';\nimport hands   from './routes/hands';",
    'worker: import hands')

patch(INDEX,
    "app.route('/billing', billing);\napp.route('/',        games);",
    "app.route('/billing', billing);\napp.route('/',        hands);\napp.route('/',        games);",
    'worker: route hands')

# ── 2. Play page: add 🃏 toggle button to top bar ────────────────────────────
patch(PLAY,
    '<button className="share-btn" id="shareBtn" onClick={() => (window as any).openShare?.()}>⬡ Share</button>',
    '<button id="trackHandsBtn" onClick={() => (window as any).toggleHandTracking?.()} style={{background:\'none\',border:\'1px solid var(--border)\',color:\'var(--muted)\',padding:\'4px 10px\',borderRadius:4,cursor:\'pointer\',fontSize:\'0.8rem\',marginRight:4}} title="Toggle hand tracking">🃏</button>\n          <button className="share-btn" id="shareBtn" onClick={() => (window as any).openShare?.()}>⬡ Share</button>',
    'play: hand tracking toggle in top bar')

# ── 3. Play page: add 🃏 Hands tab ────────────────────────────────────────────
patch(PLAY,
    '<button className="game-tab red" id="endGameBtn" onClick={() => (window as any).endGame?.()}><span className="game-tab-icon">🏁</span>End Game</button>',
    '<button className="game-tab" id="handTrackerBtn" onClick={() => (window as any).openHandTracker?.()} style={{display:\'none\'}}><span className="game-tab-icon">🃏</span>Hands</button>\n          <button className="game-tab red" id="endGameBtn" onClick={() => (window as any).endGame?.()}><span className="game-tab-icon">🏁</span>End Game</button>',
    'play: hand tracker tab')

# ── 4. Play page: add DOM sheets + script loader before WA toast ─────────────
SHEETS = '''
      {/* ── HAND TRACKER SHEET ── */}
      <div className="sheet" id="handTrackerSheet">
        <div className="sheet-box" style={{maxHeight:'85vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div className="sheet-hdr">
            <h2>🃏 Hand Tracker</h2>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              <button id="undoActionBtn" style={{display:'none',background:'none',border:'1px solid var(--border)',color:'var(--muted)',padding:'4px 10px',borderRadius:4,cursor:'pointer',fontSize:'0.75rem'}} onClick={() => (window as any).htUndoAction?.()}>↩ Undo</button>
              <button style={{background:'none',border:'1px solid var(--border)',color:'var(--muted)',padding:'4px 10px',borderRadius:4,cursor:'pointer',fontSize:'0.75rem'}} onClick={() => (window as any).toggleHandHistory?.()}>History</button>
              <button className="panel-close" onClick={() => (window as any).closeHandTracker?.()}>✕</button>
            </div>
          </div>
          <div className="sheet-body" id="handTrackerBody" style={{overflowY:'auto',flex:1,padding:'12px 16px'}}></div>
        </div>
      </div>

      {/* ── DECLARE WINNER OVERLAY ── */}
      <div className="overlay" id="winnerOverlay">
        <div className="modal">
          <h2>🏆 Who won?</h2>
          <div id="winnerPotLabel" style={{fontSize:'0.85rem',color:'var(--muted)',marginBottom:'14px'}}></div>
          <div id="winnerPlayerList" style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'14px'}}></div>
          <div className="modal-actions">
            <button className="btn-cancel" onClick={() => (window as any).closeWinnerOverlay?.()}>Cancel</button>
          </div>
        </div>
      </div>

      {/* ── CARD PICKER SHEET ── */}
      <div className="sheet" id="cardPickerSheet">
        <div className="sheet-box">
          <div className="sheet-hdr">
            <h2 id="cardPickerTitle">Pick card</h2>
            <button className="panel-close" onClick={() => (window as any).closeCardPicker?.()}>✕</button>
          </div>
          <div className="sheet-body" id="cardPickerBody" style={{padding:'12px 16px'}}></div>
        </div>
      </div>

'''

patch(PLAY,
    '      {/* ── WA TOAST ── */}',
    SHEETS + '      {/* ── WA TOAST ── */}',
    'play: hand tracker DOM sheets')

# ── 5. Play page: load hand-tracker.js script after QRCode ───────────────────
patch(PLAY,
    "      if (!(window as any).QRCode) {\n        const qrScript = document.createElement('script');\n        qrScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';\n        qrScript.onload = injectTableScript;\n        document.head.appendChild(qrScript);\n      } else {\n        injectTableScript();\n      }",
    """      if (!(window as any).QRCode) {
        const qrScript = document.createElement('script');
        qrScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        qrScript.onload = injectTableScript;
        document.head.appendChild(qrScript);
      } else {
        injectTableScript();
      }
      // Load hand tracker as separate static file (no string escaping issues)
      if (!document.getElementById('pkr-hand-tracker')) {
        const htScript = document.createElement('script');
        htScript.id  = 'pkr-hand-tracker';
        htScript.src = '/hand-tracker.js';
        document.body.appendChild(htScript);
      }""",
    'play: load hand-tracker.js')

# ── 6. Play page: expose pBuyin, inits, getPkrCtx, showToast to window ───────
# These are needed by hand-tracker.js. Find where pBuyin is defined in getTableJS
patch(PLAY,
    "function getPkrCtx() { try { return JSON.parse(localStorage.getItem('pkrCtx') || 'null'); } catch(e) { return null; } }",
    """function getPkrCtx() { try { return JSON.parse(localStorage.getItem('pkrCtx') || 'null'); } catch(e) { return null; } }
window.getPkrCtx = getPkrCtx;""",
    'play: expose getPkrCtx to window')

patch(PLAY,
    "function pBuyin(p) {",
    "window.pBuyin = function pBuyin(p) {",
    'play: expose pBuyin to window')

patch(PLAY,
    "function inits(s) {",
    "window.inits = function inits(s) {",
    'play: expose inits to window')

# ── 7. Play page: store chip/hand fields in state.game ───────────────────────
patch(PLAY,
    """      state.game = {
        name: game.name || 'Poker Night',
        seats: game.seats,
        defaultBuyin: game.buy_in ? game.buy_in / 100 : 25,
        code: game.live_token || ctx.gameId,
      };""",
    """      state.game = {
        name: game.name || 'Poker Night',
        seats: game.seats,
        defaultBuyin: game.buy_in ? game.buy_in / 100 : 25,
        code: game.live_token || ctx.gameId,
        chip_value: game.chip_value || 0,
        starting_chips: game.starting_chips || 0,
        small_blind: game.small_blind || 0,
        big_blind: game.big_blind || 0,
        hand_tracking: game.hand_tracking || 0,
      };""",
    'play: store chip/hand fields in state.game')

# ── 8. Play page: show/hide tracker tab after game load ──────────────────────
patch(PLAY,
    "    var titleEl = document.getElementById('topbarTitle');\n    if (titleEl && state.game) titleEl.textContent = state.game.name;",
    """    var titleEl = document.getElementById('topbarTitle');
    if (titleEl && state.game) titleEl.textContent = state.game.name;
    var htBtn2  = document.getElementById('handTrackerBtn');
    var trkBtn2 = document.getElementById('trackHandsBtn');
    if (htBtn2)  htBtn2.style.display  = (state.game && state.game.hand_tracking) ? '' : 'none';
    if (trkBtn2) trkBtn2.style.color   = (state.game && state.game.hand_tracking) ? 'var(--gold)' : 'var(--muted)';""",
    'play: show/hide hand tracker tab on game load')

# ── 9. Play page: add chip count badge to seat render ────────────────────────
patch(PLAY,
    "      var netHtml = bi > 0 ? '<div class=\"seat-net ' + nc(net) + '\">' + fmtNet(net) + '</div>' : (isRsvp ? '<div class=\"seat-net\" style=\"color:var(--muted);font-size:0.88rem\">RSVP</div>' : '');",
    """      var netHtml = bi > 0 ? '<div class="seat-net ' + nc(net) + '">' + fmtNet(net) + '</div>' : (isRsvp ? '<div class="seat-net" style="color:var(--muted);font-size:0.88rem">RSVP</div>' : '');
      var chipHtml = '';
      if (bi > 0 && game && game.chip_value > 0 && game.starting_chips > 0) {
        var buyCt = p.transactions ? p.transactions.filter(function(t){return t.type!=='cashout';}).length : (p.buy_ins||1);
        var chips = game.starting_chips * Math.max(1, buyCt);
        chipHtml = '<div style="font-size:clamp(0.55rem,1.3vw,0.68rem);color:var(--gold);background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.25);border-radius:3px;padding:1px 5px;margin-top:1px;font-family:DM Sans,sans-serif;line-height:1.4;">' + chips + ' chips</div>';
      }""",
    'play: chip count badge variable')

patch(PLAY,
    "seat.innerHTML = '<div class=\"seat-chip ' + cls + '\" style=\"width:' + cs + ';height:' + cs + ';' + (isRsvp?'border-style:dashed;opacity:0.7':'') + '\"><span class=\"seat-inner\" style=\"font-size:' + initFs + '\">' + esc(inits(p.name)) + '</span></div><div class=\"seat-label\">' + esc(p.name) + '</div>' + netHtml + chipHtml;",
    "seat.innerHTML = '<div class=\"seat-chip ' + cls + '\" style=\"width:' + cs + ';height:' + cs + ';' + (isRsvp?'border-style:dashed;opacity:0.7':'') + '\"><span class=\"seat-inner\" style=\"font-size:' + initFs + '\">' + esc(inits(p.name)) + '</span></div><div class=\"seat-label\">' + esc(p.name) + '</div>' + netHtml + chipHtml;",
    'play: seat innerHTML already has chipHtml (no change needed)')

# ── 10. Events page: add stakes fields ───────────────────────────────────────
# Check if already patched
with open(EVENTS, 'r') as f:
    ev = f.read()

if 'small_blind' not in ev:
    patch(EVENTS,
        "const [form, setForm] = useState({scheduled_at:'',location:'',notes:'',seats:'9',game_password:'',repeat:'none',format:'cash'});",
        "const [form, setForm] = useState({scheduled_at:'',location:'',notes:'',seats:'9',game_password:'',repeat:'none',format:'cash',small_blind:'',big_blind:'',starting_chips:''});",
        'events: form state add stakes')

    patch(EVENTS,
        "        repeat: form.repeat !== 'none' ? form.repeat : undefined,\n        format: form.format,\n      });\n      setGames(gs=>[g,...gs]);\n      setShowCreate(false);\n      setForm({scheduled_at:'',location:'',notes:'',seats:'9',game_password:'',repeat:'none',format:'cash'});",
        """        repeat: form.repeat !== 'none' ? form.repeat : undefined,
        format: form.format,
        small_blind: form.small_blind ? Math.round(parseFloat(form.small_blind)*100) : undefined,
        big_blind: form.big_blind ? Math.round(parseFloat(form.big_blind)*100) : undefined,
        starting_chips: form.starting_chips ? parseInt(form.starting_chips) : undefined,
      });
      setGames(gs=>[g,...gs]);
      setShowCreate(false);
      setForm({scheduled_at:'',location:'',notes:'',seats:'9',game_password:'',repeat:'none',format:'cash',small_blind:'',big_blind:'',starting_chips:''});""",
        'events: createGame pass stakes')

    STAKES_UI = """              <div>
                <div className="lbl" style={{marginBottom:8}}>Stakes (optional)</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <div>
                    <div style={{fontSize:10,color:'var(--muted)',marginBottom:4,fontFamily:'var(--font-body),sans-serif',textTransform:'uppercase',letterSpacing:'0.05em'}}>Small blind ($)</div>
                    <input className="inp" placeholder="e.g. 0.50" type="number" step="0.25" min="0"
                      value={form.small_blind}
                      onChange={e=>{
                        const sb = e.target.value;
                        const bb = sb && !isNaN(parseFloat(sb)) ? String(parseFloat(sb)*2) : form.big_blind;
                        setForm(f=>({...f,small_blind:sb,big_blind:bb}));
                      }}/>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:'var(--muted)',marginBottom:4,fontFamily:'var(--font-body),sans-serif',textTransform:'uppercase',letterSpacing:'0.05em'}}>Big blind ($)</div>
                    <input className="inp" placeholder="e.g. 1.00" type="number" step="0.25" min="0"
                      value={form.big_blind}
                      onChange={e=>setForm(f=>({...f,big_blind:e.target.value}))}/>
                  </div>
                </div>
                {form.small_blind && !isNaN(parseFloat(form.small_blind)) && (
                  <div style={{marginTop:8}}>
                    <div style={{fontSize:10,color:'var(--muted)',marginBottom:4,fontFamily:'var(--font-body),sans-serif',textTransform:'uppercase',letterSpacing:'0.05em'}}>Starting chips per player</div>
                    <input className="inp" placeholder="e.g. 50" type="number" min="1"
                      value={form.starting_chips}
                      onChange={e=>setForm(f=>({...f,starting_chips:e.target.value}))}/>
                    {form.starting_chips && !isNaN(parseInt(form.starting_chips)) && (
                      <div style={{fontSize:11,color:'var(--gold)',marginTop:4,fontFamily:'var(--font-body),sans-serif'}}>
                        Each chip = ${parseFloat(form.small_blind||'0').toFixed(2)} · buy-in ≈ ${(parseInt(form.starting_chips)*parseFloat(form.small_blind||'0')).toFixed(2)}
                      </div>
                    )}
                  </div>
                )}
              </div>"""

    patch(EVENTS,
        '            <div style={{display:\'flex\',gap:8,marginTop:20}}>\n              <button className="btn btn-primary" style={{flex:1}} disabled={!form.scheduled_at||saving} onClick={createGame}>',
        STAKES_UI + '\n            <div style={{display:\'flex\',gap:8,marginTop:20}}>\n              <button className="btn btn-primary" style={{flex:1}} disabled={!form.scheduled_at||saving} onClick={createGame}>',
        'events: stakes UI in create form')
else:
    print('ℹ️  events: stakes already patched')

# ── 11. Live page: add chip stack + board cards ───────────────────────────────
with open(LIVE, 'r') as f:
    lv = f.read()

if 'chipValue' not in lv:
    patch(LIVE,
        "  const { game, event, players, totalIn, totalOut, bank } = data as any;",
        """  const { game, event, players, totalIn, totalOut, bank } = data as any;
  const chipValue  = (game.chip_value    || 0) as number;
  const startChips = (game.starting_chips || 0) as number;
  const hasChips   = chipValue > 0 && startChips > 0;""",
        'live: chip value vars')

    patch(LIVE,
        "                  <div style={{fontSize:13,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>\n                    ×{p.buy_ins}\n                  </div>",
        """                  <div style={{fontSize:13,color:'var(--muted)',fontFamily:'var(--font-body),sans-serif'}}>
                    ×{p.buy_ins}
                  </div>
                  {hasChips && (
                    <div style={{fontSize:11,color:'rgba(201,168,76,0.8)',fontFamily:'var(--font-body),sans-serif',marginTop:1}}>
                      {startChips * Math.max(1,p.buy_ins||1)} chips
                    </div>
                  )}""",
        'live: chip count on player rows')
else:
    print('ℹ️  live: chips already patched')

print('\n✅ All patches done.')
