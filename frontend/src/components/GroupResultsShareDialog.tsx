'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import AppDialog from '@/components/AppDialog';
import {api,fmtDate,type ResultsData} from '@/lib/api';
import {buildResultsShare,whatsappUrl} from '@/lib/whatsapp-sharing';

/** Historical games no longer appear in Game Night's current-game picker.
 * Load the exact saved result in a dialog, then share from a second, direct
 * user gesture (essential on installed iOS). Do not include private transfers. */
export default function GroupResultsShareDialog({gameId,token,onClose}:{
  gameId:string;token:string;onClose:()=>void;
}){
  const [result,setResult]=useState<ResultsData|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [includeAmounts,setIncludeAmounts]=useState(false);
  const request=useRef(0);
  const preview=useRef<HTMLTextAreaElement>(null);
  const load=useCallback(async()=>{
    const sequence=++request.current;
    setLoading(true);setResult(null);setError('');setNotice('');
    try{
      const latest=await api.games.results(token);
      if(sequence!==request.current)return;
      if(latest.game.id!==gameId||latest.game.status!=='settled')
        throw Error('This game is no longer settled. Refresh the game before sharing.');
      if(latest.game.variance!==0)
        throw Error('Results must be reconciled before sharing. Please review the game totals.');
      setResult(latest);
    }catch(e){
      if(sequence===request.current)setError(e instanceof Error?e.message:'Unable to load the saved results.');
    }finally{if(sequence===request.current)setLoading(false);}
  },[gameId,token]);
  useEffect(()=>{void load();return()=>{request.current++;};},[load]);
  const message=result?buildResultsShare({
    room:result.event.name,date:fmtDate(result.game.scheduled_at),players:result.players,includeAmounts
  }):'';
  async function copy(){
    if(!message)return;
    try{await navigator.clipboard.writeText(message);setNotice('Copied. Paste into your intended WhatsApp group.');}
    catch{
      preview.current?.focus();preview.current?.select();
      setNotice('Automatic copy is unavailable. Select and copy the message manually, or open WhatsApp.');
    }
  }
  async function phoneShare(){
    if(!message||!navigator.share)return;
    try{await navigator.share({title:'PKR game results',text:message});setNotice('Share sheet closed. Check your chosen chat before sending.');}
    catch(e){if((e as Error)?.name!=='AbortError')setNotice('Phone sharing is unavailable. Open WhatsApp or copy the message.');}
  }
  return <AppDialog aria-label="Share group-safe results" onDismiss={onClose}
    swipeToDismiss onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal-sheet" style={{maxWidth:560,width:'100%',padding:20,display:'grid',gap:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
        <h2 style={{fontSize:20,margin:0}}>Share group-safe results</h2>
        <button type="button" className="btn btn-ghost" aria-label="Close results sharing" onClick={onClose}>Close</button>
      </div>
      <p style={{fontSize:13,color:'var(--muted)'}}>Send the saved results for this game. Individual payment instructions, contact details and settlement links are never included.</p>
      {loading&&<p role="status">Checking saved results…</p>}
      {error&&<><p role="alert" style={{color:'var(--red)'}}>{error}</p>
        <button type="button" className="btn btn-outline" onClick={()=>void load()}>Retry results</button></>}
      {result&&<>
        <label style={{display:'flex',gap:10,alignItems:'center',fontSize:14}}>
          <input type="checkbox" checked={includeAmounts} onChange={e=>setIncludeAmounts(e.target.checked)}/>
          Include player net winnings and losses
        </label>
        <textarea ref={preview} aria-label="Group results message" readOnly value={message} rows={7}
          style={{width:'100%',minHeight:120,resize:'vertical',padding:12,fontSize:14,border:'1px solid var(--border-hi)',borderRadius:10,background:'var(--bg2)',color:'var(--white)'}}/>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <a className="btn btn-primary" href={whatsappUrl(message)} target="_blank" rel="noopener noreferrer"
            style={{flex:'1 1 180px',textDecoration:'none',textAlign:'center',minHeight:44}}>Open WhatsApp</a>
          <button type="button" className="btn btn-outline" onClick={()=>void copy()}>Copy message</button>
          {typeof navigator!=='undefined'&&typeof navigator.share==='function'&&
            <button type="button" className="btn btn-outline" onClick={()=>void phoneShare()}>Phone share</button>}
          <button type="button" className="btn btn-ghost" onClick={()=>void load()}>Refresh results</button>
        </div>
      </>}
      {notice&&<p role="status">{notice}</p>}
    </div>
  </AppDialog>;
}
