import PkrBrandMark from '@/components/PkrBrandMark';

/** Shared public-page wordmark; reuses the same official crest as authenticated PKR. */
export default function MarketingBrandHeader(){
 return <div className="pkr-marketing-brand-header">
  <a href="/" className="pkr-marketing-brand-link" aria-label="PKR home">
   <PkrBrandMark decorative={false}/><span>PKR<small>YOUR PRIVATE POKER CLUB</small></span>
  </a>
  <a className="pkr-marketing-brand-action" href="/?subscribe=starter">Start hosting</a>
 </div>;
}
