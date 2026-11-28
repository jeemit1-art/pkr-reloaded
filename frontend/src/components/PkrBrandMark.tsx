/** PKR approved The Night Is On identity (open-chip K emblem).
 * Keep all themes using one source asset instead of rebuilding marks per screen.
 * Decorative appearances are hidden from screen readers. */
export default function PkrBrandMark({className='',decorative=true}:{
 className?:string;decorative?:boolean;
}){
 return <img src="/brand/pkr-night-mark.svg"
   className={'pkr-brand-mark '+className}
   alt={decorative?'':'PKR Open Chip K emblem'}
   aria-hidden={decorative?true:undefined}
   width={144} height={144} loading="eager" decoding="async"/>;
}
