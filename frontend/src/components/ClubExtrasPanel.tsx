'use client';
import PkrGlyph from '@/components/PkrGlyph';
import {useCallback,useEffect,useState} from 'react';
import {api,fmt,type Game,type ClubExpenseList,type ClubTournamentPreset,
  type ClubTournamentConfig,type ClubExportKind} from '@/lib/api';
import './ClubEngagementPanel.css';
type Props={eventId:string;games?:Game[];isManager:boolean;isOwner:boolean;userId?:string|null};
const ACTIVE=process.env.NEXT_PUBLIC_PKR_CLUB_EXTRAS_V1==='1';
const message=(e:unknown)=>e instanceof Error?e.message:'Request failed.';
const columns:Record<ClubExportKind,string[]>={
  games:['game_id','scheduled_at','location','seats','status','created_at'],
  player_results:['game_id','scheduled_at','user_id','display_name','seat_number','buy_ins',
    'buy_in_total','cashout','net','settled_at'],
  transfers:['game_id','scheduled_at','from_user','to_user','from_name','to_name',
    'amount','status','paid_at','created_at'],
  rsvps:['game_id','scheduled_at','display_name','status','created_at'],
  rsvps_live:['game_id','scheduled_at','display_name','status','arrival_option','choice_value','seat_number','created_at','updated_at'],
  members:['user_id','display_name','role','joined_at'],
  expense_splits:['expense_id','created_at','title','category','amount_cents','paid_by_user_id','user_id','share_cents','consent_status','responded_at'],
  payment_events:['game_id','scheduled_at','transfer_id','actor_id','action','previous_status','new_status','created_at'],
};
function csvCell(value:unknown){
  const plain=String(value??'').replace(/[\r\n]+/g,' ');
  const safe=/^\s*[=+\-@\t]/.test(plain)?"'"+plain:plain;
  return '"'+safe.replace(/"/g,'""')+'"';
}
function downloadCsv(kind:ClubExportKind,rows:Array<Record<string,unknown>>){
  const cols=columns[kind];
  const text='\uFEFF'+[cols.map(csvCell).join(','),
    ...rows.map(row=>cols.map(k=>csvCell(row[k])).join(','))].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='PKR-'+kind+'-private.csv';a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function parseTournament(g:Awaited<ReturnType<typeof api.clubExtras.getTournament>>,
  format:'tournament'|'rebuy'|'freezeout'):ClubTournamentConfig{
  if(!g.state||!g.levels.length)throw new Error('The selected game has no saved tournament setup.');
  const state=g.state;
  const pay=typeof state.payout_structure==='string'?JSON.parse(state.payout_structure):
    state.payout_structure;
  return {
    format,starting_chips:Number(state.starting_chips),buy_in_amount:Number(state.buy_in_amount),
    rebuy_allowed:!!state.rebuy_allowed,rebuy_levels:Number(state.rebuy_levels),
    addon_allowed:!!state.addon_allowed,addon_chips:Number(state.addon_chips),
    payout_structure:pay,
    levels:g.levels.map((l,i)=>({
      level_num:i+1,small_blind:Number(l.small_blind),big_blind:Number(l.big_blind),
      ante:Number(l.ante),duration_secs:Number(l.duration_secs),is_break:!!l.is_break,
    })),
  };
}
export default function ClubExtrasPanel({eventId,games=[],isManager,isOwner,userId}:Props){
 const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [data,setData]=useState<ClubExpenseList|null>(null);
 const [presets,setPresets]=useState<ClubTournamentPreset[]>([]);
 const [title,setTitle]=useState(''),[notes,setNotes]=useState(''),[amount,setAmount]=useState('');
 const [category,setCategory]=useState<'food'|'venue'|'supplies'|'other'>('food');
 const [paidBy,setPaidBy]=useState(''),[memberIds,setMemberIds]=useState<string[]>([]);
 const [selectedGame,setSelectedGame]=useState(''),[presetName,setPresetName]=useState('');
 const [selectedPreset,setSelectedPreset]=useState(''),[exportKind,setExportKind]=useState<ClubExportKind>('games');
 const refresh=useCallback(async()=>{
   if(!ACTIVE)return;
   try{
     const [expenses,structures]=await Promise.all([
       api.clubExtras.expenseList(eventId),
       isManager?api.clubExtras.presets(eventId):Promise.resolve({presets:[]}),
     ]);
     setEnabled(true);setData(expenses);setPresets(structures.presets);
     setPaidBy(id=>id||userId||expenses.members[0]?.user_id||'');
     setSelectedGame(id=>id||games[0]?.id||'');
     setSelectedPreset(id=>id||structures.presets[0]?.id||'');
   }catch(e){setEnabled(false);
     if(!/verified isolated migration|not ready/i.test(message(e)))setError(message(e));
   }
 },[eventId,isManager,userId,games]);
 useEffect(()=>{if(ACTIVE)void refresh();},[refresh]);
 async function run(work:()=>Promise<unknown>,success:string){
   if(busy)return;
   setBusy(true);setError('');setNotice('');
   try{await work();setNotice(success);await refresh();}
   catch(e){setError(message(e));}
   finally{setBusy(false);}
 }
 async function saveGamePreset(){
   const game=games.find(g=>g.id===selectedGame);
   if(!game)throw new Error('Select an existing tournament game.');
   const existing=await api.clubExtras.getTournament(game.id);
   const fmt=String((game as Game&{format?:string}).format);
   const type:ClubTournamentConfig['format']=fmt==='rebuy'||fmt==='freezeout'?fmt:'tournament';
   const config=parseTournament(existing,type);
   await api.clubExtras.savePreset(eventId,presetName.trim(),config);
 }
 async function applyPreset(){
   const game=games.find(g=>g.id===selectedGame);
   const preset=presets.find(p=>p.id===selectedPreset);
   if(!game||!preset)throw new Error('Select a tournament and saved structure.');
   if(game.status!=='scheduled'&&game.status!=='lobby')
     throw new Error('Presets can only be applied before a game starts.');
   await api.clubExtras.applyPreset(game.id,preset.config);
 }
 async function exportHistory(){
   if(!isOwner)throw new Error('Only the club owner may export full history.');
   let offset=0,all:Array<Record<string,unknown>>=[];
   for(let i=0;i<1000;i++){
     const page=await api.clubExtras.exportPage(eventId,exportKind,offset);
     if(page.kind!==exportKind||!Array.isArray(page.rows))
       throw new Error('The export response changed; no file was created.');
     all=all.concat(page.rows);
     if(!page.has_more){downloadCsv(exportKind,all);return;}
     if(page.next_offset===null||page.next_offset<=offset)
       throw new Error('The export paging sequence was invalid.');
     offset=page.next_offset;
   }
   throw new Error('The archive is too large for this device; no partial file was created.');
 }
 if(!ACTIVE||!enabled)return null;
 const selected=presets.find(p=>p.id===selectedPreset);
 return <section className="pkr-club" aria-label="Club extras">
   <header className="pkr-club-header"><div><small>PRIVATE CLUB TOOLS</small>
     <h3>Expenses, tournament presets and records</h3>
     <p>Optional costs remain separate from the poker settlement ledger.</p>
   </div><button type="button" onClick={()=>void refresh()} disabled={busy}>Refresh</button></header>
   {error&&<p role="alert" className="pkr-club-error">{error}</p>}
   {notice&&<p role="status" className="pkr-club-ok">{notice}</p>}
   <div className="pkr-club-grid">
     <details className="pkr-club-card">
       <summary><PkrGlyph name="settle"/> Shared costs <small>{data?.expenses.length||0} proposals</small></summary>
       <div className="pkr-club-body">
         <p>Hosts propose optional food, venue or supply expenses. Members consent individually.
           This feature never changes chips, game results or settlement transfers.</p>
         {data?.expenses.slice(0,25).map(exp=>{
           const my=exp.shares.find(s=>s.user_id===userId);
           return <div className="pkr-club-item" key={exp.id}><div>
             <strong>{exp.title} · {fmt(exp.amount_cents)}</strong>
             <small>{exp.category} · {exp.status} · {exp.shares.length} participants</small>
             {my&&<small>Your proposed share: {fmt(my.share_cents)} · {my.status}</small>}
             {exp.notes&&<small>{exp.notes}</small>}
           </div><div className="pkr-club-actions">
             {my?.status==='proposed'&&exp.status==='proposed'&&<>
               <button type="button" disabled={busy} onClick={()=>void run(
                 ()=>api.clubExtras.respond(eventId,exp.id,'accepted'),'Your consent was recorded.')}>Accept</button>
               <button type="button" disabled={busy} onClick={()=>void run(
                 ()=>api.clubExtras.respond(eventId,exp.id,'declined'),'Your response was recorded.')}>Decline</button>
             </>}
             {isManager&&exp.status==='proposed'&&
               <button type="button" disabled={busy} onClick={()=>void run(
                 ()=>api.clubExtras.cancel(eventId,exp.id),'Proposal cancelled.')}>Cancel proposal</button>}
           </div></div>;
         })}
         {isManager&&<div className="pkr-club-form">
           <strong>Propose a shared expense</strong>
           <label>What for?<input value={title} maxLength={100}
             onChange={e=>setTitle(e.target.value)} placeholder="Food for Friday game"/></label>
           <label>Category<select value={category}
             onChange={e=>setCategory(e.target.value as typeof category)}>
             {['food','venue','supplies','other'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
           <label>Amount (AUD)<input type="number" inputMode="decimal" step="0.01" min="0.01"
             value={amount} onChange={e=>setAmount(e.target.value)}/></label>
           <label>Paid by<select value={paidBy} onChange={e=>setPaidBy(e.target.value)}>
             {data?.members.map(x=><option key={x.user_id} value={x.user_id}>{x.display_name}</option>)}</select></label>
           <label>Notes (optional)<input value={notes} maxLength={240}
             onChange={e=>setNotes(e.target.value)}/></label>
           <fieldset style={{border:'1px solid #406450',borderRadius:8,padding:10}}>
             <legend>Share between approved members</legend>
             <div className="pkr-club-actions">
               {data?.members.map(x=><label key={x.user_id} style={{display:'flex',alignItems:'center',gap:6}}>
                 <input style={{width:18,height:18}} type="checkbox" checked={memberIds.includes(x.user_id)}
                   onChange={e=>setMemberIds(a=>e.target.checked?[...a,x.user_id]:a.filter(id=>id!==x.user_id))}/>
                 {x.display_name}</label>)}
             </div><small>Choose 2–15 members. Splits are calculated in cents.</small>
           </fieldset>
           <button type="button" className="pkr-club-primary" disabled={busy||memberIds.length<2}
             onClick={()=>void run(()=>api.clubExtras.propose(eventId,{
               title,notes,category,amount_cents:Math.round(Number(amount)*100),
               paid_by_user_id:paidBy,member_ids:memberIds,
             }),'Shared expense proposal created; no money has moved.')}>Propose shared cost</button>
         </div>}
       </div>
     </details>
     {isManager&&<details className="pkr-club-card">
       <summary>♠ Tournament templates <small>{presets.length} saved</small></summary>
       <div className="pkr-club-body">
         <p>Save a validated existing tournament as a template and apply it to a scheduled
           tournament using PKR's existing Pro-plan and pre-start controls.</p>
         <label>Existing tournament / target game
           <select value={selectedGame} onChange={e=>setSelectedGame(e.target.value)}>
             {games.map(g=><option key={g.id} value={g.id}>
               {new Date(g.scheduled_at*1000).toLocaleDateString('en-AU')} · {g.status} · {g.id.slice(0,6)}
             </option>)}
           </select>
         </label>
         <label>Template name<input maxLength={80} value={presetName}
           onChange={e=>setPresetName(e.target.value)} placeholder="Friday 15-minute blinds"/></label>
         <button type="button" disabled={busy||!selectedGame}
           onClick={()=>void run(saveGamePreset,'Tournament structure saved for reuse.')}>
           Save selected game's structure
         </button>
         <label>Saved template<select value={selectedPreset} onChange={e=>setSelectedPreset(e.target.value)}>
           <option value="">Choose a preset</option>
           {presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
         </select></label>
         {selected&&<p>{selected.config.levels.length} blind levels · starting chips: {selected.config.starting_chips}.</p>}
         <div className="pkr-club-actions">
           <button type="button" disabled={busy||!selected||!selectedGame}
             onClick={()=>void run(applyPreset,'Tournament template applied to the scheduled game.')}>
             Apply to scheduled game
           </button>
           {selected&&<button type="button" disabled={busy} onClick={()=>void run(
             ()=>api.clubExtras.deletePreset(eventId,selected.id),'Template deleted; games unchanged.')}>
             Delete template</button>}
         </div>
       </div>
     </details>}
     {isOwner&&<details className="pkr-club-card">
       <summary><PkrGlyph name="history"/> Export club history <small>Owner only</small></summary>
       <div className="pkr-club-body">
         <p>Download a complete paginated CSV for each category. Excludes contact details,
           passwords, sign-in credentials and private invite tokens. Keep downloads secure.</p>
         <label>Choose data<select value={exportKind} onChange={e=>setExportKind(e.target.value as ClubExportKind)}>
           <option value="games">Game dates and status</option>
           <option value="player_results">Game players, buy-ins and net results</option>
           <option value="transfers">Settlement transfers and confirmations</option>
           <option value="rsvps">Legacy RSVP history</option>
           <option value="rsvps_live">Live RSVP arrivals and seats</option>
           <option value="members">Approved members and roles</option>
           <option value="expense_splits">Shared expense proposals and consent</option>
           <option value="payment_events">Settlement confirmation audit events</option>
         </select></label>
         <button type="button" className="pkr-club-primary" disabled={busy}
           onClick={()=>void run(exportHistory,'CSV exported. Keep financial history private.')}>
           Export selected history CSV
         </button>
         <p>Current records are read in pages. Avoid changing game data while exporting.</p>
       </div>
     </details>}
   </div>
 </section>;
}
