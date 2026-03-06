'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params?.id as string;
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Inject fonts
    if (!document.getElementById('pkr-fonts')) {
      const link = document.createElement('link');
      link.id = 'pkr-fonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }

    // Get auth token
    const token = typeof window !== 'undefined'
      ? (localStorage.getItem('pkr_token') || document.cookie.match(/pkr_token=([^;]+)/)?.[1] || '')
      : '';

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://pkr-reloaded-worker.jeemit1.workers.dev';

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

      // Load QRCode library, then inject the table script
      if (!(window as any).QRCode) {
        const qrScript = document.createElement('script');
        qrScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        qrScript.onload = injectTableScript;
        document.head.appendChild(qrScript);
      } else {
        injectTableScript();
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

      {/* ── GAME SCREEN ── */}
      <div id="gameScreen" className="screen">
        <div className="topbar">
          <button className="tb-back" id="backBtn" onClick={() => {
            try {
              const c = JSON.parse(localStorage.getItem('pkrCtx') || 'null');
              if (c?.eventId) { window.location.href = '/events/' + c.eventId; return; }
            } catch(e) {}
            window.location.href = '/dashboard';
          }}>‹ PKR</button>
          <div style={{display:'flex',flexDirection:'column',flex:1}}>
            <div className="tb-title" id="topbarTitle">The Table</div>
            <div id="gameCodeBadge" style={{display:'none',fontSize:'0.88rem',color:'var(--gold)',letterSpacing:'2.5px',fontWeight:700,lineHeight:1,paddingLeft:'12px'}}></div>
          </div>
          <button className="share-btn" id="shareBtn" onClick={() => (window as any).openShare?.()}>⬡ Share</button>
        </div>

        {/* Bank Bar */}
        <div className="bank-bar" id="bankBar" onClick={() => (window as any).toggleBank?.()}>
          <div className="bank-left">
            <div className="bank-icon">💳</div>
            <span className="bank-label">Bank Summary</span>
          </div>
          <div className="bank-right">
            <span className="bank-pill g" id="bbIn">$0 in</span>
            <span className="bank-pill" style={{opacity:0.4}}>·</span>
            <span className="bank-pill" id="bbBank">$0 bank</span>
            <span className="bank-caret">▼</span>
          </div>
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
          <div className="table-area" id="tableArea">
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
        <div className="game-tabs">
          <button className="game-tab" id="publishBtn" onClick={() => (window as any).openPublish?.()}><span className="game-tab-icon">📤</span>Share</button>
          <button className="game-tab" id="lbInGameBtn" onClick={() => (window as any).openLeaderboard?.()}><span className="game-tab-icon">🏆</span>Leaderboard</button>
          <button className="game-tab" id="settleBtn" onClick={() => (window as any).openSettleUp?.()}><span className="game-tab-icon">💸</span>Settle Up</button>
          <button className="game-tab" id="saveResultsBtn" onClick={() => (window as any).saveResultsToPkr?.()} style={{display:'none'}}><span className="game-tab-icon">✅</span>Save Results</button>
          <button className="game-tab red" id="endGameBtn" onClick={() => (window as any).endGame?.()}><span className="game-tab-icon">🏁</span>End Game</button>
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
.share-btn{flex-shrink:0;background:linear-gradient(135deg,var(--gold),#8a5c20);color:#000;border:none;padding:6px 12px;font-size:0.72rem;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;cursor:pointer;border-radius:6px;margin-right:10px}
/* bank */
.bank-bar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:46px;background:var(--bg);border-bottom:1px solid var(--border);cursor:pointer;gap:10px}
.bank-bar:active{background:rgba(201,168,76,0.03)}
.bank-left{display:flex;align-items:center;gap:10px;flex-shrink:0}
.bank-icon{width:28px;height:20px;border-radius:4px;background:linear-gradient(135deg,#b8860b,#8a6410);display:flex;align-items:center;justify-content:center;font-size:0.78rem}
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
#tableStats{font-size:clamp(0.6rem,1.5vw,0.75rem);color:rgba(201,168,76,0.45);margin-top:5px;letter-spacing:1px}
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
  if (!res.ok) { var e = await res.json().catch(function(){ return {}; }); throw new Error(e.error || String(res.status)); }
  return res.json();
}
window.pkrApi = pkrApi;

// ── Sync to PKR: seat + buyin + cashout ──
var _pkrSeatedPlayers = {};
var _pkrLastSnapshot = {};

async function pkrSeatPlayer(sid, name, phone, linkedUserId) {
  var ctx = getPkrCtx();
  if (!ctx || !ctx.gameId) return null;
  if (_pkrSeatedPlayers[sid] && _pkrSeatedPlayers[sid].name === name) return _pkrSeatedPlayers[sid];
  try {
    var seatNum = parseInt((sid || '').replace('seat','')) || null;
    var body = { display_name: name, whatsapp: phone||null, seat_number: seatNum, buy_ins: 0 };
    if (linkedUserId) body.user_id = linkedUserId;
    var res = await pkrApi('/games/' + ctx.gameId + '/seat', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (res && res.players) {
      var pkrPlayer = res.players.find(function(p){ return p.display_name === name; });
      if (pkrPlayer) { _pkrSeatedPlayers[sid] = { user_id: pkrPlayer.user_id, name: name }; return _pkrSeatedPlayers[sid]; }
    }
  } catch(e) { console.warn('PKR seat failed:', e.message); }
  return null;
}

function _pkrSnapshotPlayers() {
  var snap = {};
  if (!state || !state.players) return snap;
  Object.keys(state.players).forEach(function(sid) {
    var p = state.players[sid];
    if (!p || !p.name) return;
    var buyins = (p.transactions||[]).filter(function(t){ return t.type !== 'cashout'; }).length;
    var cashoutAmt = (p.transactions||[]).filter(function(t){ return t.type === 'cashout'; }).reduce(function(s,t){ return s+(t.amount||0); }, 0);
    snap[sid] = { name: p.name, phone: p.phone||'', buyins: buyins, cashout: cashoutAmt };
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
    var cur = after[sid], prev = before[sid];
    if (!prev && cur.name) { await pkrSeatPlayer(sid, cur.name, cur.phone); return; }
    if (!prev || !cur) return;
    if (prev.name !== cur.name) { await pkrSeatPlayer(sid, cur.name, cur.phone); return; }
    var seated = _pkrSeatedPlayers[sid];
    if (!seated) { seated = await pkrSeatPlayer(sid, cur.name, cur.phone); }
    if (!seated) return;
    if (cur.buyins > prev.buyins) {
      var newBuyins = cur.buyins - prev.buyins;
      for (var i = 0; i < newBuyins; i++) {
        try { await pkrApi('/games/' + ctx.gameId + '/buyin/' + seated.user_id, { method: 'POST' }); } catch(e) {}
      }
    }
    if (Math.abs(cur.cashout - (prev.cashout||0)) > 0.005) {
      var cashoutCents = Math.round(cur.cashout * 100);
      try {
        await pkrApi('/games/' + ctx.gameId + '/cashout/' + seated.user_id, {
          method: 'POST', body: JSON.stringify({ cashout: cashoutCents }),
        });
      } catch(e) {}
    }
  });
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
            _pkrSeatedPlayers[sid] = { user_id: p.user_id, name: sp.name };
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
  var results = Object.values(state.players)
    .filter(function(p) { return p && p.name; })
    .map(function(p) {
      var buyinCount = (p.transactions||[]).filter(function(t){ return t.type !== 'cashout'; }).length;
      var coDollars = (p.transactions||[]).filter(function(t){ return t.type === 'cashout'; }).reduce(function(a,t){ return a+t.amount; }, 0);
      var entry = pkrPlayerMap[(p.name||'').toLowerCase()];
      var userId = (p.userId && p.userId !== p.name) ? p.userId : (entry ? entry.user_id : ('manual_' + (p.name||'').replace(/\\s+/g,'_')));
      return { user_id: userId, display_name: p.name, buy_ins: buyinCount, cashout: Math.round(coDollars*100) };
    });
  if (!results.length) return false;
  var settleKey = ctx.settleKey || (ctx.gameId + '_end');
  try {
    await pkrApi('/games/' + ctx.gameId + '/settle', {
      method: 'POST', body: JSON.stringify({ idempotency_key: settleKey, results: results }),
    });
    return true;
  } catch(e) {
    if (e.message === '409' || (e.message && e.message.includes('already settled'))) return true;
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
  var ctx = getPkrCtx();
  if (!ctx || !ctx.gameId) return;
  try {
    await pkrApi('/games/' + ctx.gameId + '/seat/' + encodeURIComponent(playerName) + '/notify', {
      method: 'POST', body: JSON.stringify({ title, body }),
    });
  } catch(e) {}
  // Also try event-level targeted push
  try {
    if (ctx.eventId) {
      await pkrApi('/events/' + ctx.eventId + '/notify', {
        method: 'POST', body: JSON.stringify({ title, body, player_name: playerName }),
      });
    }
  } catch(e) {}
}

// ── Utility functions ──
function fmt(n) { return '$' + (n || 0).toFixed(2); }
function fmtNet(n) { return n > 0 ? '+$' + n.toFixed(2) : n < 0 ? '-$' + Math.abs(n).toFixed(2) : '$0.00'; }
function nc(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'; }
function inits(n) { return (n || '').split(' ').map(function(w){ return w[0] || ''; }).join('').slice(0,2).toUpperCase() || '?'; }
function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function pBuyin(p) { return (p.transactions || []).filter(function(t){ return t.type !== 'cashout'; }).reduce(function(a,t){ return a+t.amount; }, 0); }
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
  if (bar) bar.classList.toggle('open');
};

function updateBank() {
  var players = Object.values(state.players).filter(function(p){ return p && p.name; });
  var totalIn = players.reduce(function(a,p){ return a+pBuyin(p); }, 0);
  var totalOut = players.reduce(function(a,p){ return a+pCash(p); }, 0);
  var inBank = totalIn - totalOut;
  var active = players.filter(function(p){ return pBuyin(p) > 0 && pCash(p) === 0; }).length;
  var cashed = players.filter(function(p){ return pCash(p) > 0; }).length;
  var set = function(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; };
  set('bbIn', fmt(totalIn) + ' in');
  set('bbBank', fmt(inBank) + ' bank');
  set('bcIn', fmt(totalIn));
  set('bcOut', fmt(totalOut));
  set('bcBank', fmt(inBank));
  set('bcBankSub', inBank >= 0 ? 'still on table' : 'over-cashed!');
  set('bcStatus', active + ' Active');
  set('bcStatusSub', cashed ? cashed + ' cashed out' : '');
}

// ── Table render ──
function renderTable() {
  if (!state.game) return;
  var wrap = document.getElementById('tableWrap');
  if (!wrap) return;
  var W = wrap.offsetWidth, H = wrap.offsetHeight;
  if (!W || !H) { setTimeout(renderTable, 80); return; }
  var tH = Math.min(H * 0.72, 480);
  var tW = Math.min(W * 0.42, tH * 0.52);
  var cx = W / 2, cy = H / 2;
  var pad = 14;
  var outer = document.getElementById('tableOuter');
  var felt = document.getElementById('tableFelt');
  if (outer) outer.style.cssText = 'width:' + (tW+pad*2) + 'px;height:' + (tH+pad*2) + 'px;left:' + (cx-(tW+pad*2)/2) + 'px;top:' + (cy-(tH+pad*2)/2) + 'px';
  if (felt) felt.style.cssText = 'width:' + tW + 'px;height:' + tH + 'px;left:' + (cx-tW/2) + 'px;top:' + (cy-tH/2) + 'px';
  var tnEl = document.getElementById('tableName');
  var tsEl = document.getElementById('tableStats');
  if (tnEl) tnEl.textContent = state.game.name;
  var players = Object.values(state.players).filter(function(p){ return p && p.name; });
  var active = players.filter(function(p){ return pBuyin(p) > 0 && pCash(p) === 0; }).length;
  if (tsEl) tsEl.textContent = players.length ? (active + ' active · ' + players.length + ' seated') : '';
  buildSeats(state.game.seats, tW, tH, cx, cy);
  updateBank();
  updateSaveResultsBtn();
}
window.renderTable = renderTable;

function buildSeats(count, tW, tH, cx, cy) {
  var cont = document.getElementById('seatsContainer');
  if (!cont) return;
  cont.innerHTML = '';
  var chipSize = Math.max(24, Math.min(tW * 0.22, 44, 44 - Math.max(0, count - 9) * 2));
  var seatGap = chipSize + 6;
  var sideCount = count - 2;
  var leftCount = Math.ceil(sideCount / 2);
  var rightCount = Math.floor(sideCount / 2);
  var hOff = tW / 2 + seatGap;
  var vOff = tH / 2 + seatGap;
  var positions = [];
  positions.push({ x: cx, y: cy - vOff });
  for (var i = 0; i < leftCount; i++) {
    var spacing = tH / (leftCount + 1);
    positions.push({ x: cx - hOff, y: cy + (-tH/2 + spacing*(i+1)) });
  }
  positions.push({ x: cx, y: cy + vOff });
  for (var j = 0; j < rightCount; j++) {
    var spacingR = tH / (rightCount + 1);
    positions.push({ x: cx + hOff, y: cy + (-tH/2 + spacingR*(j+1)) });
  }
  positions.forEach(function(pos, i) {
    var sid = 'seat' + (i+1);
    var p = state.players[sid];
    var seat = document.createElement('div');
    seat.className = 'seat';
    seat.style.left = pos.x + 'px';
    seat.style.top = pos.y + 'px';
    var cs = chipSize + 'px';
    var initFs = Math.max(8, chipSize * 0.34) + 'px';
    var emptyFs = Math.max(12, chipSize * 0.52) + 'px';
    if (p && p.name) {
      var bi = pBuyin(p), co = pCash(p), net = pNet(p);
      var isRsvp = p.rsvp && bi === 0;
      var cls = co > 0 ? 'cashed' : isRsvp ? 'rsvp' : 'seated';
      var netHtml = bi > 0 ? '<div class="seat-net ' + nc(net) + '">' + fmtNet(net) + '</div>' : (isRsvp ? '<div class="seat-net" style="color:var(--muted);font-size:0.88rem">RSVP</div>' : '');
      seat.innerHTML = '<div class="seat-chip ' + cls + '" style="width:' + cs + ';height:' + cs + ';' + (isRsvp?'border-style:dashed;opacity:0.7':'') + '"><span class="seat-inner" style="font-size:' + initFs + '">' + esc(inits(p.name)) + '</span></div><div class="seat-label">' + esc(p.name) + '</div>' + netHtml;
    } else {
      seat.innerHTML = '<div class="seat-chip empty" style="width:' + cs + ';height:' + cs + '"><span class="seat-inner" style="font-size:' + emptyFs + '">+</span></div><div class="seat-label" style="opacity:0.3;font-size:0.88rem;font-weight:400">Seat ' + (i+1) + '</div>';
    }
    var capturedSid = sid;
    seat.addEventListener('click', function(){ onSeatClick(capturedSid); });
    cont.appendChild(seat);
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
  if (el) { var n = pNet(p); el.className = 'p-net ' + nc(n); el.textContent = fmtNet(n); }
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
  sum.innerHTML = '<div class="p-av">' + esc(inits(p.name)) + '</div><div class="p-info"><div class="p-name">' + esc(p.name) + '</div><div class="p-meta">Seat ' + sid.replace('seat','') + ' &nbsp;&middot;&nbsp; In: ' + fmt(bi) + ' &middot; Out: ' + fmt(co) + '</div></div><div class="p-net ' + nc(net) + '" id="pNetDisplay">' + fmtNet(net) + '</div>';
  body.appendChild(sum);

  // Transactions
  var txSec = document.createElement('div'); txSec.className = 'psec'; txSec.textContent = 'Transactions';
  body.appendChild(txSec);
  var txList = document.createElement('div');
  var txs = p.transactions || [];
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
      amt.addEventListener('click', function(){ amt.select(); });
      amt.addEventListener('mousedown', function(e){ e.stopPropagation(); });
      var capturedIdx = idx;
      var saveTxAmt = function() {
        var v = parseFloat(amt.value);
        if (isNaN(v) || v <= 0) return;
        p.transactions[capturedIdx].amount = v; saveState(); refreshPanelSummary(sid); renderTable();
      };
      amt.addEventListener('blur', saveTxAmt);
      amt.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); amt.blur(); } });
      var timeEl = document.createElement('span'); timeEl.className = 'tx-time'; timeEl.textContent = time;
      var del = document.createElement('button'); del.className = 'tx-del'; del.textContent = '✕';
      del.addEventListener('click', function() {
        showConfirmModal('Delete Transaction?', typeLabel + ' of $' + tx.amount.toFixed(2) + ' for ' + p.name, 'Delete', function() {
          var p2 = state.players[sid]; if (!p2) return;
          p2.transactions.splice(capturedIdx, 1);
          saveState(); buildPanel(sid); renderTable();
        });
      });
      row.append(badge, amt, timeEl, del);
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
  if (isNaN(amt) || amt <= 0) { toast('Enter a valid amount'); return; }
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
  notifyPlayer(p.name, pushTitle, pushBody).catch(function(){});
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
function calcSettlements(players) {
  var debtors = players.filter(function(p){ return p.net < -0.005; }).map(function(p){ return { name: p.name, amount: -p.net }; }).sort(function(a,b){ return b.amount - a.amount; });
  var creditors = players.filter(function(p){ return p.net > 0.005; }).map(function(p){ return { name: p.name, amount: p.net }; }).sort(function(a,b){ return b.amount - a.amount; });
  var transfers = [];
  var i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    var pay = debtors[i], recv = creditors[j];
    var amt = Math.min(pay.amount, recv.amount);
    if (amt > 0.005) transfers.push({ from: pay.name, to: recv.name, amount: amt });
    pay.amount -= amt; recv.amount -= amt;
    if (pay.amount < 0.005) i++;
    if (recv.amount < 0.005) j++;
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
  var players = Object.values(state.players || {}).filter(function(p){ return p && p.name && pBuyin(p) > 0; }).map(function(p){ return { name: p.name, net: pNet(p) }; });
  if (players.length < 2) { toast('Need at least 2 players'); return; }
  _doOpenSettleUp(players);
};

function _doOpenSettleUp(players) {
  var transfers = calcSettlements(players);
  var gameName = state.game ? state.game.name : 'Poker Night';
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.85);display:flex;align-items:flex-end;justify-content:center';
  var box = document.createElement('div');
  box.style.cssText = 'background:#09180a;border-top:1px solid rgba(201,168,76,0.3);border-radius:16px 16px 0 0;width:100%;max-width:560px;max-height:88vh;display:flex;flex-direction:column';
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0';
  hdr.innerHTML = '<div><div style="font-size:1.1rem;font-weight:700;color:var(--cream)">💸 Settle Up</div><div style="font-size:0.82rem;color:var(--muted);margin-top:2px">' + (transfers.length ? transfers.length + ' transfer' + (transfers.length !== 1 ? 's' : '') + ' needed' : 'Everyone is square!') + '</div></div>';
  var closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;padding:4px 8px';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', function(){ overlay.remove(); });
  hdr.appendChild(closeBtn);
  box.appendChild(hdr);
  // Share banner
  var banner = document.createElement('div');
  banner.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0';
  var waAllText = gameName + ' — Settle Up\\n\\n' + transfers.map(function(t){ return t.from + ' pays ' + t.to + ' $' + t.amount.toFixed(2); }).join('\\n') + '\\n\\nSent via PKR ♠';
  var waAllBtn = document.createElement('button');
  waAllBtn.style.cssText = 'width:100%;display:flex;align-items:center;justify-content:center;gap:8px;background:#25D366;color:#fff;padding:12px;border-radius:10px;font-size:0.88rem;font-weight:700;border:none;cursor:pointer';
  waAllBtn.innerHTML = '<span>📤</span> Share Settlements';
  waAllBtn.addEventListener('click', function() {
    if (navigator.share) navigator.share({ text: waAllText }).catch(function(){});
    else { navigator.clipboard.writeText(waAllText).catch(function(){}); toast('Copied to clipboard!'); }
  });
  banner.appendChild(waAllBtn);
  box.appendChild(banner);
  // Transfers
  var scrollBody = document.createElement('div');
  scrollBody.style.cssText = 'overflow-y:auto;flex:1;padding:14px 16px 28px';
  scrollBody.innerHTML = renderSettlementsHTML(transfers);
  box.appendChild(scrollBody);
  overlay.appendChild(box);
  overlay.addEventListener('click', function(e){ if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ── Publish / Share Results ──
window.openPublish = function() {
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
  var ctx = getPkrCtx();
  var btn = document.getElementById('saveResultsBtn');
  if (!btn || !ctx || !ctx.gameId) return;
  var players = Object.values(state.players||{}).filter(function(p){ return p && p.name && pBuyin(p)>0; });
  var allCashedOut = players.length >= 2 && players.every(function(p){ return (p.transactions||[]).some(function(t){ return t.type === 'cashout'; }); });
  btn.style.display = allCashedOut ? '' : 'none';
};
var updateSaveResultsBtn = window.updateSaveResultsBtn;

window.saveResultsToPkr = async function() {
  var ctx = getPkrCtx();
  if (!ctx || !ctx.gameId) { toast('No PKR game found'); return; }
  var btn = document.getElementById('saveResultsBtn');
  if (btn) { btn.innerHTML = '<span class="game-tab-icon">⏳</span>Saving…'; btn.disabled = true; }
  try {
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
    var saveVisible = saveBtn && saveBtn.style.display !== 'none';
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:24px';
    var box = document.createElement('div');
    box.style.cssText = 'background:#1a0a0a;border:1px solid rgba(231,76,60,0.5);border-radius:16px;padding:24px;width:100%;max-width:320px;text-align:center';
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
  overlay2.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:24px';
  var box2 = document.createElement('div');
  box2.style.cssText = 'background:#1a0a0a;border:1px solid rgba(46,204,113,0.3);border-radius:16px;padding:24px;width:100%;max-width:320px';
  box2.innerHTML = '<div style="font-size:1.1rem;font-weight:700;color:#2ecc71;margin-bottom:10px">🏁 End Game?</div><div style="font-size:0.9rem;color:#d4c4a0;margin-bottom:20px;line-height:1.6">Results are saved ✓. This will close the game and return to the events page.</div><button id="pkrEndYes" style="width:100%;background:linear-gradient(135deg,#1e6b2a,#0f4a1a);color:#fff;border:none;padding:13px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;font-weight:700;cursor:pointer;margin-bottom:10px">Yes, End Game</button><button id="pkrEndNo" style="width:100%;background:none;border:1px solid rgba(201,168,76,0.2);color:#6b8c6e;padding:12px;border-radius:10px;font-family:DM Sans,sans-serif;font-size:0.9rem;cursor:pointer">Cancel</button>';
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
    if (eventId) window.location.href = '/events/' + eventId;
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
    // Build state.game if we don't have one
    if (!state.game) {
      state.game = {
        name: game.name || 'Poker Night',
        seats: game.seats || 9,
        defaultBuyin: game.buy_in ? game.buy_in / 100 : 25,
        code: game.live_token || ctx.gameId,
      };
      // Seed players from PKR
      (game.players || []).forEach(function(p) {
        var sid = 'seat' + (p.seat_number || 1);
        // Don't overwrite existing local state
        if (!state.players[sid] || !state.players[sid].name) {
          var txns = [];
          for (var b = 0; b < (p.buy_ins || 0); b++) {
            txns.push({ type: 'buyin', amount: state.game.defaultBuyin, ts: Date.now() - b * 60000 });
          }
          if (p.cashout != null && p.cashout > 0) txns.push({ type: 'cashout', amount: p.cashout / 100, ts: Date.now() });
          state.players[sid] = { name: p.display_name, userId: p.user_id, transactions: txns };
        }
        // Cache user_id for PKR syncing
        if (p.user_id) _pkrSeatedPlayers[sid] = { user_id: p.user_id, name: p.display_name };
      });
      saveState();
    }
    // Update topbar title
    var titleEl = document.getElementById('topbarTitle');
    if (titleEl && state.game) titleEl.textContent = state.game.name;
    renderTable();
    updateSaveResultsBtn();
    maybeShowNotifBanner();
  }).catch(function(e) {
    console.warn('Could not load game from PKR:', e.message);
    if (state.game) { renderTable(); }
    else { toast('Could not load game'); }
  });
} else {
  if (state.game) renderTable();
}

// Poll for updates every 15s (non-blocking)
var _pollInterval = setInterval(function() {
  var ctx2 = getPkrCtx();
  if (!ctx2 || !ctx2.gameId) return;
  pkrApi('/games/' + ctx2.gameId).then(function(game) {
    if (!game || !game.players) return;
    // Sync new players/buyins that may have come from other sources
    game.players.forEach(function(p) {
      var sid = 'seat' + (p.seat_number || 1);
      var existing = state.players[sid];
      if (!existing || !existing.name) return;
      // Update PKR cache
      _pkrSeatedPlayers[sid] = { user_id: p.user_id, name: p.display_name };
    });
    // Update results token
    if (game.results_token) {
      var shareBtn = document.getElementById('waGroupShareBtn');
      if (shareBtn && !shareBtn.dataset.shareUrl) {
        shareBtn.dataset.shareUrl = window.location.origin + '/games/results/' + game.results_token;
      }
    }
  }).catch(function(){});
}, 15000);

window._pkrTableCleanup = function() { clearInterval(_pollInterval); };

})();
`;
}