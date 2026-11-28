'use client';

import PkrGlyph from '@/components/PkrGlyph';

type Props={isHost:boolean;onSchedule:()=>void;onCalendar:()=>void};

/** A purposeful first-run experience. No fabricated games or account state. */
export default function GamesEmptyArena({isHost,onSchedule,onCalendar}:Props){
 return <section className="pkr-casino-empty-arena" aria-label="Your next poker night" data-testid="casino-games-empty">
   <div className="pkr-casino-empty-table" aria-hidden="true">
    <span className="pkr-casino-empty-rail"/>
    <span className="pkr-casino-empty-table-mark"><PkrGlyph name="spade" size={40}/><small>PKR GAME NIGHT</small></span>
    <span className="pkr-casino-empty-coin pkr-casino-empty-coin-a"><PkrGlyph name="heart" size={17}/></span>
    <span className="pkr-casino-empty-coin pkr-casino-empty-coin-b"><PkrGlyph name="spade" size={19}/></span>
   </div>
   <div className="pkr-casino-empty-copy">
    <span className="pkr-casino-empty-kicker"><PkrGlyph name="cards" size={17}/> READY WHEN YOU ARE</span>
    <h2>No games scheduled yet.</h2>
    <p>{isHost?'Your next poker night starts here. Set a date, invite your players and get the table ready.':'No games are scheduled for this club yet. Check the calendar for updates from your host.'}</p>
    <button type="button" className="pkr-casino-empty-action" onClick={isHost?onSchedule:onCalendar}>
     <PkrGlyph name={isHost?'schedule':'clock'} size={19}/>
     <span>{isHost?'Schedule your first game':'Open game calendar'}</span>
     <PkrGlyph name="chevron-right" size={19}/>
    </button>
    <div className="pkr-casino-empty-steps" aria-label="How game night works">
     <span><PkrGlyph name="schedule" size={16}/> Plan</span>
     <span><PkrGlyph name="members" size={16}/> Invite</span>
     <span><PkrGlyph name="cards" size={16}/> Play</span>
    </div>
   </div>
  </section>;
}
