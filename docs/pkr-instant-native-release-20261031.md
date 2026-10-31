# PKR Instant + native application release gate

## Web release scope
- New /instant browser experience for verified private-group members:
  next game, arrival options, seat choice, RSVP editing with existing
  browser edit token, current attendance, calendar event, settled-game link.
- Approved WhatsApp join completes directly into /instant; both invitation
  entry points remain host-authorised and do not create public membership.
- Dashboard has a prominent PKR Instant entry for host and player.
- Game Night shows a visible PKR Instant action and reusable authorised-member
  link, with no member-list leakage.
- No change to game accounting, paid states, settlement calculations, VAPID
  public/private keys, membership decisions or existing table.

## Native release scope
- An Expo SDK 58 React Native project that calls current private APIs.
- JWT is transferred using an existing time-limited code and stored securely.
- Host approval queue, personal invite composer, room list, player RSVP, alerts.
- Opt-in native push through an isolated Cloudflare KV store (never SQL
  push_room_subscriptions) with membership checks, clear opt-out, gated provider
  delivery and receipt cleanup.
- Native app remains unshipped until Apple/Google signing credentials,
  provider configuration, device tests and store review are complete.

## Required checks
- Worker TypeScript, Vitest (including native token tests), staging safety.
- Frontend Next.js build and responsive browser tests.
- Native TypeScript check after dependency installation. Local verification
  is impossible without native build toolchains and network access.
- Zero unapproved production data or migration changes.
- Vercel preview should have staging-only backend.
- Confirm the deployed production commit SHA matches the merged release.
- Run phone invitation and RSVP on live with consenting testers only.

## Manual acceptance before calling functionality verified
1. From WhatsApp (iPhone/Android), open a fresh personal invite.
   Host receives approval request and approves.
2. The same in-app browser completes membership and opens PKR Instant;
   no Home Screen install prompt, login loop or second approval.
3. Select a permitted arrival time and seat, save RSVP. Verify host
   sees it and that refreshing doesn't duplicate it.
4. Reopen the browser later using an authorised room link. Confirm login
   is retained where that browser preserves local storage.
5. For existing joined members, dashboard shows PKR Instant and opening
   a generic /instant room link never bypasses membership checks.
6. Test Android/iOS narrow screens. Check long room names and seating
   over 9 players.
7. Test native development build session transfer, host request approval,
   RSVP, native push opt in/out, lock-screen alert and update persistence.
8. Verify native notifications remain disabled until signed builds and
   APNs/FCM are configured.

## Rollback plan
The prior Vercel production deployment can be restored through Vercel.
Cloudflare Worker is backward-compatible: the added native routes and
notification sender are gated off by default; no database schema change.
Never roll back financial data or membership records as part of a UI rollback.
