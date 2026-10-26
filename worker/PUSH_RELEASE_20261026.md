# PKR push and player experience release gate (26 October 2026)

## Implemented in this branch
- Host-only push for new private membership requests, with a safe link to Members > Approvals.
- Host push when an approved member completes onboarding.
- RSVP change alerts to subscribed hosts/co-hosts only (not every player).
- Game time/location changes and cancellations notified to event subscribers.
- A roughly 24-hour and 2-hour reminder window via hourly Worker cron; KV deduplication and opt-in subscriptions.
- Client notification test, optional app-open chime, easier member quick actions and phone onboarding.
- Additive per-room/device subscription table; activated only by PKR_PUSH_ROOMS_V2=1.

## Release sequence
1. Preserve the live revision and verify an independent recent production D1 export and a restored copy. Avoid live data in staging.
2. Run Worker typecheck/tests; verify staging isolation and frontend browser tests.
3. Verify PKR_PHONE_MEMBERS_V1=1 and the existing schema on an isolated staging environment.
4. Apply migrations/20261026_push_rooms.sql to staging D1; verify that one endpoint can register to two rooms and only subscribed hosts receive approvals.
5. Deploy Worker to isolated staging; exercise QR join, host approval, two phones, iOS Home Screen, Android, reminders and unsubscribe, using synthetic data.
6. For production, after approval and fresh backup/restore verification, apply the additive migration to production D1; deploy the reviewed Worker; then enable PKR_PUSH_ROOMS_V2=1, and verify health.
7. Tell hosts/players to open their rooms and tap Enable push alerts once for the new per-room mapping.
8. Check the new Vercel frontend commit and Worker runtime; to roll back deactivate PKR_PUSH_ROOMS_V2 and restore the prior Worker code. Do not drop data.

**Do not set PKR_PUSH_ROOMS_V2=1 before the database table exists.**
This is not authorization to change live D1 or deploy the Worker.

## Known limits
- iPhones/iPads require Home Screen web apps and permission. Background notification sounds follow device/Focus settings; the website cannot force a custom ringtone.
- Opt-in in-app sounds only play while PKR is foregrounded and the browser permits audio.
- Push-service acceptance is not proof of display or reading.
- Exact financial/player notification delivery requires stable identity mapping between game players and authenticated users; v2 uses exact name matching instead of risky fuzzy matching.
- Vercel frontend deployment does not update Cloudflare Worker code or its D1 database.
