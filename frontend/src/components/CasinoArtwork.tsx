import type {ReactElement} from 'react';

/**
 * Real-world casino props, photographed and bundled with the application.
 * Visual-only: does not render or alter the actual live poker table.
 *
 * Sources and Unsplash licensing: public/images/casino/README.md
 * The two scene variants share the same genuine photos, but have different
 * crops so member dashboards and room headers do not look identical.
 */
export default function CasinoArtwork({variant='lounge'}:{variant?:'lounge'|'room'}):ReactElement{
 return (
  <div className={'pkr-casino-art pkr-casino-art-'+variant+' pkr-casino-photo-scene'} aria-hidden="true">
   <img
    className="pkr-photo-scene-main"
    src={variant==='room'?'/images/casino/real-casino-props.webp':'/images/casino/real-poker-chips.webp'}
    width={1500} height={1000} alt="" loading="eager" decoding="async"
   />
   <div className="pkr-photo-scene-inset">
    <img
     src={variant==='room'?'/images/casino/real-chip-closeup.webp':'/images/casino/real-casino-props.webp'}
     width={1350} height={900} alt="" loading="lazy" decoding="async"
    />
   </div>
   <span className="pkr-photo-scene-dealer">DEALER</span>
   <span className="pkr-photo-scene-suit">♠</span>
  </div>
 );
}
