# PKR unified player dashboard — staging-only change

**26 November 2026. Status: IMPLEMENTED ON AN ISOLATED FEATURE BRANCH; NOT RELEASE ACCEPTED.**
This work does not authorise production deployment, database migration or release-ready notification.

## Decision
PKR Instant is no longer a separate player product. There is one PKR application:
- Approved members use the normal role-aware /dashboard player view.
- Hosts/co-hosts retain existing management controls and may preview the player view.
- Old /instant links redirect to /dashboard and preserve the requested room.
- A room link is NOT an invitation, membership grant, host approval or authorisation token.
- The room selector is checked against the authenticated user's returned memberships.

## Existing player features retained
1. Approved WhatsApp/QR invitations and secure recovery of existing memberships.
2. Full RSVP page, host-configured arrival/reply options and alert settings.
3. In-dashboard RSVP, seating options and current attendance (previously Instant).
4. Game Night, live table, history, results, standings and personal performance.
5. Outstanding transfers, payment acknowledgement, settlement and payment history.
6. Profile management and all existing authorised room member functions.
7. iCalendar download, member-only club link sharing and optional installation/push setup.
8. Browser and PWA access, including mobile-approved-device renewal.
9. Archived room and game history, with no changes to saved records.
10. Host, co-host and member permissions remain enforced by server APIs.

## Compatibility and non-destructive rules
- Do not delete existing player, RSVP, payment or settlement data.
- Do not alter Worker APIs, D1 schema, settlement mathematics, approval decisions or payment statuses.
- Preserve both RSVP browser edit-token keys:
  pkr:rsvp:v2:<gameId> and pkr:instant:rsvp:<gameId>.
- Never automatically claim an RSVP based on matching names alone; editing requires a recognised browser edit token.
- Existing /instant links are compatibility redirects, not a duplicate experience.
- An unapproved user must not see content from another private room.

## Automated evidence sought
- npm run build (Next.js TypeScript and production-style preview build).
- frontend/tests/member-access-guidance.cjs (returning-member recovery).
- frontend/tests/unified-player-access.cjs (Chromium and WebKit, synthetic data):
  old-link redirect, membership check, correct room selection, calendar download,
  attendance, new RSVP, saved-token edit and no duplicate RSVP.
- Existing room, game, payment, security and layout workflows.
- Preview on exact commit, with isolated staging Worker and no production data.

## Manual UAT still required
Conduct on iPhone, Android, tablet and desktop with consenting testers and fictional games.
Record SHA, device, expected and actual result, pass/fail and private evidence for:
- Fresh WhatsApp invitation -> host approval -> same browser -> unified dashboard.
- Existing player recovery, revisit, old bookmarks and optional PWA installation.
- Seat conflict, duplicate taps, RSVP attendance changes and edit of previous RSVP.
- Member versus host/co-host permissions; unauthorised links reveal no private room.
- Calendar download, sharing, Game Night, live table and responsive layouts.
- Actual push opt-in, opt-out and lock-screen delivery.
- Payment acknowledgements, cash-outs and reconciled settlements.
- Offline/retry, concurrent financial writes, notifications and durable history.
- Fresh live backup, independent restored-copy preflight and data-preserving migration rehearsal.

**Stop/go:** CI alone, a Vercel READY preview or this code change is NOT proof
that staging is ready for UAT. Keep existing release gate blocked until
independently reviewed evidence meets every acceptance criterion.
Production must remain unchanged.
