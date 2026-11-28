'use client';
import PkrGlyph from '@/components/PkrGlyph';
import PkrBrandMark from '@/components/PkrBrandMark';
import type {EventMember} from '@/lib/api';

type Props={club:string;members:EventMember[]};

/**
 * Private Casino Club players: one compact directory introduction.
 * Rankings already belong to Results, and the live roster/invitation/approval
 * tabs immediately below are the single source of navigation actions.
 */
export default function PrivateClubMembersHero({club,members}:Props){
 return <section className="pkr-pc-members-hero pkr-no-members" aria-label={'Players in '+club} data-testid="private-club-players">
   <div className="pkr-pc-members-intro">
    <span className="pkr-pc-overline">PKR / YOUR PEOPLE</span>
    <h1>THE <em>CREW.</em></h1>
    <p>{club}</p>
    <div className="pkr-pc-members-count"><PkrGlyph name="members" size={17}/><strong>{members.length}</strong> club members</div>
   </div>
   <div className="pkr-no-members-stamps" aria-hidden="true">
    {members.slice(0,3).map((member,index)=><span key={member.id||index} className={'pkr-no-stamp pkr-no-stamp-'+index}>{String(index+1).padStart(2,'0')}</span>)}
   </div>
  </section>;
}
