# PKR Reloaded — isolated staging

## Dedicated resources

| Component | Stage | Status |
| --- | --- | --- |
| Cloudflare D1 | `pkr-reloaded-db-staging`, ID `03577857-fc94-49ed-bd1b-5cd658aa0978` | Owner supplied; not initialised by this PR |
| Cloudflare KV | `pkr-reloaded-kv-staging`, ID `9e86adbcfb5d4817a32dfd4482d3dbf9` | Owner supplied |
| Cloudflare Worker | `pkr-reloaded-worker-staging` | GitHub-connected. Check Cloudflare Build History for current deploy status |
| Vercel frontend | `https://pkr-reloaded-git-codex-pkr-product-b49f4c-jeemit1-arts-projects.vercel.app` | Dedicated branch Preview deployed; live backend not used |

The existing frontend project is hosted on **Vercel**, confirmed via GitHub deployment status. Vercel automatically creates preview builds on this draft PR. The preview URL above is a branch alias, not a production domain.

## Required before testing the preview

1. The Vercel branch Preview has been configured and verified. Keep the following **Preview** variables scoped to branch `codex/pkr-production-protection-20261024`:
   - `NEXT_PUBLIC_PKR_ENV` = `staging`
   - `NEXT_PUBLIC_API_URL` = `https://pkr-reloaded-worker-staging.jeemit1.workers.dev`
2. Any change to Preview variables requires a new Preview build. The Vercel preview deliberately fails closed if its staging variables are missing or point at production. These variables must **not** replace the production values.
3. Confirm Cloudflare's D1 and KV resource IDs and names match the supplied values.
4. **Database blocker:** `worker/schema.sql` does not describe the full current data model. A provisional and **staging-only** schema (`worker/staging.schema.sql`) plus in-memory smoke tests (`python3 worker/scripts/check-staging-schema.py`) have been added. It must still be checked against every current API route before applying to the *empty staging DB*. Never apply it or the existing default `db:migrate` script to production, and do not copy production financial/player data to staging.
5. Cloudflare Builds is connected to the staging Worker and tracks branch `codex/pkr-production-protection-20261024` as that Worker's deployment branch. Its build must run `npm ci && npm run check:staging && npm run typecheck && npm test` and its deploy command must be `npm run deploy:staging`. A commit to this branch may deploy **only** `pkr-reloaded-worker-staging`, not the production Worker; it does not run migrations. Do not run the default `npm run deploy`.
6. Use a **separate staging Google OAuth web client**. Its authorised redirect URI must match the deployed staging Worker, expected `https://pkr-reloaded-worker-staging.jeemit1.workers.dev/auth/callback` (verify the actual URL). Store a new `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and unique `JWT_SECRET` as Cloudflare **secrets for the staging Worker only**. Do not reuse production secrets or paste secrets into GitHub/chat.
7. Confirm staging Worker `GET /health` includes `environment: "staging"`. After that, test signing in, creating games, seating players, cash-outs, settlements, tournaments and hand tracking with synthetic data.
8. The staging Worker has no cron trigger, disables outbound push notifications, blocks Stripe checkout/portal/webhooks, and blocks paid AI calls. The production runtime is unchanged unless code is separately merged and deployed with approval.


## Cloudflare Git deployment safeguards

- The **staging Worker** uses the draft Git branch as its own Cloudflare production branch. This does **not** mean the PKR production Worker or the GitHub `main` branch is being deployed.
- The Cloudflare dashboard Worker must be named `pkr-reloaded-worker-staging`. The alternate `wrangler.staging.toml` config explicitly names the staging Worker and binds separate D1/KV IDs.
- **Do not accept or merge a Cloudflare auto-generated name-change PR that rewrites `worker/wrangler.toml`**. That default file belongs to the original production Worker; only `wrangler.staging.toml` should be used to deploy staging.
- The first build can be triggered with a documentation-only commit on the staging branch. Inspect **Deployments → Build History** for the result and check `GET /health` returns `environment: "staging"`.
- Until the staging D1 schema and staging-only OAuth/JWT credentials have been established, treat the preview as an **infrastructure smoke test only**. Do not log in with real users or attempt real-money workflows.

## Production protection

- This PR only updates source code on a development branch; it does not perform Cloudflare migrations, database exports, backend deployments or changes to `mypkr.app`.
- Vercel independently builds branch previews; they do **not** automatically become production releases. Do not use or share preview URLs until they are correctly pointed at staging.
- For a future production release, first independently back up D1, test an isolated deployment, verify financial reconciliations, and explicitly approve promotion.
- Cloudflare account IDs and D1/KV resource IDs are identifiers, not authentication secrets; real API keys, JWT keys and OAuth secrets must remain private.

References:
https://developers.cloudflare.com/workers/wrangler/configuration/
https://developers.cloudflare.com/d1/reference/migrations/
https://vercel.com/docs/environment-variables
