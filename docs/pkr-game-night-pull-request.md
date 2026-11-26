# Add Game night app design while retaining existing workflows

## Why

PKR needs a clearer phone interface and quicker access to game-night tasks while existing members continue to use their familiar tools. The redesign must preserve current records, role restrictions, game controls and payment workflows.

## What changes

- Add the approved Game night Home, compact player/RSVP experience, searchable tool directory, consistent navigation and locally bundled Inter.
- Keep the complete Command Centre and Live Poker dashboards behind the visible Full dashboard switch. Their shared room preference remains separate from the personal Home-view choice.
- Add payment overview, personal/club scope, counterparty/date/status filters and refresh while retaining the original ledger and its bulk actions, reminders and record details.
- Refresh the live table without changing financial calculations. Preserve bank units, money, chip stacks and all view options. Correct lifecycle/resize handling and stale callback isolation.
- Preserve successful RSVP edit credentials after navigation, guard context changes and retain seat/custom-response restrictions.
- Apply the approved colours and readable controls to Games, Players, Results, Calendar and Account. Update presentation assertions while preserving behavioural assertions.
- Patch Next.js to 16.4.6.

## Preservation and recovery

Baseline: `24282989c73793cd97969f889a8aded568cfd649`.

Recovery branch: `release-checkpoints/pkr-before-game-night-redesign-20261126-2340`.

No Worker, database schema, API-client, original Insights ledger, shared transfer-loader or native source changes. No preview authentication or fictional API data is included in production code.

## Validation

- Production build and TypeScript pass.
- Record details, shared payment schedule, new payment overview, tournament structure, gameplay safety and seat-stack ledger suites pass.
- Focused RSVP lifecycle/identity checks and generated live-engine resize/lifecycle checks pass.
- Browser walkthrough covers phone and desktop, both saved dashboard layouts, all five primary sections, Account/Calendar, original ledger and live table view/resize behaviour.
- Actual screenshots and the detailed feature-preservation matrix are in `docs/pkr-game-night-milestone-20261126.md`.

The full Chromium/WebKit CI matrix must pass before release. Manual QA used isolated fictional records and did not perform production money or RSVP writes. Native store builds, signing, push delivery and native/web parity remain a separate milestone.
