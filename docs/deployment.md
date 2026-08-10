# Deployment (Vercel)

Tracks the Vercel deployment prerequisites from the pre-deployment audit. This covers only what's
been implemented — see [Known gaps not covered here](#known-gaps-not-covered-here) for what's
deliberately deferred to a later pass.

## What's implemented

- **`postinstall: prisma generate`** (`package.json`) — Vercel runs `npm install` before `next
  build`; without this, the build fails outright because dozens of files import types from the
  gitignored `src/generated/prisma` output. Needs no `DATABASE_URL` at build time (it reads
  `prisma/schema.prisma`, not the database), so it's safe to run on every Preview build too.
- **`engines.node: "22.x"`** (`package.json`) — pins the Vercel Node.js runtime to match the
  environment this app is actually tested against.
- **`GET /api/scheduler/run`**, alongside the existing `POST` — Vercel Cron Jobs only ever send a
  GET request and can't be configured to send POST or a custom header name, so the endpoint now
  accepts both. See `docs/api.md`'s Scheduler section for the full provider comparison.
- **`vercel.json`** — a `crons` entry hitting `GET /api/scheduler/run` every 15 minutes. Adjust the
  schedule to your plan (Vercel's Hobby tier only allows once-per-day cron; Pro allows arbitrary
  frequency) and to how timely you need interview reminders/scheduled reports/TIME_IN_STAGE
  workflow triggers to fire.
- **`CRON_SECRET` accepted as a second valid scheduler secret**, alongside the existing
  `SCHEDULER_SECRET` (`src/lib/scheduler/auth.ts`) — Vercel's Cron feature sets `CRON_SECRET`
  itself and sends it verbatim as the bearer token; there's no way to make it use a different
  variable name, so the app has to recognize Vercel's name specifically. Every non-Vercel
  scheduler in `docs/api.md`'s table keeps using `SCHEDULER_SECRET`, unchanged.

## Keeping Preview deployments off the production database

No code change was needed for this — it falls out of two facts, both worth stating explicitly so
they don't get accidentally undone later:

1. **Vercel Cron Jobs only ever trigger against the Production deployment**, never against
   Preview deployments. The scheduler is the only thing in this app that runs without a human in
   the loop, so as long as that stays true, a Preview deployment never runs scheduled work at all.
2. **This pass does not wire `prisma migrate deploy` (or any other DB-mutating step) into the
   build.** `postinstall` only runs `prisma generate`, which never opens a database connection.
   Nothing in the build or deploy path touches `DATABASE_URL`'s target.

The remaining, unavoidably manual requirement: **set a distinct `DATABASE_URL` per Vercel
Environment** (Project Settings → Environment Variables → scope each value to Production /
Preview / Development). Vercel supports this natively; there's nothing in this repo that can
enforce it from the outside. Until real environment separation is set up, treat Preview
deployments as pointed at a non-production database by policy.

## Environment variables

| Variable | Scope | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Per environment | Must differ between Production and Preview — see above. |
| `AUTH_SECRET` | All environments | NextAuth v5's secret. Generate with `npx auth secret` or `openssl rand -base64 33`. |
| `APP_URL` | Per environment | Used to build password-reset links; set to the real deployed URL, not `localhost`. |
| `SCHEDULER_SECRET` | Production (+ any environment using a non-Vercel scheduler) | For POST-based callers (see `docs/api.md`). |
| `CRON_SECRET` | Production only | Set by convention to match what you configure in Vercel's Cron UI/`vercel.json`; Vercel does not set this for you automatically — you still create it as a project environment variable. |

`MAIL_PROVIDER`, `STORAGE_PROVIDER`, `HRIS_PROVIDER`, `JOB_BOARD_PROVIDER` are unchanged by this
pass — see [Known gaps](#known-gaps-not-covered-here).

## Known gaps not covered here

These were identified in the pre-deployment audit and are explicitly out of scope for this pass:

- **No real email delivery.** `MAIL_PROVIDER` defaults to `"console"` (logs only). A real
  provider is a separate, later effort.
- **No real document storage.** `StorageProvider`'s only implementation writes to local disk,
  which does not work on Vercel's read-only/ephemeral filesystem. Candidate document
  upload/download will fail or silently lose data until a real backend (S3/R2/Vercel Blob) is
  built.
- **No automated `prisma migrate deploy` step.** Migrations against the production database are
  a manual step (`DATABASE_URL=<production-url> npx prisma migrate deploy`) run outside the
  Vercel build, on purpose — see the note above about why the build stays DB-connection-free.
- **Postgres connection pooling under serverless concurrency** has not been addressed. If the
  target Postgres provider doesn't already sit behind a connection pooler (Neon/Supabase's pooled
  connection string, RDS Proxy, PgBouncer), high concurrent traffic can exhaust the database's
  connection limit. Worth revisiting before real production load.
