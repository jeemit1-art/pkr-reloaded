import type {Metadata} from 'next';
import MarketingBrandHeader from '@/components/MarketingBrandHeader';
export const metadata:Metadata={
 title:'PKR Brand Kit — The Night Is On',
 description:'Approved PKR Open Chip K logo, bold private-club colours and official share artwork.',
 alternates:{canonical:'/brand'},
};
const assets=[
 {name:'PKR wordmark',img:'/brand/pkr-night-logo.svg',desc:'The approved Open Chip K and custom PKR letters for dark backgrounds.'},
 {name:'Open Chip K symbol',img:'/brand/pkr-night-mark.svg',desc:'The recognisable PKR club identity for navigation and member passes.'},
 {name:'PKR app icon',img:'/brand/pkr-night-icon.svg',desc:'Official home-screen icon, built from the brand emblem.'},
 {name:'The Night Is On campaign',img:'/brand/pkr-night-cover.svg',desc:'Branded social and messaging cover image. No abstract imagery.'},
];
const colours=[['PKR Ink','#0B0D14'],['PKR Blue','#1046F8'],['PKR Coral','#FF5A4D'],['PKR Citron','#C7FF3A'],['PKR Paper','#F5F5EF'],['PKR Slate','#182139']];
export default function BrandHub(){return <main className="pkr-marketing-editorial pkr-no-brand-hub">
 <MarketingBrandHeader/>
 <nav className="pkr-marketing-breadcrumb" aria-label="Breadcrumb"><a href="/">PKR Home</a><span>›</span><span>Brand & media</span></nav>
 <header className="pkr-marketing-hero"><span className="pkr-marketing-kicker">THE OFFICIAL PKR IDENTITY</span><h1>THE NIGHT <em>IS ON.</em></h1><p>A new PKR identity for your private game club. The Open Chip K, distinctive cut-corner cards, player stamps and bold blue/coral/citron visual language now connect the whole product.</p></header>
 <div className="pkr-brand-hub-grid">{assets.map(asset=><article className="pkr-brand-hub-card" key={asset.img}>
  <figure><img src={asset.img} alt={asset.name} loading="lazy"/></figure>
  <div><h3>{asset.name}</h3><p>{asset.desc}</p><a href={asset.img} download>Download SVG</a></div>
 </article>)}</div>
 <section className="pkr-marketing-prose"><span className="pkr-marketing-kicker">PKR VISUAL SYSTEM</span><h2>YOUR TABLE. <em>YOUR PEOPLE.</em></h2><p>One approved mark and a repeatable graphic language, not another casino theme. Functional app controls use the same identity while live game records and player avatars remain genuine.</p><div className="pkr-brand-swatches">{colours.map(([label,hex])=><div className="pkr-brand-swatch" key={hex}><i style={{background:hex}}/><strong>{label}</strong><code>{hex}</code></div>)}</div><p>PKR helps organisers manage privately arranged games. It does not accept wagers, hold funds or execute transfers.</p><p><a href="/pricing">PKR host plans</a> · <a href="/install">Install PKR</a></p></section>
 </main>}
