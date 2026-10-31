'use client';
import {useEffect,useMemo,useState} from 'react';
import {useRouter} from 'next/navigation';
import RecordMetric from '@/components/RecordMetric';
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
 return <main className="pkr-primary-page pkr-results-page"><div className="pkr-primary-page-inner">
  <header className="pkr-primary-page-head">
   <div><span className="pkr-primary-kicker">PERFORMANCE · HISTORY · INSIGHTS</span><h1>Results</h1>
    <p>Player standings, complete game history and meaningful performance trends — all in one place.</p>
   </div>
   {rooms.length>0&&<label>Poker club
    <select aria-label="Results poker club" value={selected} onChange={e=>changeRoom(e.target.value)}>
     {rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
    </select></label>}
  </header>
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
   <div className="pkr-primary-grid pkr-results-summary">
    <div className="pkr-primary-metric"><small>Recorded players</small><strong>{ordered.length}</strong><span>With settled results</span></div>
    <div className="pkr-primary-metric"><small>Completed games</small><strong>{settled.length}</strong><span>Final results</span></div>
    <div className="pkr-primary-metric"><small>Top recorded player</small><strong className="pkr-results-top-name">{ordered[0]?.display_name||'—'}</strong><span>{ordered.length?fmtSign(ordered[0].total_net):'No settled results yet'}</span></div>
   </div>
   <section className="pkr-primary-panel">
    <h2>Player standings</h2>
    <p>All recorded players with settled results. Select a player's record to see detailed results and source games.</p>
    {ordered.length>0&&<div className="pkr-results-podium" aria-label="Top three players by net result">
     {ordered.slice(0,3).map((p,i)=><RecordMetric key={p.user_id||p.display_name}
       className="pkr-results-podium-card" request={{kind:'player',title:p.display_name+' — game history',roomId:selected,
        playerId:p.user_id,playerName:p.display_name}}>
       <span>#{i+1} ALL TIME</span><strong>{p.display_name}</strong>
       <b className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</b>
       <small>{p.games_played} games · {p.games_won} profitable</small>
      </RecordMetric>)}
    </div>}
    <div className="pkr-results-filters">
      <label>Search players<input type="search" aria-label="Search results by player" placeholder="Find a player…"
        value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label>Rank by<select aria-label="Sort results standings" value={sort}
        onChange={e=>setSort(e.target.value as 'net'|'average'|'profitable'|'games')}>
         <option value="net">Total net</option><option value="average">Average per game</option>
         <option value="profitable">Profitable games</option><option value="games">Games played</option>
       </select></label>
      <label className="pkr-results-min-games"><input type="checkbox" checked={minGames}
        onChange={e=>setMinGames(e.target.checked)}/> 3+ games</label>
    </div>
    {visibleStandings.length?<div className="pkr-results-ranking">
     {visibleStandings.map((player,i)=><RecordMetric key={player.user_id||player.display_name}
       className="pkr-results-rank" request={{
        kind:'player',title:player.display_name+' — game history',roomId:selected,
        playerId:player.user_id,playerName:player.display_name
       }}>
       <span className="pkr-results-rank-number">{i+1}</span>
       <span className="pkr-results-rank-name"><strong>{player.display_name}</strong>
        <small>{player.games_played} games · {player.games_won} profitable{player.identity_review_required?' · Identity review':''}</small></span>
       <span className={player.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{sort==='average'?fmtSign(player.games_played?Math.round(player.total_net/player.games_played):0):fmtSign(player.total_net)}</span>
       <span aria-hidden="true">›</span>
      </RecordMetric>)}
    </div>:<div className="pkr-primary-empty">{ordered.length?'No players match the selected filters.':'Standings appear after the first game has been settled.'}</div>}
   </section>
  </>}
  {view==='history'&&<section className="pkr-primary-panel">
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
   <section className="pkr-primary-panel"><h2>Player performance</h2>
    <p>Lifetime recorded net results by player; green indicates gains and red indicates losses.</p>
    {ordered.map(p=><RecordMetric key={p.user_id||p.display_name} className="pkr-primary-row"
      request={{kind:'player',title:p.display_name+' — game history',roomId:selected,playerId:p.user_id,playerName:p.display_name}}>
      <span><strong>{p.display_name}</strong><small>{p.games_played} games</small></span>
      <b className={p.total_net>=0?'pkr-vnext-positive':'pkr-vnext-negative'}>{fmtSign(p.total_net)}</b>
     </RecordMetric>)}
    {!ordered.length&&<p>No settled games or player results yet.</p>}
   </section>
  </>}
  </>}
  {notice&&<p role="status" className="pkr-account-notice">{notice}</p>}
 </div></main>;
}
