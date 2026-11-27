# PKR experience consolidation release — 28 November 2026

## Change boundary
- Frontend-only appearance and navigation, not a money, membership, billing or database release.
- Existing five primary destinations: Home, Games, Players, Results, Payments.
- Hosts retain Game night and both Full dashboard designs. Account now owns personal Home view preference and preview-player controls.
- Existing game, RSVP, results, transfer and payment confirmation APIs are unchanged.
- No automatic WhatsApp sending or paid WhatsApp API.
- Club planning, waitlists, seasons, shared costs, exports, tournaments and promotions remain subject to existing server and frontend feature flags; source code is not evidence of production activation.

## Frozen rollback checkpoint
- Branch: `milestone/pre-experience-consolidation-20261128`
- Commit: `479bd0cf8be66b496d8be2a0e17fe86da22c07c5`
- No migration is included in this PR. Revert the merge or redeploy this commit if frontend acceptance fails.

## Required release checks on the exact PR head
1. Vercel preview build READY, including Next.js TypeScript verification.
2. PKR frontend dependency security gate: success.
3. PKR staging isolation and Worker tests: success.
4. PKR Game Night and sharing checks: success.
5. PKR responsive browser smoke: all shards success, including Chromium/WebKit on phones and the table at 9–13 seats.
6. PKR launch screenshots: success, with the approved selected light/dark palette rather than obsolete forest/Classic assertions.
7. Inspect fictional signed-in screenshots for 320, 390, 430, 768 and 1440-pixel widths; ensure no heading/card overlap, lost click targets or bottom-bar occlusion.
8. Confirm production's exact merged commit is READY and the latest deployed main SHA is correct.

**Do not merge when a check is red or only queued.** A Vercel READY state is not evidence that the browser QA passed.

## Repository protection needed
At GitHub `Settings → Branches` (or repository rulesets), protect `main` with:
- Pull requests required; block direct pushes and force pushes.
- Require the latest successful status checks for responsive browser smoke, launch screenshots, frontend security, staging isolation, and Game Night/sharing.
- Require branches to be up-to-date before merging.
- Restrict who can bypass these rules and audit any emergency release.

The authenticated GitHub connector used for this release cannot change branch protection; until an administrator enables it, the release owner must manually verify CI before merge.

## Backend/data prerequisites — explicitly not certified by this frontend PR
- Confirm that the authenticated Cloudflare account owns the **actual PKR** production Worker, D1 and KV resources.
- Create and independently restore a fresh production D1 backup into a separately named disposable database; compare row counts, financial aggregates, transfers and audit log integrity.
- Run two-host simultaneous financial and table edits, offline/resume, 9–13 seat tests and signed-in iOS/Android PWA tests.
- Before activating any new D1-backed club feature, apply its migration to isolated staging, verify feature flags and complete signed-off role/permission/financial UAT.
- A code rollback does **not** reverse D1 migrations or financial writes. Do not delete live data or retroactively mark payments paid.

## Financial/reliability boundaries
- The UI must never infer an actual payment from a WhatsApp draft or a player-tapped Send.
- Only saved buy-ins, cash-outs, reconciled results and confirmed transfer events inform displayed balances.
- Unavailable historical records show an incomplete/review state, not an invented zero or reconciled total.
- Host changes require the existing validated server-side permissions and concurrency controls.

## Additional follow-up
- Remove historical tracked `worker/node_modules` from Git *as a separate low-risk repository hygiene change*. The root .gitignore already excludes it for new changes.
- Decompose the large live-game page in separately tested increments; do not rewrite the financial or hand engine in a single design release.
- Independently validate the next native-app parity and release pathway before implying App Store availability.
