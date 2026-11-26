# PKR consolidated release candidate — 26 November 2026
**Status: CODE REVIEW ONLY. Do not activate production database features without independent verification.**

## Repository and dependencies
- Unified dashboard: draft PR #77 -> main
- Club coordination: draft PR #79 -> PR #77
- Shared costs, data exports, tournament templates and free-first-game: draft PR #80 -> PR #79
- Prior live Git checkpoint: release-checkpoints/pkr-live-pre-unified-20261126
- Exact prior live commit: f7cf1eb364f57d93ddd3f265f7c90fd610937bc6
- Prior Vercel deployment: dpl_BPsJc1EK18dBaMZqb6ohhyd7Yuhz
- Rollback runbook: issue #78
- Existing staging smoke failure: the deployed isolated Worker OAuth redirect points to a retired preview hostname, while the source references the latest preview. The owning Cloudflare account must deploy the isolated staging Worker configuration.

## Features
| Area | Implementation | Activation |
| --- | --- | --- |
| Unified player/host dashboard | Player RSVP/seat/arrival, phone install, links, history and payment functions preserved; legacy Instant links redirect | Preview/review of PR #77 |
| Member date polls | Host creates; approved members vote; host selects and pre-fills existing scheduler | Worker PKR_CLUB_PLANNING_V1 + frontend NEXT_PUBLIC_PKR_CLUB_PLANNING_V1 |
| Seat queue | One provisional place offer at a time; no seat allocation bypass | Same; also requires PKR_RSVP_V2 |
| Player requests | Host approves attention requests for buy-in/cash-out/rebuy; no ledger changes automatically | Club planning flag |
| League seasons | Settlement-derived points, ties, basic achievements and member-visible CSV | Club planning flag |
| Shared expenses | Optional equal-cent cost splits; consent accepted/declined; no poker settlement changes | PKR_CLUB_EXTRAS_V1 + NEXT_PUBLIC_PKR_CLUB_EXTRAS_V1 |
| History CSV export | Club owner only; five paginated categories; excludes PII and secrets; sanitised CSV | Club extras flag |
| Reusable tournament presets | Host/co-host saves an existing setup, applies through protected Pro setup route before start | Club extras flag |
| First free cash game | Eligible host only, one group, up to nine seats, single cash session; claim locked to account in D1 | PKR_FREE_FIRST_GAME_V1 + NEXT_PUBLIC_PKR_FREE_FIRST_GAME_V1 |
| Host referrals | Public app URL only, no room/member/payment data | Club planning flag |

## Migration prerequisites (not performed)
1. Connect to the **correct PKR-owning Cloudflare account**. Confirm staging Worker, isolated KV, D1 IDs and FRONTEND_URL. Do not touch the production Worker or database during UAT.
2. Export, back up and **test restore** of isolated staging D1. Verify row counts and foreign keys.
3. Apply only to isolated staging D1, in this order:
   - existing required RSVP/mobile/profile migrations as relevant
   - worker/migrations/20261126_club_planning.sql
   - worker/migrations/20261126_club_extras.sql
4. Run the disposable SQLite migration and route SQL tests (CI). Then enable worker flags **only in staging** and deploy staging Worker.
5. Configure matching preview-only Vercel environment variables; rebuild the specific preview. Production variables stay off.
6. Test real iPhone and Android invitation and RSVP, queue and seat race, game-start plan gates, cash-outs and settlement, notifications, tournament setup and shared cost consent, CSV export under host and member roles, first-game claim race, and rollback.
7. Run full existing release checklist, independent privacy/security review and UAT sign-off. Only then plan production D1 backup, additive migration and feature-by-feature activation.
8. For release to Vercel, stage a **production** build with no domain assignment, test that exact build, then promote. Promoting a preview can rebuild under production environment variables, and must not be treated as the same binary.

## Preserved boundaries
- No existing historic game/settlement/transfer/RSVP/member data is modified by these optional migrations.
- Feature flags off = old app API/checkout/finance functions remain as before.
- Pricing stays Starter AUD 9.99/month and Pro AUD 19.99/month unless a separate approved pricing change is made. The free-first-game is an independently gated promotional entitlement, **not** a Stripe trial/subscription.
- Invited approved members continue to access existing player functions without host subscriptions.
- Shared cost proposals never settle poker transfers, claim actual payment or deduct from buy-ins.
- Member names, raw finance records and payment acknowledgements are not included in public referral messages.
- Full history exports are deliberately **club owner only** and should be kept in secure storage.
- Legacy /instant links are redirected while retaining room selector. Do not remove personal invitation approval, profiles, financial audit or game controls.

## Known limitations and acceptance
- Real-device PWA and notification delivery need hands-on UAT.
- Preview OAuth staging currently cannot pass smoke until the owning Cloudflare account is updated.
- Promo feature is unavailable until the D1 migration and BOTH flags are verified; do not advertise it on production with only a frontend flag.
- Existing Worker dependency audit reports unresolved advisories; review applicability and prioritise remediation before enabling production backend features.
- Migration rollback is **not** accomplished by a Vercel code rollback. Additive D1 tables can safely remain unused when feature flags are off; never delete production records automatically.
