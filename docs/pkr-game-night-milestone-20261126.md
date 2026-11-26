# PKR Game night milestone — 26 November 2026

## Milestone 1: modern app interface with existing capabilities retained

Implementation is complete on the isolated feature branch. Local production build, TypeScript checks, functional regression tests and the recorded browser walkthrough pass. Publishing the branch, opening the pull request and the full remote browser matrix remain pending. Main and the live deployment have not been replaced.

## Recovery point

- Main baseline: `24282989c73793cd97969f889a8aded568cfd649`.
- Remote milestone: `release-checkpoints/pkr-before-game-night-redesign-20261126-2340`.
- Implementation branch: `feature/game-night-app-20261126`.
- Scope: additive frontend design and workflow improvements. No database migration, production data write, payment calculation change or native binary release.

## Feature preservation agreement

All existing routes, authentication, permissions, stored records and capabilities must remain available. Game night is an additional home presentation. The full dashboard retains both server-saved Command Centre and Live Poker layouts. The new personal home-view choice does not overwrite the host’s room-wide layout preference.

| Area | Preserved | Addition |
|---|---|---|
| Home | Complete existing dashboards, club search/switching, room tools, plan/account actions | Focused Game night view, refresh, searchable named tool directory |
| Navigation | Home, Games, Players, Results, Payments, visible Account, club switcher | Consistent readable controls and solid navigation surfaces |
| Scheduling | Cash games, tournaments, repeats, calendar and unfinished games | Clear contextual entry points |
| RSVP | Credentials, custom replies, arrival times, seats, guest list, shares | Saved response summary, edit sheet and refresh |
| Players | Invitations, QR, approvals, profiles, contact/privacy controls, roles, history | Clear named destinations |
| Live table | Auto/Full/Compact, seat controls, bank counts, buy-ins, cash-outs, chip stacks, hand tracking, blinds, TV, offline/conflict checks | Restrained dark/coral styling, clearer money semantics |
| Payments | Existing Insights ledger, bulk status updates, confirmation roles, reminders, partial/legacy state handling, deep links | Personal/club overview, counterparty search, dates and status filters |
| Results | Leaderboards, history, insights, individual records, image sharing | Consistent visual system |
| Settings | Account, plan, sign-out, install, push, opt-in and sound preferences | Accessible Account control retained |
| Gated tools | Existing planning, extras, exports and other feature flags | No automatic activation or permission widening |

## Release gates

1. Build and TypeScript checks.
2. Existing record, payment, tournament, gameplay and seat-stack regression suites.
3. New payment filters and access-rule checks.
4. Browser checks on narrow/mobile, tablet and desktop layouts, both legacy dashboard modes, named navigation, RSVP, payments and live table.
5. Review changed-file inventory for removed capabilities and accidental fixture/auth code.

## Recovery

The milestone preserves the complete pre-change source. Revert the implementation commit(s) or redeploy the milestone using the existing release process. Do not force-reset main. There are no schema changes or data backfills to roll back in this milestone. Native Expo store packaging and full native/web feature parity remain separate work.

## Implemented additions and corrections

- Porcelain, white, ink and coral app styling, with bundled Inter 4.1 and its SIL Open Font Licence. The full character set retains the existing arrow symbols and supports more member names than the original Latin subset.
- Game night home with real game, RSVP and payment data; refresh; honest loading/unavailable states; a searchable directory of named existing tools; and a personal switch back to the complete original dashboard.
- Compact player game/RSVP summaries, a full RSVP edit sheet, personal payments, history and explicit tool links. Existing RSVP proof is retained, including successful requests that finish after navigation. Stale replies cannot update a different game/member context.
- Personal/club payment overview, counterparty search, Brisbane game-date range and status filters. The complete original ledger remains available through Ledger & tools; its source is unchanged.
- Dark live-table presentation retaining Auto, Full and Compact, bank units and amounts, player actions, chip stacks, hand tracking, tournaments, TV and settlement safeguards. Fixed lifecycle cleanup and resize/view rendering so Strict Mode replay and game navigation do not detach the working engine.
- Fixed narrow-screen navigation, older-view contrast and the desktop ledger offset discovered during the browser walkthrough.
- Patched Next.js from 16.4.3 to 16.4.6. Production dependency audit reported zero vulnerabilities at the time of checking.

## Verification evidence

| Check | Result |
| --- | --- |
| `npm run build` with Next.js 16.4.6 / Turbopack | Pass: compilation, TypeScript, static page generation and route output |
| `tests/record-details.cjs` | Pass: read-only records, totals, identity, partial loads and cancellation |
| `tests/room-payment-schedule.cjs` | Pass: filters, cents, history, room boundaries and incomplete history |
| `tests/payment-overview.cjs` | Pass: immutable identity, same-name separation, query compatibility, Brisbane dates, search and action gates |
| `tests/tournament-structure.cjs` | Pass: controls and all 2–24 hour structures |
| `tests/gameplay-safety.cjs` | Pass: 9 settlement, explicit-edit and co-host assertions |
| `tests/seat-stack-ledger.cjs` | Pass: 14 chip/bank, pot, refund, void, rebuy and unsafe-history assertions |
| Focused player component harness | Pass: proof retention, custom replies, seats, conflicts, private reads, storage failure, unmount/context races and payment identity |
| Generated table engine / bootstrap harness | Pass: Strict Mode replay, cleanup, delayed responses, game changes, resize, decorated renderer and view selection |
| Renderer geometry harness | Pass: 240 combinations across 320–1440 widths, 9/13/15/24 seats, three view modes and hand tracking on/off |
| Actual browser walkthrough | Phone widths 320/390, desktop widths 1024/1280; new Home, player Home, both original dashboard layouts, Games, Players, Results, Calendar, Account, payment overview and original ledger |
| Actual live-table interactions | Full/Compact selection, phone-to-desktop resizing, player detail figures and action availability verified without recording financial actions |
| Source preservation check | No changes to Worker, native app, API client, original payment ledger or shared transfer loader; no production preview-auth or fixture routes |
| Whitespace and updated browser-script syntax | Pass |

The browser walkthrough used a separate local copy of the production components with fictional data and an isolated QA API. That adapter is not part of this branch. No production game, RSVP or financial records were changed during verification. The screenshots below show rendered code, rather than generated design images.

- [Host home](review/game-night-20261126/pkr-game-night-host.jpg)
- [Player home](review/game-night-20261126/pkr-game-night-player.jpg)
- [Live table](review/game-night-20261126/pkr-game-night-table.jpg)

## Remaining release work

1. Resolve the automated publication block. The user approved the proposed branch publication and draft PR on 27 November 2026. Command-line Git has no authenticated login, so publication was attempted through the connected GitHub account. Repository metadata confirms admin/push access and the reviewed payload contains no environment files or detected credential patterns. Dependency/asset object uploads succeeded, but automatic approval review rejected the complete UI tree twice, stating that it could see the user's “Yes” without the preceding question. No implementation branch was created or moved and no draft PR was opened. A standalone destination-specific authorisation is required by that gate; do not bypass it through another upload path.
2. Open the prepared draft pull request and run the existing full Chromium/WebKit CI browser matrix. The updated presentation expectations retain the financial, geometry, role and action assertions; the complete matrix has not run for this commit yet.
3. Review the preview and release through the existing deployment process. This milestone is not a claim that every device or live production workflow has been tested.
4. Complete the separate native release scope and device/signing/notification checks documented in [native scope](pkr-game-night-native-scope.md). A Next.js build does not produce an App Store or Play Store binary.

## Follow-up verification — 27 November 2026

The final CI compatibility review found that Full-view player names could truncate on 320px phones. A scoped rule now wraps those names at widths up to 360px, retaining card dimensions, bank/result rows, accessible names and Compact mode. The existing name-fit assertion remains unchanged. CSS parsing, whitespace checks and a fresh production build/TypeScript run passed after the correction. The design manifest was regenerated. Remote CI remains pending the publication gate above.
