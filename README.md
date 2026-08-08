# Redrob ATS

In-house, customizable Applicant Tracking System, built module by module against the
In-House Customizable ATS PRD (benchmarked against Zoho Recruit, Ceipal, and Zimyo).

See [`docs/architecture.md`](docs/architecture.md) for system design, [`docs/database.md`](docs/database.md)
for the data model, [`docs/api.md`](docs/api.md) for the full API reference, and
[`docs/project-status.md`](docs/project-status.md) for what's built vs. remaining against the PRD.

## Stack

Next.js 15 (App Router) · TypeScript · TailwindCSS v4 · shadcn/ui (hand-vendored components,
see "Note on shadcn/ui" below) · Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL · Auth.js v5
(Credentials + JWT) · React Hook Form · Zod · ExcelJS (candidate/report export) · `pdf-lib`
(report PDF export) · `@dnd-kit/core` (pipeline board drag-and-drop) · Vitest · Playwright
(end-to-end smoke passes)

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
- **Bulk email**: originally queued-only infrastructure; Module 8 (Communication Hub) completed
  the wire — bulk email now picks an admin-managed `CommunicationTemplate`, renders it (with
  `{{candidate.name}}`/`{{job.title}}` placeholders), actually sends it, and logs one
  `ApplicationEmailLog` row per recipient as `Sent` or `Failed`. See Module 8 below.
- **Audit logging**: every create, update, stage change, rejection, withdrawal, bulk action,
  and pipeline-stage edit is logged to the shared audit log.

### Module 7 — Onboarding Handoff / HRIS Integration (PRD §11.7)

- **Automatic creation**: a `HandoffRecord` is created only as a side effect of an `Offer`
  reaching `Accepted` — there is no dedicated create endpoint.
- **Frozen package snapshot**: the candidate profile, final offer terms, and the candidate's
  full document manifest are captured once, at creation, into `HandoffRecord.payload` — never
  re-read live afterward, so what HR received stays stable even if the candidate record changes.
- **HRIS delivery abstraction**: `src/lib/hris/` mirrors the candidate-document
  `StorageProvider` shape — an interface, one real implementation
  (`StructuredExportProvider`), and an env-driven factory (`HRIS_PROVIDER`). No real HRIS API
  connector exists yet; `API_PUSH` is a recognized delivery method nothing writes today.
- **Delivery, retry, and exceptions**: delivery is attempted immediately on creation and logged
  as an append-only `HandoffDeliveryAttempt` row. A failed attempt lands the handoff in
  `Exception` with the failure reason; retrying re-pushes the *original frozen payload*, not a
  fresh read of the candidate.
- **Acknowledgement**: HR/Onboarding confirms a delivered package as `Accepted` or reports an
  `Exception` with a reason — reusing the existing `APPROVE` permission action rather than
  adding a new one.
- **Read-only archive**: once acknowledged `Accepted`, the linked Application can no longer be
  rejected/withdrawn/re-staged and can't collect a new interview or offer — enforced by one
  shared helper called from Application, Interview, and Offer's own services, not a new field
  on `Application`.
- **Timeline integration**: the candidate timeline gains `handoff_initiated`/
  `handoff_delivered`/`handoff_accepted`/`handoff_exception` item types.
- **Audit logging**: handoff creation and every status change (delivery outcome, retry,
  acknowledgement) is logged to the shared audit log.

### Module 8 — Communication Hub (PRD §11.10)

- **Template-driven email**: an admin-managed `CommunicationTemplate` (name, subject, body with
  `{{candidate.name}}`/`{{job.title}}` placeholders) replaces the free-typed subject/body
  Module 4's bulk-email dialog originally had — recruiters pick a template rather than composing
  one each time.
- **Mail delivery abstraction**: `src/lib/mail/` mirrors the `StorageProvider`/`HrisProvider`
  shape — an interface, one real implementation (`ConsoleMailProvider`), and an env-driven
  factory (`MAIL_PROVIDER`). No real Gmail/Outlook API connector exists yet — that needs OAuth
  credentials outside this environment's scope.
- **Actual delivery**: bulk email now renders the picked template per recipient, sends it, and
  writes the resulting `ApplicationEmailLog` row as `Sent` or `Failed` directly — no more
  permanently-`Pending` rows.
- **Admin template management**: `/admin/communication-templates` — create, edit
  subject/body, and activate/deactivate (no hard delete, same convention as pipeline stages).
  Reading the list is open to any authenticated user (recruiters need it to populate the
  bulk-email picker); only an admin can create or edit.
- **Timeline integration**: the candidate timeline gains `email_sent`/`email_failed` item types,
  completing §11.2's "every application, interview, offer, note and email in one view"
  requirement.
- **Audit logging**: template creation/updates and every bulk-email request are logged to the
  shared audit log.

### Module 9 — Reporting & Analytics (PRD §11.12)

- **Four pre-built reports**: pipeline funnel & conversion (per job, with recruiter/source/date
  filters), time-to-fill & time-to-offer (business days, per job/department), recruiter
  productivity & workload, and offer/TAT compliance — all computed on demand at `/reports`, no
  materialized/cached tables.
- **Reports reuse each entity's own permission**: no new blanket `REPORT` resource — a report
  is gated by `JOB:READ` or `OFFER:READ` (whichever entity it's about) and scoped by the
  viewer's own OWN/TEAM/ALL grant, exactly like every list endpoint already works. This is what
  gives §10.5's "row-level security" requirement for free.
- **Business-day TAT math**: `src/lib/reporting/business-days.ts` is the first real consumer of
  `Organization.workingDays`/`Holiday` (seeded in Module 1, unused until now) — offer TAT is
  measured `Offer.createdAt` → the approved `OfferApproval.decidedAt`, in business days, not
  calendar days.
- **Saved, shareable reports (§10.5)**: `SavedReport` lets a viewer name and save one of the
  four pre-built report types with its filters — deliberately *not* a generic drag-and-drop
  dashboard builder over arbitrary entities/custom fields, the same scope cut Module 8 made for
  the Template Designer. Running a saved report always re-applies the *runner's own* permission
  scope, not a fixed row-set baked in at save time.
- **Scheduled email delivery**: a `SavedReport` can be scheduled `DAILY`/`WEEKLY` with
  recipient emails and an export format. No cron/queue infrastructure exists in this app — the
  actual periodic trigger is external (an OS cron or a hosting platform's scheduled function
  hitting `POST /api/saved-reports/run-due`); the business logic itself
  (`runDueScheduledReports`) is real.
- **Export to Excel/CSV/PDF**: `GET /api/reports/export` reuses the ExcelJS/CSV pattern from
  candidate export, plus a minimal `pdf-lib`-based renderer (a plain text table, not a full
  layout engine) — added as this module's one new dependency.
- **Admin metadata vs. business record**: unlike `CommunicationTemplate` (open read for
  everyone), `SavedReport` is business-record tier — `OWN`/`TEAM`/`ALL` scope on `createdById`,
  optimistic-locking `version`, and a real seeded `SAVED_REPORT` permission grant — since
  scheduling emails to arbitrary recipients is a meaningfully more sensitive capability than
  reading a template.

### Module 10 — Workflow & Automation Builder (PRD §10.2)

- **Trigger → conditions → actions**: an admin-configurable `WorkflowDefinition` fires when an
  application enters a specific pipeline stage, a custom field changes, an application has sat
  in a stage for N days, or a new application is submitted — optionally gated by AND-only
  conditions on `Application.customFields` (the PRD's own phrasing is "when X **and** Y" — no
  OR/grouping) — then runs one or more actions: send a templated email, create a task, change a
  custom field, reassign the owner, or route a decision to an approver.
- **Full version history + rollback**: every save of trigger/conditions/actions creates a new
  `WorkflowDefinitionVersion` row and re-points `WorkflowDefinition.activeVersionId` at it —
  history is never mutated or deleted, so rolling back is just re-pointing that pointer at an
  older, still-existing version. Plain metadata edits (name, active/inactive) don't create a new
  version.
- **Business-record tier, not admin-metadata**: unlike `CommunicationTemplate`,
  `WorkflowDefinition` has real side-effect risk (it can send email, reassign ownership, or
  create approval-gated tasks with no further human review) — so it gets `OWN`/`TEAM`/`ALL`
  scope on `createdById`, optimistic-locking `version`, and "deactivate, don't delete" (a
  `WorkflowTask.sourceVersionId` can still reference an old version).
- **Idempotent by construction**: a `WorkflowExecution` ledger row is claimed via a unique
  `(version, applicationId, fingerprint)` constraint before any action runs — the same database-
  constraint-as-guard pattern `createOffer`/`createCommunicationTemplate` already use — so the
  same occurrence of a trigger (one stage change, one field update, one time-in-stage window)
  can never fire an automation twice, even under concurrent evaluation.
- **Tasks and approvals**: `CREATE_TASK`/`REQUEST_APPROVAL` both produce a `WorkflowTask` row,
  visible on the owning Application's detail page and on the new `/tasks` ("My Tasks") page —
  essential since an automation-created task would otherwise only be discoverable by whoever
  happens to open that exact application. A task is actionable by whoever manages the
  application *or* by its assignee directly, regardless of the assignee's own broader
  permissions (a Hiring Manager with no `APPLICATION:UPDATE` grant can still act on a task
  routed to them).
- **No cron/queue infrastructure** (same limitation Module 9's scheduled reports already
  documents): the time-in-stage trigger's real evaluation logic is `runDueTimeInStageWorkflows`,
  exposed at `POST /api/workflows/run-due` for an external scheduler to call periodically.
- **Timeline integration**: the candidate timeline gains `task_created`/`task_completed`/
  `task_approved`/`task_rejected` item types.

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
| `DATABASE_URL` | Prisma connection string, used by the app and by `prisma migrate`/`generate` | `postgresql://ats:ats@localhost:5432/ats?schema=public` |
| `TEST_DATABASE_URL` | Connection string for the dedicated test database — `vitest.config.mts` reads this and overrides `DATABASE_URL` with it for every test worker, so tests never touch the dev database. See [Running tests](#running-tests). | `postgresql://ats:ats@localhost:5432/ats_test?schema=public` |
| `AUTH_SECRET` | Auth.js JWT signing secret — generate with `npx auth secret`, never commit a real value | *(empty — required)* |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Bootstraps the one System Administrator account when `prisma/seed.ts` runs | `admin@example.com` / `ChangeMe123!` |
| `STORAGE_PROVIDER` | Selects the candidate-document `StorageProvider` implementation. Only `"local"` is implemented today. | `local` (code-level default; not set in `.env.example`) |
| `LOCAL_STORAGE_ROOT` | Filesystem root `LocalStorageProvider` writes candidate documents under. Created automatically on first upload; gitignored — never committed. | `./storage/candidate-documents` (code-level default; not set in `.env.example`) |
| `HRIS_PROVIDER` | Selects the onboarding-handoff `HrisProvider` implementation. Only `"structured_export"` is implemented today. | `structured_export` (code-level default; not set in `.env.example`) |
| `MAIL_PROVIDER` | Selects the bulk-email `MailProvider` implementation. Only `"console"` is implemented today. | `console` (code-level default; not set in `.env.example`) |

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

Tests run against a **dedicated `ats_test` Postgres database — never the dev database**,
pointed to by `TEST_DATABASE_URL` in `.env` (see [Environment variables](#environment-variables)).
Create the database once (the container already exists from `docker compose up -d`):

```bash
docker compose exec postgres createdb -U ats ats_test
```

Then:

```bash
npm run test         # runs the full Vitest suite once
npm run test:watch   # watch mode
```

`vitest.config.mts` reads `TEST_DATABASE_URL` and overrides `DATABASE_URL` with it for every
test worker — `tests/setup/test-database-url.ts` is the single source of truth both it and
`global-setup.ts` (which runs `prisma migrate deploy` against `ats_test` before the suite
starts) read from, so the two can never drift out of sync. If `TEST_DATABASE_URL` is unset,
Vitest fails immediately with a clear error rather than silently falling back to the dev
database or a stale credential.

## Note on shadcn/ui

The `shadcn` CLI registry (`ui.shadcn.com`) is not reachable from this environment, so the
components under `src/components/ui/` were hand-authored in the same shape the CLI generates
(same file layout, same Radix primitives, same `cn()` convention). `components.json` is in
place — if registry access is available elsewhere, `npx shadcn add <component>` will work
normally and stay consistent with what's already here.

## Project structure

See [`docs/architecture.md#folder-structure`](docs/architecture.md#folder-structure) for the
full annotated tree.
