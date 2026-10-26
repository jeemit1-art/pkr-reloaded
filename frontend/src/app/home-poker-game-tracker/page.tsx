import type {Metadata} from 'next';

export const metadata:Metadata={
 title:'Home Poker Game Tracker — Buy-ins, Rebuys & Results | PKR',
 description:'Track your home poker game in one browser app. Record player buy-ins, rebuys, cash-outs, standings and settlement amounts with PKR for private poker nights.',
 alternates:{canonical:'/home-poker-game-tracker'},
 openGraph:{title:'A Home Poker Tracker That Keeps the Night Moving | PKR',description:'Track poker buy-ins and rebuys, organize game nights and settle up with clear results.',url:'/home-poker-game-tracker'},
};
export default function TrackerPage(){
 return <main className="pkr-marketing-editorial">
  <nav className="pkr-marketing-breadcrumb" aria-label="Breadcrumb"><a href="/">PKR Home</a><span>›</span><span>Home poker tracker</span></nav>
  <header className="pkr-marketing-hero"><span className="pkr-marketing-kicker">HOME POKER GAME TRACKER</span><h1>Stop chasing chips.<br/><em>Start enjoying the game.</em></h1><p>From the first buy-in to the last cash-out, PKR keeps your private home poker night organized. Record every player’s entry, track the session and review clear results afterward.</p><div className="pkr-marketing-hero-actions"><a className="pkr-marketing-button primary" href="/?subscribe=starter">Start your poker room ↗</a><a className="pkr-marketing-button" href="/pricing">Compare host plans</a></div></header>
  <div className="pkr-marketing-feature-visual"><img src="/images/pkr-approved-hero-desktop.webp" alt="PKR approved green felt poker table and gold chips" loading="lazy"/><div><small>BUILT FOR PRIVATE GROUPS</small><strong>Spend more time playing.<br/>Less time calculating.</strong></div></div>
  <section className="pkr-marketing-prose"><span className="pkr-marketing-kicker">HOW PKR WORKS</span><h2>One place for your <em>whole poker night.</em></h2><div className="pkr-marketing-steps">
   <article><span>01</span><h3>Make your room</h3><p>Create a private poker group and invite players through personal links. Keep your player list between nights.</p></article>
   <article><span>02</span><h3>Track buy-ins and rebuys</h3><p>During the game, record each player’s entries and keep the live table totals in view.</p></article>
   <article><span>03</span><h3>Close the session</h3><p>Enter final cash-outs. PKR keeps a settlement record so the host can review who owes whom.</p></article>
   <article><span>04</span><h3>Remember the results</h3><p>See standings and lifetime net results for everyone with recorded settled games in that room.</p></article>
  </div></section>
  <section className="pkr-marketing-prose"><h2>Why not use a spreadsheet?</h2><p>A spreadsheet can hold the numbers, but it cannot manage an entire poker night without manual work. PKR combines a private group, invitations, RSVPs, buy-in tracking, game records and player history in a purpose-built flow.</p><h2>Do players have to subscribe?</h2><p>No. The host uses a Starter or Pro plan to run their private group. Invited players do not need their own paid host plan. PKR is a browser-based management app for real-world home games; it does not handle wagers or payments between players.</p><p>Planning a tournament? <a href="/poker-tournament-manager">See PKR’s tournament tools.</a> Want help with payouts? <a href="/home-poker-settlement">Read the home poker settlement guide.</a></p></section>
  <div className="pkr-marketing-bottom"><h2>Your next game is waiting.</h2><p>Get the crew together and keep the record straight.</p><a className="pkr-marketing-button primary" href="/?subscribe=starter">Start hosting ↗</a><a href="/pricing">View pricing</a></div>
 </main>;
}
