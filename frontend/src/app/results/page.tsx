'use client';
import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import RecordMetric from '@/components/RecordMetric';
import {useRoomExperience} from '@/components/PokerClubStage';
import {api,fmtDate,fmtSign,type Event,type Game,type LeaderboardEntry} from '@/lib/api';
import {playerCountLabel} from '@/lib/game-player-count';
import {buildResultsShare,whatsappUrl} from '@/lib/whatsapp-sharing';
import {createPkrResultsImage} from '@/lib/pkr-results-image';
import './results.css';

type View='standings'|'history'|'insights';
const allowView=(s:string|null):View=>s==='history'||s==='insights'?s:'standings';
const ranks=(data:LeaderboardEntry[])=>[...data].sort((a,b)=>b.total_net-a.total_net||b.games_won-a.games_won);
export default function ResultsPage(){
 const router=useRouter();
 const experience=useRoomExperience();
 const [rooms,setRooms]=useState<Event[]>([]);
 const [selected,setSelected]=useState('');
 const [games,setGames]=useState<Game[]>([]);
 const [leaders,setLeaders]=useState<LeaderboardEntry[]>([]);
 const [view,setView]=useState<View>('standings');
 const [busy,setBusy]=useState(true);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [includeAmounts,setIncludeAmounts]=useState(false);
 const [sharing,setSharing]=useState('');
 const [notice,setNotice]=useState('');
 const [historyCount,setHistoryCount]=useState(15);
 const [search,setSearch]=useState('');
 const [sort,setSort]=useState<'net'|'average'|'profitable'|'games'>('net');
 const [minGames,setMinGames]=useState(false);

 // Open the Results main tab at its heading, never at the old page scroll offset.
 useEffect(()=>{
  const reset=()=>window.scrollTo({top:0,behavior:'instant'});
  reset();
  const frame=window.requestAnimationFrame(reset);
  return()=>window.cancelAnimationFrame(frame);
 },[]);

 useEffect(()=>{
  const query=new URLSearchParams(window.location.search);
  setView(allowView(query.get('view')));
  let alive=true;
  api.events.list().then(list=>{
   if(!alive)return;
   setRooms(list);
   let preferred='';try{preferred=localStorage.getItem('pkr_preferred_room')||'';}catch{}
   const requested=query.get('room')||'';
   setSelected(list.find(x=>x.id===requested)?.id||list.find(x=>x.id===preferred)?.id||
    list.find(x=>x.status!=='ended')?.id||list[0]?.id||'');
  }).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Unable to load poker rooms.')})
   .finally(()=>{if(alive)setBusy(false)});
  return()=>{alive=false};
 },[]);
 useEffect(()=>{
  if(!selected)return;
  let live=true;setLoading(true);setError('');
  Promise.all([api.games.list(selected),api.events.leaderboard(selected)]).then(([g,l])=>{
   if(live){setGames(g);setLeaders(l)}
  }).catch(e=>{if(live)setError(e instanceof Error?e.message:'Unable to load saved results.')})
   .finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[selected]);
 const room=rooms.find(r=>r.id===selected);
 const canShare=room?.role==='host'||room?.role==='cohost';
 const ordered=ranks(leaders);
 const settled=games.filter(g=>g.status==='settled').sort((a,b)=>b.scheduled_at-a.scheduled_at);
 const displayHistory=settled.slice(0,historyCount);
 const months=useMemo(()=>{
  const now=new Date();return Array.from({length:6},(_,i)=>{
   const start=new Date(now.getFullYear(),now.getMonth()-5+i,1);
   const end=new Date(now.getFullYear(),now.getMonth()-4+i,1);
   return{key:i,label:start.toLocaleDateString('en-AU',{month:'short'}),
     count:games.filter(g=>g.status==='settled'&&g.scheduled_at*1000>=start.getTime()&&g.scheduled_at*1000<end.getTime()).length};
  });
 },[games]);
 const highest=Math.max(1,...months.map(x=>x.count));
 const peakNet=Math.max(1,...ordered.map(p=>Math.abs(p.total_net)));
 const totalPlayed=leaders.reduce((sum,p)=>sum+p.games_played,0);
 const visibleStandings=useMemo(()=>{
  const q=search.trim().toLocaleLowerCase();
  const amount=(p:LeaderboardEntry)=>sort==='average'?
    (p.games_played?p.total_net/p.games_played:0):sort==='profitable'?
    p.games_won:sort==='games'?p.games_played:p.total_net;
  return leaders.filter(p=>(!minGames||p.games_played>=3)&&(!q||p.display_name.toLocaleLowerCase().includes(q)))
    .sort((a,b)=>amount(b)-amount(a)||b.total_net-a.total_net||a.display_name.localeCompare(b.display_name));
 },[leaders,search,sort,minGames]);

 function setSection(next:View){
  setView(next);setHistoryCount(15);setNotice('');
  window.scrollTo({top:0,behavior:'instant'});
  const url=new URL(window.location.href);url.searchParams.set('view',next);
  window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
 }
 function changeRoom(id:string){
  setSelected(id);setLoading(true);setGames([]);setLeaders([]);setHistoryCount(15);setNotice('');
  try{localStorage.setItem('pkr_preferred_room',id)}catch{}
  window.dispatchEvent(new CustomEvent('pkr:room-changed',{detail:id}));
  const url=new URL(window.location.href);url.searchParams.set('room',id);
  window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
 }
 async function shareResults(game:Game){
  if(!canShare||!game.results_token||sharing)return;
  const popup=window.open('about:blank','_blank');
  if(!popup){setNotice('Allow pop-ups in this browser to share via WhatsApp.');return}
  setSharing(game.id);
  try{
   const latest=await api.games.results(game.results_token);
   if(latest.game.status!=='settled'||latest.game.variance!==0)
    throw Error('Results must be settled and reconciled before sharing.');
   const text=buildResultsShare({room:room?.name||latest.event.name,
     date:fmtDate(latest.game.scheduled_at),players:latest.players,includeAmounts});
   popup.location.replace(whatsappUrl(text));
   setNotice('Group-safe results opened in WhatsApp. Choose the intended group and tap Send.');
  }catch(e){popup.close();setNotice(e instanceof Error?e.message:'Unable to share results.')}
  finally{setSharing('')}
 }
 async function resultsImage(game:Game){
  if(!canShare||!game.results_token||sharing)return;
  setSharing(game.id);
  try{
   const latest=await api.games.results(game.results_token);
   if(latest.game.status!=='settled'||latest.game.variance!==0)
    throw Error('Results must be settled and reconciled.');
   const blob=await createPkrResultsImage({room:room?.name||latest.event.name,
     date:fmtDate(latest.game.scheduled_at),players:latest.players,includeAmounts});
   const file=new File([blob],'PKR-results.png',{type:'image/png'});
   if(navigator.share&&navigator.canShare?.({files:[file]})){
    try{await navigator.share({files:[file],title:'PKR game results'});return}
    catch(e){if((e as Error)?.name==='AbortError')return}
   }
   const src=URL.createObjectURL(blob);const link=document.createElement('a');
   link.href=src;link.download='PKR-results.png';link.click();
   window.setTimeout(()=>URL.revokeObjectURL(src),4000);
   setNotice('Results image saved. Share it with your poker group.');
  }catch(e){setNotice(e instanceof Error?e.message:'Unable to create image.')}
  finally{setSharing('')}
 }
 return <main className={'pkr-primary-page pkr-results-page pkr-results-experience-'+experience}>
  <div className="pkr-primary-page-inner">
   <div className="pkr-results-room-bar">
    <span className="pkr-results-room-identity"><span aria-hidden="true">♠</span> PKR <small>/ RESULTS</small></span>
    {rooms.length>1&&<label>Club
     <select aria-label="Results poker club" value={selected} onChange={e=>changeRoom(e.target.value)}>
      {rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
     </select></label>}
   </div>
   {experience==='command'?
    <header className="pkr-results-command-hero" data-testid="command-results-stage"
     aria-label="Command Centre results overview">
     <div className="pkr-results-command-title">
       <span className="pkr-results-hero-eyebrow">◆ COMMAND CENTRE · PERFORMANCE</span>
       <h1>Results</h1><span className="pkr-results-command-tagline">At a glance.</span>
       <p>{room?.name||'Your private poker club'} · Player rankings, settled sessions and history.</p>
     </div>
     <div className="pkr-results-command-stats">
       <div><small>Ranked players</small><strong>{ordered.length}</strong></div>
       <div><small>Completed games</small><strong>{settled.length}</strong></div>
       <div><small>Top performer</small><strong className="pkr-results-command-winner">{ordered[0]?.display_name||'—'}</strong></div>
     </div>
    </header>:
    <header className="pkr-results-live-hero" data-testid="live-results-stage"
     aria-label="Live Poker results table">
     <div className="pkr-results-live-intro">
       <span className="pkr-results-hero-eyebrow">♠ LIVE POKER · {room?.name||'YOUR CLUB'}</span>
       <h1>Results</h1>
       <p>Real results. Real rivalries.</p>
       <span className="pkr-results-live-count">{settled.length} settled games · {ordered.length} players</span>
     </div>
     <div className="pkr-results-live-table" aria-label="Top three players at the felt">
       <span className="pkr-results-table-brand">PKR <small>ALL TIME</small></span>
       {ordered.slice(0,3).map((p,i)=><RecordMetric key={p.user_id||p.display_name}
        className={'pkr-results-felt-seat pkr-results-felt-seat-'+i}
        request={{kind:'player',title:p.display_name+' — game history',roomId:selected,
         playerId:p.user_id,playerName:p.display_name}}>
         <span className="pkr-results-seat-chip">#{i+1}</span>
         <span className="pkr-results-seat-player">{p.display_name}</span>
         <b className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</b>
       </RecordMetric>)}
       {!ordered.length&&<span className="pkr-results-felt-empty">Results appear after your first settled game</span>}
     </div>
    </header>}
  <nav className="pkr-section-tabs" aria-label="Results sections">
   {([['standings','Standings'],['history','History'],['insights','Insights']] as const).map(([key,title])=>
    <button type="button" key={key} onClick={()=>setSection(key)}
      aria-current={view===key?'page':undefined}>{title}
      {key==='history'&&settled.length>0&&<span className="pkr-section-count">{settled.length}</span>}</button>)}
  </nav>
  {error&&<p role="alert" className="pkr-primary-empty">{error}</p>}
  {busy?<p role="status" className="pkr-primary-empty">Loading your poker clubs…</p>:
   rooms.length===0?<div className="pkr-primary-empty">There are no poker clubs yet. <button className="pkr-primary-outline" onClick={()=>router.push('/dashboard')}>Go to Home</button></div>:
   loading?<p role="status" className="pkr-primary-empty">Loading saved poker results…</p>:
  <>
  {view==='standings'&&<>
    <div className="pkr-results-board-top">
      <div><span className="pkr-results-board-eyebrow">
        {experience==='command'?'COMMAND CENTRE / CLUB PERFORMANCE':'LIVE POKER / FELT RANKINGS'}</span>
        <h2>{experience==='command'?'All-time standings':'Players at the felt'}</h2></div>
      <span className="pkr-results-board-counter">{ordered.length} ranked players</span>
    </div>
    <div className={'pkr-results-standings-layout pkr-results-layout-'+experience}>
      {experience==='command'&&ordered.length>0&&
       <aside className="pkr-results-command-leaders" aria-label="Top three club performers">
        <span className="pkr-results-board-eyebrow">◆ THE PERFORMANCE DESK</span>
        <h3>Club leaders</h3>
        <p>Lifetime net results from completed games.</p>
        <div className="pkr-results-command-podium">
          {ordered.slice(0,3).map((player,i)=><RecordMetric key={player.user_id||player.display_name}
            className={'pkr-results-command-leader pkr-results-command-leader-'+i}
            request={{kind:'player',title:player.display_name+' — game history',roomId:selected,
              playerId:player.user_id,playerName:player.display_name}}>
            <span className="pkr-results-command-place">{i===0?'♛':'0'+(i+1)}</span>
            <span className="pkr-results-command-person"><strong>{player.display_name}</strong>
              <small>{player.games_played} games · {player.games_won} profitable</small></span>
            <b className={player.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(player.total_net)}</b>
          </RecordMetric>)}
        </div>
        <div className="pkr-results-command-foot"><span aria-hidden="true">♠</span>
         Tap a player to inspect their saved results</div>
       </aside>}
      <section className={'pkr-results-board pkr-results-board-'+experience} aria-label="Club player standings">
       <div className="pkr-results-board-heading">
        <div><span className="pkr-results-board-eyebrow">{experience==='command'?'PLAYER RECORDS':'♠ ON THE FELT'}</span>
          <h3>{experience==='command'?'Player ledger':'The player board'}</h3></div>
        <small>Tap a name for game history</small>
       </div>
       <div className="pkr-results-filters">
        <label>Find player
         <input type="search" aria-label="Search results by player" placeholder="Search names…"
          value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <label>Rank by
         <select aria-label="Sort results standings" value={sort}
           onChange={e=>setSort(e.target.value as 'net'|'average'|'profitable'|'games')}>
          <option value="net">Total net</option>
          <option value="average">Average per game</option>
          <option value="profitable">Profitable games</option>
          <option value="games">Games played</option>
         </select></label>
        <label className="pkr-results-min-games"><input type="checkbox" checked={minGames}
          onChange={e=>setMinGames(e.target.checked)}/> 3+ games</label>
       </div>
       {visibleStandings.length?
        experience==='command'?
        <div className="pkr-results-command-ranking" aria-label="Ranked player ledger">
          <div className="pkr-results-ledger-columns" aria-hidden="true">
            <span>RANK</span><span>PLAYER</span><span>GAMES</span><span>RESULT</span><span/>
          </div>
          {visibleStandings.map((player,i)=><RecordMetric key={player.user_id||player.display_name}
            className="pkr-results-ledger-row" request={{
              kind:'player',title:player.display_name+' — game history',roomId:selected,
              playerId:player.user_id,playerName:player.display_name}}>
            <span className="pkr-results-ledger-position">{String(i+1).padStart(2,'0')}</span>
            <span className="pkr-results-ledger-person"><strong>{player.display_name}</strong>
             <small>{player.games_won} profitable games{player.identity_review_required?' · Identity review':''}</small></span>
            <span className="pkr-results-ledger-games">{player.games_played}<small>played</small></span>
            <span className="pkr-results-ledger-net"><b className={player.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>
             {sort==='average'?fmtSign(player.games_played?Math.round(player.total_net/player.games_played):0):fmtSign(player.total_net)}
             </b><small>{sort==='average'?'AVG / GAME':'NET RESULT'}</small></span>
            <span className="pkr-results-ledger-arrow" aria-hidden="true">›</span>
           </RecordMetric>)}
        </div>:
        <div className="pkr-results-live-ranking" aria-label="Players ranked at the poker table">
          {visibleStandings.map((player,i)=><RecordMetric key={player.user_id||player.display_name}
            className="pkr-results-live-player" request={{
             kind:'player',title:player.display_name+' — game history',roomId:selected,
             playerId:player.user_id,playerName:player.display_name}}>
            <span className={'pkr-results-live-chip pkr-results-live-chip-'+(i%3)}>{i+1}</span>
            <span className="pkr-results-live-person"><strong>{player.display_name}</strong>
             <small>{player.games_played} games · {player.games_won} profitable
               {player.identity_review_required?' · Identity review':''}</small></span>
            <span className="pkr-results-live-net"><b className={player.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>
             {sort==='average'?fmtSign(player.games_played?Math.round(player.total_net/player.games_played):0):fmtSign(player.total_net)}
             </b><small>{sort==='average'?'AVG / GAME':'ALL-TIME NET'}</small></span>
            <span className="pkr-results-live-arrow" aria-hidden="true">›</span>
           </RecordMetric>)}
        </div>:
        <div className="pkr-primary-empty">
         {ordered.length?'No players match your search or filters.':'Standings appear after the first settled game.'}
        </div>}
      </section>
    </div>
   </>}
  {view==='history'&&<section className="pkr-primary-panel pkr-results-history-panel">
   <div className="pkr-results-history-title"><div><h2>Completed games</h2><p>{settled.length} settled sessions saved in this club.</p></div>
    {canShare&&<label className="pkr-results-amount-option"><input type="checkbox"
      checked={includeAmounts} onChange={e=>setIncludeAmounts(e.target.checked)}/>Include player net amounts in group results</label>}
   </div>
   {displayHistory.length?displayHistory.map(game=><div className="pkr-primary-row" key={game.id}>
    <div><strong>{fmtDate(game.scheduled_at)}</strong>
     <small>{game.location||room?.name||'Game'} · {playerCountLabel(game.player_count)}</small></div>
    <div className="pkr-primary-row-actions">
     <button className="pkr-primary-outline" type="button"
       onClick={()=>router.push(game.results_token?'/games/results/'+encodeURIComponent(game.results_token):'/games/'+encodeURIComponent(game.id))}>View results →</button>
     {canShare&&game.results_token&&<button className="pkr-primary-outline" type="button" disabled={!!sharing}
       onClick={()=>void shareResults(game)}>{sharing===game.id?'Preparing…':'Share in WhatsApp'}</button>}
     {canShare&&game.results_token&&<button className="pkr-primary-outline" type="button" disabled={!!sharing}
       onClick={()=>void resultsImage(game)}>Results image</button>}
    </div>
   </div>):<div className="pkr-primary-empty">No games have been settled yet. When a game finishes, it will appear here.</div>}
   {settled.length>historyCount&&<button type="button" className="pkr-primary-outline"
     onClick={()=>setHistoryCount(n=>n+15)} style={{marginTop:16}}>Show more games ({settled.length-historyCount} remaining)</button>}
  </section>}
  {view==='insights'&&<>
   <div className="pkr-primary-grid">
    <div className="pkr-primary-metric"><small>Completed games</small><strong>{settled.length}</strong><span>From this club</span></div>
    <div className="pkr-primary-metric"><small>Players with results</small><strong>{ordered.length}</strong><span>In settled games</span></div>
    <div className="pkr-primary-metric"><small>Recorded player appearances</small><strong>{totalPlayed}</strong><span>Across the leaderboard records</span></div>
   </div>
   <section className="pkr-primary-panel">
    <h2>Games completed over six months</h2>
    <p>Counts of settled sessions, not estimated future sessions.</p>
    <div className="pkr-results-trend" role="group" aria-label="Settled games by month">
     {months.map(m=><div className="pkr-results-trend-col" key={m.key}>
       <strong>{m.count}</strong><div><span style={{height:(m.count/highest*100)+'%'}}/></div><small>{m.label}</small>
      </div>)}
    </div>
   </section>
   <section className="pkr-primary-panel pkr-results-net-panel" aria-label="Player net results graph">
    <div className="pkr-results-net-heading">
     <div><h2>Player net results</h2><p>Lifetime results from settled games. Select a player to review their game history.</p></div>
     <span className="pkr-results-net-legend"><i className="gain"/> Gain <i className="loss"/> Loss</span>
    </div>
    {ordered.length?<div className="pkr-results-net-chart" role="group" aria-label="Red and green player net result bars">
     {ordered.map(p=><RecordMetric bare key={p.user_id||p.display_name} className="pkr-results-net-row"
      request={{kind:'player',title:p.display_name+' — game history',roomId:selected,playerId:p.user_id,playerName:p.display_name}}>
      <span className="pkr-results-net-person"><strong>{p.display_name}</strong><small>{p.games_played} games</small></span>
      <span className="pkr-results-net-track" aria-hidden="true"><i className={p.total_net>0?'gain':p.total_net<0?'loss':'even'}
       style={{width:Math.max(p.total_net===0?0:3,Math.round(Math.abs(p.total_net)/peakNet*100))+'%'}}/></span>
      <b className={'pkr-results-net-amount '+(p.total_net>0?'pkr-vnext-positive':p.total_net<0?'pkr-vnext-negative':'')}>{fmtSign(p.total_net)}</b>
     </RecordMetric>)}
    </div>:<p>No settled games or player results yet.</p>}
   </section>
  </>}
  </>}
  {notice&&<p role="status" className="pkr-account-notice">{notice}</p>}
 </div></main>;
}
