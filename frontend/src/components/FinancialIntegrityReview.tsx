'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {api,type Game} from '@/lib/api';
import {reviewSettledGame,summariseGameIntegrity,type GameIntegritySummary} from '@/lib/settlement-integrity';

type Unavailable={id:string;scheduledAt:number};
type ReviewState={
 loading:boolean;checked:number;total:number;
 summaries:GameIntegritySummary[];
 unavailable:Unavailable[];
 error:string;
};

const date=new Intl.DateTimeFormat('en-AU',{
 day:'2-digit',month:'short',year:'numeric',timeZone:'Australia/Brisbane',
});
function gameDate(stamp:number){return date.format(new Date(stamp*1000));}
const aud=(value:number)=>new Intl.NumberFormat('en-AU',{
 style:'currency',currency:'AUD',minimumFractionDigits:2,
}).format(value/100);

export default function FinancialIntegrityReview({roomId}:{roomId:string}){
 const [run,setRun]=useState(0);
 const [visibleLimit,setVisibleLimit]=useState(20);
 const [state,setState]=useState<ReviewState>({
  loading:true,checked:0,total:0,summaries:[],unavailable:[],error:'',
 });
 const refresh=useCallback(()=>{setVisibleLimit(20);setRun(previous=>previous+1);},[]);

 useEffect(()=>{
  let active=true;
  const cancelled=()=>!active;
  setState({loading:true,checked:0,total:0,summaries:[],unavailable:[],error:''});
  const inspect=async()=>{
   try{
    const all=await api.games.list(roomId,'settled');
    if(cancelled())return;
    if(!Array.isArray(all))throw new Error('The saved game list is unavailable');
    // Only approved members can fetch games; the calling Payments view
    // additionally restricts this diagnostic to the current room host.
    const settled=all.filter(game=>game.event_id===roomId&&game.status==='settled'&&
      typeof game.id==='string'&&Number.isSafeInteger(game.scheduled_at));
    const ordered=[...settled].sort((a,b)=>b.scheduled_at-a.scheduled_at||
      a.id.localeCompare(b.id));
    if(cancelled())return;
    setState(previous=>({...previous,total:ordered.length}));
    if(!ordered.length){setState({loading:false,checked:0,total:0,summaries:[],unavailable:[],error:''});return;}
    const summaries:GameIntegritySummary[]=[];
    const unavailable:Unavailable[]=[];
    // Bounded concurrency: four existing authenticated read-only requests,
    // not an unbounded fan-out or a new privileged backend endpoint.
    for(let start=0;start<ordered.length;start+=4){
     if(cancelled())return;
     const group=ordered.slice(start,start+4);
     const batch=await Promise.allSettled(group.map(game=>api.games.get(game.id)));
     if(cancelled())return;
     batch.forEach((item,index)=>{
      const game:Game=group[index];
      if(item.status!=='fulfilled'||item.value?.id!==game.id||
         item.value.event_id!==roomId||item.value.status!=='settled'){
       unavailable.push({id:game.id,scheduledAt:game.scheduled_at});
       return;
      }
      try{summaries.push(reviewSettledGame(item.value));}
      catch{unavailable.push({id:game.id,scheduledAt:game.scheduled_at});}
     });
     setState({loading:start+4<ordered.length,checked:summaries.length+unavailable.length,
      total:ordered.length,summaries:[...summaries],unavailable:[...unavailable],error:''});
    }
   }catch(error){
    if(cancelled())return;
    setState(previous=>({...previous,loading:false,
     error:error instanceof Error?error.message:'The saved games could not be checked.'}));
   }
  };
  void inspect();
  return()=>{active=false;};
 },[roomId,run]);

 const totals=useMemo(()=>summariseGameIntegrity(state.summaries),[state.summaries]);
 const flagged=useMemo(()=>state.summaries.filter(game=>game.needsReview)
  .sort((a,b)=>b.scheduledAt-a.scheduledAt||a.gameId.localeCompare(b.gameId)),[state.summaries]);
 const completed=!state.loading&&!state.error&&state.checked===state.total&&
  state.unavailable.length===0;
 const incomplete=state.unavailable.length>0||state.checked<state.total||!!state.error;

 return <section className="pkr-finance-integrity" data-testid="pkr-finance-integrity"
   aria-label="Read-only settled game review">
  <div className="pkr-finance-integrity-heading">
   <div>
    <h3>Saved game integrity</h3>
    <p>Checks saved player results and distinguishes arithmetic differences from historical buy-ins that were never recorded. Review evidence before changing any result or payment.</p>
   </div>
   <button type="button" onClick={refresh} disabled={state.loading}>Recheck</button>
  </div>
  <div className="pkr-finance-integrity-metrics" aria-live="polite">
   <span><strong>{state.checked} / {state.total}</strong><small>Games checked</small></span>
   <span><strong>{totals.flagged}</strong><small>Games to review</small></span>
   <span><strong>{totals.historical}</strong><small>Unverified buy-in differences</small></span>
   <span><strong>{totals.incomplete}</strong><small>Incomplete players</small></span>
  </div>
  <p className="pkr-finance-integrity-breakdown">{totals.recorded} differences against recorded buy-ins · {totals.historical} differences against historical estimates. An estimated amount is not proof that a saved net result is wrong.</p>
  {state.loading&&<p role="status" className="pkr-finance-integrity-notice">Checking saved game records. Results are provisional until every game has loaded.</p>
  {state.error&&<p role="alert" className="pkr-finance-integrity-warning">{state.error} Please retry; do not interpret this as a zero balance.</p>}
  {!state.loading&&incomplete&&state.unavailable.length>0&&
   <p role="alert" className="pkr-finance-integrity-warning">
    {state.unavailable.length} saved {state.unavailable.length===1?'game was':'games were'} unavailable. These records have not been verified and must not be treated as balanced.
   </p>}
  {completed&&flagged.length===0&&<p role="status" className="pkr-finance-integrity-notice">
   No differences detected against the available figures. Historical buy-ins may still need evidence; this does not confirm receipt of any transfer.
  </p>}
  {flagged.length>0&&<div className="pkr-finance-integrity-results">
   <h4>Games requiring review</h4>
   {flagged.slice(0,visibleLimit).map(game=>{
    const issues=[
     game.historicalBasisDifferences>0?game.historicalBasisDifferences+' uncertain historical '+(game.historicalBasisDifferences===1?'buy-in':'buy-ins'):null,
     game.savedArithmeticDifferences>0?game.savedArithmeticDifferences+' saved arithmetic '+(game.savedArithmeticDifferences===1?'difference':'differences'):null,
     game.missingPlayers>0?game.missingPlayers+' incomplete '+(game.missingPlayers===1?'record':'records'):null,
     game.nonZeroSavedNet?'Saved net total '+aud(game.savedNetCents):null,
     game.inconsistentGameVariance?'Game variance differs from saved player results':null,
     game.emptyPlayerRoster?'No player records':null,
    ].filter(Boolean);
    return <div key={game.gameId} className="pkr-finance-integrity-game">
      <div className="pkr-finance-integrity-row">
     <span><strong>{gameDate(game.scheduledAt)}</strong>
      <small>{game.playerRecords} {game.playerRecords===1?'player':'players'} · {issues.join(' · ')}</small>
     </span>
     <Link href={'/games/'+encodeURIComponent(game.gameId)}>Open saved game</Link>
      </div>
      {game.playerIssues.length>0&&<details className="pkr-finance-integrity-players">
        <summary>Player records to review ({game.playerIssues.length})</summary>
        <div className="pkr-finance-integrity-player-list">
         {game.playerIssues.map((player,index)=><div className="pkr-finance-integrity-player" key={player.key+'-'+index}>
           <strong>{player.displayName}</strong>
           <p>{player.explanation}</p>
           <dl>
             <div><dt>Buy-ins</dt><dd>{player.buyIns===null?'Unrecorded':player.buyIns}</dd></div>
             <div><dt>Saved buy-in total</dt><dd>{player.recordedBuyinCents===null?'Missing':aud(player.recordedBuyinCents)}</dd></div>
             <div><dt>Comparison basis</dt><dd>{player.comparisonBuyinCents===null?'Unavailable':aud(player.comparisonBuyinCents)}{player.buyinSource==='current-default-estimate'?' (current club rate estimate)':''}</dd></div>
             <div><dt>Cash-out</dt><dd>{player.cashoutCents===null?'Missing':aud(player.cashoutCents)}</dd></div>
             <div><dt>Saved net</dt><dd>{player.netCents===null?'Missing':aud(player.netCents)}</dd></div>
             <div><dt>Calculated net</dt><dd>{player.comparisonNetCents===null?'Unavailable':aud(player.comparisonNetCents)}</dd></div>
           </dl>
         </div>)}
        </div>
      </details>}
    </div>;
   })}
   {flagged.length>visibleLimit&&
    <button type="button" className="pkr-finance-integrity-more" onClick={()=>setVisibleLimit(v=>v+20)}>
     Show more games ({flagged.length-visibleLimit} remaining)
    </button>}
  </div>}
  {state.unavailable.length>0&&<div className="pkr-finance-integrity-results">
   <h4>Games not yet checked</h4>
   {state.unavailable.slice(0,10).map(game=>
    <div className="pkr-finance-integrity-row" key={game.id}>
     <span><strong>{gameDate(game.scheduledAt)}</strong><small>Game could not be loaded</small></span>
     <Link href={'/games/'+encodeURIComponent(game.id)}>Open saved game</Link>
    </div>)}
   {state.unavailable.length>10&&<p>Additional unavailable games: {state.unavailable.length-10}</p>}
  </div>}
  <p className="pkr-finance-integrity-footnote">Read-only. Historical buy-in comparisons use today's club default when an original amount was not saved, so they are not conclusive. Confirm the original settlement, buy-in and cash-out evidence before correcting records. This check cannot alter players, cash balances, transfers or payment statuses.</p>
 </section>;
}
