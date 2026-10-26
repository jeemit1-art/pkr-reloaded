import type {Metadata} from 'next';

export const metadata:Metadata={
 title:'PKR Pricing Australia — Starter $9.99 & Pro $19.99 / Month',
 description:'Compare PKR Starter and Pro hosting plans in Australian dollars. Run private home poker games, track buy-ins, tournaments and settlements. Invited players join without a host subscription.',
 alternates:{canonical:'/pricing'},
 openGraph:{title:'PKR Host Pricing — Starter and Pro',description:'Choose a PKR plan for private home poker games. Starter AUD $9.99/month or Pro AUD $19.99/month.',url:'/pricing'},
};

const questions=[
 {q:'Do invited poker players need to pay?',a:'No. Hosting plans are for the group host. Players join a private group using an invitation from their host.'},
 {q:'Is PKR a native iPhone or Android app?',a:'PKR is a browser-based web app. Open it on your phone or computer and add it to your home screen where supported.'},
 {q:'Who processes the subscription payment?',a:'Stripe handles the host subscription checkout. Review the final price and subscription details before confirming payment.'},
 {q:'Does PKR charge or transfer money between players?',a:'No. PKR keeps records of game buy-ins, results and settlements. Your group handles payments independently.'}
];
export default function PricingPage(){
 return <main className="pkr-marketing-editorial">
  <nav className="pkr-marketing-breadcrumb" aria-label="Breadcrumb"><a href="/">PKR Home</a><span>›</span><span>Pricing</span></nav>
  <header className="pkr-marketing-hero"><span className="pkr-marketing-kicker">PKR HOST SUBSCRIPTIONS</span><h1>Simple plans.<br/><em>Better game nights.</em></h1><p>Keep every buy-in, tournament blind and player result in one place. Only hosts need a hosting plan; players join their host’s private group without buying a host subscription.</p></header>
  <section className="pkr-marketing-plan-grid" aria-label="Host subscription plans">
   <article className="pkr-marketing-plan"><span>STARTER</span><h2>Your regular poker night.</h2><div className="pkr-marketing-price">AUD $9.99 <small>per month</small></div><p>A focused plan for a single private poker group.</p><ul><li>One active group</li><li>Up to 9 seats</li><li>Cash-game tracking and game scheduling</li><li>RSVPs, leaderboard and settlement records</li></ul><a href="/?subscribe=starter" className="pkr-marketing-button">Choose Starter <b>↗</b></a></article>
   <article className="pkr-marketing-plan featured"><span>PRO</span><h2>More games. More room.</h2><div className="pkr-marketing-price">AUD $19.99 <small>per month</small></div><p>For hosts managing multiple rooms or bigger nights.</p><ul><li>Multiple private poker groups</li><li>Up to 15 seats</li><li>Cash games and tournament controls</li><li>Extended features, history and player insights</li></ul><a href="/?subscribe=pro" className="pkr-marketing-button primary">Choose Pro <b>↗</b></a></article>
  </section>
  <p className="pkr-marketing-fine-print">Host subscriptions are billed in Australian dollars. Confirm the final terms and charges at Stripe checkout. PKR records game results but does not handle money between players.</p>
  <section className="pkr-marketing-prose" aria-labelledby="pricing-faq"><span className="pkr-marketing-kicker">STRAIGHT ANSWERS</span><h2 id="pricing-faq">Frequently asked <em>questions.</em></h2>
   {questions.map(item=><details key={item.q}><summary>{item.q}<b>+</b></summary><p>{item.a}</p></details>)}
  </section>
  <div className="pkr-marketing-bottom"><h2>Ready to host?</h2><p>Sign in, choose a plan and take PKR to your next table.</p><a className="pkr-marketing-button primary" href="/?subscribe=pro">Start with PKR ↗</a><a href="/">Back to PKR home</a></div>
 </main>;
}
