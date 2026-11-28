'use client';
import PkrGlyph from '@/components/PkrGlyph';
import type {EventMember} from '@/lib/api';

type Props={club:string;members:EventMember[]};

/**
 * Private Casino Club players: one compact directory introduction.
 * Rankings already belong to Results, and the live roster/invitation/approval
 * tabs immediately below are the single source of navigation actions.
 */
export default function PrivateClubMembersHero({club,members}:Props){
 return <section className="pkr-pc-members-hero" aria-label={'Players in '+club} data-testid="private-club-players">
  <div className="pkr-pc-members-intro">
   <span className="pkr-pc-overline"><PkrGlyph name="club" size={15}/> THE PEOPLE BEHIND THE GAME</span>
   <h1>Our <em>Players</em></h1>
   <div className="pkr-pc-members-count"><PkrGlyph name="members" size={17}/><strong>{members.length}</strong> club members</div>
  </div>
  <div className="pkr-pc-members-scene" aria-hidden="true">
   <div className="pkr-pc-members-felt"><PkrGlyph name="spade" size={27}/></div>
  </div>
 </section>;
}
