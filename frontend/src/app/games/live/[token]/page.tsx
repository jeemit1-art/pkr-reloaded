'use client';
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api, LiveData, fmt, fmtDate } from '@/lib/api';

export default function LivePage() {
  const { token } = useParams<{token:string}>();
  const [data, setData]       = useState<LiveData|null>(null);
  const [error, setError]     = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date|null>(null);
  const [secsAgo, setSecsAgo] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    async function load() {
      try {
        const d = await api.games.live(token);
        setData(d);
        setLastUpdated(new Date());
        if (d.game.status === 'settled' && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } catch { setError('Table not found'); }
    }
    load();
    intervalRef.current = setInterval(load, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  },[token]);

  useEffect(()=>{
    if (!lastUpdated) return;
    const t = setInterval(()=> setSecsAgo(Math.floor((Date.now()-lastUpdated.getTime())/1000)), 1000);
    return ()=>clearInterval(t);
  },[lastUpdated]);

  useEffect(()=>{
    if (!data || !tableRef.current) return;
    renderTable(tableRef.current, data);
  },[data]);

  if (error) return (
    <div style={{minHeight:'100vh',background:'#060e07',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{padding:32,textAlign:'center',color:'#e74c3c',fontSize:14}}>{error}</div>
    </div>
  );
  if (!data) return <Loader/>;

  const { game, event, players, totalIn, totalOut, bank } = data as any;
  const isSettled = game.status === 'settled';
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const resultsUrl = game.results_token ? `${appUrl}/games/results/${game.results_token}` : '';

  return (
    <div style={{minHeight:'100vh',background:'#060e07',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{flexShrink:0,background:'#060e07',borderBottom:'1px solid rgba(201,168,76,0.15)',
        display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',height:52}}>
        <div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:'1.05rem',fontWeight:700,color:'#c9a84c',
            overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'60vw'}}>{event.name}</div>
          <div style={{fontSize:'0.7rem',color:'#6b8c6e',marginTop:1}}>
            {isSettled ? 'Game settled' : `Live · Read Only · Updated ${secsAgo}s ago`}
          </div>
        </div>
        <span style={{fontSize:'0.7rem',padding:'3px 9px',borderRadius:2,fontWeight:500,letterSpacing:'0.16em',
          textTransform:'uppercase',border:`1px solid ${isSettled?'rgba(46,204,113,0.3)':'rgba(201,168,76,0.3)'}`,
          color:isSettled?'#2ecc71':'#c9a84c',background:isSettled?'rgba(46,204,113,0.06)':'rgba(201,168,76,0.06)'}}>
          {game.status}
        </span>
      </div>

      <div style={{flexShrink:0,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',
        borderBottom:'1px solid rgba(201,168,76,0.15)',background:'#060e07'}}>
        {[
          {l:'Buy-ins', v:fmt(totalIn)},
          {l:'Cashouts',v:fmt(totalOut)},
          {l:'In Bank', v:fmt(bank), gold:bank>0},
        ].map(s=>(
          <div key={s.l} style={{padding:'10px 0',textAlign:'center',borderRight:'1px solid rgba(201,168,76,0.08)'}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:'1rem',
              color:(s as any).gold?'#c9a84c':'#f0e6c8',fontWeight:500}}>{s.v}</div>
            <div style={{fontSize:'0.6rem',letterSpacing:'0.16em',textTransform:'uppercase',
              color:'#6b8c6e',marginTop:2}}>{s.l}</div>
          </div>
        ))}
      </div>

      {isSettled && resultsUrl && (
        <div style={{flexShrink:0,background:'rgba(46,204,113,0.06)',
          borderBottom:'1px solid rgba(46,204,113,0.2)',
          padding:'10px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div style={{fontSize:12,color:'#2ecc71',fontWeight:600}}>✓ Game Settled</div>
          <a href={resultsUrl} style={{padding:'6px 12px',background:'#c9a84c',color:'#000',borderRadius:3,
            fontSize:11,fontWeight:700,textDecoration:'none',whiteSpace:'nowrap'}}>View Results →</a>
        </div>
      )}

      <div ref={tableRef} style={{flex:1,position:'relative',overflow:'hidden',minHeight:0}}>
        <div id="liveTableWrap" style={{position:'absolute',inset:0,display:'flex',
          alignItems:'center',justifyContent:'center'}}>
          <div id="liveTableOuter"></div>
          <div id="liveTableFelt" style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
            <div style={{textAlign:'center',zIndex:1,padding:8,pointerEvents:'none'}}>
              <div id="liveTableName" style={{fontFamily:"'Playfair Display',serif",
                fontSize:'clamp(0.7rem,2vw,1rem)',color:'rgba(240,230,200,0.55)',
                letterSpacing:2,textTransform:'uppercase'}}></div>
              <div id="liveTableStats" style={{fontSize:'clamp(0.6rem,1.5vw,0.75rem)',
                color:'rgba(201,168,76,0.45)',marginTop:5,letterSpacing:1}}></div>
            </div>
          </div>
          <div id="liveSeatsContainer" style={{position:'absolute',inset:0}}></div>
        </div>
      </div>

      <div style={{flexShrink:0,padding:'10px 16px',textAlign:'center',
        fontSize:11,color:'rgba(107,140,110,0.6)',borderTop:'1px solid rgba(201,168,76,0.08)'}}>
        {fmtDate(game.scheduled_at)}{game.location?` · ${game.location}`:''}
      </div>
    </div>
  );
}

function esc(s:string):string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderTable(container: HTMLDivElement, data: any) {
  const { game, players, buyInAmt } = data as any;
  const wrap = container.querySelector('#liveTableWrap') as HTMLElement;
  if (!wrap) return;
  const W = wrap.offsetWidth, H = wrap.offsetHeight;
  if (!W || !H) { setTimeout(()=>renderTable(container, data), 80); return; }

  const tH = Math.min(H * 0.72, 480);
  const tW = Math.min(W * 0.42, tH * 0.52);
  const cx = W/2, cy = H/2, pad = 14;

  const outer = container.querySelector('#liveTableOuter') as HTMLElement;
  const felt  = container.querySelector('#liveTableFelt') as HTMLElement;
  if (outer) outer.style.cssText = `position:absolute;border-radius:36px;background:linear-gradient(135deg,#5a3010,#3d1f08);box-shadow:0 8px 40px rgba(0,0,0,0.7);width:${tW+pad*2}px;height:${tH+pad*2}px;left:${cx-(tW+pad*2)/2}px;top:${cy-(tH+pad*2)/2}px`;
  if (felt)  felt.style.cssText  = `position:absolute;border-radius:28px;background:radial-gradient(ellipse at 50% 40%,#1e6b2a,#155220 55%,#0e3a18);display:flex;align-items:center;justify-content:center;width:${tW}px;height:${tH}px;left:${cx-tW/2}px;top:${cy-tH/2}px`;

  const tnEl = container.querySelector('#liveTableName') as HTMLElement;
  const tsEl = container.querySelector('#liveTableStats') as HTMLElement;
  const seated = players.filter((p:any)=>p.display_name);
  const active = seated.filter((p:any)=>p.buy_ins>0 && !p.cashout).length;
  if (tnEl) tnEl.textContent = game.name || 'PKR';
  if (tsEl) tsEl.textContent = seated.length ? `${active} active · ${seated.length} seated` : '';

  const seatMap: Record<number,any> = {};
  players.forEach((p:any)=>{ if (p.seat_number) seatMap[p.seat_number] = p; });

  const seatsEl = container.querySelector('#liveSeatsContainer') as HTMLElement;
  if (!seatsEl) return;
  seatsEl.innerHTML = '';

  const count = game.seats || 9;
  const chipSize = Math.max(24, Math.min(tW*0.22, 44, 44-Math.max(0,count-9)*2));
  const seatGap = chipSize+6;
  const sideCount = count-2;
  const leftCount = Math.ceil(sideCount/2);
  const rightCount = Math.floor(sideCount/2);
  const hOff = tW/2+seatGap, vOff = tH/2+seatGap;
  const positions:{x:number,y:number}[] = [];
  positions.push({x:cx, y:cy-vOff});
  for (let i=0;i<leftCount;i++) { const sp=tH/(leftCount+1); positions.push({x:cx-hOff, y:cy+(-tH/2+sp*(i+1))}); }
  positions.push({x:cx, y:cy+vOff});
  for (let j=0;j<rightCount;j++) { const sp=tH/(rightCount+1); positions.push({x:cx+hOff, y:cy+(-tH/2+sp*(j+1))}); }

  const cs = chipSize+'px';
  const initFs = Math.max(8,chipSize*0.34)+'px';
  const emptyFs = Math.max(12,chipSize*0.52)+'px';

  positions.forEach((pos,i)=>{
    const seatNum = i+1;
    const p = seatMap[seatNum];
    const seat = document.createElement('div');
    seat.style.cssText = `position:absolute;transform:translate(-50%,-50%);z-index:5;display:flex;flex-direction:column;align-items:center;gap:3px;left:${pos.x}px;top:${pos.y}px`;
    if (p && p.display_name) {
      const biAmt = (p.buy_in_total||0)>0 ? p.buy_in_total : (p.buy_ins||0)*(buyInAmt||0);
      const co = p.cashout||0;
      const net = p.net!=null ? p.net : (co>0 ? co-biAmt : null);
      const netColor = net==null?'':net>0?'#2ecc71':net<0?'#e74c3c':'#6b8c6e';
      const chipBg = co>0?'linear-gradient(135deg,#0a2a1a,#061510)':'linear-gradient(135deg,#1a3a1a,#0d2010)';
      const chipBorder = co>0?'rgba(46,204,113,0.5)':'#c9a84c';
      const initials = p.display_name.split(' ').map((w:string)=>w[0]||'').join('').slice(0,2).toUpperCase();
      const netStr = net==null?'':(net>0?`+${fmt(net)}`:fmt(net));
      seat.innerHTML = `
        <div style="width:${cs};height:${cs};border-radius:50%;border:2.5px solid ${chipBorder};background:${chipBg};display:flex;align-items:center;justify-content:center">
          <span style="font-size:${initFs};font-weight:700;color:#f0e6c8">${esc(initials)}</span>
        </div>
        <div style="font-size:clamp(0.75rem,2vw,0.9rem);font-weight:600;color:#fff;max-width:clamp(68px,16vw,96px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;background:rgba(0,0,0,0.6);padding:2px 7px;border-radius:5px;text-shadow:0 1px 3px rgba(0,0,0,0.9)">${esc(p.display_name)}</div>
        ${p.buy_ins>0?`<div style="font-size:clamp(0.6rem,1.5vw,0.72rem);color:rgba(201,168,76,0.7)">×${p.buy_ins}${buyInAmt?` · ${fmt(biAmt)}`:''}</div>`:''}
        ${net!=null?`<div style="font-size:clamp(0.62rem,1.6vw,0.78rem);font-weight:700;color:${netColor};text-shadow:0 1px 2px rgba(0,0,0,0.8)">${netStr}</div>`:''}
      `;
    } else {
      seat.innerHTML = `
        <div style="width:${cs};height:${cs};border-radius:50%;border:2px solid rgba(201,168,76,0.25);background:#0d1a0f;display:flex;align-items:center;justify-content:center">
          <span style="font-size:${emptyFs};color:rgba(201,168,76,0.3)">·</span>
        </div>
        <div style="opacity:0.3;font-size:0.8rem;color:#fff;background:rgba(0,0,0,0.4);padding:2px 7px;border-radius:5px">Seat ${seatNum}</div>
      `;
    }
    seatsEl.appendChild(seat);
  });
}

function Loader() {
  return (
    <div style={{minHeight:'100vh',background:'#060e07',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:48,color:'#c9a84c',opacity:0.5}}>PKR</div>
      <div style={{fontSize:'0.75rem',color:'rgba(107,140,110,0.6)',letterSpacing:'0.15em',textTransform:'uppercase'}}>Loading table...</div>
      <div style={{width:120,height:2,background:'rgba(201,168,76,0.1)',borderRadius:1,overflow:'hidden'}}>
        <div style={{width:'40%',height:'100%',background:'rgba(201,168,76,0.4)',borderRadius:1,animation:'slide 1.2s ease-in-out infinite'}}></div>
      </div>
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}`}</style>
    </div>
  );
}
