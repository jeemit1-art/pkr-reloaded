import type {Metadata} from 'next';
import MarketingBrandHeader from '@/components/MarketingBrandHeader';

export const metadata:Metadata={
 title:'PKR Brand & Media Kit | Your Private Poker Club',
 description:'Official PKR logo, approved brand colours and share-ready marketing artwork for your private poker club.',
 alternates:{canonical:'/brand'},
};
const assets=[
 {name:'Official logo on dark',img:'/brand/pkr-horizontal-on-dark.svg',desc:'Horizontal official crest and wordmark for dark backgrounds.'},
 {name:'Official logo on light',img:'/brand/pkr-horizontal-on-light.svg',desc:'The official wordmark optimised for light backgrounds.'},
 {name:'Landscape campaign',img:'/brand/pkr-social-landscape.svg',desc:'Wide sharing artwork for social posts and link previews.'},
 {name:'Square social post',img:'/brand/pkr-social-square.svg',desc:'Square launch campaign artwork for feeds.'},
 {name:'Vertical story',img:'/brand/pkr-social-story.svg',desc:'Portrait 9:16 story artwork for mobile sharing.'},
];
const colours=[['Midnight','#0D0B19'],['Velvet','#2B1028'],['Ruby','#C94D6C'],['Antique gold','#EEC98A'],['Ivory','#FFF4D5'],['Felt','#153C31']];
export default function BrandHub(){return <main className="pkr-marketing-editorial">
 <MarketingBrandHeader/>
 <nav className="pkr-marketing-breadcrumb" aria-label="Breadcrumb"><a href="/">PKR Home</a><span>›</span><span>Brand & media</span></nav>
 <header className="pkr-marketing-hero"><span className="pkr-marketing-kicker">OFFICIAL PKR BRAND KIT</span><h1>One crest.<br/><em>One unmistakable club.</em></h1><p>Original PKR artwork for your club and promotional sharing. Each download keeps our official ruby-and-gold spade crest, sharp typography and consistent colours.</p></header>
 <div className="pkr-brand-hub-grid">{assets.map(asset=><article className="pkr-brand-hub-card" key={asset.img}>
  <figure><img src={asset.img} alt={asset.name} loading="lazy"/></figure>
  <div><h3>{asset.name}</h3><p>{asset.desc}</p><a href={asset.img} download>Download SVG ↗</a></div>
 </article>)}</div>
 <section className="pkr-marketing-prose"><span className="pkr-marketing-kicker">VISUAL IDENTITY</span><h2>Built for the <em>private poker club.</em></h2><p>Deep midnight, velvet ruby and antique gold form the PKR identity. The felt green supports the game experience; it does not replace our official crest. Our app's nine selectable looks remain available.</p><div className="pkr-brand-swatches">{colours.map(([label,hex])=><div className="pkr-brand-swatch" key={hex}><i style={{background:hex}}/><strong>{label}</strong><code>{hex}</code></div>)}</div><p>Use genuine PKR screenshots with fictional data. PKR organises privately arranged games and records results; it does not take wagers, hold player funds or transfer settlement money.</p><p><a href="/pricing">Explore PKR plans</a> · <a href="/install">Install PKR</a></p></section>
 </main>}
