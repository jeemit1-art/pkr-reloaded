# PKR UAT staging branch

This permanent Git branch `staging/pkr-uat` is used for a **Vercel preview only**. It must never be configured as a production Worker or production domain.

- Cloudflare Worker: `pkr-reloaded-worker-staging` in the personal PKR account
- Cloudflare D1: `pkr-reloaded-db-staging` (isolated from `pkr-db`)
- Backend URL: `https://pkr-reloaded-worker-staging.jeemit1.workers.dev`
- Preview Web build must use `NEXT_PUBLIC_API_URL` pointing to the staging Worker and `NEXT_PUBLIC_PKR_ENV=staging`
- Google OAuth redirect target must be the staging Worker callback and only the staging Vercel preview return origin.
- No production migrations or player balances are to be tested using this branch.
- Keep the preview branch available until staging UAT and rollback tests are complete.
