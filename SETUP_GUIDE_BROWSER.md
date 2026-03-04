# PKR Reloaded — Browser-Only Setup Guide
### No installs on your computer. Everything runs in your browser.

---

## How this works

You'll use **GitHub Codespaces** — a full computer that runs inside a browser tab.
It has a terminal, a file editor, and everything you need already installed.
You just open it, upload your zip file, and run commands from there.

---

## Accounts — use what you already have

| Service | Action |
|---|---|
| GitHub | Sign in — Codespaces runs here |
| Cloudflare | Sign in — your backend lives here |
| Vercel | Sign in — your frontend lives here |
| Google | Sign in at console.cloud.google.com — for the login system |

No new accounts needed anywhere.

---

## Before you start

- [ ] Download `pkr-reloaded.zip` to your computer (just needs to be downloaded, not unzipped)
- [ ] Have your GitHub, Cloudflare, and Vercel accounts ready to sign into
- [ ] Set aside about 60 minutes

---

## STEP 1 — Create a GitHub repository

1. Go to https://github.com and sign in
2. Click the **+** icon (top right) → **New repository**
3. Fill in:
   - Repository name: `pkr-reloaded`
   - Visibility: **Private**
   - ⚠️ Tick **"Add a README file"** — this is required so Codespaces can open the repo
4. Click **Create repository**

---

## STEP 2 — Open GitHub Codespaces

1. You're now on your new repo page
2. Click the green **Code** button
3. Click the **Codespaces** tab
4. Click **Create codespace on main**

A new browser tab opens. It looks like VS Code. Wait about 30 seconds for it to finish loading — you'll see a terminal panel at the bottom. If you don't see the terminal, press `` Ctrl+` `` (backtick key).

This is your cloud computer. Everything from here runs inside this tab.

---

## STEP 3 — Upload and unpack your code

**3a. Upload the zip file**

In the left sidebar of Codespaces you'll see a file explorer panel. 

1. Right-click anywhere in the empty space of that panel
2. Click **Upload...**
3. Select `pkr-reloaded.zip` from your computer
4. Wait for it to upload (you'll see it appear in the sidebar)

**3b. Unzip it**

Click in the terminal at the bottom and run:

```bash
unzip pkr-reloaded.zip
```

You'll see a `pkr-reloaded` folder appear in the sidebar.

**3c. Push the code to GitHub**

```bash
cp -r pkr-reloaded/. .
rm -rf pkr-reloaded pkr-reloaded.zip
git add .
git commit -m "Initial commit"
git push
```

Refresh your GitHub repo page — you should see all the files there now.

---

## STEP 4 — Set up Google Login

**4a. Create a Google Cloud project**

1. Go to https://console.cloud.google.com in a new tab
2. Sign in with your Google account
3. Click the project selector at the top → **New Project**
4. Name: `PKR Reloaded` → **Create**
5. Make sure `PKR Reloaded` is selected in the dropdown at the top

**4b. Set up the consent screen**

1. Left menu → **APIs & Services** → **OAuth consent screen**
2. Select **External** → **Create**
3. Fill in:
   - App name: `PKR Reloaded`
   - User support email: your email
   - Developer contact information: your email
4. Click **Save and Continue**
5. On the next two screens (Scopes, Test Users) → just click **Save and Continue** each time
6. Click **Back to Dashboard**

**4c. Create credentials**

1. Left menu → **Credentials**
2. **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `PKR Reloaded Web`
5. Under **Authorized redirect URIs** → **+ ADD URI** → paste:
   ```
   http://localhost:8787/auth/callback
   ```
6. Click **Create**

A popup shows your **Client ID** and **Client Secret**.

⚠️ **Copy both right now and paste them into a notes app.** You cannot get the Client Secret back easily.
- Client ID looks like: `123456789-abc.apps.googleusercontent.com`
- Client Secret looks like: `GOCSPX-xxxxxxxxxxxxxxxx`

---

## STEP 5 — Set up Cloudflare (backend)

Everything in this step runs in the **Codespaces terminal**.

**5a. Install Wrangler**

```bash
npm install -g wrangler
```

**5b. Log in to Cloudflare**

```bash
wrangler login
```

A URL will appear in the terminal. Hold **Ctrl** (or **Cmd** on Mac) and click it — or copy and paste it into a new tab. Click **Allow** on the Cloudflare page. Come back to Codespaces.

**5c. Go to the worker folder**

```bash
cd worker
```

**5d. Create the database**

```bash
wrangler d1 create pkr-reloaded-db
```

The output includes a block like:
```
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy that ID value. Now open `wrangler.toml` in the editor — click on `worker` in the sidebar, then click `wrangler.toml`. Find:
```
database_id = "REPLACE_WITH_YOUR_D1_ID"
```
Replace `REPLACE_WITH_YOUR_D1_ID` with your ID. Press **Ctrl+S** to save.

**5e. Create the session store**

```bash
wrangler kv:namespace create "KV"
```

Output includes an `id` value. Copy it.

In `wrangler.toml`, find:
```
id = "REPLACE_WITH_YOUR_KV_ID"
```
Replace it. Save with **Ctrl+S**.

**5f. Add your Google Client ID**

In `wrangler.toml`, find:
```
GOOGLE_CLIENT_ID = "REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
```
Replace the whole value with your real Client ID from Step 4c. Example:
```
GOOGLE_CLIENT_ID = "123456789-abc.apps.googleusercontent.com"
```
Save. Leave `FRONTEND_URL` alone for now.

**5g. Generate push notification keys**

```bash
npx web-push generate-vapid-keys
```

Save the Public Key and Private Key in your notes.

**5h. Install dependencies**

```bash
npm install
```

**5i. Create the database tables**

```bash
npm run db:migrate
```

Should show a success message.

**5j. Set your secrets**

Run each command. When Terminal says `Enter a secret value:` paste the value and press Enter.

```bash
wrangler secret put GOOGLE_CLIENT_SECRET
```
→ Paste your Google Client Secret from Step 4c

```bash
wrangler secret put JWT_SECRET
```
→ Go to https://www.uuidgenerator.net/version4 in a new tab, copy the UUID, remove all dashes, go back and generate another one, paste both together. Use that as your secret. Example: `550e8400e29b41d4a716446655440000a716446655440000`

```bash
wrangler secret put VAPID_PUBLIC_KEY
```
→ Paste the Public Key from Step 5g

```bash
wrangler secret put VAPID_PRIVATE_KEY
```
→ Paste the Private Key from Step 5g

```bash
wrangler secret put VAPID_EMAIL
```
→ Type your email address

**5k. Deploy the worker**

```bash
wrangler deploy
```

You'll see:
```
✅ Deployed to: https://pkr-reloaded-worker.YOUR_NAME.workers.dev
```

Save that full URL. You need it next.

---

## STEP 6 — Set up Vercel (frontend)

**6a. Import your project**

1. Go to https://vercel.com and sign in
2. Click **Add New** → **Project**
3. Find `pkr-reloaded` → click **Import**
   - If you don't see it, click **Adjust GitHub App Permissions** and grant access
4. ⚠️ Under **Root Directory** → click **Edit** → type `frontend` → confirm. This step is critical.
5. Under **Environment Variables**, add:
   - Name: `NEXT_PUBLIC_API_URL`
   - Value: your worker URL from Step 5k (e.g. `https://pkr-reloaded-worker.YOUR_NAME.workers.dev`)
6. Click **Deploy**

Wait 1–2 minutes. You'll get a URL like `https://pkr-reloaded.vercel.app`.

Save that URL.

**6b. Tell the worker where the frontend is**

Back in Codespaces terminal (make sure you're still in the `worker` folder — type `pwd` to check, if it doesn't show `/workspaces/pkr-reloaded/worker` then run `cd /workspaces/pkr-reloaded/worker`):

Open `wrangler.toml` in the editor. Find:
```
FRONTEND_URL = "https://REPLACE_WITH_YOUR_VERCEL_URL.vercel.app"
```
Replace with your actual Vercel URL, no trailing slash:
```
FRONTEND_URL = "https://pkr-reloaded.vercel.app"
```
Save. Then redeploy:

```bash
wrangler deploy
```

**6c. Add production callback URL to Google**

1. Go to https://console.cloud.google.com
2. Left menu → **APIs & Services** → **Credentials**
3. Click on **PKR Reloaded Web**
4. Under **Authorized redirect URIs** → **+ ADD URI** → add:
   ```
   https://pkr-reloaded-worker.YOUR_NAME.workers.dev/auth/callback
   ```
   (Use your actual worker subdomain)
5. Click **Save**

---

## STEP 7 — Save your config and finish

Push the updated config files to GitHub from the Codespaces terminal:

```bash
cd /workspaces/pkr-reloaded
git add .
git commit -m "Add production config"
git push
```

Vercel will automatically redeploy in about 1 minute when it sees the push.

---

## STEP 8 — Test everything

Go through this checklist:

- [ ] Go to your Vercel URL — PKR Reloaded landing page loads
- [ ] Click **SIGN IN WITH GOOGLE** — Google sign-in page appears
- [ ] Sign in — you land on the Dashboard
- [ ] Click **+ NEW TABLE** — create a table, it appears in the list
- [ ] Open the table → **+ SCHEDULE GAME** → set a date and time → **SCHEDULE + NOTIFY**
- [ ] Click the game → add 2 players with cashout amounts → **SETTLE THIS GAME**
- [ ] Results and transfer breakdown appear
- [ ] Click the **Leaderboard** tab — player stats show up

If all checked — you're live. 🎉

---

## Sharing the app

- Send players your Vercel URL — they don't need an account
- To add a co-host: inside a table → **INVITE CO-HOST** → share the link (expires in 48 hours)
- Only you (the host) needs to sign in with Google

---

## Keeping Codespaces alive

Codespaces automatically stops after 30 minutes of inactivity. Your files are saved, but if you close the tab and come back later:

1. Go to https://github.com/codespaces
2. Find your `pkr-reloaded` codespace
3. Click the **...** menu → **Open in browser**

Everything will be exactly where you left it.

Free GitHub accounts get **120 hours/month** of Codespaces — more than enough for setup and occasional updates.

---

## If something goes wrong

| Symptom | Fix |
|---|---|
| "redirect_uri_mismatch" on Google sign-in | The redirect URI in Google Console doesn't exactly match your worker URL — recheck Step 6c |
| "Unauthorized" after signing in | `FRONTEND_URL` in wrangler.toml is wrong — fix it and run `wrangler deploy` again |
| Vercel build fails | Make sure Root Directory is set to `frontend` in Vercel project settings |
| `wrangler login` URL doesn't open | Copy the URL from the terminal and paste it into a new tab manually |
| Codespaces terminal disappears | Press Ctrl+` (backtick) to bring it back |
| Can't find wrangler.toml | Make sure you're in the `worker` folder: run `cd /workspaces/pkr-reloaded/worker` |
| Database error on first load | Run `npm run db:migrate` from inside the `worker` folder |
| Push notifications not arriving | Check all 5 `wrangler secret put` commands ran without error |

---

## Cost — everything is free

| Service | Free tier |
|---|---|
| GitHub Codespaces | 120 hours/month free |
| Cloudflare Workers | 100,000 requests/day |
| Cloudflare D1 | 5M row reads/day |
| Cloudflare KV | 100,000 reads/day |
| Vercel | Unlimited hobby deploys |
| Google OAuth | Free |

A private poker group will never come close to any limit.
