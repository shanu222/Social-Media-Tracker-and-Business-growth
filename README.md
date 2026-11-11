# Growth Desk — Social Media Product Management & Business Growth

A private web app where the company owner manages every product's social media, and the
Social Media Manager sees exactly what to post, posts it, and reports back.

## Task management

1. The Admin creates a task on a product (or asks **AI** to draft some from the product's data).
2. The Admin assigns it to any team member — they automatically get access to that product.
3. The task appears in that person's **My work** and they receive an **email** with the task, product,
   description, priority, due date and an **Open task** button.
4. Reminders go out automatically: 2 days and 1 day before the deadline, on the day, and when overdue
   (day 1, then every 3 days). Tasks not started after 3 days get a nudge. Admins get a daily summary email.
5. The person updates the **% complete**, adds comments and links, or presses **Ask admin for clarification** (emails the admin).
6. On **Mark completed** the Admin is notified in the app and by email. Changes to deadline, priority or
   instructions email the assignee and are written into the task history.
7. Every file and link stays in the product's **Library** permanently — even after the task is done.

| Who | Sees |
|---|---|
| Admin | **Tasks** dashboard: not started / in progress / overdue / completed / drafts, team progress table (open, overdue, average completion, on-time %), filters by product and person |
| Team member | **My work**: Overdue, New, Due in 7 days, In progress, Not started, Completed — or grouped by product |

Task fields: type (social post / general), title, description, product, assignee, priority, start date, due date,
instructions & notes, caption & hashtags & platforms (post tasks), links (Google Drive, YouTube, reels…), uploads,
status and percentage complete.

### AI task assistant
**Suggest with AI** on a product reads its details, account numbers and trends, open and completed tasks, recent
posts and library, then returns a short situation summary, the **gaps** it found and draft tasks with description,
action plan, caption, platforms, priority, start and due dates and the reason for each. Drafts are invisible to the
team until the Admin reviews, edits, assigns and presses **Assign & send** (or deletes them). "Follow-ups to completed
work" mode suggests next steps after finished tasks. Passwords, tokens and login emails are never sent to the AI.

### Content library
Upload images, videos, reels and documents, or paste a link (Google Drive, Dropbox, YouTube, Instagram, Canva…).
Each entry records name, product, date, who shared it, type, the link and the related task. Files up to 20 MB pass
through the API; larger ones (up to 5 GB) upload **directly** to Cloudflare R2 with a one-hour signed link.

## Product workspaces (one page per product)

| Tab | What's there |
|---|---|
| **Overview** | Product details & image, all its social accounts with live follower counts, what's waiting, posts in 30 days, recent activity |
| **Content to post** | Admin shares a caption, hashtags, media, instructions, target platforms, priority, deadline and assignee. Manager copies the caption in one click, starts the task and marks it posted with the link for each platform |
| **Published** | Every post that went live (including ones the manager made independently) with date, platform, account and link |
| **Chat** | Product-only conversation between Admin and manager; messages can reference a specific task |
| **Files** | Brand assets and media for this product (private Cloudflare R2) |
| **Activity** | Full history: content shared, started, posted, files, edits — who and when |

**Manager dashboard ("My work")**: assigned products, unread chats, and everything to post grouped as
Overdue / Due today / Next 3 days / Later. **Notifications** (bell) for new content, chat messages,
posted content, new files and daily deadline reminders.

### Roles

| | Admin (owner) | Social media manager | Viewer |
|---|---|---|---|
| Products, accounts, content tasks | create / edit / delete | sees **assigned products only**; starts & completes tasks, records posts | read |
| Chat, files, published log | full | on assigned products | read |
| Daily numbers & checklist | ✓ | ✓ | read |
| Targets, metric definitions, checklist tasks | ✓ | read | read |
| Users, emails, passwords of others, roles | ✓ | ✗ | ✗ |
| Login emails, private notes, API tokens of accounts | ✓ | ✗ (never sent to the browser) | ✗ |
| Audit log, backups, integrations | ✓ | ✗ | ✗ |

Everyone can change **their own** password; new users and admin-reset passwords must be changed at first sign-in.

### Automatic follower counts (official APIs only)

| Platform | How | What you set |
|---|---|---|
| YouTube | YouTube Data API v3 | `YOUTUBE_API_KEY` on Railway; Channel ID (`UC…`) or `@handle` on the account |
| Telegram | Bot API `getChatMemberCount` | `TELEGRAM_BOT_TOKEN` on Railway; channel `@username` on the account (add the bot to private channels) |
| Discord | Public invite endpoint (`with_counts`) | the invite code (after `discord.gg/`) on the account |
| Instagram | Instagram Graph API (business/creator account) | IG user ID + long-lived access token on the account |
| Facebook | Graph API (Page) | Page ID + Page access token on the account |
| LinkedIn, TikTok, X… | need partner-approved apps | log numbers in **Daily update** |

Synced every 6 hours (`SYNC_CRON`) and with **Sync now**. No scraping and no password logins — nothing that risks an account ban.
Tokens are encrypted and never returned to any browser. Publishing/scheduling directly to platforms is not automated
(it needs app review from each platform); the manager publishes and records the link.

---

## Tracker features (from the original sheet)

| What you do | Where |
|---|---|
| Log each account's followers, following, posts, likes, comments, reach and DMs every day | **Daily update → Social accounts** |
| Log revenue, leads, clients, ad spend, website visitors, signups, lectures, MCQs, YouTube, Play Store testers… | **Daily update → Business numbers** |
| Tick off the 30–40 minute daily routine, plus weekly and monthly checks | **Checklist** |
| See total growth, a per-account daily "growth ribbon", trends and plain-language suggestions | **Overview** |
| Keep the account register (baseline numbers, 2FA status, encrypted login email & notes) | **Accounts** |
| Set monthly targets and see on/off track automatically | **Targets & KPIs** |
| Write best/weakest post per account, overall summary and next month's action plan | **Monthly review** |
| Generate weekly / monthly / custom reports, download PDF, export CSV | **Reports** |
| Store insights screenshots, content backups and invoices in Cloudflare R2 | **Files** |
| Manage team members & roles, change password, see activity log, run backups | **Settings** |

```
frontend/  React + Vite + TypeScript  → deploy on Vercel
backend/   Node.js + Express + PostgreSQL → deploy on Railway
           Cloudflare R2 (S3 API) for files, PDF copies and encrypted nightly backups
```

---

## Security — why the code alone gives nobody your data

* **No data in the repository.** Every account, number, file and user lives only in your Railway
  PostgreSQL database and your private R2 bucket. The repo contains code and empty defaults only.
* **All secrets are environment variables** (`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, R2 keys).
  `.env` files are git-ignored. Someone who clones the repo has nothing to connect to.
* **No public sign-up.** The first admin is created from Railway variables; after that only an admin can add people.
* **Encryption at rest:** login emails, private notes and every cloud backup are encrypted with AES-256-GCM
  using `ENCRYPTION_KEY`. Even someone with database access cannot read them without the key.
* **Passwords** are hashed with bcrypt (cost 12); 10+ characters with letters and numbers required.
* **Brute-force protection:** 20 sign-in attempts per 15 minutes per IP, and an account locks for 15 minutes after 5 wrong passwords.
* **Sessions** are signed JWTs re-checked against the database on every request — disabling a user,
  changing a password or "Sign out on all devices" takes effect immediately.
* **Roles:** Admin (everything), Manager (log data, reviews, reports, files), Viewer (read-only; cannot see encrypted fields).
* **Private R2 bucket:** files get random object keys and are only reachable through 5-minute signed links issued after sign-in.
* **Hardening:** Helmet security headers, strict CORS allow-list, rate limiting, input validation (zod) on every route,
  CSV formula-injection protection, strict CSP and `noindex` on the frontend, full audit log of sign-ins, edits and downloads.

> Keep `ENCRYPTION_KEY` in your password manager. If it is lost, encrypted fields and backups cannot be recovered.

---

## Deploy

### 1. Backend on Railway

1. Railway → **New Project → Deploy from GitHub repo** → choose this repo.
2. In the service **Settings → Root Directory**, set `backend`.
3. Add a database: **New → Database → PostgreSQL** in the same project.
4. Generate secrets on your computer:
   ```bash
   cd backend && npm install && npm run gen:secrets
   ```
5. In the backend service **Variables**, add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference to the Railway database) |
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | from `gen:secrets` |
   | `ENCRYPTION_KEY` | from `gen:secrets` (64 hex characters) |
   | `CORS_ORIGINS` | your Vercel URL, e.g. `https://growth-desk.vercel.app` (comma-separate several) |
   | `ADMIN_EMAIL` | your email |
   | `ADMIN_PASSWORD` | a strong first password (remove this variable after first sign-in) |
   | `ADMIN_NAME` | your name |
   | `APP_TIMEZONE` | `Asia/Karachi` |
   | `MANAGER_EMAIL` / `MANAGER_PASSWORD` / `MANAGER_NAME` | the Social Media Manager's first login (forced to change at first sign-in) |
   | `YOUTUBE_API_KEY` | optional — Google Cloud console → YouTube Data API v3 → API key |
   | `TELEGRAM_BOT_TOKEN` | optional — from @BotFather |

6. **Settings → Networking → Generate Domain.** Copy the URL (e.g. `https://xxx.up.railway.app`).
   Open `https://xxx.up.railway.app/health` — it should show `{"ok":true}`.

Tables are created automatically on start-up, along with the default checklist and business metrics.

### 2. Cloudflare R2 (files, report PDFs, nightly backups)

1. Cloudflare dashboard → **R2 → Create bucket** (e.g. `growth-desk`). Leave public access **off**.
2. **R2 → Manage API tokens → Create API token** with *Object Read & Write* on that bucket only.
3. Add to the Railway backend variables:
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
4. Redeploy. The Files page unlocks, every generated report keeps a PDF copy in R2,
   and an encrypted backup runs every night at 02:00 (change with `BACKUP_CRON`).

### 2b. Email, AI and large uploads

**Email (Resend, recommended):** create a free account at resend.com → **Domains** → add and verify
`sustainablesolution360.com` (add the DNS records it shows) → **API Keys** → create a key. On Railway set:
`RESEND_API_KEY`, `EMAIL_FROM="Growth Desk <tasks@sustainablesolution360.com>"` and `APP_URL` (your Vercel URL).
Then **Settings → Send a test email to me**. (SMTP via `SMTP_HOST/PORT/USER/PASS` also works on paid Railway plans.)

**AI:** create a key at console.anthropic.com and set `ANTHROPIC_API_KEY` on Railway (`AI_MODEL` optional).

**Large uploads:** in Cloudflare → R2 → your bucket → **Settings → CORS Policy → Add**, paste:
```json
[
  {
    "AllowedOrigins": ["https://YOUR-APP.vercel.app"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

### 3. Frontend on Vercel

1. Vercel → **Add New → Project** → import this repo.
2. **Root Directory:** `frontend` (framework preset Vite is detected).
3. **Environment Variables:** `VITE_API_URL` = your Railway URL (no trailing slash).
4. Deploy, then make sure that Vercel URL is listed in Railway's `CORS_ORIGINS`.
5. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, change the password in **Settings**, then delete
   `ADMIN_PASSWORD` from Railway.

### 4. First-day setup

1. **Accounts → Add account** (or **Import CSV**) for each page with today's posts / followers / following as the baseline.
   CSV headers: `Brand,Username,Platform,Posts,Followers,Following,YouTube,Login email,2FA,URL,Notes`.
2. **Settings → Team → Add person** for your marketing manager (role *Manager*).
3. **Targets & KPIs** → set this month's targets; **Edit metrics** to add your own (e.g. Fiverr orders, Upwork proposals).
4. From then on: **Daily update** + **Checklist** every day, **Monthly review** + **Reports** at month end.

---

## Run locally

```bash
# Postgres running locally, database "smt"
cd backend
cp .env.example .env          # fill JWT_SECRET / ENCRYPTION_KEY via: npm run gen:secrets
npm install && npm run dev    # http://localhost:4000

cd ../frontend
npm install && npm run dev    # http://localhost:5173 (proxies /api to the backend)
```

## API overview

All routes are under `/api` and need `Authorization: Bearer <token>` except `POST /api/auth/login`.

| Area | Routes |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`, `POST /auth/logout-all` |
| Accounts | `GET/POST /accounts`, `GET/PUT/DELETE /accounts/:id`, `POST /accounts/import` |
| Daily numbers | `GET/PUT /snapshots/day?date=`, `GET /snapshots/export.csv?start=&end=` |
| Checklist | `GET /checklist?date=`, `POST /checklist/toggle`, `POST/PUT/DELETE /checklist/tasks` |
| Business metrics | `GET/POST /metrics`, `GET/PUT /metrics/day`, `GET /metrics/month`, `PUT /metrics/targets` |
| Review | `GET /reviews?month=`, `PUT /reviews/account`, `PUT /reviews/summary`, `POST/PUT/DELETE /reviews/actions` |
| Dashboard | `GET /dashboard?days=30` |
| Reports | `GET/POST /reports`, `GET /reports/:id`, `GET /reports/:id/pdf`, `DELETE /reports/:id` |
| Files (R2) | `GET/POST /files`, `GET /files/:id/download`, `DELETE /files/:id` |
| Products | `GET/POST /products`, `GET/PUT/DELETE /products/:id`, `POST /products/:id/image`, `GET /products/:id/activity` |
| Tasks | `GET/POST /products/:id/tasks`, `GET/PUT/DELETE …/tasks/:taskId`, `POST …/send`, `PATCH …/status`, `PATCH …/progress`, `POST …/comments`, `POST …/links`, `GET /tasks/mine`, `GET /tasks/all` |
| AI | `POST /products/:id/ai/suggest` |
| Library | `GET /products/:id/library?type=&q=`, `POST/DELETE /products/:id/library/links`, `POST /files/presign`, `POST /files/complete` |
| Email | `GET /system/emails`, `POST /system/test-email`, `PATCH /auth/preferences` |
| Published posts | `GET/POST /products/:id/posts`, `DELETE /products/:id/posts/:postId` |
| Chat | `GET /products/:id/messages?after=`, `POST /products/:id/messages` |
| Notifications | `GET /notifications`, `POST /notifications/read` |
| Sync | `POST /accounts/:id/sync`, `GET /accounts/sync-support` |
| Admin | `GET/POST/PATCH /users`, `GET /users/audit`, `GET /system/status`, `GET/POST /system/backups` |
