# Redrob ATS

In-house, customizable Applicant Tracking System, built module by module against the
In-House Customizable ATS PRD (benchmarked against Zoho Recruit, Ceipal, and Zimyo).

See [`docs/architecture.md`](docs/architecture.md) for system design, [`docs/database.md`](docs/database.md)
for the data model, [`docs/api.md`](docs/api.md) for the full API reference, and
[`docs/project-status.md`](docs/project-status.md) for what's built vs. remaining against the PRD.

## Stack

Next.js 15 (App Router) · TypeScript · TailwindCSS v4 · shadcn/ui (hand-vendored components,
see "Note on shadcn/ui" below) · Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL · Auth.js v5
(Credentials + JWT) · React Hook Form · Zod · ExcelJS (candidate import/export) · `@dnd-kit/core`
(pipeline board drag-and-drop) · Vitest · Playwright (end-to-end smoke passes)

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

### Module 4 — Applications / Candidate Pipeline (PRD §11.4)

- **Applications**: `Application` links one `Candidate` to one `Job`, holding the pipeline
  stage the candidate is currently in, an owner, an outcome, and its own custom fields.
  Re-applying a candidate to the same job is allowed (no unique constraint on
  `(candidateId, jobId)`) — only warned about, never blocked (see "Duplicate warnings" below).
- **Pipeline stage configuration**: each job has its own ordered set of `PipelineStage` rows
  (not a global enum, not a Controlled List — different jobs run different pipelines). New jobs
  get four starter stages (`Applied`, `Screening`, `Interview`, `Offer`) automatically; an admin
  or recruiter can add, rename, reorder, deactivate, and reactivate stages afterward from the
  job's Pipeline page. A stage is **never hard-deleted** — "removing" it deactivates it, and a
  deactivated stage's applications keep pointing at it undisturbed. A stage's name is unique only
  among currently-active stages, so a deactivated stage's name can be reused by a new one.
- **Board view**: a Kanban-style view of a job's pipeline, one column per active stage, cards
  showing the candidate and current owner.
- **Drag-and-drop**: dragging a card to another column moves that application's stage, with an
  optimistic UI update that reverts the card (and only that card) if the request fails — e.g. a
  stale-version conflict from a concurrent edit.
- **List view**: the same per-job application set as a filterable, sortable table, sharing one
  dataset with the board via a tab switch — no separate fetch.
- **Bulk actions**: select multiple applications (from either the per-job list or the global
  Applications list) and move stage, reject, withdraw, or queue an email for all of them in one
  request. Each target is applied independently — one stale or invalid row doesn't fail the rest
  of the batch; the response reports which succeeded and which failed, and why.
- **Duplicate warnings**: creating an application for a candidate/job pair that already has one
  or more prior applications shows a non-blocking warning listing them — the PRD's stated
  behavior (§11.4) is "warn," not "block."
- **Application ownership**: a dedicated `ownerId` field, defaulting to the job's primary
  recruiter at creation but independently reassignable afterward from the application's detail
  page — mirrors `Job.primaryRecruiterId` rather than introducing a new ownership shape.
- **Application outcomes**: `Rejected` and `Withdrawn` are terminal outcomes, orthogonal to
  stage (an application can be rejected from any stage, and its stage stays frozen at whatever
  it was). Once an outcome leaves `Active`, no further stage move or outcome change is accepted.
  Both require a reason from the `REJECTION_REASON` Controlled List.
- **Timeline integration**: a candidate's timeline (Module 3) now includes application
  activity — creation, stage changes, rejection, and withdrawal — alongside notes, using the
  same extensible `{ type, ... }` item contract Module 3 built for exactly this.
- **Bulk email (queued only)**: bulk email renders a subject/body template (with
  `{{candidate.name}}`/`{{job.title}}` placeholders) and logs one `ApplicationEmailLog` row per
  recipient with status `Pending` — this module never calls a real mail provider. Real delivery
  is deferred to the future Communication Hub module.
- **Audit logging**: every create, update, stage change, rejection, withdrawal, bulk action,
  and pipeline-stage edit is logged to the shared audit log.

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
- Eight Controlled Lists, all seeded with starter values: `REJECTION_REASON`,
  `CANDIDATE_SOURCE`, `DOCUMENT_TYPE`, `LOCATION`, `DEPARTMENT`, `JOB_HOLD_REASON`,
  `JOB_CLOSE_REASON`, `JOB_CANCEL_REASON`.
- Job permission grants for Recruiter, Hiring Manager, and Recruiting Manager; Candidate
  permission grants for Recruiter only (`CREATE`/`READ` at `ALL`, `UPDATE`/`DELETE` at `OWN` —
  Hiring Manager and HR / Onboarding get no default Candidate access); Application permission
  grants for Recruiter (`CREATE`/`READ` at `ALL`, `UPDATE` at `OWN`), Hiring Manager (`READ` at
  `ALL`), and Recruiting Manager (`CREATE` at `ALL`, `READ`/`UPDATE` at `TEAM`) — see
  `prisma/seed.ts` for the exact `(resource, action, scope)` grants, and
  [`docs/architecture.md`](docs/architecture.md#rbac) for how grants are structured and
  enforced.
- A directory-read grant (`USER:READ` at `ALL` scope) for Recruiter, Hiring Manager, and
  Recruiting Manager, so a Recruiter can see a colleague list to assign as job recruiters or
  reassign an application's owner without full user-administration access.
- One System Administrator user from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (skipped with a
  warning if either is unset).
- `prisma/backfill-pipeline-stages.ts` is a separate, one-time script (not run by `db seed`) that
  seeds the default four-stage pipeline onto any job created before Module 4 — new jobs get this
  automatically at creation time. Run it once per environment after deploying the Module 4
  migration: `npx tsx prisma/backfill-pipeline-stages.ts`. Idempotent — skips jobs that already
  have at least one stage.

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
