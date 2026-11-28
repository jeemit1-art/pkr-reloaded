# PKR — The Night Is On / Release Identity

This release uses the user-approved PKR New Brand Identity V2 assets as the fixed source of truth. Not another selectable theme.

## Exact source system
- Open-chip K with six chip sectors and directional coral K (vector paths taken from the approved `logos/PKR_App_Icon.svg`).
- Slanted custom PKR wordmark, with the club descriptor under it (approved `logos/PKR_Primary_On_Dark.svg`).
- Colour: ink `#0B0D14`, blue `#1046F8`, coral `#FF5A4D`, citron `#C7FF3A`, paper `#F5F5EF`, slate `#182139`. Profit `#2ACB91`, loss `#FF5A4D`.
- Headline: **THE NIGHT IS ON.**; descriptor **YOUR PRIVATE GAME CLUB**.
- Native elements, real room and game data, card-cut tickets, numbered player badges. Do **not** use abstract/stock pictures or fabricated data for in-app art.

## Product boundaries
- No data model, Cloudflare Worker, payment logic, settlement calculation, permissions or live gameplay changes.
- Real player avatars remain; existing live table controls continue to operate.
- Never display a sample RSVP figure or sample payment balance in production components.
- Shared result images are explicitly user-triggered, not automatically shared.
- Distinguish recorded owed/received payments from processed transfers: PKR never holds funds.

## Routes
- Public marketing: landing, pricing, feature pages, branding/downloads.
- Authenticated: Home, Games, Players, Results, Payments, Account, calendar, game detail, RSVP, installed PWA.
- Existing optional personal themes remain available for backward compatibility, but **this** is the default featured PKR experience, not a tenth theme.

## QA
- Verify brand image path, real record bindings and no abstract image requests in official PKR composition.
- Verify desktop sidebar, phone fixed header/footer and scroll safe areas at 320/390/430px.
- Verify all controls, members/guest role boundaries, positive/negative money colours and role-specific actions.
- Verify PWA icon/manifest/metadata and install/updating cache.
