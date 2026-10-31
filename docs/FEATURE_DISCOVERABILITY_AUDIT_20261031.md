# PKR Reloaded — Feature discoverability audit
Date: 31 October 2026
Scope: GitHub main at 6facad49; current Next.js screens, connected Cloudflare Worker and routes.
This records source-code existence and navigation, not real-device acceptance or production backend activation.

## Why the app feels smaller than the codebase
The five primary tabs remain Home, Games, Players, Results, Payments. Features previously added in separate phases have accumulated in contextual game pages, player views, WhatsApp share routes and standalone settings. The Command Centre dashboard provides six feature shortcuts while Live Poker previously had no equivalent feature inventory. Many host-only actions were reachable only after opening an individual game.

## Inventory of existing, user-relevant capabilities

| Feature | Code entry point before audit | Exposure / recommended home |
| --- | --- | --- |
| Two dashboard compositions | RoomDashboardDual; RoomExperienceTheme | Home, host-selected |
| Schedule/repeat cash or tournament nights | Events game creation form | Games → Sessions and Calendar |
| Live RSVP board and live seat selection | /games/[id]/rsvp | Games → RSVPs & Sharing |
| Host-configured 7/8/9 pm arrival times | RSVP Host Controls | Games → RSVP Settings |
| Custom RSVP text (new) | Worker rsvp-board replies + RSVPs on board/Instant | Games → RSVP Settings, with Coming/Maybe/Not coming status |
| Group-safe current RSVP update / invitation via free WhatsApp | GameNightTools | Games → RSVPs & Sharing |
| Private reminders for members without RSVP | GameNightTools | Games → RSVPs & Sharing |
| Saved RSVP edit by device token | /games/[id]/rsvp | Self-service RSVP board |
| No-install PKR Instant | /instant and dashboard | Home/RSVP onboarding |
| Phone/QR invitations and host approval | Events Members/Invite view | Players → Invite & QR / Approvals |
| Member avatars, screen names, private contact preferences | RoomPlayerProfileEditor | Players → member profile |
| Host/cohost roles and separate member access | Events screens/middleware | Players → roster and approvals |
| Live seating, buy-ins, cashouts and bank details | /games/[id]/play | Games → active session/table |
| Hand tracking, pot and stack updates | Live play and Worker hands routes | Games → active table, context-sensitive (not a bottom tab) |
| Tournament blind management | Live game tournament routes | Games → active tournament |
| Live watch link / television table | Game detail/live routes | Games → active session |
| Settled leaderboards and individual game history | /results and RecordMetric | Results → Standings |
| Six-month trend and red/green net graphs | /results?view=insights | Results → Insights |
| Group-safe results text and results-card image sharing | Results → History, GameNightTools | Results → History |
| Transfer ledger, bulk paid/unpaid and payer-receiver confirmations | /payments, game results | Payments → Outstanding |
| Individual WhatsApp payment follow-ups | /payments transfer table | Payments → private reminder |
| Automated daily outstanding settlement push (opt-in) | /games/[id] Settlement notifications; Worker reminders | Payments → Automatic reminders, links per game |
| Push opt-in, test, sound and phone installation | /account and /install | Account; Home link |
| Historical unfinished and archived rooms | /schedule, Dashboard | Games → Calendar; Home room list |
| AI hand analysis | /games/[id]/analysis route | **Not promoted** until feature flag, service availability, billing and privacy are reviewed. Existing code alone does not confirm usable production service. |
| Native wrapper scaffold | native/ | **Not promoted** as an available store app until distributed and device-tested. |

## Changes in this proposed release
- Editable 3–8 host RSVP text choices, including three stable mandatory presets (late, maybe, not-coming) and optional custom responses; explicit attendance classification protects counts and seats.
- Response vocabulary is stored with existing arrival choices; old JSON arrays remain readable. Actual per-player custom reply IDs use **one additive nullable D1 column**, `game_rsvp_guests.choice_value`. Existing `yes/no` CHECK, seat constraints and automatic game-start seating are preserved: Maybe stores a non-attending internal `no` while the API accurately reports Maybe.
- **Migration required before Worker deployment:** `worker/migrations/20261031_rsvp_custom_choice.sql`. The existing guarded production-release helper has been updated to verify a D1 backup, rehearse the migration against its restored copy, apply the nullable column (if absent), recheck financial aggregates, and only then deploy the Worker. No production changes occur until an authorised main release. The frontend must still be released **after** the Worker, ideally in a separate phase.
- Configured labels appear on the live RSVP board, Game Night list and PKR Instant; maybe/no cannot reserve a seat.
- Direct RSVP Settings links from Game Night, Games and Home, with a deep link to host controls.
- Matching feature shortcuts in both Command Centre and Live Poker.
- First-class Payments reminder toolbar without group/bulk WhatsApp messaging. Per-game recurring push controls remain on saved game details.

## Recommended follow-ups, not claims of completion
1. Make the Payments desktop and mobile transfer ledger easier to scan without horizontal scrolling; verify all reminder buttons on iPhone Safari/PWA.
2. Unify member-profile and invitation navigation, including host/cohost permissions and device status.
3. Add a searchable host feature directory only if discovery remains poor after the above changes; do not add another primary tab or generic More drawer.
4. Audit dead routes, backup files and overlapping CSS imports in a separate refactor with before/after screenshots and rollback. Do not alter production transactions in an interface audit.
5. Audit AI analysis separately for external dependency, data disclosure, consent and real activation before showing it as a customer feature.

## Release gates
- Worker Hono/Vitest tests and disposable SQLite migration tests, including original CHECK constraints, custom response classification, and preserving answers on old-client updates.
- Next production build and typecheck.
- Browser smoke on six viewport sizes with synthetic data: RSVP custom labels/seat mapping, Game Night link, both dashboards, Payments toolbar, last row vs fixed nav.
- **Two-phase deployment:** merge backend Worker/migration/release-script changes first; the existing guarded release workflow validates backup, applies the schema and deploys Worker. Verify GET/POST replies on an authorised test game. Only then merge frontend navigation/UI changes so Vercel does not publish a new client before backend readiness. No production migration or deployment is authorised or performed by this draft PR.
- No real data, messaging credentials, paid WhatsApp API or live push used by tests.
