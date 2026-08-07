# Redrob ATS

In-house, customizable Applicant Tracking System, built module by module against the
In-House Customizable ATS PRD (benchmarked against Zoho Recruit, Ceipal, and Zimyo).

See [`docs/architecture.md`](docs/architecture.md) for system design, [`docs/database.md`](docs/database.md)
for the data model, [`docs/api.md`](docs/api.md) for the full API reference, and
[`docs/project-status.md`](docs/project-status.md) for what's built vs. remaining against the PRD.

## Stack

Next.js 15 (App Router) · TypeScript · TailwindCSS v4 · shadcn/ui (hand-vendored components,
see "Note on shadcn/ui" below) · Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL · Auth.js v5
(Credentials + JWT) · React Hook Form · Zod · ExcelJS (candidate import/export) · Vitest

## Current features

### Module 1 — Foundation, Auth & RBAC, Customization Engine

- **Auth**: email/password login (Auth.js v5, JWT sessions), edge-safe middleware route
  protection (`src/middleware.ts` + `src/lib/auth/auth.config.ts`).
- **RBAC**: admin-defined roles, not a fixed list. Grants are `(resource, action, scope)` —
  action is `CREATE` / `READ` / `UPDATE` / `DELETE` / `APPROVE`, scope is `OWN` / `TEAM` / `ALL`.
  Enforced server-side on every request via `src/lib/authz/authorize.ts`, never only hidden in
  the UI. Exactly one seeded "System Administrator" role bypasses checks (`Role.isSuperAdmin`)
  so a misconfigured permission set can never lock every admin out.
- **Field-level permissions**: `FieldPermission` restricts individual fields per role
  (`src/lib/authz/authorize.ts#getFieldAccess`), independent of entity-level grants.
- **Customization engine**: `CustomFieldDefinition` (text/number/date/dropdown/multi-select/
  lookup fields on any registered entity) and `CustomObjectDefinition` (admin-defined entities
  with no dedicated table — records are JSON rows, not runtime `CREATE TABLE`). See
  `src/lib/entity-registry.ts` for how modules plug their entities into this engine.
- **Admin settings**: users, roles & permission matrix, custom fields/objects, and a searchable
  audit log, all under `/admin/*`.

### Module 2 — Requisition / Job Management (PRD §11.1)

- **Job requisitions**: title, department, location, employment type, priority, positions
  count, target date, description, and structured must-have / good-to-have criteria lists.
  Department and location are Controlled List values, not free text.
- **Approval workflow**: a fixed status state machine — `DRAFT → PENDING_APPROVAL → OPEN`, plus
  `ON_HOLD`, `CLOSED`, `CANCELLED` — driven by a table of legal transitions
  (`src/lib/jobs/status-machine.ts`), not scattered conditionals. Hold, close, and cancel each
  require a reason from a dedicated Controlled List.
- **Recruiter assignment**: one or more recruiters per job with exactly one designated primary
  recruiter, enforced by a partial unique index at the database level.
- **Ownership-aware permissions**: a distinct `APPROVE` permission action (not overloaded onto
  `UPDATE`) so roles like Hiring Manager or Recruiting Manager can approve jobs without being
  the assigned recruiter. All Job actions resolve OWN/TEAM ownership against the job's primary
  recruiter.
- **Parent/child requisitions**: a job may optionally link to a parent requisition (e.g. one
  need splitting into multiple roles), with no additional validation beyond the link itself.
- **Optimistic locking**: every update requires the caller's last-seen `version`; a stale
  write is rejected with `409 Conflict` instead of silently overwriting a concurrent change.
- **No hard delete**: normal workflows only move a job through statuses (including
  `CANCELLED`); there is no delete endpoint in this module.
- **Audit trail**: every create, update, recruiter change, and status transition is logged to
  the shared audit log, along with a dedicated `JobStatusChange` history per job.
- **Custom fields on Jobs**: `Job` is registered in the Customization Engine
  (`CUSTOM_FIELD_CAPABLE_ENTITIES`), so admins can add custom fields to job requisitions with no
  code change.

### Module 3 — Candidate Database (PRD §11.2)

- **Candidate records**: name, phone (unique, the PRD's stated hard key), email, location,
  compensation (current/expected), notice period, earliest availability, total experience,
  skills/tags, structured experience and education history, a Controlled List source, custom
  fields, and a required GDPR-aligned consent timestamp (`consentGivenAt`) captured at creation.
- **Duplicate detection**: phone is a hard database-level unique constraint — creating or
  updating a candidate onto a phone already in use is rejected (`409`) with the existing
  candidate's id, so the caller can offer merge/link instead of a blind create. Email is a
  secondary signal only — it never blocks; a match is surfaced as `possibleDuplicateOf` on the
  create response. `GET /api/candidates/duplicates` runs the same check ahead of time for the
  create/import forms.
- **Merge**: `POST /api/candidates/[id]/merge` folds a duplicate into the target candidate —
  filling only the target's empty fields from the source (never overwriting populated data),
  unioning skills/tags, reassigning the source's documents and notes to the target, then
  deleting the source.
- **Document storage**: upload/download/delete resumes, cover letters, and other files per
  candidate (PDF, Word, PNG, JPEG, up to 10MB), behind a swappable `StorageProvider` abstraction
  — see "Document storage" below.
- **Timeline & notes**: a per-candidate activity feed (`GET /api/candidates/[id]/timeline`),
  fed today by create-only Notes (`POST /api/candidates/[id]/notes`) and built with an
  extensible `{ type, ... }` item contract so future modules (Application, Interview, Offer,
  Communication Hub) can add their own event types without changing the contract.
- **Bulk import**: a stateless two-phase preview/commit flow
  (`POST /api/candidates/import/preview`, `POST /api/candidates/import/commit`) for CSV and
  XLSX files — see "Import" below.
- **Export**: `GET /api/candidates/export` streams the caller's visible candidates as CSV or
  XLSX, reusing the same `CANDIDATE:READ` permission and scope filtering as the list endpoint
  (no separate export permission), always audit-logged.
- **Ownership-aware permissions**: §9's Candidate has no "assigned recruiter" concept (unlike
  Job), so `OWN`/`TEAM` scope resolves against `Candidate.createdById` — whoever created the
  record — instead.
- **Custom fields on Candidates**: `CANDIDATE` is registered in the Customization Engine
  (`CUSTOM_FIELD_CAPABLE_ENTITIES`), so admins can add custom fields to candidate records with
  no code change.

#### Import

`POST /api/candidates/import/preview` accepts a CSV or XLSX file (case-insensitive columns:
`name`, `phone`, `email`, `location`, `currentCompensation`, `expectedCompensation`,
`noticePeriodDays`, `earliestAvailability`, `totalExperienceYears`, `skills`, `tags`,
`sourceId`, `consentGivenAt`) and validates every row without writing anything, marking each
`valid`, `invalid` (with reasons), or `duplicate` (an existing candidate's phone). It never
fabricates `consentGivenAt` — a row with no real consent timestamp fails validation, since no
candidate's consent may be invented on their behalf. It also catches two rows in the *same*
file sharing a phone, marking the second `invalid` rather than letting both preview as `valid`.
`POST /api/candidates/import/commit` takes the corrected `valid` rows back and re-validates and
re-checks duplicates server-side — it never trusts the client-side preview — creating what it
can and reporting anything skipped (e.g. a duplicate created by a concurrent request).

#### Document storage

Candidate documents are written through a `StorageProvider` interface
(`src/lib/storage/provider.ts`) so business logic never talks to a filesystem or bucket
directly. The only implementation today, `LocalStorageProvider`, is **development-only**: it
writes to a local directory (default `./storage/candidate-documents`, configurable via
`LOCAL_STORAGE_ROOT`), which is created automatically on first upload and is gitignored — no
manual setup step is required. `STORAGE_PROVIDER` selects the implementation (only `"local"` is
implemented; any other value throws at first use) so a future S3/blob-storage provider is a new
file behind the same interface, not a change to any service code.

## Local development

```bash
cp .env.example .env        # then fill in AUTH_SECRET: npx auth secret
docker compose up -d        # starts Postgres
npx prisma migrate dev      # applies the schema
npx prisma db seed          # seeds default roles, controlled lists, and an admin user
npm run dev
```

Sign in at `http://localhost:3000/login` with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
from your `.env`.

### Environment variables

| Variable | Purpose | Local default (`.env.example`) |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credentials for the local Postgres container (`docker-compose.yml`) | `ats` / `ats` / `ats` |
| `POSTGRES_PORT` | Host port Postgres is published on | `5432` |
| `DATABASE_URL` | Prisma connection string | `postgresql://ats:ats@localhost:5432/ats?schema=public` |
| `AUTH_SECRET` | Auth.js JWT signing secret — generate with `npx auth secret`, never commit a real value | *(empty — required)* |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Bootstraps the one System Administrator account when `prisma/seed.ts` runs | `admin@example.com` / `ChangeMe123!` |
| `STORAGE_PROVIDER` | Selects the candidate-document `StorageProvider` implementation. Only `"local"` is implemented today. | `local` (code-level default; not set in `.env.example`) |
| `LOCAL_STORAGE_ROOT` | Filesystem root `LocalStorageProvider` writes candidate documents under. Created automatically on first upload; gitignored — never committed. | `./storage/candidate-documents` (code-level default; not set in `.env.example`) |

**Default admin credentials are for local development only.** `prisma/seed.ts` warns and skips
creating the admin account if these are unset — never leave the defaults in a shared or
deployed environment.

### Running the project

```bash
npm run dev      # start the Next.js dev server (http://localhost:3000)
npm run build    # production build
npm run start    # run a production build
npm run lint      # ESLint
```

Don't run `npm run build` while `npm run dev` is running against the same checkout — both
write to `.next` and will corrupt each other's build output. Stop one before starting the
other.

### Running migrations

```bash
npx prisma migrate dev      # create + apply a new migration during development
npx prisma migrate deploy   # apply existing migrations only (CI / production)
npx prisma generate         # regenerate the Prisma Client after a schema change
```

### Seed data

```bash
npx prisma db seed
```

`prisma/seed.ts` is idempotent (upserts) and seeds:

- The `Organization` singleton (id `"default"`), timezone and working hours/days.
- Six system roles: System Administrator (`isSuperAdmin`), Recruiter, Hiring Manager,
  Interviewer, Recruiting Manager, HR / Onboarding.
- Eight Controlled Lists: `REJECTION_REASON`, `CANDIDATE_SOURCE`, `DOCUMENT_TYPE`, `LOCATION`,
  `DEPARTMENT`, `JOB_HOLD_REASON`, `JOB_CLOSE_REASON`, `JOB_CANCEL_REASON` — with starter values
  for `CANDIDATE_SOURCE`, `DOCUMENT_TYPE`, `LOCATION`, and `DEPARTMENT`.
- Job permission grants for Recruiter, Hiring Manager, and Recruiting Manager, and Candidate
  permission grants for Recruiter only (`CREATE`/`READ` at `ALL`, `UPDATE`/`DELETE` at `OWN` —
  Hiring Manager and HR / Onboarding get no default Candidate access) — see `prisma/seed.ts` for
  the exact `(resource, action, scope)` grants, and
  [`docs/architecture.md`](docs/architecture.md#rbac) for how grants are structured and
  enforced.
- A directory-read grant (`USER:READ` at `ALL` scope) for the same three roles, so a Recruiter
  can see a colleague list to assign as job recruiters without full user-administration access.
- One System Administrator user from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (skipped with a
  warning if either is unset).

### Running tests

Tests run against a **dedicated `ats_test` Postgres database — never the dev database**. Create
it once (the container already exists from `docker compose up -d`):

```bash
docker compose exec postgres createdb -U ats ats_test
```

Then:

```bash
npm run test         # runs the full Vitest suite once
npm run test:watch   # watch mode
```

`tests/setup/global-setup.ts` runs `prisma migrate deploy` against `ats_test` before the suite
starts, so migrations are always applied and the dev database is never touched.

## Note on shadcn/ui

The `shadcn` CLI registry (`ui.shadcn.com`) is not reachable from this environment, so the
components under `src/components/ui/` were hand-authored in the same shape the CLI generates
(same file layout, same Radix primitives, same `cn()` convention). `components.json` is in
place — if registry access is available elsewhere, `npx shadcn add <component>` will work
normally and stay consistent with what's already here.

## Project structure

See [`docs/architecture.md#folder-structure`](docs/architecture.md#folder-structure) for the
full annotated tree.
