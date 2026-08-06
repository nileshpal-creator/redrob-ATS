# Changelog

## Module 2 — Requisition / Job Management (PRD §11.1)

### Added

- `Job` entity: title, department, location, employment type, priority, status, positions
  count, target date, description, structured must-have/good-to-have criteria lists, custom
  fields, optional parent requisition link, primary recruiter, creator, and an internal
  optimistic-locking `version` counter.
- `JobRecruiterAssignment`: many-to-many recruiter assignment with exactly one primary
  recruiter per job, enforced by a hand-written partial unique index at the database level.
- `JobStatusChange`: an immutable audit trail of every status transition, with actor, reason
  (where required), and an optional note.
- New enums: `JobStatus` (`DRAFT`, `PENDING_APPROVAL`, `OPEN`, `ON_HOLD`, `CLOSED`,
  `CANCELLED`), `EmploymentType`, `JobPriority`. `APPROVE` added to `PermissionAction`, as its
  own permission distinct from `UPDATE`.
- A table-driven job status/approval state machine (`src/lib/jobs/status-machine.ts`) —
  declarative transitions with per-transition permission and reason requirements, designed as
  the seam a future configurable workflow builder can read or extend rather than replace.
- `JobService` (`src/lib/services/jobs.ts`): list (scope-filtered), detail read, available-
  transitions lookup, create, update (optimistic locking), recruiter reassignment, and status
  transitions — all business logic and permission checks in one place, behind thin API routes.
- Six new API routes: `GET/POST /api/jobs`, `GET/PATCH /api/jobs/[id]`,
  `PUT /api/jobs/[id]/recruiters`, `POST /api/jobs/[id]/status`.
- A new, ungated `GET /api/controlled-lists/[key]` route/service, so any authenticated user can
  populate a dropdown (department, location, hold/close/cancel reason) without a
  Controlled-List-administration permission.
- Seed data: `DEPARTMENT` and `LOCATION` Controlled Lists with starter values;
  `JOB_HOLD_REASON`, `JOB_CLOSE_REASON`, `JOB_CANCEL_REASON` lists (values added via the admin
  UI as needed); Job permission grants for Recruiter, Hiring Manager, and Recruiting Manager;
  a `USER:READ` (`ALL` scope) directory grant for the same three roles so they can pick
  recruiters for a job.
- `JOB` registered as a `CUSTOM_FIELD_CAPABLE_ENTITY`, so admins can add custom fields to job
  requisitions with no code change.
- Frontend: `/jobs` list with filters and search, `/jobs/new` and `/jobs/[id]/edit` forms,
  `/jobs/[id]` detail page with permission-gated status-action buttons and a recruiter editor;
  a reusable tag-input component for criteria lists and a recruiter picker component; the Jobs
  nav item, shown only to viewers with `JOB:READ`.
- Automated tests: `JobService` (creation, updates with version conflicts, recruiter
  reassignment, status transitions, OWN/TEAM/ALL scope enforcement), the status machine's
  transition table, and the Job Zod validation schemas.
- `getApplicableActions` (`src/lib/authz/resource-actions.ts`), mapping each resource to the
  `PermissionAction`s that apply to it (`JOB` → CRUD + `APPROVE`) — written for, but not yet
  wired into, the role-permission matrix UI.
- `getEffectiveScope` (`src/lib/authz/authorize.ts`), resolving the broadest scope a caller
  holds for a `(resource, action)` pair independent of any one record, for use by list-endpoint
  query filtering.
- Four new audit action strings: `job.created`, `job.updated`, `job.status_changed`,
  `job.recruiters_updated`.

### Changed

- `src/middleware.ts`'s route matcher now excludes the entire `/api` prefix instead of only
  `/api/auth` — see **Fixed** below.

### Fixed

- **Unauthenticated API requests returning a 307 HTML redirect instead of a 401 JSON body.**
  Root cause: the middleware matcher only excluded `/api/auth`, so every other `/api/*` route
  hit the page-oriented `authorized` redirect-to-`/login` callback before `withApiHandler`'s
  own 401 logic ever ran — affecting every API route since Module 1, not just Job. Fixed by
  excluding the whole `/api` prefix from the matcher; verified page routes still redirect
  correctly and API routes now return proper 401 JSON. Found and fixed during Phase 5 testing.

### Removed (PRD-alignment refinement)

Introduced during Phase 2/3 based on earlier suggestions, then removed before Phase 4 once
reviewed against the PRD's §11.1 requirements — the PRD names only assigned recruiter(s), a
human-readable code was never required (the API accepts and returns Prisma's generated `id`),
and no compensation fields are in scope for Job:

- `Job.code` / `Job.sequenceNumber` (human-readable requisition number).
- `Job.hiringManagerId` and the corresponding `hiringManager` relation.
- `Job.salaryMin`, `salaryMax`, `salaryVisible`, `currency`.
- The `approverOnly` ownership branch in the status-transition authorization logic, replaced by
  resolving all Job ownership — including `APPROVE`/`REJECT` — against
  `primaryRecruiterId`.

`Job.version` (optimistic locking) was evaluated under the same review and **kept**: it has no
user-facing surface and is standard read-modify-write safety, not a business feature.

---

## Module 1 — Foundation, Auth & RBAC, Customization Engine

Initial release: email/password authentication, admin-defined roles with
`(resource, action, scope)` permissions enforced server-side, field-level permission rules,
the Custom Field/Custom Object customization engine, controlled lists, a searchable audit log,
and the admin settings UI. See [docs/architecture.md](docs/architecture.md) for details.
