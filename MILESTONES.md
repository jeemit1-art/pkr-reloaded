# Milestones
## milestone-payments-v1
- Git tag: milestone-payments-v1 (branch: backup/milestone-payments-v1)
- Worker version ID: <PASTE>
- D1 bookmark: <PASTE>
- DB export file: pkr-backup-2026-10-24.sql (kept outside repo)
- Vercel: promote the deployment for this commit


## Game night polish — 27 November 2026

Follow-up to the Game night release, addressing reported mobile screenshots.

- The mobile header is a fixed opaque surface, with safe-area padding and a separate content spacer. The installed iOS status bar requests the normal opaque style. The footer continues to cover the home-indicator area.
- Both full dashboard layouts, player hover/focus rows, RSVP empty states, profile editors and record dialogs use the Game night palette and Inter.
- Summary metrics open their saved records or their exact filtered on-page lists. This includes player/approval/game counts, results, RSVP groups, payment totals and live table bank records. Zero counts have honest empty states; incomplete history stays marked incomplete.
- Interface symbols use a shared SVG set. Existing user avatars and photos are preserved.
- Existing navigation, room layout choices, game controls, financial write gates and account actions are retained. This milestone includes no Worker or database changes.

Recovery checkpoint: `release-checkpoints/pkr-before-polish-20261127` at `6f6f8f6c03dfb81ff8ba8aa078fe31108e81b5c0`.

Validation includes production build/type checking, record/payment/bank unit checks, Chromium and WebKit synthetic browser tests, positive mobile safe-area occlusion checks after scrolling, and screenshots of the retained full dashboards and record sheets. Browser fixtures contain fictional data only. Physical iPhone installed-app behaviour still requires device verification; browser safe-area checks simulate the inset.
