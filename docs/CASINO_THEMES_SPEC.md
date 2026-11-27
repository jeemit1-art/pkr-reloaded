# PKR Casino Themes — Implementation specification (28 November 2026)

## Approved concepts and implementation
- **Luxe Casino** — deep emerald felt; warm metallic gold chip/action buttons; embossed card edges; gold-trimmed host dashboard and player roster.
- **Neon Casino** — dark violet stage, bright cyan/pink poker props, vivid magenta gradients and electric controls.
- **VIP Lounge** — burgundy velvet mood, bronze outlines, champagne action buttons, understated serif headlines.
- **Playful Tournament** — hot red/raspberry event hero, colourful trophy/chip props, joyful rounded tiles and high-energy CTA.
- **Original designs retained** — PKR Classic, PKR Noir, Clubhouse, PKR Studio. Existing personal selections remain valid. Unselected design defaults unchanged.

## Personal controls
Account > App appearance > Casino experiences or Original PKR looks. Preference persists per device with the original key, and is applied before hydration. Light/Dark/Follow device remain separate.
Themes never change the room-wide Command Centre/Live Poker toggle.

## Live flow and real data
Existing 5-item nav: Home, Games, Players, Results, Payments. All existing routes stay valid; room, RSVP, paid transfers, buy-ins, results, game night, card stack and player profile actions retain their handlers. The casino visual layers only decorate existing controls. No invented wagers, chips, winners or payment amounts. Never replace or stylise away red loss/owed or green win/received semantics.

## Matching the mockups
- Home: dominant casino hero with bespoke cards, chips, dice or trophy, prominent verified primary action, vivid statistics and clear game status.
- Games: invitation/game-night hero, visible tabs, read-only felt seating preview and intact live table link.
- Players: distinguish player profiles, avatars, RSVP and genuine transaction actions.
- Results: themed performance stage, actual leaderboard, history and insights via direct navigation.
- Payments: themed financial header, source-backed outstanding/received totals and ledger tools.

## Technical boundaries
Only frontend theme files and non-game appearance preferences change. **No Cloudflare Worker or D1 migration.** The existing `/games/:id/play`, `/games/:id/tv` and public live spectator views are excluded. CSS assets have no pointers/events; accessible motion reduction applied. Mobile shell width, safe areas, existing nav height and working scrolling must be preserved.

## Release acceptance gate
1. Confirm original PKR styles unchanged.
2. Select each casino style, refresh and verify persistence, including two-colour-mode compatibility.
3. Visually inspect host and player on narrow iPhone/Android, tablet and desktop against mockups.
4. Verify direct navigation and gameplay still work.
5. Compare payment and result evidence (no data altered).
6. Run premium-theme, experience-consolidation, settlement-integrity and casino-themes checks.
7. Preview on Vercel, screenshot both light and dark and get production acceptance only after QA.
8. Rollback point is `milestone/pre-casino-themes-20261128` at `8c388ce759140c80bf26e33ad75e77e454a52556`.

These images are references, not available as editable design components; individual icon assets are recreated as vector SVG and CSS. Visual parity requires actual browser screenshot verification before any claim of completion.
