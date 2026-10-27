import type { ReactElement } from 'react';

/**
 * Midnight Felt photographic poker-prop asset.
 * The existing approved image depicts poker chips and playing cards,
 * not a CSS-built table or a fabricated app screenshot.
 * No gameplay state, hit targets or player information are involved.
 */
export default function CasinoArtwork({ variant = 'lounge' }: { variant?: 'lounge' | 'room' }): ReactElement {
  return (
    <div className={`pkr-casino-art pkr-casino-art-${variant} pkr-casino-art-asset`} aria-hidden="true">
      <img
        className="pkr-casino-art-props"
        src="/images/pkr-approved-hero-desktop.webp"
        alt=""
        width="1600"
        height="500"
        loading="eager"
        decoding="async"
      />
    </div>
  );
}
