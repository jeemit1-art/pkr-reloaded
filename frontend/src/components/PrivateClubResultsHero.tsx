'use client';
import PkrGlyph from '@/components/PkrGlyph';
import RecordMetric from '@/components/RecordMetric';
import RoomPlayerAvatar from '@/components/RoomPlayerAvatar';
import {rankChipStyle} from '@/lib/rank-chip-palette';
import type {RoomAvatarSources} from '@/lib/room-player-avatars';
import type {LeaderboardEntry} from '@/lib/api';
type Props={club:string;roomId:string;leaders:LeaderboardEntry[];completed:number;onHistory:()=>void;avatarSources:RoomAvatarSources};
export default function PrivateClubResultsHero({club,roomId,leaders,completed,onHistory,avatarSources}:Props){
 const top=leaders.filter(p=>p.user_id).slice().sort((a,b)=>b.total_net-a.total_net).slice(0,3);
 return <section className="pkr-pc-results-hero" data-testid="private-club-results" aria-label="Casino club hall of fame">
   <div className="pkr-pc-results-heading"><span className="pkr-pc-overline"><PkrGlyph name="trophy" size={15}/> HALL OF FAME</span>
     <h1>The <em>Leaderboard</em></h1><p>{club} · Every game has a story.</p>
   </div>
   <div className="pkr-pc-results-ribbon">
    <RecordMetric bare request={{kind:'games',title:'Completed games',roomId,filter:'settled'}}><strong>{completed}</strong><small>Completed games</small></RecordMetric>
    <RecordMetric bare request={{kind:'leaders',title:'Ranked players',roomId}}><strong>{leaders.length}</strong><small>Ranked players</small></RecordMetric>
   </div>
   <div className="pkr-pc-results-podium" aria-label="Top club performers">
    {top.length?top.map((leader,index)=><RecordMetric bare className={'pkr-pc-results-rank pkr-pc-results-rank-'+index}
     key={leader.user_id}
     request={{kind:'player',title:leader.display_name+' — game history',roomId,playerId:leader.user_id,playerName:leader.display_name}}>
      <span className="pkr-pc-results-medal pkr-rank-chip" style={rankChipStyle(index+1)}>{index===0?<PkrGlyph name="trophy" size={23}/>:index+1}</span>
      <RoomPlayerAvatar player={leader} sources={avatarSources} className="pkr-pc-results-face"/>
      <strong>{leader.display_name}</strong>
      <small>{leader.games_played} games played</small>
    </RecordMetric>):<p className="pkr-pc-results-placeholder">The first completed game starts your hall of fame.</p>}
   </div>
   <button type="button" className="pkr-pc-results-history" onClick={onHistory}>
    <PkrGlyph name="history" size={18}/> <span>VIEW COMPLETED NIGHTS</span> <PkrGlyph name="chevron-right" size={18}/>
   </button>
  </section>;
}
