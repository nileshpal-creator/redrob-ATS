# Database

Source of truth: `prisma/schema.prisma`. This document summarizes it — refer to the schema
file for exact column definitions.

## ER overview

```
Organization ──1:N── Holiday

User ──N:1── User (managerId, self-relation "UserManager")
User ──N:N── Role   (through UserRole)

Role ──1:N── RolePermission
Role ──1:N── FieldPermission

ControlledList ──1:N── ControlledListValue

CustomFieldDefinition        (standalone metadata; entityType is a string, not an FK)
CustomObjectDefinition ──1:N── CustomObjectRecord ──1:N── CustomObjectRelation

AuditLog ──N:1── User (actorId, optional)

Job ──N:1── ControlledListValue  (departmentId → "JobDepartment")
Job ──N:1── ControlledListValue  (locationId   → "JobLocation")
Job ──N:1── User                 (primaryRecruiterId → "JobPrimaryRecruiter")
Job ──N:1── User                 (createdById       → "JobCreatedBy")
Job ──N:1── Job                  (parentJobId → "JobParent", self-relation, optional)
Job ──1:N── JobRecruiterAssignment ──N:1── User
Job ──1:N── JobStatusChange ──N:1── User (actorId)
                             ──N:1── ControlledListValue (reasonId, optional)
```

## Module 1 tables

| Table | Purpose |
| --- | --- |
| `User` | Application users. `managerId` self-relation drives the `TEAM` permission scope. |
| `Role` | Admin-defined roles. `isSystem` marks seeded roles that can't be deleted; `isSuperAdmin` bypasses all permission checks. |
| `UserRole` | User ↔ Role join, composite PK `(userId, roleId)`. |
| `RolePermission` | One `(resource, action, scope)` grant per row. Unique on `(roleId, resource, action)`. |
| `FieldPermission` | One `(resource, field, access)` rule per row. Unique on `(roleId, resource, field)`. |
| `Organization` | Singleton by convention (`id = "default"`, not DB-enforced). Timezone, working days/hours. |
| `Holiday` | Organization holidays, used for future SLA/TAT clocks. |
| `ControlledList` | A named list (`key`), e.g. `"DEPARTMENT"`. `isSystem` marks seeded, non-deletable lists. |
| `ControlledListValue` | One selectable value in a list. Unique on `(listId, value)`. |
| `CustomFieldDefinition` | Metadata for one admin-defined field on one `entityType`. Unique on `(entityType, key)`. |
| `CustomObjectDefinition` | Metadata for one admin-defined object type. `apiKey` unique. |
| `CustomObjectRecord` | One JSON-blob record (`data`) of a `CustomObjectDefinition`. |
| `CustomObjectRelation` | Links a `CustomObjectRecord` to any core entity by `(relatedEntityType, relatedEntityId)`. |
| `AuditLog` | One entry per audited action. `action`/`entityType` are free-form strings (see `src/lib/audit/actions.ts`, `src/lib/entity-registry.ts`), not DB enums. |

## New Module 2 tables

| Table | Purpose |
| --- | --- |
| `Job` | One job requisition. See columns below. |
| `JobRecruiterAssignment` | Which users are assigned to a job, and which one is primary. Composite PK `(jobId, userId)`. |
| `JobStatusChange` | Immutable history row for every status transition a job goes through. |

### `Job` columns

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `String` (cuid) | |
| `title` | `String` | |
| `departmentId` | `String` | FK → `ControlledListValue`, must belong to the `DEPARTMENT` list and be active. |
| `locationId` | `String` | FK → `ControlledListValue`, must belong to the `LOCATION` list and be active. |
| `employmentType` | `EmploymentType` | enum |
| `priority` | `JobPriority` | enum |
| `status` | `JobStatus` | enum, default `DRAFT` |
| `positionsCount` | `Int` | positive, set at creation |
| `positionsFilledCount` | `Int` | default `0`; **read-only** — no Module 2 code writes to it; reserved for a future Offer/Application module to auto-maintain |
| `targetDate` | `DateTime?` | optional |
| `description` | `String?` | optional, up to 20,000 chars at the validation layer |
| `mustHaveCriteria` | `String[]` | structured list, not free text; deduplicated and trimmed at the validation layer |
| `goodToHaveCriteria` | `String[]` | same shape as `mustHaveCriteria` |
| `customFields` | `Json?` | validated against active `CustomFieldDefinition` rows for `entityType = "JOB"` |
| `parentJobId` | `String?` | FK → `Job`, self-relation, optional, no additional validation beyond existence (Phase 1 decision: flexible parent/child linking) |
| `primaryRecruiterId` | `String` | FK → `User`; the ownership anchor for every permission check on this job (see [architecture.md](architecture.md#job-workflow)) |
| `createdById` | `String` | FK → `User` |
| `version` | `Int` | default `0`; internal optimistic-locking counter, incremented on every update/recruiter-change/status-transition |
| `createdAt` / `updatedAt` | `DateTime` | |

Deliberately **not** on `Job`, per the PRD-alignment refinement (see
[project-status.md](project-status.md#known-limitations)): a human-readable job code/requisition
number, a `hiringManagerId` field, and any salary/compensation fields. None of these are named
in the PRD's §11.1 requirements, and the first two would have expanded the data model and/or
introduced new user-facing functionality beyond it.

### `JobRecruiterAssignment` columns

| Column | Type | Notes |
| --- | --- | --- |
| `jobId`, `userId` | `String` | composite PK |
| `isPrimary` | `Boolean` | exactly one `true` row per `jobId`, enforced by a hand-written partial unique index (below) |
| `assignedAt` | `DateTime` | |

### `JobStatusChange` columns

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `String` (cuid) | |
| `jobId` | `String` | FK → `Job` |
| `fromStatus` / `toStatus` | `JobStatus` | |
| `reasonId` | `String?` | FK → `ControlledListValue`; required by the service when the transition's `reasonRequired` is `true` |
| `note` | `String?` | free-text, optional, up to 2,000 chars |
| `actorId` | `String` | FK → `User` |
| `createdAt` | `DateTime` | |

## Relationships

- **User self-relation (`UserManager`)**: `User.managerId → User.id`. Drives
  `getTeamMemberIds()` — a user's "team" for `TEAM`-scoped permissions is themself plus their
  direct reports.
- **Job self-relation (`JobParent`)**: `Job.parentJobId → Job.id`, `onDelete: SetNull`. Flexible
  parent/child linking with no cardinality or type constraints beyond existence.
- **Job → ControlledListValue** (×2, named relations `JobDepartment` / `JobLocation`): both
  `departmentId` and `locationId` reference the same `ControlledListValue` table but are
  validated against different `ControlledList.key`s (`DEPARTMENT` / `LOCATION`) at the service
  layer — Prisma's schema can't express "this FK must point into list X" directly.
- **Job → User** (×2, named relations `JobPrimaryRecruiter` / `JobCreatedBy`): distinct from the
  many-to-many `JobRecruiterAssignment` relation — `primaryRecruiterId` is a direct FK for fast
  ownership lookups without a join, while the full assigned-recruiter set (including the
  primary) also appears in `JobRecruiterAssignment`.
- **JobStatusChange → ControlledListValue** (optional): only populated for transitions whose
  `reasonRequired` is `true` (`HOLD`, `CLOSE`, `CANCEL`).

## Enums

| Enum | Values | Used by |
| --- | --- | --- |
| `PermissionAction` | `CREATE`, `READ`, `UPDATE`, `DELETE`, `APPROVE` | `RolePermission.action` |
| `PermissionScope` | `OWN`, `TEAM`, `ALL` | `RolePermission.scope` |
| `FieldAccess` | `HIDDEN`, `READ`, `WRITE` | `FieldPermission.access` |
| `CustomFieldType` | `TEXT`, `NUMBER`, `DATE`, `DROPDOWN`, `MULTI_SELECT`, `LOOKUP` | `CustomFieldDefinition.fieldType` |
| `JobStatus` | `DRAFT`, `PENDING_APPROVAL`, `OPEN`, `ON_HOLD`, `CLOSED`, `CANCELLED` | `Job.status`, `JobStatusChange.fromStatus`/`toStatus` |
| `EmploymentType` | `FULL_TIME`, `PART_TIME`, `CONTRACT`, `INTERNSHIP`, `TEMPORARY` | `Job.employmentType` |
| `JobPriority` | `LOW`, `MEDIUM`, `HIGH`, `URGENT` | `Job.priority` |

`APPROVE` was added to `PermissionAction` in Module 2 (Phase 1 decision: approval must be its
own permission, not overloaded onto `UPDATE`). No other enum changed.

**Not enums, by design**: `RolePermission.resource` / `FieldPermission.resource` /
`CustomFieldDefinition.entityType` / `AuditLog.entityType` / `AuditLog.action` are plain
`String` columns, validated against TypeScript registries (`src/lib/entity-registry.ts`,
`src/lib/audit/actions.ts`) instead of database enums — so a new module registers a new
resource/entity/action string without a schema migration.

## Controlled Lists

Seeded by `prisma/seed.ts` (idempotent upsert). `isSystem = true` for all eight; non-deletable
via the admin UI.

| Key | Seeded starter values | Consumed by |
| --- | --- | --- |
| `REJECTION_REASON` | *(none yet — reserved for the future Pipeline/Application module, §11.4)* | — |
| `CANDIDATE_SOURCE` | *(none yet — reserved for the future Candidate module, §11.2)* | — |
| `DOCUMENT_TYPE` | *(none yet — reserved for the future Candidate module, §11.2)* | — |
| `LOCATION` | `Remote`, `Head Office` | `Job.locationId` |
| `DEPARTMENT` | `Engineering`, `Sales`, `Marketing`, `Finance`, `Human Resources`, `Operations` | `Job.departmentId` |
| `JOB_HOLD_REASON` | *(none seeded — add via the admin UI before using HOLD)* | `JobStatusChange.reasonId` on `HOLD` |
| `JOB_CLOSE_REASON` | *(none seeded)* | `JobStatusChange.reasonId` on `CLOSE` |
| `JOB_CANCEL_REASON` | *(none seeded)* | `JobStatusChange.reasonId` on `CANCEL` |

Values are read via `GET /api/controlled-lists/[key]` (ungated — see
[api.md](api.md#get-apicontrolled-listskey)), which returns only active values, sorted by
`sortOrder`.

## Migrations

Applied in order:

1. `20260806133643_init_module1_foundation` — Module 1 schema (User, Role, permissions,
   Organization, Controlled Lists, Custom Fields/Objects, Audit Log).
2. `20260806134234_add_user_manager_relation` — adds `User.managerId` self-relation.
3. `20260806152110_module2_job_management` — adds `Job`, `JobRecruiterAssignment`,
   `JobStatusChange`, `JobStatus`, `EmploymentType`, `JobPriority` enums, and `APPROVE` to
   `PermissionAction`.
4. `20260806152123_job_recruiter_primary_partial_index` — **hand-written SQL** (not
   expressible in `schema.prisma` syntax): a partial unique index,
   `CREATE UNIQUE INDEX job_recruiter_one_primary ON "JobRecruiterAssignment"("jobId") WHERE
   "isPrimary" = true`, enforcing exactly one primary recruiter per job at the database level.
5. `20260806154647_remove_non_prd_job_fields` — **hand-written SQL**, part of the
   PRD-alignment refinement: drops `code`, `sequenceNumber`, `hiringManagerId`, `salaryMin`,
   `salaryMax`, `salaryVisible`, and `currency` from `Job`, none of which are named in the
   PRD's §11.1 requirements.

Run `npx prisma migrate deploy` to apply all migrations without generating a new one (CI,
production, and the test database's global setup); `npx prisma migrate dev` during local
development to create and apply a new migration after a schema change.
