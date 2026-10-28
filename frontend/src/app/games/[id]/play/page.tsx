'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppDialog from '@/components/AppDialog';

export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params?.id as string;
  const initialized = useRef(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // Tournament controls load separately from the live poker engine.
  // A toolbar click must not silently fail while the script is loading.
  function openTournamentReliably(){
    const sheet=document.getElementById('tournamentSheet');
    const body=document.getElementById('tournamentBody');
    if(!sheet||!body)return;
    const opener=(window as any).openTournament;
    if(typeof opener==='function'){opener();return;}
    sheet.classList.add('open');
    body.textContent='Loading tournament controls…';
    let script=document.getElementById('pkr-tournament') as HTMLScriptElement|null;
    if(!script){
      script=document.createElement('script');
      script.id='pkr-tournament';script.src='/tournament.js';script.async=true;
      document.head.appendChild(script);
    }
    let complete=false;
    const done=(ok:boolean)=>{
      if(complete)return;complete=true;
      if(ok&&typeof (window as any).openTournament==='function'){
        (window as any).openTournament();
      }else{
        body.replaceChildren();
        const warning=document.createElement('p');
        warning.setAttribute('role','alert');
        warning.textContent='Tournament controls could not load. Check your connection and try again. Your game and player records are unchanged.';
        body.appendChild(warning);
        script?.remove();
      }
    };
    script.addEventListener('load',()=>done(true),{once:true});
    script.addEventListener('error',()=>done(false),{once:true});
    window.setTimeout(()=>done(typeof (window as any).openTournament==='function'),9000);
  }


  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Approved Theme A fonts are bundled once by RootLayout.

    // Get auth token
    const token = typeof window !== 'undefined'
      ? (localStorage.getItem('pkr_token') || document.cookie.match(/pkr_token=([^;]+)/)?.[1] || '')
      : '';

    // Never fall through to the production Worker from a preview build.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

    // Set pkrCtx for all legacy table.html code to use
    const existingCtx = (() => { try { return JSON.parse(localStorage.getItem('pkrCtx') || 'null'); } catch(e) { return null; } })();
    if (!existingCtx || existingCtx.gameId !== gameId) {
      // Fetch current user to get userId/userName
      fetch(`${apiUrl}/auth/me`, {
        credentials: 'include',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      }).then(r => r.json()).then(user => {
        const ctx = {
          gameId,
          eventId: existingCtx?.eventId || '',
          userId: user?.id || '',
          userName: user?.name || user?.display_name || '',
          token,
          apiUrl,
          settleKey: gameId + '_end',
        };
        localStorage.setItem('pkrCtx', JSON.stringify(ctx));
        bootTable();
      }).catch(() => {
        // Boot anyway with what we have
        const ctx = {
          gameId,
          eventId: existingCtx?.eventId || '',
          userId: existingCtx?.userId || '',
          userName: existingCtx?.userName || '',
          token,
          apiUrl,
          settleKey: gameId + '_end',
        };
        localStorage.setItem('pkrCtx', JSON.stringify(ctx));
        bootTable();
      });
    } else {
      // Already have ctx, just ensure token + apiUrl are fresh
      existingCtx.token = token;
      existingCtx.apiUrl = apiUrl;
      localStorage.setItem('pkrCtx', JSON.stringify(existingCtx));
      bootTable();
    }

    function bootTable() {
      // Also fetch game to get eventId if missing
      const ctx = (() => { try { return JSON.parse(localStorage.getItem('pkrCtx') || 'null'); } catch(e) { return null; } })();
      if (ctx && !ctx.eventId) {
        fetch(`${apiUrl}/games/${gameId}`, {
          credentials: 'include',
          headers: ctx.token ? { 'Authorization': `Bearer ${ctx.token}` } : {},
        }).then(r => r.json()).then(game => {
          if (game?.event_id) {
            ctx.eventId = game.event_id;
            localStorage.setItem('pkrCtx', JSON.stringify(ctx));
          }
        }).catch(() => {});
      }

      // The core table must boot regardless of optional third-party scripts.
      // QR codes are only needed when sharing; failure to load them must never
      // leave the poker table and its controls unusable.
      injectTableScript();
      if (!(window as any).QRCode && !document.getElementById('pkr-qr-lib')) {
        const qrScript = document.createElement('script');
        qrScript.id = 'pkr-qr-lib';
        qrScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        qrScript.async = true;
        qrScript.onerror = () => console.warn('PKR: optional QR library unavailable; table remains functional');
        document.head.appendChild(qrScript);
      }
      // The chip ledger never writes to game history or payment records.
      const oldLedger=document.getElementById('pkr-seat-stack-lib');
      if(oldLedger)oldLedger.remove();
      const ledgerScript=document.createElement('script');
      ledgerScript.id='pkr-seat-stack-lib';
      ledgerScript.src='/seat-stack-ledger.js?v=1';
      ledgerScript.onload=()=>{(window as any).refreshSeatStacks?.();(window as any).renderTable?.();};
      document.head.appendChild(ledgerScript);
      // Load hand tracker as separate static file (always reload to pick up updates)
      const existingHt = document.getElementById('pkr-hand-tracker');
      if (existingHt) existingHt.remove();
      const htScript = document.createElement('script');
      htScript.id  = 'pkr-hand-tracker';
      htScript.src = '/hand-tracker.js?v=' + Date.now();
      document.head.appendChild(htScript);
      // Load tournament.js
      if (!document.getElementById('pkr-tournament')) {
        const tScript = document.createElement('script');
        tScript.id  = 'pkr-tournament';
        tScript.src = '/tournament.js';
        tScript.onerror=()=>{console.warn('Tournament controls unavailable; retry from toolbar');tScript.remove();};
        document.head.appendChild(tScript);
      }
      // Load extras.js (rabbit hunt + seat randomiser)
      if (!document.getElementById('pkr-extras')) {
        const eScript = document.createElement('script');
        eScript.id  = 'pkr-extras';
        eScript.src = '/extras.js';
        document.head.appendChild(eScript);
      }
      if (!document.getElementById('handTrackerSheet')) {
        const d = document.createElement('div');
        d.id = 'htSheets';
        d.innerHTML = '<div class="sheet" id="handTrackerSheet"><div class="sheet-box" style="max-height:85vh;overflow:hidden;display:flex;flex-direction:column"><div class="sheet-hdr"><h2>🃏 Hand Tracker</h2><div style="display:flex;gap:6px;align-items:center"><button id="undoActionBtn" style="display:none;background:none;border:1px solid var(--border);color:var(--muted);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.75rem" onclick="window.htUndoAction&&window.htUndoAction()">↩ Undo</button><button style="background:none;border:1px solid var(--border);color:var(--muted);padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.75rem" onclick="window.toggleHandHistory&&window.toggleHandHistory()">History</button><button class="panel-close" onclick="window.closeHandTracker&&window.closeHandTracker()">✕</button></div></div><div class="sheet-body" id="handTrackerBody" style="overflow-y:auto;flex:1;padding:12px 16px"></div></div></div><div class="overlay" id="winnerOverlay"><div class="modal"><h2>🏆 Who won?</h2><div id="winnerPotLabel" style="font-size:0.85rem;color:var(--muted);margin-bottom:14px"></div><div id="winnerPlayerList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"></div><div class="modal-actions"><button class="btn-cancel" onclick="window.closeWinnerOverlay&&window.closeWinnerOverlay()">Cancel</button></div></div></div><div class="sheet" id="cardPickerSheet"><div class="sheet-box" style="width:min(720px,calc(100vw - 24px));max-height:85vh;overflow:hidden;display:flex;flex-direction:column;margin:6vh auto 0 auto"><div class="sheet-hdr"><h2 id="cardPickerTitle">Pick card</h2><button class="panel-close" onclick="window.closeCardPicker&&window.closeCardPicker()">✕</button></div><div class="sheet-body" id="cardPickerBody" style="padding:12px 16px;overflow-y:auto;flex:1"></div></div></div>';
        document.body.appendChild(d);
      }
    }

    function injectTableScript() {
      if (document.getElementById('pkr-table-script')) return;
      const s = document.createElement('script');
      s.id = 'pkr-table-script';
      s.textContent = getTableJS(gameId, router);
      document.body.appendChild(s);
    }

    return () => {
      // Cleanup on unmount
      const s = document.getElementById('pkr-table-script');
      if (s) s.remove();
      (window as any)._pkrTableCleanup?.();
    };
  }, [gameId]);

  return (
    <>
      <style>{getTableCSS()}</style>
      <style>{getPremiumTableCSS()}</style>
      <style>{getApprovedTableChromeCSS()}</style>

      {/* ── GAME SCREEN ── */}
      <div id="gameScreen" className="screen pkr-casino-live-table">
        <div className="topbar pkr-approved-topbar">
          <button className="tb-back" id="backBtn" aria-label="Back to room" onClick={() => {
            try {
              const c = JSON.parse(localStorage.getItem('pkrCtx') || 'null');
              if (c?.eventId) { window.location.href = '/events/' + c.eventId; return; }
            } catch(e) {}
            window.location.href = '/dashboard';
          }}><span aria-hidden="true">‹</span> <span className="pkr-brand-name">PKR</span></button>
          <div className="pkr-table-identity">
            <span className="pkr-table-identity-icon" aria-hidden="true">🃏</span>
            <span className="pkr-table-identity-copy">
              <span className="tb-title" id="topbarTitle">The Table</span>
              <span className="pkr-table-meta" id="topbarGameMeta" aria-live="off">Poker night</span>
              <span id="gameCodeBadge" style={{display:'none'}}></span>
            </span>
          </div>
          <div className="pkr-table-head-actions">
            <button className="pkr-tools-toggle" type="button" aria-expanded={toolsOpen}
              aria-haspopup="dialog" aria-label="Open table controls"
              onClick={() => { setToolsOpen(true); }} title="Table controls">
              <span aria-hidden="true">☷</span><span className="pkr-tools-label">Tools</span>
            </button>
          </div>
        </div>

        {/* One accessible, compact tools sheet. Sharing remains in the
            permanent bottom action dock: no duplicate header button. */}
        {toolsOpen&&<AppDialog className="pkr-table-tools-dialog" aria-label="Table controls"
            onDismiss={()=>setToolsOpen(false)}
            onMouseDown={e=>{if(e.target===e.currentTarget)setToolsOpen(false);}}>
          <div className="pkr-table-tools-sheet pkr-mockup-tools-sheet pkr-reference-tools" id="pkr-table-tools">
            <header className="pkr-table-tools-sheet-header">
              <div><span>POKER NIGHT</span><h2>Table controls</h2><p>Game tools</p></div>
              <button className="pkr-tools-close" type="button" aria-label="Close table controls" onClick={()=>setToolsOpen(false)}>×</button>
            </header>
            <div className="pkr-reference-tool-grid">
              <button id="trackHandsBtn" type="button" aria-label="Hand tracker" onClick={()=>{setToolsOpen(false);(window as any).toggleHandTracking?.();}}><span aria-hidden="true">♠</span><span>Hand<br/>Tracking</span></button>
              <button type="button" aria-label="Tournament" onClick={()=>{setToolsOpen(false);openTournamentReliably();}}><span aria-hidden="true">🏆</span><span>Tournament<br/>Controls</span></button>
              <button type="button" aria-label="Add seat" onClick={()=>{setToolsOpen(false);(window as any).addSeat?.();}}><span aria-hidden="true">♙+</span><span>Add<br/>Seat</span></button>
              <button type="button" aria-label="Remove empty seat" onClick={()=>{setToolsOpen(false);(window as any).removeSeat?.();}}><span aria-hidden="true">−</span><span>Remove<br/>Empty Seat</span></button>
              <button type="button" aria-label="Seat draw" onClick={()=>{setToolsOpen(false);(window as any).openSeatRandomiser?.();}}><span aria-hidden="true">🎲</span><span>Seat<br/>Draw</span></button>
              <button type="button" aria-label="Rabbit hunt" onClick={()=>{setToolsOpen(false);(window as any).openRabbitHunt?.();}}><span aria-hidden="true">🐇</span><span>Rabbit<br/>Hunt</span></button>
            </div>
            <div className="pkr-tools-reconciliation-note">Save Results becomes available after all cash-outs are recorded, the bank balances and synchronisation is clear.</div>
          </div>
        </AppDialog>}

        {/* Bank Bar */}
        <div className="bank-bar pkr-mockup-bank pkr-bank-quickbar" id="bankBar" role="button" tabIndex={0}
          aria-label="Toggle bank summary details" aria-expanded={false}
          onClick={() => (window as any).toggleBank?.()}
          onKeyDown={(e) => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); (window as any).toggleBank?.();}}}>
          <div className="pkr-bank-quick">
            <span className="pkr-bank-quick-item pkr-bank-count"><span className="bank-icon" aria-hidden="true"><img src="/images/casino/real-poker-chips.webp" alt="" /></span><small>Bank</small><strong id="bbBankQuick">$0</strong></span>
            <span className="pkr-bank-quick-divider" aria-hidden="true"></span>
            <span className="pkr-bank-quick-item pkr-bank-inplay-quick"><small>In Play</small><strong id="bbInPlay">$0</strong></span>
          </div>
          <strong id="bbTotal" className="pkr-bank-total pkr-bank-total-hidden">$0.00</strong>
          <div className="bank-right pkr-bank-detail-pills" aria-hidden="true">
            <span className="bank-pill g"><span className="pkr-bank-visual pkr-bank-in" aria-hidden="true">●</span><span className="pkr-bank-metric"><small>IN</small><b id="bbIn">$0</b></span></span>
            <span className="bank-pill pkr-bank-out"><span className="pkr-bank-visual pkr-bank-out-icon" aria-hidden="true">●</span><span className="pkr-bank-metric"><small>OUT</small><b id="bbOut">$0</b></span></span>
            <span className="bank-pill pkr-bank-current"><span className="pkr-bank-visual pkr-bank-balance" aria-hidden="true">●</span><span className="pkr-bank-metric"><small>BANK</small><b id="bbBank">$0</b></span></span>
          </div>
          <span className="bank-caret" aria-hidden="true">⌄</span>
        </div>
        <div className="bank-panel" id="bankPanel">
          <div className="bank-grid">
            <div className="bank-cell"><div className="bank-cell-lbl">↗ Total Buy-ins</div><div className="bank-cell-val pos" id="bcIn">$0.00</div></div>
            <div className="bank-cell"><div className="bank-cell-lbl">↘ Cash-outs</div><div className="bank-cell-val neg" id="bcOut">$0.00</div></div>
            <div className="bank-cell"><div className="bank-cell-lbl">💳 In Bank</div><div className="bank-cell-val" id="bcBank">$0.00</div><div className="bank-cell-sub" id="bcBankSub"></div></div>
            <div className="bank-cell"><div className="bank-cell-lbl">⚡ Status</div><div className="bank-cell-val" id="bcStatus">0 Active</div><div className="bank-cell-sub" id="bcStatusSub"></div></div>
          </div>
        </div>

        {/* Table + Side Panel */}
        <div style={{display:'flex',flex:1,overflow:'hidden',minHeight:0}}>
          <div className="table-area" id="tableArea"><div className="pkr-seat-summary" id="pkrSeatSummary" aria-label="Player balances" hidden></div>
            <div className="table-wrap" id="tableWrap">
              <div id="tableOuter"></div>
              <div id="tableFelt"><div id="tableCenter"><div id="tableName"></div><div id="tableStats"></div></div></div>
              <div id="seatsContainer"></div>
            </div>
          </div>
          <div className="side-panel" id="sidePanel">
            <div className="panel-hdr">
              <span className="panel-title" id="panelTitle">Player</span>
              <button className="panel-close" id="panelCloseBtn" onClick={() => (window as any).closePanel?.()}>✕</button>
            </div>
            <div className="panel-body" id="panelBody"></div>
          </div>
        </div>

        {/* Bottom Tab Bar */}
        <div className="game-tabs pkr-approved-game-dock" aria-label="Game actions">
          <button className="game-tab" id="publishBtn" onClick={() => (window as any).openPublish?.()}><span className="game-tab-icon" aria-hidden="true">⇧</span><span>Share</span></button>
          <button className="game-tab" id="lbInGameBtn" onClick={() => (window as any).openLeaderboard?.()}><span className="game-tab-icon" aria-hidden="true">🏆</span><span>Leaderboard</span></button>
          <button className="game-tab" id="settleBtn" onClick={() => (window as any).openSettleUp?.()}><span className="game-tab-icon" aria-hidden="true">💵</span><span>Settle Up</span></button>
          <button className="game-tab pkr-save-results-action" id="saveResultsBtn" onClick={() => (window as any).saveResultsToPkr?.()} style={{display:'none'}}><span className="game-tab-icon" aria-hidden="true">✅</span> Save Results</button>
          <button className="game-tab" id="handTrackerBtn" onClick={() => (window as any).openHandTracker?.()} style={{display:'none'}}><span className="game-tab-icon" aria-hidden="true">🃏</span><span>Hands</span></button>
          <button className="game-tab red" id="endGameBtn" onClick={() => (window as any).endGame?.()}><span className="game-tab-icon" aria-hidden="true">⚑</span><span>End Game</span></button>
        </div>
      </div>

      {/* ── ASSIGN OVERLAY ── */}
      <div className="overlay" id="assignOverlay">
        <div className="modal">
          <h2>Seat Player</h2>
          <div id="membersWrap" style={{display:'none',marginBottom:'14px'}}>
            <div style={{fontSize:'0.9rem',textTransform:'uppercase',letterSpacing:'2px',color:'var(--gold)',marginBottom:'8px'}}>👥 Members</div>
            <div id="membersList" style={{display:'flex',flexWrap:'wrap',gap:'6px'}}></div>
          </div>
          <div id="knownWrap" style={{display:'none',marginBottom:'14px'}}>
            <div style={{fontSize:'0.9rem',textTransform:'uppercase',letterSpacing:'2px',color:'var(--muted)',marginBottom:'8px'}}>Recent Players</div>
            <div id="knownList" style={{display:'flex',flexWrap:'wrap',gap:'6px'}}></div>
          </div>
          <div className="field"><label>Name</label><input type="text" id="assignName" placeholder="Enter name..." autoComplete="off" /></div>
          <div className="field">
            <label>WhatsApp (optional)</label>
            <div className="phone-row"><span className="phone-flag">🇦🇺</span><input type="tel" className="phone-inp" id="assignPhone" placeholder="04xx xxx xxx" /></div>
          </div>
          <div className="modal-actions">
            <button className="btn-cancel" onClick={() => (window as any).closeAssign?.()}>Cancel</button>
            <button className="btn-primary" onClick={() => (window as any).confirmAssign?.()}>Seat Player</button>
          </div>
        </div>
      </div>

      {/* ── LEADERBOARD SHEET ── */}
      <div className="sheet" id="lbSheet">
        <div className="sheet-box">
          <div className="sheet-hdr"><h2>🏆 Leaderboard</h2><button className="panel-close" onClick={() => (window as any).closeLbSheet?.()}>✕</button></div>
          <div className="sheet-tabs">
            <button className="sheet-tab" id="lbTabAll" onClick={() => (window as any).switchLbTab?.('all')}>All Time</button>
            <button className="sheet-tab active" id="lbTabGame" onClick={() => (window as any).switchLbTab?.('game')}>This Game</button>
          </div>
          <div className="sheet-body" id="lbBody"></div>
        </div>
      </div>

      {/* ── SHARE SHEET ── */}
      <div className="sheet" id="shareSheet">
        <div className="sheet-box">
          <div className="sheet-hdr"><h2>⬡ Share Live Table</h2><button className="panel-close" onClick={() => (window as any).closeShare?.()}>✕</button></div>
          <div className="sheet-body">
            <p style={{fontSize:'0.85rem',color:'var(--muted)',marginBottom:'14px',lineHeight:1.6}}>Players scan to watch live — read only.</p>
            <div className="qr-wrap"><canvas id="shareQR" style={{borderRadius:'4px',background:'#fff',padding:'6px'}}></canvas></div>
            <div id="shareUrlLabel" style={{fontSize:'0.9rem',color:'var(--green)',marginBottom:'4px',textAlign:'center'}}></div>
            <div className="qr-url" id="shareUrl"></div>
            <button className="btn-primary" style={{width:'100%',marginBottom:'8px'}} onClick={() => {
              const url = document.getElementById('shareUrl')?.textContent || '';
              (window as any).shareLink?.(url, 'Join The Table: ' + url);
            }}>📤 Share Link</button>
            <button className="btn-cancel" style={{width:'100%',marginBottom:'8px'}} onClick={() => {
              const url = document.getElementById('shareUrl')?.textContent || '';
              (window as any).copyText?.(url);
            }}>Copy Link</button>
            <button className="btn-cancel" style={{width:'100%'}} onClick={() => (window as any).closeShare?.()}>Close</button>
          </div>
        </div>
      </div>

      {/* ── PUBLISH SHEET ── */}

      {/* ── TOURNAMENT SHEET ── */}
      <div className="sheet" id="tournamentSheet">
        <div className="sheet-box">
          <div className="sheet-hdr"><h2>🏆 Tournament</h2><button className="panel-close" onClick={() => (window as any).closeTournament?.()}>✕</button></div>
          <div className="sheet-body" id="tournamentBody" style={{padding:'16px'}} suppressHydrationWarning></div>
        </div>
      </div>

      {/* ── RABBIT HUNT SHEET ── */}
      <div className="sheet" id="rabbitSheet">
        <div className="sheet-box">
          <div className="sheet-hdr"><h2>🐰 Rabbit Hunt</h2><button className="panel-close" onClick={() => (window as any).closeRabbitHunt?.()}>✕</button></div>
          <div className="sheet-body" id="rabbitBody" style={{padding:'16px'}} suppressHydrationWarning></div>
        </div>
      </div>

      {/* ── SEAT RANDOMISER SHEET ── */}
      <div className="sheet" id="seatSheet">
        <div className="sheet-box">
          <div className="sheet-hdr"><h2>🎲 Seat Draw</h2><button className="panel-close" onClick={() => (window as any).closeSeatRandomiser?.()}>✕</button></div>
          <div className="sheet-body" id="seatBody" style={{padding:'16px'}} suppressHydrationWarning></div>
        </div>
      </div>
      <div className="sheet" id="publishSheet">
        <div className="sheet-box">
          <div className="sheet-hdr"><h2>♠ Results</h2><button className="panel-close" onClick={() => (window as any).closePublish?.()}>✕</button></div>
          <div className="sheet-body">
            <div id="publishPreview" style={{background:'rgba(4,12,5,0.85)',border:'1px solid var(--border)',borderRadius:'8px',padding:'12px',marginBottom:'14px',fontSize:'0.9rem'}}></div>
            <button id="waGroupShareBtn" onClick={() => (window as any).sharePublishResults?.()} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'8px',background:'linear-gradient(135deg,#1e6b2a,#0f4a1a)',color:'#fff',padding:'13px',borderRadius:'10px',fontSize:'0.88rem',fontWeight:700,border:'none',cursor:'pointer',width:'100%',marginBottom:'10px'}}>
              <span style={{fontSize:'1.1rem'}}>📤</span> Share Results
            </button>
            <div style={{display:'flex',gap:'7px',marginBottom:'10px'}}>
              <button className="btn-primary" style={{flex:1}} onClick={() => {
                const url = (document.getElementById('publishUrl') as HTMLInputElement)?.value || '';
                (window as any).copyText?.(url);
              }}>Copy Link</button>
              <button className="btn-primary" style={{flex:1,background:'linear-gradient(135deg,#1a8a4a,#0f5a2e)'}} onClick={() => {
                const url = (document.getElementById('publishUrl') as HTMLInputElement)?.value || '';
                window.open(url, '_blank');
              }}>Preview</button>
            </div>
            <div className="field"><label>Shareable Results Link</label><input type="text" id="publishUrl" readOnly onClick={(e) => (e.target as HTMLInputElement).select()} style={{fontSize:'0.9rem',color:'var(--muted)'}} /></div>
          </div>
        </div>
      </div>

      {/* ── NOTIFICATION BANNER ── */}
      <div id="notifBanner" style={{display:'none',position:'fixed',bottom:'70px',left:0,right:0,zIndex:550,padding:'0 14px'}}>
        <div style={{background:'#09180a',border:'1px solid rgba(201,168,76,0.4)',borderRadius:'12px',padding:'14px 16px',display:'flex',alignItems:'center',gap:'12px',boxShadow:'0 8px 24px rgba(0,0,0,0.8)'}}>
          <div style={{fontSize:'1.4rem'}}>🔔</div>
          <div style={{flex:1}}>
            <div style={{fontSize:'0.82rem',fontWeight:700,color:'var(--cream)',marginBottom:'2px'}}>Enable Notifications</div>
            <div style={{fontSize:'0.82rem',color:'var(--muted)'}}>Get notified for buy-ins, cashouts & settlements</div>
          </div>
          <button id="notifEnableBtn" style={{background:'var(--gold)',color:'#000',border:'none',padding:'8px 14px',borderRadius:'8px',fontFamily:'DM Sans,sans-serif',fontSize:'0.88rem',fontWeight:700,cursor:'pointer'}}>Enable</button>
        </div>
      </div>


            {/* ── WA TOAST ── */}
      <div id="waToast">
        <div className="wa-toast-hdr">
          <span style={{fontSize:'1rem'}}>💬</span>
          <span className="wa-toast-label">WhatsApp Notification</span>
          <button className="wa-toast-close" onClick={() => (window as any).hideWaToast?.()}>✕</button>
        </div>
        <div className="wa-toast-msg" id="waToastMsg"></div>
        <div className="wa-toast-btns">
          <a className="wa-toast-send" id="waToastSend" href="#" target="_blank">📤 Send via WhatsApp</a>
          <button className="wa-toast-skip" onClick={() => (window as any).hideWaToast?.()}>Skip</button>
        </div>
      </div>

      {/* ── TOAST ── */}
      <div id="toast"></div>
    </>
  );
}

function getTableCSS() {
  return `
/* ── RESET & BASE ── */
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{width:100%;height:100%;overflow:hidden;background:#060e07;color:#f0e6c8;font-family:DM Sans,sans-serif;font-size:16px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
:root{
  --gold:#c9a84c;--gold2:#e8c96a;--gold-dim:#7a5820;
  --cream:#f0e6c8;--cream2:#d4c4a0;
  --green:#2ecc71;--red:#e74c3c;
  --felt-top:#1e6b2a;--felt-mid:#155220;--felt-bot:#0e3a18;
  --rail:#3d1f08;--rail2:#5a3010;
  --border:rgba(201,168,76,0.15);--border2:rgba(201,168,76,0.35);
  --muted:#6b8c6e;--bg:#060e07;--bg2:#0d1f10;--bg3:#111f13;
  --r:12px;--rs:8px;
  --display:'Playfair Display',serif;
  --body:'DM Sans',sans-serif;
}
.screen{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--bg);overflow:hidden}
.screen[hidden]{display:none!important}
/* topbar */
.topbar{flex:0 0 auto;display:flex;align-items:center;height:52px;background:var(--bg);border-bottom:1px solid var(--border)}
.tb-back{display:flex;align-items:center;gap:4px;padding:0 16px;height:100%;cursor:pointer;color:var(--gold);font-size:0.9rem;font-weight:500;border-right:1px solid var(--border);flex-shrink:0;background:none;border-top:none;border-bottom:none;border-left:none}
.tb-title{flex:1;font-family:var(--display);font-size:1.05rem;font-weight:700;color:var(--gold);padding:0 14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.share-btn{flex-shrink:0;background:#ef8976;color:#261512;border:none;padding:6px 12px;font-size:0.72rem;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;cursor:pointer;border-radius:6px;margin-right:10px}
/* bank */
.bank-bar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:46px;background:var(--bg);border-bottom:1px solid var(--border);cursor:pointer;gap:10px}
.bank-bar:active{background:rgba(201,168,76,0.03)}
.bank-left{display:flex;align-items:center;gap:10px;flex-shrink:0}
.bank-icon{width:28px;height:20px;border-radius:4px;background:#ef8976;display:flex;align-items:center;justify-content:center;font-size:0.78rem}
.bank-label{font-size:0.95rem;font-weight:600;color:var(--cream)}
.bank-right{display:flex;align-items:center;gap:8px;min-width:0}
.bank-pill{font-size:0.82rem;color:var(--muted);white-space:nowrap}
.bank-pill.g{color:var(--green)}
.bank-caret{font-size:0.6rem;color:var(--muted);transition:transform 0.25s;flex-shrink:0}
.bank-bar.open .bank-caret{transform:rotate(180deg)}
.bank-panel{flex:0 0 auto;overflow:hidden;max-height:0;transition:max-height 0.3s ease;background:var(--bg)}
.bank-panel.open{max-height:240px}
.bank-grid{display:grid;grid-template-columns:1fr 1fr;margin:12px;background:var(--bg2);border:1px solid rgba(201,168,76,0.14);border-radius:var(--r);overflow:hidden}
.bank-cell{padding:12px 14px;display:flex;flex-direction:column;gap:4px;background:#132b16}
.bank-cell:nth-child(1){border-bottom:1px solid rgba(201,168,76,0.07);border-right:1px solid rgba(201,168,76,0.07)}
.bank-cell:nth-child(2){border-bottom:1px solid rgba(201,168,76,0.07)}
.bank-cell:nth-child(3){border-right:1px solid rgba(201,168,76,0.07)}
.bank-cell-lbl{font-size:0.68rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted)}
.bank-cell-val{font-size:1.4rem;font-weight:700}
.bank-cell-sub{font-size:0.68rem;color:var(--muted)}
/* table */
.table-area{flex:1;position:relative;overflow:hidden;min-height:0}
.table-wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
#tableOuter{position:absolute;border-radius:36px;background:linear-gradient(135deg,var(--rail2),var(--rail));box-shadow:0 8px 40px rgba(0,0,0,0.7)}
#tableFelt{position:absolute;border-radius:28px;background:radial-gradient(ellipse at 50% 40%,var(--felt-top),var(--felt-mid) 55%,var(--felt-bot));display:flex;align-items:center;justify-content:center}
#tableCenter{text-align:center;z-index:1;padding:8px;pointer-events:none}
#tableName{font-family:var(--display);font-size:clamp(0.7rem,2vw,1rem);color:rgba(240,230,200,0.55);letter-spacing:2px;text-transform:uppercase}
#tableStats{font-size:clamp(0.6rem,1.5vw,0.75rem);color:rgba(235,228,220,0.48);margin-top:5px;letter-spacing:1px}
#seatsContainer{position:absolute;inset:0}
/* seats */
.seat{position:absolute;transform:translate(-50%,-50%);cursor:pointer;z-index:5;display:flex;flex-direction:column;align-items:center;gap:3px}
.seat-chip{width:clamp(36px,9vw,48px);height:clamp(36px,9vw,48px);border-radius:50%;border:2px solid rgba(201,168,76,0.25);background:#0d1a0f;display:flex;align-items:center;justify-content:center;transition:transform 0.15s}
.seat:active .seat-chip{transform:scale(0.88)}
.seat-chip.empty .seat-inner{font-size:clamp(1rem,2.5vw,1.2rem);color:rgba(201,168,76,0.3)}
.seat-chip.seated{border-color:var(--gold);border-width:2.5px;background:linear-gradient(135deg,#1a3a1a,#0d2010)}
.seat-chip.seated .seat-inner{font-size:clamp(0.72rem,2vw,0.88rem);font-weight:700;color:var(--cream)}
.seat-chip.cashed{border-color:rgba(46,204,113,0.5);background:linear-gradient(135deg,#0a2a1a,#061510)}
.seat-chip.cashed .seat-inner{font-size:clamp(0.72rem,2vw,0.88rem);font-weight:700;color:var(--green)}
.seat-chip.rsvp{border-color:rgba(201,168,76,0.4);background:rgba(201,168,76,0.06)}
.seat-label{font-size:clamp(0.75rem,2vw,0.9rem);font-weight:600;color:#fff;max-width:clamp(68px,16vw,96px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;background:rgba(0,0,0,0.6);padding:2px 7px;border-radius:5px;text-shadow:0 1px 3px rgba(0,0,0,0.9)}
.seat-net{font-size:clamp(0.62rem,1.6vw,0.78rem);font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.8)}
/* side panel */
.side-panel{width:0;overflow:hidden;background:#09180a;border-left:1px solid var(--border);display:flex;flex-direction:column;transition:width 0.25s ease;flex-shrink:0}
.side-panel.open{width:min(300px,80vw)}
.panel-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0}
.panel-title{font-family:var(--display);font-size:1.15rem;font-weight:700;color:var(--cream)}
.panel-close{background:none;border:none;color:var(--muted);font-size:1.3rem;cursor:pointer;padding:2px 6px;line-height:1}
.panel-body{flex:1;overflow-y:auto;padding:12px 14px}
.psec{font-size:0.68rem;text-transform:uppercase;letter-spacing:2px;color:var(--gold-dim);margin:14px 0 8px;padding-bottom:5px;border-bottom:1px solid rgba(201,168,76,0.08)}
.psec:first-child{margin-top:0}
/* player summary */
.p-sum{display:flex;align-items:center;gap:12px;padding:8px 0 14px;border-bottom:1px solid var(--border);margin-bottom:6px}
.p-av{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--gold-dim),var(--rail2));display:flex;align-items:center;justify-content:center;font-size:0.88rem;font-weight:700;color:var(--cream);flex-shrink:0}
.p-info{flex:1;min-width:0}
.p-name{font-size:1rem;font-weight:600;color:var(--cream);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p-meta{font-size:0.78rem;color:var(--muted);margin-top:3px}
.p-net{font-size:1.2rem;font-weight:700;white-space:nowrap}
/* transactions */
.tx-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04)}
.tx-badge{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.5px;padding:3px 7px;border-radius:4px;flex-shrink:0;white-space:nowrap;font-weight:600}
.tx-badge.bi{background:rgba(201,168,76,0.12);color:var(--gold)}
.tx-badge.co{background:rgba(46,204,113,0.12);color:var(--green)}
.tx-amt{background:transparent;border:none;border-bottom:1px solid rgba(201,168,76,0.2);color:var(--cream);font-size:0.95rem;width:72px;padding:2px 4px;outline:none;font-family:var(--body)}
.tx-amt:focus{border-bottom-color:var(--gold)}
.tx-time{font-size:0.72rem;color:var(--muted);flex:1}
.tx-del{background:none;border:none;color:rgba(231,76,60,0.35);cursor:pointer;font-size:1rem;padding:3px 2px;flex-shrink:0;line-height:1}
.tx-del:active{color:var(--red)}
/* add row */
.add-row{display:flex;gap:8px;margin-bottom:10px;align-items:center}
.add-inp{flex:1;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:11px 10px;font-size:1rem;border-radius:var(--rs);outline:none;min-width:0;font-family:var(--body)}
.add-inp:focus{border-color:var(--gold)}
.add-btn{background:linear-gradient(135deg,var(--gold),#8a5c20);color:#000;border:none;padding:11px 14px;font-size:0.82rem;font-weight:700;cursor:pointer;border-radius:var(--rs);white-space:nowrap;flex-shrink:0}
.add-btn.g{background:linear-gradient(135deg,#1a8a4a,#0f5a2e);color:#a0ffcc}
/* wa btn */
.wa-btn{display:flex;align-items:center;justify-content:center;gap:8px;background:#25D366;color:#fff;border:none;padding:11px;border-radius:var(--rs);font-size:0.9rem;font-weight:700;cursor:pointer;text-decoration:none;width:100%}
.wa-btn:active{opacity:0.8}
/* remove btn */
.remove-btn{width:100%;padding:11px;background:rgba(231,76,60,0.1);color:var(--red);border:1px solid rgba(231,76,60,0.2);border-radius:var(--rs);font-size:0.9rem;font-weight:600;cursor:pointer}
/* known chips */
.known-chip{background:var(--bg2);border:1px solid var(--border);color:var(--cream2);padding:7px 13px;border-radius:20px;font-size:0.88rem;cursor:pointer}
.known-chip:active{border-color:var(--gold);color:var(--gold)}
.known-chip.seated{opacity:0.4;pointer-events:none}
/* overlays */
.overlay{display:none;position:fixed;inset:0;z-index:50;background:rgba(0,0,0,0.75);align-items:center;justify-content:center;padding:20px}
.overlay.show{display:flex}
.modal{background:#0d1f10;border:1px solid var(--border2);border-radius:16px;padding:24px;width:100%;max-width:420px;max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.7)}
.modal h2{font-family:var(--display);font-size:1.35rem;font-weight:700;color:var(--gold);margin-bottom:20px}
.field{margin-bottom:14px}
.field label{display:block;font-size:0.72rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted);margin-bottom:6px;font-weight:600}
.field input,.field select{width:100%;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:11px 13px;font-size:1rem;border-radius:var(--rs);outline:none;font-family:var(--body)}
.field input:focus,.field select:focus{border-color:var(--gold)}
.modal-actions{display:flex;gap:10px;margin-top:20px;justify-content:flex-end}
.btn-primary{background:linear-gradient(135deg,var(--gold),#8a5c20);color:#000;border:none;padding:12px 22px;font-size:0.92rem;font-weight:700;cursor:pointer;border-radius:var(--rs)}
.btn-primary:active{opacity:0.8}
.btn-cancel{background:none;border:1px solid var(--border);color:var(--muted);padding:12px 18px;font-size:0.92rem;cursor:pointer;border-radius:var(--rs)}
.btn-cancel:active{border-color:var(--gold);color:var(--gold)}
/* sheet */
.sheet{display:none;position:fixed;inset:0;z-index:50;background:rgba(0,0,0,0.75);align-items:flex-end;justify-content:center}
.sheet.show{display:flex}
.sheet-box{background:#0d1f10;border-top:1px solid var(--border2);width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;border-radius:20px 20px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,0.5)}
.sheet-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border);flex-shrink:0}
.sheet-hdr h2{font-family:var(--display);font-size:1.2rem;font-weight:700;color:var(--cream)}
.sheet-body{overflow-y:auto;flex:1;padding:14px 18px 28px}
.sheet-tabs{display:flex;gap:8px;padding:12px 18px 0;flex-shrink:0}
.sheet-tab{flex:1;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:var(--rs);padding:9px;font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);cursor:pointer;text-align:center}
.sheet-tab.active{background:rgba(201,168,76,0.12);border-color:var(--gold);color:var(--gold)}
/* phone */
.phone-row{display:flex;gap:8px;align-items:center}
.phone-flag{font-size:1rem;flex-shrink:0}
.phone-inp{flex:1;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:11px 12px;font-size:1rem;border-radius:var(--rs);outline:none;font-family:var(--body)}
.phone-inp:focus{border-color:var(--gold)}
/* leaderboard */
.lb-row{display:flex;align-items:center;gap:12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;margin:0 0 8px}
.lb-row:first-child{border-color:rgba(201,168,76,0.35);background:#132a14}
.lb-rank{width:30px;text-align:center;font-size:0.9rem;font-weight:700;color:var(--muted);flex-shrink:0}
.lb-av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--gold-dim),var(--rail2));display:flex;align-items:center;justify-content:center;font-size:0.78rem;font-weight:700;color:var(--cream);flex-shrink:0}
.lb-info{flex:1}
.lb-name{font-size:1rem;font-weight:600;color:var(--cream)}
.lb-sub{font-size:0.78rem;color:var(--muted)}
.lb-net{font-size:1.1rem;font-weight:700}
.pos{color:var(--green)}.neg{color:var(--red)}.zero{color:var(--muted)}
/* settle */
.settle-row{display:flex;align-items:center;gap:12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;margin-bottom:10px;position:relative;overflow:hidden}
.settle-row::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--red),#8a1010)}
.settle-from{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:50px}
.settle-av{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;flex-shrink:0}
.settle-from .settle-av{background:linear-gradient(135deg,rgba(231,76,60,0.3),rgba(139,0,0,0.4));color:#ff9a8b;border:1px solid rgba(231,76,60,0.3)}
.settle-to .settle-av{background:linear-gradient(135deg,rgba(46,204,113,0.2),rgba(0,100,50,0.4));color:#7fffb0;border:1px solid rgba(46,204,113,0.25)}
.settle-nm{font-size:0.68rem;color:var(--muted);text-align:center;max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.settle-arrow{display:flex;flex-direction:column;align-items:center;flex:1;gap:5px}
.settle-arrow-line{font-size:1.2rem;color:var(--muted)}
.settle-amount{font-size:1.15rem;font-weight:700;color:var(--cream)}
.settle-to{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:50px}
.settle-wa{margin-left:auto;flex-shrink:0;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.3);color:#25D366;padding:7px 12px;border-radius:var(--rs);font-size:0.82rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;text-decoration:none}
.settle-clean{font-size:0.9rem;color:var(--green);padding:14px;text-align:center;background:rgba(46,204,113,0.06);border:1px solid rgba(46,204,113,0.2);border-radius:var(--rs)}
/* qr */
.qr-wrap{display:flex;justify-content:center;margin-bottom:14px}
.qr-url{font-size:0.78rem;color:var(--cream2);word-break:break-all;line-height:1.5;background:rgba(4,12,5,0.9);border:1px solid var(--border);border-radius:var(--rs);padding:10px 12px;margin-bottom:12px}
/* toast */
#toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(16px);background:#1a3a1a;color:var(--cream);padding:10px 20px;border-radius:24px;font-size:0.9rem;opacity:0;pointer-events:none;transition:all 0.25s;z-index:999;white-space:nowrap;border:1px solid rgba(201,168,76,0.2)}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
/* wa toast */
#waToast{display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:998;background:#0d1f10;border:1px solid rgba(37,211,102,0.4);border-radius:16px;padding:16px 18px;width:min(360px,92vw);box-shadow:0 8px 40px rgba(0,0,0,0.6)}
#waToast.show{display:block}
.wa-toast-hdr{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.wa-toast-label{font-size:0.72rem;text-transform:uppercase;letter-spacing:1.5px;color:rgba(37,211,102,0.8);flex:1}
.wa-toast-close{background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;line-height:1}
.wa-toast-msg{font-size:0.9rem;color:var(--cream2);line-height:1.6;background:rgba(0,0,0,0.3);border-radius:var(--rs);padding:11px 12px;margin-bottom:12px}
.wa-toast-btns{display:flex;gap:8px}
.wa-toast-send{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:#25D366;color:#fff;padding:11px;border-radius:var(--rs);font-size:0.9rem;font-weight:700;text-decoration:none;cursor:pointer}
.wa-toast-skip{background:none;border:1px solid rgba(201,168,76,0.15);color:var(--muted);padding:11px 16px;border-radius:var(--rs);font-size:0.9rem;cursor:pointer}
/* game tabs */
.game-tabs{flex-shrink:0;display:flex;border-top:1px solid var(--border);background:var(--bg);z-index:10}
.game-tab{flex:1;display:flex;flex-direction:column;align-items:center;padding:10px 0 14px;gap:3px;cursor:pointer;font-size:0.65rem;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);border:none;background:none;white-space:nowrap}
.sheet{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.75);display:none;align-items:flex-end;justify-content:center;padding:0 0 0 0}
.sheet.open{display:flex}
.sheet-box{width:100%;max-width:520px;background:#09180a;border:1px solid rgba(201,168,76,0.25);border-radius:16px 16px 0 0;max-height:85vh;overflow:hidden;display:flex;flex-direction:column}
.sheet-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(201,168,76,0.15);flex-shrink:0}
.sheet-hdr h2{font-family:'Playfair Display',serif;font-size:1.1rem;color:var(--gold);font-weight:700;margin:0}
.sheet-body{flex:1;overflow-y:auto}
.overlay{position:fixed;inset:0;z-index:250;background:rgba(0,0,0,0.85);display:none;align-items:center;justify-content:center;padding:20px}
.overlay.open{display:flex}
.game-tab:active{color:var(--gold);background:rgba(201,168,76,0.04)}
.game-tab.red:active{color:var(--red)}
.game-tab-icon{font-size:1.3rem;line-height:1}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
`;
}

function getTableJS(gameId: string, router: any) {
  return `
(function() {
'use strict';

// ── Storage keys scoped to game/user ──
var _ctx = null;
try { _ctx = JSON.parse(localStorage.getItem('pkrCtx') || 'null'); } catch(e) {}
if (!_ctx || !_ctx.gameId) { window.location.href = '/dashboard'; return; }
var SK      = 'pokerState_'   + _ctx.gameId + '_' + (_ctx.userId || 'host');
var HIST_K  = 'pokerHistory_' + _ctx.gameId + '_' + (_ctx.userId || 'host');
var PHONE_K = 'pokerPhones_'  + (_ctx.eventId || _ctx.gameId);
var _pkrSeatLayoutKey='pkrSeatLayout_'+_ctx.gameId;
var _pkrSavedLayout=localStorage.getItem(_pkrSeatLayoutKey);
if(_pkrSavedLayout==='full')_pkrSavedLayout='balanced';
var _pkrSeatLayout=_pkrSavedLayout==='compact'?'compact':'auto';
function pkrResolveSeatLayout(){
  if(_pkrSeatLayout==='compact')return 'compact';
  if(_pkrSeatLayout==='balanced')return 'balanced';
  var w=Math.max(document.documentElement.clientWidth||0,window.innerWidth||0);
  var h=Math.max(document.documentElement.clientHeight||0,window.innerHeight||0);
  if(w<350||(w<900&&h<w))return 'compact';
  return 'balanced';
}
window.pkrGetResolvedSeatLayout=pkrResolveSeatLayout;
window.pkrSetSeatLayout=function(mode){
  if(mode!=='auto'&&mode!=='balanced'&&mode!=='compact')return;
  _pkrSeatLayout=mode;localStorage.setItem(_pkrSeatLayoutKey,mode);renderTable();
};
var _pkrViewportTimer=0;
function _pkrHandleViewportChange(){
  clearTimeout(_pkrViewportTimer);
  _pkrViewportTimer=setTimeout(function(){if(state&&state.game)renderTable();},120);
}
window.addEventListener('resize',_pkrHandleViewportChange);
window.addEventListener('orientationchange',_pkrHandleViewportChange);
function pkrAvatar(p){
  var members=window._eventMembers||[],id=p.userId||p.user_id;
  var member=id?members.find(function(m){return m.id===id;}):null;
  if(!member&&p.name){var same=members.filter(function(m){return String(m.name||'').toLowerCase()===String(p.name).toLowerCase();});if(same.length===1)member=same[0];}
  var url=member&&member.avatar_url;
  if(typeof url!=='string')url='';
  if(url&&!(url.startsWith('/')&&!url.startsWith('//'))){try{var parsed=new URL(url);if(parsed.protocol!=='https:')url='';}catch(e){url='';}}
  return url?'<img class="pkr-seat-photo" src="'+esc(url).replace(/\"/g,'&quot;').replace(/'/g,'&#39;')+'" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.removeAttribute(String.fromCharCode(115,116,121,108,101))"><span class="pkr-avatar-fallback" style="display:none">'+esc(inits(p.name))+'</span>':
    '<span class="pkr-avatar-fallback">'+esc(inits(p.name))+'</span>';
}

// ── Rebuild display-only transaction rows from authoritative integer cents ──
// D1 stores buy-in COUNT and TOTAL, not individual bank transaction amounts.
// Do not divide total by count: 325/12 yields fictitious $27.083333 banks.
// Reconstructed mixed-value banks are estimates and must be clearly labelled.
function pkrBuildBankTransactions(player, defaultDollars) {
  var count = Number(player.buy_ins || 0);
  var unitCents = Math.round(Number(defaultDollars || 0) * 100);
  if (!Number.isSafeInteger(count) || count < 0 || count > 10000 ||
      !Number.isSafeInteger(unitCents) || unitCents <= 0) return [];
  if (count === 0) return [];
  var storedCents = player.buy_in_total;
  var totalCents = Number.isSafeInteger(storedCents) && storedCents > 0
    ? storedCents : count * unitCents;
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) return [];
  var exact = totalCents === count * unitCents;
  var remaining = totalCents - (count - 1) * unitCents;
  var cents = [];
  if (remaining > 0) {
    for (var i = 0; i < count - 1; i++) cents.push(unitCents);
    cents.push(remaining);
  } else {
    var even = Math.floor(totalCents / count);
    var extra = totalCents % count;
    for (var j = 0; j < count; j++) cents.push(even + (j < extra ? 1 : 0));
  }
  return cents.map(function(value, index) {
    return {
      type: 'buyin', amount: value / 100,
      ts: Date.now() - (count - index - 1) * 60000,
      pkrReconstructed: true,
      pkrEstimated: !exact
    };
  });
}

// Repair ONLY an unmistakable old local 'average' placeholder (fractional cents).
// Retain real cash-outs, edits and queued financial changes. Never write money
// to D1 during hydration or infer a transaction history as factual.
function pkrRepairLegacyAveragedBanks(local, server, unit) {
  if (!local || !Array.isArray(local.transactions)) return false;
  var oldBanks = local.transactions.filter(function(tx){ return tx.type !== 'cashout'; });
  if (!oldBanks.length || oldBanks.length !== server.buy_ins) return false;
  var first = Number(oldBanks[0].amount);
  if (!Number.isFinite(first) || first <= 0) return false;
  var isOldAverage = oldBanks.every(function(tx){
    return !tx.pkrReconstructed && Number.isFinite(Number(tx.amount)) &&
      Math.abs(Number(tx.amount) - first) < 0.00001;
  }) && Math.abs(first * 100 - Math.round(first * 100)) > 0.00001;
  if (!isOldAverage) return false;
  var replacement = pkrBuildBankTransactions(server, unit);
  if (replacement.length !== oldBanks.length) return false;
  var index = 0;
  local.transactions = local.transactions.map(function(tx) {
    if (tx.type === 'cashout') return tx;
    var clean = replacement[index++];
    return Object.assign({}, tx, {amount:clean.amount,
      pkrReconstructed:true, pkrEstimated:clean.pkrEstimated});
  });
  return true;
}

// ── State ──
var state = { game: null, players: {} };
window.state = state;

function loadState() {
  try {
    var s = localStorage.getItem(SK);
    if (s) { var p = JSON.parse(s); state.game = p.game || null; state.players = p.players || {}; window.state = state; }
  } catch(e) {}
}
function saveState() { localStorage.setItem(SK, JSON.stringify(state)); }
window.saveState = saveState;

// ── PKR API helper ──
function getPkrCtx() { try { return JSON.parse(localStorage.getItem('pkrCtx') || 'null'); } catch(e) { return null; } }
window.getPkrCtx = getPkrCtx;

async function pkrApi(path, opts) {
  var ctx = getPkrCtx();
  if (!ctx) return null;
  var res = await fetch(ctx.apiUrl + path, Object.assign({}, opts, {
    credentials: 'include',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      ctx.token ? { 'Authorization': 'Bearer ' + ctx.token } : {},
      (opts && opts.headers) ? opts.headers : {}
    ),
  }));
  if (!res.ok) {
    var e = await res.json().catch(function(){ return {}; });
    var err = new Error(e.error || String(res.status));
    err.status = res.status;
    err.code = e.code || null;
    err.current = e.current || null;
    throw err;
  }
  return res.json();
}
window.pkrApi = pkrApi;

// ── Sync to PKR: seat + buyin + cashout ──
var _pkrSeatedPlayers = {};
var _pkrLastSnapshot = {};
function pkrVersioned(body,player){
  if(player && Number.isSafeInteger(player.revision))
    body.expected_revision=player.revision;
  return body;
}
// A successful financial request advances its player's D1 revision.
// Update any remaining queued edit to use that new baseline BEFORE journaling.
function pkrApplyAckRevision(action,response){
  if(!action||!response||!Number.isSafeInteger(response.revision))return;
  var match=action.url.match(new RegExp('/(?:buyin|cashout)/([^/]+)$'));
  if(!match)return;
  var uid=decodeURIComponent(match[1]);
  Object.keys(_pkrSeatedPlayers).forEach(function(sid){
    if(_pkrSeatedPlayers[sid].user_id===uid)
      _pkrSeatedPlayers[sid].revision=response.revision;
  });
  _offlineQueue.forEach(function(next){
    if(next.id===action.id||!next.url.endsWith('/'+uid)||
       !(next.url.includes('/buyin/') || next.url.includes('/cashout/'))||!next.options.body)return;
    try{
      var body=JSON.parse(next.options.body);
      body.expected_revision=response.revision;
      next.options.body=JSON.stringify(body);
    }catch(e){ /* malformed edits remain pending for review */ }
  });
}


// ── Offline action queue ──
var OFFLINE_Q_KEY = 'pkr_pending_v2_' + _ctx.gameId + '_' + (_ctx.userId || 'host');
function restorePendingActions() {
  try {
    var raw = JSON.parse(localStorage.getItem(OFFLINE_Q_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(function(a) {
      return a && typeof a.id === 'string' && typeof a.url === 'string' &&
        a.url.indexOf('/games/' + _ctx.gameId + '/') === 0 &&
        a.options && ['POST','PUT','DELETE'].indexOf(a.options.method) >= 0 &&
        typeof a.key === 'string';
    }).slice(-200);
  } catch(e) { return []; }
}
var _offlineQueue = restorePendingActions();
var CONFLICT_KEY = 'pkr_pending_conflict_v1_' + _ctx.gameId + '_' + (_ctx.userId || 'host');
var _storedConflict = null;
try { _storedConflict = JSON.parse(localStorage.getItem(CONFLICT_KEY) || 'null'); } catch(e) {}
var _isOnline = navigator.onLine;
var _flushingQueue = false;
var _activeQueueId = null;
var _syncConflict = !!(_storedConflict && _offlineQueue.some(function(a){return a.id===_storedConflict.actionId;}));
var _syncConflictActionId = _syncConflict ? _storedConflict.actionId : null;
var _syncConflictCode = _syncConflict ? _storedConflict.code : null;
var _syncError = _syncConflict
  ? 'CONFLICT: An edit needs review. Select this warning to compare the local and saved records.'
  : '';

function markSyncConflict(error, actionId) {
  _syncConflict = true;
  _syncConflictActionId = actionId || (_offlineQueue[0] && _offlineQueue[0].id) || null;
  _syncConflictCode = error && error.code || 'EDIT_CONFLICT';
  _syncError = 'CONFLICT: Unsynced edits are retained. Select this warning to review before settling.';
  try { localStorage.setItem(CONFLICT_KEY,JSON.stringify({
    actionId:_syncConflictActionId,code:_syncConflictCode,
  })); } catch(e) { /* pending journal remains in memory */ }
}

function clearSyncConflict() {
  _syncConflict = false;
  _syncConflictActionId = null;
  _syncConflictCode = null;
  _syncError = '';
  try { localStorage.removeItem(CONFLICT_KEY); } catch(e) {}
}

function savePendingActions() {
  try {
    if (_offlineQueue.length) localStorage.setItem(OFFLINE_Q_KEY, JSON.stringify(_offlineQueue));
    else {
      localStorage.removeItem(OFFLINE_Q_KEY);
      localStorage.removeItem(CONFLICT_KEY);
    }
    return true;
  } catch(e) {
    _syncError = 'Browser storage is unavailable. Do not close or refresh until your changes are saved.';
    showConnBanner();
    return false;
  }
}

function showConnBanner() {
  var existing = document.getElementById('conn-banner');
  if (!_syncError && _isOnline && _offlineQueue.length === 0) {
    if (existing) existing.remove();
    return;
  }
  var b = existing || document.createElement('div');
  b.id = 'conn-banner';
  b.style.cssText = 'position:fixed;top:56px;left:0;right:0;background:#92400e;color:#fff;text-align:center;font-size:13px;padding:8px;z-index:9999;font-family:var(--font-body),sans-serif';
  b.textContent = (_syncError ||
    (!_isOnline
      ? 'Offline: changes saved on this device; reconnect to sync'
      : 'Unsynced changes: ' + _offlineQueue.length + ' operation(s) pending')) +
      (_syncConflict ? '  |  Review pending change' : '');
  b.style.cursor = _syncConflict ? 'pointer' : 'default';
  b.tabIndex = _syncConflict ? 0 : -1;
  b.onclick = _syncConflict ? function() { window.pkrReviewPendingEdits(); } : null;
  b.onkeydown = _syncConflict ? function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.pkrReviewPendingEdits(); }
  } : null;
  if (!existing) document.body.appendChild(b);
}

function queueAction(url, options, seatSid, seatName) {
  var method = (options && options.method || '').toUpperCase();
  var prefix = '/games/' + _ctx.gameId + '/';
  var route = url.indexOf(prefix) === 0 ? url.slice(prefix.length) : '';
  // Incremental POST money updates and arbitrary game mutations cannot
  // safely be replayed after a tab close or connectivity failure.
  var safe = (method === 'POST' && route === 'seat') ||
    (method === 'DELETE' && route.startsWith('seat/') && route.slice(5).length > 0) ||
    (method === 'PUT' && (route.startsWith('buyin/') || route.startsWith('cashout/')) && route.split('/').length === 2);
  if (!safe) {
    throw new Error('Only game-specific, retry-safe changes can be queued');
  }
  var key = method + ':' + url + (seatSid ? ':' + seatSid : '');
  var pending = _offlineQueue.find(function(a){return a.key===key && a.id!==_activeQueueId;});
  var active = _offlineQueue.find(function(a){return a.key===key && a.id===_activeQueueId;});
  var body = options.body || null;
  if (method === 'PUT' && (url.includes('/buyin/') || url.includes('/cashout/')) && body) {
    var next = JSON.parse(body);
    var predecessor = pending || active;
    if (predecessor) {
      var prior = JSON.parse(predecessor.options.body);
      // Preserve the original expected balance when coalescing offline edits.
      // If the earlier write is in-flight, its successor expects its new value.
      if (url.indexOf('/buyin/') >= 0) {
        next.expected_count = pending ? prior.expected_count : prior.count;
        next.expected_total = pending ? prior.expected_total : prior.total;
      } else {
        next.expected_cashout = pending ? prior.expected_cashout : prior.cashout;
      }
      if(pending&&Number.isSafeInteger(prior.expected_revision))
        next.expected_revision=prior.expected_revision;
      body = JSON.stringify(next);
    }
  }
  var action = {
    id:String(Date.now())+'-'+Math.random().toString(36).slice(2),
    key:key,url:url,options:{method:method,body:body},
    seatSid:seatSid||null,seatName:seatName||null,
  };
  _offlineQueue = _offlineQueue.filter(function(a){
    return a.key !== key || a.id===_activeQueueId;
  });
  _offlineQueue.push(action);
  if (!savePendingActions()) {
    // Keep the action in RAM, but NEVER dispatch it without a durable journal.
    var failure = new Error('Change not sent: browser storage could not save recovery data.');
    failure.code = 'LOCAL_STORAGE_UNAVAILABLE';
    throw failure;
  }
  showConnBanner();
  return action;
}

function queueLatestSeatAmounts(sid, playerId, expectedName, serverPlayer) {
  var current = _pkrSnapshotPlayers()[sid];
  if (!current || current.name !== expectedName) return;
  var base = '/games/' + _ctx.gameId;
  queueAction(base + '/buyin/' + playerId, {
    method:'PUT', body:JSON.stringify(pkrVersioned({
      count: current.buyins,
      total: Math.round(current.biTotal * 100),
      expected_count: serverPlayer && Number.isSafeInteger(serverPlayer.buy_ins) ? serverPlayer.buy_ins : 0,
      expected_total: serverPlayer && Number.isSafeInteger(serverPlayer.buy_in_total) ? serverPlayer.buy_in_total : 0,
    },serverPlayer)),
  });
  queueAction(base + '/cashout/' + playerId, {
    method:'PUT', body:JSON.stringify(pkrVersioned({
      cashout: current.hadCashout ? Math.round(current.cashout * 100) : null,
      expected_cashout: serverPlayer && serverPlayer.cashout != null ? serverPlayer.cashout : null,
    },serverPlayer)),
  });
}

// An explicit manual retry still uses the server's conditional write guards.
// This only constructs a NEW expected-value baseline; it never sends a request.
function prepareConflictRetry(action, game) {
  if (!action || !action.options || !game || !Array.isArray(game.players) ||
      game.status === 'settled' || game.status === 'cancelled') return null;
  var body;
  try { body = JSON.parse(action.options.body || '{}'); } catch(e) { return null; }
  var prefix = '/games/' + _ctx.gameId + '/';
  if (action.url.indexOf(prefix) !== 0) return null;
  var path = action.url.slice(prefix.length);
  var parts = path.split('/');
  var player = null;
  var next = Object.assign({},body);
  var formatted = function(cents) {
    return cents == null ? 'not entered' : '$' + (cents / 100).toFixed(2);
  };
  var result = {canApply:false,reason:'This edit requires manual correction on the table.',
    player:'',type:'Edit',server:'',pending:'',nextBody:next};

  if (action.options.method === 'PUT' && parts[0] === 'buyin' && parts.length === 2) {
    player = game.players.find(function(p){return p.user_id === parts[1];});
    if (!player) return result;
    next.expected_count = player.buy_ins || 0;
    next.expected_total = player.buy_in_total || 0;
    if(Number.isSafeInteger(player.revision))next.expected_revision=player.revision;
    result.player = player.display_name;
    result.type = 'Buy-ins';
    result.server = String(next.expected_count) + ' buy-ins, ' + formatted(next.expected_total);
    result.pending = String(body.count) + ' buy-ins, ' + formatted(body.total);
    result.canApply = true;
  } else if (action.options.method === 'PUT' && parts[0] === 'cashout' && parts.length === 2) {
    player = game.players.find(function(p){return p.user_id === parts[1];});
    if (!player) return result;
    next.expected_cashout = player.cashout == null ? null : player.cashout;
    if(Number.isSafeInteger(player.revision))next.expected_revision=player.revision;
    result.player = player.display_name;
    result.type = 'Cash-out';
    result.server = formatted(next.expected_cashout);
    result.pending = formatted(body.cashout);
    result.canApply = true;
  } else if (action.options.method === 'POST' && path === 'seat') {
    player = game.players.find(function(p){return p.display_name === body.display_name;});
    var target = body.seat_number == null ? null : body.seat_number;
    var occupied = target !== null && game.players.some(function(p) {
      return p.seat_number === target && p.display_name !== body.display_name;
    });
    result.player = body.display_name || 'Player';
    result.type = 'Seat assignment';
    result.server = player ? (player.seat_number == null ? 'Unassigned' : 'Seat '+player.seat_number)
      : 'Not yet registered';
    result.pending = target == null ? 'Unassigned' : 'Seat ' + target;
    if (player) next.expected_seat_number = player.seat_number == null ? null : player.seat_number;
    result.canApply = !occupied;
    if (occupied) result.reason = 'That seat is now occupied. Choose another seat in the table.';
  } else if (action.options.method === 'DELETE' && parts[0] === 'seat' && parts.length === 2) {
    player = game.players.find(function(p){return p.user_id === parts[1];});
    result.player = player ? player.display_name : 'Removed player';
    result.type = 'Remove player';
    result.server = player ? (player.seat_number == null ? 'Unassigned' : 'Seat '+player.seat_number)
      : 'Already removed';
    result.pending = 'Remove from the table';
    if (player) next.expected_seat_number = player.seat_number == null ? null : player.seat_number;
    var hasMoney = player && (player.buy_ins > 0 || player.buy_in_total > 0 ||
      player.cashout != null || player.net != null || player.settled_at != null);
    result.canApply = !hasMoney;
    if (hasMoney) result.reason = 'This player has financial records and cannot be removed.';
  }
  result.nextBody = next;
  return result;
}

// "Keep saved value" must reconcile BOTH local table state and the persistent
// offline journal. Dropping a journal entry alone would leave stale local money
// on screen and allow it to be queued again on a later table edit.
function keepServerFinancialEdit(action, game) {
  if (_flushingQueue || !action || !game || !Array.isArray(game.players)) {
    return {ok:false,error:'Game or sync state is not ready for reconciliation.'};
  }
  if (!_offlineQueue.some(function(entry){return entry.id===action.id;})) {
    return {ok:false,error:'This pending edit has changed. Review the warning again.'};
  }
  var prefix='/games/'+_ctx.gameId+'/';
  if (!action.url || action.url.indexOf(prefix)!==0 ||
      !action.options || action.options.method!=='PUT') {
    return {ok:false,error:'Only financial value conflicts can be resolved this way.'};
  }
  var parts=action.url.slice(prefix.length).split('/');
  var kind=parts[0],userId=parts[1];
  if (parts.length!==2 || ['buyin','cashout'].indexOf(kind)<0) {
    return {ok:false,error:'This change requires a manual table correction.'};
  }
  var player=game.players.find(function(p){return p.user_id===userId;});
  if (!player) return {ok:false,error:'Player no longer exists on the server.'};
  var matches=Object.keys(_pkrSeatedPlayers).filter(function(sid) {
    var linked=_pkrSeatedPlayers[sid];
    return linked && linked.user_id===userId && state &&
      state.players && state.players[sid] &&
      state.players[sid].name===player.display_name;
  });
  // Only reconcile a uniquely identified player, never a guessed seat.
  if (matches.length!==1) {
    return {ok:false,error:'Cannot safely match the server player to one local seat. Keep this edit pending.'};
  }
  var sid=matches[0],local=state.players[sid];
  if (!Array.isArray(local.transactions)) {
    return {ok:false,error:'Local transaction history is unavailable.'};
  }
  var pending;
  try { pending=JSON.parse(action.options.body||'{}'); }
  catch(e) { return {ok:false,error:'Pending financial record is invalid.'}; }
  var originals=local.transactions;
  var buyins=originals.filter(function(t){return t.type!=='cashout';});
  var cashouts=originals.filter(function(t){return t.type==='cashout';});
  var replacement;
  if (kind==='buyin') {
    if (!Number.isSafeInteger(player.buy_ins) || player.buy_ins<0 ||
        player.buy_ins>500 || !Number.isSafeInteger(player.buy_in_total) ||
        player.buy_in_total<0 || (player.buy_ins===0 && player.buy_in_total!==0)) {
      return {ok:false,error:'Server buy-in figures cannot be reconstructed safely.'};
    }
    var localTotal=Math.round(buyins.reduce(function(n,t){return n+(t.amount||0);},0)*100);
    if (buyins.length!==pending.count || localTotal!==pending.total) {
      return {ok:false,error:'Local buy-ins changed after this edit was queued. Review again.'};
    }
    var perBuyin=player.buy_ins ? player.buy_in_total/(100*player.buy_ins) : 0;
    replacement=Array.from({length:player.buy_ins},function(_,i) {
      return {type:'buyin',amount:perBuyin,
        ts:buyins[i] && buyins[i].ts || Date.now()-i*60000};
    }).concat(cashouts);
  } else {
    if (player.cashout!==null &&
        (!Number.isSafeInteger(player.cashout) || player.cashout<0)) {
      return {ok:false,error:'Server cash-out amount cannot be reconstructed safely.'};
    }
    var localCashout=cashouts.length ?
      Math.round(cashouts.reduce(function(n,t){return n+(t.amount||0);},0)*100) : null;
    if (localCashout!==pending.cashout) {
      return {ok:false,error:'Local cash-out changed after this edit was queued. Review again.'};
    }
    replacement=buyins.concat(player.cashout===null ? [] : [{
      type:'cashout',amount:player.cashout/100,
      ts:cashouts[0] && cashouts[0].ts || Date.now(),
    }]);
  }
  var previousQueue=_offlineQueue;
  var previousSnapshot=_pkrLastSnapshot;
  try {
    local.transactions=replacement;
    // Save without invoking window.saveState(), which would enqueue more writes.
    _origSaveState();
    _offlineQueue=_offlineQueue.filter(function(entry){return entry.id!==action.id;});
    if (!savePendingActions()) {
      _offlineQueue=previousQueue;
      local.transactions=originals;
      try { _origSaveState(); } catch(e) {}
      return {ok:false,error:'Browser storage failed. The pending edit was retained.'};
    }
    _pkrLastSnapshot=_pkrSnapshotPlayers();
    clearSyncConflict();
    if (typeof renderTable==='function') renderTable();
    return {ok:true};
  } catch(e) {
    _offlineQueue=previousQueue;
    local.transactions=originals;
    _pkrLastSnapshot=previousSnapshot;
    try { _origSaveState(); } catch(ignore) {}
    return {ok:false,error:'Could not persist the saved values locally. The pending edit remains.'};
  }
}

async function flushOfflineQueue() {
  if (_flushingQueue || _syncConflict || _offlineQueue.length === 0 || !navigator.onLine) return;
  // Check that every pending operation is durable BEFORE any replay begins.
  if (!savePendingActions()) return;
  _flushingQueue = true;
  _syncError = '';
  try {
    var game = await pkrApi('/games/' + _ctx.gameId);
    if (!game || game.status === 'settled' || game.status === 'cancelled') {
      _syncError = 'Game is closed. Pending changes were NOT applied; review them before proceeding.';
      return;
    }
    while (_offlineQueue.length && navigator.onLine) {
      var action = _offlineQueue[0];
      // If a seat was removed locally while offline, never replay stale seating.
      if (action.seatSid && action.seatName) {
        var live = _pkrSnapshotPlayers()[action.seatSid];
        if (!live || live.name !== action.seatName) {
          _offlineQueue = _offlineQueue.filter(function(x){return x.id !== action.id;});
          savePendingActions();
          continue;
        }
      }
      _activeQueueId = action.id;
      var response = await pkrApi(action.url, action.options);
      _activeQueueId = null;
      _offlineQueue = _offlineQueue.filter(function(x){return x.id !== action.id;});
      pkrApplyAckRevision(action,response);
      savePendingActions();
      // The seat has its real server-generated user ID now. Reconcile the
      // CURRENT local amounts, including changes made after the seat was queued.
      if (action.seatSid && response && Array.isArray(response.players)) {
        var player = response.players.find(function(p){
          return p.display_name === action.seatName;
        });
        if (player && player.user_id) {
          _pkrSeatedPlayers[action.seatSid] = {
            user_id:player.user_id,name:action.seatName,seat_number:player.seat_number,
            buy_ins:player.buy_ins,buy_in_total:player.buy_in_total,cashout:player.cashout,
          revision:player.revision,
          };
          queueLatestSeatAmounts(action.seatSid, player.user_id, action.seatName, player);
        }
      }
    }
    if (_offlineQueue.length === 0) loadGameFromPkr();
  } catch(e) {
    console.warn('Pending game sync failed; edits are retained locally:', e);
    if (e && ['EDIT_CONFLICT','PRECONDITION_REQUIRED','REVISION_UNAVAILABLE','SEAT_CONFLICT','PLAYER_HAS_HISTORY','HAND_ACTIVE'].indexOf(e.code) >= 0) {
      markSyncConflict(e,_activeQueueId || (typeof inflight !== 'undefined' && inflight && inflight.id));
    } else if (e && e.code === 'LOCAL_STORAGE_UNAVAILABLE') {
      _syncError = 'Browser storage unavailable. Pending edits are not safe to retry. Keep this tab open.';
    } else {
      _syncError = 'Sync paused. Changes remain on this device. Check your connection or reload the game status.';
    }
  } finally {
    _activeQueueId = null;
    _flushingQueue = false;
    showConnBanner();
  }
}

async function pkrApiQueued(url, options, seatSid, seatName) {
  if (!_isOnline || _flushingQueue || _offlineQueue.length > 0) {
    queueAction(url, options, seatSid, seatName);
    if (_isOnline && !_flushingQueue) flushOfflineQueue();
    return null;
  }

  // Persist BEFORE dispatching the request, not only on network errors.
  // A tab closing while the HTTP request is in flight must leave a recoverable
  // journal entry. Exact PUTs and idempotent seat retries are replay-safe.
  var inflight = queueAction(url, options, seatSid, seatName);
  _activeQueueId = inflight.id;
  _flushingQueue = true;
  var acknowledged = false;
  var result = null;
  try {
    result = await pkrApi(inflight.url, inflight.options);
    _offlineQueue = _offlineQueue.filter(function(a){return a.id !== inflight.id;});
    pkrApplyAckRevision(inflight,result);
    savePendingActions();
    acknowledged = true;
  } catch(e) {
    if (!navigator.onLine || e instanceof TypeError) _isOnline = false;
    else if (e && ['EDIT_CONFLICT','PRECONDITION_REQUIRED','REVISION_UNAVAILABLE','SEAT_CONFLICT','PLAYER_HAS_HISTORY','HAND_ACTIVE'].indexOf(e.code) >= 0) {
      markSyncConflict(e,inflight.id);
    } else _syncError = 'Change not saved to server: review the sync warning before settling.';
    // Keep the persisted entry for a safe retry or manual conflict resolution.
    console.warn('Game change retained for retry:',e);
  } finally {
    _activeQueueId = null;
    _flushingQueue = false;
    showConnBanner();
    if (acknowledged && _isOnline && _offlineQueue.length) flushOfflineQueue();
  }
  return result;
}

window.addEventListener('online', function() {
  _isOnline = true;
  if (!_syncConflict) _syncError = '';
  showConnBanner();
  flushOfflineQueue();
});
window.addEventListener('focus', function() {
  if (navigator.onLine && _offlineQueue.length && !_flushingQueue) {
    _isOnline = true;
    flushOfflineQueue();
  }
});
window.addEventListener('offline', function() {
  _isOnline = false;
  showConnBanner();
});
if (!_isOnline || _offlineQueue.length) {
  showConnBanner();
  if (_isOnline) setTimeout(flushOfflineQueue, 100);
}
// Review the CURRENT server record before voluntarily retrying a pending edit.
window.pkrReviewPendingEdits = async function() {
  if (!navigator.onLine) { alert('Reconnect to review the latest server values.'); return; }
  var action = _offlineQueue.find(function(a){return a.id===_syncConflictActionId;}) ||
    _offlineQueue[0];
  if (!action) { clearSyncConflict(); showConnBanner(); return; }
  var game;
  try { game = await pkrApi('/games/' + _ctx.gameId); }
  catch(e) { alert('Could not load current game records: ' + e.message); return; }
  var review = prepareConflictRetry(action,game);
  if (!review) { alert('The game is closed or the pending edit is invalid. No changes were applied.'); return; }
  var existing = document.getElementById('pkr-conflict-review');
  if (existing) existing.remove();
  var shade = document.createElement('div');
  shade.id = 'pkr-conflict-review';
  shade.style.cssText = 'position:fixed;inset:0;z-index:11000;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:18px';
  var panel = document.createElement('div');
  panel.style.cssText = 'background:#152018;border:1px solid #7a6333;border-radius:16px;padding:22px;color:#f5f0e5;max-width:480px;width:100%;font-family:Arial,sans-serif';
  function line(text,css) {
    var el=document.createElement('div');
    el.textContent=text;el.style.cssText=css||'margin-bottom:12px;font-size:14px;line-height:1.5';
    panel.appendChild(el);return el;
  }
  function control(text,css,handler) {
    var el=document.createElement('button');
    el.type='button';el.textContent=text;el.style.cssText=css;
    el.onclick=handler;panel.appendChild(el);return el;
  }
  line('Review unsynced change','font-weight:bold;font-size:19px;margin-bottom:12px');
  line('Nothing has been overwritten. Compare these values before deciding whether to retry.');
  line('Player: '+review.player+'  |  '+review.type);
  line('Currently on server: '+review.server,'font-weight:bold;margin-bottom:12px;font-size:14px');
  line('Pending on this device: '+review.pending,'font-weight:bold;margin-bottom:15px;font-size:14px');
  if (!review.canApply || _syncConflictCode==='PLAYER_HAS_HISTORY') {
    line(review.reason||'This change cannot safely be retried. Correct the table or seek support.',
      'color:#ffbf69;margin-bottom:16px;line-height:1.5;font-size:14px');
  } else {
    line('Retrying will use these latest server values as the expected starting point. If another host edits again, it will be blocked.');
    control('Apply my pending value','width:100%;padding:12px;margin-bottom:10px;background:#235f37;color:white;border:0;border-radius:8px;font-weight:bold;cursor:pointer',async function() {
      if (!window.confirm('Apply your pending value over the displayed server value, subject to a fresh conflict check?')) return;
      var queued = _offlineQueue.find(function(a){return a.id===action.id;});
      if (!queued) { alert('The pending edit changed. Review it again.');shade.remove();return; }
      var originalBody=queued.options.body;
      queued.options.body=JSON.stringify(review.nextBody);
      if (!savePendingActions()) {
        queued.options.body=originalBody;
        alert('Browser storage is unavailable. No retry was sent.');
        return;
      }
      clearSyncConflict();
      shade.remove();
      showConnBanner();
      await flushOfflineQueue();
    });
  }
  // A deliberate "keep server" decision is also available for financial edits.
  // Fetch again on click: the figures shown in a previous review can be stale.
  if (review.canApply && (review.type==='Buy-ins' || review.type==='Cash-out')) {
    control('Keep the saved value','width:100%;padding:12px;margin-bottom:10px;background:#26352c;color:#fff;border:1px solid #5d8766;border-radius:8px;font-weight:bold;cursor:pointer',async function() {
      if (!window.confirm('Discard THIS pending change and use the latest saved amount? Any unsynced local breakdown for this amount will be replaced.')) return;
      var fresh;
      try { fresh=await pkrApi('/games/'+_ctx.gameId); }
      catch(e) { alert('Could not verify the latest server amount. Nothing was discarded.');return; }
      var queued=_offlineQueue.find(function(entry){return entry.id===action.id;});
      if (!queued) { alert('The pending edit changed. Review it again.');shade.remove();return; }
      var decision=keepServerFinancialEdit(queued,fresh);
      if (!decision.ok) { alert(decision.error);return; }
      shade.remove();
      showConnBanner();
      if (_offlineQueue.length && _isOnline) await flushOfflineQueue();
    });
  }
  control('Keep pending and close','width:100%;padding:12px;background:transparent;color:#eee;border:1px solid #726c58;border-radius:8px;cursor:pointer',function(){shade.remove();});
  shade.appendChild(panel);
  document.body.appendChild(shade);
};

window.pkrSyncPendingActions = flushOfflineQueue;
window.pkrHasPendingActions = function() { return _offlineQueue.length > 0; };

async function loadGameFromPkr() {
  var ctx = getPkrCtx();
  if (!ctx || !ctx.gameId) return;
  try {
    var game = await pkrApi('/games/' + ctx.gameId);
    if (game && game.players) {
      game.players.forEach(function(p) {
        var sid = 'seat' + p.seat_number;
        if (p.user_id) _pkrSeatedPlayers[sid] = { user_id:p.user_id,name:p.display_name,
          seat_number:p.seat_number,buy_ins:p.buy_ins,buy_in_total:p.buy_in_total,cashout:p.cashout,revision:p.revision };
      });
    }
  } catch(e) { console.warn('Could not reload game:', e); }
}

async function pkrSeatPlayer(sid, name, phone, linkedUserId) {
  var ctx = getPkrCtx();
  if (!ctx || !ctx.gameId) return null;
  if (_pkrSeatedPlayers[sid] && _pkrSeatedPlayers[sid].name === name) {
    return _pkrSeatedPlayers[sid];
  }
  try {
    var seatNum = parseInt((sid || '').replace('seat','')) || null;
    var body = { display_name:name, whatsapp:phone || null, seat_number:seatNum, buy_ins:0 };
    if (linkedUserId) body.user_id = linkedUserId;
    // An existing player being moved must send their last observed seat.
    // Never infer a new seat as the old seat to bypass a server conflict.
    var prior = Object.keys(_pkrSeatedPlayers).map(function(oldSid) {
      return {sid:oldSid,player:_pkrSeatedPlayers[oldSid]};
    }).find(function(item) {
      return item.sid !== sid && item.player && item.player.name === name;
    });
    var known = prior && prior.player;
    if (!known && Array.isArray(ctx.dbPlayers)) {
      known = ctx.dbPlayers.find(function(player){return player.display_name === name;});
    }
    if (known && known.seat_number !== seatNum) {
      body.expected_seat_number = known.seat_number === undefined ? null : known.seat_number;
    }
    var res = await pkrApiQueued('/games/' + ctx.gameId + '/seat', {
      method:'POST', body:JSON.stringify(body),
    }, sid, name);
    if (res && Array.isArray(res.players)) {
      var player = res.players.find(function(p){ return p.display_name === name; });
      if (player) {
        Object.keys(_pkrSeatedPlayers).forEach(function(oldSid) {
          if (oldSid !== sid && _pkrSeatedPlayers[oldSid].user_id === player.user_id) {
            delete _pkrSeatedPlayers[oldSid];
          }
        });
        _pkrSeatedPlayers[sid] = {
          user_id:player.user_id,name:name,seat_number:player.seat_number,
          buy_ins:player.buy_ins,buy_in_total:player.buy_in_total,cashout:player.cashout,
          revision:player.revision,
        };
        return _pkrSeatedPlayers[sid];
      }
    }
  } catch(e) {
    console.warn('PKR seat sync failed; local state retained:', e);
    _syncError = 'Player seating could not sync. Do not save results until resolved.';
    showConnBanner();
  }
  return null;
}

function _pkrSnapshotPlayers() {
  var snap = {};
  if (!state || !state.players) return snap;
  Object.keys(state.players).forEach(function(sid) {
    var p = state.players[sid];
    if (!p || !p.name) return;
    var txs = p.transactions || [];
    var buyins = txs.filter(function(t){return t.type !== 'cashout';}).length;
    var cashoutAmt = txs.filter(function(t){return t.type === 'cashout';})
      .reduce(function(s,t){return s+(t.amount||0);},0);
    var biTotal = txs.filter(function(t){return t.type !== 'cashout';})
      .reduce(function(s,t){return s+(t.amount||0);},0);
    snap[sid] = {
      name:p.name, phone:p.phone||'', buyins:buyins,
      cashout:cashoutAmt, hadCashout:txs.some(function(t){return t.type === 'cashout';}),
      biTotal:biTotal,
    };
  });
  return snap;
}

var _origSaveState = saveState;
window.saveState = function() {
  var before = _pkrLastSnapshot;
  _origSaveState();
  var after = _pkrSnapshotPlayers();
  _pkrLastSnapshot = after;
  Object.keys(after).forEach(async function(sid) {
    var ctx = getPkrCtx();
    if (!ctx || !ctx.gameId) return;
    var cur = after[sid], previous = before[sid];
    try {
      if (!previous || previous.name !== cur.name) {
        var created = await pkrSeatPlayer(sid,cur.name,cur.phone);
        if (created && created.user_id) {
          // The player may already have bought in by the time seating finished.
          queueLatestSeatAmounts(sid,created.user_id,cur.name,created);
          if (_isOnline) flushOfflineQueue();
        }
        return;
      }
      if (previous.buyins === cur.buyins &&
          Math.abs(previous.biTotal - cur.biTotal) < 0.001 &&
          previous.hadCashout === cur.hadCashout &&
          Math.abs(previous.cashout - cur.cashout) < 0.001) {
        return; // A nonfinancial UI save does not create additional transactions.
      }
      var seated = _pkrSeatedPlayers[sid];
      if (!seated) seated = await pkrSeatPlayer(sid,cur.name,cur.phone);
      if (!seated || !seated.user_id) return; // A pending seat replay handles latest totals.

      if (cur.buyins !== previous.buyins || Math.abs(cur.biTotal - previous.biTotal) >= 0.001) {
        // Absolute PUT instead of incremental POST: safe to retry without
        // accidentally charging the same buy-in twice.
        await pkrApiQueued('/games/' + ctx.gameId + '/buyin/' + seated.user_id, {
          method:'PUT',
          body:JSON.stringify(pkrVersioned({
            count:cur.buyins,total:Math.round(cur.biTotal*100),
            expected_count:previous.buyins,expected_total:Math.round(previous.biTotal*100),
          },seated)),
        });
      }
      if (cur.hadCashout !== previous.hadCashout ||
          Math.abs(cur.cashout - previous.cashout) >= 0.001) {
        await pkrApiQueued('/games/' + ctx.gameId + '/cashout/' + seated.user_id, {
          method:'PUT',
          body:JSON.stringify(pkrVersioned({
            cashout:cur.hadCashout ? Math.round(cur.cashout*100) : null,
            expected_cashout:previous.hadCashout ? Math.round(previous.cashout*100) : null,
          },seated)),
        });
      }
    } catch(e) {
      console.warn('Game sync needs attention; local state retained:',e);
      _syncError = e && e.code === 'LOCAL_STORAGE_UNAVAILABLE'
        ? 'Browser storage unavailable. Pending edits remain on this device; do not close the tab.'
        : 'An edit has not synced. Check your connection before saving results.';
      showConnBanner();
    }
  });

  // Removed seats must also be removed from the server, unless the game has
  // already been saved as a final settlement.
  if (!window._pkrResultsSaved) {
    Object.keys(before).forEach(function(sid) {
      if (after[sid]) return;
      // A player's move is an update to their existing seat, not a deletion.
      if (Object.keys(after).some(function(otherSid) {
        return after[otherSid].name.toLowerCase() === before[sid].name.toLowerCase();
      })) return;
      var seated = _pkrSeatedPlayers[sid];
      var ctx = getPkrCtx();
      if (!ctx || !ctx.gameId || !seated || !seated.user_id) return;
      var expectedSeat = seated.seat_number == null
        ? (parseInt(sid.replace('seat','')) || null)
        : seated.seat_number;
      pkrApiQueued('/games/' + ctx.gameId + '/seat/' + seated.user_id, {
        method:'DELETE',body:JSON.stringify({expected_seat_number:expectedSeat}),
      }).then(function(response){
        if (response && response.ok) delete _pkrSeatedPlayers[sid];
      }).catch(function(e){
        console.warn('Could not remove player remotely:',e);
        _syncError = 'Player removal has not synced. Check before saving results.';
        showConnBanner();
      });
    });
  }
};
// reassign alias
var saveState = window.saveState;

// Backfill PKR players into seat cache on load
setTimeout(async function() {
  var ctx = getPkrCtx();
  if (!ctx || !ctx.gameId || !state || !state.players) return;
  try {
    var game = await pkrApi('/games/' + ctx.gameId);
    if (game && game.players) {
      game.players.forEach(function(p) {
        Object.keys(state.players || {}).forEach(function(sid) {
          var sp = state.players[sid];
          if (sp && sp.name && sp.name.toLowerCase() === p.display_name.toLowerCase()) {
            _pkrSeatedPlayers[sid] = { user_id:p.user_id,name:sp.name,
              seat_number:p.seat_number,buy_ins:p.buy_ins,buy_in_total:p.buy_in_total,cashout:p.cashout,
           revision:p.revision };
          }
        });
      });
    }
  } catch(e) {}
}, 500);

// ── Sync settle to PKR ──
window.syncSettleToPkr = async function() {
  var ctx = getPkrCtx();
  if (!ctx || !ctx.gameId) return false;
  if (!state || !state.players) return false;
  var pkrGame = null;
  try { pkrGame = await pkrApi('/games/' + ctx.gameId); } catch(e) {}
  var pkrPlayerMap = {};
  if (pkrGame && pkrGame.players) {
    pkrGame.players.forEach(function(p) { pkrPlayerMap[p.display_name.toLowerCase()] = { user_id: p.user_id }; });
  }
  // Merge by display_name — same player may occupy multiple seats
  var merged = {};
  Object.values(state.players)
    .filter(function(p) { return p && p.name; })
    .forEach(function(p) {
      var key = (p.name||'').toLowerCase();
      var buyinCount = (p.transactions||[]).filter(function(t){ return t.type !== 'cashout'; }).length;
      var biTotal    = (p.transactions||[]).filter(function(t){ return t.type !== 'cashout'; }).reduce(function(a,t){ return a+(t.amount||0); }, 0);
      var coDollars  = (p.transactions||[]).filter(function(t){ return t.type === 'cashout'; }).reduce(function(a,t){ return a+t.amount; }, 0);
      var entry = pkrPlayerMap[key];
      // Priority: seated cache > local state userId > pkrPlayerMap > fallback
      var seatedEntry = Object.values(_pkrSeatedPlayers).find(function(s){ return s && s.name && s.name.toLowerCase()===key; });
      var userId = (seatedEntry && seatedEntry.user_id) ? seatedEntry.user_id : (p.userId && p.userId !== p.name) ? p.userId : (entry ? entry.user_id : ('manual_' + (p.name||'').replace(/\\s+/g,'_')));
      if (merged[key]) {
        merged[key].buy_ins      += buyinCount;
        merged[key].buy_in_total += Math.round(biTotal*100);
        merged[key].cashout      += Math.round(coDollars*100);
      } else {
        merged[key] = { user_id: userId, display_name: p.name, buy_ins: buyinCount, buy_in_total: Math.round(biTotal*100), cashout: Math.round(coDollars*100) };
      }
    });
  var results = Object.values(merged).filter(function(p) { return p.buy_ins > 0; });
  if (results.length === 0) return false;
  var settleKey = ctx.settleKey || (ctx.gameId + '_end');
  try {
    await pkrApi('/games/' + ctx.gameId + '/settle', {
      method: 'POST', body: JSON.stringify({ idempotency_key: settleKey, results: results }),
    });
    return true;
  } catch(e) {
    // A different settlement key is not evidence that this save succeeded.
    throw e;
  }
};

// ── Push notifications via PKR ──
async function pkrPushForPlayer(playerName) {
  var ctx = getPkrCtx();
  if (!ctx || !ctx.eventId) return null;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    var reg = await navigator.serviceWorker.getRegistration('/') || await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    if (!reg) return null;
    var vapidData = await (await fetch(ctx.apiUrl + '/vapid-public-key')).json();
    function urlB64ToUint8(b64) {
      var pad = '='.repeat((4 - b64.length % 4) % 4);
      var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(raw, function(c){ return c.charCodeAt(0); });
    }
    var sub = await reg.pushManager.getSubscription()
           || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(vapidData.key) });
    var sj = sub.toJSON();
    await pkrApi('/events/' + ctx.eventId + '/subscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: sj.endpoint, keys: sj.keys, userId: ctx.userId||null, display_name: playerName||ctx.userName||null }),
    });
    return sub;
  } catch(e) { console.warn('PKR push failed:', e); return null; }
}

async function notifyPlayer(playerName, title, body) {
  // Push notifications are handled server-side by buyin/cashout routes
  // No client-side notify endpoint needed
}

// ── Utility functions ──
function fmt(n) { return '$' + (n || 0).toFixed(2); }
function getBankSize() { return (state.game && state.game.bank_size) ? state.game.bank_size : (state.game && state.game.defaultBuyin ? state.game.defaultBuyin : 0); }
function fmtB(dollars) {
  var b = getBankSize(); if(!b || b<=0) return fmt(dollars);
  var n = dollars/b; var nr = Math.round(n*10)/10;
  var banksStr = nr%1===0 ? (nr+'b') : (nr.toFixed(1)+'b');
  return banksStr + ' ($' + Math.abs(dollars).toFixed(0) + ')';
}
function fmtBNet(n) {
  if(!getBankSize()) return fmtNet(n);
  var sign = n>0?'+':n<0?'-':''; var abs = Math.abs(n);
  return sign + fmtB(abs);
}

function fmtNet(n) { return n > 0 ? '+$' + n.toFixed(2) : n < 0 ? '-$' + Math.abs(n).toFixed(2) : '$0.00'; }
function nc(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'; }
function inits(n) { return (n || '').split(' ').map(function(w){ return w[0] || ''; }).join('').slice(0,2).toUpperCase() || '?'; }
window.inits = inits;
function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
window.showToast = function(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2500);
};
window.pBuyin = function pBuyin(p) { return (p.transactions || []).filter(function(t){ return t.type !== 'cashout'; }).reduce(function(a,t){ return a+t.amount; }, 0); }
function pCash(p) { return (p.transactions || []).filter(function(t){ return t.type === 'cashout'; }).reduce(function(a,t){ return a+t.amount; }, 0); }
function pNet(p) { return pCash(p) - pBuyin(p); }
function waUrl(phone, msg) { return 'https://wa.me/' + phone.replace(/\\D/g,'') + '?text=' + encodeURIComponent(msg); }
function getPhones() { try { return JSON.parse(localStorage.getItem(PHONE_K) || '{}'); } catch(e) { return {}; } }
function savePhones(pb) { localStorage.setItem(PHONE_K, JSON.stringify(pb)); }
function getPhone(name) { return (getPhones()[name.toLowerCase()] || {}).phone || ''; }
function setPhone(name, raw) {
  if (!name.trim()) return;
  var pb = getPhones(), key = name.trim().toLowerCase();
  if (!pb[key]) pb[key] = { name: name.trim() };
  var p = raw.replace(/\\D/g,'');
  if (p.startsWith('0')) p = '61' + p.slice(1);
  if (p) pb[key].phone = p;
  savePhones(pb);
}
function getHistory() { try { return JSON.parse(localStorage.getItem(HIST_K) || '[]'); } catch(e) { return []; } }
function copyText(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function(){ window.prompt('Copy:', text); });
  else window.prompt('Copy:', text);
  toast('Copied! ♠');
}
window.copyText = copyText;

// ── Toast ──
window.toast = function toast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function(){ el.classList.remove('show'); }, 2500);
};
var toast = window.toast;

// ── WA Toast ──
var waToastTimer = null;
window.showWaToast = function(phone, msg) {
  clearTimeout(waToastTimer);
  var msgEl = document.getElementById('waToastMsg');
  var sendEl = document.getElementById('waToastSend');
  if (msgEl) msgEl.textContent = msg;
  if (sendEl) sendEl.href = waUrl(phone, msg);
  var el = document.getElementById('waToast');
  if (el) el.classList.add('show');
  waToastTimer = setTimeout(window.hideWaToast, 20000);
};
window.hideWaToast = function() {
  var el = document.getElementById('waToast');
  if (el) el.classList.remove('show');
  clearTimeout(waToastTimer);
};

// ── Confirm modal ──
function showConfirmModal(title, message, confirmLabel, onConfirm, danger) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:24px';
  var box = document.createElement('div');
  var isDanger = danger !== false;
  box.style.cssText = 'background:#09180a;border:1px solid ' + (isDanger ? 'rgba(231,76,60,0.4)' : 'rgba(201,168,76,0.3)') + ';border-radius:16px;padding:24px;width:100%;max-width:320px';
  var t = document.createElement('div');
  t.style.cssText = 'font-size:1rem;font-weight:700;color:' + (isDanger ? '#ff6b5b' : 'var(--gold)') + ';margin-bottom:10px';
  t.textContent = title;
  var m = document.createElement('div');
  m.style.cssText = 'font-size:0.9rem;color:var(--cream2);margin-bottom:20px;line-height:1.6';
  m.textContent = message;
  var yesBtn = document.createElement('button');
  yesBtn.style.cssText = 'width:100%;background:' + (isDanger ? 'linear-gradient(135deg,#c0392b,#8a2010)' : 'linear-gradient(135deg,var(--gold),#8a5c20)') + ';color:' + (isDanger ? '#fff' : '#000') + ';border:none;padding:13px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;margin-bottom:10px;display:block';
  yesBtn.textContent = confirmLabel;
  var noBtn = document.createElement('button');
  noBtn.style.cssText = 'width:100%;background:none;border:1px solid var(--border);color:var(--muted);padding:12px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.8rem;cursor:pointer;display:block';
  noBtn.textContent = 'Cancel';
  yesBtn.addEventListener('click', function(){ overlay.remove(); onConfirm(); });
  noBtn.addEventListener('click', function(){ overlay.remove(); });
  overlay.addEventListener('click', function(e){ if (e.target === overlay) overlay.remove(); });
  box.append(t, m, yesBtn, noBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// ── Bank ──
window.toggleBank = function() {
  var panel = document.getElementById('bankPanel');
  var bar = document.getElementById('bankBar');
  if (panel) panel.classList.toggle('open');
  if (bar) { var expanded = bar.classList.toggle('open'); bar.setAttribute('aria-expanded', expanded ? 'true' : 'false'); }
};

function updateBank() {
  var players = Object.values(state.players).filter(function(p){ return p && p.name; });
  var totalIn = players.reduce(function(a,p){ return a+pBuyin(p); }, 0);
  var totalOut = players.reduce(function(a,p){ return a+pCash(p); }, 0);
  var totalBanks = players.reduce(function(total,p){
    return total+(p.transactions||[]).filter(function(tx){return tx&&tx.type!=='cashout';}).length;
  },0);
  var inBank = totalIn - totalOut;
  var active = players.filter(function(p){ return pBuyin(p) > 0 && !(p.transactions && p.transactions.some(function(t){return t.type==='cashout';})); }).length;
  var cashed = players.filter(function(p){ return pCash(p) > 0; }).length;
  var set = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  set('bbTotal', fmt(totalIn));
  set('bbBanks', totalBanks+'b');
  set('bbBankQuick', fmt(inBank));
  set('bbInPlay', fmt(inBank));
  var inPlayEl=document.getElementById('bbInPlay');
  if(inPlayEl)inPlayEl.className=inBank<0?'neg':'pos';
  set('bbIn', fmtB(totalIn));
  set('bbOut', fmtB(totalOut));
  set('bbBank', fmtB(inBank));
  set('bcIn', fmtB(totalIn));
  set('bcOut', fmtB(totalOut));
  set('bcBank', fmtB(inBank));
  set('bcBankSub', inBank >= 0 ? 'still on table' : 'over-cashed!');
  set('bcStatus', active + ' Active');
  set('bcStatusSub', cashed ? cashed + ' cashed out' : '');
}

// Read-only chip labels: bank dollars are independent of hand-tracked
// chip stacks. Never turn an unfinished game into a recorded loss.
var _pkrSeatHands=[];
var _pkrVerifiedHandAudit=null;
function seatChipRows(){
  var ledger=window.pkrSeatStackLedger;
  if(!ledger||!state.game)return {};
  var rows=ledger.compute(state.game,state.players,_pkrSeatHands);
  if(_pkrVerifiedHandAudit&&state.game.hand_tracking){
    var latest=_pkrSeatHands.find(function(hand){return hand&&!hand.voided;});
    if(latest&&latest.id===_pkrVerifiedHandAudit.handId){
      (_pkrVerifiedHandAudit.stacks||[]).forEach(function(stack){
        var sid='seat'+stack.seat_number,row=rows[sid],p=state.players[sid];
        if(!row||!p||p.name!==stack.display_name||
           !Number.isSafeInteger(stack.closing_chips)||stack.closing_chips<0)return;
        row.chips=stack.closing_chips;row.source='verified';row.reason='';
        row.unsettledChips=_pkrVerifiedHandAudit.unsettled||0;
        var value=Number(state.game.chip_value);
        row.cashValue=Number.isFinite(value)&&value>0?Math.round(row.chips*value)/100:null;
      });
    }
  }
  return rows;
}
function seatBankLabel(inDollars){
  var bank=getBankSize(),banks=bank>0?inDollars/bank:0;
  if(!bank||!Number.isFinite(banks))return fmt(inDollars)+' in';
  var rounded=Math.round(banks*10)/10;
  var count=Number.isInteger(rounded)?String(rounded):rounded.toFixed(1);
  return count+'b · '+fmt(inDollars)+' in';
}
function seatStackText(row){
  if(!row)return '';
  if(row.source==='review')return '⚠ Check chip stack';
  if(row.chips===null||row.chips===undefined)return '';
  var chips=Number(row.chips).toLocaleString('en-AU')+' chips';
  if(row.source==='tracked'||row.source==='verified'){
    return 'Stack '+chips+(row.cashValue!==null?' · '+fmt(row.cashValue):'');
  }
  return chips+' issued';
}
// ── Table render ──
function renderTable() {
  if(!state.game)return;
  var area=document.getElementById('tableArea'),wrap=document.getElementById('tableWrap');
  if(!area||!wrap)return;
  var W=area.clientWidth,availableHeight=area.clientHeight;
  if(!W||!availableHeight){setTimeout(renderTable,80);return;}
  var count=Math.max(2,Math.min(36,Number(state.game.seats)||9));
  var mode=pkrResolveSeatLayout(),mobileRail=mode==='mobile',compact=mode==='compact';
  var hasStacks=!!state.game.hand_tracking;
  var leftCount=Math.ceil((count-2)/2),rightCount=Math.floor((count-2)/2),maxSide=Math.max(leftCount,rightCount);
  var wideTable=!mobileRail&&(mode==='balanced'?W>=650:(W>=700||W>availableHeight*1.08));
  // Crowded short landscape screens cannot physically fit 10+ full seat
  // cards around a horizontal ellipse. Keep the selected view and its
  // information, but use the vertical rail geometry inside the scrollable
  // table canvas instead of overlapping neighbouring players.
  if(count>=10&&availableHeight<520)wideTable=false;
  var tightWide=wideTable&&count>=10&&W<1024;
  var balancedWidth=wideTable?Math.min(150,Math.max(96,Math.floor((W-28)/(Math.ceil(count/2)+1)))):0;
  var compactWidth=wideTable?Math.min(tightWide?76:88,Math.max(62,Math.floor((W-24)/(Math.ceil(count/2)+1)))):0;
  var cardWidth=mobileRail?Math.floor(Math.min(76,Math.max(64,W*.19))):wideTable?(compact?compactWidth:balancedWidth):(compact?60:Math.floor(Math.min(108,Math.max(92,W*.26))));
  var cardHeight=mobileRail?(hasStacks?90:80):compact?(tightWide?(hasStacks?78:68):(hasStacks?82:72)):tightWide?(hasStacks?82:66):(hasStacks?82:66);
  var minimumHeight=wideTable?450:mobileRail?Math.max(560,(maxSide+1)*(cardHeight+6)+28):Math.max(430,(maxSide+1)*(cardHeight+9)+28);
  var H=Math.max(availableHeight,minimumHeight);
  wrap.style.setProperty('--pkr-canvas-height',H+'px');
  var summary=document.getElementById('pkrSeatSummary');
  area.classList.remove('pkr-table-summary-on');
  if(summary){summary.hidden=true;summary.replaceChildren();}
  var tW=wideTable?Math.min(W*.72,1000):Math.min(W*.53,250);
  var tH=wideTable?(tightWide?Math.min(H*.68,300):Math.min(H*.56,430)):Math.min(H*.62,tW*1.72);
  var screen=document.getElementById('gameScreen');
  if(screen){
    screen.classList.toggle('pkr-wide-table',wideTable);
    screen.classList.toggle('pkr-view-mobile',mobileRail);
    screen.classList.toggle('pkr-view-compact',mode==='compact');
    screen.classList.toggle('pkr-view-balanced',mode==='balanced');
    screen.dataset.tableView=mode;
  }
  var cx=W/2,cy=H/2,pad=14;
  var outer=document.getElementById('tableOuter'),felt=document.getElementById('tableFelt');
  if(outer)outer.style.cssText='width:'+(tW+pad*2)+'px;height:'+(tH+pad*2)+'px;left:'+(cx-(tW+pad*2)/2)+'px;top:'+(cy-(tH+pad*2)/2)+'px';
  if(felt)felt.style.cssText='width:'+tW+'px;height:'+tH+'px;left:'+(cx-tW/2)+'px;top:'+(cy-tH/2)+'px';
  var players=Object.values(state.players).filter(function(p){return p&&p.name;});
  var active=players.filter(function(p){return pBuyin(p)>0&&!(p.transactions||[]).some(function(t){return t.type==='cashout';});}).length;
  var name=document.getElementById('tableName'),stats=document.getElementById('tableStats'),meta=document.getElementById('topbarGameMeta');
  if(name)name.textContent=state.game.name;
  var caption=active+' active · '+players.length+' seated';
  if(stats)stats.textContent=players.length?caption:'';
  if(meta)meta.textContent=caption;
  buildSeats(count,tW,tH,cx,cy,wideTable,seatChipRows(),{width:W,height:H,cardWidth:cardWidth,cardHeight:cardHeight,mode:mode,compact:compact,mobileRail:mobileRail,tightWide:tightWide,hasStacks:hasStacks});
  updateBank();updateSaveResultsBtn();
}
window.renderTable = renderTable;
function pkrSeatMoney(n,signed){var text=signed?fmtNet(n):fmt(n);return text.endsWith('.00')?text.slice(0,-3):text;}
function pkrMockupSeatCard(p,sid,bankIn,finalNet,cashed,mode,stackRow){
  var bought=bankIn>0,status=cashed?'CASHED OUT':bought?'IN PLAY':'SEATED',statusClass=cashed?'cashed':bought?'inplay':'waiting';
  var amount=cashed?pkrSeatMoney(finalNet,true):bought?'-'+pkrSeatMoney(bankIn,false):pkrSeatMoney(0,false);
  var amountClass=cashed?nc(finalNet):bought?'neg':'zero',banks=seatBankLabel(bankIn).replace(/ in$/,'').replace('.00','');
  var avatar='<span class="seat-chip '+(cashed?'cashed':'seated')+' pkr-game-seat-avatar"><span class="seat-inner">'+pkrAvatar(p)+'</span></span>';
  var badge=cashed?'✓':'•',compact=mode==='compact',mobile=mode==='mobile',chipLabel='';
  if(state.game.hand_tracking&&stackRow&&!cashed){
    if(Number.isSafeInteger(stackRow.chips)&&stackRow.chips>=0){chipLabel=Number(stackRow.chips).toLocaleString('en-AU')+' chips';if(mode==='balanced'&&stackRow.cashValue!==null&&Number.isFinite(stackRow.cashValue))chipLabel+=' · '+pkrSeatMoney(stackRow.cashValue,false);}
    else if(stackRow.source==='review')chipLabel='Check chips';
  }
  var chips=chipLabel?'<span class="seat-stack pkr-game-stack-readout '+(stackRow.source||'issued')+'">'+esc(chipLabel)+'</span>':'';
  if(mobile)return '<span class="pkr-game-seat-card pkr-mobile-rail-card '+statusClass+'"><span class="pkr-game-seat-number">'+esc(sid.slice(4))+'</span><span class="pkr-mobile-rail-avatar">'+avatar+'<span class="pkr-game-status-dot '+statusClass+'" aria-label="'+status+'">'+badge+'</span></span><strong class="seat-label pkr-game-seat-name">'+esc(p.name)+'</strong><small class="seat-money pkr-game-seat-bank">'+esc(banks)+'</small><strong class="pkr-game-seat-result '+amountClass+'">'+esc(amount)+'</strong><span class="pkr-game-seat-status pkr-mobile-rail-status '+statusClass+'">'+status+'</span>'+chips+'</span>';
  var fullAvatar='<span class="pkr-game-full-avatar">'+avatar+(cashed?'<span class="pkr-game-status-dot cashed" aria-label="Cashed out">✓</span>':'')+'</span>';
  var main=compact?'<span class="pkr-game-compact-avatar">'+avatar+'<span class="pkr-game-status-dot '+statusClass+'" aria-label="'+status+'">'+badge+'</span></span><span class="seat-money pkr-game-compact-bank">'+esc(pkrSeatMoney(bankIn,false))+'</span><strong class="pkr-game-seat-result '+amountClass+'">'+esc(amount)+'</strong>'+(cashed?'':'<span class="pkr-game-compact-status '+statusClass+'">'+status+'</span>'):'<span class="pkr-game-seat-main">'+fullAvatar+'<span class="pkr-game-seat-copy"><strong class="seat-label pkr-game-seat-name">'+esc(p.name)+'</strong><small class="seat-money pkr-game-seat-bank">'+esc(banks)+'</small><strong class="pkr-game-seat-result '+amountClass+'">'+esc(amount)+'</strong></span></span>';
  return '<span class="pkr-game-seat-card '+statusClass+'"><span class="pkr-game-seat-number">'+esc(sid.slice(4))+'</span>'+main+chips+'</span>';
}
function buildSeats(count,tW,tH,cx,cy,wideTable,seatRows,g){
  var cont=document.getElementById('seatsContainer');if(!cont)return;cont.replaceChildren();
  var leftCount=Math.ceil((count-2)/2),rightCount=Math.floor((count-2)/2),positions=[];
  if(wideTable){
    var rx=Math.min(g.width/2-g.cardWidth/2-12,tW/2+g.cardWidth*.65),ry=Math.min(g.height/2-g.cardHeight/2-(g.tightWide?8:16),tH/2+g.cardHeight*.6);
    var polar=function(a){return {x:cx+rx*Math.cos(a),y:cy+ry*Math.sin(a)};};positions.push(polar(-Math.PI/2));
    for(var a=0;a<leftCount;a++)positions.push(polar(-Math.PI/2-Math.PI*(a+1)/(leftCount+1)));positions.push(polar(Math.PI/2));
    for(var b=0;b<rightCount;b++)positions.push(polar(Math.PI/2-Math.PI*(b+1)/(rightCount+1)));
  }else{
    var top=Math.max(g.cardHeight/2+8,cy-tH/2-g.cardHeight*.55),bottom=Math.min(g.height-g.cardHeight/2-8,cy+tH/2+g.cardHeight*.55);
    var leftX=Math.max(g.cardWidth/2+6,cx-tW/2-g.cardWidth*.52),rightX=Math.min(g.width-g.cardWidth/2-6,cx+tW/2+g.cardWidth*.52);
    var first=top+g.cardHeight*.70,last=bottom-g.cardHeight*.70,spread=function(i,n){return n<=1?g.height/2:first+(last-first)*i/(n-1);};
    positions.push({x:cx,y:top});for(var a=0;a<leftCount;a++)positions.push({x:leftX,y:spread(a,leftCount)});positions.push({x:cx,y:bottom});
    for(var b=0;b<rightCount;b++)positions.push({x:rightX,y:spread(rightCount-1-b,rightCount)});
  }
  positions.forEach(function(pos,i){
    var sid='seat'+(i+1),p=state.players[sid],seat=document.createElement('div');
    seat.className='seat pkr-mockup-player-seat pkr-layout-'+g.mode;seat.id=sid;seat.style.left=pos.x+'px';seat.style.top=pos.y+'px';
    seat.style.setProperty('--pkr-card-width',g.cardWidth+'px');seat.style.setProperty('--pkr-card-height',g.cardHeight+'px');
    seat.style.setProperty('--pkr-avatar-size',(g.mobileRail?(g.width<=360?34:40):g.tightWide?32:wideTable?42:g.width<=360?28:34)+'px');
    seat.style.setProperty('--pkr-name-size',(g.mobileRail?(g.width<=360?10:11):g.tightWide?10:wideTable?13:g.width<=360?10:11)+'px');
    seat.style.setProperty('--pkr-bank-size',(g.mobileRail?(g.width<=360?9:10):g.tightWide?9:wideTable?12:g.width<=360?9:10)+'px');
    seat.style.setProperty('--pkr-result-size',(g.mobileRail?(g.width<=360?12:14):g.tightWide?13:wideTable?17:g.width<=360?12:14)+'px');
    if(i>0&&i<=leftCount)seat.dataset.side='left';else if(i>leftCount+1)seat.dataset.side='right';seat.setAttribute('role','button');seat.tabIndex=0;
    if(p&&p.name){
      var bi=pBuyin(p),cashed=(p.transactions||[]).some(function(t){return t.type==='cashout';});
      seat.classList.add(cashed?'pkr-cashed-seat':bi>0?'pkr-inplay-seat':'pkr-waiting-seat');seat.dataset.status=cashed?'cashed':bi>0?'inplay':'waiting';
      seat.setAttribute('aria-label','Open player '+p.name+': '+(cashed?'Cashed out':bi>0?'In play':'Seated'));
      seat.title=p.name+' · '+seatBankLabel(bi)+' · '+(cashed?'Cashed out; net '+fmtNet(pNet(p)):'Buy-ins outstanding, not a realised loss');
      seat.innerHTML=pkrMockupSeatCard(p,sid,bi,pNet(p),cashed,g.mode,(seatRows||{})[sid]);
    }else{seat.classList.add('pkr-empty-seat');seat.setAttribute('aria-label','Assign player to seat '+(i+1));seat.innerHTML='<span class="seat-chip empty"><span class="seat-inner">+</span></span><span class="seat-label">Seat '+(i+1)+'</span>';}
    seat.addEventListener('click',function(){onSeatClick(sid);});seat.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();onSeatClick(sid);}});cont.appendChild(seat);
  });
}

function onSeatClick(sid) {
  var p = state.players[sid];
  if (p && p.name) openPanel(sid);
  else openAssign(sid);
}

// ── Side Panel ──
var activePanel = null;

window.openPanel = function openPanel(sid) {
  activePanel = sid;
  var sp = document.getElementById('sidePanel');
  if (sp) sp.classList.add('open');
  requestAnimationFrame(function(){ buildPanel(sid); });
};

window.closePanel = function closePanel() {
  var sp = document.getElementById('sidePanel');
  if (sp) sp.classList.remove('open');
  activePanel = null;
  setTimeout(renderTable, 270);
};

function refreshPanelSummary(sid) {
  var p = state.players[sid];
  if (!p) return;
  var el = document.getElementById('pNetDisplay');
  if (el) { var n = pNet(p); var final=(p.transactions||[]).some(function(tx){return tx.type==='cashout';}); el.className=final?'p-net '+nc(n):'p-net'+(pBuyin(p)>0?' inplay':''); el.textContent=final?fmtBNet(n):fmtB(pBuyin(p))+' in'; }
  var chips=document.getElementById('pkrSeatChipSummary');
  if(chips)chips.textContent=seatStackText(seatChipRows()[sid]);
}

function buildPanel(sid) {
  var p = state.players[sid];
  if (!p) return;
  var titleEl = document.getElementById('panelTitle');
  if (titleEl) titleEl.textContent = p.name;
  var body = document.getElementById('panelBody');
  if (!body) return;
  body.innerHTML = '';
  var bi = pBuyin(p), co = pCash(p), net = pNet(p);

  // Summary
  var sum = document.createElement('div'); sum.className = 'p-sum';
  var cashedOut=(p.transactions||[]).some(function(tx){return tx.type==='cashout';});
  var row=seatChipRows()[sid],chipSummary=seatStackText(row);
  sum.innerHTML = '<div class="p-av">' + esc(inits(p.name)) + '</div><div class="p-info"><div class="p-name">' + esc(p.name) + '</div><div class="p-meta">Seat ' + sid.replace('seat','') + ' &middot; In: <span class="pkr-panel-buyin '+(!cashedOut&&bi>0?'inplay':'')+'">' + esc(seatBankLabel(bi)) + '</span>' + (cashedOut?' &middot; Out: '+fmt(co):'') + '</div><div class="p-chip-summary" id="pkrSeatChipSummary">'+esc(chipSummary)+'</div></div><div class="p-net ' + (cashedOut?nc(net):(bi>0?'inplay':'')) + '" id="pNetDisplay">' + (cashedOut?fmtNet(net):fmtB(bi)+' in') + '</div>';
  body.appendChild(sum);

  // Transactions
  var txSec = document.createElement('div'); txSec.className = 'psec'; txSec.textContent = 'Transactions';
  body.appendChild(txSec);
  var txList = document.createElement('div');
  var txs = p.transactions || [];
  if (txs.some(function(tx){return tx.pkrReconstructed;})) {
    var note = document.createElement('div');
    note.style.cssText = 'font-size:0.76rem;line-height:1.5;color:#e9c788;padding:8px 10px;margin:6px 0;border:1px solid #846f3b;border-radius:8px;background:#1b2419';
    note.textContent = txs.some(function(tx){return tx.pkrEstimated;})
      ? 'Bank amounts reconstructed from the saved total. Individual amounts are estimated; check against the paper record before editing or settling.'
      : 'Bank rows reconstructed from the saved buy-in count and standard bank amount. Original transaction timestamps were not saved.';
    body.appendChild(note);
  }
  if (!txs.length) {
    txList.innerHTML = '<div style="font-size:0.85rem;color:var(--muted);padding:10px 0;text-align:center">No transactions yet</div>';
  } else {
    txs.forEach(function(tx, idx) {
      var typeLabel = tx.type === 'cashout' ? 'Cash out' : 'Buy-in';
      var typeCls = tx.type === 'cashout' ? 'co' : 'bi';
      var time = new Date(tx.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var row = document.createElement('div'); row.className = 'tx-row';
      var badge = document.createElement('span'); badge.className = 'tx-badge ' + typeCls; badge.textContent = typeLabel;
      var amt = document.createElement('input');
      amt.className = 'tx-amt'; amt.type = 'number'; amt.inputMode = 'decimal'; amt.value = tx.amount.toFixed(2);
      amt.addEventListener('click', function(){ if(!amt.readOnly) amt.select(); });
      amt.addEventListener('mousedown', function(e){ e.stopPropagation(); });
      var capturedIdx = idx;
      // Editing financial amounts must be explicit: a tap outside cannot
      // accidentally rewrite a buy-in or cash-out.
      amt.readOnly=true;
      amt.setAttribute('aria-label', typeLabel + ' amount in dollars');
      var originalCents=Math.round(tx.amount*100);
      var editBtn=document.createElement('button');
      editBtn.type='button';editBtn.className='tx-del';editBtn.textContent='Edit';
      editBtn.setAttribute('aria-label','Edit '+typeLabel+' amount');
      var saveBtn=document.createElement('button');
      saveBtn.type='button';saveBtn.className='tx-del';saveBtn.textContent='Save';
      saveBtn.style.display='none';
      var cancelBtn=document.createElement('button');
      cancelBtn.type='button';cancelBtn.className='tx-del';cancelBtn.textContent='Cancel';
      cancelBtn.style.display='none';
      function setEditing(enabled){
        amt.readOnly=!enabled;
        editBtn.style.display=enabled?'none':'';
        saveBtn.style.display=enabled?'':'none';
        cancelBtn.style.display=enabled?'':'none';
        if(enabled){amt.focus();amt.select();}
      }
      editBtn.addEventListener('click',function(){setEditing(true);});
      cancelBtn.addEventListener('click',function(){
        amt.value=(originalCents/100).toFixed(2);setEditing(false);
      });
      saveBtn.addEventListener('click',function(){
        var raw=amt.value.trim();
        if(!/^\\d+(?:\\.\\d{1,2})?$/.test(raw)){toast('Enter a valid dollar amount with up to two decimals');return;}
        var cents=Math.round(Number(raw)*100);
        if(!Number.isSafeInteger(cents)||cents<0){toast('Enter a valid amount');return;}
        var latest=state.players[sid];
        if(!latest||(latest.transactions||[])[capturedIdx]!==tx){
          toast('Transaction changed on this device. Review the latest record.');
          buildPanel(sid);return;
        }
        if(cents===originalCents){setEditing(false);return;}
        tx.amount=cents/100;
        tx.pkrEstimated=false;tx.pkrReconstructed=false;
        window.saveState();buildPanel(sid);renderTable();
        toast('Amount updated. Check the sync status before final settlement.');
      });
      amt.addEventListener('keydown',function(e){
        if(e.key==='Escape'){e.preventDefault();cancelBtn.click();}
        if(e.key==='Enter'&&!amt.readOnly){e.preventDefault();saveBtn.click();}
      });
      var timeEl = document.createElement('span'); timeEl.className = 'tx-time'; timeEl.textContent = time;
      var del = document.createElement('button'); del.className = 'tx-del'; del.textContent = '✕';
      del.addEventListener('click', function() {
        showConfirmModal('Delete Transaction?', typeLabel + ' of $' + tx.amount.toFixed(2) + ' for ' + p.name, 'Delete', function() {
          var p2 = state.players[sid]; if (!p2) return;
          p2.transactions.splice(capturedIdx, 1);
          window.saveState(); buildPanel(sid); renderTable();
        });
      });
      row.append(badge, amt, editBtn, saveBtn, cancelBtn, timeEl, del);
      txList.appendChild(row);
    });
  }
  body.appendChild(txList);

  // Buy-in
  var biSec = document.createElement('div'); biSec.className = 'psec'; biSec.textContent = 'Buy-in';
  body.appendChild(biSec);
  var biRow = document.createElement('div'); biRow.className = 'add-row';
  var biInp = document.createElement('input');
  biInp.className = 'add-inp'; biInp.type = 'number'; biInp.inputMode = 'decimal'; biInp.placeholder = 'Amount'; biInp.id = 'biInput';
  if (state.game && state.game.defaultBuyin) biInp.value = state.game.defaultBuyin;
  var biBtn = document.createElement('button'); biBtn.className = 'add-btn'; biBtn.textContent = '+ Buy In';
  biBtn.addEventListener('click', function(){ addTxFromInput(sid, 'buyin', biInp); });
  biInp.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); addTxFromInput(sid, 'buyin', biInp); } });
  biRow.append(biInp, biBtn); body.appendChild(biRow);

  // Cash Out
  var coSec = document.createElement('div'); coSec.className = 'psec'; coSec.textContent = 'Cash Out';
  body.appendChild(coSec);
  var coRow = document.createElement('div'); coRow.className = 'add-row';
  var coInp = document.createElement('input');
  coInp.className = 'add-inp'; coInp.type = 'number'; coInp.inputMode = 'decimal'; coInp.placeholder = 'Amount'; coInp.id = 'coInput';
  var coBtn = document.createElement('button'); coBtn.className = 'add-btn g'; coBtn.textContent = 'Cash Out';
  coBtn.addEventListener('click', function(){ addTxFromInput(sid, 'cashout', coInp); });
  coInp.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); addTxFromInput(sid, 'cashout', coInp); } });
  coRow.append(coInp, coBtn); body.appendChild(coRow);

  // WhatsApp
  var waSec = document.createElement('div'); waSec.className = 'psec'; waSec.textContent = 'WhatsApp';
  body.appendChild(waSec);
  var phone = getPhone(p.name);
  if (phone) {
    var gameName = state.game ? state.game.name : 'Poker Night';
    var balMsg = 'Hey ' + p.name + '! Update from ' + gameName + ' - balance: ' + fmtNet(net);
    var preview = document.createElement('div');
    preview.style.cssText = 'background:#0a1f0c;border:1px solid rgba(201,168,76,0.15);border-radius:6px;padding:8px 10px;margin-bottom:7px;font-size:0.88rem;color:var(--cream2);line-height:1.5';
    preview.textContent = balMsg;
    body.appendChild(preview);
    var waLink = document.createElement('a');
    waLink.className = 'wa-btn'; waLink.href = waUrl(phone, balMsg); waLink.target = '_blank';
    waLink.textContent = 'Send Balance Update';
    body.appendChild(waLink);
  } else {
    var noNum = document.createElement('div');
    noNum.style.cssText = 'font-size:0.85rem;color:var(--muted);padding:4px 0 8px';
    noNum.textContent = 'No number saved — add when seating player.';
    body.appendChild(noNum);
  }

  // Link User Account
  var linkSec = document.createElement('div'); linkSec.className = 'psec'; linkSec.textContent = 'Linked Account';
  body.appendChild(linkSec);
  var pkrCtxL = getPkrCtx();
  var seatedInfo = pkrCtxL ? _pkrSeatedPlayers[sid] : null;
  var currentUserId = seatedInfo ? seatedInfo.user_id : null;
  // Fallback: find user_id from dbPlayers by seat number
  if (!currentUserId) {
    var seatNum = parseInt(sid.replace('seat',''));
    var ctx2 = getPkrCtx();
    var dbPlayers = (ctx2 && ctx2.dbPlayers) || [];
    var dbP = dbPlayers.find(function(p){ return p.seat_number===seatNum; });
    if (dbP && dbP.user_id) {
      currentUserId = dbP.user_id;
      _pkrSeatedPlayers[sid] = {user_id:dbP.user_id, name:dbP.display_name};
    }
  }
  var isLinked = currentUserId && !currentUserId.startsWith('manual_') && !currentUserId.startsWith('rsvp_');
  var linkWrap = document.createElement('div');
  linkWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  if (isLinked) {
    // Show linked status + unlink button (host only)
    var linkedName = (window._eventMembers||[]).find(function(m){return m.id===currentUserId;});
    var linkedLabel = document.createElement('div');
    linkedLabel.style.cssText = 'font-size:0.85rem;color:var(--green);padding:4px 0';
    linkedLabel.textContent = '✓ Linked to ' + (linkedName ? linkedName.name : currentUserId);
    linkWrap.appendChild(linkedLabel);
    if (pkrCtxL && pkrCtxL.isHost) {
      var unlinkBtn = document.createElement('button');
      unlinkBtn.className = 'add-btn'; unlinkBtn.textContent = 'Unlink Account';
      unlinkBtn.style.cssText = 'background:rgba(231,76,60,0.15);border-color:rgba(231,76,60,0.4);color:#e74c3c;font-size:0.82rem';
      unlinkBtn.addEventListener('click', async function() {
        unlinkBtn.disabled = true; unlinkBtn.textContent = 'Unlinking…';
        try {
          var r = await pkrApi('/games/' + pkrCtxL.gameId + '/players/' + currentUserId + '/unlink', {method:'PUT'});
          if (r.players) { r.players.forEach(function(p){ if(p.seat_number) _pkrSeatedPlayers['seat'+p.seat_number]={user_id:p.user_id,name:p.display_name}; }); renderTable(); }
          closePanel();
        } catch(e) { unlinkBtn.disabled=false; unlinkBtn.textContent='Unlink Account'; toast('Failed to unlink'); }
      });
      linkWrap.appendChild(unlinkBtn);
    }
  } else {
    // Host: show member dropdown to link
    if (pkrCtxL && pkrCtxL.isHost && (window._eventMembers||[]).length > 0) {
      var sel = document.createElement('select');
      sel.style.cssText = 'width:100%;padding:8px 10px;background:#0d1a0f;border:1px solid var(--border);border-radius:6px;color:var(--cream);font-size:0.88rem;margin-bottom:4px';
      var defOpt = document.createElement('option'); defOpt.value=''; defOpt.textContent='— Select member to link —';
      sel.appendChild(defOpt);
      (window._eventMembers||[]).forEach(function(m) {
        var opt = document.createElement('option'); opt.value=m.id; opt.textContent=m.name+(m.email?' ('+m.email+')':'');
        sel.appendChild(opt);
      });
      linkWrap.appendChild(sel);
      var doLinkBtn = document.createElement('button');
      doLinkBtn.className = 'add-btn'; doLinkBtn.textContent = 'Link Account';
      doLinkBtn.addEventListener('click', async function() {
        if (!sel.value) { toast('Select a member first'); return; }
        doLinkBtn.disabled=true; doLinkBtn.textContent='Linking…';
        try {
          var r = await pkrApi('/games/' + pkrCtxL.gameId + '/players/' + (currentUserId||sid) + '/link', {method:'PUT', body:JSON.stringify({real_user_id:sel.value})});
          if (r.players) { r.players.forEach(function(p){ if(p.seat_number) _pkrSeatedPlayers['seat'+p.seat_number]={user_id:p.user_id,name:p.display_name}; }); renderTable(); }
          closePanel();
        } catch(e) { doLinkBtn.disabled=false; doLinkBtn.textContent='Link Account'; toast('Failed to link'); }
      });
      linkWrap.appendChild(doLinkBtn);
    }
    // Self-claim: logged-in user can claim their own seat
    if (pkrCtxL && pkrCtxL.userId && !pkrCtxL.isHost) {
      var claimBtn = document.createElement('button');
      claimBtn.className = 'add-btn g'; claimBtn.textContent = '👤 This is me';
      claimBtn.style.cssText = 'font-size:0.88rem';
      claimBtn.addEventListener('click', async function() {
        claimBtn.disabled=true; claimBtn.textContent='Claiming…';
        try {
          var r = await pkrApi('/games/' + pkrCtxL.gameId + '/players/' + (currentUserId||sid) + '/link', {method:'PUT', body:JSON.stringify({real_user_id:pkrCtxL.userId})});
          if (r.players) { r.players.forEach(function(p){ if(p.seat_number) _pkrSeatedPlayers['seat'+p.seat_number]={user_id:p.user_id,name:p.display_name}; }); renderTable(); }
          closePanel(); toast('Seat linked to your account!');
        } catch(e) { claimBtn.disabled=false; claimBtn.textContent='👤 This is me'; toast('Failed to claim seat'); }
      });
      linkWrap.appendChild(claimBtn);
    }
    if (!(pkrCtxL && pkrCtxL.isHost) && !(pkrCtxL && pkrCtxL.userId && !pkrCtxL.isHost)) {
      var noLinkMsg = document.createElement('div');
      noLinkMsg.style.cssText = 'font-size:0.85rem;color:var(--muted);padding:4px 0';
      noLinkMsg.textContent = 'Not linked to a user account.';
      linkWrap.appendChild(noLinkMsg);
    }
  }
  body.appendChild(linkWrap);

  // Player QR Code
  var qrSec = document.createElement('div'); qrSec.className = 'psec'; qrSec.textContent = 'Player QR Code';
  body.appendChild(qrSec);
  var qrNote = document.createElement('div');
  qrNote.style.cssText = 'font-size:0.82rem;color:var(--muted);margin-bottom:8px;line-height:1.5';
  qrNote.textContent = p.name + ' can scan this to watch their live balance.';
  body.appendChild(qrNote);
  var qrWrap = document.createElement('div');
  qrWrap.style.cssText = 'display:flex;justify-content:center;margin-bottom:6px';
  var qrCanvas = document.createElement('canvas');
  qrCanvas.style.cssText = 'border-radius:6px;background:#fff;padding:6px';
  qrWrap.appendChild(qrCanvas);
  body.appendChild(qrWrap);
  var _ctx2 = getPkrCtx();
  var playerUrl = _ctx2 && _ctx2.gameId ? window.location.origin + '/games/live/' + _ctx2.gameId : window.location.href;
  var qrUrlEl = document.createElement('div');
  qrUrlEl.style.cssText = 'font-size:0.78rem;text-align:center;color:var(--muted);word-break:break-all;line-height:1.4;margin-bottom:4px';
  qrUrlEl.textContent = playerUrl;
  body.appendChild(qrUrlEl);
  if (window.QRCode) {
    requestAnimationFrame(function() {
      qrCanvas.width = 130; qrCanvas.height = 130;
      try {
        var tmp = document.createElement('div');
        tmp.style.cssText = 'position:absolute;left:-9999px';
        document.body.appendChild(tmp);
        new QRCode(tmp, { text: playerUrl, width: 130, height: 130, colorDark: '#000000', colorLight: '#ffffff' });
        setTimeout(function() {
          var img = tmp.querySelector('img') || tmp.querySelector('canvas');
          if (img) {
            var qrCtx = qrCanvas.getContext('2d');
            qrCtx.fillStyle = '#fff'; qrCtx.fillRect(0,0,130,130);
            var draw = function(){ qrCtx.drawImage(img, 0, 0, 130, 130); if (tmp.parentNode) tmp.parentNode.removeChild(tmp); };
            if (img.tagName === 'CANVAS' || img.complete) draw(); else { img.onload = draw; }
          }
        }, 100);
      } catch(e) {}
    });
  }

  // Change Seat
  var csSec = document.createElement('div'); csSec.className = 'psec'; csSec.textContent = 'Change Seat';
  body.appendChild(csSec);
  var csGrid = document.createElement('div');
  csGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px';
  var totalSeats = state.game ? state.game.seats : 9;
  for (var si = 1; si <= totalSeats; si++) {
    var tSid = 'seat' + si;
    if (tSid === sid) continue;
    var occ = state.players[tSid] && state.players[tSid].name;
    var btn = document.createElement('button');
    btn.style.cssText = 'padding:5px 9px;font-size:0.82rem;border-radius:5px;cursor:pointer;font-family:DM Sans,sans-serif;border:1px solid ' + (occ ? 'rgba(231,76,60,0.35)' : 'rgba(201,168,76,0.3)') + ';background:' + (occ ? 'rgba(231,76,60,0.08)' : 'rgba(201,168,76,0.07)') + ';color:' + (occ ? 'var(--red)' : 'var(--gold)');
    btn.textContent = 'Seat ' + si + (occ ? ' (' + inits(state.players[tSid].name) + ')' : ' empty');
    (function(capturedTSid) {
      btn.addEventListener('click', function() {
        if (state.players[capturedTSid] && state.players[capturedTSid].name) {
          var tmp = state.players[capturedTSid]; state.players[capturedTSid] = state.players[sid]; state.players[sid] = tmp;
        } else {
          state.players[capturedTSid] = state.players[sid]; state.players[sid] = null;
        }
        saveState(); renderTable(); window.openPanel(capturedTSid);
      });
    })(tSid);
    csGrid.appendChild(btn);
  }
  body.appendChild(csGrid);

  // Remove Player
  var rmSec = document.createElement('div'); rmSec.className = 'psec'; rmSec.textContent = 'Remove Player';
  body.appendChild(rmSec);
  var rmBtn = document.createElement('button'); rmBtn.className = 'remove-btn'; rmBtn.textContent = 'Remove from Seat';
  rmBtn.addEventListener('click', function() {
    rmBtn.style.display = 'none';
    var confirmRow = document.createElement('div');
    confirmRow.style.cssText = 'display:flex;gap:7px;align-items:center';
    var confirmMsg = document.createElement('span'); confirmMsg.style.cssText = 'font-size:0.85rem;color:var(--red);flex:1'; confirmMsg.textContent = 'Remove ' + p.name + '?';
    var yesBtn2 = document.createElement('button');
    yesBtn2.style.cssText = 'background:rgba(231,76,60,0.15);border:1px solid rgba(231,76,60,0.4);color:var(--red);padding:7px 12px;border-radius:6px;font-family:DM Sans,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer';
    yesBtn2.textContent = 'Yes, Remove';
    var cancelBtn2 = document.createElement('button');
    cancelBtn2.style.cssText = 'background:none;border:1px solid var(--border);color:var(--muted);padding:7px 10px;border-radius:6px;font-family:DM Sans,sans-serif;font-size:0.88rem;cursor:pointer';
    cancelBtn2.textContent = 'Cancel';
    yesBtn2.addEventListener('click', function() {
      state.players[sid] = null; saveState(); window.closePanel(); renderTable(); toast(p.name + ' removed');
    });
    cancelBtn2.addEventListener('click', function() { confirmRow.remove(); rmBtn.style.display = ''; });
    confirmRow.append(confirmMsg, yesBtn2, cancelBtn2);
    body.appendChild(confirmRow);
  });
  body.appendChild(rmBtn);
}

// ── Transactions ──
function addTxFromInput(sid, type, inp) {
  var p = state.players[sid]; if (!p) return;
  var amt = parseFloat(inp ? inp.value : 0);
  if (isNaN(amt) || amt < 0) { toast('Enter a valid amount'); return; }
  if (amt === 0 && type !== 'cashout') { toast('Buy-in must be greater than 0'); return; }
  p.transactions = p.transactions || [];
  p.transactions.push({ type: type, amount: amt, ts: Date.now() });
  saveState();
  updateSaveResultsBtn();
  if (inp) inp.value = '';
  buildPanel(sid);
  renderTable();
  updateSaveResultsBtn();
  var gameName = state.game ? state.game.name : 'Poker Night';
  var pushTitle, pushBody;
  if (type === 'buyin') { pushTitle = '♠ Buy-in — $' + amt.toFixed(2); pushBody = p.name + ' is in at ' + gameName + '. Good luck!'; }
  else { pushTitle = '♠ Cashed out — $' + amt.toFixed(2); pushBody = p.name + ' finishes ' + fmtNet(pNet(p)) + ' at ' + gameName; }
  notifyPlayer(p.name, pushTitle, pushBody).catch(function(e){ /* push not configured */ });
  var phone = getPhone(p.name);
  if (phone) {
    var msg = type === 'buyin'
      ? '♠ Hi ' + p.name + '! Buy-in: $' + amt.toFixed(2) + ' at ' + gameName + '. Good luck! 🃏'
      : '♠ ' + p.name + ' — cashed out $' + amt.toFixed(2) + ' at ' + gameName + '. Net: ' + fmtNet(pNet(p)) + ' 🃏';
    window.showWaToast(phone, msg);
  }
}

// ── Assign ──
var assigningSid = null;

window.openAssign = function openAssign(sid) {
  assigningSid = sid;
  var nameInp = document.getElementById('assignName');
  var phoneInp = document.getElementById('assignPhone');
  if (nameInp) nameInp.value = '';
  if (phoneInp) phoneInp.value = '';
  // Load known players
  var seated = new Set(Object.values(state.players).filter(function(p){ return p && p.name; }).map(function(p){ return p.name.toLowerCase(); }));
  var wrap = document.getElementById('knownWrap');
  var list = document.getElementById('knownList');
  var ctx = getPkrCtx();
  function renderKnownPlayers(names) {
    if (!list) return;
    if (names.length) {
      list.innerHTML = names.map(function(n){ return '<button class="known-chip' + (seated.has(n.toLowerCase()) ? ' seated' : '') + '" data-name="' + esc(n) + '">' + esc(n) + '</button>'; }).join('');
      list.querySelectorAll('.known-chip:not(.seated)').forEach(function(btn) {
        btn.addEventListener('click', function() {
          if (nameInp) nameInp.value = btn.dataset.name;
          var ph = getPhone(btn.dataset.name);
          if (phoneInp) phoneInp.value = ph && ph.startsWith('61') ? '0' + ph.slice(2) : ph;
        });
      });
      if (wrap) wrap.style.display = 'block';
    } else {
      if (wrap) wrap.style.display = 'none';
    }
  }
  window._assignLinkedUserId = null;
  var membersWrap = document.getElementById('membersWrap');
  var membersList = document.getElementById('membersList');
  function renderMembers(members) {
    if (!membersList || !membersWrap) return;
    var avail = (members||[]).filter(function(m){ return !seated.has((m.name||'').toLowerCase()) && m.id !== (ctx&&ctx.userId); });
    if (!avail.length) { membersWrap.style.display='none'; return; }
    membersWrap.style.display = 'block';
    membersList.innerHTML = avail.map(function(m){
      return '<button class="known-chip member-chip" data-name="'+esc(m.name)+'" data-uid="'+esc(m.id)+'">'+esc(m.name)+'</button>';
    }).join('');
    membersList.querySelectorAll('.member-chip').forEach(function(btn){
      btn.addEventListener('click', function(){
        if (nameInp) nameInp.value = btn.dataset.name;
        window._assignLinkedUserId = btn.dataset.uid || null;
        var ph = getPhone(btn.dataset.name);
        if (phoneInp) phoneInp.value = ph&&ph.startsWith('61')?'0'+ph.slice(2):ph;
        membersList.querySelectorAll('.member-chip').forEach(function(b){ b.style.background=''; b.style.color=''; });
        btn.style.background='rgba(201,168,76,0.15)'; btn.style.color='var(--gold)';
      });
    });
  }
  if (ctx && ctx.eventId) {
    Promise.all([
      pkrApi('/events/'+ctx.eventId).catch(function(){ return null; }),
      pkrApi('/events/'+ctx.eventId+'/players').catch(function(){ return []; })
    ]).then(function(res){
      renderMembers(res[0]&&res[0].members ? res[0].members : []);
      renderKnownPlayers((res[1]||[]).map(function(p){ return p.display_name; }));
    });
  } else {
    renderKnownPlayers(getHistory());
  }
  var overlay = document.getElementById('assignOverlay');
  if (overlay) overlay.classList.add('show');
  setTimeout(function(){ if (nameInp) nameInp.focus(); }, 100);
};

window.closeAssign = function closeAssign() {
  var overlay = document.getElementById('assignOverlay');
  if (overlay) overlay.classList.remove('show');
  assigningSid = null;
};

window.confirmAssign = async function confirmAssign() {
  var nameInp = document.getElementById('assignName');
  var phoneInp = document.getElementById('assignPhone');
  var name = ((nameInp && nameInp.value) || '').trim();
  if (!name) { toast('Enter a name'); return; }
  var phone = ((phoneInp && phoneInp.value) || '').trim();
  if (phone) setPhone(name, phone);
  var sid = assigningSid;
  var existing = state.players[sid] || {};
  var linkedUserId = window._assignLinkedUserId || null;
  state.players[sid] = Object.assign({}, existing, { name: name, transactions: existing.transactions || [], linkedUserId: linkedUserId });
  saveState();
  updateSaveResultsBtn();
  window.closeAssign();
  window._assignLinkedUserId = null;
  renderTable();
  pkrSeatPlayer(sid, name, phone || null, linkedUserId).catch(function(){});
  setTimeout(function(){ window.openPanel(sid); }, 100);
};

// ── Leaderboard ──
var lbTab = 'game';

window.openLeaderboard = function() {
  lbTab = 'game';
  var tabAll = document.getElementById('lbTabAll');
  var tabGame = document.getElementById('lbTabGame');
  if (tabAll) tabAll.classList.remove('active');
  if (tabGame) tabGame.classList.add('active');
  renderLbSheet();
  var sheet = document.getElementById('lbSheet');
  if (sheet) sheet.classList.add('show');
};

window.closeLbSheet = function() {
  var sheet = document.getElementById('lbSheet');
  if (sheet) sheet.classList.remove('show');
};

window.switchLbTab = function(tab) {
  lbTab = tab;
  var tabAll = document.getElementById('lbTabAll');
  var tabGame = document.getElementById('lbTabGame');
  if (tabAll) tabAll.classList.toggle('active', tab === 'all');
  if (tabGame) tabGame.classList.toggle('active', tab === 'game');
  renderLbSheet();
};

function renderLbSheet() {
  var body = document.getElementById('lbBody');
  if (!body) return;
  if (lbTab === 'all') {
    var ctx = getPkrCtx();
    if (ctx && ctx.eventId) {
      body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px;font-size:0.82rem">Loading…</div>';
      pkrApi('/events/' + ctx.eventId + '/leaderboard').then(function(rows) {
        if (!rows || !rows.length) { body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px;font-size:0.82rem">No history yet</div>'; return; }
        body.innerHTML = rows.map(function(p, i) {
          var net = p.total_net / 100;
          var netStr = (net >= 0 ? '+$' : '-$') + Math.abs(net).toFixed(2);
          return '<div class="lb-row"><div class="lb-rank">' + (i === 0 ? '🏆' : '#' + (i+1)) + '</div><div class="lb-av">' + esc(inits(p.display_name)) + '</div><div class="lb-info"><div class="lb-name">' + esc(p.display_name) + '</div><div class="lb-sub">' + p.games_played + ' game' + (p.games_played!==1?'s':'') + '</div></div><div class="lb-net ' + (net>0?'pos':net<0?'neg':'zero') + '">' + netStr + '</div></div>';
        }).join('');
      }).catch(function(){ body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px">Could not load</div>'; });
      return;
    }
  }
  // This game
  var players = Object.entries(state.players || {}).filter(function(e){ return e[1] && e[1].name; }).map(function(e){ return { name: e[1].name, net: pNet(e[1]) }; }).sort(function(a,b){ return b.net - a.net; });
  if (!players.length) { body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:40px;font-size:0.82rem">No players yet</div>'; return; }
  body.innerHTML = players.map(function(p, i) {
    return '<div class="lb-row"><div class="lb-rank">' + (i === 0 ? '🏆' : '#' + (i+1)) + '</div><div class="lb-av">' + esc(inits(p.name)) + '</div><div class="lb-info"><div class="lb-name">' + esc(p.name) + '</div><div class="lb-sub">this game</div></div><div class="lb-net ' + nc(p.net) + '">' + fmtNet(p.net) + '</div></div>';
  }).join('');
}

// ── Settlement ──
// This is a PREVIEW of the same zero-variance rules enforced by the Worker.
// Never generate or share payments from incomplete cash-outs.
function getSettlementReadiness() {
  var players=Object.values(state.players||{}).filter(function(p){
    return p&&p.name&&pBuyin(p)>0;
  });
  var missing=players.filter(function(p){
    return !(p.transactions||[]).some(function(tx){return tx.type==='cashout';});
  });
  var totalIn=players.reduce(function(sum,p){return sum+Math.round(pBuyin(p)*100);},0);
  var totalOut=players.reduce(function(sum,p){return sum+Math.round(pCash(p)*100);},0);
  var variance=totalOut-totalIn;
  var reason='';
  if(players.length<2)reason='At least two players with buy-ins are needed.';
  else if(missing.length)reason='Cash-out still needed: '+missing.map(function(p){return p.name;}).join(', ')+'.';
  else if(variance!==0)reason='Bank does not balance. Buy-ins '+fmt(totalIn/100)+', cash-outs '+fmt(totalOut/100)+'; difference '+fmt(Math.abs(variance)/100)+'.';
  else if(_offlineQueue.length||_flushingQueue||_syncConflict||_syncError||!navigator.onLine)
    reason='Table changes must finish syncing before settlement.';
  return {ready:!reason,reason:reason,players:players,missing:missing,
    totalIn:totalIn,totalOut:totalOut,variance:variance};
}
window.getSettlementReadiness=getSettlementReadiness;

function calcSettlements(players) {
  // Use p.name OR p.display_name — support both shapes
  // Round to cents first to avoid floating point drift
  var debtors = players
    .map(function(p){ return { name: p.name||p.display_name, amount: Math.round(-p.net * 100) }; })
    .filter(function(p){ return p.amount > 0; })
    .sort(function(a,b){ return b.amount - a.amount; });
  var creditors = players
    .map(function(p){ return { name: p.name||p.display_name, amount: Math.round(p.net * 100) }; })
    .filter(function(p){ return p.amount > 0; })
    .sort(function(a,b){ return b.amount - a.amount; });
  // A mismatch is not rounding drift: do not manufacture a balanced result.
  var totalDebt = debtors.reduce(function(s,p){return s+p.amount;},0);
  var totalCred = creditors.reduce(function(s,p){return s+p.amount;},0);
  var drift = totalCred - totalDebt;
  if (drift !== 0) return [];
  var transfers = [];
  var i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    var pay = debtors[i], recv = creditors[j];
    var amt = Math.min(pay.amount, recv.amount);
    if (amt > 0) transfers.push({ from: pay.name, to: recv.name, amount: amt / 100 });
    pay.amount -= amt; recv.amount -= amt;
    if (pay.amount <= 0) i++;
    if (recv.amount <= 0) j++;
  }
  return transfers;
}

function renderSettlementsHTML(transfers) {
  if (!transfers.length) return '<div class="settle-clean">✓ Everyone is square — no transfers needed!</div>';
  return transfers.map(function(t) {
    var phone = getPhone(t.to);
    var msg = '♠ Hey ' + t.to + '! ' + t.from + ' owes you $' + t.amount.toFixed(2) + ' from ' + (state.game ? state.game.name : 'Poker Night') + '. Time to collect! 🃏';
    var waHref = phone ? waUrl(phone, msg) : '';
    return '<div class="settle-row"><div class="settle-from"><div class="settle-av">' + esc(inits(t.from)) + '</div><div class="settle-nm">' + esc(t.from) + '</div></div><div class="settle-arrow"><div class="settle-arrow-line">→</div><div class="settle-amount">$' + t.amount.toFixed(2) + '</div></div><div class="settle-to"><div class="settle-av">' + esc(inits(t.to)) + '</div><div class="settle-nm">' + esc(t.to) + '</div></div>' + (waHref ? '<a class="settle-wa" href="' + waHref + '" target="_blank">💬 Remind</a>' : '') + '</div>';
  }).join('');
}

window.openSettleUp = function() {
  var review=getSettlementReadiness();
  if(review.players.length<2){toast(review.reason);return;}
  _doOpenSettleUp(review);
};

function _doOpenSettleUp(review) {
  var transfers=review.ready?calcSettlements(review.players.map(function(p){
    return {name:p.name,net:pNet(p)};
  })):[];
  var gameName=state.game?state.game.name:'Poker Night';
  var overlay=document.createElement('div');
  overlay.className='pkr-game-review-overlay';
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-label','Review game settlement');
  overlay.style.cssText='position:fixed;inset:0;z-index:26000;background:rgba(0,0,0,0.88);display:flex;align-items:flex-end;justify-content:center;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);box-sizing:border-box';
  var box=document.createElement('div');
  box.style.cssText='background:#101e1d;border:1px solid #365450;border-radius:16px 16px 0 0;width:100%;max-width:580px;max-height:calc(100dvh - 20px - env(safe-area-inset-top));overflow:hidden;display:flex;flex-direction:column;color:#eaf0f2';
  var hdr=document.createElement('div');
  hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #365450;flex-shrink:0';
  var caption=document.createElement('div');
  var h=document.createElement('strong');h.textContent='Review Settlement';h.style.fontSize='18px';
  var sub=document.createElement('div');sub.textContent=review.ready
    ? (transfers.length?transfers.length+' payments to review':'Reconciled: no transfers needed')
    : 'Not ready for settlement';
  sub.style.cssText='font-size:12px;color:#a9bdbe;margin-top:5px';
  caption.append(h,sub);
  var closeBtn=document.createElement('button');
  closeBtn.type='button';closeBtn.textContent='Close';
  closeBtn.style.cssText='background:#243637;border:1px solid #45605b;color:#fff;border-radius:9px;min-height:44px;padding:8px 14px;cursor:pointer';
  var originalFocus=document.activeElement;
  var priorOverflow=document.body.style.overflow;
  var onKey=function(e){if(e.key==='Escape'){e.preventDefault();close();}};
  function close(){overlay.remove();document.removeEventListener('keydown',onKey);document.body.style.overflow=priorOverflow;if(originalFocus&&originalFocus.focus)originalFocus.focus();}
  closeBtn.addEventListener('click',close);
  hdr.append(caption,closeBtn);box.appendChild(hdr);
  var body=document.createElement('div');
  body.style.cssText='overflow-y:auto;overscroll-behavior:contain;flex:1;min-height:0;padding:16px 20px calc(20px + env(safe-area-inset-bottom))';
  var totals=document.createElement('div');
  totals.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px';
  [['Buy-ins',fmt(review.totalIn/100)],['Cash-outs',fmt(review.totalOut/100)]].forEach(function(item){
    var cell=document.createElement('div');
    cell.style.cssText='padding:12px;border:1px solid #365450;border-radius:9px;background:#1b2c2c';
    var title=document.createElement('small');title.textContent=item[0];title.style.cssText='display:block;color:#9fb0b9;margin-bottom:5px';
    var value=document.createElement('strong');value.textContent=item[1];
    cell.append(title,value);totals.appendChild(cell);
  });
  body.appendChild(totals);
  if(!review.ready){
    var warning=document.createElement('div');
    warning.setAttribute('role','alert');
    warning.style.cssText='padding:13px;border:1px solid #a57942;border-radius:9px;color:#ffe3b0;background:#3e3020;line-height:1.55;margin-bottom:14px;font-size:13px';
    warning.textContent=review.reason+' Review player transactions before saving or sharing payment instructions.';
    body.appendChild(warning);
  }else{
    if(!transfers.length){
      var noTransfer=document.createElement('p');noTransfer.textContent='All players have cashed out and the bank reconciles. No transfers needed.';
      body.appendChild(noTransfer);
    }
    transfers.forEach(function(t){
      var row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 0;border-bottom:1px solid #365450';
      var parties=document.createElement('span');parties.style.cssText='flex:1;min-width:170px;font-size:13px';
      parties.textContent=t.from+' pays '+t.to;
      var amount=document.createElement('b');amount.textContent=fmt(t.amount);
      row.append(parties,amount);
      var phone=getPhone(t.to);
      if(phone){
        var link=document.createElement('a');
        link.href=waUrl(phone,'PKR '+gameName+': '+t.from+' pays '+t.to+' '+fmt(t.amount));
        link.target='_blank';link.rel='noopener noreferrer';
        link.textContent='Message';link.style.cssText='color:#3ddc97;padding:9px';
        row.appendChild(link);
      }
      body.appendChild(row);
    });
    if(transfers.length && !window._pkrResultsSaved){
      var previewNote=document.createElement('p');previewNote.textContent='Preview only. Save results first to enable sharing payment instructions.';
      previewNote.style.cssText='color:#a9bdbe;font-size:13px;margin-top:16px';body.appendChild(previewNote);
    }
    if(transfers.length && window._pkrResultsSaved){
      var shareBtn=document.createElement('button');shareBtn.type='button';shareBtn.textContent='Share payment instructions';
      shareBtn.style.cssText='width:100%;margin-top:16px;background:#3ddc97;color:#0b0f12;border:0;border-radius:10px;min-height:48px;font-weight:750;cursor:pointer';
      shareBtn.addEventListener('click',function(){
        var latest=getSettlementReadiness();
        if(!latest.ready){toast(latest.reason);close();return;}
        var latestTransfers=calcSettlements(latest.players.map(function(p){return {name:p.name,net:pNet(p)};}));
        var text=[gameName+' - Settlement',...latestTransfers.map(function(t){return t.from+' pays '+t.to+' '+fmt(t.amount);})].join(String.fromCharCode(10));
        if(navigator.share)navigator.share({text:text}).catch(function(){});
        else if(navigator.clipboard)navigator.clipboard.writeText(text).then(function(){toast('Payment instructions copied');}).catch(function(){toast('Could not copy payment instructions');});
        else window.prompt('Copy payment instructions:',text);
      });
      body.appendChild(shareBtn);
    }
  }
  overlay.appendChild(box);box.appendChild(body);
  overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
  document.addEventListener('keydown',onKey);
  document.body.style.overflow='hidden';
  document.body.appendChild(overlay);
  closeBtn.focus();
}

// ── Publish / Share Results ──
window.openPublish = function() {
  var review=getSettlementReadiness();
  if(!review.ready){toast(review.reason);window.openSettleUp();return;}
  if(!window._pkrResultsSaved){toast('Save results before sharing final results.');return;}
  var players = Object.values(state.players || {}).filter(function(p){ return p && p.name && pBuyin(p) > 0; }).map(function(p){ return { name: p.name, net: pNet(p), bi: pBuyin(p), co: pCash(p) }; }).sort(function(a,b){ return b.net - a.net; });
  if (!players.length) { toast('No players yet'); return; }
  var transfers = calcSettlements(players);
  var gameName = state.game ? state.game.name : 'Poker Night';
  // Build preview HTML
  var standingsHtml = players.map(function(p){ return '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(201,168,76,0.06)"><span style="color:var(--cream2);font-size:0.9rem">' + esc(p.name) + '</span><span class="' + nc(p.net) + '" style="font-weight:700;font-size:0.82rem">' + fmtNet(p.net) + '</span></div>'; }).join('');
  var settleHtml = transfers.length
    ? '<div style="font-size:0.88rem;text-transform:uppercase;letter-spacing:2px;color:var(--gold-dim);margin:10px 0 6px;padding-top:8px;border-top:1px solid var(--border)">💸 Settlements</div>' + transfers.map(function(t){ return '<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:var(--red);font-size:0.9rem">' + esc(t.from) + '</span><span style="color:var(--muted);font-size:0.88rem">→ $' + t.amount.toFixed(2) + ' →</span><span style="color:var(--green);font-size:0.9rem">' + esc(t.to) + '</span></div>'; }).join('')
    : '<div style="font-size:0.88rem;color:var(--green);padding:6px 0;border-top:1px solid var(--border)">✓ No transfers needed</div>';
  var previewEl = document.getElementById('publishPreview');
  if (previewEl) previewEl.innerHTML = standingsHtml + settleHtml;
  // Build shareable text
  var ctx = getPkrCtx();
  var resultsUrl = ctx ? (window.location.origin + '/games/' + ctx.gameId + '/results/' + ctx.gameId) : window.location.href;
  // Try to get results_token from PKR
  if (ctx && ctx.gameId) {
    pkrApi('/games/' + ctx.gameId).then(function(game) {
      if (game && game.results_token) {
        resultsUrl = window.location.origin + '/games/results/' + game.results_token;
      }
      var urlInp = document.getElementById('publishUrl');
      if (urlInp) urlInp.value = resultsUrl;
      var shareBtn = document.getElementById('waGroupShareBtn');
      if (shareBtn) {
        shareBtn.dataset.shareUrl = resultsUrl;
        shareBtn.dataset.shareText = '♠ ' + gameName + ' results: ' + resultsUrl;
      }
    }).catch(function(){
      var urlInp = document.getElementById('publishUrl');
      if (urlInp) urlInp.value = resultsUrl;
    });
  }
  var sheet = document.getElementById('publishSheet');
  if (sheet) sheet.classList.add('show');
};

window.closePublish = function() {
  var sheet = document.getElementById('publishSheet');
  if (sheet) sheet.classList.remove('show');
};

window.sharePublishResults = function() {
  var shareBtn = document.getElementById('waGroupShareBtn');
  var urlInp = document.getElementById('publishUrl');
  var url = (shareBtn && shareBtn.dataset.shareUrl) || (urlInp && urlInp.value) || window.location.href;
  var text = (shareBtn && shareBtn.dataset.shareText) || ('♠ Game results: ' + url);
  if (navigator.share) navigator.share({ text: text, url: url }).catch(function(){});
  else { navigator.clipboard.writeText(text).catch(function(){}); toast('Copied!'); }
};

// ── Share live table ──
window.openShare = function() {
  var ctx = getPkrCtx();
  var liveToken = ctx && ctx.gameId ? ctx.gameId : '';
  var url = liveToken ? window.location.origin + '/games/live/' + liveToken : window.location.origin;
  var urlEl = document.getElementById('shareUrl');
  var lblEl = document.getElementById('shareUrlLabel');
  var qrCanvas = document.getElementById('shareQR');
  if (urlEl) urlEl.textContent = url;
  if (lblEl) lblEl.textContent = '🔗 Live scoreboard — read only';
  if (qrCanvas && window.QRCode) {
    qrCanvas.width = 160; qrCanvas.height = 160;
    try {
      var tmp = document.createElement('div');
      tmp.style.cssText = 'position:absolute;left:-9999px';
      document.body.appendChild(tmp);
      new QRCode(tmp, { text: url, width: 160, height: 160, colorDark: '#000000', colorLight: '#ffffff' });
      setTimeout(function() {
        var img = tmp.querySelector('img') || tmp.querySelector('canvas');
        if (img) {
          var ctx2 = qrCanvas.getContext('2d');
          ctx2.fillStyle = '#fff'; ctx2.fillRect(0,0,160,160);
          var draw = function(){ ctx2.drawImage(img, 0, 0, 160, 160); if (tmp.parentNode) tmp.parentNode.removeChild(tmp); };
          if (img.tagName === 'CANVAS' || img.complete) draw();
          else { img.onload = draw; }
        }
      }, 100);
    } catch(e) {}
  }
  var sheet = document.getElementById('shareSheet');
  if (sheet) sheet.classList.add('show');
};

window.closeShare = function() {
  var sheet = document.getElementById('shareSheet');
  if (sheet) sheet.classList.remove('show');
};

window.shareLink = async function(url, text) {
  if (navigator.share) { try { await navigator.share({ title: '♠ PKR', text: text || '', url: url }); return; } catch(e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text ? text + '\\n' + url : url); toast('Copied!'); } catch(e) { window.prompt('Copy this link:', url); }
};

// ── Save Results ──
window.updateSaveResultsBtn = function updateSaveResultsBtn() {
  var btn=document.getElementById('saveResultsBtn');
  if(!btn)return;
  var ctx=getPkrCtx();
  var ready=!!(ctx&&ctx.gameId&&state.game&&!window._pkrResultsSaved&&getSettlementReadiness().ready);
  // Never advertise a bulk cash-out as a quick action. Individual cash-out
  // remains available from the seat panel, while final saving is strictly
  // gated by zero bank variance and successful sync/reconciliation.
  btn.style.display=ready?'flex':'none';
  btn.setAttribute('aria-hidden',ready?'false':'true');
  btn.disabled=!ready;
  btn.innerHTML='<span class="game-tab-icon">✅</span> Save Results';
  btn.title=ready?'All players cashed out; bank balanced and synced. Save final results.':
    'Save Results unlocks only when all cash-outs and bank reconciliation are complete.';
};
var updateSaveResultsBtn = window.updateSaveResultsBtn;

window.saveResultsToPkr = async function() {
  var ctx = getPkrCtx();
  if (!ctx || !ctx.gameId) { toast('No PKR game found'); return; }
  var review=getSettlementReadiness();
  if(!review.ready){toast(review.reason);window.openSettleUp();return;}
  var btn = document.getElementById('saveResultsBtn');
  if (btn) { btn.innerHTML = '<span class="game-tab-icon">⏳</span>Saving…'; btn.disabled = true; }
  try {
    if (!navigator.onLine) throw new Error('You are offline. Reconnect before saving results.');
    await window.pkrSyncPendingActions();
    if (window.pkrHasPendingActions() || _syncError || _syncConflict) {
      throw new Error('Some table changes are still unsynced. Please resolve the sync warning first.');
    }
    var finalReview=getSettlementReadiness();
    if(!finalReview.ready)throw new Error(finalReview.reason);
    var ok = await window.syncSettleToPkr();
    if (ok) {
      if (btn) btn.innerHTML = '<span class="game-tab-icon">✅</span>Saved!';
      toast('Results saved to PKR ✓');
      window._pkrResultsSaved = true;
      var endBtn = document.getElementById('endGameBtn');
      if (endBtn) { endBtn.style.color = 'var(--green)'; }
    } else {
      throw new Error('No player data to save');
    }
  } catch(e) {
    if (btn) { btn.innerHTML = '<span class="game-tab-icon">✅</span>Save Results'; btn.disabled = false; }
    toast('⚠️ Save failed: ' + (e.message||'check connection'));
  }
};

// ── End Game ──
window._pkrResultsSaved = false;
window.endGame = function() {
  var ctx = getPkrCtx();
  if (!window._pkrResultsSaved) {
    var saveBtn = document.getElementById('saveResultsBtn');
    var saveVisible = saveBtn && saveBtn.style.display !== 'none' && getSettlementReadiness().ready;
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:26000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom));overflow-y:auto;box-sizing:border-box';
    var box = document.createElement('div');
    box.style.cssText = 'background:#1a0a0a;border:1px solid rgba(231,76,60,0.5);border-radius:16px;padding:24px;width:100%;max-width:320px;max-height:100%;overflow-y:auto;text-align:center';
    box.innerHTML = '<div style="font-size:2rem;margin-bottom:12px">⚠️</div><div style="font-size:1rem;font-weight:700;color:#ff6b5b;margin-bottom:10px">Save Results First</div><div style="font-size:0.88rem;color:#d4c4a0;margin-bottom:20px;line-height:1.6">' + (saveVisible ? 'Tap <strong style="color:#c9a84c">Save Results ✅</strong> before ending.' : 'Cash out all players first, then tap <strong style="color:#c9a84c">Save Results ✅</strong>.') + '</div>' + (saveVisible ? '<button id="pkrGoSave" style="width:100%;background:linear-gradient(135deg,#1e6b2a,#0f4a1a);color:#fff;border:none;padding:13px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;margin-bottom:10px">✅ Save Results Now</button>' : '') + '<button id="pkrEndBlockClose" style="width:100%;background:none;border:1px solid rgba(201,168,76,0.2);color:#6b8c6e;padding:12px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;cursor:pointer">OK</button>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    var closeBtn = document.getElementById('pkrEndBlockClose');
    if (closeBtn) closeBtn.addEventListener('click', function(){ overlay.remove(); });
    var goSaveBtn = document.getElementById('pkrGoSave');
    if (goSaveBtn) goSaveBtn.addEventListener('click', function(){ overlay.remove(); window.saveResultsToPkr(); });
    overlay.addEventListener('click', function(e){ if (e.target === overlay) overlay.remove(); });
    return;
  }
  var overlay2 = document.createElement('div');
  overlay2.style.cssText = 'position:fixed;inset:0;z-index:26000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom));overflow-y:auto;box-sizing:border-box';
  var box2 = document.createElement('div');
  box2.style.cssText = 'background:#1a0a0a;border:1px solid rgba(46,204,113,0.3);border-radius:16px;padding:24px;width:100%;max-width:320px;max-height:100%;overflow-y:auto';
  box2.innerHTML = '<div style="font-size:1.1rem;font-weight:700;color:#2ecc71;margin-bottom:10px">🏁 End Game?</div><div style="font-size:0.9rem;color:#d4c4a0;margin-bottom:20px;line-height:1.6">Results are saved ✓. This will close the table and open the game summary, where the host can send settlement notifications.</div><button id="pkrEndYes" style="width:100%;background:linear-gradient(135deg,#1e6b2a,#0f4a1a);color:#fff;border:none;padding:13px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;margin-bottom:10px">Yes, End Game</button><button id="pkrEndNo" style="width:100%;background:none;border:1px solid rgba(201,168,76,0.2);color:#6b8c6e;padding:12px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;cursor:pointer">Cancel</button>';
  overlay2.appendChild(box2);
  document.body.appendChild(overlay2);
  document.getElementById('pkrEndNo').addEventListener('click', function(){ overlay2.remove(); });
  document.getElementById('pkrEndYes').addEventListener('click', function() {
    state.game = null; state.players = {};
    saveState();
    localStorage.removeItem('pkrCtx');
    window._pkrResultsSaved = false;
    overlay2.remove();
    var eventId = ctx && ctx.eventId;
    // Results already saved and the game is settled. Return to this game's
    // summary so the host can explicitly dispatch personalised settlement
    // notifications, without touching the approved green poker table.
    if (ctx && ctx.gameId) window.location.href = '/games/' + encodeURIComponent(ctx.gameId);
    else if (eventId) window.location.href = '/events/' + encodeURIComponent(eventId);
    else window.location.href = '/dashboard';
  });
  overlay2.addEventListener('click', function(e){ if (e.target === overlay2) overlay2.remove(); });
};

// ── Notification banner ──
function maybeShowNotifBanner() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
  setTimeout(function() {
    var banner = document.getElementById('notifBanner');
    if (banner) banner.style.display = '';
  }, 3000);
}

document.addEventListener('click', function(e) {
  var notifBtn = document.getElementById('notifEnableBtn');
  if (e.target === notifBtn) {
    var banner = document.getElementById('notifBanner');
    if (banner) banner.style.display = 'none';
    Notification.requestPermission().then(function(perm) {
      if (perm === 'granted') {
        var ctx = getPkrCtx();
        pkrPushForPlayer(ctx && ctx.userName || 'Host').then(function(){ toast('Notifications enabled!'); });
      }
    });
  }
});

// ── Click-outside handlers ──
document.addEventListener('click', function(e) {
  var assignOverlay = document.getElementById('assignOverlay');
  if (e.target === assignOverlay) window.closeAssign();
  var lbSheet = document.getElementById('lbSheet');
  if (e.target === lbSheet) window.closeLbSheet();
  var shareSheet = document.getElementById('shareSheet');
  if (e.target === shareSheet) window.closeShare();
  var publishSheet = document.getElementById('publishSheet');
  if (e.target === publishSheet) window.closePublish();
  var tournamentSheet = document.getElementById('tournamentSheet');
  if (e.target === tournamentSheet) { window.closeTournament && window.closeTournament(); }
  var rabbitSheet = document.getElementById('rabbitSheet');
  if (e.target === rabbitSheet) { window.closeRabbitHunt && window.closeRabbitHunt(); }
  var seatSheet = document.getElementById('seatSheet');
  if (e.target === seatSheet) { window.closeSeatRandomiser && window.closeSeatRandomiser(); }
});

// ── Assign name input: auto-fill phone ──
var assignNameInp = document.getElementById('assignName');
if (assignNameInp) {
  assignNameInp.addEventListener('input', function() {
    var n = assignNameInp.value.trim();
    if (!n) return;
    var ph = getPhone(n);
    var phoneInp = document.getElementById('assignPhone');
    if (ph && phoneInp) phoneInp.value = ph.startsWith('61') ? '0' + ph.slice(2) : ph;
  });
  assignNameInp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') window.confirmAssign();
  });
}

// ── Boot: load state and init game from PKR ──
loadState();
_pkrLastSnapshot = _pkrSnapshotPlayers();

var ctx = getPkrCtx();
if (ctx && ctx.gameId) {
  // Fetch live game from PKR to build/sync state
  pkrApi('/games/' + ctx.gameId).then(function(game) {
    if (!game) return;
    // Restore the server-confirmed saved state after a device refresh.
    if(game.status==='settled')window._pkrResultsSaved=true;
    // Load event members and determine isHost
    if (game.event_id) {
      pkrApi('/events/' + game.event_id).then(function(ev) {
        if (!ev) return;
        window._eventMembers = ev.members || [];renderTable();
        // Determine if current user is host/cohost
        var me = ctx.userId;
        var myRole = (ev.members||[]).find(function(m){ return m.id === me; });
        var isHost = myRole && (myRole.role === 'host' || myRole.role === 'cohost');
        // Update pkrCtx with isHost
        var c = getPkrCtx();
        if (c) { c.isHost = !!isHost; localStorage.setItem('pkrCtx', JSON.stringify(c)); }
      }).catch(function(){});
    }
    // Refresh display-only game configuration from the server, including
    // chip value and hand tracking. This is never a financial or seat write.
    if(state.game){
      ['chip_value','starting_chips','hand_tracking','small_blind','big_blind'].forEach(function(field){
        if(game[field]!==undefined&&game[field]!==null)state.game[field]=game[field];
      });
      if(Number(game.buy_in)>0){
        state.game.defaultBuyin=game.buy_in/100;
        // Bank size is a separate display denomination. Never overwrite a
        // host-selected bank size with the room's default buy-in amount.
        if(!(Number(state.game.bank_size)>0))
          state.game.bank_size=Number(game.bank_size)>0?Number(game.bank_size):game.buy_in/100;
      }
      _origSaveState();
    }
    // Build state.game if we don't have one
    if (!state.game) {
      state.game = {
        name: game.name || 'Poker Night',
        seats: game.seats,
        defaultBuyin: game.buy_in ? game.buy_in / 100 : 25,
        code: game.live_token || ctx.gameId,
        chip_value: game.chip_value || 0,
        starting_chips: game.starting_chips || 0,
        bank_size: game.buy_in ? game.buy_in / 100 : 0,
        bank_size: game.buy_in ? game.buy_in / 100 : 0,
        small_blind: game.small_blind || 0,
        big_blind: game.big_blind || 0,
        hand_tracking: game.hand_tracking || 0,
      };
      // Store db players in ctx for link lookups
      var ctx2 = getPkrCtx();
      if (ctx2) { ctx2.dbPlayers = game.players||[]; localStorage.setItem('pkrCtx', JSON.stringify(ctx2)); }
      // Seed players from PKR
      (game.players || []).forEach(function(p) {
        var sid = 'seat' + (p.seat_number || 1);
        // Don't overwrite existing local state
        if (!state.players[sid] || !state.players[sid].name) {
          var txns = [];
          if (p.buy_ins > 0) {
            txns = pkrBuildBankTransactions(p, state.game.defaultBuyin);
          }
          if (p.cashout != null && p.cashout >= 0) txns.push({ type: 'cashout', amount: p.cashout / 100, ts: Date.now() });
          state.players[sid] = { name: p.display_name, userId: p.user_id, transactions: txns };
        }
        // Cache user_id for PKR syncing
        if (p.user_id) _pkrSeatedPlayers[sid] = { user_id:p.user_id,name:p.display_name,
          seat_number:p.seat_number,buy_ins:p.buy_ins,buy_in_total:p.buy_in_total,cashout:p.cashout,revision:p.revision };
      });
      // Hydrating server state must not create new money/seat writes.
      _origSaveState();
      _pkrLastSnapshot = _pkrSnapshotPlayers();
    }
    // Some returning browsers still have the old synthetic $27.083333 rows in
    // localStorage. Only rewrite those fractional-cent placeholders once the
    // server has loaded and there are no unsynced changes.
    var restoredBanks = 0;
    if (game.status !== 'settled' && game.status !== 'cancelled' &&
        !_syncConflictCode && _offlineQueue.length === 0 &&
        state.game && Number(state.game.defaultBuyin) > 0) {
      (game.players || []).forEach(function(p) {
        var existing = Object.values(state.players || {}).find(function(candidate){
          return candidate && candidate.name &&
            candidate.name.toLowerCase() === p.display_name.toLowerCase();
        });
        if (existing && pkrRepairLegacyAveragedBanks(existing,p,state.game.defaultBuyin)) {
          restoredBanks++;
        }
      });
      if (restoredBanks) {
        // Local placeholder only: no window.saveState, no DB or network write.
        _origSaveState();
        _pkrLastSnapshot = _pkrSnapshotPlayers();
      }
    }
    // Update topbar title
    var titleEl = document.getElementById('topbarTitle');
    if (titleEl && state.game) titleEl.textContent = state.game.name;
    var htBtn2  = document.getElementById('handTrackerBtn');
    var trkBtn2 = document.getElementById('trackHandsBtn');
    if (htBtn2)  htBtn2.style.display  = (state.game && state.game.hand_tracking) ? '' : 'none';
    if (trkBtn2) trkBtn2.style.color   = (state.game && state.game.hand_tracking) ? 'var(--gold)' : 'var(--muted)';
    renderTable();
    if(state.game&&state.game.hand_tracking)window.refreshSeatStacks&&window.refreshSeatStacks();
    updateSaveResultsBtn();
    maybeShowNotifBanner();
    if (restoredBanks) toast('Restored whole-cent bank amounts from PKR. Check reconstructed bank rows before settling.');
  }).catch(function(e) {
    console.warn('Could not load game from PKR:', e.message);
    if (state.game) { renderTable(); }
    else { toast('Could not load game'); }
  });
} else {
  if (state.game) renderTable();
}

// Follow read-only server changes from a co-host without ever replaying them
// as new financial PUTs. Preserve unsynced local work and identity conflicts.
var _remoteGameRefreshBusy=false;
function refreshVisibleGameFromServer(game){
  if(!game||!Array.isArray(game.players)||!state||!state.players||!state.game) return;
  if(!_isOnline||_offlineQueue.length||_flushingQueue||_syncConflict||_syncError||
     window._pkrResultsSaved||document.querySelector('.tx-amt:not([readonly])'))return;
  var changed=false,needsReview=false;
  game.players.forEach(function(server){
    if(!Number.isSafeInteger(server.seat_number)||server.seat_number<1) return;
    var sid='seat'+server.seat_number;
    var local=state.players[sid];
    if(local&&local.name&&local.name.toLowerCase()!==String(server.display_name||'').toLowerCase()){
      needsReview=true;return; // Same seat was reassigned elsewhere.
    }
    if(local&&local.userId&&server.user_id&&local.userId!==server.user_id){
      needsReview=true;return; // Never merge two identities by seat or name.
    }
    // The actual individual buy-in denominations are not persisted in D1.
    // Only hydrate from absolute server totals, labelling reconstructed rows.
    var existingCents=local?Math.round(pBuyin(local)*100):0;
    var localCount=local?(local.transactions||[]).filter(function(tx){return tx.type!=='cashout';}).length:0;
    var serverCount=Number(server.buy_ins||0);
    var invested=Number.isSafeInteger(server.buy_in_total)&&server.buy_in_total>0
      ?server.buy_in_total:serverCount*Math.round((state.game.defaultBuyin||0)*100);
    var cashed=server.cashout===null||server.cashout===undefined?null:Number(server.cashout);
    if(!Number.isSafeInteger(invested)||invested<0||
       (cashed!==null&&(!Number.isSafeInteger(cashed)||cashed<0))) {
      needsReview=true;return;
    }
    var localCashPresent=local&&(local.transactions||[]).some(function(tx){return tx.type==='cashout';});
    var localCash=local?Math.round(pCash(local)*100):null;
    var amountChanged=!local||existingCents!==invested||localCount!==serverCount||
      !!localCashPresent!==(cashed!==null)||
      (cashed!==null&&localCash!==cashed);
    if(!amountChanged)return;
    var banks=pkrBuildBankTransactions(server,state.game.defaultBuyin||0);
    if(banks.length!==serverCount){needsReview=true;return;}
    if(cashed!==null)banks.push({type:'cashout',amount:cashed/100,ts:Date.now(),pkrReconstructed:true});
    state.players[sid]=Object.assign({},local||{},{name:server.display_name,userId:server.user_id,transactions:banks});
    changed=true;
  });
  if(changed){
    // No window.saveState(): a co-host's saved data must not be written back.
    _origSaveState();
    _pkrLastSnapshot=_pkrSnapshotPlayers();
    renderTable();updateSaveResultsBtn();
    toast('Table refreshed from PKR. Amounts changed on another device; review reconstructed bank rows.');
  }
  if(needsReview&&!window._pkrRemoteSeatWarning){
    window._pkrRemoteSeatWarning=true;
    toast('A seat or player identity changed elsewhere. Reload to review before editing.');
  }
}
// Poll for updates every 15s (non-blocking)
var _pollInterval = setInterval(function() {
  var ctx2 = getPkrCtx();
  if (!ctx2 || !ctx2.gameId || _remoteGameRefreshBusy) return;
  _remoteGameRefreshBusy=true;
  pkrApi('/games/' + ctx2.gameId).then(function(game) {
    if (!game || !game.players) return;
    refreshVisibleGameFromServer(game);
    // Sync new players/buyins that may have come from other sources
    game.players.forEach(function(p) {
      var sid = 'seat' + (p.seat_number || 1);
      var existing = state.players[sid];
      if (!existing || !existing.name) return;
      // Update PKR cache
      _pkrSeatedPlayers[sid] = { user_id:p.user_id,name:p.display_name,
        seat_number:p.seat_number,buy_ins:p.buy_ins,buy_in_total:p.buy_in_total,cashout:p.cashout,revision:p.revision };
    });
    // Update results token
    if (game.results_token) {
      var shareBtn = document.getElementById('waGroupShareBtn');
      if (shareBtn && !shareBtn.dataset.shareUrl) {
        shareBtn.dataset.shareUrl = window.location.origin + '/games/results/' + game.results_token;
      }
    }
  }).catch(function(){}).finally(function(){_remoteGameRefreshBusy=false;});
}, 15000);

// Read-only hand history and immutable stack audits update the seat display.
// Never infer a player's real chip count from buy-in dollars when the bank
// denominations or hand awards cannot be reconciled.
var _pkrSeatRefreshBusy=false;
var _pkrSeatRefreshAgain=false;
window.refreshSeatStacks=function(){
  var ctx=getPkrCtx();
  if(!ctx||!ctx.gameId||!state.game||!window.pkrSeatStackLedger)return Promise.resolve();
  if(!state.game.hand_tracking){
    _pkrSeatHands=[];_pkrVerifiedHandAudit=null;renderTable();
    return Promise.resolve();
  }
  if(_pkrSeatRefreshBusy){_pkrSeatRefreshAgain=true;return Promise.resolve();}
  _pkrSeatRefreshBusy=true;
  return pkrApi('/games/'+ctx.gameId+'/hands').then(function(hands){
    if(!Array.isArray(hands))throw new Error('Hand history must be an array');
    var latest=hands.find(function(h){return h&&!h.voided;});
    var audit=null;
    // Optional, canonical stack read: the existing API calculates available
    // chips from physically verified openings, wagers, returns and pot awards.
    // Older rooms without the integrity flag use the reconciled action ledger.
    var verify=Promise.resolve();
    if(latest&&latest.mode==='full'){
      verify=pkrApi('/games/'+ctx.gameId+'/hands/'+latest.id+'/stack-baseline')
        .then(function(baseline){
          if(!baseline||!baseline.enabled||!baseline.confirmed)return;
          return pkrApi('/games/'+ctx.gameId+'/hands/'+latest.id+'/audit-stacks',{
            method:'POST',body:JSON.stringify({})
          }).then(function(data){
            if(data&&data.ok&&data.persisted_baseline&&data.audit&&
               Array.isArray(data.audit.stacks)){
              audit={handId:latest.id,stacks:data.audit.stacks,
                unsettled:data.audit.unsettled_pot_chips||0};
            }
          });
        }).catch(function(){ /* Leave the read-only ledger visible. */ });
    }
    return verify.then(function(){
      if(!state.game||!state.game.hand_tracking||getPkrCtx()?.gameId!==ctx.gameId)return;
      _pkrSeatHands=hands;_pkrVerifiedHandAudit=audit;
      renderTable();
      if(activePanel&&!document.querySelector('.tx-amt:not([readonly])'))
        refreshPanelSummary(activePanel);
    });
  }).catch(function(error){
    console.warn('PKR seat stack refresh unavailable:',error&&error.message);
  }).finally(function(){
    _pkrSeatRefreshBusy=false;
    if(_pkrSeatRefreshAgain){
      _pkrSeatRefreshAgain=false;
      window.refreshSeatStacks();
    }
  });
};
function _pkrOnHandStateChanged(event){
  var ctx=getPkrCtx(),detail=event&&event.detail;
  if(!ctx||!detail||detail.gameId!==ctx.gameId)return;
  window.refreshSeatStacks();
}
window.addEventListener('pkr:hand-state-changed',_pkrOnHandStateChanged);
var _pkrSeatStackPoll=setInterval(function(){
  if(document.visibilityState==='visible'&&state.game&&state.game.hand_tracking)
    window.refreshSeatStacks();
},15000);
window._pkrTableCleanup = function() {
  clearInterval(_pollInterval);clearInterval(_pkrSeatStackPoll);clearTimeout(_pkrViewportTimer);
  window.removeEventListener('pkr:hand-state-changed',_pkrOnHandStateChanged);
  window.removeEventListener('resize',_pkrHandleViewportChange);
  window.removeEventListener('orientationchange',_pkrHandleViewportChange);
};

window.addSeat = function() {
  var ctx=getPkrCtx(); if(!ctx||!ctx.gameId) return;
  if(!state.game) return;
  var current=state.game.seats||9;
  if(current>=15){toast('Maximum 15 seats');return;}
  var newSeats=current+1;
  pkrApi('/games/'+ctx.gameId,{method:'PUT',body:JSON.stringify({seats:newSeats})}).then(function(){
    state.game.seats=newSeats; saveState(); renderTable(); toast('Seat '+newSeats+' added ✓');
  }).catch(function(e){toast('Error: '+e.message);});
};

window.addSeat = function() {
  var ctx = getPkrCtx(); if(!ctx||!ctx.gameId) return;
  if(!state.game) return;
  var current = state.game.seats||9;
  if(current>=15){toast('Maximum 15 seats');return;}
  var newSeats = current+1;
  pkrApi('/games/'+ctx.gameId,{method:'PUT',body:JSON.stringify({seats:newSeats})}).then(function(){
    state.game.seats=newSeats; saveState(); renderTable(); toast('Seat '+newSeats+' added ✓');
  }).catch(function(e){toast('Error: '+e.message);});
};
// Remove only the highest-numbered vacant seat, avoiding renumbering seated
// players or changing buy-ins, cash-outs, balances or hand records.
window.removeSeat = function() {
  var ctx = getPkrCtx(); if(!ctx||!ctx.gameId||!state.game) return;
  var current = state.game.seats||9;
  if(current<=2){toast('A table needs at least 2 seats');return;}
  var tail = state.players['seat'+current];
  if(tail && tail.name){toast('Seat '+current+' is occupied. Unseat that player first.');return;}
  var next = current-1;
  pkrApi('/games/'+ctx.gameId,{method:'PUT',body:JSON.stringify({seats:next})}).then(function(game){
    state.game.seats=game && game.seats || next;
    saveState();renderTable();toast('Seat '+current+' removed ✓');
  }).catch(function(e){toast('Cannot remove seat: '+e.message);});
};


})();
`;
}
function getPremiumTableCSS():string {
  return "/* Live game chrome — preserve the legacy table engine and its action IDs. */\n#gameScreen{--gold:#ef8976;--gold2:#ffbbaa;--gold-dim:#bb6555;--cream:#f5f1e8;--cream2:#d6dbd3;--green:#39d796;--red:#f18578;--border:rgba(239,137,118,.22);--border2:rgba(239,137,118,.36);--bg:#161619;--bg2:#252326;--bg3:#343033;--rail:#272528;--rail2:#544b4b;--felt-top:#1c7553;--felt-mid:#12593d;--felt-bot:#073521;background:radial-gradient(ellipse at 50% 45%,#153f2b,#071710 80%);color:#f5f1e8}\n#gameScreen .topbar{background:linear-gradient(90deg,#081812,#102c20);border-bottom:1px solid rgba(228,186,107,.3);min-height:55px}\n#gameScreen .tb-title{color:#f5f1e8}\n#gameScreen .tb-back{color:#ffb29f}\n#gameScreen .bank-bar{background:#0c241b;border-bottom:1px solid rgba(228,186,107,.23)}\n#gameScreen #tableOuter{background:linear-gradient(130deg,#655d5d,#272528 35%,#494144 70%,#1b1b1d);box-shadow:0 0 0 2px rgba(238,225,212,.24),0 16px 65px #000c}\n#gameScreen #tableFelt{background:radial-gradient(ellipse at 48% 39%,#1c7d59,#11583d 55%,#083520);box-shadow:inset 0 0 34px #0008}\n#gameScreen .side-panel{background:#0d241a;border-left-color:rgba(228,186,107,.28)}\n#gameScreen .panel-hdr{background:#0b1e16}\n#gameScreen .game-tabs{background:#0b1e16;border-top-color:rgba(228,186,107,.22)}\n#gameScreen .game-tab{color:#b7cbbf}\n#gameScreen .game-tab:focus-visible,#gameScreen button:focus-visible{outline:3px solid #ffab99;outline-offset:2px}\n@media(min-width:1100px){\n body:has(.pkr-persistent-nav) #gameScreen{left:218px!important;right:0!important;width:calc(100vw - 218px)!important}\n}\n@media(max-width:1099px){\n body:has(.pkr-universal-bottom-nav) #gameScreen{bottom:calc(70px + env(safe-area-inset-bottom))!important;height:auto!important}\n #gameScreen .side-panel.open{width:min(300px,74vw)}\n #gameScreen .game-tab{min-height:46px}\n}\n@media(max-width:650px){\n #gameScreen .topbar{gap:4px}\n #gameScreen .tb-title{font-size:14px;min-width:60px}\n #gameScreen .bank-pill b{font-size:12px}\n #gameScreen .game-tabs{min-height:47px}\n #gameScreen .game-tab{padding:7px 1px 8px;font-size:10px;letter-spacing:0}\n}\n@media(max-width:500px) and (orientation:landscape){\n body:has(.pkr-universal-bottom-nav) #gameScreen{bottom:55px!important}\n #gameScreen .topbar{min-height:42px}\n #gameScreen .game-tabs{min-height:37px}\n}";
}


/*
 * Owner-approved gameplay chrome, 28 October 2026.
 * Presentation only. Leave the existing table renderer, seating coordinates,
 * betting controls, bank calculations, game actions and record IDs unchanged.
 * Theme A Midnight Felt values from the approved guide.
 */
function getApprovedTableChromeCSS():string {
  return `
#gameScreen.pkr-casino-live-table {
  --pkr-chrome-bg:#0B0F12;
  --pkr-chrome-panel:#131A1F;
  --pkr-chrome-raised:#1B242B;
  --pkr-chrome-border:#2B3D45;
  --pkr-chrome-green:#3DDC97;
  --pkr-chrome-gold:#F2B84B;
  --pkr-chrome-cream:#EAF0F2;
  --pkr-chrome-muted:#9FB0B9;
}
#gameScreen.pkr-casino-live-table .pkr-approved-topbar{
  height:65px!important;min-height:65px!important;max-height:65px;
  background:linear-gradient(110deg,#0A1114,#111E21 80%)!important;
  border-bottom:0!important;box-shadow:none!important;
  display:flex;gap:10px;align-items:center;padding:8px 12px;
  flex-shrink:0;position:relative;z-index:25;min-width:0;
}
#gameScreen.pkr-casino-live-table .pkr-approved-topbar .tb-back{
  height:44px!important;min-height:44px;
  padding:0 13px!important;margin:0;gap:8px;
  border:1px solid #17644F!important;border-radius:30px!important;
  background:linear-gradient(120deg,#071A16,#0D2420)!important;
  color:var(--pkr-chrome-green)!important;line-height:1;
  font-size:25px!important;font-weight:500;white-space:nowrap;
}
#gameScreen.pkr-casino-live-table .pkr-brand-name{
  font-family:Georgia,serif;font-size:22px;font-weight:700;letter-spacing:.02em;
}
#gameScreen.pkr-casino-live-table .pkr-table-identity{
  flex:1;min-width:0;display:flex;align-items:center;gap:9px;
  border-left:1px solid #38434A;padding-left:10px;
}
#gameScreen.pkr-casino-live-table .pkr-table-identity-icon{
  font-size:22px;line-height:1;flex:0 0 24px;
}
#gameScreen.pkr-casino-live-table .pkr-table-identity-copy{
  min-width:0;display:flex;flex-direction:column;gap:2px;
}
#gameScreen.pkr-casino-live-table .tb-title{
  display:block;padding:0!important;color:var(--pkr-chrome-cream)!important;
  font:700 16px/1.2 var(--font-head),Inter,sans-serif!important;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
#gameScreen.pkr-casino-live-table .pkr-table-meta{
  display:block;color:var(--pkr-chrome-muted);
  font:500 11px/1.35 var(--font-body),Inter,sans-serif;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
#gameScreen.pkr-casino-live-table .pkr-table-head-actions{
  flex:0 0 auto;display:flex;gap:7px;align-items:center;
}
#gameScreen.pkr-casino-live-table .topbar button.share-btn,
#gameScreen.pkr-casino-live-table .topbar.pkr-approved-topbar button.pkr-tools-toggle{
  display:flex;align-items:center;justify-content:center;
  height:44px!important;width:44px!important;min-width:44px!important;
  padding:0!important;margin:0!important;border:1px solid #365963!important;
  border-radius:16px!important;background:#102226!important;
  color:var(--pkr-chrome-cream)!important;line-height:1!important;
  font:700 25px/1 var(--font-body),Inter,sans-serif!important;
  box-shadow:none!important;letter-spacing:0!important;
}
#gameScreen.pkr-casino-live-table .topbar.pkr-approved-topbar button.pkr-tools-toggle span{transform:translateY(-3px);font-size:22px}
#gameScreen.pkr-casino-live-table .topbar button.share-btn:hover,
#gameScreen.pkr-casino-live-table .topbar.pkr-approved-topbar button.pkr-tools-toggle:hover{
  background:#183F35!important;border-color:#3DDC97!important;
}
#gameScreen.pkr-casino-live-table #pkr-table-tools.pkr-approved-tools{
  position:absolute!important;right:12px;top:65px;left:auto;
  z-index:45;display:grid!important;gap:4px;
  width:min(300px,calc(100vw - 24px));max-height:min(480px,70dvh);
  overflow-y:auto;padding:10px!important;border-radius:14px;
  border:1px solid #3C5B61;background:#15242A!important;
  box-shadow:0 22px 54px #000b;
}
#gameScreen.pkr-casino-live-table #pkr-table-tools.pkr-approved-tools[hidden]{
  display:none!important;
}
#gameScreen.pkr-casino-live-table .pkr-approved-tools .pkr-tools-caption{
  color:#9FB0B9;font:700 11px/1.3 var(--font-body),sans-serif;
  text-transform:uppercase;letter-spacing:.12em;padding:8px 10px 5px;
}
#gameScreen.pkr-casino-live-table .pkr-approved-tools button{
  display:block!important;width:100%;height:auto;min-height:42px;
  border:1px solid transparent!important;border-radius:9px!important;
  background:transparent!important;color:#EAF0F2!important;
  text-align:left;padding:11px 12px!important;margin:0!important;
  font:600 13px/1.3 var(--font-body),sans-serif!important;
}
#gameScreen.pkr-casino-live-table .pkr-approved-tools button:hover,
#gameScreen.pkr-casino-live-table .pkr-approved-tools button:focus-visible{
  background:#223B39!important;border-color:#416A5C!important;
}
#gameScreen.pkr-casino-live-table #bankBar.bank-bar{
  height:63px!important;min-height:63px!important;padding:7px 12px!important;
  gap:9px;border:1px solid #354B51!important;border-radius:14px!important;
  margin:7px 12px 5px!important;background:#111F22!important;
  box-shadow:0 3px 14px #0004!important;
  display:flex;align-items:center;flex:0 0 auto;min-width:0;
}
#gameScreen.pkr-casino-live-table .bank-bar.open{
  border-color:#3C9978!important;background:#162A2B!important;
}
#gameScreen.pkr-casino-live-table .bank-left{
  display:flex;align-items:center;gap:8px;min-width:0;flex-shrink:0;
}
#gameScreen.pkr-casino-live-table .bank-icon{
  width:30px;height:30px;border-radius:8px!important;
  background:#073A30!important;border:1px solid #28785C;overflow:hidden;
  padding:0;display:flex;justify-content:center;align-items:center;
}
#gameScreen.pkr-casino-live-table .bank-icon img{
  display:block;width:100%;height:100%;object-fit:cover;
}
#gameScreen.pkr-casino-live-table .bank-label{
  font:700 12px/1.2 var(--font-body),Inter,sans-serif!important;
  letter-spacing:-.01em;white-space:nowrap;
  color:var(--pkr-chrome-cream)!important;
}
#gameScreen.pkr-casino-live-table .bank-right{
  display:flex;align-items:center;justify-content:flex-end;
  flex:1;gap:7px;min-width:0;
}
#gameScreen.pkr-casino-live-table .bank-pill{
  display:flex;align-items:center;gap:5px;min-width:0;
  font-size:11px!important;white-space:nowrap;
  border-left:1px solid #33474F;padding-left:7px;
  color:var(--pkr-chrome-muted)!important;
}
#gameScreen.pkr-casino-live-table .bank-pill.g{border-left:0;padding-left:0}
#gameScreen.pkr-casino-live-table .pkr-bank-metric{
  display:flex;flex-direction:column;align-items:flex-start;gap:2px;
  min-width:0;
}
#gameScreen.pkr-casino-live-table .bank-pill small{
  display:block;color:#A2B2B9;font:600 9px/1 var(--font-body),sans-serif;
  letter-spacing:.06em;
}
#gameScreen.pkr-casino-live-table .bank-pill b{
  display:block;color:#EAF0F2!important;
  font:700 11px/1.1 var(--font-num),ui-monospace,monospace!important;
  font-variant-numeric:tabular-nums;
}
#gameScreen.pkr-casino-live-table .pkr-bank-current b{
  color:var(--pkr-chrome-gold)!important;
}
#gameScreen.pkr-casino-live-table .pkr-bank-visual{
  display:flex;align-items:center;justify-content:center;
  height:19px;width:19px;flex-shrink:0;border:2px dashed #C8F8E4;
  border-radius:50%;background:#237E5F;color:transparent;
  box-shadow:0 2px 0 #092C22,0 4px 0 #16513E;
}
#gameScreen.pkr-casino-live-table .pkr-bank-out-icon{
  background:#9B3442;border-color:#FFD2D5;
  box-shadow:0 2px 0 #561F2A,0 4px 0 #6E2933;
}
#gameScreen.pkr-casino-live-table .pkr-bank-balance{
  background:#A77B2E;border-color:#FFE9A9;
  box-shadow:0 2px 0 #5C441B,0 4px 0 #846525;
}
#gameScreen.pkr-casino-live-table .bank-caret{
  color:#A2B2B9;font-size:17px;flex-shrink:0;padding-left:1px;
}
#gameScreen.pkr-casino-live-table .bank-panel{
  border-bottom:1px solid #263E41!important;overflow:hidden;
}
#gameScreen.pkr-casino-live-table .bank-panel.open{max-height:270px}
#gameScreen.pkr-casino-live-table .bank-grid{
  margin:8px 12px!important;border-radius:12px!important;
}
#gameScreen.pkr-casino-live-table .pkr-approved-game-dock{
  flex-shrink:0;display:flex;position:relative;align-items:stretch;
  gap:0;min-height:67px;max-width:100%;overflow:visible;
  padding-bottom:env(safe-area-inset-bottom,0px);
  background:linear-gradient(180deg,#112025,#0B151B)!important;
  border-top:1px solid #304F53!important;
  box-shadow:0 -8px 24px #0006!important;
}
#gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab{
  flex:1 1 0;min-width:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:4px;
  border:0;border-right:1px solid #284048;
  background:transparent!important;color:#D5E0E4!important;
  padding:8px 3px!important;margin:0;white-space:nowrap;
  font:700 9px/1.15 var(--font-body),Inter,sans-serif!important;
  text-transform:uppercase!important;letter-spacing:0!important;
}
#gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab-icon{
  font-size:19px!important;line-height:1!important;display:block;
}
#gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab:hover,
#gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab:focus-visible{
  background:#19352E!important;color:#3DDC97!important;
}
#gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab.red{
  flex:1.22 1 0;min-width:77px;border:1px solid #A13842!important;
  border-radius:13px 13px 0 0!important;
  background:linear-gradient(140deg,#40191F,#241217)!important;
  color:#FF7378!important;
}
#gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab.red:hover{
  background:#51232B!important;
}
#gameScreen.pkr-casino-live-table .pkr-approved-game-dock .pkr-save-results-action{
  position:absolute!important;left:12px;right:12px;bottom:calc(100% + 10px);
  flex:none;width:auto;min-height:48px;z-index:5;
  color:#06251A!important;background:#3DDC97!important;
  border:1px solid #77E7B4!important;border-radius:12px!important;
  box-shadow:0 5px 24px #0009;
  flex-direction:row!important;gap:10px!important;
  font-size:13px!important;letter-spacing:.03em!important;
}
#gameScreen.pkr-casino-live-table .pkr-approved-game-dock .pkr-save-results-action[style*="none"]{
  display:none!important;
}
@media(max-width:450px){
  #gameScreen.pkr-casino-live-table .pkr-approved-topbar{
    height:59px!important;min-height:59px!important;max-height:59px;
    padding:7px 9px;gap:7px;
  }
  #gameScreen.pkr-casino-live-table .pkr-approved-topbar .tb-back{
    height:41px!important;min-height:41px;padding:0 10px!important;gap:5px;
  }
  #gameScreen.pkr-casino-live-table .pkr-brand-name{font-size:20px}
  #gameScreen.pkr-casino-live-table .pkr-table-identity{
    padding-left:7px;gap:5px;
  }
  #gameScreen.pkr-casino-live-table .pkr-table-identity-icon{
    flex-basis:18px;font-size:17px;
  }
  #gameScreen.pkr-casino-live-table .tb-title{font-size:13px!important}
  #gameScreen.pkr-casino-live-table .pkr-table-meta{font-size:10px}
  #gameScreen.pkr-casino-live-table .pkr-table-head-actions{gap:4px}
  #gameScreen.pkr-casino-live-table .topbar button.share-btn,
  #gameScreen.pkr-casino-live-table .topbar.pkr-approved-topbar button.pkr-tools-toggle{
    height:40px!important;width:40px!important;min-width:40px!important;
    border-radius:12px!important;
  }
  #gameScreen.pkr-casino-live-table #pkr-table-tools.pkr-approved-tools{top:59px}
  #gameScreen.pkr-casino-live-table #bankBar.bank-bar{
    height:57px!important;min-height:57px!important;
    margin:6px 8px 4px!important;padding:6px 8px!important;gap:5px;
  }
  #gameScreen.pkr-casino-live-table .bank-left{gap:5px}
  #gameScreen.pkr-casino-live-table .bank-icon{width:22px;height:22px;border-radius:6px!important}
  #gameScreen.pkr-casino-live-table .bank-label{font-size:10px!important}
  #gameScreen.pkr-casino-live-table .pkr-bank-label-extra{display:none}
  #gameScreen.pkr-casino-live-table .bank-right{gap:5px}
  #gameScreen.pkr-casino-live-table .bank-pill{padding-left:5px;gap:4px}
  #gameScreen.pkr-casino-live-table .pkr-bank-visual{width:14px;height:14px;border-width:1.5px}
  #gameScreen.pkr-casino-live-table .bank-pill small{font-size:9px}
  #gameScreen.pkr-casino-live-table .bank-pill b{font-size:10px!important}
  #gameScreen.pkr-casino-live-table .bank-caret{font-size:13px}
  #gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab{
    font-size:9px!important;padding:8px 2px!important;
  }
  #gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab-icon{font-size:18px!important}
}
@media(max-width:360px){
  #gameScreen.pkr-casino-live-table .pkr-table-identity-icon{display:none}
  #gameScreen.pkr-casino-live-table .bank-icon{display:none}
  #gameScreen.pkr-casino-live-table .pkr-bank-visual{display:none}
  #gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab.red{min-width:69px}
  #gameScreen.pkr-casino-live-table .pkr-approved-game-dock .game-tab{font-size:8px!important}
}
@media(max-height:690px){
  #gameScreen.pkr-casino-live-table .pkr-approved-topbar{
    height:52px!important;min-height:52px!important;max-height:52px;
  }
  #gameScreen.pkr-casino-live-table #bankBar.bank-bar{height:50px!important;min-height:50px!important}
  #gameScreen.pkr-casino-live-table .pkr-approved-game-dock{min-height:58px}
  #gameScreen.pkr-casino-live-table #pkr-table-tools.pkr-approved-tools{top:52px}
}
`;
}
