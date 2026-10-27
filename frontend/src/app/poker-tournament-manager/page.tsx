import type {Metadata} from 'next';

export const metadata:Metadata={
 title:'Home Poker Tournament Manager & Blind Levels | PKR',
 description:'Plan home poker tournaments with blind-level structures, seat management, player tracking and recorded final standings in PKR’s browser-based poker manager.',
 alternates:{canonical:'/poker-tournament-manager'},
 openGraph:{title:'Run a Home Poker Tournament with PKR',description:'Manage tournament blind levels, players, progress and results at your next private poker night.',url:'/poker-tournament-manager'},
};
export default function TournamentPage(){
 return <main className="pkr-marketing-editorial">
  <nav className="pkr-marketing-breadcrumb" aria-label="Breadcrumb"><a href="/">PKR Home</a><span>›</span><span>Tournament manager</span></nav>
  <header className="pkr-marketing-hero"><span className="pkr-marketing-kicker">HOME POKER TOURNAMENT MANAGER</span><h1>Set the blinds.<br/><em>Run the room.</em></h1><p>Organize a private poker tournament with clear blind stages, player seating and a consistent record of the game. PKR keeps the structure visible while you focus on hosting.</p><div className="pkr-marketing-hero-actions"><a className="pkr-marketing-button primary" href="/?subscribe=pro">Explore Pro hosting ↗</a><a className="pkr-marketing-button" href="/pricing">See host plans</a></div></header>
  <div className="pkr-marketing-feature-visual"><img src="/demo/theme-a/game-detail.webp" alt="Actual PKR game-management screen with fictional demonstration data" loading="lazy"/><div><small>YOUR GAME. YOUR FORMAT.</small><strong>Game setup and host controls,<br/>all together.</strong></div></div>
  <section className="pkr-marketing-prose"><span className="pkr-marketing-kicker">TOURNAMENT NIGHT, ORGANIZED</span><h2>More than a <em>blind timer.</em></h2><div className="pkr-marketing-steps">
   <article><span>01</span><h3>Plan your structure</h3><p>Choose starting stacks, blind levels, and a schedule that suits the length of your private game.</p></article>
   <article><span>02</span><h3>Seat your players</h3><p>Organize who is playing and keep the room’s player records together.</p></article>
   <article><span>03</span><h3>Follow the stages</h3><p>Run blind levels and breaks from the tournament controls as the evening progresses.</p></article>
   <article><span>04</span><h3>Record the finish</h3><p>Keep player results and game history with the private room for the next tournament.</p></article>
  </div></section>
  <section className="pkr-marketing-prose"><h2>Can a home tournament last longer than a few hours?</h2><p>Yes. PKR lets hosts plan additional blind stages instead of being limited to a short preset. The right structure depends on the number of players, starting chips and time available.</p><h2>Is PKR an online poker platform?</h2><p>No. PKR helps people manage privately arranged in-person games. It does not deal real-money online poker hands or process player wagers.</p><p>Hosting cash games too? <a href="/home-poker-game-tracker">Explore the home poker tracker.</a></p></section>
  <div className="pkr-marketing-bottom"><h2>A smoother tournament night.</h2><p>Keep the room focused on the game, not the clock.</p><a className="pkr-marketing-button primary" href="/?subscribe=pro">Choose Pro ↗</a><a href="/pricing">Compare plans</a></div>
 </main>;
}
