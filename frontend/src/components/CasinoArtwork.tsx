import type { ReactElement } from 'react';

/**
 * Decorative casino scene only; no interactive hit targets and no game data.
 * Built from CSS so the staging UI does not depend on external image hosts.
 */
export default function CasinoArtwork({ variant = 'lounge' }: { variant?: 'lounge' | 'room' }): ReactElement {
  return (
    <div className={`pkr-casino-art pkr-casino-art-${variant}`} aria-hidden="true">
      <div className="pkr-casino-art-glow" />
      <div className="pkr-casino-art-table"><span>♠</span></div>
      <div className="pkr-casino-art-chips pkr-art-chips-red">
        <i/><i/><i/><i/><i/><i/>
      </div>
      <div className="pkr-casino-art-chips pkr-art-chips-green">
        <i/><i/><i/><i/><i/>
      </div>
      <div className="pkr-casino-art-chips pkr-art-chips-black">
        <i/><i/><i/><i/><i/><i/><i/>
      </div>
      <div className="pkr-casino-art-cards">
        <span className="pkr-art-card pkr-art-card-back">♠</span>
        <span className="pkr-art-card pkr-art-card-front"><b>A</b><span>♠</span></span>
      </div>
    </div>
  );
}
