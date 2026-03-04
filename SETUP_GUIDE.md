# PKR Reloaded — Complete Setup Guide

---

## Accounts — Use what you already have

| Service | Do you need a new account? |
|---|---|
| GitHub | ✅ Use your existing account |
| Cloudflare | ✅ Use your existing account |
| Vercel | ✅ Use your existing account |
| Google Cloud | ⚠️ Free project inside Google Cloud Console — use your regular Google account, just create a new project |

---

## What you'll need before starting

- Your computer (Mac or Windows)
- About 45–60 minutes
- The `pkr-reloaded.zip` file downloaded and unzipped to your Desktop
- Node.js installed (check below)
- Git installed (check below)

---

## CHECK FIRST — Do you have Node.js and Git?

Open **Terminal** (Mac: ⌘+Space → type Terminal → Enter)
or **Command Prompt** (Windows: Win+R → type cmd → Enter)

Type each of these and press Enter:

```
node --version
git --version
```

If you see version numbers like `v20.11.0` — you're good, skip to Step 1.

If you see an error:
- Node.js missing → https://nodejs.org → download **LTS** → install
- Git missing → https://git-scm.com/downloads → download → install

After installing, close Terminal completely and reopen it, then check again.

---

## STEP 1 — Upload your code to GitHub

**1a. Unzip the file**

Unzip `pkr-reloaded.zip`. Move the resulting `pkr-reloaded` folder to your Desktop.

**1b. Create a new GitHub repository**

1. Go to https://github.com and sign in with your existing account
2. Click the **+** icon (top right) → **New repository**
3. Repository name: `pkr-reloaded`
4. Set to **Private**
5. Click **Create repository**
6. Leave the page that appears open — you'll use it in a moment

**1c. Push the code up**

In Terminal, run these one at a time. Replace `YOUR_USERNAME` with your actual GitHub username:

```bash
cd ~/Desktop/pkr-reloaded
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pkr-reloaded.git
git push -u origin main
```

⚠️ If GitHub asks for a password and rejects it: GitHub no longer accepts account passwords in Terminal. You need a Personal Access Token:
1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Give it any name, set expiry to 90 days, tick the **repo** checkbox
4. Click **Generate token** — copy it immediately
5. Use that token as your "password" when Terminal asks

Once done, go back to your GitHub repo page and refresh — you should see all the files there.

---

## STEP 2 — Set up Google Login

This is free and lets people sign in with their Google account.

**2a. Go to Google Cloud Console**

Go to https://console.cloud.google.com and sign in with your regular Google account.

**2b. Create a project**

1. Click the project selector at the top of the page (might say "Select a project")
2. Click **New Project**
3. Name: `PKR Reloaded` → click **Create**
4. Wait a few seconds, then make sure `PKR Reloaded` is selected in the dropdown at the top

**2c. Set up the OAuth consent screen**

(Google requires this before you can create login credentials)

1. Left menu → **APIs & Services** → **OAuth consent screen**
2. Select **External** → click **Create**
3. Fill in:
   - App name: `PKR Reloaded`
   - User support email: your email
   - Developer contact information: your email
4. Click **Save and Continue**
5. On Scopes → **Save and Continue** (no changes needed)
6. On Test Users → **Save and Continue** (no changes needed)
7. Click **Back to Dashboard**

**2d. Create your credentials**

1. Left menu → **Credentials**
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `PKR Reloaded Web`
5. Under **Authorized redirect URIs** → click **+ ADD URI** → paste:
   ```
   http://localhost:8787/auth/callback
   ```
6. Click **Create**

A popup appears with your **Client ID** and **Client Secret**.

⚠️ **Save both of these right now** — paste them into Notes or a text file. You cannot easily retrieve the Client Secret again.
- Client ID looks like: `123456789-abc.apps.googleusercontent.com`
- Client Secret looks like: `GOCSPX-xxxxxxxxxxxxxxxx`

---

## STEP 3 — Set up Cloudflare (the backend)

**3a. Install Wrangler**

In Terminal:
```bash
npm install -g wrangler
```

Takes about 30 seconds.

**3b. Log in to Cloudflare**

```bash
wrangler login
```

A browser window opens. Click **Allow**. Return to Terminal.

**3c. Go to the worker folder**

```bash
cd ~/Desktop/pkr-reloaded/worker
```

**3d. Create the database**

```bash
wrangler d1 create pkr-reloaded-db
```

The output will include something like:
```
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy that ID. Then open `worker/wrangler.toml` in a text editor (TextEdit on Mac, Notepad on Windows). Find:
```
database_id = "REPLACE_WITH_YOUR_D1_ID"
```
Replace `REPLACE_WITH_YOUR_D1_ID` with your actual ID. Save the file.

**3e. Create the session store**

```bash
wrangler kv:namespace create "KV"
```

Output includes an `id` value. Copy it.

In `wrangler.toml`, find:
```
id = "REPLACE_WITH_YOUR_KV_ID"
```
Replace with your ID. Save the file.

**3f. Add your Google Client ID to wrangler.toml**

In `wrangler.toml`, find:
```
GOOGLE_CLIENT_ID = "REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
```
Replace the whole value with your actual Client ID from Step 2. Example:
```
GOOGLE_CLIENT_ID = "123456789-abc.apps.googleusercontent.com"
```
Save the file. Leave `FRONTEND_URL` alone for now.

**3g. Generate push notification keys**

```bash
npx web-push generate-vapid-keys
```

This prints a Public Key and Private Key. Save both in your notes.

**3h. Install dependencies**

```bash
npm install
```

**3i. Create the database tables**

```bash
npm run db:migrate
```

Should show a success message. If it errors, go back and check that you saved `wrangler.toml` correctly.

**3j. Set your secrets**

Run each command. After each one Terminal shows `Enter a secret value:` — paste and press Enter.

```bash
wrangler secret put GOOGLE_CLIENT_SECRET
```
→ Paste your Google Client Secret from Step 2

```bash
wrangler secret put JWT_SECRET
```
→ Go to https://www.uuidgenerator.net/version4, copy the UUID, remove the dashes, repeat and paste both together. End result is a long random string like `550e8400e29b41d4a716446655440000a716446655440000`

```bash
wrangler secret put VAPID_PUBLIC_KEY
```
→ Paste the Public Key from Step 3g

```bash
wrangler secret put VAPID_PRIVATE_KEY
```
→ Paste the Private Key from Step 3g

```bash
wrangler secret put VAPID_EMAIL
```
→ Type your email address

**3k. Deploy the worker**

```bash
wrangler deploy
```

When done you'll see:
```
✅ Deployed to: https://pkr-reloaded-worker.YOUR_NAME.workers.dev
```

Save that full URL. You need it next.

---

## STEP 4 — Set up Vercel (the frontend)

**4a. Import your project into Vercel**

1. Go to https://vercel.com and sign in with your existing account
2. Click **Add New** → **Project**
3. Find `pkr-reloaded` in the list → click **Import**
   - If you don't see it, click **Adjust GitHub App Permissions** and grant Vercel access to this repo
4. ⚠️ Under **Root Directory** — click **Edit** and type `frontend` — this is critical, don't skip it
5. Under **Environment Variables**, add:
   - Name: `NEXT_PUBLIC_API_URL`
   - Value: your worker URL from Step 3k (e.g. `https://pkr-reloaded-worker.YOUR_NAME.workers.dev`)
6. Click **Deploy**

Wait 1–2 minutes. You'll get a URL like `https://pkr-reloaded.vercel.app`

Save that Vercel URL. You need it for the next two steps.

**4b. Tell the worker where the frontend lives**

Open `worker/wrangler.toml` again. Find:
```
FRONTEND_URL = "https://REPLACE_WITH_YOUR_VERCEL_URL.vercel.app"
```
Replace with your actual Vercel URL (no trailing slash):
```
FRONTEND_URL = "https://pkr-reloaded.vercel.app"
```
Save the file. Then redeploy:

```bash
cd ~/Desktop/pkr-reloaded/worker
wrangler deploy
```

**4c. Add production callback URL to Google**

1. Go to https://console.cloud.google.com
2. Left menu → **APIs & Services** → **Credentials**
3. Click on **PKR Reloaded Web** (your OAuth client)
4. Under **Authorized redirect URIs** → **+ ADD URI**
5. Add (replace `YOUR_NAME` with what appeared in your worker URL):
   ```
   https://pkr-reloaded-worker.YOUR_NAME.workers.dev/auth/callback
   ```
6. Click **Save**

---

## STEP 5 — Push everything and go live

```bash
cd ~/Desktop/pkr-reloaded
git add .
git commit -m "Add production config"
git push
```

Vercel will automatically rebuild in about 1 minute.

---

## STEP 6 — Verify everything works

Go through this checklist:

- [ ] Go to your Vercel URL — landing page loads with the SIGN IN button
- [ ] Click **SIGN IN WITH GOOGLE** — Google sign-in page appears
- [ ] Sign in — you land on the Dashboard
- [ ] Click **+ NEW TABLE** — create a table
- [ ] Open the table — click **+ SCHEDULE GAME**, set a date/time, click **SCHEDULE + NOTIFY**
- [ ] Click into the game — add 2 players with names and cashout amounts
- [ ] Click **SETTLE THIS GAME** — results and transfers appear
- [ ] Click the Leaderboard tab on the table page — player stats appear

If all boxes are checked, you're live. Share the Vercel URL with your group.

---

## Sharing the app with your players

- **Regular players**: just send them the Vercel URL. They join games via the app, no account needed.
- **Co-hosts** (people who can schedule games and settle): go into a table → click **INVITE CO-HOST** → share the link. It expires after 48 hours and is single-use.
- **You as host**: you're the only one who needs to be signed in with Google.

---

## If something goes wrong

| Symptom | What to check |
|---|---|
| Google sign-in shows "redirect_uri_mismatch" | The redirect URI in Google Console doesn't match your worker URL exactly — check for typos and make sure you added the production one in Step 4c |
| "Unauthorized" error after signing in | `FRONTEND_URL` in wrangler.toml is wrong or missing — fix it and run `wrangler deploy` again |
| Vercel build fails with an error | Make sure Root Directory is set to `frontend` in Vercel → your project → Settings → General |
| `wrangler` command not found | Run `npm install -g wrangler` again, then close and reopen Terminal |
| GitHub rejects your password | Use a Personal Access Token instead — see Step 1c |
| Database error on first use | Run `npm run db:migrate` from inside the `worker` folder |
| Push notifications not arriving | Check all 5 `wrangler secret put` commands completed without errors |

---

## Cost — it's all free

| Service | Free limit | You'll use |
|---|---|---|
| Cloudflare Workers | 100,000 requests/day | ~100/week |
| Cloudflare D1 | 5M row reads/day | ~1,000/week |
| Cloudflare KV | 100,000 reads/day | ~50/week |
| Vercel | Unlimited hobby deploys | As needed |
| Google OAuth | Free | Free |

You will never hit any of these limits for a private poker group.
