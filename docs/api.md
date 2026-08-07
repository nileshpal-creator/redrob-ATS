# API Reference

All routes live under `src/app/api/**/route.ts` and are wrapped in `withApiHandler`
(`src/lib/api/handlers.ts`), which:

1. Resolves the caller's session. **Every route below requires an authenticated session** —
   a request with no valid session cookie always gets `401 { "error": "Unauthorized" }`,
   before the route body runs. This is omitted from each endpoint's status-code list below to
   avoid repetition; only the codes specific to that endpoint are listed.
2. Runs the route body, which parses the request (query string or JSON body) with a Zod schema
   and calls exactly one service function.
3. Maps thrown domain errors to a response:

| Error | Status | Body |
| --- | --- | --- |
| `ForbiddenError` | `403` | `{ "error": "<message>" }` |
| `NotFoundError` | `404` | `{ "error": "<message>" }` |
| `ValidationError` | `400` | `{ "error": "<message>" }` |
| `DuplicateCandidateError` (extends `ConflictError`) | `409` | `{ "error": "<message>", "existingCandidateId": "<id>" }` |
| `ConflictError` | `409` | `{ "error": "<message>" }` |
| `ZodError` (schema parse failure) | `400` | `{ "error": "Invalid input", "issues": [...] }` |
| malformed JSON body (`SyntaxError`) | `400` | `{ "error": "Malformed request body." }` |
| anything else | `500` | `{ "error": "Internal server error" }` (logged server-side) |

A successful call returns the service function's return value as JSON with a `200` status
(mutations that return nothing, e.g. `DELETE`, get `{ "ok": true }`).

"Permissions" below names the `(resource, action, scope)` grant a role needs — see
[architecture.md#rbac](architecture.md#rbac). `isSuperAdmin` roles bypass every check listed.

## Jobs

### `GET /api/jobs`

List jobs, filtered and scoped to what the caller is permitted to see.

- **Query params** (`jobQuerySchema`): `status?`, `departmentId?`, `locationId?`, `priority?`,
  `recruiterId?`, `q?` (case-insensitive title search), `page?` (default `1`),
  `pageSize?` (default `25`, max `100`).
- **Response**: `{ jobs: Job[], total: number, page: number, pageSize: number }`. Each `Job`
  includes `department`, `location`, `primaryRecruiter`, and `recruiters` (with `user`).
- **Permissions**: `JOB:READ`. The effective scope (`ALL`/`TEAM`/`OWN`) is resolved via
  `getEffectiveScope` and applied as a `WHERE primaryRecruiterId ...` filter — `OWN` restricts
  to jobs where the caller is primary recruiter, `TEAM` to the caller and their direct reports.
- **Status codes**: `200` success · `400` invalid query params (e.g. unknown `status`) ·
  `403` no `JOB:READ` grant at any scope.

### `POST /api/jobs`

Create a job requisition (always created in `DRAFT` status).

- **Request body** (`jobCreateSchema`):
  ```json
  {
    "title": "string, 1-200 chars",
    "departmentId": "string — must be an active DEPARTMENT ControlledListValue id",
    "locationId": "string — must be an active LOCATION ControlledListValue id",
    "employmentType": "FULL_TIME | PART_TIME | CONTRACT | INTERNSHIP | TEMPORARY",
    "priority": "LOW | MEDIUM | HIGH | URGENT",
    "positionsCount": "positive integer",
    "targetDate": "ISO date string, optional",
    "description": "string, optional, max 20000 chars",
    "mustHaveCriteria": "string[], optional — deduplicated, each trimmed 1-300 chars, max 50",
    "goodToHaveCriteria": "string[], optional — same shape as mustHaveCriteria",
    "parentJobId": "string, optional — must reference an existing job",
    "recruiterUserIds": "string[], min 1 — must all be active users",
    "primaryRecruiterUserId": "string — must be one of recruiterUserIds",
    "customFields": "object, optional — validated against active JOB custom field definitions"
  }
  ```
- **Response**: the created `Job`, with `department`, `location`, `primaryRecruiter`,
  `recruiters`, `createdBy`, `parentJob`, `childJobs` (empty), `statusChanges` (empty).
- **Permissions**: `JOB:CREATE`.
- **Status codes**: `200` created · `400` schema validation failure, or a referenced
  department/location/parent job/recruiter/custom field is invalid or inactive ·
  `403` no `JOB:CREATE` grant.

### `GET /api/jobs/[id]`

Fetch one job's full detail.

- **Response**: the `Job` with the full detail include (department, location,
  primaryRecruiter, recruiters, createdBy, parentJob, childJobs, statusChanges with actor and
  reason).
- **Permissions**: `JOB:READ` at `ALL` scope, or at `OWN`/`TEAM` scope where the caller (or
  their team) is the job's primary recruiter.
- **Status codes**: `200` success · `403` caller has no qualifying grant for this job ·
  `404` no job with that id.

### `PATCH /api/jobs/[id]`

Partially update a job. Requires optimistic-locking `version`.

- **Request body** (`jobUpdateSchema`): `version` (required, integer) plus any subset of
  `title`, `departmentId`, `locationId`, `employmentType`, `priority`, `positionsCount`,
  `targetDate` (nullable), `description`, `mustHaveCriteria`, `goodToHaveCriteria`,
  `parentJobId` (nullable), `customFields`. Does **not** accept `recruiterUserIds` or
  `primaryRecruiterUserId` — use `PUT /api/jobs/[id]/recruiters` for those.
- **Response**: the updated `Job` (full detail include), with `version` incremented by 1.
- **Permissions**: same ownership rule as `GET /api/jobs/[id]`, but for `JOB:UPDATE`.
- **Status codes**: `200` success · `400` schema/reference validation failure (e.g. setting
  a job as its own parent) · `403` no qualifying grant · `404` job not found · `409` the
  supplied `version` no longer matches the stored row (someone else updated it first — reload
  and retry).

### `PUT /api/jobs/[id]/recruiters`

Replace a job's entire recruiter assignment set.

- **Request body** (`jobRecruitersUpdateSchema`):
  ```json
  {
    "version": "integer, required",
    "assignments": [
      { "userId": "string", "isPrimary": true },
      { "userId": "string", "isPrimary": false }
    ]
  }
  ```
  Exactly one `isPrimary: true` entry, no duplicate `userId`s, at least one assignment.
- **Response**: the updated `Job` (full detail include) with the new `recruiters` list and
  `primaryRecruiterId` set to the primary assignment's `userId`.
- **Permissions**: same ownership rule as `PATCH /api/jobs/[id]`, checked against `JOB:UPDATE`
  and the job's *current* `primaryRecruiterId` (before the change is applied).
- **Status codes**: `200` success · `400` schema validation failure, or an assigned user is
  not found/inactive · `403` no qualifying grant · `404` job not found · `409` version
  mismatch.

### `POST /api/jobs/[id]/status`

Move a job through the approval/status workflow. See
[architecture.md#job-workflow](architecture.md#job-workflow) for the full transition table.

- **Request body** (`jobStatusActionSchema`):
  ```json
  {
    "action": "SUBMIT | APPROVE | REJECT | HOLD | RESUME | CLOSE | CANCEL",
    "version": "integer, required",
    "reasonId": "string — required for HOLD, CLOSE, CANCEL; must belong to that action's reason list",
    "note": "string, optional, max 2000 chars"
  }
  ```
- **Response**: the updated `Job` (full detail include), with a new `JobStatusChange` row
  reflected in `statusChanges`.
- **Permissions**: `SUBMIT`/`HOLD`/`RESUME`/`CLOSE`/`CANCEL` require `JOB:UPDATE`;
  `APPROVE`/`REJECT` require `JOB:APPROVE` — in both cases at `ALL` scope, or at `OWN`/`TEAM`
  scope against the job's primary recruiter.
- **Status codes**: `200` success · `400` the action isn't legal from the job's current
  status, or a required `reasonId` is missing/invalid · `403` no qualifying grant for the
  action's required permission · `404` job not found · `409` version mismatch.

There is intentionally **no `DELETE /api/jobs/[id]`**. Normal workflows move a job to
`CANCELLED` via the status endpoint instead of deleting it (Phase 1 decision: no hard delete
from the UI).

## Candidates

### `GET /api/candidates`

List candidates, filtered and scoped to what the caller is permitted to see.

- **Query params** (`candidateQuerySchema`): `q?` (case-insensitive match against name, phone,
  or email), `skills?` (repeatable, matches any), `tags?` (repeatable, matches any), `location?`
  (case-insensitive contains), `sourceId?`, `noticePeriodMaxDays?`, `experienceMinYears?`,
  `experienceMaxYears?`, `compensationMaxExpected?`, `page?` (default `1`), `pageSize?` (default
  `25`, max `100`).
- **Response**: `{ candidates: Candidate[], total: number, page: number, pageSize: number }`.
  Each `Candidate` includes `source`.
- **Permissions**: `CANDIDATE:READ`. The effective scope (`ALL`/`TEAM`/`OWN`) is resolved via
  `getEffectiveScope` and applied as a `WHERE createdById ...` filter — `OWN` restricts to
  candidates the caller created, `TEAM` to the caller and their direct reports.
- **Status codes**: `200` success · `400` invalid query params · `403` no `CANDIDATE:READ`
  grant at any scope.

### `POST /api/candidates`

Create a candidate.

- **Request body** (`candidateCreateSchema`):
  ```json
  {
    "name": "string, 1-120 chars",
    "phone": "string, 7-20 chars, matches /^[0-9+\\-() ]{7,20}$/ — the hard duplicate key",
    "email": "string, optional, valid email, lowercased — a soft duplicate signal only",
    "location": "string, optional, max 200 chars",
    "currentCompensation": "number, optional, >= 0",
    "expectedCompensation": "number, optional, >= 0",
    "noticePeriodDays": "integer, optional, >= 0",
    "earliestAvailability": "ISO date string, optional",
    "totalExperienceYears": "number, optional, >= 0",
    "skills": "string[], optional, deduplicated, max 50",
    "tags": "string[], optional, deduplicated, max 50",
    "experienceHistory": "[{ company, title, startDate, endDate?, description? }], optional, max 20",
    "educationHistory": "[{ institution, degree, fieldOfStudy?, startYear?, endYear? }], optional, max 20",
    "sourceId": "string, optional — must be an active CANDIDATE_SOURCE ControlledListValue id",
    "consentGivenAt": "ISO date string — required, never inferred",
    "customFields": "object, optional — validated against active CANDIDATE custom field definitions"
  }
  ```
- **Response**: the created `Candidate` (full detail include: `source`, `createdBy`,
  `documents`, `notes`), plus `possibleDuplicateOf: string | null` — a matching candidate's id
  if `email` matched an existing candidate (informational only, never blocking).
- **Permissions**: `CANDIDATE:CREATE`.
- **Status codes**: `200` created · `400` schema validation failure (including a missing
  `consentGivenAt`), or an invalid/inactive `sourceId` or custom field · `403` no
  `CANDIDATE:CREATE` grant · `409` a candidate with this `phone` already exists — body is
  `{ "error": "<message>", "existingCandidateId": "<id>" }`.

### `GET /api/candidates/[id]`

Fetch one candidate's full detail.

- **Response**: the `Candidate` with `source`, `createdBy`, `documents` (with `documentType`,
  `uploadedBy`), and `notes` (with `author`, newest first).
- **Permissions**: `CANDIDATE:READ` at `ALL` scope, or at `OWN`/`TEAM` scope where the caller
  (or their team) created the candidate.
- **Status codes**: `200` success · `403` caller has no qualifying grant for this candidate ·
  `404` no candidate with that id.

### `PATCH /api/candidates/[id]`

Partially update a candidate. Requires optimistic-locking `version`.

- **Request body** (`candidateUpdateSchema`): `version` (required, integer) plus any subset of
  `name`, `phone`, `email` (nullable), `location` (nullable), `currentCompensation` (nullable),
  `expectedCompensation` (nullable), `noticePeriodDays` (nullable), `earliestAvailability`
  (nullable), `totalExperienceYears` (nullable), `skills`, `tags`, `experienceHistory`,
  `educationHistory`, `sourceId` (nullable), `customFields`. Note `consentGivenAt` is **not**
  updatable through this endpoint — it is set once, at creation.
- **Response**: the updated `Candidate` (full detail include), with `version` incremented by 1.
- **Permissions**: same ownership rule as `GET /api/candidates/[id]`, but for
  `CANDIDATE:UPDATE`.
- **Status codes**: `200` success · `400` schema/reference validation failure · `403` no
  qualifying grant · `404` candidate not found · `409` the supplied `version` no longer matches
  the stored row, **or** the new `phone` already belongs to another candidate (body includes
  `existingCandidateId` in the latter case).

### `DELETE /api/candidates/[id]`

Delete a candidate, including its uploaded documents.

- **Response**: `{ "ok": true }`.
- **Permissions**: same ownership rule as above, for `CANDIDATE:DELETE`.
- **Status codes**: `200` success · `403` no qualifying grant · `404` candidate not found.

Every stored document's file is deleted via the configured `StorageProvider` before the
database row is removed — see
[architecture.md#storageprovider-abstraction](architecture.md#storageprovider-abstraction).

### `GET /api/candidates/duplicates`

Pre-flight duplicate check for the create form and import wizard — never mutates anything.

- **Query params** (`candidateDuplicateCheckSchema`): `phone` (required), `email?` (valid
  email).
- **Response**: `{ hardMatch: Candidate | null, softMatch: Candidate | null }` — `hardMatch` is
  a phone match (would block creation); `softMatch` is an email match excluding whichever
  candidate is already `hardMatch` (informational only).
- **Permissions**: `CANDIDATE:READ` at any scope (checked via `getEffectiveScope`, not against
  any one record — a plain `OWN`-scope grant, the common Recruiter case, still passes).
- **Status codes**: `200` success · `400` missing/invalid `phone` or `email` · `403` no
  `CANDIDATE:READ` grant at any scope.

### `POST /api/candidates/[id]/merge`

Merge another candidate (`sourceCandidateId`) into this one (the target, `[id]`). Fills only
the target's empty fields from the source, unions `skills`/`tags`, reassigns the source's
documents and notes to the target, then deletes the source. See
[architecture.md#merge-workflow](architecture.md#merge-workflow).

- **Request body** (`candidateMergeSchema`): `{ "sourceCandidateId": "string", "version":
  "integer — the target's current version" }`.
- **Response**: the updated target `Candidate` (full detail include), with its documents/notes
  now including the source's.
- **Permissions**: `CANDIDATE:UPDATE` on the target **and** `CANDIDATE:DELETE` on the source
  (both checked against each record's own ownership).
- **Status codes**: `200` success · `400` `sourceCandidateId` equals the target id, or the
  source candidate doesn't exist · `403` missing either required grant · `404` target
  candidate not found · `409` the target's `version` no longer matches the stored row.

### `POST /api/candidates/[id]/documents`

Upload a document (resume, cover letter, etc.) for a candidate.

- **Request**: `multipart/form-data` with fields `file` (the file) and `documentTypeId` (an
  active `DOCUMENT_TYPE` ControlledListValue id).
- **Response**: the created `CandidateDocument`, with `documentType` and `uploadedBy`.
- **Permissions**: `CANDIDATE:UPDATE` on the candidate.
- **Status codes**: `200` created · `400` not a multipart body, missing `file`, invalid/
  inactive `documentTypeId`, file over 10MB, or an unsupported MIME type (only `application/
  pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.
  wordprocessingml.document`, `image/png`, `image/jpeg` are accepted) · `403` no qualifying
  grant · `404` candidate not found.

### `GET /api/candidates/[id]/documents/[documentId]`

Download a candidate's document.

- **Response**: the raw file bytes, with `Content-Type` set to the stored `mimeType` and
  `Content-Disposition: attachment; filename="<fileName>"`.
- **Permissions**: `CANDIDATE:READ` on the candidate.
- **Status codes**: `200` success (binary body, not JSON) · `403` no qualifying grant · `404`
  candidate or document not found (or the document belongs to a different candidate).

### `DELETE /api/candidates/[id]/documents/[documentId]`

Delete a candidate's document (both the database row and the stored file).

- **Response**: `{ "ok": true }`.
- **Permissions**: `CANDIDATE:UPDATE` on the candidate.
- **Status codes**: `200` success · `403` no qualifying grant · `404` candidate or document not
  found.

### `GET /api/candidates/[id]/timeline`

Fetch a candidate's activity timeline.

- **Response**: `{ items: [{ type: "note", id, body, author, createdAt }, ...] }`, newest
  first. `type` is an extensible discriminant — see
  [architecture.md#timeline-architecture](architecture.md#timeline-architecture); only `"note"`
  exists as of Module 3.
- **Permissions**: `CANDIDATE:READ` on the candidate.
- **Status codes**: `200` success · `403` no qualifying grant · `404` candidate not found.

### `POST /api/candidates/[id]/notes`

Add a note to a candidate's timeline. Create-only — there is no update or delete endpoint for
notes.

- **Request body** (`candidateNoteSchema`): `{ "body": "string, 1-5000 chars" }`.
- **Response**: the created `CandidateNote`, with `author`.
- **Permissions**: `CANDIDATE:UPDATE` on the candidate.
- **Status codes**: `200` created · `400` empty or over-length `body` · `403` no qualifying
  grant · `404` candidate not found.

### `POST /api/candidates/import/preview`

Validate a bulk-import file without writing anything. See
[architecture.md#import-pipeline](architecture.md#import-pipeline).

- **Request**: `multipart/form-data` with field `file` — a `.csv` or `.xlsx` file with
  case-insensitive columns: `name`, `phone`, `email`, `location`, `currentCompensation`,
  `expectedCompensation`, `noticePeriodDays`, `earliestAvailability`, `totalExperienceYears`,
  `skills` (`;`/`,`-separated), `tags` (same), `sourceId`, `consentGivenAt`.
- **Response**: `{ rows: [...] }`, one entry per file row, 1-indexed by `row`:
  ```json
  { "row": 1, "data": { "...": "parsed candidate fields" }, "status": "valid" }
  { "row": 2, "data": { "...": "..." }, "status": "invalid", "errors": ["Name is required"] }
  { "row": 3, "data": { "...": "..." }, "status": "duplicate", "existingCandidateId": "<id>" }
  ```
  A row whose phone repeats an earlier `valid` row in the *same file* is marked `invalid` with
  `errors: ["Duplicate phone with row <n> in this file."]`, since only the first would ever be
  created on commit.
- **Permissions**: `CANDIDATE:CREATE` (the permission the eventual commit will need).
- **Status codes**: `200` success (even if every row is `invalid`/`duplicate` — this endpoint
  never fails on bad *data*, only on a bad *request*) · `400` not a multipart body, or no `file`
  field · `403` no `CANDIDATE:CREATE` grant.

### `POST /api/candidates/import/commit`

Create candidates from previously previewed (and corrected) rows. Re-validates and re-checks
duplicates server-side — it never trusts the client-supplied preview.

- **Request body** (`candidateImportCommitSchema`): `{ "rows": [<candidateCreateSchema
  object>, ...], "min 1, max 500" }` — typically the `data` of each `valid` row returned by
  the preview endpoint.
- **Response**: `{ "created": [Candidate, ...], "skipped": [{ "row": number, "reason": string,
  "existingCandidateId"?: string }, ...] }`. A row that fails only with a duplicate-phone
  conflict is skipped and reported rather than aborting the whole commit; any other error
  aborts the request.
- **Permissions**: `CANDIDATE:CREATE`.
- **Status codes**: `200` success (some rows may still be `skipped` — inspect the response body)
  · `400` schema validation failure, more than 500 rows, or a non-duplicate error on any row ·
  `403` no `CANDIDATE:CREATE` grant.

### `GET /api/candidates/export`

Export the caller's visible candidates as a file.

- **Query params** (`candidateExportQuerySchema`): the same filters as `GET /api/candidates`
  (minus `page`/`pageSize` — export always returns every matching row), plus `format?` (`csv`
  default, or `xlsx`).
- **Response**: the file's raw bytes, with `Content-Type` set to `text/csv` or
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, and
  `Content-Disposition: attachment; filename="candidates-export.<format>"`. Columns: Name,
  Phone, Email, Location, Current Compensation, Expected Compensation, Notice Period (days),
  Earliest Availability, Experience (years), Skills, Tags, Source, Created At.
- **Permissions**: `CANDIDATE:READ` — reuses the same permission and scope filtering as
  `GET /api/candidates` rather than a separate export permission (see
  [architecture.md#export-pipeline](architecture.md#export-pipeline)).
- **Status codes**: `200` success (binary body, not JSON) · `400` invalid query params · `403`
  no `CANDIDATE:READ` grant at any scope.

Every export is audit-logged (`candidate.exported`) with the requested format and the row
count actually returned — never a full row dump of exported data.

## Roles & Permissions

### `GET /api/roles`

List all roles.

- **Response**: `Role[]`, each with `_count.users`, `rolePermissions`, `fieldPermissions`.
- **Permissions**: `ROLE:READ`.
- **Status codes**: `200` success · `403` no `ROLE:READ` grant.

### `POST /api/roles`

Create a role.

- **Request body** (`roleSchema`): `{ "name": "string, 1-80 chars", "description": "string, optional, max 500 chars" }`.
- **Response**: the created `Role`.
- **Permissions**: `ROLE:CREATE`.
- **Status codes**: `200` created · `400` a role with that name already exists, or schema
  validation failure · `403` no `ROLE:CREATE` grant.

### `PATCH /api/roles/[id]`

Update a role's name/description.

- **Request body** (`roleUpdateSchema`): `roleSchema`, all fields optional.
- **Response**: the updated `Role`.
- **Permissions**: `ROLE:UPDATE`.
- **Status codes**: `200` success · `400` schema validation failure · `403` no `ROLE:UPDATE`
  grant · `404` role not found.

### `DELETE /api/roles/[id]`

Delete a role.

- **Response**: `{ "ok": true }`.
- **Permissions**: `ROLE:DELETE`.
- **Status codes**: `200` success · `400` the role is a system role, or still has users
  assigned to it · `403` no `ROLE:DELETE` grant · `404` role not found.

### `PUT /api/roles/[id]/permissions`

Replace a role's entire permission grant set (both entity-level and field-level) in one
transaction — the permission matrix UI submits its full desired state.

- **Request body** (`rolePermissionsUpdateSchema`):
  ```json
  {
    "permissions": [
      { "resource": "string", "action": "CREATE | READ | UPDATE | DELETE | APPROVE", "scope": "OWN | TEAM | ALL" }
    ],
    "fieldPermissions": [
      { "resource": "string", "field": "string", "access": "HIDDEN | READ | WRITE" }
    ]
  }
  ```
  `fieldPermissions` defaults to `[]` if omitted.
- **Response**: the `Role` with its new `rolePermissions` and `fieldPermissions`.
- **Permissions**: `ROLE:UPDATE`.
- **Status codes**: `200` success · `400` schema validation failure · `403` no `ROLE:UPDATE`
  grant · `404` role not found.

## Users

### `GET /api/users`

List all users.

- **Response**: `User[]` with `id, name, email, isActive, lastLoginAt, createdAt, managerId,
  roles` (each role summarized as `{ id, name }`). No `passwordHash`.
- **Permissions**: `USER:READ`.
- **Status codes**: `200` success · `403` no `USER:READ` grant.

### `POST /api/users`

Create a user.

- **Request body** (`createUserSchema`):
  ```json
  {
    "name": "string, 1-120 chars",
    "email": "string, valid email, lowercased",
    "password": "string, min 8 chars — hashed with bcrypt (cost 12) before storage",
    "roleIds": "string[], min 1",
    "managerId": "string, optional/nullable"
  }
  ```
- **Response**: the created `User` (same shape as the list response).
- **Permissions**: `USER:CREATE`.
- **Status codes**: `200` created · `400` a user with that email already exists, or schema
  validation failure · `403` no `USER:CREATE` grant.

### `PUT /api/users/[id]/roles`

Replace a user's role assignments.

- **Request body** (`updateUserRolesSchema`): `{ "roleIds": "string[], min 1" }`.
- **Response**: the updated `User`.
- **Permissions**: `USER:UPDATE`.
- **Status codes**: `200` success · `400` schema validation failure · `403` no `USER:UPDATE`
  grant · `404` user not found.

### `PUT /api/users/[id]/status`

Activate or deactivate a user.

- **Request body** (`updateUserStatusSchema`): `{ "isActive": "boolean" }`.
- **Response**: the updated `User`.
- **Permissions**: `USER:UPDATE`.
- **Status codes**: `200` success · `400` schema validation failure, or the caller is trying
  to deactivate their own account (blocked) · `403` no `USER:UPDATE` grant · `404` user not
  found.

## Custom Fields

### `GET /api/custom-fields`

List custom field definitions, optionally filtered to one entity.

- **Query params**: `entityType?` (string).
- **Response**: `CustomFieldDefinition[]`.
- **Permissions**: **none** — deliberately ungated (still requires an authenticated session
  via `withApiHandler`). A field definition is schema metadata every entity's create/edit form
  needs to read, not business data.
- **Status codes**: `200` success.

### `POST /api/custom-fields`

Create a custom field definition.

- **Request body** (`customFieldDefinitionSchema`):
  ```json
  {
    "entityType": "string — a known core entity (currently only JOB) or an existing custom object's apiKey",
    "key": "string, 1-64 chars, /^[a-z][a-z0-9_]*$/, unique per entityType",
    "label": "string, 1-120 chars",
    "fieldType": "TEXT | NUMBER | DATE | DROPDOWN | MULTI_SELECT | LOOKUP",
    "isRequired": "boolean, default false",
    "isActive": "boolean, default true",
    "sortOrder": "integer, default 0",
    "options": "required shape depends on fieldType — { choices: [{ value, label }] } for DROPDOWN/MULTI_SELECT, { targetEntityType } for LOOKUP",
    "defaultValue": "any, optional"
  }
  ```
- **Response**: the created `CustomFieldDefinition`.
- **Permissions**: `CUSTOM_FIELD_DEFINITION:CREATE`.
- **Status codes**: `200` created · `400` unrecognized `entityType`, a duplicate `(entityType,
  key)`, missing/invalid `options` for the given `fieldType`, or schema validation failure ·
  `403` no `CUSTOM_FIELD_DEFINITION:CREATE` grant.

### `PATCH /api/custom-fields/[id]`

Update a custom field definition.

- **Request body** (`customFieldDefinitionUpdateSchema`): same shape as create, with
  `entityType`, `key`, and `fieldType` also optional.
- **Response**: the updated `CustomFieldDefinition`.
- **Permissions**: `CUSTOM_FIELD_DEFINITION:UPDATE`.
- **Status codes**: `200` success · `400` invalid `options` for the given `fieldType`, or
  schema validation failure · `403` no `CUSTOM_FIELD_DEFINITION:UPDATE` grant · `404`
  definition not found.

### `DELETE /api/custom-fields/[id]`

Delete a custom field definition.

- **Response**: `{ "ok": true }`.
- **Permissions**: `CUSTOM_FIELD_DEFINITION:DELETE`.
- **Status codes**: `200` success · `403` no `CUSTOM_FIELD_DEFINITION:DELETE` grant · `404`
  definition not found.

## Custom Objects

### `GET /api/custom-objects`

List custom object definitions.

- **Response**: `CustomObjectDefinition[]`.
- **Permissions**: `CUSTOM_OBJECT_DEFINITION:READ` — unlike custom field *definitions*, this
  list remains permission-gated.
- **Status codes**: `200` success · `403` no `CUSTOM_OBJECT_DEFINITION:READ` grant.

### `POST /api/custom-objects`

Create a custom object definition.

- **Request body** (`customObjectDefinitionSchema`):
  ```json
  {
    "apiKey": "string, 1-64 chars, /^[a-z][a-z0-9_]*$/, unique",
    "name": "string, 1-120 chars",
    "description": "string, optional, max 500 chars",
    "isActive": "boolean, required"
  }
  ```
- **Response**: the created `CustomObjectDefinition`.
- **Permissions**: `CUSTOM_OBJECT_DEFINITION:CREATE`.
- **Status codes**: `200` created · `400` `apiKey` already in use, or schema validation
  failure · `403` no `CUSTOM_OBJECT_DEFINITION:CREATE` grant.

### `PATCH /api/custom-objects/[id]`

Update a custom object definition.

- **Request body** (`customObjectDefinitionUpdateSchema`): `name`, `description`, `isActive`,
  all optional (`apiKey` is immutable after creation).
- **Response**: the updated `CustomObjectDefinition`.
- **Permissions**: `CUSTOM_OBJECT_DEFINITION:UPDATE`.
- **Status codes**: `200` success · `400` schema validation failure · `403` no
  `CUSTOM_OBJECT_DEFINITION:UPDATE` grant · `404` definition not found.

### `DELETE /api/custom-objects/[id]`

Delete a custom object definition.

- **Response**: `{ "ok": true }`.
- **Permissions**: `CUSTOM_OBJECT_DEFINITION:DELETE`.
- **Status codes**: `200` success · `403` no `CUSTOM_OBJECT_DEFINITION:DELETE` grant · `404`
  definition not found.

## Audit Log

### `GET /api/audit-log`

Search the audit log.

- **Query params** (`auditLogQuerySchema`): `actorId?`, `entityType?`, `entityId?`, `from?`
  (ISO date), `to?` (ISO date), `page?` (default `1`), `pageSize?` (default `25`, max `100`).
- **Response**: `{ entries: AuditLog[], total: number, page: number, pageSize: number }`. Each
  entry includes `actor` (`{ id, name, email }`, `null` for system-attributed entries).
- **Permissions**: `AUDIT_LOG:READ`.
- **Status codes**: `200` success · `400` invalid query params · `403` no `AUDIT_LOG:READ`
  grant.

## Controlled Lists

### `GET /api/controlled-lists/[key]`

Fetch a controlled list's active values (e.g. `DEPARTMENT`, `LOCATION`, `JOB_HOLD_REASON`).

- **Response**: `{ key: string, label: string, values: ControlledListValue[] }` — only
  `isActive: true` values, sorted by `sortOrder`.
- **Permissions**: **none** — deliberately ungated (still requires an authenticated session).
  Reference data every form needs for a dropdown, not business data.
- **Status codes**: `200` success · `404` no list with that key.

## Auth

### `GET/POST /api/auth/[...nextauth]`

The Auth.js v5 catch-all route handler (sign-in, sign-out, session, CSRF, callback endpoints).
Not custom application code — see `src/auth.ts` for the Credentials provider configuration
(email/password checked via `bcrypt.compare` against `User.passwordHash`; `User.isActive`
must be `true`) and NextAuth's own documentation for the exact sub-routes and payloads
(`/api/auth/signin`, `/api/auth/callback/credentials`, `/api/auth/session`,
`/api/auth/csrf`, `/api/auth/signout`).
