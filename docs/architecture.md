# Architecture

This document describes the system as actually implemented through Module 4, Phase 6. It is
kept in sync with the code — if something here and the code disagree, the code is correct and
this file is stale.

## Overall architecture

Redrob ATS is a single Next.js 15 (App Router) application: server-rendered pages, API routes,
and the database all live in one deployable unit. There is no separate backend service.

```
Browser
  │
  ├─ Server Components (src/app/(app)/**)  ── reads data directly via service functions
  │
  └─ Client Components ── fetch() ──▶ Route Handlers (src/app/api/**/route.ts)
                                            │
                                            ▼
                                    withApiHandler (src/lib/api/handlers.ts)
                                            │  resolves session, maps thrown errors to HTTP
                                            ▼
                                    Service layer (src/lib/services/**, src/lib/jobs/**)
                                            │  all business logic + permission checks live here
                                            ▼
                                    Prisma Client ──▶ PostgreSQL
```

Key rules the codebase follows throughout:

- **Route handlers are thin.** Every file under `src/app/api/**/route.ts` does exactly three
  things: parse the request with a Zod schema, call one service function, return its result.
  No business logic, no direct Prisma calls, in a route handler.
- **Permission checks live in the service layer, not the route layer**, so the same
  authorization guarantee holds whether a service function is called from an API route or
  (in the future) a server action.
- **Enforcement is server-side.** UI components hide controls a user can't use as a courtesy;
  every service function that mutates or reads protected data re-checks the permission itself.
  A hidden button is not a security boundary anywhere in this codebase.
- **Cross-cutting registries over per-module migrations.** Resources (`RolePermission.resource`,
  `CustomFieldDefinition.entityType`, `AuditLog.entityType`, `AuditLog.action`) are plain
  strings validated against small TypeScript registries
  (`src/lib/entity-registry.ts`, `src/lib/audit/actions.ts`), not database enums. A new module
  adds an entry to a registry file, not a migration to a shared table.

## Module 1 — Foundation, Auth & RBAC, Customization Engine

### Auth

Auth.js v5 with the Credentials provider and JWT sessions. Two configs exist deliberately:

- `src/lib/auth/auth.config.ts` — edge-safe (no Prisma, no bcrypt), used by middleware.
- `src/auth.ts` — the full config, including the Credentials provider's `authorize()` callback
  (which does need Prisma + bcrypt), used everywhere else (route handlers, server components).

`src/middleware.ts` builds its own `NextAuth(authConfig)` instance from the edge-safe config —
middleware runs on the Edge runtime, which cannot load Prisma or bcrypt, so it cannot import
`src/auth.ts` directly. Its `matcher` excludes the entire `/api` prefix
(`/((?!api|_next/static|_next/image|favicon.ico).*)`), not just `/api/auth`: every API route
resolves its own session via `withApiHandler` and returns a proper `401` JSON body when
unauthenticated, so letting middleware's page-oriented redirect-to-`/login` logic run first
would turn an unauthenticated `fetch()` into an unparseable `307` redirect instead. Page routes
still redirect to `/login` correctly; API routes return JSON.

### RBAC

Permissions are **admin-defined roles**, not a fixed list. A grant is a
`(resource, action, scope)` triple:

- `resource` — a string key (`"JOB"`, `"USER"`, ...), validated against
  `src/lib/entity-registry.ts`.
- `action` — `PermissionAction` enum: `CREATE`, `READ`, `UPDATE`, `DELETE`, `APPROVE`.
- `scope` — `PermissionScope` enum: `OWN`, `TEAM`, or `ALL`.

`src/lib/authz/authorize.ts` is the single enforcement point:

- `can(context, resource, action, { ownerId? })` — the core check. Returns `true` immediately
  if the caller's role has `Role.isSuperAdmin`. Otherwise looks up the caller's role grants for
  `(resource, action)`: an `ALL` grant always passes; an `OWN` grant passes only if
  `ownerId === context.userId`; a `TEAM` grant passes if `ownerId` is the caller or one of their
  direct reports (`getTeamMemberIds`, walking `User.managerId`).
- `requirePermission(...)` — same check, throws `ForbiddenError` (→ `403`) instead of returning
  `false`. Used by mutating service functions.
- `getEffectiveScope(context, resource, action)` — returns the broadest scope
  (`"ALL" | "TEAM" | "OWN" | null`) the caller holds for `(resource, action)`, independent of
  any one record. `can()` answers "is this one row visible?"; a list endpoint needs "what
  `WHERE` clause should this query use?" before it has rows to check — that's what this
  answers. Added in Module 2 for `listJobs`.
- `getFieldAccess(context, resource)` — resolves per-field visibility (`FieldPermission`,
  `HIDDEN` / `READ` / `WRITE`) for the caller's roles. Fields with no explicit row default to
  `READ` — a permission set opts a role *into* restricting a field, not into seeing it. Not yet
  consumed by the Job module (no Job fields are field-permission-gated as of Module 2).

Exactly one seeded role, System Administrator, has `isSuperAdmin = true` and bypasses every
check — guaranteeing a misconfigured permission set can never lock every admin out.

### Customization Engine

Two independent mechanisms, both admin-configurable without a code deploy:

- **Custom Fields** (`CustomFieldDefinition` + a `customFields Json` column on the owning
  entity). A definition has a `fieldType` (`TEXT`, `NUMBER`, `DATE`, `DROPDOWN`,
  `MULTI_SELECT`, `LOOKUP`), and is scoped to one `entityType`. Values are validated at write
  time by a dynamic Zod schema built from the active definitions
  (`src/lib/custom-fields/dynamic-schema.ts` → `buildCustomFieldValueSchema`), not by database
  columns or DDL. `CUSTOM_FIELD_CAPABLE_ENTITIES` in `src/lib/entity-registry.ts` lists which
  entities may carry custom fields — `JOB` as of Module 2.
- **Custom Objects** (`CustomObjectDefinition` + `CustomObjectRecord`). An admin-defined entity
  with no dedicated table: `CustomObjectRecord.data` is a JSON blob keyed by `apiKey`, and
  `CustomObjectRelation` links a record to any core entity by `(relatedEntityType,
  relatedEntityId)`.

Reading a field *definition* is intentionally not permission-gated (Module 2 change, see
below) — everyone who can reach a form needs to read the shape of that form. Creating,
updating, and deleting definitions (the schema-authoring actions) remain permission-gated.

### Folder structure

```
src/
  app/
    (app)/                    Authenticated shell
      admin/                  Admin settings: users, roles, custom-fields, audit-log
      jobs/                   Job list, /jobs/new, /jobs/[id], /jobs/[id]/edit,
                               /jobs/[id]/pipeline (board + list, Module 4)
      candidates/             Candidate list, /candidates/new, /candidates/[id],
                               /candidates/[id]/edit, /candidates/import
      applications/           Application list, /applications/new, /applications/[id]
                               (Module 4)
    api/                      Route handlers — thin, one per src/lib/services export
    login/                    Sign-in page (outside the authenticated shell)
  components/
    ui/                       Hand-vendored shadcn primitives
    layout/                   App shell, sidebar, nav
    admin/                    Admin-page-specific components
    auth/                     Login form
    authz/                    PermissionGate — UI-level hiding, not enforcement
    custom-fields/            Generic custom-field form section, reused by any entity form
    jobs/                     Job form, recruiter picker, tag input, status action controls,
                               job-pipeline-client.tsx + pipeline-stage-editor.tsx (Module 4)
    candidates/               Candidate form, duplicate check, documents, timeline, notes,
                               merge dialog, import wizard, experience/education editors
    applications/             Application form, candidate picker, duplicate check, owner
                               editor, transition actions, bulk action toolbar, pipeline
                               board (the one file importing @dnd-kit/core) (Module 4)
  config/
    nav.ts                    Nav item definitions, gated per-item by permission
  lib/
    auth/                     auth.config.ts (edge-safe) vs. src/auth.ts (full config)
    authz/                    session-context, authorize()/can()/getFieldAccess(), guard helpers
    audit/                    actions.ts (audit action registry) + log.ts (recordAudit)
    custom-fields/            dynamic Zod schema builder for admin-defined fields
    jobs/                     status-machine.ts — the Job status transition table
    storage/                  StorageProvider interface + LocalStorageProvider + factory
    templates/                render.ts — minimal {{key}} substitution for bulk email (Module 4)
    services/                 permission-checked business logic; one file per resource —
                               includes applications.ts and pipeline-stages.ts (Module 4)
    validations/              Zod schemas, shared by API routes and client forms
    api/                      withApiHandler — the one place mapping domain errors to HTTP codes
    entity-registry.ts        Resource/entity key registry for RBAC + custom fields + audit
    errors.ts                 Domain error classes (ValidationError, NotFoundError, ConflictError)
  generated/prisma/           Generated Prisma Client (gitignored, `npx prisma generate`)
  middleware.ts                Edge-safe route protection
prisma/
  schema.prisma               Data model
  seed.ts                     Default roles, controlled lists, permission grants, admin user
  migrations/                 One directory per migration, applied in order
  backfill-pipeline-stages.ts One-time script seeding default stages onto pre-Module-4 jobs
storage/                      Local candidate-document storage root (gitignored, dev-only)
tests/
  services/, validations/     Vitest suites against the dedicated ats_test database
  setup/global-setup.ts       Runs `prisma migrate deploy` against ats_test before the suite
docs/                          This document, database.md, api.md, project-status.md
```

## Module 2 — Requisition / Job Management (PRD §11.1)

Module 2 adds one core entity, `Job`, plus two supporting tables, and layers on the existing
Module 1 primitives rather than introducing new ones:

- **RBAC**: reuses `(resource, action, scope)` with `resource = "JOB"`. Adds no new scope or
  action *type* to the enum beyond `APPROVE`, which Phase 1 required as a distinct action from
  `UPDATE` (see [Job workflow](#job-workflow) below).
- **Customization Engine**: `JOB` is added to `CUSTOM_FIELD_CAPABLE_ENTITIES` — no new engine
  code was needed.
- **Controlled Lists**: department, location, and the hold/close/cancel reasons are all
  `ControlledListValue` rows, reusing the Module 1 `ControlledList` primitive rather than adding
  bespoke lookup tables.
- **Audit log**: Job actions log through the same `recordAudit` helper and `AuditLog` table,
  with four new action strings added to the registry (`job.created`, `job.updated`,
  `job.status_changed`, `job.recruiters_updated`).

New pieces specific to Module 2:

- `src/lib/jobs/status-machine.ts` — the approval/status workflow (below).
- `src/lib/services/jobs.ts` — all Job business logic: listing with scope-filtered queries,
  detail reads, create, update (with optimistic locking), recruiter reassignment, and status
  transitions.
- `src/lib/services/controlled-lists.ts` — a read-only, ungated service
  (`getControlledListValues(key)`) so any authenticated user can populate a dropdown (e.g.
  Department) without needing a Controlled-List-administration permission.
- `src/lib/authz/resource-actions.ts` — `getApplicableActions(resource)`, returning which
  `PermissionAction`s make sense for a given resource (`JOB` → `CREATE/READ/UPDATE/DELETE/
  APPROVE`; everything else defaults to the four CRUD actions). Written for the role-permission
  matrix UI to grey out inapplicable action cells — **not yet wired into that UI**, which still
  renders the four Module 1 CRUD columns unconditionally. See
  [Known limitations](project-status.md#known-limitations).

### Job workflow

The approval workflow is a **simple, fixed state machine** (Phase 1 decision: a configurable
workflow builder is out of scope for Module 2 and belongs to the PRD's Workflow & Automation
Builder, §10.2, a later module). It is table-driven, not a chain of `if` statements, so that a
future workflow-builder module can read or extend the same table instead of every module
reimplementing its own transition logic:

```
DRAFT ──SUBMIT──▶ PENDING_APPROVAL ──APPROVE──▶ OPEN ──HOLD──▶ ON_HOLD
  │                      │                       │                │
  │                      │ REJECT (→ DRAFT)      │ CLOSE           │ RESUME (→ OPEN)
  │                      │                       ▼                │ CLOSE
  │                      │                     CLOSED ◀────────────┘
  │                      │
  └──CANCEL──▶ CANCELLED ◀──CANCEL── (from PENDING_APPROVAL or OPEN or ON_HOLD)
```

Each row in `JOB_TRANSITIONS` (`src/lib/jobs/status-machine.ts`) declares:

- `action` — one of `SUBMIT`, `APPROVE`, `REJECT`, `HOLD`, `RESUME`, `CLOSE`, `CANCEL`.
- `from` / `to` — the `JobStatus` values the transition connects.
- `requiredAction` — the `PermissionAction` the caller must hold to perform it. `APPROVE` and
  `REJECT` require `APPROVE`; every other transition requires `UPDATE`.
- `reasonRequired` / `reasonListKey` — whether the transition needs a reason from a specific
  Controlled List. `HOLD`, `CLOSE`, and `CANCEL` all require one (`JOB_HOLD_REASON`,
  `JOB_CLOSE_REASON`, `JOB_CANCEL_REASON` respectively); `SUBMIT`, `APPROVE`, `REJECT`, and
  `RESUME` do not.

`CLOSED` and `CANCELLED` are terminal — no row in the table has either as a `from` state.
`findTransition(from, action)` looks up the single matching row (or `undefined`, which the
service turns into a `400 Cannot <action> a job in <status> status.`); `getLegalActions(from)`
returns every transition available from a status, used by `getAvailableTransitions` to compute
which action buttons a job's detail page should render for the current viewer.

**Ownership.** Every Job action — including `APPROVE`/`REJECT` — resolves `OWN`/`TEAM` ownership
against `Job.primaryRecruiterId`. The PRD's Job data model names only assigned recruiter(s), not
a separate approver field, so introducing a `hiringManagerId` column to hold an approver would
have expanded the data model beyond the PRD (see the PRD-alignment refinement in
[project-status.md](project-status.md#known-limitations)). Roles that need to approve jobs they
are not personally assigned to (Hiring Manager, Recruiting Manager) instead hold the `APPROVE`
grant at `ALL` or `TEAM` scope in `prisma/seed.ts` — ownership resolution stays uniform, and
which roles can approve without being the assignee is a permission-configuration decision, not a
schema one.

**Optimistic locking.** `Job.version` increments on every successful update, recruiter change,
or status transition. Each of those three mutations is a single
`prisma.job.updateMany({ where: { id, version: <caller's version> }, data: { ..., version: {
increment: 1 } } })`; if another request already advanced the version, `updateMany` matches zero
rows and the service throws `ConflictError` → `409`. This is purely an internal implementation
detail — there is no user-facing "revision history" feature, only the standard
read-modify-write safety it provides.

**Recruiter assignment.** `JobRecruiterAssignment` is a join table (`jobId`, `userId`,
`isPrimary`) with a hand-written partial unique index,
`job_recruiter_one_primary ON "JobRecruiterAssignment"("jobId") WHERE "isPrimary" = true`
(Prisma's schema syntax cannot express a partial index, so this migration's SQL was written by
hand). `updateJobRecruiters` replaces the entire assignment set transactionally: it deletes all
existing rows for the job and recreates them from the request, inside the same transaction as
the `Job.primaryRecruiterId`/`version` update, so a client always PUTs the full desired list
rather than diffing individual add/remove operations.

The [folder structure tree](#folder-structure) under Module 1 already reflects Module 2's
additions (`src/lib/jobs/`, `src/components/jobs/`, `src/app/(app)/jobs/`,
`src/app/api/jobs/**`).

## Module 3 — Candidate Database (PRD §11.2)

Module 3 adds one core entity, `Candidate`, plus two supporting tables
(`CandidateDocument`, `CandidateNote`), and — like Module 2 — layers on the existing Module 1
primitives:

- **RBAC**: reuses `(resource, action, scope)` with `resource = "CANDIDATE"`. No new
  `PermissionAction` was needed.
- **Customization Engine**: `CANDIDATE` is added to `CUSTOM_FIELD_CAPABLE_ENTITIES` — no new
  engine code, same `buildCustomFieldValueSchema` path Job already used.
- **Controlled Lists**: `CANDIDATE_SOURCE` and `DOCUMENT_TYPE` are `ControlledListValue` rows
  (both seeded with starter values since Module 1, reused here for the first time), the same
  primitive Module 2 used for department/location.
- **Audit log**: Candidate actions log through `recordAudit`/`AuditLog`, with eight new action
  strings (`candidate.created`, `candidate.updated`, `candidate.deleted`, `candidate.merged`,
  `candidate.document_added`, `candidate.document_deleted`, `candidate.note_added`,
  `candidate.exported`).

New pieces specific to Module 3:

- `src/lib/services/candidates.ts` — all core Candidate business logic: scope-filtered listing,
  detail reads, duplicate pre-checks, create, update (optimistic locking), delete, merge,
  document upload/download/delete, timeline reads, and note creation.
- `src/lib/services/candidate-import.ts` — the bulk-import preview/commit pipeline.
- `src/lib/services/candidate-export.ts` — the CSV/XLSX export pipeline.
- `src/lib/storage/` — the `StorageProvider` abstraction (below).

### Candidate module architecture

Candidate follows the same layering the [overall architecture](#overall-architecture) diagram
describes for every module: thin route handlers under `src/app/api/candidates/**` parse a Zod
schema and call exactly one function in `src/lib/services/candidates.ts`,
`candidate-import.ts`, or `candidate-export.ts`; every permission check and all business logic
lives in those service files, never in a route handler or a client component. The one deviation
from a plain JSON in/out contract is the two file-serving routes (document download, export) —
they build their own `NextResponse` with a binary body and `Content-Disposition` header, and
`withApiHandler` passes a returned `NextResponse` through unwrapped instead of re-wrapping it as
JSON (see `src/lib/api/handlers.ts`).

### StorageProvider abstraction

Candidate document attachments are written through a narrow interface
(`src/lib/storage/provider.ts`):

```ts
interface StorageProvider {
  save(input: { candidateId; fileName; mimeType; buffer }): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}
```

`src/lib/services/candidates.ts` only ever calls `getStorageProvider()`
(`src/lib/storage/index.ts`) and talks to the returned `StorageProvider` — it never touches a
filesystem or bucket API directly, so a future S3/blob-storage backend is a new file
implementing this interface, not a change to any service code. Today the factory always
returns `LocalStorageProvider` (`src/lib/storage/local-provider.ts`), a **development-only**
implementation backed by the local filesystem: `STORAGE_PROVIDER` (default `"local"`) selects
the implementation and throws if set to anything else, since none is implemented yet;
`LOCAL_STORAGE_ROOT` (default `./storage/candidate-documents`) is the directory it writes
under, created automatically (`mkdir -p` semantics) on first upload and gitignored. Each saved
file's `storageKey` is `<candidateId>/<uuid>-<sanitized-filename>` — the filename is stripped to
safe characters before being used as part of a filesystem path.

### Candidate lifecycle

`Candidate` has no status/workflow field (unlike `Job`) — the PRD's §9 candidate data model
describes a flat record, not a stateful pipeline (that belongs to the future Application entity,
§11.4). The lifecycle is: create (with a required consent timestamp) → read/update any number of
times (optimistic-locked) → optionally merge into another candidate (which deletes it) or
delete outright. `deleteCandidate` also deletes every one of the candidate's stored documents
via `StorageProvider.delete()` before removing the database row, so document deletion is never
silently orphaned.

### Duplicate detection

Two independent signals, with different consequences, per the PRD's business rules (§11.2,
BR1/BR2):

- **Phone (hard)**: `Candidate.phone` is a database-level `@unique` column. `createCandidate`
  and `updateCandidate` (on a phone change) both pre-check for an existing row with that phone
  and throw `DuplicateCandidateError` (extends `ConflictError` → `409`) carrying the existing
  candidate's id, so a create/update onto a phone in use is always blocked in favor of
  merge/link — it can never silently create a second record for the same phone.
- **Email (soft)**: never blocks. `createCandidate` looks up a `findFirst` match on email and
  returns it as `possibleDuplicateOf` on the create response — a UI hint, not an enforcement
  point.
- **Pre-flight check**: `checkCandidateDuplicates` (`GET /api/candidates/duplicates`) runs both
  checks without creating anything, for the create form and import wizard to call ahead of
  submission. It uses `getEffectiveScope`, not `requirePermission` — this isn't checked against
  any one record's ownership, so a caller with a plain `OWN`-scope `READ` grant (the common
  Recruiter case) must still pass, exactly like `listCandidates`.

### Merge workflow

`mergeCandidates(context, targetId, { sourceCandidateId, version })`:

1. Rejects merging a candidate into itself, then loads both records.
2. Requires `CANDIDATE:UPDATE` on the target and `CANDIDATE:DELETE` on the source — merging
   mutates the target and permanently removes the source, so both permissions are checked.
3. Fills only the target's **empty** fields from the source (`fillIfEmpty`) — a populated target
   field is never overwritten by the source's value.
4. Unions `skills` and `tags` (deduplicated) rather than replacing either array.
5. Merges `customFields`, with the target's values taking precedence on key collisions.
6. In one transaction: applies the target update (optimistic-locked on `version`), reassigns
   every `CandidateDocument` and `CandidateNote` row from the source to the target, then deletes
   the source candidate.

The update uses `Prisma.CandidateUncheckedUpdateManyInput`, not the more common
`CandidateUpdateManyMutationInput` — the latter's generated type excludes FK scalar fields like
`sourceId`, which a fill-from-source merge needs to be able to set directly.

### Timeline architecture

`getCandidateTimeline` returns `{ items: [...] }`, where every item has at minimum a `type`
discriminant. Only one type exists today — `{ type: "note", id, body, author, createdAt }`,
sourced entirely from `CandidateNote` — but the contract is deliberately extensible: future
modules (Application, Interview, Offer, Communication Hub) can add their own item `type`s to
the same feed without changing this contract or requiring timeline consumers to change. Notes
themselves are **create-only** — §9 describes this category ("Task, Note, Activity") as an
immutable audit log, so there is no note update or delete endpoint by design.

### Import pipeline

A **stateless two-phase** design (Phase 2 decision): nothing is written until the caller
explicitly commits.

1. `previewCandidateImport` (`POST /api/candidates/import/preview`) parses an uploaded CSV
   (hand-rolled parser, handling quoted/escaped cells) or XLSX (via `ExcelJS`) file, maps
   case-insensitive columns onto `candidateCreateSchema`, and validates every row without
   writing anything. Each row comes back `valid`, `invalid` (with the Zod error messages), or
   `duplicate` (an existing candidate's id, from the hard phone-uniqueness check). It also
   tracks phones already seen earlier in the *same* file (`seenPhones`), so two rows sharing a
   phone are never both marked `valid` — the second is marked `invalid` naming the row it
   collides with, since committing would otherwise only ever create the first of the two.
   `consentGivenAt` is never fabricated: a row whose file doesn't supply a real value is left
   undefined, which `candidateCreateSchema` then rejects — no candidate's consent may be invented
   on their behalf (§13).
2. `commitCandidateImport` (`POST /api/candidates/import/commit`) takes the corrected rows back
   (typically the `valid` ones after the caller fixes any `invalid` rows) and re-validates and
   re-checks duplicates from scratch via `createCandidate` for each row — it never trusts the
   previewed result, since time may have passed and another request may have created a
   conflicting record. Rows that fail with `DuplicateCandidateError` are reported as `skipped`
   rather than aborting the whole commit; every other error still propagates.

### Export pipeline

`exportCandidates` (`GET /api/candidates/export`) reuses `CANDIDATE:READ` and the same
scope-filtered `WHERE` clause as `listCandidates` (via the shared `buildCandidateScopedWhere`
helper) rather than introducing a separate `EXPORT` permission action — a Phase 3 design
decision: export is a different *shape* of read, not a different permission. It streams either
CSV (hand-rolled, with proper quote-escaping) or XLSX (via `ExcelJS`) and is **always
audit-logged** (`candidate.exported`, with the format and row count — not a full row dump).

### Candidate ownership model

Unlike `Job`, §9's Candidate has no "assigned recruiter" field — that concept only exists once
the Application entity exists, in a future module. So `OWN`/`TEAM` permission scope resolves
against `Candidate.createdById` (whoever created the record) instead, via the same
`assertCandidateAccess`/`buildScopedWhere` pattern Job uses against `primaryRecruiterId`. This
was an explicit Phase 1 decision to keep ownership resolution uniform across modules — one
"ownership anchor" column, always resolved the same way by `can()`/`getEffectiveScope()` —
rather than special-casing Candidate's lack of an assignee field.

### RBAC on Candidate

No changes to the RBAC engine itself — Candidate is a pure consumer of the Module 1 primitives
described under [RBAC](#rbac) above, with `resource = "CANDIDATE"`. The default seed grants only
Recruiter `CREATE`/`READ` at `ALL` scope and `UPDATE`/`DELETE` at `OWN` scope; Hiring Manager and
HR / Onboarding get **no** default Candidate grants (deliberately — the PRD does not name either
role as needing direct Candidate access in Module 3's scope, unlike Job's approval workflow).

### Custom fields integration

`CANDIDATE` is added to `CUSTOM_FIELD_CAPABLE_ENTITIES` (`src/lib/entity-registry.ts`) and reuses
`buildCustomFieldValueSchema` unchanged — the same generic dynamic-Zod-schema engine Job already
exercises. No Customization Engine code was written for Module 3; registering the entity string
was the only change needed.

The [folder structure tree](#folder-structure) under Module 1 already reflects Module 3's
additions (`src/lib/storage/`, `src/components/candidates/`, `src/app/(app)/candidates/`,
`src/app/api/candidates/**`, and the gitignored `/storage` directory).

## Module 4 — Applications / Candidate Pipeline (PRD §11.4)

Module 4 adds one core entity, `Application`, plus two supporting history/log tables
(`ApplicationEvent`, `ApplicationEmailLog`) and one configuration table (`PipelineStage`), and —
like Modules 2 and 3 — layers on the existing Module 1 primitives:

- **RBAC**: reuses `(resource, action, scope)` with `resource = "APPLICATION"`. No new
  `PermissionAction` was needed — Application is a plain-CRUD resource in
  `src/lib/authz/resource-actions.ts` (falls through to the default `CREATE`/`READ`/`UPDATE`/
  `DELETE` set; there is no `DELETE` endpoint, so that action is simply never granted).
  `PipelineStage` configuration is authorized as `JOB:<action>` on the parent job, not as its
  own resource — configuring a job's pipeline is conceptually part of configuring that job, the
  same way recruiter assignment already is.
- **Customization Engine**: `APPLICATION` is added to `CUSTOM_FIELD_CAPABLE_ENTITIES` — no new
  engine code, same `buildCustomFieldValueSchema` path Job and Candidate already exercise.
- **Controlled Lists**: `REJECTION_REASON` (seeded since Module 1, unconsumed until now) backs
  both `Application.outcomeReasonId` and `ApplicationEvent.reasonId` — the same
  `assertControlledListValue` validation pattern Job and Candidate already use for their own
  Controlled List FKs.
- **Audit log**: Application and pipeline-stage actions log through the same `recordAudit`
  helper and `AuditLog` table, with seven new action strings: `application.created`,
  `application.updated`, `application.stage_changed`, `application.rejected`,
  `application.withdrawn`, `application.bulk_transitioned`,
  `application.bulk_email_requested`, and `pipeline_stages.updated`.

New pieces specific to Module 4:

- `src/lib/services/pipeline-stages.ts` — per-job pipeline configuration: default-stage
  seeding, reads, and the full-set replace operation (below).
- `src/lib/services/applications.ts` — all core Application business logic: scope-filtered
  listing, detail reads, duplicate pre-checks, create, update (owner/custom fields, optimistic
  locking), the single transition entry point (stage move / reject / withdraw), bulk transition,
  and bulk email.
- `src/lib/templates/render.ts` — a minimal `{{key}}`-substitution helper for the bulk-email
  feature's subject/body rendering; deliberately not the full Template Designer (§10.4).
- `prisma/backfill-pipeline-stages.ts` — a one-time, idempotent script seeding the default
  pipeline onto any job created before this module shipped (see
  [Board/list architecture](#boardlist-architecture) below).

### Service layer

Application follows the same layering the [overall architecture](#overall-architecture) diagram
describes for every module: thin route handlers under `src/app/api/applications/**` and
`src/app/api/jobs/[id]/pipeline-stages` parse a Zod schema (`src/lib/validations/application.ts`)
and call exactly one function in `applications.ts` or `pipeline-stages.ts`; every permission
check and all business logic lives in those two service files, never in a route handler or a
client component. `assertApplicationAccess`/`assertJobAccess` (a small private copy inside
`pipeline-stages.ts`, not imported from `jobs.ts`, to avoid a circular import — `jobs.ts` calls
`seedDefaultPipelineStages` from `pipeline-stages.ts`) follow the exact
`can(ALL) → can(ownerId) → throw ForbiddenError` shape `assertJobAccess`/`assertCandidateAccess`
already established.

### `PipelineStage`

A dedicated, ordered, per-job configuration model (Phase 2 decision) — deliberately **not** a
Prisma enum (different jobs run different stage sets) and **not** a `ControlledList`
(`ControlledList` is global and unordered; a job's pipeline needs its own per-job ordering).
`createJob` seeds four starter stages (`Applied`, `Screening`, `Interview`, `Offer`,
`DEFAULT_PIPELINE_STAGE_NAMES`) transactionally at job creation, since `Application.stageId` is
required and a brand-new job has no stages yet.

A stage is **never hard-deleted** once it exists — "removing" it from the pipeline just sets
`isActive: false`; it may already be referenced by an `Application` or `ApplicationEvent`, both
of which point at it with a default (`Restrict`) FK. `replacePipelineStages` is a full-set
replace, the same convention `updateJobRecruiters` (Module 2) established: the client always PUTs
the complete desired ordered list. An entry with an `id` matching an existing stage is
renamed/reordered/reactivated in place; an entry with no `id` is created; an existing stage
omitted from the submitted array is deactivated, never deleted.

Uniqueness on `(jobId, name)` is enforced only among **active** stages, via a hand-written
partial unique index (`pipeline_stage_active_name_unique` — see
[database.md](database.md#partial-unique-indexes)), not a full Prisma `@@unique`. A full
constraint would permanently reserve a deactivated stage's name and block ever reusing it for a
new active stage — the opposite of "deactivate, don't delete, can bring back." Because the
partial index only exempts inactive rows, `replacePipelineStages` applies its writes in three
ordered phases inside one transaction to avoid two kinds of transient collision that a naive
single pass over the request would hit:

1. Every kept stage (an entry with an existing `id`) is first renamed to a temporary name derived
   from its own id (`__pending__<id>`), which can never collide with anything.
2. Every stage being removed (an existing, active stage with no matching entry in the request) is
   deactivated — this exempts its old name from the partial index.
3. Only then are the real target names/sort orders applied to kept stages, and new stages
   created.

This ordering is what makes two specific requests safe: swapping two active stages' names in one
call (phase 1 clears both real names before phase 3 reassigns them), and introducing a new active
stage that reuses a name just freed by deactivating another stage in the same call (phase 2 runs
before phase 3). Both are covered by dedicated regression tests
(`tests/services/pipeline-stages.service.test.ts`) added after this exact bug was found and fixed
during Phase 5 testing — see [project-status.md](project-status.md#completed-modules) and
[CHANGELOG.md](../CHANGELOG.md).

### `Application`

"One candidate against one job, holding the pipeline stage" (§9). Deliberately **no** unique
constraint on `(candidateId, jobId)` — re-applying the same candidate to the same job is allowed,
only warned about (§11.4) — see [Duplicate detection (Applications)](#duplicate-detection-applications) below.
`candidateId`/`jobId` carry no `onDelete` override (default `Restrict`): Candidate deletion is
blocked by a service-layer check in `deleteCandidate` before it would ever hit this FK (see
[Candidate integration](#candidate-integration) below), and `Job` has no delete endpoint at all,
so neither FK's `Restrict` behavior is ever actually exercised in normal use — it exists as a
database-level backstop, not the primary enforcement path.

**Ownership.** A dedicated `Application.ownerId` (Phase 2 decision) — §9 names `owner` as its own
Application field, distinct from the candidate/job themselves, unlike Candidate, which has no
owner-like field of its own. `ownerId` defaults to the job's primary recruiter at creation
(mirroring how a job's primary recruiter anchors Job's own ownership) but is independently
reassignable afterward via `PATCH /api/applications/[id]` — reassignment never touches
`Job.primaryRecruiterId`, and reassigning a job's primary recruiter never touches any
Application's `ownerId`. Every Application permission check —
`can(ALL) → can({ ownerId: application.ownerId }) → ForbiddenError` — resolves OWN/TEAM scope
against this one column, the same uniform "ownership anchor" pattern Job
(`primaryRecruiterId`) and Candidate (`createdById`) each already use.

**Application outcomes.** `outcome` (`ApplicationOutcome`: `ACTIVE`/`REJECTED`/`WITHDRAWN`) is
orthogonal to `stage` — a separate column, not two more stages in the pipeline. Rejected and
Withdrawn are both **terminal**: once `outcome` leaves `ACTIVE`, `transitionApplication` rejects
every further transition (stage move or another outcome change) with a `400`, and `outcome` is
never reset back to `ACTIVE`. `stage` stays frozen at whatever it was the moment the outcome was
set — rejecting an application from `Interview` leaves its `stage` reading `Interview` forever,
a deliberate snapshot of where it was when it left the pipeline. Both terminal outcomes require a
reason from the `REJECTION_REASON` Controlled List.

**Optimistic locking.** `Application.version` follows the exact `Job.version`/`Candidate.version`
pattern: every update or transition is a single `prisma.application.updateMany({ where: { id,
version: <caller's version> }, data: { ..., version: { increment: 1 } } })`; a version mismatch
means `updateMany` matches zero rows and the service throws `ConflictError` → `409`.

### `ApplicationEvent`

An immutable history row for every stage move and outcome change, modeled directly on Module 2's
`JobStatusChange`. `transitionApplication` writes the `Application` update and its
`ApplicationEvent` row inside one `$transaction`, so the two can never diverge. A `STAGE_CHANGE`
event sets both `fromStageId` and `toStageId`; a `REJECTED`/`WITHDRAWN` event sets only
`fromStageId` (a snapshot of where the application was when it left the pipeline) plus a
required `reasonId` — there is no `toStageId` for a terminal-outcome event, since the
application didn't move anywhere, it left.

### `ApplicationEmailLog`

Originally **infrastructure only** (§11.4, Phase 2 decision) — every row wrote `status: PENDING`
and nothing sent anything. Module 8 (Communication Hub, §11.10) completed the wire:
`bulkEmailApplications` resolves an active `CommunicationTemplate`, renders it
(`src/lib/templates/render.ts`, `{{candidate.name}}`/`{{job.title}}` placeholders) per recipient,
sends it via `MailProvider` (`src/lib/mail/`, described just below), and writes the row already
as `SENT`/`FAILED`. `subject`/`body` remain the *rendered*
snapshot, not a live reference to the template — `templateId` records provenance without making
history dependent on the template's current content. `CANCELLED` stays unwritten — no PRD
requirement to cancel a queued send. The log is scoped narrowly to `Application` (one row per
application per bulk-email call), not a polymorphic entity-agnostic log — nothing else in this
codebase sends email yet for a polymorphic log to also serve.

### `CommunicationTemplate` & mail delivery

Module 8's own model: admin-managed `name` (unique), `channel` (`EMAIL`/`SMS` — only `EMAIL` is
ever written; `SMS` is a recognized value nothing sends over yet, same "enum leaves room" pattern
as `HandoffDeliveryMethod.API_PUSH`), `subject`, `body`, `isActive`. Deliberately the *minimal*
slice of the Template Designer (§10.4) that §11.10's own M-requirement needs — not the full
designer (multi-language variants, conditional blocks, version history + approval workflow),
which stays its own future module. No hard delete — deactivate via `isActive`, same convention as
`PipelineStage`; no optimistic-locking `version` — matches `CustomFieldDefinition`/
`ControlledListValue`'s admin-metadata tier, not `Job`/`Offer`'s business-record tier.

`src/lib/mail/` mirrors `StorageProvider`/`HrisProvider`'s shape exactly: a `MailProvider`
interface, one real implementation (`ConsoleMailProvider` — logs the message, always succeeds;
its only plausible failure precondition, an empty recipient, is already guaranteed non-empty by
the caller before a log row is ever created, so unlike `StructuredExportProvider` there is no
genuine failure condition for this dev-only provider to model), and an env-driven factory
(`MAIL_PROVIDER`, defaulting to `"console"`). A real Gmail/Outlook API connector (§12) needs
OAuth credentials out of scope for this pass.

### Board/list architecture

`job-pipeline-client.tsx` (a job's Pipeline page) and `applications-client.tsx` (the global
Applications list) both fetch their application set once and render it through a `Tabs`/table
split rather than two independent views:

- The job Pipeline page's Board and List tabs share one `applications` array in component state
  — switching tabs re-renders the same data, no second fetch.
- The global Applications list is `applications-client.tsx` alone (list only; there is no global
  board, since a board's columns are a *job's* pipeline stages, which don't exist independent of
  a job).

Both pages reuse the same `BulkActionToolbar` component for their bulk-action row, and the same
`DataTable` component (extended in Module 4 with opt-in row-selection support — `getRowId` +
`rowSelection` + `onRowSelectionChange` — while staying backward-compatible with every caller
that doesn't pass those props).

Every job's Board defaults to showing its `Applied`/`Screening`/`Interview`/`Offer` starter
pipeline the moment the job exists, because `createJob` seeds those four stages transactionally
in the same `$transaction` as the job row itself (`seedDefaultPipelineStages`, called from
`src/lib/services/jobs.ts`). Jobs created before Module 4 shipped have no stages until
`prisma/backfill-pipeline-stages.ts` is run once against that environment (idempotent — skips
jobs that already have at least one stage).

### Drag-and-drop isolation

`@dnd-kit/core` is imported in exactly one file, `src/components/applications/pipeline-board.tsx`
(a Phase 4 constraint: "keep drag-and-drop isolated behind reusable components"). `PipelineBoard`
owns only the drag mechanics — `DndContext`, a `PointerSensor` for mouse/touch and a
`KeyboardSensor` so a focused card can be picked up/moved/dropped with keyboard alone — and
reports a completed drop via an `onDropCard(applicationId, toStageId)` callback. It renders
whatever `applications`/`stages` it's given and holds no application data itself; the caller
(`job-pipeline-client.tsx`) owns all optimistic-update-with-rollback state, so `PipelineBoard`
stays a plain, swappable presentation layer a future redesign could replace without touching any
state logic.

### Optimistic updates and rollback behavior

`handleDropCard` in `job-pipeline-client.tsx` updates the dragged card's stage in local state
immediately (before the server confirms), then calls `POST /api/applications/[id]/transition`
with `action: "STAGE_MOVE"`. On success, the card's `version`/`stage`/`stageEnteredAt` are
reconciled from the server's response. On failure (most commonly a `409` from a stale `version`
— another user moved the same card first), the card is rolled back to its stage *before* the
drag started.

The snapshot and rollback are both scoped to **only the dragged card**, via a functional
`setApplications((prev) => prev.map(...))` update — not a snapshot of the entire applications
array. This distinction matters under concurrent drags: if a second card is dragged while the
first card's request is still in flight, and the first request later fails, a full-array
rollback would silently undo the second card's already-confirmed move too. This was a real race
condition found and fixed during Phase 5 testing (see
[project-status.md](project-status.md#completed-modules) and
[CHANGELOG.md](../CHANGELOG.md)) — reproduced and verified end-to-end with a Playwright test that
forces a concurrent server-side change mid-drag and confirms only the affected card reverts.

### Bulk operations

`bulkTransitionApplications` and `bulkEmailApplications` are both **best-effort, not atomic** —
the same `{ succeeded: [...], failed: [{ id, reason }] }` split
`commitCandidateImport`'s `created`/`skipped` response established in Module 3. One target's
stale version, terminal-outcome conflict, or missing permission doesn't fail the rest of the
batch; each target still goes through the single-item service function (`transitionApplication`
or the per-application email-log write) with its own `$transaction`, so every individual
mutation and its side effect (an `ApplicationEvent` row, or an `ApplicationEmailLog` row) commit
or roll back together. Frontend bulk actions are limited to exactly four, per the Phase 2
decision: stage move, reject, withdraw, and bulk email — there is no bulk delete (Application has
no delete endpoint) and no bulk custom-field edit.

### Duplicate detection (Applications)

Unlike Candidate's hard phone-uniqueness block, Module 4's duplicate handling is **entirely
non-blocking**, per §11.4's stated behavior ("warn when re-adding a candidate previously in the
pipeline for the same job"): `findDuplicateApplications` (`GET /api/applications/duplicates`)
returns every prior `Application` for the same `(candidateId, jobId)` pair, and `createApplication`
itself always succeeds regardless of what it finds — the same list is simply attached to the
create response as `priorApplications` so the UI can show the same warning without a second
request. Like `checkCandidateDuplicates`, this uses `getEffectiveScope`, not
`requirePermission` — it isn't checked against any one record's ownership, so a caller with a
plain `OWN`-scope `READ` grant (the common Recruiter case) still passes.

### Candidate integration

Two changes to `src/lib/services/candidates.ts`, both additive — no existing Candidate behavior
changed:

- **`deleteCandidate`** now counts the candidate's `Application` rows first and throws a
  `ValidationError` ("This candidate has applications and cannot be deleted.") if any exist,
  before ever reaching the `StorageProvider.delete()` / database-delete sequence Module 3
  established. `Application.candidateId`'s database-level `Restrict` FK is a backstop for this
  same rule; the service-layer check exists so the caller gets a clean, readable `400` instead of
  an unhandled constraint-violation error.
- **`getCandidateTimeline`** extends the `{ items: [{ type, ... }] }` contract Module 3 built with
  four new item types — `application_created` (one per `Application`), and
  `application_stage_changed` / `application_rejected` / `application_withdrawn` (one per
  `ApplicationEvent`, discriminated by the event's own `type`) — merged with the existing `note`
  items and re-sorted by `createdAt` descending. This is the contract's first real second
  consumer, exactly the extensibility Module 3 designed it for; the `note` item shape is
  unchanged.

### RBAC on Application

No changes to the RBAC engine itself — Application is a pure consumer of the Module 1 primitives
described under [RBAC](#rbac) above, with `resource = "APPLICATION"`. The default seed grants
Recruiter `CREATE`/`READ` at `ALL` scope and `UPDATE` at `OWN` scope; Hiring Manager gets `READ`
at `ALL` scope only (reviews shortlists broadly per §8, but has no application-mutation need);
Recruiting Manager gets `CREATE` at `ALL` scope and `READ`/`UPDATE` at `TEAM` scope. No role has a
`DELETE` grant, since there is no delete endpoint — the same "no hard delete" precedent Job
established, rather than Candidate's hard-delete model.

### Validation

`src/lib/validations/application.ts` follows the established Zod conventions: `stageId`/`ownerId`
are optional on create (resolved to defaults by the service, per above);
`applicationTransitionSchema` is a true `z.discriminatedUnion("action", [...])` — `STAGE_MOVE`
takes `toStageId` and no `reasonId`, `REJECT`/`WITHDRAW` take `reasonId` and no `toStageId` — a
stricter shape than Job's `jobStatusActionSchema` (a single object validated with
`superRefine`), chosen because Application's three actions have genuinely disjoint required
fields, not just different legal `from` states.  `pipelineStagesReplaceSchema` requires
case-insensitively-unique names within one request and at least one stage, mirroring
`jobRecruitersUpdateSchema`'s "at least one, no duplicates" shape for `PUT
/api/jobs/[id]/recruiters`.

The [folder structure tree](#folder-structure) under Module 1 already reflects Module 4's
additions (`src/lib/services/applications.ts`, `pipeline-stages.ts`, `src/lib/templates/`,
`src/components/applications/`, `src/app/(app)/applications/`, `src/app/(app)/jobs/[id]/pipeline/`,
`src/app/api/applications/**`, `src/app/api/jobs/[id]/pipeline-stages/`, and
`prisma/backfill-pipeline-stages.ts`).

### Reports & business-day arithmetic (Module 9, §11.12)

`src/lib/services/reports.ts` holds all four pre-built reports as plain read-only aggregation
functions — no materialized/cached tables, computed fresh on every call. Each reuses the
underlying entity's own `:READ` permission and `getEffectiveScope`, the exact "reports reuse the
entity's existing permission" choice `candidate-export.ts` already documents for
`CANDIDATE:READ` — rather than a new blanket `REPORT` resource. This is also what gives §10.5's
row-level-security requirement for free: an OWN/TEAM-scoped viewer's report is narrowed exactly
like their own Job/Application/Offer lists are, with no separate mechanism to keep in sync.

`src/lib/reporting/business-days.ts` is the first real consumer of `Organization.workingDays`/
`Holiday` — columns Module 1 seeded as "foundation for future SLA/TAT clocks" (see
`docs/project-status.md`) that no service touched until now. `getWorkingCalendar()` reads the
single `Organization` row (falling back to a plain Mon-Fri calendar with no holidays if it
hasn't been seeded); `businessDaysBetween(from, to, calendar)` is a pure function taking that
calendar as a parameter rather than fetching it itself, so it's trivially unit-testable without a
database (see `tests/lib/business-days.test.ts`).

Offer/TAT compliance measures `Offer.createdAt` → the approved `OfferApproval.decidedAt` — the
one leg of Offer's lifecycle with its own immutable, never-overwritten timestamp.
`Offer.updatedAt` could not substitute for this: it reflects only the *latest* status flip, so an
offer that has since moved past `EXTENDED` (accepted/declined/revoked) no longer carries an
accurate "when was it extended" timestamp anywhere on the row. Extending the schema to add one is
out of scope for this pass — compliance is reported on the submission-to-approval leg only, which
stays accurate for every offer regardless of what happened to it afterward. The compliance
threshold (`tatThresholdDays`) is a report *parameter* supplied by the viewer, not a stored org
policy — the PRD names no fixed SLA number, so inventing one would be exactly the kind of
unstated business rule this codebase's design notes elsewhere warn against assuming.

Pipeline funnel & conversion's "reached stage N" is a cumulative count, not a point-in-time
distribution: an application counts toward every stage it currently sits at, or has any
`ApplicationEvent` recording a move into **or out of** (`STAGE_CHANGE`'s `toStageId` *and*
`fromStageId`). `fromStageId` matters specifically because an application's *initial* stage
(assigned at creation, before its first move) never appears as any event's `toStageId` — nothing
"moved it into" a stage it started at. A funnel that only consulted `toStageId` would silently
undercount that first stage for any application that has since progressed past it; this was
caught and fixed while writing `tests/services/reports.service.test.ts`'s fixture.

Recruiter productivity/workload resolves its recruiter set from the caller's `JOB:READ` scope
(OWN → self only, TEAM → direct reports, ALL → every distinct `Job.primaryRecruiterId`), then
computes all five metrics as flat `groupBy` queries across every recruiter at once —
`prisma.job.groupBy({ by: ["primaryRecruiterId"], ... })` and similarly for
applications/interviews/offers/handoffs — rather than one `count()` per recruiter per metric.
The cost is 5 queries total regardless of how many recruiters are in scope; a naive
`recruiters.map(async (recruiter) => ...)` loop (the first-draft shape, since fixed) would have
scaled 5×N.

### Saved reports & scheduled delivery (Module 9, §10.5)

`SavedReport` is the minimal faithful slice of §10.5's "custom dashboard and report builder" —
deliberately **not** a generic drag-and-drop widget engine over arbitrary entities and custom
fields (that's a multi-week UI/query engine on its own). The cut mirrors Module 8's own decision
to ship the *minimal* slice of the Template Designer rather than its full scope: `reportType`
picks one of the four pre-built reports above, and `filters` (a JSON blob, validated per-type via
Zod — `REPORT_QUERY_SCHEMAS`, the same "shape validated at the service boundary" convention as
`Job.customFields`) narrows it. There is no widget layout, no arbitrary-entity query, no
custom-field aggregation.

Business-record tier, not admin-metadata tier: unlike `CommunicationTemplate` (open read for
everyone, no `version`), `SavedReport` has `OWN`/`TEAM`/`ALL` scope on `createdById` and an
optimistic-locking `version` — because a saved report can be configured to email arbitrary
recipient addresses on a schedule, and *defining* one is a meaningfully more sensitive capability
than reading a template's content. `name` is deliberately not unique (unlike
`CommunicationTemplate.name`) since these are personal/team artifacts, not a shared org-wide
vocabulary. No historical FK references a `SavedReport` row, so deleting one is a genuine hard
delete, the same precedent as `CustomFieldDefinition` rather than `CommunicationTemplate`'s
deactivate-only convention.

Row-level security (§10.5's third bullet) is **not** stored on the `SavedReport` row itself.
Running a saved report re-applies the *runner's own* permission scope on the underlying entity at
run time — the same `getEffectiveScope()` call every ad-hoc report and every list endpoint
already makes. Two users sharing the same `SavedReport` therefore see different rows, which is
the actual requirement; storing a fixed row-set on the definition at save time would violate it.

`src/lib/services/scheduled-reports.ts` (`runDueScheduledReports`) is the real business logic
for schedule-based email delivery. It re-applies each report's *creator's* own RBAC scope by
resolving a `SessionContext` from their user id alone —
`src/lib/authz/session-context-for-user.ts`, deliberately its **own file**, not colocated with
`getSessionContext`. `session-context.ts` imports NextAuth's `auth()`, an entirely unrelated
dependency for what is otherwise a plain user-id lookup; pulling it in transitively broke
importing `getSessionContextForUser` outside the Next.js runtime (NextAuth's ESM/CJS interop with
`next/server` doesn't resolve under Vitest), which is exactly where the scheduler's own tests need
it. The split — `session-context.ts` importing `getSessionContextForUser` from the new file, the
new file importing only the `SessionContext` *type* (erased at compile time, no runtime import
emitted) back — removes that coupling without duplicating the DB lookup.

No cron or queue infrastructure exists anywhere in this app — there is no long-running worker
process beside the Next.js server itself, the same environment limit
`MailProvider`/`StorageProvider`/`HrisProvider` already document for their own "no real external
system" providers. `runDueScheduledReports` is the real, fully-tested logic for *what* should
happen on a schedule; *actually* invoking it periodically is external infra this pass does not
provide — `POST /api/saved-reports/run-due` exists for an OS cron or a hosting platform's
scheduled function to call. Due-detection (`lastRunAt` missing, or older than the schedule's
`DAILY`/`WEEKLY` interval) is computed in JS after one broad `findMany`, not per-row SQL interval
math, since `SavedReport` volumes don't warrant it.

`MailMessage` (`src/lib/mail/provider.ts`) gained an optional `attachments` field — the first
sender that needs one. `ConsoleMailProvider` logs each attachment's file name, content type, and
byte length rather than the content itself, consistent with its existing "delivery means writing
where an operator can see it happened, not a network call" design.

### Export: XLSX/CSV/PDF (Module 9)

`src/lib/services/report-export.ts` flattens each report's own return shape into a uniform
`ExportRow[]` (one shape per report type — the export function's whole job), then renders that
through one of three format-specific functions. XLSX/CSV reuse `candidate-export.ts`'s exact
pattern (`ExcelJS.Workbook` for XLSX, a hand-rolled quote-escaping join for CSV). PDF is new:
`pdf-lib`, the module's one new dependency, chosen because it's pure-JS with no native/system
binary dependency (relevant in this environment, where `apt-get install poppler-utils` failed on
a network-restricted attempt during an earlier module). The PDF renderer draws a plain
pipe-delimited text table — `pdf-lib` is a low-level PDF-writing library with no table-layout
engine of its own, and building one is out of scope for satisfying "export to PDF" for a report
that's already viewable on-screen and exportable as XLSX/CSV.

`renderReportBuffer` (no audit log) and `exportReport` (audit-logs then delegates to
`renderReportBuffer`) are deliberately two separate exported functions: the scheduled-report
runner calls `renderReportBuffer` directly (an internal, non-viewer-initiated render shouldn't
produce a viewer-attributed audit entry), while the ad-hoc export API route calls `exportReport`
(a viewer explicitly asked for a file, which — like `candidate-export.ts`'s own export — is
always logged).

### Workflow & Automation Builder (Module 10, §10.2)

`src/lib/services/workflows.ts` is the evaluate/execute engine, called from two directions:
`evaluateApplicationWorkflows(context, applicationId, triggerType, triggerMatches, fingerprint)`
for the three event-driven triggers (`STAGE_CHANGE`, `FIELD_UPDATE`, `FORM_SUBMISSION`), and
`runDueTimeInStageWorkflows(now)` for `TIME_IN_STAGE`, which has no single triggering write.
Both share the same inner loop: find every active `WorkflowDefinition` whose active version's
`triggerType` matches and whose `jobId` is either `null` (global) or the application's own job,
apply the trigger-specific `triggerMatches` predicate against `triggerConfig` (e.g. "does this
event's destination stage equal `config.toStageId`?"), evaluate the AND-only condition list
against `Application.customFields`, then run each action in its own `try`/`catch` (so one bad
action — an inactive template, a deleted user — never blocks the others in the same workflow).

**Versioning**: `WorkflowDefinition` never stores its own trigger/conditions/actions directly —
`WorkflowDefinitionVersion` does, and `WorkflowDefinition.activeVersionId` points at the current
one. Saving a new configuration creates a new version row and re-points the pointer; it never
mutates or deletes an old version. Rollback (`rollbackWorkflowDefinition`) is exactly the same
operation aimed at an older version id — the same append-only-history-plus-pointer pattern
`JobStatusChange`/`ApplicationEvent`/`OfferApproval` already establish for their own entities,
just with the pointer living on the parent row instead of being derived by querying "most recent
row." This is what makes §10.2's "full version history... with the ability to roll back"
trivially true: every version ever saved stays queryable via `WorkflowDefinition.versions`
regardless of which one is active.

**Idempotency**: `WorkflowExecution` has a unique index on `(workflowDefinitionVersionId,
applicationId, fingerprint)`. `claimExecutionSlot` attempts an INSERT into that table *before*
running any action; a `P2002` unique-violation means another evaluation already claimed this
exact occurrence, and the caller treats that as "already handled," not an error — the same
"let the database's unique constraint be the real guard against a race, not a check-then-act
pre-check" pattern `createOffer`/`createCommunicationTemplate` already use. This matters most for
`TIME_IN_STAGE`: nothing "causes" it the way a stage move causes `STAGE_CHANGE`, so
`runDueTimeInStageWorkflows` is designed to be called repeatedly (by an external scheduler) while
an application sits in the same stage, and must not re-fire on every call. Its fingerprint is
`stageEnteredAt.toISOString()` — re-entering the same stage later produces a fresh timestamp and
can fire again, which is the correct behavior. The three event-driven triggers use a fingerprint
tied to the specific occurrence: the new `ApplicationEvent.id` for `STAGE_CHANGE`, an
`updatedAt` timestamp for `FIELD_UPDATE`, and the new `Application.id` for `FORM_SUBMISSION`
(each of these can only ever happen once per row, or produces a fresh id/timestamp each time).

**Business-record tier, not admin-metadata tier**: unlike `CommunicationTemplate` (open read,
no `version`, no hard delete), `WorkflowDefinition` gets `OWN`/`TEAM`/`ALL` scope on
`createdById`, an optimistic-locking `version`, and deactivate-don't-delete — because an
automation has real side-effect risk (it can send email, reassign ownership, or create
approval-gated tasks) with no further per-action human review, the same risk profile that puts
`Job`/`Offer`/`SavedReport` in this tier rather than `CommunicationTemplate`'s.

**Cross-module hooks**: `src/lib/services/applications.ts`'s `transitionApplication`,
`updateApplication`, and `createApplication` each call a shared `fireWorkflowsInBackground`
wrapper *after* their own write has committed — deliberately outside that write's own
transaction, and with any error from workflow evaluation caught and only logged. `SEND_EMAIL` is
external I/O; a misbehaving automation must never roll back or fail the user's own action that
triggered it. `FIELD_UPDATE`'s hook diffs the application's *before* and *after*
`customFields` to find which keys actually changed (`JSON.stringify` comparison per key) — a
no-op re-save of the same value must not re-fire an automation keyed to that field.

**`WorkflowTask` dual access**: `CREATE_TASK` and `REQUEST_APPROVAL` both produce a
`WorkflowTask` row, resolved via `completeWorkflowTask`/`decideWorkflowTask`
(`src/lib/services/workflow-tasks.ts`). `assertWorkflowTaskAccess` grants access two ways: an
unscoped or ownership-scoped `APPLICATION:UPDATE` grant over the owning application, **or** the
task's own assignee, unconditionally — not gated by any Application permission at all. This is
deliberately *not* identical to `Interview`'s scheduler-vs-panelist dual-path check (which
additionally requires an OWN-scope grant on the panelist themselves): `REQUEST_APPROVAL` exists
specifically to route a decision to someone who may hold no Application-mutation permission at
all (e.g. a Hiring Manager), so gating the assignee path on any Application grant would defeat
the action's own purpose. Resolution uses a status-guarded `updateMany` (`WHERE id AND
status = 'OPEN'`) as its optimistic-concurrency guard, rather than a dedicated `version` column
— the only "conflict" that matters here (did someone else already resolve this task) is fully
captured by the status field itself.

**No cron/queue infrastructure**, the same environment limit `MailProvider`/`StorageProvider`/
`HrisProvider`/Module 9's scheduled reports already document: `runDueTimeInStageWorkflows` is
real, tested logic; `POST /api/workflows/run-due` exists for an external scheduler to call it
periodically, but nothing in this codebase invokes it on its own.

## Module 11 — Sourcing & Job Board Distribution (§11.3)

**`JobBoardProvider` abstraction**: `src/lib/job-boards/provider.ts` defines `post`/`remove`
only — deliberately no `fetchInboundApplications`/webhook-receiver method, since real boards
vary wildly in how they push inbound applications back (webhook, polling API, email digest) and
modeling one specific shape without a real board to validate it against would invent a
requirement the PRD doesn't state. `src/lib/job-boards/index.ts#getJobBoardProvider()` is an
env-driven (`JOB_BOARD_PROVIDER`, default `"mock"`) cached-singleton factory, the same shape as
`getStorageProvider`/`getHrisProvider`/`getMailProvider`. Only `MockJobBoardProvider` exists —
its `post()` fails deterministically when `job.description` is empty (a plausible real-board
rejection reason), its `remove()` always succeeds (removal is idempotent by nature; "already
gone" is a service-layer status check on `JobPosting.status`, not a provider-level failure).

**`JobPosting` — persistent, status-toggled row, not append-only**: one row per `(jobId,
sourceId)`, reusing `ControlledListValue`/`CANDIDATE_SOURCE` as the board list rather than
inventing a parallel `JOB_BOARD` list — the same board a candidate is later attributed to is the
board a job is posted to, and there is no reason for those to be two different lists. Re-posting
after a removal updates the existing row (`status: REMOVED -> POSTED`) rather than creating a
second one; `@@unique([jobId, sourceId])` is the real guard against a genuine double-post race (two
concurrent first-time posts to the same board), not a pre-check — a `P2002` on the `create` branch
is caught and turned into a `ConflictError`. `JobPosting` rows are never hard-deleted (`REMOVED`
instead of a delete), since `Application.sourcedFromPostingId` may reference one.

**RBAC reuse, not a new resource**: `createJobPosting`/`removeJobPosting`/`receiveInboundApplication`
each call the same `assertJobAccess(context, job, "UPDATE")` shape `pipeline-stages.ts` already
establishes for managing a job's own configuration — `JOB:UPDATE`, unscoped or owner-scoped to
`Job.primaryRecruiterId`. No `JOB_POSTING` permission resource was introduced; managing a job's
board postings is authorized as an extension of managing the job itself.

**Source attribution — two signals, deliberately different scopes**:
`Candidate.sourceId` (existing since Module 3, §9) answers "where did this person originally come
from" and is set once at creation, never overwritten by a later event — a returning candidate who
applies again via a *different* board keeps their original attribution. The new
`Application.sourcedFromPostingId` answers a narrower question — "which specific posting drove
*this* application" — and is populated only for applications created via
`receiveInboundApplication`. It is threaded through as an internal-only third parameter to
`createApplication(context, input, opts)`, not part of the public, Zod-validated
`ApplicationCreateInput` — `POST /api/applications` cannot be made to claim a posting attribution
it has no way to validate.

**Inbound intake has no public entry point**: §7 scopes this app to have no public,
unauthenticated career-site/apply page, so `receiveInboundApplication` is session-authenticated —
a staff member records the name/phone/email/note a board notified them about, and the function
decides the candidate (create, or reuse on a phone match per §9's hard-duplicate rule) and the
application (via the same `createApplication` every other path uses, landing in the job's first
active pipeline stage) rather than the recruiter typing either by hand. This is the "automatic"
part of "inbound applications land directly in the correct pipeline with source tagged
automatically" — the transport (staff intake vs. a live webhook) is a documented limitation
(below), not a requirement gap; the entry point itself is the piece the PRD asks for, and a real
board integration's webhook handler or polling adapter would call this exact function once
credentials exist.

**Referral capture, one combined step**: `createReferral` (`src/lib/services/referrals.ts`)
creates the candidate and application together, resolving the `CANDIDATE_SOURCE` list's existing
"Referral" value at call time rather than caching an id — the same create-or-reuse-by-phone
logic `receiveInboundApplication` uses. Both `receiveInboundApplication` and `createReferral` are
best-effort, not transactional, across their candidate-create-then-application-create pair — the
same documented precedent `bulkTransitionApplications` already establishes: if the application
create fails after the candidate was created, the candidate record still exists and the
application can be created separately via the normal `/applications/new` flow.

## Module 12 — Scheduler Infrastructure (§11.5 / §11.12 / §10.2)

**Architecture chosen: a lightweight orchestrator over consumers, not a generic job-queue
table.** Three real, PRD-committed capabilities need periodic evaluation with no single
triggering write to hang off of: interview reminders (§11.5), scheduled report delivery (§11.12,
Module 9), and `TIME_IN_STAGE` workflow triggers (§10.2, Module 10). The last two already had
their own due-runners (`runDueScheduledReports`, `runDueTimeInStageWorkflows`) and their own
`POST /api/*/run-due` endpoints, each independently documenting "no cron/queue infrastructure
exists in this app." Rather than building a polymorphic `ScheduledJob` table all three would have
to be reshaped around, `src/lib/scheduler/run.ts#runScheduledWork()` is a thin orchestrator that
calls all three existing (or, for reminders, newly-built) due-runners, isolates each one's
failure from the others, and reports per-consumer stats. This was evaluated against the three
options the module's own design brief posed — (A) a lightweight coordinator, (B) a persistent
scheduled-job table, (C) an external-trigger abstraction — and (A) was chosen because the
consumers' due-detection logic genuinely differs (a fixed lead time before an absolute instant,
a daily/weekly cadence against a last-run timestamp, a stage-age threshold against `stageEnteredAt`)
in ways a shared table would only paraphrase, not simplify; each consumer already owns its own
idempotency/batching/retry logic well, and the real remaining gap was *invocation* — one place
external infrastructure can call, not a new persistence model.

**Extended to a fourth consumer: Offer auto-expiry (§11.6 audit gap, post-launch).**
`runDueOfferExpirations` (`src/lib/services/offer-expiry.ts`) transitions any `EXTENDED` offer
whose `respondByDate` has passed to `LAPSED`, via the same version-guarded `updateMany` idiom
every other consumer uses for its own idempotency — re-running the sweep is always safe, since a
row already moved to `LAPSED` no longer matches the `WHERE status = 'EXTENDED'` filter. It was
added to `runScheduledWork()` alongside the original three rather than given its own orchestrator
or `run-due` endpoint, for the same reason the original three were unified: one more consumer
with its own due-detection shape (a per-offer absolute deadline) doesn't change the
coordinator's job, which stays invocation, isolation, and reporting.

**No cron/queue infrastructure inside this app, still.** `runScheduledWork()` is real, tested
business logic; nothing calls it periodically from inside the Next.js process — no
`setInterval`/`setTimeout` anywhere, consistent with every prior module's own documented
limitation. `POST /api/scheduler/run` is the one HTTP entry point; genuine periodic invocation is
external infrastructure's job (Vercel Cron, AWS EventBridge, a Railway/Render cron job, a
Kubernetes CronJob, Windows Task Scheduler, or a plain `curl` in an OS crontab) — see
[api.md](api.md#post-apischedulerrun) for exact setup per provider. Claiming this endpoint
"implements" cron would be false; it implements the secure, idempotent, bounded *execution* a
cron trigger can safely call, repeatedly, from anywhere.

**Authentication: a shared secret, not a session — the one deliberate exception.**
`withApiHandler` (`src/lib/api/handlers.ts`) unconditionally resolves a signed-in session and
401s otherwise; every other route in this app is built on it. An external cron provider
fundamentally cannot present a user session, so `POST /api/scheduler/run`
(`src/app/api/scheduler/run/route.ts`) is deliberately NOT built on `withApiHandler` — it's a
small, self-contained handler that checks `Authorization: Bearer <SCHEDULER_SECRET>` via
`src/lib/scheduler/auth.ts#isValidSchedulerSecret` before doing anything else.
`SCHEDULER_SECRET` is a plain environment variable, read server-side only, never sent to the
client. The comparison hashes both the expected and provided secret to a fixed-length SHA-256
digest before `crypto.timingSafeEqual` — a bare `timingSafeEqual(a, b)` throws on a length
mismatch, which is itself an observable timing signal (fast-fail vs. slow-compare) an attacker
could use to fish for the secret's length before brute-forcing its content; hashing first removes
that branch entirely, so every comparison takes the same shape regardless of what was sent.

**Interview reminders (§11.5: "automatic email reminders to candidate and panel at configurable
intervals") — built from scratch, following the exact same idempotency idioms already
established elsewhere in this codebase.** `InterviewReminder` (`prisma/schema.prisma`) is one row
per (interview occurrence, lead time, recipient) — candidate and each active panelist get their
own row, deliberately mirroring `ApplicationEmailLog`'s existing one-row-per-recipient shape
(Module 8) rather than inventing a "batch" concept. `recipientId` is always non-null (the literal
string `"candidate"`, or a panelist's real `User.id`) specifically so it can sit in a real,
DB-enforced unique constraint — a nullable column used the same way would have silently defeated
uniqueness, since Postgres never treats two NULLs as equal.

*Claiming a slot* (`claimReminderSlot` in `src/lib/services/interview-reminders.ts`) combines both
idempotency idioms this codebase already uses elsewhere, in sequence:
1. **First-ever attempt**: `prisma.interviewReminder.create()` with `status: "PROCESSING"`. The
   INSERT itself is the claim — a concurrent duplicate `create` fails on the unique constraint
   (P2002), caught and treated as "someone else already claimed this," not an error.
2. **Reclaiming an existing row** (a retry, or recovering an abandoned claim): a status-guarded
   `updateMany` — `WHERE id AND (status='RETRYING' AND nextAttemptAt<=now) OR (status='PROCESSING'
   AND updatedAt<staleCutoff)`, setting `status: 'PROCESSING'` as part of the same write. Changing
   the status itself (not just incrementing a counter) is what makes this exclusive — two
   concurrent `updateMany` calls with an *unchanged* status in their WHERE clause could both
   match and both think they'd claimed it; transitioning the status is what makes the second
   racer's identical WHERE clause stop matching once the first racer's write commits. This is the
   same pattern `removeJobPosting`/`completeWorkflowTask` already establish for their own
   claims, and the same "must recover after a timeout" requirement `claimExecutionSlot` satisfies
   via a single atomic insert — here recovery needs its own staleness window
   (`STALE_PROCESSING_MINUTES`) since the claim is a status, not a one-shot insert.

*Rescheduling, cancelling, completing.* `scheduledAtFingerprint` (`Interview.scheduledAt` as an
ISO string, captured at claim time) is folded into the uniqueness key for exactly the reason
`WorkflowExecution`'s own fingerprint is: rescheduling an interview changes `scheduledAt`, which
changes the fingerprint, so prior reminder rows for the *old* time are simply never revisited
(the due-detection query only ever computes due-ness against the *current* `scheduledAt`) while a
fresh reminder becomes claimable for the new time — no explicit invalidation step, the same
"leaving and re-entering a stage produces a fresh fingerprint" pattern `TIME_IN_STAGE` already
established. Cancelling or completing an interview removes it from the due-detection query's
`status: "SCHEDULED"` filter entirely — no reminder is ever attempted for it again.

*Retry, backoff, permanent failure.* Up to `MAX_ATTEMPTS` (3) attempts, exponential backoff
(`BASE_BACKOFF_MINUTES * 2^(attempts-1)`) between them, then `status: "FAILED"` — recorded, never
retried again. A missing email is recorded as an immediate, permanent `FAILED` (not a transient
retry — an absent email doesn't become present on its own), with `lastError` explaining why, so
it's diagnosable without becoming an infinite retry loop.

*Timezone / UTC.* `Interview.scheduledAt` is a `TIMESTAMP(3)` column, the same convention every
other timestamp in this schema already uses, treated as a UTC instant end to end. Due-time math
(`scheduledAt − leadMinutes`) is pure arithmetic on absolute instants — it needs no per-org
timezone conversion to be correct, since "45 minutes before this exact moment" means the same
thing everywhere on Earth. Timezone only matters for *display* (already handled by the frontend's
existing `toLocaleString()` calls), never for computing whether a reminder is due. §11.13 ties
working days/hours/holidays explicitly to "SLA and TAT clocks" (Module 9's own consumer) — nothing
in §11.5 asks reminders to respect business hours, so none was invented.

*Configuration.* `Organization.interviewReminderLeadMinutes` (`Int[]`, default `[1440, 60]`) is
one org-wide list, not a per-interview override — the PRD names no per-job/per-interview variant,
and `Organization` is already this app's one existing global-settings singleton
(workingDays/workingHours/timezone), previously registered in `entity-registry.ts` but never
actually wired to any route or UI since Module 1. `/admin/interview-reminders` (a fixed preset
checklist — 15 min/30 min/1h/2h/4h/1 day/2 days — not free-text minute entry) and
`GET`/`PATCH /api/organization` are the first things to actually use that registration.

**Scheduled reports (§11.12, Module 9) — reused, not rewritten, with one real bug fixed along the
way.** `runDueScheduledReports` itself is untouched in shape: it still resolves each report's
*creator's* own RBAC scope via `getSessionContextForUser` before rendering/sending, the same
row-level-security guarantee ad-hoc report viewing already gets. What changed is the claim before
that work starts. The first fix attempt used only `SavedReport.version` (already present for the
CRUD edit path's own optimistic locking) as an atomic claim, incrementing it before sending — this
closes the race between two callers reading the *identical* stale version simultaneously, but an
adversarial review found it does **not** close a subtler race: rendering and sending a report is
not instant, and the column `isDue()` actually reads (`lastRunAt`) was left untouched until *after*
the send finished. A second scheduler tick starting mid-send would do its own fresh read, see the
already-incremented version (not stale to *it*) and the still-old `lastRunAt` (still "due" to it),
and successfully claim and send a second time. The fix: stamp `lastRunAt: now` as part of the
*same* atomic `updateMany` that increments version, not after the send — so any tick that starts
once this one has claimed sees a fresh `lastRunAt` for the whole duration of the send, not just at
the instant of the claim. `MAX_REPORTS_PER_RUN` (100) bounds the batch, ordered
`lastRunAt: {sort: "asc", nulls: "first"}` so never-run reports can't starve behind an
already-run backlog under Postgres's default NULLS LAST. One residual, documented limitation: if
the process crashes after the mail provider confirms success but before the finalize `update`
commits, the row can be claimed and sent again by a later tick — true exactly-once delivery to an
external system needs a transactional outbox or provider-side idempotency keys, out of scope here;
this is an at-least-once, not exactly-once, guarantee, same as the interview-reminder claim's own
inherent trade-off.

**`TIME_IN_STAGE` workflows (§10.2, Module 10) — engine untouched, one bound added.** No change to
`evaluateConditions`, `claimExecutionSlot`, or `runActionsAndFinalize` — the existing idempotency
guard (`WorkflowExecution`'s unique `(version, applicationId, fingerprint)` constraint) was
already correct and is reused exactly as-is. The only change:
`prisma.application.findMany`'s per-definition due-application fetch inside
`runDueTimeInStageWorkflows` now takes `MAX_APPLICATIONS_PER_DEFINITION_PER_RUN` (200), the same
"bound the batch, work off a backlog over several ticks" discipline every other consumer in this
module follows.

**Observability.** Every interview-reminder attempt (`interview_reminder.sent`/`.failed`) and
every scheduler invocation (`scheduler.run`, `actorId: null` — there is no human actor for a
machine-triggered run) writes an `AuditLog` row via the existing `recordAudit` helper, the same
audit trail every other module's actions already flow through. The scheduler endpoint's own
response and audit entry report each consumer's name, success/failure, and duration — never
message bodies, attachment contents, or the configured secret itself.

**Self-review found and fixed one more real issue beyond the scheduled-reports race above**: the
per-recipient send path (`sendOneReminder`) originally called `prisma.communicationTemplate.findFirst`
once per recipient — up to `MAX_REMINDERS_PER_RUN` (500) separate queries per scheduler tick for
what are really only two distinct template names. Fixed by resolving both templates once per
`runDueInterviewReminders` call into a small `Map`, threaded through to each send instead of
re-queried.

## Post-launch: Priority-A audit gap closure

A PRD-audit pass after Module 12 confirmed 13 gaps as real, in-scope, worth fixing (see
[project-status.md](project-status.md#post-launch-priority-a-audit-gap-closure) for the full
list mapped to specific PRD items). This section covers the architectural decisions behind the
three largest pieces of that work — the rest were narrower, single-file fixes documented inline
at their own call sites.

**Field-level permission enforcement: one shared choke point, not per-service masking.**
`getFieldAccess` (Module 1, `src/lib/authz/authorize.ts`) always correctly *resolved* a role's
per-field HIDDEN/READ/WRITE map; the gap was that nothing *applied* it. Rather than adding
ad-hoc `delete obj.field` calls scattered across every service, `src/lib/authz/field-sanitizer.ts`
exports two functions — `sanitizeForRead`/`sanitizeManyForRead` (strip HIDDEN fields from a
response) and `assertWritableFields` (reject a create/update payload that sets a field the
caller only has HIDDEN/READ access to) — and every service that exposes a
`FieldPermission`-capable resource calls both at its own read/write boundary. A restricted custom
field is addressed as `"customFields.<key>"` in `FieldPermission.field`, so one map covers core
columns and admin-defined custom fields without a second mechanism. Custom Object records (gap
12 below) reuse this exact module via a local `{ ...record, customFields: record.data }` alias
around the call, rather than teaching the shared module a second field name — `data` on
`CustomObjectRecord` plays the same role `customFields` plays on every core entity.

**Configurable multi-step approval chains: admin-configured order, snapshotted at submit time.**
Job and Offer each had a fixed, single-decision approval step. `src/lib/services/approvals.ts`
is a new shared module (used by both `jobs.ts` and `offers.ts`, not duplicated) with:
- `ApprovalStepConfig` CRUD (`listApprovalStepConfigs`/`replaceApprovalStepConfigs`, full-set
  delete+recreate matching `replaceRolePermissions`'s own convention) — gated at `JOB:UPDATE`/
  `OFFER:UPDATE` **ALL scope specifically** (`assertAllScopeUpdate`), not just any UPDATE grant,
  since an ordinary recruiter's OWN-scope `JOB:UPDATE` (for editing their own jobs) must not
  extend to reconfiguring the org-wide chain. No seeded role holds that ALL-scope grant — the
  same "super-admin only in practice" shape Organization settings already established.
- `buildApprovalStepSnapshots(tx, entityType)` — read once, at SUBMIT time, into the entity's own
  `JobApproval`/`OfferApproval` rows (full copies of `stepOrder`/`name`/`requiredRoleId`/
  `requiredRoleName`, not a live foreign key to the config). A later admin edit to
  `ApprovalStepConfig` therefore never rewrites an in-progress or historical chain — verified by
  a dedicated test that clears the config mid-flight and confirms an already-submitted Job still
  requires its original two snapshotted steps, in order.
- `selectCurrentPendingStep`/`assertCanDecideStep`/`isChainComplete` — generic helpers `jobs.ts`/
  `offers.ts` call from their own `decideJobApprovalStep`/`decideOfferApprovalStep`. Deciding a
  step is gated by **two independent checks**: the entity's existing scope-based
  `assertJobAccess`/`assertOfferAccess` (unchanged, still the front door), and — only when the
  current step has a configured `requiredRoleId` — that the actor actually holds that specific
  role. A step with `requiredRoleId: null` (the legacy no-chain row) needs no second check,
  preserving today's single-step behavior byte-for-byte for any Job/Offer with no chain
  configured. The step row's own `PENDING`-guarded `updateMany` (inside a `$transaction` that
  also flips the entity's overall status once the chain completes) is the concurrency guard — a
  losing concurrent decision gets `count === 0` and a `ConflictError`, independent of the
  entity's own optimistic-lock `version` field.

**Custom Object record/relation CRUD, and a relation-scoping fix a security review caught.**
`CustomObjectRecord`/`CustomObjectRelation` existed in the schema since Module 1 but were never
exposed — `src/lib/services/custom-object-records.ts` is the first service to use them. Records
are gated by the same `CUSTOM_OBJECT_DEFINITION` permission as the definitions themselves (no new
RBAC resource per object type); `data` is validated against that object's own active
`CustomFieldDefinition` rows via the same `buildCustomFieldValueSchema` dynamic-schema builder
every core entity's `customFields` blob already goes through. A relation may only point at a core
entity (`CUSTOM_FIELD_CAPABLE_ENTITIES` — Job/Candidate/Application/Interview/Offer/Handoff), per
the model's own schema comment, not at another Custom Object record.

An independent security review of this new surface (run as part of closing out this audit pass)
found that the initial implementation checked only that the target entity *existed*
(`prisma.job.count(...)`, etc.) before linking — it never checked that the *caller* actually had
`READ` access to that specific entity in their own RBAC scope. That meant a user holding only
`CUSTOM_OBJECT_DEFINITION:UPDATE` at ALL scope (a plausible standalone "custom-objects admin"
role with no broad Job/Candidate/etc. access) could link, and later see the id of, a record
entirely outside their own scope for that resource — and could probe arbitrary ids for existence
via the `NotFoundError`-vs-success distinction. Fixed by resolving each target's own ownership
field (mirroring `assertJobAccess`/`assertCandidateAccess`/`assertApplicationAccess`/
`assertManageAccess`/`assertOfferAccess`/`assertHandoffAccess`'s own ownership fields exactly —
`primaryRecruiterId`, `createdById`, `ownerId`, `scheduledById`, `createdById`, `initiatedById`
respectively) and running the same `can(context, relatedEntityType, "READ", { ownerId })` check
every direct-access route already runs, before a relation can be created. This brings the new
surface to parity with how the rest of the app already treats "does this id exist" vs. "can this
caller see it" — not a new leak class, just this one new code path missing a check the rest of
the app already has everywhere else.
