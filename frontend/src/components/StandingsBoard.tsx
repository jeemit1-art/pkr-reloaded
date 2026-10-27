'use client';
import RecordMetric from '@/components/RecordMetric';


import {useMemo,useState} from 'react';
import {fmtSign,type LeaderboardEntry} from '@/lib/api';

type SortKey='net'|'average'|'profitable'|'games';
type BoardProps={
  roomId?:string;
  leaders:LeaderboardEntry[];
  settledGames:number;
  onSelectPlayer:(name:string)=>void;
};

const sortLabels:Record<SortKey,string>={
  net:'Total net',
  average:'Average per game',
  profitable:'Profitable games',
  games:'Games played',
};

export default function StandingsBoard({leaders,settledGames,onSelectPlayer,roomId}:BoardProps){
  const [sort,setSort]=useState<SortKey>('net');
  const [query,setQuery]=useState('');
  const [minGames,setMinGames]=useState(false);
  const getAvg=(p:LeaderboardEntry)=>p.games_played?p.total_net/p.games_played:0;
  const sortedByNet=useMemo(()=>[...leaders].sort((a,b)=>b.total_net-a.total_net||b.games_played-a.games_played||a.display_name.localeCompare(b.display_name)),[leaders]);
  const rows=useMemo(()=>{
    const q=query.trim().toLocaleLowerCase();
    return [...leaders].filter(p=>(!minGames||p.games_played>=3)&&(!q||p.display_name.toLocaleLowerCase().includes(q)))
      .sort((a,b)=>{
        const value=(p:LeaderboardEntry)=>sort==='average'?getAvg(p):sort==='profitable'?p.games_won:sort==='games'?p.games_played:p.total_net;
        return value(b)-value(a)||b.total_net-a.total_net||a.display_name.localeCompare(b.display_name);
      });
  },[leaders,sort,query,minGames]);
  const playerSessions=leaders.reduce((n,p)=>n+p.games_played,0);
  const maxAbs=Math.max(1,...leaders.map(p=>Math.abs(p.total_net)));

  return <section className="pkr-standings-board" aria-label="Poker room player standings">
    <header className="pkr-standings-heading">
      <div><span className="pkr-eyebrow">♛ PLAYER PERFORMANCE</span>
        <h2>Standings</h2>
        <p>Recorded results from settled games in this poker room. Unfinished games do not affect rankings.</p>
      </div>
      <span className="pkr-standings-updated">All-time records</span>
    </header>
    <div className="pkr-standings-summary">
      <div><RecordMetric request={{kind:'leaders',title:"Ranked players",roomId}}><span>Ranked players</span><strong>{leaders.length}</strong></RecordMetric></div>
      <div><RecordMetric request={{kind:'games',title:"Settled games",roomId,filter:'settled'}}><span>Settled games</span><strong>{settledGames}</strong></RecordMetric></div>
      <div><RecordMetric request={{kind:'sessions',title:"Player sessions",roomId}}><span>Player sessions</span><strong>{playerSessions}</strong></RecordMetric></div>
    </div>
    {!leaders.length
      ? <div className="pkr-standings-empty"><span aria-hidden="true">🏆</span><h3>The table is waiting</h3>
          <p>Settle your first game to begin tracking player standings. Until then, all results remain unranked.</p></div>
      : <>
        <div className="pkr-standings-podium" aria-label="Top three by all-time net results">
          {sortedByNet.slice(0,3).map((p,i)=><button type="button" key={p.user_id||p.display_name} className={'pkr-standings-podium-card pkr-standings-podium-'+(i+1)} onClick={()=>onSelectPlayer(p.display_name)}
            aria-label={'Open '+p.display_name+' game history, rank '+(i+1)}>
            <span className="pkr-standings-medal" aria-hidden="true">{['♛','♝','♞'][i]}</span>
            <span className="pkr-standings-rank-label">#{i+1} ALL TIME</span>
            <strong title={p.display_name}>{p.display_name}</strong>
            <b className={p.total_net<0?'loss':'gain'}>{fmtSign(p.total_net)}</b>
            <small>{p.games_played} games · {p.games_won} profitable</small>
          </button>)}
        </div>
        <div className="pkr-standings-toolbar">
          <label className="pkr-standings-search"><span>Search players</span>
            <input aria-label="Search standings by player name" type="search" placeholder="Find a player…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <label className="pkr-standings-sort"><span>Rank by</span>
            <select aria-label="Sort player standings" value={sort} onChange={e=>setSort(e.target.value as SortKey)}>
              {(Object.keys(sortLabels) as SortKey[]).map(key=><option key={key} value={key}>{sortLabels[key]}</option>)}
            </select></label>
          <label className="pkr-standings-minimum"><input type="checkbox" checked={minGames} onChange={e=>setMinGames(e.target.checked)}/>
            <span>3+ games</span></label>
        </div>
        <div className="pkr-standings-list" role="list" aria-label="Ranked player list">
          {rows.length?rows.map((p,i)=><button className="pkr-standings-row" type="button" role="listitem"
            key={p.user_id||p.display_name} onClick={()=>onSelectPlayer(p.display_name)}
            aria-label={'Open '+p.display_name+' profile, '+fmtSign(p.total_net)+' total net'}>
            <span className="pkr-standings-row-rank">{i+1}</span>
            <span className="pkr-standings-avatar" aria-hidden="true">{p.display_name.trim().charAt(0).toUpperCase()||'♠'}</span>
            <span className="pkr-standings-player">
              <strong>{p.display_name}</strong>
              <small>{p.games_played} games · {p.games_won} profitable · {p.games_played?Math.round(p.games_won/p.games_played*100):0}%</small>
              <span className="pkr-standings-track" aria-hidden="true"><i className={p.total_net>=0?'gain':'loss'} style={{width:Math.max(2,Math.abs(p.total_net)/maxAbs*100)+'%'}}/></span>
            </span>
            <span className="pkr-standings-money"><strong className={p.total_net<0?'loss':'gain'}>{sort==='average'?fmtSign(Math.round(getAvg(p))):fmtSign(p.total_net)}</strong>
              <small>{sort==='average'?'Average / game':sort==='net'?'Total net':sort==='games'?p.games_played+' sessions':p.games_won+' profitable'}</small></span>
            <span className="pkr-standings-open" aria-hidden="true">›</span>
          </button>):<div className="pkr-standings-empty"><p>No players match. Clear your search or filters.</p>
            <button type="button" onClick={()=>{setQuery('');setMinGames(false)}}>Clear filters</button></div>}
        </div>
        <p className="pkr-standings-footnote">“Profitable” means a positive net result for a settled game, not necessarily first place. Net amounts are recorded poker results, not transfers or payments received. Tap a player to review their settled-game history.</p>
      </>}
  </section>;
}
