import type { ReactElement } from 'react';

/**
 * Midnight Felt decorative poker equipment illustration.
 * The artwork is a genuine image asset of poker chips and playing cards,
 * not a CSS-built table or a fabricated app screenshot.
 * No gameplay state, hit targets or player information are involved.
 */
export default function CasinoArtwork({ variant = 'lounge' }: { variant?: 'lounge' | 'room' }): ReactElement {
  return (
    <div className={`pkr-casino-art pkr-casino-art-${variant} pkr-casino-art-asset`} aria-hidden="true">
      <img
        className="pkr-casino-art-props"
        src="/brand/pkr-midnight-closing.svg"
        alt=""
        width="950"
        height="500"
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}
