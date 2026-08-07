# Changelog

## Module 3 — Candidate Database (PRD §11.2)

### Added

- `Candidate` entity: name, phone (unique — the hard duplicate key), email (soft duplicate
  signal), location, current/expected compensation, notice period, earliest availability,
  total experience, skills/tags, structured experience and education history, a Controlled
  List source, custom fields, a required GDPR-aligned consent timestamp (`consentGivenAt`),
  and an internal optimistic-locking `version` counter.
- `CandidateDocument`: uploaded files (resume, cover letter, etc.) attached to a candidate,
  with type (Controlled List), size (≤10MB), and MIME-type validation (`application/pdf`,
  `application/msword`, `.docx`, `image/png`, `image/jpeg`).
- `CandidateNote`: an immutable, create-only timeline note per candidate.
- **Duplicate detection**: phone is a database-level unique constraint — creation/update onto
  an in-use phone is rejected with `409` (`DuplicateCandidateError`, carrying the existing
  candidate's id). Email is a secondary signal only, surfaced as `possibleDuplicateOf` on
  create, never blocking. `GET /api/candidates/duplicates` runs both checks ahead of time.
- **Merge**: `POST /api/candidates/[id]/merge` folds a duplicate into a target candidate —
  filling only the target's empty fields, unioning skills/tags, reassigning the source's
  documents and notes to the target, then deleting the source. Requires `CANDIDATE:UPDATE` on
  the target and `CANDIDATE:DELETE` on the source.
- **Timeline**: `GET /api/candidates/[id]/timeline`, an extensible `{ items: [{ type, ... }]
  }` read model — today fed only by notes, designed for future modules (Application,
  Interview, Offer, Communication Hub) to add their own item types without a contract change.
- **Document management**: upload (`POST .../documents`), download (`GET
  .../documents/[documentId]`), and delete (`DELETE .../documents/[documentId]`) endpoints.
- **Storage abstraction**: `StorageProvider` interface (`src/lib/storage/provider.ts`) with a
  `LocalStorageProvider` implementation (development-only, filesystem-backed) selected via the
  new `STORAGE_PROVIDER` env var (default `"local"`) and rooted at `LOCAL_STORAGE_ROOT`
  (default `./storage/candidate-documents`, gitignored, created automatically on first upload).
- **Bulk import**: a stateless two-phase pipeline — `POST /api/candidates/import/preview`
  parses a CSV or XLSX file and validates every row without writing anything (`valid`/
  `invalid`/`duplicate` per row, never fabricating `consentGivenAt`); `POST
  /api/candidates/import/commit` re-validates and re-checks duplicates server-side before
  creating, reporting any row skipped as a duplicate rather than aborting the whole commit.
- **Export**: `GET /api/candidates/export` streams the caller's visible candidates as CSV or
  XLSX, reusing `CANDIDATE:READ` and the list endpoint's scope filtering rather than a
  separate export permission; always audit-logged (`candidate.exported`, format + row count).
- `CandidateService` (`src/lib/services/candidates.ts`), `candidate-import.ts`, and
  `candidate-export.ts`: all Candidate business logic and permission checks, behind thin API
  routes — `GET/POST /api/candidates`, `GET/PATCH/DELETE /api/candidates/[id]`, `GET
  /api/candidates/duplicates`, `POST /api/candidates/[id]/merge`, `POST/GET/DELETE
  /api/candidates/[id]/documents[/...]`, `GET /api/candidates/[id]/timeline`, `POST
  /api/candidates/[id]/notes`, `POST /api/candidates/import/preview`, `POST
  /api/candidates/import/commit`, `GET /api/candidates/export`.
- `CANDIDATE` registered as a `CUSTOM_FIELD_CAPABLE_ENTITY`, reusing the existing
  `buildCustomFieldValueSchema` engine unchanged.
- Eight new audit action strings: `candidate.created`, `candidate.updated`,
  `candidate.deleted`, `candidate.merged`, `candidate.document_added`,
  `candidate.document_deleted`, `candidate.note_added`, `candidate.exported`.
- Seed data: Candidate permission grants for Recruiter only (`CREATE`/`READ` at `ALL` scope,
  `UPDATE`/`DELETE` at `OWN` scope) — Hiring Manager and HR / Onboarding get no default
  Candidate access, since the PRD does not name either role as needing it in this module's
  scope.
- `ExcelJS` added as a dependency for XLSX parsing (import) and generation (export).
- Frontend: `/candidates` list with filters/search, `/candidates/new` and
  `/candidates/[id]/edit` forms (with experience/education history editors and a live
  duplicate check), `/candidates/[id]` detail page with documents, timeline, notes, and a merge
  dialog, and an `/candidates/import` wizard; the Candidates nav item, shown only to viewers
  with `CANDIDATE:READ`.
- Automated tests: `CandidateService` (creation, duplicate detection, updates with version
  conflicts, delete with document cleanup, merge, documents, timeline, notes, import,
  OWN/TEAM/ALL scope enforcement — 54 tests) and the Candidate Zod validation schemas (30
  tests), bringing the project's automated test count from 55 to 139.

### Fixed

Found during Phase 5 testing:

- **Import preview missed intra-file duplicate phones.** `previewCandidateImport` only checked
  duplicates against the database, so two rows in the *same* file sharing a phone both showed
  `"valid"`, even though committing would only ever create the first. Fixed by tracking
  phones already seen earlier in the same preview pass; a repeat is now marked `"invalid"`
  naming the row it collides with.
- **Malformed JSON request bodies returned `500` instead of `400`, app-wide.**
  `await request.json()` throws a native `SyntaxError` on malformed JSON, which no error
  branch caught. Fixed centrally in `withApiHandler`'s error mapping
  (`src/lib/api/handlers.ts`) — a systemic fix benefiting every JSON-body route in the app
  (Job, Role, User, Custom Field, Custom Object, Candidate), not just Candidate's.
- **Malformed or absent multipart bodies returned `500` instead of `400`.**
  `await request.formData()` throws a native `TypeError` on a non-multipart body. Fixed at the
  two file-upload routes (`POST /api/candidates/[id]/documents`,
  `POST /api/candidates/import/preview`) by converting the native error into a
  `ValidationError` (`400`) — handled per-route rather than centrally, since `TypeError` is too
  broad a native type to safely catch app-wide.

---

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
