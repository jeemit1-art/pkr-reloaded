'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface Transaction { type: 'buyin' | 'cashout'; amount: number; ts: number; }
interface Player { name: string; userId: string; phone: string; transactions: Transaction[]; }
interface Players { [sid: string]: Player; }
interface GameInfo {
  id: string; event_id: string; event_name: string; status: string;
  seats: number; buy_in: number; live_token: string; game_password: string | null;
  scheduled_at: number; location: string; notes: string; format: string;
  players: ApiPlayer[]; transfers: Transfer[];
}
interface ApiPlayer {
  user_id: string; display_name: string; whatsapp: string | null;
  seat_number: number | null; buy_ins: number; cashout: number | null; net: number | null;
}
interface Transfer { from_user: string; to_user: string; amount: number; }
interface EventPlayer { display_name: string; whatsapp: string | null; games_played: number; }

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const inits = (n: string) => (n||'').split(' ').map((w:string)=>w[0]||'').join('').slice(0,2).toUpperCase()||'?';
const fmt = (n: number) => '$' + n.toFixed(2);
const fmtNet = (n: number) => n > 0 ? '+$'+n.toFixed(2) : n < 0 ? '-$'+Math.abs(n).toFixed(2) : '$0.00';
const nc = (n: number) => n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
const pBuyin = (p: Player) => p.transactions.filter(t=>t.type!=='cashout').reduce((a,t)=>a+t.amount,0);
const pCash  = (p: Player) => p.transactions.filter(t=>t.type==='cashout').reduce((a,t)=>a+t.amount,0);
const pNet   = (p: Player) => pCash(p) - pBuyin(p);
const hasCashout = (p: Player) => p.transactions.some(t=>t.type==='cashout');

function calcSettlements(players: {name:string;net:number}[]) {
  const debtors   = players.filter(p=>p.net<-0.005).map(p=>({name:p.name,amount:-p.net})).sort((a,b)=>b.amount-a.amount);
  const creditors = players.filter(p=>p.net> 0.005).map(p=>({name:p.name,amount: p.net})).sort((a,b)=>b.amount-a.amount);
  const transfers: {from:string;to:string;amount:number}[] = [];
  let i=0,j=0;
  while(i<debtors.length && j<creditors.length) {
    const pay=debtors[i], recv=creditors[j];
    const amt=Math.min(pay.amount,recv.amount);
    if(amt>0.005) transfers.push({from:pay.name,to:recv.name,amount:amt});
    pay.amount-=amt; recv.amount-=amt;
    if(pay.amount<0.005) i++;
    if(recv.amount<0.005) j++;
  }
  return transfers;
}

function waUrl(phone: string, msg: string) {
  const digits = phone.replace(/\D/g,'');
  const e164 = digits.startsWith('0') ? '61'+digits.slice(1) : digits;
  return `https://wa.me/${e164}?text=${encodeURIComponent(msg)}`;
}

async function pkrFetch(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const res = await fetch(apiUrl + path, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((opts.headers as Record<string,string>) || {}),
    },
  });
  if (!res.ok) {
    const e = await res.json().catch(()=>({})) as {error?:string};
    throw new Error(e.error || String(res.status));
  }
  return res.json();
}

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────
export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = Array.isArray(params.id) ? params.id[0] : params.id as string;

  // Core state
  const [game, setGame]     = useState<GameInfo | null>(null);
  const [players, setPlayers] = useState<Players>({});
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [resultsSaved, setResultsSaved] = useState(false);

  // UI state
  const [bankOpen, setBankOpen]       = useState(false);
  const [activePanel, setActivePanel] = useState<string|null>(null);
  const [assignSid, setAssignSid]     = useState<string|null>(null);
  const [showSettle, setShowSettle]   = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showEndGame, setShowEndGame] = useState(false);
  const [showSaveBlock, setShowSaveBlock] = useState(false);
  const [toast, setToast]             = useState('');
  const [toastTimer, setToastTimer]   = useState<ReturnType<typeof setTimeout>|null>(null);
  const [knownPlayers, setKnownPlayers] = useState<EventPlayer[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  // Refs
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableDims, setTableDims] = useState({W:0,H:0});
  const syncRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const snapshotRef = useRef<Record<string,{buyins:number;cashout:number}>>({});

  // ── Toast ──────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer) clearTimeout(toastTimer);
    const t = setTimeout(()=>setToast(''), 2500);
    setToastTimer(t);
  }, [toastTimer]);

  // ── Load game ─────────────────────────────
  useEffect(() => {
    loadGame();
    loadKnownPlayers();
  }, [gameId]);

  async function loadGame() {
    try {
      const g: GameInfo = await pkrFetch(`/games/${gameId}`);
      setGame(g);
      // Build local player state from API
      const buyInDollars = g.buy_in / 100;
      const newPlayers: Players = {};
      (g.players || []).forEach((p, i) => {
        const sid = 'seat' + (p.seat_number || (i+1));
        const txns: Transaction[] = [];
        for (let b=0; b<(p.buy_ins||1); b++) {
          txns.push({ type:'buyin', amount: buyInDollars, ts: Date.now() - b*60000 });
        }
        if (p.cashout != null) txns.push({ type:'cashout', amount: p.cashout/100, ts: Date.now() });
        newPlayers[sid] = { name: p.display_name, userId: p.user_id, phone: p.whatsapp||'', transactions: txns };
      });
      setPlayers(newPlayers);
      if (g.status === 'settled') setResultsSaved(true);
    } catch(e: any) {
      setError(e.message || 'Failed to load game');
    } finally {
      setLoading(false);
    }
  }

  async function loadKnownPlayers() {
    try {
      const g: GameInfo = await pkrFetch(`/games/${gameId}`);
      const rows: EventPlayer[] = await pkrFetch(`/events/${g.event_id}/players`);
      setKnownPlayers(rows || []);
    } catch {}
  }

  // ── Table dimensions ──────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      if (tableWrapRef.current) {
        setTableDims({ W: tableWrapRef.current.offsetWidth, H: tableWrapRef.current.offsetHeight });
      }
    });
    if (tableWrapRef.current) obs.observe(tableWrapRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Sync changes to PKR API ───────────────
  const syncToPkr = useCallback(async (newPlayers: Players) => {
    if (!game) return;
    const snap = snapshotRef.current;
    const after: Record<string,{buyins:number;cashout:number}> = {};
    Object.entries(newPlayers).forEach(([sid, p]) => {
      if (!p?.name) return;
      after[sid] = {
        buyins: p.transactions.filter(t=>t.type!=='cashout').length,
        cashout: p.transactions.filter(t=>t.type==='cashout').reduce((a,t)=>a+t.amount,0),
      };
    });

    for (const sid of Object.keys(after)) {
      const cur = after[sid], prev = snap[sid];
      const p = newPlayers[sid];
      if (!p?.name) continue;

      // New player seated
      if (!prev) {
        try {
          await pkrFetch(`/games/${gameId}/seat`, {
            method:'POST',
            body: JSON.stringify({
              display_name: p.name, whatsapp: p.phone||null,
              seat_number: parseInt(sid.replace('seat',''),10), buy_ins: 0,
            }),
          });
          // Reload to get user_id
          const updated: GameInfo = await pkrFetch(`/games/${gameId}`);
          const apiPlayer = updated.players.find(ap=>ap.display_name.toLowerCase()===p.name.toLowerCase());
          if (apiPlayer) {
            setPlayers(prev2 => ({...prev2, [sid]: {...prev2[sid], userId: apiPlayer.user_id}}));
          }
        } catch(e: any) { console.warn('Seat failed:', e.message); }
        continue;
      }

      // New buy-ins
      if (cur.buyins > prev.buyins) {
        const userId = p.userId;
        if (!userId || userId === p.name) continue;
        for (let i=prev.buyins; i<cur.buyins; i++) {
          try { await pkrFetch(`/games/${gameId}/buyin/${userId}`, {method:'POST'}); } catch {}
        }
      }

      // Cashout changed
      if (Math.abs(cur.cashout - (prev.cashout||0)) > 0.005) {
        const userId = p.userId;
        if (!userId || userId === p.name) continue;
        try {
          await pkrFetch(`/games/${gameId}/cashout/${userId}`, {
            method:'POST', body: JSON.stringify({cashout: Math.round(cur.cashout*100)}),
          });
        } catch {}
      }
    }
    snapshotRef.current = after;
  }, [game, gameId]);

  // ── Seat player ───────────────────────────
  async function seatPlayer(sid: string, name: string, phone: string) {
    if (!game) return;
    const buyInDollars = game.buy_in / 100;
    const seatNum = parseInt(sid.replace('seat',''), 10);
    try {
      const res: {ok:boolean;players:ApiPlayer[]} = await pkrFetch(`/games/${gameId}/seat`, {
        method:'POST',
        body: JSON.stringify({display_name: name, whatsapp: phone||null, seat_number: seatNum, buy_ins: 1}),
      });
      // Update local state with PKR user_id
      const apiPlayer = res.players.find(p=>p.display_name.toLowerCase()===name.toLowerCase());
      const txns: Transaction[] = [{ type:'buyin', amount: buyInDollars, ts: Date.now() }];
      const newP: Player = { name, userId: apiPlayer?.user_id||name, phone, transactions: txns };
      const newPlayers = {...players, [sid]: newP};
      setPlayers(newPlayers);
      snapshotRef.current[sid] = { buyins: 1, cashout: 0 };
      showToast(`${name} seated ✓`);
    } catch(e: any) { showToast('⚠️ '+e.message); }
  }

  // ── Add buy-in ────────────────────────────
  async function addBuyin(sid: string, amount: number) {
    const p = players[sid];
    if (!p) return;
    try {
      await pkrFetch(`/games/${gameId}/buyin/${p.userId}`, {method:'POST'});
      const txn: Transaction = { type:'buyin', amount, ts: Date.now() };
      const newTxns = [...p.transactions, txn];
      const newPlayers = {...players, [sid]: {...p, transactions: newTxns}};
      setPlayers(newPlayers);
      snapshotRef.current[sid] = {
        ...snapshotRef.current[sid],
        buyins: (snapshotRef.current[sid]?.buyins||0)+1,
      };
      showToast(`Buy-in added for ${p.name} ✓`);
    } catch(e: any) { showToast('⚠️ '+e.message); }
  }

  // ── Cashout ────────────────────────────────
  async function addCashout(sid: string, amount: number) {
    const p = players[sid];
    if (!p) return;
    try {
      await pkrFetch(`/games/${gameId}/cashout/${p.userId}`, {
        method:'POST', body: JSON.stringify({cashout: Math.round(amount*100)}),
      });
      const existing = p.transactions.filter(t=>t.type!=='cashout');
      const txn: Transaction = { type:'cashout', amount, ts: Date.now() };
      const newTxns = [...existing, txn];
      const newPlayers = {...players, [sid]: {...p, transactions: newTxns}};
      setPlayers(newPlayers);
      snapshotRef.current[sid] = { ...snapshotRef.current[sid], cashout: amount };
      showToast(`Cashout recorded for ${p.name} ✓`);
    } catch(e: any) { showToast('⚠️ '+e.message); }
  }

  // ── Remove player ─────────────────────────
  async function removePlayer(sid: string) {
    const p = players[sid];
    if (!p) return;
    try {
      await pkrFetch(`/games/${gameId}/seat/${p.userId}`, {method:'DELETE'});
      const newPlayers = {...players};
      delete newPlayers[sid];
      setPlayers(newPlayers);
      delete snapshotRef.current[sid];
      setActivePanel(null);
      showToast(`${p.name} removed`);
    } catch(e: any) { showToast('⚠️ '+e.message); }
  }

  // ── Save results ──────────────────────────
  async function saveResults() {
    const activePlayers = Object.values(players).filter(p=>p?.name && pBuyin(p)>0);
    if (activePlayers.length < 2) { showToast('Need at least 2 players'); return; }
    const results = activePlayers.map(p => ({
      user_id: p.userId,
      display_name: p.name,
      buy_ins: p.transactions.filter(t=>t.type!=='cashout').length,
      cashout: Math.round(pCash(p)*100),
    }));
    try {
      await pkrFetch(`/games/${gameId}/settle`, {
        method:'POST',
        body: JSON.stringify({ idempotency_key: gameId+'_end', results }),
      });
      setResultsSaved(true);
      showToast('Results saved to PKR ✓');
    } catch(e: any) {
      if (e.message.includes('already settled')) {
        setResultsSaved(true);
        showToast('Already saved ✓');
      } else {
        showToast('⚠️ '+e.message);
      }
    }
  }

  // ── End game ──────────────────────────────
  async function doEndGame() {
    if (!game) return;
    router.push(`/events/${game.event_id}`);
  }

  // ── Bank stats ────────────────────────────
  const activePlayers = Object.values(players).filter(p=>p?.name);
  const totalIn  = activePlayers.reduce((a,p)=>a+pBuyin(p),0);
  const totalOut = activePlayers.reduce((a,p)=>a+pCash(p),0);
  const inBank   = totalIn - totalOut;
  const activeCount = activePlayers.filter(p=>pBuyin(p)>0 && pCash(p)===0).length;
  const cashedCount = activePlayers.filter(p=>pCash(p)>0).length;

  // ── Can save? ─────────────────────────────
  const withBuyins = activePlayers.filter(p=>pBuyin(p)>0);
  const allCashedOut = withBuyins.length >= 2 && withBuyins.every(p=>hasCashout(p));

  // ── Table geometry ────────────────────────
  const { W, H } = tableDims;
  const tH = Math.min(H * 0.72, 480);
  const tW = Math.min(W * 0.42, tH * 0.52);
  const cx = W/2, cy = H/2;
  const pad = 14;

  function seatPositions(count: number) {
    const sideCount = count - 2;
    const leftCount = Math.ceil(sideCount / 2);
    const rightCount = Math.floor(sideCount / 2);
    const hOff = tW/2 + tW*0.22 + 8;
    const vOff = tH/2 + tW*0.22 + 8;
    const positions: {x:number;y:number}[] = [];
    positions.push({ x: cx, y: cy - vOff });
    for (let i=0; i<leftCount; i++) {
      const spacing = tH / (leftCount+1);
      positions.push({ x: cx-hOff, y: cy - tH/2 + spacing*(i+1) });
    }
    positions.push({ x: cx, y: cy + vOff });
    for (let i=0; i<rightCount; i++) {
      const spacing = tH / (rightCount+1);
      positions.push({ x: cx+hOff, y: cy - tH/2 + spacing*(i+1) });
    }
    return positions;
  }

  const seats = game ? seatPositions(game.seats) : [];
  const chipSize = Math.max(30, Math.min(tW * 0.22, 44));

  // ── Loading / error ───────────────────────
  if (loading) return (
    <div style={{position:'fixed',inset:0,background:'#060e07',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}}>
      <div style={{color:'#c9a84c',fontFamily:'Playfair Display,serif',fontSize:48,opacity:0.6}}>♠</div>
      <div style={{color:'#6b8c6e',fontFamily:'DM Sans,sans-serif',fontSize:14,letterSpacing:2}}>LOADING</div>
    </div>
  );
  if (error) return (
    <div style={{position:'fixed',inset:0,background:'#060e07',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{textAlign:'center',color:'#f0e6c8',fontFamily:'DM Sans,sans-serif'}}>
        <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
        <div style={{marginBottom:20}}>{error}</div>
        <button onClick={()=>router.push('/dashboard')} style={{background:'#c9a84c',color:'#000',border:'none',padding:'12px 24px',borderRadius:8,cursor:'pointer',fontWeight:700}}>← Dashboard</button>
      </div>
    </div>
  );
  if (!game) return null;

  return (
    <>
      {/* ── GLOBAL STYLES ── */}
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
        html,body{width:100%;height:100%;overflow:hidden;background:#060e07;color:#f0e6c8;font-family:DM Sans,sans-serif;-webkit-font-smoothing:antialiased}
        :root{
          --gold:#c9a84c;--gold2:#e8c96a;--gold-dim:#7a5820;
          --cream:#f0e6c8;--cream2:#d4c4a0;
          --green:#2ecc71;--red:#e74c3c;
          --felt-top:#1e6b2a;--felt-mid:#155220;--felt-bot:#0e3a18;
          --rail:#3d1f08;--rail2:#5a3010;
          --border:rgba(201,168,76,0.15);--border2:rgba(201,168,76,0.35);
          --muted:#6b8c6e;--bg:#060e07;--bg2:#0d1f10;--bg3:#111f13;
          --r:12px;--rs:8px;
        }
        .pos{color:var(--green)}.neg{color:var(--red)}.zero{color:var(--muted)}
        .seat{position:absolute;transform:translate(-50%,-50%);cursor:pointer;z-index:5;display:flex;flex-direction:column;align-items:center;gap:3px}
        .seat-chip{border-radius:50%;border:2px solid rgba(201,168,76,0.25);background:#0d1a0f;display:flex;align-items:center;justify-content:center;transition:transform 0.15s}
        .seat:active .seat-chip{transform:scale(0.88)}
        .seat-chip.empty .seat-inner{color:rgba(201,168,76,0.3)}
        .seat-chip.seated{border-color:var(--gold);border-width:2.5px;background:linear-gradient(135deg,#1a3a1a,#0d2010)}
        .seat-chip.seated .seat-inner{font-weight:700;color:var(--cream)}
        .seat-chip.cashed{border-color:rgba(46,204,113,0.5);background:linear-gradient(135deg,#0a2a1a,#061510)}
        .seat-chip.cashed .seat-inner{font-weight:700;color:var(--green)}
        .seat-label{font-size:clamp(0.75rem,2vw,0.9rem);font-weight:600;color:#fff;max-width:clamp(68px,16vw,96px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;background:rgba(0,0,0,0.6);padding:2px 7px;border-radius:5px;text-shadow:0 1px 3px rgba(0,0,0,0.9)}
        .seat-net{font-size:clamp(0.62rem,1.6vw,0.78rem);font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.8)}
        .tx-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04)}
        .tx-badge{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.5px;padding:3px 7px;border-radius:4px;flex-shrink:0;white-space:nowrap;font-weight:600}
        .tx-badge.bi{background:rgba(201,168,76,0.12);color:var(--gold)}
        .tx-badge.co{background:rgba(46,204,113,0.12);color:var(--green)}
        .add-inp{flex:1;background:rgba(4,12,5,0.9);border:1px solid var(--border);color:var(--cream);padding:10px;font-size:1rem;border-radius:var(--rs);outline:none;min-width:0;font-family:DM Sans,sans-serif}
        .add-inp:focus{border-color:var(--gold)}
        .add-btn{background:linear-gradient(135deg,var(--gold),#8a5c20);color:#000;border:none;padding:10px 14px;font-size:0.82rem;font-weight:700;cursor:pointer;border-radius:var(--rs);white-space:nowrap}
        .add-btn.g{background:linear-gradient(135deg,#1a8a4a,#0f5a2e);color:#a0ffcc}
        .known-chip{background:var(--bg2);border:1px solid var(--border);color:var(--cream2);padding:7px 13px;border-radius:20px;font-size:0.88rem;cursor:pointer;font-family:DM Sans,sans-serif}
        .known-chip:active{border-color:var(--gold);color:var(--gold)}
        .known-chip.seated{opacity:0.4;pointer-events:none}
        .game-tab{flex:1;display:flex;flex-direction:column;align-items:center;padding:10px 0 14px;gap:3px;cursor:pointer;font-size:0.65rem;text-transform:uppercase;letter-spacing:0.8px;color:var(--muted);border:none;background:none;white-space:nowrap;font-family:DM Sans,sans-serif}
        .game-tab:active{color:var(--gold);background:rgba(201,168,76,0.04)}
        .game-tab.red:active{color:var(--red)}
        .settle-row{display:flex;align-items:center;gap:12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;margin-bottom:10px;position:relative;overflow:hidden}
        .settle-row::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--red),#8a1010)}
        .settle-av{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;flex-shrink:0}
        .lb-row{display:flex;align-items:center;gap:12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px 16px;margin:0 0 8px}
        .lb-row:first-child{border-color:rgba(201,168,76,0.35);background:#132a14}
        @keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
      `}</style>

      {/* ── SCREEN WRAPPER ── */}
      <div style={{position:'fixed',inset:0,display:'flex',flexDirection:'column',background:'var(--bg)',overflow:'hidden'}}>

        {/* ── TOP BAR ── */}
        <div style={{flexShrink:0,display:'flex',alignItems:'center',height:52,background:'var(--bg)',borderBottom:'1px solid var(--border)'}}>
          <button onClick={()=>router.push(`/events/${game.event_id}`)}
            style={{display:'flex',alignItems:'center',gap:4,padding:'0 16px',height:'100%',cursor:'pointer',color:'var(--gold)',fontSize:'0.9rem',fontWeight:500,background:'none',border:'none',borderRight:'1px solid var(--border)'}}>
            ‹ PKR
          </button>
          <div style={{flex:1,fontFamily:'Playfair Display,serif',fontSize:'1.05rem',fontWeight:700,color:'var(--gold)',padding:'0 14px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {game.event_name}
          </div>
          {resultsSaved && (
            <div style={{fontSize:'0.72rem',color:'var(--green)',marginRight:12,fontWeight:600}}>✓ Saved</div>
          )}
        </div>

        {/* ── BANK BAR ── */}
        <div onClick={()=>setBankOpen(o=>!o)}
          style={{flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',height:46,background:'var(--bg)',borderBottom:'1px solid var(--border)',cursor:'pointer'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:28,height:20,borderRadius:4,background:'linear-gradient(135deg,#b8860b,#8a6410)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.78rem'}}>💳</div>
            <span style={{fontSize:'0.95rem',fontWeight:600,color:'var(--cream)'}}>Bank Summary</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:'0.82rem',color:'var(--green)'}}>{fmt(totalIn)} in</span>
            <span style={{fontSize:'0.82rem',color:'var(--muted)',opacity:0.4}}>·</span>
            <span style={{fontSize:'0.82rem',color:'var(--muted)'}}>{fmt(inBank)} bank</span>
            <span style={{fontSize:'0.6rem',color:'var(--muted)',transition:'transform 0.25s',transform:bankOpen?'rotate(180deg)':'none'}}>▼</span>
          </div>
        </div>

        {/* ── BANK PANEL ── */}
        <div style={{flexShrink:0,overflow:'hidden',maxHeight:bankOpen?240:0,transition:'max-height 0.3s ease',background:'var(--bg)'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',margin:12,background:'var(--bg2)',border:'1px solid rgba(201,168,76,0.14)',borderRadius:'var(--r)',overflow:'hidden'}}>
            {[
              {l:'↗ Total Buy-ins', v:fmt(totalIn),    cls:'pos'},
              {l:'↘ Cash-outs',    v:fmt(totalOut),   cls:'neg'},
              {l:'💳 In Bank',     v:fmt(inBank),     cls:nc(inBank), sub: inBank>=0?'still on table':'over-cashed!'},
              {l:'⚡ Status',      v:`${activeCount} Active`, cls:'', sub: cashedCount?`${cashedCount} cashed out`:''},
            ].map((c,i)=>(
              <div key={i} style={{padding:'12px 14px',display:'flex',flexDirection:'column',gap:4,background:'#132b16',
                borderBottom:i<2?'1px solid rgba(201,168,76,0.07)':'none',
                borderRight:i%2===0?'1px solid rgba(201,168,76,0.07)':'none'}}>
                <div style={{fontSize:'0.68rem',textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--muted)'}}>{c.l}</div>
                <div style={{fontSize:'1.4rem',fontWeight:700}} className={c.cls}>{c.v}</div>
                {c.sub && <div style={{fontSize:'0.68rem',color:'var(--muted)'}}>{c.sub}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* ── TABLE + SIDE PANEL ── */}
        <div style={{display:'flex',flex:1,overflow:'hidden',minHeight:0}}>

          {/* TABLE AREA */}
          <div style={{flex:1,position:'relative',overflow:'hidden'}} ref={tableWrapRef}>
            {W > 0 && (
              <>
                {/* Rail (outer) */}
                <div style={{position:'absolute',width:tW+pad*2,height:tH+pad*2,left:cx-(tW+pad*2)/2,top:cy-(tH+pad*2)/2,borderRadius:36,background:'linear-gradient(135deg,var(--rail2),var(--rail))',boxShadow:'0 8px 40px rgba(0,0,0,0.7)'}}/>
                {/* Felt */}
                <div style={{position:'absolute',width:tW,height:tH,left:cx-tW/2,top:cy-tH/2,borderRadius:28,background:'radial-gradient(ellipse at 50% 40%,var(--felt-top),var(--felt-mid) 55%,var(--felt-bot))',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <div style={{textAlign:'center',pointerEvents:'none'}}>
                    <div style={{fontFamily:'Playfair Display,serif',fontSize:'clamp(0.7rem,2vw,1rem)',color:'rgba(240,230,200,0.55)',letterSpacing:2,textTransform:'uppercase'}}>{game.event_name}</div>
                    <div style={{fontSize:'clamp(0.6rem,1.5vw,0.75rem)',color:'rgba(201,168,76,0.45)',marginTop:5,letterSpacing:1}}>
                      {activePlayers.filter(p=>pBuyin(p)>0).length ? `${activeCount} active · ${activePlayers.filter(p=>pBuyin(p)>0).length} seated` : ''}
                    </div>
                  </div>
                </div>
                {/* Seats */}
                {seats.map((pos, i) => {
                  const sid = 'seat'+(i+1);
                  const p = players[sid];
                  const cs = chipSize;
                  const initFs = Math.max(8, cs*0.34);
                  const emptyFs = Math.max(12, cs*0.52);
                  if (p?.name) {
                    const bi=pBuyin(p), co=pCash(p), net=pNet(p);
                    const cls = co>0?'cashed':'seated';
                    return (
                      <div key={sid} className="seat" style={{left:pos.x,top:pos.y}} onClick={()=>setActivePanel(sid)}>
                        <div className={`seat-chip ${cls}`} style={{width:cs,height:cs}}>
                          <span className="seat-inner" style={{fontSize:initFs}}>{inits(p.name)}</span>
                        </div>
                        <div className="seat-label">{p.name}</div>
                        {bi>0 && <div className={`seat-net ${nc(net)}`}>{fmtNet(net)}</div>}
                      </div>
                    );
                  }
                  return (
                    <div key={sid} className="seat" style={{left:pos.x,top:pos.y}} onClick={()=>setAssignSid(sid)}>
                      <div className="seat-chip empty" style={{width:cs,height:cs}}>
                        <span className="seat-inner" style={{fontSize:emptyFs,color:'rgba(201,168,76,0.3)'}}>+</span>
                      </div>
                      <div className="seat-label" style={{opacity:0.3,fontSize:'0.88rem',fontWeight:400}}>Seat {i+1}</div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* SIDE PANEL */}
          {activePanel && players[activePanel] && (
            <SidePanel
              sid={activePanel}
              player={players[activePanel]}
              defaultBuyin={game.buy_in/100}
              onClose={()=>setActivePanel(null)}
              onBuyin={(amt)=>addBuyin(activePanel,amt)}
              onCashout={(amt)=>addCashout(activePanel,amt)}
              onRemove={()=>removePlayer(activePanel)}
              showToast={showToast}
            />
          )}
        </div>

        {/* ── GAME TABS ── */}
        <div style={{flexShrink:0,display:'flex',borderTop:'1px solid var(--border)',background:'var(--bg)',zIndex:10}}>
          <button className="game-tab" onClick={()=>setShowLeaderboard(true)}>
            <span style={{fontSize:'1.3rem',lineHeight:1}}>🏆</span>Leaderboard
          </button>
          <button className="game-tab" onClick={()=>setShowSettle(true)}>
            <span style={{fontSize:'1.3rem',lineHeight:1}}>💸</span>Settle Up
          </button>
          {allCashedOut && !resultsSaved && (
            <button className="game-tab" onClick={saveResults}>
              <span style={{fontSize:'1.3rem',lineHeight:1}}>✅</span>Save Results
            </button>
          )}
          {resultsSaved && (
            <button className="game-tab" style={{color:'var(--green)'}}>
              <span style={{fontSize:'1.3rem',lineHeight:1}}>✅</span>Saved
            </button>
          )}
          <button className="game-tab red" onClick={()=>{
            if (!resultsSaved) { setShowSaveBlock(true); return; }
            setShowEndGame(true);
          }}>
            <span style={{fontSize:'1.3rem',lineHeight:1}}>🏁</span>End Game
          </button>
        </div>
      </div>

      {/* ── ASSIGN OVERLAY ── */}
      {assignSid && (
        <AssignOverlay
          sid={assignSid}
          knownPlayers={knownPlayers}
          seatedNames={new Set(Object.values(players).filter(p=>p?.name).map(p=>p.name.toLowerCase()))}
          onClose={()=>setAssignSid(null)}
          onSeat={(name,phone)=>{ seatPlayer(assignSid,name,phone); setAssignSid(null); }}
        />
      )}

      {/* ── SETTLE UP SHEET ── */}
      {showSettle && (
        <SettleSheet
          players={Object.values(players).filter(p=>p?.name && pBuyin(p)>0).map(p=>({name:p.name,net:pNet(p)}))}
          gameName={game.event_name}
          onClose={()=>setShowSettle(false)}
        />
      )}

      {/* ── LEADERBOARD SHEET ── */}
      {showLeaderboard && (
        <LeaderboardSheet gameId={gameId} eventId={game.event_id} players={players} onClose={()=>setShowLeaderboard(false)} />
      )}

      {/* ── END GAME CONFIRM ── */}
      {showEndGame && (
        <Modal onClose={()=>setShowEndGame(false)}>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:'1.1rem',fontWeight:700,color:'var(--green)',marginBottom:10}}>🏁 End Game?</div>
            <div style={{fontSize:'0.9rem',color:'var(--cream2)',marginBottom:20,lineHeight:1.6}}>Results are saved ✓. This will close the game and return to the events page.</div>
            <button onClick={doEndGame} style={{width:'100%',background:'linear-gradient(135deg,#1e6b2a,#0f4a1a)',color:'#fff',border:'none',padding:13,borderRadius:10,fontFamily:'DM Sans,sans-serif',fontSize:'0.9rem',fontWeight:700,cursor:'pointer',marginBottom:10}}>Yes, End Game</button>
            <button onClick={()=>setShowEndGame(false)} style={{width:'100%',background:'none',border:'1px solid rgba(201,168,76,0.2)',color:'var(--muted)',padding:12,borderRadius:10,fontFamily:'DM Sans,sans-serif',fontSize:'0.9rem',cursor:'pointer'}}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* ── SAVE BLOCK ── */}
      {showSaveBlock && (
        <Modal onClose={()=>setShowSaveBlock(false)}>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:'2rem',marginBottom:12}}>⚠️</div>
            <div style={{fontSize:'1rem',fontWeight:700,color:'#ff6b5b',marginBottom:10}}>Save Results First</div>
            <div style={{fontSize:'0.88rem',color:'var(--cream2)',marginBottom:20,lineHeight:1.6}}>
              {allCashedOut ? 'Tap Save Results ✅ before ending.' : 'Cash out all players first, then save results.'}
            </div>
            {allCashedOut && (
              <button onClick={()=>{setShowSaveBlock(false);saveResults();}} style={{width:'100%',background:'linear-gradient(135deg,#1e6b2a,#0f4a1a)',color:'#fff',border:'none',padding:13,borderRadius:10,fontFamily:'DM Sans,sans-serif',fontSize:'0.9rem',fontWeight:700,cursor:'pointer',marginBottom:10}}>✅ Save Results Now</button>
            )}
            <button onClick={()=>setShowSaveBlock(false)} style={{width:'100%',background:'none',border:'1px solid rgba(201,168,76,0.2)',color:'var(--muted)',padding:12,borderRadius:10,fontFamily:'DM Sans,sans-serif',fontSize:'0.9rem',cursor:'pointer'}}>OK</button>
          </div>
        </Modal>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{position:'fixed',bottom:90,left:'50%',transform:'translateX(-50%)',background:'#1a3a1a',color:'var(--cream)',padding:'10px 20px',borderRadius:24,fontSize:'0.9rem',zIndex:999,whiteSpace:'nowrap',border:'1px solid rgba(201,168,76,0.2)',animation:'slideUp 0.25s ease'}}>
          {toast}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// SIDE PANEL
// ─────────────────────────────────────────────
function SidePanel({ sid, player, defaultBuyin, onClose, onBuyin, onCashout, onRemove, showToast }: {
  sid: string; player: Player; defaultBuyin: number;
  onClose: ()=>void; onBuyin: (amt:number)=>void; onCashout: (amt:number)=>void;
  onRemove: ()=>void; showToast: (m:string)=>void;
}) {
  const [biInput, setBiInput] = useState(String(defaultBuyin));
  const [coInput, setCoInput] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const bi = pBuyin(player), co = pCash(player), net = pNet(player);

  return (
    <div style={{width:'min(300px,80vw)',overflow:'hidden',background:'#09180a',borderLeft:'1px solid var(--border)',display:'flex',flexDirection:'column',flexShrink:0}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
        <span style={{fontFamily:'Playfair Display,serif',fontSize:'1.15rem',fontWeight:700,color:'var(--cream)'}}>{player.name}</span>
        <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',fontSize:'1.3rem',cursor:'pointer',padding:'2px 6px',lineHeight:1}}>✕</button>
      </div>
      {/* Body */}
      <div style={{flex:1,overflowY:'auto',padding:'12px 14px'}}>
        {/* Summary */}
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0 14px',borderBottom:'1px solid var(--border)',marginBottom:6}}>
          <div style={{width:42,height:42,borderRadius:'50%',background:'linear-gradient(135deg,#7a5820,#5a3010)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.88rem',fontWeight:700,color:'var(--cream)',flexShrink:0}}>{inits(player.name)}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:'1rem',fontWeight:600,color:'var(--cream)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{player.name}</div>
            <div style={{fontSize:'0.78rem',color:'var(--muted)',marginTop:3}}>Seat {sid.replace('seat','')} · In: {fmt(bi)} · Out: {fmt(co)}</div>
          </div>
          <div style={{fontSize:'1.2rem',fontWeight:700,whiteSpace:'nowrap'}} className={nc(net)}>{fmtNet(net)}</div>
        </div>

        {/* Transactions */}
        <div style={{fontSize:'0.68rem',textTransform:'uppercase',letterSpacing:2,color:'var(--gold-dim)',margin:'14px 0 8px',paddingBottom:5,borderBottom:'1px solid rgba(201,168,76,0.08)'}}>Transactions</div>
        {player.transactions.length === 0 ? (
          <div style={{fontSize:'0.85rem',color:'var(--muted)',padding:'10px 0',textAlign:'center'}}>No transactions yet</div>
        ) : player.transactions.map((tx, idx) => (
          <div key={idx} className="tx-row">
            <span className={`tx-badge ${tx.type==='cashout'?'co':'bi'}`}>{tx.type==='cashout'?'Cash out':'Buy-in'}</span>
            <span style={{flex:1,fontSize:'0.95rem',color:'var(--cream)'}}>{fmt(tx.amount)}</span>
            <span style={{fontSize:'0.72rem',color:'var(--muted)'}}>{new Date(tx.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
          </div>
        ))}

        {/* Add Buy-in */}
        <div style={{fontSize:'0.68rem',textTransform:'uppercase',letterSpacing:2,color:'var(--gold-dim)',margin:'14px 0 8px',paddingBottom:5,borderBottom:'1px solid rgba(201,168,76,0.08)'}}>Add Buy-in</div>
        <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'center'}}>
          <input className="add-inp" type="number" inputMode="decimal" value={biInput} onChange={e=>setBiInput(e.target.value)} placeholder={String(defaultBuyin)} onClick={e=>(e.target as HTMLInputElement).select()} onKeyDown={e=>{if(e.key==='Enter'){const v=parseFloat(biInput);if(!isNaN(v)&&v>0){onBuyin(v);setBiInput(String(defaultBuyin));}}}} />
          <button className="add-btn" onClick={()=>{const v=parseFloat(biInput);if(!isNaN(v)&&v>0){onBuyin(v);setBiInput(String(defaultBuyin));}else showToast('Enter valid amount');}}>+ Buy In</button>
        </div>

        {/* Cash Out */}
        <div style={{fontSize:'0.68rem',textTransform:'uppercase',letterSpacing:2,color:'var(--gold-dim)',margin:'14px 0 8px',paddingBottom:5,borderBottom:'1px solid rgba(201,168,76,0.08)'}}>Cash Out</div>
        <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'center'}}>
          <input className="add-inp" type="number" inputMode="decimal" value={coInput} onChange={e=>setCoInput(e.target.value)} placeholder="0.00" onClick={e=>(e.target as HTMLInputElement).select()} onKeyDown={e=>{if(e.key==='Enter'){const v=parseFloat(coInput);if(!isNaN(v)&&v>=0){onCashout(v);setCoInput('');}else if(coInput==='0'){onCashout(0);setCoInput('');}}}} />
          <button className="add-btn g" onClick={()=>{const v=parseFloat(coInput);if(!isNaN(v)&&v>=0){onCashout(v);setCoInput('');}else showToast('Enter cashout amount');}}>Cash Out</button>
        </div>

        {/* WhatsApp */}
        {player.phone && (
          <a href={waUrl(player.phone, `Hi ${player.name}! Your net result: ${fmtNet(net)}`)} target="_blank"
            style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,background:'#25D366',color:'#fff',border:'none',padding:11,borderRadius:'var(--rs)',fontSize:'0.9rem',fontWeight:700,cursor:'pointer',textDecoration:'none',width:'100%',marginBottom:10}}>
            💬 Send via WhatsApp
          </a>
        )}

        {/* Remove */}
        {!confirmRemove ? (
          <button onClick={()=>setConfirmRemove(true)} style={{width:'100%',padding:11,background:'rgba(231,76,60,0.1)',color:'var(--red)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:'var(--rs)',fontSize:'0.9rem',fontWeight:600,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Remove Player</button>
        ) : (
          <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.2)',borderRadius:'var(--rs)',padding:'12px 14px'}}>
            <div style={{fontSize:'0.88rem',color:'var(--cream2)',marginBottom:12}}>Remove {player.name} from this game?</div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={onRemove} style={{flex:1,padding:10,background:'var(--red)',color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontWeight:700,fontFamily:'DM Sans,sans-serif'}}>Remove</button>
              <button onClick={()=>setConfirmRemove(false)} style={{flex:1,padding:10,background:'none',border:'1px solid var(--border)',color:'var(--muted)',borderRadius:6,cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ASSIGN OVERLAY
// ─────────────────────────────────────────────
function AssignOverlay({ sid, knownPlayers, seatedNames, onClose, onSeat }: {
  sid: string; knownPlayers: EventPlayer[]; seatedNames: Set<string>;
  onClose: ()=>void; onSeat: (name:string,phone:string)=>void;
}) {
  const [name, setName]   = useState('');
  const [phone, setPhone] = useState('');

  const filtered = knownPlayers.filter(p=>!seatedNames.has(p.display_name.toLowerCase()));

  return (
    <div style={{position:'fixed',inset:0,zIndex:50,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'#0d1f10',border:'1px solid rgba(201,168,76,0.35)',borderRadius:16,padding:24,width:'100%',maxWidth:420,maxHeight:'88vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.7)'}}>
        <h2 style={{fontFamily:'Playfair Display,serif',fontSize:'1.35rem',fontWeight:700,color:'var(--gold)',marginBottom:20}}>Seat Player</h2>
        {filtered.length > 0 && (
          <div style={{marginBottom:14}}>
            <div style={{fontSize:'0.9rem',textTransform:'uppercase',letterSpacing:2,color:'var(--muted)',marginBottom:8}}>Quick Select</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {filtered.map(p => (
                <button key={p.display_name} className="known-chip" onClick={()=>{setName(p.display_name);if(p.whatsapp){const d=p.whatsapp.replace(/\D/g,'');setPhone(d.startsWith('61')?'0'+d.slice(2):d);}}}>{p.display_name}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{marginBottom:14}}>
          <label style={{display:'block',fontSize:'0.72rem',textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--muted)',marginBottom:6,fontWeight:600}}>Name</label>
          <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Enter name..." onKeyDown={e=>{if(e.key==='Enter'&&name.trim())onSeat(name.trim(),phone.trim());}}
            style={{width:'100%',background:'rgba(4,12,5,0.9)',border:'1px solid rgba(201,168,76,0.15)',color:'var(--cream)',padding:'11px 13px',fontSize:'1rem',borderRadius:'var(--rs)',outline:'none',fontFamily:'DM Sans,sans-serif'}}/>
        </div>
        <div style={{marginBottom:14}}>
          <label style={{display:'block',fontSize:'0.72rem',textTransform:'uppercase',letterSpacing:'1.5px',color:'var(--muted)',marginBottom:6,fontWeight:600}}>WhatsApp (optional)</label>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:'1rem',flexShrink:0}}>🇦🇺</span>
            <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="04xx xxx xxx"
              style={{flex:1,background:'rgba(4,12,5,0.9)',border:'1px solid rgba(201,168,76,0.15)',color:'var(--cream)',padding:'11px 12px',fontSize:'1rem',borderRadius:'var(--rs)',outline:'none',fontFamily:'DM Sans,sans-serif'}}/>
          </div>
        </div>
        <div style={{display:'flex',gap:10,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{background:'none',border:'1px solid rgba(201,168,76,0.15)',color:'var(--muted)',padding:'12px 18px',fontSize:'0.92rem',cursor:'pointer',borderRadius:'var(--rs)',fontFamily:'DM Sans,sans-serif'}}>Cancel</button>
          <button onClick={()=>{if(name.trim())onSeat(name.trim(),phone.trim());}} style={{background:'linear-gradient(135deg,var(--gold),#8a5c20)',color:'#000',border:'none',padding:'12px 22px',fontSize:'0.92rem',fontWeight:700,cursor:'pointer',borderRadius:'var(--rs)',fontFamily:'DM Sans,sans-serif'}}>Seat Player</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SETTLE SHEET
// ─────────────────────────────────────────────
function SettleSheet({ players, gameName, onClose }: {
  players: {name:string;net:number}[]; gameName: string; onClose: ()=>void;
}) {
  const transfers = calcSettlements(players);
  const summaryLines = transfers.map(t=>`${t.from} pays ${t.to} $${t.amount.toFixed(2)}`);
  const summaryText = gameName + ' - Settle Up\n\n' + (transfers.length ? summaryLines.join('\n') : 'Everyone is square! No transfers needed.') + '\n\nSent from PKR ♠';

  function share() {
    if (navigator.share) {
      navigator.share({ text: summaryText }).catch(()=>{});
    } else {
      navigator.clipboard.writeText(summaryText).then(()=>alert('Copied!'));
    }
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:600,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:'#09180a',borderTop:'1px solid rgba(201,168,76,0.3)',borderRadius:'16px 16px 0 0',width:'100%',maxWidth:560,maxHeight:'88vh',display:'flex',flexDirection:'column'}}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
          <div>
            <div style={{fontSize:'1.1rem',fontWeight:700,color:'var(--cream)'}}>💸 Settle Up</div>
            <div style={{fontSize:'0.82rem',color:'var(--muted)',marginTop:2}}>{transfers.length ? `${transfers.length} transfer${transfers.length!==1?'s':''} needed` : 'Everyone is square!'}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',fontSize:'1.2rem',cursor:'pointer',padding:'4px 8px'}}>✕</button>
        </div>
        {/* Share banner */}
        <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border)',flexShrink:0,background:'rgba(37,211,102,0.04)'}}>
          <div style={{fontSize:'0.9rem',textTransform:'uppercase',letterSpacing:2,color:'rgba(37,211,102,0.7)',marginBottom:8}}>Send to your group chat</div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={share} style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:7,background:'#25D366',color:'#fff',padding:12,borderRadius:10,fontSize:'0.82rem',fontWeight:700,border:'none',cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>
              <span style={{fontSize:'1.1rem'}}>📤</span> Share Summary
            </button>
            <button onClick={()=>navigator.clipboard.writeText(summaryText).then(()=>alert('Copied!'))} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,background:'rgba(201,168,76,0.1)',border:'1px solid rgba(201,168,76,0.3)',color:'var(--gold)',padding:'12px 16px',borderRadius:10,fontSize:'0.82rem',fontWeight:700,cursor:'pointer',fontFamily:'DM Sans,sans-serif',whiteSpace:'nowrap'}}>
              📋 Copy
            </button>
          </div>
          <div style={{marginTop:10,background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'9px 11px',fontSize:'0.82rem',color:'var(--cream2)',lineHeight:1.7,whiteSpace:'pre-line',border:'1px solid rgba(255,255,255,0.05)'}}>
            {summaryText}
          </div>
        </div>
        {/* Individual transfers */}
        <div style={{overflowY:'auto',flex:1,padding:'14px 16px 32px'}}>
          {transfers.length === 0 ? (
            <div style={{padding:'24px 16px',textAlign:'center',fontSize:'0.82rem',color:'var(--green)'}}>✓ Everyone is already square!</div>
          ) : (
            <>
              <div style={{fontSize:'0.88rem',textTransform:'uppercase',letterSpacing:'2.5px',color:'var(--gold-dim)',marginBottom:10}}>Individual Reminders</div>
              {transfers.map((t, i) => (
                <div key={i} className="settle-row">
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:50}}>
                    <div className="settle-av" style={{background:'linear-gradient(135deg,rgba(231,76,60,0.3),rgba(139,0,0,0.4))',color:'#ff9a8b',border:'1px solid rgba(231,76,60,0.3)'}}>{inits(t.from)}</div>
                    <div style={{fontSize:'0.68rem',color:'var(--muted)',textAlign:'center',maxWidth:52,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.from}</div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1,gap:5}}>
                    <div style={{fontSize:'1.2rem',color:'var(--muted)'}}>→</div>
                    <div style={{fontSize:'1.15rem',fontWeight:700,color:'var(--cream)'}}>${t.amount.toFixed(2)}</div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:50}}>
                    <div className="settle-av" style={{background:'linear-gradient(135deg,rgba(46,204,113,0.2),rgba(0,100,50,0.4))',color:'#7fffb0',border:'1px solid rgba(46,204,113,0.25)'}}>{inits(t.to)}</div>
                    <div style={{fontSize:'0.68rem',color:'var(--muted)',textAlign:'center',maxWidth:52,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.to}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LEADERBOARD SHEET
// ─────────────────────────────────────────────
function LeaderboardSheet({ gameId, eventId, players, onClose }: {
  gameId: string; eventId: string; players: Players; onClose: ()=>void;
}) {
  const [tab, setTab]   = useState<'live'|'alltime'>('live');
  const [rows, setRows] = useState<any[]>([]);

  useEffect(()=>{
    pkrFetch(`/events/${eventId}/leaderboard`).then(setRows).catch(()=>{});
  },[eventId]);

  const livePlayers = Object.values(players).filter(p=>p?.name && pBuyin(p)>0)
    .map(p=>({name:p.name,net:pNet(p),bi:pBuyin(p),co:pCash(p)}))
    .sort((a,b)=>b.net-a.net);

  return (
    <div style={{position:'fixed',inset:0,zIndex:600,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'flex-end',justifyContent:'center'}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:'#09180a',borderTop:'1px solid rgba(201,168,76,0.3)',borderRadius:'16px 16px 0 0',width:'100%',maxWidth:560,maxHeight:'88vh',display:'flex',flexDirection:'column'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',borderBottom:'1px solid var(--border)',flexShrink:0}}>
          <div style={{fontSize:'1.1rem',fontWeight:700,color:'var(--cream)'}}>🏆 Leaderboard</div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',fontSize:'1.2rem',cursor:'pointer',padding:'4px 8px'}}>✕</button>
        </div>
        <div style={{display:'flex',gap:8,padding:'12px 16px 0',flexShrink:0}}>
          {(['live','alltime'] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{flex:1,background:tab===t?'rgba(201,168,76,0.12)':'rgba(255,255,255,0.04)',border:`1px solid ${tab===t?'var(--gold)':'var(--border)'}`,borderRadius:'var(--rs)',padding:9,fontSize:'0.72rem',textTransform:'uppercase',letterSpacing:1,color:tab===t?'var(--gold)':'var(--muted)',cursor:'pointer',fontFamily:'DM Sans,sans-serif'}}>
              {t==='live'?'This Game':'All Time'}
            </button>
          ))}
        </div>
        <div style={{overflowY:'auto',flex:1,padding:'14px 16px 32px'}}>
          {tab==='live' ? (
            livePlayers.length === 0 ? (
              <div style={{textAlign:'center',padding:40,color:'var(--muted)',fontSize:'0.9rem'}}>No players yet</div>
            ) : livePlayers.map((p, i) => (
              <div key={p.name} className="lb-row">
                <div style={{width:30,textAlign:'center',fontWeight:700,color:i===0?'var(--gold)':i===1?'var(--cream)':'var(--muted)',flexShrink:0}}>{i===0?'🏆':'#'+(i+1)}</div>
                <div style={{width:38,height:38,borderRadius:'50%',background:'linear-gradient(135deg,#7a5820,#5a3010)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.78rem',fontWeight:700,color:'var(--cream)',flexShrink:0}}>{inits(p.name)}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:'1rem',fontWeight:600,color:'var(--cream)'}}>{p.name}</div>
                  <div style={{fontSize:'0.78rem',color:'var(--muted)'}}>In: {fmt(p.bi)} · Out: {fmt(p.co)}</div>
                </div>
                <div style={{fontSize:'1.1rem',fontWeight:700}} className={nc(p.net)}>{fmtNet(p.net)}</div>
              </div>
            ))
          ) : (
            rows.length === 0 ? (
              <div style={{textAlign:'center',padding:40,color:'var(--muted)',fontSize:'0.9rem'}}>No settled games yet</div>
            ) : rows.map((p: any, i: number) => {
              const net = p.total_net/100;
              return (
                <div key={p.user_id} className="lb-row">
                  <div style={{width:30,textAlign:'center',fontWeight:700,color:i===0?'var(--gold)':i===1?'var(--cream)':'var(--muted)',flexShrink:0}}>{i===0?'🏆':'#'+(i+1)}</div>
                  <div style={{width:38,height:38,borderRadius:'50%',background:'linear-gradient(135deg,#7a5820,#5a3010)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.78rem',fontWeight:700,color:'var(--cream)',flexShrink:0}}>{inits(p.display_name)}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:'1rem',fontWeight:600,color:'var(--cream)'}}>{p.display_name}</div>
                    <div style={{fontSize:'0.78rem',color:'var(--muted)'}}>{p.games_played} games</div>
                  </div>
                  <div style={{fontSize:'1.1rem',fontWeight:700,color:net>0?'var(--green)':net<0?'var(--red)':'var(--muted)'}}>{net>=0?'+':''}${Math.abs(net).toFixed(2)}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// GENERIC MODAL
// ─────────────────────────────────────────────
function Modal({ children, onClose }: { children: React.ReactNode; onClose: ()=>void }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:700,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:'#1a0a0a',border:'1px solid rgba(201,168,76,0.3)',borderRadius:16,padding:24,width:'100%',maxWidth:320,animation:'slideUp 0.2s ease'}}>
        {children}
      </div>
    </div>
  );
}
