'use client';
import PkrGlyph from '@/components/PkrGlyph';
import type {EventMember,LeaderboardEntry} from '@/lib/api';
import RecordMetric from '@/components/RecordMetric';

type Props={club:string;roomId:string;members:EventMember[];leaders:LeaderboardEntry[];pending:number;isOwner:boolean;onRoster:()=>void;onInvite:()=>void;onRequests:()=>void};
const initials=(name:string)=>name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase()||'?';
export default function PrivateClubMembersHero({club,roomId,members,leaders,pending,isOwner,onRoster,onInvite,onRequests}:Props){
 const top=leaders.filter(p=>p.user_id).slice().sort((a,b)=>b.total_net-a.total_net).slice(0,3);
 return <section className="pkr-pc-members-hero" aria-label="Private club player room" data-testid="private-club-players">
  <div className="pkr-pc-members-intro"><span className="pkr-pc-overline"><PkrGlyph name="club" size={15}/> THE PEOPLE BEHIND THE GAME</span>
   <h1>Our <em>Players</em></h1><p>{club}</p>
   <div className="pkr-pc-members-count"><PkrGlyph name="members" size={17}/><strong>{members.length}</strong> club members</div>
  </div>
  <div className="pkr-pc-members-scene" aria-hidden="true"><div className="pkr-pc-members-felt"><PkrGlyph name="spade" size={27}/></div></div>
  {top.length>0&&<div className="pkr-pc-podium" aria-label="Top ranked members">
   {top.map((leader,index)=><RecordMetric bare key={leader.user_id} className={'pkr-pc-podium-place pkr-pc-place-'+index}
     request={{kind:'player',title:leader.display_name+' — game history',roomId,playerId:leader.user_id,playerName:leader.display_name}}>
    <span className="pkr-pc-podium-medal">{index===0?<PkrGlyph name="trophy" size={22}/>:index+1}</span>
    <span className="pkr-pc-podium-avatar">{initials(leader.display_name)}</span>
    <strong>{leader.display_name}</strong>
    <small>{leader.games_played} games</small>
   </RecordMetric>)}
  </div>}
  <div className="pkr-pc-members-actions">
   <button type="button" className="pkr-pc-members-primary" onClick={onRoster}><PkrGlyph name="members" size={20}/> <span>VIEW PLAYERS</span> <PkrGlyph name="chevron-right" size={18}/></button>
   {isOwner&&<button type="button" onClick={onInvite}><PkrGlyph name="user-add" size={20}/> INVITE PLAYER</button>}
   {isOwner&&pending>0&&<button type="button" onClick={onRequests}><PkrGlyph name="shield-check" size={20}/> {pending} JOIN REQUEST{pending===1?'':'S'}</button>}
  </div>
 </section>;
}
