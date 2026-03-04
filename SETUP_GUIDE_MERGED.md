# PKR Reloaded — Complete Setup Guide (Merged Edition)
## GitHub + Cloudflare + Vercel | No experience needed

---

## WHAT YOU'RE BUILDING

PKR Reloaded is your private poker group app. It includes:

| Feature | Where it lives |
|---|---|
| Google login for hosts | Cloudflare Worker |
| Game scheduling + push notifications | Cloudflare Worker + D1 database |
| RSVP links (shareable, no login) | Cloudflare Worker |
| Live scorecard links | Cloudflare Worker |
| Install links for new players | Vercel frontend |
| Circular table view with buy-ins + cashouts | Vercel frontend |
| Settlement + leaderboard | Cloudflare Worker |
| WhatsApp sharing from every screen | Vercel frontend |

**Three services, all free tier:**
- **GitHub** — stores your code
- **Cloudflare** — runs the backend (database + API)
- **Vercel** — runs the frontend (the app your players see)

---

## BEFORE YOU START — Install two tools

Open **Terminal** (Mac: press ⌘+Space, type Terminal, press Enter)
or **Command Prompt** (Windows: press Win+R, type cmd, press Enter)

Run each line and press Enter:

```
node --version
git --version
```

If you see errors:
- **Node.js missing** → go to https://nodejs.org → download **LTS** → install → restart Terminal
- **Git missing** → go to https://git-scm.com/downloads → install → restart Terminal

---

## STEP 1 — Get your code onto GitHub

**1a. Unzip the file**

Unzip `pkr-merged-v1.zip`. Move the `pkr-merged` folder to your Desktop.

**1b. Create a GitHub repo**

1. Go to https://github.com and sign in
2. Click **+** (top right) → **New repository**
3. Name: `pkr-reloaded`
4. Set to **Private**
5. Click **Create repository**
6. Leave the page open

**1c. Push your code**

In Terminal, run these one at a time (replace YOUR_USERNAME with your GitHub username):

```bash
cd ~/Desktop/pkr-merged
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pkr-reloaded.git
git push -u origin main
```

> ⚠️ If GitHub asks for a password and rejects it:
> 1. Go to https://github.com/settings/tokens
> 2. Click **Generate new token (classic)**
> 3. Tick **repo** → Generate → copy the token
> 4. Use the token as your "password" in Terminal

Refresh your GitHub repo page — you should see all the files.

---

## STEP 2 — Set up Google Login

**2a. Go to Google Cloud Console**

Go to https://console.cloud.google.com (sign in with your regular Google account)

**2b. Create a project**

1. Click the project selector at the top → **New Project**
2. Name: `PKR Reloaded` → click **Create**
3. Make sure your new project is selected in the top dropdown

**2c. Enable Google OAuth**

1. In the left menu → **APIs & Services** → **OAuth consent screen**
2. Choose **External** → click **Create**
3. Fill in:
   - App name: `PKR Reloaded`
   - User support email: your email
   - Developer contact email: your email
4. Click **Save and Continue** through all screens (you can skip optional fields)
5. On the last screen click **Back to Dashboard**

**2d. Create credentials**

1. Left menu → **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `PKR Reloaded`
5. Under **Authorized redirect URIs**, click **+ Add URI**
6. Add: `https://pkr-worker.YOUR_SUBDOMAIN.workers.dev/auth/google/callback`
   (You'll fill in your actual worker URL in a moment — for now put anything, we'll update it)
7. Click **Create**
8. **Copy and save** the **Client ID** and **Client Secret** — you'll need them soon

---

## STEP 3 — Set up Cloudflare (backend + database)

**3a. Create a Cloudflare account** (if you don't have one)

Go to https://dash.cloudflare.com/sign-up — it's free.

**3b. Install Wrangler (Cloudflare's tool)**

In Terminal:

```bash
npm install -g wrangler
```

**3c. Log in to Cloudflare**

```bash
wrangler login
```

A browser window will open — click **Allow**.

**3d. Go to your worker folder**

```bash
cd ~/Desktop/pkr-merged/worker
npm install
```

**3e. Create your database**

```bash
wrangler d1 create pkr-db
```

You'll see something like:

```
[[d1_databases]]
binding = "DB"
database_name = "pkr-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy that entire block** — you need the `database_id`.

**3f. Update wrangler.toml**

Open the file `pkr-merged/worker/wrangler.toml` in any text editor (Notepad works).

Find the `[[d1_databases]]` section and replace the `database_id` with yours:

```toml
[[d1_databases]]
binding = "DB"
database_name = "pkr-db"
database_id = "PASTE-YOUR-ID-HERE"
```

**3g. Create your KV store**

```bash
wrangler kv:namespace create pkr-kv
```

You'll see something like:

```
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Open `wrangler.toml` again. Find the `[[kv_namespaces]]` section and paste your id:

```toml
[[kv_namespaces]]
binding = "KV"
id = "PASTE-YOUR-KV-ID-HERE"
```

**3h. Run the database schema**

```bash
wrangler d1 execute pkr-db --remote --file=schema.sql
```

This creates all the tables your app needs.

**3i. Set your secrets**

Run each of these — replace with your actual values:

```bash
wrangler secret put GOOGLE_CLIENT_ID
# paste your Google Client ID and press Enter

wrangler secret put GOOGLE_CLIENT_SECRET
# paste your Google Client Secret and press Enter

wrangler secret put JWT_SECRET
# type any random string like: myRandomSecret123abc and press Enter
```

**3j. Deploy the worker**

```bash
wrangler deploy
```

You'll see a URL like:
`https://pkr-worker.YOUR_NAME.workers.dev`

**Save this URL — you need it for the next steps.**

**3k. Update your Google OAuth redirect**

Go back to https://console.cloud.google.com → **APIs & Services** → **Credentials** → click on your OAuth client.

Update the **Authorized redirect URI** to:
`https://pkr-worker.YOUR_NAME.workers.dev/auth/google/callback`

Click **Save**.

**3l. Add your frontend URL to the worker (once you have it)**

After Vercel deployment (Step 4), come back and run:

```bash
wrangler secret put FRONTEND_URL
# enter your Vercel URL e.g. https://pkr-reloaded.vercel.app
```

Then redeploy:

```bash
wrangler deploy
```

---

## STEP 4 — Deploy the frontend on Vercel

**4a. Go to Vercel**

Go to https://vercel.com and sign in with GitHub.

**4b. Import your project**

1. Click **Add New → Project**
2. Find `pkr-reloaded` in your GitHub repos → click **Import**
3. Set the **Root Directory** to `frontend`
   (click the pencil next to the root → type `frontend`)
4. Framework: Vercel should auto-detect **Next.js** ✓

**4c. Set environment variables**

Before clicking Deploy, scroll down to **Environment Variables** and add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://pkr-worker.YOUR_NAME.workers.dev` |

(Use your actual worker URL from Step 3j)

**4d. Deploy**

Click **Deploy**. Wait about 2 minutes.

You'll get a URL like: `https://pkr-reloaded.vercel.app`

**4e. Come back and update the worker**

Now go back to Terminal and run:

```bash
cd ~/Desktop/pkr-merged/worker
wrangler secret put FRONTEND_URL
# enter: https://pkr-reloaded.vercel.app (your actual Vercel URL)

wrangler deploy
```

---

## STEP 5 — Test everything

Open your Vercel URL in a browser (or on your phone).

**Test checklist:**

- [ ] Homepage loads with the PKR logo
- [ ] "Continue with Google" button works and logs you in
- [ ] Dashboard appears after login
- [ ] Create a Table (+ New Table)
- [ ] Go into the table → Schedule a game
- [ ] Copy the RSVP link and open it in a new tab — should show the lobby
- [ ] On the game page, try the Share button — should show RSVP, Live, and Install links
- [ ] Try enabling push notifications (🔕 → 🔔)

---

## STEP 6 — Install on your phone

**iPhone:**
1. Open your Vercel URL in Safari (must be Safari)
2. Tap the Share button (box with arrow)
3. Tap **Add to Home Screen**
4. Tap **Add**

**Android:**
1. Open your Vercel URL in Chrome
2. Chrome will show a banner to install — tap **Install**
3. Or: tap the 3-dot menu → **Add to Home Screen**

---

## How to share with players

**For RSVP (before a game):**
- Go to your game → tap the **◎ SHARE** button
- Copy the **RSVP Link** or tap **WhatsApp** to send it
- Players open the link, enter their name, tap ✓ Yes/✗ No — no account needed

**For new players (first time):**
- Tap **◎ SHARE** → copy the **Install Link**
- Send via WhatsApp — it lets them install PKR on their phone

**For live scores (during a game):**
- Tap **◎ SHARE** → copy the **Live Scorecard** link
- Players open it on their phone to watch their balance update in real-time

**For results (after settling):**
- Tap **◎ SHARE** → copy **Results Link** to share the final scoreboard

---

## FEATURES AT A GLANCE

### The Table (from your original app)
- ✅ RSVP links with WhatsApp sharing
- ✅ Install links for new players
- ✅ Live scorecard links (per-player)
- ✅ Push notification toggle on every game + event screen
- ✅ In-game player chips on the circular table view
- ✅ Buy-in + cashout from the table (tap any seat)
- ✅ RSVP strip shown above the table (pre-game)

### PKR Reloaded (from your new app)
- ✅ Google login (hosts only — players join via link)
- ✅ Multiple events/tables
- ✅ Full leaderboard rebuilt after every settle
- ✅ Settlement algorithm (minimum transfers)
- ✅ Game history
- ✅ Per-player live balance links with QR code
- ✅ Co-host invite links
- ✅ Unsettle + re-settle
- ✅ Known players quick-select when seating

---

## MAKING CHANGES LATER

To update your app after making changes to any files:

```bash
cd ~/Desktop/pkr-merged
git add .
git commit -m "Update"
git push
```

Vercel will automatically redeploy the frontend.

For backend changes:

```bash
cd ~/Desktop/pkr-merged/worker
wrangler deploy
```

---

## TROUBLESHOOTING

**"Error: Cannot find module" on Vercel**
→ Make sure Root Directory is set to `frontend` in Vercel project settings

**Google login gives "redirect_uri_mismatch"**
→ Your Google OAuth redirect URI doesn't match your worker URL. Double-check Step 3k.

**Push notifications not working on iPhone**
→ Make sure you've installed PKR as an app (Add to Home Screen), then notifications will work

**"Forbidden" errors when managing games**
→ Make sure you're logged in with Google and are the host of that event

**Worker deploys but frontend can't reach it**
→ Check `NEXT_PUBLIC_API_URL` in Vercel environment variables matches your worker URL exactly

---

## COSTS

Everything runs on free tiers:

| Service | Free tier |
|---|---|
| GitHub | Unlimited private repos |
| Cloudflare Workers | 100,000 requests/day |
| Cloudflare D1 | 5M rows read/day |
| Cloudflare KV | 100,000 reads/day |
| Vercel | Unlimited hobby deploys |

For a private poker group, you will never hit these limits.

---

*Questions? Check https://developers.cloudflare.com/workers/ or https://nextjs.org/docs*
