/** PKR's original spade-and-poker-chip crest.
 * Keep all themes using one source asset instead of rebuilding marks per screen.
 * Decorative appearances are hidden from screen readers. */
export default function PkrBrandMark({className='',decorative=true}:{
 className?:string;decorative?:boolean;
}){
 return <img src="/brand/pkr-crest.svg"
   className={'pkr-brand-mark '+className}
   alt={decorative?'':'PKR poker spade crest'}
   aria-hidden={decorative?true:undefined}
   width={144} height={144} loading="eager" decoding="async"/>;
}
