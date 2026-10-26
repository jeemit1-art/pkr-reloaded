'use client';
type Kind='table'|'dashboard'|'rsvp'|'games'|'standings'|'insights'|string;
export function DemoScreen({kind='dashboard'}:{kind?:Kind}){
 const players=['Alex M','Jordan P','Sam R','Taylor K','Casey L','Morgan D'];
 return <div className="pkr-demo-ui" aria-label={'PKR '+kind+' representative interface with fictional data'}>
  <div className="pkr-demo-head"><strong><span>♠</span> PKR</strong><span>FRIDAY HOME GAME</span><small>DEMO PREVIEW</small></div>
  {kind==='table'?<div className="pkr-demo-table-wrap"><div className="pkr-demo-table">
    {players.map((p,i)=><div key={p} className={'pkr-demo-seat seat-'+i}><span>{p.split(' ').map(s=>s[0]).join('')}</span><small>{p}</small></div>)}
    <div className="pkr-demo-table-center"><span>PRIVATE TABLE</span><strong>FRIDAY NIGHT</strong><small>6 players seated</small></div>
   </div><div className="pkr-demo-stats"><span>Cash game</span><span>6 players</span><span>Host controls</span></div></div>:
   kind==='rsvp'?<div className="pkr-demo-body"><div className="pkr-demo-title"><span>INVITATIONS</span><strong>Who’s coming tonight?</strong></div><div className="pkr-demo-stats"><span>4 Going</span><span>1 Maybe</span><span>1 Awaiting</span></div>{players.slice(0,4).map((p,i)=><div className="pkr-demo-row" key={p}><span className="pkr-demo-avatar">{p[0]}</span><strong>{p}</strong><em>{i===3?'Maybe':'Going'}</em></div>)}</div>:
   kind==='games'?<div className="pkr-demo-body"><div className="pkr-demo-title"><span>GAME MANAGER</span><strong>Friday Night Poker</strong></div><div className="pkr-demo-stats"><span>Cash game</span><span>6 players</span><span>7:00 pm</span></div><div className="pkr-demo-big"><small>NEXT GAME</small><strong>Ready to start</strong><p>Players, seating and game settings in one place.</p></div></div>:
   kind==='standings'?<div className="pkr-demo-body"><div className="pkr-demo-title"><span>PLAYER HISTORY</span><strong>Standings</strong></div>{players.slice(0,5).map((p,i)=><div className="pkr-demo-row" key={p}><span className="pkr-demo-rank">0{i+1}</span><strong>{p}</strong><em>{['+ $240','+ $130','+ $85','− $40','− $115'][i]}</em></div>)}</div>:
   kind==='insights'?<div className="pkr-demo-body"><div className="pkr-demo-title"><span>SESSION SUMMARY</span><strong>Clear results. Easy settlement.</strong></div><div className="pkr-demo-stats"><span>6 players</span><span>1 game</span><span>Settlements</span></div><div className="pkr-demo-bars">{[55,85,47,68,40,76,61].map((h,i)=><i key={i} style={{height:h+'%'}}/>)}</div><div className="pkr-demo-row"><strong>Jordan P</strong><em>+ $130</em></div><div className="pkr-demo-row"><strong>Sam R</strong><em>+ $85</em></div></div>:
   <div className="pkr-demo-body"><div className="pkr-demo-title"><span>HOST DASHBOARD</span><strong>Your poker night, organised.</strong></div><div className="pkr-demo-stats"><span>1 private room</span><span>6 members</span><span>Next: Friday</span></div><div className="pkr-demo-big"><small>UPCOMING GAME</small><strong>Friday Night Poker</strong><p>Invitations, players and game details together.</p></div><div className="pkr-demo-row"><strong>Invites and RSVP</strong><em>4 confirmed →</em></div><div className="pkr-demo-row"><strong>Game history</strong><em>View results →</em></div></div>}
  <div className="pkr-demo-foot">Illustrative interface · fictional example data</div>
 </div>;
}
