# PKR Reloaded — staging environment (not deployed)

This file sets up **staging only**. No production deployments, remote migrations, or data operations are performed by committing this code.

## Dedicated staging resources
| Component | Name or planned URL | ID |
| --- | --- | --- |
| D1 database | `pkr-reloaded-db-staging` | `03577857-fc94-49ed-bd1b-5cd658aa0978` |
| KV namespace | `pkr-reloaded-kv-staging` | `9e86adbcfb5d4817a32dfd4482d3dbf9` |
| Worker | `pkr-reloaded-worker-staging` | Not deployed |
| Frontend | `https://staging.mypkr.app` | Proposed hostname, not live |

The separate `worker/wrangler.staging.toml` config has **no** production resource bindings. Do not change or replace `worker/wrangler.toml`.

## Required before deployment
1. Verify the given D1 and KV IDs and their actual resource names in the Cloudflare dashboard.
2. **Schema blocker:** `worker/schema.sql` is outdated and does not include all the current tables and columns. Do NOT run the existing `db:migrate` script or apply this base schema to production. First create and test a complete versioned schema for the **empty staging database** using synthetic test fixtures. Nothing has been migrated.
3. Create a separate **frontend deployment project** and serve it at `https://staging.mypkr.app`. Frontend hosting infrastructure is not confirmed; do not assume the current Next.js app is ready for Cloudflare Pages without an adapter. If you choose another staging URL, change `FRONTEND_URL` in the staging config.
4. On that staging frontend build, set:
   - `NEXT_PUBLIC_PKR_ENV=staging`
   - `NEXT_PUBLIC_API_URL=https://pkr-reloaded-worker-staging.jeemit1.workers.dev` (verify Worker subdomain once deployed).
   These variables must be defined in the **staging frontend** environment only. `frontend/.env.staging.example` is reference documentation, NOT an automatically loaded Next.js file.
5. Create a separate **Google OAuth web client** for staging and authorise the callback URL `https://pkr-reloaded-worker-staging.jeemit1.workers.dev/auth/callback` (adjust after actual Worker URL is confirmed). Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a newly generated independent `JWT_SECRET` as **secrets on the staging Worker only**. Never reuse production secrets or put secret values in GitHub.
6. Outbound push notifications, scheduled payment reminders, Stripe checkout/portal/webhooks, and paid AI analysis are deliberately disabled in the staging runtime. The billing plan status read remains usable.
7. When schema, frontend, and credentials are ready and deployment is approved, from `worker/`, run `npm run check:staging` and inspect its output. The explicit deployment command is `npm run deploy:staging`. **It deploys the staging Worker; do not run it without approval.** This command does NOT run migrations.
8. Confirm `GET /health` returns `environment: "staging"` before any test login. All test games must use synthetic players, never copied production records.

## Safety notes
- Only staging bindings are declared in `wrangler.staging.toml`; no Worker routes or cron triggers are attached.
- Do not run the default `npm run deploy`, `wrangler d1 execute` or `wrangler d1 migrations apply` against production for staging work.
- No database exports or copies were made. Take a separate verified production backup before any later production release.
- Never copy production tokens, Google or Stripe secrets, real phone numbers, or real financial records into staging.
- Audit the final PR, tests and migration/rollback plans before merging to `main`.

Cloudflare official docs:
https://developers.cloudflare.com/workers/wrangler/configuration/
https://developers.cloudflare.com/d1/configuration/environments/
https://developers.cloudflare.com/d1/reference/migrations/
