# Architecture

This document describes the system as actually implemented through Module 2, Phase 5. It is
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
      jobs/                   Job list, /jobs/new, /jobs/[id], /jobs/[id]/edit
    api/                      Route handlers — thin, one per src/lib/services export
    login/                    Sign-in page (outside the authenticated shell)
  components/
    ui/                       Hand-vendored shadcn primitives
    layout/                   App shell, sidebar, nav
    admin/                    Admin-page-specific components
    auth/                     Login form
    authz/                    PermissionGate — UI-level hiding, not enforcement
    custom-fields/            Generic custom-field form section, reused by any entity form
    jobs/                     Job form, recruiter picker, tag input, status action controls
  config/
    nav.ts                    Nav item definitions, gated per-item by permission
  lib/
    auth/                     auth.config.ts (edge-safe) vs. src/auth.ts (full config)
    authz/                    session-context, authorize()/can()/getFieldAccess(), guard helpers
    audit/                    actions.ts (audit action registry) + log.ts (recordAudit)
    custom-fields/            dynamic Zod schema builder for admin-defined fields
    jobs/                     status-machine.ts — the Job status transition table
    services/                 permission-checked business logic; one file per resource
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
