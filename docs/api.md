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

Module-4-specific error conditions all map to one of the generic error types above, not a new
type — listed here because they're easy to miss when reasoning about what an Application
endpoint can return:

| Condition | Error | Status | Notes |
| --- | --- | --- | --- |
| Transitioning an application whose `outcome` is already `REJECTED`/`WITHDRAWN` (terminal outcome) | `ValidationError` | `400` | `{ "error": "This application is already rejected and cannot be transitioned further." }` (or `withdrawn`) — no transition of any kind is accepted once an outcome leaves `ACTIVE`. |
| `STAGE_MOVE`/create targeting a `PipelineStage` that is inactive, belongs to a different job, or doesn't exist | `ValidationError` | `400` | `{ "error": "Invalid pipeline stage." }` |
| The caller's `version` no longer matches the stored row (stale version) | `ConflictError` | `409` | `{ "error": "This application was changed by someone else. Reload and try again." }` — identical message/shape to Job's and Candidate's own version-conflict error. |
| Duplicate-warning behavior on create/duplicate-check | *(not an error)* | `200` | Re-applying a candidate to a job with existing prior applications is **never** rejected — `POST /api/applications` always succeeds and returns `priorApplications` on the response; `GET /api/applications/duplicates` is a separate, side-effect-free pre-flight check for the same data. This is a deliberate difference from Candidate's hard phone-duplicate block. |

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

## Applications

### `GET /api/applications`

List applications, filtered and scoped to what the caller is permitted to see.

- **Query params** (`applicationQuerySchema`): `jobId?`, `candidateId?`, `stageId?`, `outcome?`
  (`ACTIVE | REJECTED | WITHDRAWN`), `ownerId?`, `q?` (case-insensitive candidate-name search),
  `page?` (default `1`), `pageSize?` (default `25`, max `100`).
- **Response**: `{ applications: Application[], total: number, page: number, pageSize: number
  }`. Each `Application` includes `candidate`, `job`, `stage`, `owner`.
- **Permissions**: `APPLICATION:READ`. The effective scope (`ALL`/`TEAM`/`OWN`) is resolved via
  `getEffectiveScope` and applied as a `WHERE ownerId ...` filter — `OWN` restricts to
  applications the caller owns, `TEAM` to the caller and their direct reports. A caller-supplied
  `ownerId` filter narrows further but can never widen past the caller's own scope.
- **Status codes**: `200` success · `400` invalid query params · `403` no `APPLICATION:READ`
  grant at any scope.

### `POST /api/applications`

Create an application, linking a candidate to a job.

- **Request body** (`applicationCreateSchema`):
  ```json
  {
    "candidateId": "string, required",
    "jobId": "string, required",
    "stageId": "string, optional — defaults to the job's lowest-sortOrder active PipelineStage",
    "ownerId": "string, optional — defaults to Job.primaryRecruiterId",
    "customFields": "object, optional — validated against active APPLICATION custom field definitions"
  }
  ```
- **Response**: the created `Application` (full detail include — see `GET
  /api/applications/[id]`), plus `priorApplications: { id, outcome, createdAt }[]` — every other
  existing application for the same `(candidateId, jobId)` pair, for the create form's
  non-blocking duplicate warning. Re-applying is **never** blocked, only surfaced.
- **Permissions**: `APPLICATION:CREATE`.
- **Status codes**: `200` created · `400` schema validation failure, candidate/job not found, an
  explicit `stageId` that's inactive or belongs to a different job, the job has no active
  pipeline stages configured at all (and no `stageId` was given), an inactive `ownerId`, or an
  invalid/inactive custom field · `403` no `APPLICATION:CREATE` grant.

### `GET /api/applications/[id]`

Fetch one application's full detail.

- **Response**: the `Application` with `candidate`, `job`, `stage`, `owner`, `createdBy`,
  `outcomeReason`, and `events` (newest first, each with `actor`, `fromStage`, `toStage`,
  `reason`).
- **Permissions**: `APPLICATION:READ` at `ALL` scope, or at `OWN`/`TEAM` scope where the caller
  (or their team) is the application's owner.
- **Status codes**: `200` success · `403` caller has no qualifying grant for this application ·
  `404` no application with that id.

### `PATCH /api/applications/[id]`

Partially update an application. Requires optimistic-locking `version`. Does **not** accept
`stageId` or `outcome` — those go through `POST /api/applications/[id]/transition` instead, never
through a plain update.

- **Request body** (`applicationUpdateSchema`): `version` (required, integer) plus any subset of
  `ownerId` (reassign the owner), `customFields`.
- **Response**: the updated `Application` (full detail include), with `version` incremented by 1.
- **Permissions**: same ownership rule as `GET /api/applications/[id]`, but for
  `APPLICATION:UPDATE`.
- **Status codes**: `200` success · `400` schema validation failure, an inactive `ownerId`, or an
  invalid custom field · `403` no qualifying grant · `404` application not found · `409` the
  supplied `version` no longer matches the stored row.

### `GET /api/applications/duplicates`

Pre-flight duplicate check for the create form — never mutates anything, and never blocks.

- **Query params** (`applicationDuplicateCheckSchema`): `candidateId` (required), `jobId`
  (required).
- **Response**: `{ priorApplications: { id, outcome, stageId, createdAt }[] }` — every existing
  application for this exact `(candidateId, jobId)` pair, newest first. An empty array means no
  prior application exists; a non-empty array is shown as a non-blocking warning, never an error.
- **Permissions**: `APPLICATION:READ` at any scope (checked via `getEffectiveScope`, not against
  any one record — a plain `OWN`-scope grant, the common Recruiter case, still passes).
- **Status codes**: `200` success · `400` missing/invalid `candidateId`/`jobId` · `403` no
  `APPLICATION:READ` grant at any scope.

### `POST /api/applications/[id]/transition`

Move an application's stage, or set a terminal outcome (reject/withdraw). The one entry point
for all three single-application transitions — mirrors Job's `/status` action-endpoint pattern.
Rejected and Withdrawn are terminal: once `outcome` leaves `ACTIVE`, no further call to this
endpoint for the same application succeeds, regardless of `action`.

- **Request body** (`applicationTransitionSchema`, a discriminated union on `action`):
  ```json
  { "action": "STAGE_MOVE", "version": "integer, required", "toStageId": "string, required", "note": "string, optional, max 2000 chars" }
  ```
  ```json
  { "action": "REJECT", "version": "integer, required", "reasonId": "string, required — must be an active REJECTION_REASON value", "note": "string, optional" }
  ```
  ```json
  { "action": "WITHDRAW", "version": "integer, required", "reasonId": "string, required — same list as REJECT", "note": "string, optional" }
  ```
- **Response**: the updated `Application` (full detail include), with a new `ApplicationEvent`
  row reflected in `events`.
- **Permissions**: `APPLICATION:UPDATE` at `ALL` scope, or at `OWN`/`TEAM` scope against the
  application's owner.
- **Status codes**: `200` success · `400` the application's outcome is already terminal (see the
  error table above), `toStageId` refers to an inactive/nonexistent/wrong-job stage, or
  `reasonId` isn't an active `REJECTION_REASON` value · `403` no qualifying grant · `404`
  application not found · `409` version mismatch.

### `POST /api/applications/bulk/transition`

Apply the same stage-move/reject/withdraw action to many applications in one request.
**Best-effort, not atomic** — one target's failure doesn't fail the rest.

- **Request body** (`applicationBulkTransitionSchema`, a discriminated union on `action`):
  ```json
  {
    "action": "STAGE_MOVE",
    "applications": [{ "id": "string", "version": "integer" }, "1-500 entries"],
    "toStageId": "string, required",
    "note": "string, optional"
  }
  ```
  (`REJECT`/`WITHDRAW` take the same `applications` array plus `reasonId` instead of
  `toStageId`.)
- **Response**: `{ "succeeded": Application[], "failed": [{ "id": string, "reason": string },
  ...] }`. Each target is processed independently through the same logic as
  `POST /api/applications/[id]/transition`; a stale version, terminal-outcome conflict, or
  missing permission on one target lands it in `failed` with a human-readable `reason` instead of
  aborting the batch.
- **Permissions**: same as the single-application transition, checked per target — a caller
  missing the grant for one target simply gets that one reported in `failed`.
- **Status codes**: `200` success (inspect the response body — some targets may still be
  `failed`) · `400` schema validation failure (e.g. empty `applications` array, more than 500
  entries) · `403` only if the request as a whole can't be parsed as a valid action.

### `POST /api/applications/bulk/email`

Send a templated email to many applications' candidates (§11.10, Module 8 — originally
infrastructure-only, now actually delivers via `MailProvider`; see
[Communication Templates](#communication-templates) below).

- **Request body** (`applicationBulkEmailSchema`):
  ```json
  {
    "applicationIds": "string[], 1-500 entries, required",
    "templateId": "string, required — an active CommunicationTemplate id"
  }
  ```
  An unknown or inactive `templateId` fails the whole request with `400` — it's a shared
  precondition for the entire call, not a per-application concern.
- **Response**: `{ "succeeded": [{ "applicationId": string, "toEmail": string, "status": "SENT"
  | "FAILED" }, ...], "failed": [{ "id": string, "reason": string }, ...] }`. A candidate with no
  email on file, an application the caller can't `UPDATE`, or a nonexistent application id lands
  that target in `failed` (`"Candidate has no email on file."`, a permission message, or
  `"Application not found."` respectively) rather than aborting the batch — note this is
  different from `succeeded` items with `status: "FAILED"`, which mean the email log row was
  created but the `MailProvider` reported a delivery failure.
- **Permissions**: `APPLICATION:UPDATE`, checked per target the same way bulk transition is.
- **Status codes**: `200` success (inspect the response body — some targets may still report a
  delivery failure) · `400` schema validation failure or an invalid `templateId` · `403` only if
  the request as a whole can't be parsed as a valid action.

## Communication Templates

Admin-managed templates for `POST /api/applications/bulk/email` (§11.10, Module 8). Reading the
list is open to any authenticated user (the bulk-email picker needs it); create/update require
`COMMUNICATION_TEMPLATE:CREATE`/`UPDATE`. No delete route — deactivate via `PATCH isActive:false`
instead, same convention as pipeline stages.

### `GET /api/communication-templates`

- **Query params**: `channel` (`EMAIL`/`SMS`, optional), `isActive` (`"true"`/`"false"`, optional).
- **Response**: `CommunicationTemplate[]`, ordered by name.

### `POST /api/communication-templates`

- **Request body** (`communicationTemplateCreateSchema`): `{ "name": "string, 1-120 chars,
  required, unique", "channel": "EMAIL | SMS", "subject": "string, 1-200 chars, required —
  supports {{candidate.name}} / {{job.title}}", "body": "string, 1-10000 chars, required — same
  placeholders", "isActive": "boolean" }`.
- **Status codes**: `201`/`200` success · `400` a duplicate name or schema validation failure ·
  `403` missing `COMMUNICATION_TEMPLATE:CREATE`.

### `PATCH /api/communication-templates/[id]`

- **Request body** (`communicationTemplateUpdateSchema`): any of `channel`, `subject`, `body`,
  `isActive` — `name` is immutable once created (deactivate and create a replacement to rename).
- **Status codes**: `200` success · `404` unknown id · `403` missing
  `COMMUNICATION_TEMPLATE:UPDATE`.

## Pipeline Stages

Configuring a job's pipeline is authorized as `JOB:<action>` on the parent job (see
[architecture.md#pipelinestage](architecture.md#pipelinestage)), not a separate resource —
there is no `PIPELINE_STAGE:*` permission.

### `GET /api/jobs/[id]/pipeline-stages`

List a job's pipeline stages, active and inactive alike, in `sortOrder`.

- **Response**: `PipelineStage[]` — `{ id, jobId, name, sortOrder, isActive, createdAt,
  updatedAt }`.
- **Permissions**: `JOB:READ` at `ALL` scope, or at `OWN`/`TEAM` scope against the job's primary
  recruiter.
- **Status codes**: `200` success · `403` no qualifying grant · `404` job not found.

### `PUT /api/jobs/[id]/pipeline-stages`

Replace a job's entire pipeline stage set. The client always submits the complete desired
**active** list, in order — this is a full-set replace, the same convention `PUT
/api/jobs/[id]/recruiters` established in Module 2.

- **Request body** (`pipelineStagesReplaceSchema`):
  ```json
  {
    "stages": [
      { "id": "string, optional — omit for a new stage", "name": "string, 1-100 chars" }
    ]
  }
  ```
  At least one stage, required; names must be case-insensitively unique within the request.
- **Response**: the job's full stage list (active **and** inactive), in `sortOrder` — not just
  what was submitted. An entry whose `id` matches an existing stage is renamed/reordered/
  reactivated in place (`sortOrder` is set to its position in the submitted array); an entry with
  no `id` is created; an existing active stage omitted from the array is **deactivated**, never
  deleted.
- **Permissions**: `JOB:UPDATE` at `ALL` scope, or at `OWN`/`TEAM` scope against the job's primary
  recruiter.
- **Status codes**: `200` success · `400` schema validation failure (empty list, duplicate names)
  · `403` no qualifying grant · `404` job not found.

Deactivating a stage does **not** check for active applications still sitting in it at the
service layer — that guard is client-side only (the pipeline-stage editor UI blocks the removal
and shows a count). An `Application.stageId` pointing at a now-inactive stage is left completely
untouched either way; only new stage-move/create requests are validated against `isActive`.

## Reports

Four pre-built reports (§11.12, Module 9), each reusing the underlying entity's own `:READ`
permission and scope — no separate `REPORT` resource. Row-level security (§10.5) falls out of
this: an OWN/TEAM-scoped viewer's report is narrowed exactly like their own Job/Application/Offer
lists are.

### `GET /api/reports/pipeline-funnel`

- **Query params** (`pipelineFunnelQuerySchema`): `jobId` (required), `recruiterId?`,
  `sourceId?`, `dateFrom?`/`dateTo?` (ISO dates).
- **Response**: `{ job: { id, title }, totalApplications: number, stages: [{ stageId, name,
  currentCount, reachedCount, conversionFromPrevious: number | null }] }`.
- **Permissions**: `JOB:READ`, scoped against the job's primary recruiter for OWN/TEAM grants.
- **Status codes**: `200` success · `400` missing `jobId` · `403` no qualifying grant (also
  returned, not `404`, if the job exists but is out of the caller's OWN/TEAM scope) · `404`
  unknown `jobId`.

### `GET /api/reports/time-to-fill-offer`

- **Query params** (`timeToFillOfferQuerySchema`): `departmentId?`, `locationId?`,
  `recruiterId?` (maps to `Job.primaryRecruiterId`, not `Application.ownerId`), `dateFrom?`/
  `dateTo?`.
- **Response**: `{ jobs: [{ jobId, title, departmentLabel, timeToFillDaysAvg: number | null,
  hiresCount, timeToOfferDaysAvg: number | null, offersCount }], overall: {...same shape,
  aggregated} }`. Days are business days (`src/lib/reporting/business-days.ts`), not calendar
  days.
- **Permissions**: `JOB:READ`.
- **Status codes**: `200` success (an empty `jobs: []` if scope excludes every job — not an
  error) · `403` no `JOB:READ` grant at all.

### `GET /api/reports/recruiter-productivity`

- **Query params** (`recruiterProductivityQuerySchema`): `recruiterId?` (omit for every
  recruiter your scope covers), `dateFrom?`/`dateTo?` — the date range narrows *activity* counts
  only (interviews scheduled, offers extended, hires); `openJobsCount`/`activeApplicationsCount`
  are always current snapshots.
- **Response**: `{ rows: [{ recruiter: { id, name, email }, openJobsCount,
  activeApplicationsCount, interviewsScheduledCount, offersExtendedCount, hiresCount }] }`.
- **Permissions**: `JOB:READ` (a recruiter's workload is fundamentally their owned jobs/
  applications). An OWN-scope caller may only request their own `recruiterId`.
- **Status codes**: `200` success · `403` no `JOB:READ` grant, or an OWN/TEAM-scope caller
  requesting a `recruiterId` outside their scope.

### `GET /api/reports/offer-tat-compliance`

- **Query params** (`offerTatComplianceQuerySchema`): `recruiterId?`, `tatThresholdDays?`
  (default `3` — a report parameter, not a stored org policy), `dateFrom?`/`dateTo?`.
- **Response**: `{ tatThresholdDays, measuredCount, pendingApprovalCount, compliantCount,
  complianceRate: number | null, avgTatDays: number | null, rows: [{ offerId, recruiter, tatDays,
  compliant }] }`. TAT is measured `Offer.createdAt` → the approved `OfferApproval.decidedAt` —
  offers with no approval decision yet are counted in `pendingApprovalCount`, not `rows`.
- **Permissions**: `OFFER:READ`.
- **Status codes**: `200` success · `403` no `OFFER:READ` grant.

### `GET /api/reports/export`

- **Query params** (`reportExportQuerySchema`): `reportType` (one of the four report types),
  `format` (`XLSX`/`CSV`/`PDF`), `filters` (a JSON-encoded query param — that report type's own
  query schema, e.g. `?reportType=PIPELINE_FUNNEL&format=CSV&filters=%7B%22jobId%22%3A%22...%22%7D`).
- **Response**: the file, with `Content-Disposition: attachment`.
- **Permissions**: same as the underlying report's own GET endpoint.
- **Status codes**: `200` success · `400` invalid `filters` JSON or a schema validation failure
  (e.g. missing `jobId` for `PIPELINE_FUNNEL`) · `403` no qualifying grant.

## Saved Reports

Saved, shareable report definitions with optional schedule-based email delivery (§10.5, Module
9) — business-record tier, not admin-metadata tier: `OWN`/`TEAM`/`ALL` scope on `createdById`,
optimistic-locking `version`. Deliberately **not** a generic drag-and-drop dashboard builder —
`reportType` picks one of the four pre-built reports above and `filters` narrows it.

### `GET /api/saved-reports`

- **Query params** (`savedReportQuerySchema`): `reportType?`.
- **Response**: `SavedReport[]`, scoped by `SAVED_REPORT:READ`.
- **Permissions**: `SAVED_REPORT:READ`.

### `POST /api/saved-reports`

- **Request body** (`savedReportCreateSchema`): `{ "name": "string, 1-200 chars, required —
  not unique, personal/team artifacts", "reportType": "PIPELINE_FUNNEL | TIME_TO_FILL_AND_OFFER |
  RECRUITER_PRODUCTIVITY | OFFER_TAT_COMPLIANCE", "filters": "object — validated against that
  reportType's own query schema", "scheduleFrequency": "NONE | DAILY | WEEKLY, default NONE",
  "recipientEmails": "string[], default [] — required non-empty if scheduleFrequency != NONE",
  "exportFormat": "XLSX | CSV | PDF, default XLSX" }`.
- **Status codes**: `201`/`200` success · `400` schema validation failure, invalid `filters` for
  the chosen `reportType`, or a schedule with no recipients · `403` no `SAVED_REPORT:CREATE`
  grant.

### `PATCH /api/saved-reports/[id]`

- **Request body** (`savedReportUpdateSchema`): `version` (required) plus any of `name`,
  `filters`, `scheduleFrequency`, `recipientEmails`, `exportFormat`. Cross-field validation
  (schedule requires recipients) is checked against the *merged* result — updating only
  `scheduleFrequency` to `DAILY` succeeds if the report already has recipient emails from
  creation.
- **Status codes**: `200` success · `400` validation failure or an invalid schedule/recipient
  combination · `403` no qualifying `SAVED_REPORT:UPDATE` grant · `404` unknown id · `409` stale
  `version`.

### `DELETE /api/saved-reports/[id]`

Hard delete — no historical FK references this row, unlike `CommunicationTemplate`.

- **Status codes**: `200` success · `403` no qualifying `SAVED_REPORT:DELETE` grant · `404`
  unknown id.

### `POST /api/saved-reports/run-due`

Runs every `SavedReport` whose schedule is due (`lastRunAt` missing, or older than its
`DAILY`/`WEEKLY` interval), re-applying each report's *creator's* own RBAC scope, and delivers it
via `MailProvider` with the rendered file as an attachment. No cron/queue infrastructure exists
in this app — this endpoint is the real business logic; actually invoking it on a schedule is
external infra (an OS cron or a hosting platform's scheduled function) this pass does not
provide.

- **Response**: `{ dueCount, sentCount, failedCount }`.
- **Permissions**: `SAVED_REPORT:UPDATE` with no ownership context — in practice only an
  ALL-scope grant (System Administrator by default) passes, since no seeded role has an
  ALL-scope `SAVED_REPORT:UPDATE` grant. A system-wide operation, gated through the existing
  permission model rather than a bespoke `isSuperAdmin` check.
- **Status codes**: `200` success · `403` no qualifying grant.

## Workflows

Admin-configurable trigger → conditions → actions automations (§10.2, Module 10) —
business-record tier, not admin-metadata tier: `OWN`/`TEAM`/`ALL` scope on `createdById`,
optimistic-locking `version`, deactivate-don't-delete.

### `GET /api/workflows`

- **Query params** (`workflowDefinitionQuerySchema`): `jobId?`, `isActive?` (`"true"`/`"false"`
  string, coerced explicitly — not `z.coerce.boolean()`, which maps the string `"false"` to
  `true`).
- **Response**: `WorkflowDefinition[]`, each including `job`, `createdBy`, and `activeVersion`
  (the full current trigger/conditions/actions), scoped by `WORKFLOW_DEFINITION:READ`.
- **Permissions**: `WORKFLOW_DEFINITION:READ`.
- **Status codes**: `200` success · `403` no qualifying grant.

### `POST /api/workflows`

- **Request body** (`workflowDefinitionCreateSchema`): `{ "name": "string, 1-200 chars,
  required", "jobId": "string | null, optional — null/omitted applies to every job", "isActive":
  "boolean, default true", "trigger": "{ type, config } — see trigger shapes below",
  "conditions": "array of { field, operator, value }, max 20, default []", "actions": "array of
  { type, ... }, 1-10 required" }`.
  - Trigger shapes: `{ type: "STAGE_CHANGE", config: { toStageId } }` · `{ type:
    "FIELD_UPDATE", config: { fieldKey } }` · `{ type: "TIME_IN_STAGE", config: { stageId,
    days } }` · `{ type: "FORM_SUBMISSION", config: {} }`. `STAGE_CHANGE`/`TIME_IN_STAGE`
    require a non-null `jobId` — the `PipelineStage` they reference is itself job-scoped.
  - Condition operators: `EQUALS` / `NOT_EQUALS` / `GREATER_THAN` / `LESS_THAN` / `CONTAINS`,
    always against an `Application.customFields` key (AND-only — no OR/grouping).
  - Action shapes: `{ type: "SEND_EMAIL", templateId }` · `{ type: "CREATE_TASK", title,
    description?, assignedToId, dueInDays? }` · `{ type: "CHANGE_FIELD", fieldKey, value }` ·
    `{ type: "REASSIGN_OWNER", userId }` · `{ type: "REQUEST_APPROVAL", title, description?,
    approverId }`. `CHANGE_FIELD` is scoped to `Application.customFields` only — core lifecycle
    fields (stage/outcome/owner) keep their own guarded transition paths.
- **Response**: the created `WorkflowDefinition`, `version: 0`, with its first
  `WorkflowDefinitionVersion` (`versionNumber: 1`) as `activeVersion`.
- **Status codes**: `201`/`200` success · `400` schema validation failure, an unknown/inactive
  referenced custom field, template, or user, or a stage-referencing trigger with no `jobId` ·
  `403` no `WORKFLOW_DEFINITION:CREATE` grant.

### `GET /api/workflows/[id]`

- **Response**: the `WorkflowDefinition` including its full `versions` history (newest first),
  each with its own `createdBy`.
- **Permissions**: `WORKFLOW_DEFINITION:READ`, unscoped or scoped to this definition's own
  `createdById`.
- **Status codes**: `200` success · `403` no qualifying grant · `404` unknown id.

### `PATCH /api/workflows/[id]`

- **Request body** (`workflowDefinitionUpdateSchema`): `version` (required) plus any of `name`,
  `isActive` (plain metadata, no version bump implication) and `trigger`/`conditions`/`actions`
  (**all-or-nothing** — supplying any one without the other two fails validation; supplying all
  three creates a new `WorkflowDefinitionVersion` and re-points `activeVersionId`, never
  mutating the previous version). `jobId` is not editable here — re-scoping a live workflow to a
  different job is a bigger design question than this pass answers; create a new workflow
  instead.
- **Status codes**: `200` success · `400` validation failure or an invalid trigger/condition/
  action reference · `403` no qualifying `WORKFLOW_DEFINITION:UPDATE` grant · `404` unknown id ·
  `409` stale `version`.

### `POST /api/workflows/[id]/rollback`

- **Request body** (`workflowRollbackSchema`): `{ "version": number, "targetVersionId": string
  }`.
- Re-points `activeVersionId` at an older, still-existing version — never mutates or deletes
  any version row, so every version ever saved stays queryable via `GET /api/workflows/[id]`
  regardless of which one is active.
- **Status codes**: `200` success · `400` `targetVersionId` doesn't belong to this workflow ·
  `403` no qualifying `WORKFLOW_DEFINITION:UPDATE` grant · `404` unknown id · `409` stale
  `version`.

### `POST /api/workflows/run-due`

Evaluates every active `TIME_IN_STAGE` workflow against every application currently past its
configured stage-age threshold. No cron/queue infrastructure exists anywhere in this app — this
endpoint is the real business logic; actually invoking it periodically is external infra (an OS
cron or a hosting platform's scheduled function) this pass does not provide. Each fired
automation runs attributed to the workflow's own creator (there is no live triggering request
to borrow a session from); a deactivated creator's workflows are skipped, not run as no one.

- **Response**: `{ evaluatedCount, firedCount }`.
- **Permissions**: `WORKFLOW_DEFINITION:UPDATE` with no ownership context — in practice only an
  ALL-scope grant (System Administrator by default) passes, the same gating
  `POST /api/saved-reports/run-due` uses.
- **Status codes**: `200` success · `403` no qualifying grant.

## Workflow Tasks

Tasks and approval requests an automation created (`CREATE_TASK`/`REQUEST_APPROVAL`, §10.2,
Module 10). Access is two independent paths: whoever can manage the owning Application
(`APPLICATION:UPDATE`, unscoped or scoped to its owner), **or** the task's own assignee,
unconditionally — not gated by any Application permission at all, since `REQUEST_APPROVAL`
exists specifically to route a decision to someone who may hold none (e.g. a Hiring Manager).

### `GET /api/workflow-tasks`

- **Query params** (`workflowTaskQuerySchema`): `applicationId?` (requires the caller be able
  to read that application; returns every task on it, any assignee), `assignedToId?` (defaults
  to the caller's own id when `applicationId` is omitted — this is the "My Tasks" query),
  `status?` (`OPEN`/`DONE`/`APPROVED`/`REJECTED`).
- **Status codes**: `200` success · `403` `applicationId` given but the caller can't read that
  application · `404` unknown `applicationId`.

### `POST /api/workflow-tasks/[id]/complete`

Resolves an `OPEN` task to `DONE`.

- **Status codes**: `200` success · `400` task already resolved · `403` caller is neither the
  assignee nor able to manage the owning application · `404` unknown id · `409` the task was
  already resolved by a concurrent request (status-guarded `updateMany`, the same optimistic-
  concurrency shape as a `version`-guarded update, keyed on `status` instead of an integer since
  "did someone else already resolve this" is the only conflict that matters here).

### `POST /api/workflow-tasks/[id]/decide`

- **Request body**: `{ "outcome": "APPROVED" | "REJECTED" }`.
- Resolves an `OPEN` task to the given outcome — the same status-guarded update as `complete`,
  just with a caller-supplied terminal status instead of a fixed `DONE`.
- **Status codes**: `200` success · `400` task already resolved · `403` caller is neither the
  assignee nor able to manage the owning application · `404` unknown id · `409` already resolved
  by a concurrent request.

## Job Postings & Referrals (§11.3, Module 11)

Posting a job to a board, recording an inbound application against a posting, and capturing a
referral. Access to a posting is authorized as `JOB:<action>` on the parent job (unscoped or
scoped to `Job.primaryRecruiterId`) — the same reuse `PipelineStage`'s own endpoints already
establish; there is no separate `JOB_POSTING` permission resource.

### `GET /api/jobs/[id]/postings`

Lists every board this job has ever been posted to (including `REMOVED`/`FAILED` rows), newest
first.

- **Status codes**: `200` success · `403` caller lacks `JOB:READ` over this job · `404` unknown
  job id.

### `POST /api/jobs/[id]/postings`

Posts (or re-posts, after a removal) this job to a board via the configured `JobBoardProvider`.

- **Request body** (`jobPostingCreateSchema`): `{ "sourceId": string }` — a `CANDIDATE_SOURCE`
  controlled-list value id.
- A provider failure (e.g. the mock provider's "no description" rejection) does not itself return
  an error — the posting is recorded with `status: "FAILED"` and the provider's own
  `errorMessage`, so `200` is still returned; the caller reads `status` to know whether it
  actually succeeded.
- **Status codes**: `200` success (including a recorded `FAILED` posting) · `400` the job isn't
  `OPEN`, or already `POSTED` to this board, or `sourceId` isn't a valid/active
  `CANDIDATE_SOURCE` value · `403` caller lacks `JOB:UPDATE` over this job · `404` unknown job id
  · `409` a concurrent request already claimed the first post to this exact `(job, board)` pair
  (the `@@unique([jobId, sourceId])` constraint is the real guard, not a pre-check).

### `POST /api/job-postings/[id]/remove`

Removes an active posting from its board.

- **Status codes**: `200` success · `400` the posting is not currently `POSTED`, or the provider
  itself reported a removal failure · `403` caller lacks `JOB:UPDATE` over the parent job · `404`
  unknown posting id · `409` the posting was already changed by a concurrent request
  (status-guarded `updateMany`, the same shape `WorkflowTask`'s resolution endpoints use).

### `POST /api/job-postings/[id]/inbound`

Records what a board notified staff about — creates (or, on a phone match, reuses) the candidate,
tagged with this posting's board as `Candidate.sourceId`, and creates an application for the
posting's job, tagged with this specific posting via `Application.sourcedFromPostingId`. There is
no public, unauthenticated apply page in this app (§7); this is the staff-authenticated entry
point a future real board integration's webhook handler or polling adapter would call once
credentials exist.

- **Request body** (`inboundApplicationSchema`): `{ "name": string, "phone": string, "email"?:
  string, "note"?: string }`.
- `note`, when given, is stored as a `CandidateNote` on the resulting candidate, not on the
  application — `Application.customFields` has no matching field to hold it, and the note is
  about the *person*, not this one application.
- **Status codes**: `200` success · `400` the posting is not currently `POSTED` · `403` caller
  lacks `JOB:UPDATE` over the parent job · `404` unknown posting id.

### `POST /api/referrals`

Captures a referral — creates (or, on a phone match, reuses) the candidate with `sourceId` fixed
to the `CANDIDATE_SOURCE` list's "Referral" value, and creates an application for the named job,
in one combined step.

- **Request body** (`referralCreateSchema`): `{ "jobId": string, "name": string, "phone": string,
  "email"?: string, "note"?: string }`.
- **Status codes**: `200` success · `400` no active "Referral" value exists in the
  `CANDIDATE_SOURCE` controlled list · `403` caller lacks `CANDIDATE:CREATE` or
  `APPLICATION:CREATE` · `404` unknown `jobId`.

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
