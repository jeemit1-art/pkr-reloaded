# PKR installation and notification reliability upgrade — 31 October 2026

## Scope
- Join private groups from WhatsApp **before** optional installation.
- Onboarding must not report push success merely because OS permission was granted.
- Remember a player's explicit per-room opt-in/out and reconcile a missing server registration when an authenticated, opted-in device returns online. Never reopen an OS permission prompt in the background.
- Reconcile old web-push subscriptions if the public VAPID application key changes.
- Keep group approvals and private financial notifications scoped to authorised recipients.
- Host/member alerts use actual group, player, RSVP, buy-in, cash-out and settlement details where available.
- A *foreground-only* chime is more audible by default while respecting explicit mute choice. Do not promise control over iOS/Android background sound, volume, Focus or Do Not Disturb.
- A member-only, rate-limited, server-sent push self-test returns push-service acceptance, **not** proof of display or reading.
- An already authenticated member can generate a short-lived account-transfer code to sign into a separate iPhone Home Screen storage context without being re-approved. Never put a transfer code or JWT in a link, URL, logs or analytics.
- No database migration, historical settlement rewrite, VAPID key rotation or changes to the gameplay table are part of this release.

## Required CI checks
- Worker TypeScript, Vitest, static route SQL compilation and staging-isolation workflow.
- Frontend Next.js build, TypeScript, game-night and sharing smoke tests.
- Complete both checks and stage a preview before discussing production rollout.

## Manual iPhone verification (real devices required)
1. Host sends a personal WhatsApp invite. Player opens in WhatsApp, requests approval. Host sees an alert naming the requester; approves. Player can open their room and RSVP without installing.
2. Player chooses phone setup, installs PKR from Safari and opens it from Home Screen. On a separate app session, restore membership using a private transfer code generated in their original authenticated browser. Confirm it does not require new host approval. Confirm code expiry and second redemption are rejected.
3. In the Home Screen app, enable room notifications from a tap, then issue a server-sent test. Confirm receipt on an actual device and that tapping it opens the right room.
4. After deploying a *new app build without rotating VAPID keys*, check that the existing device stays subscribed and does not need to grant permission again.
5. Turn off a single room's alerts, update app, ensure that room stays off while alerts for another opted-in room remain on.
6. With Focus / mute enabled, verify the UI explains device behaviour instead of promising a background sound increase.

## Manual Android verification
1. Open an invitation from WhatsApp, join before installing, and open install instructions in Chrome. Test the browser's own install prompt or Chrome install menu.
2. Enable push, confirm a genuine server-sent test alert, and open the intended room from notification.
3. Check Android vibration settings and volume. Verify the louder *in-app* sound only while PKR is open.
4. Deploy a new frontend build. Confirm alerts persist, including when an existing per-room registration needs repair.
5. Test notification opt-out remains respected.

## Release safety
- Separate feature branch and pull request; do **not** merge to main or change live VAPID secrets or production D1 solely to test.
- Cloudflare Worker staging intentionally suppresses outbound push to real devices. Test backend handlers with synthetic unit tests; perform actual end-to-end notification delivery only using an explicitly authorised, controlled production test after a coordinated release.
- During coordinated release, deploy the new Worker API before enabling the new frontend remote-test control. The app remains usable if remote tests are temporarily unavailable.
- Device/provider acceptance is not delivery confirmation, and background volume is operating-system controlled.
