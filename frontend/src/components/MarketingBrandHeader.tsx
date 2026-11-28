import PkrBrandMark from '@/components/PkrBrandMark';
/** One PKR wordmark across all public pages, matching the app's brand mark. */
export default function MarketingBrandHeader(){
 return <div className="pkr-marketing-brand-header pkr-no-public-header">
  <a href="/" className="pkr-marketing-brand-link" aria-label="PKR home">
   <img src="/brand/pkr-night-logo.svg" alt="PKR — Your Private Game Club" width={225} height={77}/>
  </a>
  <a className="pkr-marketing-brand-action" href="/?subscribe=starter">Start hosting</a>
 </div>;
}
