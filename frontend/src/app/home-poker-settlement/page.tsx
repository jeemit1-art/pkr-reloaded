import type {Metadata} from 'next';

export const metadata:Metadata={
 title:'Home Poker Settlement Tracker — Who Owes Whom? | PKR',
 description:'Keep a clear settlement record after a home poker cash game. Track buy-ins, cash-outs, player balances, pending transfers and historic results with PKR.',
 alternates:{canonical:'/home-poker-settlement'},
 openGraph:{title:'Settle Home Poker Nights Clearly with PKR',description:'Track buy-ins, final cash-outs and recorded amounts owed after a private poker game.',url:'/home-poker-settlement'},
};
export default function SettlementPage(){
 return <main className="pkr-marketing-editorial">
  <nav className="pkr-marketing-breadcrumb" aria-label="Breadcrumb"><a href="/">PKR Home</a><span>›</span><span>Poker settlement</span></nav>
  <header className="pkr-marketing-hero"><span className="pkr-marketing-kicker">HOME POKER SETTLEMENT TRACKER</span><h1>Last hand played.<br/><em>Numbers settled.</em></h1><p>After a private cash game, the final count matters. PKR helps hosts record buy-ins, cash-outs and the resulting player balances, so everyone understands the result and who owes whom.</p><div className="pkr-marketing-hero-actions"><a className="pkr-marketing-button primary" href="/?subscribe=starter">Track your next game ↗</a><a className="pkr-marketing-button" href="/pricing">See pricing</a></div></header>
  <div className="pkr-marketing-feature-visual"><img src="/demo/theme-a/insights.webp" alt="Actual PKR player insights and settlement screen with fictional demonstration records" loading="lazy"/><div><small>AFTER THE LAST HAND</small><strong>Everyone knows<br/>where they stand.</strong></div></div>
  <section className="pkr-marketing-prose"><span className="pkr-marketing-kicker">HOW TO SETTLE A POKER GAME</span><h2>Close the night <em>without guesswork.</em></h2><div className="pkr-marketing-steps">
   <article><span>01</span><h3>Record every entry</h3><p>Keep each player’s original buy-in and any rebuys recorded during play.</p></article>
   <article><span>02</span><h3>Capture final cash-outs</h3><p>Enter what each player takes away at the end of the session.</p></article>
   <article><span>03</span><h3>Review the results</h3><p>Check the totals and review the saved settlement record before marking a game complete.</p></article>
   <article><span>04</span><h3>Follow up outside PKR</h3><p>Use the who-pays-whom view and recorded payment statuses to track what your group has settled independently.</p></article>
  </div></section>
  <section className="pkr-marketing-prose"><h2>Does PKR collect the money?</h2><p>No. PKR does not hold or transfer money. It only records the game and its settlement details. Players settle directly using their own arrangements.</p><h2>Can I review previous games?</h2><p>Yes. Completed sessions and player performance stay available in the private room’s history, based on recorded settled games.</p><p>To track the full night, see the <a href="/home-poker-game-tracker">home poker game tracker.</a></p></section>
  <div className="pkr-marketing-bottom"><h2>Finish the night right.</h2><p>Keep the game fun. Let PKR track the numbers.</p><a className="pkr-marketing-button primary" href="/?subscribe=starter">Start hosting ↗</a><a href="/pricing">Compare plans</a></div>
 </main>;
}
