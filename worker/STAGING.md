# PKR Reloaded — staging (not deployed)

## Dedicated resources

| Component | Stage | Status |
| --- | --- | --- |
| Cloudflare D1 | `pkr-reloaded-db-staging`, ID `03577857-fc94-49ed-bd1b-5cd658aa0978` | Owner supplied; not initialised by this PR |
| Cloudflare KV | `pkr-reloaded-kv-staging`, ID `9e86adbcfb5d4817a32dfd4482d3dbf9` | Owner supplied |
| Cloudflare Worker | `pkr-reloaded-worker-staging` | Configured in GitHub; not deployed |
| Vercel frontend | `https://pkr-reloaded-git-codex-pkr-product-b49f4c-jeemit1-arts-projects.vercel.app` | Vercel automatically generated a preview for this branch; **do not test login until env variables are set** |

The existing frontend project is hosted on **Vercel**, confirmed via GitHub deployment status. Vercel automatically creates preview builds on this draft PR. The preview URL above is a branch alias, not a production domain.

## Required before testing the preview

1. In **Vercel → pkr-reloaded → Settings → Environment Variables**, add the following **Preview** variables, scoped to branch `codex/pkr-production-protection-20261024`:
   - `NEXT_PUBLIC_PKR_ENV` = `staging`
   - `NEXT_PUBLIC_API_URL` = `https://pkr-reloaded-worker-staging.jeemit1.workers.dev`
2. Redeploy the preview **after** adding those variables. The Vercel preview build now deliberately fails closed if its staging variables are missing or point at production. These variables must **not** replace the production values.
3. Confirm Cloudflare's D1 and KV resource IDs and names match the supplied values.
4. **Database blocker:** `worker/schema.sql` does not describe the full current data model. A provisional and **staging-only** schema (`worker/staging.schema.sql`) plus in-memory smoke tests (`python3 worker/scripts/check-staging-schema.py`) have been added. It must still be checked against every current API route before applying to the *empty staging DB*. Never apply it or the existing default `db:migrate` script to production, and do not copy production financial/player data to staging.
5. After schema work is prepared and deployment is approved, from `worker/`, run `npm run check:staging`. Then `npm run deploy:staging` **only with explicit deployment approval**. This deploys **only** `pkr-reloaded-worker-staging`, not the production Worker, and does not run migrations. Do not run the default `npm run deploy`.
6. Use a **separate staging Google OAuth web client**. Its authorised redirect URI must match the deployed staging Worker, expected `https://pkr-reloaded-worker-staging.jeemit1.workers.dev/auth/callback` (verify the actual URL). Store a new `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and unique `JWT_SECRET` as Cloudflare **secrets for the staging Worker only**. Do not reuse production secrets or paste secrets into GitHub/chat.
7. Confirm staging Worker `GET /health` includes `environment: "staging"`. After that, test signing in, creating games, seating players, cash-outs, settlements, tournaments and hand tracking with synthetic data.
8. The staging Worker has no cron trigger, disables outbound push notifications, blocks Stripe checkout/portal/webhooks, and blocks paid AI calls. The production runtime is unchanged unless code is separately merged and deployed with approval.

## Production protection

- This PR only updates source code on a development branch; it does not perform Cloudflare migrations, database exports, backend deployments or changes to `mypkr.app`.
- Vercel independently builds branch previews; they do **not** automatically become production releases. Do not use or share preview URLs until they are correctly pointed at staging.
- For a future production release, first independently back up D1, test an isolated deployment, verify financial reconciliations, and explicitly approve promotion.
- Cloudflare account IDs and D1/KV resource IDs are identifiers, not authentication secrets; real API keys, JWT keys and OAuth secrets must remain private.

References:
https://developers.cloudflare.com/workers/wrangler/configuration/
https://developers.cloudflare.com/d1/reference/migrations/
https://vercel.com/docs/environment-variables
