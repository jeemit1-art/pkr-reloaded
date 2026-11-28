# PKR | Brand & Marketing System

Version 1.0 — 28 November 2026 · Brand direction built from the existing PKR ruby-and-gold poker crest.

## Identity

- **Brand name:** PKR (consumer-facing). Product descriptor: Your Private Poker Club.
- **Primary tagline:** **More poker. Less admin.**
- **Supporting line:** From the invitation to the final result.
- **Product promise:** One place to organise private poker nights, manage players, record the game and review results and settlements.
- **Audience:** adult private poker-game hosts and invited members. This is management software, **not** an online gambling, payments, or wagering product.
- **URL:** https://mypkr.app

## Visual system

| Token | HEX | Use |
| --- | --- | --- |
| Midnight | `#0D0B19` | Primary dark backgrounds, app icon plate |
| Velvet | `#2B1028` | Hero depth, premium panels |
| Ruby | `#C94D6C` | Character, brand signature, highlights |
| Antique gold | `#EEC98A` | Premium accents and attention |
| Gold light | `#FFF4D5` | Contrast text, warm cream surfaces |
| Felt | `#153C31` | Secondary poker/table context only |
| Loss | `#FE8A87` | Loss/amount owed; preserve red semantics |
| Win | `#69D59A` | Profit/amount received; preserve green semantics |

**Logo:** The official mark is `/brand/pkr-crest.svg`. Never re-create or substitute different suit symbols on marketing assets. Use the scalable crest at at least 28px in UI and at least 64px in printed/social applications. Maintain 20% clear space around the crest. No colourizing, flattening or dramatic glowing filters. Use the horizontal lockup on dark or light surfaces as appropriate.

**Typography:** use locally bundled Inter Variable for UI labels, numbers and core web copy. System sans-serif fallback; strong hierarchy, crisp solid text, limited decorative effects. Never place light text over bright gold; gold buttons use dark ink. Never blur or obstruct screen content.

**Illustration:** stylised chips, felt, a restrained spade motif, burgundy velvet and crisp gold borders. Marketing graphics should look like a premium private poker club, not a gambling operator. Use genuine app screenshots with fictional data, identified as such.

## Voice and copy

- Tone: confident, inviting, practical and private — never flashy wagering claims.
- Preferred verbs: organise, invite, RSVP, track, review, record, share.
- Avoid: win big, get rich, instant payout, guaranteed winnings, bet now, live casino gambling.
- Write "players arrange transfers outside PKR" not "PKR pays you".

### Approved headlines

1. **More poker. Less admin.**
2. **Your game night. One connected app.**
3. **Less chasing. More playing.**
4. **Your people. Your table. Your rules.** (avoid implying poker regulation is waived)

### Product description, short

"PKR brings invitations, RSVPs, game tracking, player results and settlement records together for your private poker club."

### Product description, long

"Organise your next private poker night with PKR. Invite your players, collect RSVPs, manage seats, record buy-ins and cash-outs, track results and review settlement records in one place. Players can join their host's club without purchasing a host subscription. PKR doesn't operate online poker games, accept wagers, hold player money or make transfers."

## Applications

- **App:** original crest in the shared header and navigation; do not remove other nine selectable themes. Preserve host/player role boundaries and all financial semantics.
- **PWA:** original crest in icon, splash/manifest and theme colour. Installed app should look like the same brand as the marketing site.
- **Website:** matching midnight/ruby/gold on landing, pricing, how-it-works and install guidance.
- **Social:** 1200×630 landscape, 1080×1080 square and 1080×1920 story assets are supplied. Export SVG to PNG for platforms that do not accept SVG.
- **Sharing:** generated result cards use the official crest, brand colours and room-scoped figures. Amounts may be omitted; do not automatically disclose individual balances.

## Compliance and factual claims

- PKR is private-game management/record-keeping software. It does not take wagers, process settlements or host online real-money poker.
- Don't advertise claims about guaranteed winnings, legal status, security certifications, automatic WhatsApp sending or store availability unless independently verified.
- Keep financial records private, avoid sensitive results in public creative, and use fictional data in public screenshots.
- Pricing and trial details must be pulled from the current live checkout before publication; do not embed speculative offers in evergreen assets.

## Rollout acceptance checklist

1. Verify crest/lockup, palette and legibility on landing, pricing, public resources, install and PWA.
2. Verify header, Home, Games, Players, Results, Payments and Account in all nine themes and Light/Dark/Follow device.
3. Verify phone 320/390/430px, Android, iOS Safari/PWA, tablet and desktop; no content behind fixed bars.
4. Verify Open Graph preview, icon/splash, WhatsApp generated share card (only on user action), screenshots and marketing assets.
5. Confirm no changes to gameplay, financial records, permissions, memberships, database or Cloudflare Worker.
6. Run CI, examine exact Vercel preview and retain rollback branch before promotion.

### Assets in `frontend/public/brand/`

- `pkr-crest.svg` — single source of truth (already in app)
- `pkr-horizontal-on-dark.svg`
- `pkr-horizontal-on-light.svg`
- `pkr-social-landscape.svg`
- `pkr-social-square.svg`
- `pkr-social-story.svg`

**Status:** design and copy system; public claims are based on the existing PKR app features, not independent market research.
